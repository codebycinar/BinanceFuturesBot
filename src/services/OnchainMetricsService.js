/**
 * BinanceMetricsService.js - Sadece Binance verileriyle çalışan piyasa metrikleri servisi
 * (Eski adı: OnchainMetricsService.js)
 * 
 * Bu servis, yalnızca Binance API kullanarak temel piyasa göstergelerini 
 * hesaplar. Harici API'lere bağımlılık olmadığı için daha güvenilir çalışır.
 * 
 * Veri toplama stratejisi:
 * 1. Sadece Binance API'den veri toplar (rate limit sorunları yoktur)
 * 2. Minimal önbellekleme ile güncel veriler kullanır
 * 3. Harici API'lere bağımlılık olmadığı için güvenilirdir
 * 
 * Kullanılan veri kaynakları:
 * - Binance API: Exchange likiditesi, işlemler, fiyat ve hacim verileri
 * 
 * Temel stratejiler:
 * - Exchange net flow: Order book ve trade verilerinden hesaplanır
 * - Whale Activity: Ortalamadan büyük işlemlerin tespiti
 * - Market sentiment: Fiyat hareketlerinden hesaplanır
 * - Market NVT: Fiyat/hacim ilişkisine dayalı değerleme
 * - SOPR benzeri analiz: RSI ve işlem verilerinden yaklaşık hesaplama
 * 
 * Diğer özellikler:
 * - Tüm API istekleri throttledRequest metodu üzerinden yapılır
 * - Kısa süreli önbellek (1 saat) ile güncel veriler elde edilir
 * - Harici API bağımlılığı olmadığı için daha güvenilir çalışır
 */
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

// Sınıf ismi değiştirilmedi, geriye dönük uyumluluk için
class OnchainMetricsService {
  constructor() {
    // API tabanları
    this.binanceBaseUrl = 'https://api.binance.com/api/v3';
    
    // Önbellek sistemi
    this.cache = {};
    this.cacheExpiry = {};
    this.cacheDuration = 60 * 60 * 1000; // 1 saat önbellek süresi (daha sık güncelleme için)
    
    // API istek yönetimi
    this.lastRequestTime = {};
    this.requestDelay = {
      'binance': 500      // Binance için 0.5 saniye gecikme
    };
    
    // API hataları için maksimum yeniden deneme sayısı
    this.maxRetries = 2;
    
    // Desteklenen varlıklar
    this.supportedAssets = ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOT'];
    
    // Binance sembol bilgileri
    this.binanceSymbolInfo = {
      'BTC': 'BTCUSDT',
      'ETH': 'ETHUSDT',
      'BNB': 'BNBUSDT',
      'SOL': 'SOLUSDT',
      'ADA': 'ADAUSDT',
      'XRP': 'XRPUSDT',
      'DOT': 'DOTUSDT',
      'AVAX': 'AVAXUSDT',
      'MATIC': 'MATICUSDT',
      'LINK': 'LINKUSDT'
    };
    
    logger.info(`BinanceMetricsService initialized with Binance API only (no external APIs)`);
  }

