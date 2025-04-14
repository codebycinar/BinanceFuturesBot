// strategies/UTBotStrategy.js

const ti = require('technicalindicators');

class UTBotStrategy {""
    constructor(config = {}) {
        // Göstergeler için ayarlar
        this.keyValue = config.keyValue || 1; // 'a' parametresi
        this.atrPeriod = config.atrPeriod || 10; // 'c' parametresi
        this.useHeikinAshi = config.useHeikinAshi || false; // 'h' parametresi

        // ATR Trailing Stop başlangıç değeri
        this.xATRTrailingStop = 0.0;

        // Önceki pozisyon
        this.pos = 0;
    }

    async initialize() {
        console.log(`UTBotStrategy Loaded `);
    }

    /**
     * Heikin Ashi mumlarını hesaplama
     */
    calculateHeikinAshi(candles) {
        const heikinAshi = candles.map((candle, index) => {
            if (index === 0) {
                return {
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume,
                    timestamp: candle.timestamp
                };
            }
            const prevHA = heikinAshi[index - 1];
            const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
            const haOpen = (prevHA.open + prevHA.close) / 2;
            const haHigh = Math.max(candle.high, haOpen, haClose);
            const haLow = Math.min(candle.low, haOpen, haClose);
            return {
                open: haOpen,
                high: haHigh,
                low: haLow,
                close: haClose,
                volume: candle.volume,
                timestamp: candle.timestamp
            };
        });
        return heikinAshi;
    }

    /**
     * Sinyal üretme fonksiyonu
     */
    async generateSignal(candles) {
        try {
            // Heikin Ashi kullanılıyorsa hesapla
            let srcCandles = candles;
            if (this.useHeikinAshi) {
                srcCandles = this.calculateHeikinAshi(candles);
            }

            const closes = srcCandles.map(c => parseFloat(c.close));
            const highs = srcCandles.map(c => parseFloat(c.high));
            const lows = srcCandles.map(c => parseFloat(c.low));

            // ATR hesaplama
            const atr = ti.ATR.calculate({ period: this.atrPeriod, high: highs, low: lows, close: closes });
            if (atr.length === 0) {
                console.log('ATR hesaplanamadı.');
                return 'NEUTRAL';
            }
            const xATR = atr[atr.length - 1];
            const nLoss = this.keyValue * xATR;

            // ATR Trailing Stop hesaplama
            const lastPrice = closes[closes.length - 1];
            const prevTrailingStop = this.xATRTrailingStop || lastPrice;

            if (lastPrice > prevTrailingStop && closes[closes.length - 2] > prevTrailingStop) {
                this.xATRTrailingStop = Math.max(prevTrailingStop, lastPrice - nLoss);
            } else if (lastPrice < prevTrailingStop && closes[closes.length - 2] < prevTrailingStop) {
                this.xATRTrailingStop = Math.min(prevTrailingStop, lastPrice + nLoss);
            } else if (lastPrice > prevTrailingStop) {
                this.xATRTrailingStop = lastPrice - nLoss;
            } else {
                this.xATRTrailingStop = lastPrice + nLoss;
            }

            // EMA hesaplama (EMA periyodu 1, yani son kapanış fiyatı)
            const ema = ti.EMA.calculate({ period: 1, values: closes });
            const currentEMA = ema.length > 0 ? ema[ema.length - 1] : closes[closes.length - 1];

            // EMA Crossover
            const prevEMA = ema.length > 1 ? ema[ema.length - 2] : closes[closes.length - 2];
            const above = (prevEMA <= this.xATRTrailingStop) && (currentEMA > this.xATRTrailingStop);
            const below = (prevEMA >= this.xATRTrailingStop) && (currentEMA < this.xATRTrailingStop);

            // CCI hesaplama
            const cci = ti.CCI.calculate({ period: 20, high: highs, low: lows, close: closes });
            const currentCCI = cci.length > 0 ? cci[cci.length - 1] : 0;

            // ADX hesaplama
            const adxArray = ti.ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
            const currentADX = adxArray.length > 0 ? adxArray[adxArray.length - 1].adx : 0;

            // Trend kontrolü
            const isTrending = currentADX > 15;

            // CCI yön değişikliği
            const isCCITurningUp = cci.length >= 2 ? cci[cci.length - 1] > cci[cci.length - 2] : false;
            const isCCITurningDown = cci.length >= 2 ? cci[cci.length - 1] < cci[cci.length - 2] : false;

            // EMA Crossover Durumu
            const emaCrossover = currentEMA > this.xATRTrailingStop ? 'LONG' :
                                  currentEMA < this.xATRTrailingStop ? 'SHORT' : 'NEUTRAL';

            // Alım ve Satım Koşulları
            const buy = currentEMA > this.xATRTrailingStop && above && currentCCI < -30 && isCCITurningUp && isTrending;
            const sell = currentEMA < this.xATRTrailingStop && below && currentCCI > 30 && isCCITurningDown && isTrending;

            // Sinyalleri Dön
            if (buy) {
                return 'BUY';
            } else if (sell) {
                return 'SELL';
            } else {
                return 'NEUTRAL';
            }

        } catch (error) {
            console.error('Error in UTBotStrategy:', error);
            return 'NEUTRAL';
        }
    }
}

module.exports = UTBotStrategy;
