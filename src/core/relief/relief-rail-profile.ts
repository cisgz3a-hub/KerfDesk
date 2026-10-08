import type {
  ReliefRailProfileSource,
  ReliefProfileSection,
} from '../scene/relief/relief-rail-profile';
import type { Vec2 } from '../scene/scene-object';
import { reliefBoundaryError } from './relief-vector-boundary';
import type { ComponentSample, ReliefComponentSampler } from './relief-authoring-sampling';

type Vertex = Vec2 & { readonly u: number; readonly t: number };
type Strip = { left0: Vertex; right0: Vertex; left1: Vertex; right1: Vertex };
type Triangle = {
  readonly strip: Strip;
  readonly a: Vertex;
  readonly b: Vertex;
  readonly c: Vertex;
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
type Rail = {
  readonly points: ReadonlyArray<Vec2>;
  readonly distances: ReadonlyArray<number>;
  readonly length: number;
};

/** An injective oriented strip is the supported scalar domain; folds are rejected. */
export function railProfileTriangles(source: ReliefRailProfileSource): ReadonlyArray<Triangle> {
  const first = measuredRail(
    source.rail.reversed === true ? [...source.rail.points].reverse() : source.rail.points,
  );
  const second =
    source.secondRail === undefined
      ? undefined
      : measuredRail(
          source.secondRail.reversed === true
            ? [...source.secondRail.points].reverse()
            : source.secondRail.points,
        );
  const times = parameters(source, first, second);
  const sides = times.map((t) => stripSides(source, first, second, t));
  const boundary = {
    rings: [
      {
        closed: true,
        points: [...sides.map((s) => s.left), ...sides.map((s) => s.right).reverse()],
      },
    ],
  };
  const error = reliefBoundaryError(boundary, false);
  if (error !== null) throw new Error(`Rail sweep is not single-valued: ${error}`);
  return triangulatedSides(sides);
}
function triangulatedSides(
  sides: ReadonlyArray<{ readonly left: Vertex; readonly right: Vertex }>,
): ReadonlyArray<Triangle> {
  const out: Triangle[] = [];
  let sign = 0;
  for (let i = 1; i < sides.length; i += 1) {
    const previous = sides[i - 1],
      next = sides[i];
    if (previous === undefined || next === undefined) continue;
    const strip = {
      left0: previous.left,
      right0: previous.right,
      left1: next.left,
      right1: next.right,
    };
    requireInjectiveStrip(strip);
    const triangles = [
      orientedTriangle(previous.left, previous.right, next.right, sign, strip),
      orientedTriangle(previous.left, next.right, next.left, sign, strip),
    ];
    for (const triangle of triangles) {
      if (sign !== 0 && Math.sign(triangle.area) !== sign)
        throw new Error('Rail sweep folds; a single XY height cannot represent it.');
      sign = Math.sign(triangle.area);
      out.push(triangle);
    }
  }
  return out;
}
/** A bilinear Jacobian is affine in both coordinates, so its four corners bound it. */
function requireInjectiveStrip(strip: Strip): void {
  const { left0, right0, left1, right1 } = strip;
  const startAlong = { x: left1.x - left0.x, y: left1.y - left0.y },
    endAlong = { x: right1.x - right0.x, y: right1.y - right0.y },
    startAcross = { x: right0.x - left0.x, y: right0.y - left0.y },
    endAcross = { x: right1.x - left1.x, y: right1.y - left1.y };
  const determinant = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
  const jacobians = [
    determinant(startAlong, startAcross),
    determinant(endAlong, startAcross),
    determinant(startAlong, endAcross),
    determinant(endAlong, endAcross),
  ];
  const sign = Math.sign(jacobians[0] ?? 0);
  if (
    jacobians.some((value) => !Number.isFinite(value) || value === 0 || Math.sign(value) !== sign)
  )
    throw new Error(
      'Rail sweep folds or collapses; a single XY height cannot represent this bilinear strip.',
    );
}

function orientedTriangle(a: Vertex, b: Vertex, c: Vertex, sign: number, strip: Strip): Triangle {
  const area = cross(a, b, c);
  if (!Number.isFinite(area) || Math.abs(area) <= 1e-10 || (sign !== 0 && Math.sign(area) !== sign))
    throw new Error(
      'Rail sweep folds or collapses; a single XY height cannot represent this surface.',
    );
  return {
    strip,
    a,
    b,
    c,
    area,
    minX: Math.min(a.x, b.x, c.x),
    maxX: Math.max(a.x, b.x, c.x),
    minY: Math.min(a.y, b.y, c.y),
    maxY: Math.max(a.y, b.y, c.y),
  };
}
export function railProfileSampler(source: ReliefRailProfileSource): ReliefComponentSampler {
  const triangles = railProfileTriangles(source);
  return (p) => {
    for (const triangle of triangles) {
      if (
        p.x < triangle.minX - 1e-9 ||
        p.x > triangle.maxX + 1e-9 ||
        p.y < triangle.minY - 1e-9 ||
        p.y > triangle.maxY + 1e-9
      )
        continue;
      const location = triangleLocation(triangle, p);
      if (location !== null)
        return {
          included: true,
          heightMm: sectionHeight(
            source.sections,
            Math.max(0, Math.min(1, location.t)),
            Math.max(0, Math.min(1, location.u)),
          ),
        };
    }
    return { included: false, heightMm: 0 } satisfies ComponentSample;
  };
}
function measuredRail(points: ReadonlyArray<Vec2>): Rail {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1],
      b = points[i];
    if (a !== undefined && b !== undefined)
      distances.push((distances[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = distances[distances.length - 1] ?? 0;
  if (!(length > 0)) throw new Error('Rail requires a non-zero physical length.');
  return { points, distances, length };
}
function pointOnRail(rail: Rail, t: number): Vec2 {
  const distance = t * rail.length;
  for (let i = 1; i < rail.points.length; i += 1) {
    const end = rail.distances[i] ?? 0;
    if (end < distance && i < rail.points.length - 1) continue;
    const a = rail.points[i - 1],
      b = rail.points[i];
    if (a === undefined || b === undefined) continue;
    const start = rail.distances[i - 1] ?? 0,
      fraction = Math.max(0, Math.min(1, (distance - start) / (end - start)));
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  }
  throw new Error('Rail has no usable segment.');
}
function parameters(
  source: ReliefRailProfileSource,
  first: Rail,
  second: Rail | undefined,
): number[] {
  const values = [
    ...Array.from({ length: source.samplingSteps + 1 }, (_, i) => i / source.samplingSteps),
    ...first.distances.map((d) => d / first.length),
    ...(second?.distances.map((d) => d / second.length) ?? []),
    ...source.sections.map((s) => s.position),
  ];
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length > 256) throw new Error('Rail strip exceeds its 256-position geometry budget.');
  return sorted;
}
function stripSides(
  source: ReliefRailProfileSource,
  first: Rail,
  second: Rail | undefined,
  t: number,
): { readonly left: Vertex; readonly right: Vertex } {
  const center = pointOnRail(first, t),
    scale = sectionWidth(source.sections, t);
  let left: Vec2, right: Vec2;
  if (second === undefined) {
    const before = pointOnRail(first, Math.max(0, t - 1e-5)),
      after = pointOnRail(first, Math.min(1, t + 1e-5));
    const dx = after.x - before.x,
      dy = after.y - before.y,
      length = Math.hypot(dx, dy);
    if (!(length > 1e-12)) throw new Error('Rail reverses or collapses at a strip position.');
    const nx = ((-dy / length) * source.widthMm * scale) / 2,
      ny = ((dx / length) * source.widthMm * scale) / 2;
    left = { x: center.x - nx, y: center.y - ny };
    right = { x: center.x + nx, y: center.y + ny };
  } else {
    const edge = pointOnRail(second, t),
      cx = (center.x + edge.x) / 2,
      cy = (center.y + edge.y) / 2;
    left = { x: cx + (center.x - cx) * scale, y: cy + (center.y - cy) * scale };
    right = { x: cx + (edge.x - cx) * scale, y: cy + (edge.y - cy) * scale };
  }
  return { left: { ...left, u: 0, t }, right: { ...right, u: 1, t } };
}
function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function triangleLocation(triangle: Triangle, p: Vec2): { u: number; t: number } | null {
  const { a, b, c, area } = triangle;
  const wa = cross(p, b, c) / area,
    wb = cross(a, p, c) / area,
    wc = 1 - wa - wb;
  if (Math.min(wa, wb, wc) < -1e-9) return null;
  return stripLocation(triangle.strip, p);
}
function surroundingSections(
  sections: ReadonlyArray<ReliefProfileSection>,
  t: number,
): { a: ReliefProfileSection; b: ReliefProfileSection; fraction: number } {
  const first = sections[0];
  if (first === undefined) throw new Error('A rail requires profiles.');
  for (let i = 1; i < sections.length; i += 1) {
    const a = sections[i - 1],
      b = sections[i];
    if (a !== undefined && b !== undefined && t <= b.position)
      return {
        a,
        b,
        fraction: Math.max(0, Math.min(1, (t - a.position) / (b.position - a.position))),
      };
  }
  const last = sections[sections.length - 1] ?? first;
  return { a: last, b: last, fraction: 0 };
}
function sectionWidth(sections: ReadonlyArray<ReliefProfileSection>, t: number): number {
  const { a, b, fraction } = surroundingSections(sections, t);
  return a.widthScale * (1 - fraction) + b.widthScale * fraction;
}
function sectionHeight(
  sections: ReadonlyArray<ReliefProfileSection>,
  t: number,
  u: number,
): number {
  const { a, b, fraction } = surroundingSections(sections, t);
  return profileHeight(a.profile, u) * (1 - fraction) + profileHeight(b.profile, u) * fraction;
}
function profileHeight(points: ReadonlyArray<Vec2>, u: number): number {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1],
      b = points[i];
    if (a !== undefined && b !== undefined && u <= b.x + 1e-9) {
      const t = Math.max(0, Math.min(1, (u - a.x) / (b.x - a.x)));
      return a.y * (1 - t) + b.y * t;
    }
  }
  return points[points.length - 1]?.y ?? 0;
}

