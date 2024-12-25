// services/OrderService.js

const logger = require('../utils/logger');
const notifier = require('node-notifier'); // node-notifier'ı içe aktarın
const path = require('path'); // İsteğe bağlı: Bildirim simgesi eklemek için
const config = require('../config/config');

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }

  /**
   * Pozisyon açma işlemi
   */
  async openPositionWithMultipleTPAndTrailing(symbol, side, currentPrice, levels = {}, useTrailingStop, callbackRate) {
    try {
      // Pozisyon açma
      const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const quantity = await this.calculatePositionSize(symbol, currentPrice);
      await this.binanceService.placeMarketOrder(symbol, side, quantity, positionSide);
      logger.info(`Market order placed: ${side} ${symbol} x${quantity}`);

      // ATR hesaplama
      const atr = await this.binanceService.calculateATR(symbol, config.strategy.atrPeriod);
      if (atr === undefined) {
        logger.warn(`ATR is undefined for ${symbol}. Skipping stop-loss and take-profit placement.`);
        return false;
      }

      // Risk Reward Ratio kullanımı
      const riskAmount = atr * config.strategy.keyValue; // 'a' * ATR
      const stopLoss = side === 'BUY' ? currentPrice - riskAmount : currentPrice + riskAmount;
      const takeProfit = side === 'BUY'
        ? currentPrice + (riskAmount * config.strategy.riskRewardRatio)
        : currentPrice - (riskAmount * config.strategy.riskRewardRatio);

      // Stop-Loss Emirini Yerleştirme
      await this.binanceService.placeStopLossOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, stopLoss, positionSide);
      logger.info(`Stop-Loss order placed at ${stopLoss}`);

      // Take-Profit Emirini Yerleştirme
      await this.binanceService.placeTakeProfitOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, takeProfit, positionSide);
      logger.info(`Take-Profit order placed at ${takeProfit}`);

      // Trailing Stop ekleme
      if (useTrailingStop) {
        await this.binanceService.placeTrailingStopOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, callbackRate, positionSide);
        logger.info(`Trailing Stop order placed with callback rate ${callbackRate}%`);
      }

      // Bildirim Gönderme
      notifier.notify(
        {
          title: 'Pozisyon Açıldı!',
          message: `${side} pozisyonu açıldı: ${symbol} x${quantity}`,
          sound: true, // Ses çalmasını sağlar
          icon: path.join(__dirname, 'trade-icon.png'), // İsteğe bağlı: Bildirim simgesi
          wait: false
        },
        function (err, response, metadata) {
          if (err) {
            logger.error('Notification error:', err);
          }
        }
      );

      return true;
    } catch (error) {
      logger.error(`Error opening position for ${symbol}:`, error);
      return false;
    }
  }

  /**
   * Pozisyon boyutunu hesaplama
   */
  async calculatePositionSize(symbol, currentPrice) {
    try {
      const balance = await this.binanceService.getFuturesBalance();
      const riskAmount = balance.availableBalance * config.riskPerTrade;
      const stopLossDistance = config.strategy.keyValue; // ATR'nin kaç katı risk alınacak
      const quantity = riskAmount / (currentPrice * stopLossDistance);
      const quantityPrecision = await this.binanceService.getQuantityPrecision(symbol);
      return parseFloat(quantity.toFixed(quantityPrecision));
    } catch (error) {
      logger.error(`Error calculating position size for ${symbol}:`, error);
      return 0;
    }
  }
}

module.exports = OrderService;
