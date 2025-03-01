// strategies/MultiTimeframeScalpingStrategy.js

class MultiTimeframeScalpingStrategy {
    constructor(config = {}) {
        // Göstergeler için ayarlar
        this.rsiPeriod = config.rsiPeriod || 14;
        this.shortMAPeriod = config.shortMAPeriod || 9;
        this.longMAPeriod = config.longMAPeriod || 21;
        this.bollingerPeriod = config.bollingerPeriod || 20;
        this.bollingerStdDev = config.bollingerStdDev || 2;
        this.macdShort = config.macdShort || 12;
        this.macdLong = config.macdLong || 26;
        this.macdSignal = config.macdSignal || 9;
        this.stochasticPeriod = config.stochasticPeriod || 14;
        this.stochasticSmoothK = config.stochasticSmoothK || 3;
        this.stochasticSmoothD = config.stochasticSmoothD || 3;

        // Linear Regression Channel Ayarları
        this.lrPeriod = config.lrPeriod || 100; // Regresyon periyodu
        this.lrScalingType = config.lrScalingType || 'Standard Deviation'; // 'Standard Deviation' veya 'ATR'
        this.lrScalingCoefficient1 = config.lrScalingCoefficient1 || 1; // Scaling Coefficient Level 1
        this.lrScalingCoefficient2 = config.lrScalingCoefficient2 || 2; // Scaling Coefficient Level 2
    }
    async initialize() {
        console.log(`MultiTimeframeScalpingStrategy Loaded `);
    }
    /**
     * 1m mumlarına bakarak trend ve sinyal üret
     */
    async findScalpingSignal(candles1m) {
        const closes = candles1m.map(c => parseFloat(c.close));
        const highs = candles1m.map(c => parseFloat(c.high));
        const lows = candles1m.map(c => parseFloat(c.low));
      
        const requiredLength = Math.max(
          this.longMAPeriod,
          this.bollingerPeriod,
          this.macdLong,
          this.stochasticPeriod,
          this.lrPeriod
        );
      
        if (closes.length < requiredLength) {
          console.log('NEUTRAL: Yetersiz veri');
          return 'NEUTRAL';
        }
      
        // EMA hesaplama
        const emaShort = this.calculateEMA(closes, this.shortMAPeriod);
        const emaLong = this.calculateEMA(closes, this.longMAPeriod);
        console.log(`EMA Short (${this.shortMAPeriod}): ${emaShort}`);
        console.log(`EMA Long (${this.longMAPeriod}): ${emaLong}`);
      
        // EMA Crossover Kontrolü
        const emaCrossover = emaShort > emaLong ? 'LONG' : emaShort < emaLong ? 'SHORT' : 'NEUTRAL';
      
        // Bollinger Bands hesaplama
        const { upperBand, lowerBand } = this.calculateBollingerBands(closes.slice(-this.bollingerPeriod));
        console.log(`Bollinger Upper Band: ${upperBand}`);
        console.log(`Bollinger Lower Band: ${lowerBand}`);
      
        // RSI hesaplama
        const rsi = this.calculateRSI(closes, this.rsiPeriod);
        console.log(`RSI (${this.rsiPeriod}): ${rsi}`);
      
        // MACD hesaplama
        const { macd, signal, histogram } = this.calculateMACD(closes, this.macdShort, this.macdLong, this.macdSignal);
        console.log(`MACD: ${macd}`);
        console.log(`MACD Signal: ${signal}`);
        console.log(`MACD Histogram: ${histogram}`);
      
        // Stochastic Oscillator hesaplama
        const { stochK, stochD } = this.calculateStochastic(highs, lows, closes, this.stochasticPeriod, this.stochasticSmoothK, this.stochasticSmoothD);
        console.log(`Stochastic %K: ${stochK}`);
        console.log(`Stochastic %D: ${stochD}`);
      
        // Linear Regression Channel Hesaplama
        const { lrMiddle, lrUpper1, lrLower1, lrUpper2, lrLower2 } = this.calculateLinearRegressionChannel(closes, this.lrPeriod, this.lrScalingType, this.lrScalingCoefficient1, this.lrScalingCoefficient2);
        console.log(`Linear Regression Middle: ${lrMiddle}`);
        console.log(`Linear Regression Upper 1: ${lrUpper1}`);
        console.log(`Linear Regression Lower 1: ${lrLower1}`);
        console.log(`Linear Regression Upper 2: ${lrUpper2}`);
        console.log(`Linear Regression Lower 2: ${lrLower2}`);
      
        const lastPrice = closes[closes.length - 1];
        console.log(`Last Price: ${lastPrice}`);
      
        // Koşulların değerlendirilmesi
        // LONG sinyali
        const isLongCondition =
          emaCrossover === 'LONG' &&
          lastPrice <= lowerBand + (upperBand - lowerBand) * 0.1 && // %10 band genişliği
          rsi < 50 && // RSI < 50
          macd > signal &&
          stochK < 30 && // %K < 30
          stochD < 30 && // %D < 30
          lastPrice < lrMiddle + (upperBand - lowerBand) * 0.05; // Fiyat, LR orta hattının biraz altında
      
        // SHORT sinyali
        const isShortCondition =
          emaCrossover === 'SHORT' &&
          lastPrice >= upperBand - (upperBand - lowerBand) * 0.1 && // %10 band genişliği
          rsi > 50 && // RSI > 50
          macd < signal &&
          stochK > 70 && // %K > 70
          stochD > 70 && // %D > 70
          lastPrice > lrMiddle - (upperBand - lowerBand) * 0.05; // Fiyat, LR orta hattının biraz üstünde
      
        if (isLongCondition) {
          console.log('Signal: LONG');
          return 'LONG';
        }
      
        if (isShortCondition) {
          console.log('Signal: SHORT');
          return 'SHORT';
        }
      
        console.log('Signal: NEUTRAL');
        return 'NEUTRAL';
      }

