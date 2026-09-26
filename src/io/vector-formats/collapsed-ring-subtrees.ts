// Grid-collapsed contours leave no orphans (ADR-444 Amendment 1).
//
// Each filled contour is snapped to the export grid: GeoJSON snaps its
// flattened points, PDF and EPS snap its path's control points. A very thin
// contour can collapse there (its written points become collinear or fewer
// than three, so it encloses no area) while a contour nested inside it still
// snaps to a real polygon. Dropping only the collapsed contour (GeoJSON) or
// painting it with no area (PDF, EPS) would leave that inner contour without
// its container: a hole would be painted as ink, or an island as paper.
//
// No-orphan rule: a contour is only ever dropped together with everything
// nested inside it. Nesting is decided on the unsnapped flattened contours,
// where the collapsed contour still encloses its children, and a collapsed
// contour is dropped with its whole subtree (its holes, their islands, and so
// on). Everything dropped lies inside the collapsed contour, whose snapped
// area is zero, so what is lost is at most about one grid diagonal wide.
//
// A contour whose written points are not collinear but whose net area is zero
// (a symmetric bow-tie or figure-eight) has NOT collapsed: it crosses itself,
// is kept, and is never used as a container here.

import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../core/scene';

/** Maximum containment tolerance (mm); finer grids need finer source outlines. */
const CONTAINMENT_TOLERANCE_MM = 0.01;

/** A written grid point (structurally vector-artwork's GridPoint). */
type GridXY = { readonly x: number; readonly y: number };

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Whether written grid points enclose no area: fewer than three distinct points, or all collinear. */
export function collapsesOnGrid(points: ReadonlyArray<GridXY>): boolean {
  const first = points[0];
  if (first === undefined) return true;
  const second = points.find((p) => p.x !== first.x || p.y !== first.y);
  if (second === undefined) return true;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  return points.every((p) => dx * (p.y - first.y) - dy * (p.x - first.x) === 0);
}

/**
 * Which filled contours to write, given each contour's written grid points:
 * a contour is kept when its written points do not collapse and it lies
 * inside no collapsed contour.
 */
export function filledCurvesKept(
  curves: ReadonlyArray<CurveSubpath>,
  written: ReadonlyArray<ReadonlyArray<GridXY>>,
  gridStepMm: number,
): boolean[] {
  const collapsed = written.map(collapsesOnGrid);
  if (!collapsed.includes(true) || collapsed.every(Boolean))
    return collapsed.map((value) => !value);
  const tolerance = Math.min(CONTAINMENT_TOLERANCE_MM, gridStepMm / 16);
  const sources = curves.map((curve, index) =>
    unsnappedPolyline(curve, tolerance, collapsed[index] === true),
  );
  return contoursKeptAfterCollapse(sources, collapsed);
}

/**
 * Which contours to keep. `sources` are the unsnapped flattened contours (any
 * frame; a mirror does not change containment), `collapsed[i]` says contour i
 * collapsed on the grid. A contour is kept when it did not collapse and lies
 * inside no collapsed contour. A contour that crosses a collapsed contour
 * (a probe outside it, or an edge crossing one of its edges) is not inside it
 * and is kept.
 */
export function contoursKeptAfterCollapse(
  sources: ReadonlyArray<ReadonlyArray<Vec2>>,
  collapsed: ReadonlyArray<boolean>,
): boolean[] {
  const keep = collapsed.map((isCollapsed) => !isCollapsed);
  const containers = sources
    .map((points, index) => ({ index, points, box: boxOf(points) }))
    .filter(({ index, points }) => collapsed[index] === true && encloses(points));
  if (containers.length === 0) return keep;
  sources.forEach((points, index) => {
    if (!keep[index] || points.length === 0) return;
    const box = boxOf(points);
    keep[index] = !containers.some(
      (container) =>
        container.index !== index &&
        boxWithin(box, container.box) &&
        liesInside(points, container.points),
    );
  });
  return keep;
}

function unsnappedPolyline(curve: CurveSubpath, toleranceMm: number, collapsed: boolean): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm });
  if (result.kind !== 'ok') {
    throw new Error(
      'Cannot resolve contour containment within ' +
        result.segmentBudget +
        ' line segments. Simplify this artwork.',
    );
  }
  const points = [...result.polyline.points];
  // A grid-relative tolerance is still an approximation. A thinner curved
  // lens can flatten to a line while holding a child that survives rounding.
  // Do not infer an empty source contour from that unresolved outline.
  if (collapsed && collapsesOnGrid(points) && sourceMayEncloseArea(curve)) {
    throw new Error(
      'Cannot resolve a collapsed curved contour at this export precision. Use a finer coordinate grid.',
    );
  }
  return points;
}

function sourceMayEncloseArea(curve: CurveSubpath): boolean {
  const points = [curve.start];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') points.push(segment.control1, segment.control2);
    else if (
      segment.kind === 'elliptical-arc' &&
      segment.radiusX !== 0 &&
      segment.radiusY !== 0 &&
      (from.x !== segment.to.x || from.y !== segment.to.y)
    ) {
      return true;
    }
    points.push(segment.to);
    from = segment.to;
  }
  return !collapsesOnGrid(points);
}

/** Whether a closed polyline encloses any area at all. */
function encloses(points: ReadonlyArray<Vec2>): boolean {
  if (points.length < 3) return false;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea !== 0;
}

/**
 * Whether `inner` lies wholly inside `outer`: no vertex of `inner` is outside
 * `outer`, and no edge of `inner` properly crosses an edge of `outer`. The
 * answer never depends on where `inner` starts. A contour lying wholly on the
 * boundary is a duplicate of the collapsed contour and collapses with it.
 * (Vertices only: a shared vertex tests exactly as on the boundary, an edge
 * midpoint need not.)
 */
function liesInside(inner: ReadonlyArray<Vec2>, outer: ReadonlyArray<Vec2>): boolean {
  if (inner.some((point) => windingSide(point, outer) === 'outside')) return false;
  return !edgesCross(inner, outer);
}

function windingSide(p: Vec2, ring: ReadonlyArray<Vec2>): 'inside' | 'outside' | 'boundary' {
  let wn = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (cross === 0 && boxWithin({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, boxOf([a, b]))) {
      return 'boundary';
    }
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wn += 1;
    } else if (b.y <= p.y && cross < 0) wn -= 1;
  }
  return wn !== 0 ? 'inside' : 'outside';
}

/** Whether an edge of `p` properly crosses an edge of `q` (each strictly separates the other). */
function edgesCross(p: ReadonlyArray<Vec2>, q: ReadonlyArray<Vec2>): boolean {
  const turn = (a: Vec2, b: Vec2, c: Vec2): number =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i] as Vec2;
    const b = p[(i + 1) % p.length] as Vec2;
    for (let j = 0; j < q.length; j += 1) {
      const c = q[j] as Vec2;
      const d = q[(j + 1) % q.length] as Vec2;
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) return true;
    }
  }
  return false;
}

function boxOf(points: ReadonlyArray<Vec2>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function boxWithin(inner: Box, outer: Box): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}
