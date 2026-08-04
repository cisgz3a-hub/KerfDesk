/** True when a flat tip is finite, non-negative, and smaller than its cutter. */
export function isValidCncTipDiameterMm(value: unknown, toolDiameterMm: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isFinite(toolDiameterMm) &&
    toolDiameterMm > 0 &&
    value < toolDiameterMm
  );
}
