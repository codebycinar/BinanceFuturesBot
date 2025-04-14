const positionManager = require('./services/PositionManager');
const logger = require('./utils/logger');
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const MultiTimeframeService = require('./services/MultiTimeframeService');
const PerformanceTracker = require('./services/PerformanceTracker');
const RLPositionManager = require('./services/RLPositionManager');
const RLModelService = require('./services/RLModelService');
const RLSupportResistanceStrategy = require('./strategies/RLSupportResistanceStrategy');
const config = require('./config/config');
const { Telegraf } = require('telegraf');
const dotenv = require("dotenv");
const express = require('express');
const path = require('path');
const { Position } = require('./db/db').models;

// Track services
let rlBot = null;

(async () => {
  try {
    // Load environment variables
    dotenv.config();
    
    // Initialize Telegram bot (simple notification only)
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    bot.start((ctx) => ctx.reply('Binance Futures Bot Online!'));
    
    // Add RL bot commands to Telegram
    bot.command('rl_start', async (ctx) => {
      if (!rlBot) {
        ctx.reply('🚀 Starting RL Trading Bot...');
        rlBot = new RLPositionManager();
        await rlBot.start();
        ctx.reply('✅ RL Trading Bot started');
      } else {
        ctx.reply('RL Trading Bot is already running');
      }
    });
    
    bot.command('rl_stop', (ctx) => {
      if (rlBot) {
        ctx.reply('🛑 Stopping RL Trading Bot...');
        rlBot.stop();
        rlBot = null;
        ctx.reply('✅ RL Trading Bot stopped');
      } else {
        ctx.reply('RL Trading Bot is not running');
      }
    });
    
    bot.command('rl_status', async (ctx) => {
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
    
    bot.command('rl_train', async (ctx) => {
      const args = ctx.message.text.split(' ');
      
      if (args.length !== 3) {
        ctx.reply('⚠️ Usage: /rl_train SYMBOL DAYS (example: /rl_train BTCUSDT 30)');
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
    
    bot.launch().then(() => {
      logger.info('Telegram bot started successfully');
      bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, 'Binance Futures Bot started! 🚀')
        .catch(err => logger.error('Error sending Telegram start message:', err));
    }).catch(err => {
      logger.error('Error starting Telegram bot:', err);
    });
    
    // Initialize services
    const binanceService = new BinanceService();
    await binanceService.initialize();

    const orderService = new OrderService(binanceService);
    
    // Initialize MultiTimeframeService
    const mtfService = new MultiTimeframeService(binanceService);
    await mtfService.initialize();
    
    // Initialize PerformanceTracker
    const performanceTracker = new PerformanceTracker();
    await performanceTracker.initialize();
    
    // Create MarketScanner with all required services
    const marketScanner = new MarketScanner(binanceService, orderService, mtfService, performanceTracker);
    await marketScanner.strategy.initialize();
    await marketScanner.initialize();
    
    // Initialize RL Model Service
    const rlModelService = new RLModelService();
    
    // Initialize web server
    const app = express();
    const PORT = process.env.PORT || 3000;
    
    // Serve static files from public directory
    app.use(express.static(path.join(__dirname, 'public')));
    
    // API endpoints for web interface
    app.get('/api/positions', async (req, res) => {
      try {
        const positions = await marketScanner.orderService.getAllPositions();
        res.json(positions);
      } catch (error) {
        logger.error(`Error getting positions: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    app.get('/api/performance', async (req, res) => {
      try {
        const performance = await performanceTracker.getAllPerformance();
        res.json(performance);
      } catch (error) {
        logger.error(`Error getting performance data: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    app.get('/api/performance/strategy/:strategyName', async (req, res) => {
      try {
        const { strategyName } = req.params;
        const performance = await performanceTracker.getStrategyPerformance(strategyName);
        res.json(performance);
      } catch (error) {
        logger.error(`Error getting strategy performance: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    app.get('/api/performance/symbol/:symbol', async (req, res) => {
      try {
        const { symbol } = req.params;
        const performance = await performanceTracker.getSymbolPerformance(symbol);
        res.json(performance);
      } catch (error) {
        logger.error(`Error getting symbol performance: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Manuel pozisyonları işaretlemek için API 
    app.post('/api/positions/set-managed', async (req, res) => {
      try {
        const { symbol, isManaged } = req.body;
        
        if (!symbol) {
          return res.status(400).json({ error: 'Symbol is required' });
        }
        
        // Pozisyonu bul
        const position = await Position.findOne({ 
          where: { symbol, isActive: true } 
        });
        
        if (!position) {
          return res.status(404).json({ error: `No active position found for ${symbol}` });
        }
        
        // isManaged değerini güncelle
        position.isManaged = !!isManaged; // Boolean'a çevir
        await position.save();
        
        // Log
        const action = position.isManaged ? "managed" : "manual (monitored only)";
        logger.info(`Position ${symbol} marked as ${action}`);
        
        res.json({ 
          symbol, 
          isManaged: position.isManaged,
          message: `Position ${symbol} is now ${action}` 
        });
      } catch (error) {
        logger.error(`Error updating position managed status: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });
    
    // RL Bot API endpoint'leri
    app.get('/api/rl/start', async (req, res) => {
      try {
        if (!rlBot) {
          rlBot = new RLPositionManager();
          await rlBot.start();
          res.json({ success: true, message: 'RL Bot started' });
        } else {
          res.json({ success: false, message: 'RL Bot is already running' });
        }
      } catch (error) {
        logger.error('Error starting RL Bot:', error);
        res.status(500).json({ error: 'Error starting RL Bot' });
      }
    });

    app.get('/api/rl/stop', (req, res) => {
      try {
        if (rlBot) {
          rlBot.stop();
          rlBot = null;
          res.json({ success: true, message: 'RL Bot stopped' });
        } else {
          res.json({ success: false, message: 'RL Bot is not running' });
        }
      } catch (error) {
        logger.error('Error stopping RL Bot:', error);
        res.status(500).json({ error: 'Error stopping RL Bot' });
      }
    });

    app.get('/api/rl/status', (req, res) => {
      res.json({ running: rlBot !== null });
    });

    app.get('/api/rl/train/:symbol/:days', async (req, res) => {
      try {
        const { symbol, days } = req.params;
        
        if (!rlBot) {
          rlBot = new RLPositionManager();
          await rlBot.binanceService.initialize();
        }
        
        // Eğitim işlemini başlat
        rlBot.trainOnHistoricalData(symbol, parseInt(days))
          .then(result => {
            logger.info(`Training completed for ${symbol} with result: ${result}`);
          })
          .catch(error => {
            logger.error(`Training error for ${symbol}:`, error);
          });
        
        res.json({ success: true, message: `Started training for ${symbol} using ${days} days of historical data` });
      } catch (error) {
        logger.error('Error starting training:', error);
        res.status(500).json({ error: 'Error starting training' });
      }
    });
    
    // Start web server
    app.listen(PORT, () => {
      logger.info(`Web interface started on port ${PORT}`);
    });
    
    logger.info('Bot started successfully with Multi-Timeframe Analysis and Web Interface.', { timestamp: new Date().toISOString() });

    // Auto-start RL Bot if configured
    if (config.autoStartRLBot) {
      try {
        logger.info('Auto-starting RL Bot...');
        rlBot = new RLPositionManager();
        await rlBot.start();
        logger.info('RL Bot auto-started successfully');
      } catch (error) {
        logger.error('Error auto-starting RL Bot:', error);
      }
    }

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
