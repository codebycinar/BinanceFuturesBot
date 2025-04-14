const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  testnet: process.env.TESTNET === 'true', // Testnet kullanıyorsanız .env dosyasına TESTNET=true ekleyin
  positionSideMode: process.env.POSITION_SIDE_MODE || 'One-Way', // 'One-Way' veya 'Hedge'
  
  // Boş bırakıldığında tüm USDT futures çiftleri taranır
  topSymbols: [],
  
  // Maksimum açık pozisyon sayısı
  maxOpenPositions: 5,
  
  // Market tarama aralığı (ms)
  marketScanInterval: 5 * 60 * 1000, // 5 dakika
  
  // Ana strateji: TurtleTradingStrategy
  // Aktif olarak kullanılacak strateji
  activeStrategy: 'TurtleTradingStrategy',

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
  
  
  // Turtle Trading stratejisi özellikleri
  turtleStrategy: {
    entryChannel: 20,     // 20 periyotluk kanal (giriş sinyali için)
    exitChannel: 10,      // 10 periyotluk kanal (çıkış sinyali için)
    atrPeriod: 14,        // ATR periyodu
    riskPercentage: 1,    // Risk yüzdesi
    atrMultiplier: 2,     // Stop loss için ATR çarpanı
    confirmationPeriod: 3, // En az 3 mum gerekli kırılma doğrulaması için
    profitMultiplier: 3,  // Risk:Ödül oranını 1:3'e çıkardık
    timeframe: '4h',      // Turtle Trading için önerilen zaman dilimi
    maxEntries: 4,        // Bir pozisyon için maksimum giriş sayısı
    volumeConfirmation: true, // Hacim onayı kontrolü
    useBreakEven: true,    // Break-even kullanımını aç/kapa
    breakEvenActivationPercent: 0.8 // %0.8 kar seviyesinde aktifleştir (ATR'nin katsayısı)
  },
  
  // Risk ve ödül oranları
  riskPerTrade: 0.01, // Risk per trade (%1 of account)

  // Pozisyon boyutunu nasıl hesaplayacağını belirle
  calculate_position_size: false,  // false: sabit boyut, true: hesaplanmış boyut
  static_position_size: 100, // USDT cinsinden sabit pozisyon boyutu
  
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
  maxOpenPositions: 15, // Açık pozisyon limiti
  
  // RL Bot için izlenecek semboller (daha az sayıda sembolle çalışalım)
  tradingPairs: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT'
  ],
  
  // Diğer stratejiler için izlenecek semboller
  topSymbols: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT',
    'DOGEUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT',
    'XRPUSDT', 'NEARUSDT', 'ATOMUSDT', 'APTUSDT', 'TRXUSDT',
  ],
  
  // RL Bot'u otomatik başlatma ayarı
  autoStartRLBot: false
};
