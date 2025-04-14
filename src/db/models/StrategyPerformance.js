module.exports = (sequelize, DataTypes) => {
    const StrategyPerformance = sequelize.define('StrategyPerformance', {
        strategyName: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        symbol: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        timeframe: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: '1h',
        },
        totalTrades: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        winningTrades: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        losingTrades: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        winRate: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        totalProfit: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        totalLoss: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        netPnl: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        pnlPercent: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        averageWin: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        averageLoss: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        profitFactor: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        maxDrawdown: {
            type: DataTypes.FLOAT,
            defaultValue: 0,
        },
        avgHoldingTime: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Average position holding time in minutes',
        },
        lastUpdated: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        marketConditions: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '{}',
            get() {
                const value = this.getDataValue('marketConditions');
                return value ? JSON.parse(value) : {};
            },
            set(value) {
                this.setDataValue('marketConditions', JSON.stringify(value));
            },
        },
        // Son 10 trade sonuçları
        recentTrades: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '[]',
            get() {
                const value = this.getDataValue('recentTrades');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('recentTrades', JSON.stringify(value));
            },
        }
    });
    return StrategyPerformance;
};