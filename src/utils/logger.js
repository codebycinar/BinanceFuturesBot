// utils/logger.js

const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => `${level.toUpperCase()}: ${message} {"timestamp":"${timestamp}"}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'bot.log' })
  ],
});

module.exports = logger;
