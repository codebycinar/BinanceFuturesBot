/**
 * HybridOnchainStrategy.js
 * 
 * Teknik analiz ve onchain metrikleri birleştiren hibrit trading stratejisi.
 * Turtle Trading stratejisini temel alarak, onchain veri akışını da 
 * değerlendirir ve daha güçlü sinyaller üretir.
 */
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;
const config = require('../config/config');
const ti = require('technicalindicators');
const TurtleTradingStrategy = require('./TurtleTradingStrategy');
const OnchainMetricsService = require('../services/OnchainMetricsService');

class HybridOnchainStrategy {
    constructor() {
        // Turtle Trading stratejisini temel olarak kullan
        this.turtleStrategy = new TurtleTradingStrategy();
        
        // Onchain metrikler servisi
        this.onchainService = new OnchainMetricsService();
        
        // Varsayılan parametreler
        this.parameters = {
            // Temel Turtle parametreleri
            entryChannel: 20,      // Donchian giriş kanalı (20 periyot)
            exitChannel: 10,       // Donchian çıkış kanalı (10 periyot)
            atrPeriod: 14,         // ATR periyodu
            timeframe: '4h',       // Ana zaman dilimi
            
            // Onchain metrik parametreleri
            enableOnchainMetrics: true,    // Onchain metrikleri etkinleştir
            onchainConfidenceThreshold: 0.6, // Minimum güven seviyesi
            onchainSignalWeight: 0.4,      // Onchain sinyaller için ağırlık (0-1)
            technicalSignalWeight: 0.6,    // Teknik analiz sinyalleri için ağırlık (0-1)
            
            // Onchain metrik ağırlıkları
            metricWeights: {
                netFlow: 0.3,           // Borsaya giren/çıkan para
                whaleTransactions: 0.2,  // Büyük işlemler
                mvrvZScore: 0.25,       // MVRV Z-Score
                nvtRatio: 0.1,          // NVT Ratio
                sopr: 0.15              // SOPR
            },
            
            // Pozisyon boyutlandırma
            maxAllocation: 30,         // Maksimum pozisyon boyutu (USDT)
            baseAllocation: 20,        // Temel pozisyon boyutu (USDT)
            maxEntries: 3,             // Maksimum pozisyon girişi
            
            // Risk yönetimi
            atrMultiplier: 2.5,        // Stop loss için ATR çarpanı
            profitMultiplier: 3,       // Take profit için çarpan
            useBreakEven: true,        // Break-even kullan
            breakEvenActivationPercent: 0.8 // Break-even aktivasyon yüzdesi
        };
        
        // Konfigürasyonda hibrit strateji ayarları varsa, bunları kullan
        if (config.hybridStrategy) {
            this.parameters = { ...this.parameters, ...config.hybridStrategy };
        }
        
        // Tercih edilen zaman dilimi
        this.preferredTimeframe = this.parameters.timeframe || '4h';
        
        // Pozisyon belleği
        this.positionMemory = {};
        
        logger.info('HybridOnchainStrategy initialized with parameters:', this.parameters);
    }
    
    async initialize() {
        try {
            // Turtle stratejisini başlat
            await this.turtleStrategy.initialize();
            
            // Önce konfigürasyon dosyasından parametreleri al
            if (config.hybridStrategy) {
                this.parameters = { ...this.parameters, ...config.hybridStrategy };
                logger.info('Loaded HybridOnchainStrategy parameters from config file');
            }
            
            // Test modunda veritabanına erişmeye çalışma
            if (process.env.NODE_ENV === 'test') {
                logger.info('Running in test mode, skipping database operations');
                return;
            }
            
            // Veritabanında strateji var mı kontrol et
            try {
                const strategy = await Strategy.findOne({ where: { name: 'HybridOnchainStrategy' } });
                if (strategy && strategy.parameters) {
                    this.parameters = { ...this.parameters, ...strategy.parameters };
                    logger.info('Loaded HybridOnchainStrategy parameters from database');
                } else {
                    // Veritabanında yoksa, şu anki parametreleri kaydet
                    try {
                        await Strategy.create({
                            name: 'HybridOnchainStrategy',
                            parameters: this.parameters,
                            isActive: true
                        });
                        logger.info('Created new HybridOnchainStrategy record in database');
                    } catch (dbError) {
                        logger.warn('Could not create strategy record in database:', dbError.message);
                    }
                }
            } catch (dbError) {
                logger.warn('Database error when accessing strategies:', dbError.message);
            }
            
            logger.info('HybridOnchainStrategy successfully initialized');
        } catch (error) {
            logger.error('Error initializing HybridOnchainStrategy:', error);
        }
    }
    