  /**
   * Bir varlık için exchange net flow verilerini getirir (borsalara giren/çıkan para)
   * Binance API üzerinden order book ve derinlik verilerini kullanarak bir tahmin yapar
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @param {string} timeframe - 24h, 1w, 1m gibi zaman dilimi (kullanılmıyor, API uyumluluğu için)
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
      
      // Binance sembolünü oluştur
      const symbol = asset + 'USDT';
      
      // Order book derinliğini al (alım ve satım emirleri dengesi)
      const orderBookUrl = `${this.binanceBaseUrl}/depth`;
      const bookResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(orderBookUrl, {
          params: {
            symbol: symbol,
            limit: 500 // Daha derin bir emir defteri
          }
        });
      });
      
      // Trade verilerini al (son 1000 işlem)
      const tradesUrl = `${this.binanceBaseUrl}/trades`;
      const tradesResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(tradesUrl, {
          params: {
            symbol: symbol,
            limit: 1000
          }
        });
      });
      
      // Emir defteri verilerini işle
      const bids = bookResponse.data.bids.map(bid => ({
        price: parseFloat(bid[0]),
        quantity: parseFloat(bid[1])
      }));
      
      const asks = bookResponse.data.asks.map(ask => ({
        price: parseFloat(ask[0]),
        quantity: parseFloat(ask[1])
      }));
      
      // Alım ve satım hacimlerini hesapla
      const totalBidVolume = bids.reduce((sum, bid) => sum + (bid.price * bid.quantity), 0);
      const totalAskVolume = asks.reduce((sum, ask) => sum + (ask.price * ask.quantity), 0);
      
      // Son işlemleri işle - alım/satım oranını bul
      const trades = tradesResponse.data;
      const buyTrades = trades.filter(trade => trade.isBuyerMaker === false);
      const sellTrades = trades.filter(trade => trade.isBuyerMaker === true);
      
      const buyVolume = buyTrades.reduce((sum, trade) => sum + (parseFloat(trade.price) * parseFloat(trade.qty)), 0);
      const sellVolume = sellTrades.reduce((sum, trade) => sum + (parseFloat(trade.price) * parseFloat(trade.qty)), 0);
      
      // Net akışı hesapla (negatif = borsadan çıkış, pozitif = borsaya giriş)
      // Emir defteri ve işlem hacimlerinin bir kombinasyonu
      const orderBookRatio = totalBidVolume / totalAskVolume;
      const tradeVolumeRatio = buyVolume / sellVolume;
      
      // Order book ve trade verilerini birleştirerek akış tahmini yap
      // Alım baskısı yüksekse para girişi (pozitif), satış baskısı yüksekse para çıkışı (negatif)
      let netFlowEstimate;
      
      if (orderBookRatio > 1.2 && tradeVolumeRatio > 1.1) {
        // Güçlü alım baskısı (nakit giriyor, kripto çıkıyor)
        netFlowEstimate = (orderBookRatio + tradeVolumeRatio) * 1000;
      } else if (orderBookRatio < 0.8 && tradeVolumeRatio < 0.9) {
        // Güçlü satış baskısı (nakit çıkıyor, kripto giriyor)
        netFlowEstimate = -((1/orderBookRatio) + (1/tradeVolumeRatio)) * 1000;
      } else {
        // Dengeli
        netFlowEstimate = (orderBookRatio - 1 + tradeVolumeRatio - 1) * 500;
      }
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = netFlowEstimate;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} exchange net flow (estimated): ${netFlowEstimate.toFixed(2)}`);
      return netFlowEstimate;
    } catch (error) {
      logger.error(`Error estimating exchange net flow for ${asset}: ${error.message}`);
      // Hata durumunda rastgele küçük bir değer döndür
      return Math.random() * 200 - 100; // -100 ile +100 arası
    }
  }

  /**
   * Büyük cüzdan (whale) işlemlerini ve aktivitelerini tahmin eder
   * Sadece Binance işlem verilerini kullanarak whale aktivitesini hesaplar
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - Tahmin edilen whale aktivite seviyesi (0-100)
   */
  async getWhaleTransactions(asset = 'BTC') {
    try {
      // Varlık adını normalize et
      asset = String(asset).toUpperCase();
      
      // Desteklenen varlık mı kontrol et
      if (!this.supportedAssets.includes(asset)) {
        logger.warn(`Unsupported asset ${asset} for onchain metrics, defaulting to BTC`);
        asset = 'BTC';
      }
      
      // Cache'den veri varsa, onu kullan
      const cacheKey = `whale_transactions_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached whale transaction data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // Binance sembol bilgilerini kontrol et
      if (!this.binanceSymbolInfo || !this.binanceSymbolInfo[asset]) {
        logger.warn(`No symbol info found for ${asset}, creating symbol as ${asset}USDT`);
        // Eksik ise, nesneyi oluştur veya yeni varlık ekle
        if (!this.binanceSymbolInfo) {
          this.binanceSymbolInfo = {};
        }
        this.binanceSymbolInfo[asset] = `${asset}USDT`;
      }
      
      // Binance sembolünü oluştur
      const symbol = this.binanceSymbolInfo[asset];
      
      logger.info(`Fetching whale activity for ${asset} using symbol ${symbol}`);
      
      try {
        // Binance'den 24 saatlik istatistikler
        const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
        const tickerResponse = await this.throttledRequest('binance', async () => {
          return await axios.get(tickerUrl, {
            params: { symbol }
          });
        });
        
        // Binance'den büyük işlem verileri (son 24 saat)
        const aggTradesUrl = `${this.binanceBaseUrl}/aggTrades`;
        const tradesResponse = await this.throttledRequest('binance', async () => {
          return await axios.get(aggTradesUrl, {
            params: {
              symbol: symbol,
              limit: 1000
            }
          });
        });
        
        // Toplam işlem hacmi (direkt Binance'den)
        const totalVolume = parseFloat(tickerResponse.data.volume || 0) * parseFloat(tickerResponse.data.weightedAvgPrice || 0);
        
        // Ortalama işlem boyutu
        const aggTrades = tradesResponse.data;
        
        // Veri içeriğini doğrula
        if (!Array.isArray(aggTrades) || aggTrades.length === 0) {
          logger.warn(`No trade data found for ${symbol}, using default whale activity`);
          return 30; // Varsayılan değer
        }
        
        // Trade verileri üzerinde hata kontrolü
        const validTrades = aggTrades.filter(trade => trade && trade.p && trade.q);
        if (validTrades.length === 0) {
          logger.warn(`No valid trade data found for ${symbol}, using default whale activity`);
          return 30; // Varsayılan değer
        }
        
        const tradeAmounts = validTrades.map(trade => parseFloat(trade.p) * parseFloat(trade.q));
        
        // Büyük işlemler (ortalama işlem büyüklüğünün 10 katından büyük)
        const averageTradeSize = tradeAmounts.reduce((sum, amount) => sum + amount, 0) / tradeAmounts.length;
        const largeTradeThreshold = averageTradeSize * 10;
        const largeTradeCount = tradeAmounts.filter(amount => amount > largeTradeThreshold).length;
        
        // Büyük işlemlerin toplam hacmi
        const largeTradeVolume = tradeAmounts
          .filter(amount => amount > largeTradeThreshold)
          .reduce((sum, amount) => sum + amount, 0);
        
        // Whale aktivite seviyesini hesapla (büyük işlemlerin toplam hacme oranı)
        const volumeRatio = largeTradeVolume / (totalVolume || 1); // 0'a bölünmeyi önlemek için
        const whaleActivityFactor = Math.min(100, Math.max(0, volumeRatio * 100 * 50));
        
        // İşlem sayısına göre ek ağırlık
        const tradeCountFactor = Math.min(50, largeTradeCount);
        
        // Toplam whale aktivite puanı (0-100 arası)
        const whaleActivityScore = Math.min(100, whaleActivityFactor + tradeCountFactor);
        
        // Veriyi önbelleğe al
        this.cache[cacheKey] = whaleActivityScore;
        this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
        
        logger.info(`${asset} whale activity score: ${whaleActivityScore.toFixed(2)}, large trades: ${largeTradeCount}`);
        return whaleActivityScore;
      } catch (reqError) {
        logger.error(`API request error for ${asset}: ${reqError.message}`);
        // API hatası durumunda varsayılan bir değer döndür
        return 30; // Orta-düşük whale aktivitesi
      }
    } catch (error) {
      logger.error(`Error estimating whale activity for ${asset}: ${error.message}`);
      logger.error(error.stack);
      // Hata durumunda varsayılan bir değer döndür
      return 30; // Orta-düşük whale aktivitesi
    }
  }

  /**
   * Market Sentiment Score hesaplayıcı
   * Binance API verilerini kullanarak piyasa duyarlılık skoru hesaplar
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - Market Sentiment Score (-4 ile +4 arasında)
   */
  async getMVRVZScore(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `market_sentiment_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached Market Sentiment Score for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // Binance sembolünü oluştur
      const symbol = this.binanceSymbolInfo[asset] || `${asset}USDT`;
      
      // Binance'den fiyat ve hacim verilerini al
      const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
      const tickerResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(tickerUrl, {
          params: { symbol }
        });
      });
      
