// src/db/models/Signal.js
module.exports = (sequelize, DataTypes) => {
    const Signal = sequelize.define('Signal', {
        symbol: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        signalType: {
            type: DataTypes.STRING, // 'WEAK_BUY', 'WEAK_SELL', 'BUY', 'SELL'
            allowNull: true,
        },
        entryPrice: {
            type: DataTypes.FLOAT,
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
        allocation: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        rsi: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        adx: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        unmetConditions: {
            type: DataTypes.TEXT, // Karşılanmayan koşulları string olarak kaydedelim
            allowNull: true,
        },
        isNotified: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        notificationDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'Signal',
        timestamps: true,
    });

    return Signal;
};