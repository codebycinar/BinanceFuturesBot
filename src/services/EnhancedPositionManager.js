const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const MultiTimeframeService = require('./MultiTimeframeService');
const OrderService = require('./OrderService');
const logger = require('../utils/logger');
const config = require('../config/config');
const { Telegraf } = require('telegraf');
const ti = require('technicalindicators');
const { Position } = models;

class EnhancedPositionManager {
    constructor() {
        this.binanceService = new BinanceService();
        this.orderService = new OrderService(this.binanceService);
        this.mtfService = new MultiTimeframeService(this.binanceService);
        this.initialized = false;
        
        // Trailing stop settings
        this.trailingStopEnabled = config.trailingStopEnabled || false;
        this.trailingStopActivationPercent = config.trailingStopActivationPercent || 0.5; // 50% of the way to take profit
        this.trailingStopDistance = config.trailingStopDistance || 0.5; // 0.5% trailing stop
        
        // Risk management settings
        this.maxDrawdownPercent = config.maxDrawdownPercent || 2.0; // 2% max drawdown before forcing close
        this.breakEvenLevel = config.breakEvenLevel || 1.0; // Move stop loss to break even after 1% profit
        
        // Telegram notifications
        this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        
        // Active position tracking
        this.positionStates = new Map(); // Tracks additional state for positions that's not stored in DB
    }
    
    async initialize() {
        try {
            await this.binanceService.initialize();
            await this.mtfService.initialize();
            
            // Start telegram bot
            this.bot.start((ctx) => ctx.reply('Position Manager is running!'));
            await this.bot.launch();
            
            logger.info('Enhanced Position Manager initialized successfully');
            this.initialized = true;
            
            // Run once immediately
            await this.run();
            
            // Schedule periodic runs
            setInterval(async () => {
                try {
                    await this.run();
                } catch (error) {
                    logger.error('Error during Position Manager periodic execution:', error);
                }
            }, 60 * 1000); // Run every minute
            
        } catch (error) {
            logger.error('Error initializing Position Manager:', error);
        }
    }
    
    async run() {
        if (!this.initialized) {
            logger.warn('Position Manager not initialized yet');
            return;
        }
        
        try {
            // Update positions from Binance
            await this.updateOpenPositions();
            
            // Get all active positions from DB
            const positions = await Position.findAll({ where: { isActive: true } });
            
            logger.info(`Managing ${positions.length} active positions`);
            
            // Process each position
            for (const position of positions) {
                try {
                    await this.managePosition(position);
                } catch (error) {
                    logger.error(`Error managing position for ${position.symbol}:`, error);
                    await this.notifyError(position.symbol, error.message);
                }
            }
        } catch (error) {
            logger.error('Error in Position Manager run:', error);
        }
    }
    
