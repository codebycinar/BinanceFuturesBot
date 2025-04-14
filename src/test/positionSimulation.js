// Position management simulation for Turtle Trading Strategy
const config = require('../config/config');

// Settings
const initialBalance = 10000; // $10k account
const symbol = 'BTCUSDT';
const startPrice = 60000; // Starting price
const days = 60; // Longer simulation (60 days)
const volatility = 0.03; // 3% daily volatility (higher to generate more signals)
// Use more sensitive channel parameters for the simulation
const entryChannel = 10; // Shorter entry channel (instead of 20)
const exitChannel = 5; // Shorter exit channel (instead of 10)
const atrPeriod = config.turtleStrategy.atrPeriod || 14;
const atrMultiplier = config.turtleStrategy.atrMultiplier || 2;
const profitMultiplier = config.turtleStrategy.profitMultiplier || 3;
const riskPercentage = config.turtleStrategy.riskPercentage || 1;
const maxEntries = config.turtleStrategy.maxEntries || 4;
const useBreakEven = config.turtleStrategy.useBreakEven || false;
const breakEvenActivationPercent = config.turtleStrategy.breakEvenActivationPercent || 0.8;

// Class to simulate price data
class PriceSimulator {
    constructor(startPrice, volatility) {
        this.currentPrice = startPrice;
        this.volatility = volatility;
        this.prices = [startPrice];
        this.highs = [startPrice * 1.005];
        this.lows = [startPrice * 0.995];
    }
    
    // Simulate next day's price
    nextDay(trendBias = 0) {
        // Random walk with trend bias
        const dailyChange = this.currentPrice * (trendBias + (Math.random() - 0.5) * this.volatility);
        this.currentPrice += dailyChange;
        this.prices.push(this.currentPrice);
        
        // Generate high and low for the day
        const dayHigh = this.currentPrice * (1 + Math.random() * 0.005);
        const dayLow = this.currentPrice * (1 - Math.random() * 0.005);
        this.highs.push(dayHigh);
        this.lows.push(dayLow);
        
        return this.currentPrice;
    }
    
    // Get last n prices
    getLast(n) {
        return this.prices.slice(-n);
    }
    
    // Get last n highs
    getLastHighs(n) {
        return this.highs.slice(-n);
    }
    
    // Get last n lows
    getLastLows(n) {
        return this.lows.slice(-n);
    }
    
    // Get current price
    getPrice() {
        return this.currentPrice;
    }
}

// Class to simulate a position
class Position {
    constructor(symbol, side, entryPrice, stopLoss, takeProfit, size) {
        this.symbol = symbol;
        this.side = side; // 'LONG' or 'SHORT'
        this.entries = [{ price: entryPrice, quantity: size }];
        this.stopLoss = stopLoss;
        this.originalStopLoss = stopLoss;
        this.takeProfit = takeProfit;
        this.isActive = true;
        this.entryTime = new Date();
        this.currentPrice = entryPrice;
        this.highestPrice = side === 'LONG' ? entryPrice : -Infinity;
        this.lowestPrice = side === 'SHORT' ? entryPrice : Infinity;
        this.breakEvenActivated = false;
    }
    
    // Add to position
    addEntry(price, quantity) {
        this.entries.push({ price, quantity });
        
        // Update highest/lowest tracking
        if (this.side === 'LONG' && price > this.highestPrice) {
            this.highestPrice = price;
        }
        if (this.side === 'SHORT' && price < this.lowestPrice) {
            this.lowestPrice = price;
        }
    }
    
    // Get average entry price
    getAvgEntryPrice() {
        const totalValue = this.entries.reduce((sum, entry) => sum + (entry.price * entry.quantity), 0);
        const totalQuantity = this.entries.reduce((sum, entry) => sum + entry.quantity, 0);
        return totalValue / totalQuantity;
    }
    
    // Get total position size
    getPositionSize() {
        return this.entries.reduce((sum, entry) => sum + entry.quantity, 0);
    }
    
