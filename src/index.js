// index.js
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const config = require('./config/config');
const logger = require('./utils/logger');

(async () => {
  try {
    const binanceService = new BinanceService();
    await binanceService.initialize(); // Initialize fonksiyonunu çağırın

    const orderService = new OrderService(binanceService);
    const marketScanner = new MarketScanner(binanceService, orderService);
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


  } catch (error) {
    logger.error('Error starting the bot:', error);
  }
})();
