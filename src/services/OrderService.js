// services/OrderService.js

const logger = require('../utils/logger');
const sound = require('sound-play'); // sound-play modülünü içe aktarın
const path = require('path'); // Ses dosyasının yolunu belirtmek için
const config = require('../config/config');
const { formatQuantity } = require('../utils/helpers');

class OrderService {
  constructor(binanceService) {
    this.binanceService = binanceService;
  }

  async placeMarketOrder({ symbol, side, quantity, positionSide }) {
    try {
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
      throw error;
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
   * Pozisyon açma işlemi
   */
  async openPositionWithMultipleTPAndTrailing(symbol, side, currentPrice, levels = {}, useTrailingStop, callbackRate) {
    try {
      const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const quantity = await this.calculatePositionSize(symbol, currentPrice);

      if (!quantity || quantity <= 0) {
        logger.error(`Calculated quantity is invalid for ${symbol}: ${quantity}`, { timestamp: new Date().toISOString() });
        return false;
      }

      logger.info(`Placing market order for ${symbol}: ${side} x${quantity}`, { timestamp: new Date().toISOString() });

      // actualPositionSide'ı tanımlayın
      const actualPositionSide = this.binanceService.positionSideMode === 'Hedge' ? positionSide : undefined;

      await this.binanceService.placeMarketOrder(symbol, side, quantity, positionSide);
      logger.info(`Market order placed: ${side} ${symbol} x${quantity}`, { timestamp: new Date().toISOString() });

      // ATR hesaplama ve diğer işlemler...

      // ATR hesaplama
      const atr = await this.binanceService.calculateATR(symbol, config.strategy.atrPeriod);
      if (atr === undefined) {
        logger.warn(`ATR is undefined for ${symbol}. Skipping stop-loss and take-profit placement.`, { timestamp: new Date().toISOString() });
        return false;
      }

      // Risk Reward Ratio kullanımı
      const riskAmount = config.strategy.keyValue * atr; // 'keyValue' * ATR
      const stopLoss = side === 'BUY' ? currentPrice - riskAmount : currentPrice + riskAmount;
      const takeProfit = side === 'BUY'
        ? currentPrice + (riskAmount * config.strategy.riskReward)
        : currentPrice - (riskAmount * config.strategy.riskReward);

      logger.info(`Placing Stop-Loss order for ${symbol}: ${stopLoss}`, { timestamp: new Date().toISOString() });
      // Stop-Loss Emirini Yerleştirme
      await this.binanceService.placeStopLossOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, stopLoss, positionSide);
      logger.info(`Stop-Loss order placed at ${stopLoss}`, { timestamp: new Date().toISOString() });

      logger.info(`Placing Take-Profit order for ${symbol}: ${takeProfit}`, { timestamp: new Date().toISOString() });

      if (typeof takeProfit !== 'number' || isNaN(takeProfit)) {
        logger.error(`Take-Profit value is invalid: ${takeProfit}`, { timestamp: new Date().toISOString() });
        return;
      }

      // Take-Profit Emirini Yerleştirme
      await this.binanceService.placeTakeProfitOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, takeProfit, positionSide);
      logger.info(`Take-Profit order placed at ${takeProfit}`, { timestamp: new Date().toISOString() });

      // Trailing Stop ekleme
      if (useTrailingStop) {
        logger.info(`Placing Trailing Stop order for ${symbol} with callback rate ${callbackRate}%`, { timestamp: new Date().toISOString() });
        await this.binanceService.placeTrailingStopOrder(symbol, side === 'BUY' ? 'SELL' : 'BUY', quantity, callbackRate, positionSide);
        logger.info(`Trailing Stop order placed with callback rate ${callbackRate}%`, { timestamp: new Date().toISOString() });
      }

      const soundPath = path.join(__dirname, '../sounds/alert.wav');
      sound.play(soundPath)
        .then(() => {
          logger.info('Sound played successfully.');
        })
        .catch(err => {
          logger.error('Error playing sound:', err);
        });

      return true;
    } catch (error) {
      logger.error(`Error opening position for ${symbol}:`, {
        message: error.message,
        stack: error.stack,
        code: error.code,
        info: error.info,
      }, { timestamp: new Date().toISOString() });
      return false;
    }
  }

  async openPositionWithMultipleTP(symbol, signal, entryPrice, { stopLoss, takeProfit }) {
    try {
      const quantity = this.calculateOrderQuantity(entryPrice);
      const orderData = {
        symbol,
        side: signal,
        type: 'MARKET',
        quantity,
        stopLoss,
        takeProfit,
      };

      await this.binanceService.placeMarketOrder(orderData);
      logger.info(`Order placed for ${symbol} with stopLoss: ${stopLoss} and takeProfit: ${takeProfit}`);
      const soundPath = path.join(__dirname, '../sounds/alert.wav');
      sound.play(soundPath)
        .then(() => {
          logger.info('Sound played successfully.');
        })
        .catch(err => {
          logger.error('Error playing sound:', err);
        });

      return true;
    } catch (error) {
      logger.error(`Error placing order for ${symbol}: ${error.message}`);
    }
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

      logger.info(`Using static position size (${static_position_size} USDT) for ${symbol}. Calculated quantity: ${adjustedQuantity}`);
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

  async calculateStaticPositionSize(symbol, allocation) {
    try {
      if (!config.calculate_position_size) {
        allocation = config.static_position_size;
      }

      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      if (!currentPrice || allocation <= 0) {
        logger.warn(`Invalid data for position size calculation: Price=${currentPrice}, Allocation=${allocation}`);
        return 0;
      }

      // Kaldıraç ile pozisyon büyüklüğü hesaplama
      const positionSize = (allocation * config.strategy.leverage) / currentPrice;

      const stepSize = await this.binanceService.getStepSize(symbol);
      const roundedPositionSize = this.binanceService.roundQuantity(positionSize, stepSize);

      // Minimum notional kontrolü
      const notional = roundedPositionSize * currentPrice;
      const minNotional = 5; // Binance minimum işlem büyüklüğü
      if (notional < minNotional) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below minimum (${minNotional} USDT).`);
        return 0;
      }

      logger.info(`Calculated static position size for ${symbol}: ${roundedPositionSize}, Notional=${notional}`);
      return roundedPositionSize;
    } catch (error) {
      logger.error(`Error calculating static position size for ${symbol}: ${error.message}`);
      return 0;
    }
  }




  async getMinNotional(symbol) {
    const exchangeInfo = await this.client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
    const notionalFilter = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
    return notionalFilter ? parseFloat(notionalFilter.minNotional) : 5; // Varsayılan değer
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
  
  /**
   * Tüm aktif ve kapalı pozisyonları getir
   */
  async getAllPositions() {
    try {
      const { Position } = require('../db/db').models;
      
      // Aktif pozisyonları getir
      const activePositions = await Position.findAll({
        where: { isActive: true },
        order: [['createdAt', 'DESC']]
      });
      
      // Son 30 kapalı pozisyonu getir
      const closedPositions = await Position.findAll({
        where: { isActive: false },
        order: [['closedAt', 'DESC']],
        limit: 30
      });
      
      return {
        active: activePositions,
        closed: closedPositions
      };
    } catch (error) {
      logger.error(`Error getting all positions: ${error.message}`);
      return { active: [], closed: [] };
    }
  }
}



module.exports = OrderService;
