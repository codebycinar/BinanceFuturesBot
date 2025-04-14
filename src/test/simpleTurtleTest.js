// Simple test for Turtle Trading Strategy
const config = require('../config/config');
const TurtleTradingStrategy = require('../strategies/TurtleTradingStrategy');
const BinanceService = require('../services/BinanceService');
const OrderService = require('../services/OrderService');
const MarketScanner = require('../services/MarketScanner');

console.log('Turtle Trading Strategy Test Script');
console.log('==================================');

class MockBinanceService {
    constructor() {
        this.exchangeInfo = {
            'BTCUSDT': {
                filters: {
                    'LOT_SIZE': { stepSize: '0.001' },
                    'PRICE_FILTER': { tickSize: '0.01' }
                },
                quantityPrecision: 3,
                pricePrecision: 2
            }
        };
    }

    async initialize() {
        console.log('Mock Binance service initialized');
        return true;
    }
    
    async getCandles(symbol, timeframe, limit = 100) {
        console.log(`Getting mock candles for ${symbol} on ${timeframe} timeframe`);
        
        // Create mock candle data with uptrend for testing
        const candles = [];
        let basePrice = 60000; // BTC price
        
        // Create fake candles with a simulated trend
        for (let i = 0; i < limit; i++) {
            // Simulate an uptrend
            const trendFactor = i < limit/2 ? 0.0005 : 0.001; // First half small uptrend, second half stronger uptrend
            const randomFactor = 0.005; // 0.5% random movement
            
            const dayChange = basePrice * (trendFactor + (Math.random() - 0.5) * randomFactor);
            basePrice += dayChange;
            
            const open = basePrice - (Math.random() * 50);
            const close = basePrice;
            const high = Math.max(open, close) + (Math.random() * 100);
            const low = Math.min(open, close) - (Math.random() * 100);
            const volume = 1000000 + Math.random() * 1000000;
            
            candles.push({
                open: open.toString(),
                high: high.toString(),
                low: low.toString(),
                close: close.toString(),
                volume: volume.toString(),
                timestamp: Date.now() - (limit - i) * 3600000
            });
        }
        
        return candles;
    }
    
    async getCurrentPrice(symbol) {
        return 60100 + Math.random() * 100;
    }
    
    async getFuturesBalance() {
        return 10000;
    }
    
    // Mock methods for stop loss and take profit
    async cancelAllOpenOrders(symbol) {
        console.log(`[Mock] Cancelling all open orders for ${symbol}`);
        return true;
    }
    
    async placeMarketOrder(orderData) {
        console.log(`[Mock] Placing market order for ${orderData.symbol}: ${orderData.side} ${orderData.quantity}`);
        return { orderId: Math.floor(Math.random() * 1000000) };
    }
    
    async placeStopLossOrder(orderData) {
        console.log(`[Mock] Placing stop loss order for ${orderData.symbol} at ${orderData.stopPrice}`);
        return { orderId: Math.floor(Math.random() * 1000000) };
    }
    
    async placeTakeProfitOrder(orderData) {
        console.log(`[Mock] Placing take profit order for ${orderData.symbol} at ${orderData.stopPrice}`);
        return { orderId: Math.floor(Math.random() * 1000000) };
    }
    
    // Mock position management methods
    async getOpenPositions() {
        return []; // No open positions for this test
    }
    
    getQuantityPrecision(symbol) {
        return this.exchangeInfo[symbol].quantityPrecision;
    }
    
    getPricePrecision(symbol) {
        return this.exchangeInfo[symbol].pricePrecision;
    }
    
    adjustPrecision(value, stepSize) {
        return parseFloat(value.toFixed(3));
    }
    
    roundQuantity(quantity, stepSize) {
        return parseFloat(quantity.toFixed(3));
    }
    
    getStepSize(symbol) {
        return '0.001';
    }
}

class MockMultiTimeframeService {
    async getMultiTimeframeData(symbol, strategy) {
        const binanceService = new MockBinanceService();
        const timeframes = ['1h', '4h', '1d'];
        const data = {
            candles: {}
        };
        
        for (const timeframe of timeframes) {
            data.candles[timeframe] = await binanceService.getCandles(symbol, timeframe, 100);
        }
        
        return data;
    }
}

