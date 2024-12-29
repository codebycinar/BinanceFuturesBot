// services/MarketScanner.js

const BollingerStrategy = require('../strategies/BollingerStrategy');
const config = require('../config/config');
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Position } = models;


class MarketScanner {
    constructor(binanceService, orderService) {
        this.binanceService = binanceService;
        this.orderService = orderService;
        this.strategy = new BollingerStrategy('BollingerStrategy');
        this.positionStates = {};
    }

    /**
   * Borsada TRADING durumunda olan tüm sembolleri döndürür.
   */
    async scanAllSymbols() {
        try {
            if (!this.strategy) {
                logger.error('Strategy instance is missing.');
                throw new Error('Strategy is not initialized.');
            }

            await this.strategy.initialize();
            logger.info('Strategy initialized successfully.');

            const usdtSymbols = await this.binanceService.scanAllSymbols();
            for (const symbol of usdtSymbols) {
                await this.scanSymbol(symbol);
            }
        } catch (error) {
            logger.error('Error scanning all symbols:', error);
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
    async scanSymbol(symbol) {
        try {
            logger.info(`\n=== Scanning ${symbol} ===`, { timestamp: new Date().toISOString() });

            if (!this.strategy) {
                throw new Error('Strategy is not initialized');
            }

            const timeframe = this.strategy.timeframe || '1h';
            const limit = this.strategy.limit || 100;
            const candles = await this.binanceService.getCandles(symbol, timeframe, limit);

            if (!candles || candles.length === 0) {
                logger.warn(`No candles fetched for ${symbol}. Skipping.`);
                return;
            }

            //logger.info(`Candles for ${symbol}: ${JSON.stringify(candles)}`);

            // Açık pozisyon kontrolü
            let position = await Position.findOne({ where: { symbol, isActive: true } });
            if (position) {
                logger.info(`Active position found for ${symbol}. Managing position.`);
                await this.managePosition(position, candles);
                return;
            }

            // Yeni sinyal üretme
            const { signal, stopLoss, takeProfit, allocation: generatedAllocation } = await this.strategy.generateSignal(candles, symbol);
            // Allocation'ı config.static_position_size olarak ayarlayın
            const allocation = config.calculate_position_size
                ? generatedAllocation
                : config.static_position_size;

            logger.info(`Generated signal for ${symbol}: Signal=${signal}, Allocation=${allocation}`);

            if (signal === 'NEUTRAL') {
                logger.info(`No actionable signal for ${symbol}.`);
                return;
            }

            // Pozisyon açma
            const currentPrice = candles[candles.length - 1].close; // Şu anki kapanış fiyatı
            await this.openNewPosition(symbol, signal, currentPrice, stopLoss, takeProfit, allocation);
        } catch (error) {
            logger.error(`Error scanning symbol ${symbol}: ${error.message || JSON.stringify(error)}`);
            logger.error(error.stack);
        }
    }

    async managePosition(position, candles) {
        const now = new Date();

        if (position.nextCandleCloseTime && now < position.nextCandleCloseTime) {
            logger.info(`Waiting for the next candle close for ${position.symbol}. Next close time: ${position.nextCandleCloseTime}`);
            return; // Zaman dolmadı, bekle
        }

        if (!candles || candles.length === 0) {
            logger.error(`Candles data is missing or empty for ${position.symbol}`);
            return;
        }

        const currentPrice = parseFloat(candles[candles.length - 1].close);
        const bollingerBands = this.calculateBollingerBands(candles);
        const { upper, lower } = bollingerBands;

        logger.info(`Managing position for ${position.symbol}:
            - Current Price: ${currentPrice}
            - Bollinger Upper: ${upper}, Lower: ${lower}`);

        // Pozisyon kapatma kontrolü
        if (position.entries > 0 && currentPrice > upper) {
            logger.info(`Closing LONG position for ${position.symbol}. Price above upper Bollinger band.`);
            await this.closePosition(position, currentPrice);
            return;
        } else if (position.entries < 0 && currentPrice < lower) {
            logger.info(`Closing SHORT position for ${position.symbol}. Price below lower Bollinger band.`);
            await this.closePosition(position, currentPrice);
            return;
        }

        const step = position.step;
        if (!step || step < 1) {
            logger.error(`Invalid step value (${step}) for ${position.symbol}`);
            return;
        }

        const allocation = this.strategy.parameters.allocation
            ? this.strategy.parameters.allocation[step - 1]
            : config.static_position_size; // Varsayılan bir değer eklenir
        if (!allocation) {
            logger.warn(`Allocation value is undefined for step ${step} in strategy parameters.`);
            return;
        }

        const quantity = await this.orderService.calculateStaticPositionSize(position.symbol, allocation);
        if (quantity === 0) {
            logger.warn(`Static position size could not be calculated for ${position.symbol}. Skipping step ${step}.`);
            return;
        }

        await this.orderService.placeMarketOrder({
            symbol: position.symbol,
            side: position.entries > 0 ? 'BUY' : 'SELL',
            quantity,
            positionSide: position.entries > 0 ? 'LONG' : 'SHORT',
        });

        logger.info(`Step ${step} executed for ${position.symbol} with quantity ${quantity}.`);

        // Bir sonraki adıma geçiş
        position.step += 1;
        position.nextCandleCloseTime = this.getNextCandleCloseTime('1h');
        await position.save();
    }

    // Bollinger bandı hesaplama metodu
    calculateBollingerBands(candles) {
        const closePrices = candles.map(c => parseFloat(c.close));
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
        } catch (error) {
            logger.error(`Error closing position for ${symbol}:`, error);
        }
    }

    getNextCandleCloseTime(timeframe) {
        const now = new Date();
        const nextHour = new Date(now);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(now.getHours() + 1);

        if (timeframe === '1h') {
            return nextHour;
        }

        // Diğer zaman dilimleri için ek mantık
        return null;
    }

    async openNewPosition(symbol, signal, entryPrice, stopLoss, takeProfit) {
        const allocation = config.calculate_position_size
            ? config.riskPerTrade * await this.binanceService.getFuturesBalance()
            : config.static_position_size;

        const quantity = await this.orderService.calculateStaticPositionSize(symbol);

        logger.info(`Opening position for ${symbol}: Entry Price=${entryPrice}, Signal=${signal}, Quantity=${quantity}, Allocation=${allocation} USDT`);

        await this.orderService.placeMarketOrder({
            symbol,
            side: signal,
            quantity,
            positionSide: signal === 'BUY' ? 'LONG' : 'SHORT',
        });

        await Position.create({
            symbol,
            entries: signal === 'BUY' ? 1 : -1,
            entryPrices: [entryPrice],
            totalAllocation: allocation,
            isActive: true,
            step: 1,
            nextCandleCloseTime: this.getNextCandleCloseTime('1h'),
        });

        logger.info(`New position opened for ${symbol} with allocation ${allocation} USDT.`);
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