    /**
     * Teknik analiz ve onchain metrikleri birleştirerek sinyal üretir
     * @param {Array} candles - Mum verileri
     * @param {string} symbol - İşlem sembolü
     * @returns {Object} - Sinyal bilgileri
     */
    async generateSignal(candles, symbol) {
        try {
            // 1. Turtle Trading stratejisinden teknik analiz sinyali al
            const technicalSignal = await this.turtleStrategy.generateSignal(candles, symbol);
            
            // Eğer onchain metrikler devre dışıysa, sadece teknik sinyali döndür
            if (!this.parameters.enableOnchainMetrics) {
                return technicalSignal;
            }
            
            // 2. Onchain metriklerden akıllı para sinyali al
            const onchainSignal = await this.onchainService.getSmartMoneySignal(symbol);
            
            // 3. İki sinyali birleştir
            return this.combineSignals(technicalSignal, onchainSignal, symbol, candles);
        } catch (error) {
            logger.error(`Error generating hybrid signal for ${symbol}:`, error);
            // Hata durumunda en azından teknik sinyali döndürmeye çalış
            try {
                return await this.turtleStrategy.generateSignal(candles, symbol);
            } catch (fallbackError) {
                logger.error(`Fallback signal generation failed for ${symbol}:`, fallbackError);
                return { signal: 'NEUTRAL', unmetConditions: ['Error in signal generation'] };
            }
        }
    }
    
