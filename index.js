const logger = require('./src/utils/logger');
const dotenv = require('dotenv');
const config = require('./src/config/config');
const telegramService = require('./src/services/TelegramService');

// Load environment variables
dotenv.config();

// Import services
const BinanceService = require('./src/services/BinanceService');
const OrderService = require('./src/services/OrderService');
const MarketScanner = require('./src/services/MarketScanner');
const EnhancedPositionManager = require('./src/services/EnhancedPositionManager');
const MultiTimeframeService = require('./src/services/MultiTimeframeService');
const RLPositionManager = require('./src/services/RLPositionManager');
const RLModelService = require('./src/services/RLModelService');
const db = require('./src/db/db');
const { Position } = db.models;

// Global RL Bot instance
let rlBot = null;

// Entry point
async function init() {
  try {
    logger.info('Starting Binance Futures Bot with Enhanced Features');
    
    // Initialize Telegram Service
    await telegramService.initialize();
    
    // Add RL bot commands to Telegram
    telegramService.addCommand('rl_start', async (ctx) => {
      if (!rlBot) {
        ctx.reply('🚀 Starting RL Trading Bot...');
        rlBot = new RLPositionManager();
        await rlBot.start();
        ctx.reply('✅ RL Trading Bot started');
      } else {
        ctx.reply('RL Trading Bot is already running');
      }
    });
    
    telegramService.addCommand('rl_stop', (ctx) => {
      if (rlBot) {
        ctx.reply('🛑 Stopping RL Trading Bot...');
        rlBot.stop();
        rlBot = null;
        ctx.reply('✅ RL Trading Bot stopped');
      } else {
        ctx.reply('RL Trading Bot is not running');
      }
    });
    
    telegramService.addCommand('rl_status', async (ctx) => {
      const status = rlBot ? 'Running' : 'Stopped';
      
      let activePositions = 0;
      try {
        activePositions = await Position.count({ 
          where: { 
            isActive: true,
            strategyUsed: 'RL Support-Resistance Strategy'
          } 
        });
      } catch (error) {
        logger.error('Error counting active positions:', error);
      }
      
      ctx.reply(`
RL Trading Bot Status: ${status}
Active RL Positions: ${activePositions}
      `);
    });
    
    telegramService.addCommand('rl_train', async (ctx) => {
      const args = ctx.message.text.split(' ');
      
      // Eğer parametre yoksa veya "all" parametresi varsa, tüm sembolleri eğit
      if (args.length === 1 || (args.length === 2 && args[1].toLowerCase() === 'all')) {
        const days = 30; // Varsayılan 30 gün
        ctx.reply(`🧠 Starting training for ALL symbols with ${days} days of historical data...`);
        
        try {
          if (!rlBot) {
            rlBot = new RLPositionManager();
            await rlBot.binanceService.initialize();
          }
          
          rlBot.trainAllSymbols(days);
        } catch (error) {
          logger.error('Error starting training:', error);
          ctx.reply(`❌ Error starting training: ${error.message}`);
        }
        return;
      }
      
      // Belirli bir sembol için eğitim
      if (args.length !== 3) {
        ctx.reply('⚠️ Usage: /rl_train SYMBOL DAYS (example: /rl_train BTCUSDT 30) or /rl_train all');
        return;
      }
      
      const symbol = args[1].toUpperCase();
      const days = parseInt(args[2]);
      
      if (isNaN(days) || days <= 0 || days > 365) {
        ctx.reply('❌ Invalid days parameter. Use a number between 1 and 365.');
        return;
      }
      
      ctx.reply(`🧠 Starting training for ${symbol} with ${days} days of historical data...`);
      
      try {
        if (!rlBot) {
          rlBot = new RLPositionManager();
          await rlBot.binanceService.initialize();
        }
        
        rlBot.trainOnHistoricalData(symbol, days);
      } catch (error) {
        logger.error('Error starting training:', error);
        ctx.reply(`❌ Error starting training: ${error.message}`);
      }
    });
    
    // Help command
    telegramService.addCommand('help', (ctx) => {
      ctx.reply(`
Binance Futures Bot Commands:
/rl_start - Start the RL trading bot (will scan markets and make trades)
/rl_stop - Stop the RL trading bot
/rl_status - Check RL bot status and active positions
/rl_train all - Train all symbols using 30 days of data
/rl_train SYMBOL DAYS - Train a specific symbol (example: /rl_train BTCUSDT 30)
/help - Show this help message
      `);
    });
    
    logger.info('Telegram service initialized successfully');
    
    // Welcome message
    await telegramService.sendMessage(`
🚀 Binance Futures Bot Starting
- Version: 3.0.0
- Features: Multi-Timeframe Analysis, Adaptive Strategy, Enhanced Position Management, Reinforcement Learning
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
    
    // Initialize RL Model Service
    const rlModelService = new RLModelService();
    
    // Auto-start RL Bot if configured
    if (config.autoStartRLBot) {
      try {
        logger.info('Auto-starting RL Bot...');
        rlBot = new RLPositionManager();
        await rlBot.start();
        logger.info('RL Bot auto-started successfully');
        bot.telegram.sendMessage(chatId, '✅ RL Bot auto-started successfully');
      } catch (error) {
        logger.error('Error auto-starting RL Bot:', error);
        bot.telegram.sendMessage(chatId, `❌ Error auto-starting RL Bot: ${error.message}`);
      }
    }
    
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

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down bot...');
  
  if (rlBot) {
    logger.info('Stopping RL Bot...');
    rlBot.stop();
    rlBot = null;
  }
  
  telegramService.sendMessage('🛑 Bot is shutting down...')
    .then(() => {
      logger.info('Shutdown complete');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Error sending shutdown message:', error);
      process.exit(1);
    });
});

// Start the bot
init();