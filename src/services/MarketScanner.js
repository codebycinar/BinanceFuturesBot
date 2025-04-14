// services/MarketScanner.js

const TurtleTradingStrategy = require('../strategies/TurtleTradingStrategy');
const config = require('../config/config');
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Position } = models;
const dotenv = require("dotenv");
const telegramService = require('./TelegramService');

const MultiTimeframeService = require('../services/MultiTimeframeService');
const EnhancedPositionManager = require('../services/EnhancedPositionManager');

class MarketScanner {
    constructor(binanceService, orderService, mtfService, performanceTracker = null) {
        this.binanceService = binanceService;
        this.orderService = orderService;
        this.mtfService = mtfService;
        this.performanceTracker = performanceTracker;
        this.strategy = new TurtleTradingStrategy(); // Sadece Turtle Trading Stratejisini kullan
        this.positionStates = {};
        this.weakSignalBuffer = []; // Zayıf sinyalleri gruplamak için buffer
        this.weakSignalBatchSize = 5; // Her mesajda kaç sinyal birleştirileceği
        this.lastMarketConditions = {}; // Market koşullarını izlemek için
    }
    
    async initialize() {
        await this.strategy.initialize();
        logger.info('Market Scanner initialized with Turtle Trading Strategy');
    }

    /**
   * Borsada TRADING durumunda olan tüm sembolleri döndürür.
   */
    async scanAllSymbols() {
        try {
            if (!config.strategy) {
                logger.error('Strategy instance is missing.');
                throw new Error('Strategy is not initialized.');
            }

            logger.info('Strategy initialized successfully.');

            const usdtSymbols = await this.binanceService.scanAllSymbols();
            for (const symbol of usdtSymbols) {
                await this.scanSymbol(symbol);
            }
        } catch (error) {
            logger.error('Error scanning all symbols:', error);
        }
    }

    async sendWeakSignalMessage(symbol, signalType, entryPrice, stopLoss, takeProfit, allocation, unmetConditions, strategyUsed) {
        // Skip Telegram notifications in test mode
        if (process.env.NODE_ENV === 'test') {
            logger.info(`Test mode: Skipping Telegram weak signal notification for ${symbol}`);
            return;
        }
        
        const message = `
    ⚠️ Weak ${signalType} signal detected for ${symbol}
    - Entry Price: ${entryPrice}
    - Stop Loss: ${stopLoss}
    - Take Profit: ${takeProfit}
    - Allocation: ${allocation}
    - Strategy: ${strategyUsed || 'Adaptive Strategy'}
    - Market Type: ${this.lastMarketConditions[symbol]?.marketType || 'Unknown'}
    - Trend: ${this.lastMarketConditions[symbol]?.trend || 'Unknown'}
    - Unmet Conditions: ${unmetConditions}
    ⚠️ No position opened.
    `;

        this.weakSignalBuffer.push(message);

        if (this.weakSignalBuffer.length >= this.weakSignalBatchSize) {
            await this.flushWeakSignalBuffer();
        }
    }

    /**
     * Buffer'daki tüm zayıf sinyalleri tek bir mesaj olarak gönderir ve buffer'ı temizler.
     */
    async flushWeakSignalBuffer() {
        if (this.weakSignalBuffer.length === 0) return;
        
        // Skip Telegram notifications in test mode
        if (process.env.NODE_ENV === 'test') {
            logger.info(`Test mode: Skipping Telegram weak signal buffer notification for ${this.weakSignalBuffer.length} signals`);
            this.weakSignalBuffer = [];
            return;
        }

        const combinedMessage = `
    ⚠️ Weak Signal Summary (${this.weakSignalBuffer.length} signals):
    ${this.weakSignalBuffer.join("\n")}
    `;

        try {
            await telegramService.sendMessage(combinedMessage);
        } catch (error) {
            logger.error(`Error sending weak signal batch message: ${error.message}`);
        }

        this.weakSignalBuffer = [];
    }

    /**
     * Yeni pozisyon açıldığında mesaj gönderir.
     */
    async notifyNewPosition(symbol, allocation, stopLoss, takeProfit, strategyUsed) {
        // Skip Telegram notifications in test mode
        if (process.env.NODE_ENV === 'test') {
            logger.info(`Test mode: Skipping Telegram notification for new position ${symbol}`);
            return;
        }
        
        // Create position object format expected by TelegramService
        const position = {
            symbol,
            entryPrices: [await this.binanceService.getCurrentPrice(symbol)],
            stopLoss,
            takeProfit,
            strategyUsed: strategyUsed || 'Adaptive Strategy',
            allocation
        };
        
        try {
            await telegramService.notifyNewPosition(position);
        } catch (error) {
            logger.error(`Error sending new position message: ${error.message}`);
        }
    }

    /**
     * Pozisyon kapandığında mesaj gönderir.
     */
    async notifyPositionClosed(symbol, closePrice, pnlPercent = 0, pnlAmount = 0) {
        // Skip Telegram notifications in test mode
        if (process.env.NODE_ENV === 'test') {
            logger.info(`Test mode: Skipping Telegram notification for closing position ${symbol}`);
            return;
        }
        
        // Create position object with the format expected by TelegramService
        const position = {
            symbol,
            entryPrices: [0], // Not important for closed notification
            closedPrice: closePrice,
            pnlPercent,
            pnlAmount,
            strategyUsed: 'Turtle Trading Strategy'
        };
        
        try {
            await telegramService.notifyPositionClosed(position, 'Market Scanner Signal');
        } catch (error) {
            logger.error(`Error sending position closed message: ${error.message}`);
        }
    }

    /**
     * Hata durumunda mesaj gönderir.
     */
    async notifyError(symbol, errorMessage) {
        // Skip Telegram notifications in test mode
        if (process.env.NODE_ENV === 'test') {
            logger.info(`Test mode: Skipping Telegram error notification for ${symbol}`);
            return;
        }
        
        try {
            await telegramService.notifyError(`Error managing position for ${symbol}`, errorMessage);
        } catch (error) {
            logger.error(`Error sending error message: ${error.message}`);
        }
    }

