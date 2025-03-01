const ti = require('technicalindicators');

class ThreeCommasBotStrategy {
  constructor(config = {}) {
    this.atrPeriod = config.strategy.atrPeriod || 14; // ATR göstergesinin periyodu
    this.ma1Length = config.strategy.ma1Length || 21; // İlk EMA uzunluğu
    this.ma2Length = config.strategy.ma2Length || 50; // İkinci EMA uzunluğu
    this.riskReward = config.strategy.riskReward || 1; // Risk/Kar oranı
    this.atrMultiplier = config.strategy.atrMultiplier || 1.5; // ATR çarpanı
  }

  async initialize() {
    console.log(`ThreeCommasBotStrategy Loaded `);
}

  /**
   * Gösterge hesaplama fonksiyonu
   */
  calculateIndicators(candles) {

    const closes = candles.map(c => parseFloat(c.close));
    const highs = candles.map(c => parseFloat(c.high));
    const lows = candles.map(c => parseFloat(c.low));

    if (closes.length === 0 || highs.length === 0 || lows.length === 0) {
      console.error('Candles data is insufficient.');
      return { ma1: [], ma2: [], atr: [], closes: [] };
    }

    const ma1 = ti.EMA.calculate({ period: this.ma1Length, values: closes });
    const ma2 = ti.EMA.calculate({ period: this.ma2Length, values: closes });
    const atr = ti.ATR.calculate({ period: this.atrPeriod, high: highs, low: lows, close: closes });

    if (!atr || atr.length === 0) {
      console.error('ATR calculation failed or returned empty array.');
      return { ma1, ma2, atr: [], closes };
    }

    const lastATR = atr[atr.length - 1];
    if (isNaN(lastATR)) {
      console.error(`Invalid ATR value: ${lastATR}`);
      return { ma1, ma2, atr: [], closes };
    }
    return { ma1, ma2, atr, closes };
  }

  /**
   * Al/Sat sinyali oluşturma fonksiyonu
   */
  generateSignal(candles) {
    try {
      const { ma1, ma2, atr, closes } = this.calculateIndicators(candles);

      if (ma1.length === 0 || ma2.length === 0 || atr.length === 0) {
        console.warn('Insufficient data for indicators.');
        return { signal: 'NEUTRAL' };
      }

      const lastClose = closes[closes.length - 1];
      const lastMA1 = ma1[ma1.length - 1];
      const lastMA2 = ma2[ma2.length - 1];
      const lastATR = atr[atr.length - 1];

      if (isNaN(lastClose) || isNaN(lastATR)) {
        console.error(`Invalid data for signal calculation: lastClose=${lastClose}, lastATR=${lastATR}`);
        return { signal: 'NEUTRAL' };
      }

      if (!this.atrMultiplier || isNaN(this.atrMultiplier)) {
        console.error(`Invalid atrMultiplier: ${this.atrMultiplier}`);
        return { signal: 'NEUTRAL' };
      }

      const validLongEntry = lastMA1 > lastMA2;
      const validShortEntry = lastMA1 < lastMA2;

      const stopLoss = validLongEntry
        ? lastClose - lastATR * this.atrMultiplier
        : lastClose + lastATR * this.atrMultiplier;

      const takeProfit = validLongEntry
        ? lastClose + (lastClose - stopLoss) * this.riskReward
        : lastClose - (stopLoss - lastClose) * this.riskReward;

      if (isNaN(stopLoss) || isNaN(takeProfit)) {
        console.error(`Stop Loss or Take Profit calculation failed. stopLoss=${stopLoss}, takeProfit=${takeProfit}`);
        return { signal: 'NEUTRAL' };
      }


      if (isNaN(takeProfit)) {
        console.error(`
          Invalid Take-Profit Calculation:
          validLongEntry=${validLongEntry}
          lastClose=${lastClose}
          stopLoss=${stopLoss}
          riskReward=${this.riskReward}
        `);
        return { signal: 'NEUTRAL', stopLoss, takeProfit: null };
      }

      if (validLongEntry) {
        console.log(`Signal: BUY, Stop Loss: ${stopLoss}, Take Profit: ${takeProfit}`);
        return { signal: 'BUY', stopLoss, takeProfit };
      } else if (validShortEntry) {
        console.log(`Signal: SELL, Stop Loss: ${stopLoss}, Take Profit: ${takeProfit}`);
        return { signal: 'SELL', stopLoss, takeProfit };
      } else {
        console.log('Signal: NEUTRAL');
        return { signal: 'NEUTRAL' };
      }
    } catch (error) {
      console.error('Error in generateSignal:', error);
      return { signal: 'NEUTRAL' };
    }
  }

}

module.exports = ThreeCommasBotStrategy;
