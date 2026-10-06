import type { ControllerKind } from '../../devices';
import { GRBL_LINE_BUFFER_CHARS, GRBLHAL_LINE_BUFFER_CHARS } from './line-buffer-limit';

export type EncodedGrblSettingValue =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'blocked'; readonly reason: string };

type EncodingRefusal = Extract<EncodedGrblSettingValue, { readonly kind: 'blocked' }>;
type DecimalParts = {
  readonly kind: 'parsed';
  readonly source: string;
  readonly sign: string;
  readonly integerLength: number;
  readonly digits: string;
  readonly parsed: number;
  readonly exponent: string | undefined;
};
type DecimalWord = { readonly sign: string; readonly digits: string; readonly point: number };
type FloatParser = {
  readonly name: string;
  readonly digits: number;
  readonly skipLeading: boolean;
};

const STOCK_FLOAT_PARSER: FloatParser = { name: 'Stock GRBL', digits: 8, skipLeading: false };
const HAL_FLOAT_PARSER: FloatParser = { name: 'grblHAL', digits: 9, skipLeading: true };
// Decimal settings among the known writable GRBL rows. HAL uses read_uint
// for its other setting datatypes, so its float limit must not apply to them.
const HAL_DECIMAL_IDS: ReadonlySet<number> = new Set([
  0, 11, 12, 24, 25, 27, 30, 31, 100, 101, 102, 110, 111, 112, 120, 121, 122, 130, 131, 132,
]);

// Stock GRBL read_float stops at E, retains the first eight digits (including
// leading zeroes); HAL keeps nine after leading zeroes. Both store a float.
// Keep supported spelling first, then try a compact decimal without rounding.
// These are wire representation limits, not physical machine ranges.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/nuts_bolts.c#L20-L97
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L238-L294
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.h#L438
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2171-L2285
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L3295-L3335
export function encodeGrblSettingValue(
  id: number,
  value: number | string,
  controllerKind: ControllerKind = 'grbl-v1.1',
): EncodedGrblSettingValue {
  const parts = parseDecimalValue(value);
  if (parts.kind === 'blocked') return parts;
  const lineLimit =
    controllerKind === 'grblhal' ? GRBLHAL_LINE_BUFFER_CHARS : GRBL_LINE_BUFFER_CHARS;
  const valueLimit = lineLimit - `$${id}=`.length;
  if (controllerKind === 'grblhal' && !HAL_DECIMAL_IDS.has(id)) {
    return encodeHalInteger(parts, valueLimit);
  }
  const parser = floatParserFor(id, controllerKind);
  for (const compact of [false, true]) {
    const decimal = expandDecimal(parts, valueLimit, compact);
    const issue = decimalIssue(decimal, parts.parsed, valueLimit, parser);
    if (issue === null && decimal !== null) return { kind: 'ok', value: decimal };
    if (compact && issue !== null) return blocked(issue);
  }
  return blocked('The decimal value cannot be represented for this controller.');
}

function encodeHalInteger(parts: DecimalParts, valueLimit: number): EncodedGrblSettingValue {
  // HAL's read_uint accepts a decimal point but multiplies its accumulator
  // for fractional zeroes: 25.0 becomes 250. Expand the exact input first,
  // then send only unsigned integer digits, never a rounded Number value.
  // https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L184-L229
  const integer = parts.parsed === 0 ? '0' : expandDecimal(parts, valueLimit, true);
  if (integer === null || !/^\d+$/.test(integer)) {
    return blocked('Enter an unsigned integer that this grblHAL setting can represent.');
  }
  // This parser also skips overflowing digits, including a tenth digit above
  // four. Refuse before writing instead of discovering corruption in readback.
  let stored = 0;
  for (let index = 0; index < integer.length; index++) {
    const digit = Number(integer[index]);
    if ((index < 9 || digit <= 4) && stored <= 429496729) {
      stored = stored * 10 + digit;
    }
  }
  return stored === parts.parsed
    ? { kind: 'ok', value: integer }
    : blocked('grblHAL cannot parse this integer without dropping digits.');
}

function parseDecimalValue(value: number | string): DecimalParts | EncodingRefusal {
  const source = String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (match === null) return blocked('Enter a finite decimal number.');
  const integer = match[2] ?? '';
  const fraction = match[3] ?? '';
  const digits = integer + fraction;
  const parsed = Number(source);
  if (digits === '' || !Number.isFinite(parsed)) {
    return blocked('Enter a finite decimal number.');
  }
  if (parsed === 0 && /[1-9]/.test(digits)) {
    return blocked('The decimal value is too small to represent without becoming zero.');
  }

  return {
    kind: 'parsed',
    source,
    sign: match[1] ?? '',
    integerLength: integer.length,
    digits,
    parsed,
    exponent: match[4],
  };
}

