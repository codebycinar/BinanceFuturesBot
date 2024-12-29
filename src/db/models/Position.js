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
            type: DataTypes.JSON,
            defaultValue: [],
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
    });
    return Position;
};
