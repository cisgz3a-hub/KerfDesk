// Cutter contact with one triangle or one edge of the triangulated heightmap
// (ADR-412). heightmap-surface-contact.ts decides which triangles and edges can
// matter for a cutter position; this module solves each one.
//
// Every supported cutter law dz is convex and nondecreasing in radius, so the
// objective h(p) - dz(|p - c|) is concave on a triangle and along an edge. On a
// triangle's plane its maximum lies on the uphill ray from the cutter axis, at
// the radius where the cutter is as steep as the facet; along an edge it is an
// endpoint, a stationary point of one of the cutter's smooth pieces, or where
// the edge crosses a piece boundary. Candidates are always scored with the
// kernel's own law `dz`, so a closed form only chooses where to look.

const GOLDEN = (Math.sqrt(5) - 1) / 2;
// 0.618^40 of a cell-sized interval is far below the 0.001 mm emit grid.
const SEARCH_ITERATIONS = 40;
const DEGENERATE_AREA = 1e-18;
const INSIDE_TOLERANCE = 1e-12;
const DOUBLE_ROOT_TOLERANCE = 1e-12;
// Bounds within this of the best contact so far are skipped. Float32 depths
// make a planar wall's triangles disagree by ~1e-7 mm; a micron-thousandth is
// far below the 0.001 mm emit grid and the Float32 depth resolution.
export const PRUNE_TOLERANCE_MM = 1e-6;

// Where to look for a maximum. `dz` stays the authority for every score.
export type ContactProfile =
  | { readonly kind: 'flat' }
  | { readonly kind: 'ball'; readonly ball: number }
  | { readonly kind: 'cone'; readonly land: number; readonly slope: number }
  | {
      readonly kind: 'tapered';
      readonly ball: number;
      readonly tangentRadius: number;
      readonly slope: number;
    }
  | { readonly kind: 'search' };

// Written by facetContact, which runs millions of times per relief.
export type FacetResult = {
  // The plane's maximum inside the cutter: bounds every edge of the triangle.
  planeBound: number;
  // The same maximum when its contact point lies inside the triangle.
  candidate: number;
  // The same maximum when it lies inside the rectangle spanned by a planar
  // quad's a (x0, y0), b (x1) and c (y2) corners.
  insideRectangle: number;
};

/** One cutter law plus per-call scratch, reused to avoid allocation. */
export type ContactLaw = {
  readonly radiusMm: number;
  readonly radiusSquared: number;
  readonly dz: (radiusMm: number) => number;
  readonly profile: ContactProfile;
  readonly roots: Float64Array;
  readonly facet: FacetResult;
};

/**
 * The facet's own maximum, written to `law.facet`. Returns false for a
 * degenerate triangle.
 */
export function facetContact(
  law: ContactLaw,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  xc: number,
  yc: number,
): boolean {
  const e1x = x1 - x0;
  const e1y = y1 - y0;
  const e1z = z1 - z0;
  const e2x = x2 - x0;
  const e2y = y2 - y0;
  const e2z = z2 - z0;
  const nz = e1x * e2y - e1y * e2x;
  if (Math.abs(nz) <= DEGENERATE_AREA) return false;
  const gx = -(e1y * e2z - e1z * e2y) / nz;
  const gy = -(e1z * e2x - e1x * e2z) / nz;
  const slope = Math.sqrt(gx * gx + gy * gy);
  const radius = slope > 0 ? facetRadius(law, slope) : 0;
  const px = slope > 0 ? xc + (radius * gx) / slope : xc;
  const py = slope > 0 ? yc + (radius * gy) / slope : yc;
  const value = z0 + gx * (px - x0) + gy * (py - y0) - law.dz(radius);
  const facet = law.facet;
  facet.planeBound = value;
  facet.candidate = insideTriangle(x0, y0, x1, y1, x2, y2, px, py)
    ? value
    : Number.NEGATIVE_INFINITY;
  facet.insideRectangle = insideRectangle(x0, y0, x1, y2, px, py)
    ? value
    : Number.NEGATIVE_INFINITY;
  return true;
}

function insideTriangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
): boolean {
  const d0 = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
  const d1 = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const d2 = (x0 - x2) * (y - y2) - (y0 - y2) * (x - x2);
  const hasNegative = d0 < -INSIDE_TOLERANCE || d1 < -INSIDE_TOLERANCE || d2 < -INSIDE_TOLERANCE;
  const hasPositive = d0 > INSIDE_TOLERANCE || d1 > INSIDE_TOLERANCE || d2 > INSIDE_TOLERANCE;
  return !(hasNegative && hasPositive);
}

function insideRectangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x: number,
  y: number,
): boolean {
  return (
    x >= Math.min(x0, x1) - INSIDE_TOLERANCE &&
    x <= Math.max(x0, x1) + INSIDE_TOLERANCE &&
    y >= Math.min(y0, y1) - INSIDE_TOLERANCE &&
    y <= Math.max(y0, y1) + INSIDE_TOLERANCE
  );
}

// Radius maximising slope * r - dz(r) on [0, R]. The objective is concave, so
// each closed form is the stationary point of the cutter's smooth piece that
// matches the facet slope, or the rim when no piece is steep enough.
function facetRadius(law: ContactLaw, slope: number): number {
  const outer = law.radiusMm;
  const profile = law.profile;
  switch (profile.kind) {
    case 'flat':
      return outer;
    case 'ball':
      return Math.min(outer, (profile.ball * slope) / Math.sqrt(1 + slope * slope));
    case 'cone':
      return slope > profile.slope ? outer : Math.min(outer, profile.land);
    case 'tapered':
      return slope > profile.slope
        ? outer
        : Math.min(outer, (profile.ball * slope) / Math.sqrt(1 + slope * slope));
    case 'search':
      return goldenMax((r) => slope * r - law.dz(r), 0, outer, SEARCH_ITERATIONS * 2);
  }
}

/**
 * The highest tip at which the cutter centred on (xc, yc) touches segment p-q,
 * or `lowerBound` when the segment requires no more.
 */
export function edgeContact(
  law: ContactLaw,
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  xc: number,
  yc: number,
  lowerBound: number,
): number {
  const ex = qx - px;
  const ey = qy - py;
  const fx = px - xc;
  const fy = py - yc;
  const a = ex * ex + ey * ey;
  const b = fx * ex + fy * ey;
  const f2 = fx * fx + fy * fy;
  const discriminant = b * b - a * (f2 - law.radiusSquared);
  if (!(a > 0) || discriminant < 0) return lowerBound;
  // The part of the segment inside the cutter.
  const root = Math.sqrt(discriminant);
  const t0 = Math.max(0, (-b - root) / a);
  const t1 = Math.min(1, (-b + root) / a);
  if (t0 > t1) return lowerBound;
  // Upper bound: the higher endpoint at the segment's nearest approach.
  const nearestT = Math.min(t1, Math.max(t0, -b / a));
  const nx = fx + nearestT * ex;
  const ny = fy + nearestT * ey;
  const nearest = Math.sqrt(nx * nx + ny * ny);
  if (Math.max(pz, qz) - law.dz(nearest) <= lowerBound + PRUNE_TOLERANCE_MM) return lowerBound;
  const dzT = qz - pz;
  const edge = edgeScratch;
  edge.pz = pz;
  edge.dzT = dzT;
  edge.fx = fx;
  edge.fy = fy;
  edge.ex = ex;
  edge.ey = ey;
  // The nearest approach is the maximum of a level edge, where the stationary
  // quadratics below collapse to a double root that rounding can lose.
  const best = Math.max(
    lowerBound,
    edgeValue(law, edge, t0),
    edgeValue(law, edge, t1),
    edgeValue(law, edge, nearestT),
  );
  if (law.profile.kind === 'search') {
    const value = (t: number): number => edgeValue(law, edge, t);
    return Math.max(best, value(goldenMax(value, t0, t1, SEARCH_ITERATIONS)));
  }
  const count = edgeCriticalPoints(law, a, b, f2, dzT);
  return bestAtRoots(law, edge, count, t0, t1, best);
}

// The edge being solved, reused so the hot path allocates nothing.
type EdgeScratch = { pz: number; dzT: number; fx: number; fy: number; ex: number; ey: number };
const edgeScratch: EdgeScratch = { pz: 0, dzT: 0, fx: 0, fy: 0, ex: 0, ey: 0 };

// Math.sqrt, not Math.hypot: hypot's overflow care is several times slower
// and these distances are a few millimetres.
function edgeValue(law: ContactLaw, edge: EdgeScratch, t: number): number {
  const x = edge.fx + t * edge.ex;
  const y = edge.fy + t * edge.ey;
  return edge.pz + t * edge.dzT - law.dz(Math.sqrt(x * x + y * y));
}

