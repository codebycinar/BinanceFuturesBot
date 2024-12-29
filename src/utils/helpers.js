// utils/helpers.js

/**
 * Quantity'yi stepSize'a uygun şekilde ayarlar
 * Eğer quantityPrecision=0 ise tam sayıya yuvarlar
 */
function formatQuantity(quantity, stepSize, quantityPrecision) {
    const step = parseFloat(stepSize);
    if (isNaN(step) || step === 0) return 0;

    const adjustedQuantity = Math.floor(quantity / step) * step;

    if (quantityPrecision === 0) {
        return Math.floor(adjustedQuantity);
    } else {
        return parseFloat(adjustedQuantity.toFixed(quantityPrecision));
    }
}

module.exports = { formatQuantity };
