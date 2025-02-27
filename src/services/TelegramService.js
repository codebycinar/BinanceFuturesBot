// services/TelegramService.js
const { Telegraf } = require('telegraf');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
  constructor() {
    if (!config.telegramBotToken || !config.telegramChatId) {
      logger.warn('Telegram bot token veya chat ID tanımlı değil!');
      return;
    }
    
    this.bot = new Telegraf(config.telegramBotToken);
    this.chatId = config.telegramChatId;
    
    // Botu başlat ama polling'i açma
    this.bot.launch().catch(error => {
      logger.error('Telegram bot başlatma hatası:', error);
    });
  }

  async sendMessage(text) {
    try {
      if (!this.bot) return;
      await this.bot.telegram.sendMessage(this.chatId, text);
    } catch (error) {
      logger.error('Telegram mesaj gönderme hatası:', error);
    }
  }

  async sendError(error, context = '') {
    const message = `🚨 ${context ? `[${context}] ` : ''}HATA:\n${error.message || error}`;
    await this.sendMessage(message);
  }

  // Komutları dinlemek için (isteğe bağlı)
  onCommand(command, handler) {
    if (!this.bot) return;
    this.bot.command(command, ctx => handler(ctx));
  }
}

module.exports = new TelegramService(); // Singleton instance