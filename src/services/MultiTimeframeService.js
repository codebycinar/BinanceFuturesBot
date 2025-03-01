// MultiTimeframeService.js
const logger = require('../utils/logger');
const config = require('../config/config');
const ti = require('technicalindicators');

class MultiTimeframeService {
    constructor(binanceService) {
        this.binanceService = binanceService;
        this.timeframes = ['5m', '15m', '1h', '4h'];
    }

    async initialize() {
        try {
            // Gerekli kontrolleri yap
            logger.info('MultiTimeframeService initialized successfully.');
        } catch (error) {
            logger.error('Error initializing MultiTimeframeService:', error.message);
            throw error;
        }
    }

    async getMultiTimeframeData(symbol, customTimeframes = null) {
        try {
            const timeframes = customTimeframes || this.timeframes;
            const result = {};

            // Fetch candles for all timeframes concurrently
            const requests = timeframes.map(timeframe =>
                this.binanceService.getCandles(symbol, timeframe, 100)
                    .then(candles => {
                        result[timeframe] = candles;
                        return { timeframe, candles };
                    })
                    .catch(error => {
                        logger.error(`Error fetching ${timeframe} candles for ${symbol}: ${error.message}`);
                        return { timeframe, candles: null };
                    })
            );

            await Promise.all(requests);

            // Calculate indicators for each timeframe
            const indicators = {};

            for (const timeframe of timeframes) {
                const candles = result[timeframe];
                if (!candles || candles.length === 0) {
                    logger.warn(`No candles data for ${symbol} on ${timeframe} timeframe`);
                    indicators[timeframe] = null;
                    continue;
                }

                indicators[timeframe] = this.calculateAllIndicators(candles);
            }

            return {
                candles: result,
                indicators: indicators
            };
        } catch (error) {
            logger.error(`Error in MultiTimeframeService for ${symbol}: ${error.message}`);
            throw error;
        }
    }