    /**
     * Teknik analiz ve onchain sinyallerini birleştirir
     * @param {Object} technicalSignal - Teknik analiz sinyali
     * @param {Object} onchainSignal - Onchain sinyal
     * @param {string} symbol - İşlem sembolü
     * @param {Array} candles - Mum verileri
     * @returns {Object} - Birleştirilmiş sinyal
     */
    combineSignals(technicalSignal, onchainSignal, symbol, candles) {
        try {
            // Teknik sinyalin değerini sayısallaştır (-1 ile +1 arasında)
            let technicalValue = 0;
            
            switch (technicalSignal.signal) {
                case 'BUY':
                    technicalValue = 1;
                    break;
                case 'WEAK_BUY':
                    technicalValue = 0.5;
                    break;
                case 'SELL':
                    technicalValue = -1;
                    break;
                case 'WEAK_SELL':
                    technicalValue = -0.5;
                    break;
                case 'ADD_BUY':
                    technicalValue = 0.7;
                    break;
                case 'ADD_SELL':
                    technicalValue = -0.7;
                    break;
                case 'EXIT_BUY':
                    technicalValue = -0.8;
                    break;
                case 'EXIT_SELL':
                    technicalValue = 0.8;
                    break;
            }
            
            // Onchain sinyali sayısallaştır (-1 ile +1 arasında)
            let onchainValue = 0;
            
            if (onchainSignal.signal === 'BUY') {
                onchainValue = onchainSignal.confidence; // 0 ile 1 arasında
            } else if (onchainSignal.signal === 'SELL') {
                onchainValue = -onchainSignal.confidence; // 0 ile -1 arasında
            }
            
            // İki sinyalin ağırlıklı ortalamasını hesapla
            const combinedValue = (
                technicalValue * this.parameters.technicalSignalWeight +
                onchainValue * this.parameters.onchainSignalWeight
            );
            
            // Karşılıklı sinyalleri loglama
            logger.info(`Hybrid signal components for ${symbol}: Technical=${technicalValue.toFixed(2)} (${technicalSignal.signal}), Onchain=${onchainValue.toFixed(2)} (${onchainSignal.signal}), Combined=${combinedValue.toFixed(2)}`);
            
            // Kombine değerden yeni sinyal oluştur
            let newSignal = 'NEUTRAL';
            let unmetConditions = [];
            
            // Signal thresholds adjusted to generate more strong signals
            if (combinedValue >= 0.6) { // Lowered from 0.8
                newSignal = 'BUY';
            } else if (combinedValue >= 0.3) { // Lowered from 0.4
                newSignal = 'WEAK_BUY';
                unmetConditions.push('Combined signal strength below threshold');
            } else if (combinedValue <= -0.6) { // Raised from -0.8
                newSignal = 'SELL';
            } else if (combinedValue <= -0.3) { // Raised from -0.4
                newSignal = 'WEAK_SELL';
                unmetConditions.push('Combined signal strength below threshold');
            } else if (technicalSignal.signal === 'ADD_BUY' && combinedValue > 0) {
                newSignal = 'ADD_BUY';
            } else if (technicalSignal.signal === 'ADD_SELL' && combinedValue < 0) {
                newSignal = 'ADD_SELL';
            } else if (technicalSignal.signal === 'EXIT_BUY' || technicalSignal.signal === 'EXIT_SELL') {
                newSignal = technicalSignal.signal; // Çıkış sinyallerini koru
            }
            
            // If technical signal is strong (BUY/SELL), consider keeping it even with mixed onchain signals
            if ((technicalSignal.signal === 'BUY' || technicalSignal.signal === 'SELL') && 
                newSignal.includes('WEAK') && Math.abs(technicalValue) > 0.8) {
                // Use the technical signal if it's very strong, even if onchain data is mixed
                newSignal = technicalSignal.signal;
                logger.info(`Using strong technical signal ${technicalSignal.signal} despite mixed onchain metrics`);
                unmetConditions.push('Using technical signal despite mixed onchain data');
            }
            
            // Birleştirilmiş sinyal için açıklama
            if (technicalSignal.signal !== newSignal) {
                if ((technicalSignal.signal === 'BUY' || technicalSignal.signal === 'WEAK_BUY') && newSignal === 'NEUTRAL') {
                    unmetConditions.push('Onchain metrics do not confirm buy signal');
                } else if ((technicalSignal.signal === 'SELL' || technicalSignal.signal === 'WEAK_SELL') && newSignal === 'NEUTRAL') {
                    unmetConditions.push('Onchain metrics do not confirm sell signal');
                } else if (newSignal === 'BUY' && technicalSignal.signal !== 'BUY') {
                    unmetConditions.push('Upgraded to BUY based on strong onchain metrics');
                } else if (newSignal === 'SELL' && technicalSignal.signal !== 'SELL') {
                    unmetConditions.push('Upgraded to SELL based on strong onchain metrics');
                }
            }
            
            // Orijinal teknik sinyalin unmetConditions'ını ekle
            if (technicalSignal.unmetConditions) {
                unmetConditions = [...unmetConditions, ...technicalSignal.unmetConditions];
            }
            
            // Onchain metriklerin güven seviyesini ve sinyalini açıkla
            unmetConditions.push(`Onchain metrics: ${onchainSignal.signal} (confidence: ${onchainSignal.confidence.toFixed(2)})`);
            
            // Pozisyon boyutunu ayarla (onchain metriklerin gücüne göre)
            let allocation = technicalSignal.allocation || this.parameters.baseAllocation;
            
            // Güçlü onchain uyum varsa pozisyon boyutunu artır
            if ((technicalValue > 0 && onchainValue > 0.6) || (technicalValue < 0 && onchainValue < -0.6)) {
                allocation *= 1.2; // %20 artış
                logger.info(`Increased position size by 20% due to strong onchain confirmation for ${symbol}`);
            } 
            // Zayıf onchain uyum varsa pozisyon boyutunu azalt
            else if ((technicalValue > 0 && onchainValue < -0.3) || (technicalValue < 0 && onchainValue > 0.3)) {
                allocation *= 0.7; // %30 azalış
                logger.info(`Decreased position size by 30% due to contradicting onchain metrics for ${symbol}`);
            }
            
            // Maksimum pozisyon boyutunu aşmamasını sağla
            if (allocation > this.parameters.maxAllocation) {
                allocation = this.parameters.maxAllocation;
                logger.info(`Capped position size at ${this.parameters.maxAllocation} USDT for ${symbol}`);
            }
            
            // Stop loss ve take profit değerlerini koru
            const stopLoss = technicalSignal.stopLoss;
            const takeProfit = technicalSignal.takeProfit;
            
            // Yeni hibrit sinyal nesnesi oluştur
            const hybridSignal = {
                signal: newSignal,
                stopLoss,
                takeProfit,
                allocation,
                unmetConditions,
                
                // Hibrit strateji ekstra alanları
                technicalSignal: technicalSignal.signal,
                onchainSignal: onchainSignal.signal,
                onchainConfidence: onchainSignal.confidence,
                onchainMetrics: onchainSignal.metrics,
                onchainScores: onchainSignal.scores,
                combinedValue,
                
                // Orijinal ekstra alanları koru
                positionAddition: technicalSignal.positionAddition,
                exitPosition: technicalSignal.exitPosition,
                indicators: technicalSignal.indicators
            };
            
            logger.info(`Generated hybrid signal for ${symbol}: ${newSignal} (technical: ${technicalSignal.signal}, onchain: ${onchainSignal.signal})`);
            return hybridSignal;
        } catch (error) {
            logger.error(`Error combining signals for ${symbol}:`, error);
            // Hata durumunda orijinal teknik sinyali döndür
            return technicalSignal;
        }
    }
    