    /**
     * Basit EMA hesaplama
     */
    calculateEMA(closes, period) {
        const k = 2 / (period + 1);
        let ema = closes.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
        for (let i = period; i < closes.length; i++) {
            ema = closes[i] * k + ema * (1 - k);
        }
        return ema;
    }

    /**
     * Bollinger Bands hesaplama
     */
    calculateBollingerBands(closes) {
        const sum = closes.reduce((acc, val) => acc + val, 0);
        const mean = sum / closes.length;
        const variance = closes.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / closes.length;
        const stdDev = Math.sqrt(variance);

        const upperBand = mean + this.bollingerStdDev * stdDev;
        const lowerBand = mean - this.bollingerStdDev * stdDev;

        return { upperBand, lowerBand };
    }

    /**
     * Basit RSI hesaplama
     */
    calculateRSI(closes, period) {
        if (closes.length < period + 1) return 50; // yetersiz data => nötr

        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff >= 0) {
                gains += diff;
            } else {
                losses += Math.abs(diff);
            }
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period + 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff >= 0) {
                avgGain = (avgGain * (period - 1) + diff) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
            }
        }

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);
        return rsi;
    }

    /**
     * MACD hesaplama
     */
    calculateMACD(closes, shortPeriod, longPeriod, signalPeriod) {
        const emaShort = this.calculateEMA(closes, shortPeriod);
        const emaLong = this.calculateEMA(closes, longPeriod);
        const macd = emaShort - emaLong;
        const signal = this.calculateEMA([macd], signalPeriod);
        const histogram = macd - signal;
        return { macd, signal, histogram };
    }

    /**
     * Stochastic Oscillator hesaplama
     */
    calculateStochastic(highs, lows, closes, period, smoothK, smoothD) {
        const highestHigh = Math.max(...highs.slice(-period));
        const lowestLow = Math.min(...lows.slice(-period));
        const lastClose = closes[closes.length - 1];

        const stochKRaw = ((lastClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        const stochKSmooth = this.calculateEMA([stochKRaw], smoothK);
        const stochDSmooth = this.calculateEMA([stochKSmooth], smoothD);

        return { stochK: stochKSmooth, stochD: stochDSmooth };
    }

    /**
     * Doğrusal Regresyon (LR) hesaplama
     */
    calculateLinearRegression(closes) {
        const n = closes.length;
        const sumX = (n * (n - 1)) / 2; // Sum of indices 0 to n-1
        const sumY = closes.reduce((acc, val) => acc + val, 0);
        const sumXY = closes.reduce((acc, val, idx) => acc + idx * val, 0);
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - Math.pow(sumX, 2));
        const intercept = (sumY - slope * sumX) / n;

        // Ortalama fiyatı regresyon hattının son noktasına getirmek
        const lrMiddle = slope * (n - 1) + intercept;
        return lrMiddle;
    }

    /**
     * Standart Sapma Hesaplama
     */
    calculateStandardDeviation(closes, mean) {
        const variance = closes.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / closes.length;
        return Math.sqrt(variance);
    }

    /**
   * ATR Hesaplama
   */
    calculateATR(highs, lows, closes, period) {
        const trueRanges = [];
        for (let i = 1; i < closes.length; i++) {
            const tr1 = highs[i] - lows[i];
            const tr2 = Math.abs(highs[i] - closes[i - 1]);
            const tr3 = Math.abs(lows[i] - closes[i - 1]);
            const tr = Math.max(tr1, tr2, tr3);
            trueRanges.push(tr);
        }
        const atr = trueRanges.slice(-period).reduce((acc, val) => acc + val, 0) / period;
        return atr;
    }

    /**
     * Linear Regression Channel hesaplama
     */
    calculateLinearRegressionChannel(closes, period, scalingType, scalingCoefficient1, scalingCoefficient2, highs, lows) {
        const lrCloses = closes.slice(-period);
        const lrMiddle = this.calculateLinearRegression(lrCloses);

        let scaling;
        if (scalingType === 'ATR') {
            scaling = this.calculateATR(highs.slice(-period), lows.slice(-period), closes.slice(-period), period);
        } else {
            scaling = this.calculateStandardDeviation(lrCloses, lrMiddle);
        }

        const lrUpper1 = lrMiddle + scalingCoefficient1 * scaling;
        const lrLower1 = lrMiddle - scalingCoefficient1 * scaling;
        const lrUpper2 = lrMiddle + scalingCoefficient2 * scaling;
        const lrLower2 = lrMiddle - scalingCoefficient2 * scaling;

        return { lrMiddle, lrUpper1, lrLower1, lrUpper2, lrLower2 };
    }
}

module.exports = MultiTimeframeScalpingStrategy;
