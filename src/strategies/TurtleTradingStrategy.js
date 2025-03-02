// TurtleTradingStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');

class TurtleTradingStrategy {
    constructor(config = {}) {
        this.parameters = {
            entryChannel: 20,    // 20 periyotluk kanal (giriş sinyali için)
            exitChannel: 10,     // 10 periyotluk kanal (çıkış sinyali için)
            atrPeriod: 14,       // ATR periyodu
            riskPercentage: 1,   // Risk yüzdesi
            atrMultiplier: 2,    // Stop loss için ATR çarpanı
            confirmationPeriod: 3, // En az 3 mum gerekli kırılma doğrulaması için
            profitMultiplier: 3   // Risk:Ödül oranını 1:3'e çıkardık
        };
        
        // 4 saatlik zaman dilimini kullanacağız
        this.preferredTimeframe = config.strategy.timeframe || '4h';
    }
    
    async initialize() {
        try {
            // Veritabanından parametreleri yükleme
            const strategy = await Strategy.findOne({ where: { name: 'TurtleTradingStrategy' } });
            if (strategy) {
                this.parameters = { ...this.parameters, ...strategy.parameters };
            }
            
            logger.info('Turtle Trading Strategy initialized with parameters:', this.parameters);
        } catch (error) {
            logger.error('Error initializing Turtle Trading Strategy:', error);
        }
    }
    
