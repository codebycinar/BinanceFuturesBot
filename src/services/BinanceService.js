// services/BinanceService.js

const Binance = require('binance-api-node').default;
const config = require('../config/config');
const { validateApiCredentials } = require('../utils/validators');
const logger = require('../utils/logger');
const ti = require('technicalindicators'); // Teknik göstergeler için kütüphane
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');


class BinanceService {
  constructor() {
    validateApiCredentials(config.apiKey, config.apiSecret);

    this.client = Binance({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      futures: true, // Futures modunu etkinleştir
      useServerTime: true,
      recvWindow: 10000,
      //baseUrl: config.testnet ? 'https://testnet.binancefuture.com' : undefined // Testnet URL'si
    });

    this.positionSideMode = config.positionSideMode || 'One-Way'; // 'One-Way' veya 'Hedge'
    // Telegram Bot'u tanımla
    this.bot = new TelegramBot(config.telegramBotToken, { polling: false });
  }

  /**
* Borsada TRADING durumunda olan tüm sembolleri döndürür.
*/
  async scanAllSymbols() {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const tradingSymbols = exchangeInfo.symbols
        .filter(symbolInfo => symbolInfo.status === 'TRADING')
        .map(symbolInfo => symbolInfo.symbol);

      // Yalnızca USDT ile bitenler
      const usdtSymbols = tradingSymbols.filter(sym => sym.endsWith('USDT'));
      return usdtSymbols;
    } catch (error) {
      logger.error('Error fetching all symbols:', error);
      throw error;
    }
  }

  /**
   * 1m mumlarını alma
   */
  async getCandles(symbol, interval = '1h', limit = 100) {
    try {
      const candles = await this.client.futuresCandles({ symbol, interval, limit });
      return candles.map(c => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: c.closeTime,
      }))
        .filter(c => !isNaN(c.close));
    } catch (error) {
      logger.error(`Error fetching candles for ${symbol}:`, error);
      return [];
    }
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
   * Mevcut fiyatı alma
   */
  async getCurrentPrice(symbol) {
    try {
      const ticker = await this.client.futuresPrices({ symbol });
      return parseFloat(ticker[symbol]);
    } catch (error) {
      logger.error(`Error fetching current price for ${symbol}:`, error);
      throw error;
    }
  }

  /**
     * Market emri ile pozisyon açar (LONG -> BUY, SHORT -> SELL).
     */
  async placeMarketOrder({ symbol, side, quantity, positionSide }) {
    try {
      const orderData = {
        symbol,
        side,
        type: 'MARKET',
        quantity,
        positionSide,
      };

      logger.info(`Sending MARKET order to Binance:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error in Binance API MARKET order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Limit emri ile pozisyon açar (örn. LONG -> BUY, SHORT -> SELL).
   */
  /**
    * Limit emri ile pozisyon açar (örn. LONG -> BUY, SHORT -> SELL).
    */
  async placeLimitOrder(symbol, side, quantity, limitPrice, positionSide) {
    try {
      if (!this.exchangeInfo || !this.exchangeInfo[symbol]) {
        throw new Error(`Exchange info for ${symbol} not found.`);
      }
      const pricePrecision = this.getPricePrecision(symbol);
      const quantityPrecision = this.getQuantityPrecision(symbol);
      const stepSize = parseFloat(this.exchangeInfo[symbol].filters.LOT_SIZE.stepSize);
      const tickSize = parseFloat(this.exchangeInfo[symbol].filters.PRICE_FILTER.tickSize);

      const adjustedQuantity = parseFloat(quantity).toFixed(quantityPrecision);
      const adjustedPrice = parseFloat(limitPrice).toFixed(pricePrecision);

      if (adjustedQuantity <= 0 || adjustedQuantity % stepSize !== 0) {
        throw new Error(`Invalid quantity after adjustment: ${adjustedQuantity}`);
      }
      if (adjustedPrice % tickSize !== 0) {
        throw new Error(`Invalid price after adjustment: ${adjustedPrice}`);
      }

      const orderData = {
        symbol,
        side,
        type: 'LIMIT',
        price: adjustedPrice,
        quantity: adjustedQuantity,
        timeInForce: 'GTC',
        positionSide,
      };

      logger.info('Placing LIMIT order:', orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing limit order for ${symbol}:`, error.message);
      throw error;
    }
  }


  /**
   * Stop-Loss emri (Stop-Market) oluşturur. LONG pozisyon -> SELL, SHORT pozisyon -> BUY.
   */
  async placeStopLossOrder({ symbol, side, quantity, stopPrice, positionSide }) {
    try {
      // Get exchange info if not already loaded
      if (!this.exchangeInfo) {
        await this.getExchangeInfo();
      }
      
      // Get price and quantity precision for the symbol
      const pricePrecision = this.getPricePrecision(symbol);
      const quantityPrecision = this.getQuantityPrecision(symbol);
      
      // Adjust price according to tick size
      const tickSize = parseFloat(this.exchangeInfo[symbol].filters.PRICE_FILTER.tickSize);
      const stepSize = parseFloat(this.exchangeInfo[symbol].filters.LOT_SIZE.stepSize);
      
      // Properly round price to valid tick size increments
      const rawStopPrice = parseFloat(stopPrice);
      const tickSizeDecimals = (tickSize.toString().split('.')[1] || '').length;
      const roundedStopPrice = Math.floor(rawStopPrice / tickSize) * tickSize;
      const adjustedStopPrice = roundedStopPrice.toFixed(tickSizeDecimals);
      
      // Properly round quantity to valid step size increments
      const rawQuantity = parseFloat(quantity);
      const stepSizeDecimals = (stepSize.toString().split('.')[1] || '').length;
      const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;
      const adjustedQuantity = roundedQuantity.toFixed(stepSizeDecimals);
      
      logger.info(`Price precision for ${symbol}: ${pricePrecision}, Quantity precision: ${quantityPrecision}`);
      logger.info(`Raw price: ${rawStopPrice} -> Adjusted: ${adjustedStopPrice}, Raw quantity: ${rawQuantity} -> Adjusted: ${adjustedQuantity}`);
      
      const orderData = {
        symbol,
        side,
        type: 'STOP_MARKET',
        stopPrice: adjustedStopPrice,
        quantity: adjustedQuantity,
        positionSide
      };
      logger.info(`Placing Stop Loss order for ${symbol}:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing Stop Loss order for ${symbol}:`, error);
      throw error;
    }
  }

  // Take Profit Emiri
  async placeTakeProfitOrder({ symbol, side, quantity, stopPrice, positionSide }) {
    try {
      // Get exchange info if not already loaded
      if (!this.exchangeInfo) {
        await this.getExchangeInfo();
      }
      
      // Get price and quantity precision for the symbol
      const pricePrecision = this.getPricePrecision(symbol);
      const quantityPrecision = this.getQuantityPrecision(symbol);
      
      // Adjust price according to tick size
      const tickSize = parseFloat(this.exchangeInfo[symbol].filters.PRICE_FILTER.tickSize);
      const stepSize = parseFloat(this.exchangeInfo[symbol].filters.LOT_SIZE.stepSize);
      
      // Properly round price to valid tick size increments
      const rawStopPrice = parseFloat(stopPrice);
      const tickSizeDecimals = (tickSize.toString().split('.')[1] || '').length;
      const roundedStopPrice = Math.floor(rawStopPrice / tickSize) * tickSize;
      const adjustedStopPrice = roundedStopPrice.toFixed(tickSizeDecimals);
      
      // Properly round quantity to valid step size increments
      const rawQuantity = parseFloat(quantity);
      const stepSizeDecimals = (stepSize.toString().split('.')[1] || '').length;
      const roundedQuantity = Math.floor(rawQuantity / stepSize) * stepSize;
      const adjustedQuantity = roundedQuantity.toFixed(stepSizeDecimals);
      
      logger.info(`Price precision for ${symbol}: ${pricePrecision}, Quantity precision: ${quantityPrecision}`);
      logger.info(`Raw price: ${rawStopPrice} -> Adjusted: ${adjustedStopPrice}, Raw quantity: ${rawQuantity} -> Adjusted: ${adjustedQuantity}`);
      
      const orderData = {
        symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: adjustedStopPrice,
        quantity: adjustedQuantity,
        positionSide
      };
      logger.info(`Placing Take Profit order for ${symbol}:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing Take Profit order for ${symbol}:`, error);
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
        positionSide: positionSide
      };

      logger.info(`Placing TRAILING_STOP_MARKET order:`, orderData);
      return await this.client.futuresOrder(orderData);
    } catch (error) {
      logger.error(`Error placing trailing stop for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Market emriyle pozisyonu kapatır (örnek: LONG -> SELL).
   */
  /**
 * Market emriyle pozisyonu kapatır (örnek: LONG -> SELL).
 */
  async closePosition(symbol, side) {
    try {
      // Exchange bilgilerini kontrol et
      const exchangeInfo = await this.getExchangeInfo();
      const symbolInfo = exchangeInfo[symbol];
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found in exchange info`);
      }

      // Açık pozisyon bilgilerini al
      const openPositions = await this.getOpenPositions();
      const position = openPositions.find(pos => pos.symbol === symbol);

      if (!position) {
        throw new Error(`No open position found for ${symbol}`);
      }

      const positionSize = Math.abs(parseFloat(position.positionAmt));
      if (positionSize === 0) {
        throw new Error(`Position size for ${symbol} is zero.`);
      }

      // Pozisyon boyutunu hassasiyete göre ayarla
      const quantityPrecision = symbolInfo.quantityPrecision;
      const adjustedQuantity = positionSize.toFixed(quantityPrecision);

      // Mevcut fiyatı al
      const currentPrice = await this.getCurrentPrice(symbol);

      // Pozisyonun giriş fiyatını al
      const entryPrice = parseFloat(position.entryPrice);

      // Kar/Zarar hesaplama
      const profitLoss = (currentPrice - entryPrice) * positionSize * (side === 'SELL' ? 1 : -1); // Long için ters işlem
      const profitLossUSDT = profitLoss.toFixed(2); // USDT cinsinden yuvarlama

      // Satış işlemini gerçekleştir
      const order = await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity: adjustedQuantity
      });

      // Başarılı işlem detaylarını logla
      const successMessage = `
          ✅ Position Closed Successfully:
          - Symbol: ${symbol}
          - Side: ${side}
          - Quantity: ${adjustedQuantity}
          - Entry Price: ${entryPrice}
          - Close Price: ${currentPrice}
          - Profit/Loss: ${profitLossUSDT} USDT
          - Order ID: ${order.orderId || 'N/A'}
      `;
      
      // Sadece loglama yap, mesajı positionManager'dan gönderelim
      logger.info(successMessage);

      return order;
    } catch (error) {
      const errorMessage = `
          ❌ Error Closing Position:
          - Symbol: ${symbol}
          - Side: ${side}
          - Error: ${error.message}
      `;
      // Sadece loglama yap, mesajı positionManager'dan gönderelim
      logger.error(errorMessage);
      throw error;
    }
  }


  getPrecision(symbol) {
    if (!this.exchangeInfo || !this.exchangeInfo.symbols) {
      throw new Error('Exchange info is not loaded');
    }

    const symbolInfo = this.exchangeInfo.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    if (!lotSizeFilter) {
      throw new Error(`LOT_SIZE filter not found for ${symbol}`);
    }

    return parseFloat(lotSizeFilter.stepSize);
  }


  roundQuantity(quantity, stepSize) {
    const precision = Math.floor(Math.log10(1 / stepSize));
    return parseFloat(quantity.toFixed(precision));
  }

  async cancelOpenOrders(symbol) {
    try {
      // O sembol için açık olan tüm emirleri al
      const openOrders = await this.binanceService.getOpenOrders(symbol);

      // Tüm açık emirleri iptal et
      for (const order of openOrders) {
        if (order.reduceOnly) { // Sadece reduce-only emirleri iptal et
          await this.binanceService.client.futuresCancelOrder({
            symbol: symbol,
            orderId: order.orderId,
          });
          logger.info(`Cancelled order for ${symbol} with ID ${order.orderId}`);
        }
      }
    } catch (error) {
      logger.error(`Error cancelling open orders for ${symbol}:`, error);
    }
  }

  /**
   * ATR hesaplama fonksiyonu
   */
  async calculateATR(symbol, period, strategy = null) {
    try {
      // Strateji varsa onun tercih ettiği zaman dilimini kullan
      // yoksa config'den veya varsayılan olarak 1h'ı kullan
      let timeframe = '1h';
      
      if (strategy && strategy.preferredTimeframe) {
        timeframe = strategy.preferredTimeframe;
      } else if (this.parameters && this.parameters.timeframe) {
        timeframe = this.parameters.timeframe;
      } else if (config.strategy && config.strategy.timeframe) {
        timeframe = config.strategy.timeframe;
      }

      const candles = await this.getCandles(symbol, timeframe, period + 1);
      if (candles.length < period + 1) {
        logger.warn(`Not enough candles to calculate ATR for ${symbol} with timeframe ${timeframe}`);
        return undefined;
      }

      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const closes = candles.map(c => parseFloat(c.close));

      const atrArray = ti.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: period,
      });

      const atr = atrArray.length > 0 ? atrArray[atrArray.length - 1] : undefined;
      logger.info(`Calculated ATR for ${symbol}: ${atr}`, { timestamp: new Date().toISOString() });
      return atr;
    } catch (error) {
      logger.error(`Error calculating ATR for ${symbol}: ${error.message}`, { timestamp: new Date().toISOString() });
      return undefined;
    }
  }

  /**
   * ADX hesaplama fonksiyonu
   */
  async calculateADX(symbol, period) {
    try {
      const candles = await this.getCandles(symbol, '1m', period + 1);
      if (candles.length < period + 1) {
        logger.warn(`Not enough candles to calculate ADX for ${symbol}`);
        return undefined;
      }

      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const closes = candles.map(c => parseFloat(c.close));

      const adxArray = ti.ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: period,
      });

      const adx = adxArray.length > 0 ? adxArray[adxArray.length - 1].adx : undefined;
      return adx;
    } catch (error) {
      logger.error(`Error calculating ADX for ${symbol}:`, error.message);
      return undefined;
    }
  }

  /**
   * Binance futures cüzdan bakiyesini (örnek: USDT) döndürür.
   */
  async getFuturesBalance() {
    try {
      const balances = await this.client.futuresAccountBalance();
      const usdtBalance = balances.find(b => b.asset === 'USDT');
      return usdtBalance ? parseFloat(usdtBalance.availableBalance) : 0;
    } catch (error) {
      logger.error('Error getting futures balance:', error);
      throw error;
    }
  }

  async fetchExchangeInfo() {
    try {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
      this.exchangeInfo = response.data.symbols.reduce((acc, symbol) => {
        acc[symbol.symbol] = {
          pricePrecision: symbol.pricePrecision,
          quantityPrecision: symbol.quantityPrecision,
          filters: symbol.filters.reduce((filters, filter) => {
            filters[filter.filterType] = filter;
            return filters;
          }, {}),
        };
        return acc;
      }, {});
      logger.info('Exchange info fetched and parsed successfully.');
    } catch (error) {
      logger.error('Error fetching exchange info:', error.message);
      throw error;
    }
  }

  async getExchangeInfo() {
    if (!this.exchangeInfo) {
      await this.fetchExchangeInfo();
    }
    return this.exchangeInfo;
  }

  /**
   * Sembolün fiyat hassasiyetini döndürür.
   */
  getPricePrecision(symbol) {
    if (!this.exchangeInfo || !this.exchangeInfo[symbol]) {
      throw new Error(`Exchange info for ${symbol} not found.`);
    }
    return this.exchangeInfo[symbol].pricePrecision;
  }

  getQuantityPrecision(symbol) {
    if (!this.exchangeInfo || !this.exchangeInfo[symbol]) {
      throw new Error(`Exchange info for ${symbol} not found.`);
    }
    return this.exchangeInfo[symbol].quantityPrecision;
  }

  async getStepSize(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      if (!symbolInfo) {
        logger.error(`Symbol ${symbol} not found in exchange info.`);
        return '1'; // Varsayılan olarak 1
      }
      const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
      if (!lotSizeFilter) {
        logger.error(`LOT_SIZE filter not found for ${symbol}.`);
        return '1'; // Varsayılan olarak 1
      }
      logger.info(`Step Size for ${symbol}: ${lotSizeFilter.stepSize}`, { timestamp: new Date().toISOString() });
      return lotSizeFilter.stepSize;
    } catch (error) {
      logger.error(`Error fetching step size for ${symbol}: ${error.message}`, { timestamp: new Date().toISOString() });
      return '1'; // Varsayılan olarak 1
    }
  }


  /**
  * Verilen sayıyı, belirtilen hassasiyete (decimal) göre string'e çevirir.
  */
  adjustPrecision(value, stepSize) {
    const precision = Math.floor(Math.log10(1 / stepSize));
    const adjustedValue = Math.floor(value / stepSize) * stepSize; // Step size ile hizala
    return parseFloat(adjustedValue.toFixed(precision));
  }

  /**
   * Initialize fonksiyonu (eğer gerekiyorsa)
   */
  async initialize() {
    try {
      await this.fetchExchangeInfo();
      logger.info('BinanceService initialized with exchange info.');
    } catch (error) {
      logger.error('Error initializing BinanceService:', error.message);
      throw error;
    }
  }
}

module.exports = BinanceService;
