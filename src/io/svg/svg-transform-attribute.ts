import { type SvgMatrix } from './svg-curve-transform';

const IDENTITY_MATRIX: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function parseSvgTransform(input: string | null): SvgMatrix {
  if (input === null || input.trim() === '') return IDENTITY_MATRIX;
  let matrix = IDENTITY_MATRIX;
  for (const match of input.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const op = match[1]?.toLowerCase();
    const nums = parseTransformNumbers(match[2] ?? '');
    matrix = multiplySvgMatrix(
      matrix,
      op === undefined ? IDENTITY_MATRIX : transformOperation(op, nums),
    );
  }
  return matrix;
}

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

function parseTransformNumbers(input: string): ReadonlyArray<number> {
  return (input.match(/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite);
}

const TRANSFORM_BUILDERS: Record<string, (nums: ReadonlyArray<number>) => SvgMatrix> = {
  matrix: (nums) => matrixFromNumbers(nums),
  translate: (nums) => translateSvgMatrix(nums[0] ?? 0, nums[1] ?? 0),
  scale: (nums) => scale(nums[0] ?? 1, nums[1] ?? nums[0] ?? 1),
  rotate: (nums) => rotate(nums[0] ?? 0, nums[1], nums[2]),
  skewx: (nums) => ({ a: 1, b: 0, c: tanDeg(nums[0] ?? 0), d: 1, e: 0, f: 0 }),
  skewy: (nums) => ({ a: 1, b: tanDeg(nums[0] ?? 0), c: 0, d: 1, e: 0, f: 0 }),
};

function transformOperation(op: string, nums: ReadonlyArray<number>): SvgMatrix {
  return (TRANSFORM_BUILDERS[op] ?? (() => IDENTITY_MATRIX))(nums);
}

function tanDeg(deg: number): number {
  return Math.tan((deg / 180) * Math.PI);
}

function matrixFromNumbers(nums: ReadonlyArray<number>): SvgMatrix {
  if (nums.length < 6) return IDENTITY_MATRIX;
  return {
    a: nums[0] ?? 1,
    b: nums[1] ?? 0,
    c: nums[2] ?? 0,
    d: nums[3] ?? 1,
    e: nums[4] ?? 0,
    f: nums[5] ?? 0,
  };
}

function scale(x: number, y: number): SvgMatrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function rotate(deg: number, cx?: number, cy?: number): SvgMatrix {
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
