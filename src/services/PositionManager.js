const { models } = require('../db/db');
const BinanceService = require('./BinanceService');
const logger = require('../utils/logger');
const config = require('../config/config');
const binanceService = new BinanceService();
const { Position } = models;

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

    const currentPrice = parseFloat(candles[candles.length - 1].close);
    const bollingerBands = calculateBollingerBands(candles);
    const { upper, lower } = bollingerBands;

    // Görüntülemek için temel parametreleri hesapla
    const entryPrice = position.entryPrices[0];
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2);
    
    // Pozisyon yönetilmeyen bir pozisyon mu?
    const isManaged = position.isManaged !== false; // undefined veya null ise de true olarak kabul et
    const managementStatus = isManaged ? "Managed" : "Monitored only (manual)";
    
    logger.info(`Checking position for ${position.symbol}:
        - Current Price: ${currentPrice}
        - Bollinger Bands: Upper=${upper}, Lower=${lower}, Basis=${bollingerBands.basis}
        - Entry Price: ${entryPrice}
        - Current PnL: ${pnlPercent}%
        - Management: ${managementStatus}
    `);

    // Pozisyon kapatma kontrolü - sadece yönetilen pozisyonlar için
    if (isManaged) {
        if (position.entries > 0 && currentPrice > upper) {
            logger.info(`Closing LONG position for ${position.symbol}. Price above upper Bollinger band.`);
            await closePosition(position.symbol, "SELL", position, currentPrice);
            return;
        } else if (position.entries < 0 && currentPrice < lower) {
            logger.info(`Closing SHORT position for ${position.symbol}. Price below lower Bollinger band.`);
            await closePosition(position.symbol, "BUY", position, currentPrice);
            return;
        }
    } else {
        // Pozisyon manuel olarak yönetiliyor, sadece sinyal bilgisi ver
        if (position.entries > 0 && currentPrice > upper) {
            logger.info(`⚠️ SIGNAL: LONG position ${position.symbol} is above upper Bollinger band (${upper.toFixed(4)}). Consider closing.`);
        } else if (position.entries < 0 && currentPrice < lower) {
            logger.info(`⚠️ SIGNAL: SHORT position ${position.symbol} is below lower Bollinger band (${lower.toFixed(4)}). Consider closing.`);
        }
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

        // Açık emirleri iptal et (herhangi bir TP/SL var ise)
        try {
            await binanceService.client.futuresCancelAllOpenOrders({ symbol });
            logger.info(`Cancelled all open orders for ${symbol}`);
        } catch (cancelError) {
            logger.warn(`Error cancelling open orders for ${symbol}: ${cancelError.message}`);
            // Devam et, bu kritik değil
        }

        // Kısa bir bekleme yap
        await new Promise(resolve => setTimeout(resolve, 500));

        // BinanceService'e pozisyonu kapatma talebini gönder
        const order = await binanceService.closePosition(symbol, side);

        // Veritabanını güncelle
        position.isActive = false;
        position.closedPrice = closePrice;
        position.closedAt = new Date();
        
        // PnL hesapla
        const entryPrice = position.entryPrices[0];
        let pnlPercent = 0;
        
        if (position.entries > 0) { // LONG
            pnlPercent = ((closePrice - entryPrice) / entryPrice) * 100;
        } else { // SHORT
            pnlPercent = ((entryPrice - closePrice) / entryPrice) * 100;
        }
        
        const pnlAmount = (position.totalAllocation * pnlPercent) / 100;
        position.pnlPercent = pnlPercent;
        position.pnlAmount = pnlAmount;
        position.exitReason = 'signal';
        
        await position.save();

        logger.info(`Position closed successfully for ${symbol}. PnL: ${pnlPercent.toFixed(2)}% (${pnlAmount.toFixed(2)} USDT). Order details: ${JSON.stringify(order)}`);
        
        return order;
    } catch (error) {
        logger.error(`Error closing position for ${symbol}: ${error.message}`);
        // Hata durumunda da veritabanını güncelle (pozisyon kapanmış olabilir)
        try {
            const openPositions = await binanceService.getOpenPositions();
            const binancePosition = openPositions.find(p => p.symbol === symbol);
            
            // Pozisyon Binance'de yoksa/kapanmışsa DB'yi güncelle
            if (!binancePosition || parseFloat(binancePosition.positionAmt) === 0) {
                position.isActive = false;
                position.closedPrice = closePrice;
                position.closedAt = new Date();
                position.exitReason = 'error_but_closed';
                await position.save();
                logger.info(`Position for ${symbol} marked as closed in DB despite error`);
            }
        } catch (dbError) {
            logger.error(`Error updating DB after close error for ${symbol}: ${dbError.message}`);
        }
        
        throw error;
    }
}

module.exports = positionManager;
