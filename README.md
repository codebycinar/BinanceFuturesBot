# Binance Futures Trading Bot

Bu bot, Binance Futures piyasasında otomatik alım-satım yapan bir trading botudur.

## Özellikler

- Destek ve direnç bölgelerini otomatik tespit
- Birden fazla strateji desteği (Destek/Direnç ve Trend Takip)
- Tüm işlem çiftlerini otomatik tarama
- Risk yönetimi
- Detaylı loglama

## Kurulum

1. Repoyu klonlayın
2. Gerekli paketleri yükleyin:
   ```bash
   npm install
   ```
3. `.env` dosyasını düzenleyin ve Binance API bilgilerinizi ekleyin
4. Botu başlatın:
   ```bash
   npm start
   ```

## Konfigürasyon

`config.js` dosyasından aşağıdaki ayarları düzenleyebilirsiniz:

- İşlem çiftleri
- Risk oranı
- Kaldıraç oranı
- Zaman dilimleri

## Stratejiler

1. Destek/Direnç Stratejisi
   - Pivot noktalarını kullanarak destek ve direnç seviyelerini belirler
   - Bu seviyelere yaklaşıldığında işlem sinyalleri üretir

2. Trend Takip Stratejisi
   - SMA ve RSI indikatörlerini kullanır
   - Trend yönünde işlem sinyalleri üretir

## Güvenlik

- API anahtarlarınızı güvende tutun
- Risk yönetimi ayarlarını dikkatli yapılandırın
- Test ortamında deneyip, gerçek işlemlere geçin

## Loglar

- `error.log`: Hata logları
- `combined.log`: Tüm işlem logları

## Uyarı

Bu bot finansal tavsiye vermez. Tüm trading işlemleri kendi sorumluluğunuzdadır.