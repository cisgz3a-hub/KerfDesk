import { curveSubpathBounds } from '../../core/scene/curve-path';
import type { Bounds, PathSegment } from '../../core/scene/scene-object';
import type { GridCommand } from './vector-artwork';

/** Exact extent of the quantized lines/cubics a page writer actually paints. */
export function paintedPathBounds(paths: ReadonlyArray<ReadonlyArray<GridCommand>>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const commands of paths) {
    const first = commands[0];
    if (first?.op !== 'move') continue;
    const segments: PathSegment[] = [];
    for (const command of commands) {
      if (command.op === 'line') segments.push({ kind: 'line', to: command.p });
      else if (command.op === 'cubic') {
        segments.push({
          kind: 'cubic',
          control1: command.c1,
          control2: command.c2,
          to: command.p,
        });
      }
    }
    if (segments.length === 0) continue;
    // Closing lines cannot extend beyond their endpoints' bounds.
    const path = curveSubpathBounds({ start: first.p, segments, closed: false });
    bounds =
      bounds === null
        ? path
        : {
            minX: Math.min(bounds.minX, path.minX),
            minY: Math.min(bounds.minY, path.minY),
            maxX: Math.max(bounds.maxX, path.maxX),
            maxY: Math.max(bounds.maxY, path.maxY),
          };
  }
  return bounds;
}
