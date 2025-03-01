const logger = require('../utils/logger');
const config = require('../config/config');

class TurtleStrategy {
  constructor(strategyName) {
    this.strategyName = strategyName;
    this.closesPercentageThresholdForPosition = config.strategy.closesPercentageThresholdForPosition || 98;
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

    // Validate candles
    if (!candles || candles.length < entryPeriod + 1) {
      logger.warn(`Not enough candles for ${symbol}: ${candles.length}/${entryPeriod + 1}`);
      return { signal: 'NEUTRAL' };
    }

    const timeframe = this.parameters.timeframe;
    const currentCandle = candles[candles.length - 1];
    const currentHigh = parseFloat(currentCandle.high);
    const currentLow = parseFloat(currentCandle.low);
    const currentPrice = parseFloat(currentCandle.close);

    // Donchian Kanalları hesapla
    const entryChannels = await binanceService.calculateDonchianChannels(
      symbol,
      entryPeriod,
      timeframe
    );

    const channelWidth = entryChannels.upper - entryChannels.lower;
    const distanceToUpper = entryChannels.upper - currentPrice;
    const distanceToLower = currentPrice - entryChannels.lower;
    const minDistance = Math.min(distanceToUpper, distanceToLower);
    const proximityPercentage = ((1 - (minDistance / channelWidth)) * 100).toFixed(2);

    // 1. Fiyat-kanal ilişkisini ve yakınlık yüzdesini logla (INFO seviyesi)
    logger.info(`Fiyat-Kanal İlişkisi (${symbol}):`, {
      currentPrice: currentPrice.toFixed(4),
      upperBand: entryChannels.upper.toFixed(4),
      lowerBand: entryChannels.lower.toFixed(4),
      distanceToUpper: distanceToUpper.toFixed(4),
      distanceToLower: distanceToLower.toFixed(4),
      proximityPercentage: proximityPercentage // Yakınlık yüzdesi eklendi
    });



    if (!entryChannels.upper || !entryChannels.lower) {
      logger.warn(`20 günlük Donchian kanalı hesaplanamadı: ${symbol}`);
      return { signal: 'NEUTRAL' };
    }

    // ATR hesapla
    const atr = await binanceService.calculateATR(symbol, atrPeriod);

    if (!atr) {
      logger.warn(`atr hesaplanamadı: ${symbol}`);
      return { signal: 'NEUTRAL' };
    }

    // Giriş sinyalleri
    let signal = 'NEUTRAL';

    if (currentHigh > entryChannels.upper) {
      signal = 'BUY';
      logger.info(`Mum yüksek değeri (${currentHigh}) kanalın üstünü (${entryChannels.upper}) geçti - BUY sinyali`);
    } else if (currentLow < entryChannels.lower) {
      signal = 'SELL';
      logger.info(`Mum düşük değeri (${currentLow}) kanalın altını (${entryChannels.lower}) geçti - SELL sinyali`);
    }

    // Yakınlık yüzdesine göre sinyal üret
    if (proximityPercentage >= 98) {
      const direction = distanceToUpper < distanceToLower ? "UPPER" : "LOWER";
      signal = direction === "UPPER" ? "BUY" : "SELL";
      logger.info(`High proximity detected for ${symbol}: ${proximityPercentage}%. Generating ${signal} signal.`);
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