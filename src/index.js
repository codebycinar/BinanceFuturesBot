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
    await marketScanner.strategy.initialize();
    logger.info('Bot started successfully.', { timestamp: new Date().toISOString() });

    // İlk taramayı hemen yapın
    await marketScanner.scanAllSymbols();

    // Daha sonra periyodik taramaları başlatın
    setInterval(async () => {
      try {
        await marketScanner.scanAllSymbols();
      } catch (error) {
        logger.error('Error during periodic scan:', error);
      }
    }, config.marketScanInterval);

    // Pozisyon yönetimi
    setInterval(async () => {
      try {
        await positionManager();
      } catch (error) {
        logger.error('Error in position manager interval:', error);
      }
    }, 60 * 1000); // 1 dakikada bir çalıştır

  } catch (error) {
    logger.error('Error starting the bot:', error);
  }
})();
