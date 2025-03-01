const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const logger = require('../utils/logger');
const config = require('../config/config');
const binanceService = new BinanceService();
const { Position } = models;

async function positionManager() {
    try {
        // 1) SADECE veritabanındaki aktif pozisyonları al
        const dbActivePositions = await Position.findAll({
            where: {
                isActive: true,
                strategy: 'turtle' // Sadece sistem tarafından açılan pozisyonlar
            }
        });

        // 2) Her pozisyon için Binance'de varlığını kontrol et
        for (const dbPosition of dbActivePositions) {
            const binancePosition = await binanceService.getOpenPositions(dbPosition.symbol);

            // 3) Binance'de pozisyon yoksa DB'de kapat
            if (!binancePosition || binancePosition.positionAmt === '0') {
                await closePosition(dbPosition.symbol, dbPosition.side, dbPosition, dbPosition.entryPrice);
                continue;
            }

            // 4) Pozisyon yönetimini gerçekleştir
            const candles = await binanceService.getCandles(dbPosition.symbol, '1h', 100);
            await managePosition(dbPosition, candles);
        }
    } catch (error) {
        logger.error('Position Manager Error:', error);
    }
}

// async function managePosition(position, candles) {
//     try {
//         const currentPrice = parseFloat(candles[candles.length - 1].close);
//         const symbol = position.symbol;

//         // Turtle parametreleri
//         const exitPeriod = config.strategy.exitPeriod;
//         const entryPeriod = config.strategy.entryPeriod;
//         const atrPeriod = config.strategy.atrPeriod;

//         // Donchian ve ATR hesapla
//         const exitChannels = await binanceService.calculateDonchianChannels(symbol, exitPeriod);
//         const entryChannels = await binanceService.calculateDonchianChannels(symbol, entryPeriod);
//         const atr = await binanceService.calculateATR(symbol, atrPeriod);

//         // LONG pozisyon yönetimi
//         if (position.side === 'LONG') {
//             const atr = await binanceService.calculateATR(symbol, config.strategy.atrPeriod);
//             const priceIncrease = currentPrice - position.lastAddPrice || position.entryPrice;

//             if (priceIncrease >= 0.5 * atr && position.units < config.strategy.maxUnits) {
//                 logger.info(`Adding unit to LONG position for ${symbol}. Price increased by ${priceIncrease} (0.5 ATR: ${0.5 * atr})`);
//                 await addPosition(position, currentPrice, atr);
//             }
//         }

//         // SHORT pozisyon yönetimi
//         if (position.side === 'SHORT') {
//             const atr = await binanceService.calculateATR(symbol, config.strategy.atrPeriod);
//             const priceDecrease = position.lastAddPrice - currentPrice || position.entryPrice - currentPrice;

//             if (priceDecrease >= 0.5 * atr && position.units < config.strategy.maxUnits) {
//                 logger.info(`Adding unit to SHORT position for ${symbol}. Price decreased by ${priceDecrease} (0.5 ATR: ${0.5 * atr})`);
//                 await addPosition(position, currentPrice, atr);
//             }
//         }

//         // Pozisyon ekleme kuralı (1 ATR hareket)
//         //await checkAddToPosition(position, currentPrice, atr);

//     } catch (error) {
//         logger.error(`Hata managePosition (${position.symbol}):`, error);
//     }
// }

