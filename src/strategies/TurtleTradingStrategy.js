// TurtleTradingStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');

class TurtleTradingStrategy {
    constructor() {
        this.parameters = {
            entryChannel: 20,    // 20 günlük kanal (giriş sinyali için)
            exitChannel: 10,     // 10 günlük kanal (çıkış sinyali için)
            atrPeriod: 14,       // ATR periyodu
            riskPercentage: 1,   // Risk yüzdesi
            atrMultiplier: 2,    // Stop loss için ATR çarpanı
        };
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
            if (!candles || candles.length < this.parameters.entryChannel + 5) {
                logger.warn(`Not enough candles for ${symbol} to generate Turtle Trading signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Donchian Kanallarını hesapla
            const entryDonchian = this.calculateDonchianChannel(candles, this.parameters.entryChannel);
            const exitDonchian = this.calculateDonchianChannel(candles, this.parameters.exitChannel);
            
            // ATR hesapla
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            
            // Son fiyat
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const previousPrice = parseFloat(candles[candles.length - 2].close);
            
            // Kırılma sinyalleri için kontrol
            const breakoutHigh = previousPrice <= entryDonchian.upper && currentPrice > entryDonchian.upper;
            const breakoutLow = previousPrice >= entryDonchian.lower && currentPrice < entryDonchian.lower;
            
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
            
            if (breakoutHigh) {
                // Long pozisyon sinyali
                signal = 'BUY';
                stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * 2); // 2:1 risk-reward
                
                logger.info(`Turtle Trading LONG signal for ${symbol} at ${currentPrice}`);
                logger.info(`Donchian Upper Breakout: ${entryDonchian.upper}`);
            } else if (breakoutLow) {
                // Short pozisyon sinyali
                signal = 'SELL';
                stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * 2); // 2:1 risk-reward
                
                logger.info(`Turtle Trading SHORT signal for ${symbol} at ${currentPrice}`);
                logger.info(`Donchian Lower Breakout: ${entryDonchian.lower}`);
            }
            
            // Sonuçları logla
            logger.info(`Turtle Trading scan for ${symbol}:
                - Current Price: ${currentPrice}
                - Entry Donchian: Upper=${entryDonchian.upper}, Lower=${entryDonchian.lower}
                - Exit Donchian: Upper=${exitDonchian.upper}, Lower=${exitDonchian.lower}
                - ATR: ${atr}
                - Signal: ${signal}
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
                - Allocation: ${allocation}
            `);
            
            return { 
                signal, 
                stopLoss, 
                takeProfit, 
                allocation,
                indicators: {
                    entryDonchian,
                    exitDonchian,
                    atr
                }
            };
            
        } catch (error) {
            logger.error(`Error generating Turtle Trading signal for ${symbol}:`, error);
            return { signal: 'NEUTRAL' };
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