    async managePosition(position) {
        const { symbol, entries, entryPrices, stopLoss, takeProfit } = position;
        const positionType = entries > 0 ? 'LONG' : 'SHORT';
        
        logger.info(`Managing ${positionType} position for ${symbol}`);
        
        // Get current market data using multi-timeframe analysis
        const mtfData = await this.mtfService.getMultiTimeframeData(symbol);
        
        // Get current price
        const currentPrice = await this.binanceService.getCurrentPrice(symbol);
        
        // Get candles for position management
        const hourlyCandles = mtfData.candles['1h'];
        if (!hourlyCandles || hourlyCandles.length === 0) {
            logger.warn(`No hourly candle data for ${symbol}. Skipping position management.`);
            return;
        }
        
        // Check if position should be updated in state tracking
        if (!this.positionStates.has(symbol)) {
            this.positionStates.set(symbol, {
                highestPrice: positionType === 'LONG' ? currentPrice : 0,
                lowestPrice: positionType === 'SHORT' ? currentPrice : Infinity,
                trailingStopActive: false,
                trailingStopLevel: null,
                breakEvenActive: false
            });
        }
        
        // Get position state
        const state = this.positionStates.get(symbol);
        
        // Update price extremes
        if (positionType === 'LONG') {
            state.highestPrice = Math.max(state.highestPrice, currentPrice);
        } else {
            state.lowestPrice = Math.min(state.lowestPrice, currentPrice);
        }
        
        // Calculate current profit/loss percentage
        const entryPrice = entryPrices[0]; // Main entry price
        const pnlPercent = positionType === 'LONG' 
            ? (currentPrice - entryPrice) / entryPrice * 100
            : (entryPrice - currentPrice) / entryPrice * 100;
        
        logger.info(`Position status for ${symbol}:
            - Position Type: ${positionType}
            - Entry Price: ${entryPrice}
            - Current Price: ${currentPrice}
            - Stop Loss: ${stopLoss}
            - Take Profit: ${takeProfit}
            - P&L: ${pnlPercent.toFixed(2)}%
            - Highest Price: ${state.highestPrice}
            - Lowest Price: ${state.lowestPrice}
            - Trailing Stop Active: ${state.trailingStopActive}
            - Break Even Active: ${state.breakEvenActive}
        `);
        
        // Check if position needs to be closed
        let shouldClose = false;
        let closeReason = '';
        
        // 1. Check for stop loss hit
        if (positionType === 'LONG' && currentPrice <= stopLoss) {
            shouldClose = true;
            closeReason = 'Stop loss hit';
        } else if (positionType === 'SHORT' && currentPrice >= stopLoss) {
            shouldClose = true;
            closeReason = 'Stop loss hit';
        }
        
        // 2. Check for take profit hit
        if (positionType === 'LONG' && currentPrice >= takeProfit) {
            shouldClose = true;
            closeReason = 'Take profit hit';
        } else if (positionType === 'SHORT' && currentPrice <= takeProfit) {
            shouldClose = true;
            closeReason = 'Take profit hit';
        }
        
        // 3. Check trailing stop
        if (state.trailingStopActive) {
            if (positionType === 'LONG' && currentPrice <= state.trailingStopLevel) {
                shouldClose = true;
                closeReason = 'Trailing stop hit';
            } else if (positionType === 'SHORT' && currentPrice >= state.trailingStopLevel) {
                shouldClose = true;
                closeReason = 'Trailing stop hit';
            }
        }
        
        // 4. Check for max drawdown (safety measure)
        const maxDrawdownReached = this.checkMaxDrawdown(state, currentPrice, entryPrice, positionType);
        if (maxDrawdownReached) {
            shouldClose = true;
            closeReason = 'Maximum drawdown reached';
        }
        
        // 5. Check for technical exit signals
        const technicalExit = await this.checkTechnicalExitSignals(mtfData, position);
        if (technicalExit.shouldExit) {
            shouldClose = true;
            closeReason = `Technical exit signal: ${technicalExit.reason}`;
        }
        
        // If position should be closed, close it
        if (shouldClose) {
            logger.info(`Closing ${positionType} position for ${symbol}. Reason: ${closeReason}`);
            
            // Close position
            const closeSide = positionType === 'LONG' ? 'SELL' : 'BUY';
            await this.closePosition(symbol, closeSide, position, currentPrice, closeReason);
            
            // Remove from tracking
            this.positionStates.delete(symbol);
            
            // Send notification
            await this.notifyPositionClosed(symbol, currentPrice, pnlPercent, closeReason);
            return;
        }
        
        // If position should not be closed, check if stop loss or trailing stop should be updated
        
        // 1. Check if break even should be activated
        if (!state.breakEvenActive && pnlPercent >= this.breakEvenLevel) {
            await this.moveStopLossToBreakEven(position, entryPrice);
            state.breakEvenActive = true;
            
            // Notify about break even stop loss
            await this.notifyStopLossUpdate(symbol, entryPrice, 'Break even level reached');
        }
        
        // 2. Check if trailing stop should be activated or updated
        if (this.trailingStopEnabled) {
            await this.manageTrailingStop(position, state, currentPrice, entryPrice, positionType);
        }
        
        // 3. Check if position should be scaled in/out based on market conditions
        await this.managePositionSize(position, mtfData, currentPrice);
        
        // Update position state
        this.positionStates.set(symbol, state);
    }
    
