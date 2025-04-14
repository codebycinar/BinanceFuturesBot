// AdaptiveStrategy.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const ti = require('technicalindicators');
const config = require('../config/config');
const MultiTimeframeService = require('../services/MultiTimeframeService');
const BinanceService = require('../services/BinanceService');

// Import all strategy types
const BollingerStrategy = require('./BollingerStrategy');
const MomentumStrategy = require('./MomentumStrategy');
const TrendFollowStrategy = require('./TrendFollowStrategy');
const TurtleTradingStrategy = require('./TurtleTradingStrategy');
const ScalpingStrategy = require('./ScalpingStrategy');

// Stratejilerin performansına dayalı seçim için
const PerformanceTracker = require('../services/PerformanceTracker');
const StrategySelector = require('../services/StrategySelector');

class AdaptiveStrategy {
    constructor(binanceService) {
        this.binanceService = binanceService || new BinanceService();
        this.mtfService = new MultiTimeframeService(this.binanceService);
        
        // Performans izleme ve strateji seçimi için
        this.performanceTracker = new PerformanceTracker();
        this.strategySelector = new StrategySelector(this.performanceTracker);
        
        // Initialize different strategies
        this.bollingerStrategy = new BollingerStrategy('BollingerStrategy');
        this.momentumStrategy = new MomentumStrategy();
        this.trendFollowStrategy = new TrendFollowStrategy(); // Güncellenmiş TrendFollowStrategy sınıfı
        this.turtleStrategy = new TurtleTradingStrategy();
        this.scalpingStrategy = new ScalpingStrategy(); // Yeni eklenen 15m scalping stratejisi
        
        // Kullanılabilir tüm stratejileri bir haritada tut
        this.strategies = {
            'BollingerStrategy': this.bollingerStrategy,
            'MomentumStrategy': this.momentumStrategy,
            'TrendFollowStrategy': this.trendFollowStrategy,
            'TurtleTradingStrategy': this.turtleStrategy,
            'ScalpingStrategy': this.scalpingStrategy
        };
        
        // Market conditions tracking
        this.marketConditions = {
            volatility: 'normal',     // low, normal, high
            trend: 'neutral',         // bullish, bearish, neutral
            volume: 'normal',         // low, normal, high
            marketType: 'ranging',    // trending, ranging, choppy
            breakout: false,          // true if price is breaking out of a range
            rangeLength: 0,           // how long the market has been in a range (days)
            trendStrength: 0,         // trend strength (0-100)
            volatilityChange: 'stable' // increasing, decreasing, stable
        };
        
        this.parameters = config.strategy;
        
        // Strategy selection weights - Turtle stratejisine daha yüksek başlangıç değeri
        this.strategyWeights = {
            bollinger: 15,       // Yükseltildi
            momentum: 15,        // Yükseltildi
            trendFollow: 20,     // Yükseltildi
            turtle: 50           // Çok daha yüksek başlangıç değeri
        };
    }
    
