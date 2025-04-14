// strategies/RLSupportResistanceStrategy.js

const logger = require('../utils/logger');
const ti = require('technicalindicators');

/**
 * Reinforcement Learning tabanlı Destek-Direnç Stratejisi
 * 
 * Bu strateji şunları yapar:
 * 1. 15 dakikalık zaman diliminde destek-direnç noktalarını belirler
 * 2. Bu noktalar arasında long/short işlemlere girer
 * 3. Kendi yaptığı işlemlerden öğrenir (Q-Learning algoritması)
 */
class RLSupportResistanceStrategy {
  constructor() {
    this.name = 'RL Support-Resistance Strategy';
    // Stratejinin tercih ettiği zaman dilimi
    this.preferredTimeframe = '15m';
    
    // Q-Learning için parametreler
    this.alpha = 0.3;  // Öğrenme oranı
    this.gamma = 0.7;  // Gelecekteki ödüllerin indirim faktörü
    this.epsilon = 0.2; // Keşif oranı (rastgele hareket olasılığı)
    
    // Q-Table (durum-eylem çiftlerinin değerleri)
    this.qTable = {};
    
    // Destek-Direnç seviyelerini belirlemek için pencere boyutu
    this.windowSize = 20;
    
    // Son işlemler hakkında bilgi
    this.lastAction = null;
    this.lastState = null;
    this.lastReward = 0;
    
    // Destek-Direnç bollinger band parametreleri
    this.supportResistancePeriod = 20;
    this.supportResistanceDeviation = 2;
    
    // Karı/Zararı oranları
    this.stopLossPercentage = 1.0;   // %1.0
    this.takeProfitPercentage = 2.0; // %2.0
    
    // Pozisyon boyutu hesaplama
    this.riskPerTrade = 2.0; // Toplam sermayenin %2'si
    this.maxPositions = 3;   // Maksimum aynı anda 3 pozisyon
    
    logger.info('RL Support-Resistance Strategy initialized');
  }
  
  /**
   * Teknik göstergeleri hesapla
   */
  async calculateIndicators(candles) {
    try {
      const closes = candles.map(c => parseFloat(c.close));
      const highs = candles.map(c => parseFloat(c.high));
      const lows = candles.map(c => parseFloat(c.low));
      
      // Bollinger Bands hesapla
      const bollingerBands = ti.BollingerBands.calculate({
        period: this.supportResistancePeriod,
        values: closes,
        stdDev: this.supportResistanceDeviation
      });
      
      // RSI hesapla
      const rsi = ti.RSI.calculate({
        values: closes,
        period: 14
      });
      
      // ATR hesapla
      const atr = ti.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14
      });
      
