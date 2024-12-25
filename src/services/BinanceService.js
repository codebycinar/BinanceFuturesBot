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
      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity,
        positionSide,
      };

      logger.info(`Placing MARKET order:`, orderData);
      return await this.client.futuresOrder(orderData);
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

      const adjustedStopPrice = parseFloat(stopPrice).toFixed(pricePrecision);
      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'STOP_MARKET',
        quantity: adjustedQuantity,
        stopPrice: adjustedStopPrice,
        positionSide,
      };

      logger.info(`Placing STOP_MARKET order:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing stop loss order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Take-Profit emri (Take-Profit-Market) oluşturur. LONG pozisyon -> SELL, SHORT pozisyon -> BUY.
   */
  async placeTakeProfitOrder(symbol, side, quantity, price, positionSide) {
    try {
      const pricePrecision = await this.getPricePrecision(symbol);
      const quantityPrecision = await this.getQuantityPrecision(symbol);

      const adjustedPrice = parseFloat(price).toFixed(pricePrecision);
      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        quantity: adjustedQuantity,
        stopPrice: adjustedPrice, // Binance'da TAKE_PROFIT_MARKET için stopPrice kullanılır
        positionSide,
      };

      logger.info(`Placing TAKE_PROFIT_MARKET order:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing take profit order for ${symbol}:`, error);
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
      const accountInfo = await this.client.futuresAccount();
      const balance = accountInfo.assets.find(asset => asset.asset === 'USDT');
      return balance || { availableBalance: 0 };
    } catch (error) {
      logger.error('Error fetching futures balance:', error);
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
      return symbolInfo ? symbolInfo.pricePrecision : 2; // Varsayılan precision
    } catch (error) {
      logger.error(`Error fetching exchange info for ${symbol}:`, error);
      return 2; // Hata durumunda varsayılan precision
    }
  }

  /**
   * Sembolün miktar hassasiyetini döndürür.
   */
  async getQuantityPrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      return symbolInfo ? symbolInfo.quantityPrecision : 8; // Varsayılan precision
    } catch (error) {
      logger.error(`Error fetching exchange info for ${symbol}:`, error);
      return 8; // Hata durumunda varsayılan precision
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

  async getFuturesDailyStats() {
    try {
      // Bu, tüm futures pariteleri için 24h istatistiğini getirir
      const stats = await this.client.futuresDailyStats();
      return stats; // array of objects
    } catch (error) {
      logger.error('Error fetching futures daily stats:', error);
      throw error;
    }
  }

  /**
 * Trailing Stop Market emri ile dinamik stop eklemek.
 * callbackRate: 0.5 => %0.5 fiyat geri çekilmesi durumunda stop tetiklenir
 */
  async placeTrailingStopOrder(symbol, side, quantity, callbackRate, positionSide) {
    try {
      // 1) Sembolün quantityPrecision değerini alalım
      const quantityPrecision = await this.getQuantityPrecision(symbol);
      // 2) Miktarı bu precision’a göre ayarlayalım
      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);

      const orderData = {
        symbol,
        side,
        type: 'TRAILING_STOP_MARKET',
        quantity: adjustedQuantity,
        callbackRate: callbackRate.toString(),
        positionSide,
      };

      logger.info(`Placing TRAILING_STOP_MARKET order:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing trailing stop for ${symbol}:`, error);
      throw error;
    }
  }

  async getTop5SymbolsByVolatility() {
    try {
      // 1) Tüm sembolleri al
      const allSymbols = await this.getAllSymbols();
      // Yalnızca USDT ile bitenleri filtreleyin (ve isterseniz BTC, BUSD, vb. hariç)
      const usdtSymbols = allSymbols.filter(sym => sym.endsWith('USDT'));

      // 2) Her sembol için son 4 saatin mumlarını toplayıp volatilite hesapla
      // Örnek: 5m interval, 48 mum => 4 saat
      const results = [];
      for (const symbol of usdtSymbols) {
        try {
          const candles = await this.getCandles(symbol, '5m', 48); // 4 saat
          if (!candles || candles.length < 2) {
            continue;
          }
          // Kapanış fiyatlarını çıkaralım
          const closes = candles.map(c => parseFloat(c.close));
          const maxClose = Math.max(...closes);
          const minClose = Math.min(...closes);
          if (minClose === 0) {
            continue;
          }
          const volatilityPercent = ((maxClose - minClose) / minClose) * 100;
          results.push({ symbol, volatility: volatilityPercent });
        } catch (err) {
          // bir sembolde hata varsa geç
          logger.warn(`Skipping ${symbol} due to error: ${err.message}`);
        }
      }

      // 3) Azalan sıralama
      results.sort((a, b) => b.volatility - a.volatility);

      // 4) İlk 5'i al
      const top5 = results.slice(0, 5).map(item => item.symbol);

      return top5;
    } catch (error) {
      logger.error('Error calculating top5 by volatility:', error);
      return [];
    }
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

  async checkAndClosePositionsAndOrders() {
    try {
      const openPositions = await this.getOpenPositions(); // tüm açık pozisyonlar
      const positionSymbols = openPositions.map(pos => pos.symbol);
      const prices = await this.getPrices(openPositions.map(pos => pos.symbol));

      const allOpenOrders = await this.client.futuresOpenOrders();
      const unrelatedOrders = allOpenOrders.filter(order => !positionSymbols.includes(order.symbol));

      // İlgisiz emirleri iptal et
      for (const order of unrelatedOrders) {
        await this.client.futuresCancelOrder({ symbol: order.symbol, orderId: order.orderId });
        logger.info(`Cancelled unrelated order: ${order.symbol} (Order ID: ${order.orderId})`);
      }

      for (const position of openPositions) {
        const symbol = position.symbol;
        const entryPrice = parseFloat(position.entryPrice);
        const currentPrice = prices[symbol];
        const side = parseFloat(position.positionAmt) > 0 ? 'LONG' : 'SHORT';

        // LONG ise => Kar % = (currentPrice - entryPrice) / entryPrice * 100
        // SHORT ise => Kar % = (entryPrice - currentPrice) / entryPrice * 100
        let profitPercent = 0;
        if (side === 'LONG') {
          profitPercent = (currentPrice - entryPrice) / entryPrice * 100;
        } else {
          profitPercent = (entryPrice - currentPrice) / entryPrice * 100;
        }

        if (profitPercent >= 7) {
          // %7 kâra ulaşıldı => kapat
          const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
          const quantity = Math.abs(parseFloat(position.positionAmt));

          // Market emri ile kapat
          await this.closePosition(symbol, closeSide, quantity, side);
          logger.info(`Closed ${side} position for ${symbol} at +7% profit`);
        }
      }
    } catch (error) {
      logger.error('Error checking positions for +7% profit:', error);
    }
  }
}

module.exports = BinanceService;