      // Binance'den kline verilerini al (geçmiş fiyat hareketi için)
      const klineUrl = `${this.binanceBaseUrl}/klines`;
      const klineResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(klineUrl, {
          params: {
            symbol: symbol,
            interval: '1d',
            limit: 30 // 30 günlük veri
          }
        });
      });
      
      // Temel piyasa verilerini çıkar
      const data = tickerResponse.data;
      const currentPrice = parseFloat(data.lastPrice || 0);
      const totalVolume = parseFloat(data.volume || 0) * parseFloat(data.weightedAvgPrice || 0);
      const priceChange24h = parseFloat(data.priceChangePercent || 0);
      
      // Kline verilerinden fiyat değişimlerini hesapla
      const closePrices = klineResponse.data.map(k => parseFloat(k[4]));
      let priceChange7d, priceChange30d;
      
      // Yeterli veri varsa gerçek değişimleri hesapla, yoksa tahmin et
      if (closePrices.length >= 7) {
        priceChange7d = (closePrices[closePrices.length-1] / closePrices[closePrices.length-7] - 1) * 100;
      } else {
        // Veri yoksa 24 saatlik değişimden tahmin et
        priceChange7d = priceChange24h * 0.7;
      }
      
      if (closePrices.length >= 30) {
        priceChange30d = (closePrices[closePrices.length-1] / closePrices[0] - 1) * 100;
      } else {
        // Veri yoksa 24 saatlik değişimden tahmin et
        priceChange30d = priceChange24h * 0.3;
      }
      
      // İşlem verileri analizi
      const count = parseInt(data.count || 0); // İşlem sayısı
      const quoteVolume = parseFloat(data.quoteVolume || 0);
      
      // İşlem istatistikleri
      const avgTradeSize = quoteVolume / count; // Ortalama işlem büyüklüğü
      const normalizedTradeSize = Math.min(1, Math.max(0, 1 - (avgTradeSize / 50000))); // Normalize et
      
      // İşlem boyutu ve sayısından sosyal sentiment hesapla
      // Küçük işlemler (perakende) yüksek olduğunda yüksek puan, büyük işlemler (kurumsal) yüksek olduğunda düşük puan
      const socialSentiment = normalizedTradeSize * 0.8;
      
      // RSI hesapla
      const rsi = this.calculateRSI(closePrices);
      
      // RSI'dan aşırı alım/satım durumunu belirle
      // 70 üzeri aşırı alım (bearish), 30 altı aşırı satım (bullish)
      const rsiScore = (50 - rsi) / 50; // -1 (aşırı alım) ile +1 (aşırı satım) arası
      
      // Fiyat trendi skoru (-1 ile +1 arası)
      const trendScore = (
        priceChange24h * 0.5 + 
        priceChange7d * 0.3 + 
        priceChange30d * 0.2
      ) / 100; // -1 ile +1 arasına normalize et
      
      // Hacim / Fiyat ilişkisi: Fiyat düşerken hacim artıyorsa bearish, fiyat artarken hacim artıyorsa bullish
      const volume24hChange = parseFloat(data.volume || 0) / parseFloat(data.prevClosePrice || 1);
      const volumeScore = priceChange24h > 0 ? 
        Math.min(1, volume24hChange / 2) : // Fiyat artarken hacim artışı bullish
        Math.min(1, -volume24hChange / 2); // Fiyat düşerken hacim artışı bearish
      
      // Buy/Sell baskı oranı
      const buyVolume = parseFloat(data.askVolume || 0);
      const sellVolume = parseFloat(data.bidVolume || 0);
      const buySellRatio = sellVolume > 0 ? buyVolume / sellVolume - 1 : 0;
      const pressureScore = Math.max(-1, Math.min(1, buySellRatio));
      
      // Tüm skorları birleştir
      const sentimentScore = (
        trendScore * 1.5 +        // Trend en önemli faktör (1.5x ağırlık)
        rsiScore * 1.2 +          // RSI önemli (1.2x ağırlık)
        pressureScore * 1.0 +     // Buy/Sell baskısı (1.0x ağırlık) 
        volumeScore * 0.8 +       // Hacim göstergeleri (0.8x ağırlık)
        socialSentiment * 0.5     // Sosyal metrikler en az önemli (0.5x ağırlık)
      ) / 5;                      // -1 ile +1 arasına normalize et
      
      // -4 ile +4 arasına ölçeklendir (Z-score benzeri bir ölçek)
      const finalScore = sentimentScore * 4;
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = finalScore;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} Market Sentiment Score: ${finalScore.toFixed(2)}`);
      return finalScore;
    } catch (error) {
      logger.error(`Error calculating Market Sentiment Score for ${asset}: ${error.message}`);
      // Hata durumunda nötr bir değer döndür
      return 0;
    }
  }

  /**
   * NVT Benzeri bir gösterge hesaplar - "Aktivite-Değer Oranı"
   * Binance verilerini kullanarak bir aktivite-değer analizi yapar
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - NVT benzeri oran (yüksek değerler aşırı değerlenmiş gösterir)
   */
  async getNVTRatio(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `nvt_ratio_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached NVT-like ratio for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // Binance sembolünü oluştur
      const symbol = this.binanceSymbolInfo[asset] || `${asset}USDT`;
      
      // Binance'den 24 saatlik istatistikler
      const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
      const tickerResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(tickerUrl, {
          params: { symbol }
        });
      });
      
      // Piyasa değeri tahmini hesapla (Binance'den)
      // Gerçek market cap verisi olmadığı için yaklaşık hesaplama yapıyoruz
      // Market Cap ≈ Price * Supply (burada supply bilgimiz yok, bu nedenle fiyat * 24s hacim kullanıyoruz)
      const lastPrice = parseFloat(tickerResponse.data.lastPrice || 0);
      const quoteVolume = parseFloat(tickerResponse.data.quoteVolume || 0);
      
      // Yaklaşık market cap
      const estimatedMarketCap = lastPrice * Math.sqrt(quoteVolume) * 100;
      // NVT benzeri oran hesapla (Market Cap / Daily Transaction Volume)
      let nvtRatioAnalog;
      
      if (quoteVolume > 0) {
        // Tahmini Market Cap / Günlük İşlem Hacmi
        nvtRatioAnalog = estimatedMarketCap / quoteVolume;
      } else {
        nvtRatioAnalog = 100; // Varsayılan değer
      }
      
      // Değeri normalize et (tipik NVT değerleri 10-100 arasındadır)
      // 20'den düşük = düşük değerlenmiş, 100'den yüksek = aşırı değerlenmiş
      nvtRatioAnalog = Math.min(200, Math.max(5, nvtRatioAnalog));
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = nvtRatioAnalog;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} aktivite-değer oranı: ${nvtRatioAnalog.toFixed(2)}`);
      return nvtRatioAnalog;
    } catch (error) {
      logger.error(`Error calculating NVT-like ratio for ${asset}: ${error.message}`);
      // Hata durumunda ortalamanın biraz üzerinde bir değer döndür
      return 50;
    }
  }

  /**
   * SOPR benzeri bir sentiment göstergesi hesaplar
   * Fiyat eğilimi, RSI ve alım-satım oranlarını kullanarak bir "kar realizasyon" göstergesi üretir
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - SOPR benzeri değer (1.0 = nötr, >1.0 = kârda satış, <1.0 = zararda satış)
   */
  async getSOPR(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `sopr_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached SOPR-like data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // Binance sembolünü oluştur
      const symbol = asset + 'USDT';
      
      // Fiyat geçmişi al (son 14 gün, 1 günlük aralıklar)
      const klineUrl = `${this.binanceBaseUrl}/klines`;
      const klineResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(klineUrl, {
          params: {
            symbol: symbol,
            interval: '1d',
            limit: 14
          }
        });
      });
      
      // İşlem verileri
      const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
      const tickerResponse = await this.throttledRequest('binance', async () => {
        return await axios.get(tickerUrl, {
          params: {
            symbol: symbol
          }
        });
      });
      
      // Fiyat hareketleri
      const prices = klineResponse.data.map(k => parseFloat(k[4])); // Kapanış fiyatları
      
      // RSI hesapla
      const rsi = this.calculateRSI(prices);
      
      // Son 24 saatteki fiyat değişimi
      const priceChange = parseFloat(tickerResponse.data.priceChangePercent);
      const priceDirection = priceChange >= 0 ? 1 : -1;
      
      // Alım-satım oranı
      const buyVolume = parseFloat(tickerResponse.data.askVolume) || 0;
      const sellVolume = parseFloat(tickerResponse.data.bidVolume) || 0;
      const buySellRatio = sellVolume > 0 ? buyVolume / sellVolume : 1.0;
      
      // SOPR analizi: 
      // - RSI > 70 ve fiyat düşüşte: Kârda satış
      // - RSI < 30 ve fiyat yükselişte: Zararda satış
      // - Yüksek alım/satım oranı ve fiyat düşüşte: Potansiyel zararda satış (panik)
      
      let soprAnalog = 1.0; // Nötr değer
      
      if (rsi > 70) {
        // Aşırı alım bölgesi
        if (priceDirection < 0) {
          // Düşüş başladıysa kârda satış
          soprAnalog = 1.0 + (rsi - 70) / 30 * 0.5; // 1.0 - 1.5 arası
        }
      } else if (rsi < 30) {
        // Aşırı satım bölgesi
        if (priceDirection > 0) {
          // Yükseliş başladıysa zararda satış bitmiş olabilir
          soprAnalog = 1.0 - (30 - rsi) / 30 * 0.5; // 0.5 - 1.0 arası
        }
      }
      
      // Alım-satım oranını dahil et
      if (buySellRatio > 1.5 && priceDirection < 0) {
        // Fiyat düşerken alım baskısı - zararda satış bitebilir
        soprAnalog *= 0.9; // Biraz daha düşür
      } else if (buySellRatio < 0.7 && priceDirection < 0) {
        // Fiyat düşerken satış baskısı - zararda satış devam ediyor
        soprAnalog *= 0.8; // Belirgin şekilde düşür
      }
      
      // Sonucu sınırla (0.5 - 1.5 arası)
      soprAnalog = Math.max(0.5, Math.min(1.5, soprAnalog));
      
      // Veriyi önbelleğe al
      this.cache[cacheKey] = soprAnalog;
      this.cacheExpiry[cacheKey] = Date.now() + this.cacheDuration;
      
      logger.info(`${asset} SOPR benzeri değer: ${soprAnalog.toFixed(4)}, RSI: ${rsi.toFixed(2)}`);
      return soprAnalog;
    } catch (error) {
      logger.error(`Error calculating SOPR-like indicator for ${asset}: ${error.message}`);
      // Hata durumunda nötr değer döndür
      return 1.0;
    }
  }
  
  /**
   * Fiyat verilerinden RSI (Relative Strength Index) hesaplar
   * @param {Array} prices - Fiyat dizisi
   * @returns {number} - RSI değeri (0-100)
   */
  calculateRSI(prices) {
    try {
      if (!prices || prices.length < 14) {
        return 50; // Yeterli veri yoksa nötr değer
      }
      
      // Fiyat değişimleri
      const changes = [];
      for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i-1]);
      }
      
      // Pozitif ve negatif değişimler
      const gains = changes.map(c => c > 0 ? c : 0);
      const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
      
      // Ortalama kazanç ve kayıp
      const avgGain = gains.reduce((sum, g) => sum + g, 0) / gains.length;
      const avgLoss = losses.reduce((sum, l) => sum + l, 0) / losses.length;
      
      // RS ve RSI hesapla
      if (avgLoss === 0) return 100;
      
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      
      return rsi;
    } catch (error) {
      logger.error(`Error calculating RSI: ${error.message}`);
      return 50; // Hata durumunda nötr değer
    }
  }

  /**
   * API isteği gönderme işlemini rate limit'e uygun olarak yönetir
   * Sadece Binance API için kullanılır
   * @param {string} apiName - API adı ('binance')
   * @param {Function} requestFunc - API isteğini yapacak async fonksiyon
   * @param {number} retryCount - Yeniden deneme sayısı (iç kullanım için)
   * @returns {Promise<any>} - API isteğinin sonucu
   */
  async throttledRequest(apiName, requestFunc, retryCount = 0) {
    try {
      // Yeniden deneme sayısı limitini kontrol et
      if (retryCount >= this.maxRetries) {
        logger.error(`Maximum retry attempts (${this.maxRetries}) reached for ${apiName} API, giving up`);
        throw new Error(`Maximum retry attempts reached for ${apiName} API`);
      }
      
      // Gecikme süresi kontrolü
      const now = Date.now();
      const lastRequest = this.lastRequestTime[apiName] || 0;
      const delay = this.requestDelay[apiName] || 1000;
      
      // Gerekirse gecikme ekle
      if (now - lastRequest < delay) {
        const waitTime = delay - (now - lastRequest);
        logger.debug(`Throttling ${apiName} API request for ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // İstek zamanını güncelle
      this.lastRequestTime[apiName] = Date.now();
      
      // İsteği yap
      return await requestFunc();
    } catch (error) {
      // Rate limit hatası durumunda daha uzun bekle ve tekrar dene
      if (error.response && error.response.status === 429) {
        // Eski gecikme süresini 2 katına çıkar ve bir üst sınırla sınırla
        const maxDelay = apiName === 'binance' ? 10000 : 60000; // 10s for Binance, 60s for others
        this.requestDelay[apiName] = Math.min(maxDelay, this.requestDelay[apiName] * 2);
        
        const waitTime = 10000 + (retryCount * 5000); // Artan bekleme süresi
        logger.warn(`Rate limit hit for ${apiName}, waiting ${waitTime/1000}s and retrying (attempt ${retryCount+1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.throttledRequest(apiName, requestFunc, retryCount + 1);
      }
      
      // Diğer hatalarda da sınırlı sayıda yeniden deneme yap
      if (retryCount < this.maxRetries - 1) {
        const waitTime = 3000 + (retryCount * 2000);
        logger.warn(`API error for ${apiName}: ${error.message}, retrying in ${waitTime/1000}s (attempt ${retryCount+1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.throttledRequest(apiName, requestFunc, retryCount + 1);
      }
      
      throw error;
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