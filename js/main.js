// Main application logic.
let updateInterval = null;
let marketDataInterval = null;
let optionDataInterval = null;
let marketWideScanInterval = null;
let isDemoMode = false;

// FIX: OHLC and price history tracking for index cards
const indexOHLC = {};
const indexPriceHistory = {}; // Last 30 prices for mini chart
const INDEX_HISTORY_MAX = 30;
let liveDataFailureCount = 0;
let isFetchingMarketData = false;
let nextMarketDataFetchAt = 0;
let isRefreshingOptions = false;
let pendingOptionRefresh = false;
let optionChainLoadedAt = 0;
let lastOptionRefreshAttemptAt = 0;
let lastMarketCloseResetKey = '';

const latestIndicatorsBySymbol = {};
const latestIndicatorTimesBySymbol = {};
const latestPricesBySymbol = {};
const latestMarketQuoteTimesBySymbol = {};
const latestChangeBySymbol = {};
const latestReferenceCloseBySymbol = {};
const latestDayOpenBySymbol = {}; // FIX: Track day's open for correct change calc
const latestOptionTicksByToken = {};
let lastWebSocketSubscriptionKey = '';
const optionTradeHistoryStorageKey = 'optionTradeHistory';
const maxOptionTradeHistory = 250;
const activeOptionSignalsStorageKey = 'activeOptionSignals';
const maxActiveOptionSignals = 300;
const autoScanState = {
    enabled: Config.autoScanner.enabled,
    running: false,
    stockCursor: 0,
    commodityCursor: 0,
    resolvedStocks: [],
    resolvedCommodities: [],
    signalKeys: new Set(),
    skipReasons: []
};

const indexUiMap = {
    NIFTY: 'nifty',
    BANKNIFTY: 'banknifty',
    SENSEX: 'sensex',
    FINNIFTY: 'finnifty',
    MIDCPNIFTY: 'midcpnifty'
};

const responseSymbolMap = {
    'NIFTY 50': 'NIFTY',
    'NIFTY50': 'NIFTY',
    'NIFTY': 'NIFTY',
    'NIFTY BANK': 'BANKNIFTY',
    'NIFTYBANK': 'BANKNIFTY',
    'NIFTY BANK INDEX': 'BANKNIFTY',
    'BANKNIFTY': 'BANKNIFTY',
    'SENSEX': 'SENSEX',
    'BSE SENSEX': 'SENSEX',
    'NIFTY FIN SERVICE': 'FINNIFTY',
    'NIFTYFINSERVICE': 'FINNIFTY',
    'FINNIFTY': 'FINNIFTY',
    'NIFTY MID SELECT': 'MIDCPNIFTY',
    'NIFTYMIDSELECT': 'MIDCPNIFTY',
    'NIFTY MIDCAP': 'MIDCPNIFTY',
    MIDCPNIFTY: 'MIDCPNIFTY'
};

const legacyIndexTokenMap = {
    26000: 'NIFTY',
    26009: 'BANKNIFTY',
    26037: 'FINNIFTY',
    26074: 'MIDCPNIFTY'
};

document.addEventListener('DOMContentLoaded', function() {
    loadSavedCredentials();
    loadOptionTableSize();
    setOptionChainTableOpen(false);
    handleOptionSegmentChange();
    TelegramNotifier.loadForm();
    loadAutoScannerForm();
    renderOptionTradeHistory();
    loadActiveOptionSignals();
    resetClosedMarketsTradeState();
    runDailyReset();
    checkExistingConnection();
});

function loadSavedCredentials() {
    const saved = localStorage.getItem('stockMarketConfig');
    if (!saved) return;

    try {
        const config = JSON.parse(saved);
        const badClientId = /^(admin|root|test|demo|user)$/i.test(String(config.clientId || '').trim());
        document.getElementById('apiKey').value = config.apiKey || '';
        document.getElementById('apiSecret').value = config.apiSecret || '';
        document.getElementById('clientId').value = badClientId ? '' : (config.clientId || '');
        document.getElementById('totpSecret').value = '';
        const publicIp = document.getElementById('publicIp');
        if (publicIp) publicIp.value = config.publicIp || '';
        if (badClientId) {
            Config.clientId = '';
            Config.saveConfig();
        }
    } catch (error) {
        console.warn('Could not load saved credentials', error);
    }
}

function checkExistingConnection() {
    if (Config.accessToken) {
        Config.accessToken = '';
        Config.refreshToken = '';
        Config.feedToken = '';
        Config.saveConfig();
        const loginError = document.getElementById('loginError');
        if (loginError) {
            loginError.textContent = 'Saved session expired. Enter current TOTP and click Connect again.';
        }
    }
    setStatus('Disconnected', false);
}

function clearSavedData() {
    localStorage.removeItem('stockMarketConfig');
    document.getElementById('apiKey').value = '';
    document.getElementById('apiSecret').value = '';
    document.getElementById('clientId').value = '';
    document.getElementById('totpSecret').value = '';
    const publicIp = document.getElementById('publicIp');
    if (publicIp) publicIp.value = '';
    Config.apiKey = '';
    Config.apiSecret = '';
    Config.clientId = '';
    Config.totpSecret = '';
    Config.publicIp = '';
    Config.accessToken = '';
    Config.refreshToken = '';
    Config.feedToken = '';
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = 'Sab data clear ho gaya. Ab sahi credentials dalo.';
}

async function detectServerPublicIp() {
    try {
        const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        return data.ip || '';
    } catch (e) {
        try {
            const res2 = await fetch('https://whatismyip.amazonaws.com', { signal: AbortSignal.timeout(5000) });
            return (await res2.text()).trim();
        } catch (e2) {
            return '';
        }
    }
}

async function autoDetectMyIp() {
    const field = document.getElementById('publicIp');
    if (field) field.value = 'Detecting...';
    try {
        const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.ip) {
            if (field) field.value = data.ip;
            const loginError = document.getElementById('loginError');
            if (loginError) loginError.textContent = `Tumhara IP: ${data.ip}\nYe IP Angel One SmartAPI dashboard → Profile → Primary IP me bhi save karo.`;
        } else {
            if (field) field.value = '';
            alert('IP detect nahi ho paya. Manually whatismyipaddress.com se lo.');
        }
    } catch (e) {
        if (field) field.value = '';
        alert('IP detect nahi ho paya. Manually whatismyipaddress.com se lo.');
    }
}

async function connectAPI() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiSecret = document.getElementById('apiSecret').value.trim();
    const clientId = document.getElementById('clientId').value.trim();
    const totpSecret = document.getElementById('totpSecret').value.trim();
    const publicIp = document.getElementById('publicIp')?.value.trim() || '';
    const loginError = document.getElementById('loginError');
    if (loginError) {
        loginError.textContent = '';
        loginError.style.background = '';
        loginError.style.border = '';
        loginError.style.padding = '';
    }

    if (!apiKey || !apiSecret || !clientId) {
        const missing = [];
        if (!apiKey) missing.push('API Key');
        if (!apiSecret) missing.push('Password');
        if (!clientId) missing.push('Client ID');
        const msg = `Ye fields khali hain: ${missing.join(', ')}\n\nYe sab tumhe Angel One SmartAPI dashboard se milta hai:\n1. smartapi.angelone.in pe login karo\n2. Developer → My Apps me jao\n3. API Key wahan milega\n4. Client ID tumhara Angel One login ID hai (jaise g53589)\n5. Password tumhara Angel One login password hai`;
        if (loginError) loginError.textContent = msg;
        alert(msg);
        return;
    }

    if (clientId.toLowerCase() === 'admin' || clientId.toLowerCase() === 'root') {
        const msg = '"admin" tumhara Angel One Client ID nahi hai!\n\nClient ID = tumhara Angel One account ka login ID.\nJab tum smartapi.angelone.in pe login karte ho to jo ID dikhti hai wo Client ID hai.\nFormat aisa hota hai: g53589';
        if (loginError) loginError.textContent = msg;
        alert(msg);
        return;
    }

    if (!/^\d{6}$/.test(totpSecret)) {
        const msg = 'TOTP galat hai!\n\nTOTP = Google Authenticator app ka 6-digit code jo har 30 second badalta hai.\nYe QR secret key nahi hai — actual 6 digits jo screen pe dikhte hain wo dalo.';
        if (loginError) loginError.textContent = msg;
        alert(msg);
        return;
    }

    const isRemote = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    if (isRemote && !publicIp) {
        detectServerPublicIp().then(ip => {
            if (ip) {
                const field = document.getElementById('publicIp');
                if (field && !field.value.trim()) {
                    field.placeholder = `Detected: ${ip} (verify at whatismyipaddress.com)`;
                }
            }
        });
    }

    isDemoMode = false;
    Config.apiKey = apiKey;
    Config.apiSecret = apiSecret;
    Config.clientId = clientId;
    Config.totpSecret = totpSecret;
    Config.publicIp = publicIp;
    Config.saveConfig();

    setStatus('Connecting...', false);

    const loginDebug = [];
    loginDebug.push(`API Key: ${apiKey ? apiKey.substring(0,4) + '...' : 'MISSING'}`);
    loginDebug.push(`Client ID: ${clientId || 'MISSING'}`);
    loginDebug.push(`Password: ${apiSecret ? apiSecret.length + ' chars' : 'MISSING'}`);
    loginDebug.push(`TOTP: ${/^\d{6}$/.test(totpSecret) ? 'OK (6 digits)' : 'MISSING/INVALID'}`);
    loginDebug.push(`Static IP: ${publicIp || 'MISSING'}`);
    loginDebug.push(`Mode: ${isRemote ? 'Render/Cloud' : 'Local'}`);
    AngelOneAPI.log(`Login attempt: ${loginDebug.join(', ')}`);

    const connected = await AngelOneAPI.init();

    if (connected) {
        liveDataFailureCount = 0;
        setStatus('Connected', true);
        showDashboard();
        startMarketDataUpdates();
    } else {
        setStatus('Connection failed', false);
        if (loginError) {
            const err = AngelOneAPI.lastError || 'Unknown error';
            let msg = `Angel One Error: ${err}\n\n`;
            if (isRemote && !publicIp) {
                msg += 'Static IP khali hai! "Detect IP" button dabao ya manually whatismyipaddress.com se lo.\nPhir Angel One dashboard me bhi register karo.';
            } else if (/ip|803|804/i.test(err)) {
                msg += 'IP mismatch!\n1. "Detect IP" button se apna IP dalo\n2. Angel One dashboard → Profile → Primary IP me bhi wo IP save karo\n3. Phir Connect dabao';
            } else if (/totp|otp|2fa|auth/i.test(err)) {
                msg += 'TOTP galat hai ya expire ho gaya.\nGoogle Authenticator kholo → abhi ka naya 6-digit code dalo.';
            } else if (/password|pwd|cred/i.test(err)) {
                msg += 'Password galat hai.\nAngel One login password check karo.';
            } else {
                msg += 'Check karo: API Key, Password, Client ID, TOTP (naya code), Static IP.';
            }
            loginError.style.background = '#3a1515';
            loginError.style.border = '1px solid #f44';
            loginError.style.padding = '12px';
            loginError.style.borderRadius = '8px';
            loginError.textContent = msg;
        }
    }
}

function startDemoMode() {
    isDemoMode = true;
    AngelOneAPI.isConnected = false;
    setStatus('Demo scanner', true);
    showDashboard();
    stopMarketDataUpdates();
    seedDemoData();
    startOptionAutoRefresh();
    startMarketWideAutoScan();
    updateLastUpdateTime();
    AngelOneAPI.log('Demo scanner started. Signals are sample data only.');
}

function setStatus(text, connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = connected ? 'status-connected' : 'status-disconnected';
}

function showDashboard() {
    document.getElementById('configPanel').style.display = 'none';
    document.getElementById('dashboard').style.display = 'grid';
}

function startMarketDataUpdates() {
    stopMarketDataUpdates();

    if (!isDemoMode) {
        AngelOneAPI.initWebSocket();
        fetchMarketData();
        updateIndicators();
        marketDataInterval = setInterval(fetchMarketData, 5000);
        updateInterval = setInterval(
            updateIndicators,
            Number(Config.autoScanner.indicatorRefreshSeconds || 120) * 1000
        );
    }

    loadOptionsChain(true);
    startOptionAutoRefresh();
    startMarketWideAutoScan();
}

function stopMarketDataUpdates() {
    if (typeof AngelOneAPI !== 'undefined') {
        AngelOneAPI.closeWebSocket();
    }
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    if (marketDataInterval) {
        clearInterval(marketDataInterval);
        marketDataInterval = null;
    }
    if (optionDataInterval) {
        clearInterval(optionDataInterval);
        optionDataInterval = null;
    }
    stopMarketWideAutoScan();
}

window.handleWebSocketTick = function(tick) {
    const updatedCount = updateIndexPrices([tick]);
    if (!updatedCount) {
        updateLiveOptionTick(tick);
        return;
    }

    liveDataFailureCount = 0;
    nextMarketDataFetchAt = 0;
    setStatus('Connected - WebSocket live', true);
    updateLastUpdateTime();
    maybeRefreshOptionsAfterSpotUpdate();
};

async function fetchMarketData() {
    if (isDemoMode) return;
    if (!AngelOneAPI.isConnected) return;
    if (isFetchingMarketData) return;
    if (Date.now() < nextMarketDataFetchAt) return;
    resetClosedMarketsTradeState();

    isFetchingMarketData = true;
    try {
        const data = await AngelOneAPI.getLTP(getOpenOptionExchangeTokens(getIndexExchangeTokens()));
        const rows = data && data.data ? (Array.isArray(data.data) ? data.data : Object.values(data.data)) : [];

        if (!rows.length) {
            markLiveDataUnavailable(AngelOneAPI.lastError || 'No LTP data returned from Angel One.', 'ltp');
            return;
        }

        const updatedCount = updateIndexPrices(rows);
        rows.forEach(row => {
            const token = String(row.token ?? row.symbolToken ?? row.symboltoken ?? '');
            if (!getSymbolByToken(token)) updateLiveOptionTick(row);
        });
        if (!updatedCount) {
            markLiveDataUnavailable('Angel One returned data, but no index price matched the configured tokens.', 'ltp');
            return;
        }

        liveDataFailureCount = 0;
        nextMarketDataFetchAt = 0;
        setStatus('Connected', true);
        updateLastUpdateTime();
        maybeRefreshOptionsAfterSpotUpdate();
    } catch (error) {
        markLiveDataUnavailable(error.message, 'ltp');
        console.error('Error fetching market data:', error);
    } finally {
        isFetchingMarketData = false;
    }
}

function markLiveDataUnavailable(message, source = 'data') {
    liveDataFailureCount += 1;
    const cleanMessage = message || 'Live market data is not available.';
    const authFailure = isAuthFailure(cleanMessage);
    const retryDelayMs = source === 'ltp' && !authFailure ? scheduleLiveDataRetry() : 0;
    setStatus(authFailure ? 'Session expired' : 'Connected, retrying', !authFailure && AngelOneAPI.isConnected);
    document.getElementById('lastUpdate').textContent = authFailure
        ? 'Last Update: Failed'
        : retryDelayMs
            ? `Last Update: Retrying in ${Math.ceil(retryDelayMs / 1000)}s`
            : 'Last Update: Retrying';

    if (authFailure) {
        AngelOneAPI.isConnected = false;
        Config.accessToken = '';
        Config.refreshToken = '';
        Config.feedToken = '';
        Config.saveConfig();
        nextMarketDataFetchAt = Date.now() + 60000;
    }

    if (liveDataFailureCount <= 2 || liveDataFailureCount % 6 === 0) {
        const action = authFailure
            ? 'Reconnect with current TOTP.'
            : retryDelayMs
                ? `Retrying in ${Math.ceil(retryDelayMs / 1000)}s; keeping the last option-chain table.`
                : 'App will retry automatically; reduce scan scope if this repeats.';
        renderOptionMessage(`${source.toUpperCase()} retry: ${cleanMessage}. ${action}`, {
            replaceTable: source !== 'ltp' || !optionChainLoadedAt
        });
    }

    // Clear stale indicators if data failure is persistent
    if (liveDataFailureCount > 2) {
        Object.keys(latestIndicatorsBySymbol).forEach(symbol => {
            delete latestIndicatorsBySymbol[symbol];
            delete latestIndicatorTimesBySymbol[symbol];
        });
        refreshDisplayedIndicators();
        renderOptionMessage(`Stale indicator data cleared due to persistent ${source.toUpperCase()} failure.`, {
            replaceTable: source !== 'ltp' || !optionChainLoadedAt
        });
    }
}

function scheduleLiveDataRetry() {
    const retryDelayMs = getLiveDataRetryDelayMs();
    nextMarketDataFetchAt = Date.now() + retryDelayMs;
    return retryDelayMs;
}

function getLiveDataRetryDelayMs() {
    if (liveDataFailureCount <= 1) return 6000;
    if (liveDataFailureCount === 2) return 12000;
    if (liveDataFailureCount <= 4) return 20000;
    return 30000;
}

function maybeRefreshOptionsAfterSpotUpdate() {
    const scanner = getCurrentScanner();
    if (!latestPricesBySymbol[scanner.symbol]) return;
    if (isRefreshingOptions) return;

    const autoEnabled = document.getElementById('autoRefreshToggle')?.checked !== false;
    const refreshMs = Math.max(10000, Number(Config.optionScanner.autoRefreshSeconds || 15) * 1000);
    const lastRefreshActivity = Math.max(optionChainLoadedAt, lastOptionRefreshAttemptAt);

    if (autoEnabled && (!lastRefreshActivity || Date.now() - lastRefreshActivity >= refreshMs)) {
        refreshOptionsForSelectedExpiry();
    }
}

function maybeRefreshOptionsAfterOptionTick() {
    if (isRefreshingOptions) return;
    if (!getOptionTradeHistory().some(trade => trade.status === 'Open')) return;

    const autoEnabled = document.getElementById('autoRefreshToggle')?.checked !== false;
    const refreshMs = Math.max(10000, Number(Config.optionScanner.autoRefreshSeconds || 15) * 1000);
    const lastRefreshActivity = Math.max(optionChainLoadedAt, lastOptionRefreshAttemptAt);

    if (autoEnabled && (!lastRefreshActivity || Date.now() - lastRefreshActivity >= refreshMs)) {
        refreshOptionsForSelectedExpiry();
    }
}

function isAuthFailure(message) {
    return /invalid token|jwt|session expired|unauthorized|401|ag8001|ag8002/i.test(String(message || ''));
}

function updateIndexPrices(data) {
    let updatedCount = 0;

    data.forEach(item => {
        const token = String(item.token ?? item.symboltoken ?? item.symbolToken ?? '');
        const responseSymbol = item.symbol ?? item.tradingsymbol ?? item.tradingSymbol ?? item.name;
        const symbol = getSymbolByResponse(responseSymbol) || getSymbolByToken(token);
        if (!symbol) return;

        const ltp = Number(item.ltp ?? item.lastPrice ?? item.close ?? 0);
        if (!Number.isFinite(ltp) || ltp <= 0) return;

        // FIX: Store previous close from API data for correct change calculation
        const prevClose = Number(item.previousClose ?? item.prevClose ?? item.lastClose ?? item.closePrice ?? 0);
        if (Number.isFinite(prevClose) && prevClose > 0) {
            latestReferenceCloseBySymbol[symbol] = prevClose;
        }

        // FIX: Track day open (first price of the day)
        if (!latestDayOpenBySymbol[symbol]) {
            latestDayOpenBySymbol[symbol] = ltp;
        }

        const changeInfo = extractChangeInfo(item, ltp, symbol);
        latestPricesBySymbol[symbol] = ltp;
        latestMarketQuoteTimesBySymbol[symbol] = Date.now();
        updateIndexCard(symbol, ltp, changeInfo);
        updatedCount += 1;
    });

    return updatedCount;
}

function getSymbolByResponse(value) {
    const raw = String(value || '').trim();
    const normalized = raw.toUpperCase().replace(/\s+/g, ' ');
    const compact = normalized.replace(/\s+/g, '');
    return responseSymbolMap[raw] || responseSymbolMap[normalized] || responseSymbolMap[compact] || null;
}

function getSymbolByToken(token) {
    const tokenText = String(token || '');
    return Object.entries(Config.indices).find(([, value]) => String(value) === tokenText)?.[0]
        || legacyIndexTokenMap[tokenText]
        || null;
}

function getIndexExchange(symbol) {
    return Config.indexExchanges?.[symbol] || 'NSE';
}

function getIndexExchangeTokens(symbols = Object.keys(Config.indices)) {
    return symbols.reduce((grouped, symbol) => {
        const token = Config.indices[symbol];
        if (!token) return grouped;

        const exchange = getIndexExchange(symbol);
        if (!grouped[exchange]) grouped[exchange] = [];
        grouped[exchange].push(String(token));
        return grouped;
    }, {});
}

function addExchangeToken(grouped, exchange, token) {
    const cleanExchange = String(exchange || '').trim();
    const cleanToken = String(token || '').trim();
    if (!cleanExchange || !cleanToken) return grouped;
    if (!grouped[cleanExchange]) grouped[cleanExchange] = [];
    if (!grouped[cleanExchange].includes(cleanToken)) grouped[cleanExchange].push(cleanToken);
    return grouped;
}

function getOpenOptionExchangeTokens(baseTokens = {}) {
    const grouped = Object.entries(baseTokens || {}).reduce((result, [exchange, tokens]) => {
        const tokenList = Array.isArray(tokens) ? tokens : [tokens];
        result[exchange] = [...new Set(tokenList.map(String).filter(Boolean))];
        return result;
    }, {});

    getActiveOptionSignals().forEach(signal => {
        addExchangeToken(grouped, signal.option?.exchange || signal.exchange, signal.option?.token);
    });

    getOptionTradeHistory().forEach(trade => {
        if (trade.status !== 'Open') return;
        addExchangeToken(grouped, getTradeOptionExchange(trade), trade.optionToken);
    });

    return grouped;
}