    async managePositionSize(position, mtfData, currentPrice) {
        // This method handles scaling in or scaling out based on market conditions
        const { symbol, entries, totalAllocation, step } = position;
        const positionType = entries > 0 ? 'LONG' : 'SHORT';
        
        // Only handle scaling if position is in initial steps
        if (step >= 3) {
            return; // Already at maximum scaling
        }
        
        // Analyze market conditions for scaling decision
        const hourlyIndicators = mtfData.indicators['1h'];
        if (!hourlyIndicators) return;
        
        const { bollinger, rsi, adx } = hourlyIndicators;
        if (!bollinger || !rsi || !adx) return;
        
        // Check if conditions favor adding to the position
        let shouldAddToPosition = false;
        let allocationMultiplier = 1.0;
        
        if (positionType === 'LONG') {
            // Add to long if price is near lower band and other indicators support
            const nearLowerBand = currentPrice < bollinger.lower * 1.01;
            const rsiOversold = rsi.value < 35;
            const strongTrend = adx.adx > 25 && adx.pdi > adx.mdi;
            
            shouldAddToPosition = nearLowerBand && (rsiOversold || strongTrend);
            
            // Determine allocation multiplier based on conditions
            if (nearLowerBand && rsiOversold && strongTrend) {
                allocationMultiplier = 1.5; // Stronger signal = larger position addition
            }
        } else {
            // Add to short if price is near upper band and other indicators support
            const nearUpperBand = currentPrice > bollinger.upper * 0.99;
            const rsiOverbought = rsi.value > 65;
            const strongTrend = adx.adx > 25 && adx.mdi > adx.pdi;
            
            shouldAddToPosition = nearUpperBand && (rsiOverbought || strongTrend);
            
            // Determine allocation multiplier based on conditions
            if (nearUpperBand && rsiOverbought && strongTrend) {
                allocationMultiplier = 1.5; // Stronger signal = larger position addition
            }
        }
        
        if (shouldAddToPosition) {
            logger.info(`Favorable conditions to add to ${positionType} position for ${symbol}`);
            
            // Calculate additional allocation
            const baseAllocation = config.static_position_size || 0.01;
            const additionalAllocation = baseAllocation * allocationMultiplier;
            
            // Calculate quantity
            const quantity = await this.orderService.calculateStaticPositionSize(symbol, additionalAllocation);
            
            if (quantity > 0) {
                // Place order to add to position
                const side = positionType === 'LONG' ? 'BUY' : 'SELL';
                
                await this.orderService.placeMarketOrder({
                    symbol,
                    side,
                    quantity,
                    positionSide: positionType,
                });
                
                // Update position in database
                position.entries += positionType === 'LONG' ? 1 : -1;
                position.entryPrices = [...position.entryPrices, currentPrice];
                position.totalAllocation = (parseFloat(totalAllocation) + additionalAllocation).toString();
                position.step = step + 1;
                await position.save();
                
                // Send notification
                await this.notifyPositionUpdate(symbol, 'Added to position', {
                    additionalAllocation,
                    newTotalAllocation: position.totalAllocation,
                    entryPrice: currentPrice
                });
                
                logger.info(`Added to ${positionType} position for ${symbol} - ${quantity} at price ${currentPrice}`);
            }
        }
    }
    
