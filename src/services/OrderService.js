// services/OrderService.js

const logger = require('../utils/logger');
const sound = require('sound-play'); // sound-play modülünü içe aktarın
const path = require('path'); // Ses dosyasının yolunu belirtmek için
const config = require('../config/config');
const { formatQuantity } = require('../utils/helpers');
const TelegramService = require('./TelegramService');

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }

  async placeMarketOrder({ symbol, side, quantity, positionSide }) {
    try {

      await this.binanceService.setLeverage(symbol);

      const quantityPrecision = this.binanceService.getQuantityPrecision(symbol);
      const stepSize = parseFloat(this.binanceService.exchangeInfo[symbol].filters.LOT_SIZE.stepSize);

      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);

      // Eğer adjustedQuantity 0'dan küçükse veya uyumsuzsa hata ver
      if (adjustedQuantity <= 0) {
        throw new Error(`Invalid quantity after adjustment: ${adjustedQuantity}`);
      }

      const orderData = {
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity,
        positionSide,
      };

      logger.info('Placing MARKET order:', orderData);
      return await this.binanceService.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error in Binance API MARKET order for ${symbol}:`, error.message);
      await TelegramService.sendError(error.message, symbol);
      throw error;
    }
  }

  async calculateTurtlePositionSize(symbol, atr) {
    try {
      const balance = await this.binanceService.getFuturesBalance();
      const riskAmount = balance * config.riskPerTrade; // %1 risk
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);
      const contractSize = 1;
      // Turtle pozisyon büyüklüğü: riskAmount / (ATR * birim fiyat)
      const quantity = riskAmount / (atr * contractSize);
      const stepSize = await this.binanceService.getStepSize(symbol);
      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);

      const notional = adjustedQuantity * currentPrice;
      if (notional < 5) {
        logger.warn(`Notional value (${notional}) for ${symbol} below minimum (5 USDT).`);
        return 0;
      }

      logger.info(`Turtle position size for ${symbol}: ${adjustedQuantity}, ATR: ${atr}`);
      return adjustedQuantity;
    } catch (error) {
      logger.error(`Error calculating Turtle position size: ${error.message}`);
      return 0;
    }
  }

  async addPosition(position, currentPrice) {
    if (position.units >= 4) return;

    const atr = await binanceService.calculateATR(position.symbol, 20);
    const addThreshold = position.side === 'LONG'
      ? position.entryPrice + 0.5 * atr
      : position.entryPrice - 0.5 * atr;

    if (currentPrice >= addThreshold) {
      const newUnits = calculatePositionSize(atr);
      await orderService.placeMarketOrder({
        symbol: position.symbol,
        side: position.side,
        quantity: newUnits
      });

      position.units += newUnits;
      await position.save();
    }
  }

  async calculateOrderQuantity(allocation, price) {
    // Bakiyeyi config'den alın veya dinamik olarak hesaplayın
    const balance = config.calculate_position_size ? await this.binanceService.getFuturesBalance() : config.static_position_size; // Sabit veya dinamik mod

    // Pozisyon büyüklüğü hesaplama
    const quantity = (balance * allocation) / price;

    // Minimum notional kontrolü
    const notional = quantity * price;
    const minNotional = 5; // Binance için minimum işlem büyüklüğü
    if (notional < minNotional) {
      logger.warn(`Calculated notional (${notional}) is below minimum. Allocation: ${allocation}, Balance: ${balance}, Price: ${price}`);
      return 0; // Minimum notional sağlanmıyorsa işlem yapmayın
    }

    logger.info(`Calculated order quantity: ${quantity} for allocation: ${allocation}, price: ${price}, balance: ${balance}`);
    return quantity;
  }

  /**
   * Pozisyon boyutunu hesaplama
   */
  async calculatePositionSize(symbol, currentPrice) {
    const { calculate_position_size, static_position_size } = config;


    if (!calculate_position_size) {
      // Sabit pozisyon büyüklüğüne göre miktarı hesapla
      const quantity = static_position_size / currentPrice;

      const stepSize = await this.binanceService.getStepSize(symbol);
      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);

      const notional = adjustedQuantity * currentPrice;
      const minNotional = 5; // Binance'in minimum işlem büyüklüğü

      if (notional < minNotional) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below the minimum (${minNotional} USDT).`);
        return 0; // Minimum notional sağlanmıyorsa işlem yapmayın
      }

      logger.info(`Pozisyon Boyutu Hesaplama (${symbol}):`, {
        usdtAmount: config.static_position_size,
        currentPrice: currentPrice,
        rawQuantity: quantity,
        stepSize: stepSize,
        adjustedQuantity: adjustedQuantity
      });
      return adjustedQuantity;
    }
    try {
      // Dinamik hesaplama
      const balance = await this.binanceService.getFuturesBalance();
      const usdtAmount = balance * config.riskPerTrade;

      const atr = await this.binanceService.calculateATR(symbol, config.strategy.atrPeriod);
      const stopLossDistance = config.strategy.keyValue * atr;

      const leverage = config.strategy.leverage;
      const quantity = (usdtAmount * leverage) / currentPrice;

      const stepSize = await this.binanceService.getStepSize(symbol);
      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);

      logger.info(`Dynamically calculated quantity for ${symbol}: ${adjustedQuantity}`);
      return adjustedQuantity;
    } catch (error) {
      logger.error(`Error calculating position size for ${symbol}:`, error);
      return 0;
    }
  }

  async closePosition(symbol, side, quantity, positionSide) {
    try {
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      const stepSize = await this.binanceService.getStepSize(symbol);
      const adjustedQuantity = parseFloat(quantity).toFixed(stepSize);

      const notional = adjustedQuantity * currentPrice;
      if (notional < 5) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below Binance's minimum. Skipping close position.`);
        return false; // İşlem yapmadan çık
      }

      logger.info(`Closing position for ${symbol}: Side: ${side}, Quantity: ${adjustedQuantity}, Position Side: ${positionSide}`);
      return await this.binanceService.placeMarketOrder({
        symbol,
        side,
        quantity: adjustedQuantity,
        positionSide,
        reduceOnly: true,
      });
    } catch (error) {
      logger.error(`Error closing position for ${symbol}:`, error);
      throw error;
    }
  }
}



module.exports = OrderService;
