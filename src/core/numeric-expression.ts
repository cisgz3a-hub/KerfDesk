// Numeric entry evaluator for the selection X / Y / Width / Height / Rotation
// boxes (LightBurn gap LBG-F12). An operator can type math (`10+5`,
// `2*(3+4)`, `2^3`), a unit (`1in`, `2.5cm`, `90deg`) or, where the caller
// allows it, a percentage of the current value (`50%`). A hand-written
// recursive-descent parser does the work: no `eval`, no `Function`, nothing
// that can run arbitrary code.
//
// The result is always in the internal unit — millimetres for lengths, degrees
// for angles. Typing `1in` is the explicit input-boundary conversion PROJECT.md
// non-negotiable 6 permits; nothing here shows inches back to the operator.
//
// Grammar, loosest binding first (whitespace allowed between any tokens):
//   sum     := product (('+' | '-') product)*
//   product := unary (('*' | '/') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := postfix ('^' unary)?          right-associative: 2^3^2 = 2^9
//   postfix := primary unit?                 unit: mm cm in " | deg ° | %
//   primary := number | constant | function group | group
//   constant: pi e; function: sqrt abs sin cos tan asin acos atan log ln
// Trigonometry works in degrees, like every angle box in KerfDesk; log is base 10.
//   group   := '(' sum ')'
// Numbers use a decimal point (12, 12.5, 12., .5, 1e3); a comma is refused
// rather than guessed at. Words are case-insensitive.
//
// A unit on the last factor of a product, with none on the factors before it,
// applies to the whole product: `1/2in` is half an inch and `3/4"` three
// quarters of one, as a woodworker means them, not 1 mm over 2 inches. A unit
// on any other factor stays on its own number (`10mm/2` is 5 mm), and a
// product of multiplications comes out the same either way.

const MM_PER_INCH = 25.4;
// A cap on what is parsed at all keeps a pasted wall of brackets from
// recursing deep enough to overflow the stack.
const MAX_ENTRY_LENGTH = 200;

export type NumericEntryKind = 'length' | 'angle';

export type NumericEntryOptions = {
  readonly kind: NumericEntryKind;
  /** The current value `%` is a share of. Omit where a percentage means nothing. */
  readonly percentOf?: number;
};

/** `message` is a short lower-case reason with no final full stop, for embedding in a sentence. */
export type NumericEntryResult =
  | { readonly kind: 'ok'; readonly value: number }
  | { readonly kind: 'invalid'; readonly message: string };

type Token =
  | { readonly kind: 'number'; readonly text: string; readonly value: number }
  | { readonly kind: 'word'; readonly text: string }
  | { readonly kind: 'symbol'; readonly text: string };

type Cursor = {
  readonly tokens: ReadonlyArray<Token>;
  readonly options: NumericEntryOptions;
  index: number;
  failure: string | null;
};

const LENGTH_UNITS: ReadonlyMap<string, number> = new Map([
  ['mm', 1],
  ['cm', 10],
  ['in', MM_PER_INCH],
  ['"', MM_PER_INCH],
]);
const ANGLE_UNITS: ReadonlyMap<string, number> = new Map([
  ['deg', 1],
  ['°', 1],
]);
const RADIANS_PER_DEGREE = Math.PI / 180;
const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);
const FUNCTIONS: ReadonlyMap<string, (value: number) => number> = new Map([
  ['sqrt', Math.sqrt],
  ['abs', Math.abs],
  ['sin', (degrees: number) => Math.sin(degrees * RADIANS_PER_DEGREE)],
  ['cos', (degrees: number) => Math.cos(degrees * RADIANS_PER_DEGREE)],
  ['tan', (degrees: number) => Math.tan(degrees * RADIANS_PER_DEGREE)],
  ['asin', (value: number) => Math.asin(value) / RADIANS_PER_DEGREE],
  ['acos', (value: number) => Math.acos(value) / RADIANS_PER_DEGREE],
  ['atan', (value: number) => Math.atan(value) / RADIANS_PER_DEGREE],
  ['log', Math.log10],
  ['ln', Math.log],
]);
const SYMBOLS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '^', '(', ')', '%', '"', '°']);
const OPERATORS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '^', '(']);
// Scientific notation (1e3) stays accepted because the old type="number" box took it.
const NUMBER_PATTERN = /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iy;
const WORD_PATTERN = /[a-z]+/iy;
const SPACE_PATTERN = /\s/;

