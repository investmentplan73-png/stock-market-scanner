// Angel One SmartAPI integration through the local Node proxy.
const AngelOneAPI = {
    isConnected: false,
    lastError: '',
    historicalRateLimitedUntil: 0,
    lastHistoricalRateLimitLogAt: 0,
    ws: null,
    wsReconnectTimer: null,
    wsConnected: false,
    wsStartedAt: 0,

    getProxyBase: function() {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            return window.location.origin;
        }
        return Config.endpoints.proxyBase;
    },

    proxyFetch: async function(path, payload = {}, timeoutMs = 45000) {
        let response;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            response = await fetch(`${this.getProxyBase()}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Local server request timed out. Instrument master or Angel One API is slow.');
            }
            throw new Error('Local server is not running. Run start-app.bat and keep that window open.');
        } finally {
            clearTimeout(timeoutId);
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `Proxy error ${response.status}`);
        }
        if (data && (data.status === false || data.success === false)) {
            const message = data.message || data.error || data.errorCode || 'Angel One request failed';
            const code = data.errorcode || data.errorCode;
            throw new Error(code ? `${message} (${code})` : message);
        }
        this.lastError = '';
        return data;
    },

    init: async function() {
        const { apiKey, apiSecret, clientId, totpSecret } = Config;

        if (!apiKey || !apiSecret || !clientId) {
            this.lastError = 'Missing Angel One credentials';
            this.log('Error: Missing Angel One credentials');
            return false;
        }

        try {
            const loginResponse = await this.login(apiKey, apiSecret, clientId, this.generateTOTP(totpSecret));

            if (loginResponse?.status === true && loginResponse?.data?.jwtToken) {
                Config.accessToken = loginResponse.data.jwtToken;
                Config.refreshToken = loginResponse.data.refreshToken || '';
                Config.feedToken = loginResponse.data.feedToken || '';
                Config.saveConfig();
                this.isConnected = true;
                this.log('Connected to Angel One SmartAPI');
                return true;
            }

            this.lastError = `${loginResponse?.message || 'Unknown response'}${loginResponse?.errorcode ? ` (${loginResponse.errorcode})` : ''}`;
            this.log(`Login failed: ${this.lastError}`);
            return false;
        } catch (error) {
            this.lastError = error.message;
            this.log(`API connection error: ${error.message}`);
            return false;
        }
    },

    login: async function(apiKey, password, clientId, totpToken = '') {
        return this.proxyFetch(Config.endpoints.login, {
            apiKey,
            password,
            clientId,
            totp: totpToken,
            publicIp: Config.publicIp
        });
    },

    generateTOTP: function(value) {
        return /^\d{6}$/.test(String(value || '').trim()) ? String(value).trim() : '';
    },

    getLTP: async function(instruments, mode = 'LTP') {
        const exchangeTokens = this.normalizeExchangeTokens(instruments);

        try {
            const data = await this.proxyFetch(Config.endpoints.marketData, {
                apiKey: Config.apiKey,
                jwtToken: Config.accessToken,
                publicIp: Config.publicIp,
                mode,
                exchangeTokens
            }, 30000);

            return {
                status: data.status,
                data: data?.data?.fetched || []
            };
        } catch (error) {
            this.lastError = error.message;
            this.log(`LTP error: ${error.message}`);
            return null;
        }
    },

    normalizeExchangeTokens: function(instruments) {
        if (instruments && typeof instruments === 'object' && !Array.isArray(instruments)) {
            return Object.entries(instruments).reduce((grouped, [exchange, tokens]) => {
                const tokenList = Array.isArray(tokens) ? tokens : [tokens];
                grouped[exchange] = tokenList.map(String).filter(Boolean);
                return grouped;
            }, {});
        }

        const tokens = Array.isArray(instruments) ? instruments.map(String) : [String(instruments)];
        return { NSE: tokens.filter(Boolean) };
    },

    getWebSocketUrl: function() {
        const base = this.getProxyBase();
        const url = new URL(Config.endpoints.wsFeed, base);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
    },

    getHistoricalData: async function(symbol, interval, fromDate, toDate, exchange = 'NSE') {
        if (Date.now() < this.historicalRateLimitedUntil) {
            const waitSeconds = Math.ceil((this.historicalRateLimitedUntil - Date.now()) / 1000);
            this.lastError = `Angel One historical data rate limit active; retrying in ${waitSeconds}s`;
            return null;
        }

        try {
            return await this.proxyFetch(Config.endpoints.history, {
                apiKey: Config.apiKey,
                jwtToken: Config.accessToken,
                publicIp: Config.publicIp,
                exchange,
                symboltoken: symbol,
                interval,
                fromdate: fromDate,
                todate: toDate
            });
        } catch (error) {
            this.lastError = error.message;
            if (this.isHistoricalRateLimit(error.message)) {
                this.historicalRateLimitedUntil = Date.now() + 90000;
                if (Date.now() - this.lastHistoricalRateLimitLogAt > 30000) {
                    this.log('Historical data rate limit hit; pausing candle requests for 90s and reusing cached signals where possible.');
                    this.lastHistoricalRateLimitLogAt = Date.now();
                }
                return null;
            }

            this.log(`Historical data error: ${error.message}`);
            return null;
        }
    },

    isHistoricalRateLimit: function(message) {
        return /exceeding access rate|rate.?limit|too many/i.test(String(message || ''));
    },

    getOptionsChain: async function(scanner, expiryDate, spotPrice) {
        try {
            return await this.proxyFetch(Config.endpoints.optionChain, {
                apiKey: Config.apiKey,
                jwtToken: Config.accessToken,
                publicIp: Config.publicIp,
                symbol: scanner.symbol,
                segment: scanner.segment || 'INDEX',
                exchange: scanner.exchange || 'NSE',
                expiryDate,
                spotPrice,
                strikeStep: OptionSignalEngine.getStrikeStep(scanner.symbol),
                width: Config.optionScanner.nearAtmStrikes,
                extraStrikes: typeof getOpenStrikesForSymbol === 'function' ? getOpenStrikesForSymbol(scanner.symbol) : []
            }, 180000);
        } catch (error) {
            this.lastError = error.message;
            this.log(`Options chain error: ${error.message}`);
            return null;
        }
    },

    getOptionExpiries: async function(symbol, segment = 'INDEX') {
        try {
            return await this.proxyFetch(Config.endpoints.optionExpiries, { symbol, segment }, 12000);
        } catch (error) {
            this.lastError = error.message;
            this.log(`Expiry lookup error: ${error.message}`);
            return null;
        }
    },

    resolveInstruments: async function(symbols, segment = 'STOCK') {
        try {
            return await this.proxyFetch(Config.endpoints.resolveInstruments, { symbols, segment });
        } catch (error) {
            this.lastError = error.message;
            this.log(`Instrument resolver error: ${error.message}`);
            return null;
        }
    },

    initWebSocket: function(exchangeTokens = null, force = false) {
        if (!this.isConnected || isDemoMode) return;
        if (force) {
            this.closeWebSocket();
        } else if (this.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.ws.readyState)) {
            return;
        }

        const tokens = exchangeTokens || (typeof getIndexExchangeTokens === 'function' ? getIndexExchangeTokens() : {});
        if (!Config.feedToken) {
            this.log('WebSocket feed token missing; quote polling fallback is active.');
            return;
        }

        try {
            this.ws = new WebSocket(this.getWebSocketUrl());
            this.wsStartedAt = Date.now();
        } catch (error) {
            this.lastError = error.message;
            this.log(`WebSocket init error: ${error.message}`);
            return;
        }

        this.ws.onopen = () => {
            this.wsConnected = true;
            this.ws.send(JSON.stringify({
                type: 'start',
                apiKey: Config.apiKey,
                jwtToken: Config.accessToken,
                clientId: Config.clientId,
                feedToken: Config.feedToken,
                exchangeTokens: tokens
            }));
            this.log('WebSocket feed requested through local proxy.');
        };

        this.ws.onmessage = event => {
            this.handleWebSocketMessage(event.data);
        };

        this.ws.onerror = () => {
            this.wsConnected = false;
            this.log('WebSocket feed error; quote polling fallback remains active.');
        };

        this.ws.onclose = () => {
            const wasConnected = this.wsConnected;
            this.wsConnected = false;
            this.ws = null;
            if (this.isConnected && wasConnected) {
                this.scheduleWebSocketReconnect();
            }
        };
    },

    handleWebSocketMessage: function(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (error) {
            return;
        }

        if (message.type === 'tick' && message.data) {
            if (typeof window.handleWebSocketTick === 'function') {
                window.handleWebSocketTick(message.data);
            }
            return;
        }

        if (message.type === 'status') {
            this.log(message.message || `WebSocket ${message.status}`);
            return;
        }

        if (message.type === 'error') {
            this.lastError = message.message || 'WebSocket error';
            this.log(`WebSocket error: ${this.lastError}`);
        }
    },

    scheduleWebSocketReconnect: function() {
        if (this.wsReconnectTimer) return;
        this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = null;
            this.initWebSocket();
        }, 5000);
    },

    closeWebSocket: function() {
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.send(JSON.stringify({ type: 'stop' }));
                this.ws.close();
            } catch (error) {
                // Ignore close errors during shutdown.
            }
        }
        this.ws = null;
        this.wsConnected = false;
    },

    updateWebSocketSubscription: function(exchangeTokens) {
        if (!this.isConnected || isDemoMode) return;
        this.initWebSocket(exchangeTokens, true);
    },

    disconnect: async function() {
        this.closeWebSocket();
        try {
            await this.proxyFetch(Config.endpoints.logout, {
                apiKey: Config.apiKey,
                jwtToken: Config.accessToken,
                publicIp: Config.publicIp,
                clientId: Config.clientId
            });
        } catch (error) {
            this.log(`Logout error: ${error.message}`);
        }

        this.isConnected = false;
        this.log('Disconnected from Angel One SmartAPI');
    },

    log: function(message) {
        const logContainer = document.getElementById('logContainer');
        if (logContainer) {
            const time = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            logEntry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
            logContainer.insertBefore(logEntry, logContainer.firstChild);
        }
        console.log(`[AngelOneAPI] ${message}`);
    }
};
