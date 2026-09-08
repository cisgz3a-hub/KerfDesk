import type { Vec2 } from '../scene';
import type { TraceSteps } from './trace-steps';

export type ContourBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
const CHECKPOINT_PAIRS = 256;

/** Bounds for a nonempty contour or segment. */
export function contourBox(points: ReadonlyArray<Vec2>): ContourBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Visit every overlapping pair, with inclusive bounds so contacts are retained. */
export function* visitContourBoxPairsSteps<T extends ContourBox>(
  boxes: ReadonlyArray<T>,
  visit: (a: T, b: T) => void,
): TraceSteps<void> {
  const cooperate = yield;
  const extent = contourBox(
    boxes.flatMap((b) => [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ]),
  );
  const horizontal = extent.maxX - extent.minX >= extent.maxY - extent.minY;
  const low = horizontal ? 'minX' : 'minY';
  const high = horizontal ? 'maxX' : 'maxY';
  const sorted = [...boxes].sort((a, b) => a[low] - b[low]);
  let pairs = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (cooperate) yield;
    const a = sorted[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b === undefined || b[low] > a[high]) break;
      pairs += 1;
      if (cooperate && pairs % CHECKPOINT_PAIRS === 0) yield;
      if (boxesOverlap(a, b)) visit(a, b);
    }
  }
}

function boxesOverlap(a: ContourBox, b: ContourBox): boolean {
  return a.maxX >= b.minX && b.maxX >= a.minX && a.maxY >= b.minY && b.maxY >= a.minY;
}
