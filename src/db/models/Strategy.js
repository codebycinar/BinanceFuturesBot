module.exports = (sequelize, DataTypes) => {
    const Strategy = sequelize.define('Strategy', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        parameters: {
            type: DataTypes.JSON,
            allowNull: false,
        },
    });
    return Strategy;
};
