// The SVG `transform` attribute: an SVG 1.1 transform list (SVG 2
// coords.html#TransformProperty keeps that grammar for the attribute). A
// browser reads it strictly: function names are case-sensitive, arguments are
// plain numbers (no units, no `turn`), and anything it cannot read voids the
// whole attribute, so the element draws untransformed (Chromium 156, ADR-574
// Amendment 1). The CSS `transform` property has its own reader
// (svg-css-transform.ts). A hand-written scan, linear in the input (ADR-268
// Amendment 2).

import { type SvgMatrix } from './svg-curve-transform';

export const IDENTITY_SVG_MATRIX: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const ARITIES: Readonly<Record<string, ReadonlyArray<number>>> = {
  matrix: [6],
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
};

/**
 * The matrix a `transform` attribute names, or null when a browser would
 * ignore the attribute. An absent, empty or `none` attribute is the identity.
 */
export function parseSvgTransformAttribute(input: string | null): SvgMatrix | null {
  if (input === null) return IDENTITY_SVG_MATRIX;
  let at = skipSpace(input, 0);
  if (at === input.length || input.slice(at).trimEnd() === 'none') return IDENTITY_SVG_MATRIX;
  let matrix = IDENTITY_SVG_MATRIX;
  for (;;) {
    const step = readFunction(input, at);
    if (step === null) return null;
    matrix = multiplySvgMatrix(matrix, step.matrix);
    at = skipSpace(input, step.end);
    if (at === input.length) return matrix;
    // One comma may separate two functions; it may not end the list.
    if (input[at] === ',') at = skipSpace(input, at + 1);
    if (at === input.length) return null;
  }
}

function readFunction(text: string, start: number): { matrix: SvgMatrix; end: number } | null {
  let at = start;
  while (at < text.length && isLetter(text.charCodeAt(at))) at += 1;
  const name = text.slice(start, at);
  const arities = Object.hasOwn(ARITIES, name) ? ARITIES[name] : undefined;
  if (arities === undefined) return null;
  at = skipSpace(text, at);
  if (text[at] !== '(') return null;
  const values: number[] = [];
  at = skipSpace(text, at + 1);
  while (text[at] !== ')') {
    if (values.length > 0 && text[at] === ',') at = skipSpace(text, at + 1);
    const number = readSvgNumber(text, at);
    if (number === null) return null;
    values.push(number.value);
    at = skipSpace(text, number.end);
    if (at >= text.length) return null;
  }
  if (!arities.includes(values.length)) return null;
  return { matrix: svgTransformFunctionMatrix(name, values), end: at + 1 };
}

/** One SVG number at `start`: sign, digits, fraction and exponent; null if none or not finite. */
export function readSvgNumber(text: string, start: number): { value: number; end: number } | null {
  let at = start;
  if (text[at] === '+' || text[at] === '-') at += 1;
  const integerEnd = skipDigits(text, at);
  let end = integerEnd;
  if (text[end] === '.') end = skipDigits(text, end + 1);
  // A mantissa needs a digit before or after its point.
  if (end - at - (text[integerEnd] === '.' ? 1 : 0) <= 0) return null;
  if (text[end] === 'e' || text[end] === 'E') {
    const sign = text[end + 1] === '+' || text[end + 1] === '-' ? 1 : 0;
    const exponentEnd = skipDigits(text, end + 1 + sign);
    if (exponentEnd > end + 1 + sign) end = exponentEnd;
  }
  const value = Number(text.slice(start, end));
  return Number.isFinite(value) ? { value, end } : null;
}

/** The matrix of one SVG 1.1 transform function with a valid argument count. */
function svgTransformFunctionMatrix(name: string, values: ReadonlyArray<number>): SvgMatrix {
  return (BUILDERS[name] ?? (() => IDENTITY_SVG_MATRIX))(values);
}

const BUILDERS: Readonly<Record<string, (values: ReadonlyArray<number>) => SvgMatrix>> = {
  matrix: ([a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]) => ({ a, b, c, d, e, f }),
  translate: ([x = 0, y = 0]) => translateSvgMatrix(x, y),
  scale: ([x = 1, y = x]) => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }),
  rotate: ([deg = 0, cx, cy]) => rotateSvgMatrix(deg, cx, cy),
  skewX: ([deg = 0]) => ({ a: 1, b: 0, c: tanDeg(deg), d: 1, e: 0, f: 0 }),
  skewY: ([deg = 0]) => ({ a: 1, b: tanDeg(deg), c: 0, d: 1, e: 0, f: 0 }),
};

export function translateSvgMatrix(x: number, y: number): SvgMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function multiplySvgMatrix(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function tanDeg(deg: number): number {
  return Math.tan((deg / 180) * Math.PI);
}

function rotateSvgMatrix(deg: number, cx?: number, cy?: number): SvgMatrix {
  const rad = (deg / 180) * Math.PI;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (cx === undefined || cy === undefined) return rotation;
  return multiplySvgMatrix(
    multiplySvgMatrix(translateSvgMatrix(cx, cy), rotation),
    translateSvgMatrix(-cx, -cy),
  );
}

// SVG white space: space, tab, line feed, form feed and carriage return.
function skipSpace(text: string, start: number): number {
  let at = start;
  while (at < text.length && ' \t\n\f\r'.includes(text.charAt(at))) at += 1;
  return at;
}

function skipDigits(text: string, start: number): number {
  let at = start;
  while (at < text.length && text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57) at += 1;
  return at;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
