// TelegramService.js
// Improved Telegram service using direct node-telegram-bot-api

const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const dotenv = require('dotenv');
const config = require('../config/config');

// Ensure environment variables are loaded
dotenv.config();

class TelegramService {
    constructor() {
        if (TelegramService.instance) {
            return TelegramService.instance;
        }

        // Flag to allow the app to proceed if Telegram is not available
        this.fallbackMode = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 60000; // 1 minute delay between reconnect attempts
        this.messageQueue = []; // Queue for messages during reconnection attempts
        this.textHandlers = [];
        this.reconnectTimer = null;

        // Initialize bot if token exists
        if (config.telegramBotToken && config.telegramChatId) {
            try {
                logger.info('Initializing Telegram Bot...');
                this.chatId = config.telegramChatId;
                
                // Initialize with empty bot, will be created in initialize method
                this.bot = null;
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
        if (this.isInitialized) {
            logger.info('Telegram service already initialized');
            return;
        }

        // No bot configuration available
        if (!config.telegramBotToken || !config.telegramChatId) {
            logger.warn('No Telegram bot configuration available, entering fallback mode');
            this.isInitialized = true;
            this.fallbackMode = true;
            return;
        }

        try {
            // Create new bot instance with polling
            this.bot = new TelegramBot(config.telegramBotToken, {
                polling: true,
                // Set polling options
                polling_options: {
                    interval: 300, // Poll every 300ms
                    timeout: 10, // Timeout after 10 seconds
                    limit: 100, // Retrieve up to 100 updates at once
                    allowed_updates: ['message', 'callback_query'] // Only get these update types
                }
            });

            // Handle polling errors
            this.bot.on('polling_error', (error) => {
                logger.error(`Telegram polling error: ${error.message}`);
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
                    this.handleConnectionError(error);
                }
            });

            // Setup message handler
            this.bot.on('message', async (msg) => {
                try {
                    logger.info(`Received Telegram message from ${msg.chat.id}: ${msg.text}`);
                    
                    // Verify it's from the authorized chat ID
                    if (msg.chat.id.toString() !== this.chatId.toString()) {
                        logger.warn(`Received message from unauthorized chat ID: ${msg.chat.id}`);
                        return;
                    }
                    
                    // Process message through handlers
                    await this.processIncomingMessage(msg);
                } catch (error) {
                    logger.error(`Error processing Telegram message: ${error.message}`);
                }
            });

            // Register basic commands
            this.registerBaseCommands();

            this.isInitialized = true;
            logger.info('Telegram service initialization completed successfully');

            // Send startup message
            await this.sendMessage('Binance Futures Bot started! 🚀');
            
            // Process any queued messages
            await this.processMessageQueue();
        } catch (error) {
            logger.error(`Error initializing Telegram bot: ${error.message}`);
            this.handleInitializationError(error);
        }
    }

    handleInitializationError(error) {
        this.fallbackMode = true;
        this.isInitialized = true; // Set initialized so app continues
        logger.warn('Entering fallback mode due to Telegram initialization error');
        
        // Schedule reconnect attempt
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            logger.info(`Scheduling Telegram reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000} seconds`);
            
            this.reconnectTimer = setTimeout(() => {
                logger.info('Attempting to reconnect to Telegram API...');
                this.fallbackMode = false;
                this.isInitialized = false;
                this.initialize();
            }, delay);
        } else {
            logger.error('Maximum reconnection attempts reached. Staying in fallback mode.');
        }
    }

