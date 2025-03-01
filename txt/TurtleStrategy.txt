const logger = require('../utils/logger');
const config = require('../config/config');

class TurtleStrategy {
  constructor(strategyName) {
    this.strategyName = strategyName;
    this.parameters = config.strategy || {
      entryPeriod: 20, // 20 günlük Donchian
      atrPeriod: 14,   // ATR periyodu
      riskPercentage: 0.01 // %1 risk
    };
  }

  async initialize() {
    if (!this.parameters.entryPeriod || !this.parameters.atrPeriod) {
      throw new Error('TurtleStrategy için config parametreleri eksik!');
    }
    logger.info(`TurtleStrategy başlatıldı: ${this.strategyName}`);
  }

  async generateSignal(candles, symbol, binanceService) {

    const entryPeriod = this.parameters.entryPeriod; // 20 gün
    const atrPeriod = this.parameters.atrPeriod;
    const timeframe = this.parameters.timeframe;

    const currentPrice = parseFloat(candles[candles.length - 1].close);

    logger.info(`Son 3 mum verisi (${symbol}):`, {
      timestamps: candles.slice(-3).map(c => new Date(c.timestamp).toISOString()),
      closes: candles.slice(-3).map(c => c.close)
    });

    // Donchian Kanalları hesapla
    const entryChannels = await binanceService.calculateDonchianChannels(
      symbol,
      entryPeriod,
      timeframe
    );


    // 1. Fiyat-kanal ilişkisini logla (INFO seviyesi)
    logger.info(`Fiyat-Kanal İlişkisi (${symbol}):`, {
      currentPrice: currentPrice.toFixed(4),
      upperBand: entryChannels.upper.toFixed(4),
      lowerBand: entryChannels.lower.toFixed(4),
      distanceToUpper: (entryChannels.upper - currentPrice).toFixed(4),
      distanceToLower: (currentPrice - entryChannels.lower).toFixed(4)
    });


    if (!entryChannels.upper || !entryChannels.lower) {
      logger.warn(`20 günlük Donchian kanalı hesaplanamadı: ${symbol}`);
      return { signal: 'NEUTRAL' };
    }

    // ATR hesapla
    const atr = await binanceService.calculateATR(symbol, atrPeriod);
    if (!atr) return { signal: 'NEUTRAL' };

    // Giriş sinyalleri
    let signal = 'NEUTRAL';

    if (currentPrice > entryChannels.upper) {
      signal = 'BUY';
    } else if (currentPrice < entryChannels.lower) {
      signal = 'SELL';
    }

    logger.info(`Turtle Signal for ${symbol}: ${signal}, Price: ${currentPrice}, EntryUpper: ${entryChannels.upper}, EntryLower: ${entryChannels.lower}, ATR: ${atr}`);

    return {
      signal,
      stopLoss: null, // Stop loss artık managePosition'da dinamik yönetilecek
      takeProfit: null, // Take profit sabit değil
      atr
    };
  }
}

module.exports = TurtleStrategy;