    async initialize() {
        // Temel servisleri başlat
        await this.mtfService.initialize();
        await this.performanceTracker.initialize();
        await this.strategySelector.initialize();
        
        // Tüm alt stratejileri başlat
        await this.bollingerStrategy.initialize();
        await this.momentumStrategy.initialize();
        
        try {
            // Check if TrendFollowStrategy has correct methods
            if (typeof this.trendFollowStrategy.initialize === 'function') {
                await this.trendFollowStrategy.initialize();
                if (typeof this.trendFollowStrategy.generateSignal !== 'function') {
                    logger.error('TrendFollowStrategy loaded but missing generateSignal method. Will use fallback strategies.');
                    // Force reload of the strategy
                    delete require.cache[require.resolve('./TrendFollowStrategy')];
                    const TrendFollowStrategy = require('./TrendFollowStrategy');
                    this.trendFollowStrategy = new TrendFollowStrategy();
                    await this.trendFollowStrategy.initialize();
                }
            } else {
                logger.error('TrendFollowStrategy loaded but missing initialize method. Will use fallback strategies.');
            }
        } catch (error) {
            logger.error(`Error initializing TrendFollowStrategy: ${error.message}`);
        }
        
        await this.turtleStrategy.initialize();
        
        try {
            // Yeni eklenen ScalpingStrategy'i başlat
            await this.scalpingStrategy.initialize();
            logger.info('ScalpingStrategy initialized successfully');
        } catch (error) {
            logger.error(`Error initializing ScalpingStrategy: ${error.message}`);
        }
        
        logger.info('Adaptive Strategy initialized with all sub-strategies');
        
        // Strateji durumlarını loglama
        const strategyReport = await this.strategySelector.getStrategyReport();
        logger.info('Current strategy status report:', strategyReport);
        
        try {
            // Veritabanından strateji ağırlıklarını yükle
            const strategy = await Strategy.findOne({ where: { name: 'AdaptiveStrategy' } });
            if (strategy && strategy.parameters && strategy.parameters.strategyWeights) {
                this.strategyWeights = { 
                    ...this.strategyWeights, 
                    ...strategy.parameters.strategyWeights 
                };
                logger.info('Loaded strategy weights from database:', this.strategyWeights);
            }
        } catch (error) {
            logger.error('Error loading strategy weights:', error);
        }
    }
    
    async loadParameters() {
        const strategy = await Strategy.findOne({ where: { name: 'AdaptiveStrategy' } });
        if (strategy) {
            this.parameters = strategy.parameters;
            logger.info('Loaded adaptive strategy parameters from database');
        } else {
            logger.info('Using default adaptive strategy parameters');
        }
    }
    
    async generateSignal(candles, symbol) {
        try {
            // Get multi-timeframe data
            const mtfData = await this.mtfService.getMultiTimeframeData(symbol);
            
            // Analyze market conditions
            await this.analyzeMarketConditions(mtfData, symbol);
            
            // Select the appropriate strategy based on market conditions
            const strategy = await this.selectStrategy(symbol);
            
            // Generate signal using the selected strategy
            const signal = await this.executeStrategy(strategy, mtfData, symbol);
            
            logger.info(`Adaptive Strategy selected ${strategy} for ${symbol} in market conditions: ${JSON.stringify(this.marketConditions)}`);
            
            return signal;
        } catch (error) {
            logger.error(`Error in Adaptive Strategy for ${symbol}: ${error.message}`);
            return { signal: 'NEUTRAL' };
        }
    }
    
    async analyzeMarketConditions(mtfData, symbol) {
        try {
            // 1. Volatility Analysis (using ATR)
            const volatility = await this.analyzeVolatility(mtfData, symbol);
            
            // 2. Trend Analysis (multi-timeframe)
            const trendAnalysis = this.mtfService.analyzeMultiTimeframeTrend(mtfData);
            
            // 3. Volume Analysis (if volume data available)
            const volume = await this.analyzeVolume(symbol);
            
            // 4. Market Type (trending, ranging, or choppy)
            const marketType = await this.determineMarketType(mtfData, volatility, trendAnalysis);
            
            // 5. Breakout Analysis - Özellikle Turtle Trading için önemli
            const breakoutAnalysis = await this.analyzeBreakout(mtfData, symbol);
            
            // 6. Range Length Analysis - Ne kadar süredir fiyat bir aralıkta kalıyor
            const rangeLength = await this.analyzeRangeLength(symbol);
            
            // 7. Volatility Change Analysis - Volatilite artıyor mu, azalıyor mu?
            const volatilityChange = await this.analyzeVolatilityChange(symbol);
            
            // Update market conditions
            this.marketConditions = {
                volatility,
                trend: trendAnalysis.trend,
                trendStrength: trendAnalysis.strength,
                volume,
                marketType,
                breakout: breakoutAnalysis.isBreakout,
                breakoutDirection: breakoutAnalysis.direction,
                rangeLength,
                volatilityChange
            };
            
            // Strateji ağırlıklarını piyasa koşullarına göre güncelle
            this.updateStrategyWeights(this.marketConditions);
            
            logger.info(`Enhanced market conditions for ${symbol}: ${JSON.stringify(this.marketConditions)}`);
            return this.marketConditions;
        } catch (error) {
            logger.error(`Error analyzing market conditions for ${symbol}: ${error.message}`);
            // Default to neutral conditions if we can't analyze
            this.marketConditions = {
                volatility: 'normal',
                trend: 'neutral',
                trendStrength: 0,
                volume: 'normal',
                marketType: 'ranging',
                breakout: false,
                breakoutDirection: 'none',
                rangeLength: 0,
                volatilityChange: 'stable'
            };
            return this.marketConditions;
        }
    }
    
