// StrategySelector.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Strategy } = models;

class StrategySelector {
    constructor(performanceTracker) {
        this.performanceTracker = performanceTracker;
        this.disabledStrategies = new Set();
        this.minTrades = 10; // Karar vermek için gereken minimum işlem sayısı
        this.refreshInterval = 3600000; // Strateji durumlarını yenileme aralığı (1 saat)
        this.lastRefreshTime = 0;
    }

    async initialize() {
        try {
            logger.info('Strategy Selector initialized');
            // İlk strateji durumlarını yükle
            await this.refreshStrategyStatuses();
        } catch (error) {
            logger.error(`Error initializing StrategySelector: ${error.message}`);
        }
    }

    /**
     * Stratejinin kullanılabilir olup olmadığını kontrol eder
     * @param {string} strategyName - Strateji adı
     * @returns {Promise<boolean>} - Kullanılabilir ise true, değilse false
     */
    async isStrategyEnabled(strategyName) {
        // Strateji durumlarını belirli aralıklarla güncelle
        const now = Date.now();
        if (now - this.lastRefreshTime > this.refreshInterval) {
            await this.refreshStrategyStatuses();
            this.lastRefreshTime = now;
        }

        // Strateji devre dışı bırakılmışsa false döndür
        return !this.disabledStrategies.has(strategyName);
    }

    /**
     * Tüm stratejilerin durumlarını günceller
     */
    async refreshStrategyStatuses() {
        try {
            // Veritabanındaki tüm stratejileri al
            const strategies = await Strategy.findAll();
            
            logger.info(`Refreshing strategy statuses for ${strategies.length} strategies`);
            
            // Her strateji için kârlılık durumunu kontrol et
            for (const strategy of strategies) {
                const strategyName = strategy.name;
                const isProfitable = await this.performanceTracker.isStrategyProfitable(strategyName, this.minTrades);
                
                if (!isProfitable) {
                    // Kârlı değilse devre dışı bırak
                    this.disabledStrategies.add(strategyName);
                    logger.warn(`Strategy ${strategyName} has been disabled due to poor performance`);
                } else if (this.disabledStrategies.has(strategyName)) {
                    // Kârlıysa ve devre dışıysa tekrar etkinleştir
                    this.disabledStrategies.delete(strategyName);
                    logger.info(`Strategy ${strategyName} has been re-enabled due to improved performance`);
                }
                
                // Strateji durumunu loglama
                const winRate = await this.performanceTracker.getStrategyWinRate(strategyName);
                logger.info(`Strategy ${strategyName} - Win Rate: ${winRate.toFixed(2)}%, Status: ${this.disabledStrategies.has(strategyName) ? 'DISABLED' : 'ENABLED'}`);
            }
            
            logger.info(`Strategy status refresh completed. ${this.disabledStrategies.size} strategies disabled.`);
        } catch (error) {
            logger.error(`Error refreshing strategy statuses: ${error.message}`);
        }
    }

    /**
     * İzin verilen stratejileri ve kazanma oranlarını içeren bir rapor döndürür
     */
    async getStrategyReport() {
        try {
            // Veritabanındaki tüm stratejileri al
            const strategies = await Strategy.findAll();
            
            const report = [];
            
            // Her strateji için bilgi topla
            for (const strategy of strategies) {
                const strategyName = strategy.name;
                const winRate = await this.performanceTracker.getStrategyWinRate(strategyName);
                const isEnabled = !this.disabledStrategies.has(strategyName);
                
                report.push({
                    name: strategyName,
                    winRate: winRate.toFixed(2),
                    status: isEnabled ? 'ENABLED' : 'DISABLED'
                });
            }
            
            // Kazanma oranına göre sırala
            return report.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
        } catch (error) {
            logger.error(`Error generating strategy report: ${error.message}`);
            return [];
        }
    }

    /**
     * Bir stratejiyi manuel olarak etkinleştirir veya devre dışı bırakır
     * @param {string} strategyName - Strateji adı
     * @param {boolean} enable - true = etkinleştir, false = devre dışı bırak
     */
    manuallySetStrategyStatus(strategyName, enable) {
        try {
            if (enable) {
                this.disabledStrategies.delete(strategyName);
                logger.info(`Strategy ${strategyName} has been manually enabled`);
            } else {
                this.disabledStrategies.add(strategyName);
                logger.info(`Strategy ${strategyName} has been manually disabled`);
            }
        } catch (error) {
            logger.error(`Error setting strategy status for ${strategyName}: ${error.message}`);
        }
    }
}

module.exports = StrategySelector;