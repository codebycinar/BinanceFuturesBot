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
                position.allocation = config.static_position_size || 100; // Varsayılan değer
                position.totalAllocation = position.allocation;
                await position.save();
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
    const bollingerBands = calculateBollingerBands(candles);
    const { upper, lower } = bollingerBands;

    // Görüntülemek için temel parametreleri hesapla
    const entryPrice = position.entryPrices[0];
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2);
    
    logger.info(`Checking position for ${position.symbol}:
        - Current Price: ${currentPrice}
        - Bollinger Bands: Upper=${upper}, Lower=${lower}, Basis=${bollingerBands.basis}
        - Entry Price: ${entryPrice}
        - Current PnL: ${pnlPercent}%
    `);

    // Pozisyon kapatma kontrolü
    if (position.entries > 0 && currentPrice > upper) {
        logger.info(`Closing LONG position for ${position.symbol}. Price above upper Bollinger band.`);
        await closePosition(position.symbol, "SELL", position, currentPrice);
        return;
    } else if (position.entries < 0 && currentPrice < lower) {
        logger.info(`Closing SHORT position for ${position.symbol}. Price below lower Bollinger band.`);
        await closePosition(position.symbol, "BUY", position, currentPrice);
        return;
    }

    // Bir sonraki adıma geçiş
    const step = position.step || 1;
    let allocation = position.allocation || config.static_position_size || 100;
    
    // Eğer config.strategy.allocation tanımlıysa kullan
    if (config.strategy && config.strategy.allocation && Array.isArray(config.strategy.allocation)) {
        const stepIndex = step - 1;
        if (stepIndex >= 0 && stepIndex < config.strategy.allocation.length) {
            const allocationPercentage = config.strategy.allocation[stepIndex];
            allocation = (allocationPercentage * position.totalAllocation) || allocation;
        }
    }
    
    logger.info(`Using allocation ${allocation} USDT for step ${step} of ${position.symbol}`);
    
    // Pozisyonun bir sonraki kontrol zamanını ayarla
    position.nextCandleCloseTime = getNextCandleCloseTime('1h');
    await position.save();
    
    // Not: Bu kısım yorumlanmıştır çünkü otomatik isteklerin yapılması şu an kapalıdır
    /*
    const quantity = await binanceService.calculateQuantity(position.symbol, allocation);
    if (quantity <= 0) {
        logger.warn(`Invalid quantity for ${position.symbol}. Skipping order.`);
        return;
    }
    
    await binanceService.placeMarketOrder({
        symbol: position.symbol,
        side: position.entries > 0 ? 'BUY' : 'SELL',
        quantity,
        positionSide: position.entries > 0 ? 'LONG' : 'SHORT',
    });
    
    position.step = step + 1;
    await position.save();
    */

    // Şu an için sadece pozisyonu izliyoruz, aktif işlem yapmıyoruz
}

function getNextCandleCloseTime(timeframe) {
    const now = new Date();
    const timeframes = {
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '1h': 60 * 60 * 1000,
    };
    const ms = timeframes[timeframe] || 60 * 60 * 1000;
    return new Date(Math.ceil(now.getTime() / ms) * ms);
}

// Pozisyonu erken kapatma kararını veren fonksiyon
function shouldCloseEarly(currentPrice, bollingerBoundary, rsi, adx, positionType) {
    const proximityThreshold = 0.02; // Bollinger bandına %2 yakınlık
    const isNearBoundary = Math.abs(currentPrice - bollingerBoundary) / bollingerBoundary <= 0.02; // %2 yakınlık kontrolü

    if (positionType === 'long') {
        return isNearBoundary && rsi > 70 && adx && adx < 20; // Aşırı alım ve zayıf trend
    } else if (positionType === 'short') {
        return isNearBoundary && rsi < 30 && adx && adx < 20; // Aşırı satış ve zayıf trend
    }
    return false;
}

// RSI hesaplama fonksiyonu
function calculateRSI(closePrices, period) {
    const gains = [];
    const losses = [];

    for (let i = 1; i < closePrices.length; i++) {
        const change = closePrices[i] - closePrices[i - 1];
        if (change > 0) gains.push(change);
        else losses.push(Math.abs(change));
    }

    const avgGain = gains.slice(-period).reduce((acc, val) => acc + val, 0) / period;
    const avgLoss = losses.slice(-period).reduce((acc, val) => acc + val, 0) / period;

    const rs = avgGain / avgLoss || 0;
    return 100 - 100 / (1 + rs);
}

// ADX hesaplama fonksiyonu
function calculateADX(candles, period) {
    if (candles.length < period + 1) {
        throw new Error('Not enough candles to calculate ADX');
    }

    const tr = []; // True Range
    const plusDM = []; // Positive Directional Movement
    const minusDM = []; // Negative Directional Movement

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const highDiff = current.high - previous.high;
        const lowDiff = previous.low - current.low;

        // True Range
        const currentTR = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );
        tr.push(currentTR);

        // Positive and Negative Directional Movement
        plusDM.push(highDiff > 0 && highDiff > lowDiff ? highDiff : 0);
        minusDM.push(lowDiff > 0 && lowDiff > highDiff ? lowDiff : 0);
    }

    // Smoothed TR, +DM, -DM
    const smoothedTR = smoothArray(tr, period);
    const smoothedPlusDM = smoothArray(plusDM, period);
    const smoothedMinusDM = smoothArray(minusDM, period);

    const plusDI = smoothedPlusDM.map((val, i) => (val / smoothedTR[i]) * 100);
    const minusDI = smoothedMinusDM.map((val, i) => (val / smoothedTR[i]) * 100);

    // Directional Index (DX)
    const dx = plusDI.map((val, i) => Math.abs(val - minusDI[i]) / (val + minusDI[i]) * 100);

    // Smoothed DX for ADX
    const adx = smoothArray(dx, period);

    // Son ADX değeri
    return adx[adx.length - 1];
}

// Moving average ile smoothing fonksiyonu
function smoothArray(array, period) {
    const smoothed = [];
    let sum = array.slice(0, period).reduce((acc, val) => acc + val, 0);

    smoothed.push(sum / period);

    for (let i = period; i < array.length; i++) {
        sum = sum - array[i - period] + array[i];
        smoothed.push(sum / period);
    }

    return smoothed;
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

async function closePosition(symbol, side, position, closePrice) {
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
        if (!binanceService) {
            throw new Error('Binance service is not defined');
        }

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
