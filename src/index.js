const BinanceService = require('./services/BinanceService');
const MarketScanner = require('./services/MarketScanner');
const logger = require('./utils/logger');
const config = require('./config/config');

class TradingBot {
  constructor() {
    this.binanceService = new BinanceService();
    this.marketScanner = new MarketScanner();
   
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
        //logger.info('Scanning all markets for opportunities...');
        //const allSymbols = await this.binanceService.getAllSymbols();
        // ...
        // <--- Eskiden "scanMarkets(allSymbols)" yapıyorduk
  
        logger.info('Scanning config-defined 5 coins for opportunities...');
        await this.marketScanner.scanConfigSymbols(); 
  
        await new Promise(resolve => setTimeout(resolve, config.marketScanInterval || 300000)); // 5 dakika
      } catch (error) {
        logger.error('Error in market scanning loop:', error);
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 dakika
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


  calculatePositionSize(price) {
    const balance = config.initialBalance || 1000; // Test için varsayılan bir bakiye
    const riskPerTrade = config.riskPerTrade || 0.01; // %1 risk
    return (balance * riskPerTrade) / price;
  }
}

const bot = new TradingBot();
bot.start();
