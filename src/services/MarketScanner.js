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
    for (const symbol of symbols) {
      const currentPrice = await this.getCurrentPrice(symbol);
      const levels = await this.getMultiTimeframeLevels(symbol, timeframes);
      const signal = this.validateSignalAcrossTimeframes(levels, currentPrice);

      if (signal !== 'NEUTRAL') {
        await this.orderService.openPositionWithMultipleTPAndTrailing(
          symbol,
          signal,
          currentPrice,
          levels,
          true,    // trailingStop
          0.5      // %0.5
        );
      }
    }

    return opportunities;
  }

  async scanTop5Markets() {
    try {
      // 1) En hacimli 5 pariteyi al
      const top5Symbols = await this.getTop5SymbolsByVolume(this.binanceService);

      // 2) Sadece o sembolleri tarayın
      for (const symbol of top5Symbols) {
        await this.scanSymbol(symbol);
      }
    } catch (error) {
      logger.error('Error scanning top 5 symbols:', error);
    }
  }


  async scanTop5VolatileMarkets() {
    try {
      // 1) Son 4 saatlik en volatil 5 sembolü al
      const top5Symbols = await this.binanceService.getTop5SymbolsByVolatility();

      logger.info(`Top 5 volatile symbols (4h): ${top5Symbols.join(', ')}`);

      // 2) Bu sembollerde tarama yap
      for (const symbol of top5Symbols) {
        await this.scanSymbol(symbol, []);
        // Yukarıdaki "scanSymbol" metodunuz 'opportunities' parametresi ister, 
        // basitçe boş dizi verebilir veya bunu da revize edebilirsiniz.
      }
    } catch (error) {
      logger.error('Error scanning top 5 volatile symbols:', error);
    }
  }

  async scanConfigSymbols() {
    try {
      // 1) config içindeki topSymbols
      const symbols = config.topSymbols;
      if (!symbols || symbols.length === 0) {
        logger.warn('No symbols defined in config.topSymbols');
        return;
      }

      logger.info(`Scanning config-defined symbols: ${symbols.join(', ')}`);

      // 2) Her sembolü tek tek tarayalım
      for (const symbol of symbols) {
        await this.scanSymbol(symbol);
      }
    } catch (error) {
      logger.error('Error scanning config-defined symbols:', error);
    }
  }

  async getTopSymbolsByDailyChange() {
    try {
      const stats = await this.binanceService.getFuturesDailyStats();
      // Filtre USDT biten pariteler
      const usdtStats = stats.filter(s => s.symbol.endsWith('USDT'));

      // En çok YÜKSELEN => sort by priceChangePercent desc
      // parseFloat(...) yapmayı unutmayın
      usdtStats.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

      // İlk 5
      const topGainers = usdtStats.slice(0, 5).map(item => item.symbol);
      return topGainers;
    } catch (err) {
      logger.error('Error fetching top daily change symbols:', err);
      return [];
    }
  }


  /**
   * Tek sembol taraması (örneğin manuel çağrılabilir).
   */
  async scanSymbol(symbol) {
    try {
      logger.info(`\n=== Scanning ${symbol} ===`);

      const timeframes = config.timeframes; // Örneğin ['1m', '5m', '15m']
      const levels = {};

      for (const timeframe of timeframes) {
        const candles = await this.binanceService.getCandles(symbol, timeframe);
        const strategy = new SupportResistanceStrategy(candles);
        levels[timeframe] = strategy.findSupportResistanceLevels();
        logger.info(`Timeframe: ${timeframe}`, formatLevels(levels[timeframe]));
      }

      const currentPrice = await this.binanceService.getCurrentPrice(symbol);
      logger.info(`Current price: ${currentPrice}`);

      for (const timeframe of timeframes) {
        const strategy = new SupportResistanceStrategy([]);
        const signal = strategy.checkSignal(currentPrice, levels[timeframe]);

        if (signal !== 'NEUTRAL') {
          logger.info(`Signal found: ${signal} on ${timeframe} timeframe`);

          // 1) Mevcut pozisyonları al
          const openPositions = await this.binanceService.getOpenPositions();
          const sideIsLong = (signal === 'LONG'); 
          
          // Hedge moddaysanız "LONG" = positionSide:'LONG'
          // One-Way moddaysanız parseFloat(positionAmt) > 0 => LONG, <0 => SHORT
          let alreadyOpen = false;

          for (const pos of openPositions) {
            if (pos.symbol === symbol) {
              // Hedge moddaysanız “pos.positionSide === 'LONG' or 'SHORT'” check
              // One-Way moddaysanız parseFloat(pos.positionAmt) > 0 => LONG
              if (this.binanceService.positionSideMode === 'Hedge') {
                if (sideIsLong && pos.positionSide === 'LONG') {
                  alreadyOpen = true;
                  break;
                } else if (!sideIsLong && pos.positionSide === 'SHORT') {
                  alreadyOpen = true;
                  break;
                }
              } else {
                // One-Way mod => positionAmt
                const posAmt = parseFloat(pos.positionAmt);
                if (sideIsLong && posAmt > 0) {
                  alreadyOpen = true;
                  break;
                } else if (!sideIsLong && posAmt < 0) {
                  alreadyOpen = true;
                  break;
                }
              }
            }
          }

          if (alreadyOpen) {
            logger.info(`Skipping ${symbol} (${signal}). Already have an open position in same direction.`);
            continue; // yeni pozisyon açmıyoruz
          }

          // 2) Artık pozisyon yoksa, openPositionWithMultipleTPAndTrailing çağır
          try {
            const result = await this.orderService.openPositionWithMultipleTPAndTrailing(
              symbol,
              signal,
              currentPrice,
              levels[timeframe],
              config.trailingStop.use,  // Config'den al
              config.trailingStop.callbackRate // Config'den al
            );

            if (result) {
              logger.info(`✨ Position opened for ${symbol} with multi TP + trailing`);
            }
          } catch (error) {
            logger.error(`Failed to open position for ${symbol}:`, error);
          }
        }
      }

      logger.info('=== Scan complete ===\n');
    } catch (error) {
      logger.error(`Error scanning symbol ${symbol}:`, error);
    }
  }
}

module.exports = MarketScanner;