class MockOrderService {
    constructor(binanceService) {
        this.binanceService = binanceService;
    }
    
    async calculateStaticPositionSize(symbol, allocation) {
        const currentPrice = await this.binanceService.getCurrentPrice(symbol);
        return allocation / currentPrice;
    }
    
    async placeMarketOrder(orderData) {
        return this.binanceService.placeMarketOrder(orderData);
    }
    
    async placeStopLossOrder(orderData) {
        return this.binanceService.placeStopLossOrder(orderData);
    }
    
    async placeTakeProfitOrder(orderData) {
        return this.binanceService.placeTakeProfitOrder(orderData);
    }
    
    async closePosition(symbol, side, quantity, positionSide) {
        console.log(`[Mock] Closing ${positionSide} position for ${symbol} with ${side} order of ${quantity}`);
        return { orderId: Math.floor(Math.random() * 1000000) };
    }
}

// Mock database Position model
class MockPosition {
    static async findOne() {
        return null; // No existing position
    }
    
    static async create(data) {
        console.log(`[Mock] Created position in database: ${JSON.stringify(data, null, 2)}`);
        return data;
    }
}

const mockPerformanceTracker = {
    updatePerformance: async (data) => {
        console.log(`[Mock] Updated performance tracker: ${JSON.stringify(data, null, 2)}`);
    }
};

const mockTelegramBot = {
    telegram: {
        sendMessage: async (chatId, message) => {
            console.log(`[Mock] Telegram message sent to ${chatId}:`);
            console.log(message);
        }
    }
};

