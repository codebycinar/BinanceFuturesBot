const { SMA, RSI, MACD, ADX } = require('technicalindicators');

class TrendFollowStrategy {
  constructor(candlesticks) {
    this.candlesticks = candlesticks;
  }

  analyze() {
    const closes = this.candlesticks.map(candle => candle.close);

    const sma20 = SMA.calculate({ period: 20, values: closes });
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });

    // Yeni göstergeler
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const adx = ADX.calculate({
      high: this.candlesticks.map(c => c.high),
      low: this.candlesticks.map(c => c.low),
      close: closes,
      period: 14
    });

    const currentPrice = closes[closes.length - 1];
    const currentSMA20 = sma20[sma20.length - 1];
    const currentSMA50 = sma50[sma50.length - 1];
    const currentRSI = rsi[rsi.length - 1];
    const currentMACD = macd[macd.length - 1];
    const currentADX = adx[adx.length - 1]?.adx;

    // Dinamik RSI sınırları
    const volatility = Math.abs(currentSMA20 - currentSMA50) / currentSMA50; // Basit volatilite ölçümü
    const upperRSI = 70 - volatility * 10;
    const lowerRSI = 30 + volatility * 10;

    if (currentPrice > currentSMA20 && currentSMA20 > currentSMA50 && currentRSI < upperRSI && currentMACD.histogram > 0 && currentADX > 25) {
      return 'LONG';
    } else if (currentPrice < currentSMA20 && currentSMA20 < currentSMA50 && currentRSI > lowerRSI && currentMACD.histogram < 0 && currentADX > 25) {
      return 'SHORT';
    }

    return 'NEUTRAL';
  }
}

module.exports = TrendFollowStrategy;
