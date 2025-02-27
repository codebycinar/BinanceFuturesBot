// services/BinanceService.js

const Binance = require('binance-api-node').default;
const config = require('../config/config');
const { validateApiCredentials } = require('../utils/validators');
const logger = require('../utils/logger');
const ti = require('technicalindicators'); // Teknik göstergeler için kütüphane
const axios = require('axios');


class BinanceService {
  constructor() {
    validateApiCredentials(config.apiKey, config.apiSecret);
    this.leverage = config.leverage || 5;
    this.client = Binance({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      futures: true, // Futures modunu etkinleştir
      useServerTime: true,
      recvWindow: 10000,
      //baseUrl: config.testnet ? 'https://testnet.binancefuture.com' : undefined // Testnet URL'si
    });

    this.positionSideMode = config.positionSideMode || 'One-Way'; // 'One-Way' veya 'Hedge'
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
   * Timeframe mumlarını alma
   */
  async getCandles(symbol, interval = '1h', limit = 100) {
    try {
      const candles = await this.client.futuresCandles({ symbol, interval, limit });

      const validCandles = candles.map(c => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: c.closeTime,
      })).filter(c => !isNaN(c.close));

      if (validCandles.length < limit) {
        logger.warn(`Insufficient candles fetched for ${symbol}: ${validCandles.length}/${limit}`);
      }

      return validCandles;
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

  async setLeverage(symbol, leverage = this.leverage) {
    try {
      await this.client.futuresLeverage({
        symbol: symbol,
        leverage: leverage
      });
      logger.info(`${symbol} için kaldıraç ${leverage}x olarak ayarlandı`);
    } catch (error) {
      logger.error(`${symbol} kaldıraç ayarlama hatası:`, error);
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

  async placeStopLossOrder({ symbol, side, quantity, stopPrice, positionSide }) {
    try {
      const orderData = {
        symbol,
        side,
        type: 'STOP_MARKET',
        stopPrice: stopPrice.toString(),
        quantity: quantity.toString(),
        positionSide
      };
      console.log(`Stop Loss emri yerleştiriliyor: ${symbol}`, orderData);
      return await this.client.futuresOrder(orderData); // Düzeltildi: this.binanceService.client -> this.client
    } catch (error) {
      console.error(`Stop Loss emri hatası (${symbol}):`, error);
      throw error;
    }
  }

  async placeTakeProfitOrder({ symbol, side, quantity, stopPrice, positionSide }) {
    try {
      const orderData = {
        symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: stopPrice.toString(),
        quantity: quantity.toString(),
        positionSide
      };
      console.log(`Take Profit emri yerleştiriliyor: ${symbol}`, orderData);
      return await this.client.futuresOrder(orderData); // Düzeltildi: this.binanceService.client -> this.client
    } catch (error) {
      console.error(`Take Profit emri hatası (${symbol}):`, error);
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
      const positionSide = side === 'BUY' ? 'SHORT' : 'LONG'; // Hedge moduna göre ayarla
      const quantity = await this.getPositionSize(symbol); // Mevcut pozisyon boyutunu al

      return await this.client.futuresOrder({
        symbol,
        side,
        type: 'MARKET',
        quantity,
        positionSide,
        reduceOnly: true
      });
    } catch (error) {
      logger.error(`Pozisyon kapatma hatası (${symbol}):`, error);
      throw error;
    }
  }

  /**
   * ATR hesaplama fonksiyonu
   */
  async calculateATR(symbol, period) {
    try {
      // Strateji parametrelerinden timeframe değerini al
      const timeframe = this.parameters && this.parameters.donchiantimeframe ? this.parameters.donchiantimeframe : '1d';


      const candles = await this.getCandles(symbol, timeframe, period + 1);
      if (!candles || candles.length < period + 1) {
        logger.warn(`No candles returned for ${symbol} in ATR calculation`);
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

  async calculateDonchianChannels(symbol, period, timeframe = '1d') {
    try {
      const candles = await this.getCandles(symbol, timeframe, period + 1);
      if (!candles || candles.length === 0) {
        logger.warn(`No candles returned for ${symbol} in Donchian calculation`);
        return { upper: null, lower: null };
      }

      if (candles.length < period) {
        logger.warn(`Not enough candles for Donchian Channels for ${symbol}: ${candles.length}/${period}`);
        return { upper: null, lower: null };
      }
      const highs = candles.slice(-period).map(c => parseFloat(c.high));
      const lows = candles.slice(-period).map(c => parseFloat(c.low));

      if (highs.length === 0 || lows.length === 0) {
        logger.warn(`No valid high/low values for Donchian Channels for ${symbol}`);
        return { upper: null, lower: null };
      }
      const upper = Math.max(...highs);
      const lower = Math.min(...lows);

      logger.info(`Donchian Kanalları (${symbol}):`, {
        upper: upper.toFixed(4),
        lower: lower.toFixed(4),
        period: period,
        candlesUsed: candles.length
      });
      return { upper, lower };
    } catch (error) {
      logger.error(`Error calculating Donchian Channels for ${symbol}:`, error);
      return { upper: null, lower: null };
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