      return {
        bollingerBands: bollingerBands[bollingerBands.length - 1],
        rsi: rsi[rsi.length - 1],
        atr: atr[atr.length - 1],
        currentPrice: closes[closes.length - 1]
      };
    } catch (error) {
      logger.error('Error calculating indicators:', error);
      return null;
    }
  }
  
  /**
   * Mevcut durum kodunu oluşturur
   */
  getStateKey(indicators) {
    if (!indicators || !indicators.bollingerBands) {
      return null;
    }
    
    const { bollingerBands, rsi, currentPrice } = indicators;
    const { upper, middle, lower } = bollingerBands;
    
    // Fiyat bandın neresinde?
    let pricePosition = 0;
    if (currentPrice > upper) pricePosition = 2; // Bandın üstünde
    else if (currentPrice < lower) pricePosition = -2; // Bandın altında
    else if (currentPrice > middle) pricePosition = 1; // Orta bandın üstünde
    else if (currentPrice < middle) pricePosition = -1; // Orta bandın altında
    
    // RSI aşırı alım/satım durumu
    let rsiState = 0;
    if (rsi > 70) rsiState = 2; // Aşırı alım
    else if (rsi < 30) rsiState = -2; // Aşırı satım
    else if (rsi > 60) rsiState = 1; // Alım bölgesi
    else if (rsi < 40) rsiState = -1; // Satım bölgesi
    
    // Durum kodu oluştur
    return `${pricePosition}_${rsiState}`;
  }
  
  /**
   * Mümkün olan eylemleri döndürür
   */
  getActions() {
    return ['long', 'short', 'hold'];
  }
  
  /**
   * Q-tablo değerini günceller
   */
  updateQValue(state, action, reward, nextState) {
    if (!state || !nextState) return;
    
    // Eğer durum Q-tablo'da yoksa ekle
    if (!this.qTable[state]) {
      this.qTable[state] = {
        'long': 0,
        'short': 0,
        'hold': 0
      };
    }
    
    // Sonraki durum için maksimum Q değerini bul
    let maxNextQ = 0;
    if (this.qTable[nextState]) {
      maxNextQ = Math.max(
        this.qTable[nextState].long, 
        this.qTable[nextState].short, 
        this.qTable[nextState].hold
      );
    } else {
      this.qTable[nextState] = {
        'long': 0,
        'short': 0,
        'hold': 0
      };
    }
    
    // Q değerini güncelle
    const oldValue = this.qTable[state][action];
    const newValue = oldValue + this.alpha * (reward + this.gamma * maxNextQ - oldValue);
    this.qTable[state][action] = newValue;
    
    logger.info(`Q-Value updated: State=${state}, Action=${action}, Reward=${reward}, NewValue=${newValue.toFixed(2)}`);
  }
  
  /**
   * En iyi eylemi seç
   */
  getBestAction(state) {
    // Keşif: Epsilon olasılıkla rastgele bir eylem seç
    if (Math.random() < this.epsilon) {
      const actions = this.getActions();
      return actions[Math.floor(Math.random() * actions.length)];
    }
    
    // Durum Q-tabloda yoksa, varsayılan değerleri ekle
    if (!this.qTable[state]) {
      this.qTable[state] = {
        'long': 0,
        'short': 0,
        'hold': 0
      };
    }
    
    // En yüksek Q değerine sahip eylemi seç
    const qValues = this.qTable[state];
    let bestAction = 'hold';
    let maxQValue = qValues.hold;
    
    if (qValues.long > maxQValue) {
      bestAction = 'long';
      maxQValue = qValues.long;
    }
    
    if (qValues.short > maxQValue) {
      bestAction = 'short';
      maxQValue = qValues.short;
    }
    
    return bestAction;
  }
  
  /**
   * Ödülü hesapla
   */
  calculateReward(action, currentPosition, pnlPercent) {
    if (!currentPosition) {
      return 0; // Pozisyon yoksa ödül yok
    }
    
    // Pozisyon kapanmışsa (TP veya SL)
    if (pnlPercent !== null) {
      // Kar/zarar durumuna göre ödül
      return pnlPercent > 0 ? pnlPercent * 10 : pnlPercent * 5;
    }
    
    // Pozisyon açığız ve eylem pozisyonumuzla uyumlu (tutarlı strateji)
    if ((currentPosition === 'long' && action === 'long') || 
        (currentPosition === 'short' && action === 'short')) {
      return 0.1;
    }
    
    // Eylem pozisyonumuzla çelişiyor (tutarsız strateji)
    if ((currentPosition === 'long' && action === 'short') || 
        (currentPosition === 'short' && action === 'long')) {
      return -0.1;
    }
    
    return 0; // Nötr durum
  }
  
  /**
   * Öğrenme adımını gerçekleştir
   */
  learn(currentState, position, pnlPercent) {
    if (this.lastState && this.lastAction) {
      const reward = this.calculateReward(this.lastAction, position, pnlPercent);
      this.updateQValue(this.lastState, this.lastAction, reward, currentState);
      this.lastReward = reward;
    }
  }
  
  /**
   * Giriş sinyalini kontrol et
   */
  async checkEntrySignal(candles, symbol) {
    try {
      const indicators = await this.calculateIndicators(candles);
      if (!indicators) return null;
      
      const currentState = this.getStateKey(indicators);
      if (!currentState) return null;
      
      // Mevcut durumdan öğren (eğer önceki durum ve eylem varsa)
      this.learn(currentState, null, null);
      
      // En iyi eylemi seç
      const action = this.getBestAction(currentState);
      
      // Durumu ve eylemi sakla
      this.lastState = currentState;
      this.lastAction = action;
      
      // Giriş eylemi
      if (action === 'long') {
        return {
          signal: 'long',
          confidence: this.qTable[currentState]?.long || 0,
          stopLoss: indicators.currentPrice * (1 - this.stopLossPercentage / 100),
          takeProfit: indicators.currentPrice * (1 + this.takeProfitPercentage / 100),
          metadata: {
            strategy: this.name,
            timeframe: this.preferredTimeframe,
            indicators: {
              bollingerBands: indicators.bollingerBands,
              rsi: indicators.rsi,
              state: currentState
            }
          }
        };
      } else if (action === 'short') {
        return {
          signal: 'short',
          confidence: this.qTable[currentState]?.short || 0,
          stopLoss: indicators.currentPrice * (1 + this.stopLossPercentage / 100),
          takeProfit: indicators.currentPrice * (1 - this.takeProfitPercentage / 100),
          metadata: {
            strategy: this.name,
            timeframe: this.preferredTimeframe,
            indicators: {
              bollingerBands: indicators.bollingerBands,
              rsi: indicators.rsi,
              state: currentState
            }
          }
        };
      }
      
      // Sinyal yok
      return null;
    } catch (error) {
      logger.error(`Error in checkEntrySignal for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Çıkış sinyalini kontrol et
   */
  async checkExitSignal(candles, position) {
    try {
      const indicators = await this.calculateIndicators(candles);
      if (!indicators) return false;
      
      const currentState = this.getStateKey(indicators);
      if (!currentState) return false;
      
      // Mevcut pozisyondan öğren
      if (position.pnlPercent) {
        this.learn(currentState, position.signal, position.pnlPercent);
      } else {
        this.learn(currentState, position.signal, null);
      }
      
      // En iyi eylemi seç
      const action = this.getBestAction(currentState);
      
      // Durumu ve eylemi sakla
      this.lastState = currentState;
      this.lastAction = action;
      
      // Pozisyonu tersine çeviren bir sinyal varsa çık
      if ((position.signal === 'long' && action === 'short') || 
          (position.signal === 'short' && action === 'long')) {
        return true;
      }
      
      // Aksi halde pozisyonu koru
      return false;
    } catch (error) {
      logger.error(`Error in checkExitSignal:`, error);
      return false;
    }
  }
  
  /**
   * Pozisyon boyutunu hesapla
   */
  calculatePositionSize(balance, currentPrice, atr) {
    // Risk tabanlı pozisyon boyutu
    const risk = (balance * this.riskPerTrade) / 100;
    // ATR bazlı stop loss mesafesi
    const stopDistance = atr * 1.5;
    // Pozisyon boyutu = Risk / Stop Loss mesafesi
    const positionSize = risk / stopDistance;
    // USD cinsinden pozisyon boyutunu hesapla
    const positionSizeUSD = positionSize * currentPrice;
    
    return positionSizeUSD;
  }
  
  /**
   * RL modelini kaydet
   */
  saveModel() {
    try {
      // JSON olarak kaydet
      return JSON.stringify(this.qTable);
    } catch (error) {
      logger.error('Error saving model:', error);
      return null;
    }
  }
  
  /**
   * RL modelini yükle
   */
  loadModel(modelData) {
    try {
      if (!modelData) return false;
      
      this.qTable = JSON.parse(modelData);
      logger.info(`RL model loaded with ${Object.keys(this.qTable).length} states`);
      return true;
    } catch (error) {
      logger.error('Error loading model:', error);
      return false;
    }
  }
  
  /**
   * Belirli bir sembol için stop loss oranını ayarla
   */
  adjustStopLoss(symbol, performanceData) {
    if (!performanceData) return;
    
    // Son 10 işlemin win rate'ini bul
    const winRate = performanceData.winRate || 0.5;
    
    // Win rate'e göre stop loss'u ayarla
    if (winRate > 0.7) {
      // İyi performans, daha sıkı stop loss
      this.stopLossPercentage = 0.8;
    } else if (winRate < 0.3) {
      // Kötü performans, daha geniş stop loss
      this.stopLossPercentage = 1.2;
    } else {
      // Normal performans, standart stop loss
      this.stopLossPercentage = 1.0;
    }
    
    logger.info(`Adjusted stop loss for ${symbol} based on win rate ${winRate}: ${this.stopLossPercentage}%`);
  }
  
  /**
   * Belirli bir sembol için take profit oranını ayarla
   */
  adjustTakeProfit(symbol, performanceData) {
    if (!performanceData) return;
    
    // Son 10 işlemin ortalama kazanç/kayıp oranını bul
    const profitLossRatio = performanceData.profitLossRatio || 1.0;
    
    // Kazanç/kayıp oranına göre take profit'i ayarla
    if (profitLossRatio > 2.0) {
      // Kazançlar kayıplardan çok daha büyük, daha yüksek TP
      this.takeProfitPercentage = 2.5;
    } else if (profitLossRatio < 0.5) {
      // Kayıplar kazançlardan büyük, daha düşük TP
      this.takeProfitPercentage = 1.5;
    } else {
      // Normal oran, standart TP
      this.takeProfitPercentage = 2.0;
    }
    
    logger.info(`Adjusted take profit for ${symbol} based on profit/loss ratio ${profitLossRatio}: ${this.takeProfitPercentage}%`);
  }
  
  /**
   * Öğrenme parametrelerini ayarla
   */
  adjustLearningParameters(totalTrades) {
    // Zamanla keşif oranını azalt (daha az rastgele eylem)
    if (totalTrades > 100) {
      this.epsilon = 0.1;
    } else if (totalTrades > 50) {
      this.epsilon = 0.15;
    }
    
    logger.info(`Adjusted learning parameters: epsilon=${this.epsilon}`);
  }
}

module.exports = RLSupportResistanceStrategy;