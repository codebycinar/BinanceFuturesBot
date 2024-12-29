const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  testnet: process.env.TESTNET === 'true', // Testnet kullanıyorsanız .env dosyasına TESTNET=true ekleyin


  strategy: {
    atrPeriod: 14, // ATR göstergesinin periyodu
    bbPeriod: 20, // Bollinger Bantlarının periyodu
    bbStdDev: 2, // Bollinger Bantları standart sapması
    stochasticPeriod: 14, // Stochastic göstergesinin periyodu
    stochasticSignalPeriod: 3, // Stochastic sinyal periyodu
    atrLookback: 21, // ATR yön kontrolü için bakılacak mum sayısı
    allocation: [0.2, 0.3, 0.5], // İlk, ikinci ve üçüncü alımlar için bütçe oranları
    timeframe: '1h',
    limit: 100,
    keyValue: 2,               // ATR çarpanı
    riskReward: 3,             // Risk/Kar oranı
    leverage: 10,              // Kaldıraç oranı
  },
  scalpstrategy: {
    rsiPeriod: 14,
    shortMAPeriod: 9,
    longMAPeriod: 21,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    macdShort: 12,
    macdLong: 26,
    macdSignal: 9,
    stochasticPeriod: 14,
    stochasticSmoothK: 3,
    stochasticSmoothD: 3,
    lrPeriod: 100,
    lrScalingType: 'Standard Deviation', // 'Standard Deviation' veya 'ATR'
    lrScalingCoefficient1: 1,
    lrScalingCoefficient2: 2,
    emaShortPeriod: 9,
    emaLongPeriod: 21,
    cciPeriod: 20,
    adxPeriod: 14,
    sarStep: 0.02,
    sarMax: 0.2,
    atrPeriod: 14,
    riskRewardRatio: 1, // Risk/Kar Oranı
  },
  // Risk ve ödül oranları
  riskPerTrade: 0.01, // Risk per trade (%1 of account)

  calculate_position_size: false,
  static_position_size: 20, //usdt 
  // Stop-loss ve Take-profit seviyeleri (yüzde cinsinden)
  stopLossPercent: 1, // %1 stop-loss
  takeProfitPercents: [3, 5, 7.5],

  // Trailing stop ayarları
  trailingStop: {
    use: false,
    callbackRate: 0.5, // %0.5 geri çekilmede stop
  },

  // Diğer ayarlar
  marketScanInterval: 120000, // 2 dakika
  minPriceMovement: 0.0001, // Minimum fiyat hareketi
  limitOrderTolerance: 0.005, // %0.5 mesafe toleransı

  topSymbols: [
    'VANAUSDT', 'MEUSDT', 'PENGUUSDT', 'THEUSDT', 'MORPHOUSDT',
    'VANRYUSDT', 'MOVEUSDT', 'NEIROUSDT', 'AVAXUSDT', 'BLURUSDT',
    '1000PEPEUSDT', 'XAIUSDT', 'DOGEUSDT', 'APTUSDT', 'DYMUSDT',
    'FLOWUSDT', 'MINAUSDT', 'DOTUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
    'ADAUSDT', 'TRXUSDT', 'LTCUSDT', 'LINKUSDT', 'XLMUSDT',
  ],
};
