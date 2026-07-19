const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');

if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

const DEFAULT_PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
let currentPort = DEFAULT_PORT;
const ROOT = __dirname;
const ANGEL_BASE = 'https://apiconnect.angelbroking.com';
const ANGEL_WS_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const INSTRUMENT_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const INSTRUMENT_CACHE_FILE = path.join(ROOT, '.cache', 'OpenAPIScripMaster.json');
const USERS_FILE = path.join(ROOT, '.cache', 'users.json');
const CREDENTIALS_FILE = path.join(ROOT, '.cache', 'credentials.json');

let instrumentCache = {
    loadedAt: 0,
    data: []
};

let instrumentRefreshInFlight = null;
let instrumentRefreshScheduled = false;

let instrumentIndexCache = {
    source: null,
    dateKey: '',
    index: null
};

let publicIpCache = {
    loadedAt: 0,
    value: ''
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
    try {
        if (req.url.startsWith('/api/')) {
            await handleApi(req, res);
            return;
        }

        serveStatic(req, res);
    } catch (error) {
        sendJson(res, 500, {
            status: false,
            message: error.message || 'Internal server error'
        });
    }
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && currentPort < DEFAULT_PORT + 10) {
        currentPort += 1;
        console.log(`Port ${currentPort - 1} is busy. Trying http://localhost:${currentPort}`);
        server.listen(currentPort, HOST);
        return;
    }

    throw error;
});

server.on('upgrade', (req, socket) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname !== '/api/ws-feed') {
            socket.destroy();
            return;
        }

        handleLocalWebSocketUpgrade(req, socket);
    } catch (error) {
        socket.destroy();
    }
});

server.listen(currentPort, HOST, () => {
    printServerUrls(currentPort);
    startKeepAlive();
});

function printServerUrls(port) {
    console.log(`Options Signal Scanner running at http://localhost:${port}`);

    const lanUrls = getLanUrls(port);
    if (lanUrls.length) {
        console.log('Mobile/LAN URL(s):');
        lanUrls.forEach(url => console.log(`  ${url}`));
        console.log('Use a phone on the same Wi-Fi network and keep this server window open.');
    }
}

// ==================== KEEP ALIVE (Prevent Render Sleep) ====================
function startKeepAlive() {
    // Only activate on deployed server (not localhost)
    const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '';
    if (!appUrl) {
        console.log('Keep-Alive: Skipped (localhost mode)');
        return;
    }

    const pingUrl = `${appUrl}/api/health`;
    const INTERVAL = 10 * 60 * 1000; // 10 minutes

    console.log(`Keep-Alive: Active - pinging ${pingUrl} every 10 minutes`);

    setInterval(async () => {
        try {
            const response = await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
            const data = await response.json().catch(() => ({}));
            console.log(`Keep-Alive ping: ${data.status ? 'OK' : 'responded'} @ ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        } catch (error) {
            console.log(`Keep-Alive ping failed: ${error.message}`);
        }
    }, INTERVAL);

    // First ping after 30 seconds
    setTimeout(async () => {
        try {
            await fetch(pingUrl, { signal: AbortSignal.timeout(10000) });
        } catch (e) {}
    }, 30000);
}

function getLanUrls(port) {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter(address => address && address.family === 'IPv4' && !address.internal)
        .map(address => `http://${address.address}:${port}`);
}

async function handleApi(req, res) {
    if (req.method === 'OPTIONS') {
        sendNoContent(res);
        return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
        sendJson(res, 200, { status: true, message: 'OK' });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/auth/check-login-required') {
        const loginRequired = getAppSetting('loginRequired', true);
        sendJson(res, 200, { loginRequired });
        return;
    }

    // Auth routes (allow before POST check for flexibility)
    if (req.method === 'POST' && req.url === '/api/auth/signup') {
        const body = await readJson(req);
        const result = await handleAuthSignup(body);
        sendJson(res, result.success ? 200 : 400, result);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/auth/login') {
        const body = await readJson(req);
        body._clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const result = await handleAuthLogin(body);
        sendJson(res, result.success ? 200 : 401, result);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/auth/change-password') {
        const body = await readJson(req);
        const result = await handleChangePassword(body);
        sendJson(res, result.success ? 200 : 400, result);
        return;
    }

    // Admin routes
    if (req.method === 'POST' && req.url.startsWith('/api/admin/')) {
        const body = await readJson(req);
        const result = await handleAdminRoute(req.url, body);
        sendJson(res, result.success ? 200 : 403, result);
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { status: false, message: 'Method not allowed' });
        return;
    }

    const body = await readJson(req);

    if (req.url === '/api/login') {
        const data = await angelRequest('/rest/auth/angelbroking/user/v1/loginByPassword', {
            apiKey: body.apiKey,
            publicIp: body.publicIp,
            timeoutMs: 20000,
            method: 'POST',
            body: {
                clientcode: body.clientId,
                password: body.password,
                totp: body.totp || ''
            }
        });
        sendJson(res, 200, data);
        return;
    }

    if (req.url === '/api/logout') {
        const data = await angelRequest('/rest/secure/angelbroking/user/v1/logout', {
            apiKey: body.apiKey,
            jwtToken: body.jwtToken,
            publicIp: body.publicIp,
            timeoutMs: 12000,
            method: 'POST',
            body: { clientcode: body.clientId }
        });
        sendJson(res, 200, data);
        return;
    }

    if (req.url === '/api/market-data') {
        const data = await angelRequest('/rest/secure/angelbroking/market/v1/quote/', {
            apiKey: body.apiKey,
            jwtToken: body.jwtToken,
            publicIp: body.publicIp,
            timeoutMs: 22000,
            method: 'POST',
            body: {
                mode: body.mode || 'LTP',
                exchangeTokens: body.exchangeTokens || {}
            }
        });
        sendJson(res, 200, data);
        return;
    }

    if (req.url === '/api/historical') {
        const data = await angelRequest('/rest/secure/angelbroking/historical/v1/getCandleData', {
            apiKey: body.apiKey,
            jwtToken: body.jwtToken,
            publicIp: body.publicIp,
            timeoutMs: 20000,
            method: 'POST',
            body: {
                exchange: body.exchange || 'NSE',
                symboltoken: String(body.symboltoken || ''),
                interval: body.interval,
                fromdate: body.fromdate,
                todate: body.todate
            }
        });
        sendJson(res, 200, data);
        return;
    }

    if (req.url === '/api/options-chain') {
        const data = await buildOptionsChain(body);
        sendJson(res, 200, { status: true, data });
        return;
    }

    if (req.url === '/api/option-expiries') {
        const data = await getOptionExpiries(body.symbol || 'NIFTY', body.segment || 'INDEX');
        sendJson(res, 200, { status: true, data });
        return;
    }

    if (req.url === '/api/instruments') {
        const data = await getInstrumentMaster();
        sendJson(res, 200, { status: true, count: data.length });
        return;
    }

    if (req.url === '/api/resolve-instruments') {
        const data = await resolveInstruments(body.symbols || [], body.segment || 'STOCK');
        sendJson(res, 200, { status: true, data });
        return;
    }

    if (req.url === '/api/telegram-send') {
        const data = await sendTelegramMessage(body);
        sendJson(res, data.ok ? 200 : 400, data);
        return;
    }

    if (req.url === '/api/credentials/save') {
        const creds = {
            apiKey: body.apiKey || '',
            apiSecret: body.apiSecret || '',
            clientId: body.clientId || '',
            totpSecret: body.totpSecret || '',
            publicIp: body.publicIp || '',
            savedAt: new Date().toISOString()
        };
        try {
            fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
            sendJson(res, 200, { success: true, message: 'Credentials saved on server' });
        } catch (e) {
            sendJson(res, 500, { success: false, message: 'Failed to save: ' + e.message });
        }
        return;
    }

    if (req.method === 'GET' && req.url === '/api/credentials/load') {
        try {
            if (fs.existsSync(CREDENTIALS_FILE)) {
                const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
                sendJson(res, 200, { success: true, data });
            } else {
                sendJson(res, 200, { success: false, message: 'No saved credentials' });
            }
        } catch (e) {
            sendJson(res, 500, { success: false, message: 'Failed to load: ' + e.message });
        }
        return;
    }

    sendJson(res, 404, { status: false, message: 'API route not found' });
}

async function sendTelegramMessage(body = {}) {
    const botToken = String(body.botToken || '').trim();
    const chatId = String(body.chat_id || body.chatId || '').trim();
    const text = String(body.text || '').trim();
    const relayUrl = String(body.relayUrl || '').trim();

    if (!botToken || !chatId || !text) {
        return {
            ok: false,
            description: 'Bot token, chat ID, and message text are required.'
        };
    }

    const payload = {
        chat_id: chatId,
        text,
        parse_mode: body.parse_mode || 'HTML',
        disable_web_page_preview: body.disable_web_page_preview !== false
    };
    let lastReason = '';

    if (relayUrl) {
        const relayResult = await sendTelegramViaRelay(relayUrl, botToken, payload);
        if (relayResult.ok) return relayResult;
        lastReason = relayResult.description || '';
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(25000)
            });
            const data = await response.json().catch(() => ({}));
            return {
                ok: Boolean(data.ok),
                description: data.description || (response.ok ? '' : `Telegram HTTP ${response.status}`),
                result: data.result || null
            };
        } catch (error) {
            lastReason = error.name === 'TimeoutError'
                ? 'Telegram request timed out'
                : error.cause?.code || error.message;

            if (attempt < 3 && /UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|request timed out/i.test(lastReason)) {
                await wait(700 * attempt);
                continue;
            }

            break;
        }
    }

    const fallbackResult = await sendTelegramWithDnsFallback(botToken, payload);
    if (fallbackResult.ok) return fallbackResult;

    return {
        ok: false,
        description: fallbackResult.description || `Telegram request failed: ${lastReason}`
    };
}