async function testTurtleTrading() {
    try {
        // Initialize dependencies
        const binanceService = new MockBinanceService();
        await binanceService.initialize();
        
        const mtfService = new MockMultiTimeframeService();
        const orderService = new MockOrderService(binanceService);
        
        // Initialize the strategy
        const strategy = new TurtleTradingStrategy();
        await strategy.initialize();
        
        console.log('\nStrategy Parameters:');
        console.log(strategy.parameters);
        
        // Override real dependencies with mocks
        global.Position = MockPosition;
        global.bot = mockTelegramBot;
        global.chatId = '123456789';
        
        // Create MarketScanner with mocks
        const marketScanner = new MarketScanner(
            binanceService,
            orderService,
            mtfService,
            mockPerformanceTracker
        );
        
        // Assign the strategy to the market scanner
        marketScanner.strategy = strategy;
        marketScanner.bot = mockTelegramBot;
        marketScanner.chatId = '123456789';
        
        // Initialize scanner
        await marketScanner.initialize();
        
        // Test the strategy on BTC
        const symbol = 'BTCUSDT';
        console.log(`\nTesting Turtle Trading Strategy on ${symbol}`);
        
        // Get candle data
        const candles = await binanceService.getCandles(symbol, strategy.preferredTimeframe, 100);
        console.log(`Received ${candles.length} candles for ${symbol}`);
        
        // Calculate Donchian channels
        const entryDonchian = strategy.calculateDonchianChannel(candles, strategy.parameters.entryChannel);
        const exitDonchian = strategy.calculateDonchianChannel(candles, strategy.parameters.exitChannel);
        
        // Calculate ATR
        const atr = strategy.calculateATR(candles, strategy.parameters.atrPeriod);
        
        console.log(`\nIndicators for ${symbol}:`);
        console.log(`- Entry Donchian Channel: Upper=${entryDonchian.upper.toFixed(2)}, Lower=${entryDonchian.lower.toFixed(2)}`);
        console.log(`- Exit Donchian Channel: Upper=${exitDonchian.upper.toFixed(2)}, Lower=${exitDonchian.lower.toFixed(2)}`);
        console.log(`- ATR: ${atr.toFixed(2)}`);
        
        // Generate signal - get original signal first
        let signal = await strategy.generateSignal(candles, symbol);
        console.log(`\nOriginal Generated Signal for ${symbol}:`);
        console.log(signal);
        
        // For testing purposes, we'll override the signal to be "BUY" so we can test position management
        signal.signal = 'BUY'; // Force a BUY signal
        signal.unmetConditions = '';
        console.log(`\nModified Signal for test purposes:`);
        console.log(signal);
        
        // Test position management
        if (signal.signal === 'BUY' || signal.signal === 'SELL') {
            console.log(`\nOpening new position based on signal: ${signal.signal}`);
            
            // Open new position
            const result = await marketScanner.openNewPosition(
                symbol, 
                signal.signal, 
                parseFloat(candles[candles.length - 1].close), 
                signal.stopLoss, 
                signal.takeProfit, 
                signal.allocation, 
                'TurtleTradingStrategy'
            );
            
            console.log(`Position opened: ${result}`);
            
            // Now let's simulate position management
            console.log(`\nSimulating position management for ${symbol}`);
            
            // Create a mock position
            const mockPosition = {
                symbol,
                entries: signal.signal === 'BUY' ? 1 : -1,
                entryPrices: [parseFloat(candles[candles.length - 1].close)],
                stopLoss: signal.stopLoss,
                takeProfit: signal.takeProfit,
                totalAllocation: signal.allocation,
                isActive: true,
                save: async function() {
                    console.log(`[Mock] Saved position: ${JSON.stringify(this, null, 2)}`);
                    return this;
                }
            };
            
            // Test managePosition method
            await marketScanner.managePosition(mockPosition, candles);
            
            // Test adding to position (pyramiding)
            if (signal.signal === 'BUY') {
                console.log(`\nTesting pyramiding (adding to position) for ${symbol}`);
                
                const addResult = await marketScanner.addToPosition(
                    mockPosition,
                    'ADD_BUY',
                    parseFloat(candles[candles.length - 1].close) * 1.01, // Slightly higher price
                    signal.stopLoss,
                    signal.takeProfit,
                    signal.allocation
                );
                
                console.log(`Position addition result: ${addResult}`);
            }
            
            // Test trailing stop
            console.log(`\nTesting trailing stop logic for ${symbol}`);
            
            // Simulate a profitable position
            const profitablePrice = signal.signal === 'BUY' 
                ? mockPosition.entryPrices[0] * 1.05 // 5% up for long
                : mockPosition.entryPrices[0] * 0.95; // 5% down for short
                
            // Check if trailing stop is triggered
            const trailingStopResult = marketScanner.checkTrailingStop(
                mockPosition,
                profitablePrice
            );
            
            console.log(`Trailing stop check with profitable price (${profitablePrice.toFixed(2)}):`);
            console.log(trailingStopResult);
            
            // Test break-even functionality
            console.log(`\nTesting break-even functionality for ${symbol}`);
            
            // Modify candles to simulate price movement after entry
            const updatedCandles = [...candles];
            const lastCandle = { ...updatedCandles[updatedCandles.length - 1] };
            
            // Update last candle to show profit exceeding break-even threshold
            if (signal.signal === 'BUY') {
                lastCandle.close = (parseFloat(lastCandle.close) * 1.03).toString(); // 3% up
            } else {
                lastCandle.close = (parseFloat(lastCandle.close) * 0.97).toString(); // 3% down
            }
            updatedCandles[updatedCandles.length - 1] = lastCandle;
            
            // Update position if needed (should trigger break-even)
            await marketScanner.updatePositionIfNeeded(mockPosition, parseFloat(lastCandle.close), updatedCandles);
            
            // Finally, test closing position
            console.log(`\nTesting position closing for ${symbol}`);
            
            const closeResult = await marketScanner.closePosition(
                mockPosition,
                parseFloat(lastCandle.close),
                'test_close'
            );
            
            console.log(`Position closed: ${closeResult}`);
        } else {
            console.log(`\nNo actionable signal generated (${signal.signal}), skipping position management tests`);
        }
        
        console.log('\nTurtle Trading Strategy test completed successfully!');
    } catch (error) {
        console.error('Error in Turtle Trading test:', error);
        console.error(error.stack);
    }
}

// Run the test
testTurtleTrading()
    .then(() => console.log('Test completed'))
    .catch(error => console.error('Test failed:', error));