const INTERVALS = {
    POSITION_CHECK: 30 * 1000, // 30 seconds
    MARKET_SCAN: 5 * 60 * 1000  // 5 minutes
  };
  
  const TRADE_SIGNALS = {
    LONG: 'LONG',
    SHORT: 'SHORT',
    NEUTRAL: 'NEUTRAL'
  };
  
  const POSITION_SIDES = {
    BUY: 'BUY',
    SELL: 'SELL'
  };
  
  module.exports = {
    INTERVALS,
    TRADE_SIGNALS,
    POSITION_SIDES
  };