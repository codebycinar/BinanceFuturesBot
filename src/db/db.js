const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'binance_futures_bot.sqlite'),
    logging: false,
    define: {
        freezeTableName: true, // Tablo adlarını çoğul yapma
    },
});

const models = {};
const modelsDir = path.join(__dirname, 'models');

// Modelleri otomatik yüklerken kontrol ekledik
fs.readdirSync(modelsDir)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => {
        const modelDefiner = require(path.join(modelsDir, file));
        const model = modelDefiner(sequelize, Sequelize.DataTypes);
        models[model.name] = model;
        console.log(`Yüklenen model: ${model.name}`); // Eklenen log
    });

// Model ilişkilerini kontrol et
Object.keys(models).forEach((modelName) => {
    if (models[modelName].associate) {
        models[modelName].associate(models);
    }
});

module.exports = { sequelize, models };
