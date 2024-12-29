// test/getSymbolInfo.js

const BinanceService = require('../services/BinanceService');
const logger = require('../utils/logger');

(async () => {
    const binanceService = new BinanceService();
    const symbols = ['TRBUSDT', 'RSRUSDT', '1000FLOKIUSDT']; // Test etmek istediğiniz semboller
    for (const symbol of symbols) {
        const stepSize = await binanceService.getStepSize(symbol);
        const quantityPrecision = await binanceService.getQuantityPrecision(symbol);
        logger.info(`Symbol: ${symbol}, Step Size: ${stepSize}, Quantity Precision: ${quantityPrecision}`, { timestamp: new Date().toISOString() });
    }
})();