    async analyzeVolatility(mtfData, symbol) {
        try {
            // Use 1h timeframe for volatility measurement
            const hourlyData = mtfData.indicators['1h'];
            if (!hourlyData || !hourlyData.atr) {
                throw new Error('No hourly ATR data available');
            }
            
            const atr = hourlyData.atr;
            
            // Get historical ATR for reference
            const historicalATR = await this.getHistoricalATR(symbol);
            
            // Compare current ATR to historical average
            const currentATR = atr.value;
            const atrRatio = currentATR / historicalATR;
            
            if (atrRatio > 1.5) return 'high';
            if (atrRatio < 0.7) return 'low';
            return 'normal';
        } catch (error) {
            logger.error(`Error analyzing volatility: ${error.message}`);
            return 'normal'; // Default to normal volatility
        }
    }
    
    // Breakout analizi - Turtle Trading stratejisi için
    async analyzeBreakout(mtfData, symbol) {
        try {
            // Daily timeframe için veri, Turtle Trading tipik olarak günlük timeframe kullanır
            const dailyCandles = await this.binanceService.getCandles(symbol, '1d', 40); // 20-günlük donchian için en az 40 gün
            
            if (!dailyCandles || dailyCandles.length < 30) {
                return { isBreakout: false, direction: 'none' };
            }
            
            // Donchian Kanalı hesaplama (20 gün)
            const entryPeriod = 20;
            const highs = dailyCandles.slice(-entryPeriod-1).map(c => parseFloat(c.high));
            const lows = dailyCandles.slice(-entryPeriod-1).map(c => parseFloat(c.low));
            
            // En yüksek ve en düşük değerleri bul (son gün hariç)
            const highest = Math.max(...highs.slice(0, -1));
            const lowest = Math.min(...lows.slice(0, -1));
            
            // Son kapanış fiyatı
            const currentClose = parseFloat(dailyCandles[dailyCandles.length - 1].close);
            const previousClose = parseFloat(dailyCandles[dailyCandles.length - 2].close);
            
            // Kırılma kontrolü
            const upperBreakout = previousClose <= highest && currentClose > highest;
            const lowerBreakout = previousClose >= lowest && currentClose < lowest;
            
            if (upperBreakout) {
                return { isBreakout: true, direction: 'up', level: highest };
            } else if (lowerBreakout) {
                return { isBreakout: true, direction: 'down', level: lowest };
            }
            
            return { isBreakout: false, direction: 'none' };
        } catch (error) {
            logger.error(`Error analyzing breakout for ${symbol}: ${error.message}`);
            return { isBreakout: false, direction: 'none' };
        }
    }
    