    /**
     * Piyasa koşullarını analiz eder
     * @param {Object} mtfData - Çoklu zaman dilimi verileri
     * @param {string} symbol - İşlem sembolü
     * @returns {Object} - Piyasa koşulları analizi
     */
    async analyzeMarketConditions(mtfData, symbol) {
        try {
            // Temel teknik analizi al
            const technicalAnalysis = await this.turtleStrategy.analyzeMarketConditions(mtfData, symbol);
            
            // Onchain metrikler devre dışıysa, sadece teknik analizi döndür
            if (!this.parameters.enableOnchainMetrics) {
                return technicalAnalysis;
            }
            
            // Onchain metriklerden akıllı para sinyalini al
            const onchainSignal = await this.onchainService.getSmartMoneySignal(symbol);
            
            // İki analizi birleştir
            return {
                ...technicalAnalysis,
                onchainTrend: onchainSignal.signal,
                onchainConfidence: onchainSignal.confidence,
                onchainMetrics: onchainSignal.metrics,
                riskScore: this.calculateRiskScore(technicalAnalysis, onchainSignal)
            };
        } catch (error) {
            logger.error(`Error analyzing market conditions for ${symbol}:`, error);
            // Hata durumunda teknik analizi döndürmeye çalış
            try {
                return await this.turtleStrategy.analyzeMarketConditions(mtfData, symbol);
            } catch (fallbackError) {
                logger.error(`Fallback market analysis failed for ${symbol}:`, fallbackError);
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
    
    /**
     * Teknik analiz ve onchain metriklerden bir risk skoru hesaplar
     * @param {Object} technicalAnalysis - Teknik analiz
     * @param {Object} onchainSignal - Onchain sinyal
     * @returns {number} - Risk skoru (0-100)
     */
    calculateRiskScore(technicalAnalysis, onchainSignal) {
        try {
            // Teknik analizden risk faktörleri
            const volatilityRisk = technicalAnalysis.volatility === 'HIGH' ? 80 : 
                                    technicalAnalysis.volatility === 'MEDIUM' ? 50 : 30;
            
            const trendRisk = technicalAnalysis.trend === 'NEUTRAL' ? 50 : 
                              technicalAnalysis.trendStrength;
            
            // Onchain metriklerden risk faktörleri
            let onchainRisk = 50; // Nötr başla
            
            if (onchainSignal.signal === 'BUY') {
                onchainRisk = 50 - (onchainSignal.confidence * 40); // 10-50 arasında (düşük risk)
            } else if (onchainSignal.signal === 'SELL') {
                onchainRisk = 50 + (onchainSignal.confidence * 40); // 50-90 arasında (yüksek risk)
            }
            
            // MVRV Z-Score risk faktörü
            let mvrvRisk = 50;
            if (onchainSignal.metrics.mvrvZScore !== null) {
                // MVRV Z-Score yüksekse risk yüksek, düşükse risk düşük
                mvrvRisk = 50 + (onchainSignal.metrics.mvrvZScore * 10);
                mvrvRisk = Math.max(10, Math.min(90, mvrvRisk));
            }
            
            // Ağırlıklı risk skoru hesapla
            const riskScore = (
                volatilityRisk * 0.3 +
                trendRisk * 0.2 +
                onchainRisk * 0.3 +
                mvrvRisk * 0.2
            );
            
            return Math.round(riskScore);
        } catch (error) {
            logger.error('Error calculating risk score:', error);
            return 50; // Hata durumunda orta risk döndür
        }
    }
    
    // Açık pozisyonları ve diğer yardımcı metodları Turtle'dan devral
    async checkExistingPositions(symbol) {
        return this.turtleStrategy.checkExistingPositions(symbol);
    }
    
    async canAddNewPosition(symbol, direction) {
        return this.turtleStrategy.canAddNewPosition(symbol, direction);
    }
    
    async canEnterNewTimeframe(symbol) {
        return this.turtleStrategy.canEnterNewTimeframe(symbol);
    }
}

module.exports = HybridOnchainStrategy;