    // Update current price
    updatePrice(price) {
        this.currentPrice = price;
        
        // Update highest/lowest tracking
        if (this.side === 'LONG' && price > this.highestPrice) {
            this.highestPrice = price;
        }
        if (this.side === 'SHORT' && price < this.lowestPrice) {
            this.lowestPrice = price;
        }
        
        // Check for break-even activation
        if (useBreakEven && !this.breakEvenActivated) {
            const entryPrice = this.getAvgEntryPrice();
            const currentProfit = this.side === 'LONG' ? 
                (price - entryPrice) : (entryPrice - price);
            const breakEvenThreshold = Math.abs(entryPrice - this.originalStopLoss) * breakEvenActivationPercent;
            
            if (currentProfit >= breakEvenThreshold) {
                // Move stop loss to break even
                this.stopLoss = entryPrice;
                this.breakEvenActivated = true;
                console.log(`Day ${currentDay}: Break-even activated for ${this.symbol} ${this.side} position. Stop loss moved to ${this.stopLoss.toFixed(2)}`);
            }
        }
        
        // Check stop loss and take profit
        const stopLossHit = this.side === 'LONG' ? price <= this.stopLoss : price >= this.stopLoss;
        const takeProfitHit = this.side === 'LONG' ? price >= this.takeProfit : price <= this.takeProfit;
        
        if (stopLossHit) {
            this.isActive = false;
            this.exitReason = 'Stop Loss';
            this.exitPrice = this.stopLoss;
            this.exitTime = new Date();
        } else if (takeProfitHit) {
            this.isActive = false;
            this.exitReason = 'Take Profit';
            this.exitPrice = this.takeProfit;
            this.exitTime = new Date();
        }
        
        return this.isActive; // Return false if position was closed
    }
    
    // Check if exit signal hit (Donchian channel exit)
    checkExitSignal(exitDonchian) {
        if (!this.isActive) return false;
        
        if (this.side === 'LONG' && this.currentPrice <= exitDonchian.lower) {
            this.isActive = false;
            this.exitReason = 'Exit Signal (Donchian)';
            this.exitPrice = this.currentPrice;
            this.exitTime = new Date();
            return true;
        } else if (this.side === 'SHORT' && this.currentPrice >= exitDonchian.upper) {
            this.isActive = false;
            this.exitReason = 'Exit Signal (Donchian)';
            this.exitPrice = this.currentPrice;
            this.exitTime = new Date();
            return true;
        }
        
        return false;
    }
    
    // Calculate current profit/loss
    getPnL() {
        const avgEntry = this.getAvgEntryPrice();
        let pnl;
        
        if (!this.isActive && this.exitPrice) {
            // Closed position PnL
            pnl = this.side === 'LONG' ?
                (this.exitPrice - avgEntry) / avgEntry * 100 :
                (avgEntry - this.exitPrice) / avgEntry * 100;
        } else {
            // Open position PnL
            pnl = this.side === 'LONG' ?
                (this.currentPrice - avgEntry) / avgEntry * 100 :
                (avgEntry - this.currentPrice) / avgEntry * 100;
        }
        
        return pnl;
    }
    
    getPnLAmount() {
        const pnlPercent = this.getPnL();
        const totalValue = this.getPositionSize() * this.getAvgEntryPrice();
        return (pnlPercent / 100) * totalValue;
    }
}

// Helper functions
function calculateDonchianChannel(highs, lows, period) {
    if (highs.length < period || lows.length < period) {
        throw new Error('Not enough data to calculate Donchian Channels');
    }
    
    const highSlice = highs.slice(-period);
    const lowSlice = lows.slice(-period);
    
    const highest = Math.max(...highSlice);
    const lowest = Math.min(...lowSlice);
    
    return {
        upper: highest,
        lower: lowest,
        middle: (highest + lowest) / 2
    };
}

function calculateATR(prices, highs, lows, period) {
    if (prices.length < period + 1) {
        throw new Error('Not enough data to calculate ATR');
    }
    
    const trValues = [];
    
    // Calculate True Range values
    for (let i = 1; i < prices.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = prices[i - 1];
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        
        trValues.push(tr);
    }
    
    // Calculate Average True Range
    const relevantTR = trValues.slice(-period);
    const atr = relevantTR.reduce((sum, tr) => sum + tr, 0) / period;
    
    return atr;
}

// Initialize the simulation
const priceSimulator = new PriceSimulator(startPrice, volatility);
let balance = initialBalance;
let positions = [];
let closedPositions = [];
let currentDay = 0;

// Run the simulation
console.log('Starting Turtle Trading Strategy Simulation');
console.log('=================================');
console.log(`Initial Balance: $${balance.toFixed(2)}`);
console.log(`Symbol: ${symbol}`);
console.log(`Starting Price: $${startPrice.toFixed(2)}`);
console.log(`Simulation Days: ${days}`);
console.log(`Risk per trade: ${riskPercentage}%`);
console.log(`ATR Multiplier: ${atrMultiplier}`);
console.log(`Profit Multiplier: ${profitMultiplier}`);
console.log(`Max Entries per Position: ${maxEntries}`);
console.log(`Break-Even Feature: ${useBreakEven ? 'Enabled' : 'Disabled'}`);
console.log('=================================');

