/**
 * Formats price with appropriate decimal places
 */
const formatPrice = (price) => {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  });
};

/**
 * Formats quantity with appropriate decimal places
 */
const formatQuantity = (quantity) => {
  return quantity.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  });
};

/**
 * Formats time in milliseconds to a readable format
 */
const formatTime = (ms) => {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.join(' ');
};

/**
 * Formats support and resistance levels for logging
 */
const formatLevels = (levels) => {
  const formatLevel = (level) => `${formatPrice(level.price)}`;

  return `Support levels: ${levels.support.map(formatLevel).join(', ') || 'None'}\n` +
    `Resistance levels: ${levels.resistance.map(formatLevel).join(', ') || 'None'}`;
};

module.exports = {
  formatPrice,
  formatQuantity,
  formatTime,
  formatLevels
};