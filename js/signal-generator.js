// Signal Generator for Buy/Sell Recommendations
const SignalGenerator = {
    signals: [],
    signalHistory: [],

    indicatorConfigMap: {
        RSI: 'rsi',
        AdvancedRSI: 'rsi',
        MACD: 'macd',
        BollingerBands: 'bollingerBands',
        EMA: 'ema',
        ADX: 'adx',
        Stochastic: 'stochastic',
        Volume: 'volume',
        OBV: 'rsi',
        Engulfing: 'rsi',
        CandlestickPatterns: 'rsi',
        FibonacciContext: 'supportResistance',
        ChartPatterns: 'supportResistance',
        MotherVolume: 'volume',
        PivotPoints: 'pivotPoints'
    },
    
    // Generate comprehensive signal based on all indicators
    generateSignal: function(symbol, price, indicators) {
        const safeIndicators = indicators || {};
        let buySignals = 0;
        let sellSignals = 0;
        let holdSignals = 0;
        let usableIndicators = 0;
        
        const signalDetails = {};
        
        // Check each indicator
        for (const [indicatorName, indicatorData] of Object.entries(safeIndicators)) {
            const configKey = this.indicatorConfigMap[indicatorName] || indicatorName.toLowerCase();
            const signal = TechnicalIndicators.getIndicatorSignal(
                indicatorName,
                indicatorData,
                Config.indicators[configKey] || {}
            );
            
            signalDetails[indicatorName] = signal;
            if (indicatorData !== null && indicatorData !== undefined) {
                usableIndicators++;
            }
            
            if (signal === 'BUY') buySignals++;
            else if (signal === 'SELL') sellSignals++;
            else holdSignals++;
        }

        const totalIndicators = Math.max(usableIndicators, 1);
        
        // Calculate overall signal strength
        const buyStrength = (buySignals / totalIndicators) * 100;
        const sellStrength = (sellSignals / totalIndicators) * 100;
        
        let finalSignal = 'HOLD';
        let confidence = 0;
        
        if (buyStrength >= Config.signals.buyThreshold * 100) {
            finalSignal = 'BUY';
            confidence = buyStrength;
        } else if (sellStrength >= Math.abs(Config.signals.sellThreshold) * 100) {
            finalSignal = 'SELL';
            confidence = sellStrength;
        }
        
        const signalObj = {
            symbol: symbol,
            price: price,
            signal: finalSignal,
            confidence: Number(confidence.toFixed(2)),
            buySignals: buySignals,
            sellSignals: sellSignals,
            holdSignals: holdSignals,
            usableIndicators: usableIndicators,
            details: signalDetails,
            timestamp: new Date().toISOString()
        };
        
        // Add to signals array if it's a strong signal
        if (confidence >= Config.signals.minConfidence) {
            this.signals.push(signalObj);
            this.signalHistory.push(signalObj);
            
            // Keep only last 50 signals in history
            if (this.signalHistory.length > 50) {
                this.signalHistory.shift();
            }
            
            this.displaySignal(signalObj);
            this.logSignal(signalObj);
        }
        
        return signalObj;
    },
    
    // Generate signal for options
    generateOptionsSignal: function(symbol, strikePrice, callData, putData, indicators) {
        const callSignal = this.generateSignal(`${symbol} ${strikePrice} CE`, callData.ltp, indicators);
        const putSignal = this.generateSignal(`${symbol} ${strikePrice} PE`, putData.ltp, indicators);
        
        return {
            strike: strikePrice,
            call: callSignal,
            put: putSignal
        };
    },
    
    // Display signal in UI
    displaySignal: function(signal) {
        const container = document.getElementById('signalsContainer');
        if (!container) return;
        
        // Remove "no signals" message if present
        const noSignals = container.querySelector('.no-signals');
        if (noSignals) {
            noSignals.remove();
        }
        
        const signalCard = document.createElement('div');
        signalCard.className = `signal-card ${signal.signal.toLowerCase()}`;
        signalCard.innerHTML = `
            <h4>${signal.symbol} - ${signal.signal} @ ${Number(signal.price || 0).toFixed(2)}</h4>
            <div class="signal-details">
                <strong>Confidence:</strong> ${signal.confidence}%<br>
                <strong>Buy Signals:</strong> ${signal.buySignals} | 
                <strong>Sell Signals:</strong> ${signal.sellSignals} | 
                <strong>Hold:</strong> ${signal.holdSignals} | 
                <strong>Checked:</strong> ${signal.usableIndicators}<br>
                <strong>Time:</strong> ${new Date(signal.timestamp).toLocaleTimeString()}
            </div>
        `;
        
        container.insertBefore(signalCard, container.firstChild);
        
        // Keep only last 10 signals displayed
        while (container.children.length > 10) {
            container.removeChild(container.lastChild);
        }
    },
    
    // Log signal
    logSignal: function(signal) {
        AngelOneAPI.log(`SIGNAL: ${signal.symbol} - ${signal.signal} (Confidence: ${signal.confidence}%)`);
    },
    
    // Clear all signals
    clearSignals: function() {
        this.signals = [];
        const container = document.getElementById('signalsContainer');
        if (container) {
            container.innerHTML = '<div class="no-signals">Waiting for signals...</div>';
        }
    },
    
    // Get signal for specific index
    getIndexSignal: function(indexName) {
        return this.signals.find(s => s.symbol === indexName);
    },
    
    // Get all active signals
    getActiveSignals: function() {
        return this.signals;
    },
    
    // Get signal history
    getSignalHistory: function() {
        return this.signalHistory;
    }
};