    // Fiyatın ne kadar süredir bir aralıkta kaldığını hesapla
    async analyzeRangeLength(symbol) {
        try {
            // Günlük mum verileri
            const dailyCandles = await this.binanceService.getCandles(symbol, '1d', 100);
            
            if (!dailyCandles || dailyCandles.length < 10) {
                return 0;
            }
            
            // Volatilite hesapla (ATR/Ortalama Fiyat)
            const closes = dailyCandles.map(c => parseFloat(c.close));
            const avgPrice = closes.reduce((sum, price) => sum + price, 0) / closes.length;
            
            const atr = this.calculateATRValue(dailyCandles, 14);
            const normalizedATR = atr / avgPrice;
            
            // Düşük volatilite eşiği
            const lowVolThreshold = 0.015; // %1.5 volatilite
            
            // Günlük volatilite değerleri
            const dailyChanges = [];
            for (let i = 1; i < dailyCandles.length; i++) {
                const curr = parseFloat(dailyCandles[i].close);
                const prev = parseFloat(dailyCandles[i-1].close);
                dailyChanges.push(Math.abs(curr - prev) / prev);
            }
            
            // Son x günün kaçı düşük volatiliteli?
            let rangeDays = 0;
            for (let i = dailyChanges.length - 1; i >= 0; i--) {
                if (dailyChanges[i] < lowVolThreshold) {
                    rangeDays++;
                } else {
                    break; // İlk yüksek volatiliteli günde dur
                }
            }
            
            return rangeDays;
        } catch (error) {
            logger.error(`Error analyzing range length for ${symbol}: ${error.message}`);
            return 0;
        }
    }
    
    // Volatilitenin artış/azalış trendini incele
    async analyzeVolatilityChange(symbol) {
        try {
            // Son 30 günlük veri
            const dailyCandles = await this.binanceService.getCandles(symbol, '1d', 30);
            
            if (!dailyCandles || dailyCandles.length < 14) {
                return 'stable';
            }
            
            // 7 günlük ATR'ları hesapla (7 günlük pencere üzerinden, yani 14+7 = 21 gün gerekli)
            const atr7Period1 = this.calculateATRValue(dailyCandles.slice(0, 14), 7);
            const atr7Period2 = this.calculateATRValue(dailyCandles.slice(7, 21), 7);
            const atr7Period3 = this.calculateATRValue(dailyCandles.slice(14), 7);
            
            // Değişim oranları
            const change1 = (atr7Period2 - atr7Period1) / atr7Period1;
            const change2 = (atr7Period3 - atr7Period2) / atr7Period2;
            
            // Trend tespiti
            const threshold = 0.10; // %10 değişim
            
            if (change1 > threshold && change2 > threshold) {
                return 'increasing-fast'; // Hızlı artan
            } else if (change1 < -threshold && change2 < -threshold) {
                return 'decreasing-fast'; // Hızlı azalan
            } else if (change1 > 0 && change2 > 0) {
                return 'increasing'; // Artan
            } else if (change1 < 0 && change2 < 0) {
                return 'decreasing'; // Azalan
            } else {
                return 'stable'; // Stabil
            }
        } catch (error) {
            logger.error(`Error analyzing volatility change for ${symbol}: ${error.message}`);
            return 'stable';
        }
    }
    
    // ATR değeri hesaplama yardımcı fonksiyonu
    calculateATRValue(candles, period) {
        try {
            const trValues = [];
            
            for (let i = 1; i < candles.length; i++) {
                const curr = candles[i];
                const prev = candles[i-1];
                
                const high = parseFloat(curr.high);
                const low = parseFloat(curr.low);
                const prevClose = parseFloat(prev.close);
                
                const tr = Math.max(
                    high - low,
                    Math.abs(high - prevClose),
                    Math.abs(low - prevClose)
                );
                
                trValues.push(tr);
            }
            
            // İlgili period için ATR hesapla
            if (trValues.length < period) {
                return 0;
            }
            
            const sum = trValues.slice(-period).reduce((acc, val) => acc + val, 0);
            return sum / period;
        } catch (error) {
            logger.error('Error calculating ATR value:', error);
            return 0;
        }
    }
    