// Generate 20 days of price data first to have enough history
for (let i = 0; i < 20; i++) {
    priceSimulator.nextDay(0.002); // Stronger upward bias to create breakouts
}

// Start simulation
while (currentDay < days) {
    currentDay++;
    
    // Generate next day's price with more pronounced trends
    const price = priceSimulator.nextDay(
        currentDay < days / 3 ? 0.004 : // Strong uptrend first third
        currentDay < days * 2/3 ? -0.004 : // Strong downtrend second third
        0.002 // Modest uptrend final third
    );
    
    console.log(`\n=== Day ${currentDay} ===`);
    console.log(`Current Price: $${price.toFixed(2)}`);
    
    // Calculate indicators
    const entryDonchian = calculateDonchianChannel(
        priceSimulator.getLastHighs(entryChannel),
        priceSimulator.getLastLows(entryChannel),
        entryChannel
    );
    
    const exitDonchian = calculateDonchianChannel(
        priceSimulator.getLastHighs(exitChannel),
        priceSimulator.getLastLows(exitChannel),
        exitChannel
    );
    
    const atr = calculateATR(
        priceSimulator.getLast(atrPeriod + 1),
        priceSimulator.getLastHighs(atrPeriod + 1),
        priceSimulator.getLastLows(atrPeriod + 1),
        atrPeriod
    );
    
    // Update existing positions
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i];
        const isStillActive = position.updatePrice(price);
        
        // Check for Donchian channel exit signal
        const exitSignal = position.checkExitSignal(exitDonchian);
        
        if (!isStillActive || exitSignal) {
            const pnl = position.getPnL();
            const pnlAmount = position.getPnLAmount();
            
            // Update balance
            balance += pnlAmount;
            
            console.log(`Closed ${position.side} position on ${symbol} (${position.exitReason})`);
            console.log(`PnL: ${pnl.toFixed(2)}% ($${pnlAmount.toFixed(2)})`);
            console.log(`New Balance: $${balance.toFixed(2)}`);
            
            // Add to closed positions
            closedPositions.push(position);
            
            // Remove from active positions
            positions.splice(i, 1);
            i--; // Adjust index since we removed an element
        }
    }
    
    // Check for new entry signals
    let activePositionCount = positions.length;
    
    // Entry condition - breakout of Donchian channel
    if (price > entryDonchian.upper && activePositionCount < 1) {
        console.log(`LONG signal detected: Price (${price.toFixed(2)}) > Entry Upper (${entryDonchian.upper.toFixed(2)})`);
        
        const positionSize = balance * (riskPercentage / 100) / atr / atrMultiplier * price;
        const stopLoss = price - (atr * atrMultiplier);
        const takeProfit = price + (atr * atrMultiplier * profitMultiplier);
        
        const position = new Position(symbol, 'LONG', price, stopLoss, takeProfit, positionSize / price);
        positions.push(position);
        
        console.log(`Opened LONG position: ${positionSize.toFixed(8)} BTC ($${(positionSize * price).toFixed(2)} USD)`);
        console.log(`Entry Price: $${price.toFixed(2)}`);
        console.log(`Stop Loss: $${stopLoss.toFixed(2)} (${((stopLoss - price) / price * 100).toFixed(2)}%)`);
        console.log(`Take Profit: $${takeProfit.toFixed(2)} (${((takeProfit - price) / price * 100).toFixed(2)}%)`);
        
    } else if (price < entryDonchian.lower && activePositionCount < 1) {
        console.log(`SHORT signal detected: Price (${price.toFixed(2)}) < Entry Lower (${entryDonchian.lower.toFixed(2)})`);
        
        const positionSize = balance * (riskPercentage / 100) / atr / atrMultiplier * price;
        const stopLoss = price + (atr * atrMultiplier);
        const takeProfit = price - (atr * atrMultiplier * profitMultiplier);
        
        const position = new Position(symbol, 'SHORT', price, stopLoss, takeProfit, positionSize / price);
        positions.push(position);
        
        console.log(`Opened SHORT position: ${positionSize.toFixed(8)} BTC ($${(positionSize * price).toFixed(2)} USD)`);
        console.log(`Entry Price: $${price.toFixed(2)}`);
        console.log(`Stop Loss: $${stopLoss.toFixed(2)} (${((stopLoss - price) / price * 100).toFixed(2)}%)`);
        console.log(`Take Profit: $${takeProfit.toFixed(2)} (${((takeProfit - price) / price * 100).toFixed(2)}%)`);
    }
    
    // Pyramiding - add to existing positions if trending favorably
    for (let position of positions) {
        const entryCount = position.entries.length;
        
        // Check if we've reached max entries
        if (entryCount >= maxEntries) continue;
        
        // Only add every 3 days (simplified version of checking for new timeframe)
        if (currentDay % 3 !== 0) continue;
        
        // For LONG positions - if price is making new highs
        if (position.side === 'LONG' && price > position.highestPrice * 1.01) {
            console.log(`Adding to LONG position (Entry #${entryCount + 1}): New high price detected`);
            
            const additionalSize = balance * (riskPercentage / 100) / 2; // Use half risk for pyramiding
            position.addEntry(price, additionalSize / price);
            
            console.log(`Added ${additionalSize.toFixed(2)} USD to position at price $${price.toFixed(2)}`);
        }
        // For SHORT positions - if price is making new lows
        else if (position.side === 'SHORT' && price < position.lowestPrice * 0.99) {
            console.log(`Adding to SHORT position (Entry #${entryCount + 1}): New low price detected`);
            
            const additionalSize = balance * (riskPercentage / 100) / 2; // Use half risk for pyramiding
            position.addEntry(price, additionalSize / price);
            
            console.log(`Added ${additionalSize.toFixed(2)} USD to position at price $${price.toFixed(2)}`);
        }
    }
    
    // Display summary of active positions
    if (positions.length > 0) {
        console.log('\nActive Positions:');
        for (const position of positions) {
            const pnl = position.getPnL();
            const pnlAmount = position.getPnLAmount();
            console.log(`${position.side} ${position.symbol}: ${position.entries.length} entries, PnL: ${pnl.toFixed(2)}% ($${pnlAmount.toFixed(2)})`);
        }
    } else {
        console.log('\nNo active positions');
    }
}

