// strategies/MomentumStrategy.js

const ti = require('technicalindicators');
const logger = require('../utils/logger');

class MomentumStrategy {
    constructor(config = {}) {
        // Göstergeler için ayarlar
        this.emaPeriod = config.emaPeriod || 200; // 200 EMA
        this.bbLength = config.bbLength || 20; // Bollinger Bands uzunluğu (Squeeze Momentum için)
        this.bbMult = config.bbMult || 2.0; // Bollinger Bands çarpanı
        this.kcLength = config.kcLength || 20; // Keltner Channel uzunluğu
        this.kcMult = config.kcMult || 1.5; // Keltner Channel çarpanı
        this.supportResistanceBars = config.supportResistanceBars || 15; // Destek/direnç için bar sayısı
        
        // ATR için parametreler
        this.atrPeriod = 14;
        this.atrMultiplier = 2.5; // Risk:Ödül oranı için daha yüksek
    }

    async initialize() {
        logger.info('MomentumStrategy initialized');
    }
    
    /**
     * AdaptiveStrategy tarafından beklenen generateSignal metodu
     */
    async generateSignal(candles, symbol) {
        try {
            if (!candles || candles.length < 50) {
                logger.warn(`Not enough candles for ${symbol} to generate Momentum signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Mevcut findSignal metodunu kullanarak temel sinyali al
            const baseSignal = await this.findSignal(candles);
            
            // Ek doğrulamalar yap - momentum için güçlü bir fiyat hareketi gerekir
            const lastCandle = candles[candles.length - 1];
            const prevCandle = candles[candles.length - 2];
            const lastClose = parseFloat(lastCandle.close);
            const lastHigh = parseFloat(lastCandle.high);
            const lastLow = parseFloat(lastCandle.low);
            const prevClose = parseFloat(prevCandle.close);
            
            // Fiyat hareketinin büyüklüğünü kontrol et
            const priceChange = Math.abs((lastClose - prevClose) / prevClose * 100);
            const isStrongMove = priceChange > 1.5; // %1.5'den büyük hareket
            
            // Son mumun gövde boyutunu kontrol et (kandil gücü)
            const bodySize = Math.abs(lastClose - parseFloat(lastCandle.open)) / 
                            (lastHigh - lastLow);
            const isStrongCandle = bodySize > 0.6; // Mumun %60'ından fazlası gövde
            
            // ATR hesapla (stop loss ve take profit için)
            const atr = this.calculateATR(candles, this.atrPeriod);
            
            // Tam sinyal belirle (güçlü/zayıf)
            let tradingSignal = 'NEUTRAL';
            let unmetConditions = [];
            
            if (baseSignal === 'BUY') {
                if (isStrongMove && isStrongCandle) {
                    tradingSignal = 'BUY';
                } else {
                    tradingSignal = 'WEAK_BUY';
                    if (!isStrongMove) unmetConditions.push('Weak price movement');
                    if (!isStrongCandle) unmetConditions.push('Weak candle body');
                }
            } else if (baseSignal === 'SELL') {
                if (isStrongMove && isStrongCandle) {
                    tradingSignal = 'SELL';
                } else {
                    tradingSignal = 'WEAK_SELL';
                    if (!isStrongMove) unmetConditions.push('Weak price movement');
                    if (!isStrongCandle) unmetConditions.push('Weak candle body');
                }
            }
            
            // Stop loss ve take profit hesapla
            let stopLoss, takeProfit;
            
            if (tradingSignal === 'BUY' || tradingSignal === 'WEAK_BUY') {
                stopLoss = lastClose - (atr * this.atrMultiplier);
                takeProfit = lastClose + (atr * this.atrMultiplier * 3); // 1:3 risk-ödül oranı
            } else if (tradingSignal === 'SELL' || tradingSignal === 'WEAK_SELL') {
                stopLoss = lastClose + (atr * this.atrMultiplier);
                takeProfit = lastClose - (atr * this.atrMultiplier * 3); // 1:3 risk-ödül oranı
            }
            
            // Standart pozisyon büyüklüğü
            const allocation = 100; // MarketScanner tarafından pozisyon boyutu yönetilecek
            
            logger.info(`Momentum scan for ${symbol}: Signal=${tradingSignal}, Price=${lastClose}, StopLoss=${stopLoss}, TakeProfit=${takeProfit}`);
            
            return {
                signal: tradingSignal,
                stopLoss,
                takeProfit,
                allocation,
                unmetConditions: unmetConditions.join(', ')
            };
            
        } catch (error) {
            logger.error(`Error generating Momentum signal for ${symbol}: ${error.message}`);
            
            // Hata durumunda bile son fiyata göre stop loss ve take profit hesapla
            try {
                const lastCandle = candles[candles.length - 1];
                const lastClose = parseFloat(lastCandle.close);
                const atr = this.calculateATR(candles, this.atrPeriod);
                
                // Varsayılan stop loss ve take profit değerleri
                const stopLoss = lastClose - (atr * this.atrMultiplier);
                const takeProfit = lastClose + (atr * this.atrMultiplier * 3);
                
                return {
                    signal: 'NEUTRAL',
                    stopLoss, 
                    takeProfit,
                    allocation: 100,
                    unmetConditions: 'Error calculating signal'
                };
            } catch (innerError) {
                // İç içe hata durumu
                return { signal: 'NEUTRAL' };
            }
        }
    }
    
    /**
     * Squeeze Momentum hesaplama
     */
    calculateSqueezeMomentum(candles) {
        try {
            const closes = candles.map(c => parseFloat(c.close));
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));

            // technicalindicators paketi 'STDDEV' içermeyebilir, manüel hesaplayalım
            // Bollinger Bands hesaplama
            const bbBasis = ti.SMA.calculate({ period: this.bbLength, values: closes });
            
            // Standart sapma manüel hesaplama
            const bbStdDev = [];
            for (let i = this.bbLength - 1; i < closes.length; i++) {
                const slice = closes.slice(i - this.bbLength + 1, i + 1);
                const mean = slice.reduce((a, b) => a + b, 0) / this.bbLength;
                const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / this.bbLength;
                bbStdDev.push(Math.sqrt(variance));
            }
            
            const upperBB = bbBasis.map((b, i) => b + (bbStdDev[i] || 0) * this.bbMult);
            const lowerBB = bbBasis.map((b, i) => b - (bbStdDev[i] || 0) * this.bbMult);

            // Keltner Channel hesaplama
            const kcBasis = ti.SMA.calculate({ period: this.kcLength, values: closes });
            const trueRange = [];
            for (let i = 1; i < candles.length; i++) {
                const curr = candles[i];
                const prev = candles[i-1];
                const high = parseFloat(curr.high);
                const low = parseFloat(curr.low);
                const prevClose = parseFloat(prev.close);
                trueRange.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
            }
            
            // Eğer yeterli veri yoksa
            if (trueRange.length < this.kcLength) {
                logger.warn(`Not enough data for Keltner Channels, found ${trueRange.length} true ranges, need ${this.kcLength}`);
                return { squeezeOn: false, squeezeOff: false };
            }
            
            const kcRange = ti.SMA.calculate({ period: this.kcLength, values: trueRange });
            const upperKC = [];
            const lowerKC = [];
            
            for (let i = 0; i < kcBasis.length; i++) {
                if (i < kcRange.length) {
                    upperKC.push(kcBasis[i] + kcRange[i] * this.kcMult);
                    lowerKC.push(kcBasis[i] - kcRange[i] * this.kcMult);
                }
            }

            // Verilerimizin tam olduğunu kontrol et
            if (lowerBB.length === 0 || upperBB.length === 0 || 
                lowerKC.length === 0 || upperKC.length === 0) {
                logger.warn("Insufficient data to calculate squeeze momentum");
                return { squeezeOn: false, squeezeOff: false };
            }

            // Son durumu kontrol et
            const lastIdx = Math.min(
                lowerBB.length - 1, 
                upperBB.length - 1,
                lowerKC.length - 1,
                upperKC.length - 1
            );
            
            if (lastIdx < 1) {
                logger.warn("Not enough data points to detect squeeze status");
                return { squeezeOn: false, squeezeOff: false };
            }
            
            const squeezeOn = lowerBB[lastIdx] > lowerKC[lastIdx] && upperBB[lastIdx] < upperKC[lastIdx];
            const squeezeOff = !squeezeOn && (lowerBB[lastIdx-1] > lowerKC[lastIdx-1] && upperBB[lastIdx-1] < upperKC[lastIdx-1]);

            logger.info(`Squeeze status: squeezeOn=${squeezeOn}, squeezeOff=${squeezeOff}`);
            return { squeezeOn, squeezeOff };
        } catch (error) {
            logger.error(`Error calculating squeeze momentum: ${error.message}`);
            return { squeezeOn: false, squeezeOff: false };
        }
    }

    /**
     * 200 EMA hesaplama
     */
    calculateEMA(candles) {
        const closes = candles.map(c => parseFloat(c.close));
        const emaArray = ti.EMA.calculate({ period: this.emaPeriod, values: closes });
        return emaArray.length > 0 ? emaArray[emaArray.length - 1] : undefined;
    }

    /**
     * Destek/Direnç noktalarını bulma
     */
    calculateSupportResistance(candles) {
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));

        const resistance = Math.max(...highs.slice(-this.supportResistanceBars));
        const support = Math.min(...lows.slice(-this.supportResistanceBars));

        return { resistance, support };
    }
    
    /**
     * ATR hesaplama
     */
    calculateATR(candles, period) {
        try {
            const trValues = [];
            
            // True Range değerleri hesapla
            for (let i = 1; i < candles.length; i++) {
                const currentCandle = candles[i];
                const previousCandle = candles[i - 1];
                
                const high = parseFloat(currentCandle.high);
                const low = parseFloat(currentCandle.low);
                const prevClose = parseFloat(previousCandle.close);
                
                // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
                const tr = Math.max(
                    high - low,
                    Math.abs(high - prevClose),
                    Math.abs(low - prevClose)
                );
                
                trValues.push(tr);
            }
            
            // Son 'period' sayıda değerin ortalamasını al
            const relevantTR = trValues.slice(-period);
            const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
            
            return atr;
        } catch (error) {
            logger.error('Error calculating ATR:', error);
            return 0;
        }
    }

    /**
     * Al/Sat sinyali üretme
     */
    async findSignal(candles) {
        try {
            const lastClose = parseFloat(candles[candles.length - 1].close);

            // Squeeze Momentum hesaplama
            const { squeezeOn, squeezeOff } = this.calculateSqueezeMomentum(candles);

            // 200 EMA hesaplama
            const ema = this.calculateEMA(candles);

            // Destek/Direnç hesaplama
            const { resistance, support } = this.calculateSupportResistance(candles);

            // Sinyal oluşturma
            if (squeezeOff && lastClose > ema && lastClose > resistance) {
                logger.info('BUY signal detected by Momentum Strategy (squeeze off + above EMA & resistance)');
                return 'BUY';
            }

            if (squeezeOff && lastClose < ema && lastClose < support) {
                logger.info('SELL signal detected by Momentum Strategy (squeeze off + below EMA & support)');
                return 'SELL';
            }

            // NEUTRAL durumunda da bilgi verelim
            logger.info('NEUTRAL signal from Momentum Strategy (no squeeze-off pattern detected)');
            return 'NEUTRAL';
        } catch (error) {
            logger.error('Error finding signal:', error);
            return 'NEUTRAL';
        }
    }
}

module.exports = MomentumStrategy;
