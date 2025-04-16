const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  testnet: process.env.TESTNET === 'true', // Testnet kullanıyorsanız .env dosyasına TESTNET=true ekleyin
  positionSideMode: process.env.POSITION_SIDE_MODE || 'One-Way', // 'One-Way' veya 'Hedge'
  
  // Onchain metrikler API anahtarları
  glassnodeApiKey: process.env.GLASSNODE_API_KEY || 'demo',
  cryptoQuantApiKey: process.env.CRYPTOQUANT_API_KEY || '',
  
  // Boş bırakıldığında tüm USDT futures çiftleri taranır
  topSymbols: [],
  
  // Maksimum açık pozisyon sayısı
  maxOpenPositions: 12,
  
  // Market tarama aralığı (ms)
  marketScanInterval: 5 * 60 * 1000, // 5 dakika
  
  // Etkinleştirilmiş stratejiler (tüm stratejileri yüklemek yerine whitelist kullan)
  enabledStrategies: [
    'AdaptiveStrategy',
    'HybridOnchainStrategy',
    'MomentumStrategy',
    'BollingerStrategy',
    'AdvancedScalpingStrategy'
  ],
  
  // Öncelikli strateji (her sembol için tüm stratejiler test edilecek)
  // Bu strateji pozisyon açmak için daha fazla ağırlık alacak
  primaryStrategy: 'HybridOnchainStrategy',
  
  // İkincil öncelikli strateji
  secondaryStrategy: 'AdaptiveStrategy',

  // Strateji parametreleri 
  strategy: {
    atrPeriod: 14, // ATR göstergesinin periyodu
    bbPeriod: 20, // Bollinger Bantlarının periyodu
    bbStdDev: 2, // Bollinger Bantları standart sapması
    stochasticPeriod: 14, // Stochastic göstergesinin periyodu
    stochasticSignalPeriod: 3, // Stochastic sinyal periyodu
    allocation: [0.2, 0.3, 0.5], // İlk, ikinci ve üçüncü alımlar için bütçe oranları
    timeframe: '4h', // Turtle Trading için 4h çerçevesini kullan
    keyValue: 2,               // ATR çarpanı
    riskReward: 3,             // Risk/Kar oranı
    leverage: 5,              // Kaldıraç oranı
  },
  
  // RL (Reinforcement Learning) Bot yapılandırması
  rlBot: {
    timeframe: '15m',          // RL Bot zaman dilimi (15 dakika)
    autoStart: false,          // Bot başlangıçta otomatik başlamasın
    riskPerTrade: 2.0,         // RL Bot için işlem başına risk (%2)
    maxPositions: 3,           // RL Bot için maksimum eşzamanlı pozisyon sayısı
    learningRate: 0.3,         // Öğrenme oranı (alpha)
    discountFactor: 0.7,       // Gelecekteki ödüllerin indirim faktörü (gamma)
    explorationRate: 0.2,      // Keşif oranı (epsilon)
    defaultStopLoss: 1.0,      // Varsayılan stop loss (%1)
    defaultTakeProfit: 2.0,    // Varsayılan take profit (%2)
    supportResistancePeriod: 20, // Destek/Direnç hesaplama periyodu
    modelsDirectory: 'models'  // RL modellerinin kaydedileceği dizin
  },
  
  
  // Modern Turtle Trading stratejisi özellikleri (güncellenmiş)
  turtleStrategy: {
    entryChannel: 200,    // 200 periyotluk kanal (giriş sinyali için) - modern piyasalara uyarlanmış
    exitChannel: 10,      // 10 periyotluk kanal (çıkış sinyali için)
    atrPeriod: 14,        // ATR periyodu
    riskPercentage: 1,    // Risk yüzdesi %1 (optimum değer)
    atrMultiplier: 2.5,   // Stop loss için ATR çarpanı (2'den 2.5'e yükseltildi)
    confirmationPeriod: 5, // Daha güçlü doğrulama için 5 mum
    profitMultiplier: 3,  // Risk:Ödül oranı 1:3
    timeframe: '1d',      // Günlük zaman dilimi (daha uzun trend için)
    maxEntries: 3,        // Bir pozisyon için maksimum giriş sayısı (azaltıldı)
    volumeConfirmation: true, // Hacim onayı kontrolü
    useBreakEven: true,    // Break-even kullanımını aç/kapa
    breakEvenActivationPercent: 0.8, // %0.8 kar seviyesinde aktifleştir
    adaptiveBreakout: true, // Adaptif kırılma seviyesi (piyasa koşullarına göre ayarlama)
    minStopLossPercent: 2.0 // Minimum stop loss mesafesi (1.5%'den 2.0%'ye yükseltildi)
  },
  
  // Risk ve ödül oranları
  riskPerTrade: 0.03, // Risk per trade (%1 of account)

  // Pozisyon boyutunu nasıl hesaplayacağını belirle
  calculate_position_size: true,  // true: hesaplanmış boyut, false: sabit boyut
  static_position_size: 90, // USDT cinsinden sabit pozisyon boyutu (30 USDT'nin 3 katına çıkarıldı)
  
  // Stop-loss ve Take-profit seviyeleri (yüzde cinsinden)
  stopLossPercent: 1, // %1 stop-loss
  takeProfitPercents: [3, 5, 7.5], // Çoklu TP için yüzdeler
  
  // Trailing stop ayarları
  trailingStop: {
    use: true,  // Trailing stop kullanımını aç/kapa
    callbackRate: 0.5, // %0.5 geri çekilmede stop
    activationPercent: 1.0, // %1 kar sonrası aktifleştir
  },

  // Diğer ayarlar
  marketScanInterval: 120000, // 2 dakika
  
  // RL Bot için izlenecek semboller (daha az sayıda sembolle çalışalım)
  tradingPairs: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT'
  ],
  
  // Diğer stratejiler için izlenecek semboller
  // topSymbols: [
  //   'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT',
  //   'DOGEUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT',
  //   'XRPUSDT', 'NEARUSDT', 'ATOMUSDT', 'APTUSDT', 'TRXUSDT',
  // ],
  
  // RL Bot'u otomatik başlatma ayarı
  autoStartRLBot: false,
  
  // HybridOnchainStrategy parametreleri
  hybridStrategy: {
    // Onchain metrik parametreleri
    enableOnchainMetrics: true,        // Onchain metrikleri etkinleştir
    onchainConfidenceThreshold: 0.6,   // Minimum güven seviyesi
    onchainSignalWeight: 0.4,          // Onchain sinyaller için ağırlık (0-1)
    technicalSignalWeight: 0.6,        // Teknik analiz sinyalleri için ağırlık (0-1)
    
    // Temel parametreler
    timeframe: '4h',                   // Tercih edilen zaman dilimi
    entryChannel: 15,                  // Giriş kanalı (Turtle 20 kullanıyor, daha hızlı giriş için 15)
    exitChannel: 10,                   // Çıkış kanalı
    atrPeriod: 14,                     // ATR periyodu
    
    // Pozisyon boyutlandırma
    maxAllocation: 30,                 // Maksimum pozisyon boyutu (USDT)
    baseAllocation: 20,                // Temel pozisyon boyutu (USDT)
    maxEntries: 6,                     // Maksimum pozisyon girişi
    
    // Risk yönetimi
    atrMultiplier: 2.5,                // Stop loss için ATR çarpanı (Turtle'dan daha geniş)
    profitMultiplier: 3,               // Take profit için çarpan
    useBreakEven: true,                // Break-even kullan
    breakEvenActivationPercent: 0.8    // Break-even aktivasyon yüzdesi
  }
};
