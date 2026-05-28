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

  const hatchesRotated: Polyline[] = [];
  // Snap the first scanline to a multiple of `spacing` so two adjacent
  // shapes hatched separately use the same Y grid — avoids visible
  // seams where two regions abut.
  const yStart = Math.ceil(yBounds.minY / spacing) * spacing;
  // Iterate by integer index rather than `y += spacing` so floating-point
  // drift doesn't decide whether the last scanline sits exactly on the
  // top boundary (which the half-open rule would then reject anyway).
  // Counting via `Math.round((maxY - yStart) / spacing) + 1` gives the
  // same scanline count for two polygons that span the same height,
  // independent of rotation angle.
  const scanCount = Math.max(0, Math.floor((yBounds.maxY - yStart) / spacing + SCANLINE_EPS) + 1);
  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const y = yStart + scanIndex * spacing;
    const intersections = collectIntersectionsAtY(rotated, y);
    if (intersections.length < 2) continue;
    intersections.sort((a, b) => a - b);
    // Snake fill: every other scanline reverses direction to skip the
    // long return travel. Cheaper than a post-hoc 2-opt and the saving
    // is the same.
    const forward = scanIndex % 2 === 0;
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xa = intersections[i];
      const xb = intersections[i + 1];
      if (xa === undefined || xb === undefined) continue;
      if (xb - xa < SCANLINE_EPS) continue; // degenerate slice
      const [x0, x1] = forward ? [xa, xb] : [xb, xa];
      hatchesRotated.push({
        points: [
          { x: x0, y },
          { x: x1, y },
        ],
        closed: false,
      });
    }
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

// For one Y, collect every edge intersection across every closed
// polyline. Rule: an edge (p,q) contributes one intersection if Y is
// in the half-open interval [min(p.y, q.y), max(p.y, q.y)). Horizontal
// edges (p.y === q.y) contribute nothing — the scanline would either
// miss or overlap entirely, which the half-open rule handles by giving
// zero intersections in both cases.
function collectIntersectionsAtY(polylines: ReadonlyArray<Polyline>, y: number): number[] {
  const out: number[] = [];
  for (const pl of polylines) {
    pushIntersectionsForPolyline(pl, y, out);
  }
  return out;
}

function pushIntersectionsForPolyline(pl: Polyline, y: number, out: number[]): void {
  const n = pl.points.length;
  if (n < 2) return;
  // Iterate every edge of the closed polygon, including the implicit
  // closing edge from points[n-1] → points[0].
  for (let i = 0; i < n; i += 1) {
    const a = pl.points[i];
    const b = pl.points[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    const yLo = Math.min(a.y, b.y);
    const yHi = Math.max(a.y, b.y);
    if (y < yLo || y >= yHi) continue;
    // Horizontal edge — yLo === yHi means the `y < yLo` check above
    // already rejected it (since y === yHi too via the >= side).
    const dy = b.y - a.y;
    if (Math.abs(dy) < SCANLINE_EPS) continue;
    const t = (y - a.y) / dy;
    out.push(a.x + t * (b.x - a.x));
  }
}
