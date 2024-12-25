/**
 * Calculates stop loss price based on position type and support/resistance levels
 */
const calculateStopLoss = (positionType, entryPrice, levels) => {
  if (!levels || levels.length === 0) {
    // If no levels found, use default 2% stop loss
    const stopDistance = entryPrice * 0.02;
    return positionType === 'LONG' 
      ? entryPrice - stopDistance 
      : entryPrice + stopDistance;
  }

  // Find nearest level for stop loss
  const nearestLevel = levels.reduce((nearest, level) => {
    if (positionType === 'LONG' && level.price < entryPrice) {
      return !nearest || level.price > nearest.price ? level : nearest;
    } else if (positionType === 'SHORT' && level.price > entryPrice) {
      return !nearest || level.price < nearest.price ? level : nearest;
    }
    return nearest;
  }, null);

  if (!nearestLevel) {
    // If no suitable level found, use default stop loss
    const stopDistance = entryPrice * 0.02;
    return positionType === 'LONG' 
      ? entryPrice - stopDistance 
      : entryPrice + stopDistance;
  }

  // Add small buffer to the level
  const buffer = entryPrice * 0.002; // 0.2% buffer
  return positionType === 'LONG' 
    ? nearestLevel.price - buffer 
    : nearestLevel.price + buffer;
};

/**
 * Calculates take profit price based on position type and support/resistance levels
 */
const calculateTakeProfit = (positionType, entryPrice, levels) => {
  if (!levels || levels.length === 0) {
    // If no levels found, use default 3% take profit
    const profitDistance = entryPrice * 0.03;
    return positionType === 'LONG' 
      ? entryPrice + profitDistance 
      : entryPrice - profitDistance;
  }

  // Find nearest level for take profit
  const nearestLevel = levels.reduce((nearest, level) => {
    if (positionType === 'LONG' && level.price > entryPrice) {
      return !nearest || level.price < nearest.price ? level : nearest;
    } else if (positionType === 'SHORT' && level.price < entryPrice) {
      return !nearest || level.price > nearest.price ? level : nearest;
    }
    return nearest;
  }, null);

  if (!nearestLevel) {
    // If no suitable level found, use default take profit
    const profitDistance = entryPrice * 0.03;
    return positionType === 'LONG' 
      ? entryPrice + profitDistance 
      : entryPrice - profitDistance;
  }

  // Add small buffer to the level
  const buffer = entryPrice * 0.002; // 0.2% buffer
  return positionType === 'LONG' 
    ? nearestLevel.price - buffer 
    : nearestLevel.price + buffer;
};

module.exports = {
  calculateStopLoss,
  calculateTakeProfit
};
