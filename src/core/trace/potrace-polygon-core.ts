export type PotracePoint = {
  x: number;
  y: number;
};

type PotraceSum = {
  x: number;
  y: number;
  xy: number;
  x2: number;
  y2: number;
};

export type PathState = {
  readonly points: readonly PotracePoint[];
  readonly x0: number;
  readonly y0: number;
  readonly sums: PotraceSum[];
};

export type Quad = number[];

export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function xprod(a: PotracePoint, b: PotracePoint): number {
  return a.x * b.y - a.y * b.x;
}

export function cyclic(a: number, b: number, c: number): boolean {
  return a <= c ? a <= b && b < c : a <= b || b < c;
}

export function pointAt(points: readonly PotracePoint[], index: number): PotracePoint {
  const point = points[index];
  if (point === undefined) throw new Error(`Missing Potrace point at ${index}`);
  return point;
}

function sumAt(sums: readonly PotraceSum[], index: number): PotraceSum {
  const sum = sums[index];
  if (sum === undefined) throw new Error(`Missing Potrace sum at ${index}`);
  return sum;
}

export function buildPathState(points: readonly PotracePoint[]): PathState {
  const first = points[0];
  const x0 = first?.x ?? 0;
  const y0 = first?.y ?? 0;
  const sums: PotraceSum[] = [{ x: 0, y: 0, xy: 0, x2: 0, y2: 0 }];

  for (let index = 0; index < points.length; index += 1) {
    const point = pointAt(points, index);
    const previous = sumAt(sums, index);
    const x = point.x - x0;
    const y = point.y - y0;
    sums.push({
      x: previous.x + x,
      y: previous.y + y,
      xy: previous.xy + x * y,
      x2: previous.x2 + x * x,
      y2: previous.y2 + y * y,
    });
  }

  return { points, x0, y0, sums };
}

export function segmentPenaltyFromState(state: PathState, start: number, end: number): number {
  const { points } = state;
  const n = points.length;
  if (n === 0) return 0;

  const segment = segmentSums(state, start, end);
  const startPoint = pointAt(points, start);
  const endPoint = pointAt(points, segment.endIndex);
  const midpointX = (startPoint.x + endPoint.x) / 2 - state.x0;
  const midpointY = (startPoint.y + endPoint.y) / 2 - state.y0;
  const normalY = endPoint.x - startPoint.x;
  const normalX = -(endPoint.y - startPoint.y);
  const a = (segment.x2 - 2 * segment.x * midpointX) / segment.count + midpointX * midpointX;
  const b =
    (segment.xy - segment.x * midpointY - segment.y * midpointX) / segment.count +
    midpointX * midpointY;
  const c = (segment.y2 - 2 * segment.y * midpointY) / segment.count + midpointY * midpointY;
  const penalty = normalX * normalX * a + 2 * normalX * normalY * b + normalY * normalY * c;

  return Math.sqrt(Math.max(0, penalty));
}

function segmentSums(
  state: PathState,
  start: number,
  end: number,
): PotraceSum & {
  readonly count: number;
  readonly endIndex: number;
} {
  const n = state.points.length;
  const j = end >= n ? end - n : end;
  const wrapped = end >= n;
  const endSum = sumAt(state.sums, j + 1);
  const startSum = sumAt(state.sums, start);
  const total = wrapped ? sumAt(state.sums, n) : { x: 0, y: 0, xy: 0, x2: 0, y2: 0 };
  return {
    x: endSum.x - startSum.x + total.x,
    y: endSum.y - startSum.y + total.y,
    x2: endSum.x2 - startSum.x2 + total.x2,
    xy: endSum.xy - startSum.xy + total.xy,
    y2: endSum.y2 - startSum.y2 + total.y2,
    count: j + 1 - start + (wrapped ? n : 0),
    endIndex: j,
  };
}

export function potraceSegmentPenalty(
  points: readonly PotracePoint[],
  start: number,
  end: number,
): number {
  return segmentPenaltyFromState(buildPathState(points), start, end);
}

export function directionIndex(dx: number, dy: number): number {
  return (3 + 3 * sign(dx) + sign(dy)) / 2;
}

export function pointslope(
  state: PathState,
  start: number,
  end: number,
): { center: PotracePoint; direction: PotracePoint } {
  const wrapped = normalizeSlopeRange(state.points.length, start, end);
  const endSum = sumAt(state.sums, wrapped.end + 1);
  const startSum = sumAt(state.sums, wrapped.start);
  const total = sumAt(state.sums, state.points.length);
  const x = endSum.x - startSum.x + wrapped.rotations * total.x;
  const y = endSum.y - startSum.y + wrapped.rotations * total.y;
  const x2 = endSum.x2 - startSum.x2 + wrapped.rotations * total.x2;
  const xy = endSum.xy - startSum.xy + wrapped.rotations * total.xy;
  const y2 = endSum.y2 - startSum.y2 + wrapped.rotations * total.y2;
  return slopeFromMoments(x, y, x2, xy, y2, wrapped.count);
}

function normalizeSlopeRange(
  n: number,
  start: number,
  end: number,
): { start: number; end: number; rotations: number; count: number } {
  let i = start;
  let j = end;
  let rotations = 0;

  while (j >= n) {
    j -= n;
    rotations += 1;
  }
  while (i >= n) {
    i -= n;
    rotations -= 1;
  }
  while (j < 0) {
    j += n;
    rotations -= 1;
  }
  while (i < 0) {
    i += n;
    rotations += 1;
  }
  return { start: i, end: j, rotations, count: j + 1 - i + rotations * n };
}

function slopeFromMoments(
  x: number,
  y: number,
  x2: number,
  xy: number,
  y2: number,
  count: number,
): { center: PotracePoint; direction: PotracePoint } {
  const center = { x: x / count, y: y / count };
  let a = (x2 - (x * x) / count) / count;
  const b = (xy - (x * y) / count) / count;
  let c = (y2 - (y * y) / count) / count;
  const lambda = (a + c + Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2;
  a -= lambda;
  c -= lambda;
  return { center, direction: slopeDirection(a, b, c) };
}

function slopeDirection(a: number, b: number, c: number): PotracePoint {
  const direction = { x: 0, y: 0 };
  if (Math.abs(a) >= Math.abs(c)) {
    const length = Math.sqrt(a * a + b * b);
    if (length !== 0) {
      direction.x = -b / length;
      direction.y = a / length;
    }
  } else {
    const length = Math.sqrt(c * c + b * b);
    if (length !== 0) {
      direction.x = -c / length;
      direction.y = b / length;
    }
  }
  return direction;
}

export function emptyQuad(): Quad {
  return new Array<number>(9).fill(0);
}

export function quadAt(quad: Quad, row: number, column: number): number {
  return quad[row * 3 + column] ?? 0;
}

export function quadForm(quad: Quad, point: PotracePoint): number {
  return (
    quadAt(quad, 0, 0) * point.x * point.x +
    (quadAt(quad, 0, 1) + quadAt(quad, 1, 0)) * point.x * point.y +
    (quadAt(quad, 0, 2) + quadAt(quad, 2, 0)) * point.x +
    quadAt(quad, 1, 1) * point.y * point.y +
    (quadAt(quad, 1, 2) + quadAt(quad, 2, 1)) * point.y +
    quadAt(quad, 2, 2)
  );
}
