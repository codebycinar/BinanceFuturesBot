const positionManager = require('./services/PositionManager');
const logger = require('./utils/logger');
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const MultiTimeframeService = require('./services/MultiTimeframeService');
const PerformanceTracker = require('./services/PerformanceTracker');
const config = require('./config/config');
const { Telegraf } = require('telegraf');
const dotenv = require("dotenv");
const express = require('express');
const path = require('path');

(async () => {
  try {
    // Load environment variables
    dotenv.config();
    
    // Initialize Telegram bot (simple notification only)
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    bot.start((ctx) => ctx.reply('Binance Futures Bot Online!'));
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
    
    // Start web server
    app.listen(PORT, () => {
      logger.info(`Web interface started on port ${PORT}`);
    });
    
    logger.info('Bot started successfully with Multi-Timeframe Analysis and Web Interface.', { timestamp: new Date().toISOString() });

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
