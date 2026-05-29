// fillHatching — pure scanline polygon fill.
//
// Input: a set of closed polylines (the contours of a SceneObject color
// path) + a hatch angle in degrees + a hatch spacing in mm.
// Output: a set of open polylines (the hatch lines that fill the interior).
//
// Algorithm (classic scanline fill, even-odd rule):
//   1. Rotate every input polyline by -hatchAngle around (0,0) so that the
//      hatch direction becomes horizontal — we always do the math in the
//      "horizontal scanline" frame regardless of the requested angle.
//   2. For each Y from yMin to yMax at hatchSpacing intervals, walk every
//      edge of every input polyline and collect its intersection with the
//      horizontal line Y. Half-open interval on Y avoids the classic
//      "vertex exactly on scanline" double-count.
//   3. Sort the intersections by X and pair them: (x0,x1)(x2,x3)…
//      Each pair is one interior run. Even-odd pairing naturally handles
//      holes (e.g. letter "O") because the inner contour contributes a
//      second pair of intersections that skips its enclosed area.
//   4. Alternate direction each scanline (snake fill) so the laser doesn't
//      do a long return-to-start travel between rows.
//   5. Rotate every hatch line by +hatchAngle to bring it back into the
//      original frame.
//
// Pure-core compliant: no clock, no random, no I/O. The rotation epsilon
// (`SCANLINE_EPS`) is a small absolute tolerance in mm; with double-precision
// rotation and rounding at G-code emit time (3 decimal places), it stays
// well inside the noise floor of any laser machine.
//
// Open polylines (closed=false) don't enclose area and are silently skipped
// — the caller decides whether to surface a warning toast.

import type { Polyline, Vec2 } from '../scene';

// Small absolute tolerance in mm. Used to (a) collapse near-zero edge
// lengths, (b) snap "scanline exactly on vertex" cases off the boundary
// so the half-open interval rule fires cleanly. 1e-6 mm is well below
// the 3-decimal G-code emit precision.
const SCANLINE_EPS = 1e-6;

// Minimum permitted hatch spacing. Anything denser than this is almost
// certainly user error (the laser can't move that fine, and the G-code
// would be enormous) — clamp at the algorithm boundary rather than risk
// an infinite-feeling loop.
const MIN_HATCH_SPACING_MM = 0.05;

export type HatchInput = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly hatchAngleDeg: number;
  readonly hatchSpacingMm: number;
};

export function fillHatching(input: HatchInput): ReadonlyArray<Polyline> {
  const spacing = Math.max(MIN_HATCH_SPACING_MM, input.hatchSpacingMm);
  // Accept polylines whose `closed` flag is set, OR whose first and
  // last points coincide within float epsilon. Defense-in-depth for
  // upstream sources that don't set the flag — notably opentype.js v2
  // glyphs whose stored TextObject polylines were created before the
  // text-to-polylines fix landed (autosave-restored "O" reproduced
  // the original Frame=empty bug even after deploy). Caller doesn't
  // have to re-render the text — we just notice the geometry.
  const closed = input.polylines.filter(isClosedEnough);
  if (closed.length === 0) return [];

  const angle = normalizeAngle(input.hatchAngleDeg);
  const rotated = closed.map((pl) => rotatePolyline(pl, -angle));
  const yBounds = polylineYBounds(rotated);
  if (yBounds === null) return [];

  // Build the edge table ONCE, then sweep scanlines with an active set —
  // rather than re-walking every edge of every contour at every scanline.
  // The old O(scanlines × edges) walk froze the whole app when a traced
  // "big image" (thousands of contours) was switched to Fill: the canvas
  // redraw AND the live ETA both run this synchronously. Edges sorted by
  // their low Y let a single advancing cursor admit them; the half-open
  // `y < yHi` test retires them. Each edge is touched only on the scanlines
  // it actually spans, so the cost tracks the geometry, not bed height.
  const edges = buildSortedEdges(rotated);
  const hatchesRotated: Polyline[] = [];
  // Snap the first scanline to a multiple of `spacing` so two adjacent
  // shapes hatched separately use the same Y grid — avoids visible
  // seams where two regions abut.
  const yStart = Math.ceil(yBounds.minY / spacing) * spacing;
  // Iterate by integer index rather than `y += spacing` so floating-point
  // drift doesn't decide whether the last scanline sits exactly on the top
  // boundary (which the half-open rule would then reject anyway). The
  // integer count is also rotation-invariant for equal-height polygons.
  const scanCount = Math.max(0, Math.floor((yBounds.maxY - yStart) / spacing + SCANLINE_EPS) + 1);
  let nextEdge = 0;
  let active: ScanEdge[] = [];
  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const y = yStart + scanIndex * spacing;
    // Admit every edge whose span has begun (sorted by yLo, so stop at the
    // first one still ahead of this scanline).
    while (nextEdge < edges.length) {
      const e = edges[nextEdge];
      if (e === undefined || e.yLo > y) break;
      active.push(e);
      nextEdge += 1;
    }
    // Retire edges whose span has ended: an edge covers the half-open
    // interval [yLo, yHi), so y >= yHi means it no longer crosses. Since y
    // only increases, a retired edge never returns.
    active = active.filter((e) => y < e.yHi);
    const intersections = active.map((e) => intersectX(e, y));
    pushScanlineHatches(intersections, y, scanIndex, hatchesRotated);
  }

  return hatchesRotated.map((pl) => rotatePolyline(pl, angle));
}

