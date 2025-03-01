// services/MarketScanner.js

const AdaptiveStrategy = require('../strategies/AdaptiveStrategy');
const config = require('../config/config');
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Telegraf } = require('telegraf');
const { Position } = models;
const dotenv = require("dotenv");
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

const BinanceService = require('../services/BinanceService');
const OrderService = require('../services/OrderService');
const MultiTimeframeService = require('../services/MultiTimeframeService');
const EnhancedPositionManager = require('../services/EnhancedPositionManager');

(async () => {
    try {
        dotenv.config();
        bot.start((ctx) => ctx.reply('Binance Futures Bot Online!'));
        bot.launch();
        
        const binanceService = new BinanceService();
        await binanceService.initialize();

        const orderService = new OrderService(binanceService);
        const mtfService = new MultiTimeframeService(binanceService);
        await mtfService.initialize();
        
        const marketScanner = new MarketScanner(binanceService, orderService, mtfService);
        await marketScanner.initialize();

        logger.info('Market Scanner started with Adaptive Strategy and Multi-Timeframe Analysis.');

        // Market taramasını başlat
        await marketScanner.scanAllSymbols();

        // Periyodik tarama
        setInterval(async () => {
            try {
                await marketScanner.scanAllSymbols();
                await marketScanner.flushWeakSignalBuffer();
            } catch (error) {
                logger.error('Error during Market Scanner periodic scan:', error);
            }
        }, 60 * 1000); // 1 dakikada bir çalıştır
    } catch (error) {
        logger.error('Error starting Market Scanner:', error);
    }
})();

class MarketScanner {
    constructor(binanceService, orderService, mtfService) {
        this.binanceService = binanceService;
        this.orderService = orderService;
        this.mtfService = mtfService;
        this.strategy = new AdaptiveStrategy(binanceService);
        this.positionStates = {};
        this.weakSignalBuffer = []; // Zayıf sinyalleri gruplamak için buffer
        this.weakSignalBatchSize = 5; // Her mesajda kaç sinyal birleştirileceği
        this.lastMarketConditions = {}; // Market koşullarını izlemek için
    }
    
    async initialize() {
        await this.strategy.initialize();
        logger.info('Market Scanner initialized with Adaptive Strategy');
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

        const combinedMessage = `
    ⚠️ Weak Signal Summary (${this.weakSignalBuffer.length} signals):
    ${this.weakSignalBuffer.join("\n")}
    `;

        try {
            await bot.telegram.sendMessage(chatId, combinedMessage);
        } catch (error) {
            logger.error(`Error sending weak signal batch message: ${error.message}`);
        }

        this.weakSignalBuffer = [];
    }

    /**
     * Yeni pozisyon açıldığında mesaj gönderir.
     */
    async notifyNewPosition(symbol, allocation, stopLoss, takeProfit, strategyUsed) {
        const marketConditions = this.lastMarketConditions[symbol] || {};
        
        const message = `
    ✅ New position opened for ${symbol}:
    - Allocation: ${allocation} USDT
    - Stop Loss: ${stopLoss}
    - Take Profit: ${takeProfit}
    - Strategy: ${strategyUsed || 'Adaptive Strategy'}
    - Market Type: ${marketConditions.marketType || 'Unknown'}
    - Trend: ${marketConditions.trend || 'Unknown'} (Strength: ${marketConditions.trendStrength || 'Unknown'}%)
    - Volatility: ${marketConditions.volatility || 'Unknown'}
    `;

        try {
            await bot.telegram.sendMessage(chatId, message);
        } catch (error) {
            logger.error(`Error sending new position message: ${error.message}`);
        }
    }

    async notifyPositionClosed(symbol, closePrice) {
        const message = `
    ✅ Position for ${symbol} closed at price ${closePrice}.
    `;

        try {
            await bot.telegram.sendMessage(chatId, message);
        } catch (error) {
            logger.error(`Error sending position closed message: ${error.message}`);
        }
    }

    /**
     * Pozisyon kapandığında mesaj gönderir.
     */
    async notifyPositionClosed(symbol, closePrice) {
        const message = `
✅ Position for ${symbol} closed at price ${closePrice}.
`;

        try {
            await bot.telegram.sendMessage(chatId, message);
        } catch (error) {
            logger.error(`Error sending position closed message: ${error.message}`);
        }
    }

