console.log("Testing position size calculation...");
const OrderService = require("./src/services/OrderService");
const config = require("./src/config/config");

// Mock BinanceService
const mockBinanceService = {
  getFuturesBalance: async () => 1000,
  getCurrentPrice: async () => 50000,
  getStepSize: async () => 0.001,
  adjustPrecision: (qty, step) => Math.floor(qty / step) * step,
  roundQuantity: (qty, step) => Math.floor(qty / step) * step,
};

// Create OrderService instance with mock
const orderService = new OrderService(mockBinanceService);

async function testPositionSizeCalculation() {
  // Test with calculate_position_size = false
  config.calculate_position_size = false;
  config.static_position_size = 100;
  
  const staticResult = await orderService.calculatePositionSize("BTCUSDT", 50000);
  console.log("Static position size:", staticResult);
  
  // Test with calculate_position_size = true
  config.calculate_position_size = true;
  config.riskPerTrade = 0.05; // 5% of balance to make it above minimum notional
  
  const dynamicResult = await orderService.calculatePositionSize("BTCUSDT", 50000);
  console.log("Dynamic position size:", dynamicResult);
  
  // Test calculateStaticPositionSize method with a valid allocation
  const staticSize = await orderService.calculateStaticPositionSize("BTCUSDT", 150);
  console.log("Static position size with calculateStaticPositionSize:", staticSize);
}

testPositionSizeCalculation().catch(console.error);
