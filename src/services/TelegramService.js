// TelegramService.js
// Adding text message handling support

const { Telegraf } = require('telegraf');
const logger = require('../utils/logger');
const dotenv = require('dotenv');

// Ensure environment variables are loaded
dotenv.config();

class TelegramService {
    constructor() {
        if (TelegramService.instance) {
            return TelegramService.instance;
        }

        // Flag to allow the app to proceed if Telegram is not available
        this.fallbackMode = false;

        // Initialize bot if token exists
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            try {
                this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
                this.chatId = process.env.TELEGRAM_CHAT_ID;
                this.isInitialized = false;
                this.textHandlers = [];
                logger.info('TelegramService instance created');
            } catch (error) {
                logger.error(`Error creating Telegram bot: ${error.message}`);
                this.bot = null;
                this.isInitialized = false;
                this.fallbackMode = true;
            }
        } else {
            logger.warn('Missing Telegram bot token or chat ID. Telegram notifications disabled.');
            this.bot = null;
            this.isInitialized = false;
            this.fallbackMode = true;
        }

        TelegramService.instance = this;
    }

    async initialize() {
        // Already initialized or in fallback mode
        if (this.isInitialized || this.fallbackMode) {
            logger.info('Telegram service already initialized or in fallback mode');
            this.isInitialized = true;
            return;
        }

        // No bot instance available
        if (!this.bot) {
            logger.warn('No Telegram bot instance available, entering fallback mode');
            this.isInitialized = true;
            this.fallbackMode = true;
            return;
        }

        try {
            // Basic commands
            this.bot.command('start', (ctx) => {
                ctx.reply('Welcome to Binance Futures Bot! Type /help for available commands.');
            });

            this.bot.command('help', (ctx) => {
                ctx.reply(`
Available commands:
/status - Show bot status
/positions - Show active positions
/performance - Show trading performance
                `);
            });

            // Add text message handler
            this.bot.on('text', (ctx) => {
                // Process text messages through registered handlers
                this.textHandlers.forEach(handler => {
                    try {
                        handler(ctx);
                    } catch (err) {
                        logger.error(`Error in text message handler: ${err.message}`);
                    }
                });
            });

            // Bot launch with timeout
            const launchPromise = this.bot.launch();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Telegram bot launch timeout after 5 seconds')), 5000)
            );
            
            await Promise.race([launchPromise, timeoutPromise])
                .catch(error => {
                    logger.warn(`Telegram bot launch timed out or failed: ${error.message}. Continuing without Telegram.`);
                    this.bot = null;
                    this.fallbackMode = true;
                });
                
            this.isInitialized = true;
            logger.info('Telegram service initialization completed');

            // Send startup message (only if bot successfully launched)
            if (this.bot) {
                this.sendMessage('Binance Futures Bot started! 🚀')
                    .catch(err => logger.warn(`Could not send initial message: ${err.message}`));
            }
        } catch (error) {
            logger.error(`Error initializing Telegram bot: ${error.message}`);
            this.isInitialized = true;
            this.fallbackMode = true;
            this.bot = null;
        }
    }

    isReady() {
        return (this.bot && this.isInitialized) || this.fallbackMode;
    }

    async sendMessage(message) {
        // If in fallback mode, log the message but don't try to send
        if (this.fallbackMode) {
            logger.info(`[TELEGRAM MESSAGE]: ${message}`);
            return true;
        }

        // If bot not ready and not in fallback mode
        if (!this.bot || !this.isInitialized) {
            logger.warn('Telegram bot not ready. Message not sent:', message);
            return false;
        }

        try {
            // Add timeout to prevent hanging
            const sendPromise = this.bot.telegram.sendMessage(this.chatId, message);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Telegram sendMessage timeout after 3 seconds')), 3000)
            );
            
            await Promise.race([sendPromise, timeoutPromise]);
            return true;
        } catch (error) {
            logger.error(`Error sending Telegram message: ${error.message}`);
            return false;
        }
    }

    async sendFormattedMessage(title, content, options = {}) {
        const { emoji = '📊', isError = false } = options;
        const statusEmoji = isError ? '❌' : emoji;
        
        const message = `
${statusEmoji} ${title}

${content}
        `;
        
        return this.sendMessage(message);
    }

    // New position notification
    async notifyNewPosition(position) {
        const { symbol, entryPrices, stopLoss, takeProfit, strategyUsed, allocation } = position;
        const entryPrice = entryPrices[0];
        const direction = position.entries > 0 ? 'LONG 📈' : 'SHORT 📉';
        
        const message = `
🔔 New Position Opened:
Symbol: ${symbol} (${direction})
Entry Price: ${entryPrice}
Stop Loss: ${stopLoss}
Take Profit: ${takeProfit}
Strategy: ${strategyUsed || 'Unknown'}
Allocation: ${allocation} USDT
        `;
        
        return this.sendMessage(message);
    }

    // Position closed notification
    async notifyPositionClosed(position, exitReason) {
        if (!position) return;
        
        const { symbol, entryPrices, closedPrice, pnlPercent, pnlAmount, strategyUsed } = position;
        const isProfit = pnlPercent >= 0;
        const emoji = isProfit ? '🟢' : '🔴';
        const pnlPrefix = isProfit ? '+' : '';
        
        const message = `
${emoji} Position Closed:
Symbol: ${symbol}
Entry: ${entryPrices[0]}
Exit: ${closedPrice}
PnL: ${pnlPrefix}${pnlPercent?.toFixed(2)}% (${pnlPrefix}${pnlAmount?.toFixed(2)} USDT)
Strategy: ${strategyUsed || 'Unknown'}
Reason: ${exitReason || 'manual'}
        `;
        
        return this.sendMessage(message);
    }

    // Position update notification (trailing stop, break-even, etc.)
    async notifyPositionUpdate(symbol, updateType, details) {
        const message = `
📝 Position Update (${updateType}):
Symbol: ${symbol}
${details}
        `;
        
        return this.sendMessage(message);
    }

    // Position manager status notification
    async notifyStatus(activePositions, balanceInfo) {
        const message = `
📊 Bot Status:
Active Positions: ${activePositions?.length || 0}
Balance: ${balanceInfo?.balance || 'N/A'} USDT
Available: ${balanceInfo?.availableBalance || 'N/A'} USDT
        `;
        
        return this.sendMessage(message);
    }

    // Error notification
    async notifyError(errorMessage, details = '') {
        const message = `
❌ Error:
${errorMessage}
${details ? `\nDetails: ${details}` : ''}
        `;
        
        return this.sendMessage(message);
    }

    // Signal notification (for when position is not opened)
    async notifySignal(symbol, signal, price, reason = '') {
        const directionEmoji = signal.includes('BUY') ? '📈' : '📉';
        
        const message = `
🔍 ${directionEmoji} Signal Detected:
Symbol: ${symbol}
Signal: ${signal}
Price: ${price}
${reason ? `Note: ${reason}` : ''}
        `;
        
        return this.sendMessage(message);
    }

    // Stop the bot
    async stop() {
        if (this.fallbackMode) {
            logger.info('Telegram service in fallback mode, no bot to stop');
            return true;
        }

        if (this.bot && this.isInitialized) {
            try {
                await this.bot.stop();
                this.isInitialized = false;
                logger.info('Telegram bot stopped');
                return true;
            } catch (error) {
                logger.error(`Error stopping Telegram bot: ${error.message}`);
                return false;
            }
        }
        return true;
    }

    // Add custom command
    addCommand(command, handler) {
        if (!this.bot || this.fallbackMode) {
            logger.warn(`Cannot add command '${command}' - bot not available or in fallback mode`);
            return false;
        }
        
        try {
            this.bot.command(command, handler);
            return true;
        } catch (error) {
            logger.error(`Error adding command ${command}: ${error.message}`);
            return false;
        }
    }
    
    // Add text message handler
    addTextHandler(handler) {
        if (this.fallbackMode) {
            logger.warn('Cannot add text handler - service in fallback mode');
            return false;
        }

        if (typeof handler !== 'function') {
            logger.error('Invalid text handler: handler must be a function');
            return false;
        }
        
        this.textHandlers.push(handler);
        return true;
    }
    
    // Process text message for all handlers
    async handleTextMessage(ctx) {
        if (this.fallbackMode || !this.isReady() || !ctx) return false;
        
        for (const handler of this.textHandlers) {
            try {
                await handler(ctx);
            } catch (err) {
                logger.error(`Error in text message handler: ${err.message}`);
            }
        }
        
        return true;
    }
}

// Create and export singleton instance
module.exports = new TelegramService();