// Candidate parameters along an edge for each closed-form profile. A flat
// cutter is linear along the segment, so an endpoint always wins.
function edgeCriticalPoints(
  law: ContactLaw,
  a: number,
  b: number,
  f2: number,
  dzT: number,
): number {
  const { profile, roots } = law;
  switch (profile.kind) {
    case 'ball':
      return ballStationaryPoints(roots, 0, profile.ball, a, b, f2, dzT);
    case 'cone': {
      const flank = flankStationaryPoints(roots, 0, profile.slope, a, b, f2, dzT);
      return radiusCrossings(roots, flank, profile.land, a, b, f2);
    }
    case 'tapered': {
      const ball = ballStationaryPoints(roots, 0, profile.ball, a, b, f2, dzT);
      const flank = flankStationaryPoints(roots, ball, profile.slope, a, b, f2, dzT);
      return radiusCrossings(roots, flank, profile.tangentRadius, a, b, f2);
    }
    case 'flat':
    case 'search':
      return 0;
  }
}

function bestAtRoots(
  law: ContactLaw,
  edge: EdgeScratch,
  count: number,
  t0: number,
  t1: number,
  best: number,
): number {
  let result = best;
  for (let index = 0; index < count; index += 1) {
    const t = law.roots[index] ?? Number.NaN;
    if (t > t0 && t < t1) result = Math.max(result, edgeValue(law, edge, t));
  }
  return result;
}

// Stationary points of dz_t * t + sqrt(r^2 - rho(t)^2), with
// rho(t)^2 = a t^2 + 2 b t + f2 the squared distance from the cutter axis:
// (a t + b) = dz_t * sqrt(r^2 - rho^2) squares to
// a(a + dz_t^2) t^2 + 2 b (a + dz_t^2) t + b^2 + dz_t^2 (f2 - r^2) = 0.
// Squaring can add a spurious root; every point on the edge is a real
// contact, so scoring both keeps the maximum exact.
function ballStationaryPoints(
  out: Float64Array,
  offset: number,
  radiusMm: number,
  a: number,
  b: number,
  f2: number,
  dzT: number,
): number {
  const k = a + dzT * dzT;
  return quadraticRoots(
    out,
    offset,
    a * k,
    2 * b * k,
    b * b + dzT * dzT * (f2 - radiusMm * radiusMm),
  );
}

// Stationary points on a conical flank rising `slope` per mm of radius: dz_t
// equals slope * (a t + b) / rho, which squares to
// a(a - m^2) t^2 + 2 b (a - m^2) t + b^2 - m^2 f2 = 0 with m = dz_t / slope.
function flankStationaryPoints(
  out: Float64Array,
  offset: number,
  slope: number,
  a: number,
  b: number,
  f2: number,
  dzT: number,
): number {
  if (!(slope > 0) || !Number.isFinite(slope)) return offset;
  const m = dzT / slope;
  const k = a - m * m;
  return quadraticRoots(out, offset, a * k, 2 * b * k, b * b - m * m * f2);
}

// Where the segment's distance from the axis equals `radius`.
function radiusCrossings(
  out: Float64Array,
  offset: number,
  radius: number,
  a: number,
  b: number,
  f2: number,
): number {
  return quadraticRoots(out, offset, a, 2 * b, f2 - radius * radius);
}

// Real roots of qa t^2 + qb t + qc, appended to `out` at `offset`; returns the
// new length.
function quadraticRoots(
  out: Float64Array,
  offset: number,
  qa: number,
  qb: number,
  qc: number,
): number {
  if (!Number.isFinite(qa) || !Number.isFinite(qb) || !Number.isFinite(qc)) return offset;
  if (Math.abs(qa) <= DEGENERATE_AREA) {
    if (Math.abs(qb) <= DEGENERATE_AREA) return offset;
    out[offset] = -qc / qb;
    return offset + 1;
  }
  const discriminant = qb * qb - 4 * qa * qc;
  // A double root can round to a slightly negative discriminant.
  if (discriminant < -DOUBLE_ROOT_TOLERANCE * qb * qb) return offset;
  const root = Math.sqrt(Math.max(0, discriminant));
  out[offset] = (-qb - root) / (2 * qa);
  out[offset + 1] = (-qb + root) / (2 * qa);
  return offset + 2;
}

// Golden-section maximum of a concave function on [lo, hi].
function goldenMax(f: (t: number) => number, lo: number, hi: number, iterations: number): number {
  let left = lo;
  let right = hi;
  let m1 = right - GOLDEN * (right - left);
  let m2 = left + GOLDEN * (right - left);
  let v1 = f(m1);
  let v2 = f(m2);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (v1 < v2) {
      left = m1;
      m1 = m2;
      v1 = v2;
      m2 = left + GOLDEN * (right - left);
      v2 = f(m2);
    } else {
      right = m2;
      m2 = m1;
      v2 = v1;
      m1 = right - GOLDEN * (right - left);
      v1 = f(m1);
    }
  }
  return v1 >= v2 ? m1 : m2;
}