export function evaluateNumericEntry(
  text: string,
  options: NumericEntryOptions,
): NumericEntryResult {
  if (text.length > MAX_ENTRY_LENGTH) return invalid('it is too long to read');
  const tokens = tokenize(text);
  if (tokens.kind === 'invalid') return tokens;
  if (tokens.tokens.length === 0) return invalid('the box is empty');
  const cursor: Cursor = { tokens: tokens.tokens, options, index: 0, failure: null };
  const value = parseSum(cursor);
  const extra = cursor.tokens[cursor.index];
  if (cursor.failure === null && extra !== undefined) fail(cursor, strayTokenMessage(extra, true));
  if (cursor.failure !== null) return invalid(cursor.failure);
  if (Number.isNaN(value)) return invalid("the result isn't a real number");
  if (!Number.isFinite(value)) return invalid('the result is too large');
  return { kind: 'ok', value };
}

function invalid(message: string): NumericEntryResult {
  return { kind: 'invalid', message };
}

type TokenizeResult =
  | { readonly kind: 'ok'; readonly tokens: ReadonlyArray<Token> }
  | { readonly kind: 'invalid'; readonly message: string };

function tokenize(text: string): TokenizeResult {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    if (SPACE_PATTERN.test(text.charAt(index))) {
      index += 1;
      continue;
    }
    const token = readToken(text, index);
    if (typeof token === 'string') return { kind: 'invalid', message: token };
    tokens.push(token);
    index += token.text.length;
  }
  return { kind: 'ok', tokens };
}

/** The token starting at `start`, or why the character there can't start one. */
function readToken(text: string, start: number): Token | string {
  const number = matchAt(NUMBER_PATTERN, text, start);
  if (number !== null) return { kind: 'number', text: number, value: Number(number) };
  const word = matchAt(WORD_PATTERN, text, start);
  if (word !== null) return { kind: 'word', text: word.toLowerCase() };
  const char = text.charAt(start);
  if (SYMBOLS.has(char)) return { kind: 'symbol', text: char };
  if (char === ',') return 'use a dot for decimals, not a comma';
  return `"${char}" isn't a number, operator or unit`;
}

function matchAt(pattern: RegExp, text: string, start: number): string | null {
  pattern.lastIndex = start;
  return pattern.exec(text)?.[0] ?? null;
}

/** Record the first failure only; later calls unwind without overwriting it. */
function fail(cursor: Cursor, message: string): number {
  if (cursor.failure === null) cursor.failure = message;
  return Number.NaN;
}

function takeSymbol(cursor: Cursor, symbols: ReadonlySet<string>): string | null {
  const token = cursor.tokens[cursor.index];
  if (cursor.failure !== null || token?.kind !== 'symbol' || !symbols.has(token.text)) return null;
  cursor.index += 1;
  return token.text;
}

const SUM_OPERATORS: ReadonlySet<string> = new Set(['+', '-']);
const PRODUCT_OPERATORS: ReadonlySet<string> = new Set(['*', '/']);
const POWER_OPERATOR: ReadonlySet<string> = new Set(['^']);
const OPEN_BRACKET: ReadonlySet<string> = new Set(['(']);
const CLOSE_BRACKET: ReadonlySet<string> = new Set([')']);

function parseSum(cursor: Cursor): number {
  let value = parseProduct(cursor);
  let op = takeSymbol(cursor, SUM_OPERATORS);
  while (op !== null) {
    const right = parseProduct(cursor);
    value = op === '+' ? value + right : value - right;
    op = takeSymbol(cursor, SUM_OPERATORS);
  }
  return value;
}

// A factor of a product: its number and the scale of the unit written right
// after it, kept apart until the product knows whether the unit is its last.
type Factor = { readonly value: number; readonly scale: number | null };

// `value` reads every unit on its own number. `unitless` is the product read
// without units while no factor has carried one; when the last factor brings
// the only unit, `whole` applies it to that product instead (see the header).
function parseProduct(cursor: Cursor): number {
  const first = parseUnary(cursor);
  let value = scaled(first);
  let unitless = first.scale === null ? first.value : null;
  let whole: number | null = null;
  let op = takeSymbol(cursor, PRODUCT_OPERATORS);
  while (op !== null) {
    const right = parseUnary(cursor);
    if (op === '/' && scaled(right) === 0) return fail(cursor, 'it divides by zero');
    value = applyProductOperator(op, value, scaled(right));
    const combined = unitless === null ? null : applyProductOperator(op, unitless, right.value);
    whole = combined === null || right.scale === null ? null : combined * right.scale;
    unitless = right.scale === null ? combined : null;
    op = takeSymbol(cursor, PRODUCT_OPERATORS);
  }
  return whole ?? value;
}

function applyProductOperator(op: string, left: number, right: number): number {
  return op === '*' ? left * right : left / right;
}

function scaled(factor: Factor): number {
  return factor.scale === null ? factor.value : factor.value * factor.scale;
}

