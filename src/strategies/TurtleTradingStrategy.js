// TurtleTradingStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');

class TurtleTradingStrategy {
    constructor() {
        this.parameters = {
            entryChannel: 20,    // 20 periyotluk kanal (giriş sinyali için)
            exitChannel: 10,     // 10 periyotluk kanal (çıkış sinyali için)
            atrPeriod: 14,       // ATR periyodu
            riskPercentage: 1,   // Risk yüzdesi
            atrMultiplier: 2,    // Stop loss için ATR çarpanı
            confirmationPeriod: 3, // En az 3 mum gerekli kırılma doğrulaması için
            profitMultiplier: 3   // Risk:Ödül oranını 1:3'e çıkardık
        };
        
        // 4 saatlik zaman dilimini kullanacağız
        this.preferredTimeframe = config.strategy.timeframe || '4h';
    }
    
    async initialize() {
        try {
            // Veritabanından parametreleri yükleme
            const strategy = await Strategy.findOne({ where: { name: 'TurtleTradingStrategy' } });
            if (strategy) {
                this.parameters = { ...this.parameters, ...strategy.parameters };
            }
            
            logger.info('Turtle Trading Strategy initialized with parameters:', this.parameters);
        } catch (error) {
            logger.error('Error initializing Turtle Trading Strategy:', error);
        }
    }
    
