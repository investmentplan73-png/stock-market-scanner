// Conservative options signal engine.
// It produces tracked signal plans only; it does not place orders.
const OptionSignalEngine = {
    normalizeNumber: function(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    },

    getStrikeStep: function(symbol) {
        return Config.optionScanner.strikeStep[symbol] || Config.optionScanner.strikeStep.STOCK;
    },

    roundToStrike: function(price, step) {
        if (!price || !step) return 0;
        return Math.round(price / step) * step;
    },

    normalizeOption: function(raw = {}) {
        const bid = this.normalizeNumber(raw.bid ?? raw.bidPrice ?? raw.bestBidPrice, null);
        const ask = this.normalizeNumber(raw.ask ?? raw.askPrice ?? raw.bestAskPrice, null);
        const ltp = this.normalizeNumber(raw.ltp ?? raw.lastPrice ?? raw.lastTradedPrice ?? raw.close, 0);
        const spreadPercent = bid && ask && ltp ? ((ask - bid) / ltp) * 100 : null;

        return {
            token: raw.token ?? raw.symbolToken ?? raw.symboltoken ?? '',
            exchange: raw.exchange ?? raw.exch_seg ?? raw.exchangeType ?? '',
            tradingSymbol: raw.tradingSymbol ?? raw.tradingsymbol ?? raw.symbol ?? '',
            lotSize: this.normalizeNumber(raw.lotSize ?? raw.lotsize ?? raw.lot_size ?? raw.minLotSize ?? raw.minlotsize, null),
            ltp,
            open: this.normalizeNumber(raw.open ?? raw.openPrice ?? raw.ohlc?.open, null),
            high: this.normalizeNumber(raw.high ?? raw.highPrice ?? raw.dayHigh ?? raw.ohlc?.high, null),
            low: this.normalizeNumber(raw.low ?? raw.lowPrice ?? raw.dayLow ?? raw.ohlc?.low, null),
            previousClose: this.normalizeNumber(raw.previousClose ?? raw.prevClose ?? raw.closePrice ?? raw.ohlc?.close, null),
            change: this.normalizeNumber(raw.change ?? raw.netChange ?? raw.priceChange, 0),
            changePercent: this.normalizeNumber(raw.changePercent ?? raw.pChange ?? raw.percentChange, 0),
            volume: this.normalizeNumber(
                raw.volume
                ?? raw.tradeVolume
                ?? raw.totalTradedVolume
                ?? raw.totalTradeVolume
                ?? raw.totTradedQty
                ?? raw.vtt,
                null
            ),
            iv: this.normalizeNumber(raw.iv ?? raw.impliedVolatility, null),
            delta: this.normalizeNumber(raw.delta ?? raw.greeks?.delta, null),
            vega: this.normalizeNumber(raw.vega ?? raw.greeks?.vega, null),
            bid,
            ask,
            spreadPercent
        };
    },

    normalizeChain: function(rawData, fallbackSpot = 0) {
        const raw = rawData || {};
        const chain = raw.optionChain || raw.options || raw.records?.data || raw.data || raw;
        const spotPrice = this.normalizeNumber(raw.spotPrice ?? raw.underlyingValue ?? raw.records?.underlyingValue ?? fallbackSpot, fallbackSpot);
        const calls = {};
        const puts = {};

        if (Array.isArray(chain)) {
            chain.forEach(item => {
                const strike = this.normalizeNumber(item.strikePrice ?? item.strike ?? item.strike_price, null);
                if (!strike) return;

                if (item.CE || item.call || item.callData) {
                    calls[strike] = this.normalizeOption(item.CE || item.call || item.callData);
                }
                if (item.PE || item.put || item.putData) {
                    puts[strike] = this.normalizeOption(item.PE || item.put || item.putData);
                }
            });
        } else {
            const rawCalls = chain.calls || chain.CE || {};
            const rawPuts = chain.puts || chain.PE || {};

            Object.entries(rawCalls).forEach(([strike, option]) => {
                calls[this.normalizeNumber(strike)] = this.normalizeOption(option);
            });
            Object.entries(rawPuts).forEach(([strike, option]) => {
                puts[this.normalizeNumber(strike)] = this.normalizeOption(option);
            });
        }

        return { spotPrice, calls, puts };
    },

    getUnderlyingBias: function(indicators = {}) {
        const ict = indicators.ICTContext || {};
        const bullish = Number(ict.bullish || 0);
        const bearish = Number(ict.bearish || 0);
        const direction = ict.direction || (bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL');
        const reasons = Array.isArray(ict.reasons) ? ict.reasons : [];
        return {
            direction,
            bullish,
            bearish,
            strength: Math.min(Number(ict.strength || Math.max(bullish, bearish)), 100),
            reasons
        };
    },

    applyVolumeConfirmation: function(score, reasons, warnings, side, volume) {
        if (!volume || !TechnicalIndicators.isNumber(volume.ratio)) return score;

        const volumeConfig = Config.indicators.volume || {};
        const confirmationRatio = volumeConfig.confirmationRatio || volumeConfig.spikeMultiplier || 1.1;
        const dryUpRatio = volumeConfig.dryUpRatio || 0.75;
        const wantsUpMove = side === 'CALL';
        const matchesSide = wantsUpMove
            ? volume.priceDirection === 'UP'
            : volume.priceDirection === 'DOWN';

        if (volume.ratio >= confirmationRatio && matchesSide) {
            reasons.push(`Underlying volume ${this.formatRatio(volume.ratio)} confirms ${side}`);
            return score + 10;
        }

        if (volume.ratio >= confirmationRatio && ['UP', 'DOWN'].includes(volume.priceDirection)) {
            warnings.push('Underlying volume is against the trade');
            return score - 10;
        }

        if (volume.ratio < dryUpRatio) {
            warnings.push('Underlying volume is light');
            return score - 6;
        }

        return score;
    },

    applyPivotConfirmation: function(score, reasons, warnings, side, pivot) {
        if (!pivot || !TechnicalIndicators.isNumber(pivot.currentPrice) || !TechnicalIndicators.isNumber(pivot.pivot)) {
            return score;
        }

        const currentPrice = pivot.currentPrice;
        const wantsBullish = side === 'CALL';

        if (wantsBullish && currentPrice > pivot.pivot) {
            score += 8;
            reasons.push('Price holding above pivot');
        } else if (!wantsBullish && currentPrice < pivot.pivot) {
            score += 8;
            reasons.push('Price holding below pivot');
        } else {
            score -= 12;
            warnings.push(wantsBullish ? 'Price is below pivot' : 'Price is above pivot');
        }

        const barrier = this.getNearestPivotBarrier(pivot, side);
        if (barrier) {
            const distancePercent = Math.abs(barrier.value - currentPrice) / currentPrice * 100;
            if (distancePercent <= (Config.optionScanner.pivotBufferPercent ?? 0.18)) {
                score -= 12;
                warnings.push(`${side} is close to ${barrier.label}`);
            }
        }

        if (wantsBullish && TechnicalIndicators.isNumber(pivot.r1) && currentPrice > pivot.r1) {
            score += 4;
            reasons.push('Above R1 breakout');
        } else if (!wantsBullish && TechnicalIndicators.isNumber(pivot.s1) && currentPrice < pivot.s1) {
            score += 4;
            reasons.push('Below S1 breakdown');
        }

        return score;
    },

    applyVwapConfirmation: function(score, reasons, warnings, side, vwap) {
        if (!vwap || !TechnicalIndicators.isNumber(vwap.currentPrice) || !TechnicalIndicators.isNumber(vwap.vwap)) {
            warnings.push('VWAP unavailable');
            return { score: score - 8, confirmed: false };
        }

        const wantsBullish = side === 'CALL';
        const isAbove = vwap.currentPrice > vwap.vwap;
        const distance = Math.abs(Number(vwap.distancePercent || 0));

        if (wantsBullish && isAbove) {
            reasons.push(`Price above VWAP by ${distance.toFixed(2)}%`);
            return { score: score + 12, confirmed: true };
        }

        if (!wantsBullish && !isAbove) {
            reasons.push(`Price below VWAP by ${distance.toFixed(2)}%`);
            return { score: score + 12, confirmed: true };
        }

        warnings.push(wantsBullish ? 'Price is below VWAP' : 'Price is above VWAP');
        return { score: score - 14, confirmed: false };
    },

    getNearestPivotBarrier: function(pivot, side) {
        const currentPrice = pivot.currentPrice;
        const levels = side === 'CALL'
            ? [
                { label: 'R1 resistance', value: pivot.r1 },
                { label: 'R2 resistance', value: pivot.r2 },
                { label: 'R3 resistance', value: pivot.r3 }
            ].filter(level => TechnicalIndicators.isNumber(level.value) && level.value > currentPrice)
                .sort((a, b) => a.value - b.value)
            : [
                { label: 'S1 support', value: pivot.s1 },
                { label: 'S2 support', value: pivot.s2 },
                { label: 'S3 support', value: pivot.s3 }
            ].filter(level => TechnicalIndicators.isNumber(level.value) && level.value < currentPrice)
                .sort((a, b) => b.value - a.value);

        return levels[0] || null;
    },

    isNearPivotBarrier: function(pivot, side) {
        if (!pivot || !TechnicalIndicators.isNumber(pivot.currentPrice)) return false;

        const barrier = this.getNearestPivotBarrier(pivot, side);
        if (!barrier) return false;

        const distancePercent = Math.abs(barrier.value - pivot.currentPrice) / pivot.currentPrice * 100;
        return distancePercent <= (Config.optionScanner.pivotBufferPercent ?? 0.32);
    },

    applySupportResistanceConfirmation: function(score, reasons, warnings, side, levels) {
        if (!levels || !TechnicalIndicators.isNumber(levels.currentPrice)) {
            warnings.push('Support/resistance unavailable');
            return { score: score - 10, clear: false };
        }

        const buffer = Config.optionScanner.supportResistanceBufferPercent ?? 0.38;
        const wantsBullish = side === 'CALL';
        const currentPrice = levels.currentPrice;
        const barrier = wantsBullish ? levels.resistance : levels.support;
        const distancePercent = wantsBullish
            ? levels.resistanceDistancePercent
            : levels.supportDistancePercent;

        if (barrier && TechnicalIndicators.isNumber(distancePercent) && distancePercent <= buffer) {
            const label = wantsBullish ? 'resistance' : 'support';
            warnings.push(`${side} is too close to ${label}`);
            return { score: score - 18, clear: false };
        }

        if (wantsBullish && levels.support) {
            score += 7;
            reasons.push('Support below price for SL');
        } else if (wantsBullish) {
            score -= 10;
            warnings.push('No support found for CALL SL');
            return { score, clear: false };
        } else if (!wantsBullish && levels.resistance) {
            score += 7;
            reasons.push('Resistance above price for SL');
        } else {
            score -= 10;
            warnings.push('No resistance found for PUT SL');
            return { score, clear: false };
        }

        if (wantsBullish && !levels.resistance && levels.support) {
            score += 4;
            reasons.push('No immediate resistance above');
        } else if (!wantsBullish && !levels.support && levels.resistance) {
            score += 4;
            reasons.push('No immediate support below');
        }

        return { score, clear: true };
    },

    applyBreakoutConfirmation: function(score, reasons, warnings, side, levels, volume, option) {
        const settings = Config.optionScanner.breakout || {};
        if (settings.enabled === false || !levels?.breakout) {
            return { score, confirmed: false, fake: false };
        }

        const wantsBullish = side === 'CALL';
        const breakout = wantsBullish ? levels.breakout.up : levels.breakout.down;
        const fakeBreakout = wantsBullish ? levels.breakout.fakeUp : levels.breakout.fakeDown;
        const label = wantsBullish ? 'breakout' : 'breakdown';

        if (fakeBreakout && settings.blockFakeBreakouts !== false) {
            warnings.push(`Fake ${label} risk: ${fakeBreakout.reason || 'wick rejection'}`);
            return { score: score - 32, confirmed: false, fake: true };
        }

        if (!breakout) {
            return { score, confirmed: false, fake: false };
        }

        const closePercent = Number(breakout.closePercent);
        const minClosePercent = Number(settings.confirmationBufferPercent ?? 0.12);
        const maxExtensionPercent = Number(settings.maxExtensionPercent ?? 1.4);
        const minVolumeRatio = Number(settings.minVolumeRatio ?? 1.2);
        const volumeRatio = Number(volume?.ratio);
        const volumeConfirmed = Number.isFinite(volumeRatio) && volumeRatio >= minVolumeRatio;
        const optionConfirmed = Number(option?.change || 0) > 0 || Number(option?.changePercent || 0) > 0;

        if (!Number.isFinite(closePercent) || closePercent < minClosePercent) {
            warnings.push(`${side} ${label} close is not strong enough`);
            return { score: score - 6, confirmed: false, fake: false };
        }

        if (closePercent > maxExtensionPercent) {
            warnings.push(`${side} ${label} is overextended`);
            return { score: score - 8, confirmed: false, fake: false };
        }

        if (!volumeConfirmed) {
            warnings.push(`${side} ${label} volume not confirmed`);
            return { score: score - 8, confirmed: false, fake: false };
        }

        if (!optionConfirmed) {
            warnings.push(`${side} option did not confirm ${label}`);
            return { score: score - 8, confirmed: false, fake: false };
        }

        reasons.push(`${side} confirmed ${label} with volume ${this.formatRatio(volumeRatio)}`);
        return { score: score + 14, confirmed: true, fake: false };
    },

    applyGreeksConfirmation: function(score, reasons, warnings, side, option, greeks) {
        const settings = Config.optionScanner.greeks || {};
        if (settings.enabled === false) return { score, confirmed: true, risky: false };

        if (!greeks || !greeks.available) {
            warnings.push('Delta/IV unavailable');
            return {
                score: score - 10,
                confirmed: settings.requireForBuy !== true,
                risky: settings.requireForBuy === true
            };
        }

        let confirmed = true;
        let risky = false;
        const ivPercent = Number(greeks.ivPercent);
        const deltaAbs = Math.abs(Number(greeks.delta || 0));
        const daysToExpiry = Number(greeks.daysToExpiry);

        if (Number.isFinite(daysToExpiry) && daysToExpiry < Number(settings.minDaysToExpiry ?? 0.25)) {
            score -= 14;
            confirmed = false;
            risky = true;
            warnings.push('Expiry is too close for fresh BUY');
        }

        if (Number.isFinite(ivPercent)) {
            if (ivPercent < Number(settings.minIvPercent ?? 5)) {
                score -= 8;
                confirmed = false;
                warnings.push('IV is too low');
            } else if (ivPercent > Number(settings.maxIvPercent ?? 85)) {
                score -= 12;
                confirmed = false;
                warnings.push('IV is too high');
            } else {
                score += 4;
            }
        }

        if (deltaAbs < Number(settings.minDeltaAbs ?? 0.24)) {
            score -= 12;
            confirmed = false;
            risky = true;
            warnings.push('Delta is too low');
        } else if (deltaAbs > Number(settings.maxDeltaAbs ?? 0.82)) {
            score -= 5;
            warnings.push('Delta is very high');
        } else {
            score += 6;
            reasons.push(`Delta ${Number(greeks.delta).toFixed(2)} confirms option response`);
        }

        return { score, confirmed, risky };
    },

    formatRatio: function(value) {
        return `${Number(value || 0).toFixed(2)}x`;
    },

    calculateGreeks: function({ side, spotPrice, strike, option, expiryDate }) {
        const settings = Config.optionScanner.greeks || {};
        const spot = Number(spotPrice || 0);
        const strikePrice = Number(strike || 0);
        const entry = Number(option?.ltp || 0);
        if (!spot || !strikePrice || !entry) return { available: false };

        const daysToExpiry = this.getDaysToExpiry(expiryDate);
        const minYears = Math.max(Number(settings.minDaysToExpiry ?? 0.25), 0.1) / 365;
        const timeYears = Math.max(daysToExpiry / 365, minYears);
        const riskFreeRate = Number(settings.riskFreeRate ?? 0.065);
        let volatility = this.normalizeVolatility(option?.iv);
        const rawGreeksAvailable = ['delta', 'vega'].some(key => Number.isFinite(Number(option?.[key])));

        if (!volatility) {
            volatility = this.estimateImpliedVolatility({
                side,
                spot,
                strike: strikePrice,
                timeYears,
                riskFreeRate,
                marketPrice: entry
            });
        }

        if (!volatility) return { available: false, daysToExpiry };

        const calculated = this.blackScholesDeltaVega({
            side,
            spot,
            strike: strikePrice,
            timeYears,
            riskFreeRate,
            volatility
        });

        const delta = Number.isFinite(Number(option?.delta)) ? Number(option.delta) : calculated.delta;
        const vega = Number.isFinite(Number(option?.vega)) ? Number(option.vega) : calculated.vega;

        return {
            available: true,
            estimated: !rawGreeksAvailable,
            ivPercent: volatility * 100,
            daysToExpiry,
            delta,
            vega
        };
    },

    normalizeVolatility: function(iv) {
        const value = Number(iv);
        if (!Number.isFinite(value) || value <= 0) return null;
        return value > 1 ? value / 100 : value;
    },

    getDaysToExpiry: function(expiryDate) {
        const parsed = this.parseExpiryDate(expiryDate);
        if (!parsed) return 1;
        parsed.setHours(15, 30, 0, 0);
        return Math.max((parsed.getTime() - Date.now()) / 86400000, 0.1);
    },

    parseExpiryDate: function(value) {
        const text = String(value || '').trim().toUpperCase();
        if (!text) return null;

        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            const [yyyy, mm, dd] = text.split('-').map(Number);
            return new Date(yyyy, mm - 1, dd);
        }

        const match = text.replace(/-/g, '').match(/^(\d{1,2})([A-Z]{3})(\d{2}|\d{4})$/);
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
        return new Date(year, month, Number(match[1]));
    },

    estimateImpliedVolatility: function({ side, spot, strike, timeYears, riskFreeRate, marketPrice }) {
        const intrinsic = side === 'CALL'
            ? Math.max(spot - strike, 0)
            : Math.max(strike - spot, 0);
        if (!marketPrice || marketPrice < intrinsic) return null;

        let low = 0.03;
        let high = 3;
        for (let i = 0; i < 40; i++) {
            const mid = (low + high) / 2;
            const price = this.blackScholesPrice({ side, spot, strike, timeYears, riskFreeRate, volatility: mid });
            if (price > marketPrice) high = mid;
            else low = mid;
        }
        return (low + high) / 2;
    },

    blackScholesPrice: function({ side, spot, strike, timeYears, riskFreeRate, volatility }) {
        const d1 = this.getD1({ spot, strike, timeYears, riskFreeRate, volatility });
        const d2 = d1 - (volatility * Math.sqrt(timeYears));
        const discountedStrike = strike * Math.exp(-riskFreeRate * timeYears);

        if (side === 'CALL') {
            return (spot * this.normalCdf(d1)) - (discountedStrike * this.normalCdf(d2));
        }
        return (discountedStrike * this.normalCdf(-d2)) - (spot * this.normalCdf(-d1));
    },

    blackScholesDeltaVega: function({ side, spot, strike, timeYears, riskFreeRate, volatility }) {
        const sqrtTime = Math.sqrt(timeYears);
        const d1 = this.getD1({ spot, strike, timeYears, riskFreeRate, volatility });
        const pdf = this.normalPdf(d1);
        const delta = side === 'CALL'
            ? this.normalCdf(d1)
            : this.normalCdf(d1) - 1;
        const vega = (spot * pdf * sqrtTime) / 100;

        return {
            delta,
            vega
        };
    },

    getD1: function({ spot, strike, timeYears, riskFreeRate, volatility }) {
        return (Math.log(spot / strike) + ((riskFreeRate + (0.5 * volatility * volatility)) * timeYears))
            / (volatility * Math.sqrt(timeYears));
    },

    normalPdf: function(value) {
        return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
    },

    normalCdf: function(value) {
        return 0.5 * (1 + this.erf(value / Math.sqrt(2)));
    },

    erf: function(value) {
        const sign = value < 0 ? -1 : 1;
        const x = Math.abs(value);
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;
        const t = 1 / (1 + (p * x));
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
    },

    applyTranscriptFormulaConfirmations: function(score, reasons, warnings, side, indicators = {}) {
        const wantsBullish = side === 'CALL';
        const wantedDirection = wantsBullish ? 'BULLISH' : 'BEARISH';
        const oppositeDirection = wantsBullish ? 'BEARISH' : 'BULLISH';
        const advancedRsi = indicators.AdvancedRSI || {};
        const obv = indicators.OBV || {};
        const engulfing = indicators.Engulfing || {};
        const motherVolume = indicators.MotherVolume || {};
        const candlestick = indicators.CandlestickPatterns || {};
        const fibonacci = indicators.FibonacciContext || {};
        const chartPattern = indicators.ChartPatterns || {};
        const pivot = indicators.PivotPoints || {};
        let confirmed = false;
        let blocked = false;

        if (advancedRsi.direction === wantedDirection) {
            score += advancedRsi.signal === (wantsBullish ? 'BUY' : 'SELL') ? 16 : 9;
            confirmed = true;
            reasons.push(`Advanced RSI ${advancedRsi.zone || ''} confirms ${side}`.trim());
        } else if (advancedRsi.direction === oppositeDirection) {
            score -= 16;
            blocked = true;
            warnings.push(`Advanced RSI is ${oppositeDirection}`);
        }

        if (obv.direction === wantedDirection) {
            score += 10;
            confirmed = true;
            reasons.push('OBV volume pressure confirms');
        } else if (obv.direction === oppositeDirection) {
            score -= 12;
            warnings.push('OBV volume pressure is against trade');
        }

        if (engulfing.type === wantedDirection) {
            score += engulfing.strength === 'STRONG' ? 12 : 8;
            confirmed = true;
            reasons.push(`${engulfing.type} engulfing confirms reversal`);
        } else if (engulfing.type === oppositeDirection) {
            score -= 14;
            warnings.push(`${engulfing.type} engulfing is against trade`);
        }

        if (motherVolume.isMother) {
            if (
                (wantsBullish && motherVolume.direction === 'BULLISH' && motherVolume.breakout === 'UP')
                || (!wantsBullish && motherVolume.direction === 'BEARISH' && motherVolume.breakout === 'DOWN')
            ) {
                score += 16;
                confirmed = true;
                reasons.push('Mother volume breakout confirms');
            } else if (motherVolume.direction !== 'NEUTRAL') {
                score -= 12;
                warnings.push('Mother volume is not aligned');
            }
        }

        if (candlestick.direction === wantedDirection && Number(candlestick.strength || 0) >= 58) {
            score += candlestick.strength >= 80 ? 16 : 10;
            confirmed = true;
            reasons.push((candlestick.primary?.name || 'Candlestick pattern') + ' confirms ' + side);
        } else if (candlestick.direction === oppositeDirection && Number(candlestick.strength || 0) >= 58) {
            score -= candlestick.strength >= 80 ? 18 : 12;
            blocked = Number(candlestick.strength || 0) >= 80 || blocked;
            warnings.push((candlestick.primary?.name || 'Candlestick pattern') + ' is against trade');
        }

        // PIVOT + CANDLESTICK COMBO TRIGGER (John Person Method)
        const pivotCombo = indicators.PivotCandleCombo || {};
        if (pivotCombo.triggered && pivotCombo.combo) {
            const comboDirection = pivotCombo.direction;
            if (comboDirection === wantedDirection) {
                score += pivotCombo.boostScore || 12;
                confirmed = true;
                reasons.push(pivotCombo.combo.detail || 'Pivot+Candle combo confirms');
            } else if (comboDirection === oppositeDirection) {
                score -= 10;
                warnings.push(pivotCombo.combo.detail || 'Pivot+Candle combo is against trade');
            }
        }
        if (pivotCombo.warnings && pivotCombo.warnings.length) {
            pivotCombo.warnings.forEach(w => warnings.push(w.detail || 'Pivot counter signal'));
        }

        if (fibonacci.direction === wantedDirection && Number(fibonacci.strength || 0) >= 45) {
            score += fibonacci.inGoldenZone ? 14 : 9;
            confirmed = true;
            reasons.push(fibonacci.inGoldenZone ? 'Fibonacci golden zone confirms' : 'Fibonacci level confirms');
        } else if (fibonacci.direction === oppositeDirection && Number(fibonacci.strength || 0) >= 45) {
            score -= fibonacci.inGoldenZone ? 16 : 10;
            warnings.push('Fibonacci zone is against trade');
        }

        if (chartPattern.direction === wantedDirection && Number(chartPattern.strength || 0) >= 58) {
            score += chartPattern.strength >= 80 ? 18 : 12;
            confirmed = true;
            reasons.push((chartPattern.primary?.name || 'Chart pattern') + ' confirms');
        } else if (chartPattern.direction === oppositeDirection && Number(chartPattern.strength || 0) >= 58) {
            score -= chartPattern.strength >= 80 ? 20 : 12;
            blocked = Number(chartPattern.strength || 0) >= 80 || blocked;
            warnings.push((chartPattern.primary?.name || 'Chart pattern') + ' is against trade');
        }

        if (pivot && TechnicalIndicators.isNumber(pivot.currentPrice) && TechnicalIndicators.isNumber(pivot.pivot)) {
            const pivotAligned = wantsBullish ? pivot.currentPrice > pivot.pivot : pivot.currentPrice < pivot.pivot;
            if (pivotAligned) {
                score += 6;
                confirmed = true;
                reasons.push(wantsBullish ? 'Price above pivot' : 'Price below pivot');
            } else {
                score -= 9;
                warnings.push(wantsBullish ? 'Price below pivot' : 'Price above pivot');
            }
        }

        // VPA (Volume Price Analysis) confirmation
        const vpa = indicators.VPA || {};
        if (vpa.direction === wantedDirection && Number(vpa.strength || 0) >= 62) {
            score += vpa.strength >= 75 ? 14 : 9;
            confirmed = true;
            reasons.push((vpa.primary?.name || 'VPA') + ' confirms ' + side);
        } else if (vpa.direction === oppositeDirection && Number(vpa.strength || 0) >= 62) {
            score -= vpa.strength >= 75 ? 16 : 10;
            warnings.push((vpa.primary?.name || 'VPA') + ' is against trade');
        }
        // VPA fake move detection - strongest fake filter
        if (vpa.isFakeMove) {
            const vpaAgainstTrade = vpa.direction === oppositeDirection;
            if (vpaAgainstTrade) {
                score -= 20;
                blocked = true;
                warnings.push('VPA Effort vs Result: fake move detected against trade');
            }
        }

        return { score, confirmed, blocked };
    },

    evaluateOption: function(context) {
        const {
            symbol,
            strike,
            side,
            optionData,
            oppositeData,
            spotPrice,
            indicators,
            expiryDate,
            timeframe
        } = context;

        const option = this.normalizeOption(optionData);
        const opposite = this.normalizeOption(oppositeData);
        const greeks = this.calculateGreeks({ side, spotPrice, strike, option, expiryDate });
        option.greeks = greeks;
        const settings = Config.optionScanner;
        const safeIndicators = indicators || {};
        const bias = this.getUnderlyingBias(safeIndicators);
        const wantsBullish = side === 'CALL';
        const wantedDirection = wantsBullish ? 'BULLISH' : 'BEARISH';
        const ictContext = safeIndicators.ICTContext || {};
        const advancedIctContext = safeIndicators.ICTAdvancedContext || {};
        const orbGapBbContext = safeIndicators.ORBGapBBContext || {};
        const ictAligned = ictContext.direction === wantedDirection
            && Number(ictContext.strength || 0) >= 58;
        const ictConfirmed = ictAligned && (
            ictContext.displacement === wantedDirection
            || ictContext.fvg === wantedDirection
            || (wantsBullish && ictContext.liquidity === 'SELL_SIDE_SWEEP')
            || (!wantsBullish && ictContext.liquidity === 'BUY_SIDE_SWEEP')
        );
        const reasons = [];
        const warnings = [];

        let score = 0;
        let optionMomentumConfirmed = false;
        let liquidityConfirmed = false;

        if (option.ltp <= 0) {
            return this.createNoTrade(symbol, strike, side, option, 0, ['No option LTP']);
        }

        if (bias.direction === wantedDirection) {
            score += Math.min(bias.strength, 20);
            reasons.push(...bias.reasons.slice(0, 3));
        } else if (bias.direction === 'NEUTRAL') {
            warnings.push('Underlying trend is neutral');
            score -= 5;
        } else {
            warnings.push(`Underlying trend is ${bias.direction}`);
            score -= 30;
        }

        if (ictConfirmed) {
            score += 24;
            reasons.push('ICT fractal + liquidity + displacement aligned');
        } else if (ictAligned) {
            score += 12;
            warnings.push('ICT bias aligned, waiting for liquidity/displacement');
        } else {
            warnings.push('ICT fractal setup is not aligned');
        }

        const orbGapBbDirection = orbGapBbContext.direction || 'NEUTRAL';
        const orbGapBbStrength = Number(orbGapBbContext.strength || 0);
        if (orbGapBbDirection === wantedDirection && orbGapBbStrength >= 40) {
            score += orbGapBbContext.trapBoom?.type !== 'NONE' ? 16 : 12;
            reasons.push(`ORB/Gap/BB confirms ${wantedDirection}`);
        } else if (orbGapBbDirection !== 'NEUTRAL' && orbGapBbDirection !== wantedDirection) {
            score -= 12;
            warnings.push(`ORB/Gap/BB is ${orbGapBbDirection}`);
        } else if (orbGapBbContext.bbTrap?.type?.includes('WAIT')) {
            warnings.push('BB outside candle needs same-day confirmation');
        }

        const advancedDirection = advancedIctContext.direction || 'NEUTRAL';
        const advancedStrength = Number(advancedIctContext.strength || 0);
        const advancedTrapDirection = advancedIctContext.trap?.direction || 'NONE';
        if (advancedDirection === wantedDirection && advancedStrength >= 45) {
            score += 18;
            reasons.push('Advanced ICT POI/trap map confirms direction');
        } else if (advancedTrapDirection === wantedDirection) {
            score += 14;
            reasons.push('Advanced ICT trap favors this side');
        } else if (
            (advancedDirection !== 'NEUTRAL' && advancedDirection !== wantedDirection)
            || (advancedTrapDirection !== 'NONE' && advancedTrapDirection !== wantedDirection)
        ) {
            score -= 18;
            warnings.push('Advanced ICT POI/trap map is against trade');
        }

        if (advancedIctContext.workDone && advancedTrapDirection !== wantedDirection) {
            score -= 10;
            warnings.push('HTF target already done; possible trap zone');
        }

        const transcriptFormulaCheck = this.applyTranscriptFormulaConfirmations(
            score,
            reasons,
            warnings,
            side,
            safeIndicators
        );
        score = transcriptFormulaCheck.score;

        if (option.change > 0 || option.changePercent > 0) {
            score += 12;
            optionMomentumConfirmed = true;
            reasons.push(`${side} price is rising`);
        } else if (option.change < 0 || option.changePercent < 0) {
            score -= 12;
            warnings.push(`${side} price is falling`);
        } else if (settings.requireOptionMomentum) {
            score -= 8;
            warnings.push(`${side} price momentum is not confirmed`);
        }

        if (option.volume !== null && option.volume >= settings.minVolume) {
            score += 8;
            liquidityConfirmed = true;
            reasons.push('Option volume filter passed');
        } else if (option.volume === null) {
            liquidityConfirmed = settings.requireOptionVolume !== true;
            score -= settings.requireOptionVolume ? 18 : 2;
            warnings.push('Option volume unavailable');
        } else {
            liquidityConfirmed = settings.requireOptionVolume !== true;
            score -= settings.requireOptionVolume ? 18 : 5;
            warnings.push('Low option volume');
        }

        if (opposite.ltp > 0) {
            const relativeStrength = option.change - opposite.change;
            if (relativeStrength > 0) {
                score += 8;
                reasons.push(`${side} stronger than opposite side`);
            } else if (relativeStrength < 0) {
                score -= 6;
                warnings.push('Opposite side is stronger');
            }
        }

        const distancePercent = spotPrice ? (Math.abs(strike - spotPrice) / spotPrice) * 100 : 0;
        if (distancePercent <= 0.8) {
            score += 10;
            reasons.push('Near ATM strike');
        } else if (distancePercent <= 1.6) {
            score += 4;
            reasons.push('Tradable nearby strike');
        } else {
            score -= 8;
            warnings.push('Strike is far from spot');
        }

        if (option.spreadPercent !== null) {
            if (option.spreadPercent <= settings.maxSpreadPercent) {
                score += 8;
                reasons.push('Spread filter passed');
            } else {
                score -= 16;
                warnings.push('Wide bid-ask spread');
            }
        }

        const breakoutCheck = {
            score,
            confirmed: ictConfirmed,
            fake: false
        };
        const greeksCheck = this.applyGreeksConfirmation(
            score,
            reasons,
            warnings,
            side,
            option,
            greeks
        );
        score = greeksCheck.score;

        score = Math.max(0, Math.min(100, Math.round(score)));
        const risk = this.createRiskPlan(option.ltp, {
            side,
            option,
            spotPrice,
            indicators: safeIndicators,
            levels: safeIndicators.SupportResistance,
            advancedIct: advancedIctContext,
            atr: safeIndicators.ATR,
            greeks
        });
        const advancedConfirmed = advancedDirection === wantedDirection || advancedTrapDirection === wantedDirection;
        const ictVwapConfirmed = ictAligned || advancedConfirmed || transcriptFormulaCheck.confirmed;
        const ictStructureClear = ictConfirmed || ictAligned || advancedConfirmed || transcriptFormulaCheck.confirmed;
        const qualityCheck = this.getTradeQualityCheck({
            option,
            opposite,
            risk,
            warnings,
            score,
            bias,
            wantedDirection,
            ictAligned,
            vwapConfirmed: ictVwapConfirmed,
            structureClear: ictStructureClear,
            breakoutConfirmed: breakoutCheck.confirmed,
            greeksCheck
        });
        if (!qualityCheck.ok) {
            warnings.push(...qualityCheck.warnings);
            score = Math.max(0, score - qualityCheck.penalty);
        }
        score = Math.max(0, Math.min(100, Math.round(score)));
        let action = 'NO TRADE';
        const adx = safeIndicators.ADX;
        const adxConfirmed = !adx
            || !TechnicalIndicators.isNumber(adx.adx)
            || adx.adx >= Number(settings.minAdxForBuy || 18);
        const trendConfirmed = bias.direction === wantedDirection
            && bias.strength >= Number(settings.minTrendStrengthForBuy || 58)
            && adxConfirmed;
        const vwapConfirmed = ictVwapConfirmed;
        const structureClear = ictStructureClear;
        const pivotConfirmed = ictAligned || transcriptFormulaCheck.confirmed;
        const optionMomentumAllowed = optionMomentumConfirmed
            || (ictAligned && !(option.change < 0 || option.changePercent < 0));
        const cleanBuySetup = trendConfirmed
            || ictConfirmed
            || advancedConfirmed
            || transcriptFormulaCheck.confirmed;
        const btstSettings = settings.btst || {};
        const daysToExpiry = this.getDaysToExpiry(expiryDate);
        const btstTimeframes = btstSettings.timeframes || ['ONE_DAY'];
        const isBtstTimeframe = btstTimeframes.includes(timeframe || 'FIVE_MINUTE');
        const btstAllowed = btstSettings.enabled !== false
            && isBtstTimeframe
            && daysToExpiry >= Number(btstSettings.minDaysToExpiry || 1.2)
            && bias.direction === wantedDirection
            && bias.strength >= Number(btstSettings.minTrendStrength || 45)
            && vwapConfirmed
            && structureClear
            && pivotConfirmed
            && !transcriptFormulaCheck.blocked
            && qualityCheck.ok
            && !breakoutCheck.fake
            && score >= Number(btstSettings.minConfidence || 72)
            && warnings.length <= Number(btstSettings.maxWarnings || 3);
        const buyAllowed = cleanBuySetup
            && !breakoutCheck.fake
            && qualityCheck.ok
            && vwapConfirmed
            && structureClear
            && pivotConfirmed
            && !transcriptFormulaCheck.blocked
            && (greeksCheck.confirmed || settings.greeks?.requireForBuy !== true)
            && (!greeksCheck.risky || settings.greeks?.requireForBuy !== true)
            && (!settings.requireOptionVolume || liquidityConfirmed)
            && (!settings.requireOptionMomentum || optionMomentumAllowed);

        if (breakoutCheck.fake) {
            action = 'NO TRADE';
        } else if (btstAllowed) {
            action = `BTST ${side}`;
            reasons.unshift('BTST setup for next session holding');
        } else if (score >= settings.strongConfidence && warnings.length <= Number(settings.maxBuyWarnings ?? 1) && buyAllowed) {
            action = `BUY ${side}`;
        } else if (score >= Number(settings.minBuyScore || 76) && warnings.length <= Number(settings.maxBuyWarnings ?? 2) && buyAllowed && (trendConfirmed || ictAligned)) {
            // Require at least indicator confirmation beyond just trend
            if (confirmed || ictAligned) {
                action = `BUY ${side}`;
            } else {
                action = `WATCH ${side}`;
                warnings.push('Trend aligned but indicator confirmation incomplete');
            }
        } else if (score >= settings.minConfidence && warnings.length <= Number(settings.maxWatchWarnings ?? 2) && qualityCheck.watchOk) {
            action = `WATCH ${side}`;
        }

        return {
            symbol,
            strike,
            side,
            action,
            score,
            confidence: score,
            option,
            risk,
            bias,
            reasons: reasons.slice(0, 5),
            warnings: warnings.slice(0, 4),
            buyBlockers: qualityCheck.ok ? [] : qualityCheck.warnings.slice(0, 4),
            qualityPenalty: qualityCheck.penalty
        };
    },

    getTradeQualityCheck: function(context = {}) {
        const settings = Config.optionScanner || {};
        const option = context.option || {};
        const opposite = context.opposite || {};
        const risk = context.risk || {};
        const warnings = [];
        let penalty = 0;

        const entry = Number(risk.entry || option.ltp || 0);
        const stopLoss = Number(risk.stopLoss || 0);
        const target1 = Number(risk.target1 || 0);
        const riskAmount = entry - stopLoss;
        const rewardAmount = target1 - entry;
        const rewardRisk = riskAmount > 0 ? rewardAmount / riskAmount : 0;
        const maxRiskPercent = Number(settings.maxOptionRiskPercent || 26);
        const actualRiskPercent = entry > 0 && riskAmount > 0 ? (riskAmount / entry) * 100 : 999;

        if (!entry || !stopLoss || riskAmount <= 0) {
            warnings.push('Risk plan is not valid');
            penalty += 20;
        } else if (actualRiskPercent > maxRiskPercent) {
            warnings.push(`Risk ${actualRiskPercent.toFixed(1)}% is too high`);
            penalty += 12;
        }

        if (!rewardRisk || rewardRisk < Number(settings.minRewardRiskForBuy || 1.5)) {
            warnings.push(`Reward/risk ${rewardRisk.toFixed(2)} is weak`);
            penalty += 10;
        }

        if (Number(option.change || 0) < 0 || Number(option.changePercent || 0) < 0) {
            warnings.push('Option price is falling');
            penalty += 18;
        }

        if (opposite.ltp > 0 && Number(opposite.change || 0) > Number(option.change || 0)) {
            warnings.push('Opposite option side is stronger');
            penalty += 8;
        }

        if (option.spreadPercent !== null && Number(option.spreadPercent) > Number(settings.maxSpreadPercent || 5)) {
            warnings.push('Bid-ask spread is too wide');
            penalty += 12;
        }

        if (context.bias?.direction !== context.wantedDirection) {
            warnings.push('Underlying direction is not aligned');
            penalty += 24;
        }

        if (!context.vwapConfirmed && !context.breakoutConfirmed) {
            warnings.push('ICT bias is not confirmed');
            penalty += 12;
        }

        if (!context.structureClear && !context.breakoutConfirmed) {
            warnings.push('ICT structure/liquidity is not clear');
            penalty += 12;
        }

        if (Config.optionScanner?.greeks?.requireForBuy === true
            && (context.greeksCheck?.risky || context.greeksCheck?.confirmed === false)) {
            warnings.push('Greeks/expiry risk filter failed');
            penalty += 16;
        }

        const totalWarnings = Number((context.warnings || []).length) + warnings.length;
        const ok = penalty <= 18 && totalWarnings <= Number(settings.maxBuyWarnings ?? 2);
        const watchOk = penalty <= 34 && totalWarnings <= Number(settings.maxWatchWarnings ?? 3);

        return {
            ok,
            watchOk,
            penalty,
            warnings: warnings.slice(0, 3)
        };
    },

    createNoTrade: function(symbol, strike, side, option, score, warnings) {
        return {
            symbol,
            strike,
            side,
            action: 'NO TRADE',
            score,
            confidence: score,
            option,
            risk: this.createRiskPlan(option.ltp || 0),
            bias: { direction: 'NEUTRAL', strength: 0, reasons: [] },
            reasons: [],
            warnings
        };
    },

    createRiskPlan: function(entry, context = {}) {
        if (!entry || entry <= 0) {
            return { entry: 0, stopLoss: 0, target1: 0, target2: 0, target3: 0, maxLossPercent: 0 };
        }

        const settings = Config.optionScanner;
        const stopSettings = settings.stopLoss || {};
        const maxLossPercent = Number(settings.maxOptionRiskPercent || 32);
        const fallbackRiskPercent = Number(stopSettings.fallbackRiskPercent || maxLossPercent);
        const minRiskPercent = Math.min(
            Number(stopSettings.minRiskPercent || 0),
            maxLossPercent
        );

        // === SMART SL: Multiple methods, pick best confirmed ===
        const optionSupportRisk = this.getOptionSupportRiskAmount(entry, context.option);
        const structureRisk = optionSupportRisk || this.getStructureRiskAmount(entry, context);
        const fibonacciRisk = this.getFibonacciBasedRisk(entry, context);
        const vpaRisk = this.getVPABasedRisk(entry, context);

        const fallbackRisk = entry * (fallbackRiskPercent / 100);
        const minRisk = entry * (minRiskPercent / 100);
        const maxRisk = entry * (maxLossPercent / 100);

        // Collect all valid SL candidates
        const slCandidates = [];
        if (structureRisk?.riskAmount > 0) {
            slCandidates.push({ amount: structureRisk.riskAmount, basis: structureRisk.basis, confidence: 70 });
        }
        if (fibonacciRisk?.riskAmount > 0) {
            slCandidates.push({ amount: fibonacciRisk.riskAmount, basis: fibonacciRisk.basis, confidence: fibonacciRisk.confidence || 75 });
        }
        if (vpaRisk?.riskAmount > 0) {
            slCandidates.push({ amount: vpaRisk.riskAmount, basis: vpaRisk.basis, confidence: vpaRisk.confidence || 72 });
        }

        // Pick best SL: prefer highest confidence, then tightest within limits
        let bestRisk = null;
        if (slCandidates.length) {
            // Sort by confidence desc, then by tighter risk
            slCandidates.sort((a, b) => b.confidence - a.confidence || a.amount - b.amount);
            bestRisk = slCandidates[0];

            // If multiple methods agree on similar SL, boost confidence (confirmed SL)
            if (slCandidates.length >= 2) {
                const tolerance = entry * 0.05; // 5% tolerance
                const firstTwo = slCandidates.slice(0, 2);
                if (Math.abs(firstTwo[0].amount - firstTwo[1].amount) <= tolerance) {
                    bestRisk.basis = 'confirmed-' + firstTwo[0].basis + '+' + firstTwo[1].basis;
                    bestRisk.confidence = Math.min(95, bestRisk.confidence + 15);
                }
            }
        }

        const rawRisk = bestRisk?.amount || structureRisk?.riskAmount || fallbackRisk;
        const riskAmount = bestRisk?.basis?.startsWith('option-support')
            ? Math.min(rawRisk, maxRisk)
            : Math.max(minRisk, Math.min(rawRisk, maxRisk));
        const stopLoss = Math.max(entry - riskAmount, 0.05);

        // === SMART TARGETS: Fibonacci + Resistance based ===
        const smartTargets = this.getSmartTargets(entry, riskAmount, context);
        const target1 = smartTargets.target1;
        const target2 = smartTargets.target2;
        const target3 = smartTargets.target3;

        return {
            entry,
            stopLoss,
            target1,
            target2,
            target3,
            maxLossPercent,
            stopBasis: bestRisk?.basis || structureRisk?.basis || 'option-risk',
            stopConfidence: bestRisk?.confidence || 50,
            optionSupport: optionSupportRisk?.optionSupport || null,
            underlyingStop: structureRisk?.underlyingStop || null,
            targetBasis: smartTargets.basis || 'risk-reward',
            riskReward: riskAmount > 0 ? Number(((target1 - entry) / riskAmount).toFixed(2)) : 0
        };
    },

    // Fibonacci-based SL: use nearest Fibonacci retracement below entry as stop
    getFibonacciBasedRisk: function(entry, context = {}) {
        const { indicators, side, spotPrice } = context;
        if (!indicators) return null;

        const fib = indicators.FibonacciContext;
        const fischerTargets = indicators.FischerDualRatio;
        if (!fib || !TechnicalIndicators.isNumber(fib.swingHigh) || !TechnicalIndicators.isNumber(fib.swingLow)) return null;

        const spot = Number(spotPrice || fib.currentPrice || 0);
        if (!spot) return null;

        const isCall = side === 'CALL';
        const range = fib.swingHigh - fib.swingLow;
        if (range <= 0) return null;

        // For CALL: SL below nearest Fibonacci support level
        // For PUT: SL above nearest Fibonacci resistance level
        const retracements = fib.retracements || {};
        const levels = Object.entries(retracements)
            .map(([ratio, value]) => ({ ratio: Number(ratio), value: Number(value) }))
            .filter(l => TechnicalIndicators.isNumber(l.value));

        let fibStop = null;
        let confidence = 70;

        if (isCall) {
            // Find highest Fibonacci level BELOW current spot
            const supports = levels
                .filter(l => l.value < spot)
                .sort((a, b) => b.value - a.value);
            if (supports.length) {
                fibStop = supports[0].value;
                // 61.8% and 50% are strongest support = higher confidence
                if (supports[0].ratio >= 0.5 && supports[0].ratio <= 0.618) confidence = 85;
                else if (supports[0].ratio === 0.382) confidence = 78;
            }
        } else {
            // For PUT: find lowest Fibonacci level ABOVE current spot
            const resistances = levels
                .filter(l => l.value > spot)
                .sort((a, b) => a.value - b.value);
            if (resistances.length) {
                fibStop = resistances[0].value;
                if (resistances[0].ratio >= 0.5 && resistances[0].ratio <= 0.618) confidence = 85;
                else if (resistances[0].ratio === 0.382) confidence = 78;
            }
        }

        if (!TechnicalIndicators.isNumber(fibStop)) return null;

        // In golden zone = highest confidence
        if (fib.inGoldenZone) confidence = Math.min(95, confidence + 10);

        // Convert underlying stop to option risk using delta
        const delta = Math.abs(Number(context.greeks?.delta || 0.45));
        const effectiveDelta = Math.max(delta, 0.25);
        const underlyingRisk = isCall ? (spot - fibStop) : (fibStop - spot);
        if (underlyingRisk <= 0) return null;

        const buffer = spot * 0.001; // Small buffer below fib level
        const riskAmount = Math.min(entry * 0.85, (underlyingRisk + buffer) * effectiveDelta);
        if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;

        return {
            riskAmount,
            fibStop,
            basis: `fib-${isCall ? 'support' : 'resistance'}`,
            confidence
        };
    },

    // VPA-based SL: use volume absorption levels and stopping volume as stops
    getVPABasedRisk: function(entry, context = {}) {
        const { indicators, side, spotPrice } = context;
        if (!indicators) return null;

        const vpa = indicators.VPA;
        const levels = indicators.SupportResistance;
        if (!vpa) return null;

        const spot = Number(spotPrice || levels?.currentPrice || 0);
        if (!spot) return null;

        const isCall = side === 'CALL';
        let confidence = 65;
        let vpaStop = null;

        // VPA Stopping Volume = strong support/resistance confirmed by volume
        if (vpa.primary) {
            if (isCall && (vpa.primary.name === 'Stopping Volume' || vpa.primary.name === 'Absorption at Support')) {
                // Recent candle low is volume-confirmed support
                confidence = 80;
            } else if (!isCall && (vpa.primary.name === 'Supply Overcoming' || vpa.primary.name === 'Absorption at Resistance')) {
                confidence = 80;
            }
        }

        // If VPA shows accumulation, SL should be below recent low (smart money buying there)
        if (isCall && vpa.accumulation) {
            confidence = Math.min(88, confidence + 12);
        }
        if (!isCall && vpa.distribution) {
            confidence = Math.min(88, confidence + 12);
        }

        // Use S/R levels confirmed by VPA as stop
        if (levels) {
            if (isCall && levels.support && TechnicalIndicators.isNumber(levels.support.value)) {
                vpaStop = levels.support.value;
                // Multi-touch support with VPA confirmation = very reliable
                if (levels.support.touches >= 2) confidence = Math.min(92, confidence + 8);
            } else if (!isCall && levels.resistance && TechnicalIndicators.isNumber(levels.resistance.value)) {
                vpaStop = levels.resistance.value;
                if (levels.resistance.touches >= 2) confidence = Math.min(92, confidence + 8);
            }
        }

        if (!TechnicalIndicators.isNumber(vpaStop)) return null;

        const delta = Math.abs(Number(context.greeks?.delta || 0.45));
        const effectiveDelta = Math.max(delta, 0.25);
        const underlyingRisk = isCall ? (spot - vpaStop) : (vpaStop - spot);
        if (underlyingRisk <= 0) return null;

        const riskAmount = Math.min(entry * 0.85, underlyingRisk * effectiveDelta);
        if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;

        return {
            riskAmount,
            vpaStop,
            basis: 'vpa-confirmed',
            confidence
        };
    },

    // Smart Targets: use Fibonacci extensions + Resistance levels instead of fixed R:R
    getSmartTargets: function(entry, riskAmount, context = {}) {
        const { indicators, side, spotPrice } = context;
        const settings = Config.optionScanner;

        // Fallback: fixed R:R targets
        const fallbackT1 = entry + (riskAmount * settings.firstTargetRiskReward);
        const fallbackT2 = entry + (riskAmount * settings.secondTargetRiskReward);
        const fallbackT3 = entry + (riskAmount * (settings.secondTargetRiskReward * 1.5));

        if (!indicators || !spotPrice) {
            return { target1: fallbackT1, target2: fallbackT2, target3: fallbackT3, basis: 'risk-reward' };
        }

        const fib = indicators.FibonacciContext;
        const levels = indicators.SupportResistance;
        const fischer = indicators.FischerSynergy;
        const isCall = side === 'CALL';
        const spot = Number(spotPrice || 0);
        const delta = Math.abs(Number(context.greeks?.delta || 0.45));
        const effectiveDelta = Math.max(delta, 0.25);

        const targetCandidates = [];
        let basis = 'risk-reward';

        // === Fibonacci Extension Targets ===
        if (fib && fib.extensions) {
            const extensions = Object.entries(fib.extensions)
                .map(([ratio, value]) => ({ ratio: Number(ratio), value: Number(value) }))
                .filter(l => TechnicalIndicators.isNumber(l.value));

            extensions.forEach(ext => {
                if (isCall && ext.value > spot) {
                    const move = (ext.value - spot) * effectiveDelta;
                    targetCandidates.push({ price: entry + move, source: `Fib ${ext.ratio}x`, priority: ext.ratio >= 1.618 ? 2 : 1 });
                } else if (!isCall && ext.value < spot) {
                    const move = (spot - ext.value) * effectiveDelta;
                    targetCandidates.push({ price: entry + move, source: `Fib ${ext.ratio}x`, priority: ext.ratio >= 1.618 ? 2 : 1 });
                }
            });
        }

        // === Resistance/Support Level Targets ===
        if (levels) {
            if (isCall && levels.resistances) {
                levels.resistances.forEach((r, i) => {
                    if (TechnicalIndicators.isNumber(r.value) && r.value > spot) {
                        const move = (r.value - spot) * effectiveDelta;
                        targetCandidates.push({ price: entry + move, source: `Resistance ${i + 1}`, priority: i === 0 ? 1 : 2 });
                    }
                });
            } else if (!isCall && levels.supports) {
                levels.supports.forEach((s, i) => {
                    if (TechnicalIndicators.isNumber(s.value) && s.value < spot) {
                        const move = (spot - s.value) * effectiveDelta;
                        targetCandidates.push({ price: entry + move, source: `Support ${i + 1}`, priority: i === 0 ? 1 : 2 });
                    }
                });
            }
        }

        // === Fischer Synergy Price Targets ===
        if (fischer && fischer.priceTarget) {
            const ft = fischer.priceTarget;
            if (TechnicalIndicators.isNumber(ft.moderate)) {
                const move = Math.abs(ft.moderate - spot) * effectiveDelta;
                if (move > 0) targetCandidates.push({ price: entry + move, source: 'Fischer Moderate', priority: 2 });
            }
            if (TechnicalIndicators.isNumber(ft.aggressive)) {
                const move = Math.abs(ft.aggressive - spot) * effectiveDelta;
                if (move > 0) targetCandidates.push({ price: entry + move, source: 'Fischer Aggressive', priority: 3 });
            }
        }

        // Filter only targets above entry and sort by price
        const validTargets = targetCandidates
            .filter(t => t.price > entry + (riskAmount * 0.5)) // At least 0.5R reward
            .sort((a, b) => a.price - b.price);

        if (validTargets.length >= 2) {
            basis = 'fibonacci+structure';
            // T1 = nearest structure target (conservative)
            // T2 = next target or Fib 1.618 extension
            // T3 = furthest target (aggressive)
            const t1 = validTargets[0].price;
            const t2 = validTargets[Math.min(1, validTargets.length - 1)].price;
            const t3 = validTargets[Math.min(2, validTargets.length - 1)].price;

            return {
                target1: Math.max(t1, fallbackT1 * 0.8), // Don't go below 80% of fallback
                target2: Math.max(t2, fallbackT2 * 0.8),
                target3: Math.max(t3, fallbackT2),
                basis,
                targetDetails: validTargets.slice(0, 3).map(t => t.source)
            };
        } else if (validTargets.length === 1) {
            basis = 'structure+rr';
            return {
                target1: Math.max(validTargets[0].price, fallbackT1 * 0.8),
                target2: fallbackT2,
                target3: fallbackT3,
                basis,
                targetDetails: [validTargets[0].source]
            };
        }

        return { target1: fallbackT1, target2: fallbackT2, target3: fallbackT3, basis: 'risk-reward' };
    },

    getOptionSupportRiskAmount: function(entry, option = {}) {
        const price = Number(entry || 0);
        if (!price) return null;

        const stopSettings = Config.optionScanner.stopLoss || {};
        const candidates = [
            option.low,
            option.previousClose
        ]
            .map(Number)
            .filter(value => Number.isFinite(value) && value > 0 && value < price);

        if (!candidates.length) return null;

        const optionSupport = Math.max(...candidates);
        const bufferPercent = Number(stopSettings.optionSupportBufferPercent ?? 4);
        const minBuffer = Math.max(price * 0.015, 0.05);
        const buffer = Math.max(optionSupport * (bufferPercent / 100), minBuffer);
        const calculatedStopLoss = Math.max(optionSupport - buffer, 0.05);
        const riskAmount = price - stopLoss;

        // Enforce a minimum risk to avoid overly tight stop-losses
        const minRiskAmount = price * (Number(Config.optionScanner.stopLoss.minRiskPercent || 5) / 100);
        const finalRiskAmount = Math.max(riskAmount, minRiskAmount);
        if (!Number.isFinite(finalRiskAmount) || finalRiskAmount <= 0) return null;

        return {
            riskAmount,
            optionSupport,
            basis: 'option-support'
        };
    },

    getStructureRiskAmount: function(entry, context = {}) {
        const { side, spotPrice, levels, advancedIct, atr, greeks } = context;
        const spot = Number(spotPrice || levels?.currentPrice || 0);
        if (!spot) return null;

        const stopSettings = Config.optionScanner.stopLoss || {};
        const isCall = side === 'CALL';
        const poiStop = this.getAdvancedPoiStop(isCall, spot, advancedIct);
        const barrier = poiStop
            ? { value: poiStop.value, basis: poiStop.basis }
            : isCall ? levels?.support : levels?.resistance;
        if (!barrier || !TechnicalIndicators.isNumber(barrier.value)) return null;

        const percentBuffer = spot * (Number(stopSettings.supportBufferPercent ?? 0.08) / 100);
        const atrBuffer = TechnicalIndicators.isNumber(atr)
            ? atr * Number(stopSettings.atrBufferMultiplier ?? 0.12)
            : 0;
        const buffer = Math.max(percentBuffer, atrBuffer);
        const underlyingStop = isCall
            ? Number(barrier.value) - buffer
            : Number(barrier.value) + buffer;
        const underlyingRisk = isCall ? spot - underlyingStop : underlyingStop - spot;
        if (!Number.isFinite(underlyingRisk) || underlyingRisk <= 0) return null;

        const delta = Math.abs(Number(greeks?.delta || 0));
        const effectiveDelta = Number.isFinite(delta) && delta > 0
            ? Math.max(delta, 0.25)
            : 0.45;
        const riskAmount = Math.min(entry * 0.9, underlyingRisk * effectiveDelta);

        if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;

        return {
            riskAmount,
            underlyingStop,
            basis: barrier.basis || (isCall ? 'support-based' : 'resistance-based')
        };
    },

    getAdvancedPoiStop: function(isCall, spot, advancedIct = {}) {
        const activePoi = advancedIct.activePoi;
        if (!activePoi) return null;

        if (isCall && activePoi.direction === 'BULLISH' && activePoi.low < spot) {
            return { value: activePoi.low, basis: 'advanced-ict-poi' };
        }
        if (!isCall && activePoi.direction === 'BEARISH' && activePoi.high > spot) {
            return { value: activePoi.high, basis: 'advanced-ict-poi' };
        }

        return null;
    },

    evaluateChain: function(symbol, rawData, indicators, fallbackSpot = 0, options = {}) {
        const normalized = this.normalizeChain(rawData, fallbackSpot);
        const step = this.getStrikeStep(symbol);
        const atmStrike = this.roundToStrike(normalized.spotPrice, step);
        const width = Config.optionScanner.nearAtmStrikes;
        const expiryDate = rawData?.expiryDate || rawData?.requestedExpiryDate || rawData?.expiry || '';
        const rows = [];
        const availableStrikes = [...new Set([
            ...Object.keys(normalized.calls || {}),
            ...Object.keys(normalized.puts || {})
        ].map(Number).filter(Number.isFinite))];
        const strikesToEvaluate = availableStrikes.length
            ? availableStrikes
                .sort((a, b) => Math.abs(a - normalized.spotPrice) - Math.abs(b - normalized.spotPrice))
                .slice(0, (width * 2) + 1)
                .sort((a, b) => a - b)
            : Array.from({ length: (width * 2) + 1 }, (_, index) => atmStrike + ((index - width) * step));

        strikesToEvaluate.forEach(strike => {
            const call = this.evaluateOption({
                symbol,
                strike,
                side: 'CALL',
                optionData: normalized.calls[strike],
                oppositeData: normalized.puts[strike],
                spotPrice: normalized.spotPrice,
                indicators,
                expiryDate,
                timeframe: options.timeframe
            });
            const put = this.evaluateOption({
                symbol,
                strike,
                side: 'PUT',
                optionData: normalized.puts[strike],
                oppositeData: normalized.calls[strike],
                spotPrice: normalized.spotPrice,
                indicators,
                expiryDate,
                timeframe: options.timeframe
            });

            rows.push({ strike, call, put });
        });

        const settings = Config.optionScanner;
        const candidates = rows
            .flatMap(row => [row.call, row.put])
            .filter(item => item.action !== 'NO TRADE')
            .sort((a, b) => b.score - a.score);

        if (!candidates.length && settings.showBestWatchWhenNoBuy !== false) {
            const fallback = rows
                .flatMap(row => [row.call, row.put])
                .filter(item => Number(item.option?.ltp || 0) > 0)
                .filter(item => Number(item.score || 0) >= Number(settings.minWatchScore || 45))
                .sort((a, b) => b.score - a.score)[0];

            if (fallback) {
                fallback.action = `WATCH ${fallback.side}`;
                fallback.warnings = [
                    'Best available setup; confirmations incomplete',
                    ...(fallback.warnings || [])
                ].slice(0, 4);
                candidates.push(fallback);
            }
        }

        return {
            symbol,
            spotPrice: normalized.spotPrice,
            atmStrike,
            rows,
            best: candidates[0] || null,
            bias: this.getUnderlyingBias(indicators),
            indicators
        };
    },

    formatMoney: function(value) {
        return Number(value || 0).toFixed(2);
    }
};
