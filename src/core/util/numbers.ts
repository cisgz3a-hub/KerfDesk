// Shared numeric tolerance helper. Two values are "close" when they are within
// an absolute 0.001 OR a 0.001 relative epsilon — enough to treat re-parsed
// GRBL/profile numbers (e.g. "1000.000" vs 1000) as unchanged. Extracted from
// DetectedSettingsBanner and device-setup-firmware-diff per CLAUDE.md's
// "extract on the second occurrence" rule.

const COMPARE_EPSILON = 0.001;

export function numbersClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < COMPARE_EPSILON) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / denom < COMPARE_EPSILON;
}
