import { calcFromComponentValues, mathFunctionNames } from '@csstools/css-calc';
import {
  FunctionNode,
  TokenNode,
  isFunctionNode,
  isSimpleBlockNode,
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  parseListOfComponentValues,
  type ComponentValue,
} from '@csstools/css-parser-algorithms';
import {
  NumberType,
  TokenType,
  isTokenComment,
  isTokenDelim,
  isTokenDimension,
  isTokenIdent,
  isTokenNumber,
  isTokenOpenParen,
  isTokenPercentage,
  isTokenWhitespace,
  tokenize,
} from '@csstools/css-tokenizer';

const OPTIONS = {
  rawPercentages: true,
  precision: -1,
  toCanonicalUnits: true,
  censorIntoStandardRepresentableValues: true,
};
type Quantity = { amount: number; powers: ReadonlyMap<string, number>; contextual: boolean };
const CANONICAL_TYPES = new Map([
  ['px', 'length'],
  ['deg', 'angle'],
  ['s', 'time'],
  ['hz', 'frequency'],
  ['dpi', 'resolution'],
]);
const RELATIVE_LENGTHS = new Set([
  'em',
  'rem',
  'ex',
  'rex',
  'cap',
  'rcap',
  'ch',
  'rch',
  'ic',
  'ric',
  'lh',
  'rlh',
  'vw',
  'vh',
  'vi',
  'vb',
  'vmin',
  'vmax',
  'svw',
  'svh',
  'svi',
  'svb',
  'svmin',
  'svmax',
  'lvw',
  'lvh',
  'lvi',
  'lvb',
  'lvmin',
  'lvmax',
  'dvw',
  'dvh',
  'dvi',
  'dvb',
  'dvmin',
  'dvmax',
  'cqw',
  'cqh',
  'cqi',
  'cqb',
  'cqmin',
  'cqmax',
]);
// CSS Values 4 section 7.4: 1dppx (also 1x) = 96dpi; an inch is 2.54cm.
const RESOLUTION_DPI = new Map([
  ['dpi', 1],
  ['dpcm', 2.54],
  ['dppx', 96],
  ['x', 96],
]);

/** Evaluate a single context-free CSS math value, preserving its numeric type. */
export function svgOpacityMath(value: string): number | 'unresolved' | null {
  const tokens = tokenize({ css: value }).filter((token) => !isTokenComment(token));
  if (!validOperatorWhitespace(tokens)) return null;
  try {
    const values = parseListOfComponentValues(tokens).filter(
      (node) => !isWhiteSpaceOrCommentNode(node),
    );
    const [node] = values;
    if (
      values.length !== 1 ||
      !isFunctionNode(node) ||
      !mathFunctionNames.has(node.getName().toLowerCase())
    )
      return null;
    const result = fold(node);
    if (result === null || !isOpacityType(result)) return null;
    // A relative scale can be zero: em/em is NaN at font-size:0. Retain its
    // valid winning declaration, but disclose the importer cannot resolve it.
    if (result.contextual) return 'unresolved';
    const amount = result.powers.has('percentage') ? result.amount / 100 : result.amount;
    return Number.isNaN(amount) ? 0 : Math.min(1, Math.max(0, amount));
  } catch {
    return null;
  }
}

// Comments do not count as the whitespace CSS requires around binary +/-.
function validOperatorWhitespace(tokens: ReturnType<typeof tokenize>): boolean {
  return tokens.every((token, index) => {
    if (!isTokenDelim(token) || (token[4].value !== '+' && token[4].value !== '-')) return true;
    return isTokenWhitespace(tokens[index - 1]) && isTokenWhitespace(tokens[index + 1]);
  });
}

