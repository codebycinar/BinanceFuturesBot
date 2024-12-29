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
 * Formats support and resistance levels for logging
 */
const formatLevels = (levels) => {
  const formatLevel = (level) => `${formatPrice(level.price)}`;

  return `Support levels: ${levels.support.map(formatLevel).join(', ') || 'None'}\n` +
    `Resistance levels: ${levels.resistance.map(formatLevel).join(', ') || 'None'}`;
};

module.exports = {
  formatPrice,
  formatLevels,
  formatQuantity
};