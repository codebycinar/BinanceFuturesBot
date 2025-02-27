const positionManager = require('./services/PositionManager');
const logger = require('./utils/logger');
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const config = require('./config/config');

(async () => {
  try {
    const binanceService = new BinanceService();
    await binanceService.initialize();

    const orderService = new OrderService(binanceService);
    const marketScanner = new MarketScanner(binanceService, orderService);
    await marketScanner.initialize();
    logger.info('Bot started successfully.', { timestamp: new Date().toISOString() });
    let isProcessing = false; // Çakışma önleme kilidi

    // Döngü ile işlemleri sırayla çalıştır
    while (true) {
      if (!isProcessing) {
        isProcessing = true;
        try {
          // Pozisyon yönetimini başlat
          logger.info('Starting PositionManager...');
          await positionManager();
          logger.info('PositionManager completed.');

          // Market taramasını başlat
          logger.info('Starting MarketScanner...');
          await marketScanner.scanAllSymbols();
          logger.info('MarketScanner completed.');

          // 1 dakika bekleme
          logger.info('Waiting for 1 minute before restarting the cycle...');
          await new Promise(resolve => setTimeout(resolve, 60 * 1000));
        } catch (error) {
          logger.error('Error in main loop:', error);
          // Döngü devam etsin, bir sonraki iterasyon başlasın
        }
        finally {
          isProcessing = false;
          logger.info('Waiting for next cycle...');
          await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 1 dakika bekle
        }
      } else {
        logger.warn('Previous operation still in progress. Skipping...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 sn bekleyip kontrol et
      }
    }
  } catch (error) {
    logger.error('Error starting the bot:', error);
    process.exit(1);
  }
})();
