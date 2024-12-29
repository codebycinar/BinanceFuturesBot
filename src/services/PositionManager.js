const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const logger = require('../utils/logger');

const binanceService = new BinanceService();
const { Position } = models;

async function positionManager() {
    try {
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

            // Mevcut fiyat ve bollinger bandı hesaplama
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const bollingerBands = calculateBollingerBands(candles);
            const { upper, lower } = bollingerBands;

            logger.info(`Checking position for ${position.symbol}:
                - Current Price: ${currentPrice}
                - Bollinger Upper: ${upper}, Lower: ${lower}`);

            // Pozisyon türüne göre kapatma kontrolü
            if (position.entries > 0 && currentPrice > upper) {
                // LONG pozisyon, üst banda çıktı
                logger.info(`Closing LONG position for ${position.symbol}. Price above upper Bollinger band.`);
                await closePosition(position, currentPrice);
            } else if (position.entries < 0 && currentPrice < lower) {
                // SHORT pozisyon, alt banda indi
                logger.info(`Closing SHORT position for ${position.symbol}. Price below lower Bollinger band.`);
                await closePosition(position, currentPrice);
            }
        }
    } catch (error) {
        logger.error('Error in position manager loop:', error);
    }
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

module.exports = positionManager;
