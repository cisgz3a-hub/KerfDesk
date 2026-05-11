/**
 * T1-156: pure scanline-geometry helpers extracted from FillGenerator.
 * Pre-T1-156 these four pure functions + two interfaces lived inside
 * the 593-line FillGenerator.ts file. The fill generator's
 * cache/orchestration logic stays put; only the underlying
 * scanline-rasterizer primitives move:
 *
 *   - Edge / ScanlineEdge: line-segment representations used by the
 *     scanline AET (active edge table).
 *   - `extractEdges(paths)`: turn FlatPath coords into edge list,
 *     wrapping the last point back to the first (closing edge).
 *   - `findIntersections(edges, y)`: classic horizontal-ray-vs-edge
 *     intersection test. Skips horizontal edges (no crossing), uses
 *     strict-inequality-on-one-end to avoid double-counting vertices.
 *   - `buildScanlineEdgeBuckets(edges, startY, interval, rowCount)`:
 *     bucketed AET — every edge gets enter/leave rows so the
 *     scanline loop adds/removes from the active set rather than
 *     re-checking every edge per row. Skips edges entirely outside
 *     the row range.
 *   - `findActiveIntersections(activeEdges, y)`: intersection test
 *     over the active edge subset (the AET-managed version of
 *     findIntersections).
 *   - `rotatePoint(x, y, angle)`: rotate a point by `angle` radians
 *     around the origin. Used to align fill scanlines with the
 *     layer's fill-angle setting.
 *
 * No behavioral change — the rasterizer's edge-counting, vertex-
 * tie-breaking, and AET bucketing rules are byte-identical.
 */
import type { Point } from '../types';
import type { FlatPath } from '../job/Job';

export interface Edge {
  x1: number; y1: number;
  x2: number; y2: number;
}

export interface ScanlineEdge extends Edge {
  enterRow: number;
  leaveRow: number;
}

/**
 * Flatten the coords-array representation of each FlatPath into a
 * list of edges, wrapping the last point back to the first (closing
 * edge). Paths with fewer than 2 points are skipped.
 */
export function extractEdges(paths: FlatPath[]): Edge[] {
  const edges: Edge[] = [];

  for (const path of paths) {
    const n = path.coords.length / 2;
    if (n < 2) continue;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n; // Wraps to first point for closing edge
      edges.push({
        x1: path.coords[i * 2],
        y1: path.coords[i * 2 + 1],
        x2: path.coords[j * 2],
        y2: path.coords[j * 2 + 1],
      });
    }
  }

  return edges;
}

/**
 * Find all X coordinates where a horizontal ray at height `y`
 * crosses `edges`. Standard line-segment intersection:
 *   - Horizontal edges (y1 === y2) are skipped — they contribute no
 *     crossings.
 *   - Strict inequality at one end (`y >= yMax`) avoids
 *     double-counting vertices at edge joints.
 *
 * Returns X values in edge order (NOT sorted).
 */
export function findIntersections(edges: Edge[], y: number): number[] {
  const intersections: number[] = [];

  for (const edge of edges) {
    const { y1, y2 } = edge;

    if (y1 === y2) continue;

    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);

    if (y < yMin || y >= yMax) continue;

    const t = (y - y1) / (y2 - y1);
    const x = edge.x1 + t * (edge.x2 - edge.x1);
    intersections.push(x);
  }

  return intersections;
}

/**
 * Bucket edges by entry/exit row for the scanline active-edge table.
 * Returns parallel arrays of length `rowCount` listing the edges
 * to add and remove at each row. Edges entirely outside the row
 * range (top/bottom) are excluded.
 */
export function buildScanlineEdgeBuckets(
  edges: Edge[],
  startY: number,
  interval: number,
  rowCount: number,
): { addAt: ScanlineEdge[][]; removeAt: ScanlineEdge[][] } {
  const addAt = Array.from({ length: rowCount }, () => [] as ScanlineEdge[]);
  const removeAt = Array.from({ length: rowCount }, () => [] as ScanlineEdge[]);
  if (rowCount <= 0 || interval <= 0) {
    return { addAt, removeAt };
  }

  for (const edge of edges) {
    if (edge.y1 === edge.y2) continue;

    const yMin = Math.min(edge.y1, edge.y2);
    const yMax = Math.max(edge.y1, edge.y2);
    const enterRow = Math.max(0, Math.ceil((yMin - startY) / interval));
    const leaveRow = Math.min(rowCount, Math.ceil((yMax - startY) / interval));

    if (enterRow >= leaveRow || leaveRow <= 0 || enterRow >= rowCount) continue;

    const scanlineEdge: ScanlineEdge = { ...edge, enterRow, leaveRow };
    addAt[enterRow].push(scanlineEdge);
    if (leaveRow < rowCount) {
      removeAt[leaveRow].push(scanlineEdge);
    }
  }

  return { addAt, removeAt };
}

/**
 * Intersection test over the active subset of edges (the
 * AET-managed version of `findIntersections`). Returns X values in
 * active-edges order (NOT sorted).
 */
export function findActiveIntersections(
  activeEdges: readonly ScanlineEdge[],
  y: number,
): number[] {
  const intersections: number[] = [];

  for (const edge of activeEdges) {
    if (y < Math.min(edge.y1, edge.y2) || y >= Math.max(edge.y1, edge.y2)) continue;
    const t = (y - edge.y1) / (edge.y2 - edge.y1);
    intersections.push(edge.x1 + t * (edge.x2 - edge.x1));
  }

  return intersections;
}

/**
 * Rotate `(x, y)` by `angleRad` radians around the origin. Used to
 * align fill scanlines with a layer's fill-angle setting before
 * intersection tests; the inverse rotation runs after to put the
 * generated scanlines back into world coordinates.
 */
export function rotatePoint(x: number, y: number, angleRad: number): Point {
  return {
    x: x * Math.cos(angleRad) - y * Math.sin(angleRad),
    y: x * Math.sin(angleRad) + y * Math.cos(angleRad),
  };
}
