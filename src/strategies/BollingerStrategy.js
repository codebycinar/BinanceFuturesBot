const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const ti = require('technicalindicators');

class BollingerStrategy {
  constructor(strategyName) {
    this.strategyName = strategyName;
    this.parameters = null;
  }

  async loadParameters() {
    const strategy = await Strategy.findOne({ where: { name: this.strategyName } });
    if (!strategy) {
      throw new Error(`Strategy ${this.strategyName} not found in database.`);
    }
    this.parameters = strategy.parameters;
  }

  async initialize() {
    await this.loadParameters();
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

    // ATR hesaplaması
    const atrValues = [];
    for (let i = period - 1; i < trueRanges.length; i++) {
      const slice = trueRanges.slice(i - period + 1, i + 1);
      const atr = slice.reduce((acc, val) => acc + val, 0) / period;
      atrValues.push(atr);
    }

    const currentATR = atrValues[atrValues.length - 1];

    // Trend analizi için son 14 birimlik değerler kullanılır
    const trendATRValues = atrValues.slice(-period); // Son 14 değer
    const trendSum = trendATRValues.reduce((acc, val) => acc + val, 0);
    const averageATR = trendSum / period;

    const atrTrend = currentATR > averageATR ? 'UP' : 'DOWN';

    return { current: currentATR, trend: atrTrend };
  }


  async generateSignal(candles, symbol) {
    const highs = candles.map(c => parseFloat(c.high)).filter(val => !isNaN(val));
    const lows = candles.map(c => parseFloat(c.low)).filter(val => !isNaN(val));
    const closes = candles.map(c => parseFloat(c.close)).filter(val => !isNaN(val));

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

    // Varsayılan allocation değeri
    const allocation = this.parameters.allocation || 0.01; // %1 varsayılan olarak ayarlandı

    logger.info(`Scanning ${symbol}:
    - Last Close Price: ${lastClose}
    - Bollinger Bands: Upper=${bb.upper}, Lower=${bb.lower}, Basis=${bb.basis}
    - Price Position: ${isOutsideUpperBB ? 'Above Upper Band' : isOutsideLowerBB ? 'Below Lower Band' : 'Inside Bands'}
    - Stochastic K: ${stochasticK}
    - ATR: Current=${atr.current}, Trend=${atr.trend}
    - Allocation: ${allocation}
    `);

    if (isOutsideLowerBB && stochasticK < 20 && atr.trend === 'UP') {
      logger.info(`BUY signal generated for ${symbol}`);
      return { signal: 'BUY', stopLoss: bb.lower, takeProfit: bb.upper, allocation };
    } else if (isOutsideUpperBB && stochasticK > 80 && atr.trend === 'DOWN') {
      logger.info(`SELL signal generated for ${symbol}`);
      return { signal: 'SELL', stopLoss: bb.upper, takeProfit: bb.lower, allocation };
    }

    logger.info(`No actionable signal for ${symbol}`);
    return { signal: 'NEUTRAL', allocation };
  }

}

module.exports = BollingerStrategy;
