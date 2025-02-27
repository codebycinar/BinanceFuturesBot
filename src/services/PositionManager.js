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

async function managePosition(position, candles) {
    try {
        const currentPrice = parseFloat(candles[candles.length - 1].close);
        const symbol = position.symbol;

        // Turtle parametreleri
        const exitPeriod = config.strategy.exitPeriod;
        const atrPeriod = config.strategy.atrPeriod;

        // Donchian ve ATR hesapla
        const exitChannels = await binanceService.calculateDonchianChannels(symbol, exitPeriod);
        const atr = await binanceService.calculateATR(symbol, atrPeriod);

        // LONG pozisyon yönetimi
        if (position.side === 'LONG') {
            // Çıkış kuralı: Exit Channel'ın altına düşerse
            if (currentPrice < exitChannels.lower) {
                await closePosition(symbol, 'SELL', position, currentPrice);
                return;
            }

            // Dinamik Trailing Stop (2*ATR)
            const newStop = currentPrice - 2 * atr;
            if (newStop > position.stopLoss) {
                await updateStopLoss(position, newStop);
            }

            // Dinamik Take Profit (Trend takip)
            if (currentPrice > position.entryPrice + 4 * atr) {
                await closePosition(symbol, 'SELL', position, currentPrice);
                return;
            }
        }

        // SHORT pozisyon yönetimi
        if (position.side === 'SHORT') {
            // Çıkış kuralı: Exit Channel'ın üstüne çıkarsa
            if (currentPrice > exitChannels.upper) {
                await closePosition(symbol, 'BUY', position, currentPrice);
                return;
            }

            // Dinamik Trailing Stop (2*ATR)
            const newStop = currentPrice + 2 * atr;
            if (newStop < position.stopLoss || position.stopLoss === 0) {
                await updateStopLoss(position, newStop);
            }

            // Dinamik Take Profit (Trend takip)
            if (currentPrice < position.entryPrice - 4 * atr) {
                await closePosition(symbol, 'BUY', position, currentPrice);
                return;
            }
        }

        // Pozisyon ekleme kuralı (1 ATR hareket)
        await checkAddToPosition(position, currentPrice, atr);

    } catch (error) {
        logger.error(`Hata managePosition (${position.symbol}):`, error);
    }
}

// Yardımcı fonksiyonlar
async function updateStopLoss(position, newStop) {
    position.stopLoss = newStop;
    await position.save();
    logger.info(`Stop loss updated: ${position.symbol} → ${newStop}`);

    // Binance'de stop loss emrini güncelle
    await binanceService.cancelOpenOrders(position.symbol);
    await binanceService.placeStopLossOrder({
        symbol: position.symbol,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        quantity: position.quantity,
        stopPrice: newStop,
        positionSide: position.side
    });
}

async function checkAddToPosition(position, currentPrice, atr) {
    if (position.units >= config.strategy.maxUnits) return;

    const entryPrice = position.entryPrice;
    const priceDifference = Math.abs(currentPrice - entryPrice);

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
        position.quantity += newQuantity;
        await position.save();
    }
}

async function closePosition(symbol, side, position, closePrice) {
    if (position.strategy !== 'Turtle') return; // Manuel pozisyonlara dokunma
    try {
        await binanceService.closePosition(symbol, side);
        position.isActive = false;
        position.closedPrice = closePrice;
        await position.save();
        logger.info(`Pozisyon kapatıldı: ${symbol} → ${closePrice}`);
    } catch (error) {
        logger.error(`Pozisyon kapatma hatası (${symbol}):`, error);
    }
}

module.exports = positionManager;
