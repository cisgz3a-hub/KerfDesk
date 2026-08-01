import type { Vec2 } from '../../core/scene';
import type { SplineData } from './dxf-spline';

const DOMAIN_EPSILON = 1e-12;

type HomogeneousPoint = Readonly<{ x: number; y: number; w: number }>;
type BezierPiece = ReadonlyArray<HomogeneousPoint>;

/** Flattens a valid DXF spline without weakening its requested chord tolerance. */
export function flattenSplineToTolerance(
  spline: SplineData,
  domainStart: number,
  domainEnd: number,
  tolerance: number,
): Vec2[] {
  const pieces = bezierPieces(spline, domainStart, domainEnd);
  const first = euclidean(pieces[0]?.[0] as HomogeneousPoint);
  const points: Vec2[] = [first];
  for (const piece of pieces) flattenBezier(piece, tolerance, points);
  return points;
}

// Knot insertion gives every non-empty B-spline span an exact Bezier control
// polygon. The curve is unchanged; only its control representation changes.
function bezierPieces(spline: SplineData, domainStart: number, domainEnd: number): BezierPiece[] {
  const degree = spline.degree;
  let knots = [...spline.knots];
  let controls = spline.controlPoints.map((point, index) => {
    const weight = spline.weights.length === 0 ? 1 : (spline.weights[index] as number);
    return { x: point.x * weight, y: point.y * weight, w: weight };
  });
  const interior = [...new Set(knots.filter((knot) => knot > domainStart && knot < domainEnd))];
  for (const knot of interior) {
    while (multiplicity(knots, knot) < degree) {
      ({ knots, controls } = insertKnot(knots, controls, degree, knot));
    }
  }
  const pieces: BezierPiece[] = [];
  for (let span = degree; span < controls.length; span += 1) {
    const start = knots[span] as number;
    const end = knots[span + 1] as number;
    if (!(end - start > DOMAIN_EPSILON)) continue;
    const controlsForSpan = controls.slice(span - degree, span + 1);
    if (controlsForSpan.length === degree + 1) pieces.push(controlsForSpan);
  }
  return pieces;
}

function multiplicity(knots: ReadonlyArray<number>, knot: number): number {
  return knots.filter((candidate) => Math.abs(candidate - knot) <= DOMAIN_EPSILON).length;
}

function insertKnot(
  knots: ReadonlyArray<number>,
  controls: ReadonlyArray<HomogeneousPoint>,
  degree: number,
  knot: number,
): { readonly knots: number[]; readonly controls: HomogeneousPoint[] } {
  const span = findSpan(knots, degree, controls.length, knot);
  const existingMultiplicity = multiplicity(knots, knot);
  const nextControls: HomogeneousPoint[] = [];
  for (let i = 0; i <= span - degree; i += 1) nextControls.push(controls[i] as HomogeneousPoint);
  for (let i = span - degree + 1; i <= span - existingMultiplicity; i += 1) {
    const before = controls[i - 1] as HomogeneousPoint;
    const after = controls[i] as HomogeneousPoint;
    const lower = knots[i] as number;
    const upper = knots[i + degree] as number;
    const alpha = upper - lower > DOMAIN_EPSILON ? (knot - lower) / (upper - lower) : 0;
    nextControls.push(blend(before, after, alpha));
  }
  for (let i = span - existingMultiplicity; i < controls.length; i += 1) {
    nextControls.push(controls[i] as HomogeneousPoint);
  }
  return {
    knots: [...knots.slice(0, span + 1), knot, ...knots.slice(span + 1)],
    controls: nextControls,
  };
}

function blend(a: HomogeneousPoint, b: HomogeneousPoint, alpha: number): HomogeneousPoint {
  return {
    x: (1 - alpha) * a.x + alpha * b.x,
    y: (1 - alpha) * a.y + alpha * b.y,
    w: (1 - alpha) * a.w + alpha * b.w,
  };
}

function flattenBezier(piece: BezierPiece, tolerance: number, out: Vec2[]): void {
  const pending: BezierPiece[] = [piece];
  while (pending.length > 0) {
    const current = pending.pop() as BezierPiece;
    if (bezierFlatness(current) <= tolerance) {
      out.push(euclidean(current[current.length - 1] as HomogeneousPoint));
      continue;
    }
    const [left, right] = splitBezier(current);
    pending.push(right, left);
  }
}

// Positive-weight rational Bezier points are convex combinations of their
// Euclidean controls, so this is a conservative whole-span deviation bound.
function bezierFlatness(piece: BezierPiece): number {
  const start = euclidean(piece[0] as HomogeneousPoint);
  const end = euclidean(piece[piece.length - 1] as HomogeneousPoint);
  let worst = 0;
  for (const control of piece)
    worst = Math.max(worst, distanceToSegment(euclidean(control), start, end));
  return worst;
}

function splitBezier(piece: BezierPiece): readonly [BezierPiece, BezierPiece] {
  const left: HomogeneousPoint[] = [piece[0] as HomogeneousPoint];
  const right: HomogeneousPoint[] = [piece[piece.length - 1] as HomogeneousPoint];
  let level = [...piece];
  while (level.length > 1) {
    const next: HomogeneousPoint[] = [];
    for (let index = 1; index < level.length; index += 1) {
      next.push(blend(level[index - 1] as HomogeneousPoint, level[index] as HomogeneousPoint, 0.5));
    }
    left.push(next[0] as HomogeneousPoint);
    right.push(next[next.length - 1] as HomogeneousPoint);
    level = next;
  }
  right.reverse();
  return [left, right];
}

function euclidean(point: HomogeneousPoint): Vec2 {
  const safeWeight = Math.abs(point.w) > DOMAIN_EPSILON ? point.w : 1;
  return { x: point.x / safeWeight, y: point.y / safeWeight };
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DOMAIN_EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function findSpan(
  knots: ReadonlyArray<number>,
  degree: number,
  controlPointCount: number,
  u: number,
): number {
  const last = controlPointCount - 1;
  if (u >= (knots[controlPointCount] as number)) return last;
  if (u <= (knots[degree] as number)) return degree;
  let low = degree;
  let high = controlPointCount;
  let mid = Math.floor((low + high) / 2);
  while (u < (knots[mid] as number) || u >= (knots[mid + 1] as number)) {
    if (u < (knots[mid] as number)) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}
