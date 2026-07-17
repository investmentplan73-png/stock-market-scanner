// Configuration Management
const Config = {
    // Angel One API Configuration
    apiKey: '',
    apiSecret: '',
    clientId: '',
    totpSecret: '',
    publicIp: '',
    accessToken: '',
    refreshToken: '',
    feedToken: '',
    
    // API Endpoints
    endpoints: {
        proxyBase: 'http://localhost:8787',
        login: '/api/login',
        logout: '/api/logout',
        marketData: '/api/market-data',
        wsFeed: '/api/ws-feed',
        history: '/api/historical',
        optionChain: '/api/options-chain',
        optionExpiries: '/api/option-expiries',
        resolveInstruments: '/api/resolve-instruments',
        telegramSend: '/api/telegram-send'
    },
    
    // Index symbol tokens. Angel One moved broad indices to the 999xxxxx
    // AMXIDX token series for market-data APIs.
    indices: {
        NIFTY: '99926000',
        BANKNIFTY: '99926009',
        FINNIFTY: '99926037',
        MIDCPNIFTY: '99926074',
        SENSEX: '99919000'
    },

    indexExchanges: {
        NIFTY: 'NSE',
        BANKNIFTY: 'NSE',
        FINNIFTY: 'NSE',
        MIDCPNIFTY: 'NSE',
        SENSEX: 'BSE'
    },
    
    // Indicator Parameters
    indicators: {
        rsi: {
            period: 14,
            overbought: 70,
            oversold: 30,
            heat: 80,
            warning: 86,
            confirmationSmaPeriod: 20,
            freshLookback: 20,
            bbPeriod: 20,
            bbStdDev: 2,
            obvFast: 12,
            obvSlow: 21
        },
        macd: {
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        },
        bollingerBands: {
            period: 20,
            stdDev: 2
        },
        ema: {
            short: 9,
            long: 21
        },
        adx: {
            period: 14
        },
        stochastic: {
            kPeriod: 14,
            dPeriod: 3,
            overbought: 80,
            oversold: 20
        },
        volume: {
            period: 20,
            spikeMultiplier: 1.15,
            confirmationRatio: 1.1,
            dryUpRatio: 0.75,
            motherLookback: 252,
            motherAveragePeriod: 20,
            motherMultiplier: 1.8
        },
        pivotPoints: {
            neutralBandPercent: 0.05
        },
        supportResistance: {
            period: 34,
            swingLookback: 2,
            minTouches: 2
        }
    },
    
    // Signal Thresholds
    signals: {
        minConfidence: 70,
        buyThreshold: 0.7,
        sellThreshold: -0.7
    },

    // Options scanner settings. Keep this practical for live Angel One data:
    // some quote fields such as option volume can be missing.
    optionScanner: {
        minConfidence: 70,
        minBuyScore: 76,
        strongConfidence: 80,
        maxOptionRiskPercent: 30,
        firstTargetRiskReward: 1.8,
        secondTargetRiskReward: 2.8,
        maxSpreadPercent: 7,
        pivotBufferPercent: 0.24,
        supportResistanceBufferPercent: 0.28,
        showBestWatchWhenNoBuy: true,
        minWatchScore: 62,
        maxBuyWarnings: 2,
        maxWatchWarnings: 3,
        minRewardRiskForBuy: 1.25,
        stopLoss: {
            confirmations: 2, // FIX: Was 1, now 2 - need 2 touches to confirm SL
            fallbackRiskPercent: 28, // FIX: Was 24, wider buffer
            minRiskPercent: 18, // FIX: Was 14, wider minimum
            optionSupportBufferPercent: 6, // FIX: Was 4, wider buffer
            supportBufferPercent: 0.12, // FIX: Was 0.08, wider buffer
            atrBufferMultiplier: 0.18 // FIX: Was 0.12, wider ATR buffer
        },
        breakout: {
            enabled: true,
            confirmationBufferPercent: 0.14,
            maxExtensionPercent: 1.25,
            minVolumeRatio: 1.35,
            blockFakeBreakouts: true,
            minWickBreakPercent: 0.035,
            minClosePositionPercent: 68,
            maxWeakClosePercent: 0.12,
            minRejectionWickRatio: 0.5
        },
        minVolume: 1,
        requireOptionVolume: false,
        requireOptionMomentum: true,
        minTrendStrengthForBuy: 56,
        minAdxForBuy: 18,
        btst: {
            enabled: true,
            timeframes: ['ONE_DAY'],
            minConfidence: 82,
            minTrendStrength: 55,
            minDaysToExpiry: 1.2,
            maxWarnings: 2
        },
        trendExit: {
            enabled: true,
            minOppositeTrendStrength: 55,
            minHoldMinutes: 5
        },
        greeks: {
            enabled: true,
            requireForBuy: false,
            riskFreeRate: 0.065,
            minIvPercent: 3,
            maxIvPercent: 80,
            minDeltaAbs: 0.22,
            maxDeltaAbs: 0.82,
            minDaysToExpiry: 0.5
        },
        nearAtmStrikes: 5,
        strikeStep: {
            NIFTY: 50,
            BANKNIFTY: 100,
            FINNIFTY: 50,
            MIDCPNIFTY: 25,
            SENSEX: 100,
            CRUDEOIL: 50,
            NATURALGAS: 5,
            GOLD: 100,
            GOLDM: 100,
            SILVER: 1000,
            SILVERM: 100,
            COPPER: 5,
            ZINC: 1,
            ALUMINIUM: 1,
            STOCK: 10,
            COMMODITY: 50
        },
        autoRefreshSeconds: 20
    },

    // Optional stock-option scan input. Fill these from the Angel One instrument
    // master for the stock you want to scan.
    stockOption: {
        symbol: '',
        token: '',
        exchange: 'NSE'
    },

    commodityOption: {
        symbol: 'CRUDEOIL',
        token: '',
        exchange: 'MCX',
        symbols: [
            'CRUDEOIL',
            'NATURALGAS',
            'GOLD',
            'GOLDM',
            'SILVER',
            'SILVERM',
            'COPPER',
            'ZINC',
            'ALUMINIUM'
        ]
    },

    autoScanner: {
        enabled: true,
        scope: 'MARKET',
        scanIntervalSeconds: 30,
        indicatorRefreshSeconds: 180,
        delayBetweenSymbolsMs: 800,
        maxStocksPerCycle: 60,
        maxCommoditiesPerCycle: 3,
        includeWatchSignals: false,
        includeCommodityWatchSignals: true,
        useAllFnoStocks: true,
        includeCommodities: true,
        marketMoodFilter: {
            enabled: false,
            minScoreAgainstMood: 72
        },
        stockSymbols: [
            'RELIANCE',
            'HDFCBANK',
            'ICICIBANK',
            'SBIN',
            'AXISBANK',
            'INFY',
            'TCS',
            'LT',
            'KOTAKBANK',
            'BHARTIARTL',
            'ITC',
            'TATAMOTORS',
            'MARUTI',
            'SUNPHARMA',
            'TATASTEEL',
            'ADANIENT',
            'BAJFINANCE',
            'HINDUNILVR',
            'POWERGRID',
            'NTPC'
        ],
        commoditySymbols: [
            'CRUDEOIL',
            'NATURALGAS',
            'GOLD',
            'SILVER',
            'COPPER',
            'ZINC'
        ]
    },

    telegram: {
        enabled: false,
        botToken: '',
        botToken2: '',
        chatId: '@stockoptionniftycalls',
        defaultChatId: '@stockoptionniftycalls',
        chatId2: '',
        relayUrl: '',
        minAlertScore: 76,
        cooldownSeconds: 120,
        duplicateWindowMinutes: 180,
        stockOptionHourlyLimit: 5,
        stockOptionLimitWindowMinutes: 60
    },

    tradeLock: {
        enabled: true,
        closeOnTarget: 'target1'
    },

    marketHours: {
        timezone: 'Asia/Kolkata',
        INDEX: {
            open: '09:15',
            close: '15:30',
            days: [1, 2, 3, 4, 5]
        },
        STOCK: {
            open: '09:15',
            close: '15:30',
            days: [1, 2, 3, 4, 5]
        },
        COMMODITY: {
            open: '09:00',
            close: '23:30',
            days: [1, 2, 3, 4, 5]
        }
    },
    
    // Save configuration to localStorage
    saveConfig: function() {
        const config = {
            apiKey: this.apiKey,
            apiSecret: this.apiSecret,
            clientId: this.clientId,
            totpSecret: this.totpSecret,
            publicIp: this.publicIp,
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            feedToken: this.feedToken,
            telegram: {
                enabled: this.telegram.enabled,
                botToken: this.telegram.botToken,
                botToken2: this.telegram.botToken2,
                chatId: this.telegram.chatId,
                relayUrl: this.telegram.relayUrl,
                chatId2: this.telegram.chatId2,
                minAlertScore: this.telegram.minAlertScore,
                cooldownSeconds: this.telegram.cooldownSeconds,
                duplicateWindowMinutes: this.telegram.duplicateWindowMinutes,
                stockOptionHourlyLimit: this.telegram.stockOptionHourlyLimit,
                stockOptionLimitWindowMinutes: this.telegram.stockOptionLimitWindowMinutes
            },
            autoScanner: {
                scope: this.autoScanner.scope,
                enabled: this.autoScanner.enabled,
                includeCommodities: this.autoScanner.includeCommodities
            },
            tradeLock: {
                enabled: this.tradeLock.enabled,
                closeOnTarget: this.tradeLock.closeOnTarget
            }
        };
        localStorage.setItem('stockMarketConfig', JSON.stringify(config));
    },
    
    // Load configuration from localStorage
    loadConfig: function() {
        const saved = localStorage.getItem('stockMarketConfig');
        if (saved) {
            const config = JSON.parse(saved);
            this.apiKey = config.apiKey || '';
            this.apiSecret = config.apiSecret || '';
            this.clientId = config.clientId || '';
            this.totpSecret = config.totpSecret || '';
            this.publicIp = config.publicIp || '';
            this.accessToken = config.accessToken || '';
            this.refreshToken = config.refreshToken || '';
            this.feedToken = config.feedToken || '';
            this.telegram = {
                ...this.telegram,
                ...(config.telegram || {})
            };
            this.telegram.minAlertScore = Math.max(60, Math.min(Number(this.telegram.minAlertScore || 76), 100));
            this.autoScanner = {
                ...this.autoScanner,
                ...(config.autoScanner || {})
            };
            if (['SELECTED', 'INDICES'].includes(this.autoScanner.scope)) {
                this.autoScanner.scope = 'MARKET';
            }
            this.tradeLock = {
                ...this.tradeLock,
                ...(config.tradeLock || {})
            };
            if (!this.telegram.chatId && this.telegram.defaultChatId) {
                this.telegram.chatId = this.telegram.defaultChatId;
            }
        }
    },
    
    // Clear configuration
    clearConfig: function() {
        localStorage.removeItem('stockMarketConfig');
        this.apiKey = '';
        this.apiSecret = '';
        this.clientId = '';
        this.totpSecret = '';
        this.publicIp = '';
        this.accessToken = '';
        this.refreshToken = '';
        this.feedToken = '';
    }
};

// Load config on initialization
Config.loadConfig();