function expandDecimal(parts: DecimalParts, valueLimit: number, compact: boolean): string | null {
  if (!compact && parts.exponent === undefined) return parts.source;
  if (parts.parsed === 0) return `${parts.sign}0`;
  const word = decimalWord(parts, compact);
  if (!Number.isSafeInteger(word.point) || decimalLength(word, compact) > valueLimit) {
    return null;
  }
  const { sign, digits, point } = word;
  if (point <= 0) return `${sign}${compact ? '' : '0'}.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) {
    return sign + digits + '0'.repeat(point - digits.length);
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function decimalWord(parts: DecimalParts, compact: boolean): DecimalWord {
  const point = parts.integerLength + Number(parts.exponent ?? 0);
  if (!compact) return { sign: parts.sign, digits: parts.digits, point };
  const digits = parts.digits.replace(/^0+/, '');
  return {
    sign: parts.sign === '+' ? '' : parts.sign,
    digits: digits.replace(/0+$/, ''),
    point: point - (parts.digits.length - digits.length),
  };
}

function decimalLength({ sign, digits, point }: DecimalWord, compact: boolean): number {
  if (point <= 0) return sign.length + (compact ? 1 : 2) - point + digits.length;
  return sign.length + Math.max(point, digits.length) + (point < digits.length ? 1 : 0);
}

function floatParserFor(id: number, controllerKind: ControllerKind): FloatParser | null {
  if (controllerKind === 'grbl-v1.1') return STOCK_FLOAT_PARSER;
  return controllerKind === 'grblhal' && HAL_DECIMAL_IDS.has(id) ? HAL_FLOAT_PARSER : null;
}

function decimalIssue(
  decimal: string | null,
  parsed: number,
  valueLimit: number,
  parser: FloatParser | null,
): string | null {
  if (decimal === null || decimal.length > valueLimit) {
    return 'The decimal value is too long for the controller setting command.';
  }
  if (parser === null) return null;
  const word = parserWord(decimal, parser.skipLeading);
  return floatIssue(word, parser, parsed);
}

function floatIssue(word: DecimalWord, parser: FloatParser, parsed: number): string | null {
  const stored = parserMagnitude(word, parser.digits);
  const rounded = Math.fround(Math.abs(parsed));
  if (!Number.isFinite(stored) || !Number.isFinite(rounded)) {
    return `${parser.name} cannot store a finite value of this magnitude.`;
  }
  if (parsed !== 0 && stored === 0) {
    return `${parser.name} would store this non-zero decimal as zero.`;
  }
  if (parsed !== 0 && rounded === 0) {
    return `${parser.name} cannot represent this non-zero value at its float precision.`;
  }
  // Ignore digits already below native float precision. Decimal truncation is
  // lossy only when it changes that precision and the parser does not itself
  // produce the expected float. Keep the original wire text in the other case.
  return retainedFloat(word, parser.digits) !== rounded && stored !== rounded
    ? `${parser.name} cannot parse this decimal without dropping non-zero digits.`
    : null;
}

function retainedFloat({ digits, point }: DecimalWord, digitLimit: number): number {
  const retained = digits.slice(0, digitLimit);
  return Math.fround(Number(`${retained || '0'}e${point - retained.length}`));
}

function parserWord(decimal: string, skipLeading: boolean): DecimalWord {
  const unsigned = decimal.replace(/^[+-]/, '');
  const dot = unsigned.indexOf('.');
  const point = dot === -1 ? unsigned.length : dot;
  const digits = unsigned.replace('.', '');
  if (!skipLeading) return { sign: '', digits, point };
  const retained = digits.replace(/^0+/, '');
  return { sign: '', digits: retained, point: point - (digits.length - retained.length) };
}

// Model only the float arithmetic's finite/non-zero boundary, allowing normal
// binary rounding. Never use the rounded result as the operator's wire value.
function parserMagnitude({ digits, point }: DecimalWord, digitLimit: number): number {
  const retained = digits.slice(0, digitLimit);
  let magnitude = Math.fround(Number(retained));
  let exponent = point - retained.length;
  while (exponent >= 1) {
    magnitude = Math.fround(magnitude * 10);
    exponent -= 1;
  }
  while (exponent <= -2) {
    magnitude = Math.fround(magnitude * Math.fround(0.01));
    exponent += 2;
  }
  return exponent === -1 ? Math.fround(magnitude * Math.fround(0.1)) : magnitude;
}

function blocked(reason: string): EncodingRefusal {
  return { kind: 'blocked', reason };
}
