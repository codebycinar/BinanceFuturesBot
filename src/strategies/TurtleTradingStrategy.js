// TurtleTradingStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');
const ti = require('technicalindicators');

class TurtleTradingStrategy {
    constructor() {
        // Modern piyasalara uyarlanmış Turtle Trading parametreleri
        this.parameters = {
            entryChannel: 200,   // 200 periyotluk kanal (giriş sinyali için) - orijinal 20 yerine
            exitChannel: 10,     // 10 periyotluk kanal (çıkış sinyali için)
            atrPeriod: 14,       // ATR periyodu
            riskPercentage: 1,   // Risk yüzdesi %1 (optimum değer)
            atrMultiplier: 2,    // Stop loss için ATR çarpanı
            confirmationPeriod: 5, // Daha güçlü doğrulama için 5 mum 
            profitMultiplier: 3,  // Risk:Ödül oranı 1:3
            maxEntries: 3,        // Maksimum giriş sayısı
            timeframe: '1d',      // Günlük zaman dilimi (daha uzun trend için)
            volumeConfirmation: true, // Hacim onayı kontrolü
            useBreakEven: true,   // Break-even kullanımını aç/kapa
            breakEvenActivationPercent: 0.8 // %0.8 kar seviyesinde aktifleştir (ATR'nin katsayısı)
        };
        
        // Konfigürasyonda Turtle stratejisi ayarları varsa, bunları kullan
        if (config.turtleStrategy) {
            this.parameters = { ...this.parameters, ...config.turtleStrategy };
        }
        
        // 4 saatlik zaman dilimini kullanacağız
        this.preferredTimeframe = this.parameters.timeframe || config.strategy.timeframe || '4h';
        
        // İzleme durumları için hafıza nesnesi
        this.positionMemory = {}; // Her sembol için yüksek/düşük fiyatları takip etmek için
    }
    
    async initialize() {
        try {
            // Önce konfigürasyon dosyasından parametreleri al
            if (config.turtleStrategy) {
                this.parameters = { ...this.parameters, ...config.turtleStrategy };
                logger.info('Loaded Turtle Trading parameters from config file');
            }
            
            // Test modunda veritabanına erişmeye çalışma
            if (process.env.NODE_ENV === 'test') {
                this.preferredTimeframe = this.parameters.timeframe || '4h';
                logger.info('Running in test mode, skipping database operations');
                return;
            }
            
            try {
                // Veritabanının hazır olup olmadığını kontrol et
                const dbReady = await this.checkDatabaseReady();
                
                if (dbReady) {
                    // Eğer veritabanında varsa, onları da yükle (öncelik veritabanındaki parametrelerde)
                    const strategy = await Strategy.findOne({ where: { name: 'TurtleTradingStrategy' } });
                    if (strategy && strategy.parameters) {
                        this.parameters = { ...this.parameters, ...strategy.parameters };
                        logger.info('Loaded Turtle Trading parameters from database');
                    } else {
                        // Veritabanında yoksa, şu anki parametreleri kaydet
                        try {
                            await Strategy.create({
                                name: 'TurtleTradingStrategy',
                                parameters: this.parameters,
                                isActive: true
                            });
                            logger.info('Created new Turtle Trading Strategy record in database');
                        } catch (dbError) {
                            logger.warn('Could not create strategy record in database:', dbError.message);
                        }
                    }
                } else {
                    logger.warn('Database not ready, using config file parameters only');
                }
            } catch (dbError) {
                logger.warn('Database error when accessing strategies:', dbError.message);
                // Veritabanına erişilemiyorsa, config dosyasındaki parametrelerle devam et
            }
            
            this.preferredTimeframe = this.parameters.timeframe || '1d'; // Değiştirildi - modern strateji için 1d tercih edilir
            
            logger.info(`Turtle Trading Strategy initialized with parameters:
                - Entry Channel: ${this.parameters.entryChannel} periods
                - Exit Channel: ${this.parameters.exitChannel} periods
                - ATR Period: ${this.parameters.atrPeriod}
                - Risk Percentage: ${this.parameters.riskPercentage}%
                - ATR Multiplier: ${this.parameters.atrMultiplier}
                - Confirmation Period: ${this.parameters.confirmationPeriod}
                - Profit Multiplier: ${this.parameters.profitMultiplier}
                - Max Entries: ${this.parameters.maxEntries}
                - Timeframe: ${this.preferredTimeframe}
                - Use Break-Even: ${this.parameters.useBreakEven ? 'Yes' : 'No'}
            `);
            
            // Multi-Strategy yapısı ile uyumluluk kontrolü
            if (!this.generateSignal) {
                logger.error('TurtleTradingStrategy is missing the generateSignal method required for the multi-strategy system');
            } else {
                logger.info('TurtleTradingStrategy is compatible with the multi-strategy system');
            }
        } catch (error) {
            logger.error('Error initializing Turtle Trading Strategy:', error);
        }
    }
    
