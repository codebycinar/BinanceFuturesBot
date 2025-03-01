const positionManager = require('./services/PositionManager');
const logger = require('./utils/logger');
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const MultiTimeframeService = require('./services/MultiTimeframeService');
const config = require('./config/config');
const { Telegraf } = require('telegraf');
const dotenv = require("dotenv");

(async () => {
  try {
    // Load environment variables
    dotenv.config();
    
    // Initialize Telegram bot
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    bot.start((ctx) => ctx.reply('Binance Futures Bot Online!'));
    bot.launch();
    
    // Initialize services
    const binanceService = new BinanceService();
    await binanceService.initialize();

    const orderService = new OrderService(binanceService);
    
    // Initialize MultiTimeframeService
    const mtfService = new MultiTimeframeService(binanceService);
    await mtfService.initialize();
    
    // Create MarketScanner with all required services
    const marketScanner = new MarketScanner(binanceService, orderService, mtfService);
    await marketScanner.strategy.initialize();
    await marketScanner.initialize();
    
    logger.info('Bot started successfully with Multi-Timeframe Analysis.', { timestamp: new Date().toISOString() });

    // Döngü ile işlemleri sırayla çalıştır
    while (true) {
      try {
        // Pozisyon yönetimini başlat
        logger.info('Starting PositionManager...');
        await positionManager();
        logger.info('PositionManager completed.');

        // Market taramasını başlat
        logger.info('Starting MarketScanner...');
        await marketScanner.scanAllSymbols();
        logger.info('MarketScanner completed.');

        // Weak signals flushing
        await marketScanner.flushWeakSignalBuffer();

        // 1 dakika bekleme
        logger.info('Waiting for 1 minute before restarting the cycle...');
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
      } catch (error) {
        logger.error('Error in main loop:', error);
        // Döngü devam etsin, bir sonraki iterasyon başlasın
      }
    }
  } catch (error) {
    logger.error('Error starting the bot:', error);
  }
})();