// A sign keeps the unit of what it signs, so 1/-2in is minus half an inch.
function parseUnary(cursor: Cursor): Factor {
  const sign = takeSymbol(cursor, SUM_OPERATORS);
  if (sign === null) return parsePower(cursor);
  const factor = parseUnary(cursor);
  return sign === '-' ? { value: -factor.value, scale: factor.scale } : factor;
}

// The exponent is a `unary`, so it may carry a sign (2^-1) and recurses back
// into `power` for right-associativity; a leading minus stays outside the
// power, so -2^2 is -(2^2) as on paper. A power's units are applied inside it.
function parsePower(cursor: Cursor): Factor {
  const base = parsePostfix(cursor);
  if (takeSymbol(cursor, POWER_OPERATOR) === null) return base;
  return { value: scaled(base) ** scaled(parseUnary(cursor)), scale: null };
}

function parsePostfix(cursor: Cursor): Factor {
  const value = parsePrimary(cursor);
  const token = cursor.tokens[cursor.index];
  if (cursor.failure !== null || token === undefined) return { value, scale: null };
  const scale = unitScale(cursor, token);
  if (scale === null) return { value, scale: null };
  cursor.index += 1;
  return { value, scale };
}

function parsePrimary(cursor: Cursor): number {
  const token = cursor.tokens[cursor.index];
  if (token === undefined) return fail(cursor, missingOperandMessage(cursor, null));
  if (token.kind === 'number') {
    cursor.index += 1;
    return token.value;
  }
  if (token.kind === 'word') return parseWord(cursor, token.text);
  if (token.text === '(') return parseGroup(cursor);
  return fail(cursor, missingOperandMessage(cursor, token.text));
}

function parseGroup(cursor: Cursor): number {
  takeSymbol(cursor, OPEN_BRACKET);
  const value = parseSum(cursor);
  if (takeSymbol(cursor, CLOSE_BRACKET) !== null || cursor.failure !== null) return value;
  const next = cursor.tokens[cursor.index];
  return fail(
    cursor,
    next === undefined ? 'a closing bracket ")" is missing' : strayTokenMessage(next, false),
  );
}

function parseWord(cursor: Cursor, word: string): number {
  cursor.index += 1;
  const constant = CONSTANTS.get(word);
  if (constant !== undefined) return constant;
  const apply = FUNCTIONS.get(word);
  if (apply !== undefined) {
    const next = cursor.tokens[cursor.index];
    if (next?.text !== '(') return fail(cursor, `"${word}" needs brackets, like ${word}(2)`);
    return apply(parseGroup(cursor));
  }
  if (LENGTH_UNITS.has(word) || ANGLE_UNITS.has(word)) {
    return fail(cursor, `"${word}" needs a number in front, like 2${word}`);
  }
  return fail(cursor, `"${word}" isn't a unit or function this box knows`);
}

/** The factor a unit suffix applies, or null when `token` is not a unit. */
function unitScale(cursor: Cursor, token: Token): number | null {
  if (token.kind === 'number') return null;
  if (token.text === '%') {
    const percentOf = cursor.options.percentOf;
    if (percentOf === undefined) return fail(cursor, 'percentages only work in Width and Height');
    return percentOf / 100;
  }
  const units = cursor.options.kind === 'length' ? LENGTH_UNITS : ANGLE_UNITS;
  const scale = units.get(token.text);
  if (scale !== undefined) return scale;
  if (LENGTH_UNITS.has(token.text)) {
    return fail(cursor, `${quoted(token.text)} is a length unit, but this box takes an angle`);
  }
  if (ANGLE_UNITS.has(token.text)) {
    return fail(cursor, `${quoted(token.text)} is an angle unit, but this box takes a length`);
  }
  return null;
}

function missingOperandMessage(cursor: Cursor, found: string | null): string {
  const previous = cursor.tokens[cursor.index - 1];
  if (previous?.kind === 'symbol' && OPERATORS.has(previous.text)) {
    return `a number is missing after "${previous.text}"`;
  }
  if (found === ')') return '")" has no matching "("';
  return found === null ? 'a number is missing' : `${quoted(found)} needs a number in front of it`;
}

function strayTokenMessage(token: Token, topLevel: boolean): string {
  if (token.text === ')' && topLevel) return '")" has no matching "("';
  if (token.kind === 'symbol' && token.text !== '(')
    return `${quoted(token.text)} is in the wrong place`;
  return `an operator such as + or * is missing before "${token.text}"`;
}

// Wrapping the inch mark in straight quotes would read as `"""`.
function quoted(text: string): string {
  return text === '"' ? 'the inch mark (")' : `"${text}"`;
}
