// strategies/AdvancedScalpingStrategy.js

const ti = require('technicalindicators');
const logger = require('../utils/logger');

class AdvancedScalpingStrategy {
    constructor(config = {}) {
        // Göstergeler için ayarlar
        this.emaShortPeriod = config.emaShortPeriod || 9;
        this.emaLongPeriod = config.emaLongPeriod || 21;
        this.cciPeriod = config.cciPeriod || 20;
        this.adxPeriod = config.adxPeriod || 14;
        this.sarStep = config.sarStep || 0.02;
        this.sarMax = config.sarMax || 0.2;
        this.atrPeriod = config.atrPeriod || 14;

        // Risk Yönetimi Ayarları
        this.riskRewardRatio = config.riskRewardRatio || 1; // Risk/Kar Oranı

        // ADX DX Geçmişi
        this.dxHistory = [];
        
        // Tercih edilen zaman dilimi (5m, stratejideki findScalpingSignal için)
        this.preferredTimeframe = '5m';
    }

    async initialize() {
        console.log(`AdvancedScalpingStrategy Loaded `);
    }
    
    /**
     * Strateji için sinyal üretme (StrategyManager ile uyumluluk için)
     * @param {Array} candles - Mum verileri
     * @param {string} symbol - İşlem sembolü
     * @returns {Object} - Strateji sinyali
     */
    async generateSignal(candles, symbol) {
        try {
            if (!candles || candles.length < 30) {
                return { signal: 'NEUTRAL' };
            }
            
            // Scalping sinyalini hesapla
            const scalpingSignal = await this.findScalpingSignal(candles);
            
            // Son mum ve fiyat bilgileri
            const currentCandle = candles[candles.length - 1];
            const currentPrice = parseFloat(currentCandle.close);
            
            // ATR hesapla (stop-loss/take-profit için)
            const atr = this.calculateATR(candles, this.atrPeriod);
            
            // Alış/satış sinyallerini ayarla
            let signal = 'NEUTRAL';
            let stopLoss = 0;
            let takeProfit = 0;
            let allocation = 20; // Varsayılan
            
            // findScalpingSignal fonksiyonu 'LONG', 'SHORT', 'NEUTRAL' döndürdüğü için burada düzeltme yapalım
            if (scalpingSignal === 'LONG') {
                signal = 'BUY';
                stopLoss = currentPrice - (atr * 1.5);
                takeProfit = currentPrice + (atr * this.riskRewardRatio * 1.5);
            } else if (scalpingSignal === 'SHORT') {
                signal = 'SELL';
                stopLoss = currentPrice + (atr * 1.5);
                takeProfit = currentPrice - (atr * this.riskRewardRatio * 1.5);
            } else if (scalpingSignal === 'WEAK_LONG' || scalpingSignal === 'WEAK_BUY') {
                signal = 'WEAK_BUY';
                stopLoss = currentPrice - (atr * 1.5);
                takeProfit = currentPrice + (atr * this.riskRewardRatio * 1.5);
            } else if (scalpingSignal === 'WEAK_SHORT' || scalpingSignal === 'WEAK_SELL') {
                signal = 'WEAK_SELL';
                stopLoss = currentPrice + (atr * 1.5);
                takeProfit = currentPrice - (atr * this.riskRewardRatio * 1.5);
            }
            
            logger.info(`AdvancedScalpingStrategy generated ${signal} signal for ${symbol} (original: ${scalpingSignal})`);
            
            return {
                signal,
                stopLoss,
                takeProfit,
                allocation,
                indicators: {
                    atr
                }
            };
        } catch (error) {
            logger.error(`Error in AdvancedScalpingStrategy.generateSignal for ${symbol}:`, error);
            return { signal: 'NEUTRAL' };
        }
    }