async function sendTelegramViaRelay(relayUrl, botToken, payload) {
    if (!/^https?:\/\//i.test(relayUrl)) {
        return {
            ok: false,
            description: 'Telegram relay URL must start with http:// or https://.'
        };
    }

    try {
        const response = await fetch(relayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                botToken,
                chatId: payload.chat_id,
                chat_id: payload.chat_id,
                text: payload.text,
                parse_mode: payload.parse_mode,
                disable_web_page_preview: payload.disable_web_page_preview
            }),
            signal: AbortSignal.timeout(25000)
        });
        const data = await response.json().catch(() => ({}));

        return {
            ok: Boolean(response.ok && (data.ok !== false)),
            description: data.description || data.message || (response.ok ? '' : `Relay HTTP ${response.status}`),
            result: data.result || null
        };
    } catch (error) {
        return {
            ok: false,
            description: `Telegram relay failed: ${error.name === 'TimeoutError' ? 'Relay timed out' : error.message}`
        };
    }
}

async function sendTelegramWithDnsFallback(botToken, payload) {
    try {
        const ips = await resolveTelegramApiIps();
        let lastReason = '';

        for (const ip of ips) {
            try {
                const data = await postTelegramViaIp(ip, botToken, payload);
                return {
                    ok: Boolean(data.ok),
                    description: data.description || '',
                    result: data.result || null
                };
            } catch (error) {
                lastReason = error.code || error.message;
            }
        }

        return {
            ok: false,
            description: lastReason ? `Telegram DNS fallback failed: ${lastReason}` : 'Telegram DNS fallback found no usable IP.'
        };
    } catch (error) {
        return {
            ok: false,
            description: `Telegram DNS fallback failed: ${error.code || error.message}`
        };
    }
}

async function resolveTelegramApiIps() {
    const dohUrl = 'https://cloudflare-dns.com/dns-query?name=api.telegram.org&type=A';
    const data = await httpsGetJson(dohUrl, {
        Accept: 'application/dns-json'
    });

    return (data.Answer || [])
        .filter(item => item.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(item.data || ''))
        .map(item => item.data)
        .slice(0, 4);
}

