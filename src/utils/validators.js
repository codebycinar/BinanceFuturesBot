const validateApiCredentials = (apiKey, apiSecret) => {
    if (!apiKey || !apiSecret) {
      throw new Error(
        'API credentials are missing. Please add your Binance API credentials to the .env file:\n\n' +
        'BINANCE_API_KEY=your_actual_api_key\n' +
        'BINANCE_API_SECRET=your_actual_api_secret\n'
      );
    }
    
    if (apiKey === 'your_api_key_here' || apiSecret === 'your_api_secret_here') {
      throw new Error(
        'Please replace the default API credentials in .env with your actual Binance API keys.\n\n' +
        'To get your API keys:\n' +
        '1. Log in to your Binance account\n' +
        '2. Go to API Management\n' +
        '3. Create a new API key\n' +
        '4. Copy the API key and secret to your .env file\n\n' +
        'Make sure to enable Futures trading permissions for your API key!'
      );
    }
  
    // Validate API key format
    if (!/^[A-Za-z0-9]{64}$/.test(apiKey)) {
      throw new Error(
        'Invalid API key format. Binance API keys should be 64 characters long and contain only letters and numbers.\n' +
        'Please check your API key in the .env file.'
      );
    }
  
    // Validate API secret format
    if (!/^[A-Za-z0-9]{64}$/.test(apiSecret)) {
      throw new Error(
        'Invalid API secret format. Binance API secrets should be 64 characters long and contain only letters and numbers.\n' +
        'Please check your API secret in the .env file.'
      );
    }
  };
  
  const validateBalance = (balance) => {
    if (!balance || !balance.availableBalance) {
      throw new Error('Could not retrieve account balance. Please check your API permissions and ensure you have funds in your Futures wallet.');
    }
    return parseFloat(balance.availableBalance);
  };
  
  module.exports = {
    validateApiCredentials,
    validateBalance
  };