    async generateSignal(candles, symbol) {
        try {
            if (!candles || candles.length < this.parameters.entryChannel + 10) {
                logger.warn(`Not enough candles for ${symbol} to generate Turtle Trading signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Donchian Kanallarını hesapla
            const entryDonchian = this.calculateDonchianChannel(candles, this.parameters.entryChannel);
            const exitDonchian = this.calculateDonchianChannel(candles, this.parameters.exitChannel);
            
            // ATR hesapla
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            
            // Trend analizi için basit bir hareketli ortalama
            const sma50 = this.calculateSMA(candles, 50);
            const sma200 = this.calculateSMA(candles, 200);
            
            // Son fiyatlar
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const previousPrice = parseFloat(candles[candles.length - 2].close);
            const isUptrend = currentPrice > sma50 && sma50 > sma200;
            const isDowntrend = currentPrice < sma50 && sma50 < sma200;
            
            // Kırılma sinyalleri için gelişmiş kontrol
            let breakoutHigh = false;
            let breakoutLow = false;
            
            // Kırılmanın doğrulanması için son birkaç mum kontrolü
            const confirmationPeriod = this.parameters.confirmationPeriod;
            
            // Yukarı kırılma kontrolü - birden fazla mum kırılma üstünde olmalı
            if (previousPrice <= entryDonchian.upper && currentPrice > entryDonchian.upper) {
                // Son mumların kaç tanesi yüksek seviyeye yakın kapanmış?
                let highCloseCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    if (parseFloat(candles[i].close) > entryDonchian.upper * 0.99) {
                        highCloseCount++;
                    }
                }
                breakoutHigh = highCloseCount >= confirmationPeriod / 2;
            }
            
            // Aşağı kırılma kontrolü - birden fazla mum kırılma altında olmalı
            if (previousPrice >= entryDonchian.lower && currentPrice < entryDonchian.lower) {
                // Son mumların kaç tanesi düşük seviyeye yakın kapanmış?
                let lowCloseCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    if (parseFloat(candles[i].close) < entryDonchian.lower * 1.01) {
                        lowCloseCount++;
                    }
                }
                breakoutLow = lowCloseCount >= confirmationPeriod / 2;
            }
            
            // Hacim doğrulaması ekle
            const volumeConfirmation = this.checkVolumeConfirmation(candles);
            
            // Çıkış sinyalleri için kontrol
            const exitLong = currentPrice < exitDonchian.lower;
            const exitShort = currentPrice > exitDonchian.upper;
            
            // Turtle Trading için pozisyon büyüklüğü hesaplama (ATR-based position sizing)
            const dollarRisk = config.calculate_position_size 
                ? config.riskPerTrade * config.accountSize 
                : config.static_position_size;
                
            const riskPerUnit = atr * this.parameters.atrMultiplier;
            const units = dollarRisk / riskPerUnit;
            const allocation = units * currentPrice;
            
            // Turtle Trading'e göre stop loss ve take profit hesaplama
            let stopLoss, takeProfit;
            let signal = 'NEUTRAL';
            let unmetConditions = [];
            
            // Trend ile uyumlu işlemleri tercih et
            if (breakoutHigh && volumeConfirmation) {
                if (isUptrend) {
                    // Long pozisyon sinyali
                    signal = 'BUY';
                    stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                    // Risk:Ödül oranını 1:3'e yükselttik
                    takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    
                    logger.info(`Turtle Trading LONG signal for ${symbol} at ${currentPrice}`);
                    logger.info(`Donchian Upper Breakout: ${entryDonchian.upper} with volume confirmation`);
                } else {
                    // Trend ile uyumlu değil, zayıf sinyal
                    signal = 'WEAK_BUY';
                    stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    unmetConditions.push('Trend not confirmed (price below SMA50/SMA200)');
                }
            } else if (breakoutLow && volumeConfirmation) {
                if (isDowntrend) {
                    // Short pozisyon sinyali
                    signal = 'SELL';
                    stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                    // Risk:Ödül oranını 1:3'e yükselttik
                    takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    
                    logger.info(`Turtle Trading SHORT signal for ${symbol} at ${currentPrice}`);
                    logger.info(`Donchian Lower Breakout: ${entryDonchian.lower} with volume confirmation`);
                } else {
                    // Trend ile uyumlu değil, zayıf sinyal
                    signal = 'WEAK_SELL';
                    stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    unmetConditions.push('Trend not confirmed (price above SMA50/SMA200)');
                }
            } else if (breakoutHigh || breakoutLow) {
                // Hacim doğrulaması eksik
                signal = breakoutHigh ? 'WEAK_BUY' : 'WEAK_SELL';
                if (breakoutHigh) {
                    stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                } else {
                    stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                }
                unmetConditions.push('Volume confirmation missing');
            } else {
                // NEUTRAL durumda bile stop loss ve take profit hesapla
                // Varsayılan olarak alış yönü için (long) hesaplama yapalım
                stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                
                // Yönsel eğilimi (trend) baz alarak hesaplamayı düzelt
                if (isDowntrend) {
                    // Eğer aşağı yönlü bir piyasa eğilimi varsa, short (satış) için hesapla
                    stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                }
                
                unmetConditions.push('No breakout detected, monitoring only');
            }
            
            // Ek piyasa bilgilerini hesapla
            const volatility = (atr / currentPrice) * 100; // Yüzde olarak volatilite
            const averageVolume = this.calculateAverageVolume(candles, 20);
            const currentVolume = parseFloat(candles[candles.length - 1].volume);
            const volumeRatio = currentVolume / averageVolume;
            
            // Sonuçları logla
            logger.info(`Enhanced Turtle Trading scan for ${symbol}:
                - Current Price: ${currentPrice}
                - Entry Donchian: Upper=${entryDonchian.upper}, Lower=${entryDonchian.lower}
                - Exit Donchian: Upper=${exitDonchian.upper}, Lower=${exitDonchian.lower}
                - ATR: ${atr} (${volatility.toFixed(2)}%)
                - Volume Ratio: ${volumeRatio.toFixed(2)}
                - Trend: ${isUptrend ? 'UP' : isDowntrend ? 'DOWN' : 'NEUTRAL'}
                - Signal: ${signal}
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
                - Allocation: ${allocation}
                - Unmet Conditions: ${unmetConditions.join(', ') || 'None'}
            `);
            
            return { 
                signal, 
                stopLoss, 
                takeProfit, 
                allocation,
                unmetConditions: unmetConditions.join(', '),
                indicators: {
                    entryDonchian,
                    exitDonchian,
                    atr,
                    volatility,
                    volumeRatio,
                    trend: isUptrend ? 'UP' : isDowntrend ? 'DOWN' : 'NEUTRAL'
                }
            };
            
        } catch (error) {
            logger.error(`Error generating Turtle Trading signal for ${symbol}:`, error);
            return { signal: 'NEUTRAL' };
        }
    }
    
    // Basit bir SMA hesaplayıcı
    calculateSMA(candles, period) {
        if (candles.length < period) return null;
        
        const closes = candles.slice(-period).map(c => parseFloat(c.close));
        const sum = closes.reduce((total, price) => total + price, 0);
        return sum / period;
    }
    
    // Hacim doğrulaması kontrolü
    checkVolumeConfirmation(candles) {
        try {
            // Son 20 mumun hacim ortalaması
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            
            // Son mumun hacmi
            const lastVolume = volumes[volumes.length - 1];
            
            // Son hacim ortalamanın 1.5 katından büyükse doğrula
            return lastVolume > avgVolume * 1.5;
        } catch (error) {
            logger.error('Error checking volume confirmation:', error);
            return false;
        }
    }
    
    // Ortalama hacim hesaplama
    calculateAverageVolume(candles, period) {
        try {
            if (candles.length < period) return 0;
            
            const volumes = candles.slice(-period).map(c => parseFloat(c.volume));
            return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        } catch (error) {
            logger.error('Error calculating average volume:', error);
            return 0;
        }
    }
    
    // Donchian Kanalı hesaplama
    calculateDonchianChannel(candles, period) {
        try {
            const relevantCandles = candles.slice(-period);
            
            let highest = -Infinity;
            let lowest = Infinity;
            
            for (const candle of relevantCandles) {
                const high = parseFloat(candle.high);
                const low = parseFloat(candle.low);
                
                if (high > highest) highest = high;
                if (low < lowest) lowest = low;
            }
            
            return {
                upper: highest,
                lower: lowest,
                middle: (highest + lowest) / 2
            };
        } catch (error) {
            logger.error('Error calculating Donchian Channel:', error);
            return { upper: 0, lower: 0, middle: 0 };
        }
    }
    
    // ATR (Average True Range) hesaplama
    calculateATR(candles, period) {
        try {
            const trValues = [];
            
            // İlk True Range değerleri hesapla
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
            
            // Son 'period' kadar değerin ortalamasını al
            const relevantTR = trValues.slice(-period);
            const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
            
            return atr;
        } catch (error) {
            logger.error('Error calculating ATR:', error);
            return 0;
        }
    }
}

module.exports = TurtleTradingStrategy;