function postTelegramViaIp(ip, botToken, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = https.request({
            host: ip,
            servername: 'api.telegram.org',
            method: 'POST',
            path: `/bot${botToken}/sendMessage`,
            timeout: 25000,
            headers: {
                Host: 'api.telegram.org',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                raw += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(raw || '{}'));
                } catch (error) {
                    reject(new Error(`Invalid Telegram response HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('Telegram DNS fallback timed out')));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function httpsGetJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            timeout: 10000,
            headers
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                raw += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(raw || '{}'));
                } catch (error) {
                    reject(new Error(`Invalid DNS response HTTP ${res.statusCode}`));
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('DNS fallback timed out')));
        req.on('error', reject);
    });
}

async function buildOptionsChain(body) {
    const symbol = normalizeSymbol(body.symbol || 'NIFTY');
    const segment = normalizeSymbol(body.segment || 'INDEX');
    const expiry = normalizeExpiry(body.expiryDate);
    const spotPrice = Number(body.spotPrice || 0);
    const strikeStep = Number(body.strikeStep || 50);
    const width = Number(body.width || 5);
    const atmStrike = roundToStrike(spotPrice, strikeStep);
    const wantedStrikes = new Set();

    for (let i = -width; i <= width; i++) {
        wantedStrikes.add(atmStrike + (i * strikeStep));
    }
    (body.extraStrikes || []).forEach(strike => {
        const normalizedStrike = Number(strike || 0);
        if (Number.isFinite(normalizedStrike) && normalizedStrike > 0) {
            wantedStrikes.add(normalizedStrike);
        }
    });

    let symbolOptionRows = [];
    let instrumentError = '';
    let usedSearchFallback = false;

    try {
        const cachedInstruments = await readInstrumentCacheFromDisk();
        if (cachedInstruments.length) {
            symbolOptionRows = findOptionRowsForSymbol(cachedInstruments, symbol, segment);
        } else if (body.jwtToken) {
            instrumentError = 'Instrument master cache is empty; using SearchScrip fallback.';
        } else {
            const instruments = await getInstrumentMaster();
            symbolOptionRows = findOptionRowsForSymbol(instruments, symbol, segment);
        }
    } catch (error) {
        instrumentError = error.message || 'Instrument master unavailable';
    }

    let resolvedExpiry = expiry;
    let resolvedExpiryDate = body.expiryDate || '';
    let matchingOptionRows = symbolOptionRows.filter(item => normalizeExpiry(item.expiry) === expiry);

    if (!matchingOptionRows.length && segment !== 'STOCK') {
        const nearestExpiry = getNearestExpiry(symbolOptionRows);
        if (nearestExpiry) {
            resolvedExpiry = normalizeExpiry(nearestExpiry.raw);
            resolvedExpiryDate = nearestExpiry.iso || nearestExpiry.raw;
            matchingOptionRows = symbolOptionRows.filter(item => normalizeExpiry(item.expiry) === resolvedExpiry);
        }
    }

    let optionRows = matchingOptionRows.filter(item => wantedStrikes.has(normalizeStrike(item.strike, item)));

    if (!optionRows.length && matchingOptionRows.length) {
        const nearestStrikes = getNearestStrikes(matchingOptionRows, spotPrice, width);
        optionRows = matchingOptionRows.filter(item => nearestStrikes.has(normalizeStrike(item.strike, item)));
    }

    if (!optionRows.length && body.jwtToken && body.expiryDate) {
        optionRows = await searchOptionRowsByTradingSymbol({
            apiKey: body.apiKey,
            jwtToken: body.jwtToken,
            publicIp: body.publicIp,
            symbol,
            segment,
            expiryDate: body.expiryDate,
            strikes: [...wantedStrikes]
        });
        matchingOptionRows = optionRows;
        resolvedExpiry = expiry;
        resolvedExpiryDate = body.expiryDate;
        usedSearchFallback = true;
    }

    const tokenInfoByToken = {};
    const exchangeTokens = {};

    optionRows.forEach(item => {
        const token = String(item.token);
        const exchange = item.exch_seg;
        if (!exchangeTokens[exchange]) exchangeTokens[exchange] = [];
        exchangeTokens[exchange].push(token);
        tokenInfoByToken[token] = item;
    });

    const quoteRows = await fetchQuoteBatches({
        apiKey: body.apiKey,
        jwtToken: body.jwtToken,
        publicIp: body.publicIp,
        exchangeTokens,
        mode: 'FULL'
    });

    const calls = {};
    const puts = {};

    quoteRows.forEach(quote => {
        const token = String(quote.symbolToken || quote.symboltoken || quote.token || '');
        const instrument = tokenInfoByToken[token];
        if (!instrument) return;

        const strike = normalizeStrike(instrument.strike, instrument);
        const optionData = normalizeQuote(quote, instrument);
        if (String(instrument.symbol).endsWith('CE')) {
            calls[strike] = optionData;
        } else if (String(instrument.symbol).endsWith('PE')) {
            puts[strike] = optionData;
        }
    });

    return {
        spotPrice,
        calls,
        puts,
        source: usedSearchFallback ? 'angel-one-search-scrip' : 'angel-one-market-data',
        requestedExpiryDate: body.expiryDate || '',
        expiryDate: resolvedExpiryDate,
        expiryRaw: resolvedExpiry,
        availableExpiries: getExpiriesForRows(symbolOptionRows).slice(0, 12),
        matchedExpiryInstruments: matchingOptionRows.length,
        instruments: optionRows.length,
        fetched: quoteRows.length,
        instrumentError,
        usedSearchFallback,
        message: getOptionsChainMessage({
            symbol,
            symbolOptionRows,
            matchingOptionRows,
            optionRows,
            quoteRows,
            resolvedExpiryDate,
            instrumentError,
            usedSearchFallback
        })
    };
}

function getOptionsChainMessage(context) {
    if (context.usedSearchFallback && !context.optionRows.length) {
        return `SearchScrip fallback also found no option tokens for ${context.symbol}. ${context.instrumentError || ''}`.trim();
    }
    if (!context.symbolOptionRows.length && !context.usedSearchFallback) {
        return `No ${context.symbol} option instruments found in Angel One master.`;
    }
    if (!context.matchingOptionRows.length) {
        return `No option instruments found for this expiry. Nearest expiry is ${context.resolvedExpiryDate || 'not available'}.`;
    }
    if (!context.optionRows.length) {
        return 'No nearby strike instruments found around live spot price.';
    }
    if (!context.quoteRows.length) {
        return 'Angel One quote API returned no option quotes for matched tokens.';
    }
    return '';
}

async function searchOptionRowsByTradingSymbol({ apiKey, jwtToken, publicIp, symbol, segment, expiryDate, strikes }) {
    const exchange = getOptionSearchExchange(symbol, segment);
    const expiryCode = formatSearchExpiry(expiryDate);
    if (!exchange || !expiryCode) return [];

    const rows = [];
    const seenTokens = new Set();
    const cleanStrikes = [...new Set(strikes.map(Number).filter(strike => Number.isFinite(strike) && strike > 0))]
        .sort((a, b) => a - b);

    for (const strike of cleanStrikes) {
        for (const side of ['CE', 'PE']) {
            const tradingSymbols = getOptionSearchSymbols(symbol, expiryDate, strike, side, segment);

            for (const tradingSymbol of tradingSymbols) {
                const normalizedSearch = normalizeTradingSymbol(tradingSymbol);
                const searchResult = await searchScrip({
                    apiKey,
                    jwtToken,
                    publicIp,
                    exchange,
                    searchscrip: tradingSymbol
                });
                const matches = Array.isArray(searchResult?.data) ? searchResult.data : [];
                const exactMatch = matches.find(item => normalizeTradingSymbol(item.tradingsymbol) === normalizedSearch)
                    || matches.find(item => normalizeTradingSymbol(item.tradingsymbol).startsWith(normalizedSearch));

                const token = exactMatch?.symboltoken || exactMatch?.symbolToken || exactMatch?.token;
                if (token && !seenTokens.has(String(token))) {
                    seenTokens.add(String(token));
                    rows.push({
                        token: String(token),
                        symbol: exactMatch.tradingsymbol || tradingSymbol,
                        name: symbol,
                        expiry: expiryDate,
                        strike: strike * 100,
                        exch_seg: exactMatch.exchange || exchange,
                        lotsize: exactMatch.lotsize || exactMatch.lotSize || exactMatch.lot_size || '',
                        instrumenttype: segment === 'COMMODITY'
                            ? 'OPTCOM'
                            : segment === 'STOCK'
                                ? 'OPTSTK'
                                : 'OPTIDX'
                    });
                    break;
                }

                await wait(120);
            }
        }
    }

    return rows;
}

function getOptionSearchSymbols(symbol, expiryDate, strike, side, segment = 'INDEX') {
    const strikeText = String(Math.round(strike));
    const standardExpiry = formatSearchExpiry(expiryDate);

    if (segment === 'COMMODITY') {
        return standardExpiry ? [`${symbol}${standardExpiry}${strikeText}${side}`] : [];
    }

    if (symbol === 'SENSEX') {
        const bfoWeeklyExpiry = formatBfoWeeklyExpiry(expiryDate);
        const bfoMonthlyExpiry = formatBfoMonthlyExpiry(expiryDate);
        return [
            bfoWeeklyExpiry ? `${symbol}${bfoWeeklyExpiry}${strikeText}${side}` : '',
            bfoMonthlyExpiry ? `${symbol}${bfoMonthlyExpiry}${strikeText}${side}` : '',
            standardExpiry ? `${symbol}${standardExpiry}${strikeText}${side}` : ''
        ].filter(Boolean);
    }

    return standardExpiry ? [`${symbol}${standardExpiry}${strikeText}${side}`] : [];
}

async function searchScrip({ apiKey, jwtToken, publicIp, exchange, searchscrip }) {
    const response = await angelRequest('/rest/secure/angelbroking/order/v1/searchScrip', {
        apiKey,
        jwtToken,
        publicIp,
        timeoutMs: 8000,
        method: 'POST',
        body: {
            exchange,
            searchscrip
        }
    });

    if (response?.status === false || response?.success === false) {
        return { data: [] };
    }

    return response;
}

function getOptionSearchExchange(symbol, segment = 'INDEX') {
    if (segment === 'COMMODITY') return 'MCX';
    return symbol === 'SENSEX' ? 'BFO' : 'NFO';
}

function formatSearchExpiry(value) {
    const parsed = parseInstrumentExpiry(value);
    if (!parsed) return '';

    const dd = String(parsed.getDate()).padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const yy = String(parsed.getFullYear()).slice(-2);
    return `${dd}${months[parsed.getMonth()]}${yy}`;
}

function formatBfoWeeklyExpiry(value) {
    const parsed = parseInstrumentExpiry(value);
    if (!parsed) return '';

    const yy = String(parsed.getFullYear()).slice(-2);
    const month = String(parsed.getMonth() + 1);
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yy}${month}${dd}`;
}

function formatBfoMonthlyExpiry(value) {
    const parsed = parseInstrumentExpiry(value);
    if (!parsed) return '';

    const yy = String(parsed.getFullYear()).slice(-2);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${yy}${months[parsed.getMonth()]}`;
}

async function fetchQuoteBatches({ apiKey, jwtToken, publicIp, exchangeTokens, mode }) {
    const fetched = [];
    const batches = [];

    Object.entries(exchangeTokens || {}).forEach(([exchange, tokens]) => {
        for (let i = 0; i < tokens.length; i += 50) {
            batches.push({ [exchange]: tokens.slice(i, i + 50) });
        }
    });

    for (const batch of batches) {
        const response = await angelRequest('/rest/secure/angelbroking/market/v1/quote/', {
            apiKey,
            jwtToken,
            publicIp,
            timeoutMs: 15000,
            method: 'POST',
            body: {
                mode,
                exchangeTokens: batch
            }
        });
        if (response?.status === false || response?.success === false) {
            const message = response.message || response.error || response.errorCode || 'Angel One quote request failed';
            const code = response.errorcode || response.errorCode;
            throw new Error(code ? `${message} (${code})` : message);
        }
        const rows = response?.data?.fetched || [];
        fetched.push(...rows);
        await wait(550);
    }

    return fetched;
}

async function getInstrumentMaster() {
    const cacheAgeMs = Date.now() - instrumentCache.loadedAt;
    if (instrumentCache.data.length && cacheAgeMs < 6 * 60 * 60 * 1000) {
        return instrumentCache.data;
    }

    const diskCache = await readInstrumentCacheFromDisk();
    if (diskCache.length) {
        if (Date.now() - instrumentCache.loadedAt >= 24 * 60 * 60 * 1000) {
            scheduleInstrumentMasterRefresh();
        }
        return diskCache;
    }

    return downloadInstrumentMaster();
}

function scheduleInstrumentMasterRefresh() {
    if (instrumentRefreshScheduled || instrumentRefreshInFlight) return;
    instrumentRefreshScheduled = true;
    const timer = setTimeout(() => {
        instrumentRefreshScheduled = false;
        refreshInstrumentMasterInBackground();
    }, 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
}

function refreshInstrumentMasterInBackground() {
    if (instrumentRefreshInFlight) return instrumentRefreshInFlight;
    instrumentRefreshInFlight = downloadInstrumentMaster()
        .catch(error => {
            console.warn(`Instrument master background refresh failed: ${error.message}`);
            return instrumentCache.data;
        })
        .finally(() => {
            instrumentRefreshInFlight = null;
        });
    return instrumentRefreshInFlight;
}

async function downloadInstrumentMaster() {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetch(INSTRUMENT_MASTER_URL, { signal: AbortSignal.timeout(60000) });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            instrumentCache = {
                loadedAt: Date.now(),
                data
            };
            writeInstrumentCacheToDisk(data);
            return instrumentCache.data;
        } catch (error) {
            lastError = error;
            await wait(1000 * attempt);
        }
    }

    throw new Error(`Instrument master download failed: ${lastError?.cause?.code || lastError?.message || 'timeout'}`);
}

async function readInstrumentCacheFromDisk() {
    if (instrumentCache.data.length) return instrumentCache.data;

    try {
        const stat = await fs.promises.stat(INSTRUMENT_CACHE_FILE);
        const data = JSON.parse(await fs.promises.readFile(INSTRUMENT_CACHE_FILE, 'utf8'));
        if (Array.isArray(data) && data.length) {
            instrumentCache = {
                loadedAt: stat.mtimeMs,
                data
            };
            return instrumentCache.data;
        }
    } catch (error) {
        return [];
    }

    return [];
}

function writeInstrumentCacheToDisk(data) {
    fs.promises.mkdir(path.dirname(INSTRUMENT_CACHE_FILE), { recursive: true })
        .then(() => fs.promises.writeFile(INSTRUMENT_CACHE_FILE, JSON.stringify(data)))
        .catch(() => {});
}

async function getOptionExpiries(symbol, segment = 'INDEX') {
    const instruments = await getInstrumentMaster();
    const normalizedSegment = normalizeSymbol(segment);
    const optionRows = findOptionRowsForSymbol(instruments, normalizeSymbol(symbol), normalizedSegment);
    const expiries = normalizedSegment === 'STOCK'
        ? getUpcomingStockMonthlyExpiries(8)
        : getExpiriesForRows(optionRows);

    return {
        symbol: normalizeSymbol(symbol),
        segment: normalizedSegment,
        expiries,
        count: expiries.length,
        instruments: optionRows.length
    };
}

function getUpcomingStockMonthlyExpiries(count) {
    const expiries = [];
    const today = startOfToday();

    for (let monthOffset = 0; expiries.length < count && monthOffset < count + 12; monthOffset++) {
        const expiry = getLastWeekdayOfMonth(today.getFullYear(), today.getMonth() + monthOffset, 2);
        if (expiry >= today) {
            expiries.push({
                iso: formatDateIso(expiry),
                raw: formatInstrumentExpiry(expiry),
                exchange: 'NFO'
            });
        }
    }

    return expiries;
}

function getLastWeekdayOfMonth(year, monthIndex, weekday) {
    const date = new Date(year, monthIndex + 1, 0);
    while (date.getDay() !== weekday) {
        date.setDate(date.getDate() - 1);
    }
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatInstrumentExpiry(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${dd}${months[date.getMonth()]}${date.getFullYear()}`;
}

function findOptionRowsForSymbol(instruments, symbol, segment = 'INDEX') {
    const index = getInstrumentIndex(instruments);
    if (segment === 'STOCK') return index.stockOptionsBySymbol.get(symbol) || [];
    if (segment === 'COMMODITY') return index.commodityOptionsBySymbol.get(symbol) || [];
    return index.indexOptionsBySymbol.get(symbol) || [];
}

function getExpiriesForRows(optionRows) {
    const expiryMap = new Map();
    const today = startOfToday();

    optionRows.forEach(item => {
        const raw = String(item.expiry || '').trim();
        const parsed = parseInstrumentExpiry(raw);
        if (!parsed || parsed < today) return;

        const iso = formatDateIso(parsed);
        if (!expiryMap.has(iso)) {
            expiryMap.set(iso, {
                iso,
                raw,
                exchange: item.exch_seg
            });
        }
    });

    return [...expiryMap.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

async function resolveInstruments(symbols, segment = 'STOCK') {
    const instruments = await getInstrumentMaster();
    const index = getInstrumentIndex(instruments);
    const normalizedSegment = normalizeSymbol(segment);
    if (normalizedSegment === 'COMMODITY') {
        return resolveCommodityInstruments(instruments, symbols, index);
    }

    const requestedSymbols = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
    const shouldResolveAll = !requestedSymbols.length || requestedSymbols.includes('*') || requestedSymbols.includes('ALL');
    const symbolsToResolve = shouldResolveAll
        ? index.fnoStockSymbols
        : requestedSymbols.slice(0, 250);

    return symbolsToResolve.map(symbol => {
        const equity = index.equitiesBySymbol.get(symbol) || null;
        const optionRows = index.stockOptionsBySymbol.get(symbol) || [];
        const nearestExpiry = getNearestExpiry(optionRows);
        const stockMonthlyExpiry = getUpcomingStockMonthlyExpiries(1)[0] || null;

        return {
            symbol,
            found: Boolean(equity && (stockMonthlyExpiry || nearestExpiry)),
            token: equity ? String(equity.token || '') : '',
            exchange: equity?.exch_seg || 'NSE',
            expiryDate: stockMonthlyExpiry?.iso || nearestExpiry?.iso || nearestExpiry?.raw || '',
            expiryRaw: stockMonthlyExpiry?.raw || nearestExpiry?.raw || '',
            optionExchange: stockMonthlyExpiry?.exchange || nearestExpiry?.exchange || 'NFO',
            optionCount: optionRows.length
        };
    });
}

function resolveCommodityInstruments(instruments, symbols, index = getInstrumentIndex(instruments)) {
    const requestedSymbols = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
    const shouldResolveAll = !requestedSymbols.length || requestedSymbols.includes('*') || requestedSymbols.includes('ALL');
    const symbolsToResolve = shouldResolveAll
        ? index.commoditySymbols
        : requestedSymbols.slice(0, 100);

    return symbolsToResolve.map(symbol => {
        const future = index.commodityFuturesBySymbol.get(symbol)?.[0] || null;
        const optionRows = index.commodityOptionsBySymbol.get(symbol) || [];
        const nearestExpiry = getNearestExpiry(optionRows);

        return {
            symbol,
            found: Boolean(future && nearestExpiry),
            token: future ? String(future.token || '') : '',
            exchange: future?.exch_seg || 'MCX',
            expiryDate: nearestExpiry?.iso || nearestExpiry?.raw || '',
            expiryRaw: nearestExpiry?.raw || '',
            optionExchange: nearestExpiry?.exchange || 'MCX',
            optionCount: optionRows.length
        };
    });
}

function getInstrumentIndex(instruments) {
    const dateKey = formatDateIso(startOfToday());
    if (instrumentIndexCache.source === instruments
        && instrumentIndexCache.dateKey === dateKey
        && instrumentIndexCache.index) {
        return instrumentIndexCache.index;
    }

    const today = startOfToday();
    const index = {
        stockOptionsBySymbol: new Map(),
        commodityOptionsBySymbol: new Map(),
        indexOptionsBySymbol: new Map(),
        equitiesBySymbol: new Map(),
        commodityFuturesBySymbol: new Map(),
        fnoStockSymbols: [],
        commoditySymbols: []
    };

    const stockSymbols = new Set();
    const commoditySymbols = new Set();

    instruments.forEach(item => {
        const symbol = normalizeSymbol(item.name);
        if (!symbol) return;

        const exchange = String(item.exch_seg || '').toUpperCase();
        const instrumentType = String(item.instrumenttype || '').toUpperCase();
        const tradingSymbol = String(item.symbol || '').toUpperCase();
        const normalizedTradingSymbol = normalizeTradingSymbol(tradingSymbol);

        if (exchange === 'NSE'
            && !index.equitiesBySymbol.has(symbol)
            && (normalizedTradingSymbol === `${symbol}EQ` || tradingSymbol.endsWith('-EQ'))) {
            index.equitiesBySymbol.set(symbol, item);
        }

        if (instrumentType === 'OPTIDX' && ['NFO', 'BFO'].includes(exchange)) {
            addMapItem(index.indexOptionsBySymbol, symbol, item);
            return;
        }

        const expiryDate = parseInstrumentExpiry(item.expiry);
        if (!expiryDate || expiryDate < today) return;

        if (instrumentType === 'OPTSTK' && ['NFO', 'BFO'].includes(exchange)) {
            addMapItem(index.stockOptionsBySymbol, symbol, item);
            stockSymbols.add(symbol);
            return;
        }

        if (exchange === 'MCX' && isOptionInstrument(item)) {
            addMapItem(index.commodityOptionsBySymbol, symbol, item);
            commoditySymbols.add(symbol);
            return;
        }

        if (exchange === 'MCX' && isFutureInstrument(item)) {
            addMapItem(index.commodityFuturesBySymbol, symbol, item);
        }
    });

    index.commodityFuturesBySymbol.forEach((rows, symbol) => {
        index.commodityFuturesBySymbol.set(symbol, rows
            .map(item => ({ item, expiryDate: parseInstrumentExpiry(item.expiry) }))
            .filter(row => row.expiryDate && row.expiryDate >= today)
            .sort((a, b) => a.expiryDate - b.expiryDate)
            .map(row => row.item));
    });

    index.fnoStockSymbols = [...stockSymbols].sort();
    index.commoditySymbols = [...commoditySymbols].sort();

    instrumentIndexCache = {
        source: instruments,
        dateKey,
        index
    };
    return index;
}

function addMapItem(map, key, item) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
}

function getFnoStockSymbols(instruments) {
    const today = startOfToday();
    const symbols = new Set();

    instruments.forEach(item => {
        const expiryDate = parseInstrumentExpiry(item.expiry);
        if (item.instrumenttype === 'OPTSTK'
            && ['NFO', 'BFO'].includes(item.exch_seg)
            && expiryDate
            && expiryDate >= today) {
            const symbol = normalizeSymbol(item.name);
            if (symbol) symbols.add(symbol);
        }
    });

    return [...symbols].sort();
}

function findEquityInstrument(instruments, symbol) {
    const matches = instruments.filter(item => {
        const itemName = normalizeSymbol(item.name);
        const itemSymbol = normalizeTradingSymbol(item.symbol);
        return item.exch_seg === 'NSE'
            && itemName === symbol
            && (itemSymbol === `${symbol}EQ` || String(item.symbol || '').toUpperCase().endsWith('-EQ'));
    });

    return matches.find(item => normalizeTradingSymbol(item.symbol) === `${symbol}EQ`) || matches[0] || null;
}

function findStockOptionRows(instruments, symbol) {
    const today = startOfToday();

    return instruments.filter(item => {
        const itemName = normalizeSymbol(item.name);
        const expiryDate = parseInstrumentExpiry(item.expiry);
        return itemName === symbol
            && item.instrumenttype === 'OPTSTK'
            && ['NFO', 'BFO'].includes(item.exch_seg)
            && expiryDate
            && expiryDate >= today;
    });
}

function getCommoditySymbols(instruments) {
    const today = startOfToday();
    const symbols = new Set();

    instruments.forEach(item => {
        const itemName = normalizeSymbol(item.name);
        const expiryDate = parseInstrumentExpiry(item.expiry);
        if (itemName
            && item.exch_seg === 'MCX'
            && isOptionInstrument(item)
            && expiryDate
            && expiryDate >= today) {
            symbols.add(itemName);
        }
    });

    return [...symbols].sort();
}

function findCommodityOptionRows(instruments, symbol) {
    const today = startOfToday();

    return instruments.filter(item => {
        const itemName = normalizeSymbol(item.name);
        const expiryDate = parseInstrumentExpiry(item.expiry);
        return itemName === symbol
            && item.exch_seg === 'MCX'
            && isOptionInstrument(item)
            && expiryDate
            && expiryDate >= today;
    });
}

function findCommodityFutureInstrument(instruments, symbol) {
    const today = startOfToday();
    const futures = instruments
        .filter(item => {
            const itemName = normalizeSymbol(item.name);
            const expiryDate = parseInstrumentExpiry(item.expiry);
            return itemName === symbol
                && item.exch_seg === 'MCX'
                && isFutureInstrument(item)
                && expiryDate
                && expiryDate >= today;
        })
        .map(item => ({ item, expiryDate: parseInstrumentExpiry(item.expiry) }))
        .sort((a, b) => a.expiryDate - b.expiryDate);

    return futures[0]?.item || null;
}

function isOptionInstrument(item) {
    const type = String(item.instrumenttype || '').toUpperCase();
    const symbol = String(item.symbol || '').toUpperCase();
    return type.startsWith('OPT') || symbol.endsWith('CE') || symbol.endsWith('PE');
}

function isFutureInstrument(item) {
    const type = String(item.instrumenttype || '').toUpperCase();
    const symbol = String(item.symbol || '').toUpperCase();
    return type.startsWith('FUT') || /FUT$/.test(symbol);
}

function getNearestExpiry(optionRows) {
    const expiryMap = new Map();

    optionRows.forEach(item => {
        const raw = String(item.expiry || '').trim();
        const parsed = parseInstrumentExpiry(raw);
        if (!parsed) return;
        const key = formatDateIso(parsed);
        if (!expiryMap.has(key)) {
            expiryMap.set(key, {
                iso: key,
                raw,
                date: parsed,
                exchange: item.exch_seg
            });
        }
    });

    return [...expiryMap.values()].sort((a, b) => a.date - b.date)[0] || null;
}

function getNearestStrikes(optionRows, spotPrice, width) {
    const strikeCount = (Number(width || 5) * 2) + 1;
    const strikes = [...new Set(optionRows.map(item => normalizeStrike(item.strike, item)).filter(Boolean))];

    return new Set(
        strikes
            .sort((a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice))
            .slice(0, strikeCount)
    );
}

async function angelRequest(endpoint, options) {
    let response;
    let lastNetworkReason = '';
    const maxAttempts = Math.max(1, Number(options.retries || 2) + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            response = await fetch(`${ANGEL_BASE}${endpoint}`, {
                method: options.method || 'POST',
                headers: await buildAngelHeaders(options.apiKey, options.jwtToken, options.publicIp),
                body: JSON.stringify(options.body || {}),
                signal: AbortSignal.timeout(options.timeoutMs || 20000)
            });
            break;
        } catch (error) {
            lastNetworkReason = error.name === 'TimeoutError'
                ? 'request timed out'
                : error.cause?.code || error.message;

            if (attempt >= maxAttempts || !isTransientAngelNetworkError(lastNetworkReason)) {
                throw new Error(`Angel One network request failed: ${lastNetworkReason}`);
            }

            await wait(500 * attempt);
        }
    }

    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        data = { status: false, message: text || error.message };
    }

    if (!response.ok && !data.message) {
        data.message = `Angel One request failed (${response.status})`;
    }

    return data;
}

function isTransientAngelNetworkError(reason) {
    return /ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|request timed out/i
        .test(String(reason || ''));
}

async function buildAngelHeaders(apiKey, jwtToken, publicIp) {
    const resolvedPublicIp = publicIp || await getPublicIp();
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': resolvedPublicIp || '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': apiKey || ''
    };

    if (jwtToken) {
        headers.Authorization = normalizeBearer(jwtToken);
    }

    return headers;
}

async function getPublicIp() {
    const cacheAgeMs = Date.now() - publicIpCache.loadedAt;
    if (publicIpCache.value && cacheAgeMs < 30 * 60 * 1000) {
        return publicIpCache.value;
    }

    try {
        const response = await fetch('https://api.ipify.org?format=json', {
            signal: AbortSignal.timeout(2500)
        });
        const data = await response.json();
        publicIpCache = {
            loadedAt: Date.now(),
            value: data.ip || ''
        };
        return publicIpCache.value;
    } catch (error) {
        return '';
    }
}

function normalizeQuote(quote, instrument) {
    const depth = quote.depth || {};
    const bestBuy = Array.isArray(depth.buy) ? depth.buy[0] : null;
    const bestSell = Array.isArray(depth.sell) ? depth.sell[0] : null;
    const lotSize = numberFrom(
        instrument.lotsize
        ?? instrument.lotSize
        ?? instrument.lot_size
        ?? instrument.minlotsize
        ?? instrument.minLotSize
    );

    return {
        token: String(instrument.token),
        tradingSymbol: instrument.symbol,
        exchange: instrument.exch_seg,
        lotSize,
        ltp: numberFrom(quote.ltp ?? quote.lastTradedPrice),
        change: numberFrom(quote.netChange ?? quote.change),
        changePercent: numberFrom(quote.percentChange ?? quote.pChange),
        volume: numberFrom(
            quote.tradeVolume
            ?? quote.volume
            ?? quote.totalTradedVolume
            ?? quote.totalTradeVolume
            ?? quote.totTradedQty
            ?? quote.vtt
        ),
        oi: numberFrom(quote.opnInterest ?? quote.openInterest ?? quote.oi),
        oiChange: numberFrom(quote.changeInOpenInterest ?? quote.oiChange),
        iv: numberFrom(quote.impliedVolatility ?? quote.iv),
        delta: numberFrom(quote.delta ?? quote.greeks?.delta),
        theta: numberFrom(quote.theta ?? quote.greeks?.theta),
        gamma: numberFrom(quote.gamma ?? quote.greeks?.gamma),
        vega: numberFrom(quote.vega ?? quote.greeks?.vega),
        bid: numberFrom(quote.bestFiveData?.[0]?.bidprice ?? bestBuy?.price),
        ask: numberFrom(quote.bestFiveData?.[0]?.askprice ?? bestSell?.price)
    };
}

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const safePath = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Block direct access to admin.html without secret key
    if (safePath === '\\admin.html' || safePath === '/admin.html') {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const key = url.searchParams.get('key');
        if (key !== (process.env.ADMIN_KEY || 'scanner2024')) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath);
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(data);
    });
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1_000_000) {
                req.destroy();
                reject(new Error('Request body too large'));
            }
        });
        req.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    res.end(JSON.stringify(data));
}

