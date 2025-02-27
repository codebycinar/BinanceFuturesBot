// utils/logger.js
const { createLogger, format, transports } = require('winston');
const Transport = require('winston-transport');
const path = require('path');
const fs = require('fs');

// 1. Önce şu paketi yükleyin:
// npm install winston-transport

// Dosya adı oluşturma fonksiyonu
const getCurrentHourlyLogFileName = () => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}00-bot.log`;
};

// Özel Transport sınıfı
class HourlyFileTransport extends Transport {
  log(info, callback) {
    const filename = path.join(__dirname, '..', 'logs', getCurrentHourlyLogFileName());
    
    // Metadata kontrolü ekleyin
    const metadata = info.metadata || {}; // Eğer metadata yoksa boş obje kullan
    
    let logEntry = `${info.level.toUpperCase()}: ${info.message}`;
    if (Object.keys(metadata).length > 0) {
      logEntry += ` ${JSON.stringify(metadata)}`;
    }
    logEntry += ` {"timestamp":"${info.timestamp}"}\n`;

    fs.appendFileSync(filename, logEntry);
    callback();
  }
}

const logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...metadata }) => {
      let logMessage = `${level.toUpperCase()}: ${message}`;
      if (Object.keys(metadata).length > 0) {
        logMessage += ` ${JSON.stringify(metadata)}`;
      }
      logMessage += ` {"timestamp":"${timestamp}"}`;
      return logMessage;
    })
  ),
  transports: [
    new transports.Console(),
    new HourlyFileTransport()
  ]
});

module.exports = logger;