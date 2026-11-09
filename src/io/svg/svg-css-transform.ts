// The CSS `transform` property and the individual `translate`, `rotate` and
// `scale` properties (CSS Transforms 1 and 2), as a browser reads them on SVG
// content. Each value parses into terms; translations keep their percentages
// until the element's reference box is known (transform-box).

import {
  cssAngle,
  cssFunctionList,
  cssLength,
  cssNumber,
  cssTokens,
  cssValueHasFunction,
  firstCssProblem,
  type CssLengthPercentage,
  type CssValueProblem,
} from './svg-css-values';
import {
  IDENTITY_MATRIX3D,
  matrix3dFrom2d,
  multiplyMatrix3d,
  rotateMatrix3d,
  scaleMatrix3d,
  skewMatrix3d,
  translateMatrix3d,
  type Matrix3d,
} from './svg-matrix3d';

/** The box percentages and transform-origin resolve against, in user units. */
export type SvgReferenceBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CssTransformTerm =
  | { readonly kind: 'matrix'; readonly matrix: Matrix3d }
  | {
      readonly kind: 'translate';
      readonly x: CssLengthPercentage;
      readonly y: CssLengthPercentage;
      readonly z: number;
    };
export type CssTransformTerms = ReadonlyArray<CssTransformTerm>;
type Parsed = CssTransformTerms | CssValueProblem;

const ZERO: CssLengthPercentage = { px: 0, percent: 0 };

export function resolveCssTransformTerms(terms: CssTransformTerms, box: SvgReferenceBox): Matrix3d {
  let matrix = IDENTITY_MATRIX3D;
  for (const term of terms) {
    const step =
      term.kind === 'matrix'
        ? term.matrix
        : translateMatrix3d(
            term.x.px + term.x.percent * box.width,
            term.y.px + term.y.percent * box.height,
            term.z,
          );
    matrix = multiplyMatrix3d(matrix, step);
  }
  return matrix;
}

/** The CSS `transform` property: `none` or a list of transform functions. */
export function parseCssTransformProperty(text: string): Parsed {
  if (text.toLowerCase() === 'none') return [];
  const functions = cssFunctionList(text);
  if (typeof functions === 'string') return functions;
  if (functions.length === 0) return 'invalid';
  const terms: CssTransformTerm[] = [];
  for (const { name, args } of functions) {
    const builder = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
    const term = builder === undefined ? 'invalid' : builder(args);
    if (typeof term === 'string') return term;
    terms.push(term);
  }
  return terms;
}

/** `translate: none | <length-percentage> [<length-percentage> <length>?]?` */
export function parseCssTranslateProperty(text: string): Parsed {
  const tokens = propertyTokens(text);
  if (typeof tokens === 'string') return tokens;
  if (tokens.length === 0) return [];
  if (tokens.length > 3) return 'invalid';
  const [x = '0', y = '0', z = '0'] = tokens;
  return translateTerm(lengthPercentage(x), lengthPercentage(y), length(z));
}

/** `rotate: none | <angle> | [x | y | z | <number>{3}] && <angle>` */
export function parseCssRotateProperty(text: string): Parsed {
  const tokens = propertyTokens(text);
  if (typeof tokens === 'string') return tokens;
  if (tokens.length === 0) return [];
  // The angle comes last or first; a bare 0 may be either an angle or an axis part.
  return (
    rotation(cssAngle(tokens[tokens.length - 1] ?? ''), tokens.slice(0, -1)) ??
    rotation(cssAngle(tokens[0] ?? ''), tokens.slice(1)) ??
    'invalid'
  );
}

function rotation(angle: number | 'invalid', axisTokens: ReadonlyArray<string>): Parsed | null {
  const axis = rotationAxis(axisTokens);
  return angle === 'invalid' || axis === null ? null : [matrixTerm(rotateMatrix3d(...axis, angle))];
}

/** `scale: none | [<number> | <percentage>]{1,3}`; one value scales both axes. */
export function parseCssScaleProperty(text: string): Parsed {
  const tokens = propertyTokens(text);
  if (typeof tokens === 'string') return tokens;
  if (tokens.length === 0) return [];
  if (tokens.length > 3) return 'invalid';
  const values = tokens.map((token) => cssNumber(token, true));
  const [x = 1, y = x, z = 1] = values;
  if (x === 'invalid' || y === 'invalid' || z === 'invalid') return 'invalid';
  return [matrixTerm(scaleMatrix3d(x, y, z))];
}

// [] for `none`, tokens otherwise.
function propertyTokens(text: string): string[] | CssValueProblem {
  if (text.toLowerCase() === 'none') return [];
  if (cssValueHasFunction(text)) return 'unresolved';
  const tokens = cssTokens(text);
  return tokens.length === 0 ? 'invalid' : tokens;
}

const AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

