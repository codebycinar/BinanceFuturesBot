// AdaptiveMomentumStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');
const ti = require('technicalindicators');

class AdaptiveMomentumStrategy {
    constructor() {
        // Default parameters
        this.parameters = {
            // EMA parameters
            fastEMA: 12,
            slowEMA: 26,
            signalEMA: 9,
            
            // RSI parameters
            rsiPeriod: 14,
            rsiOverbought: 70,
            rsiOversold: 30,
            
            // MACD parameters
            macdFast: 12,
            macdSlow: 26,
            macdSignal: 9,
            
            // Risk management
            atrPeriod: 14,
            atrMultiplier: 2,
            riskPercentage: 1,
            profitMultiplier: 2.5,
            
            // Confirmation
            volumeConfirmation: true,
            confirmationPeriod: 2,
            
            // Timeframe
            timeframe: '1h',
            
            // Cross validation
            validateWithHigherTimeframe: true,
            higherTimeframe: '4h'
        };
        
        // Set preferred timeframe
        this.preferredTimeframe = this.parameters.timeframe || '1h';
        
        // Position memory for tracking
        this.positionMemory = {};
    }
    
    async initialize() {
        try {
            // Load from config if available
            if (config.adaptiveStrategy) {
                this.parameters = { ...this.parameters, ...config.adaptiveStrategy };
                logger.info('Loaded Adaptive Momentum Strategy parameters from config file');
            }
            
            // Skip database operations in test mode
            if (process.env.NODE_ENV === 'test') {
                this.preferredTimeframe = this.parameters.timeframe || '1h';
                logger.info('Running in test mode, skipping database operations');
                return;
            }
            
            try {
                // Check if database is ready
                const dbReady = await this.checkDatabaseReady();
                
                if (dbReady) {
                    // Load from database if available
                    const strategy = await Strategy.findOne({ where: { name: 'AdaptiveMomentumStrategy' } });
                    if (strategy && strategy.parameters) {
                        this.parameters = { ...this.parameters, ...strategy.parameters };
                        logger.info('Loaded Adaptive Momentum Strategy parameters from database');
                    } else {
                        // Save current parameters if not in database
                        try {
                            await Strategy.create({
                                name: 'AdaptiveMomentumStrategy',
                                parameters: this.parameters,
                                isActive: true
                            });
                            logger.info('Created new Adaptive Momentum Strategy record in database');
                        } catch (dbError) {
                            logger.warn('Could not create strategy record in database:', dbError.message);
                        }
                    }
                } else {
                    logger.warn('Database not ready, using config file parameters only');
                }
            } catch (dbError) {
                logger.warn('Database error when accessing strategies:', dbError.message);
            }
            
            this.preferredTimeframe = this.parameters.timeframe || '1h';
            
            logger.info('Adaptive Momentum Strategy initialized with parameters:', this.parameters);
        } catch (error) {
            logger.error('Error initializing Adaptive Momentum Strategy:', error);
        }
    }
    
