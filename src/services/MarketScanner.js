// services/MarketScanner.js
const { Op, json } = require('sequelize');
const TurtleStrategy = require('../strategies/TurtleStrategy');
const config = require('../config/config');
const logger = require('../utils/logger');
const { models } = require('../db/db');
const TelegramService = require('./TelegramService');
const { Position, Signal } = models;

class MarketScanner {
    constructor(binanceService, orderService) {
        this.binanceService = binanceService;
        this.orderService = orderService;
        this.strategy = new TurtleStrategy('TurtleStrategy');
        this.positionStates = {};
        this.activeScans = new Set();
        this.closestPairs = [];
        this.closesPercentageThreshold = config.strategy.closesPercentageThreshold || 90;
        this.closesPercentageThresholdForPosition = config.strategy.closesPercentageThresholdForPosition || 98;
    }

    async initialize() {
        await this.strategy.initialize(); // Stratejiyi başlat
        logger.info('MarketScanner strateji uygulamaya hazır.');
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

            await this.sendClosestPairsNotification();
        } catch (error) {
            logger.error('Error scanning all symbols:', error);
        }
    }

    async sendSignalMessage(symbol, signalType, signalPower, entryPrice, stopLoss, takeProfit, allocation, rsi, adx, bbBasis, stochastic, atr, unmetConditions) {
        // Bildirim yapılmasını kontrol et
        const shouldNotify = await this.shouldNotifySignal(symbol);
        if (!shouldNotify) {
            logger.info(`Notification skipped for ${symbol} as it was sent within the last hour.`);
            return;
        }

        let message = '';

        if (signalPower === 'WEAK_BUY' || signalPower === 'WEAK_SELL') {
            {
                message = `
                ⚠️ Weak ${signalType} signal detected for ${symbol}.
                - Entry Price: ${Number(entryPrice).toFixed(4)} 
                - Stop Loss: ${Number(stopLoss).toFixed(4)}
                - Take Profit: ${Number(takeProfit).toFixed(4)}
                - Allocation: ${allocation.join(', ')} 
                - Rsi: ${Number(rsi)?.toFixed(2) ?? 'N/A'} 
                - Adx: ${Number(adx)?.toFixed(2) ?? 'N/A'}
                - Stochastic: ${Number(stochastic)?.toFixed(2) ?? 'N/A'}
                - Atr: ${Number(atr.current)?.toFixed(4) ?? 'N/A'} (Trend: ${atr.trend ?? 'N/A'})
                - Bollinger Basis: ${Number(bbBasis)?.toFixed(4) ?? 'N/A'}
                - Unmet Conditions: ${unmetConditions || 'None'}
                ⚠️ No position opened.
                `;
            }

            if (signalPower === 'BUY' || signalPower === 'SELL') {
                message = `
                💸 Strong ${signalType} signal detected for ${symbol}.
                - Entry Price: ${Number(entryPrice).toFixed(4)} 
                - Stop Loss: ${Number(stopLoss).toFixed(4)}
                - Take Profit: ${Number(takeProfit).toFixed(4)}
                - Allocation: ${allocation.join(', ')} 
                - Rsi: ${Number(rsi)?.toFixed(2) ?? 'N/A'} 
                - Adx: ${Number(adx)?.toFixed(2) ?? 'N/A'}
                - Stochastic: ${Number(stochastic)?.toFixed(2) ?? 'N/A'}
                - Atr: ${Number(atr.current)?.toFixed(4) ?? 'N/A'} (Trend: ${atr.trend ?? 'N/A'})
                - Bollinger Basis: ${Number(bbBasis)?.toFixed(4) ?? 'N/A'}
                `;

            }

            try {
                await TelegramService.sendMessage(message);
                logger.info(`Weak signal notification sent for ${symbol}`);

                // Bildirimi veritabanında işaretle
                await this.markSignalAsNotified(symbol);
            } catch (error) {
                logger.error(`Error sending weak signal message for ${symbol}: ${error.message}`);
            }
        }
    }

    /**
     * Yeni pozisyon açıldığında mesaj gönderir.
     */
    async notifyNewPosition(symbol, quantity, entryPrice) {
        const message = `
        ✅ New position opened for ${symbol}:
        - Allocation: ${quantity} USDT
        - Entry Price: ${entryPrice}
        `;

        try {
            await TelegramService.sendMessage(message);
        } catch (error) {
            logger.error(`Error sending new position message: ${error.message}`);
        }
    }

    async notifyPositionClosed(symbol, closePrice) {
        const message = `
    ✅ Position for ${symbol} closed at price ${closePrice}.
    `;

        try {
            await TelegramService.sendMessage(message);
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
            await TelegramService.sendMessage(message);
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
            await TelegramService.sendMessage(message);
        } catch (error) {
            logger.error(`Error sending error message: ${error.message}`);
        }
    }

    async saveSignalToDB(signal) {
        try {
            // Ensure required fields are present
            if (!signal) {
                console.error('Signal is undefined');
                return;
            }

            // Example: Safely handle tags array
            const tags = (signal.tags || []).join(',');

            // Save to database
            await Signal.create({
                symbol: signal.symbol,
                signalType: signal.signalType,
                entryPrice: signal.entryPrice,
                stopLoss: signal.stopLoss,
                takeProfit: signal.takeProfit,
                allocation: signal.allocation,
                rsi: signal.rsi,
                adx: signal.adx,
                unmetConditions: signal.unmetConditions,
                tags: tags, // Safely joined tags
                isNotified: false
            });

            console.log(`Signal saved successfully for ${signal.symbol}`);
        } catch (error) {
            console.error(`Error saving signal to DB for ${signal?.symbol}:`, error.message);
        }
    }

    async shouldNotifySignal(symbol) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 saat önce
        const recentSignal = await Signal.findOne({
            where: {
                symbol,
                isNotified: true,
                notificationDate: { [Op.gte]: oneHourAgo }, // Son 1 saat içinde bildirim yapılmış mı?
            },
            order: [['notificationDate', 'DESC']],
        });

        return !recentSignal; // Eğer son 1 saat içinde bildirim yapılmışsa false, aksi halde true
    }

    async markSignalAsNotified(symbol) {
        try {
            const signal = await Signal.findOne({
                where: { symbol, isNotified: false },
                order: [['createdAt', 'DESC']], // En yeni sinyali al
            });

            if (signal) {
                signal.isNotified = true;
                signal.notificationDate = new Date();
                await signal.save();
                logger.info(`Signal marked as notified for ${symbol}`);
            }
        } catch (error) {
            logger.error(`Error marking signal as notified for ${symbol}: ${error.message}`);
        }
    }

    /**
     * Belirli bir sembolü tarar ve pozisyon açma işlemlerini gerçekleştirir.
     */
    /**
  * Belirli bir sembolü tarar ve pozisyon açma işlemlerini gerçekleştirir.
  */
    async scanSymbol(symbol) {
        try {
            if (!this.binanceService) {
                throw new Error('Binance service is not defined');
            }

            logger.info(`\n=== Scanning ${symbol} ===`, { timestamp: new Date().toISOString() });

            if (!config.strategy) {
                throw new Error('Strategy is not initialized');
            }

            const timeframe = config.strategy.timeframe || '1d';
            const limit = config.strategy.limit || 100;
            if (!Number.isInteger(limit) || limit <= 0) {
                throw new Error(`Invalid limit value for ${symbol}: ${limit}`);
            }
            const candles = await this.binanceService.getCandles(symbol, timeframe, limit);

            if (!candles || candles.length < limit) {
                logger.warn(`Skipping ${symbol} due to insufficient candles: ${candles.length}/${limit}`);
                return;
            }

            // Açık pozisyon kontrolü
            let position = await Position.findOne({ where: { symbol, isActive: true } });
            if (position) {
                logger.info(`Active position found for ${symbol}. Delegating to PositionManager.`);
                return;
            }

            // Açık pozisyon sayısını kontrol et
            const activePositionsCount = await Position.count({ where: { isActive: true } });
            const maxOpenPositions = config.maxOpenPositions || 10;

            if (activePositionsCount >= maxOpenPositions) {
                logger.warn(`Maximum open positions limit (${maxOpenPositions}) reached. Skipping new position for ${symbol}.`);
                return;
            }


            // Yeni sinyal üretme
            const { signal, stopLoss, takeProfit, allocation, rsi, adx, unmetConditions, bbBasis, stochasticK, atr } = await this.strategy.generateSignal(candles, symbol, this.binanceService);
            const entryChannels = await this.binanceService.calculateDonchianChannels(symbol, 20);
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const channelWidth = entryChannels.upper - entryChannels.lower;
            let percentage, direction;
            if (currentPrice >= entryChannels.upper) {
                percentage = 0;
                direction = "UPPER";
            } else if (currentPrice <= entryChannels.lower) {
                percentage = 0;
                direction = "LOWER";
            } else {
                const distanceToUpper = entryChannels.upper - currentPrice;
                const distanceToLower = currentPrice - entryChannels.lower;
                const minDistance = Math.min(distanceToUpper, distanceToLower); // En yakın mesafe
                percentage = ((minDistance / channelWidth) * 100).toFixed(2); // Doğru hesaplama
                direction = distanceToUpper < distanceToLower ? "UPPER" : "LOWER"; // Yön belirleme
            }

            const newPair = {
                symbol,
                percentage: parseFloat(percentage), // Sayısal hale getir
                direction,
                price: parseFloat(currentPrice), // Sayısal hale getir
                upper: parseFloat(entryChannels.upper), // Sayısal hale getir
                lower: parseFloat(entryChannels.lower) // Sayısal hale getir
            };

            const proximityPercentage = parseFloat(percentage);
            if (proximityPercentage >= this.closesPercentageThreshold) {
                this.updateClosestPairs(newPair);
            } else {
                // %90'ın altındaysa listeden çıkar
                this.closestPairs = this.closestPairs.filter(p => p.percentage >= this.closesPercentageThreshold);
                this.closestPairs.sort((a, b) => b.percentage - a.percentage);
            }

            if (signal === 'NEUTRAL') {
                logger.info(`No actionable signal for ${symbol}.`);
                return;
            }
            else {
                const dbSignal = {
                    symbol,
                    signalType: signal,
                    entryPrice: currentPrice,
                    stopLoss,
                    takeProfit,
                    allocation,
                    rsi,
                    adx,
                    bbBasis,
                    stochasticK,
                    atr,
                    tags: unmetConditions ? ['weak', ...unmetConditions.split(',')] : [],
                };

                // Sinyali veritabanına kaydet
                await this.saveSignalToDB(dbSignal);
            }

            if (signal === 'BUY' || signal === 'SELL') {
                if (config.strategy.enableTrading) {

                    await this.openNewPosition(symbol, signal, currentPrice, atr);
                }
                else
                    await this.sendSignalMessage(symbol, signalType, signal, currentPrice, stopLoss, takeProfit, allocation, rsi, adx, bbBasis, stochasticK, atr, unmetConditions);
            }
            else if (newPair.percentage >= this.closesPercentageThresholdForPosition) {
                if (config.strategy.enableTrading) {

                    logger.info(`High proximity detected for ${symbol}: ${newPair.percentage}%. Opening position...`);
                    await this.openNewPosition(symbol, direction === "UPPER" ? "BUY" : "SELL", currentPrice, atr);
                }
            }
        } catch (error) {
            logger.error(`Error scanning symbol ${symbol}: ${error.message || JSON.stringify(error)}`);
            logger.error(error.stack);
        }
    }

    updateClosestPairs(newPair) {

        // Veri doğrulama: Tüm sayısal alanlar kontrol ediliyor
        if (
            typeof newPair.price !== 'number' ||
            typeof newPair.upper !== 'number' ||
            typeof newPair.lower !== 'number' ||
            typeof newPair.percentage !== 'number' ||
            newPair.percentage < this.closesPercentageThreshold
        ) {
            logger.warn(`Invalid data for symbol ${newPair.symbol}:`, newPair);
            return;
        }

        // Aynı sembol zaten listede var mı kontrol et
        const existingPairIndex = this.closestPairs.findIndex(pair => pair.symbol === newPair.symbol);

        if (existingPairIndex !== -1) {
            // Eğer sembol zaten listede varsa, sadece güncelle
            if (newPair.percentage > this.closestPairs[existingPairIndex].percentage) {
                this.closestPairs[existingPairIndex] = newPair;
                logger.info(`Updated existing pair in closestPairs: ${newPair.symbol}`);
            } else {
                logger.info(`Skipped updating existing pair in closestPairs: ${newPair.symbol}`);
            }
        } else {
            this.closestPairs.push(newPair);
            logger.info(`Added new pair to closestPairs: ${newPair.symbol}`);
        }
        this.closestPairs = this.closestPairs.filter(p => p.percentage >= this.closesPercentageThreshold);
        // Listeyi skora göre sırala (yüksekten düşüğe)
        this.closestPairs.sort((a, b) => b.percentage - a.percentage);
    }

    async sendClosestPairsNotification() {
        try {

            if (this.closestPairs.length === 0) {
                logger.info("No pairs with %85+ proximity to notify.");
                return;
            }

            let message = "📈 %85+ Yakınlıkta Semboller:\n";

            // Sadece %90+ olanları sırala
            const sortedPairs = this.closestPairs
                .filter(p => p.percentage >= this.closesPercentageThreshold)
                .sort((a, b) => b.percentage - a.percentage);

            logger.info("Pairs : " + JSON.stringify(sortedPairs));

            for (const pair of sortedPairs) {
                const formattedPrice = typeof pair.price === 'number' ? pair.price.toFixed(4) : 'N/A';
                const formattedUpper = typeof pair.upper === 'number' ? pair.upper.toFixed(4) : 'N/A';
                const formattedLower = typeof pair.lower === 'number' ? pair.lower.toFixed(4) : 'N/A';
                message += `
            -------------------
            🌟 ${pair.symbol}
            - Yakınlık Oranı: %${pair.percentage}
            - Kanal Durumu: ${pair.direction}
            - Mevcut Fiyat: ${formattedPrice}
            - Donchian Kanalları:
              Üst: ${formattedUpper}
              Alt: ${formattedLower}
            `;
            }

            // Telegram'a gönder
            await TelegramService.sendMessage(message);
            logger.info("En yakın 5 sembol bildirimi gönderildi.");
        } catch (error) {
            logger.error(`Error sending closest pairs notification: ${error.message}`);
        }
    }

    async openNewPosition(symbol, signal, entryPrice, atr) {
        try {
            // 1) Pozisyon boyutunu OrderService ile hesapla
            const quantity = await this.orderService.calculateTurtlePositionSize(symbol, atr);
            // 2) Binance üzerinden pozisyon aç
            await this.binanceService.placeMarketOrder({
                symbol,
                side: signal,
                quantity,
                positionSide: signal === 'BUY' ? 'LONG' : 'SHORT'
            });

            // 3) Pozisyonu veritabanına kaydet (StopLoss/TakeProfit OPSİYONEL)
            await Position.create({
                symbol,
                side: signal,
                entryPrice,

                isActive: true,
                units: 1,
                strategy: 'turtle',
                stopLoss: entryPrice - 2 * atr,
                takeProfit: entryPrice + 4 * atr
            });

            // 4) Yeni pozisyon bildirimi gönder
            await this.notifyNewPosition(symbol, quantity, entryPrice);

            logger.info(`Yeni Turtle pozisyonu: ${symbol} ${signal}`);

        } catch (error) {
            logger.error(`Pozisyon açma hatası (${symbol}): ${error.message}`);
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

    calculateATR(candles, period = 14) {
        const validCandles = candles.filter(
            c => !isNaN(parseFloat(c.high)) && !isNaN(parseFloat(c.low)) && !isNaN(parseFloat(c.close))
        );

        if (validCandles.length < period) {
            throw new Error('Not enough valid data to calculate ATR');
        }

        const trueRanges = [];
        for (let i = 1; i < validCandles.length; i++) {
            const currentHigh = parseFloat(validCandles[i].high);
            const currentLow = parseFloat(validCandles[i].low);
            const previousClose = parseFloat(validCandles[i - 1].close);

            const tr = Math.max(
                currentHigh - currentLow,
                Math.abs(currentHigh - previousClose),
                Math.abs(currentLow - previousClose)
            );
            trueRanges.push(tr);
        }

        const atrValues = [];
        for (let i = period - 1; i < trueRanges.length; i++) {
            const slice = trueRanges.slice(i - period + 1, i + 1);
            const atr = slice.reduce((acc, val) => acc + val, 0) / period;
            atrValues.push(atr);
        }

        const currentATR = atrValues[atrValues.length - 1];
        const trendATRValues = atrValues.slice(-7);
        const trendSum = trendATRValues.reduce((acc, val) => acc + val, 0);
        const averageATR = trendSum / 7;
        const atrTrend = currentATR > averageATR * 1.1 ? 'UP' : currentATR < averageATR * 0.9 ? 'DOWN' : 'NEUTRAL';

        return { current: currentATR, trend: atrTrend };
    }

}

module.exports = MarketScanner;
