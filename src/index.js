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
        logger.info('Scanning all markets for opportunities...');
        const allSymbols = await this.binanceService.getAllSymbols();
        const opportunities = await this.marketScanner.scanMarkets(allSymbols);

        if (opportunities.length > 0) {
          logger.info(`Found ${opportunities.length} opportunities.`);
          await Promise.all(opportunities.map(this.evaluateOpportunity.bind(this)));
        }

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

  async evaluateOpportunity(opportunity) {
    const { symbol, signal, price, levels } = opportunity;

    try {
      const positionSize = this.calculatePositionSize(price);
      if (signal === 'LONG') {
        await this.binanceService.openPosition(symbol, 'BUY', positionSize, 'LONG');
      } else if (signal === 'SHORT') {
        await this.binanceService.openPosition(symbol, 'SELL', positionSize, 'SHORT');
      }
      logger.info(`Opened ${signal} position for ${symbol} at ${price}`);
    } catch (error) {
      logger.error(`Error evaluating opportunity for ${symbol}:`, error);
    }
  }

  calculatePositionSize(price) {
    const balance = config.initialBalance || 1000; // Test için varsayılan bir bakiye
    const riskPerTrade = config.riskPerTrade || 0.01; // %1 risk
    return (balance * riskPerTrade) / price;
  }
}

const bot = new TradingBot();
bot.start();
