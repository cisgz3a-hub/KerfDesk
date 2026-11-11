// LHYMicro-GL distances (ADR-703), from MeerK40t's MIT driver.py
// lhymicro_distance (L41-108 at d511944e). A distance is a count of 1/1000 in
// steps: each 'z' is 255, 52..254 are three digits, 1..25 are 'a'..'y' and
// 26..51 are '|' followed by 'a'..'z' ("|a" = 26, "|z" = 51).

const LETTERS = 'abcdefghijklmnopqrstuvwxy';
const LONG_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function encodeLhyDistance(steps: number): string {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(`LHY distance must be a non-negative integer, got ${steps}.`);
  }
  const fullZs = Math.floor(steps / 255);
  const rest = steps % 255;
  return 'z'.repeat(fullZs) + restCode(rest);
}

function restCode(value: number): string {
  if (value === 0) return '';
  if (value >= 52) return String(value).padStart(3, '0');
  if (value >= 26) return `|${LONG_LETTERS[value - 26] ?? ''}`;
  return LETTERS[value - 1] ?? '';
}
