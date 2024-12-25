// index.js
const BinanceService = require('./services/BinanceService');
const MarketScanner = require('./services/MarketScanner');
const OrderService = require('./services/OrderService');
const logger = require('./utils/logger');
const config = require('./config/config');

class TradingBot {
  constructor() {
    // Tek bir BinanceService instance'ı oluşturuyoruz
    this.binanceService = new BinanceService();
    this.orderService = new OrderService(this.binanceService);
    this.marketScanner = new MarketScanner(this.binanceService, this.orderService);
  }

  async start() {
    logger.info('Starting trading bot...');
    await this.binanceService.initialize();
    try {
      await Promise.all([
        this.startMarketScanning(),
        this.scheduleOrderCleanup(), // İlgisiz emirleri iptal et
      ]);
    } catch (error) {
      logger.error('Error starting bot:', error);
      process.exit(1);
    }
  }

  async startMarketScanning() {
    while (true) {
      try {
        logger.info('Scanning config-defined symbols for opportunities...', { timestamp: new Date().toISOString() });
        await this.marketScanner.scanConfigSymbols(); 

        // 5 dk bekleme
        await new Promise(resolve => setTimeout(resolve, config.marketScanInterval || 300000));
      } catch (error) {
        logger.error('Error in market scanning loop:', error);
        // Hata durumunda 1 dk bekleyip tekrar dene
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
  }

  async scheduleOrderCleanup() {
    setInterval(async () => {
      try {
        logger.info('Checking and cancelling unrelated orders...');
        await this.binanceService.cancelUnrelatedOrders();
      } catch (error) {
        logger.error('Error during order cleanup:', error);
      }
    }, config.orderCleanupInterval || 60000); // Varsayılan 1 dakika
  }
}

const bot = new TradingBot();
bot.start();
