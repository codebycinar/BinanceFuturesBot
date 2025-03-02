module.exports = (sequelize, DataTypes) => {
    const Position = sequelize.define('Position', {
        symbol: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        entries: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        entryPrices: {
            type: DataTypes.TEXT,
            defaultValue: JSON.stringify([]),
            get() {
                const value = this.getDataValue('entryPrices');
                return value ? JSON.parse(value) : [];
            },
            set(value) {
                this.setDataValue('entryPrices', JSON.stringify(value));
            },
        },
        totalAllocation: {
            type: DataTypes.FLOAT,
            defaultValue: 0.0,
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        step: {
            type: DataTypes.INTEGER,
            defaultValue: 1,
        },
        nextCandleCloseTime: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        stopLoss: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        takeProfit: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        closedPrice: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        closedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        exitReason: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        strategyUsed: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'Adaptive Strategy',
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
        pnlPercent: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        pnlAmount: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        holdTime: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 0,
            comment: 'Position hold time in minutes',
        },
        isManaged: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            allowNull: false,
            comment: 'Bot tarafından yönetilen pozisyonlar true, manuel pozisyonlar false olacak',
        },
    });
    return Position;
};