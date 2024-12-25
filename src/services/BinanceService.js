// services/BinanceService.js

const Binance = require('binance-api-node').default;
const config = require('../config/config');
const { validateApiCredentials } = require('../utils/validators');
const logger = require('../utils/logger');
const ti = require('technicalindicators'); // Teknik göstergeler için kütüphane

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
  async getCandles(symbol, interval = '1m', limit = 100) {
    try {
      const candles = await this.client.futuresCandles({ symbol, interval, limit });
      return candles.map(c => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: c.openTime
      }));
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
        positionSide: positionSide
      });
    } catch (error) {
      logger.error(`Error placing market order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Stop-Loss Emirini Yerleştirme
   */
  async placeStopLossOrder(symbol, side, quantity, stopPrice, positionSide) {
    try {
      await this.client.futuresOrder({
        symbol,
        side,
        type: 'STOP_MARKET',
        stopPrice,
        quantity,
        positionSide,
        reduceOnly: true
      });
    } catch (error) {
      logger.error(`Error placing stop-loss order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Take-Profit Emirini Yerleştirme
   */
  async placeTakeProfitOrder(symbol, side, quantity, takeProfitPrice, positionSide) {
    try {
      await this.client.futuresOrder({
        symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: takeProfitPrice,
        quantity,
        positionSide,
        reduceOnly: true
      });
    } catch (error) {
      logger.error(`Error placing take-profit order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Trailing Stop Emirini Yerleştirme
   */
  async placeTrailingStopOrder(symbol, side, quantity, callbackRate, positionSide) {
    try {
      await this.client.futuresOrder({
        symbol,
        side,
        type: 'TRAILING_STOP_MARKET',
        quantity,
        callbackRate,
        positionSide,
        reduceOnly: true
      });
    } catch (error) {
      logger.error(`Error placing trailing stop order for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * ATR hesaplama fonksiyonu
   */
  async calculateATR(symbol, period) {
    try {
      const candles = await this.getCandles(symbol, '1m', period + 1);
      if (candles.length < period + 1) {
        logger.warn(`Not enough candles to calculate ATR for ${symbol}`);
        return undefined; // undefined döndürmek daha doğru olabilir
      }

      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      const closes = candles.map(c => parseFloat(c.close));

      const atrArray = ti.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: period
      });

      const atr = atrArray.length > 0 ? atrArray[atrArray.length - 1] : undefined;
      return atr;
    } catch (error) {
      logger.error(`Error calculating ATR for ${symbol}:`, error);
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
        period: period
      });

      const adx = adxArray.length > 0 ? adxArray[adxArray.length - 1].adx : undefined;
      return adx;
    } catch (error) {
      logger.error(`Error calculating ADX for ${symbol}:`, error);
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
      return usdtBalance || { availableBalance: '0' };
    } catch (error) {
      logger.error('Error getting futures balance:', error);
      throw error;
    }
  }

  /**
   * Miktar hassasiyetini alma
   */
  async getQuantityPrecision(symbol) {
    try {
      const exchangeInfo = await this.client.futuresExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
      return symbolInfo.quantityPrecision;
    } catch (error) {
      logger.error(`Error fetching quantity precision for ${symbol}:`, error);
      return 2; // Varsayılan hassasiyet
    }
  }

  /**
  * Verilen sayıyı, belirtilen hassasiyete (decimal) göre string'e çevirir.
  */
  adjustPrecision(value, precision) {
    return parseFloat(value).toFixed(precision);
  }

  /**
   * Initialize fonksiyonu (eğer gerekiyorsa)
   */
  async initialize() {
    // Gerekli başlangıç işlemlerini burada yapabilirsiniz
    // Örneğin, bazı göstergeler için başlangıç verisi yükleme vb.
  }
}

module.exports = BinanceService;
