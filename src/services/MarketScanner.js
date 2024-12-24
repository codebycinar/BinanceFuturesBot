const BinanceService = require('./BinanceService');
const OrderService = require('./OrderService');
const SupportResistanceStrategy = require('../strategies/SupportResistanceStrategy');
const { formatLevels } = require('../utils/formatters');
const config = require('../config/config');
const logger = require('../utils/logger');

class MarketScanner {
  constructor() {
    this.binanceService = new BinanceService();
    this.orderService = new OrderService(this.binanceService);
  }

  /**
   * Belirli bir sembol ve zaman dilimleri için destek/direnç seviyelerini bulur.
   * (Önceki kodunuzdaki getMultiTimeframeLevels metodunu koruyoruz.)
   */
  async getMultiTimeframeLevels(symbol, timeframes) {
    const levels = {};
  
    for (const timeframe of timeframes) {
      try {
        const candles = await this.binanceService.getCandles(symbol, timeframe, 100);
        if (!candles || candles.length === 0) {
          logger.warn(`No candles for ${symbol} at timeframe ${timeframe}`);
          continue;
        }
        const strategy = new SupportResistanceStrategy(candles);
        levels[timeframe] = strategy.findSupportResistanceLevels();
  
        if (
          (!levels[timeframe].support || levels[timeframe].support.length === 0) &&
          (!levels[timeframe].resistance || levels[timeframe].resistance.length === 0)
        ) {
          logger.warn(`No valid support/resistance levels for ${symbol} at ${timeframe}`);
        }
  
        logger.info(`Levels for ${symbol} at ${timeframe}:`, levels[timeframe]);
      } catch (error) {
        logger.error(`Error getting levels for ${symbol} at ${timeframe}:`, error);
      }
    }
  
    return levels;
  }

  /**
   * Çoklu zaman dilimlerine bakarak basit bir LONG/SHORT/NEUTRAL sinyali döndürür.
   * (Siz kendi mantığınızı ekleyebilirsiniz.)
   */
  validateSignalAcrossTimeframes(levels, currentPrice) {
    if (!levels || Object.keys(levels).length === 0) {
      logger.warn('No levels provided for validation.');
      return 'NEUTRAL';
    }

    for (const [timeframe, level] of Object.entries(levels)) {
      if (!level.support || level.support.length === 0 || !level.resistance || level.resistance.length === 0) {
        logger.warn(`Missing support/resistance levels for ${timeframe}`);
        continue;
      }

      const nearestSupport = this.findNearestLevel(currentPrice, level.support);
      const nearestResistance = this.findNearestLevel(currentPrice, level.resistance);

      if (nearestSupport && currentPrice < nearestSupport.price) {
        // Basit örnek olarak, fiyat desteğin altına inmişse LONG
        return 'LONG';
      } else if (nearestResistance && currentPrice > nearestResistance.price) {
        // Fiyat direncin üstüne çıkmışsa SHORT
        return 'SHORT';
      }
    }

    return 'NEUTRAL';
  }

  /**
   * Fiyata en yakın destek veya direnci bulmak için yardımcı fonksiyon.
   */
  findNearestLevel(price, levels) {
    return levels.reduce((nearest, level) => {
      const diff = Math.abs(level.price - price);
      return diff < Math.abs(nearest.price - price) ? level : nearest;
    }, levels[0]);
  }

  /**
   * Belirtilen sembolleri tarar, sinyal oluşursa limit veya market emir açtırır.
   */
  async scanMarkets(symbols) {
    const timeframes = config.timeframes;
    const opportunities = [];
  
    for (const symbol of symbols) {
      const currentPrice = await this.getCurrentPrice(symbol);
      const levels = await this.getMultiTimeframeLevels(symbol, timeframes);
      const signal = this.validateSignalAcrossTimeframes(levels, currentPrice);
  
      if (signal !== 'NEUTRAL') {
        // Bir limit order koyacağımız senaryo:
        // Basit örnek: nearestSupport/resistance ile limitPrice belirleyelim:
        const nearestSupport = levels[timeframes[0]].support[0]?.price || Infinity;
        const nearestResistance = levels[timeframes[0]].resistance[0]?.price || Infinity;
  
        const distance =
          signal === 'LONG'
            ? Math.abs(currentPrice - nearestSupport)
            : Math.abs(nearestResistance - currentPrice);
  
        if (distance / currentPrice <= config.limitOrderTolerance) {
          // Örnek: Limit Price SHORT sinyalde nearestResistance olsun
          const limitPrice = signal === 'LONG' ? nearestSupport : nearestResistance;
  
          try {
            // Şimdi OrderService'deki openLimitPosition'a levels veriyoruz
            await this.orderService.openLimitPosition(
              symbol,
              signal,        // 'LONG' veya 'SHORT'
              limitPrice,
              levels[timeframes[0]] // Örnek olarak 1. timeframe'in support/resistance'larını yolladık
            );
          } catch (error) {
            logger.error(`Error placing limit position for ${symbol}:`, error);
          }
        } else {
          // Market order fırsatı vs.
          // ...
        }
      }
    }
  
    return opportunities;
  }

  /**
   * Tek sembol taraması (örneğin manuel çağrılabilir).
   */
  async scanSymbol(symbol, opportunities) {
    logger.info(`\n=== Scanning ${symbol} ===`);

    const timeframes = config.timeframes;
    const levels = {};

    for (const timeframe of timeframes) {
      const candles = await this.binanceService.getCandles(symbol, timeframe);
      const strategy = new SupportResistanceStrategy(candles);
      levels[timeframe] = strategy.findSupportResistanceLevels();

      logger.info(`\nTimeframe: ${timeframe}`);
      logger.info(formatLevels(levels[timeframe]));
    }

    const currentPrice = await this.getCurrentPrice(symbol);

    logger.info(`\nCurrent price: ${currentPrice}`);

    for (const timeframe of timeframes) {
      const strategy = new SupportResistanceStrategy([]);
      const signal = strategy.checkSignal(currentPrice, levels[timeframe]);

      if (signal !== 'NEUTRAL') {
        logger.info(`Signal found: ${signal} on ${timeframe} timeframe`);

        try {
          const result = await this.orderService.openPosition(
            symbol,
            signal,
            currentPrice,
            levels[timeframe]
          );

          if (result) {
            logger.info('✨ Trading opportunity detected and position opened!');
            opportunities.push({
              symbol,
              signal,
              price: currentPrice,
              timeframe,
              levels: levels[timeframe]
            });
          } else {
            logger.info(`No position opened for ${symbol} due to an issue.`);
          }
        } catch (error) {
          logger.error(`Failed to open position for ${symbol}:`, error);
        }
      }
    }

    logger.info('=== Scan complete ===\n');
  }

  /**
   * 1m mumun son kapanış fiyatını alır.
   */
  async getCurrentPrice(symbol) {
    const candles = await this.binanceService.getCandles(symbol, '1m', 1);
    return parseFloat(candles[0].close);
  }
}

module.exports = MarketScanner;
