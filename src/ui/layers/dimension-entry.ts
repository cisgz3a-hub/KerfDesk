import { evaluateNumericEntry, type NumericEntryResult } from '../../core/numeric-expression';
import type { DisplayLengthUnit } from '../display-length';

// A speed per second, as vendor guides and the LightBurn forum often give it:
// "100 mm/s" or "4 in/sec" is sixty times that per minute (UX audit U8-P3-4).
// The unit covers the whole box, as "1/2 in" does in a length box: "1/2 mm/s"
// is half a millimetre per second. Rewriting only the number beside the unit
// read it as 1/(2 mm × 60), which the Speed box clamped to 1 mm/min, a lit beam
// thirty times too slow (rolling audit v12 X5-P3-4; ADR-480 Amendment 5).
const TRAILING_PER_SECOND = /\s*(mm|cm|in)\s*\/\s*(?:s|secs?|seconds?)\s*$/i;
const ANY_PER_SECOND = /(mm|cm|in)\s*\/\s*(?:s|secs?|seconds?)\b/i;
const SECONDS_PER_MINUTE = 60;

/** Lengths and feeds enter at the display boundary; the result is always mm
 * (or mm/min). A feed may spell its unit with the field's /min suffix, or per
 * second after the whole value, which is converted here (PROJECT.md
 * non-negotiable 6 allows explicit input conversion). */
export function dimensionEntry(
  text: string,
  unit: DisplayLengthUnit,
  dimension: 'length' | 'feed',
): NumericEntryResult {
  const lengthUnit = { kind: 'length', lengthUnit: unit } as const;
  if (dimension === 'length') return evaluateNumericEntry(text, lengthUnit);
  const perSecond = TRAILING_PER_SECOND.exec(text);
  if (perSecond !== null) {
    const body = text.slice(0, perSecond.index);
    if (ANY_PER_SECOND.test(body)) return PER_SECOND_ONCE;
    const result = evaluateNumericEntry(`(${body}) ${perSecond[1]}`, lengthUnit);
    return result.kind === 'ok' ? { kind: 'ok', value: result.value * SECONDS_PER_MINUTE } : result;
  }
  // A per-second unit inside the expression would cover only its neighbour.
  if (ANY_PER_SECOND.test(text)) return PER_SECOND_ONCE;
  return evaluateNumericEntry(text.replace(/(mm|cm|in)\s*\/\s*min\b/gi, '$1'), lengthUnit);
}

const PER_SECOND_ONCE: NumericEntryResult = {
  kind: 'invalid',
  message: 'write mm/s once, after the whole speed, such as 1/2 mm/s',
};

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
