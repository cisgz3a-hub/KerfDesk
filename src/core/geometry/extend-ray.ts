// Forward-ray contacts with canonical paths. All distances are world mm;
// cubic roots are isolated between derivative roots so tangencies are retained.
import { endpointArc } from '../scene/curve-path';
import { applyTransform, type PathSegment, type Transform, type Vec2 } from '../scene';

export const EXTEND_EPS_MM = 1e-7;
export type RayContact = { readonly distance: number; readonly overlap: boolean };
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export function segmentRayContacts(
  origin: Vec2,
  direction: Vec2,
  from: Vec2,
  segment: PathSegment,
  transform: Transform,
): RayContact[] {
  const world = (p: Vec2): Vec2 => applyTransform(p, transform);
  if (segment.kind === 'line')
    return lineContacts(origin, direction, world(from), world(segment.to));
  if (segment.kind === 'cubic') {
    const controls = [from, segment.control1, segment.control2, segment.to].map(world);
    const sides = controls.map((p) => cross(minus(p, origin), direction));
    const along = controls.map((p) => dot(minus(p, origin), direction));
    const sideCoefficients = coefficients(sides);
    const alongCoefficients = coefficients(along);
    if (sides.every((s) => Math.abs(s) <= EXTEND_EPS_MM)) {
      const extrema = [
        0,
        1,
        ...quadraticRoots(
          3 * alongCoefficients[0],
          2 * alongCoefficients[1],
          alongCoefficients[2],
        ).filter((t) => t > 0 && t < 1),
      ];
      const values = extrema.map((t) => evaluate(alongCoefficients, t));
      return overlapContact(Math.min(...values), Math.max(...values));
    }
    return unitRoots(sideCoefficients).flatMap((t) => contact(evaluate(alongCoefficients, t)));
  }
  const arc = endpointArc(from, segment);
  // A very short valid arc can lose its sweep through floating-point rounding.
  // Keep its finite chord instead of treating a zero-sign span as the whole ellipse.
  if (arc === null || arc.delta === 0)
    return lineContacts(origin, direction, world(from), world(segment.to));
  const center = world(arc.center);
  const cos = Math.cos(arc.rotationRad);
  const sin = Math.sin(arc.rotationRad);
  const u = minus(
    world({ x: arc.center.x + arc.radiusX * cos, y: arc.center.y + arc.radiusX * sin }),
    center,
  );
  const v = minus(
    world({ x: arc.center.x - arc.radiusY * sin, y: arc.center.y + arc.radiusY * cos }),
    center,
  );
  const determinant = cross(u, v);
  if (determinant === 0 || !Number.isFinite(determinant)) return [];
  const local = (p: Vec2): Vec2 => ({ x: cross(p, v) / determinant, y: cross(u, p) / determinant });
  const p = local(minus(origin, center));
  const d = local(direction);
  const endpoints = [world(from), world(segment.to)];
  const start = local(minus(endpoints[0] as Vec2, center));
  const end = local(minus(endpoints[1] as Vec2, center));
  return quadraticRoots(dot(d, d), 2 * dot(p, d), dot(p, p) - 1).flatMap((distance) => {
    const unitPoint = { x: p.x + distance * d.x, y: p.y + distance * d.y };
    // Angular slack grows with radius and object scale. Outside the strict arc
    // span, accept only float noise within the physical endpoint tolerance.
    const point = { x: origin.x + distance * direction.x, y: origin.y + distance * direction.y };
    const onArc =
      withinArcSpan(unitPoint, start, end, arc.delta) ||
      endpoints.some((end) => Math.hypot(point.x - end.x, point.y - end.y) <= EXTEND_EPS_MM);
    return onArc ? contact(distance) : [];
  });
}

