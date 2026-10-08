import type { NamedSketchParameter, SketchValue } from './constrained-sketch';
type Quantity = { readonly value: number; readonly unit: NamedSketchParameter['unit'] };
export type SketchParameterResult =
  | { readonly kind: 'ok'; readonly values: ReadonlyMap<string, Quantity> }
  | { readonly kind: 'error'; readonly reason: string };

/** Small arithmetic parser, never JavaScript eval. Bare numbers are scalar ratios. */
export function resolveSketchParameters(
  parameters: ReadonlyArray<NamedSketchParameter>,
): SketchParameterResult {
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter])),
    values = new Map<string, Quantity>(),
    visiting = new Set<string>();
  const resolve = (name: string): Quantity => {
    const existing = values.get(name);
    if (existing !== undefined) return existing;
    const parameter = byName.get(name);
    if (parameter === undefined) throw new Error('Unknown parameter: ' + name);
    if (visiting.has(name))
      throw new Error('Cyclic parameter reference: ' + [...visiting, name].join(' → '));
    visiting.add(name);
    const quantity =
      typeof parameter.value === 'number'
        ? { value: parameter.value, unit: parameter.unit }
        : parseExpression(parameter.value, resolve);
    if (quantity.unit !== parameter.unit)
      throw new Error(
        name +
          ' requires ' +
          parameter.unit +
          ', received ' +
          quantity.unit +
          '. Use explicit mm or deg literals for offsets.',
      );
    if (!Number.isFinite(quantity.value) || Math.abs(quantity.value) > 1_000_000)
      throw new Error('Parameter is not a finite supported value: ' + name);
    visiting.delete(name);
    values.set(name, quantity);
    return quantity;
  };
  try {
    for (const name of byName.keys()) resolve(name);
    return { kind: 'ok', values };
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }
}
export function sketchLength(value: SketchValue, values: ReadonlyMap<string, Quantity>): number {
  if (typeof value === 'number') return value;
  const quantity = values.get(value.parameter);
  if (quantity === undefined) throw new Error('Unknown parameter: ' + value.parameter);
  if (quantity.unit !== 'mm')
    throw new Error(value.parameter + ' must use mm for a dimensional constraint.');
  return quantity.value;
}
function parseExpression(expression: string, resolve: (name: string) => Quantity): Quantity {
  if (expression.length > 512) throw new Error('Parameter expression exceeds 512 characters.');
  const tokens =
    expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+*/-]/gi) ??
    [];
  if (tokens.join('') !== expression.replace(/\s+/g, ''))
    throw new Error('Unsupported parameter expression.');
  if (tokens.length > 256) throw new Error('Parameter expression exceeds its token budget.');
  let cursor = 0,
    nesting = 0;
  const primary = (): Quantity => {
    const token = tokens[cursor++];
    if (token === undefined) throw new Error('Incomplete parameter expression.');
    if (token === '-' || token === '+') {
      const q = primary();
      return { ...q, value: token === '-' ? -q.value : q.value };
    }
    if (token === '(') {
      nesting += 1;
      if (nesting > 16) throw new Error('Parameter expression nesting exceeds 16.');
      const q = sum();
      if (tokens[cursor++] !== ')') throw new Error('Missing closing parenthesis.');
      nesting -= 1;
      return q;
    }
    if (/^\d|^\./.test(token)) {
      const unit =
        tokens[cursor] === 'mm' || tokens[cursor] === 'deg'
          ? (tokens[cursor++] as 'mm' | 'deg')
          : 'scalar';
      return { value: Number(token), unit };
    }
    if (/^[A-Za-z_]/.test(token)) return resolve(token);
    throw new Error('Invalid parameter token: ' + token);
  };
  const product = (): Quantity => {
    let q = primary();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++],
        right = primary();
      if (operator === '*') {
        if (q.unit !== 'scalar' && right.unit !== 'scalar')
          throw new Error('Products of two dimensional parameters are outside this 2D subset.');
        q = { value: q.value * right.value, unit: q.unit === 'scalar' ? right.unit : q.unit };
      } else {
        if (right.value === 0) throw new Error('Division by zero in a parameter expression.');
        if (right.unit !== 'scalar' && right.unit !== q.unit)
          throw new Error('Parameter division has incompatible units.');
        q = { value: q.value / right.value, unit: right.unit === 'scalar' ? q.unit : 'scalar' };
      }
    }
    return q;
  };
  const sum = (): Quantity => {
    let q = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++],
        right = product();
      if (q.unit !== right.unit) throw new Error('Parameter addition has incompatible units.');
      q = { value: q.value + (operator === '+' ? right.value : -right.value), unit: q.unit };
    }
    return q;
  };
  const result = sum();
  if (cursor !== tokens.length) throw new Error('Unexpected parameter expression token.');
  return result;
}
