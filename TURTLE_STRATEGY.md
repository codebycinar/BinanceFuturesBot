# Turtle Trading Strategy

Bu dosya, Binance Futures Bot için geliştirilmiş Turtle Trading stratejisinin açıklamasını ve kullanımını içerir.

## Turtle Trading Nedir?

Turtle Trading, 1980'lerde Richard Dennis ve William Eckhardt tarafından geliştirilen ve başarıyla uygulanan bir trend takip stratejisidir. Stratejinin temelinde, fiyat belirli bir yüksek veya düşük noktayı aştığında alış/satış yapma prensibi yatar. Bu strateji özellikle yüksek volatilite dönemlerinde faydalıdır.

## Strateji Parametreleri

Turtle Trading stratejimizin parametreleri aşağıdaki gibidir:

- **entryChannel**: 20 periyotluk kanal (giriş sinyali için)
- **exitChannel**: 10 periyotluk kanal (çıkış sinyali için)
- **atrPeriod**: 14 (ATR göstergesinin periyodu)
- **riskPercentage**: 1 (Risk yüzdesi)
- **atrMultiplier**: 2 (Stop loss için ATR çarpanı)
- **confirmationPeriod**: 3 (En az 3 mum gerekli kırılma doğrulaması için)
- **profitMultiplier**: 3 (Risk:Ödül oranını 1:3'e çıkardık)
- **timeframe**: "4h" (Tercih edilen zaman dilimi)
- **maxEntries**: 4 (Bir pozisyon için maksimum giriş sayısı)
- **volumeConfirmation**: true (Hacim onayı kontrolü)
- **useBreakEven**: true (Break-even kullanımını aç/kapa)
- **breakEvenActivationPercent**: 0.8 (ATR'nin yüzde kaçı kadar kar için break-even aktif olsun)

## Strateji Kuralları

Turtle Trading stratejimiz şu kurallara göre çalışır:

### Giriş Kuralları

1. **Long (Alış) Pozisyonu**: Fiyat son 20 mumun en yüksek fiyatını (Donchian Kanalı üst bandı) kırarsa, LONG pozisyon açılır.
2. **Short (Satış) Pozisyonu**: Fiyat son 20 mumun en düşük fiyatını (Donchian Kanalı alt bandı) kırarsa, SHORT pozisyon açılır.

### Pozisyon Yönetimi

1. **Stop Loss**: Her giriş için ATR değerinin 2 katı kadar stop-loss belirlenir.
2. **Take Profit**: Her giriş için ATR değerinin 6 katı kadar (2 x 3) take-profit belirlenir.
3. **Break-Even**: Pozisyon ATR'nin 0.8 katı kadar kar elde ettiğinde, stop-loss seviyesi giriş fiyatına (veya küçük bir kar seviyesine) taşınır.
4. **Ek Girişler (Pyramiding)**: Pozisyon lehine hareket ettiğinde, maksimum 4 giriş yapılabilir. Her giriş için tek bir zaman diliminde yalnızca bir işlem açılabilir.

### Çıkış Kuralları

1. **Trend Bitişi**: Fiyat son 10 mumun en düşük fiyatı (LONG pozisyonlar için) veya en yüksek fiyatı (SHORT pozisyonlar için) kırıldığında pozisyon kapatılır.
2. **Stop Loss**: Stop-loss seviyesine ulaşıldığında pozisyon kapatılır.
3. **Take Profit**: Take-profit seviyesine ulaşıldığında pozisyon kapatılır.
4. **Trailing Stop**: Pozisyon belirlenen kar seviyesine ulaştığında, kazancı korumak için trailing stop aktifleştirilir.

## Configürasyon Ayarları

Bot'un `config.js` dosyasındaki Turtle Trading stratejisi ayarları:

```javascript
// Turtle Trading stratejisi özellikleri
turtleStrategy: {
  entryChannel: 20,     // 20 periyotluk kanal (giriş sinyali için)
  exitChannel: 10,      // 10 periyotluk kanal (çıkış sinyali için)
  atrPeriod: 14,        // ATR periyodu
  riskPercentage: 1,    // Risk yüzdesi
  atrMultiplier: 2,     // Stop loss için ATR çarpanı
  confirmationPeriod: 3, // En az 3 mum gerekli kırılma doğrulaması için
  profitMultiplier: 3,  // Risk:Ödül oranını 1:3'e çıkardık
  timeframe: '4h',      // Turtle Trading için önerilen zaman dilimi
  maxEntries: 4,        // Bir pozisyon için maksimum giriş sayısı
  volumeConfirmation: true, // Hacim onayı kontrolü
  useBreakEven: true,    // Break-even kullanımını aç/kapa
  breakEvenActivationPercent: 0.8 // %0.8 kar seviyesinde aktifleştir (ATR'nin katsayısı)
},
```

## Turtle Trading Stratejisi Testi

Turtle Trading stratejisini test etmek için özel bir test scripti oluşturulmuştur. Bu script, belirtilen sembollerde stratejinin nasıl davranacağını simüle eder. 

```bash
node src/test/testTurtleStrategy.js
```

Bu test, şunları gerçekleştirir:
- Donchian Kanallarını hesaplar
- ATR değerlerini hesaplar
- Potansiyel giriş ve çıkış noktalarını belirler
- Simüle edilmiş pozisyonlar için risk:ödül oranını hesaplar

## İpuçları ve En İyi Uygulamalar

1. Turtle Trading stratejisi özellikle trend olan piyasalarda iyi çalışır, range'de (yatay) piyasalarda sürekli stop out olabilir.
2. Volatilite düşük olduğunda, ATR çarpanını arttırmak daha az sıklıkta ama daha kaliteli işlemler almanızı sağlayabilir.
3. Risk yönetimi bu stratejinin temelidir. Her işlem için hesaplamanızın %1-2'sinden fazlasını riske etmeyin.
4. Strateji için en ideal zaman dilimi 4 saatlik grafiklerdir (4h), ancak günlük (1d) veya 1 saatlik (1h) zaman dilimleriyle de test edilebilir.
5. Farklı varlık sınıflarında farklı davranabilir, bu nedenle önce az sayıda sembolle başlayın ve performansı gözlemleyin.

## Stratejinin Zayıf Yönleri ve Dikkat Edilmesi Gerekenler

1. Yüksek volatiliteli piyasalarda, false (yanlış) kırılmalar sonucunda yanlış sinyaller üretebilir.
2. Düşük volatiliteli, yatay piyasalarda sık sık stop out olma riski vardır.
3. Her zaman diliminde maximum 1 tane işlem açılmasına dikkat edin, yoksa çok fazla riski bir araya toplayabilirsiniz.
4. Trend olmayan piyasalarda kullanmayın, farklı stratejilere geçiş yapın.

---

Bu strategy geliştirilmeye açıktır. Performansını iyileştirmek için önerilere açığız.