// utils/logger.js

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Log dizini oluştur (yoksa)
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Tarih formatını ayarla
const getCurrentDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Log dosya adlarını oluştur
const logFile = path.join(logDir, `${getCurrentDate()}-bot.log`);
const errorLogFile = path.join(logDir, `${getCurrentDate()}-error.log`);
const errorLogsFile = path.join(logDir, 'errorlogs.log'); // Kalıcı hata log dosyası

// Ortak format ayarları
const logFormat = format.combine(
  format.timestamp(),
  format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${level.toUpperCase()}: ${message}\n${stack} {"timestamp":"${timestamp}"}`;
    }
    return `${level.toUpperCase()}: ${message} {"timestamp":"${timestamp}"}`;
  })
);

const logger = createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // Konsola tüm logları yazdır
    new transports.Console(),
    
    // Tüm logları genel log dosyasına yazdır
    new transports.File({ 
      filename: logFile,
      maxsize: 5242880, // 5MB
      maxFiles: 30 
    }),
    
    // Günlük hata logları (tarihli)
    new transports.File({ 
      filename: errorLogFile, 
      level: 'error', 
      maxsize: 5242880, // 5MB
      maxFiles: 30 
    }),
    
    // Kalıcı hata log dosyası (tüm hataları bir dosyada tutar)
    new transports.File({
      filename: errorLogsFile,
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ],
  // Hata durumunda çökmeyi önle
  exitOnError: false
});

module.exports = logger;
