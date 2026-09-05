/**
 * Represent a requested feed without exceeding its configured ceiling.
 * Feeds at or above 1 mm/min are floored for stable whole-number output;
 * positive fractional feeds remain fractional. A controller or firmware build
 * may enforce its own physical minimum independently of this G-code word.
 */
export function effectiveGcodeFeedMmPerMin(feedMmPerMin: number): number {
  if (Number.isFinite(feedMmPerMin) && feedMmPerMin > 0 && feedMmPerMin < 1) {
    return feedMmPerMin;
  }
  return Math.max(1, Math.floor(feedMmPerMin));
}

/**
 * Format a represented feed as ordinary decimal G-code. JavaScript switches
 * small and large numbers to exponent notation, but GRBL feed words accept a
 * decimal number rather than ECMAScript's `1e-7` spelling.
 */
export function formatGcodeFeedMmPerMin(feedMmPerMin: number): string {
  return expandPositiveExponent(effectiveGcodeFeedMmPerMin(feedMmPerMin));
}

function expandPositiveExponent(value: number): string {
  const text = String(value);
  const exponentMarker = text.search(/[eE]/);
  if (exponentMarker < 0) return text;
  const coefficient = text.slice(0, exponentMarker);
  const exponent = Number(text.slice(exponentMarker + 1));
  const digits = coefficient.replace('.', '');
  const decimalIndex =
    (coefficient.indexOf('.') < 0 ? coefficient.length : coefficient.indexOf('.')) + exponent;
  if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
