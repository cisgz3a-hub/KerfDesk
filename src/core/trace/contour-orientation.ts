import type { Vec2 } from '../scene';

const FRACTION_BITS = 52n;
const EXPONENT_MASK = 2047n;
const FRACTION_MASK = (1n << FRACTION_BITS) - 1n;
const EXPONENT_BIAS_WITH_FRACTION = 1075;
const SUBNORMAL_EXPONENT = -1074;
const SIGN_BIT = 63n;
type Dyadic = { readonly integer: bigint; readonly exponent: number };
type PreparedPoint = { readonly x: number; readonly y: number; readonly values: [Dyadic, Dyadic] };
const BINARY64_VIEW = new DataView(new ArrayBuffer(8));

// A finite binary64 value is an integer times a power of two. Aligning those
// powers makes the determinant exact even for almost-collinear trace edges;
// no epsilon may turn a positive paper gap into a contact.
function dyadic(value: number): Dyadic {
  BINARY64_VIEW.setFloat64(0, value);
  const bits = BINARY64_VIEW.getBigUint64(0);
  const exponent = Number((bits >> FRACTION_BITS) & EXPONENT_MASK);
  const fraction = bits & FRACTION_MASK;
  const sign = bits >> SIGN_BIT === 0n ? 1n : -1n;
  return {
    integer: sign * (exponent === 0 ? fraction : fraction + (1n << FRACTION_BITS)),
    exponent: exponent === 0 ? SUBNORMAL_EXPONENT : exponent - EXPONENT_BIAS_WITH_FRACTION,
  };
}

// Floating-point filter in front of the exact determinant (Shewchuk, "Adaptive
// Precision Floating-Point Arithmetic and Fast Robust Geometric Predicates",
// 1997): each coordinate difference is rounded once and so keeps its exact
// sign, and when the rounded determinant clears (3 + 16u)u times the sum of
// its two products' magnitudes (u = 2^-53) its sign is the exact sign. Only
// near-degenerate triples, products too small for that bound to hold, and
// non-finite input fall through to the exact dyadic evaluation below, so the
// answer is always the exact one.
const UNIT_ROUNDOFF = 2 ** -53;
const ORIENTATION_ERROR_BOUND = (3 + 16 * UNIT_ROUNDOFF) * UNIT_ROUNDOFF;
// Keep the filter away from gradual underflow, where rounding is no longer
// relative and the bound above does not hold.
const MIN_FILTERED_PRODUCT = 2 ** -900;

/** The orientation sign when a double evaluation proves it, else 0 (unknown;
 *  a true zero is never reported here). */
function filteredOrientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const left = (bx - ax) * (cy - ay);
  const right = (by - ay) * (cx - ax);
  const magnitudeLeft = Math.abs(left);
  const magnitudeRight = Math.abs(right);
  if (!(magnitudeLeft >= MIN_FILTERED_PRODUCT && magnitudeRight >= MIN_FILTERED_PRODUCT)) return 0;
  const determinant = left - right;
  const bound = ORIENTATION_ERROR_BOUND * (magnitudeLeft + magnitudeRight);
  if (determinant > bound) return 1;
  if (-determinant > bound) return -1;
  return 0;
}

/** Exact orientation sign for finite trace coordinates. */
export function contourOrientation(a: Vec2, b: Vec2, c: Vec2): number {
  const { x: ax, y: ay } = a;
  const { x: bx, y: by } = b;
  const { x: cx, y: cy } = c;
  const filtered = filteredOrientation(ax, ay, bx, by, cx, cy);
  if (filtered !== 0) return filtered;
  return exactOrientation([ax, ay, bx, by, cx, cy].map(dyadic));
}

/** Cache only binary64 decompositions, never an approximate determinant. */
export class ContourOrientation {
  private readonly points = new WeakMap<Vec2, PreparedPoint>();

  sign(a: Vec2, b: Vec2, c: Vec2): number {
    const filtered = filteredOrientation(a.x, a.y, b.x, b.y, c.x, c.y);
    if (filtered !== 0) return filtered;
    return exactOrientation([
      ...this.coordinates(a),
      ...this.coordinates(b),
      ...this.coordinates(c),
    ]);
  }

  private coordinates(point: Vec2): [Dyadic, Dyadic] {
    const { x, y } = point;
    const previous = this.points.get(point);
    if (previous !== undefined && previous.x === x && previous.y === y) return previous.values;
    const values: [Dyadic, Dyadic] = [dyadic(x), dyadic(y)];
    this.points.set(point, { x, y, values });
    return values;
  }
}

function exactOrientation(values: ReadonlyArray<Dyadic>): number {
  const exponent = Math.min(...values.map((value) => value.exponent));
  const integers = values.map((value) => value.integer << BigInt(value.exponent - exponent));
  // The fixed six-coordinate list establishes all six entries.
  const [ax, ay, bx, by, cx, cy] = integers as [bigint, bigint, bigint, bigint, bigint, bigint];
  const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return determinant > 0n ? 1 : determinant < 0n ? -1 : 0;
}

/** Winding membership; callers separately detect boundary contacts. */
export function insideContour(point: Vec2, points: ReadonlyArray<Vec2>): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    if (a.y <= point.y && b.y > point.y && contourOrientation(a, b, point) > 0) winding += 1;
    if (a.y > point.y && b.y <= point.y && contourOrientation(a, b, point) < 0) winding -= 1;
  }
  return winding !== 0;
}
