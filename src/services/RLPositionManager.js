// services/RLPositionManager.js

const logger = require('../utils/logger');
const BinanceService = require('./BinanceService');
const RLModelService = require('./RLModelService');
const RLSupportResistanceStrategy = require('../strategies/RLSupportResistanceStrategy');
const db = require('../db/db');
const config = require('../config/config');
const { formatTime } = require('../utils/formatters');
const TelegramBot = require('node-telegram-bot-api');

/**
 * Reinforcement Learning tabanlı pozisyon yöneticisi.
 * Bu sınıf, RL stratejisi kullanarak giriş/çıkış sinyallerini değerlendirir
 * ve gerçek zamanlı öğrenme ile stratejiyi sürekli iyileştirir.
 */
class RLPositionManager {
  constructor() {
    // Temel servisler
    this.binanceService = new BinanceService();
    this.rlModelService = new RLModelService();
    
    // Strateji
    this.strategy = new RLSupportResistanceStrategy();
    
    // İzlenen semboller
    this.watchlist = config.tradingPairs || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    
    // Son bakılan mumlar
    this.lastCandles = {};
    
    // Telegram bildirimleri için bot
    if (config.telegramBotToken && config.telegramChatId) {
      this.telegramBot = new TelegramBot(config.telegramBotToken, { polling: false });
      this.telegramChatId = config.telegramChatId;
    }
    
    // Periyodik kontrol için timer
    this.checkInterval = null;
    
    logger.info('RLPositionManager initialized');
  }
  
