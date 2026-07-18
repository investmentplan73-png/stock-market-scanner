// Telegram alert helper. Uses Bot API credentials entered by the user.
// Do not hardcode Telegram app api_id/api_hash or bot tokens in source files.
const TelegramNotifier = {
    lastAlertByKey: {},
    lastSkipLogByKey: {},
    lastSendError: '',
    sentSignalsStorageKey: 'telegramSentSignals',
    stockHourlyStorageKey: 'telegramStockOptionHourlySent',

    getSentSignals: function() {
        try {
            return JSON.parse(localStorage.getItem(this.sentSignalsStorageKey) || '{}');
        } catch (error) {
            return {};
        }
    },

    saveSentSignals: function(sentSignals) {
        localStorage.setItem(this.sentSignalsStorageKey, JSON.stringify(sentSignals));
    },

    pruneSentSignals: function(sentSignals = this.getSentSignals()) {
        const windowMinutes = Number(Config.telegram.duplicateWindowMinutes || 180);
        const cutoff = Date.now() - (windowMinutes * 60 * 1000);
        let changed = false;

        Object.entries(sentSignals).forEach(([key, sentAt]) => {
            const sentTime = new Date(sentAt || 0).getTime();
            if (!Number.isFinite(sentTime) || sentTime < cutoff) {
                delete sentSignals[key];
                changed = true;
            }
        });

        if (changed) this.saveSentSignals(sentSignals);
        return sentSignals;
    },

    loadForm: function() {
        const enabled = document.getElementById('telegramEnabled');
        const token = document.getElementById('telegramBotToken');
        const token2 = document.getElementById('telegramBotToken2');
        const chatId = document.getElementById('telegramChatId');
        const chatId2 = document.getElementById('telegramChatId2');
        const relayUrl = document.getElementById('telegramRelayUrl');
        const minScore = document.getElementById('telegramMinScore');

        // Clean up old hardcoded channel values
        const rawChatId = String(Config.telegram.chatId || '').trim();
        const cleanChatId = this.isOldDefaultChannel(rawChatId) ? '' : rawChatId;
        const rawChatId2 = String(Config.telegram.chatId2 || '').trim();

        if (enabled) enabled.checked = Boolean(Config.telegram.enabled);
        if (token) token.value = Config.telegram.botToken || '';
        if (token2) token2.value = Config.telegram.botToken2 || '';
        if (chatId) chatId.value = cleanChatId;
        if (chatId2) chatId2.value = rawChatId2;
        if (relayUrl) relayUrl.value = '';
        if (minScore) minScore.value = Config.telegram.minAlertScore || 76;

        // If old default channel was found, clear it from config too
        if (this.isOldDefaultChannel(rawChatId)) {
            Config.telegram.chatId = '';
            Config.telegram.defaultChatId = '';
            Config.saveConfig();
        }
    },

    isOldDefaultChannel: function(value) {
        const v = String(value || '').trim().toLowerCase();
        return v === '@stockoptionniftycalls' || v === 'stockoptionniftycalls';
    },

    saveFromForm: function() {
        const enabled = document.getElementById('telegramEnabled');
        const token = document.getElementById('telegramBotToken');
        const token2 = document.getElementById('telegramBotToken2');
        const chatId = document.getElementById('telegramChatId');
        const chatId2 = document.getElementById('telegramChatId2');
        const relayUrl = document.getElementById('telegramRelayUrl');
        const minScore = document.getElementById('telegramMinScore');
        const chatIdValue = chatId?.value.trim() || '';
        const chatIdValue2 = chatId2?.value.trim() || '';

        Config.telegram.enabled = Boolean(enabled?.checked);
        Config.telegram.botToken = token?.value.trim() || '';
        Config.telegram.botToken2 = token2?.value.trim() || '';
        Config.telegram.chatId = this.looksLikePhoneNumber(chatIdValue) ? '' : this.normalizeChatDestination(chatIdValue);
        Config.telegram.chatId2 = this.looksLikePhoneNumber(chatIdValue2) ? '' : this.normalizeChatDestination(chatIdValue2);
        Config.telegram.relayUrl = relayUrl?.value.trim() || '';
        Config.telegram.minAlertScore = Number(minScore?.value || 70);
        Config.saveConfig();

        if (chatId && chatIdValue && this.looksLikePhoneNumber(chatIdValue)) {
            chatId.value = '';
            alert('Telegram alerts need a numeric chat ID, not a mobile number. Message your bot first, then use getUpdates or @userinfobot to find the chat ID.');
        }
        if (chatId2 && chatIdValue2 && this.looksLikePhoneNumber(chatIdValue2)) {
            chatId2.value = '';
            alert('Telegram Chat ID 2 looks like a phone number. Please use a numeric chat ID.');
        }

        AngelOneAPI.log('Telegram alert settings saved locally.');
    },

    looksLikePhoneNumber: function(value) {
        return /^\+?\d{10,15}$/.test(String(value || '').replace(/\s+/g, ''));
    },

    normalizeChatDestination: function(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('@') || trimmed.startsWith('-')) return trimmed;
        if (/^\d+$/.test(trimmed)) return trimmed;
        if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(trimmed)) return `@${trimmed}`;
        return trimmed;
    },

    getStockHourlySent: function() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.stockHourlyStorageKey) || '[]');
            return Array.isArray(saved) ? saved : [];
        } catch (error) {
            return [];
        }
    },

    saveStockHourlySent: function(items) {
        localStorage.setItem(this.stockHourlyStorageKey, JSON.stringify(items));
    },

    pruneStockHourlySent: function(items = this.getStockHourlySent()) {
        const windowMs = Number(Config.telegram.stockOptionLimitWindowMinutes || 60) * 60 * 1000;
        const cutoff = Date.now() - windowMs;
        const fresh = items.filter(item => new Date(item.sentAt || item).getTime() >= cutoff);
        if (fresh.length !== items.length) this.saveStockHourlySent(fresh);
        return fresh;
    },

    getStockHourlyLimitStatus: function() {
        const sent = this.pruneStockHourlySent();
        const limit = Number(Config.telegram.stockOptionHourlyLimit || 5);
        return {
            sent: sent.length,
            limit,
            remaining: Math.max(limit - sent.length, 0)
        };
    },

    recordStockAutoSend: function(signal) {
        if (!this.isStockOptionSignal(signal)) return;
        const sent = this.pruneStockHourlySent();
        sent.push({
            key: this.getSignalKey(signal),
            sentAt: new Date().toISOString()
        });
        this.saveStockHourlySent(sent);
    },

    releaseStockAutoSlot: function(signalOrTrade) {
        if (!this.isStockOptionSignal(signalOrTrade)) return;
        const key = this.getSignalKey(signalOrTrade);
        const sent = this.pruneStockHourlySent().filter(item => String(item.key || item).toUpperCase() !== key);
        this.saveStockHourlySent(sent);

        const sentSignals = this.getSentSignals();
        delete sentSignals[key];
        this.saveSentSignals(sentSignals);
        delete this.lastAlertByKey[key];
    },

    isStockOptionSignal: function(signal) {
        const segment = String(signal?.segment || '').toUpperCase();
        const source = String(signal?.source || '').toUpperCase();
        return segment === 'STOCK' || source.includes('STOCK OPTION');
    },

    getBots: function() {
        const bots = [];
        if (Config.telegram.botToken && Config.telegram.chatId) {
            bots.push({ botToken: Config.telegram.botToken, chatId: Config.telegram.chatId });
        }
        if (Config.telegram.botToken2 && Config.telegram.chatId2) {
            bots.push({ botToken: Config.telegram.botToken2, chatId: Config.telegram.chatId2 });
        }
        return bots;
    },

    canSend: function(signal, options = {}) {
        if (!signal) return false;
        if (!Config.telegram.enabled) {
            this.logSkip(signal, 'Telegram alerts are disabled.');
            return false;
        }
        if (!this.getBots().length) {
            this.logSkip(signal, 'Telegram bot token or chat ID is missing.');
            return false;
        }
        if (!options.allowWatch && !this.isAlertAction(signal.action)) {
            this.logSkip(signal, `${signal.action || 'Signal'} is shown in the app but Telegram sends only BUY/BTST alerts.`);
            return false;
        }
        if (!options.bypassScore && Number(signal.score || 0) < Number(Config.telegram.minAlertScore || 70)) {
            this.logSkip(signal, `Score ${signal.score}% is below Telegram min score ${Config.telegram.minAlertScore || 70}%.`);
            return false;
        }

        if (!options.manual && this.isStockOptionSignal(signal)) {
            const limitStatus = this.getStockHourlyLimitStatus();
            if (limitStatus.sent >= limitStatus.limit) {
                this.logSkip(signal, `Stock option hourly Telegram limit reached (${limitStatus.sent}/${limitStatus.limit}). Call is kept on screen for manual Send.`);
                return false;
            }
        }

        if (typeof isMarketOpenForSegment === 'function'
            && !options.bypassMarketHours
            && !isMarketOpenForSegment(signal.segment || 'INDEX')) {
            const reason = typeof getMarketClosedReason === 'function'
                ? getMarketClosedReason(signal.segment || 'INDEX')
                : 'Market is closed';
            this.logSkip(signal, reason);
            return false;
        }

        const key = this.getSignalKey(signal);
        if (!options.bypassDuplicate) {
            const sentSignals = this.pruneSentSignals();
            if (sentSignals[key]) {
                this.logSkip(signal, `Duplicate alert sent within ${Config.telegram.duplicateWindowMinutes || 180} minutes.`);
                return false;
            }
        }

        const lastSent = this.lastAlertByKey[key] || 0;
        const cooldownMs = Number(Config.telegram.cooldownSeconds || 120) * 1000;
        if (!options.bypassCooldown && Date.now() - lastSent < cooldownMs) {
            this.logSkip(signal, 'Telegram cooldown is active for this signal.');
            return false;
        }

        return true;
    },

    logSkip: function(signal, reason) {
        const key = `${this.getSignalKey(signal)}|${reason}`;
        const now = Date.now();
        if (now - (this.lastSkipLogByKey[key] || 0) < 60000) return;
        this.lastSkipLogByKey[key] = now;
        AngelOneAPI.log(`Telegram skipped ${signal.symbol || 'signal'} ${signal.strike || ''} ${signal.side || ''}: ${reason}`);
    },

    sendOptionSignal: async function(signal, options = {}) {
        if (!this.canSend(signal, options)) return false;

        const message = this.formatOptionMessage(signal);
        const results = await Promise.all(
            this.getBots().map(bot => this.sendMessage(message, bot.botToken, bot.chatId))
        );
        const allSent = results.every(Boolean);

        if (allSent) {
            this.lastAlertByKey[this.getSignalKey(signal)] = Date.now();
            const sentSignals = this.getSentSignals();
            sentSignals[this.getSignalKey(signal)] = new Date().toISOString();
            this.saveSentSignals(sentSignals);
            if (!options.manual && this.isStockOptionSignal(signal)) {
                this.recordStockAutoSend(signal);
            }
            AngelOneAPI.log(`Telegram alert sent: ${signal.symbol} ${signal.strike} ${signal.side}`);
        }
        return allSent;
    },

    getSignalKey: function(signal) {
        return [
            signal.symbol || '',
            signal.expiryDate || signal.expiry || '',
            signal.strike || '',
            signal.side || ''
        ].join('|').toUpperCase();
    },

    getTradeLockKey: function(signal) {
        return [
            signal.symbol || ''
        ].join('|').toUpperCase();
    },

    sendTradeUpdate: async function(trade, status, ltp) {
        if (!Config.telegram.enabled || !this.getBots().length) return false;
        const message = this.formatTradeUpdateMessage(trade, status, ltp);
        const results = await Promise.all(
            this.getBots().map(bot => this.sendMessage(message, bot.botToken, bot.chatId))
        );
        return results.every(Boolean);
    },

    resetSentSignals: function() {
        this.clearAllMemory();
        AngelOneAPI.log('Telegram sent-alert memory cleared.');
        alert('Sent alert memory cleared. Open trade locks and stock hourly limit memory are also cleared.');
    },

    clearAllMemory: function() {
        localStorage.removeItem(this.sentSignalsStorageKey);
        localStorage.removeItem(this.stockHourlyStorageKey);
        this.lastAlertByKey = {};
    },

    resetForMarketClose: function() {
        this.clearAllMemory();
        this.lastSkipLogByKey = {};
        AngelOneAPI.log('Market closed. Telegram trade memory reset.');
    },

    sendTest: async function() {
        this.saveFromForm();

        const bots = this.getBots();
        if (!bots.length) {
            alert('Telegram Bot Token and Chat ID are required.');
            return;
        }

        const results = await Promise.all(
            bots.map(bot => this.sendMessage('Options Signal Scanner test alert is working.', bot.botToken, bot.chatId))
        );
        const allSent = results.every(Boolean);
        alert(allSent ? 'Telegram test alert(s) sent.' : `One or more Telegram test alerts failed. ${this.lastSendError || 'Check tokens, chat IDs, and browser console.'}`);
    },

    isAlertAction: function(action) {
        const text = String(action || '');
        return text.startsWith('BUY') || text.startsWith('BTST') || text.startsWith('SWING');
    },

    sendMessage: async function(text, botToken, chatId) {
        this.lastSendError = '';
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };

        try {
            const response = await fetch(`${AngelOneAPI.getProxyBase()}${Config.endpoints.telegramSend}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    botToken: botToken,
                    relayUrl: Config.telegram.relayUrl || '',
                    ...payload
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
                this.lastSendError = this.formatSendError(data.description || data.message || `Proxy error ${response.status}`);
                AngelOneAPI.log(`Telegram error: ${this.lastSendError}`);
                return false;
            }
            return Boolean(data.ok);
        } catch (error) {
            this.lastSendError = this.formatSendError(error.message);
            AngelOneAPI.log(`Telegram request failed: ${this.lastSendError}`);
            return false;
        }
    },

    isNetworkTimeoutError: function(message) {
        return /UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|timed out|Failed to fetch|NetworkError/i
            .test(String(message || ''));
    },

    formatSendError: function(message) {
        const text = String(message || '').trim();
        if (this.isNetworkTimeoutError(text)) {
            return `${text || 'Telegram request failed'}. App tried server-side Telegram send and DNS fallback. The call stays active; press Send Telegram again after changing network/VPN/firewall.`;
        }
        return text || 'Telegram request failed. Check bot token and chat ID.';
    },

    formatOptionMessage: function(signal) {
        const risk = signal.risk || {};

        return [
            `<b>${signal.action}</b>`,
            `${signal.symbol} ${signal.strike} ${signal.side}`,
            signal.expiryDate ? `Expiry: ${signal.expiryDate}` : '',
            `Confidence: ${signal.score}%`,
            `Entry: ${OptionSignalEngine.formatMoney(risk.entry)}`,
            `SL: ${OptionSignalEngine.formatMoney(risk.stopLoss)}${risk.stopBasis ? ' (' + risk.stopBasis + ')' : ''}`,
            risk.optionSupport ? `Option Support: ${OptionSignalEngine.formatMoney(risk.optionSupport)}` : '',
            `Lot Size: ${typeof formatOptionLotSize === 'function' ? formatOptionLotSize(signal) : (signal.option?.lotSize || signal.option?.lotsize || '--')}`,
            `Target 1: ${OptionSignalEngine.formatMoney(risk.target1)}`,
            `Target 2: ${OptionSignalEngine.formatMoney(risk.target2)}`,
            risk.target3 ? `Target 3: ${OptionSignalEngine.formatMoney(risk.target3)}` : '',
            risk.riskReward ? `R:R ${risk.riskReward}` : '',
            risk.targetBasis && risk.targetBasis !== 'risk-reward' ? `Basis: ${risk.targetBasis}` : ''
        ].filter(Boolean).join('\n');
    },

    formatTradeUpdateMessage: function(trade, status, ltp) {
        return [
            `<b>${status}</b>`,
            `${trade.symbol} ${trade.strike} ${trade.side}`,
            trade.expiryDate ? `Expiry: ${trade.expiryDate}` : '',
            `Entry: ${OptionSignalEngine.formatMoney(trade.entry)}`,
            `Current: ${OptionSignalEngine.formatMoney(ltp)}`,
            `SL: ${OptionSignalEngine.formatMoney(trade.stopLoss)}`,
            `Target 1: ${OptionSignalEngine.formatMoney(trade.target1)}`,
            `Target 2: ${OptionSignalEngine.formatMoney(trade.target2)}`,
            trade.target3 ? `Target 3: ${OptionSignalEngine.formatMoney(trade.target3)}` : '',
            'This side is unlocked for the next fresh signal.'
        ].filter(Boolean).join('\n');
    }
};
