/**
 * OnchainMetricsService Test
 * 
 * Bu script, OnchainMetricsService'in düzgün çalışıp çalışmadığını test eder
 * ve API throttling mekanizmasını kontrol eder.
 */

const OnchainMetricsService = require('./src/services/OnchainMetricsService');
const logger = require('./src/utils/logger');

async function testOnchainMetrics() {
  logger.info('Starting OnchainMetrics test...');
  
  const metrics = new OnchainMetricsService();
  
  // Test assets
  const assets = ['BTC', 'ETH', 'BNB'];
  
  // Test all methods on each asset
  for (const asset of assets) {
    logger.info(`Testing metrics for ${asset}...`);
    
    try {
      // Get exchange net flow
      const netFlow = await metrics.getExchangeNetFlow(asset);
      logger.info(`${asset} Exchange Net Flow: ${netFlow}`);
      
      // Get whale transactions
      const whaleActivity = await metrics.getWhaleTransactions(asset);
      logger.info(`${asset} Whale Activity: ${whaleActivity}`);
      
      // Get MVRV Z-Score
      const mvrvZScore = await metrics.getMVRVZScore(asset);
      logger.info(`${asset} Market Sentiment Score: ${mvrvZScore}`);
      
      // Get NVT Ratio
      const nvtRatio = await metrics.getNVTRatio(asset);
      logger.info(`${asset} NVT Ratio: ${nvtRatio}`);
      
      // Get SOPR
      const sopr = await metrics.getSOPR(asset);
      logger.info(`${asset} SOPR: ${sopr}`);
      
      // Get smart money signal
      const signal = await metrics.getSmartMoneySignal(`${asset}USDT`);
      logger.info(`${asset} Smart Money Signal: ${signal.signal} (confidence: ${signal.confidence.toFixed(2)})`);
      
    } catch (error) {
      logger.error(`Error testing metrics for ${asset}: ${error.message}`);
    }
    
    // Add a delay between assets to avoid overwhelming APIs
    logger.info(`Waiting 5 seconds before next asset...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  logger.info('OnchainMetrics test completed');
}

// Run the test
testOnchainMetrics().catch(err => {
  logger.error(`Test failed: ${err.message}`);
});