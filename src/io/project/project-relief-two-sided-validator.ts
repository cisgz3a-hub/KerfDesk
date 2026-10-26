// A two-sided split side's record of the stock it was planned for (ADR-580
// Amendment 1). Relief CAM moves the side's frame by the record, so a malformed
// one must not reach it.

import {
  firstError,
  isObject,
  requireLiteral,
  requireNonNegativeNumber,
  requirePositiveNumber,
} from './project-shape-primitives';

export function validateReliefTwoSidedSplit(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const record = obj['twoSidedSplit'];
  if (record === undefined) return null;
  const at = `${path}.twoSidedSplit`;
  if (!isObject(record)) return `missing or invalid \`${at}\``;
  const source = obj['reliefSource'];
  if (!isObject(source) || source['kind'] !== 'legacy-mesh') {
    return `invalid \`${at}\`: only an STL relief is a side of a split`;
  }
  return firstError([
    requireLiteral(record, `${at}.side`, ['A', 'B']),
    requirePositiveNumber(record, `${at}.stockThicknessMm`),
    requirePositiveNumber(record, `${at}.modelDepthMm`),
    requirePositiveNumber(record, `${at}.splitHeightMm`),
    requireNonNegativeNumber(record, `${at}.webMm`),
  ]);
}