function sendNoContent(res) {
    res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    res.end();
}

function normalizeBearer(token) {
    const value = String(token || '').trim();
    return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
}

function normalizeSymbol(symbol) {
    return String(symbol || '').toUpperCase().replace(/\s+/g, '');
}

function normalizeTradingSymbol(symbol) {
    return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeExpiry(value) {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [yyyy, mm, dd] = text.split('-');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        return `${dd}${months[Number(mm) - 1]}${yyyy}`;
    }

    return text.replace(/-/g, '');
}

function normalizeStrike(value, instrument = {}) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    const exchange = String(instrument.exch_seg || '').toUpperCase();
    const divisor = exchange === 'CDS' ? 10000000 : 100;
    return Math.round(number / divisor);
}

function parseInstrumentExpiry(value) {
    const text = normalizeExpiry(value);
    const match = text.match(/^(\d{1,2})([A-Z]{3})(\d{2}|\d{4})$/);
    if (!match) return null;

    const months = {
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11
    };
    const month = months[match[2]];
    if (month === undefined) return null;

    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const date = new Date(year, month, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function formatDateIso(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function roundToStrike(price, step) {
    if (!price || !step) return 0;
    return Math.round(price / step) * step;
}

function numberFrom(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function handleLocalWebSocketUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const accept = crypto
        .createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
    ].join('\r\n'));

    const local = createLocalWsConnection(socket);
    let angel = null;

    local.onMessage = message => {
        let payload;
        try {
            payload = JSON.parse(message);
        } catch (error) {
            local.sendJson({ type: 'error', message: 'Invalid WebSocket JSON payload' });
            return;
        }

        if (payload.type === 'start') {
            if (angel) angel.close();
            angel = createAngelFeedBridge(payload, local);
        } else if (payload.type === 'stop') {
            if (angel) angel.close();
            angel = null;
        }
    };

    local.onClose = () => {
        if (angel) angel.close();
    };
}

function createLocalWsConnection(socket) {
    const state = {
        buffer: Buffer.alloc(0),
        onMessage: null,
        onClose: null,
        closed: false
    };

    socket.on('data', chunk => {
        state.buffer = Buffer.concat([state.buffer, chunk]);
        parseLocalWsFrames(state);
    });

    socket.on('close', () => {
        state.closed = true;
        if (state.onClose) state.onClose();
    });

    socket.on('error', () => {
        state.closed = true;
        if (state.onClose) state.onClose();
    });

    return {
        sendJson(data) {
            if (state.closed || socket.destroyed) return;
            socket.write(encodeLocalWsFrame(JSON.stringify(data)));
        },
        close() {
            state.closed = true;
            if (!socket.destroyed) socket.end();
        },
        get onMessage() {
            return state.onMessage;
        },
        set onMessage(handler) {
            state.onMessage = handler;
        },
        get onClose() {
            return state.onClose;
        },
        set onClose(handler) {
            state.onClose = handler;
        }
    };
}

function parseLocalWsFrames(state) {
    while (state.buffer.length >= 2) {
        const first = state.buffer[0];
        const second = state.buffer[1];
        const opcode = first & 0x0f;
        const masked = (second & 0x80) === 0x80;
        let length = second & 0x7f;
        let offset = 2;

        if (length === 126) {
            if (state.buffer.length < offset + 2) return;
            length = state.buffer.readUInt16BE(offset);
            offset += 2;
        } else if (length === 127) {
            if (state.buffer.length < offset + 8) return;
            const high = state.buffer.readUInt32BE(offset);
            const low = state.buffer.readUInt32BE(offset + 4);
            length = high * 2 ** 32 + low;
            offset += 8;
        }

        const maskLength = masked ? 4 : 0;
        if (state.buffer.length < offset + maskLength + length) return;

        const mask = masked ? state.buffer.slice(offset, offset + 4) : null;
        offset += maskLength;
        const payload = Buffer.from(state.buffer.slice(offset, offset + length));
        state.buffer = state.buffer.slice(offset + length);

        if (masked && mask) {
            for (let i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }

        if (opcode === 0x8) {
            state.closed = true;
            if (state.onClose) state.onClose();
            return;
        }
        if (opcode === 0x1 && state.onMessage) {
            state.onMessage(payload.toString('utf8'));
        }
    }
}

function encodeLocalWsFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const header = [];
    header.push(0x81);

    if (payload.length < 126) {
        header.push(payload.length);
    } else if (payload.length <= 65535) {
        header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
    } else {
        header.push(127, 0, 0, 0, 0);
        header.push((payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff);
    }

    return Buffer.concat([Buffer.from(header), payload]);
}

function createAngelFeedBridge(payload, local) {
    const apiKey = String(payload.apiKey || '').trim();
    const jwtToken = String(payload.jwtToken || '').trim();
    const clientId = String(payload.clientId || '').trim();
    const feedToken = String(payload.feedToken || '').trim();
    const tokenList = buildAngelTokenList(payload.exchangeTokens || {});

    if (!apiKey || !jwtToken || !clientId || !feedToken) {
        local.sendJson({ type: 'error', message: 'Missing WebSocket credentials or feed token' });
        return { close() {} };
    }
    if (!tokenList.length) {
        local.sendJson({ type: 'error', message: 'No tokens available for WebSocket subscription' });
        return { close() {} };
    }
    if (typeof WebSocket !== 'function') {
        local.sendJson({ type: 'error', message: 'This Node runtime does not provide a WebSocket client' });
        return { close() {} };
    }

    let closed = false;
    let heartbeat = null;
    let ws;

    try {
        ws = new WebSocket(ANGEL_WS_URL, [], {
            headers: {
                Authorization: normalizeBearer(jwtToken),
                'x-api-key': apiKey,
                'x-client-code': clientId,
                'x-feed-token': feedToken
            }
        });
    } catch (error) {
        local.sendJson({ type: 'error', message: `Angel WebSocket open failed: ${error.message}` });
        return { close() {} };
    }

    ws.addEventListener('open', () => {
        local.sendJson({ type: 'status', status: 'connected', message: 'Angel One WebSocket connected' });
        ws.send(JSON.stringify({
            correlationID: `codex-${Date.now()}`,
            action: 1,
            params: {
                mode: 1,
                tokenList
            }
        }));

        heartbeat = setInterval(() => {
            if (!closed && ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 25000);
    });

    ws.addEventListener('message', async event => {
        const data = await normalizeWsMessageData(event.data);
        const tick = parseAngelTick(data);
        if (tick) {
            local.sendJson({ type: 'tick', data: tick });
            return;
        }

        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
        if (text && text !== 'pong') {
            local.sendJson({ type: 'info', message: text });
        }
    });

    ws.addEventListener('error', () => {
        local.sendJson({ type: 'error', message: 'Angel One WebSocket error' });
    });

    ws.addEventListener('close', () => {
        if (heartbeat) clearInterval(heartbeat);
        if (!closed) {
            local.sendJson({ type: 'status', status: 'closed', message: 'Angel One WebSocket closed' });
        }
    });

    return {
        close() {
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            try {
                ws.close();
            } catch (error) {
                // Ignore close errors from an already closed socket.
            }
        }
    };
}

function buildAngelTokenList(exchangeTokens) {
    return Object.entries(exchangeTokens || {})
        .map(([exchange, tokens]) => ({
            exchangeType: getAngelExchangeType(exchange),
            tokens: (Array.isArray(tokens) ? tokens : [tokens]).map(String).filter(Boolean)
        }))
        .filter(item => item.exchangeType && item.tokens.length);
}

function getAngelExchangeType(exchange) {
    const key = String(exchange || '').toUpperCase();
    const map = {
        NSE: 1,
        NSE_CM: 1,
        NFO: 2,
        NSE_FO: 2,
        BSE: 3,
        BSE_CM: 3,
        BFO: 4,
        BSE_FO: 4,
        MCX: 5,
        MCX_FO: 5,
        CDS: 13
    };
    return map[key] || null;
}

async function normalizeWsMessageData(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (data && typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
    return data;
}

function parseAngelTick(data) {
    if (!Buffer.isBuffer(data) || data.length < 51) return null;

    const mode = data.readUInt8(0);
    const exchangeType = data.readUInt8(1);
    const token = data
        .slice(2, 27)
        .toString('utf8')
        .replace(/\0/g, '')
        .trim();
    const exchangeTimestamp = readInt64LeSafe(data, 35);
    const ltpRaw = readInt64LeSafe(data, 43);
    const ltp = ltpRaw === null ? null : ltpRaw / 100;

    if (!token || !Number.isFinite(ltp) || ltp <= 0) return null;

    return {
        mode,
        exchangeType,
        token,
        symbolToken: token,
        ltp,
        lastPrice: ltp,
        exchangeTimestamp,
        source: 'angel-one-websocket'
    };
}

function readInt64LeSafe(buffer, offset) {
    if (!Buffer.isBuffer(buffer) || buffer.length < offset + 8) return null;
    const value = buffer.readBigInt64LE(offset);
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

// ==================== USER AUTHENTICATION ====================

const SESSIONS_FILE = path.join(ROOT, '.cache', 'sessions.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@2024#pro';

// JSONBin.io configuration for persistent user storage
const JSONBIN_KEY = process.env.JSONBIN_KEY || '';
const JSONBIN_ID = process.env.JSONBIN_ID || '';
const JSONBIN_API = 'https://api.jsonbin.io/v3';

// In-memory users cache
let usersMemoryCache = null;
let jsonbinSyncInProgress = false;

// ---- JSONBin Functions ----

async function jsonbinRead() {
    if (!JSONBIN_KEY || !JSONBIN_ID) return null;
    try {
        const response = await fetch(`${JSONBIN_API}/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        if (!response.ok) {
            console.log(`JSONBin read failed: HTTP ${response.status}`);
            return null;
        }
        const result = await response.json();
        return result.record || null;
    } catch (error) {
        console.log(`JSONBin read error: ${error.message}`);
        return null;
    }
}

async function jsonbinWrite(data) {
    if (!JSONBIN_KEY || !JSONBIN_ID) return false;
    if (jsonbinSyncInProgress) return false;
    jsonbinSyncInProgress = true;
    try {
        const response = await fetch(`${JSONBIN_API}/b/${JSONBIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_KEY
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            console.log(`JSONBin write failed: HTTP ${response.status}`);
            return false;
        }
        return true;
    } catch (error) {
        console.log(`JSONBin write error: ${error.message}`);
        return false;
    } finally {
        jsonbinSyncInProgress = false;
    }
}

async function syncUsersToJsonBin(users) {
    const data = await jsonbinRead();
    const record = data || { users: [], loginRequired: true };
    record.users = users;
    await jsonbinWrite(record);
}

async function loadUsersFromJsonBin() {
    const data = await jsonbinRead();
    if (data && Array.isArray(data.users) && data.users.length) {
        console.log(`Loaded ${data.users.length} user(s) from JSONBin.`);
        return data.users;
    }
    return null;
}

// ---- User Load/Save with JSONBin ----

function loadUsers() {
    if (usersMemoryCache && usersMemoryCache.length) {
        return usersMemoryCache;
    }

    // Try local file first (fast)
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        const users = JSON.parse(data);
        if (Array.isArray(users) && users.length) {
            usersMemoryCache = users;
            return users;
        }
    } catch (error) {}

    // Seed from env var
    const seedUsers = seedUsersFromEnv();
    if (seedUsers.length) {
        usersMemoryCache = seedUsers;
        saveUsers(seedUsers);
        return seedUsers;
    }
    return [];
}

// Async load from JSONBin on startup
async function initUsersFromJsonBin() {
    const jsonbinUsers = await loadUsersFromJsonBin();
    if (jsonbinUsers && jsonbinUsers.length) {
        usersMemoryCache = jsonbinUsers;
        // Also save to local file for fast reads
        const dir = path.dirname(USERS_FILE);
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(USERS_FILE, JSON.stringify(jsonbinUsers, null, 2));
        } catch (e) {}
        console.log(`Users synced from JSONBin: ${jsonbinUsers.length} user(s)`);
        return;
    }

    // If JSONBin empty, push local/seed users to it
    const localUsers = loadUsers();
    if (localUsers.length) {
        await syncUsersToJsonBin(localUsers);
        console.log(`Pushed ${localUsers.length} local user(s) to JSONBin.`);
    }
}

// Start JSONBin sync on server boot
initUsersFromJsonBin().catch(err => console.log('JSONBin init warning:', err.message));

function loadUsers() {
    // If we have in-memory cache, use that (survives file issues)
    if (usersMemoryCache && usersMemoryCache.length) {
        return usersMemoryCache;
    }

    // Try file
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        const users = JSON.parse(data);
        if (Array.isArray(users) && users.length) {
            usersMemoryCache = users;
            return users;
        }
    } catch (error) {}

    // Seed from env var (for Render.com free tier - persists across restarts)
    const seedUsers = seedUsersFromEnv();
    if (seedUsers.length) {
        usersMemoryCache = seedUsers;
        saveUsers(seedUsers);
        return seedUsers;
    }
    return [];
}

function seedUsersFromEnv() {
    // Format: SEED_USERS=username:password:name:days,username2:password2:name2:days2
    const seed = process.env.SEED_USERS || '';
    if (!seed) return [];

    const users = [];
    seed.split(',').forEach(entry => {
        const parts = entry.trim().split(':');
        const [email, password, name, days] = parts;
        if (!email || !password) return;

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + Number(days || 30));

        users.push({
            id: crypto.randomUUID(),
            name: name || email,
            email: email.toLowerCase().trim(),
            mobile: '',
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString(),
            expiryDate: expiryDate.toISOString(),
            maxLogins: 2,
            disabled: false
        });
    });

    if (users.length) {
        console.log(`Seeded ${users.length} user(s) from SEED_USERS env var.`);
    }
    return users;
}

function saveUsers(users) {
    // Always update memory cache first
    usersMemoryCache = users;

    // Save to local file
    const dir = path.dirname(USERS_FILE);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.log('Warning: Could not write users file, using memory cache.');
    }

    // Sync to JSONBin (async, non-blocking)
    syncUsersToJsonBin(users).catch(err =>
        console.log('JSONBin sync warning:', err.message)
    );
}

function loadSessions() {
    try {
        const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function saveSessions(sessions) {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'options-scanner-salt-2024').digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function isUserExpired(user) {
    if (!user.expiryDate) return false;
    const expiry = new Date(user.expiryDate);
    return expiry < new Date();
}

function getActiveSessions(userId) {
    const sessions = loadSessions();
    const now = Date.now();
    // Sessions are valid for 24 hours
    return sessions.filter(s => s.userId === userId && (now - new Date(s.loginAt).getTime()) < 86400000);
}

function addSession(userId, token, ip) {
    const sessions = loadSessions();
    sessions.push({
        userId,
        token,
        ip: ip || 'unknown',
        loginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
    });
    // Keep only last 500 sessions
    saveSessions(sessions.slice(-500));
}

function removeSessionsByUser(userId) {
    const sessions = loadSessions();
    saveSessions(sessions.filter(s => s.userId !== userId));
}

async function handleAuthSignup(body) {
    // Public signup disabled - only admin can create accounts
    return { success: false, message: 'Signup is disabled. Contact admin on WhatsApp for login access.' };
}

async function handleChangePassword(body) {
    const userId = String(body.userId || '').trim();
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!userId || !oldPassword || !newPassword) {
        return { success: false, message: 'All fields are required' };
    }

    if (newPassword.length < 6) {
        return { success: false, message: 'New password must be at least 6 characters' };
    }

    const users = loadUsers();
    const user = users.find(u => u.id === userId);

    if (!user) {
        return { success: false, message: 'User not found' };
    }

    if (user.passwordHash !== hashPassword(oldPassword)) {
        return { success: false, message: 'Old password is incorrect' };
    }

    user.passwordHash = hashPassword(newPassword);
    saveUsers(users);
    console.log(`Password changed for user: ${user.email}`);

    return { success: true, message: 'Password changed successfully' };
}

async function handleAuthLogin(body) {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
    }

    const users = loadUsers();
    const user = users.find(u =>
        u.email === email || u.mobile === email.replace(/\s+/g, '') || u.name.toLowerCase() === email
    );

    if (!user) {
        return { success: false, message: 'No account found. Contact admin for access.' };
    }

    if (user.passwordHash !== hashPassword(password)) {
        return { success: false, message: 'Incorrect password.' };
    }

    // Check if account is expired
    if (isUserExpired(user)) {
        return { success: false, message: 'Your access has expired. Contact admin to renew.' };
    }

    // Check if account is disabled
    if (user.disabled) {
        return { success: false, message: 'Your account is disabled. Contact admin.' };
    }

    // Check concurrent login limit
    const maxLogins = Number(user.maxLogins || 2);
    const activeSessions = getActiveSessions(user.id);
    if (activeSessions.length >= maxLogins) {
        return { success: false, message: `Maximum ${maxLogins} devices allowed. Already logged in on ${activeSessions.length} device(s).` };
    }

    const token = generateToken();
    const ip = body._clientIp || 'unknown';
    addSession(user.id, token, ip);

    // Update last login
    user.lastLoginAt = new Date().toISOString();
    user.lastLoginIp = ip;
    saveUsers(users);

    console.log(`User logged in: ${user.email} from ${ip}`);

    return {
        success: true,
        message: 'Login successful',
        user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile, expiryDate: user.expiryDate || null },
        token
    };
}

// ==================== ADMIN PANEL ROUTES ====================

function isAdminAuth(body) {
    return String(body.adminPassword || '') === ADMIN_PASSWORD;
}

async function handleAdminRoute(url, body) {
    if (!isAdminAuth(body)) {
        return { success: false, message: 'Invalid admin password' };
    }

    if (url === '/api/admin/users') {
        const users = loadUsers();
        const sessions = loadSessions();
        const now = Date.now();
        return {
            success: true,
            users: users.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                mobile: u.mobile,
                createdAt: u.createdAt,
                expiryDate: u.expiryDate || null,
                expired: isUserExpired(u),
                disabled: u.disabled || false,
                maxLogins: u.maxLogins || 2,
                lastLoginAt: u.lastLoginAt || null,
                lastLoginIp: u.lastLoginIp || null,
                activeSessions: sessions.filter(s => s.userId === u.id && (now - new Date(s.loginAt).getTime()) < 86400000).length
            }))
        };
    }

    if (url === '/api/admin/create-user') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const mobile = String(body.mobile || '').trim();
        const password = String(body.password || '');
        const expiryDays = Number(body.expiryDays || 30);
        const maxLogins = Number(body.maxLogins || 2);

        if (!name || !email || !password) {
            return { success: false, message: 'Name, username, and password are required' };
        }

        const users = loadUsers();
        if (users.find(u => u.email === email)) {
            return { success: false, message: 'Username already exists' };
        }

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiryDays);

        const newUser = {
            id: crypto.randomUUID(),
            name,
            email,
            mobile: mobile.replace(/\s+/g, ''),
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString(),
            expiryDate: expiryDate.toISOString(),
            maxLogins,
            disabled: false
        };

        users.push(newUser);
        saveUsers(users);
        console.log(`Admin created user: ${email} (expires: ${expiryDate.toDateString()})`);

        return { success: true, message: `User ${email} created. Expires in ${expiryDays} days.`, user: newUser };
    }

    if (url === '/api/admin/delete-user') {
        const userId = String(body.userId || '');
        if (!userId) return { success: false, message: 'User ID required' };

        const users = loadUsers();
        const index = users.findIndex(u => u.id === userId);
        if (index === -1) return { success: false, message: 'User not found' };

        const deleted = users.splice(index, 1)[0];
        saveUsers(users);
        removeSessionsByUser(userId);
        console.log(`Admin deleted user: ${deleted.email}`);

        return { success: true, message: `User ${deleted.email} deleted` };
    }

    if (url === '/api/admin/update-user') {
        const userId = String(body.userId || '');
        if (!userId) return { success: false, message: 'User ID required' };

        const users = loadUsers();
        const user = users.find(u => u.id === userId);
        if (!user) return { success: false, message: 'User not found' };

        if (body.expiryDays !== undefined) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + Number(body.expiryDays || 30));
            user.expiryDate = expiryDate.toISOString();
        }
        if (body.maxLogins !== undefined) {
            user.maxLogins = Number(body.maxLogins || 2);
        }
        if (body.disabled !== undefined) {
            user.disabled = Boolean(body.disabled);
        }
        if (body.newPassword) {
            user.passwordHash = hashPassword(body.newPassword);
        }

        saveUsers(users);
        return { success: true, message: `User ${user.email} updated` };
    }

    if (url === '/api/admin/kick-user') {
        const userId = String(body.userId || '');
        if (!userId) return { success: false, message: 'User ID required' };
        removeSessionsByUser(userId);
        return { success: true, message: 'All sessions cleared for user' };
    }

    if (url === '/api/admin/sessions') {
        const sessions = loadSessions();
        const users = loadUsers();
        const now = Date.now();
        const active = sessions
            .filter(s => (now - new Date(s.loginAt).getTime()) < 86400000)
            .map(s => {
                const user = users.find(u => u.id === s.userId);
                return {
                    ...s,
                    userName: user?.name || 'Unknown',
                    userEmail: user?.email || 'Unknown'
                };
            });
        return { success: true, sessions: active, total: active.length };
    }

    if (url === '/api/admin/toggle-login') {
        const enabled = body.enabled !== undefined ? Boolean(body.enabled) : true;
        saveAppSetting('loginRequired', enabled);
        return { success: true, message: `Login requirement ${enabled ? 'ON' : 'OFF'}`, loginRequired: enabled };
    }

    if (url === '/api/admin/settings') {
        return { success: true, loginRequired: getAppSetting('loginRequired', true) };
    }

    return { success: false, message: 'Unknown admin route' };
}

const APP_SETTINGS_FILE = path.join(ROOT, '.cache', 'app-settings.json');

function loadAppSettings() {
    try {
        return JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8'));
    } catch (e) {
        const loginRequired = process.env.LOGIN_REQUIRED !== 'false';
        return { loginRequired };
    }
}

function saveAppSettings(settings) {
    const dir = path.dirname(APP_SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify(settings, null, 2));

    // Also save loginRequired to JSONBin
    jsonbinRead().then(data => {
        if (data) {
            data.loginRequired = settings.loginRequired;
            jsonbinWrite(data);
        }
    }).catch(() => {});
}

function getAppSetting(key, defaultValue) {
    const settings = loadAppSettings();
    return settings[key] !== undefined ? settings[key] : defaultValue;
}

function saveAppSetting(key, value) {
    const settings = loadAppSettings();
    settings[key] = value;
    saveAppSettings(settings);
}