    async generateSignal(candles, symbol) {
        try {
            if (!candles || candles.length < this.parameters.entryChannel + 10) {
                logger.warn(`Not enough candles for ${symbol} to generate Turtle Trading signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Donchian Kanallarını hesapla
            const entryDonchian = this.calculateDonchianChannel(candles, this.parameters.entryChannel);
            const exitDonchian = this.calculateDonchianChannel(candles, this.parameters.exitChannel);
            
            // ATR hesapla
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            
            // Trend analizi için basit bir hareketli ortalama
            const sma50 = this.calculateSMA(candles, 50);
            const sma200 = this.calculateSMA(candles, 200);
            
            // Mum değerleri
            const currentCandle = candles[candles.length - 1];
            const previousCandle = candles[candles.length - 2];
            
            const currentHigh = parseFloat(currentCandle.high);
            const currentLow = parseFloat(currentCandle.low);
            const currentClose = parseFloat(currentCandle.close);
            
            const previousHigh = parseFloat(previousCandle.high);
            const previousLow = parseFloat(previousCandle.low);
            
            const isUptrend = currentClose > sma50 && sma50 > sma200;
            const isDowntrend = currentClose < sma50 && sma50 < sma200;
            
            // Kırılma sinyalleri için gelişmiş kontrol
            let breakoutHigh = false;
            let breakoutLow = false;
            
            // Kırılmanın doğrulanması için son birkaç mum kontrolü
            const confirmationPeriod = this.parameters.confirmationPeriod;
            
            // Yukarı kırılma kontrolü - mumun en yüksek değeri üst sınırı geçtiyse
            // Bu, önceki mumda üst sınıra temas yokken, şimdiki mumda varsa sinyal oluşturur
            if (previousHigh < entryDonchian.upper && currentHigh >= entryDonchian.upper) {
                logger.info(`${symbol}: Üst Donchian bandına temas algılandı. Band: ${entryDonchian.upper}, Mum yüksek: ${currentHigh}`);
                
                // Doğrulama için yakındaki mumları kontrol et
                let highTouchCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    // Mumun en yüksek değeri banta teğet veya geçtiyse say
                    if (parseFloat(candles[i].high) >= entryDonchian.upper * 0.998) {
                        highTouchCount++;
                    }
                }
                
                breakoutHigh = highTouchCount >= 1; // En az bir mumda teması doğrula
                logger.info(`${symbol}: Üst band temas sayısı: ${highTouchCount}, Breakout: ${breakoutHigh}`);
            }
            
            // Aşağı kırılma kontrolü - mumun en düşük değeri alt sınırı geçtiyse
            // Bu, önceki mumda alt sınıra temas yokken, şimdiki mumda varsa sinyal oluşturur
            if (previousLow > entryDonchian.lower && currentLow <= entryDonchian.lower) {
                logger.info(`${symbol}: Alt Donchian bandına temas algılandı. Band: ${entryDonchian.lower}, Mum düşük: ${currentLow}`);
                
                // Doğrulama için yakındaki mumları kontrol et
                let lowTouchCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    // Mumun en düşük değeri banta teğet veya geçtiyse say
                    if (parseFloat(candles[i].low) <= entryDonchian.lower * 1.002) {
                        lowTouchCount++;
                    }
                }
                
                breakoutLow = lowTouchCount >= 1; // En az bir mumda teması doğrula
                logger.info(`${symbol}: Alt band temas sayısı: ${lowTouchCount}, Breakout: ${breakoutLow}`);
            }
            
            // Hacim doğrulaması ekle
            const volumeConfirmation = this.checkVolumeConfirmation(candles);
            
            // Çıkış sinyalleri için kontrol (mumun en düşük veya en yüksek değerlerine bakarak)
            const exitLong = currentLow <= exitDonchian.lower;
            const exitShort = currentHigh >= exitDonchian.upper;
            
            // Turtle Trading için pozisyon büyüklüğü hesaplama (ATR-based position sizing)
            // İlk giriş için hesaplama
            const initialRisk = config.calculate_position_size 
                ? config.riskPerTrade * config.accountSize 
                : config.static_position_size;
                
            // Toplam 4 giriş yapılabilir, her biri için kademeli olarak azalan risk
            const positionEntries = 4;
            const entryRisk = initialRisk / positionEntries;
                
            const riskPerUnit = atr * this.parameters.atrMultiplier;
            const units = entryRisk / riskPerUnit;
            const allocation = units * currentClose;
            
            // Turtle Trading'e göre stop loss ve take profit hesaplama
            let stopLoss, takeProfit;
            let signal = 'NEUTRAL';
            let unmetConditions = [];
            
            // Çıkış sinyallerini kontrol et (açık pozisyonları kontrol et)
            let existingPositions = await this.checkExistingPositions(symbol);
            
            // Varsayılan değerler (pozisyon yoksa)
            if (!existingPositions) {
                logger.warn(`Error checking existing positions for ${symbol}, using default values`);
                existingPositions = { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0 };
            }
            
            // Trend ile uyumlu işlemleri tercih et
            if (breakoutHigh) {
                // Long pozisyon sinyali
                if (existingPositions.hasLong) {
                    // Ek giriş (pyramiding) sinyali - pozisyona ekleme
                    if (existingPositions.longEntries < 4) {
                        // Son girişten beri yeterli zaman geçmiş mi kontrol et
                        const canEnterNewPosition = await this.canAddNewPosition(symbol, 'LONG');
                        
                        if (canEnterNewPosition) {
                            signal = 'ADD_BUY';
                            logger.info(`Turtle Trading ADD LONG signal for ${symbol} at ${currentClose} (entry #${existingPositions.longEntries + 1})`);
                        } else {
                            logger.info(`Waiting for next timeframe to add to LONG position for ${symbol}`);
                            signal = 'NEUTRAL';
                        }
                    } else {
                        logger.info(`Maximum long entries (4) reached for ${symbol}, not adding more`);
                        signal = 'NEUTRAL';
                    }
                } else {
                    // Aynı zaman diliminde bir önceki işlemimiz var mı kontrol et
                    const canEnterNewPosition = await this.canEnterNewTimeframe(symbol);
                    
                    if (canEnterNewPosition) {
                        // Yeni giriş sinyali
                        signal = volumeConfirmation ? 'BUY' : 'WEAK_BUY';
                        
                        if (!volumeConfirmation) {
                            unmetConditions.push('Volume confirmation missing');
                        }
                        
                        logger.info(`Turtle Trading LONG signal for ${symbol} at ${currentClose}`);
                        logger.info(`Donchian Upper Breakout: ${entryDonchian.upper}`);
                    } else {
                        logger.info(`Already opened a position in this timeframe for ${symbol}, waiting for next timeframe`);
                        signal = 'NEUTRAL';
                    }
                }
                
                // Her durumda stop loss ve take profit hesapla
                stopLoss = currentLow - (atr * this.parameters.atrMultiplier);
                takeProfit = currentHigh + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                
            } else if (breakoutLow) {
                // Short pozisyon sinyali
                if (existingPositions.hasShort) {
                    // Ek giriş (pyramiding) sinyali - pozisyona ekleme
                    if (existingPositions.shortEntries < 4) {
                        // Son girişten beri yeterli zaman geçmiş mi kontrol et
                        const canEnterNewPosition = await this.canAddNewPosition(symbol, 'SHORT');
                        
                        if (canEnterNewPosition) {
                            signal = 'ADD_SELL';
                            logger.info(`Turtle Trading ADD SHORT signal for ${symbol} at ${currentClose} (entry #${existingPositions.shortEntries + 1})`);
                        } else {
                            logger.info(`Waiting for next timeframe to add to SHORT position for ${symbol}`);
                            signal = 'NEUTRAL';
                        }
                    } else {
                        logger.info(`Maximum short entries (4) reached for ${symbol}, not adding more`);
                        signal = 'NEUTRAL';
                    }
                } else {
                    // Aynı zaman diliminde bir önceki işlemimiz var mı kontrol et
                    const canEnterNewPosition = await this.canEnterNewTimeframe(symbol);
                    
                    if (canEnterNewPosition) {
                        // Yeni giriş sinyali
                        signal = volumeConfirmation ? 'SELL' : 'WEAK_SELL';
                        
                        if (!volumeConfirmation) {
                            unmetConditions.push('Volume confirmation missing');
                        }
                        
                        logger.info(`Turtle Trading SHORT signal for ${symbol} at ${currentClose}`);
                        logger.info(`Donchian Lower Breakout: ${entryDonchian.lower}`);
                    } else {
                        logger.info(`Already opened a position in this timeframe for ${symbol}, waiting for next timeframe`);
                        signal = 'NEUTRAL';
                    }
                }
                
                // Her durumda stop loss ve take profit hesapla
                stopLoss = currentHigh + (atr * this.parameters.atrMultiplier);
                takeProfit = currentLow - (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                
            } else if (exitLong && existingPositions.hasLong) {
                // Long pozisyon için çıkış sinyali
                signal = 'EXIT_BUY';
                stopLoss = currentLow;
                logger.info(`Turtle Trading EXIT LONG signal for ${symbol} at ${currentClose}`);
                logger.info(`Exit Donchian Lower Breakout: ${exitDonchian.lower}`);
                
            } else if (exitShort && existingPositions.hasShort) {
                // Short pozisyon için çıkış sinyali
                signal = 'EXIT_SELL';
                stopLoss = currentHigh;
                logger.info(`Turtle Trading EXIT SHORT signal for ${symbol} at ${currentClose}`);
                logger.info(`Exit Donchian Upper Breakout: ${exitDonchian.upper}`);
                
            } else {
                // NEUTRAL durumda bile stop loss ve take profit hesapla
                // Varsayılan olarak alış yönü için (long) hesaplama yapalım
                stopLoss = currentLow - (atr * this.parameters.atrMultiplier);
                takeProfit = currentHigh + (atr * this.parameters.atrMultiplier * this.parameters.profitMultiplier);
                
                unmetConditions.push('No breakout detected, monitoring only');
            }
            
            // Ek piyasa bilgilerini hesapla
            const volatility = (atr / currentClose) * 100; // Yüzde olarak volatilite
            const averageVolume = this.calculateAverageVolume(candles, 20);
            const currentVolume = parseFloat(candles[candles.length - 1].volume);
            const volumeRatio = currentVolume / averageVolume;
            
            // Sonuçları logla
            logger.info(`Enhanced Turtle Trading scan for ${symbol}:
                - Current Price: ${currentClose}, High: ${currentHigh}, Low: ${currentLow}
                - Entry Donchian: Upper=${entryDonchian.upper}, Lower=${entryDonchian.lower}
                - Exit Donchian: Upper=${exitDonchian.upper}, Lower=${exitDonchian.lower}
                - ATR: ${atr} (${volatility.toFixed(2)}%)
                - Volume Ratio: ${volumeRatio.toFixed(2)}
                - Trend: ${isUptrend ? 'UP' : isDowntrend ? 'DOWN' : 'NEUTRAL'}
                - Signal: ${signal}
                - Stop Loss: ${stopLoss}
                - Take Profit: ${takeProfit}
                - Allocation: ${allocation}
                - Existing Positions: Long=${existingPositions.longEntries}, Short=${existingPositions.shortEntries}
                - Unmet Conditions: ${unmetConditions.join(', ') || 'None'}
            `);
            
            return { 
                signal, 
                stopLoss, 
                takeProfit, 
                allocation,
                positionAddition: signal === 'ADD_BUY' || signal === 'ADD_SELL',
                exitPosition: signal === 'EXIT_BUY' || signal === 'EXIT_SELL',
                unmetConditions: unmetConditions.join(', '),
                indicators: {
                    entryDonchian,
                    exitDonchian,
                    atr,
                    volatility,
                    volumeRatio,
                    currentHigh,
                    currentLow,
                    currentClose,
                    trend: isUptrend ? 'UP' : isDowntrend ? 'DOWN' : 'NEUTRAL'
                }
            };
            
        } catch (error) {
            logger.error(`Error generating Turtle Trading signal for ${symbol}:`, error);
            return { signal: 'NEUTRAL' };
        }
    }
    
