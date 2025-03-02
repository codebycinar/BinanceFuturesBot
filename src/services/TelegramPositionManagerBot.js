// TelegramPositionManagerBot.js
const { Telegraf } = require('telegraf');
const logger = require('../utils/logger');
const { models } = require('../db/db');
const { Position } = models;
const BinanceService = require('./BinanceService');
const config = require('../config/config');

class TelegramPositionManagerBot {
    constructor() {
        this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.binanceService = new BinanceService();
        this.autoTrackPositions = false; // Varsayılan olarak otomatik takip kapalı
    }

    async initialize() {
        try {
            // Komutları tanımla
            this.bot.command('start', this.handleStart.bind(this));
            this.bot.command('help', this.handleHelp.bind(this));
            this.bot.command('positions', this.handlePositions.bind(this));
            this.bot.command('status', this.handleStatus.bind(this));
            this.bot.command('close', this.handleClose.bind(this));
            this.bot.command('track', this.handleTrack.bind(this));
            this.bot.command('untrack', this.handleUntrack.bind(this));
            this.bot.command('trackall', this.handleTrackAll.bind(this));
            
            // Yazılı yanıtları işle
            this.bot.on('text', this.handleTextMessage.bind(this));
            
            // Botu başlat
            await this.bot.launch();
            logger.info('Telegram Position Manager Bot started');
            
            // Başlangıçta bilgi mesajı gönder, ancak izin sorma
            this.sendInitialMessage();
            
            return true;
        } catch (error) {
            logger.error(`Error initializing Telegram Position Manager Bot: ${error.message}`);
            return false;
        }
    }

    // Başlangıç mesajı
    async handleStart(ctx) {
        await ctx.reply(`
Welcome to Binance Futures Bot!

Use the following commands to manage your positions:
/help - Show all available commands
/positions - List all active positions
/status - Show account status
/close [symbol] - Close a specific position
/track [symbol] - Start tracking a specific position
/untrack [symbol] - Stop tracking a specific position
/trackall - Track all positions automatically
        `);
    }

    // Yardım mesajı
    async handleHelp(ctx) {
        await ctx.reply(`
Available commands:
/positions - List all active positions
/status - Show account status and performance
/close [symbol] - Close a specific position
/track [symbol] - Start tracking a specific position
/untrack [symbol] - Stop tracking a specific position
/trackall - Track all positions automatically
        `);
    }

    // Aktif pozisyonları listele
    async handlePositions(ctx) {
        try {
            const positions = await Position.findAll({ 
                where: { isActive: true },
                order: [['createdAt', 'DESC']]
            });
            
            if (positions.length === 0) {
                await ctx.reply('No active positions found.');
                return;
            }
            
            let message = '📊 Active Positions:\n\n';
            
            for (const position of positions) {
                const entryPrice = position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length;
                const currentPrice = await this.binanceService.getCurrentPrice(position.symbol);
                
                // PnL hesapla
                let pnlPercent = 0;
                if (position.entries > 0) { // LONG
                    pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
                } else { // SHORT
                    pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
                }
                
                const pnlFormatted = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
                const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
                
                message += `${emoji} ${position.symbol} (${position.entries > 0 ? 'LONG' : 'SHORT'})\n`;
                message += `   Entry: ${entryPrice.toFixed(4)}\n`;
                message += `   Current: ${currentPrice.toFixed(4)}\n`;
                message += `   PnL: ${pnlFormatted}\n`;
                message += `   Strategy: ${position.strategyUsed || 'Unknown'}\n`;
                message += `   Started: ${new Date(position.createdAt).toLocaleString()}\n\n`;
            }
            
            await ctx.reply(message);
        } catch (error) {
            logger.error(`Error handling positions command: ${error.message}`);
            await ctx.reply('Error getting positions. Please try again later.');
        }
    }

