# Binance Futures Trading Bot

Bu bot, Binance Futures piyasasında otomatik alım-satım yapan gelişmiş bir trading botudur.

## Yeni Özellikler (v3.0)

- **Turtle Trading Stratejisi**: Donchian Kanalları kullanarak kırılma (breakout) sinyalleri üretir
- **Gelişmiş Piyasa Analizi**: Kırılma tespiti, aralık uzunluğu ve volatilite değişimini analiz eder
- **Daha Akıllı Strateji Seçimi**: Ağırlık tabanlı strateji seçim sistemi ve özel kurallar

## Yeni Özellikler (v2.0)

- **Çoklu Zaman Dilimi Analizi**: Birden fazla zaman dilimini (5d, 15d, 1s, 4s) analiz ederek daha güçlü sinyaller üretir
- **Adaptif Strateji Seçimi**: Piyasa koşullarına göre (trend, yatay, dalgalı) en uygun stratejiyi dinamik olarak seçer
- **Gelişmiş Pozisyon Yönetimi**: Trailing stop, başabaş seviyesi ve dinamik pozisyon boyutlandırma içerir
- **Piyasa Bağlamı Farkındalığı**: Daha iyi alım-satım kararları vermek için piyasa volatilitesini, trend gücünü ve hacmi analiz eder
- **Gelişmiş Risk Yönetimi**: Maksimum drawdown koruması, dinamik stop loss ve uygun pozisyon boyutlandırma uygular
- **Teknik Göstergeler**: Bollinger Bantları, RSI, MACD, ADX, ATR ve Stokastik dahil olmak üzere birden fazla gösterge kullanır
- **Telegram Bildirimleri**: Tüm alım-satım aktiviteleri ve piyasa koşulları için detaylı uyarılar gönderir

## Eski Özellikler

- Destek ve direnç bölgelerini otomatik tespit
- Birden fazla strateji desteği (Destek/Direnç ve Trend Takip)
- Tüm işlem çiftlerini otomatik tarama
- Risk yönetimi
- Detaylı loglama

## Mimari

Sistem aşağıdaki ana bileşenlerden oluşur:

1. **MarketScanner**: Alım-satım fırsatları için tüm USDT Futures çiftlerini tarar
2. **MultiTimeframeService**: Daha güçlü sinyaller için birden fazla zaman dilimini analiz eder
3. **AdaptiveStrategy**: Piyasa koşullarına göre uygun stratejiyi seçer
4. **EnhancedPositionManager**: Trailing stop ve başabaş fonksiyonlarıyla açık pozisyonları yönetir
5. **BinanceService**: Binance API ile tüm etkileşimleri işler
6. **OrderService**: Uygun risk yönetimi ile emirleri yerleştirir ve yönetir

## Stratejiler

Bot, piyasa koşullarına göre farklı stratejiler arasında dinamik olarak geçiş yapabilir:

- **Bollinger Stratejisi**: Yatay piyasalar için kullanılır, Bollinger Bantlarından sıçramalarla işlem yapar
- **Trend Takip Stratejisi**: ADX onayıyla güçlü trenli piyasalar için kullanılır
- **Momentum Stratejisi**: Güçlü yönlü hareketleri olan volatil piyasalar için kullanılır
- **Turtle Trading Stratejisi**: Breakout (kırılma) trading için kullanılır, Donchian Kanallarını kullanır

### Turtle Trading Stratejisi Açıklaması

Turtle Trading, 1980'lerde Richard Dennis ve William Eckhardt tarafından geliştirilen ünlü bir trend takip stratejisidir. Bu stratejinin temel mantığı şudur:

1. **Giriş Kuralı**: Fiyat son 20 günün en yüksek seviyesini geçerse LONG, son 20 günün en düşük seviyesini geçerse SHORT pozisyon açılır (Donchian Channel breakout)
2. **Çıkış Kuralı**: Fiyat son 10 günün en düşük seviyesinin altına düşerse LONG pozisyondan çıkılır, son 10 günün en yüksek seviyesinin üzerine çıkarsa SHORT pozisyondan çıkılır
3. **Pozisyon Boyutu**: ATR (Average True Range) tabanlı risk yönetimi kullanılır

Bu bot, Turtle Trading'in modern bir adaptasyonunu kullanır ve piyasa koşullarına göre bu stratejiyi dinamik olarak uygular. Özellikle uzun süre yatay seyrettikten sonra bir kırılma (breakout) oluştuğunda etkilidir.

## Kurulum

1. Repoyu klonlayın
2. Gerekli paketleri yükleyin:
   ```bash
   npm install
   ```
3. `.env` dosyasını düzenleyin ve Binance API bilgilerinizi ekleyin:

```
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
USE_TESTNET=true  # Gerçek işlemler için false olarak değiştirin
```

4. `src/config/config.js` dosyasında alım-satım parametrelerini yapılandırın
5. Botu başlatın:
   ```bash
   node index.js
   ```

## Loglar

- `error.log`: Hata logları
- `combined.log`: Tüm işlem logları

## Risk Uyarısı

Bu bot yalnızca eğitim amaçlı olarak sağlanmıştır. Kripto para ticareti önemli risk içerir ve herkes için uygun olmayabilir. Botun stratejileri kârları garanti etmez ve kayıplara neden olabilir. Her zaman uygun risk yönetimi kullanın ve yalnızca kaybetmeyi göze alabileceğiniz fonlarla işlem yapın.

## Uyarı

Bu bot finansal tavsiye vermez. Tüm trading işlemleri kendi sorumluluğunuzdadır.