    // Helper method to check if database is ready
    async checkDatabaseReady() {
        try {
            // Check Position table existence
            await models.Position.findOne();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async generateSignal(candles, symbol, mtfData = null) {
        try {
            if (!candles || candles.length < 50) {
                logger.warn(`Not enough candles for ${symbol} to generate Adaptive Momentum signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Get current candle data
            const currentCandle = candles[candles.length - 1];
            const previousCandle = candles[candles.length - 2];
            const currentPrice = parseFloat(currentCandle.close);
            
            // Calculate MACD
            const macdInput = {
                values: candles.map(c => parseFloat(c.close)),
                fastPeriod: this.parameters.macdFast,
                slowPeriod: this.parameters.macdSlow,
                signalPeriod: this.parameters.macdSignal,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            };
            
            const macdResults = ti.MACD.calculate(macdInput);
            
            // Calculate RSI
            const rsiInput = {
                values: candles.map(c => parseFloat(c.close)),
                period: this.parameters.rsiPeriod
            };
            
            const rsiResults = ti.RSI.calculate(rsiInput);
            
            // Calculate EMAs
            const ema10 = ti.EMA.calculate({values: candles.map(c => parseFloat(c.close)), period: 10});
            const ema20 = ti.EMA.calculate({values: candles.map(c => parseFloat(c.close)), period: 20});
            const ema50 = ti.EMA.calculate({values: candles.map(c => parseFloat(c.close)), period: 50});
            const ema200 = ti.EMA.calculate({values: candles.map(c => parseFloat(c.close)), period: 200});
            
            // Calculate ATR for stop loss and take profit
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            
            // Cross timeframe validation if enabled and data available
            let higherTimeframeConfirmation = true;
            if (this.parameters.validateWithHigherTimeframe && mtfData && mtfData.candles && mtfData.candles[this.parameters.higherTimeframe]) {
                const higherCandles = mtfData.candles[this.parameters.higherTimeframe];
                if (higherCandles.length >= 50) {
                    // Calculate higher timeframe indicators
                    const htfEma10 = ti.EMA.calculate({values: higherCandles.map(c => parseFloat(c.close)), period: 10});
                    const htfEma50 = ti.EMA.calculate({values: higherCandles.map(c => parseFloat(c.close)), period: 50});
                    
                    // Check if higher timeframe confirms the trend
                    const htfTrend = htfEma10[htfEma10.length - 1] > htfEma50[htfEma50.length - 1] ? 'UP' : 'DOWN';
                    higherTimeframeConfirmation = (htfTrend === 'UP' && ema10[ema10.length - 1] > ema50[ema50.length - 1]) ||
                                                (htfTrend === 'DOWN' && ema10[ema10.length - 1] < ema50[ema50.length - 1]);
                }
            }
            
            // Get latest indicator values
            const latestMACD = macdResults[macdResults.length - 1];
            const prevMACD = macdResults[macdResults.length - 2];
            const latestRSI = rsiResults[rsiResults.length - 1];
            const prevRSI = rsiResults[rsiResults.length - 2];
            
            // Volume confirmation
            const volumeConfirmation = this.checkVolumeConfirmation(candles);
            
            // Check for bullish momentum (LONG signal)
            let signal = 'NEUTRAL';
            let unmetConditions = [];
            
            const isBullishMACD = prevMACD.histogram < 0 && latestMACD.histogram > 0;
            const isBearishMACD = prevMACD.histogram > 0 && latestMACD.histogram < 0;
            
            const isBullishEMA = ema10[ema10.length - 1] > ema20[ema20.length - 1] && 
                               ema20[ema20.length - 1] > ema50[ema50.length - 1];
            const isBearishEMA = ema10[ema10.length - 1] < ema20[ema20.length - 1] && 
                                ema20[ema20.length - 1] < ema50[ema50.length - 1];
            
            const isStrongBull = currentPrice > ema200[ema200.length - 1] && isBullishEMA;
            const isStrongBear = currentPrice < ema200[ema200.length - 1] && isBearishEMA;
            
            // Check existing positions to decide on exit signals
            let existingPositions = await this.checkExistingPositions(symbol);
            if (!existingPositions) {
                existingPositions = { hasLong: false, hasShort: false };
            }
            
            // Calculate stop loss and take profit levels
            let stopLoss, takeProfit;
            
            // LONG signal conditions
            if (isBullishMACD && latestRSI > 50 && isStrongBull && higherTimeframeConfirmation) {
                if (!existingPositions.hasLong) {
                    signal = volumeConfirmation ? 'BUY' : 'WEAK_BUY';
                    if (!volumeConfirmation) unmetConditions.push('Volume confirmation missing');
                    
                    stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    
                    logger.info(`Adaptive Momentum LONG signal for ${symbol} at ${currentPrice}`);
                    logger.info(`MACD Histogram: ${latestMACD.histogram.toFixed(6)}, RSI: ${latestRSI.toFixed(2)}`);
                }
            } 
            // SHORT signal conditions
            else if (isBearishMACD && latestRSI < 50 && isStrongBear && higherTimeframeConfirmation) {
                if (!existingPositions.hasShort) {
                    signal = volumeConfirmation ? 'SELL' : 'WEAK_SELL';
                    if (!volumeConfirmation) unmetConditions.push('Volume confirmation missing');
                    
                    stopLoss = currentPrice + (atr * this.parameters.atrMultiplier);
                    takeProfit = currentPrice - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                    
                    logger.info(`Adaptive Momentum SHORT signal for ${symbol} at ${currentPrice}`);
                    logger.info(`MACD Histogram: ${latestMACD.histogram.toFixed(6)}, RSI: ${latestRSI.toFixed(2)}`);
                }
            }
            // Exit LONG position
            else if (existingPositions.hasLong && (isBearishMACD || latestRSI > this.parameters.rsiOverbought)) {
                signal = 'EXIT_BUY';
                logger.info(`Adaptive Momentum EXIT LONG signal for ${symbol} at ${currentPrice}`);
                logger.info(`MACD Histogram: ${latestMACD.histogram.toFixed(6)}, RSI: ${latestRSI.toFixed(2)}`);
            }
            // Exit SHORT position
            else if (existingPositions.hasShort && (isBullishMACD || latestRSI < this.parameters.rsiOversold)) {
                signal = 'EXIT_SELL';
                logger.info(`Adaptive Momentum EXIT SHORT signal for ${symbol} at ${currentPrice}`);
                logger.info(`MACD Histogram: ${latestMACD.histogram.toFixed(6)}, RSI: ${latestRSI.toFixed(2)}`);
            }
            // Default case - NEUTRAL
            else {
                stopLoss = currentPrice - (atr * this.parameters.atrMultiplier);
                takeProfit = currentPrice + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                unmetConditions.push('No momentum signal detected');
            }
            
            // Calculate position size
            const initialRisk = config.calculate_position_size 
                ? config.riskPerTrade * config.accountSize 
                : config.static_position_size;
                
            const riskPerUnit = atr * this.parameters.atrMultiplier;
            const units = initialRisk / riskPerUnit;
            const allocation = units * currentPrice;
            
            // Log strategy metrics
            logger.info(`Adaptive Momentum scan for ${symbol}:
                - Current Price: ${currentPrice}
                - MACD: Histogram=${latestMACD.histogram.toFixed(6)}, MACD=${latestMACD.MACD.toFixed(6)}, Signal=${latestMACD.signal.toFixed(6)}
                - RSI: ${latestRSI.toFixed(2)}
                - EMAs: 10=${ema10[ema10.length-1].toFixed(2)}, 20=${ema20[ema20.length-1].toFixed(2)}, 50=${ema50[ema50.length-1].toFixed(2)}, 200=${ema200[ema200.length-1].toFixed(2)}
                - ATR: ${atr.toFixed(6)}
                - Signal: ${signal}
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
                - Higher Timeframe Confirmation: ${higherTimeframeConfirmation}
                - Unmet Conditions: ${unmetConditions.join(', ') || 'None'}
            `);
            
            return {
                signal,
                stopLoss,
                takeProfit,
                allocation,
                unmetConditions: unmetConditions.join(', '),
                indicators: {
                    macd: latestMACD,
                    rsi: latestRSI,
                    ema10: ema10[ema10.length-1],
                    ema20: ema20[ema20.length-1],
                    ema50: ema50[ema50.length-1],
                    ema200: ema200[ema200.length-1],
                    atr
                }
            };
        } catch (error) {
            logger.error(`Error generating Adaptive Momentum signal for ${symbol}:`, error);
            return { signal: 'NEUTRAL' };
        }
    }
    
    // Volume confirmation check
    checkVolumeConfirmation(candles) {
        try {
            // Get last 20 candles' volumes
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            
            // Last candle's volume
            const lastVolume = volumes[volumes.length - 1];
            
            // Validate if last volume is at least 1.5x average
            return lastVolume > avgVolume * 1.5;
        } catch (error) {
            logger.error('Error checking volume confirmation:', error);
            return false;
        }
    }
    
    // Calculate ATR (Average True Range)
    calculateATR(candles, period) {
        try {
            const trValues = [];
            
            // Calculate initial True Range values
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
            
            // Get average of last 'period' values
            const relevantTR = trValues.slice(-period);
            const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
            
            return atr;
        } catch (error) {
            logger.error('Error calculating ATR:', error);
            return 0;
        }
    }
    
    // Check for existing positions
    async checkExistingPositions(symbol) {
        try {
            // Return mock data in test mode
            if (process.env.NODE_ENV === 'test') {
                return { hasLong: false, hasShort: false };
            }
            
            // Check database readiness
            const dbReady = await this.checkDatabaseReady();
            if (!dbReady) {
                logger.warn(`Database not ready when checking positions for ${symbol}, using default values`);
                return { hasLong: false, hasShort: false };
            }
            
            const { Position } = require('../db/db').models;
            
            // Get active positions
            try {
                const positions = await Position.findAll({
                    where: { 
                        symbol, 
                        isActive: true 
                    }
                });
                
                if (!positions || positions.length === 0) {
                    return { hasLong: false, hasShort: false };
                }
                
                // Separate long and short positions
                const longPositions = positions.filter(p => p.entries > 0);
                const shortPositions = positions.filter(p => p.entries < 0);
                
                return {
                    hasLong: longPositions.length > 0,
                    hasShort: shortPositions.length > 0
                };
            } catch (dbError) {
                logger.warn(`Database error checking positions for ${symbol}: ${dbError.message}`);
                return { hasLong: false, hasShort: false };
            }
        } catch (error) {
            logger.error(`Error checking existing positions for ${symbol}:`, error);
            return { hasLong: false, hasShort: false };
        }
    }
    
    // Analyze market conditions for adaptive behavior
    async analyzeMarketConditions(mtfData, symbol) {
        try {
            const preferredTimeframe = this.preferredTimeframe || '1h';
            const candles = mtfData.candles[preferredTimeframe] || [];
            
            if (!candles || candles.length < 50) {
                logger.warn(`Not enough ${preferredTimeframe} candles for ${symbol} to analyze market conditions`);
                return {
                    trend: 'NEUTRAL',
                    trendStrength: 50,
                    volatility: 'MEDIUM',
                    marketType: 'RANGING',
                    volume: 'NORMAL'
                };
            }
            
            // Calculate ATR for volatility
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const volatilityPercent = (atr / currentPrice) * 100;
            
            // Calculate EMAs for trend analysis
            const closes = candles.map(c => parseFloat(c.close));
            const ema10 = ti.EMA.calculate({values: closes, period: 10});
            const ema20 = ti.EMA.calculate({values: closes, period: 20});
            const ema50 = ti.EMA.calculate({values: closes, period: 50});
            const ema200 = ti.EMA.calculate({values: closes, period: 200});
            
            // Determine trend
            let trend = 'NEUTRAL';
            let trendStrength = 50;
            
            const currentEma10 = ema10[ema10.length - 1];
            const currentEma20 = ema20[ema20.length - 1];
            const currentEma50 = ema50[ema50.length - 1];
            const currentEma200 = ema200[ema200.length - 1];
            
            if (currentEma10 > currentEma20 && currentEma20 > currentEma50 && currentEma50 > currentEma200) {
                // Strong uptrend
                trend = 'UP';
                const distancePercent = ((currentEma10 - currentEma200) / currentEma200) * 100;
                trendStrength = Math.min(90, 50 + distancePercent * 2);
            } else if (currentEma10 < currentEma20 && currentEma20 < currentEma50 && currentEma50 < currentEma200) {
                // Strong downtrend
                trend = 'DOWN';
                const distancePercent = ((currentEma200 - currentEma10) / currentEma200) * 100;
                trendStrength = Math.min(90, 50 + distancePercent * 2);
            } else if (currentEma10 > currentEma20 && currentEma50 < currentEma200) {
                // Potential reversal from down to up
                trend = 'UP_REVERSAL';
                trendStrength = 60;
            } else if (currentEma10 < currentEma20 && currentEma50 > currentEma200) {
                // Potential reversal from up to down
                trend = 'DOWN_REVERSAL';
                trendStrength = 60;
            }
            
            // Classify volatility
            let volatility = 'MEDIUM';
            if (volatilityPercent > 2.5) volatility = 'HIGH';
            else if (volatilityPercent < 1.0) volatility = 'LOW';
            
            // Determine market type
            let marketType = 'RANGING';
            if (trend === 'UP' && trendStrength > 70) marketType = 'TRENDING_UP';
            else if (trend === 'DOWN' && trendStrength > 70) marketType = 'TRENDING_DOWN';
            else if (trend.includes('REVERSAL')) marketType = 'REVERSAL';
            
            // Analyze volume
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            const currentVolume = volumes[volumes.length - 1];
            
            let volume = 'NORMAL';
            if (currentVolume > avgVolume * 1.5) volume = 'HIGH';
            else if (currentVolume < avgVolume * 0.5) volume = 'LOW';
            
            // Return market condition analysis
            return {
                trend,
                trendStrength,
                volatility,
                marketType,
                volume,
                indicators: {
                    ema10: currentEma10,
                    ema20: currentEma20,
                    ema50: currentEma50,
                    ema200: currentEma200,
                    atr,
                    volatilityPercent
                }
            };
        } catch (error) {
            logger.error(`Error analyzing market conditions for ${symbol}:`, error);
            return {
                trend: 'NEUTRAL',
                trendStrength: 50,
                volatility: 'MEDIUM',
                marketType: 'RANGING',
                volume: 'NORMAL'
            };
        }
    }
}

module.exports = AdaptiveMomentumStrategy;