    /**
     * Hata durumunda mesaj gönderir.
     */
    async notifyError(symbol, errorMessage) {
        const message = `
❌ Error managing position for ${symbol}:
- Error: ${errorMessage}
`;

        try {
            await bot.telegram.sendMessage(chatId, message);
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
                logger.info(`Active position found for ${symbol}. Using EnhancedPositionManager.`);
                return; // EnhancedPositionManager handles position management separately
            }

            // Açık pozisyon sayısını kontrol et
            const activePositionsCount = await Position.count({ where: { isActive: true } });
            const maxOpenPositions = config.maxOpenPositions || 10;

            if (activePositionsCount >= maxOpenPositions) {
                logger.warn(`Maximum open positions limit (${maxOpenPositions}) reached. Skipping new position for ${symbol}.`);
                return;
            }

            // Multi-timeframe data alma
            const mtfData = await this.mtfService.getMultiTimeframeData(symbol);
            
            // Hourly candles for signal generation (legacy compatibility)
            const candles = mtfData.candles['1h'];
            if (!candles || candles.length === 0) {
                logger.warn(`No candles fetched for ${symbol}. Skipping.`);
                return;
            }
            
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
    async closePosition(position, closePrice) {
        const { symbol, totalAllocation, entries } = position;
        const side = entries > 0 ? 'SELL' : 'BUY';
        const positionSide = entries > 0 ? 'LONG' : 'SHORT';

        try {
            await this.orderService.closePosition(symbol, side, totalAllocation, positionSide);

            position.isActive = false; // Pozisyonu kapalı olarak işaretle
            position.closedPrice = closePrice; // Kapanış fiyatını kaydet
            position.closedAt = new Date(); // Kapanış zamanını kaydet
            await position.save();

            logger.info(`Position for ${symbol} closed at price ${closePrice}.`);
            await this.notifyPositionClosed(symbol, closePrice);
        } catch (error) {
            logger.error(`Error closing position for ${symbol}:`, error);
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
        // Calculate position size
        const positionSize = config.calculate_position_size
            ? config.riskPerTrade * await this.binanceService.getFuturesBalance()
            : allocation || config.static_position_size;

        // Calculate quantity based on allocation
        const quantity = await this.orderService.calculateStaticPositionSize(symbol, positionSize);

        // Log the position opening
        logger.info(`Opening position for ${symbol}: 
            - Entry Price: ${entryPrice}
            - Signal: ${signal}
            - Strategy Used: ${strategyUsed || 'Adaptive Strategy'}
            - Market Conditions: ${JSON.stringify(this.lastMarketConditions[symbol] || {})}
            - Quantity: ${quantity}
            - Allocation: ${positionSize} USDT
            - Stop Loss: ${stopLoss}
            - Take Profit: ${takeProfit}
        `);

        // Place market order to open position
        await this.orderService.placeMarketOrder({
            symbol,
            side: signal,
            quantity,
            positionSide: signal === 'BUY' ? 'LONG' : 'SHORT',
        });

        // Setup stop loss and take profit orders
        const closeSide = signal === 'BUY' ? 'SELL' : 'BUY';
        const positionSide = signal === 'BUY' ? 'LONG' : 'SHORT';

        // Enhanced stop loss with better buffer calculation
        const stopLossBuffer = signal === 'BUY' ? 0.99 : 1.01; // Default 1% buffer
        
        // Calculate dynamic buffer based on volatility if available
        let dynamicBuffer = stopLossBuffer;
        if (this.lastMarketConditions[symbol]?.volatility === 'high') {
            dynamicBuffer = signal === 'BUY' ? 0.98 : 1.02; // 2% buffer for high volatility
        }

        // Stop Loss Order
        await this.orderService.placeStopLossOrder({
            symbol,
            side: closeSide,
            quantity,
            stopPrice: stopLoss,
            price: stopLoss * dynamicBuffer,
            positionSide,
        });

        // Take Profit Order
        await this.orderService.placeTakeProfitOrder({
            symbol,
            side: closeSide,
            quantity,
            stopPrice: takeProfit,
            price: takeProfit * (signal === 'BUY' ? 1.01 : 0.99),
            positionSide,
        });

        // Create position record in database
        await Position.create({
            symbol,
            entries: signal === 'BUY' ? 1 : -1,
            entryPrices: [entryPrice],
            totalAllocation: positionSize,
            isActive: true,
            step: 1,
            nextCandleCloseTime: this.getNextCandleCloseTime('1h'),
            stopLoss,
            takeProfit,
            strategyUsed: strategyUsed || 'Adaptive Strategy',
            marketConditions: JSON.stringify(this.lastMarketConditions[symbol] || {})
        });

        logger.info(`New position opened for ${symbol} with allocation ${positionSize} USDT, Stop Loss=${stopLoss}, Take Profit=${takeProfit}.`);
        await this.notifyNewPosition(symbol, positionSize, stopLoss, takeProfit, strategyUsed);
    }

    async managePosition(position, candles) {
        try {
            const lastCandle = candles[candles.length - 1];
            const currentPrice = parseFloat(lastCandle.close); // Opsiyonel: Gerçek zamanlı fiyat için WebSocket kullanılabilir
            const { stopLoss, takeProfit, entries, symbol } = position;

            const isLong = entries > 0;
            const isShort = entries < 0;

            let shouldClose = false;

            if (isLong) {
                if (currentPrice >= takeProfit) {
                    logger.info(`Take profit reached for LONG position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                } else if (currentPrice <= stopLoss) {
                    logger.info(`Stop loss reached for LONG position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                }
            } else if (isShort) {
                if (currentPrice <= takeProfit) {
                    logger.info(`Take profit reached for SHORT position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                } else if (currentPrice >= stopLoss) {
                    logger.info(`Stop loss reached for SHORT position on ${symbol}. Closing position at ${currentPrice}.`);
                    shouldClose = true;
                }
            }

            if (shouldClose) {
                // Açık emirlerin iptali (eğer varsa)
                await this.orderService.cancelOpenOrders(symbol);
                await this.closePosition(position, currentPrice);
                logger.info(`Position closed successfully for ${symbol} at ${currentPrice}`);
            } else {
                logger.info(`No action needed for position on ${symbol}. Current Price=${currentPrice}, Stop Loss=${stopLoss}, Take Profit=${takeProfit}`);
            }
        } catch (error) {
            logger.error(`Error managing position for ${symbol}: ${error.message}`);
            await this.notifyError(symbol, error.message);
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
