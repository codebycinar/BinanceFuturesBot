/**
 * OnchainMetricsService.js - Kripto varlıklar için onchain metrikleri sağlayan servis
 * 
 * Bu servis, Glassnode, CryptoQuant gibi API'lar aracılığıyla 
 * blockchain üzerindeki verileri analiz ederek, piyasaya giren/çıkan para akışı, 
 * whale hareketleri ve akıllı para davranışları hakkında bilgi sağlar.
 */
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class OnchainMetricsService {
  constructor() {
    // API kimlik bilgileri (config.js'den alınacak)
    this.glassnodeApiKey = config.glassnodeApiKey || 'demo';
    this.cryptoQuantApiKey = config.cryptoQuantApiKey || '';
    this.baseUrl = 'https://api.glassnode.com/v1/metrics';
    
    // Önbellek sistemi
    this.cache = {};
    this.cacheExpiry = {};
    this.cacheDuration = 30 * 60 * 1000; // 30 dakika
    
    // Desteklenen varlıklar
    this.supportedAssets = ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOT'];
    
    logger.info('OnchainMetricsService initialized');
  }

  /**
   * Bir varlık için exchange net flow verilerini getirir (borsalara giren/çıkan para)
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @param {string} timeframe - 24h, 1w, 1m gibi zaman dilimi
   * @returns {number|null} - Pozitif değer borsalara para girişini, negatif değer çıkışını gösterir
   */
  async getExchangeNetFlow(asset = 'BTC', timeframe = '24h') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `exchange_flow_${asset}_${timeframe}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached exchange net flow data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // API isteği
      const endpoint = '/transactions/exchanges_net_flow_total';
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await axios.get(url, {
        params: {
          a: asset,
          i: timeframe,
          api_key: this.glassnodeApiKey
        }
      });
      
      if (!response.data || !response.data.length) {
        logger.warn(`No exchange net flow data returned for ${asset}`);
        return null;
      }
      
      // En son veriyi al
      const latestData = response.data[response.data.length - 1];
      const netFlow = latestData.v; // Pozitif = giriş, Negatif = çıkış
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = netFlow;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} exchange net flow: ${netFlow.toFixed(2)} (${timeframe})`);
      return netFlow;
    } catch (error) {
      logger.error(`Error fetching exchange net flow for ${asset}: ${error.message}`);
      return null;
    }
  }

  /**
   * Büyük cüzdan (whale) işlem sayısını getirir
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - Büyük işlem sayısı
   */
  async getWhaleTransactions(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `whale_transactions_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached whale transaction data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // API isteği
      const endpoint = '/transactions/transfers_volume_large';
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await axios.get(url, {
        params: {
          a: asset,
          i: '24h',
          api_key: this.glassnodeApiKey
        }
      });
      
      if (!response.data || !response.data.length) {
        logger.warn(`No whale transaction data returned for ${asset}`);
        return null;
      }
      
      // En son veriyi al
      const latestData = response.data[response.data.length - 1];
      const whaleTransactions = latestData.v;
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = whaleTransactions;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} whale transactions: ${whaleTransactions}`);
      return whaleTransactions;
    } catch (error) {
      logger.error(`Error fetching whale transactions for ${asset}: ${error.message}`);
      return null;
    }
  }

  /**
   * MVRV Z-Score değerini getirir (Market Value / Realized Value)
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - MVRV Z-Score değeri
   */
  async getMVRVZScore(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `mvrv_z_score_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached MVRV Z-Score data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // API isteği
      const endpoint = '/indicators/mvrv_z_score';
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await axios.get(url, {
        params: {
          a: asset,
          api_key: this.glassnodeApiKey
        }
      });
      
      if (!response.data || !response.data.length) {
        logger.warn(`No MVRV Z-Score data returned for ${asset}`);
        return null;
      }
      
      // En son veriyi al
      const latestData = response.data[response.data.length - 1];
      const mvrvZScore = latestData.v;
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = mvrvZScore;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} MVRV Z-Score: ${mvrvZScore.toFixed(2)}`);
      return mvrvZScore;
    } catch (error) {
      logger.error(`Error fetching MVRV Z-Score for ${asset}: ${error.message}`);
      return null;
    }
  }

  /**
   * NVT Ratio (Network Value to Transactions Ratio) değerini getirir
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - NVT Ratio değeri
   */
  async getNVTRatio(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `nvt_ratio_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached NVT Ratio data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // API isteği
      const endpoint = '/indicators/nvt';
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await axios.get(url, {
        params: {
          a: asset,
          i: '1d',
          api_key: this.glassnodeApiKey
        }
      });
      
      if (!response.data || !response.data.length) {
        logger.warn(`No NVT Ratio data returned for ${asset}`);
        return null;
      }
      
      // En son veriyi al
      const latestData = response.data[response.data.length - 1];
      const nvtRatio = latestData.v;
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = nvtRatio;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} NVT Ratio: ${nvtRatio.toFixed(2)}`);
      return nvtRatio;
    } catch (error) {
      logger.error(`Error fetching NVT Ratio for ${asset}: ${error.message}`);
      return null;
    }
  }

  /**
   * SOPR (Spent Output Profit Ratio) değerini getirir
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - SOPR değeri
   */
  async getSOPR(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `sopr_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached SOPR data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // API isteği
      const endpoint = '/indicators/sopr';
      const url = `${this.baseUrl}${endpoint}`;
      
      const response = await axios.get(url, {
        params: {
          a: asset,
          i: '1d',
          api_key: this.glassnodeApiKey
        }
      });
      
      if (!response.data || !response.data.length) {
        logger.warn(`No SOPR data returned for ${asset}`);
        return null;
      }
      
      // En son veriyi al
      const latestData = response.data[response.data.length - 1];
      const sopr = latestData.v;
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = sopr;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} SOPR: ${sopr.toFixed(4)}`);
      return sopr;
    } catch (error) {
      logger.error(`Error fetching SOPR for ${asset}: ${error.message}`);
      return null;
    }
  }

  /**
   * Kripto varlık için temel sembol adını getirir (örn. BTCUSDT -> BTC)
   * @param {string} symbol - BTCUSDT, ETHUSDT gibi tam sembol
   * @returns {string} - BTC, ETH gibi temel varlık kısaltması
   */
  getBaseAsset(symbol) {
    // Sondaki USDT, BUSD, USDC vb. kısımları kaldır
    const baseAsset = symbol.replace(/USDT$|BUSD$|USDC$|USD$|PERP$/, '');
    
    // Desteklenen varlıklar listesinde kontrol et
    if (this.supportedAssets.includes(baseAsset)) {
      return baseAsset;
    }
    
    // Desteklenmeyen varlık için varsayılan olarak BTC döndür
    logger.warn(`Unsupported asset ${baseAsset} for onchain metrics, defaulting to BTC`);
    return 'BTC';
  }

  /**
   * Akıllı Para Sinyali - Tüm onchain metrikleri analiz ederek bir alım/satım sinyali üretir
   * @param {string} symbol - BTCUSDT, ETHUSDT gibi tam sembol
   * @returns {Object} - {signal, confidence, metrics} sinyali, güven seviyesi ve ilgili metrikleri içerir
   */
  async getSmartMoneySignal(symbol) {
    try {
      // Sembolü BTC, ETH gibi base asset'e çevir
      const baseAsset = this.getBaseAsset(symbol);
      
      // Metrikleri paralel olarak getir
      const [netFlow, whaleTransactions, mvrvZScore, nvtRatio, sopr] = await Promise.all([
        this.getExchangeNetFlow(baseAsset),
        this.getWhaleTransactions(baseAsset),
        this.getMVRVZScore(baseAsset),
        this.getNVTRatio(baseAsset),
        this.getSOPR(baseAsset)
      ]);
      
      // Tüm metriklerin skorunu hesapla (her biri -1 ile +1 arasında)
      let scores = {
        netFlow: 0,
        whaleTransactions: 0,
        mvrvZScore: 0,
        nvtRatio: 0,
        sopr: 0
      };
      
      // Exchange Net Flow skoru (negatif = borsalardan çıkış = bullish)
      if (netFlow !== null) {
        // Normalize et (tipik olarak -5000 ile +5000 arasında değerler)
        scores.netFlow = Math.max(-1, Math.min(1, -netFlow / 5000));
      }
      
      // Whale işlemleri skoru (yüksek = akümülasyon = bullish)
      if (whaleTransactions !== null) {
        // Normalize et (tipik olarak 0 ile 50 arasında değerler)
        scores.whaleTransactions = Math.max(-1, Math.min(1, (whaleTransactions - 15) / 35));
      }
      
      // MVRV Z-Score (düşük = alım fırsatı, yüksek = satım fırsatı)
      if (mvrvZScore !== null) {
        // MVRV Z-Score tipik olarak -1 ile 7 arasında değişir
        // Düşük değerler bullish, yüksek değerler bearish
        scores.mvrvZScore = Math.max(-1, Math.min(1, -mvrvZScore / 4));
      }
      
      // NVT Ratio (düşük = değerli, yüksek = aşırı değerli)
      if (nvtRatio !== null) {
        // Normalize et (tipik olarak 10 ile 100 arasında değerler)
        // Düşük değerler bullish, yüksek değerler bearish
        scores.nvtRatio = Math.max(-1, Math.min(1, -(nvtRatio - 40) / 60));
      }
      
      // SOPR (1'in altında = satanlar zararda = potansiyel dip, 1'in üstünde = satanlar kârda)
      if (sopr !== null) {
        // SOPR 1 civarında nötr, <0.9 güçlü alım sinyali, >1.2 güçlü satım sinyali
        scores.sopr = Math.max(-1, Math.min(1, (1 - sopr) * 5));
      }
      
      // Ağırlıklı ortalama skor hesapla
      const weights = {
        netFlow: 0.3,        // Güçlü sinyal
        whaleTransactions: 0.2, // Orta sinyal
        mvrvZScore: 0.25,    // Güçlü sinyal
        nvtRatio: 0.1,       // Zayıf sinyal
        sopr: 0.15           // Orta sinyal
      };
      
      let totalScore = 0;
      let totalWeight = 0;
      
      for (const [metric, score] of Object.entries(scores)) {
        if (score !== 0) {
          totalScore += score * weights[metric];
          totalWeight += weights[metric];
        }
      }
      
      // Eğer hiç veri yoksa, nötr sinyal döndür
      if (totalWeight === 0) {
        logger.warn(`No onchain metrics available for ${symbol}, returning neutral signal`);
        return { 
          signal: 'NEUTRAL', 
          confidence: 0, 
          metrics: { netFlow, whaleTransactions, mvrvZScore, nvtRatio, sopr },
          scores
        };
      }
      
      // Final skoru hesapla (-1 ile +1 arasında)
      const finalScore = totalScore / totalWeight;
      
      // Skordan sinyal ve güven seviyesi belirle
      let signal = 'NEUTRAL';
      let confidence = Math.abs(finalScore);
      
      if (finalScore > 0.3) {
        signal = 'BUY';
      } else if (finalScore < -0.3) {
        signal = 'SELL';
      }
      
      logger.info(`OnchainMetricsService smart money signal for ${symbol}: ${signal} (confidence: ${confidence.toFixed(2)}, score: ${finalScore.toFixed(2)})`);
      
      return {
        signal,
        confidence,
        metrics: { netFlow, whaleTransactions, mvrvZScore, nvtRatio, sopr },
        scores,
        finalScore
      };
    } catch (error) {
      logger.error(`Error generating smart money signal for ${symbol}: ${error.message}`);
      return { signal: 'NEUTRAL', confidence: 0, error: error.message };
    }
  }
}

module.exports = OnchainMetricsService;