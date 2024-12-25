const logger = require('../utils/logger');
const { calculateStopLoss, calculateTakeProfit } = require('../utils/priceCalculator');
const config = require('../config/config');

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }



  /**
  * Tek fonksiyon: Market emriyle aç, sabit SL, 3 kademeli TP + opsiyonel trailingStop.
  */
  async openPositionWithMultipleTPAndTrailing(
    symbol,
    signal,        // 'LONG'|'SHORT'
    entryPrice,
    levels,        
    useTrailingStop = config.trailingStop.use,  // config'den al
    trailingRate = config.trailingStop.callbackRate // config'den al
  ) {
    try {
      // 1) Bakiye ve pozisyon büyüklüğü
      const balance = await this.binanceService.getFuturesBalance();
      const positionSize = await this.calculatePositionSize(symbol, balance, entryPrice); // Sembol parametresi eklendi

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

      // 3) Stop-loss (config'den)
      const stopLossPrice = await this.calculateStopLossPrice(symbol, signal, entryPrice, levels); // Sembol parametresi eklendi
      await this.binanceService.placeStopLossOrder(
        symbol,
        side === 'BUY' ? 'SELL' : 'BUY',
        positionSize,
        stopLossPrice,
        positionSide
      );

      // 4) Kademeli Take-Profit (config'den)
      for (let i = 0; i < config.takeProfitPercents.length; i++) {
        const tpPercent = config.takeProfitPercents[i];
        const tpPrice = signal === 'LONG' ? entryPrice * (1 + tpPercent / 100) : entryPrice * (1 - tpPercent / 100);
        const tpQty = positionSize * ((i < config.takeProfitPercents.length - 1) ? 0.3 : 0.4); // Son TP için farklı oran

        await this.binanceService.placeTakeProfitOrder(
          symbol,
          side === 'BUY' ? 'SELL' : 'BUY',
          tpQty,
          tpPrice,
          positionSide
        );
      }

      // 5) Trailing Stop (opsiyonel, config'den)
      if (useTrailingStop) {
        const trailingSide = side === 'BUY' ? 'SELL' : 'BUY';
        await this.binanceService.placeTrailingStopOrder(
          symbol,
          trailingSide,
          positionSize,
          trailingRate,
          positionSide
        );
        logger.info(`Trailing Stop enabled at callbackRate: ${trailingRate}% for ${symbol}`);
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
  async calculateStopLossPrice(symbol, signal, entryPrice, levels) {
    const slPercent = config.stopLossPercent; // Config'den al
    const pricePrecision = await this.binanceService.getPricePrecision(symbol); // Fiyat precision'ını al

    if (signal === 'LONG') {
      return parseFloat((entryPrice * (1 - slPercent / 100)).toFixed(pricePrecision));
    } else {
      return parseFloat((entryPrice * (1 + slPercent / 100)).toFixed(pricePrecision));
    }
  }

    /**
   * Pozisyon boyutu hesaplar (ör. cüzdanın %1'i kadar risk).
   */
    async calculatePositionSize(symbol, balance, price) {
      const riskAmount = balance.availableBalance * config.riskPerTrade;
      const quantity = riskAmount / price;
      const quantityPrecision = await this.binanceService.getQuantityPrecision(symbol); // Sembol precision'ını al
      return parseFloat(quantity.toFixed(quantityPrecision));
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
