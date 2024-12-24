const Binance = require('binance-api-node').default;
const config = require('../config/config');
const { validateApiCredentials } = require('../utils/validators');
const logger = require('../utils/logger');

class BinanceService {
  constructor() {
    validateApiCredentials(config.apiKey, config.apiSecret);

    this.client = Binance({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      futures: true,
      useServerTime: true,
      recvWindow: 10000
    });

    this.positionSideMode = null;
  }

  async initialize() {
    this.positionSideMode = await this.checkPositionSideMode();
  }

  async getOpenPositions() {
    try {
      const positions = await this.client.futuresPositionRisk();
      return positions.filter(position => parseFloat(position.positionAmt) !== 0); // Pozisyonu açık olanlar
    } catch (error) {
      logger.error('Error fetching open positions:', error);
      throw error;
    }
  }

  async manageOpenPositions() {
    try {
      const openPositions = await this.getOpenPositions();
      logger.info(`Managing ${openPositions.length} open positions.`);
  
      const prices = await this.getPrices(openPositions.map(p => p.symbol));
      logger.info('Fetched prices for all open positions.');
  
      for (const position of openPositions) {
        const currentPrice = parseFloat(prices[position.symbol]);
        const entryPrice = parseFloat(position.entryPrice);
        const positionAmt = parseFloat(position.positionAmt);
        const side = positionAmt > 0 ? 'LONG' : 'SHORT';
  
        logger.info(`Processing ${position.symbol}: 
          Entry Price: ${entryPrice}, 
          Current Price: ${currentPrice}, 
          Position Amount: ${positionAmt}, 
          Side: ${side}`);
  
        if (!entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
          logger.error(`Invalid entry price for ${position.symbol}: ${entryPrice}`);
          continue;
        }
  
        if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
          logger.error(`Invalid current price for ${position.symbol}: ${currentPrice}`);
          continue;
        }
  
        const stopLoss = side === 'LONG'
          ? entryPrice * (1 - config.stopLossPercentage)
          : entryPrice * (1 + config.stopLossPercentage);
  
        const takeProfit = side === 'LONG'
          ? entryPrice * (1 + config.takeProfitPercentage)
          : entryPrice * (1 - config.takeProfitPercentage);
  
        if (isNaN(stopLoss) || isNaN(takeProfit)) {
          logger.error(`Failed to calculate stop loss or take profit for ${position.symbol}. 
            Entry Price: ${entryPrice}, 
            Current Price: ${currentPrice}`);
          continue;
        }
  
        const pricePrecision = await this.getPricePrecision(position.symbol);
        const adjustedStopLoss = parseFloat(stopLoss.toFixed(pricePrecision));
        const adjustedTakeProfit = parseFloat(takeProfit.toFixed(pricePrecision));
  
        logger.info(`Calculated levels for ${position.symbol}: 
          Adjusted Stop Loss: ${adjustedStopLoss}, 
          Adjusted Take Profit: ${adjustedTakeProfit}`);
  
        const minPriceMovement = 1 / Math.pow(10, pricePrecision);
  
        if (Math.abs(entryPrice - adjustedStopLoss) < minPriceMovement || 
            Math.abs(entryPrice - adjustedTakeProfit) < minPriceMovement) {
          logger.error(`Price movement too small for ${position.symbol}. 
            Entry Price: ${entryPrice}, 
            Stop Loss: ${adjustedStopLoss}, 
            Take Profit: ${adjustedTakeProfit}`);
          continue;
        }
  
        // Eksik emirleri tamamla
        const existingStopLoss = position.stopLoss;
        const existingTakeProfit = position.takeProfit;
  
        if (!existingStopLoss) {
          await this.placeStopLossOrder(
            position.symbol,
            side === 'LONG' ? 'SELL' : 'BUY',
            Math.abs(positionAmt),
            adjustedStopLoss,
            side
          );
          logger.info(`Stop Loss set for ${position.symbol}: ${adjustedStopLoss}`);
        }
  
        if (!existingTakeProfit) {
          await this.placeTakeProfitOrder(
            position.symbol,
            side === 'LONG' ? 'SELL' : 'BUY',
            Math.abs(positionAmt),
            adjustedTakeProfit,
            side
          );
          logger.info(`Take Profit set for ${position.symbol}: ${adjustedTakeProfit}`);
        }
      }
    } catch (error) {
      logger.error('Error managing open positions:', error);
    }
  }
  
  

  async closePosition(symbol, side, quantity) {
    try {
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);
  
      logger.info(`Closing position for ${symbol}:
        Side: ${side}
        Quantity: ${adjustedQuantity}`);
  
      return await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity.toString(),
      });
    } catch (error) {
      logger.error(`Error closing position for ${symbol}:`, error);
      throw error;
    }
  }
  
  
  async getFuturesBalance() {
    try {
      const balances = await this.client.futuresAccountBalance();
      const usdtBalance = balances.find(b => b.asset === 'USDT');
      return usdtBalance || { availableBalance: '0' };
    } catch (error) {
      logger.error('Error getting futures balance:', error);
      throw error;
    }
  }

  async getCandles(symbol, interval, limit = 100) {
    try {
      const candles = await this.client.futuresCandles({
        symbol,
        interval,
        limit
      });
      return candles;
    } catch (error) {
      logger.error(`Error getting candles for ${symbol} at ${interval}:`, error);
      logger.error('Candle request failed, details:', { symbol, interval, limit });
      throw error;
    }
  }
  
  

  adjustPrecision(value, precision) {
    return parseFloat(value).toFixed(precision);
  }

  async openPosition(symbol, side, quantity, positionSide) {
    try {
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

      logger.info(`Placing market order for ${symbol}:
        Side: ${side}
        Quantity: ${adjustedQuantity}
        Position Side: ${positionSide}`);

      return await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity.toString(),
        positionSide
      });
    } catch (error) {
      logger.error(`Error opening position for ${symbol}:`, error);
      throw error;
    }
  }

  addReduceOnly(orderData, side, positionSide) {
    if ((side === 'SELL' && positionSide === 'LONG') || (side === 'BUY' && positionSide === 'SHORT')) {
      orderData.reduceOnly = true;
    }
    return orderData;
  }

  cleanOrderData(orderData) {
    // Gereksiz parametreleri temizle
    if (orderData.type === 'TAKE_PROFIT_MARKET' || orderData.type === 'STOP_MARKET') {
      delete orderData.reduceOnly;
    }
    return orderData;
  }
  

  async placeStopLossOrder(symbol, side, quantity, stopPrice, positionSide) {
  try {
    const pricePrecision = await this.getPricePrecision(symbol);
    const quantityPrecision = await this.getQuantityPrecision(symbol);

    const adjustedStopPrice = this.adjustPrecision(stopPrice, pricePrecision);
    const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

    // STOP_MARKET emri için gerekli veriler
    const orderData = {
      symbol,
      side,
      type: 'STOP_MARKET',
      quantity: adjustedQuantity.toString(),
      stopPrice: adjustedStopPrice.toString(),
      positionSide,
    };

    // `reduceOnly` sadece pozisyon kapatma durumunda gönderilmeli
    if ((side === 'SELL' && positionSide === 'SHORT') || (side === 'BUY' && positionSide === 'LONG')) {
      orderData.reduceOnly = true;
    }

    logger.info(`Placing stop loss for ${symbol}:`, orderData);

    return await this.client.futuresOrder(orderData);
  } catch (error) {
    logger.error(`Error placing stop loss for ${symbol}:`, error);
    throw error;
  }
}

async placeTakeProfitOrder(symbol, side, quantity, price, positionSide) {
  try {
    const pricePrecision = await this.getPricePrecision(symbol);
    const quantityPrecision = await this.getQuantityPrecision(symbol);

    const adjustedPrice = this.adjustPrecision(price, pricePrecision);
    const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

    // TAKE_PROFIT_MARKET emri için gerekli parametreler
    const orderData = {
      symbol,
      side,
      type: 'TAKE_PROFIT_MARKET',
      quantity: adjustedQuantity.toString(),
      stopPrice: adjustedPrice.toString(),
      positionSide,
      reduceOnly: true, // İlk olarak eklenebilir
    };
    
    this.cleanOrderData(orderData); // Gereksiz parametreleri kaldırır

    // `reduceOnly` parametresini kaldırın
    logger.info(`Placing take profit for ${symbol}:`, orderData);

    return await this.client.futuresOrder(orderData);
  } catch (error) {
    logger.error(`Error placing take profit for ${symbol}:`, error);
    throw error;
  }
}



  async getPrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);
      return symbolInfo.pricePrecision; // Stop price hassasiyet bilgisi
    } catch (error) {
      logger.error(`Error fetching precision for ${symbol}:`, error);
      throw error;
    }
  }

  async getPricePrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);
      return symbolInfo.pricePrecision; // Fiyat hassasiyeti
    } catch (error) {
      logger.error(`Error fetching price precision for ${symbol}:`, error);
      throw error;
    }
  }

  async getQuantityPrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);
      return symbolInfo.quantityPrecision; // Miktar hassasiyeti
    } catch (error) {
      logger.error(`Error fetching quantity precision for ${symbol}:`, error);
      throw error;
    }
  }

  async getAllSymbols() {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      return exchangeInfo.symbols
        .filter(symbolInfo => symbolInfo.status === 'TRADING') // Yalnızca aktif işlem çiftleri
        .map(symbolInfo => symbolInfo.symbol);
    } catch (error) {
      logger.error('Error fetching all symbols:', error);
      throw error;
    }
  }
  

  async checkAndClosePositions() {
    try {
      const activePositions = this.positionManager.getActivePositions(); // Aktif pozisyonları al
      const prices = await this.getPrices(activePositions.map(p => p.symbol)); // Fiyatları çek

      for (const position of activePositions) {
        const currentPrice = prices[position.symbol];
        if (!currentPrice) continue;

        if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
          // Stop Loss seviyesi tetiklendi
          await this.closePosition(position.symbol, 'SELL', position.quantity);
          logger.info(`Closed LONG position for ${position.symbol} at Stop Loss level: ${currentPrice}`);
        } else if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
          // Take Profit seviyesi tetiklendi
          await this.closePosition(position.symbol, 'SELL', position.quantity);
          logger.info(`Closed LONG position for ${position.symbol} at Take Profit level: ${currentPrice}`);
        } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
          // Stop Loss seviyesi tetiklendi
          await this.closePosition(position.symbol, 'BUY', position.quantity);
          logger.info(`Closed SHORT position for ${position.symbol} at Stop Loss level: ${currentPrice}`);
        } else if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
          // Take Profit seviyesi tetiklendi
          await this.closePosition(position.symbol, 'BUY', position.quantity);
          logger.info(`Closed SHORT position for ${position.symbol} at Take Profit level: ${currentPrice}`);
        }
      }
    } catch (error) {
      logger.error('Error checking and closing positions:', error);
    }
  }


  async checkPositionSideMode() {
    try {
      const result = await this.client.futuresPositionSideDual();
      this.positionSideMode = result.dualSidePosition ? 'Hedge' : 'One-Way';
      logger.info(`Position Side Mode: ${this.positionSideMode}`);
      return this.positionSideMode;
    } catch (error) {
      logger.error('Error checking position side mode:', error);
      throw error;
    }
  }

  async cancelUnrelatedOrders() {
    try {
      const openPositions = await this.getOpenPositions(); // Açık pozisyonları al
      const positionSymbols = openPositions.map(pos => pos.symbol); // Pozisyonları olan işlem çiftleri
  
      const allOpenOrders = await this.client.futuresOpenOrders(); // Açık emirleri al
      const unrelatedOrders = allOpenOrders.filter(order => !positionSymbols.includes(order.symbol)); // Pozisyonu olmayan emirler
  
      for (const order of unrelatedOrders) {
        await this.client.futuresCancelOrder({ symbol: order.symbol, orderId: order.orderId });
        logger.info(`Cancelled unrelated order: ${order.symbol} (Order ID: ${order.orderId})`);
      }
    } catch (error) {
      logger.error('Error cancelling unrelated orders:', error);
    }
  }
  

  async getPrices(symbols) {
    const prices = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const candles = await this.getCandles(symbol, '1m', 1);
          prices[symbol] = parseFloat(candles[0].close);
        } catch (error) {
          logger.error(`Error fetching price for ${symbol}:`, error);
        }
      })
    );
    return prices;
  }
  
}


module.exports = BinanceService;