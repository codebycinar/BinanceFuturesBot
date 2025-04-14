// ScalpingStrategy.js
const logger = require('../utils/logger');
const config = require('../config/config');
const ti = require('technicalindicators');

/**
 * Kısa vadeli hızlı sinyal üreten bir scalping stratejisi
 * - 15 dakikalık grafikler için optimize edilmiştir
 * - RSI, EMA crossover ve MACD kullanır
 * - Hızlı giriş/çıkış hedefler
 */
class ScalpingStrategy {
  constructor() {
    this.name = 'ScalpingStrategy';
    // Strateji için özel tercih edilecek zaman dilimi
    this.preferredTimeframe = '15m';
    
    // Strateji parametreleri
    this.params = {
      // İndikatör parametreleri
      emaFast: 9,
      emaSlow: 21,
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      
      // Pozisyon parametreleri
      stopLossPercent: 0.5, // Daha yakın stop-loss
      takeProfitPercent: 1.0, // Daha yakın take-profit
      allocationPercent: 0.05, // Hesabın %5'i
    };
  }
  
  async initialize() {
    logger.info('ScalpingStrategy initialized for 15m timeframe');
  }
  
  /**
   * 15 dakikalık zaman diliminde EMA, RSI ve MACD sinyallerine dayalı alım-satım sinyalleri üretir
   */
  async generateSignal(candles, symbol) {
    try {
      if (!candles || candles.length < 50) {
        return { signal: 'NEUTRAL' };
      }
      
      const closes = candles.map(c => parseFloat(c.close));
      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      
      // Son fiyat
      const currentPrice = closes[closes.length - 1];
      const previousPrice = closes[closes.length - 2];
      
      // EMA crossover hesapla
      const fastEMA = this.calculateEMA(closes, this.params.emaFast);
      const slowEMA = this.calculateEMA(closes, this.params.emaSlow);
      
      // Son iki değer
      const currentFastEMA = fastEMA[fastEMA.length - 1];
      const previousFastEMA = fastEMA[fastEMA.length - 2];
      const currentSlowEMA = slowEMA[slowEMA.length - 1];
      const previousSlowEMA = slowEMA[slowEMA.length - 2];
      
      // Crossover tespiti
      const isBullishCrossover = previousFastEMA <= previousSlowEMA && currentFastEMA > currentSlowEMA;
      const isBearishCrossover = previousFastEMA >= previousSlowEMA && currentFastEMA < currentSlowEMA;
      
      // RSI hesapla
      const rsi = this.calculateRSI(closes, this.params.rsiPeriod);
      const currentRSI = rsi[rsi.length - 1];
      
      // MACD hesapla
      const macdResult = this.calculateMACD(closes);
      const macdLine = macdResult.MACD;
      const signalLine = macdResult.signal;
      const histogram = macdResult.histogram;
      
      const currentMACD = macdLine[macdLine.length - 1];
      const currentSignal = signalLine[signalLine.length - 1];
      const currentHistogram = histogram[histogram.length - 1];
      const previousHistogram = histogram[histogram.length - 2];
      
      // MACD histogram yön değiştirme
      const isHistogramTurningUp = previousHistogram < 0 && currentHistogram > previousHistogram;
      const isHistogramTurningDown = previousHistogram > 0 && currentHistogram < previousHistogram;
      
      // Momentum tespiti
      const isStrongUptrend = currentFastEMA > currentSlowEMA && currentMACD > currentSignal && currentHistogram > 0;
      const isStrongDowntrend = currentFastEMA < currentSlowEMA && currentMACD < currentSignal && currentHistogram < 0;
      
      // ATR hesapla (volatilite için)
      const atr = this.calculateATR(candles, 14);
      
      // Stop loss ve take profit hesapla
      const stopLossPercent = this.params.stopLossPercent;
      const takeProfitPercent = this.params.takeProfitPercent;
      
      let stopLoss, takeProfit, signal = 'NEUTRAL';
      let unmetConditions = [];
      
      // Log
      logger.info(`ScalpingStrategy analysis for ${symbol} (15m):
        - Current Price: ${currentPrice}
        - EMA9/EMA21: ${currentFastEMA.toFixed(4)}/${currentSlowEMA.toFixed(4)}
        - RSI(14): ${currentRSI.toFixed(2)}
        - MACD: ${currentMACD.toFixed(4)} Signal: ${currentSignal.toFixed(4)} Hist: ${currentHistogram.toFixed(4)}
        - ATR: ${atr}
      `);
      
      // LONG sinyali
      if (
        isBullishCrossover || 
        (isStrongUptrend && isHistogramTurningUp) ||
        (currentRSI < 40 && isHistogramTurningUp && currentFastEMA > currentSlowEMA)
      ) {
        stopLoss = currentPrice * (1 - stopLossPercent / 100);
        takeProfit = currentPrice * (1 + takeProfitPercent / 100);
        
        if (currentRSI > this.params.rsiOverbought) {
          signal = 'WEAK_BUY';
          unmetConditions.push(`RSI overbought at ${currentRSI.toFixed(2)}`);
        } else if (isStrongDowntrend) {
          signal = 'WEAK_BUY';
          unmetConditions.push('Strong downtrend detected');
        } else {
          signal = 'BUY';
        }
      }
      // SHORT sinyali
      else if (
        isBearishCrossover || 
        (isStrongDowntrend && isHistogramTurningDown) ||
        (currentRSI > 60 && isHistogramTurningDown && currentFastEMA < currentSlowEMA)
      ) {
        stopLoss = currentPrice * (1 + stopLossPercent / 100);
        takeProfit = currentPrice * (1 - takeProfitPercent / 100);
        
        if (currentRSI < this.params.rsiOversold) {
          signal = 'WEAK_SELL';
          unmetConditions.push(`RSI oversold at ${currentRSI.toFixed(2)}`);
        } else if (isStrongUptrend) {
          signal = 'WEAK_SELL';
          unmetConditions.push('Strong uptrend detected');
        } else {
          signal = 'SELL';
        }
      }
      
      // Hesap büyüklüğüne göre allocation hesapla
      let allocation = config.static_position_size || 100;
      
      // Sonuçları döndür
      return {
        signal,
        stopLoss,
        takeProfit,
        allocation,
        unmetConditions: unmetConditions.join(', '),
        strategyUsed: 'Scalping (15m)'
      };
    } catch (error) {
      logger.error(`Error in ScalpingStrategy for ${symbol}: ${error.message}`);
      return {
        signal: 'NEUTRAL',
        error: error.message
      };
    }
  }
  
