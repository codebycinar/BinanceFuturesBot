// StrategyManager.js
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Tüm stratejileri yönetir ve dinamik olarak yükler
 */
class StrategyManager {
    constructor() {
        // Yüklenen stratejileri saklamak için
        this.strategies = {};
        
        // Aktif stratejilerin listesi
        this.activeStrategies = [];
        
        // Geçerli stratejilerin listesi (yapılandırmada etkinleştirilmiş olanlar)
        this.validStrategies = config.enabledStrategies || [
            'TurtleTradingStrategy',
            'AdaptiveStrategy',
            'HybridOnchainStrategy',
            'MomentumStrategy',
            'SupportResistanceStrategy'
        ];
    }
    
    /**
     * Tüm stratejileri yükler ve başlatır
     */
    async initialize() {
        try {
            // Strategies dizinindeki tüm .js dosyalarını bul
            const strategiesDir = path.join(__dirname, '../strategies');
            const files = fs.readdirSync(strategiesDir);
            
            logger.info(`Found ${files.length} strategy files`);
            
            // Yüklenen ve başlatılan stratejileri takip et
            let loadedCount = 0;
            let initializedCount = 0;
            
            // Her .js dosyasını modül olarak yükle
            for (const file of files) {
                if (file.endsWith('.js')) {
                    const strategyName = file.replace('.js', '');
                    
                    // Yalnızca geçerli (whitelist'deki) stratejileri yükle
                    if (!this.validStrategies.includes(strategyName)) {
                        logger.info(`Skipping strategy ${strategyName} (not in enabled list)`);
                        continue;
                    }
                    
                    try {
                        // Strateji modülünü dinamik olarak yükle
                        const StrategyClass = require(`../strategies/${strategyName}`);
                        
                        // Strateji örneğini oluştur
                        const strategyInstance = new StrategyClass();
                        
                        // generateSignal metodunu kontrol et - multi-strateji sisteminde gerekli
                        if (typeof strategyInstance.generateSignal !== 'function') {
                            logger.error(`Strategy ${strategyName} does not have the required generateSignal method. Skipping.`);
                            continue;
                        }
                        
                        // Strateji nesnesini sakla
                        this.strategies[strategyName] = strategyInstance;
                        
                        loadedCount++;
                        logger.info(`Loaded strategy: ${strategyName}`);
                        
                        // Stratejiyi başlat (initialize metodu varsa)
                        if (typeof strategyInstance.initialize === 'function') {
                            try {
                                await strategyInstance.initialize();
                                initializedCount++;
                                
                                // Başarıyla başlatılan stratejileri aktif olarak işaretle
                                this.activeStrategies.push(strategyName);
                                logger.info(`Initialized strategy: ${strategyName}`);
                            } catch (initError) {
                                logger.error(`Error initializing strategy ${strategyName}: ${initError.message}`);
                                // İnitialize başarısız olsa bile stratejiyi etkinleştir
                                // Ancak durumu logla
                                logger.warn(`Adding ${strategyName} to active strategies despite initialization failure`);
                                this.activeStrategies.push(strategyName);
                            }
                        } else {
                            logger.warn(`Strategy ${strategyName} does not have an initialize method. Adding to active strategies anyway.`);
                            this.activeStrategies.push(strategyName);
                        }
                    } catch (error) {
                        logger.error(`Error loading or initializing strategy ${strategyName}: ${error.message}`);
                    }
                }
            }
            
            logger.info(`Strategy Manager initialized with ${loadedCount} strategies loaded and ${initializedCount} strategies initialized`);
            logger.info(`Active strategies: ${this.activeStrategies.join(', ')}`);
            
            return true;
        } catch (error) {
            logger.error(`Error initializing Strategy Manager: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Belirli bir stratejiyi döndürür
     * @param {string} strategyName - Strateji adı
     * @returns {Object} - Strateji nesnesi
     */
    getStrategy(strategyName) {
        return this.strategies[strategyName];
    }
    
    /**
     * Tüm aktif stratejileri döndürür
     * @returns {Array} - Aktif strateji nesnelerinin listesi
     */
    getAllActiveStrategies() {
        return this.activeStrategies.map(name => this.strategies[name]);
    }
    
    /**
     * Belirli sembol için tüm aktif stratejilerde sinyal üretir
     * @param {string} symbol - İşlem sembolü
     * @param {Array} candles - Mum verileri
     * @param {Object} mtfData - Çoklu zaman dilimi verileri
     * @returns {Array} - Üretilen sinyallerin listesi
     */
    async generateSignalsForAllStrategies(symbol, candles, mtfData) {
        const signals = [];
        
        for (const strategyName of this.activeStrategies) {
            try {
                const strategy = this.strategies[strategyName];
                
                // Strateji için zaman dilimini belirle
                const timeframe = strategy.preferredTimeframe || '1h';
                const strategyCandles = mtfData?.candles?.[timeframe] || candles;
                
                if (!strategyCandles || strategyCandles.length === 0) {
                    logger.warn(`No candles available for ${symbol} with timeframe ${timeframe} for strategy ${strategyName}`);
                    continue;
                }
                
                // Sinyal üret
                const result = await strategy.generateSignal(strategyCandles, symbol);
                
                if (result) {
                    // Sinyal sonucuna strateji adını ekle
                    result.strategyName = strategyName;
                    signals.push(result);
                    
                    logger.info(`Generated signal with ${strategyName} for ${symbol}: ${result.signal}`);
                }
            } catch (error) {
                logger.error(`Error generating signal with strategy ${strategyName} for ${symbol}: ${error.message}`);
            }
        }
        
        return signals;
    }
}

module.exports = StrategyManager;