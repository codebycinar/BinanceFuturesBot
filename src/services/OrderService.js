const logger = require('../utils/logger');
const { calculateStopLoss, calculateTakeProfit } = require('../utils/priceCalculator');

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }

  calculatePositionSize(balance, currentPrice) {
    const riskAmount = balance.availableBalance * 0.01; // %1 risk
    return (riskAmount / currentPrice);
  }

  async openPosition(symbol, signal, currentPrice, levels) {
    try {
      const balance = await this.binanceService.getFuturesBalance();
      const positionSize = this.calculatePositionSize(balance, currentPrice);
  
      const { stopLoss, takeProfit } = this.calculateOrderLevels(signal, currentPrice, levels);
  
      const positionSide = signal === 'LONG' ? 'LONG' : 'SHORT';
  
      const entryOrder = await this.binanceService.openPosition(
        symbol,
        signal === 'LONG' ? 'BUY' : 'SELL',
        positionSize,
        positionSide
      );
  
      if (!entryOrder) {
        logger.error(`Failed to create entry order for ${symbol}`);
        return null; // Başarısız durumda null döndür
      }
  
      await this.binanceService.placeStopLossOrder(
        symbol,
        signal === 'LONG' ? 'SELL' : 'BUY',
        positionSize,
        stopLoss,
        positionSide
      );
  
      await this.binanceService.placeTakeProfitOrder(
        symbol,
        signal === 'LONG' ? 'SELL' : 'BUY',
        positionSize,
        takeProfit,
        positionSide
      );
  
      return entryOrder;
    } catch (error) {
      logger.error(`Failed to open position for ${symbol}:`, error);
      return null; // Başarısız durumda null döndür
    }
  }  

  async adjustPosition(symbol, signal, currentPrice, levels) {
    try {
      const openPositions = await this.binanceService.getOpenPositions();
      const existingPosition = openPositions.find(
        position => position.symbol === symbol && position.positionSide === (signal === 'LONG' ? 'LONG' : 'SHORT')
      );

      if (!existingPosition) {
        logger.info(`No existing position for ${symbol}. Cannot adjust.`);
        return; // Pozisyon yoksa ekleme yapılmaz
      }

      // Fiyat seviyesi kontrolü
      const existingPrice = parseFloat(existingPosition.entryPrice);
      const priceDifference = Math.abs(currentPrice - existingPrice) / existingPrice;

      if (priceDifference < 0.01) {
        logger.info(`Price difference for ${symbol} is too small. Skipping adjustment.`);
        return; // Fiyat farkı yeterince büyük değilse ekleme yapılmaz
      }

      const additionalPositionSize = this.calculatePositionSize(
        { availableBalance: existingPosition.positionAmt }, // Mevcut pozisyon büyüklüğüne göre ekleme
        currentPrice
      );

      logger.info(`Adjusting position for ${symbol}:
  - Existing Price: ${existingPrice}
  - Current Price: ${currentPrice}
  - Additional Size: ${additionalPositionSize}
      `);

      await this.binanceService.openPosition(
        symbol,
        signal === 'LONG' ? 'BUY' : 'SELL',
        additionalPositionSize,
        signal === 'LONG' ? 'LONG' : 'SHORT'
      );

      logger.info(`Successfully adjusted position for ${symbol}.`);
    } catch (error) {
      logger.error(`Error adjusting position for ${symbol}:`, error);
    }
  }

  calculateOrderLevels(signal, currentPrice, levels) {
    if (signal === 'LONG') {
      const stopLoss = calculateStopLoss('LONG', currentPrice, levels.support);
      const takeProfit = calculateTakeProfit('LONG', currentPrice, levels.resistance);
      return { stopLoss, takeProfit };
    } else {
      const stopLoss = calculateStopLoss('SHORT', currentPrice, levels.resistance);
      const takeProfit = calculateTakeProfit('SHORT', currentPrice, levels.support);
      return { stopLoss, takeProfit };
    }
  }
}

module.exports = OrderService;
