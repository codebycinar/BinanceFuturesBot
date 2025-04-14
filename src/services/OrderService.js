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
      // Exchange info'yu kontrol edelim
      await this.binanceService.getExchangeInfo();
      const quantityPrecision = this.binanceService.getQuantityPrecision(symbol);
      
      // Step size değerini direkt olarak Exchange Info'dan alalım (eğer mevcutsa)
      let stepSize = '1';
      try {
        if (this.binanceService.exchangeInfo[symbol] && 
            this.binanceService.exchangeInfo[symbol].filters && 
            this.binanceService.exchangeInfo[symbol].filters.LOT_SIZE) {
          stepSize = parseFloat(this.binanceService.exchangeInfo[symbol].filters.LOT_SIZE.stepSize);
        } else {
          // Eğer LOT_SIZE filtresi bulunamazsa, API'den step size'ı almayı deneyelim
          stepSize = await this.binanceService.getStepSize(symbol);
        }
      } catch (error) {
        logger.warn(`Error getting step size from exchange info for ${symbol}, using default: ${error.message}`);
        // Varsayılan değeri kullan
        stepSize = '1';
      }

      // Miktarı ayarla
      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);

      // Eğer adjustedQuantity 0'dan küçükse veya uyumsuzsa hata ver
      if (adjustedQuantity <= 0) {
        throw new Error(`Invalid quantity after adjustment: ${adjustedQuantity}`);
      }

      // Hedge modunu hesaba katarak pozisyon tarafını belirleme
      const finalPositionSide = config.positionSideMode === 'Hedge' ? positionSide : undefined;
      
      logger.info(`Placing MARKET order:
        - Symbol: ${symbol}
        - Side: ${side}
        - Quantity: ${adjustedQuantity}
        - Position Side: ${finalPositionSide || 'One-Way (Default)'}
        - Position Side Mode: ${config.positionSideMode}
      `);
      
      // BinanceService üzerinden doğrudan market emri verme
      return await this.binanceService.placeMarketOrder({
        symbol,
        side, 
        quantity: adjustedQuantity,
        positionSide: finalPositionSide
      });
    } catch (error) {
      logger.error(`Error in MARKET order for ${symbol}:`, error.message);
      if (error.response && error.response.data) {
        logger.error(`API error details: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }


  async calculateOrderQuantity(allocation, price) {
    try {
      // Pozisyon büyüklüğünü belirle
      let usdtAmount;
      
      if (allocation > 0) {
        // Eğer allocation verilmişse, direkt kullan
        usdtAmount = allocation;
      } else {
        // Hesaplama türüne göre USDT miktarını belirle
        if (config.calculate_position_size) {
          // Dinamik hesaplama - Bakiye * risk oranı
          const balance = await this.binanceService.getFuturesBalance();
          usdtAmount = balance * config.riskPerTrade;
        } else {
          // Sabit değeri kullan
          usdtAmount = config.static_position_size;
        }
      }
  
      // USDT miktarını koin miktarına çevir
      const quantity = usdtAmount / price;
  
      // Minimum notional kontrolü
      const notional = quantity * price;
      const minNotional = 5; // Binance için minimum işlem büyüklüğü
      if (notional < minNotional) {
        logger.warn(`Calculated notional (${notional}) is below minimum. USDT amount: ${usdtAmount}, Price: ${price}`);
        return 0; // Minimum notional sağlanmıyorsa işlem yapmayın
      }
  
      logger.info(`Calculated order quantity: ${quantity} for USDT amount: ${usdtAmount}, price: ${price}`);
      return quantity;
    } catch (error) {
      logger.error(`Error calculating order quantity: ${error.message}`);
      return 0;
    }
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

    try {
      let usdtAmount;
      
      if (!calculate_position_size) {
        // Sabit pozisyon büyüklüğü kullan
        usdtAmount = static_position_size;
        logger.info(`Using static position size (${static_position_size} USDT) for ${symbol}`);
      } else {
        // Dinamik hesaplama - Bakiyenin riskPerTrade yüzdesini kullan
        const balance = await this.binanceService.getFuturesBalance();
        usdtAmount = balance * config.riskPerTrade;
        logger.info(`Using dynamic position size (${config.riskPerTrade * 100}% of ${balance} = ${usdtAmount} USDT) for ${symbol}`);
      }
      
      // USDT miktarını koin miktarına çevir
      const quantity = usdtAmount / currentPrice;
      
      // Sembol için adım büyüklüğüne göre ayarla
      const stepSize = await this.binanceService.getStepSize(symbol);
      const adjustedQuantity = this.binanceService.adjustPrecision(quantity, stepSize);
      
      // Minimum işlem büyüklüğü kontrolü
      const notional = adjustedQuantity * currentPrice;
      const minNotional = 5; // Binance'in minimum işlem büyüklüğü
      
      if (notional < minNotional) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below the minimum (${minNotional} USDT).`);
        return 0; // Minimum notional sağlanmıyorsa işlem yapmayın
      }
      
      logger.info(`Calculated quantity for ${symbol}: ${adjustedQuantity} (${usdtAmount} USDT at price ${currentPrice})`);
      return adjustedQuantity;
    } catch (error) {
      logger.error(`Error calculating position size for ${symbol}:`, error);
      return 0;
    }
  }

  async calculateStaticPositionSize(symbol, allocation) {
    try {
      // Pozisyon büyüklüğünü belirleme
      if (allocation <= 0) {
        if (!config.calculate_position_size) {
          // Eğer allocation geçersizse ve hesaplama kapalıysa, config'den statik değeri kullan
          allocation = config.static_position_size;
        } else {
          // Dinamik hesaplama için balance * riskPerTrade kullan
          const balance = await this.binanceService.getFuturesBalance();
          allocation = balance * config.riskPerTrade;
        }
      }
      
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      if (!currentPrice || allocation <= 0) {
        logger.warn(`Invalid data for position size calculation: Price=${currentPrice}, Allocation=${allocation}`);
        return 0;
      }

      // USDT miktarını koin miktarına çevir (kaldıraç kullanmadan)
      const positionSize = allocation / currentPrice;

      const stepSize = await this.binanceService.getStepSize(symbol);
      const roundedPositionSize = this.binanceService.roundQuantity(positionSize, stepSize);

      // Minimum notional kontrolü
      const notional = roundedPositionSize * currentPrice;
      const minNotional = 5; // Binance minimum işlem büyüklüğü
      if (notional < minNotional) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below minimum (${minNotional} USDT).`);
        return 0;
      }

      logger.info(`Calculated position size for ${symbol}: ${roundedPositionSize} (${allocation} USDT at price ${currentPrice})`);
      return roundedPositionSize;
    } catch (error) {
      logger.error(`Error calculating position size for ${symbol}: ${error.message}`);
      return 0;
    }
  }




  async getMinNotional(symbol) {
    const exchangeInfo = await this.client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
    const notionalFilter = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
    return notionalFilter ? parseFloat(notionalFilter.minNotional) : 5; // Varsayılan değer
  }
  
  /**
   * Stop-Loss emri (Stop-Market) oluşturur
   */
  async placeStopLossOrder({ symbol, side, quantity, stopPrice, price, positionSide }) {
    try {
      // Parametre kontrolü
      if (!symbol || !side || !quantity || !stopPrice) {
        logger.error(`Missing required parameters for stop loss order: Symbol=${symbol}, Side=${side}, Quantity=${quantity}, StopPrice=${stopPrice}`);
        throw new Error('Missing required parameters for stop loss order');
      }
      
      logger.info(`Placing Stop Loss order for ${symbol}:
        - Side: ${side}
        - Quantity: ${quantity}
        - Stop Price: ${stopPrice}
        - Position Side: ${positionSide}
      `);
      
      // BinanceService üzerinden stop loss emri verme
      return await this.binanceService.placeStopLossOrder({
        symbol,
        side,
        quantity,
        stopPrice, 
        positionSide
      });
    } catch (error) {
      logger.error(`Error placing stop loss order for ${symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Take-Profit emri (Take-Profit-Market) oluşturur
   */
  async placeTakeProfitOrder({ symbol, side, quantity, stopPrice, price, positionSide }) {
    try {
      // Parametre kontrolü
      if (!symbol || !side || !quantity || !stopPrice) {
        logger.error(`Missing required parameters for take profit order: Symbol=${symbol}, Side=${side}, Quantity=${quantity}, StopPrice=${stopPrice}`);
        throw new Error('Missing required parameters for take profit order');
      }
      
      logger.info(`Placing Take Profit order for ${symbol}:
        - Side: ${side}
        - Quantity: ${quantity}
        - Stop Price: ${stopPrice}
        - Position Side: ${positionSide}
      `);
      
      // BinanceService üzerinden take profit emri verme
      return await this.binanceService.placeTakeProfitOrder({
        symbol,
        side,
        quantity,
        stopPrice,
        positionSide
      });
    } catch (error) {
      logger.error(`Error placing take profit order for ${symbol}:`, error);
      throw error;
    }
  }

  async closePosition(symbol, side, quantity, positionSide) {
    try {
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);

      // Eğer quantity null, undefined, 0 veya NaN ise, pozisyon miktarını Binance'dan al
      let actualQuantity = quantity;
      let actualPositionSide = positionSide;
      
      if (!quantity || isNaN(quantity) || quantity === 0) {
        logger.info(`No quantity provided for ${symbol}, fetching position size from Binance`);
        
        // Pozisyon miktarını Binance'dan al
        const positions = await this.binanceService.getOpenPositions();
        const position = positions.find(p => p.symbol === symbol);
        
        if (!position || Math.abs(parseFloat(position.positionAmt)) === 0) {
          logger.warn(`No open position found on Binance for ${symbol}`);
          return false;
        }
        
        // Pozisyon miktarının mutlak değerini al (positionAmt negative for SHORT positions)
        actualQuantity = Math.abs(parseFloat(position.positionAmt));
        logger.info(`Found position size from Binance for ${symbol}: ${actualQuantity}`);
        
        // Binance'dan gelen pozisyon tarafını kullan (daha güvenilir)
        if (position.positionSide) {
          actualPositionSide = position.positionSide;
          logger.info(`Using position side from Binance: ${actualPositionSide}`);
        }
      }
      
      // Eğer hala geçersiz miktar varsa, işlemi durdur
      if (!actualQuantity || isNaN(actualQuantity) || actualQuantity === 0) {
        logger.error(`Invalid quantity for ${symbol}: ${actualQuantity}`);
        return false;
      }

      const stepSize = await this.binanceService.getStepSize(symbol);
      const precision = Math.log10(1 / stepSize);
      
      // Miktarı stepSize'a göre uygun şekilde yuvarla
      const adjustedQuantity = Math.floor(actualQuantity / stepSize) * stepSize;
      
      // Son adım olarak miktarı doğru basamak sayısına yuvarla
      const finalQuantity = precision > 0 
        ? adjustedQuantity.toFixed(precision) 
        : adjustedQuantity.toString();
      
      logger.info(`Closing position for ${symbol}: Side: ${side}, Quantity: ${finalQuantity}, Position Side: ${actualPositionSide}`);
      
      const notional = parseFloat(finalQuantity) * currentPrice;
      if (notional < 5) {
        logger.warn(`Notional value (${notional}) for ${symbol} is below Binance's minimum. Skipping close position.`);
        return false; // İşlem yapmadan çık
      }

      return await this.binanceService.placeMarketOrder({
        symbol,
        side,
        quantity: finalQuantity,
        positionSide: actualPositionSide
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
