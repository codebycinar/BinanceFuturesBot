// services/RLModelService.js

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const db = require('../db/db');
const { Strategy } = require('../db/models/Strategy');

/**
 * RL (Reinforcement Learning) modellerini yönetmek için servis.
 * Modellerin kaydedilmesi, yüklenmesi ve performans takibi için kullanılır.
 */
class RLModelService {
  constructor() {
    this.modelsPath = path.join(__dirname, '../../models');
    
    // Modellerin saklandığı klasörü oluştur (eğer yoksa)
    if (!fs.existsSync(this.modelsPath)) {
      fs.mkdirSync(this.modelsPath, { recursive: true });
    }
    
    logger.info('RLModelService initialized');
  }
  
  /**
   * Model dosyasının yolunu döndürür.
   */
  getModelFilePath(symbol, strategyName) {
    const sanitizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedStrategy = strategyName.replace(/[^a-zA-Z0-9]/g, '');
    return path.join(this.modelsPath, `${sanitizedSymbol}_${sanitizedStrategy}.json`);
  }
  
  /**
   * Modeli kaydeder.
   */
  async saveModel(symbol, strategyName, modelData) {
    try {
      if (!modelData) {
        logger.warn(`No model data to save for ${symbol} with strategy ${strategyName}`);
        return false;
      }
      
      // Dosyaya kaydet
      const filePath = this.getModelFilePath(symbol, strategyName);
      fs.writeFileSync(filePath, modelData);
      
      logger.info(`Model saved for ${symbol} with strategy ${strategyName}`);
      return true;
    } catch (error) {
      logger.error(`Error saving model for ${symbol}:`, error);
      return false;
    }
  }
  