    /**
     * Config'den tanımlanan sembolleri tarar.
     */
    async scanConfigSymbols() {
        try {
            const symbols = config.topSymbols;
            if (!symbols || symbols.length === 0) {
                logger.warn('No symbols defined in config.topSymbols');
                return;
            }

            logger.info(`Scanning config-defined symbols: ${symbols.join(', ')}`, { timestamp: new Date().toISOString() });

            for (const symbol of symbols) {
                await this.scanSymbol(symbol);
            }
        } catch (error) {
            logger.error('Error scanning config-defined symbols:', error);
        }
    }

    /**
     * Belirli bir sembolü tarar ve pozisyon açma işlemlerini gerçekleştirir.
     */
    /**
  * Belirli bir sembolü tarar ve pozisyon açma işlemlerini gerçekleştirir.
  * Çoklu zaman çerçevesi analizi ve adaptif strateji kullanır.
  */
    async scanSymbol(symbol) {
        try {
            if (!this.binanceService) {
                throw new Error('Binance service is not defined');
            }

            logger.info(`\n=== Scanning ${symbol} with Multi-Timeframe Analysis ===`, { timestamp: new Date().toISOString() });

            // Açık pozisyon kontrolü
            let position = await Position.findOne({ where: { symbol, isActive: true } });
            if (position) {
                logger.info(`Active position found for ${symbol}. Managing position...`);
                
                // Strateji için tercih edilen zaman dilimini kullan veya varsayılan olarak 1h'ı kullan
                const timeframe = this.strategy.preferredTimeframe || '1h';
                const candles = await this.binanceService.getCandles(symbol, timeframe, 100);
                
                if (!candles || candles.length === 0) {
                    logger.warn(`No candles fetched for ${symbol}. Skipping position management.`);
                    return;
                }
                
                // Pozisyon yönetimini burada yap
                await this.managePosition(position, candles);
                return;
            }

            // Açık pozisyon sayısını kontrol et
            const activePositionsCount = await Position.count({ where: { isActive: true } });
            const maxOpenPositions = config.maxOpenPositions || 10;

            if (activePositionsCount >= maxOpenPositions) {
                logger.warn(`Maximum open positions limit (${maxOpenPositions}) reached. Skipping new position for ${symbol}.`);
                return;
            }

            // Stratejiye göre optimize edilmiş zaman dilimlerini kullan
            const mtfData = await this.mtfService.getMultiTimeframeData(symbol, this.strategy);
            
            // Strateji için tercih edilen zaman dilimini kullan veya varsayılan olarak 1h'ı kullan
            const preferredTimeframe = this.strategy.preferredTimeframe || '1h';
            const candles = mtfData.candles[preferredTimeframe] || mtfData.candles['1h'];
            
            if (!candles || candles.length === 0) {
                logger.warn(`No candles fetched for ${symbol} with timeframe ${preferredTimeframe}. Skipping.`);
                return;
            }
            
            logger.info(`Using ${preferredTimeframe} timeframe for ${symbol} with ${this.strategy.constructor.name}`);
            
            // Market koşullarını analiz et
            const marketConditions = await this.strategy.analyzeMarketConditions(mtfData, symbol);
            this.lastMarketConditions[symbol] = marketConditions;
            
            // Log market conditions
            logger.info(`Market conditions for ${symbol}: 
                - Trend: ${marketConditions.trend} (Strength: ${marketConditions.trendStrength}%)
                - Volatility: ${marketConditions.volatility}
                - Market Type: ${marketConditions.marketType}
                - Volume: ${marketConditions.volume}
            `);
            
            // Yeni sinyal üretme (Adaptif Strateji)
            const { signal, stopLoss, takeProfit, allocation, unmetConditions, strategyUsed } = 
                await this.strategy.generateSignal(candles, symbol);

            if (signal === 'NEUTRAL') {
                logger.info(`No actionable signal for ${symbol}.`);
                return;
            }

            // Pozisyon açma
            const currentPrice = candles[candles.length - 1].close;

            if (signal === 'BUY' || signal === 'SELL') {
                await this.openNewPosition(symbol, signal, currentPrice, stopLoss, takeProfit, allocation, strategyUsed);
            } else if (signal === 'WEAK_BUY' || signal === 'WEAK_SELL') {
                const signalType = signal === 'WEAK_BUY' ? 'BUY' : 'SELL';
                await this.sendWeakSignalMessage(
                    symbol, 
                    signalType, 
                    currentPrice, 
                    stopLoss, 
                    takeProfit, 
                    allocation, 
                    unmetConditions,
                    strategyUsed
                );
            } else if (signal === 'ADD_BUY' || signal === 'ADD_SELL') {
                // Mevcut pozisyonu bul ve giriş sayısını arttır
                const { Position } = models;
                const { Op } = require('sequelize');
                const direction = signal === 'ADD_BUY' ? 1 : -1;
                const position = await Position.findOne({
                    where: { 
                        symbol,
                        isActive: true,
                        entries: direction > 0 ? { [Op.gt]: 0 } : { [Op.lt]: 0 }
                    }
                });
                
                if (position) {
                    await this.addToPosition(position, signal, currentPrice, stopLoss, takeProfit, allocation);
                } else {
                    logger.warn(`No active ${direction > 0 ? 'LONG' : 'SHORT'} position found for ${symbol} to add to.`);
                }
            } else if (signal === 'EXIT_BUY' || signal === 'EXIT_SELL') {
                // Pozisyonu kapat
                const { Position } = models;
                const { Op } = require('sequelize');
                const direction = signal === 'EXIT_BUY' ? 1 : -1;
                const position = await Position.findOne({
                    where: { 
                        symbol,
                        isActive: true,
                        entries: direction > 0 ? { [Op.gt]: 0 } : { [Op.lt]: 0 }
                    }
                });
                
                if (position) {
                    await this.closePosition(position, currentPrice, 'turtle_exit_signal');
                    logger.info(`Closed ${direction > 0 ? 'LONG' : 'SHORT'} position for ${symbol} based on Turtle exit signal`);
                } else {
                    logger.warn(`No active ${direction > 0 ? 'LONG' : 'SHORT'} position found for ${symbol} to close.`);
                }
            }
        } catch (error) {
            logger.error(`Error scanning symbol ${symbol}: ${error.message || JSON.stringify(error)}`);
            logger.error(error.stack);
        }
    }