    // Basit bir SMA hesaplayıcı
    calculateSMA(candles, period) {
        if (candles.length < period) return null;
        
        const closes = candles.slice(-period).map(c => parseFloat(c.close));
        const sum = closes.reduce((total, price) => total + price, 0);
        return sum / period;
    }
    
    // Açık pozisyonları kontrol etme fonksiyonu
    async checkExistingPositions(symbol) {
        try {
            const { Position } = require('../db/db').models;
            
            // Aktif pozisyonları getir
            const positions = await Position.findAll({
                where: { 
                    symbol, 
                    isActive: true 
                }
            });
            
            if (!positions || positions.length === 0) {
                return { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0, lastEntryTime: null };
            }
            
            // Long ve short pozisyonları ayır
            const longPositions = positions.filter(p => p.entries > 0);
            const shortPositions = positions.filter(p => p.entries < 0);
            
            // Son giriş zamanını belirle
            const latestLongPosition = longPositions.length > 0 ? 
                longPositions.reduce((latest, position) => {
                    // Eğer position.updatedAt varsa ve latest.updatedAt'dan daha yeniyse, bu position'u döndür
                    return (!latest || new Date(position.updatedAt) > new Date(latest.updatedAt)) ? position : latest;
                }, null) : null;
                
            const latestShortPosition = shortPositions.length > 0 ? 
                shortPositions.reduce((latest, position) => {
                    return (!latest || new Date(position.updatedAt) > new Date(latest.updatedAt)) ? position : latest;
                }, null) : null;
            
            return {
                hasLong: longPositions.length > 0,
                hasShort: shortPositions.length > 0,
                longEntries: longPositions.length > 0 ? Math.abs(longPositions[0].entries) : 0,
                shortEntries: shortPositions.length > 0 ? Math.abs(shortPositions[0].entries) : 0,
                lastLongEntryTime: latestLongPosition ? latestLongPosition.updatedAt : null,
                lastShortEntryTime: latestShortPosition ? latestShortPosition.updatedAt : null
            };
            
        } catch (error) {
            logger.error(`Error checking existing positions for ${symbol}:`, error);
            return { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0, lastEntryTime: null };
        }
    }
    
