// Technical indicator calculations used by the signal engines.
const TechnicalIndicators = {
    isNumber: function(value) {
        return typeof value === 'number' && Number.isFinite(value);
    },

    round: function(value, decimals = 2) {
        if (!this.isNumber(value)) return null;
        return Number(value.toFixed(decimals));
    },

    calculateRSI: function(prices, period = 14) {
        const values = this.calculateRSIValues(prices, period);
        return values && values.length ? values.at(-1) : null;
    },

    calculateRSIValues: function(prices, period = 14) {
        if (!Array.isArray(prices) || prices.length < period + 1) return null;

        const values = new Array(prices.length).fill(null);
        let gains = 0;
        let losses = 0;

        for (let i = 1; i <= period; i++) {
            const change = prices[i] - prices[i - 1];
            if (change >= 0) gains += change;
            else losses -= change;
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        values[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

        for (let i = period + 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            const gain = Math.max(change, 0);
            const loss = Math.max(-change, 0);
            avgGain = ((avgGain * (period - 1)) + gain) / period;
            avgLoss = ((avgLoss * (period - 1)) + loss) / period;
            values[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        }

        return values;
    },

    calculateEMA: function(prices, period) {
        if (!Array.isArray(prices) || prices.length < period) return null;
        return this.calculateEMAValues(prices, period).at(-1);
    },

    calculateEMAValues: function(prices, period) {
        if (!Array.isArray(prices) || prices.length < period) return [];

        const multiplier = 2 / (period + 1);
        const values = new Array(period - 1).fill(null);
        let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
        values.push(ema);

        for (let i = period; i < prices.length; i++) {
            ema = ((prices[i] - ema) * multiplier) + ema;
            values.push(ema);
        }

        return values;
    },

    calculateSMA: function(prices, period) {
        if (!Array.isArray(prices) || prices.length < period) return null;
        const recent = prices.slice(-period);
        return recent.reduce((sum, price) => sum + price, 0) / period;
    },

    calculateVolumeProfile: function(volumes, closes = [], period = 20) {
        if (!Array.isArray(volumes)) return null;

        const cleanVolumes = volumes
            .map(volume => Number(volume))
            .filter(volume => Number.isFinite(volume) && volume >= 0);
        if (cleanVolumes.length < 2) return null;

        const current = cleanVolumes.at(-1);
        const previous = cleanVolumes.at(-2);
        const lookback = cleanVolumes.slice(Math.max(0, cleanVolumes.length - period - 1), -1);
        if (!lookback.length) return null;

        const average = lookback.reduce((sum, volume) => sum + volume, 0) / lookback.length;
        const ratio = average > 0 ? current / average : null;

        const cleanCloses = Array.isArray(closes)
            ? closes.map(price => Number(price)).filter(Number.isFinite)
            : [];
        const currentClose = cleanCloses.at(-1);
        const previousClose = cleanCloses.at(-2);
        const priceChange = this.isNumber(currentClose) && this.isNumber(previousClose)
            ? currentClose - previousClose
            : null;

        let priceDirection = 'FLAT';
        if (this.isNumber(priceChange) && priceChange > 0) priceDirection = 'UP';
        else if (this.isNumber(priceChange) && priceChange < 0) priceDirection = 'DOWN';

        return {
            current,
            previous,
            average,
            ratio,
            priceChange,
            priceDirection,
            volumeDirection: current > previous ? 'RISING' : current < previous ? 'FALLING' : 'FLAT'
        };
    },

    calculateOBV: function(closes, volumes, emaFast = 12, emaSlow = 21) {
        if (!Array.isArray(closes) || !Array.isArray(volumes)) return null;

        const length = Math.min(closes.length, volumes.length);
        if (length < Math.max(emaSlow, 3)) return null;

        const values = [0];
        for (let i = 1; i < length; i++) {
            const close = Number(closes[i]);
            const previousClose = Number(closes[i - 1]);
            const volume = Number(volumes[i]);
            const previousObv = values.at(-1);
            if (!Number.isFinite(close) || !Number.isFinite(previousClose) || !Number.isFinite(volume)) {
                values.push(previousObv);
            } else if (close > previousClose) {
                values.push(previousObv + volume);
            } else if (close < previousClose) {
                values.push(previousObv - volume);
            } else {
                values.push(previousObv);
            }
        }

        const fastValues = this.calculateEMAValues(values, emaFast);
        const slowValues = this.calculateEMAValues(values, emaSlow);
        const current = values.at(-1);
        const previous = values.at(-2);
        const fast = fastValues.at(-1);
        const slow = slowValues.at(-1);
        const slope = this.isNumber(previous) ? current - previous : 0;

        let direction = 'NEUTRAL';
        if (this.isNumber(fast) && this.isNumber(slow)) {
            if (current > fast && fast > slow && slope >= 0) direction = 'BULLISH';
            else if (current < fast && fast < slow && slope <= 0) direction = 'BEARISH';
        }

        return { current, previous, emaFast: fast, emaSlow: slow, slope, direction };
    },

    calculateEngulfingPattern: function(opens, highs, lows, closes) {
        const length = Math.min(opens?.length || 0, highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 2) return null;

        const previous = {
            open: Number(opens[length - 2]),
            high: Number(highs[length - 2]),
            low: Number(lows[length - 2]),
            close: Number(closes[length - 2])
        };
        const current = {
            open: Number(opens[length - 1]),
            high: Number(highs[length - 1]),
            low: Number(lows[length - 1]),
            close: Number(closes[length - 1])
        };
        if (![previous.open, previous.high, previous.low, previous.close, current.open, current.high, current.low, current.close].every(Number.isFinite)) {
            return null;
        }

        const previousBearish = previous.close < previous.open;
        const previousBullish = previous.close > previous.open;
        const currentBullish = current.close > current.open;
        const currentBearish = current.close < current.open;
        const bodyEngulfs = Math.max(current.open, current.close) >= Math.max(previous.open, previous.close)
            && Math.min(current.open, current.close) <= Math.min(previous.open, previous.close);
        const fullRangeEngulfs = current.high >= previous.high && current.low <= previous.low;
        const strength = fullRangeEngulfs ? 'STRONG' : bodyEngulfs ? 'BODY' : 'NONE';

        if (previousBearish && currentBullish && bodyEngulfs) {
            return { type: 'BULLISH', strength, support: current.low, resistance: current.high };
        }
        if (previousBullish && currentBearish && bodyEngulfs) {
            return { type: 'BEARISH', strength, support: current.low, resistance: current.high };
        }

        return { type: 'NONE', strength: 'NONE', support: current.low, resistance: current.high };
    },

    getCandleStats: function(open, high, low, close) {
        const safeOpen = Number(open);
        const safeHigh = Number(high);
        const safeLow = Number(low);
        const safeClose = Number(close);
        if (![safeOpen, safeHigh, safeLow, safeClose].every(Number.isFinite)) return null;

        const range = Math.max(safeHigh - safeLow, 0);
        const body = Math.abs(safeClose - safeOpen);
        const upperWick = Math.max(safeHigh - Math.max(safeOpen, safeClose), 0);
        const lowerWick = Math.max(Math.min(safeOpen, safeClose) - safeLow, 0);
        const direction = safeClose > safeOpen ? 'BULLISH' : safeClose < safeOpen ? 'BEARISH' : 'NEUTRAL';

        return {
            open: safeOpen,
            high: safeHigh,
            low: safeLow,
            close: safeClose,
            range,
            body,
            upperWick,
            lowerWick,
            bodyRatio: range ? body / range : 0,
            upperWickRatio: range ? upperWick / range : 0,
            lowerWickRatio: range ? lowerWick / range : 0,
            direction
        };
    },

    inferShortTrend: function(closes, lookback = 5) {
        const clean = (closes || []).map(Number).filter(Number.isFinite);
        if (clean.length < 3) return 'NEUTRAL';
        const recent = clean.slice(-lookback);
        const first = recent[0];
        const last = recent.at(-1);
        const change = first ? ((last - first) / first) * 100 : 0;
        if (change > 0.2) return 'UP';
        if (change < -0.2) return 'DOWN';
        return 'NEUTRAL';
    },

    calculateCandlestickPatterns: function(opens, highs, lows, closes) {
        const length = Math.min(opens?.length || 0, highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 3) return null;

        const rows = [];
        for (let i = 0; i < length; i++) {
            const stats = this.getCandleStats(opens[i], highs[i], lows[i], closes[i]);
            if (stats) rows.push(stats);
        }
        if (rows.length < 3) return null;

        const current = rows.at(-1);
        const previous = rows.at(-2);
        const third = rows.at(-3);
        const trend = this.inferShortTrend(rows.map(item => item.close), 6);
        const averageRange = rows.slice(-12, -1).reduce((sum, item) => sum + item.range, 0) / Math.max(rows.slice(-12, -1).length, 1);
        const averageBody = rows.slice(-12, -1).reduce((sum, item) => sum + item.body, 0) / Math.max(rows.slice(-12, -1).length, 1);
        const patterns = [];

        const addPattern = (name, direction, strength, detail = '') => {
            patterns.push({ name, direction, strength, detail });
        };

        const isDoji = current.range > 0 && current.bodyRatio <= 0.12;
        if (isDoji) addPattern('Doji', 'NEUTRAL', 35, 'Indecision candle');

        if (current.lowerWickRatio >= 0.55 && current.bodyRatio <= 0.35 && current.upperWickRatio <= 0.2) {
            addPattern(trend === 'DOWN' ? 'Hammer' : 'Hanging Man', trend === 'DOWN' ? 'BULLISH' : 'BEARISH', trend === 'DOWN' ? 72 : 58);
        }

        if (current.upperWickRatio >= 0.55 && current.bodyRatio <= 0.35 && current.lowerWickRatio <= 0.2) {
            addPattern(trend === 'UP' ? 'Shooting Star' : 'Inverted Hammer', trend === 'UP' ? 'BEARISH' : 'BULLISH', trend === 'UP' ? 72 : 58);
        }

        const bodyEngulfs = Math.max(current.open, current.close) >= Math.max(previous.open, previous.close)
            && Math.min(current.open, current.close) <= Math.min(previous.open, previous.close);
        if (previous.direction === 'BEARISH' && current.direction === 'BULLISH' && bodyEngulfs) {
            addPattern('Bullish Engulfing', 'BULLISH', current.range > averageRange ? 82 : 74);
        } else if (previous.direction === 'BULLISH' && current.direction === 'BEARISH' && bodyEngulfs) {
            addPattern('Bearish Engulfing', 'BEARISH', current.range > averageRange ? 82 : 74);
        }

        if (
            third.direction === 'BEARISH'
            && previous.bodyRatio <= 0.35
            && current.direction === 'BULLISH'
            && current.close > ((third.open + third.close) / 2)
        ) {
            addPattern('Morning Star', 'BULLISH', 84);
        }

        if (
            third.direction === 'BULLISH'
            && previous.bodyRatio <= 0.35
            && current.direction === 'BEARISH'
            && current.close < ((third.open + third.close) / 2)
        ) {
            addPattern('Evening Star', 'BEARISH', 84);
        }

        if (
            previous.direction === 'BEARISH'
            && current.direction === 'BULLISH'
            && current.close > ((previous.open + previous.close) / 2)
            && current.open < previous.low
        ) {
            addPattern('Piercing Line', 'BULLISH', 70);
        }

        if (
            previous.direction === 'BULLISH'
            && current.direction === 'BEARISH'
            && current.close < ((previous.open + previous.close) / 2)
            && current.open > previous.high
        ) {
            addPattern('Dark Cloud Cover', 'BEARISH', 70);
        }

        const recentThree = rows.slice(-3);
        if (
            recentThree.every(item => item.direction === 'BULLISH' && item.body >= averageBody * 0.75)
            && recentThree[2].close > recentThree[1].close
            && recentThree[1].close > recentThree[0].close
        ) {
            addPattern('Three White Soldiers', 'BULLISH', 86);
        }

        if (
            recentThree.every(item => item.direction === 'BEARISH' && item.body >= averageBody * 0.75)
            && recentThree[2].close < recentThree[1].close
            && recentThree[1].close < recentThree[0].close
        ) {
            addPattern('Three Black Crows', 'BEARISH', 86);
        }

        if (
            current.direction === 'BULLISH'
            && current.body >= averageBody * 1.4
            && current.upperWickRatio <= 0.18
            && current.lowerWickRatio <= 0.18
        ) {
            addPattern('Bullish Marubozu', 'BULLISH', 72);
        }

        if (
            current.direction === 'BEARISH'
            && current.body >= averageBody * 1.4
            && current.upperWickRatio <= 0.18
            && current.lowerWickRatio <= 0.18
        ) {
            addPattern('Bearish Marubozu', 'BEARISH', 72);
        }

        // ==================== NEW CONFIRMED PATTERNS (from Candlestick Charting Explained) ====================

        // HARAMI (Inside Bar) — only valid with trend confirmation
        const previousBody = Math.abs(previous.close - previous.open);
        const currentInsidePrevious = current.high <= previous.high && current.low >= previous.low;
        const bodyInsidePrevious = Math.max(current.open, current.close) <= Math.max(previous.open, previous.close)
            && Math.min(current.open, current.close) >= Math.min(previous.open, previous.close);

        if (previous.direction === 'BEARISH' && current.direction === 'BULLISH'
            && bodyInsidePrevious && current.body < previousBody * 0.5
            && trend === 'DOWN') {
            addPattern('Bullish Harami', 'BULLISH', 64, 'Inside bar after downtrend');
        }
        if (previous.direction === 'BULLISH' && current.direction === 'BEARISH'
            && bodyInsidePrevious && current.body < previousBody * 0.5
            && trend === 'UP') {
            addPattern('Bearish Harami', 'BEARISH', 64, 'Inside bar after uptrend');
        }

        // TWEEZER TOPS/BOTTOMS — equal highs/lows with reversal confirmation
        const tweezTolerance = averageRange * 0.03;
        if (Math.abs(previous.high - current.high) <= tweezTolerance
            && previous.direction === 'BULLISH' && current.direction === 'BEARISH'
            && trend === 'UP' && current.close < previous.open) {
            addPattern('Tweezer Top', 'BEARISH', 70, 'Equal highs + bearish reversal');
        }
        if (Math.abs(previous.low - current.low) <= tweezTolerance
            && previous.direction === 'BEARISH' && current.direction === 'BULLISH'
            && trend === 'DOWN' && current.close > previous.open) {
            addPattern('Tweezer Bottom', 'BULLISH', 70, 'Equal lows + bullish reversal');
        }

        // THREE INSIDE UP/DOWN — Harami + confirmation candle (3-candle pattern)
        if (rows.length >= 3) {
            const thirdBodyInsideSecond = Math.max(previous.open, previous.close) <= Math.max(third.open, third.close)
                && Math.min(previous.open, previous.close) >= Math.min(third.open, third.close);

            if (third.direction === 'BEARISH' && thirdBodyInsideSecond
                && previous.direction === 'BULLISH' && previous.body < Math.abs(third.close - third.open) * 0.5
                && current.direction === 'BULLISH' && current.close > third.open) {
                addPattern('Three Inside Up', 'BULLISH', 80, 'Harami confirmed by 3rd candle');
            }
            if (third.direction === 'BULLISH' && thirdBodyInsideSecond
                && previous.direction === 'BEARISH' && previous.body < Math.abs(third.close - third.open) * 0.5
                && current.direction === 'BEARISH' && current.close < third.open) {
                addPattern('Three Inside Down', 'BEARISH', 80, 'Harami confirmed by 3rd candle');
            }
        }

        // KICKER PATTERN — strongest reversal (gap + opposite direction)
        if (previous.direction === 'BEARISH' && current.direction === 'BULLISH'
            && current.open > previous.open && current.close > previous.open
            && current.body >= averageBody * 1.2) {
            addPattern('Bullish Kicker', 'BULLISH', 90, 'Gap up + strong bullish body');
        }
        if (previous.direction === 'BULLISH' && current.direction === 'BEARISH'
            && current.open < previous.open && current.close < previous.open
            && current.body >= averageBody * 1.2) {
            addPattern('Bearish Kicker', 'BEARISH', 90, 'Gap down + strong bearish body');
        }

        // ABANDONED BABY — gap + doji + gap (very rare, very strong)
        if (rows.length >= 3) {
            const previousIsDoji = previous.range > 0 && previous.bodyRatio <= 0.12;
            if (third.direction === 'BEARISH' && previousIsDoji
                && previous.high < third.low && previous.high < current.low
                && current.direction === 'BULLISH') {
                addPattern('Bullish Abandoned Baby', 'BULLISH', 92, 'Gap doji gap — rare reversal');
            }
            if (third.direction === 'BULLISH' && previousIsDoji
                && previous.low > third.high && previous.low > current.high
                && current.direction === 'BEARISH') {
                addPattern('Bearish Abandoned Baby', 'BEARISH', 92, 'Gap doji gap — rare reversal');
            }
        }

        // BELT HOLD — strong open at extreme with no wick
        if (current.direction === 'BULLISH' && current.lowerWickRatio <= 0.05
            && current.body >= averageBody * 1.3 && trend === 'DOWN') {
            addPattern('Bullish Belt Hold', 'BULLISH', 66, 'Open at low + strong up close');
        }
        if (current.direction === 'BEARISH' && current.upperWickRatio <= 0.05
            && current.body >= averageBody * 1.3 && trend === 'UP') {
            addPattern('Bearish Belt Hold', 'BEARISH', 66, 'Open at high + strong down close');
        }

        // SPINNING TOP — indecision, only useful when after strong trend
        if (current.bodyRatio > 0.12 && current.bodyRatio <= 0.3
            && current.upperWickRatio >= 0.25 && current.lowerWickRatio >= 0.25
            && (trend === 'UP' || trend === 'DOWN')) {
            const spinDir = trend === 'UP' ? 'BEARISH' : 'BULLISH';
            addPattern('Spinning Top', spinDir, 45, `Indecision after ${trend.toLowerCase()} trend`);
        }

        // RISING/FALLING THREE METHODS — continuation (needs 5 candles)
        if (rows.length >= 5) {
            const five = rows.slice(-5);
            const firstBig = five[0];
            const lastBig = five[4];
            const middleThree = five.slice(1, 4);
            const middleContained = middleThree.every(c => c.high <= firstBig.high && c.low >= firstBig.low);
            const middleSmall = middleThree.every(c => c.body < firstBig.body * 0.6);

            if (firstBig.direction === 'BULLISH' && lastBig.direction === 'BULLISH'
                && lastBig.close > firstBig.close && middleContained && middleSmall
                && trend === 'UP') {
                addPattern('Rising Three Methods', 'BULLISH', 76, 'Continuation after pullback');
            }
            if (firstBig.direction === 'BEARISH' && lastBig.direction === 'BEARISH'
                && lastBig.close < firstBig.close && middleContained && middleSmall
                && trend === 'DOWN') {
                addPattern('Falling Three Methods', 'BEARISH', 76, 'Continuation after bounce');
            }
        }

        // ==================== END NEW PATTERNS ====================

        const bullishScore = patterns
            .filter(item => item.direction === 'BULLISH')
            .reduce((max, item) => Math.max(max, item.strength), 0);
        const bearishScore = patterns
            .filter(item => item.direction === 'BEARISH')
            .reduce((max, item) => Math.max(max, item.strength), 0);
        const direction = bullishScore > bearishScore ? 'BULLISH'
            : bearishScore > bullishScore ? 'BEARISH'
                : 'NEUTRAL';
        const primary = patterns
            .filter(item => item.direction === direction || direction === 'NEUTRAL')
            .sort((a, b) => b.strength - a.strength)[0] || null;

        return {
            direction,
            strength: Math.max(bullishScore, bearishScore),
            primary,
            patterns: patterns.slice(0, 5),
            trend
        };
    },

    // ==================== PIVOT + CANDLESTICK COMBO TRIGGER (John Person Method) ====================
    // From "Candlestick and Pivot Point Trading Triggers" by John L. Person
    // High accuracy: Candlestick pattern at pivot level = confirmed trade trigger
    calculatePivotCandleCombo: function(opens, highs, lows, closes, pivotData) {
        if (!pivotData || !pivotData.pivot) return null;
        const length = Math.min(opens?.length || 0, highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 3) return null;

        const currentClose = Number(closes[length - 1]);
        const currentLow = Number(lows[length - 1]);
        const currentHigh = Number(highs[length - 1]);
        if (!this.isNumber(currentClose)) return null;

        const candlePatterns = this.calculateCandlestickPatterns(opens, highs, lows, closes);
        if (!candlePatterns || !candlePatterns.patterns.length) return null;

        const { pivot, r1, r2, s1, s2 } = pivotData;
        const range = pivotData.range || (r1 - s1);
        const tolerance = range * 0.015; // 1.5% of range = "at level"

        // Check which pivot level price is near
        const levels = [
            { name: 'S2', value: s2, side: 'BULLISH' },
            { name: 'S1', value: s1, side: 'BULLISH' },
            { name: 'Pivot', value: pivot, side: null },
            { name: 'R1', value: r1, side: 'BEARISH' },
            { name: 'R2', value: r2, side: 'BEARISH' }
        ];

        let nearestLevel = null;
        let nearestDistance = Infinity;

        levels.forEach(level => {
            if (!this.isNumber(level.value)) return;
            const dist = Math.abs(currentClose - level.value);
            if (dist < nearestDistance && dist <= tolerance) {
                nearestDistance = dist;
                nearestLevel = level;
            }
            // Also check if low touched support or high touched resistance
            if (level.side === 'BULLISH' && Math.abs(currentLow - level.value) <= tolerance) {
                if (Math.abs(currentLow - level.value) < nearestDistance) {
                    nearestDistance = Math.abs(currentLow - level.value);
                    nearestLevel = level;
                }
            }
            if (level.side === 'BEARISH' && Math.abs(currentHigh - level.value) <= tolerance) {
                if (Math.abs(currentHigh - level.value) < nearestDistance) {
                    nearestDistance = Math.abs(currentHigh - level.value);
                    nearestLevel = level;
                }
            }
        });

        if (!nearestLevel) return { triggered: false, combo: null, boostScore: 0 };

        // Match candlestick direction with pivot level expectation
        const triggers = [];
        let boostScore = 0;

        candlePatterns.patterns.forEach(pattern => {
            // BULLISH pattern at SUPPORT level = BUY trigger
            if (pattern.direction === 'BULLISH' && nearestLevel.side === 'BULLISH') {
                const triggerStrength = Math.min(pattern.strength + 15, 98);
                triggers.push({
                    type: 'BUY_TRIGGER',
                    pattern: pattern.name,
                    level: nearestLevel.name,
                    levelPrice: nearestLevel.value,
                    strength: triggerStrength,
                    detail: `${pattern.name} at ${nearestLevel.name} (${nearestLevel.value.toFixed(2)}) — Strong BUY`
                });
                boostScore = Math.max(boostScore, 12);
            }

            // BEARISH pattern at RESISTANCE level = SELL trigger
            if (pattern.direction === 'BEARISH' && nearestLevel.side === 'BEARISH') {
                const triggerStrength = Math.min(pattern.strength + 15, 98);
                triggers.push({
                    type: 'SELL_TRIGGER',
                    pattern: pattern.name,
                    level: nearestLevel.name,
                    levelPrice: nearestLevel.value,
                    strength: triggerStrength,
                    detail: `${pattern.name} at ${nearestLevel.name} (${nearestLevel.value.toFixed(2)}) — Strong SELL`
                });
                boostScore = Math.max(boostScore, 12);
            }

            // Pattern at PIVOT (neutral level) - direction from pattern
            if (nearestLevel.name === 'Pivot' && pattern.direction !== 'NEUTRAL') {
                triggers.push({
                    type: pattern.direction === 'BULLISH' ? 'BUY_TRIGGER' : 'SELL_TRIGGER',
                    pattern: pattern.name,
                    level: 'Pivot',
                    levelPrice: pivot,
                    strength: pattern.strength + 8,
                    detail: `${pattern.name} at Pivot (${pivot.toFixed(2)}) — ${pattern.direction} bias`
                });
                boostScore = Math.max(boostScore, 8);
            }

            // COUNTER signal: Bullish at resistance or Bearish at support = WARNING
            if (pattern.direction === 'BULLISH' && nearestLevel.side === 'BEARISH') {
                triggers.push({
                    type: 'COUNTER_WARNING',
                    pattern: pattern.name,
                    level: nearestLevel.name,
                    levelPrice: nearestLevel.value,
                    strength: 0,
                    detail: `${pattern.name} at resistance ${nearestLevel.name} — may fail, resistance overhead`
                });
                boostScore = Math.min(boostScore, -5);
            }
            if (pattern.direction === 'BEARISH' && nearestLevel.side === 'BULLISH') {
                triggers.push({
                    type: 'COUNTER_WARNING',
                    pattern: pattern.name,
                    level: nearestLevel.name,
                    levelPrice: nearestLevel.value,
                    strength: 0,
                    detail: `${pattern.name} at support ${nearestLevel.name} — may fail, support below`
                });
                boostScore = Math.min(boostScore, -5);
            }
        });

        const bestTrigger = triggers
            .filter(t => t.type !== 'COUNTER_WARNING')
            .sort((a, b) => b.strength - a.strength)[0] || null;
        const warnings = triggers.filter(t => t.type === 'COUNTER_WARNING');

        return {
            triggered: Boolean(bestTrigger),
            combo: bestTrigger,
            warnings: warnings.slice(0, 2),
            allTriggers: triggers.slice(0, 5),
            nearestLevel,
            boostScore,
            direction: bestTrigger ? (bestTrigger.type === 'BUY_TRIGGER' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL'
        };
    },

    calculateFibonacciContext: function(highs, lows, closes, lookback = 55) {
        const length = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 10) return null;

        const cleanHighs = highs.slice(-lookback).map(Number).filter(Number.isFinite);
        const cleanLows = lows.slice(-lookback).map(Number).filter(Number.isFinite);
        const cleanCloses = closes.slice(-lookback).map(Number).filter(Number.isFinite);
        if (cleanHighs.length < 10 || cleanLows.length < 10 || cleanCloses.length < 10) return null;

        const high = Math.max(...cleanHighs);
        const low = Math.min(...cleanLows);
        const close = cleanCloses.at(-1);
        const range = high - low;
        if (!this.isNumber(range) || range <= 0 || !this.isNumber(close)) return null;

        const highIndex = cleanHighs.lastIndexOf(high);
        const lowIndex = cleanLows.lastIndexOf(low);
        const trend = lowIndex < highIndex ? 'UP' : highIndex < lowIndex ? 'DOWN' : this.inferShortTrend(cleanCloses, 8);
        const retracementRatios = [0.236, 0.382, 0.5, 0.618, 0.786];
        const extensionRatios = [1.272, 1.618, 2.0];
        const retracements = {};
        const extensions = {};

        retracementRatios.forEach(ratio => {
            retracements[String(ratio)] = trend === 'UP'
                ? high - (range * ratio)
                : low + (range * ratio);
        });
        extensionRatios.forEach(ratio => {
            extensions[String(ratio)] = trend === 'UP'
                ? low + (range * ratio)
                : high - (range * ratio);
        });

        const tolerance = Math.max(close * 0.0025, range * 0.015);
        const nearest = Object.entries(retracements)
            .map(([ratio, value]) => ({
                ratio,
                value,
                distance: Math.abs(close - value),
                distancePercent: close ? (Math.abs(close - value) / close) * 100 : 0
            }))
            .sort((a, b) => a.distance - b.distance)[0] || null;
        const goldenLow = Math.min(retracements['0.5'], retracements['0.618']);
        const goldenHigh = Math.max(retracements['0.5'], retracements['0.618']);
        const inGoldenZone = close >= goldenLow - tolerance && close <= goldenHigh + tolerance;
        const holdingGoldenZone = inGoldenZone && (trend === 'UP' ? close >= goldenLow : close <= goldenHigh);
        const breakout = trend === 'UP' && close > high ? 'EXTENSION_UP'
            : trend === 'DOWN' && close < low ? 'EXTENSION_DOWN'
                : 'NONE';
        const direction = trend === 'UP' && (holdingGoldenZone || breakout === 'EXTENSION_UP') ? 'BULLISH'
            : trend === 'DOWN' && (holdingGoldenZone || breakout === 'EXTENSION_DOWN') ? 'BEARISH'
                : 'NEUTRAL';
        const strength = Math.min(100,
            (inGoldenZone ? 36 : nearest && nearest.distance <= tolerance ? 24 : 0)
            + (breakout !== 'NONE' ? 34 : 0)
            + (trend !== 'NEUTRAL' ? 18 : 0)
        );

        return {
            direction,
            strength,
            trend,
            swingHigh: high,
            swingLow: low,
            currentPrice: close,
            retracements,
            extensions,
            nearest,
            inGoldenZone,
            holdingGoldenZone,
            breakout
        };
    },

    calculateChartPatterns: function(highs, lows, closes, lookback = 34) {
        const length = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 12) return null;

        const h = highs.slice(-lookback).map(Number).filter(Number.isFinite);
        const l = lows.slice(-lookback).map(Number).filter(Number.isFinite);
        const c = closes.slice(-lookback).map(Number).filter(Number.isFinite);
        const n = Math.min(h.length, l.length, c.length);
        if (n < 12) return null;

        const recentHigh = Math.max(...h);
        const recentLow = Math.min(...l);
        const close = c.at(-1);
        const range = recentHigh - recentLow;
        if (!this.isNumber(range) || range <= 0 || !this.isNumber(close)) return null;

        const tolerance = Math.max(close * 0.003, range * 0.035);
        const swingHighs = [];
        const swingLows = [];
        for (let i = 2; i < n - 2; i++) {
            if (h[i] >= h[i - 1] && h[i] >= h[i - 2] && h[i] >= h[i + 1] && h[i] >= h[i + 2]) {
                swingHighs.push({ index: i, value: h[i] });
            }
            if (l[i] <= l[i - 1] && l[i] <= l[i - 2] && l[i] <= l[i + 1] && l[i] <= l[i + 2]) {
                swingLows.push({ index: i, value: l[i] });
            }
        }

        const lastHighs = swingHighs.slice(-3);
        const lastLows = swingLows.slice(-3);
        const patterns = [];
        const addPattern = (name, direction, strength, trigger = '') => {
            patterns.push({ name, direction, strength, trigger });
        };

        if (lastHighs.length >= 2) {
            const [a, b] = lastHighs.slice(-2);
            if (Math.abs(a.value - b.value) <= tolerance && close < Math.min(...l.slice(a.index, n))) {
                addPattern('Double Top', 'BEARISH', 78, 'Neckline breakdown');
            }
        }

        if (lastLows.length >= 2) {
            const [a, b] = lastLows.slice(-2);
            if (Math.abs(a.value - b.value) <= tolerance && close > Math.max(...h.slice(a.index, n))) {
                addPattern('Double Bottom', 'BULLISH', 78, 'Neckline breakout');
            }
        }

        if (lastHighs.length >= 3) {
            const [left, head, right] = lastHighs;
            const shouldersClose = Math.abs(left.value - right.value) <= tolerance * 1.6;
            if (head.value > left.value + tolerance && head.value > right.value + tolerance && shouldersClose) {
                const neckline = Math.min(...lastLows.map(item => item.value));
                if (close < neckline) addPattern('Head and Shoulders', 'BEARISH', 86, 'Neckline breakdown');
            }
        }

        if (lastLows.length >= 3) {
            const [left, head, right] = lastLows;
            const shouldersClose = Math.abs(left.value - right.value) <= tolerance * 1.6;
            if (head.value < left.value - tolerance && head.value < right.value - tolerance && shouldersClose) {
                const neckline = Math.max(...lastHighs.map(item => item.value));
                if (close > neckline) addPattern('Inverse Head and Shoulders', 'BULLISH', 86, 'Neckline breakout');
            }
        }

        const firstHalfHigh = Math.max(...h.slice(0, Math.floor(n / 2)));
        const secondHalfHigh = Math.max(...h.slice(Math.floor(n / 2)));
        const firstHalfLow = Math.min(...l.slice(0, Math.floor(n / 2)));
        const secondHalfLow = Math.min(...l.slice(Math.floor(n / 2)));
        const contracting = (secondHalfHigh - secondHalfLow) < (firstHalfHigh - firstHalfLow) * 0.78;
        if (contracting && close > secondHalfHigh - tolerance) {
            addPattern('Triangle Breakout', 'BULLISH', 72, 'Range expansion up');
        } else if (contracting && close < secondHalfLow + tolerance) {
            addPattern('Triangle Breakdown', 'BEARISH', 72, 'Range expansion down');
        }

        const channelSlope = (c.at(-1) - c[0]) / Math.max(c[0], 1);
        const nearHigh = recentHigh - close <= tolerance;
        const nearLow = close - recentLow <= tolerance;
        if (channelSlope > 0.015 && nearHigh) addPattern('Ascending Channel Breakout', 'BULLISH', 64);
        if (channelSlope < -0.015 && nearLow) addPattern('Descending Channel Breakdown', 'BEARISH', 64);

        const bullishScore = patterns
            .filter(item => item.direction === 'BULLISH')
            .reduce((max, item) => Math.max(max, item.strength), 0);
        const bearishScore = patterns
            .filter(item => item.direction === 'BEARISH')
            .reduce((max, item) => Math.max(max, item.strength), 0);
        const direction = bullishScore > bearishScore ? 'BULLISH'
            : bearishScore > bullishScore ? 'BEARISH'
                : 'NEUTRAL';
        const primary = patterns
            .filter(item => item.direction === direction)
            .sort((a, b) => b.strength - a.strength)[0] || null;

        return {
            direction,
            strength: Math.max(bullishScore, bearishScore),
            primary,
            patterns: patterns.slice(0, 5),
            recentHigh,
            recentLow,
            currentPrice: close
        };
    },

    calculateMotherVolume: function(opens, highs, lows, closes, volumes, period = 252, averagePeriod = 20, multiplier = 1.8) {
        const length = Math.min(opens?.length || 0, highs?.length || 0, lows?.length || 0, closes?.length || 0, volumes?.length || 0);
        if (length < Math.max(averagePeriod + 1, 10)) return null;

        const currentVolume = Number(volumes[length - 1]);
        const currentOpen = Number(opens[length - 1]);
        const currentHigh = Number(highs[length - 1]);
        const currentLow = Number(lows[length - 1]);
        const currentClose = Number(closes[length - 1]);
        if (![currentVolume, currentOpen, currentHigh, currentLow, currentClose].every(Number.isFinite)) return null;

        const priorVolumes = volumes
            .slice(Math.max(0, length - period - 1), length - 1)
            .map(Number)
            .filter(Number.isFinite);
        const averageVolumes = volumes
            .slice(Math.max(0, length - averagePeriod - 1), length - 1)
            .map(Number)
            .filter(Number.isFinite);
        if (!priorVolumes.length || !averageVolumes.length) return null;

        const priorMax = Math.max(...priorVolumes);
        const average = averageVolumes.reduce((sum, value) => sum + value, 0) / averageVolumes.length;
        const ratio = average > 0 ? currentVolume / average : null;
        const maxRatio = priorMax > 0 ? currentVolume / priorMax : null;
        const direction = currentClose > currentOpen ? 'BULLISH' : currentClose < currentOpen ? 'BEARISH' : 'NEUTRAL';
        const closePosition = currentHigh > currentLow ? ((currentClose - currentLow) / (currentHigh - currentLow)) * 100 : 50;
        const recentHigh = Math.max(...highs.slice(Math.max(0, length - 21), length - 1).map(Number).filter(Number.isFinite));
        const recentLow = Math.min(...lows.slice(Math.max(0, length - 21), length - 1).map(Number).filter(Number.isFinite));
        const breakout = Number.isFinite(recentHigh) && currentClose > recentHigh ? 'UP'
            : Number.isFinite(recentLow) && currentClose < recentLow ? 'DOWN'
                : 'NONE';
        const isMother = currentVolume >= priorMax * 0.95 && this.isNumber(ratio) && ratio >= multiplier;

        return {
            current: currentVolume,
            average,
            priorMax,
            ratio,
            maxRatio,
            isMother,
            direction,
            closePosition,
            breakout,
            high: currentHigh,
            low: currentLow,
            close: currentClose
        };
    },

    calculateAdvancedRSIContext: function(closes, highs, lows, volumes, options = {}) {
        const period = options.period || 14;
        const overbought = options.overbought ?? 70;
        const oversold = options.oversold ?? 30;
        const heat = options.heat ?? 80;
        const warning = options.warning ?? 86;
        const rsiValues = this.calculateRSIValues(closes, period);
        if (!rsiValues || !rsiValues.length) return null;

        const current = rsiValues.at(-1);
        const previous = rsiValues.at(-2);
        if (!this.isNumber(current)) return null;

        const sma20 = this.calculateSMA(closes, options.confirmationSmaPeriod || 20);
        const bollinger = this.calculateBollingerBands(closes, options.bbPeriod || 20, options.bbStdDev || 2);
        const obv = this.calculateOBV(closes, volumes || [], options.obvFast || 12, options.obvSlow || 21);
        const currentClose = Number(closes.at(-1));
        const previousClose = Number(closes.at(-2));
        const bbBlastUp = bollinger && currentClose > bollinger.upper;
        const bbBlastDown = bollinger && currentClose < bollinger.lower;
        const priceAboveSma = this.isNumber(sma20) && currentClose > sma20;
        const priceBelowSma = this.isNumber(sma20) && currentClose < sma20;
        const obvBullish = obv?.direction === 'BULLISH';
        const obvBearish = obv?.direction === 'BEARISH';

        const recentRsi = rsiValues.filter(this.isNumber).slice(-(options.freshLookback || 20));
        const previousRecent = recentRsi.slice(0, -1);
        const freshAbove70 = current >= overbought && previousRecent.every(value => value < overbought);
        const freshBelow30 = current <= oversold && previousRecent.every(value => value > oversold);
        const sustainedAbove70 = recentRsi.slice(-3).filter(value => value >= overbought).length >= 2;
        const sustainedBelow30 = recentRsi.slice(-3).filter(value => value <= oversold).length >= 2;

        const crossedBackBelow70 = this.isNumber(previous) && previous >= overbought && current < overbought;
        const crossedBackAbove30 = this.isNumber(previous) && previous <= oversold && current > oversold;
        const bearishConfirmation = priceBelowSma || bbBlastDown || obvBearish || currentClose < previousClose;
        const bullishConfirmation = priceAboveSma || bbBlastUp || obvBullish || currentClose > previousClose;

        let zone = 'NEUTRAL';
        if (current >= warning) zone = 'WARNING_HEAT';
        else if (current >= heat) zone = 'OVERHEAT';
        else if (current >= overbought) zone = 'HEAT';
        else if (current <= oversold) zone = 'WEAK';
        else if (current < 50) zone = 'BEARISH_SIDE';
        else if (current > 50) zone = 'BULLISH_SIDE';

        let signal = 'HOLD';
        let direction = 'NEUTRAL';
        const reasons = [];

        if (crossedBackBelow70 && bearishConfirmation) {
            signal = 'SELL';
            direction = 'BEARISH';
            reasons.push('RSI came back below 70 with confirmation');
        } else if (crossedBackAbove30 && bullishConfirmation) {
            signal = 'BUY';
            direction = 'BULLISH';
            reasons.push('RSI came back above 30 with confirmation');
        } else if (current >= heat && (bbBlastUp || priceAboveSma || obvBullish)) {
            signal = 'BUY';
            direction = 'BULLISH';
            reasons.push('RSI heat zone has momentum confirmation');
        } else if (current <= oversold && (bbBlastDown || priceBelowSma || obvBearish)) {
            signal = 'SELL';
            direction = 'BEARISH';
            reasons.push('RSI weak zone has downside confirmation');
        } else if (current >= overbought && (freshAbove70 || sustainedAbove70)) {
            direction = 'BULLISH';
            reasons.push('RSI above 70 is treated as strength, not automatic sell');
        } else if (current <= oversold && (freshBelow30 || sustainedBelow30)) {
            direction = 'BEARISH';
            reasons.push('RSI below 30 is treated as weakness, not automatic buy');
        } else if (current > 50 && bullishConfirmation) {
            direction = 'BULLISH';
        } else if (current < 50 && bearishConfirmation) {
            direction = 'BEARISH';
        }

        return {
            value: current,
            previous,
            signal,
            direction,
            zone,
            crossedBackBelow70,
            crossedBackAbove30,
            freshAbove70,
            freshBelow30,
            sustainedAbove70,
            sustainedBelow30,
            bbBlastUp,
            bbBlastDown,
            priceAboveSma,
            priceBelowSma,
            obvDirection: obv?.direction || 'NEUTRAL',
            reasons
        };
    },

    calculateVWAP: function(highs, lows, closes, volumes, period = 50) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
            return null;
        }

        const length = Math.min(highs.length, lows.length, closes.length, volumes.length);
        if (length < 2) return null;

        const start = Math.max(0, length - period);
        let priceVolumeSum = 0;
        let volumeSum = 0;
        let fallbackPriceSum = 0;
        let fallbackCount = 0;

        for (let i = start; i < length; i++) {
            const high = Number(highs[i]);
            const low = Number(lows[i]);
            const close = Number(closes[i]);
            const volume = Number(volumes[i]);
            if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;

            const typicalPrice = (high + low + close) / 3;
            fallbackPriceSum += typicalPrice;
            fallbackCount += 1;

            if (Number.isFinite(volume) && volume > 0) {
                priceVolumeSum += typicalPrice * volume;
                volumeSum += volume;
            }
        }

        const currentPrice = Number(closes[length - 1]);
        const vwap = volumeSum > 0
            ? priceVolumeSum / volumeSum
            : fallbackCount
                ? fallbackPriceSum / fallbackCount
                : null;

        if (!this.isNumber(vwap) || !this.isNumber(currentPrice)) return null;

        return {
            vwap,
            currentPrice,
            distancePercent: ((currentPrice - vwap) / vwap) * 100,
            position: currentPrice > vwap ? 'ABOVE' : currentPrice < vwap ? 'BELOW' : 'AT',
            volumeBacked: volumeSum > 0
        };
    },

    calculatePivotPoints: function(highs, lows, closes) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;

        const cleanHighs = highs.map(price => Number(price)).filter(Number.isFinite);
        const cleanLows = lows.map(price => Number(price)).filter(Number.isFinite);
        const cleanCloses = closes.map(price => Number(price)).filter(Number.isFinite);
        if (cleanHighs.length < 2 || cleanLows.length < 2 || cleanCloses.length < 2) return null;

        const previousHigh = cleanHighs.at(-2);
        const previousLow = cleanLows.at(-2);
        const previousClose = cleanCloses.at(-2);
        const currentPrice = cleanCloses.at(-1);
        const range = previousHigh - previousLow;
        if (!this.isNumber(range) || range <= 0) return null;

        const pivot = (previousHigh + previousLow + previousClose) / 3;

        return {
            pivot,
            r1: (2 * pivot) - previousLow,
            s1: (2 * pivot) - previousHigh,
            r2: pivot + range,
            s2: pivot - range,
            r3: previousHigh + (2 * (pivot - previousLow)),
            s3: previousLow - (2 * (previousHigh - pivot)),
            currentPrice,
            previousHigh,
            previousLow,
            previousClose,
            range
        };
    },

    calculateSupportResistance: function(highs, lows, closes, opens = [], period = 34, swingLookback = 2) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;

        const length = Math.min(highs.length, lows.length, closes.length);
        if (length < Math.max(8, swingLookback * 2 + 3)) return null;

        const candles = [];
        for (let i = 0; i < length; i++) {
            const open = Number(opens[i]);
            const high = Number(highs[i]);
            const low = Number(lows[i]);
            const close = Number(closes[i]);
            if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close)) {
                candles.push({
                    open: Number.isFinite(open) ? open : close,
                    high,
                    low,
                    close,
                    index: i
                });
            }
        }
        if (candles.length < Math.max(8, swingLookback * 2 + 3)) return null;

        const latestCandle = candles.at(-1);
        const previousCandle = candles.at(-2);
        const currentPrice = latestCandle.close;
        const previousClose = previousCandle.close;
        const start = Math.max(0, candles.length - period - 1);
        const recent = candles.slice(start, -1);
        if (recent.length < Math.max(6, swingLookback * 2 + 1)) return null;

        const supportCandidates = [];
        const resistanceCandidates = [];
        const firstIndex = Math.max(swingLookback, start);
        const lastIndex = candles.length - 1 - swingLookback;

        for (let i = firstIndex; i < lastIndex; i++) {
            const candle = candles[i];
            const neighbors = candles.slice(i - swingLookback, i + swingLookback + 1);
            const isSwingLow = neighbors.every(item => candle.low <= item.low);
            const isSwingHigh = neighbors.every(item => candle.high >= item.high);

            if (isSwingLow) supportCandidates.push({ value: candle.low, index: candle.index });
            if (isSwingHigh) resistanceCandidates.push({ value: candle.high, index: candle.index });
        }

        const recentLow = Math.min(...recent.map(candle => candle.low));
        const recentHigh = Math.max(...recent.map(candle => candle.high));
        supportCandidates.push({ value: recentLow, index: recent.at(-1).index });
        resistanceCandidates.push({ value: recentHigh, index: recent.at(-1).index });

        const tolerance = Math.max(currentPrice * 0.0015, (recentHigh - recentLow) * 0.05);
        const supportLevels = this.clusterPriceLevels(supportCandidates, tolerance);
        const resistanceLevels = this.clusterPriceLevels(resistanceCandidates, tolerance);
        const supports = supportLevels
            .filter(level => level.value < currentPrice)
            .sort((a, b) => b.value - a.value);
        const resistances = resistanceLevels
            .filter(level => level.value > currentPrice)
            .sort((a, b) => a.value - b.value);

        const nearestSupport = supports[0] || null;
        const nearestResistance = resistances[0] || null;
        const breakout = this.calculateBreakoutState({
            currentPrice,
            previousClose,
            currentOpen: latestCandle.open,
            currentHigh: latestCandle.high,
            currentLow: latestCandle.low,
            supportLevels,
            resistanceLevels
        });

        return {
            currentPrice,
            previousClose,
            currentOpen: latestCandle.open,
            currentHigh: latestCandle.high,
            currentLow: latestCandle.low,
            support: nearestSupport,
            resistance: nearestResistance,
            supports: supports.slice(0, 3),
            resistances: resistances.slice(0, 3),
            supportLevels: supportLevels.slice(0, 6),
            resistanceLevels: resistanceLevels.slice(0, 6),
            supportDistancePercent: nearestSupport ? ((currentPrice - nearestSupport.value) / currentPrice) * 100 : null,
            resistanceDistancePercent: nearestResistance ? ((nearestResistance.value - currentPrice) / currentPrice) * 100 : null,
            breakout,
            lookback: recent.length
        };
    },

    calculateBreakoutState: function(context) {
        const {
            currentPrice,
            previousClose,
            currentOpen,
            currentHigh,
            currentLow,
            supportLevels = [],
            resistanceLevels = []
        } = context || {};

        if (!this.isNumber(currentPrice) || !this.isNumber(previousClose)) {
            return { up: null, down: null, fakeUp: null, fakeDown: null };
        }

        const settings = (typeof Config !== 'undefined' && Config.optionScanner?.breakout) || {};
        const minWickBreakPercent = Number(settings.minWickBreakPercent ?? 0.04);
        const minClosePositionPercent = Number(settings.minClosePositionPercent ?? 62);
        const maxWeakClosePercent = Number(settings.maxWeakClosePercent ?? 0.18);
        const minRejectionWickRatio = Number(settings.minRejectionWickRatio ?? 0.42);
        const safeHigh = this.isNumber(currentHigh) ? currentHigh : currentPrice;
        const safeLow = this.isNumber(currentLow) ? currentLow : currentPrice;
        const safeOpen = this.isNumber(currentOpen) ? currentOpen : previousClose;
        const candleRange = Math.max(safeHigh - safeLow, 0);
        const upperWick = Math.max(safeHigh - Math.max(safeOpen, currentPrice), 0);
        const lowerWick = Math.max(Math.min(safeOpen, currentPrice) - safeLow, 0);
        const upperWickRatio = candleRange ? upperWick / candleRange : 0;
        const lowerWickRatio = candleRange ? lowerWick / candleRange : 0;
        const closePositionPercent = candleRange ? ((currentPrice - safeLow) / candleRange) * 100 : 50;
        const closeFromHighPercent = 100 - closePositionPercent;

        const brokenResistance = resistanceLevels
            .filter(level => this.isNumber(level.value) && level.value < currentPrice && previousClose <= level.value)
            .sort((a, b) => b.value - a.value)[0] || null;
        const brokenSupport = supportLevels
            .filter(level => this.isNumber(level.value) && level.value > currentPrice && previousClose >= level.value)
            .sort((a, b) => a.value - b.value)[0] || null;

        const fakeUp = resistanceLevels
            .map(level => this.buildFakeBreakoutRisk({
                side: 'UP',
                level,
                currentPrice,
                previousClose,
                currentHigh: safeHigh,
                currentLow: safeLow,
                wickRatio: upperWickRatio,
                closePositionPercent,
                minWickBreakPercent,
                minClosePositionPercent,
                maxWeakClosePercent,
                minRejectionWickRatio
            }))
            .filter(Boolean)
            .sort((a, b) => Math.abs(a.value - currentPrice) - Math.abs(b.value - currentPrice))[0] || null;
        const fakeDown = supportLevels
            .map(level => this.buildFakeBreakoutRisk({
                side: 'DOWN',
                level,
                currentPrice,
                previousClose,
                currentHigh: safeHigh,
                currentLow: safeLow,
                wickRatio: lowerWickRatio,
                closePositionPercent: closeFromHighPercent,
                minWickBreakPercent,
                minClosePositionPercent,
                maxWeakClosePercent,
                minRejectionWickRatio
            }))
            .filter(Boolean)
            .sort((a, b) => Math.abs(a.value - currentPrice) - Math.abs(b.value - currentPrice))[0] || null;

        return {
            up: brokenResistance ? {
                level: brokenResistance,
                closePercent: ((currentPrice - brokenResistance.value) / brokenResistance.value) * 100,
                previousClose,
                currentPrice
            } : null,
            down: brokenSupport ? {
                level: brokenSupport,
                closePercent: ((brokenSupport.value - currentPrice) / brokenSupport.value) * 100,
                previousClose,
                currentPrice
            } : null,
            fakeUp: fakeUp ? {
                level: fakeUp,
                wickPercent: fakeUp.wickPercent,
                reason: fakeUp.reason,
                wickRatio: fakeUp.wickRatio,
                closePositionPercent: fakeUp.closePositionPercent,
                previousClose,
                currentPrice
            } : null,
            fakeDown: fakeDown ? {
                level: fakeDown,
                wickPercent: fakeDown.wickPercent,
                reason: fakeDown.reason,
                wickRatio: fakeDown.wickRatio,
                closePositionPercent: fakeDown.closePositionPercent,
                previousClose,
                currentPrice
            } : null
        };
    },

    buildFakeBreakoutRisk: function(context) {
        const {
            side,
            level,
            currentPrice,
            previousClose,
            currentHigh,
            currentLow,
            wickRatio,
            closePositionPercent,
            minWickBreakPercent,
            minClosePositionPercent,
            maxWeakClosePercent,
            minRejectionWickRatio
        } = context || {};
        if (!level || !this.isNumber(level.value)) return null;

        const levelValue = Number(level.value);
        const isUp = side === 'UP';
        const pierced = isUp
            ? this.isNumber(currentHigh) && currentHigh > levelValue
            : this.isNumber(currentLow) && currentLow < levelValue;
        const previousWasInside = isUp
            ? previousClose <= levelValue
            : previousClose >= levelValue;
        if (!pierced || !previousWasInside) return null;

        const wickPercent = isUp
            ? ((currentHigh - levelValue) / levelValue) * 100
            : ((levelValue - currentLow) / levelValue) * 100;
        if (!Number.isFinite(wickPercent) || wickPercent < minWickBreakPercent) return null;

        const closePercent = isUp
            ? ((currentPrice - levelValue) / levelValue) * 100
            : ((levelValue - currentPrice) / levelValue) * 100;
        const closedBackInside = isUp ? currentPrice <= levelValue : currentPrice >= levelValue;
        const weakCloseOutside = closePercent > 0
            && closePercent <= maxWeakClosePercent
            && closePositionPercent < minClosePositionPercent;
        const rejectionWick = wickRatio >= minRejectionWickRatio
            && closePositionPercent < minClosePositionPercent;

        if (!closedBackInside && !weakCloseOutside && !rejectionWick) return null;

        return {
            ...level,
            wickPercent,
            closePercent,
            wickRatio,
            closePositionPercent,
            reason: closedBackInside
                ? 'closed back inside level'
                : weakCloseOutside
                    ? 'weak close beyond level'
                    : 'rejection wick near level'
        };
    },

    clusterPriceLevels: function(levels, tolerance) {
        if (!Array.isArray(levels) || !levels.length) return [];
        const safeTolerance = Number.isFinite(Number(tolerance)) && tolerance > 0 ? tolerance : 0.01;
        const sorted = levels
            .map(level => ({
                value: Number(level.value),
                index: Number(level.index || 0)
            }))
            .filter(level => Number.isFinite(level.value))
            .sort((a, b) => a.value - b.value);

        const clusters = [];
        sorted.forEach(level => {
            const cluster = clusters.find(item => Math.abs(item.value - level.value) <= safeTolerance);
            if (cluster) {
                cluster.values.push(level.value);
                cluster.touches += 1;
                cluster.latestIndex = Math.max(cluster.latestIndex, level.index);
                cluster.value = cluster.values.reduce((sum, value) => sum + value, 0) / cluster.values.length;
            } else {
                clusters.push({
                    value: level.value,
                    values: [level.value],
                    touches: 1,
                    latestIndex: level.index
                });
            }
        });

        return clusters
            .map(cluster => ({
                value: cluster.value,
                touches: cluster.touches,
                latestIndex: cluster.latestIndex
            }))
            .sort((a, b) => b.touches - a.touches || b.latestIndex - a.latestIndex);
    },

    calculateMACD: function(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (!Array.isArray(prices) || prices.length < slowPeriod + signalPeriod) return null;

        const fastValues = this.calculateEMAValues(prices, fastPeriod);
        const slowValues = this.calculateEMAValues(prices, slowPeriod);
        const macdSeries = [];

        for (let i = 0; i < prices.length; i++) {
            if (this.isNumber(fastValues[i]) && this.isNumber(slowValues[i])) {
                macdSeries.push(fastValues[i] - slowValues[i]);
            }
        }

        if (macdSeries.length < signalPeriod) return null;

        const signalLine = this.calculateEMA(macdSeries, signalPeriod);
        const macdLine = macdSeries.at(-1);
        if (!this.isNumber(macdLine) || !this.isNumber(signalLine)) return null;

        return {
            macd: macdLine,
            signal: signalLine,
            histogram: macdLine - signalLine
        };
    },

    calculateBollingerBands: function(prices, period = 20, stdDev = 2) {
        if (!Array.isArray(prices) || prices.length < period) return null;

        const sma = this.calculateSMA(prices, period);
        const recentPrices = prices.slice(-period);
        const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);

        return {
            middle: sma,
            upper: sma + (stdDev * standardDeviation),
            lower: sma - (stdDev * standardDeviation),
            bandwidth: sma ? ((stdDev * standardDeviation * 2) / sma) * 100 : 0,
            currentPrice: prices.at(-1)
        };
    },

    calculateATR: function(highs, lows, closes, period = 14) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;
        if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;

        const trueRanges = [];
        for (let i = 1; i < highs.length; i++) {
            trueRanges.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            ));
        }

        return this.calculateEMA(trueRanges, period);
    },

    calculateADX: function(highs, lows, closes, period = 14) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;
        if (highs.length < period * 2 || lows.length < period * 2 || closes.length < period * 2) return null;

        const plusDM = [];
        const minusDM = [];
        const trueRanges = [];

        for (let i = 1; i < highs.length; i++) {
            const upMove = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];

            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
            trueRanges.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            ));
        }

        const smoothedTR = this.calculateEMAValues(trueRanges, period);
        const smoothedPlusDM = this.calculateEMAValues(plusDM, period);
        const smoothedMinusDM = this.calculateEMAValues(minusDM, period);
        const dxSeries = [];

        for (let i = 0; i < trueRanges.length; i++) {
            const tr = smoothedTR[i];
            if (!tr) continue;

            const plusDI = (smoothedPlusDM[i] / tr) * 100;
            const minusDI = (smoothedMinusDM[i] / tr) * 100;
            const denominator = plusDI + minusDI;
            if (!denominator) continue;

            dxSeries.push(Math.abs((plusDI - minusDI) / denominator) * 100);
        }

        const adx = this.calculateEMA(dxSeries, period);
        const lastTR = smoothedTR.at(-1);
        if (!this.isNumber(adx) || !lastTR) return null;

        return {
            adx: adx,
            plusDI: (smoothedPlusDM.at(-1) / lastTR) * 100,
            minusDI: (smoothedMinusDM.at(-1) / lastTR) * 100
        };
    },

    calculateStochastic: function(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;
        if (closes.length < kPeriod + dPeriod) return null;

        const kValues = [];
        for (let i = kPeriod - 1; i < closes.length; i++) {
            const recentHighs = highs.slice(i - kPeriod + 1, i + 1);
            const recentLows = lows.slice(i - kPeriod + 1, i + 1);
            const highestHigh = Math.max(...recentHighs);
            const lowestLow = Math.min(...recentLows);
            const range = highestHigh - lowestLow;
            kValues.push(range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100);
        }

        const k = kValues.at(-1);
        const d = this.calculateSMA(kValues, dPeriod);
        if (!this.isNumber(k) || !this.isNumber(d)) return null;

        return { k, d };
    },

    // ==================== VOLUME PRICE ANALYSIS (VPA) ENGINE ====================
    // Based on Anna Coulling's "A Complete Guide to Volume Price Analysis"
    // Core concept: Volume validates price - high volume = genuine move, low volume = weak/fake move
    
    calculateVPA: function(opens, highs, lows, closes, volumes, lookback = 20) {
        const length = Math.min(
            opens?.length || 0, highs?.length || 0,
            lows?.length || 0, closes?.length || 0, volumes?.length || 0
        );
        if (length < Math.max(lookback, 8)) return null;

        // Prepare current and recent candle data
        const idx = length - 1;
        const currentOpen = Number(opens[idx]);
        const currentHigh = Number(highs[idx]);
        const currentLow = Number(lows[idx]);
        const currentClose = Number(closes[idx]);
        const currentVolume = Number(volumes[idx]);
        if (![currentOpen, currentHigh, currentLow, currentClose, currentVolume].every(Number.isFinite)) return null;

        const prevOpen = Number(opens[idx - 1]);
        const prevHigh = Number(highs[idx - 1]);
        const prevLow = Number(lows[idx - 1]);
        const prevClose = Number(closes[idx - 1]);
        const prevVolume = Number(volumes[idx - 1]);

        // Calculate averages for comparison
        const recentVolumes = [];
        const recentSpreads = [];
        const recentBodies = [];
        for (let i = Math.max(0, length - lookback - 1); i < idx; i++) {
            const v = Number(volumes[i]);
            const h = Number(highs[i]);
            const l = Number(lows[i]);
            const o = Number(opens[i]);
            const c = Number(closes[i]);
            if (Number.isFinite(v) && Number.isFinite(h) && Number.isFinite(l)) {
                recentVolumes.push(v);
                recentSpreads.push(h - l);
                if (Number.isFinite(o) && Number.isFinite(c)) recentBodies.push(Math.abs(c - o));
            }
        }
        if (recentVolumes.length < 5) return null;

        const avgVolume = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length;
        const avgSpread = recentSpreads.reduce((s, v) => s + v, 0) / recentSpreads.length;
        const avgBody = recentBodies.length ? recentBodies.reduce((s, v) => s + v, 0) / recentBodies.length : avgSpread * 0.6;

        // Current candle metrics
        const spread = currentHigh - currentLow;
        const body = Math.abs(currentClose - currentOpen);
        const isBullish = currentClose > currentOpen;
        const isBearish = currentClose < currentOpen;
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        const spreadRatio = avgSpread > 0 ? spread / avgSpread : 1;
        const bodyRatio = avgBody > 0 ? body / avgBody : 1;

        // Close position within the candle (0 = bottom, 100 = top)
        const closePosition = spread > 0 ? ((currentClose - currentLow) / spread) * 100 : 50;

        const signals = [];
        let direction = 'NEUTRAL';
        let strength = 0;

        // === 1. CLIMAX VOLUME (Ultra-high volume + wide spread = reversal warning) ===
        // Coulling: "Climax volume marks the end of a move"
        if (volumeRatio >= 2.5 && spreadRatio >= 1.5) {
            if (isBullish && closePosition >= 60) {
                // Buying climax at top - potential reversal down
                signals.push({ name: 'Buying Climax', direction: 'BEARISH', strength: 78, detail: `Vol ${volumeRatio.toFixed(1)}x, spread ${spreadRatio.toFixed(1)}x` });
            } else if (isBearish && closePosition <= 40) {
                // Selling climax at bottom - potential reversal up
                signals.push({ name: 'Selling Climax', direction: 'BULLISH', strength: 78, detail: `Vol ${volumeRatio.toFixed(1)}x, spread ${spreadRatio.toFixed(1)}x` });
            }
        }

        // === 2. NO DEMAND BAR (Low volume + narrow up bar = weak buying, bearish) ===
        // Coulling: "If volume is low on an up bar, there is no demand"
        if (isBullish && volumeRatio <= 0.6 && spreadRatio <= 0.7 && closePosition <= 55) {
            signals.push({ name: 'No Demand', direction: 'BEARISH', strength: 62, detail: 'Low vol narrow up bar - weak buying' });
        }

        // === 3. NO SUPPLY BAR (Low volume + narrow down bar = weak selling, bullish) ===
        // Coulling: "If volume is low on a down bar, there is no supply"
        if (isBearish && volumeRatio <= 0.6 && spreadRatio <= 0.7 && closePosition >= 45) {
            signals.push({ name: 'No Supply', direction: 'BULLISH', strength: 62, detail: 'Low vol narrow down bar - weak selling' });
        }

        // === 4. STOPPING VOLUME (High volume + narrow spread at bottom = accumulation) ===
        // Coulling: "Stopping volume halts a down move"
        const trend = this.inferShortTrend(
            closes.slice(Math.max(0, length - 8), length).map(Number).filter(Number.isFinite),
            6
        );

        if (volumeRatio >= 1.8 && spreadRatio <= 0.6 && trend === 'DOWN') {
            // High volume but price not dropping further = smart money absorbing
            if (closePosition >= 40) {
                signals.push({ name: 'Stopping Volume', direction: 'BULLISH', strength: 74, detail: 'High vol absorbed at support' });
            }
        }
        // Inverse: high volume narrow spread at top in uptrend
        if (volumeRatio >= 1.8 && spreadRatio <= 0.6 && trend === 'UP') {
            if (closePosition <= 60) {
                signals.push({ name: 'Supply Overcoming', direction: 'BEARISH', strength: 74, detail: 'High vol absorbed at resistance' });
            }
        }

        // === 5. EFFORT vs RESULT (Most powerful fake detection) ===
        // Coulling: "If effort (volume) does not match result (price movement), the move is suspect"
        // High volume but narrow spread = effort without result = TRAP
        if (volumeRatio >= 1.8 && spreadRatio <= 0.5) {
            if (isBullish) {
                // High effort to push up but small result = fake up move / distribution
                signals.push({ name: 'Effort No Result (Up)', direction: 'BEARISH', strength: 82, detail: 'High vol + tiny up move = TRAP' });
            } else if (isBearish) {
                // High effort to push down but small result = fake down move / accumulation
                signals.push({ name: 'Effort No Result (Down)', direction: 'BULLISH', strength: 82, detail: 'High vol + tiny down move = TRAP' });
            }
        }
        // Low volume but wide spread = no effort with big result = unsustainable
        if (volumeRatio <= 0.5 && spreadRatio >= 1.5) {
            if (isBullish) {
                // Big up move on no volume = not backed, will fade
                signals.push({ name: 'No Effort Big Result (Up)', direction: 'BEARISH', strength: 68, detail: 'Wide up bar on low vol = unsustainable' });
            } else if (isBearish) {
                // Big down move on no volume = panic selling, not genuine
                signals.push({ name: 'No Effort Big Result (Down)', direction: 'BULLISH', strength: 68, detail: 'Wide down bar on low vol = unsustainable' });
            }
        }

        // === 6. ABSORPTION VOLUME (Volume absorbed without price change = strong level) ===
        // Coulling: "When volume is absorbed, price tests and holds"
        if (Number.isFinite(prevVolume) && Number.isFinite(prevHigh) && Number.isFinite(prevLow)) {
            const prevSpread = prevHigh - prevLow;
            const prevVolumeRatio = avgVolume > 0 ? prevVolume / avgVolume : 1;
            const twoBarVol = (currentVolume + prevVolume) / 2;
            const twoBarVolRatio = avgVolume > 0 ? twoBarVol / avgVolume : 1;
            const priceChange = Math.abs(currentClose - prevClose);
            const priceChangePercent = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;

            // Two consecutive bars with high volume but price barely moved
            if (twoBarVolRatio >= 1.6 && priceChangePercent <= 0.15) {
                if (trend === 'DOWN') {
                    signals.push({ name: 'Absorption at Support', direction: 'BULLISH', strength: 72, detail: '2-bar high vol, price held = support' });
                } else if (trend === 'UP') {
                    signals.push({ name: 'Absorption at Resistance', direction: 'BEARISH', strength: 72, detail: '2-bar high vol, price held = resistance' });
                }
            }
        }

        // === 7. TEST BAR (Pullback on low volume = confirming previous move) ===
        // Coulling: "A test on low volume confirms the level is genuine"
        if (volumeRatio <= 0.5 && spreadRatio <= 0.6) {
            if (trend === 'UP' && isBearish && closePosition >= 50) {
                // Small pullback on low volume in uptrend = successful test = BUY
                signals.push({ name: 'Successful Test', direction: 'BULLISH', strength: 70, detail: 'Low vol pullback held = trend continues' });
            } else if (trend === 'DOWN' && isBullish && closePosition <= 50) {
                // Small bounce on low volume in downtrend = failed test = SELL
                signals.push({ name: 'Failed Test', direction: 'BEARISH', strength: 70, detail: 'Low vol bounce failed = trend continues' });
            }
        }

        // === ACCUMULATION / DISTRIBUTION DETECTION ===
        // Check last 5 bars for accumulation (high vol at lows) or distribution (high vol at highs)
        let accumScore = 0;
        let distScore = 0;
        const recentBars = Math.min(5, idx);
        for (let i = idx - recentBars; i < idx; i++) {
            const barVol = Number(volumes[i]);
            const barClose = Number(closes[i]);
            const barOpen = Number(opens[i]);
            const barHigh = Number(highs[i]);
            const barLow = Number(lows[i]);
            if (![barVol, barClose, barOpen, barHigh, barLow].every(Number.isFinite)) continue;

            const barSpread = barHigh - barLow;
            const barClosePos = barSpread > 0 ? ((barClose - barLow) / barSpread) * 100 : 50;
            const barVolRatio = avgVolume > 0 ? barVol / avgVolume : 1;

            // Accumulation: high volume bars closing in upper half during downtrend
            if (barVolRatio >= 1.3 && barClosePos >= 55 && barClose < barOpen + barSpread * 0.1) {
                accumScore++;
            }
            // Distribution: high volume bars closing in lower half during uptrend
            if (barVolRatio >= 1.3 && barClosePos <= 45 && barClose > barOpen - barSpread * 0.1) {
                distScore++;
            }
        }

        if (accumScore >= 3 && trend === 'DOWN') {
            signals.push({ name: 'Accumulation Phase', direction: 'BULLISH', strength: 76, detail: `${accumScore} accumulation bars detected` });
        }
        if (distScore >= 3 && trend === 'UP') {
            signals.push({ name: 'Distribution Phase', direction: 'BEARISH', strength: 76, detail: `${distScore} distribution bars detected` });
        }

        // === DETERMINE OVERALL VPA DIRECTION ===
        const bullishSignals = signals.filter(s => s.direction === 'BULLISH');
        const bearishSignals = signals.filter(s => s.direction === 'BEARISH');
        const bullishScore = bullishSignals.reduce((max, s) => Math.max(max, s.strength), 0);
        const bearishScore = bearishSignals.reduce((max, s) => Math.max(max, s.strength), 0);

        if (bullishScore > bearishScore && bullishScore >= 60) {
            direction = 'BULLISH';
            strength = bullishScore;
        } else if (bearishScore > bullishScore && bearishScore >= 60) {
            direction = 'BEARISH';
            strength = bearishScore;
        }

        const primary = signals
            .filter(s => s.direction === direction || direction === 'NEUTRAL')
            .sort((a, b) => b.strength - a.strength)[0] || null;

        // Effort vs Result flag - separate output for fake call filtering
        const effortNoResult = signals.some(s => s.name.startsWith('Effort No Result'));
        const noEffortBigResult = signals.some(s => s.name.startsWith('No Effort Big Result'));
        const isFakeMove = effortNoResult || noEffortBigResult;

        return {
            direction,
            strength,
            primary,
            signals: signals.slice(0, 5),
            volumeRatio: Number(volumeRatio.toFixed(2)),
            spreadRatio: Number(spreadRatio.toFixed(2)),
            closePosition: Number(closePosition.toFixed(1)),
            trend,
            isFakeMove,
            effortNoResult,
            accumulation: accumScore >= 3,
            distribution: distScore >= 3,
            signalCount: signals.length
        };
    },

    // ==================== END VPA ENGINE ====================

    // ==================== FISCHER SYNERGY ENGINE ====================
    // Based on Robert Fischer's "Candlesticks, Fibonacci, and Chart Pattern Trading Tools"
    // Chapter 6: Merging Fibonacci with Candlesticks and Chart Patterns
    // Signal only fires when multiple confirmations align - reduces fake calls significantly
    
    calculateFischerSynergy: function(indicators) {
        if (!indicators) return null;

        const fib = indicators.FibonacciContext;
        const candles = indicators.CandlestickPatterns;
        const charts = indicators.ChartPatterns;
        const volume = indicators.Volume;
        const obv = indicators.OBV;
        const adx = indicators.ADX;
        const macd = indicators.MACD;
        const advRsi = indicators.AdvancedRSI;

        const confirmations = [];
        let direction = 'NEUTRAL';
        let synergyScore = 0;
        let fibLevel = null;
        let priceTarget = null;
        let timeTarget = null;

        // === LAYER 1: Fibonacci Position (Is price at a key Fibonacci level?) ===
        let fibConfirm = false;
        let fibStrength = 0;
        if (fib && fib.direction !== 'NEUTRAL') {
            if (fib.inGoldenZone) {
                // Price is in 50-61.8% golden zone - strongest Fibonacci signal
                fibConfirm = true;
                fibStrength = 40;
                fibLevel = 'Golden Zone (50-61.8%)';
                confirmations.push({ source: 'Fibonacci', detail: 'Price in Golden Zone', weight: 40 });
            } else if (fib.nearest && fib.nearest.distancePercent <= 0.5) {
                // Price is within 0.5% of any Fibonacci level
                fibConfirm = true;
                fibStrength = 30;
                fibLevel = `Fib ${(Number(fib.nearest.ratio) * 100).toFixed(1)}%`;
                confirmations.push({ source: 'Fibonacci', detail: `Near ${fibLevel}`, weight: 30 });
            } else if (fib.breakout !== 'NONE') {
                // Price has broken Fibonacci extension
                fibConfirm = true;
                fibStrength = 35;
                fibLevel = 'Extension Breakout';
                confirmations.push({ source: 'Fibonacci', detail: 'Extension breakout', weight: 35 });
            }
        }

        // === LAYER 2: Candlestick Pattern Confirmation ===
        let candleConfirm = false;
        let candleStrength = 0;
        if (candles && candles.direction !== 'NEUTRAL' && candles.strength >= 64) {
            candleConfirm = true;
            candleStrength = Math.min(35, candles.strength * 0.4);
            const patternName = candles.primary ? candles.primary.name : 'Pattern';
            confirmations.push({ source: 'Candlestick', detail: patternName, weight: candleStrength });
        }

        // === LAYER 3: Chart Pattern Confirmation ===
        let chartConfirm = false;
        let chartStrength = 0;
        if (charts && charts.direction !== 'NEUTRAL' && charts.strength >= 70) {
            chartConfirm = true;
            chartStrength = Math.min(30, charts.strength * 0.35);
            const patternName = charts.primary ? charts.primary.name : 'Chart Pattern';
            confirmations.push({ source: 'ChartPattern', detail: patternName, weight: chartStrength });
        }

        // === LAYER 4: Volume Confirmation ===
        let volumeConfirm = false;
        let volumeStrength = 0;
        if (volume && this.isNumber(volume.ratio) && volume.ratio >= 1.3) {
            volumeConfirm = true;
            volumeStrength = Math.min(20, volume.ratio * 8);
            confirmations.push({ source: 'Volume', detail: `${volume.ratio.toFixed(1)}x avg`, weight: volumeStrength });
        } else if (obv && obv.direction !== 'NEUTRAL') {
            volumeConfirm = true;
            volumeStrength = 15;
            confirmations.push({ source: 'OBV', detail: obv.direction, weight: volumeStrength });
        }

        // === LAYER 5: Momentum Confirmation (ADX/MACD/RSI) ===
        let momentumConfirm = false;
        let momentumStrength = 0;
        let momentumDirection = 'NEUTRAL';
        
        if (adx && this.isNumber(adx.adx) && adx.adx > 22) {
            momentumConfirm = true;
            momentumDirection = adx.plusDI > adx.minusDI ? 'BULLISH' : 'BEARISH';
            momentumStrength += 12;
        }
        if (macd && this.isNumber(macd.histogram)) {
            if (macd.histogram > 0 && macd.macd > macd.signal) {
                momentumConfirm = true;
                if (momentumDirection === 'NEUTRAL') momentumDirection = 'BULLISH';
                momentumStrength += 10;
            } else if (macd.histogram < 0 && macd.macd < macd.signal) {
                momentumConfirm = true;
                if (momentumDirection === 'NEUTRAL') momentumDirection = 'BEARISH';
                momentumStrength += 10;
            }
        }
        if (advRsi && advRsi.signal && advRsi.signal !== 'HOLD') {
            momentumConfirm = true;
            if (momentumDirection === 'NEUTRAL') momentumDirection = advRsi.direction;
            momentumStrength += 10;
        }
        if (momentumConfirm) {
            confirmations.push({ source: 'Momentum', detail: momentumDirection, weight: momentumStrength });
        }

        // === LAYER 6: VPA (Volume Price Analysis) Confirmation ===
        let vpaConfirm = false;
        let vpaStrength = 0;
        let vpaDirection = 'NEUTRAL';
        const vpa = indicators.VPA;
        if (vpa && vpa.direction !== 'NEUTRAL' && vpa.strength >= 62) {
            vpaConfirm = true;
            vpaDirection = vpa.direction;
            vpaStrength = Math.min(25, vpa.strength * 0.3);
            const detail = vpa.primary ? vpa.primary.name : 'VPA Signal';
            confirmations.push({ source: 'VPA', detail: detail, weight: vpaStrength });
        }

        // === VPA FAKE MOVE FILTER ===
        // If VPA detects Effort vs Result mismatch, flag potential fake
        let vpaFakeWarning = false;
        if (vpa && vpa.isFakeMove) {
            vpaFakeWarning = true;
        }

        // === SYNERGY DECISION: Need at least 2 confirmations in same direction ===
        const confirmCount = [fibConfirm, candleConfirm, chartConfirm, volumeConfirm, momentumConfirm, vpaConfirm]
            .filter(Boolean).length;

        if (confirmCount < 2) {
            // Not enough confirmations - no synergy signal
            return {
                direction: 'NEUTRAL',
                signal: 'HOLD',
                synergyScore: 0,
                confirmations: [],
                confirmCount: confirmCount,
                fibLevel: null,
                priceTarget: null,
                timeTarget: null,
                reason: 'Insufficient confirmations (need 2+)'
            };
        }

        // Determine direction by majority vote of confirmations
        let bullishVotes = 0;
        let bearishVotes = 0;

        if (fibConfirm && fib) {
            if (fib.direction === 'BULLISH') bullishVotes++;
            else if (fib.direction === 'BEARISH') bearishVotes++;
        }
        if (candleConfirm && candles) {
            if (candles.direction === 'BULLISH') bullishVotes++;
            else if (candles.direction === 'BEARISH') bearishVotes++;
        }
        if (chartConfirm && charts) {
            if (charts.direction === 'BULLISH') bullishVotes++;
            else if (charts.direction === 'BEARISH') bearishVotes++;
        }
        if (volumeConfirm && volume) {
            if (volume.priceDirection === 'UP') bullishVotes++;
            else if (volume.priceDirection === 'DOWN') bearishVotes++;
        }
        if (momentumConfirm) {
            if (momentumDirection === 'BULLISH') bullishVotes++;
            else if (momentumDirection === 'BEARISH') bearishVotes++;
        }
        if (vpaConfirm) {
            if (vpaDirection === 'BULLISH') bullishVotes++;
            else if (vpaDirection === 'BEARISH') bearishVotes++;
        }

        // Need clear majority - if split, no signal
        if (bullishVotes === bearishVotes || (bullishVotes === 0 && bearishVotes === 0)) {
            return {
                direction: 'NEUTRAL',
                signal: 'HOLD',
                synergyScore: 0,
                confirmations: confirmations,
                confirmCount: confirmCount,
                fibLevel: fibLevel,
                priceTarget: null,
                timeTarget: null,
                reason: 'Conflicting directions'
            };
        }

        direction = bullishVotes > bearishVotes ? 'BULLISH' : 'BEARISH';
        synergyScore = fibStrength + candleStrength + chartStrength + volumeStrength + momentumStrength + vpaStrength;

        // === VPA FAKE MOVE PENALTY ===
        // If VPA detects effort-no-result AND direction conflicts with VPA, penalize score
        if (vpaFakeWarning && vpa && vpa.direction !== 'NEUTRAL' && vpa.direction !== direction) {
            synergyScore = synergyScore * 0.6; // 40% penalty for potential fake move
        }

        // === FISCHER PRICE TARGET (Dual Ratio Extension) ===
        // Based on Chapter 4: using 0.618 correction x 1.618 extension for target
        if (fib && this.isNumber(fib.swingHigh) && this.isNumber(fib.swingLow) && this.isNumber(fib.currentPrice)) {
            const range = fib.swingHigh - fib.swingLow;
            if (direction === 'BULLISH') {
                // Target: correction low + range * 1.618
                const correctionLow = fib.swingHigh - (range * 0.618);
                priceTarget = {
                    conservative: fib.swingHigh, // Previous high
                    moderate: correctionLow + (range * 1.272),
                    aggressive: correctionLow + (range * 1.618),
                    method: 'Fischer Dual Ratio (0.618 x 1.618)'
                };
            } else {
                // Target: correction high - range * 1.618
                const correctionHigh = fib.swingLow + (range * 0.618);
                priceTarget = {
                    conservative: fib.swingLow, // Previous low
                    moderate: correctionHigh - (range * 1.272),
                    aggressive: correctionHigh - (range * 1.618),
                    method: 'Fischer Dual Ratio (0.618 x 1.618)'
                };
            }
        }

        // === FISCHER TIME TARGET (PHI-ratio based) ===
        // Time between swings * 1.618 = expected next move duration
        if (fib && this.isNumber(fib.swingHigh) && this.isNumber(fib.swingLow)) {
            // Approximate: use lookback as swing duration proxy
            const swingDuration = 55; // default lookback candles
            timeTarget = {
                phiCandles: Math.round(swingDuration * 0.618), // First PHI target
                phiExtended: Math.round(swingDuration * 1.618), // Extended PHI target
                method: 'Fischer PHI Time Analysis'
            };
        }

        // === BONUS: Fischer's 3-level confirmation quality grade ===
        let quality = 'STANDARD';
        if (fibConfirm && candleConfirm && (chartConfirm || volumeConfirm || vpaConfirm)) {
            quality = 'HIGH'; // Fibonacci + Candlestick + one more = Fischer's ideal
            synergyScore = Math.min(100, synergyScore * 1.2); // 20% bonus
        }
        if (fibConfirm && candleConfirm && chartConfirm && (volumeConfirm || vpaConfirm)) {
            quality = 'PREMIUM'; // 4+ confirm = extremely reliable
            synergyScore = Math.min(100, synergyScore * 1.35); // 35% bonus
        }
        if (fibConfirm && candleConfirm && chartConfirm && volumeConfirm && vpaConfirm) {
            quality = 'ULTRA'; // All 5 confirm including VPA = highest confidence
            synergyScore = Math.min(100, synergyScore * 1.5); // 50% bonus
        }

        const signal = synergyScore >= 45 ? (direction === 'BULLISH' ? 'BUY' : 'SELL') : 'HOLD';

        return {
            direction,
            signal,
            synergyScore: Math.round(synergyScore),
            strength: Math.round(synergyScore),
            quality,
            confirmations,
            confirmCount,
            fibLevel,
            priceTarget,
            timeTarget,
            reason: `${confirmCount} confirmations aligned ${direction} (${quality})`
        };
    },

    // Fischer Fibonacci Time Analysis
    // Calculates PHI-ratio time targets for when next move is expected
    calculateFibonacciTimeAnalysis: function(highs, lows, closes, lookback = 55) {
        const length = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 15) return null;

        const h = highs.slice(-lookback).map(Number).filter(Number.isFinite);
        const l = lows.slice(-lookback).map(Number).filter(Number.isFinite);
        const c = closes.slice(-lookback).map(Number).filter(Number.isFinite);
        const n = Math.min(h.length, l.length, c.length);
        if (n < 15) return null;

        // Find swing points
        const swings = [];
        for (let i = 2; i < n - 2; i++) {
            if (h[i] >= h[i - 1] && h[i] >= h[i - 2] && h[i] >= h[i + 1] && h[i] >= h[i + 2]) {
                swings.push({ index: i, type: 'HIGH', value: h[i] });
            }
            if (l[i] <= l[i - 1] && l[i] <= l[i - 2] && l[i] <= l[i + 1] && l[i] <= l[i + 2]) {
                swings.push({ index: i, type: 'LOW', value: l[i] });
            }
        }

        if (swings.length < 3) return null;

        // Sort by index
        swings.sort((a, b) => a.index - b.index);

        // Calculate time distances between consecutive swings
        const timeDistances = [];
        for (let i = 1; i < swings.length; i++) {
            timeDistances.push(swings[i].index - swings[i - 1].index);
        }

        if (!timeDistances.length) return null;

        const lastSwing = swings.at(-1);
        const lastDistance = timeDistances.at(-1);
        const avgDistance = timeDistances.reduce((sum, d) => sum + d, 0) / timeDistances.length;
        const candlesSinceLastSwing = n - 1 - lastSwing.index;

        // PHI time targets from last swing
        const phiTargets = [
            { ratio: 0.618, candles: Math.round(avgDistance * 0.618), label: 'PHI 0.618' },
            { ratio: 1.0, candles: Math.round(avgDistance), label: 'Average' },
            { ratio: 1.618, candles: Math.round(avgDistance * 1.618), label: 'PHI 1.618' },
            { ratio: 2.618, candles: Math.round(avgDistance * 2.618), label: 'PHI 2.618' }
        ];

        // Find the next expected reversal window
        const nextTargets = phiTargets
            .map(t => ({ ...t, remaining: t.candles - candlesSinceLastSwing }))
            .filter(t => t.remaining > 0);

        const nearestTarget = nextTargets[0] || null;
        const isInTimeWindow = nearestTarget && nearestTarget.remaining <= 3;

        return {
            lastSwing,
            candlesSinceLastSwing,
            avgSwingDistance: Math.round(avgDistance),
            phiTargets,
            nextTargets,
            nearestTarget,
            isInTimeWindow,
            swingCount: swings.length
        };
    },

    // Fischer Price Extension with Dual Ratio Confirmation
    // Uses two Fibonacci ratios that multiply to confirm target validity
    // 0.618 x 1.618 ≈ 1.0 (golden ratio product rule)
    calculateFischerDualRatioTarget: function(highs, lows, closes, lookback = 55) {
        const length = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0);
        if (length < 15) return null;

        const h = highs.slice(-lookback).map(Number).filter(Number.isFinite);
        const l = lows.slice(-lookback).map(Number).filter(Number.isFinite);
        const c = closes.slice(-lookback).map(Number).filter(Number.isFinite);
        const n = Math.min(h.length, l.length, c.length);
        if (n < 15) return null;

        const high = Math.max(...h);
        const low = Math.min(...l);
        const close = c.at(-1);
        const range = high - low;
        if (!this.isNumber(range) || range <= 0 || !this.isNumber(close)) return null;

        const highIndex = h.lastIndexOf(high);
        const lowIndex = l.lastIndexOf(low);
        const trend = lowIndex < highIndex ? 'UP' : 'DOWN';

        // Fischer's 5-wave extension targets using dual ratio confirmation
        // Wave 1-2 correction ratio x Wave 3 extension = confirmed target
        const correctionRatios = [0.382, 0.5, 0.618];
        const extensionRatios = [1.272, 1.618, 2.0, 2.618];
        const targets = [];

        correctionRatios.forEach(cRatio => {
            extensionRatios.forEach(eRatio => {
                // Fischer's rule: when correction x extension ≈ PHI ratio, target is strong
                const product = cRatio * eRatio;
                const isPhiProduct = Math.abs(product - 1.0) <= 0.15
                    || Math.abs(product - 0.618) <= 0.1
                    || Math.abs(product - 1.618) <= 0.15;

                if (isPhiProduct) {
                    let targetPrice;
                    if (trend === 'UP') {
                        const correctionLevel = high - (range * cRatio);
                        targetPrice = correctionLevel + (range * eRatio);
                    } else {
                        const correctionLevel = low + (range * cRatio);
                        targetPrice = correctionLevel - (range * eRatio);
                    }

                    targets.push({
                        correctionRatio: cRatio,
                        extensionRatio: eRatio,
                        product: Number(product.toFixed(3)),
                        targetPrice: Number(targetPrice.toFixed(2)),
                        isPhiConfirmed: true,
                        strength: isPhiProduct ? 'STRONG' : 'MODERATE'
                    });
                }
            });
        });

        // Sort targets by proximity to current price direction
        targets.sort((a, b) => {
            if (trend === 'UP') return a.targetPrice - b.targetPrice;
            return b.targetPrice - a.targetPrice;
        });

        // Filter to only targets ahead of current price
        const validTargets = targets.filter(t =>
            trend === 'UP' ? t.targetPrice > close : t.targetPrice < close
        );

        return {
            trend,
            swingHigh: high,
            swingLow: low,
            currentPrice: close,
            range,
            targets: validTargets.slice(0, 4),
            primaryTarget: validTargets[0] || null,
            method: 'Fischer Dual Ratio (Correction x Extension = PHI)'
        };
    },

    // ==================== END FISCHER SYNERGY ENGINE ====================

    getIndicatorSignal: function(indicator, value, params = {}) {
        if (value === null || value === undefined) return 'HOLD';

        switch (indicator) {
            case 'RSI': {
                if (!this.isNumber(value)) return 'HOLD';
                // Raw RSI is display-only. AdvancedRSI applies the transcript rules
                // with cross-back and confirmation instead of plain 70/30 signals.
                return 'HOLD';
            }

            case 'AdvancedRSI':
                if (!value || !value.signal) return 'HOLD';
                return ['BUY', 'SELL'].includes(value.signal) ? value.signal : 'HOLD';

            case 'OBV':
                if (!value || !value.direction) return 'HOLD';
                if (value.direction === 'BULLISH') return 'BUY';
                if (value.direction === 'BEARISH') return 'SELL';
                return 'HOLD';

            case 'Engulfing':
                if (!value || !value.type) return 'HOLD';
                if (value.type === 'BULLISH') return 'BUY';
                if (value.type === 'BEARISH') return 'SELL';
                return 'HOLD';

            case 'MotherVolume':
                if (!value || !value.isMother) return 'HOLD';
                if (value.direction === 'BULLISH' && value.breakout === 'UP' && value.closePosition >= 60) return 'BUY';
                if (value.direction === 'BEARISH' && value.breakout === 'DOWN' && value.closePosition <= 40) return 'SELL';
                return 'HOLD';

            case 'CandlestickPatterns':
            case 'FibonacciContext':
            case 'ChartPatterns':
                if (!value || !value.direction || Number(value.strength || 0) < 58) return 'HOLD';
                if (value.direction === 'BULLISH') return 'BUY';
                if (value.direction === 'BEARISH') return 'SELL';
                return 'HOLD';

            case 'FischerSynergy':
                if (!value || !value.signal || value.signal === 'HOLD') return 'HOLD';
                if (value.synergyScore < 45) return 'HOLD';
                return value.signal;

            case 'VPA':
                if (!value || !value.direction || value.direction === 'NEUTRAL') return 'HOLD';
                if (value.strength < 62) return 'HOLD';
                // If VPA detects fake move, return opposite to filter it
                if (value.isFakeMove) {
                    return value.direction === 'BULLISH' ? 'BUY' : 'SELL';
                }
                if (value.direction === 'BULLISH') return 'BUY';
                if (value.direction === 'BEARISH') return 'SELL';
                return 'HOLD';

            case 'MACD':
                if (!value || !this.isNumber(value.histogram) || !this.isNumber(value.macd) || !this.isNumber(value.signal)) return 'HOLD';
                if (value.histogram > 0 && value.macd > value.signal) return 'BUY';
                if (value.histogram < 0 && value.macd < value.signal) return 'SELL';
                return 'HOLD';

            case 'BollingerBands':
                if (!value || !this.isNumber(value.currentPrice) || !this.isNumber(value.lower) || !this.isNumber(value.upper)) return 'HOLD';
                if (value.currentPrice < value.lower) return 'BUY';
                if (value.currentPrice > value.upper) return 'SELL';
                return 'HOLD';

            case 'EMA':
                if (!value || !this.isNumber(value.short) || !this.isNumber(value.long)) return 'HOLD';
                if (value.short > value.long) return 'BUY';
                if (value.short < value.long) return 'SELL';
                return 'HOLD';

            case 'ADX':
                if (!value || !this.isNumber(value.adx) || !this.isNumber(value.plusDI) || !this.isNumber(value.minusDI)) return 'HOLD';
                if (value.adx > 22) {
                    if (value.plusDI > value.minusDI) return 'BUY';
                    if (value.minusDI > value.plusDI) return 'SELL';
                }
                return 'HOLD';

            case 'Stochastic': {
                const overbought = params.overbought ?? 80;
                const oversold = params.oversold ?? 20;
                if (!value || !this.isNumber(value.k) || !this.isNumber(value.d)) return 'HOLD';
                if (value.k < oversold && value.d < oversold) return 'BUY';
                if (value.k > overbought && value.d > overbought) return 'SELL';
                return 'HOLD';
            }

            case 'Volume': {
                const multiplier = params.spikeMultiplier ?? 1.15;
                if (!value || !this.isNumber(value.ratio)) return 'HOLD';
                if (value.ratio >= multiplier && value.priceDirection === 'UP') return 'BUY';
                if (value.ratio >= multiplier && value.priceDirection === 'DOWN') return 'SELL';
                return 'HOLD';
            }

            case 'PivotPoints': {
                const neutralBandPercent = params.neutralBandPercent ?? 0.05;
                if (!value || !this.isNumber(value.currentPrice) || !this.isNumber(value.pivot)) return 'HOLD';

                const distancePercent = Math.abs(value.currentPrice - value.pivot) / value.currentPrice * 100;
                if (distancePercent <= neutralBandPercent) return 'HOLD';
                if (value.currentPrice > value.pivot) return 'BUY';
                if (value.currentPrice < value.pivot) return 'SELL';
                return 'HOLD';
            }

            default:
                return 'HOLD';
        }
    }
};