    checkMaxDrawdown(state, currentPrice, entryPrice, positionType) {
        // Calculate drawdown from the best price reached
        let drawdownPercent;
        
        if (positionType === 'LONG') {
            // For long positions, drawdown is from highest price reached
            drawdownPercent = (state.highestPrice - currentPrice) / state.highestPrice * 100;
        } else {
            // For short positions, drawdown is from lowest price reached
            drawdownPercent = (currentPrice - state.lowestPrice) / state.lowestPrice * 100;
        }
        
        // Check if drawdown exceeds max allowed drawdown
        const exceedsMaxDrawdown = drawdownPercent > this.maxDrawdownPercent;
        
        if (exceedsMaxDrawdown) {
            logger.warn(`Maximum drawdown of ${drawdownPercent.toFixed(2)}% exceeded for ${positionType} position`);
        }
        
        return exceedsMaxDrawdown;
    }
    
    async checkTechnicalExitSignals(mtfData, position) {
        const { symbol, entries } = position;
        const positionType = entries > 0 ? 'LONG' : 'SHORT';
        
        // Get indicators from 1h timeframe
        const hourlyData = mtfData.indicators['1h'];
        if (!hourlyData) return { shouldExit: false };
        
        // Check divergence and other technical exit conditions
        let shouldExit = false;
        let reason = '';
        
        // Check RSI divergence
        const divergence = this.checkRSIDivergence(mtfData, positionType);
        if (divergence.detected) {
            shouldExit = true;
            reason = `RSI divergence detected on ${divergence.timeframe} timeframe`;
        }
        
        // Check MACD crossover
        if (hourlyData.macd) {
            const macd = hourlyData.macd;
            
            // MACD line crosses below signal line for longs
            if (positionType === 'LONG' && 
                macd.histogram < 0 && 
                macd.value < 0) {
                shouldExit = true;
                reason = 'MACD crossed below signal line';
            }
            
            // MACD line crosses above signal line for shorts
            if (positionType === 'SHORT' && 
                macd.histogram > 0 && 
                macd.value > 0) {
                shouldExit = true;
                reason = 'MACD crossed above signal line';
            }
        }
        
        // Check ADX trend weakening
        if (hourlyData.adx && hourlyData.adx.adx < 20) {
            // If trend is weakening, exit when profit is positive
            const currentPrice = await this.binanceService.getCurrentPrice(symbol);
            const entryPrice = position.entryPrices[0];
            
            const pnlPercent = positionType === 'LONG' 
                ? (currentPrice - entryPrice) / entryPrice * 100
                : (entryPrice - currentPrice) / entryPrice * 100;
            
            if (pnlPercent > 0.5) { // Exit only if in profit
                shouldExit = true;
                reason = 'Trend is weakening (ADX < 20) while in profit';
            }
        }
        
        return { shouldExit, reason };
    }
    
    checkRSIDivergence(mtfData, positionType) {
        // Check for RSI divergence on multiple timeframes
        const timeframes = ['1h', '4h'];
        
        for (const timeframe of timeframes) {
            if (!mtfData.candles[timeframe] || !mtfData.indicators[timeframe]) continue;
            
            const candles = mtfData.candles[timeframe];
            const indicators = mtfData.indicators[timeframe];
            
            if (!indicators.rsi || !indicators.rsi.values || indicators.rsi.values.length < 2) continue;
            
            // Extract price and RSI history
            const prices = candles.slice(-5).map(c => parseFloat(c.close));
            const rsiValues = indicators.rsi.values;
            
            // For LONG positions, look for bearish divergence (higher highs in price, lower highs in RSI)
            if (positionType === 'LONG') {
                // Check if price made higher high
                if (prices[prices.length - 1] > prices[prices.length - 3]) {
                    // Check if RSI made lower high
                    if (rsiValues[rsiValues.length - 1].value < rsiValues[rsiValues.length - 3].value) {
                        return { detected: true, timeframe };
                    }
                }
            }
            
            // For SHORT positions, look for bullish divergence (lower lows in price, higher lows in RSI)
            else {
                // Check if price made lower low
                if (prices[prices.length - 1] < prices[prices.length - 3]) {
                    // Check if RSI made higher low
                    if (rsiValues[rsiValues.length - 1].value > rsiValues[rsiValues.length - 3].value) {
                        return { detected: true, timeframe };
                    }
                }
            }
        }
        
        return { detected: false };
    }
    
