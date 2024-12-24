const BinanceService = require('./BinanceService');
const OrderService = require('./OrderService');
const SupportResistanceStrategy = require('../strategies/SupportResistanceStrategy');
const { formatPrice, formatLevels } = require('../utils/formatters');
const config = require('../config/config');
const logger = require('../utils/logger');

class MarketScanner {
  constructor() {
    this.binanceService = new BinanceService();
    this.orderService = new OrderService(this.binanceService);
  }

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
        logger.info(`Levels for ${symbol} at ${timeframe}:`, levels[timeframe]);
      } catch (error) {
        logger.error(`Error getting levels for ${symbol} at ${timeframe}:`, error);
      }
    }
  
    return levels;
  }

  validateSignalAcrossTimeframes(levels, currentPrice, trendSignal) {
    if (!levels || Object.keys(levels).length === 0) {
      logger.warn('No levels provided for validation.');
      return 'NEUTRAL';
    }
  
    for (const [timeframe, level] of Object.entries(levels)) {
      if (!level.support || !level.resistance) {
        logger.warn(`Missing support/resistance levels for ${timeframe}`);
        continue;
      }
  
      const nearestSupport = this.findNearestLevel(currentPrice, level.support);
      const nearestResistance = this.findNearestLevel(currentPrice, level.resistance);
  
      if (currentPrice < nearestSupport.price && trendSignal === 'LONG') {
        return 'LONG';
      } else if (currentPrice > nearestResistance.price && trendSignal === 'SHORT') {
        return 'SHORT';
      }
    }
  
    return 'NEUTRAL';
  }
  
  
  
  findNearestLevel(price, levels) {
    return levels.reduce((nearest, level) => {
      const diff = Math.abs(level.price - price);
      return diff < Math.abs(nearest.price - price) ? level : nearest;
    }, levels[0]);
  }
  
  async scanMarkets(symbols) {
    try {
      const opportunities = [];
      const timeframes = ['4h', '1d']; // Daha hızlı tarama için 4h ve 1d kullanıyoruz.
  
      // Daha likit ve volatil sembolleri seç
      const filteredSymbols = symbols.filter(symbol => {
        // Örnek: Sadece USDT paritelerini seç ve BTC dışındaki pariteleri dahil et
        return symbol.endsWith('USDT') && !symbol.startsWith('BTC');
      });
  
      for (const symbol of filteredSymbols) {
        const currentPrice = await this.getCurrentPrice(symbol);
        const levels = await this.getMultiTimeframeLevels(symbol, timeframes);
  
        const signal = this.validateSignalAcrossTimeframes(levels, currentPrice);
  
        if (signal !== 'NEUTRAL') {
          // Destek/direnç mesafesine göre öncelik derecesi hesapla
          const nearestSupport = levels[timeframes[0]].support[0]?.price || Infinity;
          const nearestResistance = levels[timeframes[0]].resistance[0]?.price || Infinity;
          const distance = signal === 'LONG'
            ? Math.abs(currentPrice - nearestSupport) // LONG için destek mesafesi
            : Math.abs(nearestResistance - currentPrice); // SHORT için direnç mesafesi
  
          opportunities.push({ symbol, signal, distance, levels });
        }
      }
  
      // Fırsatları mesafeye göre sıralayın (en yakın seviyeler önce)
      opportunities.sort((a, b) => a.distance - b.distance);
  
      return opportunities;
    } catch (error) {
      logger.error('Error scanning markets:', error);
      throw error;
    }
  }  
  
  
  
  checkSignal(symbol, levels) {
    const currentPrice = this.getCurrentPrice(symbol); // Fiyatı alın
    const strategy = new SupportResistanceStrategy([], 20); // Boş mumlar çünkü sadece sinyal kontrolü
    return strategy.checkSignal(currentPrice, levels);
  }
  
  async getCurrentPrice(symbol) {
    const candles = await this.binanceService.getCandles(symbol, '1m', 1); // Son 1 mum
    return parseFloat(candles[0].close);
  }

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
  
    const currentPrice = parseFloat(
      (await this.binanceService.getCandles(symbol, '1m', 1))[0].close
    );
  
    logger.info(`\nCurrent price: ${currentPrice}`);
  
    for (const timeframe of timeframes) {
      const strategy = new SupportResistanceStrategy([]);
      const signal = strategy.checkSignal(currentPrice, levels[timeframe]);
  
      if (signal !== 'NEUTRAL') {
        logger.info(`Signal found: ${signal} on ${timeframe} timeframe`);
  
        try {
          // Pozisyon açmayı deneyin
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
}

module.exports = MarketScanner;