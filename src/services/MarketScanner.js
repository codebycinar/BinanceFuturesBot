// services/MarketScanner.js

const UTBotStrategy = require('../strategies/UTBotStrategy');
const config = require('../config/config');
const logger = require('../utils/logger');

class MarketScanner {
    constructor(binanceService, orderService) {
        this.binanceService = binanceService;
        this.orderService = orderService;
        this.strategy = new UTBotStrategy(config.strategy);
    }

    /**
   * Borsada TRADING durumunda olan tüm sembolleri döndürür.
   */
    async scanAllSymbols() {
        try {
            const usdtSymbols = await this.binanceService.scanAllSymbols();
            for (const symbol of usdtSymbols) {
                await this.scanSymbol(symbol);
            }
        } catch (error) {
            logger.error('Error fetching all symbols:', error);
            throw error;
        }
    }

    /**
     * Config'den tanımlanan sembolleri tarar.
     */
    async scanConfigSymbols() {
        try {
            const symbols = config.topSymbols;
            if (!symbols || symbols.length === 0) {
                logger.warn('No symbols defined in config.topSymbols');
                return;
            }

            logger.info(`Scanning config-defined symbols: ${symbols.join(', ')}`, { timestamp: new Date().toISOString() });

            for (const symbol of symbols) {
                await this.scanSymbol(symbol);
            }
        } catch (error) {
            logger.error('Error scanning config-defined symbols:', error);
        }
    }

    /**
     * Belirli bir sembolü tarar ve pozisyon açma işlemlerini gerçekleştirir.
     */
    async scanSymbol(symbol) {
        try {
            logger.info(`\n=== Scanning ${symbol} ===`, { timestamp: new Date().toISOString() });

            // 1m mumlarını al
            const candles1m = await this.binanceService.getCandles(symbol, '1m', 100); // Yeterli sayıda mum alın

            if (candles1m.length === 0) {
                logger.warn(`No candles fetched for ${symbol}. Skipping.`);
                return;
            }

            const scalpSignal = await this.strategy.generateSignal(candles1m);

            logger.info(`Scalp Signal for ${symbol}: ${scalpSignal}`, { timestamp: new Date().toISOString() });

            if (scalpSignal !== 'NEUTRAL') {
                // Mevcut pozisyonu kontrol et
                const openPositions = await this.binanceService.getOpenPositions();
                const isPositionOpen = openPositions.some(pos => pos.symbol === symbol &&
                    ((scalpSignal === 'LONG' && pos.positionSide === 'LONG') ||
                        (scalpSignal === 'SHORT' && pos.positionSide === 'SHORT'))
                );

                if (isPositionOpen) {
                    logger.info(`Skipping ${symbol} (${scalpSignal}). Already have an open position in the same direction.`, { timestamp: new Date().toISOString() });
                    return; // Yeni pozisyon açmıyoruz
                }

                // Pozisyon açma işlemi
                const currentPrice = await this.binanceService.getCurrentPrice(symbol);
                const result = await this.orderService.openPositionWithMultipleTPAndTrailing(
                    symbol,
                    scalpSignal,
                    currentPrice,
                    {}, // Gerekirse seviyeler ekleyin
                    config.trailingStop.use,
                    config.trailingStop.callbackRate
                );

                if (result) {
                    logger.info(`✨ Position opened for ${symbol} with multi TP + trailing`, { timestamp: new Date().toISOString() });
                }
            }

            logger.info('=== Scan complete ===\n', { timestamp: new Date().toISOString() });
        } catch (error) {
            logger.error(`Error scanning symbol ${symbol}:`, error);
        }
    }
}

module.exports = MarketScanner;
