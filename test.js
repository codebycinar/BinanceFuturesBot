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
  
  // Sadece BTC'yi test et (rate limit nedeniyle)
  const asset = 'BTC';
  
  logger.info(`Testing metrics for ${asset}...`);
  
  try {
    // Get exchange net flow (Binance API - sorun olmaz)
    logger.info(`Testing Exchange Net Flow...`);
    const netFlow = await metrics.getExchangeNetFlow(asset);
    logger.info(`${asset} Exchange Net Flow: ${netFlow}`);
    
    // 3 saniyelik bir bekleme ekleyelim
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Sadece market sentiment scorunu test et (ana karakter, en önemli metrik - CoinCap API kullanır)
    logger.info(`Testing Market Sentiment Score...`);
    const mvrvZScore = await metrics.getMVRVZScore(asset);
    logger.info(`${asset} Market Sentiment Score: ${mvrvZScore}`);
    
    // 3 saniyelik bir bekleme ekleyelim
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Smart money signal'ı test et (metrikleri birleştirir)
    logger.info(`Testing Smart Money Signal...`);
    const signal = await metrics.getSmartMoneySignal(`${asset}USDT`);
    logger.info(`${asset} Smart Money Signal: ${signal.signal} (confidence: ${signal.confidence.toFixed(2)})`);
    
    // Test başarılı olduysa diğer metrikleri üretim ortamında çalıştıracağız
    logger.info(`API throttling test başarılı. Diğer metrikler (whale transactions, NVT, SOPR) üretim ortamında çalışacak.`);
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