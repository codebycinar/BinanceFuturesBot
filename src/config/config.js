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
  topSymbols: ['VANAUSDT', 'MEUSDT', 'PENGUUSDT', 'THEUSDT', 'MORPHOUSDT']
};