    /**
     * 1m mumlarına bakarak trend ve sinyal üret
     */
    async findScalpingSignal(candles1m) {
        try {
            const closes = candles1m.map(c => parseFloat(c.close));
            const highs = candles1m.map(c => parseFloat(c.high));
            const lows = candles1m.map(c => parseFloat(c.low));

            const requiredLength = Math.max(
                this.emaLongPeriod,
                this.cciPeriod,
                this.adxPeriod,
                this.atrPeriod
            );

            if (closes.length < requiredLength) {
                console.log('NEUTRAL: Yetersiz veri');
                return 'NEUTRAL';
            }

            // Göstergeleri hesaplama
            const emaShortArray = ti.EMA.calculate({ period: this.emaShortPeriod, values: closes });
            const emaShort = emaShortArray.length > 0 ? emaShortArray[emaShortArray.length - 1] : undefined;

            const emaLongArray = ti.EMA.calculate({ period: this.emaLongPeriod, values: closes });
            const emaLong = emaLongArray.length > 0 ? emaLongArray[emaLongArray.length - 1] : undefined;

            console.log(`EMA Short (${this.emaShortPeriod}): ${emaShort}`);
            console.log(`EMA Long (${this.emaLongPeriod}): ${emaLong}`);

            // CCI hesaplama
            const cciArray = ti.CCI.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: this.cciPeriod
            });
            const cci = cciArray.length > 0 ? cciArray[cciArray.length - 1] : undefined;
            console.log(`CCI (${this.cciPeriod}): ${cci}`);

            // ADX hesaplama
            const adxArray = ti.ADX.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: this.adxPeriod
            });
            if (adxArray.length === 0 || typeof adxArray[adxArray.length - 1].adx !== 'number') {
                console.log('ADX hesaplanamadı veya geçersiz değer');
                return 'NEUTRAL';
            }
            const adx = adxArray[adxArray.length - 1].adx;
            console.log(`ADX (${this.adxPeriod}): ${adx}`);

            // Parabolic SAR hesaplama
            const sarArray = ti.PSAR.calculate({
                step: this.sarStep,
                max: this.sarMax,
                high: highs,
                low: lows
            });
            const sar = sarArray.length > 0 ? sarArray[sarArray.length - 1] : undefined;
            console.log(`Parabolic SAR: ${sar}`);

            // ATR hesaplama
            const atrArray = ti.ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: this.atrPeriod
            });
            const atr = atrArray.length > 0 ? atrArray[atrArray.length - 1] : undefined;
            console.log(`ATR (${this.atrPeriod}): ${atr}`);

            const lastPrice = closes[closes.length - 1];
            console.log(`Last Price: ${lastPrice}`);

            // Trend gücü kontrolü
            const isTrending = adx !== undefined ? adx > 15 : false; // Eşik değeri 20'den 15'e indirildi
            console.log(`Is Trending: ${isTrending}`);

            // CCI yön değişikliği kontrolü
            const isCCITurningUp = cciArray.length >= 2
                ? cciArray[cciArray.length - 1] > cciArray[cciArray.length - 2]
                : false;
            const isCCITurningDown = cciArray.length >= 2
                ? cciArray[cciArray.length - 1] < cciArray[cciArray.length - 2]
                : false;

            // EMA Crossover Kontrolü
            const emaCrossover = (emaShort !== undefined && emaLong !== undefined)
                ? (emaShort > emaLong ? 'LONG' : emaShort < emaLong ? 'SHORT' : 'NEUTRAL')
                : 'NEUTRAL';
            console.log(`EMA Crossover: ${emaCrossover}`);

            // Koşulların değerlendirilmesi
            // LONG sinyali
            const isLongCondition =
                emaCrossover === 'LONG' &&
                cci !== undefined && cci < -30 && // CCI -30'un altında
                isCCITurningUp &&
                sar !== undefined && sar < lastPrice && // SAR fiyatın altında
                isTrending;
            console.log(`Is Long Condition Met: ${isLongCondition}`);

            // SHORT sinyali
            const isShortCondition =
                emaCrossover === 'SHORT' &&
                cci !== undefined && cci > 30 && // CCI 30'un üzerinde
                isCCITurningDown &&
                sar !== undefined && sar > lastPrice && // SAR fiyatın üstünde
                isTrending;
            console.log(`Is Short Condition Met: ${isShortCondition}`);

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
        } catch (error) {
            console.error('Scalping signal error:', error);
            return 'NEUTRAL';
        }
    }
    
    /**
     * ATR (Average True Range) hesaplama
     * @param {Array} candles - Mum verileri
     * @param {number} period - ATR periyodu
     * @returns {number} - ATR değeri
     */
    calculateATR(candles, period) {
        try {
            if (!candles || candles.length < period + 1) {
                return 0;
            }
            
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));
            const closes = candles.map(c => parseFloat(c.close));
            
            // TechnicalIndicators kütüphanesini kullanarak ATR hesapla
            const atrArray = ti.ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: period
            });
            
            // Son ATR değerini döndür
            return atrArray.length > 0 ? atrArray[atrArray.length - 1] : 0;
        } catch (error) {
            console.error('Error calculating ATR:', error);
            return 0;
        }
    }
}

module.exports = AdvancedScalpingStrategy;
