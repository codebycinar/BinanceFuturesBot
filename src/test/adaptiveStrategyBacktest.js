/**
 * Adaptive Strategy Backtest Script
 * 
 * This script performs a basic backtest of different strategies:
 * - TurtleTradingStrategy
 * - AdaptiveMomentumStrategy
 * 
 * The backtest runs on historical data from Binance and simulates trading to compare strategy performances.
 */

const BinanceService = require('../services/BinanceService');
const TurtleTradingStrategy = require('../strategies/TurtleTradingStrategy');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Import the AdaptiveMomentumStrategy (to be created)
const AdaptiveMomentumStrategy = require('../strategies/AdaptiveMomentumStrategy');

// Backtest configuration
const config = {
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT'],
    timeframe: '1h',
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
    endDate: new Date(),
    initialCapital: 10000,
    positionSize: 0.1, // 10% of capital per trade
    stopLoss: 0.02, // 2% stop loss
    takeProfit: 0.05, // 5% take profit
};

// BacktestResult class to track performance
class BacktestResult {
    constructor(strategyName) {
        this.strategyName = strategyName;
        this.trades = [];
        this.capital = config.initialCapital;
        this.initialCapital = config.initialCapital;
        this.winCount = 0;
        this.loseCount = 0;
        this.signalCount = 0;
        this.maxDrawdown = 0;
        this.highestCapital = config.initialCapital;
    }

    addTrade(trade) {
        this.trades.push(trade);
        this.capital += trade.profit;
        
        // Update win/lose count
        if (trade.profit > 0) {
            this.winCount++;
        } else if (trade.profit < 0) {
            this.loseCount++;
        }
        
        // Update highestCapital and maxDrawdown
        if (this.capital > this.highestCapital) {
            this.highestCapital = this.capital;
        } else {
            const drawdown = (this.highestCapital - this.capital) / this.highestCapital;
            if (drawdown > this.maxDrawdown) {
                this.maxDrawdown = drawdown;
            }
        }
    }

    get totalTrades() {
        return this.trades.length;
    }

    get winRate() {
        return this.totalTrades > 0 ? (this.winCount / this.totalTrades) * 100 : 0;
    }

    get profitFactor() {
        const grossProfit = this.trades
            .filter(t => t.profit > 0)
            .reduce((sum, t) => sum + t.profit, 0);
        
        const grossLoss = Math.abs(this.trades
            .filter(t => t.profit < 0)
            .reduce((sum, t) => sum + t.profit, 0));
        
        return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    }

    get netProfit() {
        return this.capital - this.initialCapital;
    }

    get netProfitPercent() {
        return (this.netProfit / this.initialCapital) * 100;
    }

    get summary() {
        return {
            strategyName: this.strategyName,
            initialCapital: this.initialCapital,
            finalCapital: this.capital,
            netProfit: this.netProfit,
            netProfitPercent: this.netProfitPercent,
            totalTrades: this.totalTrades,
            winCount: this.winCount,
            loseCount: this.loseCount,
            winRate: this.winRate,
            profitFactor: this.profitFactor,
            maxDrawdown: this.maxDrawdown * 100,
            signalCount: this.signalCount
        };
    }
}

// Helper function to fetch historical data
async function fetchHistoricalData(binanceService, symbol, timeframe, startDate, endDate) {
    try {
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();
        
        // Fetch candles
        const candles = await binanceService.getCandles(
            symbol,
            timeframe,
            1000, // max limit
            startTime,
            endTime
        );
        
        return candles;
    } catch (error) {
        console.error(`Error fetching historical data for ${symbol}:`, error);
        return [];
    }
}