    /**
     * Son girişten beri yeni bir zaman dilimi geçmiş mi kontrol eder
     * Her 4 saatlik periyotta sadece 1 pyramiding (ek giriş) yapılabilir
     */
    async canAddNewPosition(symbol, direction) {
        try {
            const { Position } = require('../db/db').models;
            
            // Mevcut pozisyonları kontrol et
            const positions = await this.checkExistingPositions(symbol);
            
            // Yön için son giriş zamanını al
            const lastEntryTime = direction === 'LONG' ? positions.lastLongEntryTime : positions.lastShortEntryTime;
            
            // Eğer daha önce giriş yapılmamışsa, giriş yapılabilir
            if (!lastEntryTime) return true;
            
            // Son girişten bu yana geçen süreyi hesapla
            const now = new Date();
            const lastEntry = new Date(lastEntryTime);
            
            // Timeframe süresini milisaniye cinsinden hesapla (4 saat = 4 * 60 * 60 * 1000 ms)
            const timeframeDuration = 4 * 60 * 60 * 1000; // 4 saatlik
            
            // Son girişten bu yana bir timeframe (4 saat) geçmiş mi kontrol et
            const timeSinceLastEntry = now - lastEntry;
            
            // Bir sonraki timeframe'in başlangıcını hesapla
            // Örn: 4 saatlik periyotlar: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
            const currentTimeframeStart = new Date(
                Math.floor(now.getTime() / timeframeDuration) * timeframeDuration
            );
            
            const lastEntryTimeframe = new Date(
                Math.floor(lastEntry.getTime() / timeframeDuration) * timeframeDuration
            );
            
            // Eğer son giriş ile şu anki giriş farklı timeframe'lerde ise giriş yapılabilir
            // Örneğin son giriş 04:00-08:00 arasında yapıldıysa, 08:00-12:00 arasında yeni giriş yapılabilir
            const canEnter = currentTimeframeStart.getTime() > lastEntryTimeframe.getTime();
            
            logger.info(`${symbol} ${direction} - Time since last entry: ${timeSinceLastEntry / (60 * 1000)} minutes. Can enter new position: ${canEnter}`);
            
            return canEnter;
            
        } catch (error) {
            logger.error(`Error checking if can add new position for ${symbol}:`, error);
            return false; // Hata durumunda güvenli tarafta kal, yeni giriş yapma
        }
    }
    
