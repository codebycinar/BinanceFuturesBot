const { SMA, RSI, MACD, ADX } = require('technicalindicators');
const logger = require('../utils/logger');

class TrendFollowStrategy {
  constructor(config = {}) {
    this.parameters = {
      sma1Period: 20,
      sma2Period: 50,
      rsiPeriod: 14,
      adxThreshold: 25,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      atrPeriod: 14,
      atrMultiplier: 2
    };
    
    // Trend takip stratejisi için orta-uzun vadeli bir zaman dilimi tercih edilir
    this.preferredTimeframe = config.preferredTimeframe || '4h';
  }

  async initialize() {
    logger.info('TrendFollowStrategy initialized');
  }

  // New method for compatibility with AdaptiveStrategy
  async generateSignal(candles, symbol) {
    try {
      if (!candles || candles.length < 50) {
        logger.warn(`Not enough candles for ${symbol} to generate Trend Follow signal`);
        return { signal: 'NEUTRAL' };
      }

      // Call the analyze method with the candles
      const signal = this.analyze(candles);
      
      // Convert LONG/SHORT/NEUTRAL to BUY/SELL/NEUTRAL
      let tradingSignal = 'NEUTRAL';
      if (signal === 'LONG') tradingSignal = 'BUY';
      if (signal === 'SHORT') tradingSignal = 'SELL';

      // Calculate ATR for stop loss and take profit
      const atr = this.calculateATR(candles, this.parameters.atrPeriod);
      const currentPrice = parseFloat(candles[candles.length - 1].close);
      
      // Set stop loss and take profit based on ATR
      let stopLoss, takeProfit;
      if (tradingSignal === 'BUY') {
        stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
        takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * 2); // 2:1 risk-reward
      } else if (tradingSignal === 'SELL') {
        stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
        takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * 2); // 2:1 risk-reward
      }

      // Default allocation from config
      const allocation = 100; // This will be overridden by the position sizing in MarketScanner

      logger.info(`Trend Follow scan for ${symbol}: Signal=${tradingSignal}, Price=${currentPrice}, StopLoss=${stopLoss}, TakeProfit=${takeProfit}`);
      
      return {
        signal: tradingSignal,
        stopLoss,
        takeProfit,
        allocation
      };
    } catch (error) {
      logger.error(`Error generating Trend Follow signal for ${symbol}: ${error.message}`);
      return { signal: 'NEUTRAL' };
    }
  }

  analyze(candles) {
    const closes = candles.map(candle => parseFloat(candle.close));
    const highs = candles.map(candle => parseFloat(candle.high));
    const lows = candles.map(candle => parseFloat(candle.low));

    // Calculate indicators
    const sma20 = SMA.calculate({ period: this.parameters.sma1Period, values: closes });
    const sma50 = SMA.calculate({ period: this.parameters.sma2Period, values: closes });
    const rsi = RSI.calculate({ period: this.parameters.rsiPeriod, values: closes });

    // MACD
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: this.parameters.macdFast,
      slowPeriod: this.parameters.macdSlow,
      signalPeriod: this.parameters.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    // ADX
    const adx = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.parameters.rsiPeriod
    });

    // Get current values
    const currentPrice = closes[closes.length - 1];
    const currentSMA20 = sma20[sma20.length - 1];
    const currentSMA50 = sma50[sma50.length - 1];
    const currentRSI = rsi[rsi.length - 1];
    const currentMACD = macd[macd.length - 1];
    const currentADX = adx[adx.length - 1]?.adx || 0;

    // Dinamik RSI sınırları
    const volatility = Math.abs(currentSMA20 - currentSMA50) / currentSMA50; // Basit volatilite ölçümü
    const upperRSI = 70 - volatility * 10;
    const lowerRSI = 30 + volatility * 10;

    if (currentPrice > currentSMA20 && currentSMA20 > currentSMA50 && 
        currentRSI < upperRSI && currentMACD.histogram > 0 && 
        currentADX > this.parameters.adxThreshold) {
      return 'LONG';
    } else if (currentPrice < currentSMA20 && currentSMA20 < currentSMA50 && 
               currentRSI > lowerRSI && currentMACD.histogram < 0 && 
               currentADX > this.parameters.adxThreshold) {
      return 'SHORT';
    }

    return 'NEUTRAL';
  }

  // Calculate ATR (Average True Range)
  calculateATR(candles, period) {
    try {
      const trValues = [];
      
      // Calculate True Range values
      for (let i = 1; i < candles.length; i++) {
        const currentCandle = candles[i];
        const previousCandle = candles[i - 1];
        
        const high = parseFloat(currentCandle.high);
        const low = parseFloat(currentCandle.low);
        const prevClose = parseFloat(previousCandle.close);
        
        // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        
        trValues.push(tr);
      }
      
      // Get the last 'period' values and calculate average
      const relevantTR = trValues.slice(-period);
      const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
      
      return atr;
    } catch (error) {
      logger.error('Error calculating ATR:', error);
      return 0;
    }
  }
}

module.exports = TrendFollowStrategy;
