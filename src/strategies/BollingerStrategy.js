const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const ti = require('technicalindicators');
const config = require('../config/config');

class BollingerStrategy {
    constructor(strategyName, config = {}) {
        this.strategyName = strategyName;
        this.parameters = config.strategy || config;
        
        // Bollinger Bands için orta vadeli bir zaman dilimi tercih edilir
        this.preferredTimeframe = config.preferredTimeframe || '1h';
    }

    async loadParameters() {
        const strategy = await Strategy.findOne({ where: { name: this.strategyName } });
        if (!strategy) {
            throw new Error(`Strategy ${this.strategyName} not found in database.`);
        }
        this.parameters = strategy.parameters;
    }

    async initialize() {
        console.log(`Loaded parameters for ${this.strategyName}:`, this.parameters);
    }

    calculateBollingerBands(values, period, stdDevMultiplier) {
        if (values.length < period) {
            throw new Error('Not enough data to calculate Bollinger Bands');
        }

        const bands = [];
        for (let i = period - 1; i < values.length; i++) {
            const slice = values.slice(i - period + 1, i + 1);
            const mean = slice.reduce((acc, val) => acc + val, 0) / slice.length;
            const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / slice.length;
            const stdDev = Math.sqrt(variance);

            bands.push({
                upper: mean + stdDevMultiplier * stdDev,
                lower: mean - stdDevMultiplier * stdDev,
                basis: mean,
            });
        }

        return bands;
    }

    calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) {
            logger.error('Not enough data to calculate RSI');
            return null;
        }

        let gains = 0;
        let losses = 0;
        for (let i = 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateStochastic(candles) {
        const highs = candles.map(c => parseFloat(c.high)).filter(val => !isNaN(val));
        const lows = candles.map(c => parseFloat(c.low)).filter(val => !isNaN(val));
        const closes = candles.map(c => parseFloat(c.close)).filter(val => !isNaN(val));

        const period = this.parameters.stochasticPeriod || 14;
        const signalPeriod = this.parameters.stochasticSignalPeriod || 3;

        if (closes.length < period || highs.length < period || lows.length < period) {
            logger.error('Not enough valid data to calculate Stochastic');
            return null;
        }

        try {
            const stochastic = ti.Stochastic.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: period,
                signalPeriod: signalPeriod,
            });

            if (!stochastic || stochastic.length === 0) {
                logger.error('Stochastic calculation returned no data');
                return null;
            }

            return stochastic[stochastic.length - 1].k;
        } catch (error) {
            logger.error(`Error calculating Stochastic: ${error.message}`);
            return null;
        }
    }

    calculateIndicators(candles) {
        const closes = candles.map(c => parseFloat(c.close));
        if (closes.length < this.parameters.bbPeriod) {
            logger.error('Not enough data to calculate Bollinger Bands');
            return { bb: null };
        }

        try {
            const bb = this.calculateBollingerBands(closes, this.parameters.bbPeriod, this.parameters.bbStdDev);
            return { bb: bb[bb.length - 1] };
        } catch (error) {
            logger.error('Error calculating Bollinger Bands:', error.message);
            return { bb: null };
        }
    }

    calculateADX(candles, period = 14) {
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));
        const closes = candles.map(c => parseFloat(c.close));

        const adxInput = {
            high: highs,
            low: lows,
            close: closes,
            period: period
        };

        try {
            const adx = ti.ADX.calculate(adxInput);
            return adx.length > 0 ? adx[adx.length - 1].adx : null;
        } catch (error) {
            logger.error(`ADX calculation error: ${error.message}`);
            return null;
        }
    }

    calculateATR(candles, period = 14) {
        const validCandles = candles.filter(
            c => !isNaN(parseFloat(c.high)) && !isNaN(parseFloat(c.low)) && !isNaN(parseFloat(c.close))
        );

        if (validCandles.length < period) {
            throw new Error('Not enough valid data to calculate ATR');
        }

        const trueRanges = [];
        for (let i = 1; i < validCandles.length; i++) {
            const currentHigh = parseFloat(validCandles[i].high);
            const currentLow = parseFloat(validCandles[i].low);
            const previousClose = parseFloat(validCandles[i - 1].close);

            const tr = Math.max(
                currentHigh - currentLow,
                Math.abs(currentHigh - previousClose),
                Math.abs(currentLow - previousClose)
            );
            trueRanges.push(tr);
        }

        const atrValues = [];
        for (let i = period - 1; i < trueRanges.length; i++) {
            const slice = trueRanges.slice(i - period + 1, i + 1);
            const atr = slice.reduce((acc, val) => acc + val, 0) / period;
            atrValues.push(atr);
        }

        const currentATR = atrValues[atrValues.length - 1];
        const trendATRValues = atrValues.slice(-7);
        const trendSum = trendATRValues.reduce((acc, val) => acc + val, 0);
        const averageATR = trendSum / 7;
        const atrTrend = currentATR > averageATR * 1.1 ? 'UP' : currentATR < averageATR * 0.9 ? 'DOWN' : 'NEUTRAL';

        return { current: currentATR, trend: atrTrend };
    }

    async generateSignal(candles, symbol) {
        const closes = candles.map(c => parseFloat(c.close)).filter(val => !isNaN(val));
        const rsi = this.calculateRSI(closes);
        const adx = this.calculateADX(candles);

        if (closes.length === 0) {
            logger.error(`No valid close prices for ${symbol}`);
            return { signal: 'NEUTRAL' };
        }

        const indicators = this.calculateIndicators(candles);
        const { bb } = indicators;
        if (!bb || !bb.upper || !bb.lower || !bb.basis) {
            logger.error(`Bollinger Bands data is missing or incomplete for ${symbol}`);
            return { signal: 'NEUTRAL' };
        }

        const stochasticK = this.calculateStochastic(candles);
        if (stochasticK === null) {
            logger.error(`Failed to calculate Stochastic for ${symbol}`);
            return { signal: 'NEUTRAL' };
        }

        const atr = this.calculateATR(candles);
        if (!atr || !atr.current || !atr.trend) {
            logger.error(`Failed to calculate ATR for ${symbol}`);
            return { signal: 'NEUTRAL' };
        }

        const lastClose = closes[closes.length - 1];
        const isOutsideUpperBB = lastClose > bb.upper;
        const isOutsideLowerBB = lastClose < bb.lower;

        const allocation = this.parameters.allocation || 0.01;

        logger.info(`Scanning ${symbol}:
- Last Close Price: ${lastClose}
- Bollinger Bands: Upper=${bb.upper}, Lower=${bb.lower}, Basis=${bb.basis}
- Price Position: ${isOutsideUpperBB ? 'Above Upper Band' : isOutsideLowerBB ? 'Below Lower Band' : 'Inside Bands'}
- Stochastic K: ${stochasticK}
- ATR: Current=${atr.current}, Trend=${atr.trend}
- Allocation: ${allocation}
- Rsi: ${rsi}
- Adx: ${adx}
`);

        const buyConditionNames = [
            "Price Below Lower Bollinger Band",
            "Stochastic K Below 25",
            "ATR Trend Up",
            "RSI Below 35",
            "ADX Above 20"
        ];

        const sellConditionNames = [
            "Price Above Upper Bollinger Band",
            "Stochastic K Above 75",
            "ATR Trend Down",
            "RSI Above 65",
            "ADX Above 20"
        ];

        const strongBuyConditions = [
            isOutsideLowerBB,
            stochasticK < 25,
            atr.trend === 'UP',
            rsi < 35,
            adx > 20
        ];

        const strongSellConditions = [
            isOutsideUpperBB,
            stochasticK > 75,
            atr.trend === 'DOWN',
            rsi > 65,
            adx > 20
        ];

        const weakBuyConditions = strongBuyConditions.filter(condition => condition).length >= 4;
        const weakSellConditions = strongSellConditions.filter(condition => condition).length >= 4;

        let stopLoss, takeProfit;

        if (isOutsideLowerBB) {
            stopLoss = Math.min(bb.lower, lastClose * 0.99);
            takeProfit = bb.upper;
        } else if (isOutsideUpperBB) {
            stopLoss = Math.max(bb.upper, lastClose * 1.01);
            takeProfit = bb.lower;
        } else {
            stopLoss = isOutsideLowerBB ? lastClose * 0.99 : lastClose * 1.01;
            takeProfit = isOutsideLowerBB ? lastClose * 1.01 : lastClose * 0.99;
        }

        if (strongBuyConditions.every(condition => condition)) {
            logger.info(`BUY signal generated for ${symbol}`);
            return { signal: 'BUY', stopLoss, takeProfit, allocation };
        } else if (strongSellConditions.every(condition => condition)) {
            logger.info(`SELL signal generated for ${symbol}`);
            return { signal: 'SELL', stopLoss, takeProfit, allocation };
        }

        if (weakBuyConditions) {
            const unmetConditions = buyConditionNames.filter((_, index) => !strongBuyConditions[index]);
            const unmetConditionsMessage = unmetConditions.join(", ");
            logger.info(`Weak BUY signal detected for ${symbol}. Not opening a position. Unmet conditions: ${unmetConditionsMessage}`);
            return { signal: 'WEAK_BUY', stopLoss, takeProfit, allocation, unmetConditions: unmetConditionsMessage };
        } else if (weakSellConditions) {
            const unmetConditions = sellConditionNames.filter((_, index) => !strongSellConditions[index]);
            const unmetConditionsMessage = unmetConditions.join(", ");
            logger.info(`Weak SELL signal detected for ${symbol}. Not opening a position. Unmet conditions: ${unmetConditionsMessage}`);
            return { signal: 'WEAK_SELL', stopLoss, takeProfit, allocation, unmetConditions: unmetConditionsMessage };
        }

        logger.info(`No actionable signal for ${symbol}`);
        
        // NEUTRAL durumda bile stop loss ve take profit hesapla
        // Bollinger bant mesafesine göre bir risk hesaplaması yap
        const bandWidth = bb.upper - bb.lower;
        const riskPercentage = 0.5; // Risk yüzdesi
        
        // Varsayılan olarak ATR kullanarak daha dinamik stop loss/take profit hesapla
        stopLoss = lastClose - (atr.current * 2); // 2x ATR aşağıda stop loss
        takeProfit = lastClose + (atr.current * 3); // 3x ATR yukarıda take profit (1:1.5 risk/ödül oranı)
        
        return { 
            signal: 'NEUTRAL', 
            stopLoss, 
            takeProfit, 
            allocation,
            unmetConditions: 'No trading signal detected, monitoring only'
        };
    }
}

module.exports = BollingerStrategy;