async function managePosition(position, candles) {
    try {
        const currentPrice = parseFloat(candles[candles.length - 1].close);
        const symbol = position.symbol;
        const timeframe = config.strategy.timeframe;
        const exitPeriod = config.strategy.exitPeriod;
        const atrPeriod = config.strategy.atrPeriod;

        // Doğru timeframe ile ATR ve Donchian kanallarını hesapla
        const exitChannels = await binanceService.calculateDonchianChannels(symbol, exitPeriod, timeframe);
        const atr = await binanceService.calculateATR(symbol, atrPeriod, timeframe);
        const entryChannels = await binanceService.calculateDonchianChannels(symbol, 20, timeframe); // 20-period entry kanalı

        // LONG pozisyon için
        if (position.side === 'LONG') {
            // Çıkış kuralı
            if (currentPrice < exitChannels.lower || currentPrice >= position.takeProfit) {
                await closePosition(symbol, 'SELL', position, currentPrice);
                return;
            }

            // Trailing Stop
            const newStop = currentPrice - 2 * atr;
            if (newStop > position.stopLoss) {
                position.stopLoss = newStop;
                await position.save();
            }

            // Pozisyon ekleme: 0.5 ATR ve üst banda temas
            const priceIncrease = currentPrice - (position.lastAddPrice || position.entryPrice);
            if (currentPrice >= entryChannels.upper && priceIncrease >= 0.5 * atr && position.units < config.strategy.maxUnits) {
                await addPosition(position, currentPrice, atr);
            }
        }

        // SHORT pozisyon için
        if (position.side === 'SHORT') {
            // Çıkış kuralı
            if (currentPrice > exitChannels.upper || currentPrice <= position.takeProfit) {
                await closePosition(symbol, 'BUY', position, currentPrice);
                return;
            }

            // Trailing Stop
            const newStop = currentPrice + 2 * atr;
            if (newStop < position.stopLoss) {
                position.stopLoss = newStop;
                await position.save();
            }

            // Pozisyon ekleme: 0.5 ATR ve alt banda temas
            const priceDecrease = (position.lastAddPrice || position.entryPrice) - currentPrice;
            if (currentPrice <= entryChannels.lower && priceDecrease >= 0.5 * atr && position.units < config.strategy.maxUnits) {
                await addPosition(position, currentPrice, atr);
            }
        }
    } catch (error) {
        logger.error(`Hata managePosition (${position.symbol}):`, error);
    }
}

async function addPosition(position, currentPrice, atr) {
    try {
        const quantity = await orderService.calculatePositionSize(
            position.symbol,
            currentPrice,
            config.strategy.riskPerTrade
        );

        await binanceService.placeMarketOrder({
            symbol: position.symbol,
            side: position.side, // LONG ise BUY, SHORT ise SELL
            quantity,
            positionSide: position.side
        });

        position.units++;
        position.lastAddPrice = currentPrice;
        position.stopLoss = position.side === 'LONG'
            ? currentPrice - 2 * atr
            : currentPrice + 2 * atr;
        await position.save();

        logger.info(`Unit added to ${position.symbol}. Total units: ${position.units}`);
    } catch (error) {
        logger.error(`Error adding position for ${position.symbol}: ${error.message}`);
    }
}

async function checkAddToPosition(position, currentPrice, atr) {
    if (position.units >= config.strategy.maxUnits) return;

    const priceDifference = Math.abs(currentPrice - position.lastAddPrice || position.entryPrice);

    if (priceDifference > atr * 0.5) {
        const newQuantity = await orderService.calculatePositionSize(
            position.symbol,
            currentPrice,
            config.strategy.riskPerTrade
        );

        await binanceService.placeMarketOrder({
            symbol: position.symbol,
            side: position.side === 'LONG' ? 'BUY' : 'SELL',
            quantity: newQuantity,
            positionSide: position.side
        });

        position.units++;
        position.lastAddPrice = currentPrice;
        position.quantity += newQuantity;
        await position.save();
    }
}

async function closePosition(symbol, side, position, closePrice) {
    if (position.strategy !== 'turtle') {
        logger.warn(`Non-Turtle position detected for ${symbol}. Skipping close.`);
        return;
    }

    try {
        await binanceService.closePosition(symbol, side);
        position.isActive = false;
        position.closedPrice = closePrice;
        await position.save();
        logger.info(`Turtle position closed for ${symbol} at ${closePrice}`);
    } catch (error) {
        logger.error(`Error closing Turtle position for ${symbol}: ${error.message}`);
    }
}

module.exports = positionManager;