  /**
   * Pozisyon yöneticisini başlatır.
   */
  async start() {
    try {
      // Binance servisini başlat
      await this.binanceService.initialize();
      
      // Stratejileri yükle
      await this.loadStrategies();
      
      // Aktif pozisyonları kontrol et
      await this.checkActivePositions();
      
      // Periyodik kontrol başlat (her 15 dakikada bir)
      const interval = 15 * 60 * 1000; // 15 dakika
      this.checkInterval = setInterval(() => this.checkCycle(), interval);
      
      // İlk kontrol döngüsünü başlat
      await this.checkCycle();
      
      logger.info('RLPositionManager started');
      return true;
    } catch (error) {
      logger.error('Error starting RLPositionManager:', error);
      this.sendTelegramMessage(`❌ Error starting RLPositionManager: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Servisin çalışmasını durdurur.
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('RLPositionManager stopped');
  }
  
  /**
   * Stratejileri yükler ve RL modellerini initialize eder
   */
  async loadStrategies() {
    try {
      // Watchlist'teki her sembol için RL modelini yükle
      for (const symbol of this.watchlist) {
        const modelData = await this.rlModelService.loadModel(symbol, this.strategy.name);
        
        if (modelData) {
          this.strategy.loadModel(modelData);
          logger.info(`Loaded RL model for ${symbol}`);
        } else {
          logger.info(`No existing model found for ${symbol}, starting fresh`);
        }
        
        // Performans verilerini yükle ve strateji parametrelerini ayarla
        const performance = await this.rlModelService.getStrategyPerformance(symbol, this.strategy.name);
        
        if (performance) {
          // Performans verilerine göre stop loss ve take profit ayarla
          this.strategy.adjustStopLoss(symbol, performance);
          this.strategy.adjustTakeProfit(symbol, performance);
          
          // Öğrenme parametrelerini ayarla
          this.strategy.adjustLearningParameters(performance.totalTrades || 0);
          
          logger.info(`Adjusted strategy parameters for ${symbol} based on performance data`);
        }
      }
    } catch (error) {
      logger.error('Error loading strategies:', error);
    }
  }
  
  /**
   * Mevcut aktif pozisyonları kontrol eder
   */
  async checkActivePositions() {
    try {
      const { Position } = db.models;
      
      // Veritabanındaki aktif pozisyonları bul
      const activePositions = await Position.findAll({
        where: {
          isActive: true,
          strategyUsed: this.strategy.name,
          isManaged: true
        }
      });
      
      logger.info(`Found ${activePositions.length} active RL positions to monitor`);
      
      // Her aktif pozisyon için kontrol yap
      for (const position of activePositions) {
        // Güncel mumları al
        const candles = await this.binanceService.getCandles(
          position.symbol, 
          this.strategy.preferredTimeframe, 
          50
        );
        
        if (!candles || candles.length < 20) {
          logger.warn(`Not enough candles for ${position.symbol}, skipping`);
          continue;
        }
        
        this.lastCandles[position.symbol] = candles;
        
        // Pozisyon çıkış sinyalini kontrol et
        const shouldExit = await this.strategy.checkExitSignal(candles, position);
        
        if (shouldExit) {
          await this.exitPosition(position);
        }
      }
    } catch (error) {
      logger.error('Error checking active positions:', error);
    }
  }
  
  /**
   * Pozisyondan çıkış yapar
   */
  async exitPosition(position) {
    try {
      // Pozisyon tipine göre tersine işlem
      const closeSide = position.signal === 'long' ? 'SELL' : 'BUY';
      
      // Binance'da pozisyonu kapat
      await this.binanceService.closePosition(position.symbol, closeSide);
      
      // Pozisyon kapanış fiyatını al
      const currentPrice = await this.binanceService.getCurrentPrice(position.symbol);
      
      // Kar/zarar hesapla
      let pnlPercent = 0;
      if (position.signal === 'long') {
        pnlPercent = ((currentPrice - position.entryPrices[0]) / position.entryPrices[0]) * 100;
      } else {
        pnlPercent = ((position.entryPrices[0] - currentPrice) / position.entryPrices[0]) * 100;
      }
      
      // Pozisyonu veritabanında güncelle
      await position.update({
        isActive: false,
        closedPrice: currentPrice,
        closedAt: new Date(),
        exitReason: 'RL Strategy Exit Signal',
        pnlPercent,
        pnlAmount: (position.totalAllocation * pnlPercent) / 100,
        holdTime: Math.round((new Date() - new Date(position.createdAt)) / (1000 * 60)) // dakika olarak
      });
      
      // Bu sonuçla modelin öğrenmesini sağla
      const isWin = pnlPercent > 0;
      
      // Strateji performansını güncelle
      await this.rlModelService.recordTradeResult(
        position.symbol,
        this.strategy.name,
        isWin,
        pnlPercent
      );
      
      // Modeli kaydet
      const modelData = this.strategy.saveModel();
      await this.rlModelService.saveModel(position.symbol, this.strategy.name, modelData);
      
      // Bildirim gönder
      const emoji = isWin ? '🟢' : '🔴';
      const message = `${emoji} RL Bot Exit: ${position.symbol} ${position.signal.toUpperCase()}
Profit: ${pnlPercent.toFixed(2)}%
Entry: ${position.entryPrices[0]}
Exit: ${currentPrice}
Hold Time: ${formatTime(position.holdTime * 60 * 1000)} 
Reason: ${position.exitReason}`;
      
      this.sendTelegramMessage(message);
      logger.info(`Exited position for ${position.symbol}: ${message}`);
    } catch (error) {
      logger.error(`Error exiting position for ${position.symbol}:`, error);
      this.sendTelegramMessage(`❌ Error exiting ${position.symbol} position: ${error.message}`);
    }
  }
  
  /**
   * Yeni pozisyon açar
   */
  async enterPosition(symbol, signal) {
    try {
      const { Position } = db.models;
      
      // Mevcut fiyat bilgisini al
      const currentPrice = await this.binanceService.getCurrentPrice(symbol);
      
      // Hesap bakiyesini al
      const balance = await this.binanceService.getFuturesBalance();
      
      // Exchange bilgilerini al (precision değerleri için)
      try {
        await this.binanceService.getExchangeInfo();
      } catch (error) {
        logger.error(`Failed to get exchange info: ${error.message}`);
        // Devam et, varsayılan precision değerleri kullanılacak
      }
      
      // Çok küçük ve güvenli bir pozisyon boyutu kullan
      // Sabit bir değer: 10 USD maksimum
      const positionSize = Math.min(10, balance * 0.005); // Bakiyenin en fazla %0.5'i, maksimum 10 USD
      
      // İşlem miktarını hesapla (USD cinsinden pozisyon büyüklüğü / coin fiyatı)
      const baseQuantity = positionSize / currentPrice;
      
      // Miktar için precision değerlerini al - güvenli bir varsayılan kullan
      let quantityPrecision = 3; // Varsayılan
      try {
        quantityPrecision = this.binanceService.getQuantityPrecision(symbol);
        // Çok büyük değerleri sınırla
        if (quantityPrecision > 8) quantityPrecision = 8;
      } catch (error) {
        logger.warn(`Could not get precise quantity precision for ${symbol}, using default value 3`);
      }
      
      // Güvenli bir şekilde miktarı ayarla
      const quantity = this.binanceService.adjustPrecision(baseQuantity, quantityPrecision);
      
      try {
        logger.info(`Using fixed position size for ${symbol}: $${positionSize.toFixed(2)}`);
      } catch (e) {
        logger.info(`Using fixed position size for ${symbol}: $${positionSize}`);
      }
      
      logger.info(`Raw quantity: ${baseQuantity}, Adjusted quantity: ${quantity}, Precision: ${quantityPrecision}`);
      
      // Sipariş tipi ve durumları belirle
      const orderSide = signal.signal === 'long' ? 'BUY' : 'SELL';
      const positionSide = this.binanceService.positionSideMode === 'Hedge' 
          ? (signal.signal === 'long' ? 'LONG' : 'SHORT') 
          : undefined;
      
      // Market emriyle pozisyon aç
      const order = await this.binanceService.placeMarketOrder({
        symbol,
        side: orderSide,
        quantity,
        positionSide
      });
      
      // Stop Loss ve Take Profit emirlerini ekle
      if (signal.stopLoss) {
        const slSide = signal.signal === 'long' ? 'SELL' : 'BUY';
        await this.binanceService.placeStopLossOrder({
          symbol,
          side: slSide,
          quantity,
          stopPrice: signal.stopLoss,
          positionSide
        });
      }
      
      if (signal.takeProfit) {
        const tpSide = signal.signal === 'long' ? 'SELL' : 'BUY';
        await this.binanceService.placeTakeProfitOrder({
          symbol,
          side: tpSide,
          quantity,
          stopPrice: signal.takeProfit,
          positionSide
        });
      }
      
      // Veritabanına kaydet
      const position = await Position.create({
        symbol,
        entries: 1,
        entryPrices: [currentPrice],
        totalAllocation: positionSize,
        isActive: true,
        signal: signal.signal,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        strategyUsed: this.strategy.name,
        marketConditions: signal.metadata,
        isManaged: true
      });
      
      // Bildirim gönder
      const message = `🤖 RL Bot Entry: ${symbol} ${signal.signal.toUpperCase()}
Price: ${currentPrice}
Stop Loss: ${signal.stopLoss.toFixed(8)}
Take Profit: ${signal.takeProfit.toFixed(8)}
Confidence: ${(signal.confidence || 0).toFixed(2)}
Size: $${positionSize.toFixed(2)}`;
      
      this.sendTelegramMessage(message);
      logger.info(`Entered new position for ${symbol}: ${message}`);
      
      return position;
    } catch (error) {
      logger.error(`Error entering position for ${symbol}:`, error);
      this.sendTelegramMessage(`❌ Error entering ${symbol} position: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Periyodik kontrol döngüsü
   */
  async checkCycle() {
    try {
      logger.info('Starting RL check cycle');
      
      // Aktif pozisyonları kontrol et
      await this.checkActivePositions();
      
      // Yeni giriş fırsatlarını kontrol et
      await this.scanForEntrySignals();
      
      // Modelleri ve performans verilerini kaydet
      await this.saveModels();
      
      logger.info('Completed RL check cycle');
    } catch (error) {
      logger.error('Error in RL check cycle:', error);
    }
  }
  
  /**
   * Yeni giriş sinyallerini kontrol eder
   */
  async scanForEntrySignals() {
    try {
      const { Position } = db.models;
      
      // Aktif pozisyon sayısını kontrol et
      const activePositionCount = await Position.count({
        where: {
          isActive: true,
          strategyUsed: this.strategy.name
        }
      });
      
      // Maksimum pozisyon sayısını aşıyorsa, yeni pozisyon açma
      if (activePositionCount >= this.strategy.maxPositions) {
        logger.info(`Already at maximum ${this.strategy.maxPositions} positions, skipping entry scan`);
        return;
      }
      
      // Watchlist'teki sembolleri tara
      for (const symbol of this.watchlist) {
        // Sembol için zaten aktif bir pozisyon var mı?
        const hasActivePosition = await Position.findOne({
          where: {
            symbol,
            isActive: true,
            strategyUsed: this.strategy.name
          }
        });
        
        if (hasActivePosition) {
          logger.info(`Already have an active position for ${symbol}, skipping`);
          continue;
        }
        
        // Strateji için 15 dakikalık mumları al
        const candles = await this.binanceService.getCandles(
          symbol, 
          this.strategy.preferredTimeframe, 
          50
        );
        
        if (!candles || candles.length < 20) {
          logger.warn(`Not enough candles for ${symbol}, skipping`);
          continue;
        }
        
        this.lastCandles[symbol] = candles;
        
        // Giriş sinyalini kontrol et
        const entrySignal = await this.strategy.checkEntrySignal(candles, symbol);
        
        if (entrySignal) {
          logger.info(`Got entry signal for ${symbol}: ${entrySignal.signal}`);
          
          // Pozisyona gir
          await this.enterPosition(symbol, entrySignal);
          
          // Yeni bir pozisyon açtıktan sonra aktif pozisyon limitini tekrar kontrol et
          const newActivePositionCount = await Position.count({
            where: {
              isActive: true,
              strategyUsed: this.strategy.name
            }
          });
          
          if (newActivePositionCount >= this.strategy.maxPositions) {
            logger.info(`Reached maximum ${this.strategy.maxPositions} positions after adding ${symbol}, stopping entry scan`);
            break;
          }
        }
      }
    } catch (error) {
      logger.error('Error scanning for entry signals:', error);
    }
  }
  
  /**
   * Tüm modelleri ve performans verilerini kaydeder
   */
  async saveModels() {
    try {
      for (const symbol of this.watchlist) {
        // Modeli kaydet
        const modelData = this.strategy.saveModel();
        await this.rlModelService.saveModel(symbol, this.strategy.name, modelData);
        
        // Öğrenme eğrisi verisini oluştur ve kaydet
        const learningCurve = await this.rlModelService.generateLearningCurveData(symbol, this.strategy.name);
        
        if (learningCurve) {
          logger.info(`Learning curve for ${symbol}:`, learningCurve);
        }
      }
      
      logger.info('Models and performance data saved');
    } catch (error) {
      logger.error('Error saving models:', error);
    }
  }
  
  /**
   * Telegram mesajı gönderir
   */
  sendTelegramMessage(message) {
    if (this.telegramBot && this.telegramChatId) {
      this.telegramBot.sendMessage(this.telegramChatId, message)
        .catch(error => logger.error('Error sending Telegram message:', error));
    }
  }
  
  /**
   * Tüm izlenen semboller için eğitim yapar
   */
  async trainAllSymbols(days = 30) {
    try {
      const symbols = this.watchlist;
      
      logger.info(`Starting training for all ${symbols.length} symbols with ${days} days of data`);
      this.sendTelegramMessage(`🧠 Starting training for all ${symbols.length} symbols with ${days} days of data`);
      
      const results = {
        totalTrades: 0,
        winningTrades: 0,
        symbols: {}
      };
      
      // Her sembol için eğitim yap
      for (const symbol of symbols) {
        logger.info(`Training symbol: ${symbol}`);
        const result = await this.trainOnHistoricalData(symbol, days, false); // suppressMessages=false
        
        if (result) {
          results.totalTrades += result.totalTrades;
          results.winningTrades += result.winCount;
          results.symbols[symbol] = {
            trades: result.totalTrades,
            winRate: result.winRate,
            profitLossRatio: result.profitLossRatio
          };
        }
      }
      
      // Genel sonuçları hesapla
      const totalWinRate = results.totalTrades > 0 ? 
        (results.winningTrades / results.totalTrades) * 100 : 0;
      
      // Sonuçları log'la ve Telegram'a gönder
      const message = `✅ Training completed for all symbols!
Total Trades: ${results.totalTrades}
Winning Trades: ${results.winningTrades}
Overall Win Rate: ${totalWinRate.toFixed(2)}%

Performance by Symbol:
${Object.entries(results.symbols)
  .filter(([_, data]) => data.trades > 0)
  .sort((a, b) => b[1].winRate - a[1].winRate)
  .map(([sym, data]) => `${sym}: ${data.trades} trades, ${(data.winRate * 100).toFixed(2)}% win rate`)
  .join('\n')}`;
      
      logger.info(message);
      this.sendTelegramMessage(message);
      
      return results;
    } catch (error) {
      logger.error(`Error training all symbols:`, error);
      this.sendTelegramMessage(`❌ Error training all symbols: ${error.message}`);
      return null;
    }
  }

  /**
   * Seçilen sembol için geçmiş verileri kullanarak bir RL stratejisini eğitir
   */
  async trainOnHistoricalData(symbol, days = 30, suppressMessages = false) {
    try {
      logger.info(`Starting historical training for ${symbol} with ${days} days of data`);
      if (!suppressMessages) {
        this.sendTelegramMessage(`🧠 Starting RL training for ${symbol} with ${days} days of data`);
      }
      
      // Günlük mum verisini al (bugünden geçmişe doğru)
      const endTime = Date.now();
      const startTime = endTime - (days * 24 * 60 * 60 * 1000); // days günlük veri (milisaniye cinsinden)
      
      logger.info(`Fetching daily candles from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
      
      const dailyCandles = await this.binanceService.getCandles(
        symbol, 
        '1d', 
        days,
        startTime,
        endTime
      );
      
      if (!dailyCandles || dailyCandles.length < days * 0.5) { // En az %50 veri olsun
        const errorMsg = `Not enough daily candles for ${symbol}, got ${dailyCandles.length}/${days}`;
        logger.warn(errorMsg);
        if (!suppressMessages) {
          this.sendTelegramMessage(`⚠️ ${errorMsg}`);
        }
        return false;
      }
      
      // Her gün için 15 dakikalık mumları alıp stratejiye ver
      let totalTrades = 0;
      let successfulTrades = 0;
      
      for (let i = 0; i < dailyCandles.length; i++) {
        const day = new Date(dailyCandles[i].timestamp);
        logger.info(`Training on data for ${symbol} on ${day.toISOString().split('T')[0]}`);
        
        // O gün için 15 dakikalık mumları al
        const dayStart = new Date(day);
        dayStart.setUTCHours(0, 0, 0, 0);
        
        const dayEnd = new Date(day);
        dayEnd.setUTCHours(23, 59, 59, 999);
        
        logger.info(`Fetching 15m candles for ${symbol} on ${dayStart.toISOString().split('T')[0]}`);
        
        // 15 dakikalık mumları al (maksimum 96 mum - günde 24 saat * 4 15-dakikalık dilim)
        const intraday15mCandles = await this.binanceService.getCandles(
          symbol, 
          this.strategy.preferredTimeframe, 
          96,
          dayStart.getTime(),
          dayEnd.getTime()
        );
        
        logger.info(`Received ${intraday15mCandles.length} 15m candles for ${symbol} on ${dayStart.toISOString().split('T')[0]}`);
        
        
        if (!intraday15mCandles || intraday15mCandles.length < 20) {
          logger.warn(`Not enough 15m candles for ${symbol} on ${day.toISOString().split('T')[0]}, skipping`);
          continue;
        }
        
        // İlk giriş sinyalini al
        let entrySignal = await this.strategy.checkEntrySignal(intraday15mCandles.slice(0, 20), symbol);
        let entryIndex = null;
        let position = null;
        
        // Gün boyunca mumları tara
        for (let j = 20; j < intraday15mCandles.length - 1; j++) {
          const currentCandles = intraday15mCandles.slice(j - 19, j + 1);
          
          if (!position && entrySignal) {
            // Pozisyon aç
            entryIndex = j;
            position = {
              symbol,
              signal: entrySignal.signal,
              entryPrice: parseFloat(currentCandles[currentCandles.length - 1].close),
              stopLoss: entrySignal.stopLoss,
              takeProfit: entrySignal.takeProfit,
              metadata: entrySignal.metadata
            };
            
            logger.info(`Training: Entered ${symbol} ${position.signal} at ${position.entryPrice}`);
            continue;
          }
          
          if (position) {
            // Pozisyonu kontrol et
            const currentPrice = parseFloat(currentCandles[currentCandles.length - 1].close);
            
            // Stop Loss veya Take Profit'e ulaşıldı mı?
            let exitReason = null;
            let isWin = false;
            let pnlPercent = 0;
            
            if (position.signal === 'long') {
              if (currentPrice <= position.stopLoss) {
                exitReason = 'Stop Loss';
                isWin = false;
                pnlPercent = ((position.stopLoss - position.entryPrice) / position.entryPrice) * 100;
              } else if (currentPrice >= position.takeProfit) {
                exitReason = 'Take Profit';
                isWin = true;
                pnlPercent = ((position.takeProfit - position.entryPrice) / position.entryPrice) * 100;
              }
            } else { // short
              if (currentPrice >= position.stopLoss) {
                exitReason = 'Stop Loss';
                isWin = false;
                pnlPercent = ((position.entryPrice - position.stopLoss) / position.entryPrice) * 100;
              } else if (currentPrice <= position.takeProfit) {
                exitReason = 'Take Profit';
                isWin = true;
                pnlPercent = ((position.entryPrice - position.takeProfit) / position.entryPrice) * 100;
              }
            }
            
            // Strateji sinyal veriyor mu?
            if (!exitReason) {
              const shouldExit = await this.strategy.checkExitSignal(currentCandles, position);
              
              if (shouldExit) {
                exitReason = 'Strategy Exit Signal';
                
                if (position.signal === 'long') {
                  pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
                } else {
                  pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
                }
                
                isWin = pnlPercent > 0;
              }
            }
            
            if (exitReason) {
              // Pozisyondan çık
              logger.info(`Training: Exited ${symbol} ${position.signal} at ${currentPrice}, reason: ${exitReason}, PnL: ${pnlPercent.toFixed(2)}%`);
              
              // Bu işlem için öğrenme
              position.pnlPercent = pnlPercent;
              const candles = intraday15mCandles.slice(j - 19, j + 1);
              const currentState = this.strategy.getStateKey(await this.strategy.calculateIndicators(candles));
              
              if (currentState) {
                this.strategy.learn(currentState, position.signal, pnlPercent);
              }
              
              // İstatistikleri güncelle
              totalTrades++;
              if (isWin) successfulTrades++;
              
              // Performans kaydı
              await this.rlModelService.recordTradeResult(
                symbol,
                this.strategy.name,
                isWin,
                pnlPercent
              );
              
              // Pozisyonu sıfırla
              position = null;
              entrySignal = null;
            }
          }
          
          // Pozisyonda değilsek yeni giriş sinyali ara
          if (!position) {
            entrySignal = await this.strategy.checkEntrySignal(currentCandles, symbol);
          }
        }
        
        // Gün sonunda hala açık pozisyon varsa kapat
        if (position) {
          const lastPrice = parseFloat(intraday15mCandles[intraday15mCandles.length - 1].close);
          let pnlPercent = 0;
          
          if (position.signal === 'long') {
            pnlPercent = ((lastPrice - position.entryPrice) / position.entryPrice) * 100;
          } else {
            pnlPercent = ((position.entryPrice - lastPrice) / position.entryPrice) * 100;
          }
          
          const isWin = pnlPercent > 0;
          
          logger.info(`Training: Force closed ${symbol} ${position.signal} at day end, PnL: ${pnlPercent.toFixed(2)}%`);
          
          // Performans kaydı
          await this.rlModelService.recordTradeResult(
            symbol,
            this.strategy.name,
            isWin,
            pnlPercent
          );
          
          totalTrades++;
          if (isWin) successfulTrades++;
        }
        
        // Her gün sonunda modeli kaydet
        const modelData = this.strategy.saveModel();
        await this.rlModelService.saveModel(symbol, this.strategy.name, modelData);
      }
      
      // Eğitim sonuçlarını göster
      const winRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
      logger.info(`Training completed for ${symbol}:
        Total Trades: ${totalTrades}
        Winning Trades: ${successfulTrades}
        Win Rate: ${winRate.toFixed(2)}%
      `);
      
      // Telegram'a mesaj gönder - suppress edilmemişse
      if (!suppressMessages) {
        this.sendTelegramMessage(`✅ RL training completed for ${symbol}:
Total Trades: ${totalTrades}
Winning Trades: ${successfulTrades}
Win Rate: ${winRate.toFixed(2)}%`);
      }
      
      // Performans verilerini al
      const performance = await this.rlModelService.getStrategyPerformance(symbol, this.strategy.name);
      
      return performance;
    } catch (error) {
      logger.error(`Error training model for ${symbol}:`, error);
      this.sendTelegramMessage(`❌ Error in RL training for ${symbol}: ${error.message}`);
      return false;
    }
  }
}

module.exports = RLPositionManager;