function lineContacts(origin: Vec2, direction: Vec2, a: Vec2, b: Vec2): RayContact[] {
  const edge = minus(b, a);
  const offset = minus(a, origin);
  const length = Math.hypot(edge.x, edge.y);
  const denominator = cross(direction, edge);
  if (length <= EXTEND_EPS_MM)
    return Math.abs(cross(offset, direction)) <= EXTEND_EPS_MM
      ? contact(dot(offset, direction))
      : [];
  if (Math.abs(denominator) <= 1e-12 * length) {
    if (Math.abs(cross(offset, direction)) > EXTEND_EPS_MM) return [];
    const d0 = dot(offset, direction);
    const d1 = dot(minus(b, origin), direction);
    return overlapContact(Math.min(d0, d1), Math.max(d0, d1));
  }
  const t = cross(offset, direction) / denominator;
  return t < -EXTEND_EPS_MM / length || t > 1 + EXTEND_EPS_MM / length
    ? []
    : contact(cross(offset, edge) / denominator);
}

function contact(distance: number): RayContact[] {
  return Number.isFinite(distance) && distance >= -EXTEND_EPS_MM
    ? [{ distance: Math.max(0, distance), overlap: false }]
    : [];
}
function overlapContact(min: number, max: number): RayContact[] {
  if (max < -EXTEND_EPS_MM) return [];
  const distance = Math.max(0, min);
  return [{ distance, overlap: max - distance > EXTEND_EPS_MM }];
}
function withinArcSpan(point: Vec2, start: Vec2, end: Vec2, delta: number): boolean {
  // Avoid atan2/subtraction/modulo rounding a tiny off-end angle onto a seam.
  // The minor span is the intersection of two half-planes; the major is their union.
  const fromStart = Math.sign(delta) * cross(start, point);
  const toEnd = Math.sign(delta) * cross(point, end);
  return Math.abs(delta) <= Math.PI ? fromStart >= 0 && toEnd >= 0 : fromStart >= 0 || toEnd >= 0;
}

type CubicCoefficients = readonly [number, number, number, number];
function coefficients(values: number[]): CubicCoefficients {
  const [a = 0, b = 0, c = 0, d = 0] = values;
  return [-a + 3 * b - 3 * c + d, 3 * a - 6 * b + 3 * c, -3 * a + 3 * b, a];
}
function evaluate([a, b, c, d]: CubicCoefficients, t: number): number {
  return ((a * t + b) * t + c) * t + d;
}

function quadraticRoots(a: number, b: number, c: number): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0 || !Number.isFinite(scale)) return [];
  a /= scale;
  b /= scale;
  c /= scale;
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  const roundoff = 32 * Number.EPSILON * (b * b + Math.abs(4 * a * c));
  if (discriminant < -roundoff) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const q = -0.5 * (b + (b >= 0 ? root : -root));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

function unitRoots(coefficients: CubicCoefficients): number[] {
  const [a, b, c] = coefficients;
  const roundoff = Math.min(
    EXTEND_EPS_MM,
    32 * Number.EPSILON * coefficients.reduce((sum, value) => sum + Math.abs(value), 0),
  );
  const cuts = [0, ...quadraticRoots(3 * a, 2 * b, c).filter((t) => t > 0 && t < 1), 1].sort(
    (x, y) => x - y,
  );
  const roots = cuts.filter((t) => atRoot(coefficients, t, roundoff));
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1] as number;
    let high = cuts[i] as number;
    let lowValue = evaluate(coefficients, low);
    const highValue = evaluate(coefficients, high);
    // A derivative root can evaluate just across zero through rounding. It is
    // already a contact; do not invent two neighbouring roots by bisecting it.
    if (!bracketsRoot(lowValue, highValue, roundoff)) continue;
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2;
      const value = evaluate(coefficients, middle);
      if (value === 0) {
        low = middle;
        high = middle;
        break;
      }
      if (Math.sign(value) === Math.sign(lowValue)) {
        low = middle;
        lowValue = value;
      } else high = middle;
    }
    roots.push((low + high) / 2);
  }
  return roots;
}

function bracketsRoot(low: number, high: number, roundoff: number): boolean {
  return low * high < 0 && Math.min(Math.abs(low), Math.abs(high)) > roundoff;
}

function atRoot(coefficients: CubicCoefficients, t: number, roundoff: number): boolean {
  // Interior minima must reach numerical zero. A shallow but nonzero minimum
  // may separate two genuine roots that are far apart in world coordinates.
  const tolerance = t > 0 && t < 1 ? roundoff : EXTEND_EPS_MM;
  return Math.abs(evaluate(coefficients, t)) <= tolerance;
}
