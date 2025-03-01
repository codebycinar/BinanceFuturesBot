const positionManager = require('./services/PositionManager');
const logger = require('./utils/logger');
const BinanceService = require('./services/BinanceService');
const OrderService = require('./services/OrderService');
const MarketScanner = require('./services/MarketScanner');
const MultiTimeframeService = require('./services/MultiTimeframeService');
const PerformanceTracker = require('./services/PerformanceTracker');
const TelegramPositionManagerBot = require('./services/TelegramPositionManagerBot');
const config = require('./config/config');
const { Telegraf } = require('telegraf');
const dotenv = require("dotenv");
const express = require('express');
const path = require('path');

(async () => {
  try {
    // Load environment variables
    dotenv.config();
    
    // Initialize Telegram Position Manager Bot
    const telegramBot = new TelegramPositionManagerBot();
    await telegramBot.initialize();
    
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
