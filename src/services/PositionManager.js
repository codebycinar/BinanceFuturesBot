const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const logger = require('../utils/logger');
const config = require('../config/config');
const binanceService = new BinanceService();
const { Position } = models;
const ti = require('technicalindicators');

async function positionManager() {
    try {
        // Binance'den açık pozisyonları güncelle
        await updateOpenPositions();

        const positions = await Position.findAll({ where: { isActive: true } });

        for (const position of positions) {
            if (!position.allocation) {
                position.allocation = config.static_position_size || 0.01; // Varsayılan değer
                logger.warn(`Allocation for ${position.symbol} is null. Setting default allocation: ${position.allocation}`);
            }

            // Candle verilerini al
            const candles = await binanceService.getCandles(position.symbol, '1h', 100);
            if (!candles || candles.length === 0) {
                logger.warn(`No candle data for ${position.symbol}. Skipping.`);
                continue;
            }

            // Pozisyonu yönet
            await managePosition(position, candles);
        }
    } catch (error) {
        logger.error('Error in position manager loop:', error);
    }
}

async function managePosition(position, candles) {
    const closePrices = candles.map(candle => parseFloat(candle.close));
    const highPrices = candles.map(candle => parseFloat(candle.high)); // En yüksek fiyatlar
    const lowPrices = candles.map(candle => parseFloat(candle.low));  // En düşük fiyatlar
    const currentHigh = highPrices[highPrices.length - 1]; // İçinde bulunulan mumun en yüksek fiyatı
    const currentLow = lowPrices[lowPrices.length - 1];   // İçinde bulunulan mumun en düşük fiyatı
    const currentPrice = closePrices[closePrices.length - 1];

    // Bollinger Bands hesapla
    const bollingerBands = calculateBollingerBands(candles);
    const { upper, lower } = bollingerBands;

    logger.info(`Checking position for ${position.symbol}:
        - Current Price: ${currentPrice}
        - Bollinger Bands: Upper=${upper}, Lower=${lower}, Basis=${bollingerBands.basis}
        - Current High: ${currentHigh}
        - Current Low: ${currentLow}
        - Entry Price: ${position.entryPrices[0]}
        - Current PnL: ${((currentPrice - position.entryPrices[0]) / position.entryPrices[0] * 100).toFixed(2)}%
    `);

    // Pozisyondan çıkış kontrolü
    if (position.entries > 0) {
        // Long pozisyon
        if (currentHigh >= upper) {
            logger.info(`Closing LONG position for ${position.symbol}. Condition met (High >= Bollinger Upper).`);
            await closePosition(position, currentPrice);
        }
    } else if (position.entries < 0) {
        // Short pozisyon
        if (currentLow <= lower) {
            logger.info(`Closing SHORT position for ${position.symbol}. Condition met (Low <= Bollinger Lower).`);
            await closePosition(position, currentPrice);
        }
    }
}


async function closePosition(position, closePrice) {
    try {
        const { symbol, totalAllocation, entries } = position;
        const side = entries > 0 ? 'SELL' : 'BUY';
        const positionSide = entries > 0 ? 'LONG' : 'SHORT';

        // BinanceService üzerinden exchangeInfo alınıyor
        const exchangeInfo = await binanceService.getExchangeInfo();
        const symbolInfo = exchangeInfo[symbol];

        if (!symbolInfo) {
            throw new Error(`Exchange info for ${symbol} not found.`);
        }

        const quantityPrecision = symbolInfo.quantityPrecision;
        const adjustedQuantity = parseFloat(totalAllocation).toFixed(quantityPrecision);

        logger.info(`Closing position for ${symbol}:
            Side: ${side}
            Position Side: ${positionSide}
            Quantity: ${adjustedQuantity}
        `);

        // Pozisyonu kapat
        const order = await binanceService.closePosition(symbol, side, adjustedQuantity, positionSide);

        // Veritabanını güncelle
        position.isActive = false;
        position.closedPrice = closePrice;
        position.closedAt = new Date();
        await position.save();

        logger.info(`Position for ${symbol} closed at price ${closePrice}.`);
        return order;
    } catch (error) {
        logger.error(`Error closing position for ${position.symbol}:`, error.message);
        throw error;
    }
}


// EMA hesaplama fonksiyonu
function calculateEMA(period, closePrices) {
    const emaValues = ti.EMA.calculate({
        period: period,
        values: closePrices, // Mumların kapanış fiyatları
    });
    return emaValues[emaValues.length - 1]; // Son EMA değerini döndür
}

async function updateOpenPositions() {
    try {
        const openPositions = await binanceService.getOpenPositions();

        for (const binancePosition of openPositions) {
            const { symbol, entryPrice } = binancePosition;

            // Veritabanındaki pozisyonu bul
            const position = await Position.findOne({ where: { symbol, isActive: true } });
            if (position) {
                position.entryPrices = [parseFloat(entryPrice)];
                await position.save();

                logger.info(`Updated entry price for ${symbol}: ${entryPrice}`);
            }
        }
    } catch (error) {
        logger.error('Error updating open positions:', error);
    }
}

function calculateBollingerBands(candles) {
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

async function closePosition(position, closePrice) {
    try {
        const { symbol, totalAllocation, entries } = position;
        const side = entries > 0 ? 'SELL' : 'BUY';
        const positionSide = entries > 0 ? 'LONG' : 'SHORT';

        await binanceService.closePosition(symbol, side, totalAllocation, positionSide);

        position.isActive = false; // Pozisyonu kapalı olarak işaretle
        position.closedPrice = closePrice; // Kapanış fiyatını kaydet
        position.closedAt = new Date(); // Kapanış zamanını kaydet
        await position.save();

        logger.info(`Position for ${symbol} closed at price ${closePrice}.`);
    } catch (error) {
        logger.error(`Error closing position for ${position.symbol}:`, error);
    }
}

module.exports = positionManager;
