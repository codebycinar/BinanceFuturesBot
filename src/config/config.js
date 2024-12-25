const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  timeframes: ['1m', '5m', '15m'],
  riskPerTrade: 0.02, // Risk per trade (0,5% of account)
  leverage: 10, // 10x kaldıraç
  marketScanInterval: 30000, // 30 saniye
  positionCheckInterval: 60000, // 1 dakika
  minPriceMovement: 0.0001, // Minimum fiyat hareketi
  limitOrderTolerance: 0.005, // %0.5 mesafe toleransı
  topSymbols: ['VANAUSDT', 'MEUSDT', 'PENGUUSDT', 'THEUSDT', 'MORPHOUSDT','VANRYUSDT','MOVEUSDT','NEIROUSDT','AVAXUSDT','BLURUSDT','1000PEPEUSDT','XAIUSDT','DOGEUSDT','APTUSDT','DYMUSDT','FLOWUSDT','MINAUSDT','DOTUSDT'],
  stopLossPercent: 1.5, // %0.5
  takeProfitPercents: [0.8, 1.2, 1.8], // %0.8, %1.2, %1.8

  // Trailing stop ayarları
  trailingStop: {
    use: true,
    callbackRate: 0.5, // %0.3 geri çekilmede stop
  },
};