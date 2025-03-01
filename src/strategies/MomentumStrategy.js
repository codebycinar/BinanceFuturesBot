// strategies/AdvancedScalpingStrategy.js

const ti = require('technicalindicators');

class AdvancedScalpingStrategy {
    constructor(config = {}) {
        // Göstergeler için ayarlar
        this.emaPeriod = config.emaPeriod || 200; // 200 EMA
        this.bbLength = config.bbLength || 20; // Bollinger Bands uzunluğu (Squeeze Momentum için)
        this.bbMult = config.bbMult || 2.0; // Bollinger Bands çarpanı
        this.kcLength = config.kcLength || 20; // Keltner Channel uzunluğu
        this.kcMult = config.kcMult || 1.5; // Keltner Channel çarpanı
        this.supportResistanceBars = config.supportResistanceBars || 15; // Destek/direnç için bar sayısı
    }

    async initialize() {
        console.log(`AdvancedScalpingStrategy Loaded `);
    }
    /**
     * Squeeze Momentum hesaplama
     */
    calculateSqueezeMomentum(candles) {
        const closes = candles.map(c => parseFloat(c.close));
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));

        // Bollinger Bands hesaplama
        const bbBasis = ti.SMA.calculate({ period: this.bbLength, values: closes });
        const bbStdDev = ti.STDDEV.calculate({ period: this.bbLength, values: closes });
        const upperBB = bbBasis.map((b, i) => b + (bbStdDev[i] || 0) * this.bbMult);
        const lowerBB = bbBasis.map((b, i) => b - (bbStdDev[i] || 0) * this.bbMult);

        // Keltner Channel hesaplama
        const kcBasis = ti.SMA.calculate({ period: this.kcLength, values: closes });
        const trueRange = candles.map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - c.close), Math.abs(c.low - c.close)));
        const kcRange = ti.SMA.calculate({ period: this.kcLength, values: trueRange });
        const upperKC = kcBasis.map((k, i) => k + (kcRange[i] || 0) * this.kcMult);
        const lowerKC = kcBasis.map((k, i) => k - (kcRange[i] || 0) * this.kcMult);

        const squeezeOn = lowerBB.every((lb, i) => lb > (lowerKC[i] || 0)) && upperBB.every((ub, i) => ub < (upperKC[i] || 0));
        const squeezeOff = lowerBB.some((lb, i) => lb < (lowerKC[i] || 0)) && upperBB.some((ub, i) => ub > (upperKC[i] || 0));

        return { squeezeOn, squeezeOff };
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
                console.log('BUY signal detected');
                return 'BUY';
            }

            if (squeezeOff && lastClose < ema && lastClose < support) {
                console.log('SELL signal detected');
                return 'SELL';
            }

            console.log('NEUTRAL signal detected');
            return 'NEUTRAL';
        } catch (error) {
            console.error('Error finding signal:', error);
            return 'NEUTRAL';
        }
    }
}

module.exports = AdvancedScalpingStrategy;