    /**
     * Zayıf sinyaller için özel Telegram mesajı gönderme.
     */
    async handleWeakSignal(symbol, signal, entryPrice, stopLoss, takeProfit, allocation, unmetConditions) {
        if (signal === 'WEAK_BUY' || signal === 'WEAK_SELL') {
            const signalType = signal === 'WEAK_BUY' ? 'BUY' : 'SELL';
            await this.sendWeakSignalMessage(symbol, signalType, entryPrice, stopLoss, takeProfit, allocation, unmetConditions);
        }
    }

    /**
     * Pozisyona ilave işlem açma (pyramiding)
     */
    async addToPosition(position, signal, entryPrice, stopLoss, takeProfit, allocation) {
        try {
            const side = signal === 'ADD_BUY' ? 'BUY' : 'SELL';
            const positionSide = signal === 'ADD_BUY' ? 'LONG' : 'SHORT';
            const symbol = position.symbol;
            
            // Validate parameters
            if (!position || !position.isActive) {
                logger.error(`Cannot add to inactive or invalid position for ${symbol}`);
                return false;
            }
            
            // Önceki giriş sayısını al ve arttır
            const existingEntries = Math.abs(position.entries);
            const newEntryCount = existingEntries + 1;
            
            // Strateji parametrelerinden maximum giriş sayısını al
            const maxEntries = this.strategy && this.strategy.parameters ? 
                this.strategy.parameters.maxEntries : 4;
                
            if (newEntryCount > maxEntries) {
                logger.warn(`Maximum entry count (${maxEntries}) reached for ${symbol}. Not adding more.`);
                return false;
            }
            
            // Mevcut fiyatı doğrula
            const currentPrice = await this.binanceService.getCurrentPrice(symbol);
            if (!currentPrice) {
                logger.error(`Failed to get current price for ${symbol} when adding to position`);
                return false;
            }
            
            // Mevcut fiyat ile gönderilen fiyat arasında fazla fark varsa kontrol et
            if (Math.abs(currentPrice - entryPrice) / entryPrice > 0.01) { // %1'den fazla fark varsa
                logger.warn(`Entry price (${entryPrice}) differs significantly from current price (${currentPrice}) for ${symbol}`);
                // Güncel fiyatı kullan
                entryPrice = currentPrice;
            }
            
            // Pozisyon boyutunu hesapla - Turtle Trading için her giriş için yalnızca pozisyon boyutunu kullan
            // /4 ifadesi Turtle Trading stratejisi için bir gerekliliktir (her giriş toplam riskin 1/4'ü olarak alınır)
            let positionSize;
            if (allocation && allocation > 0) {
                positionSize = allocation;
            } else {
                const rawAmount = config.calculate_position_size 
                    ? config.riskPerTrade * await this.binanceService.getFuturesBalance()
                    : config.static_position_size;
                // Turtle Trading stratejisi için 1/4 kullanımı
                positionSize = rawAmount / 4;
            }
                
            // Miktar hesaplama
            const quantity = await this.orderService.calculateStaticPositionSize(symbol, positionSize);
            
            if (!quantity || quantity <= 0) {
                logger.error(`Invalid quantity calculated for ${symbol}: ${quantity}`);
                return false;
            }
            
            logger.info(`Adding to ${positionSide} position for ${symbol} (Entry #${newEntryCount}/${maxEntries}):
                - Current Price: ${currentPrice}
                - Position Size: ${positionSize} USDT
                - Quantity: ${quantity}
                - New Stop Loss: ${stopLoss}
                - New Take Profit: ${takeProfit}
            `);
            
            // Market emri ile ekstra alım yap - Pozisyon modunu kontrol et
            const useHedgeMode = config.positionSideMode === 'Hedge';
            const orderPositionSide = useHedgeMode ? positionSide : undefined;
            
            // Açık emirleri önce iptal et
            try {
                const canceled = await this.binanceService.cancelAllOpenOrders(symbol);
                if (canceled) {
                    logger.info(`Successfully cancelled open orders for ${symbol} before adding to position`);
                } else {
                    logger.warn(`Failed to cancel open orders for ${symbol}. Will proceed with adding to position.`);
                }
                
                // Kısa bir bekleme
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (cancelError) {
                logger.error(`Error cancelling open orders for ${symbol}: ${cancelError.message}`);
            }
            
            // Market emri ile pozisyon ekle
            const marketOrderResult = await this.orderService.placeMarketOrder({
                symbol,
                side,
                quantity,
                positionSide: orderPositionSide
            });
            
            if (!marketOrderResult) {
                throw new Error(`Failed to place market order for ${symbol} when adding to position`);
            }
            
            // Kısa bir bekleme
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Yeni stop loss ve take profit emirleri yerleştir
            const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
            const closePositionSide = useHedgeMode ? positionSide : undefined;
            
            // Total quantity hesapla
            const totalQuantity = position.totalAllocation / entryPrice + quantity;
            
            // Stop Loss Order
            try {
                await this.orderService.placeStopLossOrder({
                    symbol,
                    side: closeSide,
                    quantity: totalQuantity,
                    stopPrice: stopLoss,
                    positionSide: closePositionSide
                });
                
                logger.info(`Updated Stop Loss order placed for ${symbol} at ${stopLoss}`);
            } catch (slError) {
                logger.error(`Error placing updated Stop Loss order for ${symbol}: ${slError.message}`);
            }
            
            // Take Profit Order
            try {
                await this.orderService.placeTakeProfitOrder({
                    symbol,
                    side: closeSide,
                    quantity: totalQuantity,
                    stopPrice: takeProfit,
                    positionSide: closePositionSide
                });
                
                logger.info(`Updated Take Profit order placed for ${symbol} at ${takeProfit}`);
            } catch (tpError) {
                logger.error(`Error placing updated Take Profit order for ${symbol}: ${tpError.message}`);
            }
            
            // Pozisyon bilgilerini güncelle
            position.entryPrices.push(entryPrice);
            position.totalAllocation += parseFloat(positionSize);
            position.entries = (signal === 'ADD_BUY') ? newEntryCount : -newEntryCount;
            
            // Stop loss ve take profit seviyelerini güncelle
            position.stopLoss = stopLoss;
            position.takeProfit = takeProfit;
            position.updatedAt = new Date();
            
            await position.save();
            
            // Bildirim mesajı
            const message = `
🔄 Position Addition (${newEntryCount}/${maxEntries}):
- Symbol: ${symbol}
- Direction: ${positionSide}
- Entry Price: ${entryPrice}
- Entry Size: ${positionSize.toFixed(2)} USDT
- Total Position: ${position.totalAllocation.toFixed(2)} USDT
- Updated Stop Loss: ${stopLoss}
- Updated Take Profit: ${takeProfit}
            `;
            
            logger.info(message);
            try {
                await this.bot.telegram.sendMessage(this.chatId, message);
            } catch (notifyError) {
                logger.error(`Error sending notification: ${notifyError.message}`);
            }
            
            return true;
        } catch (error) {
            logger.error(`Error adding to position for ${position.symbol}: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);
            
            try {
                await this.notifyError(position.symbol, `Failed to add to position: ${error.message}`);
            } catch (notifyError) {
                logger.error(`Error sending notification: ${notifyError.message}`);
            }
            
            return false;
        }
    }
    
    async calculateQuantityFromUSDT(symbol, usdtAmount) {
        try {
            // 1. Sembolün mevcut fiyatını al
            const price = await this.getCurrentPrice(symbol)

            // 2. USDT'yi coin miktarına çevir: miktar = USDT / fiyat
            const rawQuantity = usdtAmount / price

            // 3. Sembolün lot size kurallarını al
            const stepSize = await this.getStepSize(symbol)

            // 4. Miktarı Binance'ın kurallarına uygun şekilde yuvarla
            const precision = Math.log10(1 / stepSize)
            const quantity = Math.floor(rawQuantity / stepSize) * stepSize

            return parseFloat(quantity.toFixed(precision))
        } catch (error) {
            logger.error(`Quantity calculation error: ${error.message}`)
            throw error
        }
    }

    // Bollinger bandı hesaplama metodu
    calculateBollingerBands(candles) {
        const closePrices = candles.map(c => parseFloat(c.close)).filter(price => !isNaN(price)); // Filter out invalid prices

        const period = 20; // Bollinger Band periyodu
        const stdDevMultiplier = 2;

        if (closePrices.length < period) {
            throw new Error('Not enough data to calculate Bollinger Bands.');
        }

        const recentPrices = closePrices.slice(-period);
        const mean = recentPrices.reduce((acc, val) => acc + val, 0) / period;
        const variance = recentPrices.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        return {
            upper: mean + stdDevMultiplier * stdDev,
            lower: mean - stdDevMultiplier * stdDev,
            basis: mean,
        };
    }

    // Pozisyonu kapatma metodu
    async closePosition(position, closePrice, exitReason = 'manual') {
        const { symbol, totalAllocation, entries, entryPrices } = position;
        const side = entries > 0 ? 'SELL' : 'BUY';
        const positionSide = entries > 0 ? 'LONG' : 'SHORT';

        try {
            // Önce açık emirleri iptal et (TP/SL/Trailing Stop)
            try {
                await this.binanceService.cancelAllOpenOrders(symbol);
                logger.info(`Cancelled all open orders for ${symbol} before closing position`);
            } catch (cancelError) {
                logger.warn(`Failed to cancel open orders for ${symbol}: ${cancelError.message}. Proceeding with position closure.`);
            }
            
            // Kısa bir bekleme süresi ekle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Pozisyon büyüklüğünü hesapla
            const quantity = await this.orderService.calculateStaticPositionSize(symbol, totalAllocation);
            
            if (!quantity || quantity <= 0) {
                throw new Error(`Invalid quantity calculated for ${symbol}: ${quantity}`);
            }
            
            logger.info(`Closing ${positionSide} position for ${symbol}:
                - Close Price: ${closePrice}
                - Quantity: ${quantity}
                - Total Allocation: ${totalAllocation} USDT
                - Exit Reason: ${exitReason}
            `);
            
            // Pozisyonu kapat
            const result = await this.orderService.closePosition(symbol, side, quantity, positionSide);
            
            if (!result) {
                throw new Error(`Failed to close position for ${symbol}. Order service returned no result.`);
            }

            // PnL hesaplama
            const avgEntryPrice = entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / entryPrices.length;
            let pnlPercent, pnlAmount;
            
            if (entries > 0) { // LONG pozisyon
                pnlPercent = ((closePrice - avgEntryPrice) / avgEntryPrice) * 100;
            } else { // SHORT pozisyon
                pnlPercent = ((avgEntryPrice - closePrice) / avgEntryPrice) * 100;
            }
            
            pnlAmount = (totalAllocation * pnlPercent) / 100;
            
            // Pozisyon süresini hesapla (dakika cinsinden)
            const createdAt = new Date(position.createdAt);
            const closedAt = new Date();
            const holdTime = Math.round((closedAt - createdAt) / (1000 * 60));
            
            // DB'de pozisyonu güncelle
            position.isActive = false;
            position.closedPrice = closePrice;
            position.closedAt = closedAt;
            position.exitReason = exitReason;
            position.pnlPercent = pnlPercent;
            position.pnlAmount = pnlAmount;
            position.holdTime = holdTime;
            
            await position.save();

            // Turtle stratejisi için performans metrikleri güncelleniyor mu kontrol et
            if (this.performanceTracker) {
                try {
                    await this.performanceTracker.updatePerformance({
                        symbol,
                        entryPrice: avgEntryPrice,
                        exitPrice: closePrice,
                        side: entries > 0 ? 'LONG' : 'SHORT',
                        pnlPercent,
                        pnlAmount,
                        holdTime,
                        exitReason,
                        strategy: position.strategyUsed || 'TurtleTradingStrategy'
                    });
                } catch (error) {
                    logger.error(`Error updating performance metrics: ${error.message}`);
                }
            }

            logger.info(`Position for ${symbol} closed at price ${closePrice}. PnL: ${pnlPercent.toFixed(2)}% (${pnlAmount.toFixed(2)} USDT)`);
            await this.notifyPositionClosed(symbol, closePrice, pnlPercent, pnlAmount);
            
            return true;
        } catch (error) {
            logger.error(`Error closing position for ${symbol}: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);
            
            // Eğer Binance'dan hata alırsak bile DB'de kapatalım
            try {
                // Pozisyonun gerçekten açık olup olmadığını Binance'den kontrol et
                const openPositions = await this.binanceService.getOpenPositions();
                const isStillOpen = openPositions.some(pos => 
                    pos.symbol === symbol && Math.abs(parseFloat(pos.positionAmt)) > 0
                );
                
                if (!isStillOpen) {
                    // Pozisyon Binance'de kapanmış, DB'yi güncelle
                    position.isActive = false;
                    position.closedPrice = closePrice;
                    position.closedAt = new Date();
                    position.exitReason = `Auto-closed: ${exitReason}`;
                    await position.save();
                    
                    logger.info(`Position for ${symbol} was already closed on Binance. Updated database.`);
                    return true;
                }
                
                // Pozisyon hala açık, manuel müdahale gerekebilir
                logger.warn(`Position for ${symbol} is still open on Binance but closing operation failed. Manual intervention may be required.`);
                
                // DB'yi güncellemek için
                position.exitReason = `Error: ${error.message}`;
                await position.save();
            } catch (dbError) {
                logger.error(`Error updating position in database: ${dbError.message}`);
            }
            
            return false;
        }
    }

    getNextCandleCloseTime(timeframe) {
        const now = new Date();
        const timeframes = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '1h': 60 * 60 * 1000,
        };
        const ms = timeframes[timeframe] || 60 * 60 * 1000;
        return new Date(Math.ceil(now.getTime() / ms) * ms);
    }
    async openNewPosition(symbol, signal, entryPrice, stopLoss, takeProfit, allocation, strategyUsed) {
        try {
            // Validate parameters
            if (!symbol || !signal || !entryPrice || !stopLoss || !takeProfit) {
                logger.error(`Missing required parameters for opening position: 
                    Symbol: ${symbol}, Signal: ${signal}, Entry Price: ${entryPrice}, 
                    Stop Loss: ${stopLoss}, Take Profit: ${takeProfit}`
                );
                return false;
            }
            
            // Check if we already have an active position for this symbol
            try {
                const existingPosition = await Position.findOne({ where: { symbol, isActive: true } });
                if (existingPosition) {
                    logger.warn(`Attempted to open new position for ${symbol} but there's already an active position`);
                    return false;
                }
            } catch (dbError) {
                // In test mode, ignore DB errors and proceed
                if (process.env.NODE_ENV === 'test') {
                    logger.warn(`Test mode: Ignoring database error for position check: ${dbError.message}`);
                } else {
                    logger.error(`Database error checking for existing positions: ${dbError.message}`);
                    return false;
                }
            }
            
            // Pozisyon boyutunu hesapla - Turtle Trading için her giriş için yalnızca pozisyon boyutunu kullan
            // /4 ifadesi Turtle Trading stratejisi için bir gerekliliktir (her giriş toplam riskin 1/4'ü olarak alınır)
            let positionSize;
            if (allocation && allocation > 0) {
                positionSize = allocation;
            } else {
                const rawAmount = config.calculate_position_size 
                    ? config.riskPerTrade * await this.binanceService.getFuturesBalance()
                    : config.static_position_size;
                // Turtle Trading stratejisi için 1/4 kullanımı
                positionSize = rawAmount / 4;
            }
    
            // Calculate quantity based on allocation
            const quantity = await this.orderService.calculateStaticPositionSize(symbol, positionSize);
            
            if (!quantity || quantity <= 0) {
                logger.error(`Invalid quantity calculated for ${symbol}: ${quantity}`);
                return false;
            }
    
            // Log the position opening
            logger.info(`Opening position for ${symbol}: 
                - Entry Price: ${entryPrice}
                - Signal: ${signal}
                - Strategy Used: ${strategyUsed || 'TurtleTradingStrategy'}
                - Market Conditions: ${JSON.stringify(this.lastMarketConditions[symbol] || {})}
                - Quantity: ${quantity}
                - Allocation: ${positionSize} USDT
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
            `);
    
            // Cancel any existing orders for this symbol first
            try {
                const canceled = await this.binanceService.cancelAllOpenOrders(symbol);
                if (canceled) {
                    logger.info(`Successfully cancelled all existing orders for ${symbol} before opening new position`);
                } else {
                    logger.warn(`Failed to cancel existing orders for ${symbol}. Proceeding with new position anyway.`);
                }
                
                // Short delay after cancellation
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (cancelError) {
                logger.warn(`Error cancelling existing orders for ${symbol}: ${cancelError.message}`);
            }
    
            // Place market order to open position
            const useHedgeMode = config.positionSideMode === 'Hedge';
            const positionSide = useHedgeMode ? (signal === 'BUY' ? 'LONG' : 'SHORT') : undefined;
            
            // Position Side modu kontrolü logları
            logger.info(`Position Mode Settings:
                - config.positionSideMode: ${config.positionSideMode}
                - useHedgeMode: ${useHedgeMode}
                - positionSide: ${positionSide || 'undefined (One-Way Mode)'}
            `);
            
            try {
                const marketOrderResult = await this.orderService.placeMarketOrder({
                    symbol,
                    side: signal,
                    quantity,
                    positionSide,
                });
                logger.info(`Market order result details: ${JSON.stringify(marketOrderResult)}`);
                return marketOrderResult;
            } catch (orderError) {
                logger.error(`Failed to place market order: ${orderError.message}`);
                if (orderError.response && orderError.response.data) {
                    logger.error(`API error details: ${JSON.stringify(orderError.response.data)}`);
                }
                throw orderError;
            }
            // Market order sonuçlarını kontrol et
            if (!marketOrderResult) {
                throw new Error(`Failed to place market order for ${symbol}`);
            }
            
            logger.info(`Market order placed successfully for ${symbol}: ${JSON.stringify(marketOrderResult)}`);
            
            // Short delay after market order
            await new Promise(resolve => setTimeout(resolve, 1000));
    
            // Setup stop loss and take profit orders
            const closeSide = signal === 'BUY' ? 'SELL' : 'BUY';
            // Only provide positionSide if hedge mode is active
            const closePositionSide = useHedgeMode ? (signal === 'BUY' ? 'LONG' : 'SHORT') : undefined;
    
            // Get current price to confirm entry
            const confirmPrice = await this.binanceService.getCurrentPrice(symbol);
            if (confirmPrice) {
                logger.info(`Confirmed entry price for ${symbol}: ${confirmPrice} (Original: ${entryPrice})`);
                
                // Use the updated price if it's significantly different (>0.5%)
                if (Math.abs(confirmPrice - entryPrice) / entryPrice > 0.005) {
                    logger.warn(`Entry price has changed significantly for ${symbol}: ${entryPrice} -> ${confirmPrice}`);
                    // Update entry price but keep original SL/TP levels for safety
                    entryPrice = confirmPrice;
                }
            }
    
            // Stop Loss Order
            try {
                const stopLossResult = await this.orderService.placeStopLossOrder({
                    symbol,
                    side: closeSide,
                    quantity,
                    stopPrice: stopLoss,
                    positionSide: closePositionSide,
                });
                
                logger.info(`Stop Loss order placed for ${symbol} at ${stopLoss}`);
            } catch (slError) {
                logger.error(`Error placing Stop Loss order for ${symbol}: ${slError.message}`);
                // Continue anyway - the position will need manual management
            }
    
            // Take Profit Order
            try {
                const takeProfitResult = await this.orderService.placeTakeProfitOrder({
                    symbol,
                    side: closeSide,
                    quantity,
                    stopPrice: takeProfit,
                    positionSide: closePositionSide,
                });
                
                logger.info(`Take Profit order placed for ${symbol} at ${takeProfit}`);
            } catch (tpError) {
                logger.error(`Error placing Take Profit order for ${symbol}: ${tpError.message}`);
                // Continue anyway - the position will need manual management
            }
    
            // Create position record in database
            let position;
            try {
                position = await Position.create({
                    symbol,
                    entries: signal === 'BUY' ? 1 : -1,
                    entryPrices: [entryPrice],
                    totalAllocation: positionSize,
                    isActive: true,
                    step: 1,
                    nextCandleCloseTime: this.getNextCandleCloseTime('1h'),
                    stopLoss,
                    takeProfit,
                    strategyUsed: strategyUsed || 'TurtleTradingStrategy',
                    marketConditions: JSON.stringify(this.lastMarketConditions[symbol] || {}),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                
                if (!position) {
                    logger.error(`Failed to create position record in database for ${symbol}`);
                } else {
                    logger.info(`Position record created in database for ${symbol} with ID ${position.id}`);
                }
            } catch (dbError) {
                // In test mode, create a mock position object
                if (process.env.NODE_ENV === 'test') {
                    logger.warn(`Test mode: Creating mock position for ${symbol} due to DB error: ${dbError.message}`);
                    position = {
                        symbol,
                        entries: signal === 'BUY' ? 1 : -1,
                        entryPrices: [entryPrice],
                        totalAllocation: positionSize,
                        isActive: true,
                        step: 1,
                        stopLoss,
                        takeProfit,
                        strategyUsed: strategyUsed || 'TurtleTradingStrategy',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                } else {
                    logger.error(`Database error creating position: ${dbError.message}`);
                }
            }
    
            logger.info(`New position opened for ${symbol} with allocation ${positionSize} USDT, Stop Loss=${stopLoss}, Take Profit=${takeProfit}.`);
            
            try {
                await this.notifyNewPosition(symbol, positionSize, stopLoss, takeProfit, strategyUsed);
            } catch (notifyError) {
                logger.error(`Error sending notification for new position: ${notifyError.message}`);
            }
            
            return true;
        } catch (error) {
            logger.error(`Error opening new position for ${symbol}: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);
            
            try {
                await this.notifyError(symbol, `Failed to open position: ${error.message}`);
            } catch (notifyError) {
                logger.error(`Error sending notification: ${notifyError.message}`);
            }
            
            return false;
        }
    }

    async managePosition(position, candles) {
        try {
            const { symbol, entries, stopLoss, takeProfit, totalAllocation, entryPrices } = position;
            
            // Gerçek zamanlı fiyat almak için Binance API'sini kullan (daha doğru sonuçlar için)
            const currentPrice = await this.binanceService.getCurrentPrice(symbol);
            if (!currentPrice) {
                logger.error(`Failed to get current price for ${symbol}. Skipping position management.`);
                return;
            }
            
            const lastCandle = candles[candles.length - 1];
            const isLong = entries > 0;
            const isShort = entries < 0;
            
            // Ortalama giriş fiyatını hesapla
            const avgEntryPrice = entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / entryPrices.length;
            
            // Mevcut kar/zarar hesapla
            const currentPnL = isLong 
                ? ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100 
                : ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
            
            logger.info(`Managing ${isLong ? 'LONG' : 'SHORT'} position for ${symbol}:
                - Current Price: ${currentPrice}
                - Entry Price(s): ${entryPrices.join(', ')} (Avg: ${avgEntryPrice})
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
                - Total Allocation: ${totalAllocation}
                - Current PnL: ${currentPnL.toFixed(2)}%
            `);

            // Turtle Trading stratejisi için çıkış koşullarına bakın
            if (this.strategy.constructor.name === 'TurtleTradingStrategy') {
                // Turtle Trading için özel çıkış kuralları
                const exitDonchian = this.strategy.calculateDonchianChannel(candles, this.strategy.parameters.exitChannel);
                
                logger.info(`Turtle exit channel - Upper: ${exitDonchian.upper.toFixed(4)}, Lower: ${exitDonchian.lower.toFixed(4)}`);
                
                if (isLong && lastCandle.low <= exitDonchian.lower) {
                    logger.info(`Turtle exit signal (lower band break) for LONG position on ${symbol}. Closing position at ${currentPrice}.`);
                    await this.closePosition(position, currentPrice, 'turtle_exit_signal');
                    return;
                } else if (isShort && lastCandle.high >= exitDonchian.upper) {
                    logger.info(`Turtle exit signal (upper band break) for SHORT position on ${symbol}. Closing position at ${currentPrice}.`);
                    await this.closePosition(position, currentPrice, 'turtle_exit_signal');
                    return;
                }
            }

            // Standart TP/SL kontrolü
            let shouldClose = false;
            let exitReason = '';

            // Stop loss ve take profit için daha kesin kontrol
            // Not: Piyasa volatilitesi için küçük bir tampon ekleyelim
            const slBuffer = 0.001; // %0.1 buffer
            const tpBuffer = 0.001; // %0.1 buffer

            if (isLong) {
                if (currentPrice >= takeProfit * (1 - tpBuffer)) {
                    logger.info(`Take profit reached for LONG position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                    exitReason = 'take_profit';
                } else if (currentPrice <= stopLoss * (1 + slBuffer)) {
                    logger.info(`Stop loss reached for LONG position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                    exitReason = 'stop_loss';
                }
            } else if (isShort) {
                if (currentPrice <= takeProfit * (1 + tpBuffer)) {
                    logger.info(`Take profit reached for SHORT position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                    exitReason = 'take_profit';
                } else if (currentPrice >= stopLoss * (1 - slBuffer)) {
                    logger.info(`Stop loss reached for SHORT position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                    exitReason = 'stop_loss';
                }
            }

            // Trailing stop kontrolü
            if (!shouldClose && config.trailingStop && config.trailingStop.use) {
                const trailingStopResult = this.checkTrailingStop(position, currentPrice);
                if (trailingStopResult.triggered) {
                    logger.info(`Trailing stop triggered for ${isLong ? 'LONG' : 'SHORT'} position on ${symbol} at ${currentPrice}.`);
                    shouldClose = true;
                    exitReason = 'trailing_stop';
                }
            }

            if (shouldClose) {
                // Açık emirlerin iptali (eğer varsa)
                try {
                    const canceled = await this.binanceService.cancelAllOpenOrders(symbol);
                    if (canceled) {
                        logger.info(`Successfully cancelled all open orders for ${symbol} before closing position`);
                    } else {
                        logger.warn(`Failed to cancel all open orders for ${symbol}. Proceeding with position closure.`);
                    }
                    
                    // Kısa bir bekleme ekle
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    logger.error(`Error cancelling open orders for ${symbol}: ${error.message}`);
                }
                
                const closed = await this.closePosition(position, currentPrice, exitReason);
                if (closed) {
                    logger.info(`Position closed successfully for ${symbol} at ${currentPrice}. Reason: ${exitReason}`);
                } else {
                    logger.error(`Failed to close position for ${symbol} at ${currentPrice}. Reason: ${exitReason}`);
                }
            } else {
                // Pozisyon güncelleme işlemleri (trailing stop, vb.)
                await this.updatePositionIfNeeded(position, currentPrice, candles);
                
                logger.info(`Position maintained for ${symbol}. Current Price=${currentPrice}, Stop Loss=${stopLoss}, Take Profit=${takeProfit}`);
            }
        } catch (error) {
            logger.error(`Error managing position for ${symbol}: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);
            try {
                await this.notifyError(position.symbol, error.message);
            } catch (notifyError) {
                logger.error(`Error sending notification: ${notifyError.message}`);
            }
        }
    }
    
    /**
     * Trailing stop kontrolü yapar
     */
    checkTrailingStop(position, currentPrice) {
        if (!position || !position.entryPrices || position.entryPrices.length === 0) {
            logger.error(`Invalid position data for trailing stop check`);
            return { triggered: false };
        }
        
        const { entries, entryPrices, highWaterMark } = position;
        const isLong = entries > 0;
        
        // Ortalama giriş fiyatını hesapla
        const entryPrice = entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / entryPrices.length;
        
        // Mevcut kar/zarar hesapla
        let profitPercent;
        if (isLong) {
            profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
        } else {
            profitPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
        }
        
        // Config'den trailing stop parametrelerini al
        const activationThreshold = config.trailingStop.activationPercent || 1.0; // Örneğin %1 kar
        const callbackRate = config.trailingStop.callbackRate || 0.5; // Örneğin %0.5 geri çekilme
        
        // Profit değerimiz threshold'dan büyükse işlem yap
        if (profitPercent > activationThreshold) {
            // Veritabanında highWaterMark field'ı yoksa, şu anki profiti kullan
            // Bu değeri veritabanında saklamak daha doğru olur - gelecekte implement edilebilir
            let currentHighWaterMark = highWaterMark || profitPercent;
            
            // Eğer mevcut profit HWM'den daha yüksekse, güncelle
            if (profitPercent > currentHighWaterMark) {
                currentHighWaterMark = profitPercent;
                
                // Eğer veritabanında saklamak istersek, burada position'u güncellerdik
                // position.highWaterMark = currentHighWaterMark;
                // await position.save();
                
                logger.info(`New high water mark for ${position.symbol}: ${currentHighWaterMark.toFixed(2)}%`);
            }
            
            // HWM'den ne kadar geri çekildiğini hesapla
            const pullback = currentHighWaterMark - profitPercent;
            
            logger.info(`Trailing stop check for ${position.symbol}:
                - Current profit: ${profitPercent.toFixed(2)}%
                - High water mark: ${currentHighWaterMark.toFixed(2)}%
                - Pullback: ${pullback.toFixed(2)}%
                - Callback threshold: ${callbackRate}%
                - Activation threshold: ${activationThreshold}%
            `);
            
            // Eğer geri çekilme trailing stop oranını aştıysa, pozisyonu kapat
            if (pullback >= callbackRate) {
                return { 
                    triggered: true, 
                    reason: `Trailing stop: ${pullback.toFixed(2)}% pullback from ${currentHighWaterMark.toFixed(2)}% profit`,
                    highWaterMark: currentHighWaterMark,
                    pullback: pullback
                };
            }
        } else {
            logger.info(`Current profit ${profitPercent.toFixed(2)}% for ${position.symbol} is below trailing stop activation threshold (${activationThreshold}%)`);
        }
        
        return { triggered: false };
    }
    
    /**
     * Pozisyon güncelleme işlemleri (gerekirse)
     */
    async updatePositionIfNeeded(position, currentPrice, candles) {
        const { symbol, entries, stopLoss, takeProfit } = position;
        const isLong = entries > 0;
        
        // Turtle stratejisi için, ATR değerine göre stop loss güncelleme
        if (this.strategy && this.strategy.constructor.name === 'TurtleTradingStrategy') {
            try {
                // ATR hesaplaması
                const atr = this.strategy.calculateATR(candles, this.strategy.parameters.atrPeriod);
                if (!atr || isNaN(atr)) {
                    logger.warn(`Invalid ATR value calculated for ${symbol}: ${atr}`);
                    return;
                }
                
                const atrMultiplier = this.strategy.parameters.atrMultiplier || 2;
                const breakEvenActivationPercent = this.strategy.parameters.breakEvenActivationPercent || 0.8;
                const useBreakEven = this.strategy.parameters.useBreakEven !== false; // Default true
                
                if (!useBreakEven) {
                    logger.info(`Break-even feature is disabled for ${symbol}`);
                    return;
                }
                
                // Break-even seviyesi - ATR'nin breakEvenActivationPercent katı kadar kar yaparsa
                const breakEvenThreshold = atr * atrMultiplier * breakEvenActivationPercent;
                
                // Ortalama giriş fiyatı
                const avgEntryPrice = position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length;
                
                // Kar hesaplama
                let profit, profitPercent;
                if (isLong) {
                    profit = currentPrice - avgEntryPrice;
                    profitPercent = (profit / avgEntryPrice) * 100;
                } else {
                    profit = avgEntryPrice - currentPrice;
                    profitPercent = (profit / avgEntryPrice) * 100;
                }
                
                logger.info(`Break-even check for ${symbol}:
                    - Average Entry: ${avgEntryPrice}
                    - Current Price: ${currentPrice}
                    - Current Profit: ${profit.toFixed(4)} (${profitPercent.toFixed(2)}%)
                    - ATR: ${atr.toFixed(4)}
                    - Break-even Threshold: ${breakEvenThreshold.toFixed(4)} (${breakEvenActivationPercent * atrMultiplier} x ATR)
                    - Current Stop Loss: ${stopLoss}
                `);
                
                // Eğer kar breakEvenThreshold'u aştıysa, stop loss'u break-even'a taşı
                if (profit >= breakEvenThreshold) {
                    // Yeni stop loss seviyesi - giriş seviyesine ATR'nin bir kısmını ekleyerek küçük bir buffer ver
                    let newStopLoss;
                    if (isLong) {
                        // Long pozisyonlar için giriş fiyatı veya biraz üstü
                        newStopLoss = avgEntryPrice + (atr * 0.1); // Giriş seviyesinden %10 ATR yukarıda
                    } else {
                        // Short pozisyonlar için giriş fiyatı veya biraz altı
                        newStopLoss = avgEntryPrice - (atr * 0.1); // Giriş seviyesinden %10 ATR aşağıda
                    }
                    
                    // Eğer yeni stop loss daha iyiyse (long için daha yüksek, short için daha düşük)
                    if ((isLong && newStopLoss > stopLoss) || (!isLong && newStopLoss < stopLoss)) {
                        // Stop loss güncelleme
                        logger.info(`Break-even triggered for ${symbol}. Updating stop loss from ${stopLoss} to ${newStopLoss.toFixed(4)}`);
                        
                        // Veritabanında güncelle
                        position.stopLoss = newStopLoss;
                        position.breakEvenTriggered = true; // İsterseniz veritabanı modelinde bu alanı ekleyebilirsiniz
                        await position.save();
                        
                        // Telegram üzerinden bildirim gönder
                        try {
                            const message = `
                                🔄 Break-even activated for ${symbol}:
                                - Position: ${isLong ? 'LONG' : 'SHORT'}
                                - Entry: ${avgEntryPrice}
                                - New Stop Loss: ${newStopLoss.toFixed(4)}
                                - Current Price: ${currentPrice}
                                - Profit: ${profitPercent.toFixed(2)}%
                            `;
                            await this.bot.telegram.sendMessage(this.chatId, message);
                        } catch (notifyError) {
                            logger.error(`Error sending break-even notification: ${notifyError.message}`);
                        }
                        
                        // Mevcut emirleri iptal et ve yeni stop loss emri ver
                        try {
                            // Tüm açık emirleri iptal et
                            const canceled = await this.binanceService.cancelAllOpenOrders(symbol);
                            if (!canceled) {
                                logger.warn(`Failed to cancel open orders for ${symbol}. Continuing with placing new orders.`);
                            }
                            
                            // Kısa bir bekleme
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // Yeni stop loss emri ver
                            const side = isLong ? 'SELL' : 'BUY';
                            const positionSide = isLong ? 'LONG' : 'SHORT';
                            const quantity = await this.orderService.calculateStaticPositionSize(symbol, position.totalAllocation);
                            
                            if (!quantity || quantity <= 0) {
                                throw new Error(`Invalid quantity calculated for ${symbol}: ${quantity}`);
                            }
                            
                            // Stop loss emri
                            await this.orderService.placeStopLossOrder({
                                symbol,
                                side,
                                quantity,
                                stopPrice: newStopLoss,
                                positionSide
                            });
                            
                            logger.info(`New stop loss order placed for ${symbol} at ${newStopLoss.toFixed(4)}`);
                            
                            // Take profit emrini de tekrar yerleştir
                            if (takeProfit) {
                                await this.orderService.placeTakeProfitOrder({
                                    symbol,
                                    side,
                                    quantity,
                                    stopPrice: takeProfit,
                                    positionSide
                                });
                                logger.info(`New take profit order placed for ${symbol} at ${takeProfit}`);
                            }
                        } catch (error) {
                            logger.error(`Error updating orders for ${symbol}: ${error.message}`);
                            logger.error(`Stack trace: ${error.stack}`);
                        }
                    } else {
                        logger.info(`Break-even level reached for ${symbol}, but current stop loss (${stopLoss}) is already better than break-even level (${newStopLoss.toFixed(4)})`);
                    }
                } else {
                    logger.info(`Profit (${profit.toFixed(4)}) for ${symbol} hasn't reached break-even threshold (${breakEvenThreshold.toFixed(4)}) yet`);
                }
            } catch (error) {
                logger.error(`Error updating position for ${symbol}: ${error.message}`);
                logger.error(`Stack trace: ${error.stack}`);
            }
        }
    }

    async addOrderToPosition(position, entryPrice, allocation) {
        try {
            position.entries += 1;
            position.entryPrices = [...position.entryPrices, entryPrice];
            position.totalAllocation += allocation;
            await position.save();

            // Emir yönünü belirleme
            const signal = allocation > 0 ? 'SELL' : 'BUY'; // Signal kesinleşmeli
            const positionSide = signal === 'BUY' ? 'LONG' : 'SHORT'; // Hedge moduna göre ayarlanabilir

            if (!signal || allocation <= 0) {
                logger.error(`Invalid signal or allocation for ${position.symbol}. Signal: ${signal}, Allocation: ${allocation}`);
                return;
            }

            const orderData = {
                symbol: position.symbol,
                side: signal,
                quantity: allocation,
                positionSide,
            };

            logger.info(`Placing MARKET order for ${position.symbol}:`, orderData);
            await this.binanceService.placeMarketOrder(orderData);
        } catch (error) {
            logger.error(`Error placing market order for ${position.symbol}: ${error.message}`);
            throw error;
        }
    }

}

module.exports = MarketScanner;
