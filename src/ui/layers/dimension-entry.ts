import { evaluateNumericEntry, type NumericEntryResult } from '../../core/numeric-expression';
import type { DisplayLengthUnit } from '../display-length';

// A speed per second, as vendor guides and the LightBurn forum often give it:
// "100 mm/s" or "4 in/sec" is sixty times that per minute (UX audit U8-P3-4).
const PER_SECOND = /(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|in)\s*\/\s*(?:s|secs?|seconds?)\b/gi;

/** Lengths and feeds enter at the display boundary; the result is always mm
 * (or mm/min). A feed may spell its unit with the field's /min suffix, or per
 * second, which is converted here (PROJECT.md non-negotiable 6 allows explicit
 * input conversion). */
export function dimensionEntry(
  text: string,
  unit: DisplayLengthUnit,
  dimension: 'length' | 'feed',
): NumericEntryResult {
  const expression =
    dimension === 'feed'
      ? text.replace(PER_SECOND, '($1 $2 * 60)').replace(/(mm|cm|in)\s*\/\s*min\b/gi, '$1')
      : text;
  return evaluateNumericEntry(expression, { kind: 'length', lengthUnit: unit });
}

export function dimensionEntryError(
  text: string,
  unit: DisplayLengthUnit,
  dimension: 'length' | 'feed',
): string | null {
  const result = dimensionEntry(text, unit, dimension);
  if (result.kind !== 'invalid') return null;
  return dimension === 'feed'
    ? `Enter a speed in ${unit}/min (or type ${unit}/s): ${result.message}.`
    : `Enter a value in ${unit}: ${result.message}.`;
}