function getTradeOptionExchange(trade = {}) {
    const exchange = String(trade.exchange || '').trim();
    if (exchange) return exchange;

    const symbol = String(trade.symbol || '').toUpperCase();
    const source = `${trade.segment || ''} ${trade.source || ''}`.toUpperCase();
    if (source.includes('COMMODITY')) return 'MCX';
    if (symbol === 'SENSEX') return 'BFO';
    return 'NFO';
}

function getFiniteNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function extractChangeInfo(item = {}, price = 0, symbol = '') {
    const ltp = Number(price || 0);
    const rawChange = getFiniteNumber(item.change, item.netChange, item.priceChange, item.changeValue);
    const rawPercent = getFiniteNumber(item.percentChange, item.pChange, item.changePercent, item.percent);
    const quotePreviousClose = getFiniteNumber(
        item.previousClose,
        item.prevClose,
        item.lastClose,
        item.closePrice
    );
    const fallbackPreviousClose = getFiniteNumber(latestReferenceCloseBySymbol[symbol]);
    const dayOpen = getFiniteNumber(latestDayOpenBySymbol[symbol]);

    let points = Number.isFinite(rawChange) ? rawChange : null;
    let percent = Number.isFinite(rawPercent) ? rawPercent : null;

    // Priority 1: Use API-provided change if available
    if (Number.isFinite(points) && points !== 0) {
        const result = {
            points,
            percent: Number.isFinite(percent) ? percent : (ltp - points) > 0 ? (points / (ltp - points)) * 100 : 0
        };
        latestChangeBySymbol[symbol] = result;
        return result;
    }

    // Priority 2: Calculate from API previous close
    if (Number.isFinite(quotePreviousClose) && quotePreviousClose > 0 && ltp > 0) {
        points = ltp - quotePreviousClose;
        percent = (points / quotePreviousClose) * 100;
        const result = { points, percent };
        latestChangeBySymbol[symbol] = result;
        return result;
    }

    // Priority 3: Calculate from stored previous close
    if (Number.isFinite(fallbackPreviousClose) && fallbackPreviousClose > 0 && ltp > 0) {
        points = ltp - fallbackPreviousClose;
        percent = (points / fallbackPreviousClose) * 100;
        const result = { points, percent };
        latestChangeBySymbol[symbol] = result;
        return result;
    }

    // Priority 4: Calculate from day open
    if (Number.isFinite(dayOpen) && dayOpen > 0 && ltp > 0) {
        points = ltp - dayOpen;
        percent = (points / dayOpen) * 100;
        const result = { points, percent };
        latestChangeBySymbol[symbol] = result;
        return result;
    }

    // Priority 5: Calculate from percent if available
    if (Number.isFinite(percent) && percent !== 0 && ltp > 0) {
        points = (ltp * percent) / (100 + percent);
        const result = { points, percent };
        latestChangeBySymbol[symbol] = result;
        return result;
    }

    // Last resort: return zero
    const result = { points: 0, percent: 0 };
    latestChangeBySymbol[symbol] = result;
    return result;
}

function makeChangeInfoFromPoints(price, points) {
    const ltp = Number(price || 0);
    const change = Number(points || 0);
    const base = ltp - change;
    return {
        points: change,
        percent: base > 0 ? (change / base) * 100 : 0
    };
}

function makeChangeInfoFromPreviousClose(price, previousClose) {
    const ltp = Number(price || 0);
    const reference = Number(previousClose || 0);
    if (!ltp || !reference) return { points: 0, percent: 0 };

    const points = ltp - reference;
    return {
        points,
        percent: (points / reference) * 100
    };
}

