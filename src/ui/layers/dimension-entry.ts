import { evaluateNumericEntry, type NumericEntryResult } from '../../core/numeric-expression';
import type { DisplayLengthUnit } from '../display-length';

/** Lengths and feeds enter at the display boundary; the result is always mm
 * (or mm/min). A feed may spell its unit with the field's /min suffix. */
export function dimensionEntry(
  text: string,
  unit: DisplayLengthUnit,
  dimension: 'length' | 'feed',
): NumericEntryResult {
  const expression = dimension === 'feed' ? text.replace(/(mm|cm|in)\s*\/\s*min\b/gi, '$1') : text;
  return evaluateNumericEntry(expression, { kind: 'length', lengthUnit: unit });
}

export function dimensionEntryError(
  text: string,
  unit: DisplayLengthUnit,
  dimension: 'length' | 'feed',
): string | null {
  const result = dimensionEntry(text, unit, dimension);
  return result.kind === 'invalid' ? `Enter a value in ${unit}: ${result.message}.` : null;
}
