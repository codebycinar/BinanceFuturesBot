const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  testnet: process.env.TESTNET === 'true', // Testnet kullanıyorsanız .env dosyasına TESTNET=true ekleyin
  strategy: {
    keyValue: 1, // 'a' parametresi
    atrPeriod: 10, // 'c' parametresi
    useHeikinAshi: false, // 'h' parametresi
    riskRewardRatio: 1, // Risk/Kar Oranı
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
  riskPerTrade: 0.02, // Risk per trade (%1 of account)
  leverage: 10, // 10x kaldıraç

  // Stop-loss ve Take-profit seviyeleri (yüzde cinsinden)
  stopLossPercent: 1, // %1 stop-loss
  takeProfitPercents: [1.5, 2, 2.5], // TP1: %1.5, TP2: %2, TP3: %2.5

  // Trailing stop ayarları
  trailingStop: {
    use: true,
    callbackRate: 0.5, // %0.5 geri çekilmede stop
  },

  // Diğer ayarlar
  marketScanInterval: 60000, // 1 dakika
  positionCheckInterval: 60000, // 1 dakika
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