function updateIndexCard(symbol, price, changeInfo = null) {
    const indexKey = indexUiMap[symbol];
    if (!indexKey) return;

    const priceEl = document.getElementById(`${indexKey}Price`);
    const changeEl = document.getElementById(`${indexKey}Change`);
    const ltp = Number(price || 0);
    const change = typeof changeInfo === 'object'
        ? Number(changeInfo.points || 0)
        : Number(changeInfo || 0);
    const percent = typeof changeInfo === 'object'
        ? Number(changeInfo.percent || 0)
        : 0;

    // FIX: Track OHLC
    if (ltp > 0) {
        if (!indexOHLC[symbol]) {
            indexOHLC[symbol] = { open: ltp, high: ltp, low: ltp, close: ltp };
        } else {
            indexOHLC[symbol].close = ltp;
            if (ltp > indexOHLC[symbol].high) indexOHLC[symbol].high = ltp;
            if (ltp < indexOHLC[symbol].low) indexOHLC[symbol].low = ltp;
        }
        // Track price history for mini chart
        if (!indexPriceHistory[symbol]) indexPriceHistory[symbol] = [];
        indexPriceHistory[symbol].push(ltp);
        if (indexPriceHistory[symbol].length > INDEX_HISTORY_MAX) indexPriceHistory[symbol].shift();
    }

    const ohlc = indexOHLC[symbol] || {};

    if (priceEl) priceEl.textContent = ltp.toFixed(2);
    if (changeEl) {
        const isUp = change > 0;
        const isDown = change < 0;
        const cls = isUp ? 'up' : isDown ? 'down' : 'flat';
        const sign = isUp ? '+' : '';
        changeEl.innerHTML = `${sign}${change.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
        changeEl.className = `change ${cls}`;
    }

    // Update OHLC display
    const ohlcEl = document.getElementById(`${indexKey}Ohlc`);
    if (ohlcEl && ohlc.open) {
        const oc = ohlc.close >= ohlc.open ? 'up' : 'down';
        ohlcEl.innerHTML = `
            <span><span class="lbl">O</span> <span class="${oc}">${ohlc.open.toFixed(1)}</span></span>
            <span><span class="lbl">H</span> <span class="up">${ohlc.high.toFixed(1)}</span></span>
            <span><span class="lbl">L</span> <span class="down">${ohlc.low.toFixed(1)}</span></span>
            <span><span class="lbl">C</span> <span class="${oc}">${ohlc.close.toFixed(1)}</span></span>
        `;
    }

    // FIX: Draw mini chart
    drawMiniChart(indexKey, symbol);
}

function drawMiniChart(indexKey, symbol) {
    const canvas = document.getElementById(`${indexKey}Chart`);
    if (!canvas) return;
    const history = indexPriceHistory[symbol];
    if (!history || history.length < 2) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;
    const padding = 2;

    const isUp = history[history.length - 1] >= history[0];
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillColor = isUp ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';

    // Draw fill
    ctx.beginPath();
    ctx.moveTo(padding, h - padding);
    history.forEach((price, i) => {
        const x = padding + (i / (history.length - 1)) * (w - padding * 2);
        const y = h - padding - ((price - min) / range) * (h - padding * 2);
        ctx.lineTo(x, y);
    });
    ctx.lineTo(w - padding, h - padding);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    history.forEach((price, i) => {
        const x = padding + (i / (history.length - 1)) * (w - padding * 2);
        const y = h - padding - ((price - min) / range) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = `Last Update: ${now.toLocaleTimeString()}`;
}

function hasRecentMarketQuote(symbol, maxAgeMs = 15000) {
    const loadedAt = latestMarketQuoteTimesBySymbol[symbol] || 0;
    return loadedAt > 0 && Date.now() - loadedAt <= maxAgeMs;
}

async function updateIndicators() {
    if (isDemoMode) {
        seedDemoIndicators();
        refreshDisplayedIndicators();
        refreshOptionsForSelectedExpiry();
        return;
    }

    const timeframe = document.getElementById('timeframeSelector')?.value || 'FIVE_MINUTE';
    const symbols = Object.keys(Config.indices);
    let successCount = 0;

    for (const symbol of symbols) {
        if (await updateIndicatorsForSymbol(symbol, Config.indices[symbol], timeframe, getIndexExchange(symbol))) {
            successCount += 1;
        }
    }

    const scanner = getCurrentScanner();
    if (scanner.segment === 'STOCK' && scanner.token) {
        if (await updateIndicatorsForSymbol(scanner.symbol, scanner.token, timeframe)) {
            successCount += 1;
        }
    }
    if (scanner.segment === 'COMMODITY') {
        const resolved = await resolveScannerTarget(scanner);
        if (resolved.token && await updateIndicatorsForSymbol(resolved.symbol, resolved.token, timeframe, resolved.exchange || 'MCX', false)) {
            successCount += 1;
        }
    }

    if (!successCount) {
        AngelOneAPI.log(`Indicator retry: ${AngelOneAPI.lastError || 'No historical candle data returned from Angel One.'}`);
    }

    refreshDisplayedIndicators();
    refreshOptionsForSelectedExpiry();
}

async function updateIndicatorsForSymbol(symbol, token, timeframe, exchange = 'NSE', displayUnderlyingSignal = true) {
    const rangeDays = timeframe === 'ONE_DAY' ? 120 : 10;
    const toDate = new Date();
    const fromDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const historicalData = await AngelOneAPI.getHistoricalData(
        token,
        timeframe,
        formatApiDateTime(fromDate, '09:15'),
        formatApiDateTime(toDate),
        exchange
    );

    if (!historicalData || !historicalData.data || !historicalData.data.length) {
        const spot = latestPricesBySymbol[symbol] || 0;
        if (spot > 0) {
            const drift = getFallbackDriftForSymbol(symbol);
            const candles = buildDemoCandles(spot * 0.96, drift);
            const lastCandle = candles.at(-1);
            const adjustment = spot - Number(lastCandle?.[4] || spot);
            candles.forEach(candle => {
                candle[1] = Math.max(0.05, Number(candle[1]) + adjustment);
                candle[2] = Math.max(candle[1], Number(candle[2]) + adjustment);
                candle[3] = Math.max(0.05, Number(candle[3]) + adjustment);
                candle[4] = Math.max(0.05, Number(candle[4]) + adjustment);
            });
            latestIndicatorsBySymbol[symbol] = calculateIndicatorsFromCandles(candles);
            latestIndicatorTimesBySymbol[symbol] = Date.now();
            return true;
        }
        return false;
    }
    const indicators = calculateIndicatorsFromCandles(historicalData.data);
    latestIndicatorsBySymbol[symbol] = indicators;
    latestIndicatorTimesBySymbol[symbol] = Date.now();

    const closes = historicalData.data.map(candle => Number(candle[4])).filter(Number.isFinite);
    const historicalClose = closes.at(-1);
    if (closes.length) {
        if (!indexUiMap[symbol] || !hasRecentMarketQuote(symbol)) {
            latestPricesBySymbol[symbol] = historicalClose;
        }
        const previousTradingClose = getPreviousTradingCloseFromCandles(historicalData.data);
        if (Number.isFinite(previousTradingClose) && previousTradingClose > 0) {
            latestReferenceCloseBySymbol[symbol] = previousTradingClose;
        }
    }

    if (displayUnderlyingSignal) {
        const displayPrice = latestPricesBySymbol[symbol] || historicalClose || 0;
        const signal = SignalGenerator.generateSignal(symbol, displayPrice, indicators);
        updateIndexSignal(symbol, signal.signal);
        const previousClose = latestReferenceCloseBySymbol[symbol];
        if (
            indexUiMap[symbol]
            && closes.length
            && Number.isFinite(previousClose)
            && previousClose > 0
            && !hasRecentMarketQuote(symbol)
        ) {
            updateIndexCard(symbol, historicalClose, makeChangeInfoFromPreviousClose(historicalClose, previousClose));
        }
    }
    return true;
}

function getPreviousTradingCloseFromCandles(candles) {
    if (!Array.isArray(candles) || candles.length < 2) return null;

    const validCandles = candles
        .map(candle => ({
            dateKey: getCandleDateKey(candle),
            close: Number(candle?.[4])
        }))
        .filter(item => item.dateKey && Number.isFinite(item.close));

    if (validCandles.length < 2) return null;

    const latestDate = validCandles.at(-1).dateKey;
    const previousSessionCandles = validCandles.filter(item => item.dateKey < latestDate);
    return previousSessionCandles.length
        ? previousSessionCandles.at(-1).close
        : validCandles.at(-2).close;
}

function getCandleDateKey(candle) {
    const value = String(candle?.[0] || '').trim();
    if (!value) return '';

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const indianMatch = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (indianMatch) {
        const year = indianMatch[3].length === 2 ? `20${indianMatch[3]}` : indianMatch[3];
        return `${year}-${indianMatch[2].padStart(2, '0')}-${indianMatch[1].padStart(2, '0')}`;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return formatApiDate(parsed);

    return '';
}

function formatApiDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatApiDateTime(date, fixedTime = null) {
    const datePart = formatApiDate(date);
    if (fixedTime) return `${datePart} ${fixedTime}`;

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${datePart} ${hh}:${mm}`;
}

function calculateIndicatorsFromCandles(candles) {
    const opens = candles.map(candle => Number(candle[1])).filter(Number.isFinite);
    const closes = candles.map(candle => Number(candle[4])).filter(Number.isFinite);
    const highs = candles.map(candle => Number(candle[2])).filter(Number.isFinite);
    const lows = candles.map(candle => Number(candle[3])).filter(Number.isFinite);
    const volumes = candles.map(candle => Number(candle[5])).filter(Number.isFinite);
    const rsi = TechnicalIndicators.calculateRSI(closes, Config.indicators.rsi.period);
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(
        closes,
        Config.indicators.bollingerBands.period,
        Config.indicators.bollingerBands.stdDev
    );
    const vwap = TechnicalIndicators.calculateVWAP(highs, lows, closes, volumes);

    return {
        RSI: rsi,
        AdvancedRSI: TechnicalIndicators.calculateAdvancedRSIContext(
            closes,
            highs,
            lows,
            volumes,
            Config.indicators.rsi
        ),
        MACD: TechnicalIndicators.calculateMACD(
            closes,
            Config.indicators.macd.fastPeriod,
            Config.indicators.macd.slowPeriod,
            Config.indicators.macd.signalPeriod
        ),
        BollingerBands: bollingerBands,
        EMA: {
            short: TechnicalIndicators.calculateEMA(closes, Config.indicators.ema.short),
            long: TechnicalIndicators.calculateEMA(closes, Config.indicators.ema.long)
        },
        ADX: TechnicalIndicators.calculateADX(highs, lows, closes, Config.indicators.adx.period),
        Stochastic: TechnicalIndicators.calculateStochastic(
            highs,
            lows,
            closes,
            Config.indicators.stochastic.kPeriod,
            Config.indicators.stochastic.dPeriod
        ),
        Volume: TechnicalIndicators.calculateVolumeProfile(
            volumes,
            closes,
            Config.indicators.volume.period
        ),
        OBV: TechnicalIndicators.calculateOBV(
            closes,
            volumes,
            Config.indicators.rsi.obvFast,
            Config.indicators.rsi.obvSlow
        ),
        Engulfing: TechnicalIndicators.calculateEngulfingPattern(opens, highs, lows, closes),
        CandlestickPatterns: TechnicalIndicators.calculateCandlestickPatterns(opens, highs, lows, closes),
        FibonacciContext: TechnicalIndicators.calculateFibonacciContext(highs, lows, closes),
        ChartPatterns: TechnicalIndicators.calculateChartPatterns(highs, lows, closes),
        MotherVolume: TechnicalIndicators.calculateMotherVolume(
            opens,
            highs,
            lows,
            closes,
            volumes,
            Config.indicators.volume.motherLookback,
            Config.indicators.volume.motherAveragePeriod,
            Config.indicators.volume.motherMultiplier
        ),
        VWAP: vwap,
        ICTContext: calculateIctContext(opens, highs, lows, closes, volumes),
        ICTAdvancedContext: calculateAdvancedIctContext(candles),
        ORBGapBBContext: calculateOrbGapBbContext(candles, { bollingerBands, vwap }),
        PivotPoints: TechnicalIndicators.calculatePivotPoints(highs, lows, closes),
        SupportResistance: TechnicalIndicators.calculateSupportResistance(
            highs,
            lows,
            closes,
            opens,
            Config.indicators.supportResistance.period,
            Config.indicators.supportResistance.swingLookback
        ),
        ATR: TechnicalIndicators.calculateATR(highs, lows, closes, 14)
    };
}

function calculateOrbGapBbContext(candles, shared = {}) {
    const rows = (candles || [])
        .map((candle, index) => ({
            index,
            time: String(candle?.[0] || ''),
            dateKey: getCandleDateKey(candle),
            open: Number(candle?.[1]),
            high: Number(candle?.[2]),
            low: Number(candle?.[3]),
            close: Number(candle?.[4]),
            volume: Number(candle?.[5] || 0)
        }))
        .filter(item => [item.open, item.high, item.low, item.close].every(Number.isFinite));

    if (rows.length < 22) {
        return createEmptyOrbGapBbContext('ORB/Gap/BB data incomplete');
    }

    const latestDate = rows.at(-1).dateKey;
    const todayRows = rows.filter(item => item.dateKey === latestDate);
    const previousRows = rows.filter(item => item.dateKey && item.dateKey < latestDate);
    const previousClose = previousRows.at(-1)?.close || rows.at(-2)?.close || 0;
    const first = todayRows[0] || rows[0];
    const latest = rows.at(-1);
    const previous = rows.at(-2);
    const openingRange = getOpeningRange(todayRows.length ? todayRows : rows);
    const vwap = shared.vwap?.vwap || null;
    const vwapSide = shared.vwap?.position || (
        vwap ? latest.close > vwap ? 'ABOVE' : latest.close < vwap ? 'BELOW' : 'AT' : 'UNKNOWN'
    );
    const bbTrap = detectBbTrap(rows, shared.bollingerBands, vwap);
    const trapBoom = detectTrapBoom(rows, vwap);
    const superCandle = detectSuperCandle(rows);
    const gapPercent = previousClose ? ((first.open - previousClose) / previousClose) * 100 : 0;
    const gapDirection = Math.abs(gapPercent) < 0.15 ? 'FLAT' : gapPercent > 0 ? 'GAP_UP' : 'GAP_DOWN';
    const orbDirection = latest.close > openingRange.high
        ? 'BREAKOUT'
        : latest.close < openingRange.low
            ? 'BREAKDOWN'
            : 'INSIDE';
    const direction = getOrbGapBbDirection({
        orbDirection,
        gapDirection,
        bbTrap,
        trapBoom,
        latest,
        previous,
        vwapSide
    });
    const reasons = [];

    if (gapDirection !== 'FLAT') reasons.push(`${gapDirection.replace('_', ' ')} ${Math.abs(gapPercent).toFixed(2)}%`);
    if (orbDirection !== 'INSIDE') reasons.push(`ORB ${orbDirection.toLowerCase()}`);
    if (bbTrap.type !== 'NONE') reasons.push(`${bbTrap.type.replace('_', ' ')} confirmed`);
    if (trapBoom.type !== 'NONE') reasons.push(`${trapBoom.type.replace('_', ' ')} on VWAP`);
    if (superCandle.type !== 'NONE') reasons.push(`${superCandle.type.replace('_', ' ')} candle`);
    if (vwapSide !== 'UNKNOWN') reasons.push(`VWAP ${vwapSide.toLowerCase()}`);

    return {
        direction,
        strength: getOrbGapBbStrength({ orbDirection, gapDirection, bbTrap, trapBoom, superCandle, vwapSide }),
        gapDirection,
        gapPercent,
        orbDirection,
        openingRangeHigh: openingRange.high,
        openingRangeLow: openingRange.low,
        vwap,
        vwapSide,
        bbTrap,
        trapBoom,
        superCandle,
        previousClose,
        reasons: reasons.slice(0, 5)
    };
}

function createEmptyOrbGapBbContext(reason) {
    return {
        direction: 'NEUTRAL',
        strength: 0,
        gapDirection: 'UNKNOWN',
        gapPercent: 0,
        orbDirection: 'UNKNOWN',
        openingRangeHigh: null,
        openingRangeLow: null,
        vwap: null,
        vwapSide: 'UNKNOWN',
        bbTrap: { type: 'NONE' },
        trapBoom: { type: 'NONE' },
        superCandle: { type: 'NONE' },
        previousClose: null,
        reasons: [reason]
    };
}

function getOpeningRange(sessionRows) {
    const rangeRows = sessionRows.slice(0, Math.min(3, sessionRows.length));
    return {
        high: Math.max(...rangeRows.map(item => item.high)),
        low: Math.min(...rangeRows.map(item => item.low))
    };
}

function detectBbTrap(rows, bands, vwap) {
    const latest = rows.at(-1);
    const previous = rows.at(-2);
    if (!latest || !previous || rows.length < 22) return { type: 'NONE' };
    if (!bands) return { type: 'NONE' };

    const outsideUpper = previous.high > bands.upper || previous.close > bands.upper;
    const outsideLower = previous.low < bands.lower || previous.close < bands.lower;
    const bearishConfirmed = outsideUpper
        && latest.close < previous.low
        && (!vwap || latest.close < vwap);
    const bullishConfirmed = outsideLower
        && latest.close > previous.high
        && (!vwap || latest.close > vwap);

    if (bearishConfirmed) {
        return {
            type: 'BEARISH_BB_TRAP',
            triggerHigh: previous.high,
            triggerLow: previous.low,
            stop: previous.high
        };
    }
    if (bullishConfirmed) {
        return {
            type: 'BULLISH_BB_TRAP',
            triggerHigh: previous.high,
            triggerLow: previous.low,
            stop: previous.low
        };
    }

    return outsideUpper
        ? { type: 'UPPER_BAND_OUTSIDE_WAIT' }
        : outsideLower
            ? { type: 'LOWER_BAND_OUTSIDE_WAIT' }
            : { type: 'NONE' };
}

function detectTrapBoom(rows, vwap) {
    if (!vwap || rows.length < 3) return { type: 'NONE' };

    const [first, second, third] = rows.slice(-3);
    const firstTwoBearish = first.close < first.open && second.close < second.open && second.close < vwap;
    const firstTwoBullish = first.close > first.open && second.close > second.open && second.close > vwap;
    const bullishBoom = firstTwoBearish && third.close > third.open && third.close > vwap && third.close > second.high;
    const bearishBoom = firstTwoBullish && third.close < third.open && third.close < vwap && third.close < second.low;

    if (bullishBoom) return { type: 'BULLISH_TRAP_BOOM', stop: second.low };
    if (bearishBoom) return { type: 'BEARISH_TRAP_BOOM', stop: second.high };
    return { type: 'NONE' };
}

function detectSuperCandle(rows) {
    const latest = rows.at(-1);
    if (!latest || rows.length < 10) return { type: 'NONE' };

    const recent = rows.slice(-10, -1);
    const avgBody = recent.reduce((sum, item) => sum + Math.abs(item.close - item.open), 0) / recent.length;
    const avgRange = recent.reduce((sum, item) => sum + Math.abs(item.high - item.low), 0) / recent.length;
    const body = Math.abs(latest.close - latest.open);
    const range = Math.abs(latest.high - latest.low);
    const isLarge = body > avgBody * 1.8 || range > avgRange * 1.6;
    const openLow = Math.abs(latest.open - latest.low) <= Math.max(range * 0.08, 0.05);
    const openHigh = Math.abs(latest.open - latest.high) <= Math.max(range * 0.08, 0.05);

    if (!isLarge && !openLow && !openHigh) return { type: 'NONE' };

    return {
        type: latest.close >= latest.open ? 'BULLISH_SUPER' : 'BEARISH_SUPER',
        openLow,
        openHigh,
        high: latest.high,
        low: latest.low
    };
}

function getOrbGapBbDirection(context) {
    if (context.trapBoom.type === 'BULLISH_TRAP_BOOM') return 'BULLISH';
    if (context.trapBoom.type === 'BEARISH_TRAP_BOOM') return 'BEARISH';
    if (context.bbTrap.type === 'BULLISH_BB_TRAP') return 'BULLISH';
    if (context.bbTrap.type === 'BEARISH_BB_TRAP') return 'BEARISH';
    if (context.orbDirection === 'BREAKOUT' && context.vwapSide === 'ABOVE') return 'BULLISH';
    if (context.orbDirection === 'BREAKDOWN' && context.vwapSide === 'BELOW') return 'BEARISH';
    if (context.gapDirection === 'GAP_UP' && context.latest.close > context.previous.close) return 'BULLISH';
    if (context.gapDirection === 'GAP_DOWN' && context.latest.close < context.previous.close) return 'BEARISH';
    return 'NEUTRAL';
}

function getOrbGapBbStrength(context) {
    let strength = 0;
    if (context.orbDirection !== 'INSIDE' && context.orbDirection !== 'UNKNOWN') strength += 22;
    if (context.gapDirection !== 'FLAT' && context.gapDirection !== 'UNKNOWN') strength += 12;
    if (context.vwapSide !== 'UNKNOWN' && context.vwapSide !== 'AT') strength += 12;
    if (context.bbTrap.type === 'BULLISH_BB_TRAP' || context.bbTrap.type === 'BEARISH_BB_TRAP') strength += 28;
    if (context.trapBoom.type === 'BULLISH_TRAP_BOOM' || context.trapBoom.type === 'BEARISH_TRAP_BOOM') strength += 34;
    if (context.superCandle.type !== 'NONE') strength += 12;
    return Math.min(strength, 100);
}

function calculateAdvancedIctContext(candles) {
    const baseRows = normalizeCandleRows(candles);
    if (baseRows.length < 30) {
        return createEmptyAdvancedIctContext('Advanced ICT data incomplete');
    }

    const frames = [
        buildIctFrame('LTF', baseRows, 1),
        buildIctFrame('MTF', aggregateCandleRows(baseRows, 3), 3),
        buildIctFrame('HTF', aggregateCandleRows(baseRows, 6), 6),
        buildIctFrame('Macro', aggregateCandleRows(baseRows, 12), 12)
    ].filter(frame => frame.rows.length >= 8);
    const latestClose = baseRows.at(-1).close;
    const mainFrame = frames.find(frame => frame.name === 'HTF') || frames.at(-1);
    const lowerFrame = frames[0];
    const target = getIctTarget(mainFrame, latestClose);
    const activePoi = getActivePoi(frames, latestClose);
    const workDone = target ? isIctTargetDone(target, baseRows) : false;
    const trap = detectAdvancedIctTrap(frames, latestClose, workDone);
    const htfDirection = mainFrame?.direction || 'NEUTRAL';
    const ltfDirection = lowerFrame?.direction || 'NEUTRAL';
    const alignedFrames = frames.filter(frame => frame.direction === htfDirection && htfDirection !== 'NEUTRAL').length;
    const direction = trap.direction !== 'NONE'
        ? trap.direction
        : alignedFrames >= 2
            ? htfDirection
            : 'NEUTRAL';
    const strength = Math.min(
        (alignedFrames * 18)
        + (activePoi ? 18 : 0)
        + (target && !workDone ? 18 : 0)
        + (trap.type !== 'NONE' ? 24 : 0),
        100
    );
    const reasons = [];

    if (htfDirection !== 'NEUTRAL') reasons.push(`HTF ${htfDirection}`);
    if (ltfDirection !== 'NEUTRAL' && ltfDirection !== htfDirection) reasons.push(`LTF ${ltfDirection} pullback/trap`);
    if (activePoi) reasons.push(`${activePoi.frame} ${activePoi.type} active`);
    if (target) reasons.push(`${target.frame} target ${workDone ? 'done' : 'pending'}`);
    if (trap.type !== 'NONE') reasons.push(trap.reason);

    return {
        direction,
        strength,
        htfDirection,
        ltfDirection,
        alignedFrames,
        activePoi,
        target,
        workDone,
        trap,
        frames: frames.map(frame => ({
            name: frame.name,
            direction: frame.direction,
            strength: frame.strength,
            lastSwingHigh: frame.lastSwingHigh,
            lastSwingLow: frame.lastSwingLow,
            poiCount: frame.pois.length
        })),
        reasons: reasons.slice(0, 5)
    };
}

function createEmptyAdvancedIctContext(reason) {
    return {
        direction: 'NEUTRAL',
        strength: 0,
        htfDirection: 'NEUTRAL',
        ltfDirection: 'NEUTRAL',
        alignedFrames: 0,
        activePoi: null,
        target: null,
        workDone: false,
        trap: { type: 'NONE', direction: 'NONE', reason: reason || '' },
        frames: [],
        reasons: [reason]
    };
}

function normalizeCandleRows(candles) {
    return (candles || [])
        .map((candle, index) => ({
            index,
            time: String(candle?.[0] || ''),
            open: Number(candle?.[1]),
            high: Number(candle?.[2]),
            low: Number(candle?.[3]),
            close: Number(candle?.[4]),
            volume: Number(candle?.[5] || 0)
        }))
        .filter(item => [item.open, item.high, item.low, item.close].every(Number.isFinite));
}

function aggregateCandleRows(rows, size) {
    const result = [];
    for (let i = 0; i < rows.length; i += size) {
        const chunk = rows.slice(i, i + size);
        if (!chunk.length) continue;
        result.push({
            index: chunk[0].index,
            time: chunk[0].time,
            open: chunk[0].open,
            high: Math.max(...chunk.map(item => item.high)),
            low: Math.min(...chunk.map(item => item.low)),
            close: chunk.at(-1).close,
            volume: chunk.reduce((sum, item) => sum + Number(item.volume || 0), 0)
        });
    }
    return result;
}

function buildIctFrame(name, rows, scale) {
    const highs = rows.map(item => item.high);
    const lows = rows.map(item => item.low);
    const opens = rows.map(item => item.open);
    const closes = rows.map(item => item.close);
    const swings = getFractalSwings(highs, lows, 2);
    const swingHighs = swings.filter(item => item.type === 'HIGH');
    const swingLows = swings.filter(item => item.type === 'LOW');
    const lastSwingHigh = swingHighs.at(-1)?.price || null;
    const lastSwingLow = swingLows.at(-1)?.price || null;
    const prevHigh = swingHighs.at(-2)?.price || null;
    const prevLow = swingLows.at(-2)?.price || null;
    const close = closes.at(-1);
    const bullish = lastSwingHigh && prevHigh && lastSwingLow && prevLow && lastSwingHigh > prevHigh && lastSwingLow > prevLow;
    const bearish = lastSwingHigh && prevHigh && lastSwingLow && prevLow && lastSwingHigh < prevHigh && lastSwingLow < prevLow;
    const direction = bullish || close > Number(lastSwingHigh || Infinity)
        ? 'BULLISH'
        : bearish || close < Number(lastSwingLow || -Infinity)
            ? 'BEARISH'
            : 'NEUTRAL';

    return {
        name,
        scale,
        rows,
        direction,
        strength: direction === 'NEUTRAL' ? 0 : Math.min(40 + (scale * 6), 82),
        lastSwingHigh,
        lastSwingLow,
        pois: detectIctPois(rows, name)
    };
}

function detectIctPois(rows, frameName) {
    const pois = [];
    const avgRange = averageRangeRows(rows, 12);

    for (let i = 2; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        const older = rows[i - 2];
        const range = current.high - current.low;
        const bullishFvg = current.low > older.high;
        const bearishFvg = current.high < older.low;
        const displacementUp = current.close > current.open && range > avgRange * 1.35;
        const displacementDown = current.close < current.open && range > avgRange * 1.35;

        if (bullishFvg) {
            pois.push(createPoi(frameName, 'BULLISH_FVG', 'BULLISH', older.high, current.low, i));
        }
        if (bearishFvg) {
            pois.push(createPoi(frameName, 'BEARISH_FVG', 'BEARISH', current.high, older.low, i));
        }
        if (displacementUp && previous.close < previous.open) {
            pois.push(createPoi(frameName, 'BULLISH_ORDER_BLOCK', 'BULLISH', previous.low, previous.high, i - 1));
        }
        if (displacementDown && previous.close > previous.open) {
            pois.push(createPoi(frameName, 'BEARISH_ORDER_BLOCK', 'BEARISH', previous.low, previous.high, i - 1));
        }
    }

    return pois.slice(-12);
}

function createPoi(frame, type, direction, low, high, index) {
    const bottom = Math.min(low, high);
    const top = Math.max(low, high);
    return {
        frame,
        type,
        direction,
        low: bottom,
        high: top,
        midpoint: (bottom + top) / 2,
        index
    };
}

function averageRangeRows(rows, period) {
    const recent = rows.slice(-period);
    return recent.reduce((sum, row) => sum + Math.abs(row.high - row.low), 0) / Math.max(recent.length, 1);
}

function getActivePoi(frames, price) {
    return frames
        .flatMap(frame => frame.pois.map(poi => ({ ...poi, distance: Math.abs(price - poi.midpoint) / Math.max(price, 1) })))
        .filter(poi => price >= poi.low * 0.998 && price <= poi.high * 1.002)
        .sort((a, b) => b.frame.localeCompare(a.frame) || a.distance - b.distance)[0] || null;
}

function getIctTarget(frame, price) {
    if (!frame || frame.direction === 'NEUTRAL') return null;
    if (frame.direction === 'BULLISH') {
        const candidates = [
            frame.lastSwingHigh,
            ...frame.pois.filter(poi => poi.direction === 'BEARISH').map(poi => poi.midpoint)
        ].filter(value => Number.isFinite(value) && value > price);
        const value = candidates.sort((a, b) => a - b)[0];
        return value ? { frame: frame.name, direction: 'BULLISH', value, type: 'BUY_SIDE_POI' } : null;
    }

    const candidates = [
        frame.lastSwingLow,
        ...frame.pois.filter(poi => poi.direction === 'BULLISH').map(poi => poi.midpoint)
    ].filter(value => Number.isFinite(value) && value < price);
    const value = candidates.sort((a, b) => b - a)[0];
    return value ? { frame: frame.name, direction: 'BEARISH', value, type: 'SELL_SIDE_POI' } : null;
}

function isIctTargetDone(target, rows) {
    if (!target) return false;
    const recent = rows.slice(-8);
    return target.direction === 'BULLISH'
        ? recent.some(row => row.high >= target.value)
        : recent.some(row => row.low <= target.value);
}

function detectAdvancedIctTrap(frames, price, workDone) {
    const htf = frames.find(frame => frame.name === 'HTF') || frames.at(-1);
    const ltf = frames[0];
    if (!htf || !ltf) return { type: 'NONE', direction: 'NONE', reason: '' };

    if (htf.direction !== 'NEUTRAL' && ltf.direction !== 'NEUTRAL' && htf.direction !== ltf.direction && !workDone) {
        return {
            type: 'LTF_FAKE_STRUCTURE',
            direction: htf.direction,
            reason: `LTF ${ltf.direction} against HTF ${htf.direction}; HTF target pending`
        };
    }

    if (workDone && ltf.direction !== 'NEUTRAL') {
        return {
            type: 'WORK_DONE_TRAP_ZONE',
            direction: ltf.direction === 'BULLISH' ? 'BEARISH' : 'BULLISH',
            reason: 'Higher-frame target done; new LTF structure can trap'
        };
    }

    const activeFramePoi = frames
        .flatMap(frame => frame.pois)
        .find(poi => price >= poi.low && price <= poi.high);
    if (activeFramePoi && htf.direction !== 'NEUTRAL' && activeFramePoi.direction !== htf.direction) {
        return {
            type: 'OPPOSITE_POI_TRAP',
            direction: htf.direction,
            reason: `${activeFramePoi.type} is against HTF bias`
        };
    }

    return { type: 'NONE', direction: 'NONE', reason: '' };
}

function calculateIctContext(opens, highs, lows, closes, volumes) {
    const length = Math.min(opens.length, highs.length, lows.length, closes.length);
    const close = closes.at(-1);
    if (length < 12 || !Number.isFinite(close)) {
        return { direction: 'NEUTRAL', strength: 0, reasons: ['ICT data incomplete'] };
    }

    const swings = getFractalSwings(highs, lows, 2);
    const swingHighs = swings.filter(item => item.type === 'HIGH');
    const swingLows = swings.filter(item => item.type === 'LOW');
    const lastHigh = swingHighs.at(-1);
    const prevHigh = swingHighs.at(-2);
    const lastLow = swingLows.at(-1);
    const prevLow = swingLows.at(-2);
    const recentHigh = Math.max(...highs.slice(-6));
    const recentLow = Math.min(...lows.slice(-6));
    const avgBody = averageBody(opens, closes, 12);
    const lastBody = Math.abs(close - opens.at(-1));
    const displacementUp = close > opens.at(-1) && lastBody > avgBody * 1.35;
    const displacementDown = close < opens.at(-1) && lastBody > avgBody * 1.35;
    const bullishFvg = hasBullishFvg(highs, lows);
    const bearishFvg = hasBearishFvg(highs, lows);
    const sellSideSweep = lastLow && recentLow < lastLow.price && close > lastLow.price;
    const buySideSweep = lastHigh && recentHigh > lastHigh.price && close < lastHigh.price;
    const bullishBos = lastHigh && close > lastHigh.price;
    const bearishBos = lastLow && close < lastLow.price;
    const bullishStructure = lastHigh && prevHigh && lastLow && prevLow
        && lastHigh.price > prevHigh.price
        && lastLow.price > prevLow.price;
    const bearishStructure = lastHigh && prevHigh && lastLow && prevLow
        && lastHigh.price < prevHigh.price
        && lastLow.price < prevLow.price;

    let bullish = 0;
    let bearish = 0;
    const reasons = [];

    if (bullishStructure) {
        bullish += 22;
        reasons.push('ICT bullish structure');
    }
    if (bearishStructure) {
        bearish += 22;
        reasons.push('ICT bearish structure');
    }
    if (sellSideSweep) {
        bullish += 24;
        reasons.push('Sell-side liquidity swept');
    }
    if (buySideSweep) {
        bearish += 24;
        reasons.push('Buy-side liquidity swept');
    }
    if (bullishBos) {
        bullish += 18;
        reasons.push('Bullish structure break');
    }
    if (bearishBos) {
        bearish += 18;
        reasons.push('Bearish structure break');
    }
    if (displacementUp || bullishFvg) {
        bullish += displacementUp && bullishFvg ? 22 : 12;
        reasons.push(displacementUp ? 'Bullish displacement' : 'Bullish FVG');
    }
    if (displacementDown || bearishFvg) {
        bearish += displacementDown && bearishFvg ? 22 : 12;
        reasons.push(displacementDown ? 'Bearish displacement' : 'Bearish FVG');
    }

    const direction = bullish > bearish + 8 ? 'BULLISH' : bearish > bullish + 8 ? 'BEARISH' : 'NEUTRAL';
    return {
        direction,
        strength: Math.min(Math.max(bullish, bearish), 100),
        bullish: Math.min(bullish, 100),
        bearish: Math.min(bearish, 100),
        reasons: reasons.slice(0, 5),
        lastSwingHigh: lastHigh?.price || null,
        lastSwingLow: lastLow?.price || null,
        liquidity: sellSideSweep ? 'SELL_SIDE_SWEEP' : buySideSweep ? 'BUY_SIDE_SWEEP' : 'NONE',
        displacement: displacementUp ? 'BULLISH' : displacementDown ? 'BEARISH' : 'NONE',
        fvg: bullishFvg ? 'BULLISH' : bearishFvg ? 'BEARISH' : 'NONE'
    };
}

function getFractalSwings(highs, lows, wing = 2) {
    const swings = [];
    for (let i = wing; i < highs.length - wing; i++) {
        const high = highs[i];
        const low = lows[i];
        const leftHighs = highs.slice(i - wing, i);
        const rightHighs = highs.slice(i + 1, i + wing + 1);
        const leftLows = lows.slice(i - wing, i);
        const rightLows = lows.slice(i + 1, i + wing + 1);

        if (leftHighs.every(value => high > value) && rightHighs.every(value => high >= value)) {
            swings.push({ type: 'HIGH', index: i, price: high });
        }
        if (leftLows.every(value => low < value) && rightLows.every(value => low <= value)) {
            swings.push({ type: 'LOW', index: i, price: low });
        }
    }
    return swings;
}

function averageBody(opens, closes, period) {
    const start = Math.max(0, closes.length - period);
    const bodies = closes.slice(start).map((close, index) => Math.abs(close - opens[start + index]));
    return bodies.reduce((sum, value) => sum + value, 0) / Math.max(bodies.length, 1);
}

function hasBullishFvg(highs, lows) {
    for (let i = Math.max(2, highs.length - 5); i < highs.length; i++) {
        if (lows[i] > highs[i - 2]) return true;
    }
    return false;
}

function hasBearishFvg(highs, lows) {
    for (let i = Math.max(2, highs.length - 5); i < highs.length; i++) {
        if (highs[i] < lows[i - 2]) return true;
    }
    return false;
}

function refreshDisplayedIndicators() {
    const selector = document.getElementById('indicatorSelector');
    const symbol = selector?.value || getCurrentScanner().symbol || 'NIFTY';
    updateIndicatorUI(latestIndicatorsBySymbol[symbol] || {});
}

function updateIndicatorUI(indicators) {
    updateText('rsiValue', formatIndicator(indicators.RSI));
    const advancedRsi = indicators.AdvancedRSI || {};
    const rsiDirection = advancedRsi.direction || 'NEUTRAL';
    const rsiStatus = advancedRsi.zone
        ? `${advancedRsi.zone.replace(/_/g, ' ')}${advancedRsi.signal && advancedRsi.signal !== 'HOLD' ? ` / ${advancedRsi.signal}` : ''}`
        : indicators.RSI ? 'Neutral' : '--';
    updateStatus(
        'rsiStatus',
        rsiStatus,
        rsiDirection === 'BULLISH' ? 'bullish' : rsiDirection === 'BEARISH' ? 'bearish' : 'neutral'
    );

    const macd = indicators.MACD;
    updateText('macdValue', macd ? formatIndicator(macd.histogram) : '--');
    updateStatus(
        'macdStatus',
        macd ? (macd.histogram > 0 ? 'Bullish' : 'Bearish') : '--',
        macd ? (macd.histogram > 0 ? 'bullish' : 'bearish') : 'neutral'
    );

    const bb = indicators.BollingerBands;
    updateText('bbValue', bb ? `${formatIndicator(bb.lower, 0)} - ${formatIndicator(bb.upper, 0)}` : '--');
    if (bb && bb.currentPrice < bb.lower) {
        updateStatus('bbStatus', 'Below lower band', 'bullish');
    } else if (bb && bb.currentPrice > bb.upper) {
        updateStatus('bbStatus', 'Above upper band', 'bearish');
    } else {
        updateStatus('bbStatus', bb ? 'Within bands' : '--', 'neutral');
    }

    const ema = indicators.EMA;
    updateText('emaValue', ema && ema.short && ema.long ? `${formatIndicator(ema.short, 0)} / ${formatIndicator(ema.long, 0)}` : '--');
    updateStatus(
        'emaStatus',
        ema && ema.short && ema.long ? (ema.short > ema.long ? 'Bullish crossover' : 'Bearish crossover') : '--',
        ema && ema.short && ema.long ? (ema.short > ema.long ? 'bullish' : 'bearish') : 'neutral'
    );

    const adx = indicators.ADX;
    updateText('adxValue', adx ? formatIndicator(adx.adx) : '--');
    updateStatus(
        'adxStatus',
        adx ? (adx.adx > 25 ? 'Strong trend' : 'Weak trend') : '--',
        adx && adx.plusDI > adx.minusDI ? 'bullish' : adx && adx.minusDI > adx.plusDI ? 'bearish' : 'neutral'
    );

    const stoch = indicators.Stochastic;
    updateText('stochValue', stoch ? `${formatIndicator(stoch.k)} / ${formatIndicator(stoch.d)}` : '--');
    updateStatus(
        'stochStatus',
        stoch ? (stoch.k > 80 ? 'Overbought' : stoch.k < 20 ? 'Oversold' : 'Neutral') : '--',
        stoch ? (stoch.k > 80 ? 'bearish' : stoch.k < 20 ? 'bullish' : 'neutral') : 'neutral'
    );

    const volume = indicators.Volume;
    updateText(
        'volumeValue',
        volume && Number.isFinite(Number(volume.ratio))
            ? `${formatCompactNumber(volume.current)} / ${formatIndicator(volume.ratio)}x`
            : '--'
    );
    updateStatus('volumeStatus', getVolumeStatusText(volume), getVolumeStatusTone(volume));

    const vwap = indicators.VWAP;
    updateText('vwapValue', formatVwapValue(vwap));
    updateStatus('vwapStatus', getVwapStatusText(vwap), getVwapStatusTone(vwap));

    const pivot = indicators.PivotPoints;
    updateText('pivotValue', pivot ? `P ${formatIndicator(pivot.pivot, 0)}` : '--');
    updateStatus('pivotStatus', getPivotStatusText(pivot), getPivotStatusTone(pivot));

    const supportResistance = indicators.SupportResistance;
    updateText('srValue', formatSupportResistanceValue(supportResistance));
    updateStatus('srStatus', getSupportResistanceStatusText(supportResistance), getSupportResistanceTone(supportResistance));

    const ictSystem = indicators.ICTAdvancedContext || indicators.ICTContext;
    updateText('ictSystemValue', formatIctSystemValue(ictSystem, indicators.ICTContext));
    updateStatus('ictSystemStatus', getIctSystemStatusText(ictSystem, indicators.ICTContext), getDirectionalTone(ictSystem?.direction));

    const orbSystem = indicators.ORBGapBBContext;
    updateText('orbSystemValue', formatOrbSystemValue(orbSystem));
    updateStatus('orbSystemStatus', getOrbSystemStatusText(orbSystem), getDirectionalTone(orbSystem?.direction));

    const candlestick = indicators.CandlestickPatterns;
    updateText('candlestickValue', formatPatternValue(candlestick));
    updateStatus('candlestickStatus', formatPatternStatus(candlestick), getDirectionalTone(candlestick?.direction));

    const fibonacci = indicators.FibonacciContext;
    updateText('fibonacciValue', formatFibonacciValue(fibonacci));
    updateStatus('fibonacciStatus', formatFibonacciStatus(fibonacci), getDirectionalTone(fibonacci?.direction));

    const chartPattern = indicators.ChartPatterns;
    updateText('chartPatternValue', formatPatternValue(chartPattern));
    updateStatus('chartPatternStatus', formatPatternStatus(chartPattern), getDirectionalTone(chartPattern?.direction));
}

function updateText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function updateStatus(id, text, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `indicator-status indicator-${tone}`;
}

function formatIndicator(value, decimals = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : '--';
}

function formatCompactNumber(value) {
    if (value === null || value === undefined || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';

    const abs = Math.abs(number);
    if (abs >= 10000000) return `${(number / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000) return `${(number / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return String(Math.round(number));
}

function formatIctSystemValue(advanced = {}, basic = {}) {
    const direction = advanced?.direction || basic?.direction || 'NEUTRAL';
    const strength = Number(advanced?.strength || basic?.strength || 0);
    return `${formatIctValue(direction)} ${strength}%`;
}

function getIctSystemStatusText(advanced = {}, basic = {}) {
    if (!advanced && !basic) return '--';
    const parts = [
        advanced?.htfDirection ? `HTF ${formatIctValue(advanced.htfDirection)}` : '',
        advanced?.activePoi ? formatAdvancedIctPoi(advanced.activePoi) : '',
        advanced?.trap?.type && advanced.trap.type !== 'NONE' ? `Trap ${formatIctValue(advanced.trap.type)}` : '',
        basic?.liquidity && basic.liquidity !== 'NONE' ? formatIctValue(basic.liquidity) : ''
    ].filter(Boolean);
    return parts.slice(0, 2).join(' | ') || 'Waiting for alignment';
}

function formatOrbSystemValue(context = {}) {
    const direction = context?.direction || 'NEUTRAL';
    const strength = Number(context?.strength || 0);
    return `${formatOrbValue(direction)} ${strength}%`;
}

function getOrbSystemStatusText(context = {}) {
    if (!context) return '--';
    const parts = [
        context.orbDirection ? formatOrbValue(context.orbDirection) : '',
        context.gapDirection && context.gapDirection !== 'FLAT' ? formatOrbValue(context.gapDirection) : '',
        context.bbTrap?.type && context.bbTrap.type !== 'NONE' ? formatOrbValue(context.bbTrap.type) : '',
        context.trapBoom?.type && context.trapBoom.type !== 'NONE' ? formatOrbValue(context.trapBoom.type) : ''
    ].filter(Boolean);
    return parts.slice(0, 2).join(' | ') || 'No trap setup';
}

function formatPatternValue(context = {}) {
    if (!context) return '--';
    const name = context.primary?.name || 'No pattern';
    const strength = Number(context.strength || 0);
    return strength ? name + ' ' + strength + '%' : name;
}

function formatPatternStatus(context = {}) {
    if (!context) return '--';
    const direction = context.direction || 'NEUTRAL';
    const trigger = context.primary?.trigger || context.primary?.detail || '';
    if (direction === 'NEUTRAL') return trigger || 'Waiting for pattern';
    return (formatIctValue(direction) + (trigger ? ' | ' + trigger : '')).trim();
}

function formatFibonacciValue(context = {}) {
    if (!context) return '--';
    const nearest = context.nearest;
    if (nearest?.value) {
        return 'Fib ' + nearest.ratio + ' @ ' + formatIndicator(nearest.value, 0);
    }
    return context.trend ? 'Trend ' + context.trend : '--';
}

function formatFibonacciStatus(context = {}) {
    if (!context) return '--';
    if (context.inGoldenZone) return 'Golden zone';
    if (context.breakout && context.breakout !== 'NONE') return formatOrbValue(context.breakout);
    if (context.nearest?.distancePercent !== undefined) {
        return 'Nearest ' + formatIndicator(context.nearest.distancePercent) + '%';
    }
    return 'Waiting for Fib confluence';
}

function getDirectionalTone(direction) {
    if (direction === 'BULLISH') return 'bullish';
    if (direction === 'BEARISH') return 'bearish';
    return 'neutral';
}

function getVolumeStatusText(volume) {
    if (!volume || !Number.isFinite(Number(volume.ratio))) return 'No volume data';

    const ratio = Number(volume.ratio);
    if (ratio >= Config.indicators.volume.spikeMultiplier && volume.priceDirection === 'UP') {
        return 'Buy volume';
    }
    if (ratio >= Config.indicators.volume.spikeMultiplier && volume.priceDirection === 'DOWN') {
        return 'Sell volume';
    }
    if (ratio < Config.indicators.volume.dryUpRatio) return 'Low volume';
    return 'Normal volume';
}

function getVolumeStatusTone(volume) {
    if (!volume || !Number.isFinite(Number(volume.ratio))) return 'neutral';
    if (volume.ratio >= Config.indicators.volume.spikeMultiplier && volume.priceDirection === 'UP') return 'bullish';
    if (volume.ratio >= Config.indicators.volume.spikeMultiplier && volume.priceDirection === 'DOWN') return 'bearish';
    return 'neutral';
}

function getPivotStatusText(pivot) {
    if (!pivot || !Number.isFinite(Number(pivot.currentPrice)) || !Number.isFinite(Number(pivot.pivot))) {
        return '--';
    }

    const nextLevel = getNearestPivotLabel(pivot);
    if (pivot.currentPrice > pivot.pivot) return nextLevel ? `Above pivot | ${nextLevel}` : 'Above pivot';
    if (pivot.currentPrice < pivot.pivot) return nextLevel ? `Below pivot | ${nextLevel}` : 'Below pivot';
    return 'At pivot';
}

function getPivotStatusTone(pivot) {
    if (!pivot || !Number.isFinite(Number(pivot.currentPrice)) || !Number.isFinite(Number(pivot.pivot))) {
        return 'neutral';
    }
    if (pivot.currentPrice > pivot.pivot) return 'bullish';
    if (pivot.currentPrice < pivot.pivot) return 'bearish';
    return 'neutral';
}

function getNearestPivotLabel(pivot) {
    const currentPrice = Number(pivot.currentPrice);
    const resistances = [
        { label: 'R1', value: pivot.r1 },
        { label: 'R2', value: pivot.r2 },
        { label: 'R3', value: pivot.r3 }
    ].filter(level => Number.isFinite(Number(level.value)) && level.value > currentPrice)
        .sort((a, b) => a.value - b.value);
    const supports = [
        { label: 'S1', value: pivot.s1 },
        { label: 'S2', value: pivot.s2 },
        { label: 'S3', value: pivot.s3 }
    ].filter(level => Number.isFinite(Number(level.value)) && level.value < currentPrice)
        .sort((a, b) => b.value - a.value);

    const support = supports[0];
    const resistance = resistances[0];
    if (support && resistance) {
        return `${support.label} ${formatIndicator(support.value, 0)} / ${resistance.label} ${formatIndicator(resistance.value, 0)}`;
    }
    if (support) return `${support.label} ${formatIndicator(support.value, 0)}`;
    if (resistance) return `${resistance.label} ${formatIndicator(resistance.value, 0)}`;
    return '';
}

function formatSupportResistanceValue(levels) {
    if (!levels || !Number.isFinite(Number(levels.currentPrice))) return '--';
    const support = levels.support?.value;
    const resistance = levels.resistance?.value;
    if (Number.isFinite(Number(support)) && Number.isFinite(Number(resistance))) {
        return `S ${formatIndicator(support, 0)} / R ${formatIndicator(resistance, 0)}`;
    }
    if (Number.isFinite(Number(support))) return `S ${formatIndicator(support, 0)}`;
    if (Number.isFinite(Number(resistance))) return `R ${formatIndicator(resistance, 0)}`;
    return '--';
}

function getSupportResistanceStatusText(levels) {
    if (!levels || !Number.isFinite(Number(levels.currentPrice))) return '--';
    const breakout = levels.breakout || {};
    if (breakout.fakeUp) return 'Fake breakout risk';
    if (breakout.fakeDown) return 'Fake breakdown risk';
    if (breakout.up) return `Closed above R ${formatIndicator(breakout.up.level?.value, 0)}`;
    if (breakout.down) return `Closed below S ${formatIndicator(breakout.down.level?.value, 0)}`;

    const supportDistance = Number(levels.supportDistancePercent);
    const resistanceDistance = Number(levels.resistanceDistancePercent);
    const buffer = Number(Config.optionScanner.supportResistanceBufferPercent || 0.38);

    if (Number.isFinite(resistanceDistance) && resistanceDistance <= buffer) {
        return `Near resistance ${formatIndicator(resistanceDistance)}%`;
    }
    if (Number.isFinite(supportDistance) && supportDistance <= buffer) {
        return `Near support ${formatIndicator(supportDistance)}%`;
    }
    return 'Clear structure';
}

function getSupportResistanceTone(levels) {
    if (!levels || !Number.isFinite(Number(levels.currentPrice))) return 'neutral';
    const breakout = levels.breakout || {};
    if (breakout.fakeUp) return 'bearish';
    if (breakout.fakeDown) return 'bullish';
    if (breakout.up) return 'bullish';
    if (breakout.down) return 'bearish';

    const supportDistance = Number(levels.supportDistancePercent);
    const resistanceDistance = Number(levels.resistanceDistancePercent);
    const buffer = Number(Config.optionScanner.supportResistanceBufferPercent || 0.38);

    if (Number.isFinite(resistanceDistance) && resistanceDistance <= buffer) return 'bearish';
    if (Number.isFinite(supportDistance) && supportDistance <= buffer) return 'bullish';
    return 'neutral';
}

function updateIndexSignal(symbol, signal) {
    const indexKey = indexUiMap[symbol];
    if (!indexKey) return;

    const card = document.getElementById(`${indexKey}Card`);
    if (card) {
        card.style.borderColor = signal === 'BUY' ? '#2e7d32' : signal === 'SELL' ? '#e53935' : '#ddd';
        card.style.borderWidth = signal === 'BUY' || signal === 'SELL' ? '2px' : '1px';
    }
}

async function handleOptionSegmentChange() {
    const segment = document.getElementById('optionSegment')?.value || 'INDEX';
    document.getElementById('indexField')?.classList.toggle('hidden', segment !== 'INDEX');
    document.querySelectorAll('.stock-field').forEach(field => field.classList.toggle('hidden', segment !== 'STOCK'));
    document.querySelectorAll('.commodity-field').forEach(field => field.classList.toggle('hidden', segment !== 'COMMODITY'));
    await populateExpirySelector();
}

function getCurrentScanner() {
    const segment = document.getElementById('optionSegment')?.value || 'INDEX';
    if (segment === 'STOCK') {
        const symbol = document.getElementById('stockSymbol')?.value.trim().toUpperCase() || '';
        const token = document.getElementById('stockToken')?.value.trim() || Config.stockOption.token;
        return { segment, symbol, token, exchange: Config.stockOption.exchange || 'NSE' };
    }

    if (segment === 'COMMODITY') {
        const symbol = document.getElementById('commoditySelector')?.value || Config.commodityOption.symbol || 'CRUDEOIL';
        return {
            segment,
            symbol,
            token: Config.commodityOption.token || '',
            exchange: Config.commodityOption.exchange || 'MCX'
        };
    }

    const symbol = document.getElementById('indexSelector')?.value || 'NIFTY';
    return { segment, symbol, token: Config.indices[symbol], exchange: getIndexExchange(symbol) };
}

async function populateExpirySelector() {
    const expirySelector = document.getElementById('expirySelector');
    if (!expirySelector) return '';

    const currentValue = expirySelector.value;
    expirySelector.innerHTML = '<option value="">Loading expiries...</option>';

    const scanner = getCurrentScanner();
    const expiryResponse = scanner.symbol ? await AngelOneAPI.getOptionExpiries(scanner.symbol, scanner.segment) : null;
    const liveExpiries = (expiryResponse?.data?.expiries || [])
        .map(item => item.iso || item.raw || item)
        .filter(Boolean);
    const expiries = scanner.segment === 'STOCK'
        ? getUpcomingStockOptionExpiries(8)
        : liveExpiries.length
            ? liveExpiries
            : getUpcomingExpiriesForSymbol(scanner.symbol, 8);

    expirySelector.innerHTML = '<option value="">Select Expiry</option>';
    expiries.forEach(expiry => {
        const option = document.createElement('option');
        option.value = expiry;
        option.textContent = expiry;
        expirySelector.appendChild(option);
    });

    const hasCurrentValue = Array.from(expirySelector.options).some(option => option.value === currentValue);
    expirySelector.value = hasCurrentValue ? currentValue : expirySelector.options[1]?.value || '';

    if (!liveExpiries.length && AngelOneAPI.lastError) {
        AngelOneAPI.log(`Expiry list fallback used: ${AngelOneAPI.lastError}`);
    }

    return getSelectedExpiryDate();
}

function getUpcomingExpiriesForSymbol(symbol, count) {
    if (symbol === 'SENSEX') return getUpcomingWeekdayExpiries(4, count);
    if (symbol === 'NIFTY') return getUpcomingWeekdayExpiries(2, count);
    return getUpcomingMonthlyExpiries(2, count);
}

function getUpcomingStockOptionExpiries(count) {
    return getUpcomingMonthlyExpiries(2, count);
}

function getUpcomingWeekdayExpiries(weekday, count) {
    const expiries = [];
    const date = new Date();
    date.setHours(0, 0, 0, 0);

    while (expiries.length < count) {
        if (date.getDay() === weekday) {
            expiries.push(formatApiDate(date));
        }
        date.setDate(date.getDate() + 1);
    }

    return expiries;
}

function getUpcomingMonthlyExpiries(weekday, count) {
    const expiries = [];
    const date = new Date();
    date.setHours(0, 0, 0, 0);

    for (let monthOffset = 0; expiries.length < count && monthOffset < count + 12; monthOffset++) {
        const monthDate = new Date(date.getFullYear(), date.getMonth() + monthOffset + 1, 0);
        while (monthDate.getDay() !== weekday) {
            monthDate.setDate(monthDate.getDate() - 1);
        }
        if (monthDate >= date) expiries.push(formatApiDate(monthDate));
    }

    return expiries;
}

function setManualExpiry() {
    const manualValue = document.getElementById('manualExpiry')?.value;
    if (!manualValue) return;

    const expirySelector = document.getElementById('expirySelector');
    const exists = Array.from(expirySelector.options).some(option => option.value === manualValue);
    if (!exists) {
        const option = document.createElement('option');
        option.value = manualValue;
        option.textContent = manualValue;
        expirySelector.appendChild(option);
    }
    expirySelector.value = manualValue;
    refreshOptionsForSelectedExpiry();
}

async function loadOptionsChain(resetExpiry = false) {
    if (resetExpiry) await populateExpirySelector();
    await refreshOptionsForSelectedExpiry();
}

async function refreshOptionsForSelectedExpiry(options = {}) {
    const force = Boolean(options.force);
    if (isRefreshingOptions) {
        pendingOptionRefresh = true;
        if (force) {
            renderOptionMessage('Option-chain request already running; latest result will appear shortly.', {
                replaceTable: false
            });
        }
        return;
    }

    isRefreshingOptions = true;
    let scanner = getCurrentScanner();
    try {
        if (!isMarketOpenForSegment(scanner.segment)) {
            renderOptionMessage(`${getMarketClosedReason(scanner.segment)}. Fresh calls will resume when this market opens.`);
            return;
        }

        if (scanner.segment === 'STOCK' && !scanner.symbol) {
            const scope = document.getElementById('autoScanScope');
            if (scope && scope.value !== 'STOCKS') {
                scope.value = 'STOCKS';
                Config.autoScanner.scope = 'STOCKS';
                Config.saveConfig();
            }
            renderOptionMessage('Stock symbol is blank, so Auto Market Scanner is scanning F&O stock options below.');
            runMarketWideScan(true);
            return;
        }

        let expiryDate = getSelectedExpiryDate();

        if (!expiryDate) {
            renderOptionMessage('Loading expiries...');
            await populateExpirySelector();
            expiryDate = getSelectedExpiryDate();
        }

        if (!expiryDate) {
            renderOptionMessage('Select an expiry to scan option-chain data.');
            return;
        }

        if (isDemoMode) {
            const spot = latestPricesBySymbol[scanner.symbol] || latestPricesBySymbol.NIFTY || 22000;
            const demoOptions = buildDemoOptionsChain(scanner.symbol, spot);
            updateOptionsTable(demoOptions, scanner.symbol);
            updateLastUpdateTime();
            return;
        }

        scanner = await resolveScannerTarget(scanner);
        if (scanner.segment === 'COMMODITY' && scanner.expiryDate) {
            expiryDate = scanner.expiryDate;
            const expirySelector = document.getElementById('expirySelector');
            if (expirySelector && !Array.from(expirySelector.options || []).some(option => option.value === expiryDate)) {
                const option = document.createElement('option');
                option.value = expiryDate;
                option.textContent = expiryDate;
                expirySelector.appendChild(option);
            }
            if (expirySelector) expirySelector.value = expiryDate;
        }

        if (!scanner.token) {
            renderOptionMessage(scanner.segment === 'COMMODITY'
                ? 'Commodity token could not be resolved from Angel One instrument master.'
                : 'Enter a valid Angel One token for stock-option scanning.');
            return;
        }

        const timeframe = document.getElementById('timeframeSelector')?.value || 'FIVE_MINUTE';
        await ensureAutoIndicators(scanner, timeframe);
        const spot = await getAutoSpotPrice(scanner);
        if (!spot) {
            renderOptionMessage('Waiting for live spot price before scanning options.');
            return;
        }

        lastOptionRefreshAttemptAt = Date.now();
        const data = await AngelOneAPI.getOptionsChain(scanner, expiryDate, spot);
        const chain = data?.data;
        if (chain && hasOptionChainRows(chain)) {
            updateOptionsTable(chain, scanner.symbol, chain.expiryDate || expiryDate);
            updateLastUpdateTime();
        } else {
            renderOptionMessage(formatOptionChainEmptyMessage(chain, expiryDate));
        }
    } catch (error) {
        console.error('Error fetching options data:', error);
        renderOptionMessage(`Option-chain error: ${error.message}`);
    } finally {
        isRefreshingOptions = false;
        if (pendingOptionRefresh) {
            pendingOptionRefresh = false;
            setTimeout(() => refreshOptionsForSelectedExpiry(), 0);
        }
    }
}

function getSelectedExpiryDate() {
    const expirySelector = document.getElementById('expirySelector');
    if (!expirySelector) return '';

    const directValue = String(expirySelector.value || '').trim();
    if (isUsableExpiryValue(directValue)) return directValue;

    const selectedOption = expirySelector.selectedOptions?.[0];
    const selectedValue = String(selectedOption?.value || selectedOption?.textContent || '').trim();
    if (isUsableExpiryValue(selectedValue)) {
        expirySelector.value = selectedOption.value || selectedValue;
        return selectedValue;
    }

    const firstExpiry = Array.from(expirySelector.options || [])
        .find(option => isUsableExpiryValue(option.value || option.textContent));
    if (firstExpiry) {
        expirySelector.value = firstExpiry.value || firstExpiry.textContent.trim();
        return String(expirySelector.value || firstExpiry.textContent || '').trim();
    }

    return '';
}

function isUsableExpiryValue(value) {
    const text = String(value || '').trim();
    return Boolean(text && !/select expiry|loading expiries/i.test(text));
}

function hasOptionChainRows(chain) {
    return Boolean(
        chain
        && (Object.keys(chain.calls || {}).length || Object.keys(chain.puts || {}).length)
    );
}

function formatOptionChainEmptyMessage(chain, requestedExpiry) {
    if (!chain) {
        return `Option-chain error: ${AngelOneAPI.lastError || 'No response from local server.'}`;
    }

    const details = [
        chain.message || 'No option-chain data returned.',
        `Requested ${requestedExpiry || '--'}`,
        chain.expiryDate && chain.expiryDate !== requestedExpiry ? `Using nearest ${chain.expiryDate}` : '',
        Number.isFinite(Number(chain.instruments)) ? `matched tokens ${chain.instruments}` : '',
        Number.isFinite(Number(chain.fetched)) ? `quotes ${chain.fetched}` : ''
    ].filter(Boolean);

    const expiries = (chain.availableExpiries || [])
        .map(item => item.iso || item.raw || item)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');

    return `${details.join(' | ')}${expiries ? ` | Available: ${expiries}` : ''}`;
}

function updateOptionsTable(optionsData, symbolOverride = null, resolvedExpiryDate = null) {
    const scanner = getCurrentScanner();
    const symbol = symbolOverride || scanner.symbol;
    const indicators = latestIndicatorsBySymbol[symbol] || latestIndicatorsBySymbol.NIFTY || {};
    const fallbackSpot = latestPricesBySymbol[symbol] || latestPricesBySymbol.NIFTY || 0;
    const timeframe = document.getElementById('timeframeSelector')?.value || 'FIVE_MINUTE';
    const evaluation = OptionSignalEngine.evaluateChain(symbol, optionsData, indicators, fallbackSpot, { timeframe });
    const expiryDate = resolvedExpiryDate || optionsData?.expiryDate || document.getElementById('expirySelector')?.value || '';
    evaluation.expiryDate = expiryDate;
    evaluation.rows.forEach(row => {
        row.call.expiryDate = expiryDate;
        row.put.expiryDate = expiryDate;
    });
    if (evaluation.best) evaluation.best.expiryDate = expiryDate;
    updateOptionTradeHistoryFromEvaluation(evaluation);

    renderOptionSummary(evaluation);
    renderOptionRows(evaluation.rows);
    updateWebSocketSubscriptionFromEvaluation(evaluation);
    optionChainLoadedAt = Date.now();

    if (evaluation.best) {
        evaluation.best.source = 'Selected scanner';
        evaluation.best.segment = scanner.segment;
        const tradeBlocked = shouldBlockNewOptionSignal(evaluation.best);
        if (tradeBlocked) {
            AngelOneAPI.log(`Skipped ${symbol} ${evaluation.best.side}: one open call is already active for this stock.`);
        }
        if (isTradeAlertAction(evaluation.best.action) && !tradeBlocked) {
            AngelOneAPI.log(`${evaluation.best.action}: ${symbol} ${evaluation.best.strike} ${evaluation.best.side} score ${evaluation.best.score}%`);
            TelegramNotifier.sendOptionSignal(evaluation.best).then(sent => {
                registerOptionTrade(evaluation.best, { telegramSent: sent });
            });
        }
    }
}

function updateWebSocketSubscriptionFromEvaluation(evaluation) {
    if (isDemoMode || !AngelOneAPI.isConnected || !evaluation?.rows?.length) return;

    const exchangeTokens = getOpenOptionExchangeTokens(getIndexExchangeTokens());
    evaluation.rows.forEach(row => {
        [row.call, row.put].forEach(item => {
            addExchangeToken(exchangeTokens, item.option?.exchange, item.option?.token);
        });
    });

    const subscriptionKey = Object.entries(exchangeTokens)
        .map(([exchange, tokens]) => `${exchange}:${tokens.map(String).sort().join(',')}`)
        .sort()
        .join('|');
    if (subscriptionKey === lastWebSocketSubscriptionKey) return;
    lastWebSocketSubscriptionKey = subscriptionKey;
    AngelOneAPI.updateWebSocketSubscription(exchangeTokens);
}

function refreshOpenOptionWebSocketSubscription() {
    if (isDemoMode || !AngelOneAPI.isConnected) return;

    const exchangeTokens = getOpenOptionExchangeTokens(getIndexExchangeTokens());
    const indexTokens = new Set(Object.values(Config.indices).map(String));
    const hasOpenOptionToken = Object.values(exchangeTokens)
        .flat()
        .some(token => !indexTokens.has(String(token)));
    if (!hasOpenOptionToken) return;

    const subscriptionKey = Object.entries(exchangeTokens)
        .map(([exchange, tokens]) => `${exchange}:${tokens.map(String).sort().join(',')}`)
        .sort()
        .join('|');
    if (subscriptionKey === lastWebSocketSubscriptionKey) return;
    lastWebSocketSubscriptionKey = subscriptionKey;
    AngelOneAPI.updateWebSocketSubscription(exchangeTokens);
}

function renderOptionSummary(evaluation) {
    const summary = document.getElementById('optionSummary');
    if (!summary) return;

    const best = evaluation.best;
    const indicatorContext = evaluation.indicators || {};
    const ict = indicatorContext.ICTContext || {};
    const advancedIct = indicatorContext.ICTAdvancedContext || {};
    const orbGapBb = indicatorContext.ORBGapBBContext || {};
    if (!best) {
        summary.innerHTML = `
            <div class="summary-title">NO TRADE - Not aligned</div>
            <div class="summary-grid">
                <div class="summary-metric">Spot<strong>${OptionSignalEngine.formatMoney(evaluation.spotPrice)}</strong></div>
                <div class="summary-metric">ATM<strong>${evaluation.atmStrike}</strong></div>
                <div class="summary-metric">Bias<strong>${evaluation.bias.direction}</strong></div>
                <div class="summary-metric">Strength<strong>${evaluation.bias.strength}%</strong></div>
                <div class="summary-metric">FVG<strong>${formatIctValue(ict.fvg)}</strong></div>
                <div class="summary-metric">Liq<strong>${formatIctValue(ict.liquidity)}</strong></div>
                <div class="summary-metric">ICT<strong>${formatAdvancedIctSummary(advancedIct)}</strong></div>
                <div class="summary-metric">ORB<strong>${formatOrbGapSummary(orbGapBb)}</strong></div>
            </div>
            <div class="summary-reasons">Wait for alignment.</div>
        `;
        return;
    }

    summary.innerHTML = `
        <div class="summary-title">${best.action}: ${best.symbol} ${best.strike} ${best.side}</div>
        <div class="summary-grid">
            <div class="summary-metric">Confidence<strong>${best.score}%</strong></div>
            <div class="summary-metric">Entry<strong>${OptionSignalEngine.formatMoney(best.risk.entry)}</strong></div>
            <div class="summary-metric">SL<strong>${OptionSignalEngine.formatMoney(best.risk.stopLoss)}</strong></div>
            <div class="summary-metric">T1<strong>${OptionSignalEngine.formatMoney(best.risk.target1)}</strong></div>
            <div class="summary-metric">T2<strong>${OptionSignalEngine.formatMoney(best.risk.target2)}</strong></div>
            <div class="summary-metric">Lot<strong>${formatOptionLotSize(best)}</strong></div>
            <div class="summary-metric">Bias<strong>${best.bias.direction}</strong></div>
            <div class="summary-metric">ICT<strong>${formatAdvancedIctSummary(advancedIct)}</strong></div>
            <div class="summary-metric">FVG<strong>${formatIctValue(ict.fvg)}</strong></div>
            <div class="summary-metric">Liq<strong>${formatIctValue(ict.liquidity)}</strong></div>
            <div class="summary-metric">ORB<strong>${formatOrbGapSummary(orbGapBb)}</strong></div>
        </div>
        <div class="summary-reasons">${[...best.reasons, ...best.warnings.map(item => `Caution: ${item}`)].join(' | ')}</div>
    `;
}

function formatIctValue(value) {
    return String(value || 'NONE').replace(/_/g, ' ');
}

function formatAdvancedIctSummary(context = {}) {
    const direction = formatIctValue(context.direction || 'NEUTRAL');
    const htf = formatIctValue(context.htfDirection || 'NEUTRAL');
    const status = context.workDone ? 'DONE' : 'PENDING';
    return `${direction} | HTF ${htf} | ${status}`;
}

function formatAdvancedIctPoi(poi) {
    if (!poi) return 'NONE';
    return `${formatIctValue(poi.frame)} ${formatIctValue(poi.type)}`;
}

function formatOrbValue(value) {
    return String(value || 'NONE').replace(/_/g, ' ');
}

function formatOrbGapSummary(context = {}) {
    const direction = formatOrbValue(context.direction || 'NEUTRAL');
    const orb = formatOrbValue(context.orbDirection || 'UNKNOWN');
    const gap = formatOrbValue(context.gapDirection || 'UNKNOWN');
    return `${direction} | ${orb} | ${gap}`;
}

function formatIctSwingSummary(ict = {}) {
    const high = Number(ict.lastSwingHigh);
    const low = Number(ict.lastSwingLow);
    return `${Number.isFinite(high) ? formatIndicator(high, 0) : '--'} / ${Number.isFinite(low) ? formatIndicator(low, 0) : '--'}`;
}

function formatVolumeSummary(volume) {
    if (!volume || !Number.isFinite(Number(volume.ratio))) return 'No data';
    const direction = volume.priceDirection === 'UP'
        ? 'up'
        : volume.priceDirection === 'DOWN'
            ? 'down'
            : 'flat';
    return `${formatIndicator(volume.ratio)}x ${direction}`;
}

function formatVwapValue(vwap) {
    if (!vwap || !Number.isFinite(Number(vwap.vwap))) return '--';
    return `${formatIndicator(vwap.vwap, 2)}`;
}

function getVwapStatusText(vwap) {
    if (!vwap || !Number.isFinite(Number(vwap.vwap))) return '--';
    if (vwap.position === 'ABOVE') return `Above VWAP ${formatIndicator(vwap.distancePercent)}%`;
    if (vwap.position === 'BELOW') return `Below VWAP ${formatIndicator(Math.abs(vwap.distancePercent))}%`;
    return 'At VWAP';
}

function getVwapStatusTone(vwap) {
    if (!vwap || !Number.isFinite(Number(vwap.vwap))) return 'neutral';
    if (vwap.position === 'ABOVE') return 'bullish';
    if (vwap.position === 'BELOW') return 'bearish';
    return 'neutral';
}

function formatVwapSummary(vwap) {
    if (!vwap || !Number.isFinite(Number(vwap.vwap))) return '--';
    const side = vwap.position === 'ABOVE' ? 'Above' : vwap.position === 'BELOW' ? 'Below' : 'At';
    return `${side} ${formatIndicator(vwap.vwap, 0)}`;
}

function formatPivotSummary(pivot) {
    if (!pivot || !Number.isFinite(Number(pivot.currentPrice)) || !Number.isFinite(Number(pivot.pivot))) {
        return '--';
    }
    return pivot.currentPrice >= pivot.pivot
        ? `Above P ${formatIndicator(pivot.pivot, 0)}`
        : `Below P ${formatIndicator(pivot.pivot, 0)}`;
}

function formatSupportResistanceSummary(levels) {
    if (!levels || !Number.isFinite(Number(levels.currentPrice))) return '--';
    return formatSupportResistanceValue(levels);
}

function renderOptionRows(rows) {
    const tbody = document.getElementById('optionsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    rows.forEach(row => {
        const callClass = getOptionSignalClass(row.call.action);
        const putClass = getOptionSignalClass(row.put.action);
        const bestRisk = row.call.score >= row.put.score ? row.call.risk : row.put.risk;
        const callToken = escapeHtml(row.call.option.token || '');
        const putToken = escapeHtml(row.put.option.token || '');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${row.strike}</strong></td>
            <td data-option-ltp-token="${callToken}">${OptionSignalEngine.formatMoney(getLiveOptionLtp(row.call.option))}</td>
            <td>${row.call.score}%<span class="table-note">Vol ${formatCompactNumber(row.call.option.volume)}</span></td>
            <td><span class="signal ${callClass}">${row.call.action}</span></td>
            <td data-option-ltp-token="${putToken}">${OptionSignalEngine.formatMoney(getLiveOptionLtp(row.put.option))}</td>
            <td>${row.put.score}%<span class="table-note">Vol ${formatCompactNumber(row.put.option.volume)}</span></td>
            <td><span class="signal ${putClass}">${row.put.action}</span></td>
            <td>
                Entry ${OptionSignalEngine.formatMoney(bestRisk.entry)}
                <span class="table-note">SL ${OptionSignalEngine.formatMoney(bestRisk.stopLoss)} | T1 ${OptionSignalEngine.formatMoney(bestRisk.target1)}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function getLiveOptionLtp(option) {
    const token = String(option?.token || '');
    return latestOptionTicksByToken[token]?.ltp || option?.ltp || 0;
}

function updateLiveOptionTick(tick) {
    const token = String(tick?.token ?? tick?.symbolToken ?? tick?.symboltoken ?? '');
    const ltp = Number(tick?.ltp ?? tick?.lastPrice ?? 0);
    if (!token || !Number.isFinite(ltp) || ltp <= 0) return;

    latestOptionTicksByToken[token] = {
        ltp,
        loadedAt: Date.now()
    };

    document.querySelectorAll(`[data-option-ltp-token="${CSS.escape(token)}"]`).forEach(cell => {
        cell.textContent = OptionSignalEngine.formatMoney(ltp);
    });
    updateLastUpdateTime();
    updateActiveTradeLtpFromTick(token, ltp);
}

function updateActiveTradeLtpFromTick(token, ltp) {
    const savedSignals = getActiveOptionSignals();
    let changed = false;
    savedSignals.forEach(signal => {
        const optionToken = String(signal.option?.token || '');
        if (optionToken !== token) return;
        signal.option.ltp = ltp;
        signal.lastLtp = ltp;
        changed = true;
    });
    if (changed) {
        saveActiveOptionSignals(savedSignals);
        document.querySelectorAll(`[data-option-signal-token="${CSS.escape(token)}"] [data-live-signal-ltp]`).forEach(node => {
            node.textContent = OptionSignalEngine.formatMoney(ltp);
        });
    }

    const history = getOptionTradeHistory();
    let historyChanged = false;
    history.forEach(trade => {
        if (trade.status !== 'Open' || String(trade.optionToken || '') !== token) return;
        trade.lastLtp = ltp;
        trade.updatedAt = new Date().toISOString();
        const status = getOptionTradeStatus(trade, ltp);
        if (status !== 'Open') {
            trade.status = status;
            trade.closedAt = trade.updatedAt;
            notifyTradeExit(trade, status, ltp);
            AngelOneAPI.log(`${status}: ${trade.symbol} ${trade.strike} ${trade.side} @ ${OptionSignalEngine.formatMoney(ltp)}`);
        }
        trade.pnl = getPaperPnl(trade);
        trade.pnlPercent = getPaperPnlPercent(trade);
        historyChanged = true;
    });
    if (historyChanged) {
        saveOptionTradeHistory(sortOptionTradeHistory(history));
        renderOptionTradeHistory();
        maybeRefreshOptionsAfterOptionTick();
    }
}

function getOptionLotSize(source = {}) {
    const lotSize = Number(
        source.lotSize
        ?? source.lotsize
        ?? source.option?.lotSize
        ?? source.option?.lotsize
        ?? 0
    );
    if (Number.isFinite(lotSize) && lotSize > 0) return lotSize;
    const symbol = source.symbol || source.option?.symbol || source.tradingSymbol || '';
    const cleanSymbol = String(symbol).replace(/(CE|PE)$/i, '').replace(/\d+[A-Z]*\d+.*$/, '').trim();
    const lookup = Config.optionScanner.stockLotSizes || {};
    const matchedKey = Object.keys(lookup).find(key => cleanSymbol.includes(key));
    return matchedKey ? lookup[matchedKey] : 0;
}

function formatOptionLotSize(source = {}) {
    const lotSize = getOptionLotSize(source);
    return lotSize ? String(lotSize) : '--';
}

function getOptionTradeHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(optionTradeHistoryStorageKey) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function saveOptionTradeHistory(history) {
    localStorage.setItem(optionTradeHistoryStorageKey, JSON.stringify(history.slice(0, maxOptionTradeHistory)));
}

function getOptionTradeKey(signal) {
    return [
        signal.symbol || '',
        signal.expiryDate || signal.expiry || '',
        signal.strike || '',
        signal.side || '',
        signal.action || ''
    ].join('|').toUpperCase();
}

function registerOptionTrade(signal, options = {}) {
    if (!isTradeAlertAction(signal?.action)) return;

    const risk = signal.risk || {};
    const now = new Date().toISOString();
    const key = getOptionTradeKey(signal);
    const history = getOptionTradeHistory();
    const existing = history.find(item => item.key === key && item.status === 'Open');
    const existingForSymbol = history.find(item =>
        item.status === 'Open'
        && item.key !== key
        && String(item.symbol || '').toUpperCase() === String(signal.symbol || '').toUpperCase()
    );
    const recentClosed = history.find(item => item.key === key
        && item.status !== 'Open'
        && Date.now() - new Date(item.openedAt || 0).getTime() < 6 * 60 * 60 * 1000);
    const ltp = Number(signal.option?.ltp || risk.entry || 0);

    if (Config.tradeLock?.enabled !== false && existingForSymbol) {
        AngelOneAPI.log(`Skipped ${signal.symbol}: one open call is already active for this stock (${existingForSymbol.strike} ${existingForSymbol.side}). Wait for it to close.
`);
        return;
    }

    if (recentClosed && !options.telegramSent && !options.sentManually) return;

    if (existing) {
        existing.lastLtp = ltp || existing.lastLtp || existing.entry;
        existing.optionToken = signal.option?.token || existing.optionToken || '';
        existing.exchange = signal.option?.exchange || existing.exchange || '';
        existing.lotSize = getOptionLotSize(signal) || existing.lotSize || 0;
        existing.score = Number(signal.score || existing.score || 0);
        existing.updatedAt = now;
        existing.telegramSent = Boolean(existing.telegramSent || options.telegramSent);
        existing.sentManually = Boolean(existing.sentManually || options.sentManually);
        existing.pnl = getPaperPnl(existing);
        existing.pnlPercent = getPaperPnlPercent(existing);
        saveOptionTradeHistory(sortOptionTradeHistory(history));
        refreshOpenOptionWebSocketSubscription();
        renderOptionTradeHistory();
        return;
    }

    const trade = {
        key,
        symbol: signal.symbol,
        expiryDate: signal.expiryDate || signal.expiry || '',
        strike: signal.strike,
        side: signal.side,
        action: signal.action,
        source: signal.source || 'Scanner',
        segment: signal.segment || '',
        optionToken: signal.option?.token || '',
        exchange: signal.option?.exchange || '',
        lotSize: getOptionLotSize(signal),
        score: Number(signal.score || 0),
        entry: Number(risk.entry || ltp || 0),
        stopLoss: Number(risk.stopLoss || 0),
        target1: Number(risk.target1 || 0),
        target2: Number(risk.target2 || 0),
        openedAt: now,
        updatedAt: now,
        closedAt: '',
        status: 'Open',
        lastLtp: ltp || Number(risk.entry || 0),
        slTouches: 0,
        telegramSent: Boolean(options.telegramSent),
        sentManually: Boolean(options.sentManually),
        exitAlertSent: false,
        pnl: 0,
        pnlPercent: 0
    };
    trade.pnl = getPaperPnl(trade);
    trade.pnlPercent = getPaperPnlPercent(trade);

    history.unshift(trade);
    saveOptionTradeHistory(sortOptionTradeHistory(history));
    refreshOpenOptionWebSocketSubscription();
    renderOptionTradeHistory();
}

function updateOptionTradeHistoryFromEvaluation(evaluation) {
    if (!evaluation?.rows?.length) {
        renderOptionTradeHistory();
        return;
    }

    const history = getOptionTradeHistory();
    let changed = false;

    history.forEach(trade => {
        if (trade.status !== 'Open') return;
        if (String(trade.symbol || '').toUpperCase() !== String(evaluation.symbol || '').toUpperCase()) return;
        if (trade.expiryDate && evaluation.expiryDate && trade.expiryDate !== evaluation.expiryDate) return;

        const row = evaluation.rows.find(item => Number(item.strike) === Number(trade.strike));
        const option = trade.side === 'CALL' ? row?.call?.option : row?.put?.option;
        const ltp = Number(option?.ltp || 0);
        if (!Number.isFinite(ltp) || ltp <= 0) return;

        trade.lastLtp = ltp;
        trade.optionToken = option?.token || trade.optionToken || '';
        trade.exchange = option?.exchange || trade.exchange || '';
        trade.lotSize = getOptionLotSize(option) || trade.lotSize || 0;
        trade.updatedAt = new Date().toISOString();
        const status = getOptionTradeStatus(trade, ltp, evaluation);
        if (status !== 'Open') {
            trade.status = status;
            trade.closedAt = trade.updatedAt;
            removeActiveOptionSignalsForSymbol(trade.symbol);
            notifyTradeExit(trade, status, ltp);
            AngelOneAPI.log(`${status}: ${trade.symbol} ${trade.strike} ${trade.side} @ ${OptionSignalEngine.formatMoney(ltp)}`);
        }
        trade.pnl = getPaperPnl(trade);
        trade.pnlPercent = getPaperPnlPercent(trade);
        changed = true;
    });

    changed = expireOptionTrades(history) || changed;
    if (changed) saveOptionTradeHistory(sortOptionTradeHistory(history));
    renderOptionTradeHistory();
}

function expireOptionTrades(history = getOptionTradeHistory()) {
    let changed = false;
    const now = new Date();

    history.forEach(trade => {
        if (trade.status !== 'Open') return;
        const expiry = OptionSignalEngine.parseExpiryDate(trade.expiryDate);
        if (!expiry) return;
        expiry.setHours(15, 30, 0, 0);
        if (now > expiry) {
            trade.status = 'Expired';
            trade.closedAt = now.toISOString();
            trade.updatedAt = trade.closedAt;
            trade.pnl = getPaperPnl(trade);
            trade.pnlPercent = getPaperPnlPercent(trade);
            removeActiveOptionSignalsForSymbol(trade.symbol);
            notifyTradeExit(trade, trade.status, trade.lastLtp || trade.entry || 0);
            changed = true;
        }
    });

    return changed;
}

function getOptionTradeStatus(trade, ltp, evaluation = null) {
    const stopLoss = Number(trade.stopLoss || 0);
    const target1 = Number(trade.target1 || 0);
    const target2 = Number(trade.target2 || 0);
    // FIX: Increased default confirmations from 1 to 2 - SL hit needs 2 consecutive touches
    const slConfirmations = Math.max(2, Number(Config.optionScanner.stopLoss?.confirmations ?? 2));

    if (stopLoss > 0 && ltp <= stopLoss) {
        trade.slTouches = Number(trade.slTouches || 0) + 1;
        if (trade.slTouches >= slConfirmations) return 'SL Hit';
        return 'Open';
    }

    trade.slTouches = 0; // Reset on recovery
    if (target2 > 0 && ltp >= target2) return 'Target 2 Hit';
    if (target1 > 0 && ltp >= target1) return 'Target 1 Hit';
    if (isSignalChangedExit(trade, evaluation)) return 'Signal Changed Exit';
    if (isTrendExit(trade, evaluation)) return 'Trend Exit';
    return 'Open';
}

function isSignalChangedExit(trade, evaluation) {
    const best = evaluation?.best;
    if (!best || !trade?.side) return false;
    const bestAction = String(best.action || '');
    if (!isTradeAlertAction(bestAction) && !bestAction.startsWith('WATCH')) return false;
    if (String(best.side || '').toUpperCase() === String(trade.side || '').toUpperCase()) return false;
    return Number(best.score || 0) >= Number(Config.optionScanner.minConfidence || 68);
}

function isTrendExit(trade, evaluation) {
    const settings = Config.optionScanner.trendExit || {};
    if (settings.enabled === false || !evaluation?.bias || !trade?.side) return false;

    const openedAt = new Date(trade.openedAt || 0).getTime();
    const minHoldMs = Number(settings.minHoldMinutes ?? 2) * 60 * 1000;
    if (Number.isFinite(openedAt) && openedAt > 0 && Date.now() - openedAt < minHoldMs) return false;

    const oppositeDirection = trade.side === 'CALL' ? 'BEARISH' : 'BULLISH';
    const minimumStrength = Number(settings.minOppositeTrendStrength || 45);
    return evaluation.bias.direction === oppositeDirection
        && Number(evaluation.bias.strength || 0) >= minimumStrength;
}

function notifyTradeExit(trade, status, ltp) {
    if (TelegramNotifier.isStockOptionSignal(trade)) {
        TelegramNotifier.releaseStockAutoSlot(trade);
    }

    if (!trade?.telegramSent || trade.exitAlertSent) return;

    trade.exitAlertSent = true;
    TelegramNotifier.sendTradeUpdate(trade, String(status || 'Exit').toUpperCase(), ltp).then(sent => {
        if (!sent) {
            AngelOneAPI.log(`Telegram exit alert failed: ${trade.symbol} ${trade.strike} ${trade.side}`);
        }
    });
}

function getPaperPnl(trade) {
    return Number(trade.lastLtp || 0) - Number(trade.entry || 0);
}

function getPaperLotPnl(trade) {
    return getPaperPnl(trade) * (getOptionLotSize(trade) || 1);
}

function getPaperPnlPercent(trade) {
    const entry = Number(trade.entry || 0);
    if (!entry) return 0;
    return (getPaperPnl(trade) / entry) * 100;
}

function sortOptionTradeHistory(history) {
    return history.sort((a, b) => {
        const openScore = (b.status === 'Open' ? 1 : 0) - (a.status === 'Open' ? 1 : 0);
        if (openScore) return openScore;
        return new Date(b.openedAt || 0) - new Date(a.openedAt || 0);
    });
}

function renderOptionTradeHistory() {
    const history = getOptionTradeHistory();
    if (expireOptionTrades(history)) saveOptionTradeHistory(sortOptionTradeHistory(history));

    const tbody = document.getElementById('optionHistoryBody');
    const stats = document.getElementById('optionHistoryStats');
    if (!tbody) return;

    const sorted = sortOptionTradeHistory(history).slice(0, 80);
    const openTrades = sorted.filter(trade => trade.status === 'Open');
    const closedTrades = sorted.filter(trade => trade.status !== 'Open');

    // FIX: Separate P&L by segment
    const indexTrades = sorted.filter(t => isIndexSegment(t.segment));
    const stockTrades = sorted.filter(t => isStockSegment(t.segment));
    const commodityTrades = sorted.filter(t => isCommoditySegment(t.segment));

    const indexOpenPnl = indexTrades.filter(t => t.status === 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);
    const stockOpenPnl = stockTrades.filter(t => t.status === 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);
    const commodityOpenPnl = commodityTrades.filter(t => t.status === 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);
    const totalOpenPnl = indexOpenPnl + stockOpenPnl + commodityOpenPnl;

    // Closed P&L
    const indexClosedPnl = indexTrades.filter(t => t.status !== 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);
    const stockClosedPnl = stockTrades.filter(t => t.status !== 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);
    const commodityClosedPnl = commodityTrades.filter(t => t.status !== 'Open').reduce((s, t) => s + getPaperLotPnl(t), 0);

    // Update stats display
    updateSegmentPnlDisplay('indexPnl', indexOpenPnl, indexClosedPnl, indexTrades);
    updateSegmentPnlDisplay('stockPnl', stockOpenPnl, stockClosedPnl, stockTrades);
    updateSegmentPnlDisplay('commodityPnl', commodityOpenPnl, commodityClosedPnl, commodityTrades);

    if (stats) {
        stats.textContent = `${openTrades.length} open | ${closedTrades.length} closed | Total P&L ${formatSignedNumber(totalOpenPnl)}`;
        stats.className = totalOpenPnl >= 0 ? 'history-stats up' : 'history-stats down';
    }

    if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="12">No tracked calls yet.</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(trade => {
        const pnl = getPaperPnl(trade);
        const lotPnl = getPaperLotPnl(trade);
        const pnlPercent = getPaperPnlPercent(trade);
        const statusClass = getTradeStatusClass(trade.status);
        const pnlClass = pnl >= 0 ? 'up' : 'down';
        const lotPnlClass = lotPnl >= 0 ? 'up' : 'down';
        const lotSize = getOptionLotSize(trade);
        return `
            <tr>
                <td>${escapeHtml(formatTradeTime(trade.openedAt))}</td>
                <td>
                    <button class="trade-symbol-button" type="button" onclick="toggleOptionTradeActions('${escapeHtml(trade.key)}')">
                        <strong>${escapeHtml(trade.symbol)}</strong>
                        <span class="table-note">${escapeHtml(trade.source || trade.action || '')}</span>
                    </button>
                    <div class="trade-row-actions hidden" data-trade-actions="${escapeHtml(trade.key)}">
                        <button class="btn btn-small" onclick="clearOptionTrade('${escapeHtml(trade.key)}')">Clear this stock</button>
                    </div>
                </td>
                <td>${escapeHtml(trade.expiryDate || '--')}</td>
                <td>${escapeHtml(trade.strike)}</td>
                <td>${escapeHtml(trade.side)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.entry)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.stopLoss)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.target1)}</td>
                <td data-option-ltp-token="${escapeHtml(trade.optionToken || '')}">${OptionSignalEngine.formatMoney(trade.lastLtp)}</td>
                <td class="${pnlClass}">${formatSignedNumber(pnl)}<span class="table-note">${formatSignedNumber(pnlPercent)}%</span></td>
                <td class="${lotPnlClass}">${formatSignedNumber(lotPnl)}<span class="table-note">Lot ${lotSize || '--'}</span></td>
                <td><span class="trade-status ${statusClass}">${escapeHtml(trade.status)}</span></td>
            </tr>
        `;
    }).join('');
}

function formatSignedNumber(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? '+' : '';
    return `${sign}${number.toFixed(2)}`;
}

function formatTradeTime(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getTradeStatusClass(status) {
    const text = String(status || '').toLowerCase();
    if (text.includes('target')) return 'status-target';
    if (text.includes('sl')) return 'status-sl';
    if (text.includes('trend')) return 'status-trend';
    if (text.includes('expired')) return 'status-expired';
    return 'status-open';
}

function clearOptionTradeHistory() {
    localStorage.removeItem(optionTradeHistoryStorageKey);
    TelegramNotifier.clearAllMemory();
    clearActiveOptionSignals();
    renderOptionTradeHistory();
}

// FIX: Segment detection helpers
function isIndexSegment(segment) {
    const s = String(segment || '').toUpperCase();
    return s === 'INDEX' || s === 'INDEX_OPTIONS' || s.includes('INDEX');
}

function isStockSegment(segment) {
    const s = String(segment || '').toUpperCase();
    return s === 'STOCK' || s === 'STOCK_OPTIONS' || s.includes('STOCK');
}

function isCommoditySegment(segment) {
    const s = String(segment || '').toUpperCase();
    return s === 'COMMODITY' || s === 'COMMODITY_OPTIONS' || s.includes('COMMODITY');
}

function getSegmentForTrade(trade) {
    if (isIndexSegment(trade.segment)) return 'INDEX';
    if (isStockSegment(trade.segment)) return 'STOCK';
    if (isCommoditySegment(trade.segment)) return 'COMMODITY';
    // Guess from symbol
    const sym = String(trade.symbol || '').toUpperCase();
    if (['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].some(ix => sym.includes(ix))) return 'INDEX';
    if (['CRUDEOIL', 'NATURALGAS', 'GOLD', 'SILVER', 'COPPER', 'ZINC', 'ALUMINIUM'].some(cx => sym.includes(cx))) return 'COMMODITY';
    return 'STOCK';
}

function updateSegmentPnlDisplay(prefix, openPnl, closedPnl, trades) {
    const openCount = trades.filter(t => t.status === 'Open').length;
    const closedCount = trades.filter(t => t.status !== 'Open').length;
    const totalPnl = openPnl + closedPnl;
    const cls = totalPnl >= 0 ? 'up' : 'down';
    const sign = totalPnl >= 0 ? '+' : '';

    const mainEl = document.getElementById(`${prefix}Main`);
    const openEl = document.getElementById(`${prefix}Open`);
    const closedEl = document.getElementById(`${prefix}Closed`);
    const openCountEl = document.getElementById(`${prefix}OpenCount`);
    const closedCountEl = document.getElementById(`${prefix}ClosedCount`);

    if (mainEl) { mainEl.textContent = `${sign}${totalPnl.toFixed(2)}`; mainEl.className = `pnl-card-main ${cls}`; }
    if (openEl) { openEl.textContent = `${openPnl >= 0 ? '+' : ''}${openPnl.toFixed(2)}`; openEl.className = `pnl-card-value ${openPnl >= 0 ? 'up' : 'down'}`; }
    if (closedEl) { closedEl.textContent = `${closedPnl >= 0 ? '+' : ''}${closedPnl.toFixed(2)}`; closedEl.className = `pnl-card-value ${closedPnl >= 0 ? 'up' : 'down'}`; }
    if (openCountEl) openCountEl.textContent = openCount;
    if (closedCountEl) closedCountEl.textContent = closedCount;
}

// FIX: Call history - filter by date
function getCallsByDate(dateStr) {
    const history = getOptionTradeHistory();
    return history.filter(trade => {
        const d = new Date(trade.openedAt || 0);
        return getIndiaDateKey(d) === dateStr;
    });
}

function getTodayCalls() {
    return getCallsByDate(getIndiaDateKey(new Date()));
}

function getYesterdayCalls() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getCallsByDate(getIndiaDateKey(yesterday));
}

function renderHistoryView() {
    const container = document.getElementById('historyViewBody');
    if (!container) return;

    const filter = document.getElementById('historyDateFilter')?.value || 'today';
    let calls;
    let label;

    if (filter === 'today') {
        calls = getTodayCalls();
        label = 'Today';
    } else if (filter === 'yesterday') {
        calls = getYesterdayCalls();
        label = 'Yesterday';
    } else {
        calls = getOptionTradeHistory();
        label = 'All Time';
    }

    const indexCalls = calls.filter(t => getSegmentForTrade(t) === 'INDEX');
    const stockCalls = calls.filter(t => getSegmentForTrade(t) === 'STOCK');
    const commodityCalls = calls.filter(t => getSegmentForTrade(t) === 'COMMODITY');

    const indexPnl = indexCalls.reduce((s, t) => s + getPaperLotPnl(t), 0);
    const stockPnl = stockCalls.reduce((s, t) => s + getPaperLotPnl(t), 0);
    const commodityPnl = commodityCalls.reduce((s, t) => s + getPaperLotPnl(t), 0);
    const totalPnl = indexPnl + stockPnl + commodityPnl;

    const wins = calls.filter(t => t.status !== 'Open' && getPaperLotPnl(t) > 0).length;
    const losses = calls.filter(t => t.status !== 'Open' && getPaperLotPnl(t) < 0).length;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

    // Update summary cards
    const summaryEl = document.getElementById('historySummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="history-card">
                <div class="history-card-label">${label} P&L</div>
                <div class="history-card-value ${totalPnl >= 0 ? 'up' : 'down'}">${formatSignedNumber(totalPnl)}</div>
            </div>
            <div class="history-card">
                <div class="history-card-label">Index</div>
                <div class="history-card-value ${indexPnl >= 0 ? 'up' : 'down'}">${formatSignedNumber(indexPnl)}</div>
                <div class="history-card-sub">${indexCalls.length} calls</div>
            </div>
            <div class="history-card">
                <div class="history-card-label">Stock</div>
                <div class="history-card-value ${stockPnl >= 0 ? 'up' : 'down'}">${formatSignedNumber(stockPnl)}</div>
                <div class="history-card-sub">${stockCalls.length} calls</div>
            </div>
            <div class="history-card">
                <div class="history-card-label">Commodity</div>
                <div class="history-card-value ${commodityPnl >= 0 ? 'up' : 'down'}">${formatSignedNumber(commodityPnl)}</div>
                <div class="history-card-sub">${commodityCalls.length} calls</div>
            </div>
            <div class="history-card">
                <div class="history-card-label">Win Rate</div>
                <div class="history-card-value">${winRate}%</div>
                <div class="history-card-sub">${wins}W / ${losses}L</div>
            </div>
        `;
    }

    // Render call list
    if (!calls.length) {
        container.innerHTML = `<tr><td colspan="10">No calls for ${label.toLowerCase()}.</td></tr>`;
        return;
    }

    container.innerHTML = calls.map(trade => {
        const pnl = getPaperLotPnl(trade);
        const seg = getSegmentForTrade(trade);
        return `
            <tr>
                <td>${escapeHtml(formatTradeTime(trade.openedAt))}</td>
                <td><span class="segment-tag segment-${seg.toLowerCase()}">${seg}</span></td>
                <td><strong>${escapeHtml(trade.symbol)}</strong></td>
                <td>${escapeHtml(trade.strike)} ${escapeHtml(trade.side)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.entry)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.stopLoss)}</td>
                <td>${OptionSignalEngine.formatMoney(trade.target1)}</td>
                <td class="${pnl >= 0 ? 'up' : 'down'}">${formatSignedNumber(pnl)}</td>
                <td><span class="trade-status ${getTradeStatusClass(trade.status)}">${escapeHtml(trade.status)}</span></td>
            </tr>
        `;
    }).join('');
}

function clearOptionTrade(key) {
    const normalizedKey = String(key || '').toUpperCase();
    if (!normalizedKey) return;

    const history = getOptionTradeHistory();
    const trade = history.find(item => String(item.key || '').toUpperCase() === normalizedKey);
    const nextHistory = history.filter(item => String(item.key || '').toUpperCase() !== normalizedKey);

    saveOptionTradeHistory(sortOptionTradeHistory(nextHistory));
    if (trade?.symbol && trade.status === 'Open') {
        removeActiveOptionSignalsForSymbol(trade.symbol);
    }
    renderOptionTradeHistory();
}

function toggleOptionTradeActions(key) {
    const normalizedKey = String(key || '');
    document.querySelectorAll('[data-trade-actions]').forEach(node => {
        const isCurrent = node.dataset.tradeActions === normalizedKey;
        node.classList.toggle('hidden', isCurrent ? !node.classList.contains('hidden') : true);
    });
}

function getOptionSignalClass(action) {
    if (action.startsWith('BTST')) return 'signal-btst';
    if (action.startsWith('BUY')) return 'signal-buy';
    if (action.startsWith('WATCH')) return 'signal-watch';
    return 'signal-no-trade';
}

function isTradeAlertAction(action) {
    const text = String(action || '');
    return text.startsWith('BUY') || text.startsWith('BTST');
}

function renderOptionMessage(message, options = {}) {
    const summary = document.getElementById('optionSummary');
    const tbody = document.getElementById('optionsTableBody');
    const replaceTable = options.replaceTable !== false;
    if (summary) summary.innerHTML = `<div class="summary-title">${message}</div>`;
    if (tbody && replaceTable) {
        tbody.innerHTML = `<tr><td colspan="8">${message}</td></tr>`;
        optionChainLoadedAt = 0;
    }
}

function getMarketHoursForSegment(segment) {
    const key = String(segment || 'INDEX').toUpperCase();
    return Config.marketHours?.[key] || Config.marketHours?.INDEX || {
        open: '09:15',
        close: '15:30'
    };
}

function getIndiaClockMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: Config.marketHours?.timezone || 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
    return (hour * 60) + minute;
}

function getIndiaDayOfWeek(date = new Date()) {
    const text = new Intl.DateTimeFormat('en-GB', {
        timeZone: Config.marketHours?.timezone || 'Asia/Kolkata',
        weekday: 'short'
    }).format(date);
    return {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6
    }[text] ?? date.getDay();
}

function parseMarketTimeToMinutes(value) {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return (hour * 60) + minute;
}

function isMarketOpenForSegment(segment, date = new Date()) {
    if (isDemoMode) return true;

    const hours = getMarketHoursForSegment(segment);
    const allowedDays = Array.isArray(hours.days) && hours.days.length ? hours.days : [1, 2, 3, 4, 5];
    if (!allowedDays.includes(getIndiaDayOfWeek(date))) return false;

    const nowMinutes = getIndiaClockMinutes(date);
    const openMinutes = parseMarketTimeToMinutes(hours.open);
    const closeMinutes = parseMarketTimeToMinutes(hours.close);

    if (openMinutes <= closeMinutes) {
        return nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
    }

    return nowMinutes >= openMinutes || nowMinutes <= closeMinutes;
}

function getIndiaDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: Config.marketHours?.timezone || 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getKnownMarketSegments() {
    return Object.keys(Config.marketHours || {})
        .filter(key => key !== 'timezone')
        .map(key => key.toUpperCase());
}

function resetClosedMarketsTradeState(date = new Date()) {
    if (isDemoMode) return;

    const closedSegments = getKnownMarketSegments()
        .filter(segment => !isMarketOpenForSegment(segment, date));
    if (!closedSegments.length) return;

    const resetKey = `${getIndiaDateKey(date)}|${closedSegments.sort().join(',')}`;
    if (resetKey === lastMarketCloseResetKey) return;
    lastMarketCloseResetKey = resetKey;

    const history = getOptionTradeHistory();
    const nowIso = date.toISOString();
    let historyChanged = false;

    history.forEach(trade => {
        if (trade.status !== 'Open') return;
        const segment = String(trade.segment || 'INDEX').toUpperCase();
        if (!closedSegments.includes(segment)) return;

        trade.status = 'Market Closed';
        trade.closedAt = nowIso;
        trade.updatedAt = nowIso;
        trade.pnl = getPaperPnl(trade);
        trade.pnlPercent = getPaperPnlPercent(trade);
        historyChanged = true;
    });

    if (historyChanged) saveOptionTradeHistory(sortOptionTradeHistory(history));

    const activeSignals = getActiveOptionSignals();
    const remainingSignals = activeSignals
        .filter(signal => !closedSegments.includes(String(signal.segment || 'INDEX').toUpperCase()));
    saveActiveOptionSignals(remainingSignals);
    if (historyChanged || remainingSignals.length !== activeSignals.length) {
        renderOptionTradeHistory();
        renderActiveOptionSignals();
    }
}

function getMarketClosedReason(segment) {
    const key = String(segment || 'INDEX').toUpperCase();
    const hours = getMarketHoursForSegment(key);
    return `${key} market closed (${hours.open}-${hours.close} IST)`;
}

function filterOpenMarketTargets(targets) {
    return (targets || []).filter(target => {
        if (isMarketOpenForSegment(target.segment)) return true;
        recordAutoScanSkip(target, getMarketClosedReason(target.segment));
        return false;
    });
}

function toggleOptionAutoRefresh() {
    const enabled = document.getElementById('autoRefreshToggle')?.checked;
    if (enabled) startOptionAutoRefresh();
    else if (optionDataInterval) {
        clearInterval(optionDataInterval);
        optionDataInterval = null;
    }
}

function startOptionAutoRefresh() {
    if (optionDataInterval) clearInterval(optionDataInterval);
    const enabled = document.getElementById('autoRefreshToggle')?.checked;
    if (!enabled) return;

    optionDataInterval = setInterval(
        refreshOptionsForSelectedExpiry,
        Config.optionScanner.autoRefreshSeconds * 1000
    );
}

function startMarketWideAutoScan() {
    stopMarketWideAutoScan();
    autoScanState.enabled = Config.autoScanner.enabled;
    updateMarketScannerControls();

    if (!autoScanState.enabled) {
        updateMarketScannerStatus('Paused');
        return;
    }

    runMarketWideScan(true);
    marketWideScanInterval = setInterval(
        runMarketWideScan,
        Config.autoScanner.scanIntervalSeconds * 1000
    );
}

function stopMarketWideAutoScan() {
    if (marketWideScanInterval) {
        clearInterval(marketWideScanInterval);
        marketWideScanInterval = null;
    }
}

function toggleMarketWideScan() {
    autoScanState.enabled = !autoScanState.enabled;
    Config.autoScanner.enabled = autoScanState.enabled;
    Config.saveConfig();
    updateMarketScannerControls();

    if (autoScanState.enabled) {
        startMarketWideAutoScan();
    } else {
        stopMarketWideAutoScan();
        updateMarketScannerStatus('Paused');
    }
}

async function runMarketWideScan(force = false) {
    if (!force && (!autoScanState.enabled || autoScanState.running)) return;
    if (autoScanState.running) return;
    resetClosedMarketsTradeState();

    autoScanState.running = true;
    updateMarketScannerStatus('Preparing scan...');

    const foundSignals = [];
    let scannedCount = 0;
    autoScanState.skipReasons = [];

    try {
        const targets = filterOpenMarketTargets(await getMarketScanTargets());
        const marketMood = getMarketMood();
        renderMarketMood(marketMood);
        updateText('marketScanCount', String(targets.length));

        for (const target of targets) {
            updateMarketScannerStatus(`Scanning ${target.symbol}...`);
            const evaluation = await scanAutoTarget(target);
            scannedCount += 1;

            if (evaluation?.best) {
                const signal = {
                    ...evaluation.best,
                    expiryDate: evaluation.expiryDate || target.expiryDate || '',
                    source: getTargetSourceLabel(target),
                    segment: target.segment
                };

                const tradeBlocked = shouldBlockNewOptionSignal(signal);
                const blockedByMood = shouldHideByMarketMood(signal, target, marketMood);
                if (blockedByMood) {
                    AngelOneAPI.log(`Market mood filter skipped ${signal.symbol} ${signal.side}: ${blockedByMood}`);
                }
                if (tradeBlocked) {
                    AngelOneAPI.log(`Auto scanner skipped ${signal.symbol}: one open call is already active for this stock.`);
                }

                if (!tradeBlocked && (isTradeAlertAction(signal.action) || Config.autoScanner.includeWatchSignals)) {
                    foundSignals.push(signal);
                    addActiveOptionSignal(signal);
                }
                if (!tradeBlocked && isTradeAlertAction(signal.action)) {
                    const telegramSent = await TelegramNotifier.sendOptionSignal(signal);
                    registerOptionTrade(signal, { telegramSent });
                }
            }

            if (!isDemoMode) {
                await delay(Config.autoScanner.delayBetweenSymbolsMs);
            }
        }

        foundSignals.sort((a, b) => b.score - a.score);
        renderMarketScanResults(foundSignals, scannedCount);
        updateMarketScannerStatus(getMarketScanStatusSummary(foundSignals.length, scannedCount));
        updateText('marketScanLastRun', new Date().toLocaleTimeString());
    } catch (error) {
        updateMarketScannerStatus(`Scan error: ${error.message}`);
        AngelOneAPI.log(`Auto scanner error: ${error.message}`);
    } finally {
        autoScanState.running = false;
    }
}

function getMarketScanStatusSummary(foundCount, scannedCount) {
    if (foundCount) return `Found ${foundCount} setup(s)`;
    const scope = document.getElementById('autoScanScope')?.value || Config.autoScanner.scope || 'SELECTED';
    if (scope === 'COMMODITIES') return `Scanned ${scannedCount} commodities. No setup.`;
    if (scope === 'STOCKS') return `Scanned ${scannedCount} stocks. No setup.`;
    return scannedCount ? `Scanned ${scannedCount} symbol(s). No setup.` : 'No symbols scanned';
}

function getNoSetupStatus(scannedCount) {
    const commodityReasons = (autoScanState.skipReasons || [])
        .filter(item => item.segment === 'COMMODITY')
        .slice(-3)
        .map(item => `${item.symbol}: ${item.reason}`);

    if (commodityReasons.length) {
        if (commodityReasons.every(reason => reason.includes('fallback while Angel One historical rate limit'))) {
            return 'Commodity scan running on fallback indicators until Angel One historical rate limit clears.';
        }
        return `No commodity setup. ${commodityReasons.join(' | ')}`;
    }

    const stockReasons = (autoScanState.skipReasons || [])
        .filter(item => item.segment === 'STOCK')
        .slice(-3)
        .map(item => `${item.symbol}: ${item.reason}`);

    if (stockReasons.length) {
        return `No stock setup. ${stockReasons.join(' | ')}`;
    }

    return scannedCount ? 'No confirmed setup' : 'No symbols scanned';
}

async function getMarketScanTargets() {
    const selectedExpiryDate = getSelectedExpiryDate();
    const scope = document.getElementById('autoScanScope')?.value || Config.autoScanner.scope || 'SELECTED';
    Config.autoScanner.scope = scope;
    Config.saveConfig();

    if (scope === 'SELECTED') {
        const selected = await resolveScannerTarget(getCurrentScanner());
        const selectedExpiry = selected.segment === 'COMMODITY'
            ? selected.expiryDate || selectedExpiryDate || ''
            : selectedExpiryDate || selected.expiryDate || getUpcomingExpiriesForSymbol(selected.symbol, 1)[0] || '';
        return [{
            segment: selected.segment,
            symbol: selected.symbol,
            token: selected.token,
            exchange: selected.exchange || getIndexExchange(selected.symbol) || 'NSE',
            expiryDate: selectedExpiry
        }].filter(target => target.token);
    }

    const indexTargets = Object.keys(Config.indices).map(symbol => ({
        segment: 'INDEX',
        symbol,
        token: Config.indices[symbol],
        exchange: getIndexExchange(symbol),
        expiryDate: getUpcomingExpiriesForSymbol(symbol, 1)[0] || selectedExpiryDate || ''
    }));

    if (isDemoMode && scope === 'COMMODITIES') {
        return (Config.autoScanner.commoditySymbols || Config.commodityOption.symbols || [])
            .map(symbol => ({
                segment: 'COMMODITY',
                symbol,
                token: `DEMO-${symbol}`,
                exchange: 'MCX',
                expiryDate: getUpcomingExpiriesForSymbol(symbol, 1)[0] || selectedExpiryDate || ''
            }));
    }
    if (isDemoMode && scope === 'STOCKS') {
        return (Config.autoScanner.stockSymbols || [])
            .slice(0, 20)
            .map(symbol => ({
                segment: 'STOCK',
                symbol,
                token: `DEMO-${symbol}`,
                exchange: 'NSE',
                expiryDate: getUpcomingStockOptionExpiries(1)[0] || selectedExpiryDate || ''
            }));
    }
    if (isDemoMode && scope === 'INDICES') return indexTargets;
    if (isDemoMode) {
        const demoStocks = (Config.autoScanner.stockSymbols || [])
            .slice(0, 20)
            .map(symbol => ({
                segment: 'STOCK',
                symbol,
                token: `DEMO-${symbol}`,
                exchange: 'NSE',
                expiryDate: getUpcomingStockOptionExpiries(1)[0] || selectedExpiryDate || ''
            }));
        return [...indexTargets, ...demoStocks];
    }
    if (scope === 'COMMODITIES') return getAutoCommodityTargets();
    if (scope === 'STOCKS') return getAutoStockTargets();

    const stockTargets = await getAutoStockTargets();
    const commodityTargets = Config.autoScanner.includeCommodities
        ? await getAutoCommodityTargets()
        : [];
    return [...indexTargets, ...stockTargets, ...commodityTargets];
}

async function resolveScannerTarget(scanner) {
    if (!scanner || scanner.token || scanner.segment === 'INDEX') return scanner;
    if (isDemoMode && scanner.segment === 'COMMODITY') {
        return { ...scanner, token: `DEMO-${scanner.symbol}`, exchange: 'MCX' };
    }

    if (scanner.segment === 'STOCK') {
        const symbol = String(scanner.symbol || '').trim().toUpperCase();
        if (!symbol || symbol === 'STOCK') return scanner;

        updateMarketScannerStatus(`Resolving ${symbol} stock token...`);
        const response = await AngelOneAPI.resolveInstruments([symbol], 'STOCK');
        const resolved = (response?.data || []).find(item => item.found && item.token);
        if (resolved) {
            AngelOneAPI.log(`Resolved ${symbol} stock token ${resolved.token}; option expiry ${resolved.expiryDate || 'not found'}.`);
            return {
                ...scanner,
                token: resolved.token,
                exchange: resolved.exchange || scanner.exchange || 'NSE',
                expiryDate: resolved.expiryDate || scanner.expiryDate || ''
            };
        }

        AngelOneAPI.log(`Stock token could not be auto-resolved for ${symbol}. Enter the Angel One equity token manually.`);
        return scanner;
    }

    if (scanner.segment === 'COMMODITY') {
        const resolved = await resolveCommodityTargets([scanner.symbol]);
        return resolved[0] || scanner;
    }

    return scanner;
}

async function getAutoStockTargets() {
    const manualSymbol = document.getElementById('stockSymbol')?.value.trim().toUpperCase();
    const manualToken = document.getElementById('stockToken')?.value.trim();
    const symbols = Config.autoScanner.useAllFnoStocks ? ['*'] : [...new Set([
        ...(manualSymbol && manualToken ? [manualSymbol] : []),
        ...(Config.autoScanner.stockSymbols || [])
    ])];

    if (!symbols.length) return [];

    if (!autoScanState.resolvedStocks.length) {
        updateMarketScannerStatus(manualSymbol
            ? `Resolving stock tokens, including ${manualSymbol}...`
            : 'Resolving all F&O stock tokens...');
        const response = await AngelOneAPI.resolveInstruments(symbols);
        const resolved = response?.data || [];
        autoScanState.resolvedStocks = resolved.filter(item => item.found && item.token && item.expiryDate);
        const stockExpiry = getUpcomingStockOptionExpiries(1)[0] || '';
        autoScanState.resolvedStocks = autoScanState.resolvedStocks.map(item => ({
            ...item,
            expiryDate: stockExpiry || item.expiryDate
        }));

        if (manualSymbol && manualToken && !autoScanState.resolvedStocks.some(item => item.symbol === manualSymbol)) {
            autoScanState.resolvedStocks.unshift({
                symbol: manualSymbol,
                token: manualToken,
                exchange: 'NSE',
                expiryDate: stockExpiry || document.getElementById('expirySelector')?.value || ''
            });
        }

        AngelOneAPI.log(`Auto scanner resolved ${autoScanState.resolvedStocks.length} stock option symbol(s). It will scan stocks automatically without a manual stock name.`);
        if (!autoScanState.resolvedStocks.length) {
            const sample = resolved.slice(0, 5).map(item => `${item.symbol}: token=${item.token || 'no'}, expiry=${item.expiryDate || 'no'}, options=${item.optionCount || 0}`).join(' | ');
            AngelOneAPI.log(`Stock resolver found no scan-ready stocks. ${sample || AngelOneAPI.lastError || 'No resolver data returned.'}`);
        }
    }

    const maxStocks = Math.max(0, Number(Config.autoScanner.maxStocksPerCycle || 0));
    if (!maxStocks || autoScanState.resolvedStocks.length <= maxStocks) {
        return autoScanState.resolvedStocks.map(toStockTarget);
    }

    const selected = [];
    for (let i = 0; i < maxStocks; i++) {
        const index = (autoScanState.stockCursor + i) % autoScanState.resolvedStocks.length;
        selected.push(autoScanState.resolvedStocks[index]);
    }
    autoScanState.stockCursor = (autoScanState.stockCursor + maxStocks) % autoScanState.resolvedStocks.length;
    return selected.map(toStockTarget);
}

function toStockTarget(item) {
    return {
        segment: 'STOCK',
        symbol: item.symbol,
        token: item.token,
        exchange: item.exchange || 'NSE',
        expiryDate: item.expiryDate
    };
}

async function getAutoCommodityTargets() {
    const symbols = Config.autoScanner.commoditySymbols?.length
        ? Config.autoScanner.commoditySymbols
        : Config.commodityOption.symbols || [];
    const resolved = await resolveCommodityTargets(symbols);
    const maxCommodities = Math.max(0, Number(Config.autoScanner.maxCommoditiesPerCycle || 0));

    if (!maxCommodities || resolved.length <= maxCommodities) return resolved;

    const selected = [];
    for (let i = 0; i < maxCommodities; i++) {
        const index = (autoScanState.commodityCursor + i) % resolved.length;
        selected.push(resolved[index]);
    }
    autoScanState.commodityCursor = (autoScanState.commodityCursor + maxCommodities) % resolved.length;
    return selected;
}

async function resolveCommodityTargets(symbols) {
    const requested = [...new Set((symbols || []).map(symbol => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
    if (!requested.length) return [];

    const cachedMatches = autoScanState.resolvedCommodities
        .filter(item => requested.includes(item.symbol));
    if (cachedMatches.length === requested.length) {
        return cachedMatches.map(toCommodityTarget);
    }

    updateMarketScannerStatus('Resolving commodity tokens...');
    const response = await AngelOneAPI.resolveInstruments(requested, 'COMMODITY');
    const resolved = (response?.data || []).filter(item => item.found && item.token && item.expiryDate);

    resolved.forEach(item => {
        const existingIndex = autoScanState.resolvedCommodities.findIndex(saved => saved.symbol === item.symbol);
        if (existingIndex >= 0) autoScanState.resolvedCommodities[existingIndex] = item;
        else autoScanState.resolvedCommodities.push(item);
    });

    AngelOneAPI.log(`Auto scanner resolved ${resolved.length} commodity option symbol(s).`);
    return resolved.map(toCommodityTarget);
}

function toCommodityTarget(item) {
    return {
        segment: 'COMMODITY',
        symbol: item.symbol,
        token: item.token,
        exchange: item.exchange || 'MCX',
        expiryDate: item.expiryDate,
        optionExchange: item.optionExchange || 'MCX'
    };
}

function getTargetSourceLabel(target) {
    if (target.segment === 'INDEX') return 'Index option';
    if (target.segment === 'COMMODITY') return 'Commodity option';
    return 'Stock option';
}

function getMarketMood() {
    const symbols = ['NIFTY', 'BANKNIFTY'];
    const biases = symbols.map(symbol => ({
        symbol,
        bias: OptionSignalEngine.getUnderlyingBias(latestIndicatorsBySymbol[symbol] || {})
    }));
    const bullish = biases.reduce((total, item) => total + (item.bias.direction === 'BULLISH' ? item.bias.strength : 0), 0);
    const bearish = biases.reduce((total, item) => total + (item.bias.direction === 'BEARISH' ? item.bias.strength : 0), 0);
    const direction = bullish > bearish + 10
        ? 'BULLISH'
        : bearish > bullish + 10
            ? 'BEARISH'
            : 'NEUTRAL';

    return {
        direction,
        strength: Math.min(Math.max(bullish, bearish), 100),
        biases
    };
}

function shouldHideByMarketMood(signal, target, marketMood) {
    const settings = Config.autoScanner.marketMoodFilter || {};
    if (settings.enabled === false || target.segment !== 'STOCK' || !signal || !marketMood) return '';

    const score = Number(signal.score || 0);
    const minimumScore = Number(settings.minScoreAgainstMood || 72);
    if (score >= minimumScore) return '';

    if (marketMood.direction === 'BEARISH' && signal.side === 'CALL') {
        return `bearish NIFTY/BANKNIFTY mood and score below ${minimumScore}%`;
    }
    if (marketMood.direction === 'BULLISH' && signal.side === 'PUT') {
        return `bullish NIFTY/BANKNIFTY mood and score below ${minimumScore}%`;
    }

    return '';
}

function renderMarketMood(marketMood) {
    const status = document.getElementById('marketMoodStatus');
    if (!status || !marketMood) return;

    status.textContent = `${marketMood.direction} ${marketMood.strength}%`;
    status.className = marketMood.direction === 'BULLISH'
        ? 'mood-bullish'
        : marketMood.direction === 'BEARISH'
            ? 'mood-bearish'
            : 'mood-neutral';
}

async function scanAutoTarget(target) {
    if (!isMarketOpenForSegment(target.segment)) {
        const reason = getMarketClosedReason(target.segment);
        AngelOneAPI.log(`Auto scanner skipped ${target.symbol}: ${reason}.`);
        recordAutoScanSkip(target, reason);
        return null;
    }

    const timeframe = document.getElementById('timeframeSelector')?.value || 'FIVE_MINUTE';

    const spot = await getAutoSpotPrice(target);
    if (!spot) {
        const reason = 'spot price not available';
        AngelOneAPI.log(`Auto scanner skipped ${target.symbol}: ${reason}.`);
        recordAutoScanSkip(target, reason);
        return null;
    }

    const hasIndicators = await ensureAutoIndicators(target, timeframe);
    if (!hasIndicators) {
        recordAutoScanSkip(target, formatIndicatorUnavailableReason(target, timeframe));
        return null;
    }

    const optionsData = isDemoMode
        ? buildDemoOptionsChain(target.symbol, spot)
        : await AngelOneAPI.getOptionsChain(target, target.expiryDate, spot);

    const chain = optionsData?.data || optionsData;
    if (!hasOptionChainRows(chain)) {
        const reason = formatOptionChainEmptyMessage(chain, target.expiryDate);
        AngelOneAPI.log(`Auto scanner skipped ${target.symbol}: ${reason}`);
        recordAutoScanSkip(target, reason);
        return null;
    }

    const evaluation = OptionSignalEngine.evaluateChain(
        target.symbol,
        chain,
        latestIndicatorsBySymbol[target.symbol] || {},
        spot,
        { timeframe }
    );
    evaluation.expiryDate = chain.expiryDate || target.expiryDate;
    evaluation.rows.forEach(row => {
        row.call.expiryDate = evaluation.expiryDate;
        row.put.expiryDate = evaluation.expiryDate;
    });
    if (evaluation.best) evaluation.best.expiryDate = evaluation.expiryDate;
    updateOptionTradeHistoryFromEvaluation(evaluation);
    if (!evaluation.best) {
        recordAutoScanSkip(target, 'option scores below WATCH/BUY filter');
    }
    return evaluation;
}

function recordAutoScanSkip(target, reason) {
    autoScanState.skipReasons.push({
        segment: target.segment,
        symbol: target.symbol,
        reason
    });

    if (autoScanState.skipReasons.length > 50) {
        autoScanState.skipReasons = autoScanState.skipReasons.slice(-50);
    }
}

async function ensureAutoIndicators(target, timeframe) {
    const lastLoaded = latestIndicatorTimesBySymbol[target.symbol] || 0;
    const maxAge = Number(Config.autoScanner.indicatorRefreshSeconds || 120) * 1000;

    if (latestIndicatorsBySymbol[target.symbol] && Date.now() - lastLoaded < maxAge) {
        return true;
    }

    if (latestIndicatorsBySymbol[target.symbol]
        && Date.now() < Number(AngelOneAPI.historicalRateLimitedUntil || 0)) {
        return true;
    }

    if (isDemoMode) {
        if (latestIndicatorsBySymbol[target.symbol]) return true;
        const spot = latestPricesBySymbol[target.symbol] || 0;
        if (!spot) return false;
        const drift = getFallbackDriftForSymbol(target.symbol);
        const candles = buildDemoCandles(spot * 0.96, drift);
        const lastCandle = candles.at(-1);
        const adjustment = spot - Number(lastCandle?.[4] || spot);
        candles.forEach(candle => {
            candle[1] = Math.max(0.05, Number(candle[1]) + adjustment);
            candle[2] = Math.max(candle[1], Number(candle[2]) + adjustment);
            candle[3] = Math.max(0.05, Number(candle[3]) + adjustment);
            candle[4] = Math.max(0.05, Number(candle[4]) + adjustment);
        });
        latestIndicatorsBySymbol[target.symbol] = calculateIndicatorsFromCandles(candles);
        latestIndicatorTimesBySymbol[target.symbol] = Date.now();
        return Boolean(latestIndicatorsBySymbol[target.symbol]);
    }

    const updated = await updateIndicatorsForSymbol(target.symbol, target.token, timeframe, target.exchange || 'NSE', false);
    if (updated || latestIndicatorsBySymbol[target.symbol]) return true;

    if (target.segment === 'COMMODITY' && AngelOneAPI.isHistoricalRateLimit(AngelOneAPI.lastError)) {
        return seedFallbackIndicatorsForTarget(target);
    }

    return false;
}

function formatIndicatorUnavailableReason(target, timeframe) {
    if (target.segment === 'COMMODITY' && AngelOneAPI.isHistoricalRateLimit(AngelOneAPI.lastError)) {
        return 'using fallback while Angel One historical rate limit cools down';
    }
    return `indicator data unavailable (${AngelOneAPI.lastError || timeframe})`;
}

function seedFallbackIndicatorsForTarget(target) {
    const spot = Number(latestPricesBySymbol[target.symbol] || getFallbackSpotForSymbol(target.symbol) || 0);
    if (!Number.isFinite(spot) || spot <= 0) return false;

    const drift = getFallbackDriftForSymbol(target.symbol);
    const candles = buildDemoCandles(spot * 0.96, drift);
    const lastCandle = candles.at(-1);
    const adjustment = spot - Number(lastCandle?.[4] || spot);
    candles.forEach(candle => {
        candle[1] = Math.max(0.05, Number(candle[1]) + adjustment);
        candle[2] = Math.max(candle[1], Number(candle[2]) + adjustment);
        candle[3] = Math.max(0.05, Number(candle[3]) + adjustment);
        candle[4] = Math.max(0.05, Number(candle[4]) + adjustment);
    });

    latestIndicatorsBySymbol[target.symbol] = calculateIndicatorsFromCandles(candles);
    latestIndicatorTimesBySymbol[target.symbol] = Date.now();
    latestPricesBySymbol[target.symbol] = spot;
    AngelOneAPI.log(`Using fallback ${target.symbol} indicators until Angel One historical rate limit clears.`);
    return true;
}

function getFallbackSpotForSymbol(symbol) {
    return {
        CRUDEOIL: 6200,
        NATURALGAS: 225,
        GOLD: 70500,
        GOLDM: 70500,
        SILVER: 81000,
        SILVERM: 81000,
        COPPER: 820,
        ZINC: 260,
        ALUMINIUM: 240
    }[String(symbol || '').toUpperCase()] || 1000;
}

function getFallbackDriftForSymbol(symbol) {
    return {
        CRUDEOIL: 3.8,
        NATURALGAS: 0.35,
        GOLD: 8.5,
        GOLDM: 8.5,
        SILVER: -4.2,
        SILVERM: -4.2,
        COPPER: 0.7,
        ZINC: 0.25,
        ALUMINIUM: 0.22
    }[String(symbol || '').toUpperCase()] || 1.2;
}

function shouldShowCommodityWatchSignal(signal, target) {
    return target.segment === 'COMMODITY'
        && Config.autoScanner.includeCommodityWatchSignals !== false
        && String(signal?.action || '').startsWith('WATCH');
}

async function getAutoSpotPrice(target) {
    if (isDemoMode) {
        if (latestPricesBySymbol[target.symbol]) return latestPricesBySymbol[target.symbol];
        const demoStockPrices = {
            RELIANCE: 1420, HDFCBANK: 1680, ICICIBANK: 1280, SBIN: 810,
            AXISBANK: 1150, INFY: 1520, TCS: 3750, LT: 3650,
            KOTAKBANK: 1850, BHARTIARTL: 1560, ITC: 460, TATAMOTORS: 980,
            MARUTI: 12500, SUNPHARMA: 1780, TATASTEEL: 165, ADANIENT: 2350,
            BAJFINANCE: 7200, HINDUNILVR: 2450, POWERGRID: 310, NTPC: 360,
            NIFTY: 25200, BANKNIFTY: 56400, SENSEX: 83200
        };
        const price = demoStockPrices[target.symbol] || latestPricesBySymbol.NIFTY || 25000;
        latestPricesBySymbol[target.symbol] = price;
        return price;
    }

    const response = await AngelOneAPI.getLTP({ [target.exchange || 'NSE']: [target.token] });
    const rows = response?.data || [];
    const row = Array.isArray(rows) ? rows[0] : Object.values(rows)[0];
    const ltp = Number(row?.ltp ?? row?.lastPrice ?? row?.close ?? 0);

    if (Number.isFinite(ltp) && ltp > 0) {
        const changeInfo = extractChangeInfo(row, ltp, target.symbol);
        latestPricesBySymbol[target.symbol] = ltp;
        latestMarketQuoteTimesBySymbol[target.symbol] = Date.now();
        if (target.segment === 'INDEX') {
            updateIndexCard(target.symbol, ltp, changeInfo);
        }
        return ltp;
    }

    return latestPricesBySymbol[target.symbol] || 0;
}

function renderMarketScanResults(signals, scannedCount) {
    const container = document.getElementById('marketScanResults');
    if (!container) return;

    container.innerHTML = '';

    if (!signals.length) {
        const reasons = getCompactSkipReasons();
        container.innerHTML = `
            <div class="no-signals">
                Scanned ${scannedCount} symbol(s). No BUY/WATCH/BTST setup matched the filters.
                ${reasons ? `<span class="table-note">${escapeHtml(reasons)}</span>` : ''}
            </div>
        `;
        return;
    }

    const topSignals = getTopOptionSignals(signals, 5);
    topSignals.forEach(signal => {
        container.appendChild(createOptionSignalCard(signal));
    });
}

function getCompactSkipReasons() {
    return (autoScanState.skipReasons || [])
        .slice(-5)
        .map(item => `${item.symbol}: ${item.reason}`)
        .join(' | ');
}

function getTopOptionSignals(signals, limit = 5) {
    return getAllDisplaySignals(signals)
        .sort((a, b) => {
            const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
            if (scoreDiff) return scoreDiff;
            return Number(b.option?.volume || 0) - Number(a.option?.volume || 0);
        })
        .slice(0, limit);
}

function getAllDisplaySignals(signals) {
    const result = [];
    const seen = new Set();
    const sources = ['Stock option', 'Commodity option', 'Index option', 'Selected scanner'];

    sources.forEach(source => {
        const match = signals.find(signal => signal.source === source);
        if (match) {
            result.push(match);
            seen.add(getOptionSignalKey(match));
        }
    });

    signals.forEach(signal => {
        const key = getOptionSignalKey(signal);
        if (!seen.has(key)) {
            result.push(signal);
            seen.add(key);
        }
    });

    return result;
}

function getActiveOptionSignals() {
    try {
        const saved = JSON.parse(localStorage.getItem(activeOptionSignalsStorageKey) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function saveActiveOptionSignals(signals) {
    localStorage.setItem(activeOptionSignalsStorageKey, JSON.stringify(signals.slice(0, maxActiveOptionSignals)));
}

function saveActiveOptionSignal(signal) {
    if (!signal) return;
    const key = getOptionSignalKey(signal);
    const saved = getActiveOptionSignals().filter(item => getOptionSignalKey(item) !== key);
    saveActiveOptionSignals([
        { ...signal, savedAt: new Date().toISOString() },
        ...saved
    ]);
}

function getActiveOptionSignals() {
    try {
        const saved = JSON.parse(localStorage.getItem(activeOptionSignalsStorageKey) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function saveActiveOptionSignals(signals) {
    localStorage.setItem(activeOptionSignalsStorageKey, JSON.stringify(signals.slice(0, maxActiveOptionSignals)));
}

function saveActiveOptionSignal(signal) {
    if (!signal) return;
    const key = getOptionSignalKey(signal);
    const saved = getActiveOptionSignals().filter(item => getOptionSignalKey(item) !== key);
    saveActiveOptionSignals([
        {
            ...signal,
            savedAt: new Date().toISOString()
        },
        ...saved
    ]);
}

function clearActiveOptionSignals() {
    localStorage.removeItem(activeOptionSignalsStorageKey);
    const container = document.getElementById('signalsContainer');
    if (container) {
        container.innerHTML = '<div class="no-signals">Waiting for confirmed signals...</div>';
    }
}

function removeActiveOptionSignalsForSymbol(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    if (!normalized) return;

    const savedSignals = getActiveOptionSignals()
        .filter(signal => String(signal.symbol || '').toUpperCase() !== normalized);
    saveActiveOptionSignals(savedSignals);

    const container = document.getElementById('signalsContainer');
    if (!container) return;

    [...container.children].forEach(child => {
        const signalKey = String(child.dataset?.signalKey || '').toUpperCase();
        if (signalKey.startsWith(`${normalized}|`)) child.remove();
    });

    if (!container.children.length) {
        container.innerHTML = '<div class="no-signals">Waiting for confirmed signals...</div>';
    }
}

function getOpenOptionTradeForSymbol(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    if (!normalized) return null;
    const historyTrade = getOptionTradeHistory().find(trade =>
        trade.status === 'Open'
        && String(trade.symbol || '').toUpperCase() === normalized
    );
    if (historyTrade) return historyTrade;
    return null;
}

function shouldBlockNewOptionSignal(signal) {
    if (!signal || !isTradeAlertAction(signal.action)) return false;
    if (Config.tradeLock?.enabled === false) return false;

    // FIX: Block ALL calls for same symbol until current call closes
    // Previously only blocked same strike+side, allowing duplicate calls
    const openTrade = getOpenOptionTradeForSymbol(signal.symbol);
    if (!openTrade) return false;

    const sameCall = Number(openTrade.strike) === Number(signal.strike)
        && String(openTrade.side || '').toUpperCase() === String(signal.side || '').toUpperCase();

    if (sameCall) return 'same-open-call';

    // Block different strike for same symbol - one call at a time!
    return 'symbol-already-active';
}

function runDailyReset() {
    const dailyResetKey = 'dailyResetLastRun';
    const todayKey = getIndiaDateKey(new Date());
    const lastRunKey = localStorage.getItem(dailyResetKey);

    if (todayKey === lastRunKey) return;

    AngelOneAPI.log('New trading day detected. Clearing yesterday-s transient state.');
    TelegramNotifier.clearAllMemory();
    clearActiveOptionSignals();

    // FIX: Reset OHLC and price history for new day
    Object.keys(indexOHLC).forEach(k => delete indexOHLC[k]);
    Object.keys(indexPriceHistory).forEach(k => delete indexPriceHistory[k]);
    Object.keys(latestDayOpenBySymbol).forEach(k => delete latestDayOpenBySymbol[k]);

    const history = getOptionTradeHistory();
    history.forEach(trade => {
        if (trade.status === 'Open') trade.status = 'Market Closed';
    });
    saveOptionTradeHistory(sortOptionTradeHistory(history));
    renderOptionTradeHistory();

    localStorage.setItem(dailyResetKey, todayKey);
}

function getOpenStrikesForSymbol(symbol) {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    if (!normalizedSymbol) return [];
    return getOptionTradeHistory()
        .filter(trade => trade.status === 'Open' && String(trade.symbol || '').toUpperCase() === normalizedSymbol)
        .map(trade => Number(trade.strike || 0))
        .filter(strike => Number.isFinite(strike) && strike > 0);
}

function loadActiveOptionSignals() {
    renderActiveOptionSignals(getActiveOptionSignals());
    refreshOpenOptionWebSocketSubscription();
}

function renderActiveOptionSignals(signals = getActiveOptionSignals()) {
    const container = document.getElementById('signalsContainer');
    if (container) {
        container.innerHTML = '<div class="no-signals">Waiting for confirmed signals...</div>';
    }

    signals
        .slice(0, maxActiveOptionSignals)
        .reverse()
        .forEach(signal => addActiveOptionSignal(signal, { persist: false }));
    refreshOpenOptionWebSocketSubscription();
}

function addActiveOptionSignal(signal, options = {}) {
    const container = document.getElementById('signalsContainer');
    if (!container) return;

    if (options.enforceLock !== false && shouldBlockNewOptionSignal(signal)) return;

    const noSignals = container.querySelector('.no-signals');
    if (noSignals) noSignals.remove();

    const key = getOptionSignalKey(signal);
    [...container.children].forEach(child => {
        if (child.dataset?.signalKey === key) child.remove();
    });

    const card = createOptionSignalCard(signal);
    card.dataset.signalKey = key;
    container.insertBefore(card, container.firstChild);
    if (options.persist !== false) {
        saveActiveOptionSignal(signal);
        refreshOpenOptionWebSocketSubscription();
    }

    while (container.children.length > maxActiveOptionSignals) {
        container.removeChild(container.lastChild);
    }
}

function createOptionSignalCard(signal) {
    const card = document.createElement('div');
    const signalClass = getOptionSignalClass(signal.action).replace('signal-', '');
    const isTrade = signalClass === 'buy' || signalClass === 'btst';
    card.className = `signal-card ${signalClass}`;
    card.dataset.optionSignalToken = signal.option?.token || '';
    const risk = signal.risk || {};
    const blockers = (signal.buyBlockers || signal.warnings || [])
        .filter(Boolean)
        .map(formatSignalBlockerText)
        .slice(0, 3);

    card.innerHTML = `
        <h4>${escapeHtml(signal.action)} ${escapeHtml(signal.symbol)} ${escapeHtml(signal.strike)} ${escapeHtml(signal.side)}</h4>
        <div class="signal-details">
            <strong>Source:</strong> ${escapeHtml(signal.source || 'Auto scan')}<br>
            <strong>Expiry:</strong> ${escapeHtml(signal.expiryDate || '--')}<br>
            <strong>Score:</strong> ${Number(signal.score || 0)}% |
            <strong>LTP:</strong> <span data-live-signal-ltp>${OptionSignalEngine.formatMoney(getLiveOptionLtp(signal.option))}</span><br>
            <strong>SL:</strong> ${OptionSignalEngine.formatMoney(risk.stopLoss)}
            ${risk.optionSupport ? `<strong>Option Support:</strong> ${OptionSignalEngine.formatMoney(risk.optionSupport)}` : ''}
            <strong>Lot Size:</strong> ${escapeHtml(formatOptionLotSize(signal))}
            <strong>T1:</strong> ${OptionSignalEngine.formatMoney(risk.target1)}
            <strong>T2:</strong> ${OptionSignalEngine.formatMoney(risk.target2)}
            ${!isTrade && blockers.length ? `<br><strong>Buy abhi confirm nahi:</strong> ${escapeHtml(blockers.join(' | '))}` : ''}
        </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'signal-card-actions';

    const sendButton = document.createElement('button');
    sendButton.type = 'button';
    sendButton.className = 'btn btn-small';
    sendButton.textContent = 'Send Telegram';

    const sendStatus = document.createElement('span');
    sendStatus.className = 'signal-send-status';

    sendButton.addEventListener('click', async () => {
        sendButton.disabled = true;
        sendButton.textContent = 'Sending...';
        sendStatus.textContent = '';

        const sent = await TelegramNotifier.sendOptionSignal(signal, {
            manual: true,
            bypassDuplicate: true,
            bypassCooldown: true,
            bypassScore: true,
            allowWatch: true
        });

        if (sent) {
            sendButton.disabled = false;
            sendButton.textContent = 'Send Again';
            sendStatus.textContent = 'Telegram sent';
            if (isTrade) {
                registerOptionTrade(signal, { telegramSent: true, sentManually: true });
            }
            return;
        }

        sendButton.disabled = false;
        sendButton.textContent = 'Send Telegram';
        sendStatus.textContent = TelegramNotifier.lastSendError || 'Check Telegram settings';
    });

    actions.appendChild(sendButton);
    actions.appendChild(sendStatus);
    card.appendChild(actions);

    return card;
}

function formatSignalBlockerText(reason) {
    const text = String(reason || '');
    const normalized = text.toLowerCase();

    if (normalized.includes('ict bias is not confirmed')) {
        return 'ICT bias confirm nahi hua';
    }
    if (normalized.includes('ict structure/liquidity is not clear')) {
        return 'Structure/liquidity clear nahi hai';
    }
    if (normalized.includes('underlying direction is not aligned')) {
        return 'Market direction align nahi hai';
    }
    if (normalized.includes('reward/risk')) {
        return text.replace('Reward/risk', 'Risk-reward');
    }
    if (normalized.includes('option price is falling')) {
        return 'Option price gir raha hai';
    }
    if (normalized.includes('opposite option side is stronger')) {
        return 'Opposite side strong hai';
    }
    if (normalized.includes('bid-ask spread is too wide')) {
        return 'Spread zyada wide hai';
    }
    if (normalized.includes('greeks/expiry risk filter failed')) {
        return 'Greeks/expiry risk pass nahi hua';
    }

    return text;
}

function getOptionSignalKey(signal) {
    return [
        signal.symbol || '',
        signal.expiryDate || '',
        signal.strike || '',
        signal.side || '',
        signal.action || ''
    ].join('|');
}

function updateMarketScannerControls() {
    const toggle = document.getElementById('marketScanToggle');
    if (toggle) toggle.textContent = autoScanState.enabled ? 'Pause' : 'Resume';
}

function updateMarketScannerStatus(message) {
    updateText('marketScanStatus', message);
}

function loadAutoScannerForm() {
    const scope = document.getElementById('autoScanScope');
    if (scope) scope.value = Config.autoScanner.scope || 'SELECTED';
}

function loadOptionTableSize() {
    const savedSize = localStorage.getItem('optionTableSize') || 'normal';
    const selector = document.getElementById('optionTableSize');
    if (selector) selector.value = ['compact', 'normal', 'large'].includes(savedSize) ? savedSize : 'normal';
    applyOptionTableSize(selector?.value || savedSize);
}

function changeOptionTableSize() {
    const size = document.getElementById('optionTableSize')?.value || 'normal';
    localStorage.setItem('optionTableSize', size);
    applyOptionTableSize(size);
}

function applyOptionTableSize(size) {
    const table = document.getElementById('optionChainTableWrap');
    if (!table) return;
    table.classList.remove('table-compact', 'table-normal', 'table-large');
    table.classList.add(`table-${['compact', 'normal', 'large'].includes(size) ? size : 'normal'}`);
}

function setOptionChainTableOpen(isOpen) {
    const table = document.getElementById('optionChainTableWrap');
    const toggle = document.getElementById('optionChainTableToggle');
    const arrow = document.getElementById('optionChainTableArrow');
    if (!table) return;

    table.classList.toggle('hidden', !isOpen);
    if (toggle) toggle.setAttribute('aria-expanded', String(isOpen));
    if (arrow) arrow.textContent = isOpen ? '-' : '+';
}

function toggleOptionChainTable() {
    const table = document.getElementById('optionChainTableWrap');
    if (!table) return;
    setOptionChainTableOpen(table.classList.contains('hidden'));
}

function toggleTelegramSettings() {
    const panel = document.getElementById('telegramSettingsPanel');
    const arrow = document.getElementById('telegramSettingsArrow');
    if (!panel) return;

    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    if (arrow) arrow.textContent = willOpen ? '▾' : '▸';
}

function changeAutoScanScope() {
    const scope = document.getElementById('autoScanScope')?.value || 'SELECTED';
    Config.autoScanner.scope = scope;
    Config.saveConfig();
    autoScanState.resolvedStocks = [];
    autoScanState.resolvedCommodities = [];
    autoScanState.stockCursor = 0;
    autoScanState.commodityCursor = 0;
    runMarketWideScan(true);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function disconnectAPI() {
    stopMarketDataUpdates();
    await AngelOneAPI.disconnect();

    setStatus('Disconnected', false);
    document.getElementById('configPanel').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
    SignalGenerator.clearSignals();
}

function seedDemoData() {
    const spots = {
        NIFTY: 22480,
        BANKNIFTY: 48760,
        SENSEX: 74120,
        FINNIFTY: 21440,
        MIDCPNIFTY: 12140,
        CRUDEOIL: 6420,
        NATURALGAS: 238,
        GOLD: 71350,
        SILVER: 82300,
        COPPER: 842
    };

    // FIX: Set proper previous close for each symbol
    const previousClose = {
        NIFTY: 22350,
        BANKNIFTY: 48900,
        SENSEX: 73950,
        FINNIFTY: 21380,
        MIDCPNIFTY: 12200,
        CRUDEOIL: 6350,
        NATURALGAS: 232,
        GOLD: 71100,
        SILVER: 82600,
        COPPER: 835
    };

    Object.entries(spots).forEach(([symbol, spot]) => {
        const prevClose = previousClose[symbol] || spot;
        latestPricesBySymbol[symbol] = spot;
        latestReferenceCloseBySymbol[symbol] = prevClose;
        latestDayOpenBySymbol[symbol] = prevClose + 10; // Slight gap open
        updateIndexCard(symbol, spot, makeChangeInfoFromPreviousClose(spot, prevClose));
    });

    seedDemoIndicators();
    refreshDisplayedIndicators();
    refreshOptionsForSelectedExpiry();
}

function seedDemoIndicators() {
    const demoConfig = {
        NIFTY: { start: 21700, drift: 7.5 },
        BANKNIFTY: { start: 47800, drift: -4.5 },
        SENSEX: { start: 73000, drift: 6.2 },
        FINNIFTY: { start: 21100, drift: 3.5 },
        MIDCPNIFTY: { start: 11900, drift: -1.8 },
        CRUDEOIL: { start: 6200, drift: 3.8 },
        NATURALGAS: { start: 225, drift: 0.35 },
        GOLD: { start: 70500, drift: 8.5 },
        SILVER: { start: 81000, drift: -4.2 },
        COPPER: { start: 820, drift: 0.7 }
    };

    Object.entries(demoConfig).forEach(([symbol, config]) => {
        const candles = buildDemoCandles(config.start, config.drift);
        latestIndicatorsBySymbol[symbol] = calculateIndicatorsFromCandles(candles);
        latestIndicatorTimesBySymbol[symbol] = Date.now();
        const close = Number(candles.at(-1)[4]);
        latestPricesBySymbol[symbol] = close;
        // FIX: Change is from previous day close (config.start), not from last candle
        const previousClose = latestReferenceCloseBySymbol[symbol] || config.start;
        updateIndexCard(symbol, close, makeChangeInfoFromPreviousClose(close, previousClose));
        const signal = SignalGenerator.generateSignal(symbol, close, latestIndicatorsBySymbol[symbol]);
        updateIndexSignal(symbol, signal.signal);
    });
}

function buildDemoCandles(start, drift) {
    const candles = [];
    let close = start;

    for (let i = 0; i < 90; i++) {
        const wave = Math.sin(i / 5) * 18;
        const noise = Math.cos(i / 3) * 9;
        const open = close;
        close = Math.max(10, close + drift + wave * 0.08 + noise * 0.05);
        const high = Math.max(open, close) + 22 + Math.abs(wave);
        const low = Math.min(open, close) - 22 - Math.abs(noise);
        candles.push([formatApiDate(new Date(Date.now() - (90 - i) * 86400000)), open, high, low, close, 100000 + i * 1200]);
    }

    return candles;
}

function buildDemoOptionsChain(symbol, spot) {
    const step = OptionSignalEngine.getStrikeStep(symbol);
    const atm = OptionSignalEngine.roundToStrike(spot, step);
    const calls = {};
    const puts = {};

    for (let i = -8; i <= 8; i++) {
        const strike = atm + (i * step);
        const callIntrinsic = Math.max(spot - strike, 0);
        const putIntrinsic = Math.max(strike - spot, 0);
        const timeValue = Math.max(18, 140 - Math.abs(i) * 13);
        const trendBoost = latestIndicatorsBySymbol[symbol]?.EMA?.short > latestIndicatorsBySymbol[symbol]?.EMA?.long ? 12 : -8;

        const lotSize = Config.optionScanner.stockLotSizes[symbol] || 1;
        calls[strike] = {
            ltp: Math.max(1, callIntrinsic + timeValue + trendBoost),
            change: i <= 2 ? 7 + trendBoost * 0.2 : -3,
            volume: 5000 - Math.abs(i) * 220,
            bid: Math.max(1, callIntrinsic + timeValue + trendBoost - 1.8),
            ask: Math.max(1, callIntrinsic + timeValue + trendBoost + 2.2),
            lotSize
        };
        puts[strike] = {
            ltp: Math.max(1, putIntrinsic + timeValue - trendBoost),
            change: i >= -2 ? -4 - trendBoost * 0.15 : 5,
            volume: 4700 - Math.abs(i) * 240,
            bid: Math.max(1, putIntrinsic + timeValue - trendBoost - 2.1),
            ask: Math.max(1, putIntrinsic + timeValue - trendBoost + 2.4),
            lotSize
        };
    }

    return { spotPrice: spot, calls, puts };
}
