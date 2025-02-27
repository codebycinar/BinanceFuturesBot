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
        strategy: {
            type: DataTypes.STRING,
            defaultValue: 'turtle', // Varsayılan değer
            allowNull: false
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
    });
    return Position;
};