    // Veritabanının hazır olup olmadığını kontrol eden yardımcı fonksiyon
    async checkDatabaseReady() {
        try {
            // Position tablosunun varlığını kontrol et
            await models.Position.findOne();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async generateSignal(candles, symbol) {
        try {
            if (!candles || candles.length < this.parameters.entryChannel + 10) {
                logger.warn(`Not enough candles for ${symbol} to generate Turtle Trading signal`);
                return { signal: 'NEUTRAL' };
            }
            
            // Cache mechanims for repeated calculations
            if (!this.calculationCache) {
                this.calculationCache = {};
                this.cacheExpiry = {};
            }
            
            // Adaptif kırılma seviyesi - piyasa koşullarına göre ayarla
            let entryPeriod = this.parameters.entryChannel;
            if (this.parameters.adaptiveBreakout) {
                // Create a cache key to avoid repeated ATR calculations
                const cacheKey = `${symbol}_atr_${this.parameters.atrPeriod}_${candles[candles.length-1].timestamp}`;
                const now = Date.now();
                const cacheLifetime = 30 * 1000; // 30 second cache
                
                let atr;
                if (this.calculationCache[cacheKey] && this.cacheExpiry[cacheKey] > now) {
                    // Use cached ATR value
                    atr = this.calculationCache[cacheKey];
                } else {
                    // Calculate ATR and cache it
                    atr = this.calculateATR(candles, this.parameters.atrPeriod);
                    this.calculationCache[cacheKey] = atr;
                    this.cacheExpiry[cacheKey] = now + cacheLifetime;
                    
                    // Clean cache occasionally
                    this.cleanCalculationCache();
                }
                
                const currentPrice = parseFloat(candles[candles.length - 1].close);
                const volatilityPercent = (atr / currentPrice) * 100;
                
                // Yüksek volatilitede daha uzun periyot, düşük volatilitede daha kısa
                if (volatilityPercent > 3.0) { // Yüksek volatilite
                    entryPeriod = Math.min(300, this.parameters.entryChannel * 1.5);
                    logger.info(`High volatility (${volatilityPercent.toFixed(2)}%), increasing breakout period to ${entryPeriod}`);
                } else if (volatilityPercent < 1.0) { // Düşük volatilite
                    entryPeriod = Math.max(100, this.parameters.entryChannel * 0.75);
                    logger.info(`Low volatility (${volatilityPercent.toFixed(2)}%), decreasing breakout period to ${entryPeriod}`);
                }
            }
            
            // Donchian Kanallarını hesapla
            const entryDonchian = this.calculateDonchianChannel(candles, Math.round(entryPeriod));
            const exitDonchian = this.calculateDonchianChannel(candles, this.parameters.exitChannel);
            
            // ATR hesapla - use cache if available
            let atr;
            const atrCacheKey = `${symbol}_atr_${this.parameters.atrPeriod}_${candles[candles.length-1].timestamp}`;
            const now = Date.now();
            
            if (this.calculationCache && this.calculationCache[atrCacheKey] && this.cacheExpiry[atrCacheKey] > now) {
                // Use cached ATR value
                atr = this.calculationCache[atrCacheKey];
            } else {
                // Calculate ATR and cache it
                atr = this.calculateATR(candles, this.parameters.atrPeriod);
                if (this.calculationCache) {
                    this.calculationCache[atrCacheKey] = atr;
                    this.cacheExpiry[atrCacheKey] = now + (30 * 1000); // 30 second cache
                }
            }
            
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
                
                // Daha net kırılma için aradaki mesafeyi kontrol et (%0.2)
                const breakoutPercentage = ((currentHigh - entryDonchian.upper) / entryDonchian.upper) * 100;
                const isSignificantBreakout = breakoutPercentage >= 0.2;
                
                // Doğrulama için yakındaki mumları kontrol et
                let highTouchCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    // Mumun en yüksek değeri banta teğet veya geçtiyse say (daha düşük tolerans %0.995)
                    if (parseFloat(candles[i].high) >= entryDonchian.upper * 0.995) {
                        highTouchCount++;
                    }
                }
                
                // En az 2 mumda temas arayarak doğrulama kriterini sıkılaştır
                breakoutHigh = highTouchCount >= 2 || (isSignificantBreakout && highTouchCount >= 1);
                logger.info(`${symbol}: Üst band temas sayısı: ${highTouchCount}, Breakout %: ${breakoutPercentage.toFixed(2)}%, Is significant: ${isSignificantBreakout}, Breakout: ${breakoutHigh}`);
            }
            
            // Aşağı kırılma kontrolü - mumun en düşük değeri alt sınırı geçtiyse
            // Bu, önceki mumda alt sınıra temas yokken, şimdiki mumda varsa sinyal oluşturur
            if (previousLow > entryDonchian.lower && currentLow <= entryDonchian.lower) {
                logger.info(`${symbol}: Alt Donchian bandına temas algılandı. Band: ${entryDonchian.lower}, Mum düşük: ${currentLow}`);
                
                // Daha net kırılma için aradaki mesafeyi kontrol et (%0.2)
                const breakoutPercentage = ((entryDonchian.lower - currentLow) / entryDonchian.lower) * 100;
                const isSignificantBreakout = breakoutPercentage >= 0.2;
                
                // Doğrulama için yakındaki mumları kontrol et
                let lowTouchCount = 0;
                for (let i = candles.length - confirmationPeriod; i < candles.length; i++) {
                    // Mumun en düşük değeri banta teğet veya geçtiyse say (daha düşük tolerans %1.005)
                    if (parseFloat(candles[i].low) <= entryDonchian.lower * 1.005) {
                        lowTouchCount++;
                    }
                }
                
                // En az 2 mumda temas arayarak doğrulama kriterini sıkılaştır
                breakoutLow = lowTouchCount >= 2 || (isSignificantBreakout && lowTouchCount >= 1);
                logger.info(`${symbol}: Alt band temas sayısı: ${lowTouchCount}, Breakout %: ${breakoutPercentage.toFixed(2)}%, Is significant: ${isSignificantBreakout}, Breakout: ${breakoutLow}`);
            }
            
            // Hacim doğrulaması ekle - hacim eşiğini 1.5x'ten 1.3x'e düşürdük
            const volumeConfirmation = this.checkVolumeConfirmation(candles, 1.3);
            
            // Volatilite analizi - ATR/Fiyat oranı
            const volatilityPercent = (atr / currentClose) * 100;
            const volatilityLevel = volatilityPercent > 2.5 ? 'HIGH' : volatilityPercent < 1.0 ? 'LOW' : 'MEDIUM';
            
            // Volatiliteye göre ATR çarpanı ayarlanması
            const dynamicAtrMultiplier = this.getDynamicAtrMultiplier(volatilityLevel);
            
            // Çıkış sinyalleri için kontrol (mumun en düşük veya en yüksek değerlerine bakarak)
            const exitLong = currentLow <= exitDonchian.lower;
            const exitShort = currentHigh >= exitDonchian.upper;
            
            // Turtle Trading için pozisyon büyüklüğü hesaplama (ATR-based position sizing)
            // İlk giriş için hesaplama
            const initialRisk = config.calculate_position_size 
                ? config.riskPerTrade * config.accountSize 
                : config.static_position_size;
                
            // Toplam giriş sayısını 4'ten 3'e düşürdük
            const positionEntries = 3;
            const entryRisk = initialRisk / positionEntries;
                
            // Volatiliteye göre ayarlanmış risk
            const riskPerUnit = atr * dynamicAtrMultiplier;
            const units = entryRisk / riskPerUnit;
            
            // Maksimum pozisyon büyüklüğünü sınırlandır
            const maxPositionSize = config.static_position_size;
            let allocation = units * currentClose;
            
            // Volatiliteye göre pozisyon boyutunu ayarla
            if (volatilityLevel === 'HIGH') {
                // Yüksek volatilitede pozisyon boyutunu %25 düşür
                allocation = allocation * 0.75;
                logger.info(`Reduced position size by 25% due to HIGH volatility for ${symbol}`);
            }
            
            // Pozisyon boyutu kontrol ve sınırlama
            if (allocation > maxPositionSize) {
                allocation = maxPositionSize;
                logger.info(`Position size capped at ${maxPositionSize} USDT for ${symbol}`);
            }
            
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
            
            // Trend analizi
            const trendStrength = isUptrend ? 'UPTREND' : isDowntrend ? 'DOWNTREND' : 'NEUTRAL';
            
            // Trend ve kırılma ile uyumlu işlemleri tercih et
            if (breakoutHigh) {
                // Trend ile uyumlu mu kontrol et
                const trendAligned = isUptrend || (!isDowntrend && currentClose > sma50);
                
                if (!trendAligned) {
                    unmetConditions.push('Breakout not aligned with trend direction');
                }
                
                // Long pozisyon sinyali
                if (existingPositions.hasLong) {
                    // Ek giriş (pyramiding) sinyali - pozisyona ekleme
                    if (existingPositions.longEntries < 3) { // Maksimum giriş sayısını 4'ten 3'e düşürdük
                        // Son girişten beri yeterli zaman geçmiş mi kontrol et
                        const canEnterNewPosition = await this.canAddNewPosition(symbol, 'LONG');
                        
                        if (canEnterNewPosition && trendAligned) {
                            signal = 'ADD_BUY';
                            logger.info(`Turtle Trading ADD LONG signal for ${symbol} at ${currentClose} (entry #${existingPositions.longEntries + 1})`);
                        } else {
                            if (!trendAligned) {
                                logger.info(`Skipping ADD LONG for ${symbol} - trend not aligned with position`);
                            } else {
                                logger.info(`Waiting for next timeframe to add to LONG position for ${symbol}`);
                            }
                            signal = 'NEUTRAL';
                        }
                    } else {
                        logger.info(`Maximum long entries (3) reached for ${symbol}, not adding more`);
                        signal = 'NEUTRAL';
                    }
                } else {
                    // Aynı zaman diliminde bir önceki işlemimiz var mı kontrol et
                    const canEnterNewPosition = await this.canEnterNewTimeframe(symbol);
                    
                    // Trendle uyumlu ve giriş yapılabilir durumda ise sinyal oluştur
                    if (canEnterNewPosition && trendAligned) {
                        // Trend ve hacim onayı tam ise güçlü sinyal
                        if (trendAligned && volumeConfirmation) {
                            signal = 'BUY';
                        } else if (trendAligned) {
                            signal = 'WEAK_BUY';
                            unmetConditions.push('Volume confirmation missing');
                        } else {
                            signal = 'NEUTRAL';
                            unmetConditions.push('Trend not aligned with breakout');
                        }
                        
                        if (signal !== 'NEUTRAL') {
                            logger.info(`Turtle Trading LONG signal for ${symbol} at ${currentClose}`);
                            logger.info(`Donchian Upper Breakout: ${entryDonchian.upper}, Trend: ${trendStrength}, Volatility: ${volatilityLevel}`);
                        }
                    } else {
                        if (!trendAligned) {
                            logger.info(`Skipping new LONG for ${symbol} - trend not aligned with position`);
                        } else {
                            logger.info(`Already opened a position in this timeframe for ${symbol}, waiting for next timeframe`);
                        }
                        signal = 'NEUTRAL';
                    }
                }
                
                // Volatiliteye göre dinamik olarak stop loss ve take profit hesapla
                stopLoss = currentLow - (atr * dynamicAtrMultiplier);
                takeProfit = currentHigh + (atr * dynamicAtrMultiplier * this.parameters.profitMultiplier);
                
                // Daha mantıklı stop loss olması için düzeltme
                if (currentClose - stopLoss < atr * 1.5) {
                    // Stop loss çok yakın, volatiliteye göre kaydır
                    stopLoss = currentClose - (atr * (dynamicAtrMultiplier + 0.5));
                    logger.info(`Adjusted stop loss for ${symbol} due to close proximity`);
                }
                
            } else if (breakoutLow) {
                // Trend ile uyumlu mu kontrol et
                const trendAligned = isDowntrend || (!isUptrend && currentClose < sma50);
                
                if (!trendAligned) {
                    unmetConditions.push('Breakout not aligned with trend direction');
                }
                
                // Short pozisyon sinyali
                if (existingPositions.hasShort) {
                    // Ek giriş (pyramiding) sinyali - pozisyona ekleme
                    if (existingPositions.shortEntries < 3) { // Maksimum giriş sayısını 4'ten 3'e düşürdük
                        // Son girişten beri yeterli zaman geçmiş mi kontrol et
                        const canEnterNewPosition = await this.canAddNewPosition(symbol, 'SHORT');
                        
                        if (canEnterNewPosition && trendAligned) {
                            signal = 'ADD_SELL';
                            logger.info(`Turtle Trading ADD SHORT signal for ${symbol} at ${currentClose} (entry #${existingPositions.shortEntries + 1})`);
                        } else {
                            if (!trendAligned) {
                                logger.info(`Skipping ADD SHORT for ${symbol} - trend not aligned with position`);
                            } else {
                                logger.info(`Waiting for next timeframe to add to SHORT position for ${symbol}`);
                            }
                            signal = 'NEUTRAL';
                        }
                    } else {
                        logger.info(`Maximum short entries (3) reached for ${symbol}, not adding more`);
                        signal = 'NEUTRAL';
                    }
                } else {
                    // Aynı zaman diliminde bir önceki işlemimiz var mı kontrol et
                    const canEnterNewPosition = await this.canEnterNewTimeframe(symbol);
                    
                    // Trendle uyumlu ve giriş yapılabilir durumda ise sinyal oluştur
                    if (canEnterNewPosition && trendAligned) {
                        // Trend ve hacim onayı tam ise güçlü sinyal
                        if (trendAligned && volumeConfirmation) {
                            signal = 'SELL';
                        } else if (trendAligned) {
                            signal = 'WEAK_SELL';
                            unmetConditions.push('Volume confirmation missing');
                        } else {
                            signal = 'NEUTRAL';
                            unmetConditions.push('Trend not aligned with breakout');
                        }
                        
                        if (signal !== 'NEUTRAL') {
                            logger.info(`Turtle Trading SHORT signal for ${symbol} at ${currentClose}`);
                            logger.info(`Donchian Lower Breakout: ${entryDonchian.lower}, Trend: ${trendStrength}, Volatility: ${volatilityLevel}`);
                        }
                    } else {
                        if (!trendAligned) {
                            logger.info(`Skipping new SHORT for ${symbol} - trend not aligned with position`);
                        } else {
                            logger.info(`Already opened a position in this timeframe for ${symbol}, waiting for next timeframe`);
                        }
                        signal = 'NEUTRAL';
                    }
                }
                
                // Volatiliteye göre dinamik olarak stop loss ve take profit hesapla
                stopLoss = currentHigh + (atr * dynamicAtrMultiplier);
                takeProfit = currentLow - (atr * dynamicAtrMultiplier * this.parameters.profitMultiplier);
                
                // Daha mantıklı stop loss olması için düzeltme
                if (stopLoss - currentClose < atr * 1.5) {
                    // Stop loss çok yakın, volatiliteye göre kaydır
                    stopLoss = currentClose + (atr * (dynamicAtrMultiplier + 0.5));
                    logger.info(`Adjusted stop loss for ${symbol} due to close proximity`);
                }
                
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
            // Test modunda mock data döndür
            if (process.env.NODE_ENV === 'test') {
                return { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0, lastEntryTime: null };
            }
            
            // Veritabanı kontrolü
            const dbReady = await this.checkDatabaseReady();
            if (!dbReady) {
                logger.warn(`Database not ready when checking positions for ${symbol}, using default values`);
                return { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0, lastEntryTime: null };
            }
            
            const { Position } = require('../db/db').models;
            
            // Aktif pozisyonları getir
            try {
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
            } catch (dbError) {
                logger.warn(`Database error checking positions for ${symbol}: ${dbError.message}`);
                return { hasLong: false, hasShort: false, longEntries: 0, shortEntries: 0, lastEntryTime: null };
            }
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
            // Test modunda her zaman yeni pozisyon eklemesine izin ver
            if (process.env.NODE_ENV === 'test') {
                logger.info(`Test mode: Always allowing new position additions for ${symbol} ${direction}`);
                return true;
            }
            
            // Veritabanı kontrolü
            const dbReady = await this.checkDatabaseReady();
            if (!dbReady) {
                logger.warn(`Database not ready when checking add position for ${symbol}, allowing new position`);
                return true;
            }
            
            try {
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
            } catch (dbError) {
                logger.warn(`Database error checking timeframe for ${symbol}: ${dbError.message}`);
                return true; // Veritabanı hatası durumunda yeni pozisyon eklemeye izin ver
            }
        } catch (error) {
            logger.error(`Error checking if can add new position for ${symbol}:`, error);
            return false; // Genel hata durumunda güvenli tarafta kal, yeni giriş yapma
        }
    }
    
    /**
     * Yeni pozisyon açmak için zaman dilimini kontrol et
     * Her 4 saatlik periyotta yeni bir pozisyon açılabilir
     */
    async canEnterNewTimeframe(symbol) {
        try {
            // Test modunda her zaman yeni pozisyon açmaya izin ver
            if (process.env.NODE_ENV === 'test') {
                logger.info(`Test mode: Always allowing new timeframe entries for ${symbol}`);
                return true;
            }
            
            // Veritabanı kontrolü
            const dbReady = await this.checkDatabaseReady();
            if (!dbReady) {
                logger.warn(`Database not ready when checking new timeframe for ${symbol}, allowing new timeframe`);
                return true;
            }
            
            const { Position } = require('../db/db').models;
            
            try {
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
            } catch (dbError) {
                logger.warn(`Database error checking new timeframe for ${symbol}: ${dbError.message}`);
                return true; // Veritabanı hatası durumunda yeni pozisyon açmaya izin ver
            }
        } catch (error) {
            logger.error(`Error checking if can enter new timeframe for ${symbol}:`, error);
            return true; // Genel hata durumunda yeni pozisyon açılmasına izin ver
        }
    }
    
    // Hacim doğrulaması kontrolü
    checkVolumeConfirmation(candles, threshold = 1.5) {
        try {
            // Son 20 mumun hacim ortalaması
            const volumes = candles.slice(-20).map(c => parseFloat(c.volume));
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            
            // Son mumun hacmi
            const lastVolume = volumes[volumes.length - 1];
            
            // İki son mumun hacim ortalaması (daha güvenilir)
            const lastTwoVolume = (parseFloat(candles[candles.length - 1].volume) + 
                                  parseFloat(candles[candles.length - 2].volume)) / 2;
            
            // Son iki mumun hacmi ortalamanın threshold katından büyükse veya
            // son mumun hacmi ortalamanın 1.7 katından büyükse doğrula
            const confirmed = lastTwoVolume > avgVolume * threshold || lastVolume > avgVolume * 1.7;
            
            logger.info(`Volume confirmation for last candle: ${lastVolume > avgVolume * threshold}, ratio: ${(lastVolume/avgVolume).toFixed(2)}x`);
            logger.info(`Volume confirmation for last two candles: ${lastTwoVolume > avgVolume * threshold}, ratio: ${(lastTwoVolume/avgVolume).toFixed(2)}x`);
            
            return confirmed;
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
    
    // Volatiliteye göre dinamik ATR çarpanı hesapla
    getDynamicAtrMultiplier(volatilityLevel) {
        // Piyasanın volatilitesine göre ATR çarpanını ayarla
        switch (volatilityLevel) {
            case 'HIGH':
                // Yüksek volatilitede daha geniş stop loss
                return this.parameters.atrMultiplier + 1.0;
            case 'MEDIUM':
                // Orta volatilitede normal stop loss
                return this.parameters.atrMultiplier + 0.5;
            case 'LOW':
                // Düşük volatilitede daha dar stop loss
                return this.parameters.atrMultiplier;
            default:
                return this.parameters.atrMultiplier;
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
    
    /**
     * Clean calculation cache to prevent memory leaks
     */
    cleanCalculationCache() {
        try {
            if (!this.calculationCache || !this.cacheExpiry) {
                return;
            }
            
            const now = Date.now();
            let expiredCount = 0;
            
            Object.keys(this.cacheExpiry).forEach(key => {
                if (this.cacheExpiry[key] < now) {
                    delete this.calculationCache[key];
                    delete this.cacheExpiry[key];
                    expiredCount++;
                }
            });
            
            // If we have too many cache entries, trim the cache
            const maxCacheSize = 1000;
            if (Object.keys(this.calculationCache).length > maxCacheSize) {
                // Get oldest entries based on expiry time
                const oldestEntries = Object.keys(this.cacheExpiry)
                    .sort((a, b) => this.cacheExpiry[a] - this.cacheExpiry[b])
                    .slice(0, 100); // Remove oldest 100 entries
                    
                oldestEntries.forEach(key => {
                    delete this.calculationCache[key];
                    delete this.cacheExpiry[key];
                    expiredCount++;
                });
            }
            
            if (expiredCount > 0) {
                logger.debug(`Cleaned ${expiredCount} TurtleStrategy cache entries`);
            }
        } catch (error) {
            logger.error(`Error cleaning calculation cache: ${error.message}`);
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