// Grid-collapsed contours leave no orphans in GeoJSON (ADR-444 Amendment 1).
//
// The GeoJSON writer flattens each closed contour and snaps it to the export
// grid. A very thin contour can collapse there (its snapped points become
// collinear or fewer than three) while a contour nested inside it still snaps
// to a real polygon. Dropping only the collapsed ring would leave that inner
// ring without its container: a hole would be classed as an outer ring and
// paper would be written as ink, or an island would become a hole.
//
// Nesting is therefore decided on the unsnapped flattened contours, where the
// collapsed contour still encloses its children, and a collapsed contour is
// dropped together with every contour inside it (its holes, their islands,
// and so on). This is the no-orphan rule of ADR-458 Amendment 1: a ring is
// only ever dropped with its whole subtree. Everything in that subtree lies
// inside the collapsed contour, which is thinner than the grid, so the
// dropped region is thinner than the grid as well.

import type { Vec2 } from '../../core/scene';

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/**
 * Which contours to keep. `sources` are the unsnapped flattened contours (any
 * frame; a mirror does not change containment), `collapsed[i]` says contour i
 * collapsed on the grid. A contour is kept when it did not collapse and lies
 * inside no collapsed contour.
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
 * Whether `inner` lies inside `outer`, decided by the first vertex of `inner`
 * that is not on `outer`'s boundary. A contour lying wholly on the boundary is
 * a duplicate of the collapsed contour and collapses with it.
 */
function liesInside(inner: ReadonlyArray<Vec2>, outer: ReadonlyArray<Vec2>): boolean {
  for (const point of inner) {
    const side = windingSide(point, outer);
    if (side !== 'boundary') return side === 'inside';
  }
  return true;
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
