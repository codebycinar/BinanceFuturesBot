const { technicalIndicators } = require('technicalindicators');
const logger = require('../utils/logger');

class SupportResistanceStrategy {
  constructor(candlesticks, period = 20) {
    this.candlesticks = candlesticks;
    this.period = period;
    this.pivotThreshold = 0.002; // 0.2% threshold for pivot points
  }

  findSupportResistanceLevels() {
    if (!this.candlesticks || this.candlesticks.length < this.period * 2) {
      logger.warn('Not enough candlesticks for analysis');
      return { support: [], resistance: [] };
    }

    const highs = this.candlesticks.map(candle => parseFloat(candle.high));
    const lows = this.candlesticks.map(candle => parseFloat(candle.low));
    
    const supportLevels = this.findPivotLows(lows);
    const resistanceLevels = this.findPivotHighs(highs);

    // Group nearby levels
    const groupedSupport = this.groupNearbyLevels(supportLevels);
    const groupedResistance = this.groupNearbyLevels(resistanceLevels);

    return {
      support: groupedSupport,
      resistance: groupedResistance
    };
  }

  findPivotLows(prices) {
    const pivotLows = [];
    const lookback = Math.floor(this.period / 2);

    for (let i = lookback; i < prices.length - lookback; i++) {
      const leftPrices = prices.slice(i - lookback, i);
      const rightPrices = prices.slice(i + 1, i + lookback + 1);
      const currentPrice = prices[i];

      const isLowest = leftPrices.every(p => p > currentPrice) && 
                      rightPrices.every(p => p > currentPrice);

      if (isLowest) {
        // Calculate strength based on how many bars respect this level
        const strength = this.calculatePivotStrength(prices, i, 'support');
        
        pivotLows.push({
          price: currentPrice,
          index: i,
          strength
        });
      }
    }

    return this.filterStrongPivots(pivotLows);
  }

  findPivotHighs(prices) {
    const pivotHighs = [];
    const lookback = Math.floor(this.period / 2);

    for (let i = lookback; i < prices.length - lookback; i++) {
      const leftPrices = prices.slice(i - lookback, i);
      const rightPrices = prices.slice(i + 1, i + lookback + 1);
      const currentPrice = prices[i];

      const isHighest = leftPrices.every(p => p < currentPrice) && 
                       rightPrices.every(p => p < currentPrice);

      if (isHighest) {
        // Calculate strength based on how many bars respect this level
        const strength = this.calculatePivotStrength(prices, i, 'resistance');
        
        pivotHighs.push({
          price: currentPrice,
          index: i,
          strength
        });
      }
    }

    return this.filterStrongPivots(pivotHighs);
  }

  calculatePivotStrength(prices, pivotIndex, type) {
    let touchCount = 0;
    const threshold = prices[pivotIndex] * this.pivotThreshold;
    
    // Look forward from pivot point
    for (let i = pivotIndex + 1; i < prices.length; i++) {
      if (type === 'support' && Math.abs(prices[i] - prices[pivotIndex]) <= threshold) {
        touchCount++;
      } else if (type === 'resistance' && Math.abs(prices[i] - prices[pivotIndex]) <= threshold) {
        touchCount++;
      }
    }

    return touchCount;
  }

  filterStrongPivots(pivots) {
    // Sort by strength and take top 5
    return pivots
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5);
  }

  groupNearbyLevels(levels) {
    if (levels.length === 0) return [];

    const grouped = [];
    let currentGroup = [levels[0]];

    for (let i = 1; i < levels.length; i++) {
      const currentLevel = levels[i];
      const lastInGroup = currentGroup[currentGroup.length - 1];

      // Check if levels are within threshold
      if (Math.abs(currentLevel.price - lastInGroup.price) / lastInGroup.price <= this.pivotThreshold) {
        currentGroup.push(currentLevel);
      } else {
        // Average the prices in current group
        const avgPrice = currentGroup.reduce((sum, level) => sum + level.price, 0) / currentGroup.length;
        const maxStrength = Math.max(...currentGroup.map(level => level.strength));
        
        grouped.push({
          price: avgPrice,
          strength: maxStrength,
          index: currentGroup[0].index
        });

        currentGroup = [currentLevel];
      }
    }

    // Add the last group
    if (currentGroup.length > 0) {
      const avgPrice = currentGroup.reduce((sum, level) => sum + level.price, 0) / currentGroup.length;
      const maxStrength = Math.max(...currentGroup.map(level => level.strength));
      
      grouped.push({
        price: avgPrice,
        strength: maxStrength,
        index: currentGroup[0].index
      });
    }

    return grouped;
  }

  checkSignal(currentPrice, levels) {
    if (!levels.support.length || !levels.resistance.length) {
      return 'NEUTRAL';
    }

    // Find nearest support and resistance
    const nearestSupport = this.findNearestLevel(currentPrice, levels.support);
    const nearestResistance = this.findNearestLevel(currentPrice, levels.resistance);
    
    const supportDistance = Math.abs(currentPrice - nearestSupport.price) / currentPrice;
    const resistanceDistance = Math.abs(currentPrice - nearestResistance.price) / currentPrice;

    // Consider both distance and strength for signal generation
    if (supportDistance < this.pivotThreshold && nearestSupport.strength >= 2) {
      return 'LONG';
    } else if (resistanceDistance < this.pivotThreshold && nearestResistance.strength >= 2) {
      return 'SHORT';
    }
    
    return 'NEUTRAL';
  }

  findNearestLevel(price, levels) {
    return levels.reduce((nearest, level) => {
      const currentDiff = Math.abs(level.price - price);
      const nearestDiff = Math.abs(nearest.price - price);
      return currentDiff < nearestDiff ? level : nearest;
    }, levels[0]);
  }
}

module.exports = SupportResistanceStrategy;