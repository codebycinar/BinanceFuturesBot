// Test script for Turtle Trading Strategy
const TurtleTradingStrategy = require('../strategies/TurtleTradingStrategy');
const logger = require('../utils/logger');
const config = require('../config/config');

// Use mock data instead of connecting to Binance
class MockBinanceService {
    async initialize() {
        console.log('Mock Binance service initialized');
        return true;
    }
    
    async getCandles(symbol, timeframe, limit) {
        console.log(`Getting mock candles for ${symbol} on ${timeframe} timeframe`);
        
        // Create mock candle data with 100 candles
        const candles = [];
        let basePrice = 0;
        
        switch (symbol) {
            case 'BTCUSDT':
                basePrice = 60000;
                break;
            case 'ETHUSDT':
                basePrice = 3000;
                break;
            case 'BNBUSDT':
                basePrice = 500;
                break;
            case 'SOLUSDT':
                basePrice = 150;
                break;
            case 'AVAXUSDT':
                basePrice = 30;
                break;
            default:
                basePrice = 100;
        }
        
        // Create fake candles with a simulated trend
        for (let i = 0; i < limit; i++) {
            // Simulate a trend direction that changes
            const trendDirection = i < limit/2 ? 1 : -1;
            const volatility = basePrice * 0.02; // 2% volatility
            
            const open = basePrice + trendDirection * (i * volatility * 0.1) + (Math.random() - 0.5) * volatility;
            const close = open + (Math.random() - 0.5) * volatility;
            const high = Math.max(open, close) + Math.random() * volatility * 0.5;
            const low = Math.min(open, close) - Math.random() * volatility * 0.5;
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
        // Return a mock current price based on the symbol
        switch (symbol) {
            case 'BTCUSDT': return 60000 + Math.random() * 1000;
            case 'ETHUSDT': return 3000 + Math.random() * 100;
            case 'BNBUSDT': return 500 + Math.random() * 20;
            case 'SOLUSDT': return 150 + Math.random() * 10;
            case 'AVAXUSDT': return 30 + Math.random() * 5;
            default: return 100 + Math.random() * 10;
        }
    }
}

async function testTurtleStrategy() {
    try {
        console.log('Starting Turtle Trading Strategy test...');
        
        // Use mock Binance service instead of the real one
        const binanceService = new MockBinanceService();
        await binanceService.initialize();
        
        // Initialize strategy
        const turtleStrategy = new TurtleTradingStrategy();
        await turtleStrategy.initialize();
        
        // Test parameters
        console.log('Strategy Parameters:', turtleStrategy.parameters);
        console.log('Preferred Timeframe:', turtleStrategy.preferredTimeframe);
        
        // Test on a few symbols
        const testSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'AVAXUSDT'];
        
        for (const symbol of testSymbols) {
            console.log(`\n=== Testing ${symbol} ===`);
            
            // Get candles for the symbol
            const candles = await binanceService.getCandles(
                symbol, 
                turtleStrategy.preferredTimeframe, 
                100
            );
            
            if (!candles || candles.length === 0) {
                console.log(`No candles fetched for ${symbol}. Skipping.`);
                continue;
            }
            
            console.log(`Fetched ${candles.length} candles for ${symbol}`);
            
            // Calculate Donchian channels
            const entryDonchian = turtleStrategy.calculateDonchianChannel(
                candles, 
                turtleStrategy.parameters.entryChannel
            );
            
            const exitDonchian = turtleStrategy.calculateDonchianChannel(
                candles, 
                turtleStrategy.parameters.exitChannel
            );
            
            // Calculate ATR
            const atr = turtleStrategy.calculateATR(
                candles, 
                turtleStrategy.parameters.atrPeriod
            );
            
            // Calculate signal
            const signal = await turtleStrategy.generateSignal(candles, symbol);
            
            // Print results
            console.log('Entry Donchian Channel:', entryDonchian);
            console.log('Exit Donchian Channel:', exitDonchian);
            console.log('ATR:', atr);
            console.log('Signal:', signal);
            
            // Print analysis about current price position
            const currentPrice = parseFloat(candles[candles.length - 1].close);
            console.log('Current Price:', currentPrice);
            console.log('Price Position:');
            console.log('- Distance to Entry Upper Band:', entryDonchian.upper - currentPrice);
            console.log('- Distance to Entry Lower Band:', currentPrice - entryDonchian.lower);
            console.log('- Distance to Exit Upper Band:', exitDonchian.upper - currentPrice);
            console.log('- Distance to Exit Lower Band:', currentPrice - exitDonchian.lower);
            
            // Break-even analysis
            const breakEvenLevel = atr * turtleStrategy.parameters.breakEvenActivationPercent;
            console.log('Break-even Activation Level (profit needed):', breakEvenLevel);
            
            // Simulated positions
            console.log('\nSimulated LONG position:');
            const longEntryPrice = entryDonchian.upper;
            const longStopLoss = longEntryPrice - (atr * turtleStrategy.parameters.atrMultiplier);
            const longTakeProfit = longEntryPrice + (atr * turtleStrategy.parameters.atrMultiplier * turtleStrategy.parameters.profitMultiplier);
            console.log('- Entry:', longEntryPrice);
            console.log('- Stop Loss:', longStopLoss);
            console.log('- Take Profit:', longTakeProfit);
            console.log('- Risk:Reward Ratio:', ((longTakeProfit - longEntryPrice) / (longEntryPrice - longStopLoss)).toFixed(2));
            
            console.log('\nSimulated SHORT position:');
            const shortEntryPrice = entryDonchian.lower;
            const shortStopLoss = shortEntryPrice + (atr * turtleStrategy.parameters.atrMultiplier);
            const shortTakeProfit = shortEntryPrice - (atr * turtleStrategy.parameters.atrMultiplier * turtleStrategy.parameters.profitMultiplier);
            console.log('- Entry:', shortEntryPrice);
            console.log('- Stop Loss:', shortStopLoss);
            console.log('- Take Profit:', shortTakeProfit);
            console.log('- Risk:Reward Ratio:', ((shortEntryPrice - shortTakeProfit) / (shortStopLoss - shortEntryPrice)).toFixed(2));
        }
        
        console.log('\nTurtle Trading Strategy test completed successfully!');
        
    } catch (error) {
        console.error('Error testing Turtle Trading Strategy:', error);
    }
}

// Run the test
testTurtleStrategy()
    .then(() => {
        console.log('Test completed!');
        process.exit(0);
    })
    .catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });