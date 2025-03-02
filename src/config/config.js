const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  testnet: process.env.TESTNET === 'true', // Testnet kullanıyorsanız .env dosyasına TESTNET=true ekleyin


  strategy: {
    atrPeriod: 14, // ATR göstergesinin periyodu
    bbPeriod: 20, // Bollinger Bantlarının periyodu
    bbStdDev: 2, // Bollinger Bantları standart sapması
    stochasticPeriod: 14, // Stochastic göstergesinin periyodu
    stochasticSignalPeriod: 3, // Stochastic sinyal periyodu
    atrLookback: 21, // ATR yön kontrolü için bakılacak mum sayısı
    allocation: [0.2, 0.3, 0.5], // İlk, ikinci ve üçüncü alımlar için bütçe oranları
    timeframe: '4h', // Turtle Trading için 4h çerçevesini kullan
    limit: 100,
    keyValue: 2,               // ATR çarpanı
    riskReward: 3,             // Risk/Kar oranı
    leverage: 5,              // Kaldıraç oranı
  },
  // Risk ve ödül oranları
  riskPerTrade: 0.01, // Risk per trade (%1 of account)

  calculate_position_size: false,
  static_position_size: 100, //usdt 
  // Stop-loss ve Take-profit seviyeleri (yüzde cinsinden)
  stopLossPercent: 1, // %1 stop-loss
  takeProfitPercents: [3, 5, 7.5],

  // Trailing stop ayarları
  trailingStop: {
    use: true,
    callbackRate: 0.5, // %0.5 geri çekilmede stop
  },

  // Diğer ayarlar
  marketScanInterval: 120000, // 2 dakika
  minPriceMovement: 0.0001, // Minimum fiyat hareketi
  limitOrderTolerance: 0.005, // %0.5 mesafe toleransı
  maxOpenPositions: 15, // Açık pozisyon limiti
  topSymbols: [
    'VANAUSDT', 'MEUSDT', 'PENGUUSDT', 'THEUSDT', 'MORPHOUSDT',
    'VANRYUSDT', 'MOVEUSDT', 'NEIROUSDT', 'AVAXUSDT', 'BLURUSDT',
    '1000PEPEUSDT', 'XAIUSDT', 'DOGEUSDT', 'APTUSDT', 'DYMUSDT',
    'FLOWUSDT', 'MINAUSDT', 'DOTUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
    'ADAUSDT', 'TRXUSDT', 'LTCUSDT', 'LINKUSDT', 'XLMUSDT',
  ],
};
