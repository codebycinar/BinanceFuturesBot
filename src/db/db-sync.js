const { sequelize, models } = require('./db');
const { Strategy } = models;

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established.');

        // Modelleri senkronize et
        await sequelize.sync({ alter: true });
        console.log('Models synchronized successfully.');

        // Varsayılan stratejiler
        const strategies = [
            {
                name: 'BollingerStrategy',
                parameters: {
                    bbPeriod: 20,
                    bbStdDev: 2,
                    maType: 'SMA',
                    stochasticPeriod: 14,
                    stochasticSignalPeriod: 3,
                    atrPeriod: 14,
                },
            },
        ];

        for (const strategy of strategies) {
            await Strategy.findOrCreate({
                where: { name: strategy.name },
                defaults: strategy,
            });
        }

        console.log('Default strategies inserted successfully.');
        console.log('Modeller:', Object.keys(require('./db')));
    } catch (error) {
        console.error('Error syncing database:', error);
    } finally {
        await sequelize.close();
    }
})();
