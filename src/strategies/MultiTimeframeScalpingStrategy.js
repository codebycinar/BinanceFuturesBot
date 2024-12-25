// strategies/MultiTimeframeScalpingStrategy.js

const talib = require('talib'); 
// talib kullanmak isterseniz "npm install talib" veya benzer library gerekir.
// Aksi halde kendiniz RSI, MA hesaplayabilirsiniz.

class MultiTimeframeScalpingStrategy {
  /**
   * Constructor, gereken parametreleri vs. alabilirsiniz.
   * örneğin:
   * @param {Number} rsiPeriod - RSI periyodu (ör. 14)
   * @param {Number} shortMAPeriod - Kısa MA periyodu (ör. 9)
   * @param {Number} longMAPeriod - Uzun MA periyodu (ör. 21)
   */
  constructor(config = {}) {
    this.rsiPeriod = config.rsiPeriod || 14;
    this.shortMAPeriod = config.shortMAPeriod || 9;
    this.longMAPeriod = config.longMAPeriod || 21;
  }

  /**
   * 15m mumlarına bakarak temel trend yönünü bulur
   */
  async determineTrend(candles15m) {
    // basitçe uzun MA ve kısa MA kıyaslayabiliriz
    const closes = candles15m.map(c => parseFloat(c.close));
    if (closes.length < this.longMAPeriod) {
      return 'NEUTRAL';
    }

    // Uzun MA - Kısa MA hesapla (basit yöntem)
    const shortMA = this.simpleMovingAverage(closes.slice(-this.shortMAPeriod));
    const longMA = this.simpleMovingAverage(closes.slice(-this.longMAPeriod));

    if (shortMA > longMA) {
      return 'UPTREND';   // 15m uptrend
    } else if (shortMA < longMA) {
      return 'DOWNTREND'; // 15m downtrend
    }
    return 'NEUTRAL';
  }

  /**
   * 5m mumlarına bakarak momentum teyidi ver
   */
  async determineMomentum(candles5m) {
    // Örneğin RSI hesaplayıp 50'nin üstündeyse UP, altındaysa DOWN diyebiliriz
    // Basitçe RSI => istek: talib / teknik-hesaplama kütüphanesi
    const closes = candles5m.map(c => parseFloat(c.close));
    if (closes.length < this.rsiPeriod) {
      return 'NEUTRAL';
    }

    const lastRSIValue = await this.calculateRSI(closes, this.rsiPeriod);
    if (lastRSIValue > 55) {
      return 'UP';
    } else if (lastRSIValue < 45) {
      return 'DOWN';
    }
    return 'NEUTRAL';
  }

  /**
   * 1m mumlarına bakarak "scalp sinyali" üret
   * (örneğin RSI aşırı alım/satım veya MA crossover)
   */
  async getScalpSignal(candles1m, higherTimeframeTrend, middleTimeframeMomentum) {
    // eğer 15m uptrend ve 5m momentum up ise => sadece LONG sinyali arayalım
    // eğer 15m downtrend ve 5m momentum down ise => sadece SHORT sinyali arayalım
    // aksi halde => sinyal arama
    if (higherTimeframeTrend === 'UPTREND' && middleTimeframeMomentum === 'UP') {
      // 1m RSI < 30 => scalp LONG sinyali ver
      const closes = candles1m.map(c => parseFloat(c.close));
      const lastRSIValue = await this.calculateRSI(closes, this.rsiPeriod);
      if (lastRSIValue < 30) {
        return 'LONG';
      }
    } else if (higherTimeframeTrend === 'DOWNTREND' && middleTimeframeMomentum === 'DOWN') {
      // 1m RSI > 70 => scalp SHORT sinyali ver
      const closes = candles1m.map(c => parseFloat(c.close));
      const lastRSIValue = await this.calculateRSI(closes, this.rsiPeriod);
      if (lastRSIValue > 70) {
        return 'SHORT';
      }
    }
    return 'NEUTRAL';
  }

  /**
   * Ana metod: 1m, 5m, 15m mumlarını alır, sinyali döndürür.
   * Örnek:
   * @param {Array} candles1m - 1m mumları
   * @param {Array} candles5m - 5m mumları
   * @param {Array} candles15m - 15m mumları
   * @returns {String} 'LONG' | 'SHORT' | 'NEUTRAL'
   */
  async findScalpingSignal(candles1m, candles5m, candles15m) {
    const trend15m = await this.determineTrend(candles15m);  // UPTREND | DOWNTREND | NEUTRAL
    const momentum5m = await this.determineMomentum(candles5m); // UP | DOWN | NEUTRAL
    const scalpSignal = await this.getScalpSignal(
      candles1m,
      trend15m,
      momentum5m
    );

    return scalpSignal; // 'LONG', 'SHORT' veya 'NEUTRAL'
  }

  /**
   * Basit MA (örnek)
   */
  simpleMovingAverage(values) {
    if (!values || values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }

  /**
   * RSI hesaplayan basit bir örnek. 
   * (Kütüphaneye gerek olmaksızın koda gömülü hesaplama da yapabilirsiniz.)
   */
  async calculateRSI(closes, period) {
    if (closes.length < period) return 50; // yetersiz data => nötr

    // Mümkünse talib vs. library kullanın:
    // Örnek talib:
    // const result = talib.execute({
    //   name: 'RSI',
    //   startIdx: 0,
    //   endIdx: closes.length - 1,
    //   inReal: closes,
    //   optInTimePeriod: period
    // });
    // return result.result.outReal.slice(-1)[0]; // son RSI değeri

    // Demo: Kendi basit RSI implementasyonu (örnek, tam doğru olmayabilir)
    const slice = closes.slice(-period - 1);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i] - slice[i - 1];
      if (diff >= 0) {
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    return rsi;
  }
}

module.exports = MultiTimeframeScalpingStrategy;
