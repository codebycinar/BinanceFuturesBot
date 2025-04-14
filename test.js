/**
 * OnchainMetricsService Test
 * 
 * Bu script, OnchainMetricsService'in düzgün çalışıp çalışmadığını test eder
 * ve CoinCap API key entegrasyonunu kontrol eder.
 */

const OnchainMetricsService = require('./src/services/OnchainMetricsService');
const logger = require('./src/utils/logger');

async function testOnchainMetrics() {
  logger.info('Starting OnchainMetrics test with CoinCap API key...');
  
  const metrics = new OnchainMetricsService();
  
  // Sadece BTC'yi test et
  const asset = 'BTC';
  
  logger.info(`Testing metrics for ${asset}...`);
  
  try {
    // Get exchange net flow (Binance API - sorun olmaz)
    logger.info(`Testing Exchange Net Flow...`);
    const netFlow = await metrics.getExchangeNetFlow(asset);
    logger.info(`${asset} Exchange Net Flow: ${netFlow}`);
    
    // 3 saniyelik bir bekleme ekleyelim
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Market sentiment scorunu test et
    logger.info(`Testing Market Sentiment Score...`);
    const mvrvZScore = await metrics.getMVRVZScore(asset);
    logger.info(`${asset} Market Sentiment Score: ${mvrvZScore}`);
    
    // 3 saniyelik bir bekleme ekleyelim
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Whale aktivitesini test et
    logger.info(`Testing Whale Activity...`);
    const whaleActivity = await metrics.getWhaleTransactions(asset);
    logger.info(`${asset} Whale Activity: ${whaleActivity}`);
    
    // 3 saniyelik bir bekleme ekleyelim
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Smart money signal'ı test et
    logger.info(`Testing Smart Money Signal...`);
    const signal = await metrics.getSmartMoneySignal(`${asset}USDT`);
    logger.info(`${asset} Smart Money Signal: ${signal.signal} (confidence: ${signal.confidence.toFixed(2)})`);
    
    // API çağrı sayısını göster
    logger.info(`CoinCap API Call Count: ${metrics.apiCallCount.coincap}`);
    logger.info(`Test completed successfully with CoinCap API key`);
  } catch (error) {
    logger.error(`Error testing metrics for ${asset}: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
  }
  
  logger.info('OnchainMetrics test completed');
}

// Run the test
testOnchainMetrics().catch(err => {
  logger.error(`Test failed: ${err.message}`);
});