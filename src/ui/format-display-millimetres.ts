const DISPLAY_DECIMALS = 3;

/** Format millimetres compactly without rounding a nonzero value to zero. */
export function formatDisplayMillimetres(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(DISPLAY_DECIMALS).replace(/\.?0+$/, '');
  if (Number(fixed) !== 0) return fixed;
  return value.toExponential(DISPLAY_DECIMALS).replace(/\.?0+(?=e)/, '');
}
