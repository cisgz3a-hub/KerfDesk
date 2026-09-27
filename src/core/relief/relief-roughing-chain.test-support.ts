// Test support for ADR-424's linked roughing: a chain is one pass that cuts
// several loops, each closed at its own start and joined to the next by a
// straight link at depth.

import type { CncPass } from '../job';
import type { Vec2 } from '../scene';

/** The loops of one chain, each from its start back to that start. A tail
 * that never returns to its start is left out, so a caller comparing the
 * loops' total length with the chain's sees it. */
export function chainLoops(points: ReadonlyArray<Vec2>): ReadonlyArray<ReadonlyArray<Vec2>> {
  const loops: Array<ReadonlyArray<Vec2>> = [];
  let start = 0;
  while (start < points.length - 1) {
    const first = points[start];
    if (first === undefined) break;
    let end = -1;
    for (let index = start + 1; index < points.length; index += 1) {
      const point = points[index];
      if (point !== undefined && point.x === first.x && point.y === first.y) {
        end = index;
        break;
      }
    }
    if (end < 0) break;
    loops.push(points.slice(start, end + 1));
    start = end + 1;
  }
  return loops;
}

/** Every loop the roughing passes cut at depth, with its level. */
export function roughingLoops(
  passes: ReadonlyArray<CncPass>,
): ReadonlyArray<{ readonly zMm: number; readonly points: ReadonlyArray<Vec2> }> {
  return passes.flatMap((pass) =>
    pass.kind === 'contour'
      ? chainLoops(pass.polyline).map((points) => ({ zMm: pass.zMm, points }))
      : [],
  );
}