    async getHistoricalATR(symbol) {
        try {
            // Get long-term candles (1d timeframe)
            const dailyCandles = await this.binanceService.getCandles(symbol, '1d', 30);
            
            // Calculate ATR
            const highs = dailyCandles.map(c => parseFloat(c.high));
            const lows = dailyCandles.map(c => parseFloat(c.low));
            const closes = dailyCandles.map(c => parseFloat(c.close));
            
            const atr = ti.ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            });
            
            // Return average of ATR values
            return atr.reduce((sum, val) => sum + val, 0) / atr.length;
        } catch (error) {
            logger.error(`Error getting historical ATR: ${error.message}`);
            return 1; // Default value if calculation fails
        }
    }
    
    async analyzeVolume(symbol) {
        try {
            // Get volume data for the past few days
            const dailyCandles = await this.binanceService.getCandles(symbol, '1d', 10);
            
            // Extract volume data
            const volumes = dailyCandles.map(c => parseFloat(c.volume));
            
            // Calculate average volume
            const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (volumes.length - 1);
            
            // Compare current volume to average
            const currentVolume = volumes[volumes.length - 1];
            const volumeRatio = currentVolume / avgVolume;
            
            if (volumeRatio > 1.5) return 'high';
            if (volumeRatio < 0.7) return 'low';
            return 'normal';
        } catch (error) {
            logger.error(`Error analyzing volume: ${error.message}`);
            return 'normal'; // Default to normal volume
        }
    }
    
    async determineMarketType(mtfData, volatility, trendAnalysis) {
        try {
            // Check for strong trend
            if (trendAnalysis.strength > 70 && volatility !== 'low') {
                return 'trending';
            }
            
            // Check for choppy market
            if (volatility === 'high' && trendAnalysis.strength < 40) {
                return 'choppy';
            }
            
            // Check for sideways/ranging market
            const hourlyData = mtfData.indicators['1h'];
            if (hourlyData && hourlyData.bollinger) {
                const bbWidth = hourlyData.bollinger.width;
                
                // Narrow Bollinger band width indicates ranging
                if (bbWidth < 0.03 && volatility === 'low') {
                    return 'ranging';
                }
            }
            
            // Default case - check based on ADX
            if (hourlyData && hourlyData.adx) {
                const adxValue = hourlyData.adx.adx;
                
                if (adxValue > 25) return 'trending';
                if (adxValue < 15) return 'ranging';
                return 'choppy';
            }
            
            return 'ranging'; // Default if we can't determine
        } catch (error) {
            logger.error(`Error determining market type: ${error.message}`);
            return 'ranging'; // Default to ranging market
        }
    }
    
    // Piyasa koşullarına göre strateji ağırlıklarını güncelle
    updateStrategyWeights(conditions) {
        // Başlangıçta makul varsayılan ağırlıklar belirle - Turtle stratejisine önemli ölçüde yüksek değer
        const weights = {
            bollinger: 15,   // Daha düşük varsayılan değer
            momentum: 15,    // Daha düşük varsayılan değer
            trendFollow: 20, // Daha düşük varsayılan değer
            turtle: 50       // Turtle stratejisi için çok daha yüksek varsayılan değer
        };
        
        // 1. Bollinger Strateji Ağırlığı Güncelleme (range'ler için iyi)
        if (conditions.marketType === 'ranging') {
            weights.bollinger += 25;
            
            // Range uzunluğu arttıkça bollinger stratejisinin ağırlığı artar
            if (conditions.rangeLength > 5) {
                weights.bollinger += 10;
            }
            if (conditions.rangeLength > 10) {
                weights.bollinger += 10;
            }
        } else {
            weights.bollinger -= 5;  // Daha az ceza uygula
        }
        
        // 2. Momentum Strateji Ağırlığı Güncelleme (yüksek volatilite için iyi)
        if (conditions.volatility === 'high') {
            weights.momentum += 20;
            
            // Volatilite artıyorsa, momentum stratejisi daha da etkili olabilir
            if (conditions.volatilityChange === 'increasing' || 
                conditions.volatilityChange === 'increasing-fast') {
                weights.momentum += 15;
            }
        } else {
            weights.momentum -= 5;  // Daha az ceza uygula
        }
        
        // 3. Trend Takip Stratejisi Ağırlığı Güncelleme
        if (conditions.marketType === 'trending' && conditions.trendStrength > 50) {
            weights.trendFollow += 25;
            
            // Trend kuvvetli ise daha da fazla ağırlık ver
            if (conditions.trendStrength > 70) {
                weights.trendFollow += 15;
            }
        } else {
            weights.trendFollow -= 5;  // Daha az ceza uygula
        }
        
        // 4. Turtle Trading Stratejisi Ağırlığı Güncelleme (breakout'lar için ideal)
        if (conditions.breakout) {
            weights.turtle += 40; // Breakout durumunda turtle stratejisine yüksek öncelik ver
            
            // Volatilite artış eğilimindeyse kırılma daha olası
            if (conditions.volatilityChange === 'increasing' || 
                conditions.volatilityChange === 'increasing-fast') {
                weights.turtle += 10;
            }
        } else if (conditions.rangeLength > 10) {
            // Uzun süren range sonrası kırılma olasılığı yüksek
            weights.turtle += 15;
        } else {
            // Turtle stratejisi için daha az ceza uygula, minimum değer korunsun
            weights.turtle -= 3;  
        }
        
        // Türkiye ve gelişmekte olan piyasalar için de Turtle iyi olabilir
        if (conditions.volume === 'high') {
            weights.turtle += 15;
        }
        
        // Nötr piyasa koşullarında Bollinger stratejisi biraz daha ağırlık kazansın
        if (conditions.trend === 'neutral' && conditions.volatility === 'normal') {
            weights.bollinger += 10;
        }
        
        // Hafif trend varlığında trendFollow biraz artsın
        if (conditions.trendStrength > 30 && conditions.trendStrength <= 50) {
            weights.trendFollow += 10;
        }
        
        // Hesaplanan ağırlıkları sınırla (min 5, max 100) - minimum 5 olarak ayarlıyoruz ki hiçbir strateji sıfırlanmasın
        Object.keys(weights).forEach(key => {
            weights[key] = Math.max(5, Math.min(100, weights[key]));
        });
        
        this.strategyWeights = weights;
        logger.info(`Updated strategy weights: ${JSON.stringify(weights)}`);
    }

    async selectStrategy(symbol) {
        // Piyasa koşullarını al
        const { volatility, trend, marketType, trendStrength, breakout } = this.marketConditions;
        
        // Performans verilerine dayalı olarak devre dışı bırakılmış stratejileri kontrol et
        // Strateji adını timeframe haritasından gerçek strateji adına çeviren yardımcı fonksiyon
        const strategyNameMap = {
            'bollinger': 'BollingerStrategy',
            'momentum': 'MomentumStrategy',
            'trendFollow': 'TrendFollowStrategy',
            'turtle': 'TurtleTradingStrategy',
            'scalping': 'ScalpingStrategy'
        };
        
        // Seçilebilir strateji listesini oluştur (devre dışı bırakılmamış stratejilerden)
        const availableStrategies = {};
        for (const [key, value] of Object.entries(this.strategyWeights)) {
            const strategyFullName = strategyNameMap[key];
            if (await this.strategySelector.isStrategyEnabled(strategyFullName)) {
                availableStrategies[key] = value;
            } else {
                logger.warn(`Strategy ${strategyFullName} is disabled due to poor performance and won't be selected`);
            }
        }
        
        // Hiçbir strateji kullanılabilir değilse, varsayılan olarak turtle kullan
        if (Object.keys(availableStrategies).length === 0) {
            logger.warn('No profitable strategies available, using TurtleTradingStrategy as default');
            return 'turtle';
        }
        
        // Direkt kural tabanlı seçim (öncelikli durumlar) - ama sadece kullanılabilir stratejiler arasından
        
        // 1. Kırılma durumunda Turtle Trading (Bu koşul en yüksek öncelikli)
        if (breakout && availableStrategies['turtle']) {
            logger.info('Strategy Selection: Turtle Trading selected due to price breakout');
            return 'turtle';
        }
        
        // 2. Yüksek hacim durumunda da Turtle (kripto paraların ani hareketlerini yakalamak için)
        if (this.marketConditions.volume === 'high' && volatility !== 'low' && availableStrategies['turtle']) {
            logger.info('Strategy Selection: Turtle Trading selected due to high volume');
            return 'turtle';
        }
        
        // 3. Uzun süreli bir range'den sonra Turtle (kırılma olasılığı için)
        if (this.marketConditions.rangeLength > 14 && availableStrategies['turtle']) {
            logger.info('Strategy Selection: Turtle Trading selected due to potential breakout after long range');
            return 'turtle'; 
        }
        
        // 4. Volatilite artış eğilimi Turtle için uygun (kırılma hazırlığı)
        if ((this.marketConditions.volatilityChange === 'increasing-fast' || 
            this.marketConditions.volatilityChange === 'increasing') && availableStrategies['turtle']) {
            logger.info('Strategy Selection: Turtle Trading selected due to increasing volatility');
            return 'turtle';
        }
        
        // 5. Güçlü trend varsa Trend Takip
        if (marketType === 'trending' && trendStrength > 75 && availableStrategies['trendFollow']) {
            logger.info('Strategy Selection: Trend Follow selected due to strong trend');
            return 'trendFollow';
        }
        
        // 6. Kesin yatay piyasa Bollinger
        if (marketType === 'ranging' && this.marketConditions.rangeLength > 12 && availableStrategies['bollinger']) {
            logger.info('Strategy Selection: Bollinger selected due to established range market');
            return 'bollinger';
        }
        
        // 7. Çok yüksek volatilite momentum
        if (volatility === 'high' && 
            this.marketConditions.volatilityChange === 'increasing-fast' && availableStrategies['momentum']) {
            logger.info('Strategy Selection: Momentum selected due to rapidly increasing volatility');
            return 'momentum';
        }
        
        // 8. 15 dakikalık scalping stratejisi önceliği
        if (availableStrategies['scalping']) {
            // Kısa timeframe için genelde scalping stratejisini tercih et
            const randomVal = Math.random(); // 0-1 arası rastgele değer
            
            // Rastgele %60 ihtimalle scalping stratejisini seç
            if (randomVal < 0.6) {
                logger.info('Strategy Selection: Scalping (15m) selected for short-term trading');
                return 'scalping';
            }
        }
        
        // Ağırlık tabanlı istatistiksel seçim - sadece kullanılabilir stratejiler arasından
        // En yüksek ağırlığa sahip stratejiyi seç
        let highestWeight = 0;
        let secondHighestWeight = 0;
        let selectedStrategy = null;
        let secondStrategy = '';
        
        Object.entries(availableStrategies).forEach(([strategy, weight]) => {
            if (weight > highestWeight) {
                secondHighestWeight = highestWeight;
                secondStrategy = selectedStrategy;
                highestWeight = weight;
                selectedStrategy = strategy;
            } else if (weight > secondHighestWeight) {
                secondHighestWeight = weight;
                secondStrategy = strategy;
            }
        });
        
        // selectedStrategy null olamaz, çünkü en az bir strateji kullanılabilir olmalı
        
        // Eğer en yüksek ağırlıklı 2 strateji arasındaki fark az ise ve ikinci strateji Turtle ise, Turtle'ı seç
        if (highestWeight - secondHighestWeight < 10 && secondStrategy === 'turtle' && availableStrategies['turtle']) {
            selectedStrategy = 'turtle';
            logger.info(`Strategy Selection: Turtle chosen due to close weight with ${secondHighestWeight} vs ${highestWeight}`);
        }
        
        logger.info(`Strategy Selection for ${symbol}: Selected ${selectedStrategy} with weight ${highestWeight} based on market conditions`);
        logger.info(`Available strategy weights: ${JSON.stringify(availableStrategies)}`);
        return selectedStrategy;
    }
    
    async executeStrategy(strategyName, mtfData, symbol) {
        try {
            // Strateji için uygun timeframe seçimi
            let candles;
            const timeframes = mtfData.candles;
            
            // Her strateji için ideal timeframe seçimi - daha uzun zaman dilimlerini tercih ediyoruz
            switch (strategyName) {
                case 'turtle':
                    // Turtle Trading için günlük chart 
                    candles = await this.binanceService.getCandles(symbol, '1d', 60); // Donchian kanalları için daha fazla günlük veri
                    logger.info(`Using 1d timeframe for Turtle Trading Strategy (${symbol})`);
                    break;
                    
                case 'trendFollow':
                    // Trend stratejisi için 4h-1d timeframe
                    candles = timeframes['1d'] || timeframes['4h'] || timeframes['1h'];
                    logger.info(`Using ${candles === timeframes['1d'] ? '1d' : candles === timeframes['4h'] ? '4h' : '1h'} timeframe for Trend Follow Strategy (${symbol})`);
                    break;
                    
                case 'momentum':
                    // Momentum stratejisi için 1h veya 4h - 15m'den çıkartılıp 4h eklendi
                    candles = timeframes['4h'] || timeframes['1h'];
                    logger.info(`Using ${candles === timeframes['4h'] ? '4h' : '1h'} timeframe for Momentum Strategy (${symbol})`);
                    break;
                    
                case 'bollinger':
                default:
                    // Bollinger Bands için 4h veya 1h 
                    candles = timeframes['4h'] || timeframes['1h'];
                    logger.info(`Using ${candles === timeframes['4h'] ? '4h' : '1h'} timeframe for Bollinger Strategy (${symbol})`);
                    break;
            }
            
            if (!candles || candles.length === 0) {
                logger.warn(`No candles available for ${strategyName} strategy on ${symbol}`);
                candles = timeframes['1h']; // Fallback to hourly
            }
            
            // Seçilen stratejiyi çalıştır
            let result;
            switch (strategyName) {
                case 'bollinger':
                    result = await this.bollingerStrategy.generateSignal(candles, symbol);
                    break;
                
                case 'momentum':
                    result = await this.momentumStrategy.generateSignal(candles, symbol);
                    break;
                
                case 'trendFollow':
                    try {
                        if (!this.trendFollowStrategy.generateSignal) {
                            logger.warn(`TrendFollowStrategy does not have generateSignal method for ${symbol}. Using fallback.`);
                            // Fallback to safer strategy if the method doesn't exist
                            result = await this.bollingerStrategy.generateSignal(candles, symbol);
                            strategyName = 'bollinger'; // Change the strategy name for reporting
                        } else {
                            result = await this.trendFollowStrategy.generateSignal(candles, symbol);
                        }
                    } catch (e) {
                        logger.error(`Error with TrendFollowStrategy for ${symbol}: ${e.message}`);
                        // Fallback to safer strategy
                        result = await this.bollingerStrategy.generateSignal(candles, symbol);
                        strategyName = 'bollinger'; // Change the strategy name for reporting
                    }
                    break;
                    
                case 'turtle':
                    result = await this.turtleStrategy.generateSignal(candles, symbol);
                    break;
                
                default:
                    result = await this.bollingerStrategy.generateSignal(candles, symbol);
                    break;
            }
            
            // Strateji adını ekle
            return { ...result, strategyUsed: strategyName };
            
        } catch (error) {
            logger.error(`Error executing strategy ${strategyName} for ${symbol}: ${error.message}`);
            return { signal: 'NEUTRAL' };
        }
    }
    
    // Indicator calculation methods can be added here if needed
}

module.exports = AdaptiveStrategy;