    async manageTrailingStop(position, state, currentPrice, entryPrice, positionType) {
        const { symbol, stopLoss, takeProfit } = position;
        
        // Calculate the distance to take profit
        const distanceToTakeProfit = positionType === 'LONG' 
            ? takeProfit - entryPrice 
            : entryPrice - takeProfit;
        
        // Calculate current profit
        const currentProfit = positionType === 'LONG' 
            ? currentPrice - entryPrice 
            : entryPrice - currentPrice;
        
        // Calculate how far along the way to take profit we are
        const percentTowardsTP = currentProfit / distanceToTakeProfit;
        
        // Check if trailing stop should be activated
        if (percentTowardsTP >= this.trailingStopActivationPercent) {
            // Trailing stop should be active
            if (!state.trailingStopActive) {
                // First time activating trailing stop
                state.trailingStopActive = true;
                
                // Calculate initial trailing stop level
                if (positionType === 'LONG') {
                    state.trailingStopLevel = currentPrice * (1 - this.trailingStopDistance / 100);
                } else {
                    state.trailingStopLevel = currentPrice * (1 + this.trailingStopDistance / 100);
                }
                
                logger.info(`Activated trailing stop for ${symbol} at ${state.trailingStopLevel}`);
                await this.notifyTrailingStopActivated(symbol, state.trailingStopLevel);
                
                // Update stop loss order if possible
                await this.updateStopLossOrder(position, state.trailingStopLevel);
            } else {
                // Trailing stop already active, check if it should be updated
                if (positionType === 'LONG' && currentPrice > state.highestPrice) {
                    // New high price, update trailing stop
                    state.trailingStopLevel = currentPrice * (1 - this.trailingStopDistance / 100);
                    state.highestPrice = currentPrice;
                    
                    logger.info(`Updated trailing stop for ${symbol} to ${state.trailingStopLevel}`);
                    
                    // Update stop loss order
                    await this.updateStopLossOrder(position, state.trailingStopLevel);
                } 
                else if (positionType === 'SHORT' && currentPrice < state.lowestPrice) {
                    // New low price, update trailing stop
                    state.trailingStopLevel = currentPrice * (1 + this.trailingStopDistance / 100);
                    state.lowestPrice = currentPrice;
                    
                    logger.info(`Updated trailing stop for ${symbol} to ${state.trailingStopLevel}`);
                    
                    // Update stop loss order
                    await this.updateStopLossOrder(position, state.trailingStopLevel);
                }
            }
        }
    }
    
    async updateStopLossOrder(position, newStopLevel) {
        try {
            const { symbol, entries } = position;
            const positionType = entries > 0 ? 'LONG' : 'SHORT';
            const side = positionType === 'LONG' ? 'SELL' : 'BUY';
            
            // First cancel existing stop loss orders
            await this.binanceService.cancelAllOpenOrders(symbol);
            
            // Get current quantity
            const openPositions = await this.binanceService.getOpenPositions();
            const openPosition = openPositions.find(pos => pos.symbol === symbol);
            
            if (!openPosition) {
                throw new Error(`No open position found on Binance for ${symbol}`);
            }
            
            // Get quantity and precisions
            const quantity = Math.abs(parseFloat(openPosition.positionAmt));
            const quantityPrecision = await this.binanceService.getQuantityPrecision(symbol);
            const pricePrecision = await this.binanceService.getPricePrecision(symbol);
            
            // Format values with correct precision
            const formattedQuantity = quantity.toFixed(quantityPrecision);
            const formattedPrice = parseFloat(newStopLevel).toFixed(pricePrecision);
            
            // Place new stop loss
            await this.orderService.placeStopLossOrder({
                symbol,
                side,
                quantity: formattedQuantity,
                stopPrice: formattedPrice,
                price: formattedPrice, // Can add a small buffer here
                positionSide: positionType,
            });
            
            // Update position in database
            position.stopLoss = newStopLevel;
            await position.save();
            
            logger.info(`Updated stop loss order for ${symbol} to ${newStopLevel}`);
        } catch (error) {
            logger.error(`Error updating stop loss order for ${position.symbol}: ${error.message}`);
        }
    }
    