    /**
     * Yeni pozisyon açmak için zaman dilimini kontrol et
     * Her 4 saatlik periyotta yeni bir pozisyon açılabilir
     */
    async canEnterNewTimeframe(symbol) {
        try {
            const { Position } = require('../db/db').models;
            
            // Mevcut tüm açık pozisyonları getir
            const positions = await Position.findAll({
                where: { 
                    isActive: true
                },
                order: [['createdAt', 'DESC']]
            });
            
            // Son açılan pozisyonu bul
            const lastPosition = positions.length > 0 ? positions[0] : null;
            
            // Hiç pozisyon yoksa, yeni pozisyon açılabilir
            if (!lastPosition) return true;
            
            // Son pozisyonun açılış zamanını al
            const lastPositionTime = new Date(lastPosition.createdAt);
            const now = new Date();
            
            // Timeframe süresini milisaniye cinsinden hesapla (4 saat = 4 * 60 * 60 * 1000 ms)
            const timeframeDuration = 4 * 60 * 60 * 1000; // 4 saatlik
            
            // Şu anki timeframe'in başlangıcını hesapla
            const currentTimeframeStart = new Date(
                Math.floor(now.getTime() / timeframeDuration) * timeframeDuration
            );
            
            // Son pozisyonun açıldığı timeframe'in başlangıcını hesapla
            const lastPositionTimeframe = new Date(
                Math.floor(lastPositionTime.getTime() / timeframeDuration) * timeframeDuration
            );
            
            // Eğer son pozisyon ile şu anki giriş farklı timeframe'lerde ise yeni pozisyon açılabilir
            const canEnter = currentTimeframeStart.getTime() > lastPositionTimeframe.getTime();
            
            const timeSinceLastPosition = now - lastPositionTime;
            logger.info(`${symbol} - Time since last position: ${timeSinceLastPosition / (60 * 1000)} minutes. Can open new position: ${canEnter}`);
            
            return canEnter;
            
        } catch (error) {
            logger.error(`Error checking if can enter new timeframe for ${symbol}:`, error);
            return true; // Hata durumunda yeni pozisyon açılmasına izin ver
        }
    }
    
    // Hacim doğrulaması kontrolü
    checkVolumeConfirmation(candles) {
        try {
            // Son 20 mumun hacim ortalaması
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            
            // Son mumun hacmi
            const lastVolume = volumes[volumes.length - 1];
            
            // Son hacim ortalamanın 1.5 katından büyükse doğrula
            return lastVolume > avgVolume * 1.5;
        } catch (error) {
            logger.error('Error checking volume confirmation:', error);
            return false;
        }
    }
    
    // Ortalama hacim hesaplama
    calculateAverageVolume(candles, period) {
        try {
            if (candles.length < period) return 0;
            
            const volumes = candles.slice(-period).map(c => parseFloat(c.volume));
            return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        } catch (error) {
            logger.error('Error calculating average volume:', error);
            return 0;
        }
    }
    
    // Donchian Kanalı hesaplama
    calculateDonchianChannel(candles, period) {
        try {
            const relevantCandles = candles.slice(-period);
            
            let highest = -Infinity;
            let lowest = Infinity;
            
            for (const candle of relevantCandles) {
                const high = parseFloat(candle.high);
                const low = parseFloat(candle.low);
                
                if (high > highest) highest = high;
                if (low < lowest) lowest = low;
            }
            
            return {
                upper: highest,
                lower: lowest,
                middle: (highest + lowest) / 2
            };
        } catch (error) {
            logger.error('Error calculating Donchian Channel:', error);
            return { upper: 0, lower: 0, middle: 0 };
        }
    }
    