// The component parser owns tokenization and structure; css-calc owns scalar
// functions and canonical units. Typed arithmetic below carries exponents until
// the whole expression resolves, so a length squared can cancel later without
// treating an intermediate dimension as an opacity or reassociating products.
function fold(node: ComponentValue): Quantity | null {
  if (isTokenNode(node)) return scalar(node);
  if (isSimpleBlockNode(node))
    return isTokenOpenParen(node.startToken) ? expression(node.value) : null;
  if (!isFunctionNode(node) || !mathFunctionNames.has(node.getName().toLowerCase())) return null;
  if (node.getName().toLowerCase() === 'calc') return expression(node.value);
  return foldFunction(node);
}

function expression(values: ComponentValue[]): Quantity | null {
  const input = values.filter((node) => !isWhiteSpaceOrCommentNode(node));
  let result: Quantity | null = null;
  let sign = 1;
  for (let from = 0; from < input.length; ) {
    let end = from + 1;
    while (end < input.length && !['+', '-'].includes(operator(input[end]) ?? '')) end += 1;
    const term = product(input.slice(from, end));
    if (term === null) return null;
    if (result === null) result = term;
    else {
      if (!sameType(result, term)) return null;
      result = add(result, term, sign);
    }
    if (end === input.length) return result;
    sign = operator(input[end]) === '-' ? -1 : 1;
    from = end + 1;
    if (from === input.length) return null;
  }
  return result;
}

function add(left: Quantity, right: Quantity, sign: number): Quantity {
  return {
    amount: left.amount + sign * right.amount,
    powers: left.powers,
    contextual: left.contextual || right.contextual,
  };
}

function product(input: ComponentValue[]): Quantity | null {
  const first = input[0];
  if (first === undefined || input.length % 2 === 0) return null;
  let result = fold(first);
  for (let at = 1; at < input.length && result !== null; at += 2) {
    const op = operator(input[at]);
    const node = input[at + 1];
    const right = node === undefined ? null : fold(node);
    if ((op !== '*' && op !== '/') || right === null) return null;
    result = multiply(result, right, op === '/');
  }
  return result;
}

function multiply(left: Quantity, right: Quantity, divide: boolean): Quantity {
  const powers = new Map(left.powers);
  for (const [unit, exponent] of right.powers) {
    const combined = (powers.get(unit) ?? 0) + (divide ? -exponent : exponent);
    if (combined === 0) powers.delete(unit);
    else powers.set(unit, combined);
  }
  return {
    amount: divide ? left.amount / right.amount : left.amount * right.amount,
    powers,
    contextual: left.contextual || right.contextual,
  };
}

function foldFunction(node: FunctionNode): Quantity | null {
  const args: Quantity[] = [];
  const represented: (ComponentValue[] | null)[] = [];
  let from = 0;
  for (let at = 0; at <= node.value.length; at += 1) {
    const token = node.value[at];
    if (at !== node.value.length && !(isTokenNode(token) && token.value[0] === TokenType.Comma))
      continue;
    const raw = node.value.slice(from, at);
    const arg = expression(raw);
    // Strategy keywords (round) and none (clamp) remain the library's grammar.
    // Other failures include unsupported types: allowing those into a scalar
    // function can conceal their type (e.g. sign(1fr) becomes a number).
    if (arg === null) {
      if (!isKeywordArgument(node.getName().toLowerCase(), represented.length, raw)) return null;
      represented.push(raw);
    } else {
      args.push(arg);
      const token = represent(arg);
      represented.push(token === null ? null : [token]);
    }
    from = at + 1;
  }
  if (represented.every((arg) => arg !== null)) {
    const values = represented.flatMap((arg, index) =>
      index === 0 ? arg : [new TokenNode([TokenType.Comma, ',', -1, -1, undefined]), ...arg],
    );
    const solved = scalarResult(solve(new FunctionNode(node.name, node.endToken, values)));
    return solved === null
      ? null
      : { ...solved, contextual: solved.contextual || args.some((arg) => arg.contextual) };
  }
  // Function arguments must themselves resolve to a number, dimension or
  // percentage. Compound exponents may cancel inside calc, not across a
  // min/max/clamp (or other scalar function) boundary.
  return null;
}

