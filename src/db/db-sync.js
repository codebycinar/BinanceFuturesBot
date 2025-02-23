const { sequelize, models } = require('./db');

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established.');

        // Tüm modelleri senkronize etmek için alternatif:
        await sequelize.sync({ force: true }); // Tüm tabloları yeniden oluşturur

        console.log('All tables synchronized successfully.');
    } catch (error) {
        console.error('Error syncing database:', error);
    } finally {
        await sequelize.close();
    }
})();