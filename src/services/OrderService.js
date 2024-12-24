const logger = require('../utils/logger');
const { calculateStopLoss, calculateTakeProfit } = require('../utils/priceCalculator');
const config = require('../config/config'); 

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }

  /**
   * Pozisyon boyutu hesaplar (ör. cüzdanın %1'i kadar risk).
   */
  calculatePositionSize(balance, price) {
    const riskAmount = balance.availableBalance * config.riskPerTrade; 
    return parseFloat((riskAmount / price).toFixed(8));
  }

  /**
   * MARKET emriyle pozisyon açar, ardından Stop-Loss ve Take-Profit emirlerini de girer.
   */
  async openPosition(symbol, signal, currentPrice, levels) {
    try {
      const balance = await this.binanceService.getFuturesBalance();
      const positionSize = this.calculatePositionSize(balance, currentPrice);

      // LONG => BUY, SHORT => SELL
      const side = signal === 'LONG' ? 'BUY' : 'SELL';
      const positionSide = signal === 'LONG' ? 'LONG' : 'SHORT';

      // Market emri (BinanceService üstünden)
      const entryOrder = await this.binanceService.placeMarketOrder(
        symbol,
        side,
        positionSize,
        positionSide
      );

      if (!entryOrder) {
        logger.error(`Failed to create entry order for ${symbol}`);
        return null;
      }

      // Stop-loss & take-profit seviyeleri
      const { stopLoss, takeProfit } = this.calculateOrderLevels(signal, currentPrice, levels);

      // Stop-loss
      await this.binanceService.placeStopLossOrder(
        symbol,
        signal === 'LONG' ? 'SELL' : 'BUY',
        positionSize,
        stopLoss,
        positionSide
      );

      // Take-profit
      await this.binanceService.placeTakeProfitOrder(
        symbol,
        signal === 'LONG' ? 'SELL' : 'BUY',
        positionSize,
        takeProfit,
        positionSide
      );

      logger.info(`Position opened for ${symbol}. SL: ${stopLoss}, TP: ${takeProfit}`);
      return entryOrder;
    } catch (error) {
      logger.error(`Failed to open position for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Limit emri ile pozisyon açar.
   */
  async openLimitPosition(symbol, signal, limitPrice, levels) {
    try {
      const balance = await this.binanceService.getFuturesBalance();
      const positionSize = this.calculatePositionSize(balance, limitPrice);

      // 'LONG' -> side='BUY', positionSide='LONG'
      // 'SHORT' -> side='SELL', positionSide='SHORT'
      const side = signal === 'LONG' ? 'BUY' : 'SELL';
      const positionSide = signal === 'LONG' ? 'LONG' : 'SHORT';

      // Limit emrini gönderiyoruz
      const limitOrder = await this.binanceService.placeLimitOrder(
        symbol,
        side,
        positionSize,
        limitPrice,
        positionSide
      );

      if (!limitOrder) {
        logger.error(`Failed to create limit order for ${symbol}`);
        return null;
      }

      // Limit emrini koyduk; şimdi SL/TP seviyelerini hesaplayalım
      const { stopLoss, takeProfit } = this.calculateOrderLevels(signal, limitPrice, levels);

      // Stop-Loss emri
      await this.binanceService.placeStopLossOrder(
        symbol,
        // LONG pozisyonun stop'u SELL tarafındadır; SHORT pozisyonun stop'u BUY
        side === 'BUY' ? 'SELL' : 'BUY',
        positionSize,
        stopLoss,
        positionSide
      );

      // Take-Profit emri
      await this.binanceService.placeTakeProfitOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        positionSize,
        takeProfit,
        positionSide
      );

      logger.info(`Limit order placed for ${symbol} at ${limitPrice} for signal: ${signal}`);
      logger.info(`SL: ${stopLoss}, TP: ${takeProfit} orders also placed.`);

      return limitOrder;
    } catch (error) {
      logger.error(`Error placing limit position for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Pozisyona ekleme yapma (örn. “average down”).
   */
  async adjustPosition(symbol, signal, currentPrice, levels) {
    try {
      const openPositions = await this.binanceService.getOpenPositions();
      const existingPosition = openPositions.find(
        position => position.symbol === symbol && position.positionSide === (signal === 'LONG' ? 'LONG' : 'SHORT')
      );

      if (!existingPosition) {
        logger.info(`No existing position for ${symbol}. Cannot adjust.`);
        return;
      }

      const existingPrice = parseFloat(existingPosition.entryPrice);
      const priceDifference = Math.abs(currentPrice - existingPrice) / existingPrice;

      // Örnek mantık: Fiyat farkı en az %1 olursa ekleme yap.
      if (priceDifference < 0.01) {
        logger.info(`Price difference for ${symbol} is too small. Skipping adjustment.`);
        return;
      }

      const additionalPositionSize = this.calculatePositionSize(
        { availableBalance: existingPosition.positionAmt },
        currentPrice
      );

      logger.info(`Adjusting position for ${symbol}:
        - Existing Price: ${existingPrice}
        - Current Price: ${currentPrice}
        - Additional Size: ${additionalPositionSize}
      `);

      await this.binanceService.placeMarketOrder(
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

  /**
   * Stop-loss & take-profit değerlerini hesaplar (destek/direnç seviyelerine göre).
   */
  calculateOrderLevels(signal, entryPrice, levels) {
    // Burada entryPrice olarak limitPrice kullanıyoruz.
    // Alternatif: Bir mum kapanış fiyatını da kullanabilirsiniz.
    const stopLoss =
      signal === 'LONG'
        ? calculateStopLoss('LONG', entryPrice, levels.support)
        : calculateStopLoss('SHORT', entryPrice, levels.resistance);

    const takeProfit =
      signal === 'LONG'
        ? calculateTakeProfit('LONG', entryPrice, levels.resistance)
        : calculateTakeProfit('SHORT', entryPrice, levels.support);

    return { stopLoss, takeProfit };
  }
}

module.exports = OrderService;
