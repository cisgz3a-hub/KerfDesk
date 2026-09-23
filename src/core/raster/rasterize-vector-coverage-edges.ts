import type { Vec2 } from '../scene';

type Edge = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly minY: number;
  readonly maxY: number;
};

export type CoverageEdges = {
  readonly pending: ReadonlyArray<Edge>;
  readonly active: Edge[];
  next: number;
};

/** Index each edge once. Only the edges crossing the current subrow are
 * revisited, instead of scanning every vertex of a dense photograph.
 */
export function prepareCoverageEdges(
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  epsilon: number,
): CoverageEdges {
  const pending: Edge[] = [];
  for (const points of contours) {
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      if (Number.isNaN(a.y) || Number.isNaN(b.y) || Math.abs(b.y - a.y) < epsilon) continue;
      pending.push({ a, b, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
    }
  }
  pending.sort((a, b) => a.minY - b.minY);
  return { pending, active: [], next: 0 };
}

/** Calls must advance in ascending scanline order. Half-open edge intervals
 * and interpolation from original endpoints match the binary fill sweep.
 */
export function coverageCrossingsAtY(
  edges: CoverageEdges,
  y: number,
): Array<{ readonly x: number; readonly delta: number }> {
  for (; edges.next < edges.pending.length; edges.next += 1) {
    const edge = edges.pending[edges.next];
    if (edge === undefined || edge.minY > y) break;
    if (edge.maxY > y) edges.active.push(edge);
  }
  const crossings: Array<{ readonly x: number; readonly delta: number }> = [];
  let kept = 0;
  for (const edge of edges.active) {
    if (y >= edge.maxY) continue;
    edges.active[kept++] = edge;
    const dy = edge.b.y - edge.a.y;
    const x = edge.a.x + ((y - edge.a.y) / dy) * (edge.b.x - edge.a.x);
    if (Number.isFinite(x)) crossings.push({ x, delta: dy > 0 ? 1 : -1 });
  }
  edges.active.length = kept;
  return crossings;
}
