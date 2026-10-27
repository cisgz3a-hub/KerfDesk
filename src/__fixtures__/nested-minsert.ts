import type { CurveSubpath } from '../core/scene';

// Compact DXF with 150,000 composed INSERT instances. Each individual grid is
// within the existing limit; the payload is small enough to expose size-based
// assumptions about parsing cost. The independent transform is documented below.
export function nestedMinsertDxf(): string {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'UNIT',
    '10',
    '1',
    '20',
    '2',
    '0',
    'LINE',
    '10',
    '1',
    '20',
    '2',
    '11',
    '2',
    '21',
    '2',
    '62',
    '0',
    '0',
    'ENDBLK',
    '0',
    'BLOCK',
    '2',
    'NEST',
    '10',
    '3',
    '20',
    '4',
    '0',
    'INSERT',
    '2',
    'UNIT',
    '10',
    '10',
    '20',
    '20',
    '41',
    '2',
    '42',
    '3',
    '50',
    '90',
    '70',
    '500',
    '44',
    '4',
    '62',
    '0',
    '0',
    'ENDBLK',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'INSERT',
    '2',
    'NEST',
    '10',
    '100',
    '20',
    '200',
    '41',
    '3',
    '42',
    '2',
    '50',
    '90',
    '71',
    '300',
    '45',
    '10',
    '62',
    '1',
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n');
}

// Inner column c: (10, 20+4c) -> (10, 22+4c), after UNIT base,
// nonuniform scale, 90-degree rotation and translation. Outer row r then maps
// this to (68-8c-10r, 221) -> (64-8c-10r, 221). Normalization subtracts minimum
// X=-6918 and flips Y, yielding (6986-8c-10r, 0) -> (6982-8c-10r, 0).
export function nestedMinsertStartX(index: number): number {
  return 6986 - 8 * (index % 500) - 10 * Math.floor(index / 500);
}

export const NESTED_MINSERT_INSTANCES = 150_000;

/** Whether `curves` hold every instance, each once, as a 4 mm horizontal line
 * piece where the composed transforms put it. DXF import joins instances whose
 * ends meet exactly one other end (ADR-626 Amendment 8), so a curve may hold
 * several; every piece is a line segment. */
export function holdsEveryNestedMinsertInstance(curves: ReadonlyArray<CurveSubpath>): boolean {
  const starts: number[] = [];
  for (const curve of curves) {
    let at = curve.start;
    for (const segment of curve.segments) {
      const to = segment.to;
      const straight =
        segment.kind === 'line' &&
        Math.abs(at.y) < 1e-8 &&
        Math.abs(to.y) < 1e-8 &&
        Math.abs(Math.abs(at.x - to.x) - 4) < 1e-8;
      if (!straight) return false;
      starts.push(Math.max(at.x, to.x));
      at = to;
    }
  }
  if (starts.length !== NESTED_MINSERT_INSTANCES) return false;
  starts.sort((a, b) => a - b);
  const expected = Array.from({ length: NESTED_MINSERT_INSTANCES }, (_, index) =>
    nestedMinsertStartX(index),
  ).sort((a, b) => a - b);
  return starts.every((x, index) => Math.abs(x - (expected[index] ?? Number.NaN)) < 1e-8);
}

// UNIT is one line; GRID places UNIT on a 100 x 100 grid; the drawing places
// GRID on another 100 x 100 grid. Each grid is within the per-grid limit and
// the inner one is only 20,000 points, but the whole drawing would place
// 2 x 10^8, past the block expansion budget (ADR-269 Amendment 1), which
// refuses it before the outer copies exist.
export function nestedGridsPastBudgetDxf(): string {
  const tags = (...pairs: ReadonlyArray<readonly [number, string | number]>) =>
    pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
  return [
    tags([0, 'SECTION'], [2, 'BLOCKS']),
    tags([0, 'BLOCK'], [2, 'UNIT'], [10, 0], [20, 0]),
    tags([0, 'LINE'], [10, 0], [20, 0], [11, 1], [21, 0]),
    tags([0, 'ENDBLK']),
    tags([0, 'BLOCK'], [2, 'GRID'], [10, 0], [20, 0]),
    tags([0, 'INSERT'], [2, 'UNIT'], [10, 0], [20, 0], [70, 100], [71, 100], [44, 2], [45, 2]),
    tags([0, 'ENDBLK']),
    tags([0, 'ENDSEC']),
    tags([0, 'SECTION'], [2, 'ENTITIES']),
    tags([0, 'INSERT'], [2, 'GRID'], [10, 0], [20, 0], [70, 100], [71, 100], [44, 300], [45, 300]),
    tags([0, 'ENDSEC'], [0, 'EOF']),
    '',
  ].join('\n');
}

export const DXF_EXPANSION_REFUSAL = /DXF block references expand to more than 500,000 points/;