/** Invert the ruled strip, so changing width does not skew a symmetric profile. */
function stripLocation(strip: Strip, p: Vec2): { u: number; t: number } | null {
  const { left0, right0, left1, right1 } = strip;
  const a = { x: left1.x - left0.x, y: left1.y - left0.y },
    b = { x: right0.x - left0.x, y: right0.y - left0.y },
    c = { x: right1.x - left1.x - b.x, y: right1.y - left1.y - b.y },
    q = { x: p.x - left0.x, y: p.y - left0.y };
  const determinant = (v: Vec2, w: Vec2) => v.x * w.y - v.y * w.x;
  const rawA = -determinant(a, c),
    rawB = determinant(q, c) - determinant(a, b),
    rawC = determinant(q, b);
  const magnitude = Math.max(Math.abs(rawA), Math.abs(rawB), Math.abs(rawC));
  if (!(magnitude > 0) || !Number.isFinite(magnitude))
    throw new Error('Rail strip coordinates exceed the finite inversion range.');
  const A = rawA / magnitude,
    B = rawB / magnitude,
    C = rawC / magnitude;
  const roots = inverseStripRoots(A, B, C);
  for (const v of roots) {
    if (!insideStripFraction(v)) continue;
    const width = { x: b.x + c.x * v, y: b.y + c.y * v };
    const offset = { x: q.x - a.x * v, y: q.y - a.y * v };
    const u = Math.abs(width.x) >= Math.abs(width.y) ? offset.x / width.x : offset.y / width.y;
    if (!insideStripFraction(u)) continue;
    return { u, t: left0.t * (1 - v) + left1.t * v };
  }
  return null;
}

function inverseStripRoots(A: number, B: number, C: number): ReadonlyArray<number> {
  if (A === 0) return B === 0 ? [] : [-C / B];
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const stable = -0.5 * (B + (B >= 0 ? root : -root));
  return stable === 0 ? [-B / (2 * A)] : [stable / A, C / stable];
}

function insideStripFraction(value: number): boolean {
  return Number.isFinite(value) && value >= -1e-9 && value <= 1 + 1e-9;
}