    // ATR (Average True Range) hesaplama
    calculateATR(candles, period) {
        try {
            const trValues = [];
            
            // İlk True Range değerleri hesapla
            for (let i = 1; i < candles.length; i++) {
                const currentCandle = candles[i];
                const previousCandle = candles[i - 1];
                
                const high = parseFloat(currentCandle.high);
                const low = parseFloat(currentCandle.low);
                const prevClose = parseFloat(previousCandle.close);
                
                // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
                const tr = Math.max(
                    high - low,
                    Math.abs(high - prevClose),
                    Math.abs(low - prevClose)
                );
                
                trValues.push(tr);
            }
            
            // Son 'period' kadar değerin ortalamasını al
            const relevantTR = trValues.slice(-period);
            const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
            
            return atr;
        } catch (error) {
            logger.error('Error calculating ATR:', error);
            return 0;
        }
    }
    
    async analyzeMarketConditions(mtfData, symbol) {
        try {
            const preferredTimeframe = this.preferredTimeframe || '4h';
            const candles = mtfData.candles[preferredTimeframe] || [];
            
            if (!candles || candles.length < 50) {
                logger.warn(`Not enough ${preferredTimeframe} candles for ${symbol} to analyze market conditions`);
                return {
                    trend: 'NEUTRAL',
                    trendStrength: 50,
                    volatility: 'MEDIUM',
                    marketType: 'RANGING',
                    volume: 'NORMAL'
                };
            }
            
            // Donchian Kanallarını hesapla
            const entryDonchian = this.calculateDonchianChannel(candles, this.parameters.entryChannel);
            
            // ATR hesapla - volatilite için
            const atr = this.calculateATR(candles, this.parameters.atrPeriod);
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            const volatilityPercent = (atr / currentPrice) * 100;
            
            // Hareketli ortalamalar
            const sma50 = this.calculateSMA(candles, 50);
            const sma200 = this.calculateSMA(candles, 200);
            
            // Trend belirleme
            let trend = 'NEUTRAL';
            let trendStrength = 50;
            
            if (currentPrice > sma50 && sma50 > sma200) {
                // Güçlü yukarı trend
                trend = 'UP';
                const distanceFromSMA = ((currentPrice - sma50) / sma50) * 100;
                trendStrength = Math.min(90, 50 + distanceFromSMA * 5);
            } else if (currentPrice < sma50 && sma50 < sma200) {
                // Güçlü aşağı trend
                trend = 'DOWN';
                const distanceFromSMA = ((sma50 - currentPrice) / sma50) * 100;
                trendStrength = Math.min(90, 50 + distanceFromSMA * 5);
            } else if (currentPrice > sma50 && sma50 < sma200) {
                // Potansiyel trend değişimi (aşağıdan yukarıya)
                trend = 'UP_REVERSAL';
                trendStrength = 60;
            } else if (currentPrice < sma50 && sma50 > sma200) {
                // Potansiyel trend değişimi (yukarıdan aşağıya)
                trend = 'DOWN_REVERSAL';
                trendStrength = 60;
            }
            
            // Volatilite sınıflandırma
            let volatility = 'MEDIUM';
            if (volatilityPercent > 2.5) volatility = 'HIGH';
            else if (volatilityPercent < 1.0) volatility = 'LOW';
            
            // Market tipi belirleme
            let marketType = 'RANGING';
            if (trend === 'UP' && trendStrength > 70) marketType = 'TRENDING_UP';
            else if (trend === 'DOWN' && trendStrength > 70) marketType = 'TRENDING_DOWN';
            else if (trend.includes('REVERSAL')) marketType = 'REVERSAL';
            
            // Hacim analizi
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            const currentVolume = volumes[volumes.length - 1];
            
            let volume = 'NORMAL';
            if (currentVolume > avgVolume * 1.5) volume = 'HIGH';
            else if (currentVolume < avgVolume * 0.5) volume = 'LOW';
            
            // Sonuçları döndür
            return {
                trend,
                trendStrength,
                volatility,
                marketType,
                volume,
                indicators: {
                    entryDonchian,
                    atr,
                    volatilityPercent,
                    sma50,
                    sma200
                }
            };
        } catch (error) {
            logger.error(`Error analyzing market conditions for ${symbol}:`, error);
            return {
                trend: 'NEUTRAL',
                trendStrength: 50,
                volatility: 'MEDIUM',
                marketType: 'RANGING',
                volume: 'NORMAL'
            };
        }
    }
}

module.exports = TurtleTradingStrategy;