function rotationAxis(tokens: ReadonlyArray<string>): readonly [number, number, number] | null {
  if (tokens.length === 0) return [0, 0, 1];
  const name = tokens.length === 1 ? (tokens[0] ?? '').toLowerCase() : '';
  if (Object.hasOwn(AXES, name)) return AXES[name] ?? null;
  const values = numbers(tokens, 3);
  return values === null ? null : [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

type Arg = CssLengthPercentage | CssValueProblem;
const lengthPercentage = (token: string): Arg => cssLength(token, { percent: true });
const length = (token: string): Arg => cssLength(token, { percent: false });

function matrixTerm(matrix: Matrix3d): CssTransformTerm {
  return { kind: 'matrix', matrix };
}

function translateTerm(x: Arg, y: Arg, z: Arg): Parsed {
  const problem = firstCssProblem([x, y, z]);
  if (problem !== null || typeof x === 'string' || typeof y === 'string' || typeof z === 'string')
    return problem ?? 'invalid';
  return [{ kind: 'translate', x, y, z: z.px }];
}

function single(term: Parsed): CssTransformTerm | CssValueProblem {
  return typeof term === 'string' ? term : (term[0] ?? 'invalid');
}

function numbers(args: ReadonlyArray<string>, count: number, percent = false): number[] | null {
  if (args.length !== count) return null;
  const values = args.map((arg) => cssNumber(arg, percent));
  return values.every((value): value is number => value !== 'invalid') ? values : null;
}

function angles(args: ReadonlyArray<string>, min: number, max: number): number[] | null {
  if (args.length < min || args.length > max) return null;
  const values = args.map(cssAngle);
  return values.every((value): value is number => value !== 'invalid') ? values : null;
}

type Builder = (args: ReadonlyArray<string>) => CssTransformTerm | CssValueProblem;

function fromNumbers(count: number, build: (values: number[]) => Matrix3d, percent = false) {
  return (args: ReadonlyArray<string>) => {
    const values = numbers(args, count, percent);
    return values === null ? 'invalid' : matrixTerm(build(values));
  };
}

function fromAngles(min: number, max: number, build: (values: number[]) => Matrix3d) {
  return (args: ReadonlyArray<string>) => {
    const values = angles(args, min, max);
    return values === null ? 'invalid' : matrixTerm(build(values));
  };
}

function translateFunction(axes: 'xy' | 'x' | 'y' | 'z' | 'xyz'): Builder {
  return (args) => {
    const count = axes === 'xyz' ? 3 : 1;
    if (args.length !== count && !(axes === 'xy' && args.length === 2)) return 'invalid';
    const [first = '0', second = '0', third = '0'] = args;
    if (axes === 'y') return single(translateTerm(ZERO, lengthPercentage(first), ZERO));
    if (axes === 'z') return single(translateTerm(ZERO, ZERO, length(first)));
    const z = axes === 'xyz' ? length(third) : ZERO;
    return single(translateTerm(lengthPercentage(first), lengthPercentage(second), z));
  };
}

function scaleFunction(): Builder {
  return (args) => {
    if (args.length < 1 || args.length > 2) return 'invalid';
    const values = numbers(args, args.length, true);
    if (values === null) return 'invalid';
    const [x = 1, y = x] = values;
    return matrixTerm(scaleMatrix3d(x, y));
  };
}

// perspective() only moves z and w, which the drawn affine part ignores.
function perspectiveFunction(args: ReadonlyArray<string>): CssTransformTerm | CssValueProblem {
  const [value = ''] = args;
  if (args.length !== 1) return 'invalid';
  if (value.toLowerCase() === 'none') return matrixTerm(IDENTITY_MATRIX3D);
  const depth = length(value);
  if (typeof depth === 'string') return depth;
  return depth.px < 0 ? 'invalid' : matrixTerm(IDENTITY_MATRIX3D);
}

const FUNCTIONS: Readonly<Record<string, Builder>> = {
  matrix: fromNumbers(6, ([a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]) =>
    matrix3dFrom2d(a, b, c, d, e, f),
  ),
  matrix3d: fromNumbers(16, (values) => values),
  translate: translateFunction('xy'),
  translatex: translateFunction('x'),
  translatey: translateFunction('y'),
  translatez: translateFunction('z'),
  translate3d: translateFunction('xyz'),
  scale: scaleFunction(),
  scalex: fromNumbers(1, ([x = 1]) => scaleMatrix3d(x, 1), true),
  scaley: fromNumbers(1, ([y = 1]) => scaleMatrix3d(1, y), true),
  scalez: fromNumbers(1, ([z = 1]) => scaleMatrix3d(1, 1, z), true),
  scale3d: fromNumbers(3, ([x = 1, y = 1, z = 1]) => scaleMatrix3d(x, y, z), true),
  rotate: fromAngles(1, 1, ([deg = 0]) => rotateMatrix3d(0, 0, 1, deg)),
  rotatez: fromAngles(1, 1, ([deg = 0]) => rotateMatrix3d(0, 0, 1, deg)),
  rotatex: fromAngles(1, 1, ([deg = 0]) => rotateMatrix3d(1, 0, 0, deg)),
  rotatey: fromAngles(1, 1, ([deg = 0]) => rotateMatrix3d(0, 1, 0, deg)),
  rotate3d: (args) => {
    const axis = numbers(args.slice(0, 3), 3);
    const angle = cssAngle(args[3] ?? '');
    if (args.length !== 4 || axis === null || angle === 'invalid') return 'invalid';
    const [x = 0, y = 0, z = 0] = axis;
    return matrixTerm(rotateMatrix3d(x, y, z, angle));
  },
  skew: fromAngles(1, 2, ([x = 0, y = 0]) => skewMatrix3d(x, y)),
  skewx: fromAngles(1, 1, ([x = 0]) => skewMatrix3d(x, 0)),
  skewy: fromAngles(1, 1, ([y = 0]) => skewMatrix3d(0, y)),
  perspective: perspectiveFunction,
};
