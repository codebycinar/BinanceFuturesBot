// Test script for TelegramService
const telegramService = require('./src/services/TelegramService');
const logger = require('./src/utils/logger');

async function testTelegramService() {
    try {
        logger.info('Starting TelegramService test');
        
        // Initialize the service
        await telegramService.initialize();
        logger.info('TelegramService initialized');
        
        // Send a basic message
        const messageSent = await telegramService.sendMessage('Test message from TelegramService');
        logger.info(`Basic message sent: ${messageSent}`);
        
        // Test a position notification
        const testPosition = {
            symbol: 'BTCUSDT',
            entryPrices: [50000],
            entries: 1, // LONG position
            stopLoss: 49000,
            takeProfit: 52000,
            strategyUsed: 'TurtleTradingStrategy',
            allocation: 100
        };
        
        await telegramService.notifyNewPosition(testPosition);
        logger.info('Position notification sent');
        
        // Test an error notification
        await telegramService.notifyError('Test error', 'This is a test error details');
        logger.info('Error notification sent');
        
        logger.info('All tests completed successfully');
    } catch (error) {
        logger.error(`Error testing TelegramService: ${error.message}`);
    }
}

// Run the test
testTelegramService();