// Final summary
console.log('\n=================================');
console.log('Simulation Complete');
console.log('=================================');
console.log(`Final Balance: $${balance.toFixed(2)}`);
console.log(`Profit/Loss: $${(balance - initialBalance).toFixed(2)} (${((balance - initialBalance) / initialBalance * 100).toFixed(2)}%)`);
console.log(`Total Trades: ${closedPositions.length}`);

// Calculate win rate
const winningTrades = closedPositions.filter(p => p.getPnL() > 0);
const winRate = winningTrades.length / closedPositions.length * 100;
console.log(`Win Rate: ${winRate.toFixed(2)}% (${winningTrades.length}/${closedPositions.length})`);

// Calculate average profit/loss
const profitSum = closedPositions.reduce((sum, p) => sum + p.getPnL(), 0);
const avgProfit = profitSum / closedPositions.length;
console.log(`Average Profit/Loss: ${avgProfit.toFixed(2)}%`);

// Calculate profit factor
const grossProfit = winningTrades.reduce((sum, p) => sum + p.getPnLAmount(), 0);
const losingTrades = closedPositions.filter(p => p.getPnL() <= 0);
const grossLoss = Math.abs(losingTrades.reduce((sum, p) => sum + p.getPnLAmount(), 0));
const profitFactor = grossProfit / (grossLoss || 1); // Avoid division by zero
console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);

// Log individual trade details
console.log('\n=================================');
console.log('Trade Details:');
console.log('=================================');
closedPositions.forEach((p, index) => {
    const duration = (p.exitTime - p.entryTime) / (1000 * 60 * 60 * 24); // days
    console.log(`Trade #${index + 1}: ${p.side} ${p.symbol}`);
    console.log(`Entries: ${p.entries.length}, Avg Entry: $${p.getAvgEntryPrice().toFixed(2)}`);
    console.log(`Exit: $${p.exitPrice.toFixed(2)} (${p.exitReason})`);
    console.log(`PnL: ${p.getPnL().toFixed(2)}% ($${p.getPnLAmount().toFixed(2)})`);
    console.log(`Duration: ${duration.toFixed(1)} days`);
    console.log(`Break-Even Activated: ${p.breakEvenActivated ? 'Yes' : 'No'}`);
    console.log('-------------------');
});