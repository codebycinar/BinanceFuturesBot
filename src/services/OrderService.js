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
   * Tek fonksiyon: Market emriyle aç, sabit SL, 3 kademeli TP + opsiyonel trailingStop.
   */
   async openPositionWithMultipleTPAndTrailing(
    symbol,
    signal,        // 'LONG'|'SHORT'
    entryPrice,
    levels,        
    useTrailingStop = false,  // trailing stop'u aktif etmek için true
    trailingRate = 0.5        // %0.5 geri çekilmede stop
  ) {
    try {
      // 1) Bakiye ve pozisyon büyüklüğü
      const balance = await this.binanceService.getFuturesBalance();
      const positionSize = this.calculatePositionSize(balance, entryPrice);

      // 2) Market emriyle pozisyonu aç
      const side = signal === 'LONG' ? 'BUY' : 'SELL';
      const positionSide = signal === 'LONG' ? 'LONG' : 'SHORT';

      const entryOrder = await this.binanceService.placeMarketOrder(
        symbol,
        side,
        positionSize,
        positionSide
      );
      if (!entryOrder) {
        logger.error(`Failed to open position for ${symbol}`);
        return null;
      }

      // 3) Stop-loss (sabit)
      const stopLossPrice = this.calculateStopLossPrice(signal, entryPrice, levels);
      await this.binanceService.placeStopLossOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        positionSize,
        stopLossPrice,
        positionSide
      );

      // 4) Üç kademeli Take-Profit
      // TP1 %2, TP2 %4, TP3 %7 (örn.)
      const tp1Price = signal === 'LONG' ? entryPrice * 1.02 : entryPrice * 0.98;
      const tp2Price = signal === 'LONG' ? entryPrice * 1.04 : entryPrice * 0.96;
      const tp3Price = signal === 'LONG' ? entryPrice * 1.07 : entryPrice * 0.93;

      const tp1Qty = positionSize * 0.3;
      const tp2Qty = positionSize * 0.3;
      const tp3Qty = positionSize * 0.4;

      await this.binanceService.placeTakeProfitOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        tp1Qty,
        tp1Price,
        positionSide
      );
      await this.binanceService.placeTakeProfitOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        tp2Qty,
        tp2Price,
        positionSide
      );
      await this.binanceService.placeTakeProfitOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        tp3Qty,
        tp3Price,
        positionSide
      );

      // 5) Trailing Stop (opsiyonel)
      if (useTrailingStop) {
        const trailingSide = side === 'BUY' ? 'SELL' : 'BUY';
        await this.binanceService.placeTrailingStopOrder(
          symbol,
          trailingSide,
          positionSize,
          trailingRate,
          positionSide
        );
        logger.info(`Trailing Stop enabled at callbackRate: ${trailingRate}%`);
      }

      logger.info(`Opened position for ${symbol} with multiple TP & trailingStop=${useTrailingStop}`);
      return entryOrder;
    } catch (error) {
      logger.error(`Error opening multi-TP & trailing position for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Örnek bir stop loss hesabı
   */
  calculateStopLossPrice(signal, entryPrice, levels) {
    // Burada dilediğiniz stop-loss hesaplamasını yapabilirsiniz.
    // Örneğin %2 sabit
    const slPercent = 0.02;
    if (signal === 'LONG') {
      return entryPrice * (1 - slPercent);
    } else {
      return entryPrice * (1 + slPercent);
    }
    // veya destek/direnç levels'a göre:
    // return calculateStopLoss(signal, entryPrice, levels.support or levels.resistance);
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