    handleConnectionError(error) {
        if (!this.fallbackMode) {
            logger.warn(`Telegram connection error: ${error.message}. Entering temporary fallback mode.`);
            this.fallbackMode = true;
            
            // Schedule recovery
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
                logger.info('Attempting to recover from Telegram connection error...');
                this.fallbackMode = false;
                
                // Stop and restart polling
                if (this.bot) {
                    this.bot.stopPolling()
                        .then(() => {
                            return this.bot.startPolling();
                        })
                        .then(() => {
                            logger.info('Successfully restarted Telegram polling');
                            // Process any queued messages
                            this.processMessageQueue();
                        })
                        .catch(err => {
                            logger.error(`Error restarting Telegram polling: ${err.message}`);
                            this.handleInitializationError(err);
                        });
                }
            }, 30000); // 30 seconds recovery delay
        }
    }

    registerBaseCommands() {
        // Only register if bot is available
        if (!this.bot) return;

        // Basic commands
        this.bot.onText(/\/start/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId.toString()) return;
            this.bot.sendMessage(this.chatId, 'Welcome to Binance Futures Bot! Type /help for available commands.');
        });

        this.bot.onText(/\/help/, (msg) => {
            if (msg.chat.id.toString() !== this.chatId.toString()) return;
            this.bot.sendMessage(this.chatId, `
Available commands:
/status - Show bot status
/positions - Show active positions
/performance - Show trading performance
            `);
        });

        this.bot.onText(/\/status/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId.toString()) return;
            // This will be handled by the text handlers
        });

        this.bot.onText(/\/positions/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId.toString()) return;
            // This will be handled by the text handlers
        });

        this.bot.onText(/\/performance/, async (msg) => {
            if (msg.chat.id.toString() !== this.chatId.toString()) return;
            // This will be handled by the text handlers
        });

        logger.info('Base Telegram commands registered');
    }

    async processIncomingMessage(msg) {
        // Process through all registered handlers
        const promises = this.textHandlers.map(handler => {
            try {
                return handler(msg);
            } catch (err) {
                logger.error(`Error in text message handler: ${err.message}`);
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
    }

    async processMessageQueue() {
        if (this.messageQueue.length === 0 || this.fallbackMode) return;

        logger.info(`Processing ${this.messageQueue.length} queued Telegram messages`);
        
        // Process all queued messages
        const queue = [...this.messageQueue];
        this.messageQueue = [];
        
        for (const item of queue) {
            try {
                await this.sendMessage(item.message, item.options);
            } catch (error) {
                logger.error(`Error sending queued message: ${error.message}`);
                // Re-queue failed messages if not in fallback mode
                if (!this.fallbackMode) {
                    this.messageQueue.push(item);
                }
            }
        }
    }

    isReady() {
        return (this.bot && this.isInitialized) || this.fallbackMode;
    }

    // Helper to escape Markdown special characters
    escapeMarkdown(text) {
        if (!text) return '';
        // Convert to string if not already
        const str = String(text);
        // For regular Markdown mode (not MarkdownV2), we only need to escape a few characters
        // This fixes the issue with excessive backslashes in messages
        return str.replace(/([_*`\[\]])/g, '\\$1');
    }

    async sendMessage(message, options = {}) {
        // If in fallback mode, log the message but don't try to send
        if (this.fallbackMode) {
            logger.info(`[TELEGRAM MESSAGE]: ${message}`);
            
            // Add to queue for later sending
            if (!options.noQueue) {
                this.messageQueue.push({ message, options });
            }
            return true;
        }

        // If bot not ready
        if (!this.bot || !this.isInitialized) {
            logger.warn(`Telegram bot not ready. Message queued: ${message}`);
            // Add to queue for later sending
            if (!options.noQueue) {
                this.messageQueue.push({ message, options });
            }
            return false;
        }

        try {
            let processedMessage = message;
            
            // Use simplified Markdown escaping to avoid excessive backslashes
            if (options.parse_mode === 'Markdown' || !options.parse_mode) {
                // We use a simple approach that doesn't over-escape
                processedMessage = this.processMarkdownMessage(message);
            }
            
            // Add timeout to prevent hanging
            const sendPromise = this.bot.sendMessage(this.chatId, processedMessage, {
                parse_mode: options.parse_mode || 'Markdown',
                disable_web_page_preview: options.disable_preview !== false
            });
            
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Telegram sendMessage timeout after 10 seconds')), 10000)
            );
            
            await Promise.race([sendPromise, timeoutPromise]);
            return true;
        } catch (error) {
            logger.error(`Error sending Telegram message: ${error.message}`);
            
            // If it's a parsing error, try to send without Markdown formatting
            if (error.message.includes("can't parse entities")) {
                logger.info('Retrying message without Markdown formatting');
                try {
                    await this.bot.sendMessage(this.chatId, message, {
                        parse_mode: undefined,
                        disable_web_page_preview: options.disable_preview !== false
                    });
                    return true;
                } catch (secondError) {
                    logger.error(`Error resending message without formatting: ${secondError.message}`);
                }
            }
            
            // Check for fatal errors that require fallback mode
            if (
                error.message.includes('ETELEGRAM') || 
                error.message.includes('timeout') || 
                error.message.includes('Too Many Requests') ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNRESET'
            ) {
                this.handleConnectionError(error);
                
                // Add to queue for later sending
                if (!options.noQueue) {
                    this.messageQueue.push({ message, options });
                }
                
                // Log the message in fallback mode
                logger.info(`[TELEGRAM MESSAGE (fallback)]: ${message}`);
                return true;
            }
            
            return false;
        }
    }
    
    // Process a markdown message to properly escape special characters
    processMarkdownMessage(message) {
        if (!message) return '';
        
        // For simpler Markdown parsing that won't excessively escape
        // Just lightly escape the basic formatting characters
        return String(message).replace(/([_*`])/g, '\\$1');
        
        /* Old complex implementation was causing issues with excessive escaping
        // Handle bold text: ensure proper escaping of content between asterisks
        const boldRegex = /\*(.*?)\*/g;
        const parts = [];
        let lastIndex = 0;
        let match;
        
        while ((match = boldRegex.exec(message)) !== null) {
            // Add text before the match (escaped)
            if (match.index > lastIndex) {
                parts.push(this.escapeMarkdown(message.substring(lastIndex, match.index)));
            }
            
            // Add the bold text (without escaping the asterisks, but escape content inside)
            const content = match[1];
            parts.push(`*${this.escapeMarkdown(content)}*`);
            
            lastIndex = match.index + match[0].length;
        }
        
        // Add any remaining text
        if (lastIndex < message.length) {
            parts.push(this.escapeMarkdown(message.substring(lastIndex)));
        }
        
        return parts.join('');
        */
    }

    async sendFormattedMessage(title, content, options = {}) {
        const { emoji = '📊', isError = false } = options;
        const statusEmoji = isError ? '❌' : emoji;
        
        // No escaping needed, processMarkdownMessage will handle this properly
        const message = `
${statusEmoji} *${title}*

${content}
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async notifyNewPosition(position) {
        const { symbol, entryPrices, stopLoss, takeProfit, strategyUsed, allocation } = position;
        const entryPrice = entryPrices[0];
        const direction = position.entries > 0 ? 'LONG 📈' : 'SHORT 📉';
        
        // Simplified message without excessive escaping
        const message = `
🔔 *New Position Opened:*
Symbol: ${symbol} (${direction})
Entry Price: ${entryPrice}
Stop Loss: ${stopLoss}
Take Profit: ${takeProfit}
Strategy: ${strategyUsed || 'Unknown'}
Allocation: ${allocation} USDT
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async notifyPositionClosed(position, exitReason) {
        if (!position) return;
        
        const { symbol, entryPrices, closedPrice, pnlPercent, pnlAmount, strategyUsed } = position;
        const isProfit = pnlPercent >= 0;
        const emoji = isProfit ? '🟢' : '🔴';
        const pnlPrefix = isProfit ? '+' : '';
        
        const pnlPercentFormatted = pnlPercent?.toFixed(2) || '0.00';
        const pnlAmountFormatted = pnlAmount?.toFixed(2) || '0.00';
        
        // Using simple string formatting without excessive escaping
        const message = `
${emoji} *Position Closed:*
Symbol: ${symbol}
Entry: ${entryPrices[0]}
Exit: ${closedPrice}
PnL: ${pnlPrefix}${pnlPercentFormatted}% (${pnlPrefix}${pnlAmountFormatted} USDT)
Strategy: ${strategyUsed || 'Unknown'}
Reason: ${exitReason || 'manual'}
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async notifyPositionUpdate(symbol, updateType, details) {
        // Simplified message without excessive escaping
        const message = `
📝 *Position Update (${updateType}):*
Symbol: ${symbol}
${details}
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async notifyStatus(activePositions, balanceInfo) {
        const activePosCount = activePositions?.length || 0;
        const balance = balanceInfo?.balance || 'N/A';
        const availableBalance = balanceInfo?.availableBalance || 'N/A';
        
        // Simplified message without excessive escaping
        const message = `
📊 *Bot Status:*
Active Positions: ${activePosCount}
Balance: ${balance} USDT
Available: ${availableBalance} USDT
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async notifyError(errorMessage, details = '') {
        // Simplified message without excessive escaping
        const message = `
❌ *Error:*
${errorMessage}
${details ? `\nDetails: ${details}` : ''}
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown', isError: true });
    }

    async notifySignal(symbol, signal, price, reason = '') {
        const directionEmoji = signal.includes('BUY') ? '📈' : '📉';
        
        // Simplified message without excessive escaping
        const message = `
🔍 ${directionEmoji} *Signal Detected:*
Symbol: ${symbol}
Signal: ${signal}
Price: ${price}
${reason ? `Note: ${reason}` : ''}
        `;
        
        return this.sendMessage(message, { parse_mode: 'Markdown' });
    }

    async stop() {
        if (this.fallbackMode) {
            logger.info('Telegram service in fallback mode, no bot to stop');
            return true;
        }

        if (this.bot) {
            try {
                // Clear any reconnect timers
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                
                // Stop polling
                await this.bot.stopPolling();
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

    addCommand(command, handler) {
        if (!this.bot || this.fallbackMode) {
            logger.warn(`Cannot add command '${command}' - bot not available or in fallback mode`);
            return false;
        }
        
        try {
            this.bot.onText(new RegExp(`\\/${command}`), (msg) => {
                // Ensure message is from authorized chat
                if (msg.chat.id.toString() !== this.chatId.toString()) {
                    logger.warn(`Received /${command} from unauthorized chat ID: ${msg.chat.id}`);
                    return;
                }
                
                handler(msg);
            });
            logger.info(`Added command handler for /${command}`);
            return true;
        } catch (error) {
            logger.error(`Error adding command ${command}: ${error.message}`);
            return false;
        }
    }
    
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
        logger.info('Added text message handler');
        return true;
    }
}

// Create and export singleton instance
module.exports = new TelegramService();