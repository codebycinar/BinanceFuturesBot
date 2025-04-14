require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

async function testBinanceAPI() {
    try {
        const apiKey = process.env.BINANCE_API_KEY;
        const apiSecret = process.env.BINANCE_API_SECRET;
        
        console.log("API Key:", apiKey ? "Defined" : "Undefined");
        console.log("API Secret:", apiSecret ? "Defined" : "Undefined");

        const timestamp = Date.now();
        const params = new URLSearchParams({ timestamp });
        
        const signature = crypto
            .createHmac('sha256', apiSecret)
            .update(params.toString())
            .digest('hex');
        
        params.append('signature', signature);
        
        // Önce exchange bilgilerini almayı deneyelim (public endpoint)
        const publicResponse = await axios({
            method: 'GET',
            url: 'https://fapi.binance.com/fapi/v1/exchangeInfo'
        });
        
        console.log('Public API call successful!');
        
        // Son açık pozisyonları almayı deneyelim
        console.log("Trying to get open positions...");
        try {
            const positionsResponse = await axios({
                method: 'GET',
                url: 'https://fapi.binance.com/fapi/v2/positionRisk',
                headers: { 'X-MBX-APIKEY': apiKey },
                params: new URLSearchParams(params)
            });
            console.log('Positions API call successful!');
            console.log(`Retrieved ${positionsResponse.data.length} positions`);
        } catch (positionsError) {
            console.log('Positions API call failed:');
            if (positionsError.response && positionsError.response.data) {
                console.log(JSON.stringify(positionsError.response.data));
            } else {
                console.log(positionsError.message);
            }
        }
        
        // Balance bilgisini almayı deneyelim
        console.log("Trying to get balance information...");
        try {
            const response = await axios({
                method: 'GET',
                url: 'https://fapi.binance.com/fapi/v2/balance',
                headers: { 'X-MBX-APIKEY': apiKey },
                params: new URLSearchParams(params)
            });
            
            console.log('Balance API call successful!');
            console.log(`Retrieved balance info for ${response.data.length} assets`);
            
            const usdtBalance = response.data.find(asset => asset.asset === 'USDT');
            if (usdtBalance) {
                console.log(`USDT Balance: ${usdtBalance.availableBalance}`);
            }
        } catch (balanceError) {
            console.log('Balance API call failed:');
            if (balanceError.response && balanceError.response.data) {
                console.log(JSON.stringify(balanceError.response.data));
            } else {
                console.log(balanceError.message);
            }
        }
        
        console.log('API Test completed');
        return true;
    } catch (error) {
        console.error('API Test Failed:');
        if (error.response && error.response.data) {
            console.error('API Error Response:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
        return false;
    }
}

testBinanceAPI();