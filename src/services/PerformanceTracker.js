// PerformanceTracker.js
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { StrategyPerformance, Position } = models;

class PerformanceTracker {
    constructor() {
        this.logger = logger;
    }

    async initialize() {
        logger.info('Performance Tracker initialized');
    }

    /**
     * Pozisyon kapandığında strateji performansını güncelle
     * @param {Object} position - Kapatılan pozisyon
     */
    async updatePerformance(position) {
        try {
            if (!position || !position.closedPrice || !position.strategyUsed) {
                logger.warn('Invalid position data for performance tracking');
                return;
            }

            // Pozisyonun PnL'ini hesapla
            const isLong = position.entries > 0;
            const entryPrice = position.entryPrices.reduce((sum, price) => sum + price, 0) / position.entryPrices.length;
            const exitPrice = position.closedPrice;
            
            let pnlPercent = 0;
            if (isLong) {
                pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
            } else {
                pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
            }
            
            const pnlAmount = (position.totalAllocation * pnlPercent) / 100;
            const isWin = pnlPercent > 0;
            
            // Pozisyon tutma süresini hesapla (dakika cinsinden)
            const createdAt = new Date(position.createdAt);
            const closedAt = new Date(position.closedAt);
            const holdTime = Math.round((closedAt - createdAt) / (1000 * 60));
            
            // Strateji performans kaydını bul veya oluştur
            let [performance, created] = await StrategyPerformance.findOrCreate({
                where: { 
                    strategyName: position.strategyUsed,
                    symbol: position.symbol,
                    timeframe: '1h'  // Varsayılan timeframe
                },
                defaults: {
                    totalTrades: 0,
                    winningTrades: 0,
                    losingTrades: 0,
                    winRate: 0,
                    totalProfit: 0,
                    totalLoss: 0,
                    netPnl: 0,
                    pnlPercent: 0,
                    averageWin: 0,
                    averageLoss: 0,
                    profitFactor: 0,
                    maxDrawdown: 0,
                    avgHoldingTime: 0,
                    recentTrades: [],
                    marketConditions: position.marketConditions || {}
                }
            });
            
            // Performans metriklerini güncelle
            performance.totalTrades += 1;
            
            if (isWin) {
                performance.winningTrades += 1;
                performance.totalProfit += pnlAmount;
                
                // Ortalama kazancı güncelle
                performance.averageWin = performance.totalProfit / performance.winningTrades;
            } else {
                performance.losingTrades += 1;
                performance.totalLoss += Math.abs(pnlAmount);
                
                // Ortalama kaybı güncelle
                performance.averageLoss = performance.totalLoss / performance.losingTrades;
            }
            
            // Kazanma oranını hesapla
            performance.winRate = (performance.winningTrades / performance.totalTrades) * 100;
            
            // Net PnL
            performance.netPnl = performance.totalProfit - performance.totalLoss;
            
            // PnL yüzdesi (hesaplaması iyi değil, geliştirilecek)
            performance.pnlPercent = (performance.netPnl / (performance.totalProfit + performance.totalLoss)) * 100;
            
            // Profit Factor (karlı tüm işlemlerin toplamı / zararlı tüm işlemlerin toplamı)
            if (performance.totalLoss > 0) {
                performance.profitFactor = performance.totalProfit / performance.totalLoss;
            }
            
            // Ortalama işlem süresi
            const totalHoldTime = (performance.avgHoldingTime * (performance.totalTrades - 1)) + holdTime;
            performance.avgHoldingTime = totalHoldTime / performance.totalTrades;
            
            // Son işlemleri ekle (son 10 işlem)
            const recentTrades = performance.recentTrades || [];
            recentTrades.unshift({
                date: closedAt,
                symbol: position.symbol,
                entryPrice: entryPrice,
                exitPrice: exitPrice,
                pnlPercent: pnlPercent,
                pnlAmount: pnlAmount,
                holdTime: holdTime,
                positionType: isLong ? 'LONG' : 'SHORT',
                isWin: isWin
            });
            
            performance.recentTrades = recentTrades.slice(0, 10); // Son 10 işlemi tut
            performance.lastUpdated = new Date();
            
            // Değişiklikleri kaydet
            await performance.save();
            
            logger.info(`Performance updated for ${position.strategyUsed} on ${position.symbol} (${isWin ? 'WIN' : 'LOSS'}, PnL: ${pnlPercent.toFixed(2)}%, Amount: ${pnlAmount.toFixed(2)} USDT)`);
            
            return performance;
        } catch (error) {
            logger.error(`Error updating strategy performance: ${error.message}`);
            logger.error(error.stack);
        }
    }
    
    /**
     * Tüm stratejilerin performans verilerini getir
     */
    async getAllPerformance() {
        try {
            return await StrategyPerformance.findAll({
                order: [
                    ['winRate', 'DESC'],
                    ['profitFactor', 'DESC']
                ]
            });
        } catch (error) {
            logger.error(`Error getting all strategy performances: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Belirli bir stratejinin performans verilerini getir
     */
    async getStrategyPerformance(strategyName) {
        try {
            return await StrategyPerformance.findAll({
                where: { strategyName },
                order: [
                    ['winRate', 'DESC'],
                    ['profitFactor', 'DESC']
                ]
            });
        } catch (error) {
            logger.error(`Error getting performance for strategy ${strategyName}: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Belirli bir sembol için performans verilerini getir
     */
    async getSymbolPerformance(symbol) {
        try {
            return await StrategyPerformance.findAll({
                where: { symbol },
                order: [
                    ['winRate', 'DESC'],
                    ['profitFactor', 'DESC']
                ]
            });
        } catch (error) {
            logger.error(`Error getting performance for symbol ${symbol}: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Mevcut performans verilerini kullanarak en iyi stratejiyi seç
     */
    async getBestStrategy(symbol) {
        try {
            const performances = await StrategyPerformance.findAll({
                where: { symbol },
                order: [
                    ['winRate', 'DESC'],
                    ['profitFactor', 'DESC'],
                    ['totalTrades', 'DESC']
                ]
            });
            
            // En az 5 işlem yapılmış stratejileri filtrele
            const validPerformances = performances.filter(p => p.totalTrades >= 5);
            
            if (validPerformances.length > 0) {
                return validPerformances[0].strategyName;
            }
            
            return null; // Yeterli veri yok
        } catch (error) {
            logger.error(`Error getting best strategy for ${symbol}: ${error.message}`);
            return null;
        }
    }
}

module.exports = PerformanceTracker;