    calculateAllIndicators(candles) {
        if (!candles || candles.length < 30) {
            return null;
        }

        const closes = candles.map(c => parseFloat(c.close));
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));

        try {
            const bbResult = this.calculateBollingerBands(closes);
            const rsi = this.calculateRSI(closes);
            const macd = this.calculateMACD(closes);
            const adx = this.calculateADX(candles);
            const atr = this.calculateATR(candles);
            const stochastic = this.calculateStochastic(candles);

            return {
                bollinger: bbResult,
                rsi,
                macd,
                adx,
                atr,
                stochastic
            };
        } catch (error) {
            logger.error(`Error calculating indicators: ${error.message}`);
            return null;
        }
    }

    calculateBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
        if (closes.length < period) {
            throw new Error('Not enough data to calculate Bollinger Bands');
        }

        const recentPrices = closes.slice(-period);
        const mean = recentPrices.reduce((acc, val) => acc + val, 0) / period;
        const variance = recentPrices.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        return {
            upper: mean + stdDevMultiplier * stdDev,
            lower: mean - stdDevMultiplier * stdDev,
            basis: mean,
            width: ((mean + stdDevMultiplier * stdDev) - (mean - stdDevMultiplier * stdDev)) / mean,
            pctB: (closes[closes.length - 1] - (mean - stdDevMultiplier * stdDev)) /
                ((mean + stdDevMultiplier * stdDev) - (mean - stdDevMultiplier * stdDev))
        };
    }

    calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) {
            throw new Error('Not enough data to calculate RSI');
        }

        try {
            const rsi = ti.RSI.calculate({
                values: closes,
                period: period
            });

            return {
                value: rsi[rsi.length - 1],
                values: rsi.slice(-5),
                period: period
            };
        } catch (error) {
            logger.error(`RSI calculation error: ${error.message}`);
            return null;
        }
    }

    calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (closes.length < slowPeriod + signalPeriod) {
            throw new Error('Not enough data to calculate MACD');
        }

        try {
            const macd = ti.MACD.calculate({
                values: closes,
                fastPeriod: fastPeriod,
                slowPeriod: slowPeriod,
                signalPeriod: signalPeriod
            });

            const lastMACD = macd[macd.length - 1];

            return {
                value: lastMACD.MACD,
                signal: lastMACD.signal,
                histogram: lastMACD.histogram,
                values: macd.slice(-5)
            };
        } catch (error) {
            logger.error(`MACD calculation error: ${error.message}`);
            return null;
        }
    }

    calculateADX(candles, period = 14) {
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));
        const closes = candles.map(c => parseFloat(c.close));

        if (highs.length < period + 2) {
            throw new Error('Not enough data to calculate ADX');
        }

        try {
            const adx = ti.ADX.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: period
            });

            const lastADX = adx[adx.length - 1];

            return {
                adx: lastADX.adx,
                pdi: lastADX.pdi,
                mdi: lastADX.mdi,
                values: adx.slice(-5)
            };
        } catch (error) {
            logger.error(`ADX calculation error: ${error.message}`);
            return null;
        }
    }

    calculateATR(candles, period = 14) {
        try {
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));
            const closes = candles.map(c => parseFloat(c.close));

            if (highs.length < period + 1) {
                throw new Error('Not enough data to calculate ATR');
            }

            const atr = ti.ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: period
            });

            const currentATR = atr[atr.length - 1];
            const trendATRValues = atr.slice(-7);
            const averageATR = trendATRValues.reduce((acc, val) => acc + val, 0) / 7;
            const atrTrend = currentATR > averageATR * 1.1 ? 'UP' :
                currentATR < averageATR * 0.9 ? 'DOWN' : 'NEUTRAL';

            return {
                value: currentATR,
                trend: atrTrend,
                values: atr.slice(-5)
            };
        } catch (error) {
            logger.error(`ATR calculation error: ${error.message}`);
            return null;
        }
    }

    calculateStochastic(candles, kPeriod = 14, dPeriod = 3) {
        try {
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));
            const closes = candles.map(c => parseFloat(c.close));

            if (highs.length < kPeriod) {
                throw new Error('Not enough data to calculate Stochastic');
            }

            const stochastic = ti.Stochastic.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: kPeriod,
                signalPeriod: dPeriod
            });

            const lastStoch = stochastic[stochastic.length - 1];

            return {
                k: lastStoch.k,
                d: lastStoch.d,
                values: stochastic.slice(-5)
            };
        } catch (error) {
            logger.error(`Stochastic calculation error: ${error.message}`);
            return null;
        }
    }

    // Trend analysis across timeframes
    analyzeMultiTimeframeTrend(mtfData) {
        try {
            const analysis = {
                trend: null,
                strength: 0,
                signals: {}
            };

            const timeframes = Object.keys(mtfData.indicators);
            let bullishCount = 0;
            let bearishCount = 0;

            for (const timeframe of timeframes) {
                const indicators = mtfData.indicators[timeframe];
                if (!indicators) continue;

                const timeframeAnalysis = this.analyzeTrend(indicators);
                if (timeframeAnalysis.trend === 'bullish') bullishCount++;
                if (timeframeAnalysis.trend === 'bearish') bearishCount++;

                analysis.signals[timeframe] = timeframeAnalysis;
            }

            // Calculate overall trend based on multiple timeframes
            analysis.trend = bullishCount > bearishCount ? 'bullish' :
                bearishCount > bullishCount ? 'bearish' : 'neutral';

            // Calculate trend strength (0-100)
            const timeframeCount = timeframes.length;
            analysis.strength = Math.abs(bullishCount - bearishCount) / timeframeCount * 100;

            return analysis;
        } catch (error) {
            logger.error(`Error analyzing multi-timeframe trend: ${error.message}`);
            return { trend: 'neutral', strength: 0, signals: {} };
        }
    }

    analyzeTrend(indicators) {
        // Get individual indicator signals
        const bbSignal = this.getBollingerSignal(indicators.bollinger);
        const rsiSignal = this.getRSISignal(indicators.rsi);
        const macdSignal = this.getMACDSignal(indicators.macd);
        const adxSignal = this.getADXSignal(indicators.adx);
        const stochSignal = this.getStochasticSignal(indicators.stochastic);

        // Count bullish and bearish signals
        const signals = [bbSignal, rsiSignal, macdSignal, adxSignal, stochSignal];
        const bullishCount = signals.filter(signal => signal === 'bullish').length;
        const bearishCount = signals.filter(signal => signal === 'bearish').length;

        // Determine trend direction and strength
        let trend;
        if (bullishCount > bearishCount) {
            trend = 'bullish';
        } else if (bearishCount > bullishCount) {
            trend = 'bearish';
        } else {
            trend = 'neutral';
        }

        return {
            trend: trend,
            strength: Math.abs(bullishCount - bearishCount) / signals.length,
            indicators: {
                bollinger: bbSignal,
                rsi: rsiSignal,
                macd: macdSignal,
                adx: adxSignal,
                stochastic: stochSignal
            }
        };
    }

    getBollingerSignal(bollinger) {
        if (!bollinger) return 'neutral';

        const pctB = bollinger.pctB;

        if (pctB > 1) return 'bearish'; // Above upper band
        if (pctB < 0) return 'bullish'; // Below lower band
        if (pctB > 0.8) return 'bearish'; // Near upper band
        if (pctB < 0.2) return 'bullish'; // Near lower band

        return 'neutral';
    }

    getRSISignal(rsi) {
        if (!rsi) return 'neutral';

        const value = rsi.value;

        if (value > 70) return 'bearish';
        if (value < 30) return 'bullish';
        if (value > 60) return 'bearish';
        if (value < 40) return 'bullish';

        return 'neutral';
    }

    getMACDSignal(macd) {
        if (!macd) return 'neutral';

        // Histogram = MACD Line - Signal Line
        // Positive = Bullish, Negative = Bearish
        if (macd.histogram > 0 && macd.value > 0) return 'bullish';
        if (macd.histogram < 0 && macd.value < 0) return 'bearish';

        return 'neutral';
    }

    getADXSignal(adx) {
        if (!adx) return 'neutral';

        // Strong trend when ADX > 25
        // Weak trend when ADX < 20
        if (adx.adx < 20) return 'neutral';

        // Determine trend direction from DI lines
        if (adx.pdi > adx.mdi) return 'bullish';
        if (adx.mdi > adx.pdi) return 'bearish';

        return 'neutral';
    }

    getStochasticSignal(stochastic) {
        if (!stochastic) return 'neutral';

        // Overbought/oversold signals
        if (stochastic.k > 80 && stochastic.d > 80) return 'bearish';
        if (stochastic.k < 20 && stochastic.d < 20) return 'bullish';

        // Crossover signals (K crossing D)
        const values = stochastic.values;
        if (values.length >= 2) {
            const current = values[values.length - 1];
            const previous = values[values.length - 2];

            if (current.k > current.d && previous.k < previous.d) return 'bullish';
            if (current.k < current.d && previous.k > previous.d) return 'bearish';
        }

        return 'neutral';
    }
}

module.exports = MultiTimeframeService;