// Backtest a strategy on a symbol
async function backtestStrategy(strategy, symbol, candles) {
    const result = new BacktestResult(strategy.constructor.name);
    let position = null;
    
    for (let i = 100; i < candles.length; i++) {
        // Use a window of candles for signal generation
        const candleWindow = candles.slice(0, i);
        
        // Generate signal
        const signal = await strategy.generateSignal(candleWindow, symbol);
        
        if (signal.signal) {
            result.signalCount++;
        }
        
        const currentCandle = candles[i - 1];
        const nextCandle = candles[i];
        
        // Simulate trade execution
        if (position === null) {
            // No position - check for entry signals
            if (signal.signal === 'BUY') {
                position = {
                    type: 'LONG',
                    entryPrice: nextCandle.open,
                    entryTime: new Date(nextCandle.timestamp),
                    size: config.positionSize * result.capital,
                    stopLoss: nextCandle.open * (1 - config.stopLoss),
                    takeProfit: nextCandle.open * (1 + config.takeProfit),
                };
            } else if (signal.signal === 'SELL') {
                position = {
                    type: 'SHORT',
                    entryPrice: nextCandle.open,
                    entryTime: new Date(nextCandle.timestamp),
                    size: config.positionSize * result.capital,
                    stopLoss: nextCandle.open * (1 + config.stopLoss),
                    takeProfit: nextCandle.open * (1 - config.takeProfit),
                };
            }
        } else {
            // Has position - check for exit
            if (position.type === 'LONG') {
                // Check stop loss
                if (nextCandle.low <= position.stopLoss) {
                    // Stop loss hit
                    const profit = position.size * ((position.stopLoss / position.entryPrice) - 1);
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: position.stopLoss,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'STOP_LOSS'
                    });
                    position = null;
                } 
                // Check take profit
                else if (nextCandle.high >= position.takeProfit) {
                    // Take profit hit
                    const profit = position.size * ((position.takeProfit / position.entryPrice) - 1);
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: position.takeProfit,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'TAKE_PROFIT'
                    });
                    position = null;
                }
                // Check for exit signal
                else if (signal.signal === 'EXIT_BUY') {
                    const profit = position.size * ((nextCandle.open / position.entryPrice) - 1);
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: nextCandle.open,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'SIGNAL'
                    });
                    position = null;
                }
            } else if (position.type === 'SHORT') {
                // Check stop loss
                if (nextCandle.high >= position.stopLoss) {
                    // Stop loss hit
                    const profit = position.size * (1 - (position.stopLoss / position.entryPrice));
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: position.stopLoss,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'STOP_LOSS'
                    });
                    position = null;
                } 
                // Check take profit
                else if (nextCandle.low <= position.takeProfit) {
                    // Take profit hit
                    const profit = position.size * (1 - (position.takeProfit / position.entryPrice));
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: position.takeProfit,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'TAKE_PROFIT'
                    });
                    position = null;
                }
                // Check for exit signal
                else if (signal.signal === 'EXIT_SELL') {
                    const profit = position.size * (1 - (nextCandle.open / position.entryPrice));
                    result.addTrade({
                        type: position.type,
                        entryPrice: position.entryPrice,
                        entryTime: position.entryTime,
                        exitPrice: nextCandle.open,
                        exitTime: new Date(nextCandle.timestamp),
                        profit,
                        exitReason: 'SIGNAL'
                    });
                    position = null;
                }
            }
        }
    }
    
    // Close any open position at the end
    if (position !== null) {
        const lastCandle = candles[candles.length - 1];
        if (position.type === 'LONG') {
            const profit = position.size * ((lastCandle.close / position.entryPrice) - 1);
            result.addTrade({
                type: position.type,
                entryPrice: position.entryPrice,
                entryTime: position.entryTime,
                exitPrice: lastCandle.close,
                exitTime: new Date(lastCandle.timestamp),
                profit,
                exitReason: 'END_OF_TEST'
            });
        } else {
            const profit = position.size * (1 - (lastCandle.close / position.entryPrice));
            result.addTrade({
                type: position.type,
                entryPrice: position.entryPrice,
                entryTime: position.entryTime,
                exitPrice: lastCandle.close,
                exitTime: new Date(lastCandle.timestamp),
                profit,
                exitReason: 'END_OF_TEST'
            });
        }
    }
    
    return result;
}