    async moveStopLossToBreakEven(position, entryPrice) {
        try {
            // Update stop loss to break even
            await this.updateStopLossOrder(position, entryPrice);
            
            logger.info(`Moved stop loss to break even (${entryPrice}) for ${position.symbol}`);
        } catch (error) {
            logger.error(`Error moving stop loss to break even: ${error.message}`);
        }
    }
    
    async closePosition(symbol, side, position, closePrice, reason) {
        try {
            logger.info(`Closing ${side} position for ${symbol} at ${closePrice}. Reason: ${reason}`);
            
            // First cancel all open orders for this symbol
            await this.binanceService.cancelAllOpenOrders(symbol);
            
            // Close position with market order
            await this.orderService.closePosition(symbol, side, null, position.entries > 0 ? 'LONG' : 'SHORT');
            
            // Update position record
            position.isActive = false;
            position.closedPrice = closePrice;
            position.closedAt = new Date();
            position.exitReason = reason;
            await position.save();
            
            logger.info(`Position for ${symbol} closed at price ${closePrice}`);
        } catch (error) {
            logger.error(`Error closing position for ${symbol}: ${error.message}`);
            
            // Try to mark position as closed in DB anyways
            position.isActive = false;
            position.closedPrice = closePrice;
            position.closedAt = new Date();
            position.exitReason = `Failed to close properly: ${error.message}`;
            await position.save();
            
            // Rethrow for full error handling
            throw error;
        }
    }
    
    async updateOpenPositions() {
        try {
            if (!this.binanceService) {
                throw new Error('Binance service is not defined');
            }
            
            // Get open positions from Binance
            const openPositions = await this.binanceService.getOpenPositions();
            
            // Get open symbols
            const openSymbols = openPositions.map(pos => pos.symbol);
            
            // Get all active positions from database
            const dbOpenPositions = await Position.findAll({ where: { isActive: true } });
            
            // Loop through database positions
            for (const dbPosition of dbOpenPositions) {
                const { symbol } = dbPosition;
                
                if (!openSymbols.includes(symbol)) {
                    // Position closed externally, mark as closed in database
                    logger.info(`Position for ${symbol} not found on exchange, marking as closed`);
                    dbPosition.isActive = false;
                    dbPosition.closedAt = new Date();
                    dbPosition.closedPrice = await this.binanceService.getCurrentPrice(symbol);
                    dbPosition.exitReason = 'Closed externally';
                    await dbPosition.save();
                    
                    // Remove from tracking
                    this.positionStates.delete(symbol);
                    continue;
                }
                
                // Update position with latest data from Binance
                const binancePosition = openPositions.find(pos => pos.symbol === symbol);
                if (binancePosition) {
                    const { entryPrice, positionAmt } = binancePosition;
                    
                    // Update entry price and position amount
                    dbPosition.entryPrices = [parseFloat(entryPrice)];
                    dbPosition.entries = parseFloat(positionAmt) > 0 ? 
                        Math.abs(parseFloat(positionAmt)) : 
                        -Math.abs(parseFloat(positionAmt));
                    
                    await dbPosition.save();
                    logger.info(`Updated position data for ${symbol} from exchange`);
                }
            }
            
            // Check for positions on exchange that are not in database
            for (const binancePosition of openPositions) {
                const { symbol, positionAmt, entryPrice } = binancePosition;
                
                // Skip positions with zero amount
                if (parseFloat(positionAmt) === 0) continue;
                
                const dbPosition = dbOpenPositions.find(pos => pos.symbol === symbol);
                if (!dbPosition) {
                    // Position exists on exchange but not in database, add it
                    logger.info(`Found position for ${symbol} on exchange that's not in database, adding it`);
                    
                    // Calculate stop loss and take profit levels
                    const currentPrice = await this.binanceService.getCurrentPrice(symbol);
                    const atrValue = await this.calculateATR(symbol);
                    
                    let stopLoss, takeProfit;
                    if (parseFloat(positionAmt) > 0) {
                        // Long position
                        stopLoss = parseFloat(entryPrice) * 0.99;
                        takeProfit = parseFloat(entryPrice) * 1.02;
                    } else {
                        // Short position
                        stopLoss = parseFloat(entryPrice) * 1.01;
                        takeProfit = parseFloat(entryPrice) * 0.98;
                    }
                    
                    // Create position record
                    await Position.create({
                        symbol,
                        entries: parseFloat(positionAmt) > 0 ? 1 : -1,
                        entryPrices: [parseFloat(entryPrice)],
                        totalAllocation: Math.abs(parseFloat(positionAmt) * parseFloat(entryPrice)),
                        isActive: true,
                        step: 1,
                        stopLoss,
                        takeProfit,
                        nextCandleCloseTime: this.getNextCandleCloseTime('1h')
                    });
                    
                    // Initialize position state tracking
                    this.positionStates.set(symbol, {
                        highestPrice: parseFloat(positionAmt) > 0 ? currentPrice : 0,
                        lowestPrice: parseFloat(positionAmt) < 0 ? currentPrice : Infinity,
                        trailingStopActive: false,
                        trailingStopLevel: null,
                        breakEvenActive: false
                    });
                }
            }
        } catch (error) {
            logger.error('Error updating open positions:', error);
        }
    }
    
    async calculateATR(symbol) {
        try {
            // Get candles
            const candles = await this.binanceService.getCandles(symbol, '1h', 20);
            
            // Calculate ATR
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));
            const closes = candles.map(c => parseFloat(c.close));
            
            const atr = ti.ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            });
            
            return atr[atr.length - 1];
        } catch (error) {
            logger.error(`Error calculating ATR for ${symbol}: ${error.message}`);
            return 0;
        }
    }
    
    getNextCandleCloseTime(timeframe) {
        const now = new Date();
        const timeframes = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
        };
        const ms = timeframes[timeframe] || 60 * 60 * 1000;
        return new Date(Math.ceil(now.getTime() / ms) * ms);
    }
    
    // Telegram notification methods
    async notifyPositionClosed(symbol, price, pnlPercent, reason) {
        try {
            const message = `
🔴 Position closed for ${symbol}
- Closing Price: ${price}
- P&L: ${pnlPercent.toFixed(2)}%
- Reason: ${reason}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending position closed notification: ${error.message}`);
        }
    }
    
    async notifyTrailingStopActivated(symbol, level) {
        try {
            const message = `
🔵 Trailing stop activated for ${symbol}
- Initial trailing stop level: ${level}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending trailing stop notification: ${error.message}`);
        }
    }
    
    async notifyStopLossUpdate(symbol, level, reason) {
        try {
            const message = `
🟢 Stop loss updated for ${symbol}
- New stop loss level: ${level}
- Reason: ${reason}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending stop loss update notification: ${error.message}`);
        }
    }
    
    async notifyPositionUpdate(symbol, action, details) {
        try {
            const message = `
🟡 Position update for ${symbol}
- Action: ${action}
- Allocation: +${details.additionalAllocation} USDT
- Total Allocation: ${details.newTotalAllocation} USDT
- Entry Price: ${details.entryPrice}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending position update notification: ${error.message}`);
        }
    }
    
    async notifyError(symbol, errorMessage) {
        try {
            const message = `
❌ Error managing position for ${symbol}:
- Error: ${errorMessage}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending error notification: ${error.message}`);
        }
    }
}

// Create singleton instance
const enhancedPositionManager = new EnhancedPositionManager();

// Export the instance
module.exports = enhancedPositionManager;