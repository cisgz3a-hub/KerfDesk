// Uniform spatial hash over polyline segments, shared by the chain-assembly
// stages whose naive form scans EVERY segment of EVERY chain per query
// (weld foot-finding, ridge-walk arrival). Each segment is bucketed into
// every grid cell its bounding box touches; a radius query returns the
// segments in the cells the query disc overlaps.
//
// This is a search accelerator ONLY: it returns a SUPERSET of the segments
// within `reach` of a point (never fewer), so callers re-test the exact
// distance and keep their own selection order / tie-breaking. It never
// changes which segment wins — only how few are examined. Callers that need
// deterministic ordering sort the returned owner ids themselves.

import type { Vec2 } from '../../scene';

/** A segment tagged with the caller's owner index (usually a chain index)
 *  and its position within that owner, so callers can reconstruct their
 *  original iteration order for tie-breaking. */
export type GridSegment = {
  readonly ownerId: number;
  readonly segIndex: number;
  readonly a: Vec2;
  readonly b: Vec2;
};

const MIN_CELL_SIZE_PX = 1;

export class SegmentGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<string, GridSegment[]>();

  /** `reach` is the largest query radius the grid will be asked for; the
   *  cell size is set to it so a query disc spans at most a 2×2 cell block. */
  constructor(reach: number) {
    this.cellSize = Math.max(MIN_CELL_SIZE_PX, reach);
  }

  insert(seg: GridSegment): void {
    const minCx = this.cellIndex(Math.min(seg.a.x, seg.b.x));
    const maxCx = this.cellIndex(Math.max(seg.a.x, seg.b.x));
    const minCy = this.cellIndex(Math.min(seg.a.y, seg.b.y));
    const maxCy = this.cellIndex(Math.max(seg.a.y, seg.b.y));
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const key = this.key(cx, cy);
        const bucket = this.cells.get(key);
        if (bucket === undefined) this.cells.set(key, [seg]);
        else bucket.push(seg);
      }
    }
  }

  /** Every segment whose bounding-box cells overlap the disc of `radius`
   *  around `p`. A superset of the truly-within-`radius` segments; may
   *  return a segment more than once when it spans several cells, so callers
   *  that must not double-count de-duplicate by (ownerId, segIndex). */
  query(p: Vec2, radius: number): GridSegment[] {
    const minCx = this.cellIndex(p.x - radius);
    const maxCx = this.cellIndex(p.x + radius);
    const minCy = this.cellIndex(p.y - radius);
    const maxCy = this.cellIndex(p.y + radius);
    const out: GridSegment[] = [];
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket !== undefined) out.push(...bucket);
      }
    }
    return out;
  }

  private cellIndex(coord: number): number {
    return Math.floor(coord / this.cellSize);
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }
}
