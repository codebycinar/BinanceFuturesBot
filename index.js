const logger = require('./src/utils/logger');
const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

// Import services
const BinanceService = require('./src/services/BinanceService');
const OrderService = require('./src/services/OrderService');
const MarketScanner = require('./src/services/MarketScanner');
const EnhancedPositionManager = require('./src/services/EnhancedPositionManager');
const MultiTimeframeService = require('./src/services/MultiTimeframeService');

// Entry point
async function init() {
  try {
    logger.info('Starting Binance Futures Bot with Enhanced Features');
    
    // Welcome message
    await bot.telegram.sendMessage(chatId, `
🚀 Binance Futures Bot Starting
- Version: 2.0.0
- Features: Multi-Timeframe Analysis, Adaptive Strategy, Enhanced Position Management
- Date: ${new Date().toISOString()}
    `);
    
    // Initialize services
    const binanceService = new BinanceService();
    await binanceService.initialize();
    
    const orderService = new OrderService(binanceService);
    
    const mtfService = new MultiTimeframeService(binanceService);
    await mtfService.initialize();
    
    // Start position manager
    await EnhancedPositionManager.initialize();
    
    // Start market scanner
    const marketScanner = new MarketScanner(binanceService, orderService, mtfService);
    await marketScanner.initialize();
    
    // Start initial scan
    await marketScanner.scanAllSymbols();
    
    // Main loop
    while (true) {
      try {
        // Run position management
        logger.info('Running enhanced position management...');
        await EnhancedPositionManager.run();
        
        // Run market scanning
        logger.info('Running market scanning...');
        await marketScanner.scanAllSymbols();
        
        // Wait for next cycle
        logger.info('Waiting for 1 minute before next cycle...');
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
      } catch (error) {
        logger.error('Error in main loop:', error);
        bot.telegram.sendMessage(chatId, `❌ Error in main loop: ${error.message}`);
        // Wait a bit before continuing after error
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
      }
    }
  } catch (error) {
    logger.error('Failed to start bot:', error);
    if (bot && chatId) {
      bot.telegram.sendMessage(chatId, `❌ Failed to start bot: ${error.message}`);
    }
  }
}

// Handle errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  bot.telegram.sendMessage(chatId, `❌ Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  bot.telegram.sendMessage(chatId, `❌ Unhandled Promise Rejection: ${reason}`);
});

// Start the bot
init();