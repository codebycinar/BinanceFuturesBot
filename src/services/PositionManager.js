const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const logger = require('../utils/logger');
const config = require('../config/config');
const binanceService = new BinanceService();
const { Position } = models;

(async () => {
    try {
        logger.info('Position Manager started.');

        // Pozisyon yönetimini başlat
        await positionManager();

        // Periyodik yönetim
        setInterval(async () => {
            try {
                await positionManager();
            } catch (error) {
                logger.error('Error during Position Manager periodic execution:', error);
            }
        }, 60 * 1000); // 1 dakikada bir çalıştır
    } catch (error) {
        logger.error('Error starting Position Manager:', error);
    }
})();

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
            await closePosition(position.symbol, 'SELL');
        }
    } else if (position.entries < 0) {
        // Short pozisyon
        if (currentLow <= lower) {
            logger.info(`Closing SHORT position for ${position.symbol}. Condition met (Low <= Bollinger Lower).`);
            await closePosition(position.symbol, 'BUY');
        }
    }
}

// async function closePosition(side, positionSide, position, closePrice) {
//     try {
//         const { symbol } = position;

//         // BinanceService üzerinden exchangeInfo kontrolü
//         try {
//             const quantityPrecision = await binanceService.getQuantityPrecision(symbol);
//             const pricePrecision = await binanceService.getPricePrecision(symbol);
//             logger.info(`Precision for ${symbol}: Quantity=${quantityPrecision}, Price=${pricePrecision}`);
//         } catch (error) {
//             logger.warn(`Exchange info not found for ${symbol}. Refreshing exchange info...`);
//             await binanceService.refreshExchangeInfo(); // Exchange info güncelleniyor
//             throw error; // Hatayı üst metoda geri fırlat
//         }

//         // Açık pozisyonları al ve kontrol et
//         const openPositions = await binanceService.getOpenPositions();
//         const openPosition = openPositions.find(pos => pos.symbol === symbol);
//         if (!openPosition) {
//             throw new Error(`No open position found on Binance for ${symbol}`);
//         }

//         // Mevcut pozisyon boyutunu al
//         const positionSize = Math.abs(parseFloat(openPosition.positionAmt));
//         if (positionSize === 0) {
//             throw new Error(`Position size for ${symbol} is zero.`);
//         }

//         const quantityPrecision = await binanceService.getQuantityPrecision(symbol);
//         const adjustedQuantity = positionSize.toFixed(quantityPrecision);
//         const pricePrecision = await binanceService.getPricePrecision(symbol);
//         const adjustedStopPrice = parseFloat(closePrice).toFixed(pricePrecision);

//         // Pozisyonu kapat
//         const order = await binanceService.closePosition(symbol, side, adjustedQuantity, positionSide, adjustedStopPrice);
//         logger.info(`Position closed on Binance ${symbol} at price ${closePrice}. Order details: ${JSON.stringify(order)}`);

//         // Veritabanını güncelle
//         position.isActive = false;
//         position.closedPrice = closePrice;
//         position.closedAt = new Date();
//         await position.save();

//         logger.info(`Position for ${symbol} closed at price ${closePrice}.`);
//         return order;
//     } catch (error) {
//         logger.error(`Error closing position for ${position.symbol}:`, error.message);
//         logger.error(`Stack trace: ${error.stack}`);
//         throw error;
//     }
// }

async function closePosition(symbol, side) {
    try {
        logger.info(`Closing position for ${symbol} with side ${side}.`);

        // BinanceService'e pozisyonu kapatma talebini gönder
        const order = await binanceService.closePosition(symbol, side);
        // Veritabanını güncelle
        position.isActive = false;
        position.closedPrice = closePrice;
        position.closedAt = new Date();
        await position.save();

        logger.info(`Position closed successfully for ${symbol}. Order details: ${JSON.stringify(order)}`);
    } catch (error) {
        logger.error(`Error closing position for ${symbol}: ${error.message}`);
        throw error;
    }
}


async function updateOpenPositions() {
    try {
        // Binance üzerinde açık pozisyonları al
        const openPositions = await binanceService.getOpenPositions();

        // Binance üzerinde açık olan sembolleri topla
        const openSymbols = openPositions.map(pos => pos.symbol);

        // Veritabanındaki tüm açık pozisyonları al
        const dbOpenPositions = await Position.findAll({ where: { isActive: true } });

        for (const dbPosition of dbOpenPositions) {
            const { symbol } = dbPosition;

            if (!openSymbols.includes(symbol)) {
                // Binance üzerinde olmayan pozisyonları kapalı olarak işaretle
                logger.info(`Marking position as closed for symbol: ${symbol}`);
                dbPosition.isActive = false;
                dbPosition.closedAt = new Date();
                await dbPosition.save();
                continue;
            }

            // Binance üzerinde açık olan pozisyonun giriş fiyatını güncelle
            const binancePosition = openPositions.find(pos => pos.symbol === symbol);
            if (binancePosition) {
                const { entryPrice } = binancePosition;
                dbPosition.entryPrices = [parseFloat(entryPrice)];
                await dbPosition.save();
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

module.exports = positionManager;
