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
        minConfidence: 60,
        minBuyScore: 55,
        strongConfidence: 68,
        maxOptionRiskPercent: 30,
        firstTargetRiskReward: 2.0,
        secondTargetRiskReward: 3.0,
        maxSpreadPercent: 7,
        pivotBufferPercent: 0.24,
        supportResistanceBufferPercent: 0.28,
        showBestWatchWhenNoBuy: true,
        minWatchScore: 50,
        maxBuyWarnings: 5,
        maxWatchWarnings: 8,
        maxBuyPenalty: 35,
        maxWatchPenalty: 50,
        requireVwapConfirm: false,
        requireStructureClear: false,
        requirePivotConfirm: false,
        minRewardRiskForBuy: 1.0,
        spreadBufferPercent: 3,
        stopLoss: {
            confirmations: 1,
            fallbackRiskPercent: 25,
            minRiskPercent: 12,
            optionSupportBufferPercent: 6,
            supportBufferPercent: 0.12,
            atrBufferMultiplier: 0.18
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
        autoRefreshSeconds: 20,
        stockLotSizes: {
            NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 40, MIDCPNIFTY: 50, SENSEX: 15,
            RELIANCE: 500, HDFCBANK: 550, ICICIBANK: 700, SBIN: 3000, AXISBANK: 625,
            INFY: 425, TCS: 175, LT: 150, KOTAKBANK: 400, BHARTIARTL: 475,
            ITC: 1600, TATAMOTORS: 2200, MARUTI: 5, SUNPHARMA: 400, TATASTEEL: 5500,
            ADANIENT: 250, BAJFINANCE: 125, HINDUNILVR: 300, POWERGRID: 2700, NTPC: 4500,
            WIPRO: 1500, TATACONSUM: 1000, HCLTECH: 350, TECHM: 600, DRREDDY: 125,
            CIPLA: 325, APOLLOHOSP: 125, EICHERMOT: 250, BAJAJFINSV: 150, CoalIndia: 550,
            INDUSINDBK: 900, GRASIM: 225, TATAPOWER: 2750, DIVISLAB: 100, ONGC: 3875,
            BPCL: 1800, HINDALCO: 1625, NESTLEIND: 30, JSWSTEEL: 675, ULTRACEMCO: 50,
            ASIANPAINT: 200, BHERO: 700, TRENT: 675, ADANIPORTS: 1250, BEL: 4500,
            IRCTC: 1525, SBILIFE: 1125, HDFCLIFE: 1400, PIDILITIND: 400, PERSISTENT: 225,
            COFORGE: 475, M&M: 425, MARICO: 1200, DABUR: 1500, COLPAL: 325,
            GODREJCP: 650, BRITANNIA: 225, ICICIPRULI: 1700, HAVELLS: 625, VOLTAS: 425,
            BATAINDIA: 550, DELHIVERY: 1325, PAYTM: 625, ZOMATO: 2375, NYKAA: 1550,
            POLICYBZR: 350, LICI: 350, IOB: 10000, CANBK: 5000, PNB: 5000,
            BANKBARODA: 5000, IDBI: 3000, FEDERALBNK: 10000, BANDHANBNK: 10000,
            AUBANK: 1100, INDUSINDBK: 900, MOTHERSON: 3750, ZEEL: 5000, SAIL: 15000,
            HINDZINC: 1000, NMDC: 5625, NATIONALUM: 5625, VEDL: 3000, JINDALSTEL: 2750,
            TATACHEM: 1125, DEEPAKNTR: 225, NAVINFLUOR: 150, LALPATHLAB: 250,
            MAXHEALTH: 350, DIXON: 125, VOLTAS: 425, CROMPTON: 1500, BDL: 475,
            HAL: 100, COCHINSHIP: 175, MazagonDock: 250, GRSE: 400
        }
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
        includeWatchSignals: true,
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
