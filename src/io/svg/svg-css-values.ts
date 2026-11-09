// CSS values that SVG transforms are written in (CSS Values 4, CSS Transforms
// 1 and 2): lengths in absolute units, percentages, angles, numbers, and
// lists of `name(arguments)` functions. Every reader is a single linear scan
// (ADR-268 Amendment 2). In SVG, one CSS px is one user unit.

import { readSvgNumber } from './svg-transform-attribute';

/** A length-percentage: `px` user units plus `percent` of a reference size. */
export type CssLengthPercentage = { readonly px: number; readonly percent: number };

/**
 * 'invalid': a browser ignores the declaration. 'unresolved': valid CSS whose
 * value depends on things the importer does not model (fonts, the window,
 * calc(), custom properties), so it cannot be placed faithfully.
 */
export type CssValueProblem = 'invalid' | 'unresolved';

const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};
const ANGLE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};
// Font-, line-, viewport- and container-relative units (CSS Values 4 §6).
const RELATIVE_UNIT =
  /^(?:r?(?:em|ex|ch|cap|ic|lh)|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/;
const MAX_TOKEN_LENGTH = 64;
// Functions that substitute or compute a value (CSS Variables, CSS Values 4).
const SUBSTITUTION_OR_MATH =
  /^(?:var|env|attr|calc|min|max|clamp|round|mod|rem|sin|cos|tan|asin|acos|atan2?|pow|sqrt|hypot|log|exp|abs|sign)$/i;

/** A CSS value with comments and a trailing `!important` removed, trimmed. */
export function cssValueText(value: string): string {
  let text = '';
  let at = 0;
  for (;;) {
    const open = value.indexOf('/*', at);
    if (open < 0) break;
    text += value.slice(at, open) + ' ';
    const close = value.indexOf('*/', open + 2);
    at = close < 0 ? value.length : close + 2;
  }
  text += value.slice(at);
  return text
    .trim()
    .replace(/!\s*important$/i, '')
    .trim();
}

/** A CSS-wide keyword, lower-cased, or null for an ordinary value. */
export function cssWideKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  return ['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(lower) ? lower : null;
}

/** True when the value needs substitution or math the importer does not evaluate. */
export function cssValueHasFunction(text: string): boolean {
  return text.includes('(');
}

type NumericToken = { readonly value: number; readonly unit: string };

/** One `<number><unit>?` token: the number and its lower-cased unit ('' or '%'). */
function numericToken(token: string): NumericToken | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const number = readSvgNumber(token, 0);
  if (number === null) return null;
  const unit = token.slice(number.end).toLowerCase();
  if (unit !== '' && unit !== '%' && !/^[a-z]+$/.test(unit)) return null;
  return { value: number.value, unit };
}

/**
 * A length, or a length-percentage when `percent` allows it. A unitless
 * number is a length only when it is zero, or when `unitless` allows it (SVG
 * presentation attributes read bare numbers as user units).
 */
export function cssLength(
  token: string,
  options: { readonly percent: boolean; readonly unitless?: boolean },
): CssLengthPercentage | CssValueProblem {
  const parsed = numericToken(token);
  if (parsed === null) return 'invalid';
  const { value, unit } = parsed;
  if (unit === '%') return options.percent ? { px: 0, percent: value / 100 } : 'invalid';
  if (unit === '') {
    return value === 0 || options.unitless === true ? { px: value, percent: 0 } : 'invalid';
  }
  const scale = Object.hasOwn(ABSOLUTE_UNITS, unit) ? ABSOLUTE_UNITS[unit] : undefined;
  if (scale !== undefined) return { px: value * scale, percent: 0 };
  return RELATIVE_UNIT.test(unit) ? 'unresolved' : 'invalid';
}

/** An angle in degrees. A unitless angle is allowed only as zero. */
export function cssAngle(token: string): number | 'invalid' {
  const parsed = numericToken(token);
  if (parsed === null) return 'invalid';
  if (parsed.unit === '') return parsed.value === 0 ? 0 : 'invalid';
  const scale = Object.hasOwn(ANGLE_UNITS, parsed.unit) ? ANGLE_UNITS[parsed.unit] : undefined;
  return scale === undefined ? 'invalid' : parsed.value * scale;
}

/** A plain number, or a percentage as a fraction when `percent` allows it. */
export function cssNumber(token: string, percent = false): number | 'invalid' {
  const parsed = numericToken(token);
  if (parsed === null) return 'invalid';
  if (parsed.unit === '') return parsed.value;
  return percent && parsed.unit === '%' ? parsed.value / 100 : 'invalid';
}

/** The first problem among parsed values, or null when every value parsed. */
export function firstCssProblem(values: ReadonlyArray<unknown>): CssValueProblem | null {
  if (values.includes('invalid')) return 'invalid';
  return values.includes('unresolved') ? 'unresolved' : null;
}

export type CssFunction = { readonly name: string; readonly args: ReadonlyArray<string> };

/**
 * `name(a, b) name(c)`: functions separated by optional white space, their
 * arguments by commas. Names are case-insensitive. An argument holding white
 * space or a nested function is not a single value: a nested function such as
 * calc() is 'unresolved', anything else 'invalid'.
 */
export function cssFunctionList(text: string): CssFunction[] | CssValueProblem {
  const functions: CssFunction[] = [];
  let at = skipCssSpace(text, 0);
  while (at < text.length) {
    let nameEnd = at;
    while (nameEnd < text.length && /[a-zA-Z0-9-]/.test(text.charAt(nameEnd))) nameEnd += 1;
    if (nameEnd === at || text[nameEnd] !== '(') return 'invalid';
    if (SUBSTITUTION_OR_MATH.test(text.slice(at, nameEnd))) return 'unresolved';
    const close = text.indexOf(')', nameEnd);
    if (close < 0) return 'invalid';
    const inner = text.slice(nameEnd + 1, close);
    if (inner.includes('(')) return 'unresolved';
    const args = inner.split(',').map((arg) => arg.trim());
    if (args.some((arg) => arg === '' || /\s/.test(arg))) return 'invalid';
    functions.push({ name: text.slice(at, nameEnd).toLowerCase(), args });
    at = skipCssSpace(text, close + 1);
  }
  return functions;
}

/** White-space separated tokens of a property value such as `translate: 1px 2px`. */
export function cssTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token !== '');
}

function skipCssSpace(text: string, start: number): number {
  let at = start;
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
  return at;
}
