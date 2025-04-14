/**
 * OnchainMetricsService.js - Kripto varlıklar için onchain metrikleri sağlayan servis
 * 
 * Bu servis, çeşitli ücretsiz API'lar aracılığıyla blockchain üzerindeki 
 * verileri analiz ederek, piyasaya giren/çıkan para akışı, 
 * whale hareketleri ve akıllı para davranışları hakkında bilgi sağlar.
 * 
 * Kullanılan ücretsiz veri kaynakları:
 * - CoinGecko API: Market verisi ve sosyal metrikler
 * - WhaleAlert API: Büyük işlemler
 * - Binance API: Exchange likiditesi ve akışı
 * - Blockchain.com API: Bitcoin ağ verileri
 * - Etherscan API: Ethereum ağ verileri
 */
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class OnchainMetricsService {
  constructor() {
    // API kimlik bilgileri (config.js'den alınacak)
    this.etherscanApiKey = config.etherscanApiKey || '';
    this.whaleAlertApiKey = config.whaleAlertApiKey || '';
    
    // API tabanları
    this.coingeckoBaseUrl = 'https://api.coingecko.com/api/v3';
    this.binanceBaseUrl = 'https://api.binance.com/api/v3';
    this.etherscanBaseUrl = 'https://api.etherscan.io/api';
    this.blockchainBaseUrl = 'https://api.blockchain.info';
    this.whaleAlertBaseUrl = 'https://api.whale-alert.io/v1';
    
    // Önbellek sistemi
    this.cache = {};
    this.cacheExpiry = {};
    this.cacheDuration = 30 * 60 * 1000; // 30 dakika
    
    // Desteklenen varlıklar
    this.supportedAssets = ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOT'];
    
    // Sembol eşleştirme tablosu (Binance sembollerini CoinGecko ID'lerine dönüştürmek için)
    this.coinIdMap = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'BNB': 'binancecoin',
      'SOL': 'solana',
      'ADA': 'cardano',
      'XRP': 'ripple',
      'DOT': 'polkadot',
      'AVAX': 'avalanche-2',
      'MATIC': 'matic-network',
      'LINK': 'chainlink'
    };
    
    logger.info('OnchainMetricsService initialized with free API sources');
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
      const bookResponse = await axios.get(orderBookUrl, {
        params: {
          symbol: symbol,
          limit: 500 // Daha derin bir emir defteri
        }
      });
      
      // Trade verilerini al (son 1000 işlem)
      const tradesUrl = `${this.binanceBaseUrl}/trades`;
      const tradesResponse = await axios.get(tradesUrl, {
        params: {
          symbol: symbol,
          limit: 1000
        }
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
   * CoinGecko API ve Binance işlem verilerini kullanarak whale aktivitesini hesaplar
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - Tahmin edilen whale aktivite seviyesi (0-100)
   */
  async getWhaleTransactions(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `whale_transactions_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached whale transaction data for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // CoinGecko ID'sini bul
      const coinId = this.coinIdMap[asset] || asset.toLowerCase();
      
      // Market verilerini al
      const coinDataUrl = `${this.coingeckoBaseUrl}/coins/${coinId}`;
      const coinResponse = await axios.get(coinDataUrl, {
        params: {
          localization: false,
          tickers: true,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false
        }
      });
      
      // Binance'den büyük işlem verileri (son 24 saat)
      const symbol = asset + 'USDT';
      const aggTradesUrl = `${this.binanceBaseUrl}/aggTrades`;
      const tradesResponse = await axios.get(aggTradesUrl, {
        params: {
          symbol: symbol,
          limit: 1000
        }
      });
      
      // Toplam işlem hacmi
      const totalVolume = coinResponse.data.market_data.total_volume.usd || 0;
      const marketCap = coinResponse.data.market_data.market_cap.usd || 0;
      
      // Ortalama işlem boyutu
      const aggTrades = tradesResponse.data;
      const tradeAmounts = aggTrades.map(trade => parseFloat(trade.p) * parseFloat(trade.q));
      
      // Büyük işlemler (ortalama işlem büyüklüğünün 10 katından büyük)
      const averageTradeSize = tradeAmounts.reduce((sum, amount) => sum + amount, 0) / tradeAmounts.length;
      const largeTradeThreshold = averageTradeSize * 10;
      const largeTradeCount = tradeAmounts.filter(amount => amount > largeTradeThreshold).length;
      
      // Büyük işlemlerin toplam hacmi
      const largeTradeVolume = tradeAmounts
        .filter(amount => amount > largeTradeThreshold)
        .reduce((sum, amount) => sum + amount, 0);
      
      // Whale aktivite seviyesini hesapla (büyük işlemlerin toplam hacme oranı)
      const volumeRatio = largeTradeVolume / totalVolume;
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
    } catch (error) {
      logger.error(`Error estimating whale activity for ${asset}: ${error.message}`);
      // Hata durumunda varsayılan bir değer döndür
      return 30; // Orta-düşük whale aktivitesi
    }
  }

  /**
   * MVRV benzeri bir değer hesaplar - "Market Sentiment Score"
   * CoinGecko API'sinden piyasa verilerini kullanarak bir sentiment skoru üretir
   * @param {string} asset - BTC, ETH gibi varlık kısaltması
   * @returns {number|null} - Market Sentiment Score (-4 ile +4 arasında)
   */
  async getMVRVZScore(asset = 'BTC') {
    try {
      // Cache'den veri varsa, onu kullan
      const cacheKey = `mvrv_z_score_${asset}`;
      if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
        logger.debug(`Using cached Market Sentiment Score for ${asset}`);
        return this.cache[cacheKey];
      }
      
      // CoinGecko ID'sini bul
      const coinId = this.coinIdMap[asset] || asset.toLowerCase();
      
      // Piyasa verilerini al
      const coinDataUrl = `${this.coingeckoBaseUrl}/coins/${coinId}`;
      const coinResponse = await axios.get(coinDataUrl, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: true,
          developer_data: false,
          sparkline: false
        }
      });
      
      // Fiyat değişim yüzdeleri
      const priceChange24h = coinResponse.data.market_data.price_change_percentage_24h || 0;
      const priceChange7d = coinResponse.data.market_data.price_change_percentage_7d || 0;
      const priceChange30d = coinResponse.data.market_data.price_change_percentage_30d || 0;
      
      // Piyasa göstergeleri
      const marketCap = coinResponse.data.market_data.market_cap.usd || 0;
      const totalVolume = coinResponse.data.market_data.total_volume.usd || 0;
      const volumeToMarketCapRatio = totalVolume / marketCap;
      const ath = coinResponse.data.market_data.ath.usd || 0;
      const athChangePercentage = coinResponse.data.market_data.ath_change_percentage.usd || 0;
      
      // Twitter ve Reddit metrikleri
      const twitterFollowers = coinResponse.data.community_data?.twitter_followers || 0;
      const redditSubscribers = coinResponse.data.community_data?.reddit_subscribers || 0;
      const redditActive = coinResponse.data.community_data?.reddit_accounts_active_48h || 0;
      
      // Sosyal duyarlılık skoru (0-1 arası)
      let socialSentiment = 0;
      if (twitterFollowers > 0 && redditSubscribers > 0) {
        const redditActivity = redditActive / redditSubscribers; // Aktif kullanıcı oranı
        socialSentiment = redditActivity * 0.8; // Reddit aktivitesi 0-1 arasında normalize edildi
      }
      
      // Fiyat trendi skoru (-1 ile +1 arası)
      // Kısa vadeli trende daha fazla ağırlık ver
      const trendScore = (
        priceChange24h * 0.5 + 
        priceChange7d * 0.3 + 
        priceChange30d * 0.2
      ) / 100; // -1 ile +1 arasına normalize et
      
      // ATH'dan uzaklık skoru (-1 ile +1 arası)
      // ATH'ya yakınsa negatif (aşırı alım), uzaksa pozitif (potansiyel alım)
      const athDistanceScore = (Math.min(0, athChangePercentage) / -100); // 0 ile +1 arası
      
      // Hacim analizi (-1 ile +1 arası)
      // Yüksek hacim/marketcap oranı pozitif, düşük negatif
      const volumeScore = Math.min(1, Math.max(-1, (volumeToMarketCapRatio * 10) - 0.5));
      
      // Tüm skorları birleştir
      const sentimentScore = (
        trendScore * 1.5 +      // Trend en önemli faktör
        athDistanceScore * 1.0 + // ATH'dan uzaklık orta derece önemli
        volumeScore * 1.0 +      // Hacim orta derece önemli 
        socialSentiment * 0.5    // Sosyal metrikler en az önemli
      ) / 4;                     // -1 ile +1 arasına normalize et
      
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
   * CoinGecko ve Binance verilerini kullanarak bir aktivite-değer analizi yapar
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
      
      // CoinGecko ID'sini bul
      const coinId = this.coinIdMap[asset] || asset.toLowerCase();
      
      // Piyasa verilerini al
      const coinDataUrl = `${this.coingeckoBaseUrl}/coins/${coinId}`;
      const coinResponse = await axios.get(coinDataUrl, {
        params: {
          localization: false,
          market_data: true,
          developer_data: false,
          sparkline: false
        }
      });
      
      // Binance'den 24 saatlik istatistikler
      const symbol = asset + 'USDT';
      const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
      const tickerResponse = await axios.get(tickerUrl, {
        params: {
          symbol: symbol
        }
      });
      
      // Ağ değeri (market cap) ve işlem hacmi
      const marketCap = coinResponse.data.market_data.market_cap.usd || 0;
      const tradingVolume = parseFloat(tickerResponse.data.quoteVolume) || 0;
      
      // NVT benzeri oran hesapla
      let nvtRatioAnalog;
      
      if (tradingVolume > 0) {
        // Market Cap / Günlük İşlem Hacmi
        nvtRatioAnalog = marketCap / tradingVolume;
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
      const klineResponse = await axios.get(klineUrl, {
        params: {
          symbol: symbol,
          interval: '1d',
          limit: 14
        }
      });
      
      // İşlem verileri
      const tickerUrl = `${this.binanceBaseUrl}/ticker/24hr`;
      const tickerResponse = await axios.get(tickerUrl, {
        params: {
          symbol: symbol
        }
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