function isKeywordArgument(name: string, index: number, values: ComponentValue[]): boolean {
  const args = values.filter((node) => !isWhiteSpaceOrCommentNode(node));
  const [node] = args;
  if (args.length !== 1 || !isTokenNode(node) || !isTokenIdent(node.value)) return false;
  const keyword = node.value[4].value.toLowerCase();
  if (name === 'round' && index === 0)
    return ['nearest', 'up', 'down', 'to-zero'].includes(keyword);
  return name === 'clamp' && (index === 0 || index === 2) && keyword === 'none';
}

function scalar(node: TokenNode): Quantity | null {
  if (isTokenDimension(node.value)) {
    const token = node.value;
    const unit = token[4].unit.toLowerCase();
    if (RELATIVE_LENGTHS.has(unit))
      return { amount: token[4].value, powers: new Map([['length', 1]]), contextual: true };
    const resolution = RESOLUTION_DPI.get(unit);
    if (resolution !== undefined)
      return {
        amount: token[4].value * resolution,
        powers: new Map([['resolution', 1]]),
        contextual: false,
      };
  }
  return scalarResult(solve(calculation([node])));
}

function scalarResult(node: ComponentValue): Quantity | null {
  if (!isTokenNode(node)) return null;
  const token = node.value;
  if (isTokenNumber(token)) return { amount: token[4].value, powers: new Map(), contextual: false };
  if (isTokenPercentage(token))
    return { amount: token[4].value, powers: new Map([['percentage', 1]]), contextual: false };
  if (!isTokenDimension(token)) return null;
  const unit = token[4].unit.toLowerCase();
  const type = CANONICAL_TYPES.get(unit);
  if (type !== undefined)
    return { amount: token[4].value, powers: new Map([[type, 1]]), contextual: false };
  return RELATIVE_LENGTHS.has(unit)
    ? { amount: token[4].value, powers: new Map([['length', 1]]), contextual: true }
    : null;
}

function represent(value: Quantity): TokenNode | null {
  const amount = value.contextual ? 1 : value.amount;
  const type = Number.isInteger(amount) ? NumberType.Integer : NumberType.Number;
  if (value.powers.size === 0)
    return new TokenNode([TokenType.Number, String(amount), -1, -1, { value: amount, type }]);
  if (value.powers.size !== 1) return null;
  const [dimension, power] = [...value.powers][0] ?? [];
  if (power !== 1) return null;
  if (dimension === 'percentage')
    return new TokenNode([TokenType.Percentage, `${amount}%`, -1, -1, { value: amount }]);
  const unit = [...CANONICAL_TYPES].find(([, kind]) => kind === dimension)?.[0];
  return unit === undefined
    ? null
    : new TokenNode([
        TokenType.Dimension,
        `${amount}${unit}`,
        -1,
        -1,
        { value: amount, type, unit },
      ]);
}

function sameType(a: Quantity, b: Quantity): boolean {
  return (
    a.powers.size === b.powers.size &&
    [...a.powers].every(([unit, power]) => b.powers.get(unit) === power)
  );
}
function isOpacityType(value: Quantity): boolean {
  return (
    value.powers.size === 0 || (value.powers.size === 1 && value.powers.get('percentage') === 1)
  );
}
function operator(node: ComponentValue | undefined): string | null {
  return isTokenNode(node) && isTokenDelim(node.value) ? node.value[4].value : null;
}
function calculation(values: ComponentValue[]): FunctionNode {
  return new FunctionNode(
    [TokenType.Function, 'calc(', -1, -1, { value: 'calc' }],
    [TokenType.CloseParen, ')', -1, -1, undefined],
    values,
  );
}
function solve(node: FunctionNode): ComponentValue {
  return calcFromComponentValues([[node]], OPTIONS)[0]?.[0] ?? node;
}