// Main backtest function
async function runBacktest() {
    try {
        console.log('Starting backtest...');
        console.log(`Timeframe: ${config.timeframe}`);
        console.log(`Start Date: ${config.startDate.toISOString()}`);
        console.log(`End Date: ${config.endDate.toISOString()}`);
        console.log(`Symbols: ${config.symbols.join(', ')}`);
        console.log(`Initial Capital: $${config.initialCapital}`);
        console.log(`Position Size: ${config.positionSize * 100}%`);
        console.log(`Stop Loss: ${config.stopLoss * 100}%`);
        console.log(`Take Profit: ${config.takeProfit * 100}%`);
        console.log('------------------------------------');
        
        // Initialize services and strategies
        const binanceService = new BinanceService();
        await binanceService.initialize();
        
        const turtleStrategy = new TurtleTradingStrategy();
        await turtleStrategy.initialize();
        
        const adaptiveMomentumStrategy = new AdaptiveMomentumStrategy();
        await adaptiveMomentumStrategy.initialize();
        
        // Results for each strategy
        const results = {
            TurtleTradingStrategy: {},
            AdaptiveMomentumStrategy: {}
        };
        
        // Run backtest for each symbol
        for (const symbol of config.symbols) {
            console.log(`Backtesting ${symbol}...`);
            
            // Fetch historical data
            const candles = await fetchHistoricalData(
                binanceService,
                symbol,
                config.timeframe,
                config.startDate,
                config.endDate
            );
            
            if (candles.length === 0) {
                console.warn(`No data available for ${symbol}, skipping...`);
                continue;
            }
            
            console.log(`Fetched ${candles.length} candles for ${symbol}`);
            
            // Run strategies
            const turtleResult = await backtestStrategy(turtleStrategy, symbol, candles);
            const adaptiveResult = await backtestStrategy(adaptiveMomentumStrategy, symbol, candles);
            
            // Store results
            results.TurtleTradingStrategy[symbol] = turtleResult.summary;
            results.AdaptiveMomentumStrategy[symbol] = adaptiveResult.summary;
            
            // Display symbol results
            console.log(`${symbol} Results:`);
            console.log(`  Turtle Trading Strategy:`);
            console.log(`    Net Profit: $${turtleResult.netProfit.toFixed(2)} (${turtleResult.netProfitPercent.toFixed(2)}%)`);
            console.log(`    Win Rate: ${turtleResult.winRate.toFixed(2)}% (${turtleResult.winCount}/${turtleResult.totalTrades})`);
            console.log(`    Profit Factor: ${turtleResult.profitFactor.toFixed(2)}`);
            console.log(`    Max Drawdown: ${turtleResult.maxDrawdown.toFixed(2)}%`);
            console.log(`    Signal Count: ${turtleResult.signalCount}`);
            
            console.log(`  Adaptive Momentum Strategy:`);
            console.log(`    Net Profit: $${adaptiveResult.netProfit.toFixed(2)} (${adaptiveResult.netProfitPercent.toFixed(2)}%)`);
            console.log(`    Win Rate: ${adaptiveResult.winRate.toFixed(2)}% (${adaptiveResult.winCount}/${adaptiveResult.totalTrades})`);
            console.log(`    Profit Factor: ${adaptiveResult.profitFactor.toFixed(2)}`);
            console.log(`    Max Drawdown: ${adaptiveResult.maxDrawdown.toFixed(2)}%`);
            console.log(`    Signal Count: ${adaptiveResult.signalCount}`);
            
            console.log('------------------------------------');
        }
        
        // Calculate and display aggregate results
        const aggregateResults = {};
        
        for (const strategyName in results) {
            aggregateResults[strategyName] = {
                strategyName,
                initialCapital: config.initialCapital * config.symbols.length,
                finalCapital: 0,
                netProfit: 0,
                netProfitPercent: 0,
                totalTrades: 0,
                winCount: 0,
                loseCount: 0,
                winRate: 0,
                profitFactor: 0,
                maxDrawdown: 0,
                signalCount: 0
            };
            
            let symbolCount = 0;
            
            for (const symbol in results[strategyName]) {
                const result = results[strategyName][symbol];
                symbolCount++;
                
                aggregateResults[strategyName].finalCapital += result.finalCapital;
                aggregateResults[strategyName].netProfit += result.netProfit;
                aggregateResults[strategyName].totalTrades += result.totalTrades;
                aggregateResults[strategyName].winCount += result.winCount;
                aggregateResults[strategyName].loseCount += result.loseCount;
                aggregateResults[strategyName].maxDrawdown = Math.max(aggregateResults[strategyName].maxDrawdown, result.maxDrawdown);
                aggregateResults[strategyName].signalCount += result.signalCount;
            }
            
            if (symbolCount > 0) {
                aggregateResults[strategyName].netProfitPercent = (aggregateResults[strategyName].netProfit / aggregateResults[strategyName].initialCapital) * 100;
                aggregateResults[strategyName].winRate = aggregateResults[strategyName].totalTrades > 0 ? 
                    (aggregateResults[strategyName].winCount / aggregateResults[strategyName].totalTrades) * 100 : 0;
                
                // Calculate aggregate profit factor
                const totalWinProfit = Object.values(results[strategyName])
                    .reduce((sum, result) => sum + (result.winCount > 0 ? result.netProfit * (result.winCount / result.totalTrades) : 0), 0);
                
                const totalLossMagnitude = Object.values(results[strategyName])
                    .reduce((sum, result) => sum + (result.loseCount > 0 ? -result.netProfit * (result.loseCount / result.totalTrades) : 0), 0);
                
                aggregateResults[strategyName].profitFactor = totalLossMagnitude > 0 ? 
                    totalWinProfit / totalLossMagnitude : totalWinProfit > 0 ? Infinity : 0;
            }
        }
        
        // Display aggregate results
        console.log('Aggregate Results:');
        for (const strategyName in aggregateResults) {
            const result = aggregateResults[strategyName];
            console.log(`${strategyName}:`);
            console.log(`  Net Profit: $${result.netProfit.toFixed(2)} (${result.netProfitPercent.toFixed(2)}%)`);
            console.log(`  Win Rate: ${result.winRate.toFixed(2)}% (${result.winCount}/${result.totalTrades})`);
            console.log(`  Profit Factor: ${result.profitFactor.toFixed(2)}`);
            console.log(`  Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);
            console.log(`  Signal Count: ${result.signalCount}`);
            console.log('------------------------------------');
        }
        
        // Save results to file
        const resultsDir = path.join(__dirname, '../../backtestResults');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const resultsPath = path.join(resultsDir, `backtest_results_${timestamp}.json`);
        
        fs.writeFileSync(resultsPath, JSON.stringify({
            config,
            symbolResults: results,
            aggregateResults
        }, null, 2));
        
        console.log(`Results saved to ${resultsPath}`);
        
    } catch (error) {
        console.error('Error running backtest:', error);
    }
}

// Run the backtest
runBacktest();