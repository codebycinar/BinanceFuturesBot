const Binance = require('binance-api-node').default;
const config = require('../config/config');
const { validateApiCredentials } = require('../utils/validators');
const logger = require('../utils/logger');
const axios = require('axios');
const crypto = require('crypto');

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

    this.positionSideMode = 'Hedge';
  }

  /**
   * Binance tarafında One-Way mi, Hedge mi kullanılacağını öğrenir.
   */
  async initialize() {
    this.positionSideMode = 'Hedge';
  }

  async fetchPositionSideDual() {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', config.apiSecret)
      .update(queryString)
      .digest('hex');

    const url = `https://fapi.binance.com/fapi/v1/positionSide/dual?${queryString}&signature=${signature}`;

    const headers = { 'X-MBX-APIKEY': config.apiKey };

    const { data } = await axios.get(url, { headers });
    // data => { dualSidePosition: true/false }
    return data;
  }


  /**
   * Mevcut açık futures pozisyonlarını getirir.
   */
  async getOpenPositions() {
    try {
      const positions = await this.client.futuresPositionRisk();
      return positions.filter(position => parseFloat(position.positionAmt) !== 0);
    } catch (error) {
      logger.error('Error fetching open positions:', error);
      throw error;
    }
  }

  /**
   * Tüm açık emirleri (futures) getirir.
   */
  async getOpenOrders(symbol) {
    try {
      return await this.client.futuresOpenOrders({ symbol });
    } catch (error) {
      logger.error('Error fetching open orders:', error);
      throw error;
    }
  }

  /**
   * Market emri ile pozisyon açar (LONG -> BUY, SHORT -> SELL).
   */
  async placeMarketOrder(symbol, side, quantity, positionSide) {
    try {
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

      logger.info(`Placing MARKET order:
        Symbol: ${symbol}
        Side: ${side}
        Position Side: ${positionSide}
        Quantity: ${adjustedQuantity}
      `);

      return await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity.toString(),
        // Hedge modundaysak positionSide göndeririz
        positionSide: this.positionSideMode === 'Hedge' ? positionSide : undefined
      });
    } catch (error) {
      logger.error(`Error placing market order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Limit emri ile pozisyon açar (örn. LONG -> BUY, SHORT -> SELL).
   */
  async placeLimitOrder(symbol, side, quantity, limitPrice, positionSide) {
    try {
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      const pricePrecision = await this.getPricePrecision(symbol);
  
      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);
      const adjustedPrice = parseFloat(limitPrice).toFixed(pricePrecision);
  
      // Artık "this.positionSideMode === 'Hedge' ? positionSide : undefined" yok
      // Direk positionSide'ı gönderiyoruz:
      const orderData = {
        symbol,
        side,
        type: 'LIMIT',
        price: adjustedPrice.toString(),
        quantity: adjustedQuantity.toString(),
        timeInForce: 'GTC',
        positionSide, // => ÖNEMLİ: Burada 'LONG' veya 'SHORT' gelecek
      };
  
      logger.info(`Placing LIMIT order:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing limit order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Stop-Loss emri (Stop-Market) oluşturur. LONG pozisyon -> SELL, SHORT pozisyon -> BUY.
   */
  async placeStopLossOrder(symbol, side, quantity, stopPrice, positionSide) {
    try {
      const pricePrecision = await this.getPricePrecision(symbol);
      const quantityPrecision = await this.getQuantityPrecision(symbol);

      const adjustedStopPrice = this.adjustPrecision(stopPrice, pricePrecision);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'STOP_MARKET',
        stopPrice: adjustedStopPrice.toString(),
        quantity: adjustedQuantity.toString()
      };

      // Hedge modundaysak positionSide ve reduceOnly ayarı
      if (this.positionSideMode === 'Hedge') {
        orderData.positionSide = positionSide;
      }

      logger.info(`Placing STOP_MARKET order (Stop-Loss) for ${symbol}:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing stop loss for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Take-Profit emri (Take-Profit-Market) oluşturur. LONG pozisyon -> SELL, SHORT pozisyon -> BUY.
   */
  async placeTakeProfitOrder(symbol, side, quantity, takeProfitPrice, positionSide) {
    try {
      const pricePrecision = await this.getPricePrecision(symbol);
      const quantityPrecision = await this.getQuantityPrecision(symbol);

      const adjustedTPPrice = this.adjustPrecision(takeProfitPrice, pricePrecision);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: adjustedTPPrice.toString(),
        quantity: adjustedQuantity.toString()
      };

      // Hedge modundaysak positionSide ve reduceOnly ayarı
      if (this.positionSideMode === 'Hedge') {
        orderData.positionSide = positionSide;
      }

      logger.info(`Placing TAKE_PROFIT_MARKET order for ${symbol}:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing take profit for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Market emriyle pozisyonu kapatır (örnek: LONG -> SELL).
   */
  async closePosition(symbol, side, quantity, positionSide) {
    try {
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      const adjustedQuantity = this.adjustPrecision(quantity, quantityPrecision);

      logger.info(`Closing position for ${symbol}:
        Side: ${side}
        Position Side: ${positionSide}
        Quantity: ${adjustedQuantity}
      `);

      return await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity.toString(),
        positionSide: this.positionSideMode === 'Hedge' ? positionSide : undefined,
        reduceOnly: true
      });
    } catch (error) {
      logger.error(`Error closing position for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Binance futures cüzdan bakiyesini (örnek: USDT) döndürür.
   */
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

  /**
   * Belirli sembol için mum verilerini döndürür.
   */
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
      throw error;
    }
  }

  /**
   * Sembolün fiyat hassasiyetini döndürür.
   */
  async getPricePrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found`);
      }
      return symbolInfo.pricePrecision;
    } catch (error) {
      logger.error(`Error fetching price precision for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Sembolün miktar hassasiyetini döndürür.
   */
  async getQuantityPrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found`);
      }
      return symbolInfo.quantityPrecision;
    } catch (error) {
      logger.error(`Error fetching quantity precision for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Verilen sayıyı, belirtilen hassasiyete (decimal) göre string'e çevirir.
   */
  adjustPrecision(value, precision) {
    return parseFloat(value).toFixed(precision);
  }

  /**
   * Borsada TRADING durumunda olan tüm sembolleri döndürür.
   */
  async getAllSymbols() {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      return exchangeInfo.symbols
        .filter(symbolInfo => symbolInfo.status === 'TRADING')
        .map(symbolInfo => symbolInfo.symbol);
    } catch (error) {
      logger.error('Error fetching all symbols:', error);
      throw error;
    }
  }

  /**
   * Bir dizi sembolün son kapanış (1m) fiyatlarını topluca döndürür.
   */
  async getPrices(symbols) {
    const prices = {};
    await Promise.all(
      symbols.map(async symbol => {
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

  /**
   * Aktif pozisyonu olmayan emirleri iptal eder (isteğe bağlı).
   */
  async cancelUnrelatedOrders() {
    try {
      const openPositions = await this.getOpenPositions();
      const positionSymbols = openPositions.map(pos => pos.symbol);

      const allOpenOrders = await this.client.futuresOpenOrders();
      const unrelatedOrders = allOpenOrders.filter(order => !positionSymbols.includes(order.symbol));

      for (const order of unrelatedOrders) {
        await this.client.futuresCancelOrder({ symbol: order.symbol, orderId: order.orderId });
        logger.info(`Cancelled unrelated order: ${order.symbol} (Order ID: ${order.orderId})`);
      }
    } catch (error) {
      logger.error('Error cancelling unrelated orders:', error);
    }
  }
}

module.exports = BinanceService;
