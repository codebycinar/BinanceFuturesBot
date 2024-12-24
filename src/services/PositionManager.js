const logger = require('../utils/logger');

class PositionManager {
  constructor(binanceService) {
    this.binanceService = binanceService;
    this.positions = new Map(); // symbol -> position details
  }

  async addPosition(symbol, side, entryPrice, quantity, levels) {
    const targetPrice = side === 'LONG' 
      ? this.findFirstResistance(entryPrice, levels.resistance)
      : this.findFirstSupport(entryPrice, levels.support);

    this.positions.set(symbol, {
      side,
      entryPrice,
      quantity,
      targetPrice,
      levels
    });

    logger.info(`New position added: ${symbol} ${side} at ${entryPrice}, target: ${targetPrice}`);
  }

  async checkPositions(currentPrices) {
    for (const [symbol, position] of this.positions.entries()) {
      const currentPrice = currentPrices[symbol];
      if (!currentPrice) continue;

      const shouldClose = this.shouldClosePosition(position, currentPrice);
      
      if (shouldClose) {
        try {
          await this.binanceService.closePosition(symbol, position.side, position.quantity);
          this.positions.delete(symbol);
          
          const profit = this.calculateProfit(position, currentPrice);
          logger.info(`Closed position: ${symbol} ${position.side} at ${currentPrice}, profit: ${profit}%`);
        } catch (error) {
          logger.error(`Error closing position for ${symbol}:`, error);
        }
      }
    }
  }

  shouldClosePosition(position, currentPrice) {
    if (position.side === 'LONG') {
      return currentPrice >= position.targetPrice;
    } else {
      return currentPrice <= position.targetPrice;
    }
  }

  findFirstResistance(price, resistanceLevels) {
    return resistanceLevels
      .filter(level => level.price > price)
      .sort((a, b) => a.price - b.price)[0]?.price;
  }

  findFirstSupport(price, supportLevels) {
    return supportLevels
      .filter(level => level.price < price)
      .sort((a, b) => b.price - a.price)[0]?.price;
  }

  calculateProfit(position, closePrice) {
    const priceDiff = closePrice - position.entryPrice;
    const multiplier = position.side === 'LONG' ? 1 : -1;
    return ((priceDiff / position.entryPrice) * 100 * multiplier).toFixed(2);
  }

  getActivePositions() {
    return Array.from(this.positions.entries()).map(([symbol, position]) => ({
      symbol,
      ...position
    }));
  }
}

module.exports = PositionManager;