  // Gerekli indikatör hesaplama fonksiyonları
  calculateEMA(prices, period) {
    return ti.EMA.calculate({
      values: prices,
      period: period
    });
  }
  
  calculateRSI(prices, period) {
    return ti.RSI.calculate({
      values: prices,
      period: period
    });
  }
  
  calculateMACD(prices) {
    const macdInput = {
      values: prices,
      fastPeriod: this.params.macdFast,
      slowPeriod: this.params.macdSlow,
      signalPeriod: this.params.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    
    const macdResults = ti.MACD.calculate(macdInput);
    
    // MACD, Signal Line ve Histogram'ı ayrı ayrı al
    const macd = macdResults.map(r => r.MACD);
    const signal = macdResults.map(r => r.signal);
    const histogram = macdResults.map(r => r.histogram);
    
    return {
      MACD: macd,
      signal: signal,
      histogram: histogram
    };
  }
  
  calculateATR(candles, period) {
    const atrInput = {
      high: candles.map(c => parseFloat(c.high)),
      low: candles.map(c => parseFloat(c.low)),
      close: candles.map(c => parseFloat(c.close)),
      period: period
    };
    
    const atrResult = ti.ATR.calculate(atrInput);
    return atrResult[atrResult.length - 1];
  }
}

module.exports = ScalpingStrategy;