// "Closed enough" check: either the closed flag is set, or the polyline
// returns to within FLAG_EPS_MM of its starting point. The geometric
// half catches glyph contours whose source omitted Z (opentype.js v2)
// and any data-at-rest polylines whose closed flag was set incorrectly
// upstream. Same epsilon as text-to-polylines.flattenPath uses.
const CLOSURE_EPS_MM = 1e-4;
function isClosedEnough(pl: Polyline): boolean {
  if (pl.points.length < 3) return false;
  if (pl.closed) return true;
  const first = pl.points[0];
  const last = pl.points[pl.points.length - 1];
  if (first === undefined || last === undefined) return false;
  return Math.abs(first.x - last.x) < CLOSURE_EPS_MM && Math.abs(first.y - last.y) < CLOSURE_EPS_MM;
}

// Wrap hatch angle into [0, 180). Hatching at 200° looks identical to 20°
// because the line is undirected — normalize so downstream comparisons
// (and snapshot tests) get a canonical form.
function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 180;
  if (a < 0) a += 180;
  return a;
}

function rotatePolyline(pl: Polyline, deg: number): Polyline {
  if (deg === 0) return pl;
  const rad = (deg * Math.PI) / 180;
  const cos = snapTrig(Math.cos(rad));
  const sin = snapTrig(Math.sin(rad));
  const points: Vec2[] = pl.points.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
  return { points, closed: pl.closed };
}

// Snap cos/sin results near 0, ±1 to exact values. Math.cos(±π/2)
// returns ~6e-17 in IEEE-754 — small enough that the bounding box of a
// 90°-rotated square gets a millionth-of-a-mm "lip" on its top edge,
// which the half-open scanline rule then picks up as a spurious row.
// Snapping eliminates angle-vs-angle hatch-count drift at right angles.
function snapTrig(n: number): number {
  const TRIG_EPS = 1e-12;
  if (Math.abs(n) < TRIG_EPS) return 0;
  if (Math.abs(n - 1) < TRIG_EPS) return 1;
  if (Math.abs(n + 1) < TRIG_EPS) return -1;
  return n;
}

function polylineYBounds(
  polylines: ReadonlyArray<Polyline>,
): { readonly minY: number; readonly maxY: number } | null {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pl of polylines) {
    for (const p of pl.points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minY, maxY };
}

// One non-horizontal polygon edge, precomputed for the scanline sweep.
// yLo/yHi are the half-open Y span [yLo, yHi) the edge crosses; ax..by
// are the endpoints in the (already rotated) horizontal-scanline frame.
type ScanEdge = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly yLo: number;
  readonly yHi: number;
};

// Flatten every closed polyline into a flat edge list, dropping horizontal
// edges (they never cross a scanline — the half-open rule gives them zero
// intersections), and sort by yLo so the sweep can admit edges with a single
// advancing cursor instead of re-scanning the whole list each scanline.
function buildSortedEdges(polylines: ReadonlyArray<Polyline>): ScanEdge[] {
  const edges: ScanEdge[] = [];
  for (const pl of polylines) {
    const n = pl.points.length;
    if (n < 2) continue;
    // Every edge of the closed polygon, including the implicit closing
    // edge points[n-1] → points[0].
    for (let i = 0; i < n; i += 1) {
      const a = pl.points[i];
      const b = pl.points[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      if (Math.abs(b.y - a.y) < SCANLINE_EPS) continue;
      edges.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        yLo: Math.min(a.y, b.y),
        yHi: Math.max(a.y, b.y),
      });
    }
  }
  edges.sort((e1, e2) => e1.yLo - e2.yLo);
  return edges;
}

// X coordinate where edge `e` crosses horizontal line `y`. Caller guarantees
// y is inside [yLo, yHi), so dy is non-zero (horizontal edges were dropped).
function intersectX(e: ScanEdge, y: number): number {
  const dy = e.by - e.ay;
  const t = (y - e.ay) / dy;
  return e.ax + t * (e.bx - e.ax);
}

// Pair sorted X intersections into interior runs (even-odd rule) and emit one
// hatch line per run. Direction alternates with scanIndex (snake fill) so the
// laser doesn't return-to-start between rows. scanIndex (not a boolean) keeps
// the snake decision here and avoids a boolean parameter at the call site.
function pushScanlineHatches(xs: number[], y: number, scanIndex: number, out: Polyline[]): void {
  if (xs.length < 2) return;
  xs.sort((a, b) => a - b);
  const forward = scanIndex % 2 === 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const xa = xs[i];
    const xb = xs[i + 1];
    if (xa === undefined || xb === undefined) continue;
    if (xb - xa < SCANLINE_EPS) continue;
    const [x0, x1] = forward ? [xa, xb] : [xb, xa];
    out.push({
      points: [
        { x: x0, y },
        { x: x1, y },
      ],
      closed: false,
    });
  }
}