    // Hesap durumu ve performans
    async handleStatus(ctx) {
        try {
            // Hesap bakiyesi
            const accountInfo = await this.binanceService.client.futuresAccountInfo();
            const totalBalance = parseFloat(accountInfo.totalWalletBalance);
            const availableBalance = parseFloat(accountInfo.availableBalance);
            
            // Toplam kar/zarar
            const closedPositions = await Position.findAll({ 
                where: { isActive: false },
                order: [['closedAt', 'DESC']],
                limit: 30
            });
            
            let totalPnl = 0;
            let winCount = 0;
            let lossCount = 0;
            
            closedPositions.forEach(position => {
                if (position.pnlAmount) {
                    totalPnl += position.pnlAmount;
                    if (position.pnlAmount > 0) winCount++;
                    else lossCount++;
                }
            });
            
            const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length * 100).toFixed(2) : 0;
            
            const message = `
📈 Account Status:

💰 Balance: ${totalBalance.toFixed(2)} USDT
💵 Available: ${availableBalance.toFixed(2)} USDT

📊 Trading Performance (last 30 trades):
${totalPnl >= 0 ? '✅' : '❌'} Total PnL: ${totalPnl.toFixed(2)} USDT
🎯 Win Rate: ${winRate}% (${winCount}/${closedPositions.length})

🔄 Auto-tracking: ${this.autoTrackPositions ? 'ON' : 'OFF'}
            `;
            
            await ctx.reply(message);
        } catch (error) {
            logger.error(`Error handling status command: ${error.message}`);
            await ctx.reply('Error getting account status. Please try again later.');
        }
    }

    // Pozisyon kapatma
    async handleClose(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please specify a symbol to close. Example: /close BTCUSDT');
                return;
            }
            
            const symbol = args[1].toUpperCase();
            
            // Veritabanında pozisyonu bul
            const position = await Position.findOne({ 
                where: { 
                    symbol, 
                    isActive: true 
                } 
            });
            
            if (!position) {
                await ctx.reply(`No active position found for ${symbol}.`);
                return;
            }
            
            // Kullanıcıya onay sor
            await ctx.reply(`Are you sure you want to close ${symbol} position? Reply with "YES" to confirm.`);
            
            // İşlem onay bekleme durumuna geç
            this.pendingClose = {
                symbol,
                positionId: position.id,
                userId: ctx.message.from.id,
                chatId: ctx.chat.id
            };
            
        } catch (error) {
            logger.error(`Error handling close command: ${error.message}`);
            await ctx.reply('Error processing close request. Please try again later.');
        }
    }

    // Pozisyon izleme başlat
    async handleTrack(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please specify a symbol to track. Example: /track BTCUSDT');
                return;
            }
            
            const symbol = args[1].toUpperCase();
            
            // Veritabanında pozisyonu bul
            const position = await Position.findOne({ 
                where: { 
                    symbol, 
                    isActive: true 
                } 
            });
            
            if (!position) {
                await ctx.reply(`No active position found for ${symbol}.`);
                return;
            }
            
            // Kullanıcıya izleme onayı sor - her pozisyon için ayrı onay almak için
            await ctx.reply(`Do you want to track ${symbol} position? Reply with YES or NO.`);
            
            // İzleme onay bekleme durumuna geç
            this.pendingTrack = {
                symbol,
                positionId: position.id,
                userId: ctx.message.from.id,
                chatId: ctx.chat.id
            };
            
        } catch (error) {
            logger.error(`Error handling track command: ${error.message}`);
            await ctx.reply('Error processing track request. Please try again later.');
        }
    }

    // Pozisyon izlemeyi durdur
    async handleUntrack(ctx) {
        try {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                await ctx.reply('Please specify a symbol to stop tracking. Example: /untrack BTCUSDT');
                return;
            }
            
            const symbol = args[1].toUpperCase();
            await ctx.reply(`Stopped tracking ${symbol} position.`);
            
            // İzleme listesinden çıkar
            this.untrackPosition(symbol);
            
        } catch (error) {
            logger.error(`Error handling untrack command: ${error.message}`);
            await ctx.reply('Error processing untrack request. Please try again later.');
        }
    }

    // Tüm pozisyonları otomatik izle - bunu tek bir pozisyonu izleme işlevi olarak değiştirelim
    async handleTrackAll(ctx) {
        try {
            // Tüm aktif pozisyonları getir
            const positions = await Position.findAll({ where: { isActive: true } });
            
            if (positions.length === 0) {
                await ctx.reply('No active positions found to track.');
                return;
            }
            
            // Tüm aktif pozisyonları listele ve kullanıcıya birini seçmesini söyle
            let message = 'Choose a position to track by using the /track command with one of these symbols:\n\n';
            
            positions.forEach(position => {
                message += `- ${position.symbol}\n`;
            });
            
            message += '\nExample: /track BTCUSDT';
            
            await ctx.reply(message);
            
        } catch (error) {
            logger.error(`Error handling trackall command: ${error.message}`);
            await ctx.reply('Error getting positions to track. Please try again later.');
        }
    }

    // Metin mesajlarını işle
    async handleTextMessage(ctx) {
        const text = ctx.message.text.trim().toUpperCase();
        
        // Pozisyon kapatma onayı
        if (text === 'YES' && this.pendingClose && 
            ctx.message.from.id === this.pendingClose.userId && 
            ctx.chat.id === this.pendingClose.chatId) {
            
            try {
                // Pozisyonu bul
                const position = await Position.findByPk(this.pendingClose.positionId);
                if (!position || !position.isActive) {
                    await ctx.reply(`Position no longer active for ${this.pendingClose.symbol}.`);
                    this.pendingClose = null;
                    return;
                }
                
                // Mevcut fiyatı al
                const currentPrice = await this.binanceService.getCurrentPrice(this.pendingClose.symbol);
                
                // Pozisyonu kapat
                await this.closePosition(position, currentPrice, 'manual_telegram');
                
                await ctx.reply(`Position for ${this.pendingClose.symbol} closed at price ${currentPrice}.`);
                this.pendingClose = null;
                
            } catch (error) {
                logger.error(`Error closing position via Telegram: ${error.message}`);
                await ctx.reply(`Error closing position for ${this.pendingClose.symbol}. Please try again later.`);
                this.pendingClose = null;
            }
        }
        // Track onayı
        else if ((text === 'YES' || text === 'NO') && this.pendingTrack) {
            if (text === 'YES') {
                try {
                    // Pozisyon izlemeye başla
                    const position = await Position.findByPk(this.pendingTrack.positionId);
                    if (position && position.isActive) {
                        this.trackPosition(position);
                        await ctx.reply(`Started tracking ${position.symbol} position. You will receive updates on significant price movements.`);
                    } else {
                        await ctx.reply(`Position no longer active for ${this.pendingTrack.symbol}.`);
                    }
                } catch (error) {
                    logger.error(`Error tracking position: ${error.message}`);
                    await ctx.reply(`Error tracking position for ${this.pendingTrack.symbol}.`);
                }
            } else {
                await ctx.reply(`Tracking cancelled for ${this.pendingTrack.symbol}.`);
            }
            this.pendingTrack = null;
        }
    }

    // Başlangıç bilgi mesajı gönder
    async sendInitialMessage() {
        try {
            await this.bot.telegram.sendMessage(this.chatId, 
                `Binance Futures Bot started! 🚀\n\nUse /help to see available commands.\nUse /track [symbol] to track specific positions.`);
        } catch (error) {
            logger.error(`Error sending initial message: ${error.message}`);
        }
    }

    // Pozisyon izleme (uygulama özelinde geliştirilebilir)
    trackPosition(position) {
        logger.info(`Started tracking position for ${position.symbol}`);
        // Burada WebSocket veya polling ile pozisyon takibi yapılabilir
    }

    // Pozisyon izlemeyi durdur
    untrackPosition(symbol) {
        logger.info(`Stopped tracking position for ${symbol}`);
        // İzleme durdurma işlemleri
    }

    // Pozisyon kapatma
    async closePosition(position, currentPrice, exitReason) {
        try {
            const { symbol, entries } = position;
            const side = entries > 0 ? 'SELL' : 'BUY'; // LONG ise SELL, SHORT ise BUY yaparak kapatma
            const positionSide = entries > 0 ? 'LONG' : 'SHORT';
            
            // Binance üzerinden açık emirleri iptal et
            await this.binanceService.client.futuresCancelAllOpenOrders({ symbol });
            
            // Mevcut pozisyon miktarını al
            const positions = await this.binanceService.getOpenPositions();
            const binancePosition = positions.find(p => p.symbol === symbol);
            if (!binancePosition || parseFloat(binancePosition.positionAmt) === 0) {
                logger.warn(`No active position found on Binance for ${symbol}`);
                position.isActive = false;
                position.closedAt = new Date();
                position.exitReason = exitReason || 'not_found';
                await position.save();
                return;
            }
            
            // Pozisyonu kapat
            const quantity = Math.abs(parseFloat(binancePosition.positionAmt));
            await this.binanceService.client.futuresOrder({
                symbol,
                side,
                type: 'MARKET',
                quantity
            });
            
            // Pozisyon kapatma kaydı
            position.isActive = false;
            position.closedPrice = currentPrice;
            position.closedAt = new Date();
            position.exitReason = exitReason || 'manual';
            
            // PnL hesaplaması
            const entryPrice = position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length;
            let pnlPercent = 0;
            if (entries > 0) { // LONG
                pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
            } else { // SHORT
                pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
            }
            
            position.pnlPercent = pnlPercent;
            position.pnlAmount = (position.totalAllocation * pnlPercent) / 100;
            
            // İşlem süresi (dakika)
            const createdAt = new Date(position.createdAt);
            position.holdTime = Math.round((new Date() - createdAt) / (1000 * 60));
            
            await position.save();
            
            // Kapanış bildirimi
            this.notifyPositionClosed(position);
            
            logger.info(`Position for ${symbol} closed via Telegram at price ${currentPrice}`);
            return true;
            
        } catch (error) {
            logger.error(`Error closing position via Telegram: ${error.message}`);
            throw error;
        }
    }

    // Pozisyon kapanış bildirimi
    async notifyPositionClosed(position) {
        try {
            const { symbol, pnlPercent, pnlAmount, closedPrice, strategyUsed } = position;
            const isProfit = pnlPercent >= 0;
            const emoji = isProfit ? '🟢' : '🔴';
            const pnlPrefix = isProfit ? '+' : '';
            
            const message = `
${emoji} Position Closed:
Symbol: ${symbol}
Price: ${closedPrice}
PnL: ${pnlPrefix}${pnlPercent.toFixed(2)}% (${pnlPrefix}${pnlAmount.toFixed(2)} USDT)
Strategy: ${strategyUsed || 'Unknown'}
Reason: ${position.exitReason || 'manual'}
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending position closed notification: ${error.message}`);
        }
    }

    // Pozisyon güncelleme bildirimi
    async notifyPositionUpdate(position, currentPrice, pnlPercent) {
        try {
            const { symbol, entries } = position;
            const entryPrice = position.entryPrices.reduce((sum, price) => sum + parseFloat(price), 0) / position.entryPrices.length;
            const isProfit = pnlPercent >= 0;
            const emoji = isProfit ? '🟢' : '🔴';
            const pnlPrefix = isProfit ? '+' : '';
            const pnlAmount = (position.totalAllocation * pnlPercent) / 100;
            
            const message = `
📊 Position Update:
Symbol: ${symbol} (${entries > 0 ? 'LONG' : 'SHORT'})
Entry: ${entryPrice.toFixed(4)}
Current: ${currentPrice.toFixed(4)}
PnL: ${pnlPrefix}${pnlPercent.toFixed(2)}% (${pnlPrefix}${pnlAmount.toFixed(2)} USDT)
            `;
            
            await this.bot.telegram.sendMessage(this.chatId, message);
        } catch (error) {
            logger.error(`Error sending position update notification: ${error.message}`);
        }
    }

    // Bot durdurma
    async stop() {
        try {
            await this.bot.stop();
            logger.info('Telegram Position Manager Bot stopped');
        } catch (error) {
            logger.error(`Error stopping Telegram Position Manager Bot: ${error.message}`);
        }
    }
}

module.exports = TelegramPositionManagerBot;