  /**
   * Modeli yükler.
   */
  async loadModel(symbol, strategyName) {
    try {
      const filePath = this.getModelFilePath(symbol, strategyName);
      
      if (!fs.existsSync(filePath)) {
        logger.info(`No saved model found for ${symbol} with strategy ${strategyName}`);
        return null;
      }
      
      const modelData = fs.readFileSync(filePath, 'utf8');
      logger.info(`Model loaded for ${symbol} with strategy ${strategyName}`);
      
      return modelData;
    } catch (error) {
      logger.error(`Error loading model for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Strateji performans verisini veritabanından alır.
   */
  async getStrategyPerformance(symbol, strategyName) {
    try {
      const db = require('../db/db');
      const { StrategyPerformance } = db.models;
      
      const performance = await StrategyPerformance.findOne({
        where: {
          symbol,
          strategyName
        }
      });
      
      return performance ? performance.toJSON() : null;
    } catch (error) {
      logger.error(`Error fetching strategy performance for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Strateji performans verisini günceller.
   */
  async updateStrategyPerformance(symbol, strategyName, performanceData) {
    try {
      const db = require('../db/db');
      const { StrategyPerformance } = db.models;
      
      const [performance, created] = await StrategyPerformance.findOrCreate({
        where: {
          symbol,
          strategyName
        },
        defaults: performanceData
      });
      
      if (!created) {
        await performance.update(performanceData);
      }
      
      logger.info(`Strategy performance updated for ${symbol} with strategy ${strategyName}`);
      return true;
    } catch (error) {
      logger.error(`Error updating strategy performance for ${symbol}:`, error);
      return false;
    }
  }
  
  /**
   * Yeni bir trade sonucunu kaydeder ve performans metriklerini günceller.
   */
  async recordTradeResult(symbol, strategyName, isWin, profitPercent) {
    try {
      const performance = await this.getStrategyPerformance(symbol, strategyName) || {
        symbol,
        strategyName,
        totalTrades: 0,
        winCount: 0,
        lossCount: 0,
        totalProfitPercent: 0,
        totalLossPercent: 0,
        winRate: 0,
        profitLossRatio: 1,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        bestTrade: 0,
        worstTrade: 0
      };
      
      // Toplam işlem sayısını artır
      performance.totalTrades += 1;
      
      if (isWin) {
        performance.winCount += 1;
        performance.totalProfitPercent += profitPercent;
        performance.consecutiveWins += 1;
        performance.consecutiveLosses = 0;
        
        // En iyi trade'i güncelle
        if (profitPercent > performance.bestTrade) {
          performance.bestTrade = profitPercent;
        }
      } else {
        performance.lossCount += 1;
        performance.totalLossPercent += Math.abs(profitPercent);
        performance.consecutiveLosses += 1;
        performance.consecutiveWins = 0;
        
        // En kötü trade'i güncelle
        if (profitPercent < performance.worstTrade) {
          performance.worstTrade = profitPercent;
        }
      }
      
      // Win rate hesapla
      performance.winRate = performance.totalTrades > 0 ? 
        performance.winCount / performance.totalTrades : 0;
      
      // Kar/Zarar oranını hesapla
      const avgProfit = performance.winCount > 0 ? 
        performance.totalProfitPercent / performance.winCount : 0;
      const avgLoss = performance.lossCount > 0 ? 
        performance.totalLossPercent / performance.lossCount : 1; // 0'a bölünmeyi önlemek için 1 varsayılanı
      
      performance.profitLossRatio = avgLoss > 0 ? avgProfit / avgLoss : avgProfit;
      
      // Performans verisini güncelle
      await this.updateStrategyPerformance(symbol, strategyName, performance);
      
      logger.info(`Trade result recorded for ${symbol} with strategy ${strategyName}: Win=${isWin}, Profit=${profitPercent.toFixed(2)}%`);
      return performance;
    } catch (error) {
      logger.error(`Error recording trade result for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Tüm stratejileri listeler.
   */
  async listAllModels() {
    try {
      const files = fs.readdirSync(this.modelsPath);
      const models = files
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const [symbol, strategy] = file.replace('.json', '').split('_');
          return { symbol, strategy };
        });
      
      return models;
    } catch (error) {
      logger.error('Error listing models:', error);
      return [];
    }
  }
  
  /**
   * Belirli bir strateji için tüm sembollerin performans metriklerini getirir.
   */
  async getStrategyPerformanceByStrategy(strategyName) {
    try {
      const db = require('../db/db');
      const { StrategyPerformance } = db.models;
      
      const performances = await StrategyPerformance.findAll({
        where: {
          strategyName
        }
      });
      
      return performances.map(p => p.toJSON());
    } catch (error) {
      logger.error(`Error fetching strategy performances for ${strategyName}:`, error);
      return [];
    }
  }
  
  /**
   * RL modeline ait öğrenme eğrisi verisini oluşturur
   */
  async generateLearningCurveData(symbol, strategyName) {
    try {
      // Model dosyasını yükle
      const modelData = await this.loadModel(symbol, strategyName);
      if (!modelData) return null;
      
      const qTable = JSON.parse(modelData);
      
      // Q-Table'dan öğrenme verisi çıkar
      const learningData = {
        stateCount: Object.keys(qTable).length,
        avgQValueLong: 0,
        avgQValueShort: 0,
        avgQValueHold: 0,
        maxQValueLong: -Infinity,
        maxQValueShort: -Infinity,
        maxQValueHold: -Infinity,
        statesWithPositiveQValue: 0
      };
      
      // Q değerlerinin ortalama ve maksimumlarını hesapla
      let totalLong = 0, totalShort = 0, totalHold = 0;
      let positiveStates = 0;
      
      Object.values(qTable).forEach(qValues => {
        totalLong += qValues.long;
        totalShort += qValues.short;
        totalHold += qValues.hold;
        
        learningData.maxQValueLong = Math.max(learningData.maxQValueLong, qValues.long);
        learningData.maxQValueShort = Math.max(learningData.maxQValueShort, qValues.short);
        learningData.maxQValueHold = Math.max(learningData.maxQValueHold, qValues.hold);
        
        if (Math.max(qValues.long, qValues.short, qValues.hold) > 0) {
          positiveStates++;
        }
      });
      
      learningData.avgQValueLong = totalLong / learningData.stateCount;
      learningData.avgQValueShort = totalShort / learningData.stateCount;
      learningData.avgQValueHold = totalHold / learningData.stateCount;
      learningData.statesWithPositiveQValue = positiveStates;
      
      // Performans verilerini ekle
      const performance = await this.getStrategyPerformance(symbol, strategyName);
      if (performance) {
        learningData.winRate = performance.winRate;
        learningData.profitLossRatio = performance.profitLossRatio;
        learningData.totalTrades = performance.totalTrades;
      }
      
      return learningData;
    } catch (error) {
      logger.error(`Error generating learning curve data for ${symbol}:`, error);
      return null;
    }
  }
}

module.exports = RLModelService;