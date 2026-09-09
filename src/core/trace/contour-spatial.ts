import { ContourBoxIndex } from './contour-box-index';
import { boxesOverlap, contourBox, finiteContourBox, type ContourBox } from './contour-bounds';
import type { TraceSteps } from './trace-steps';

export { contourBox, type ContourBox } from './contour-bounds';
const CHECKPOINT_PAIRS = 256;

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
  if (!boxes.every(finiteContourBox)) {
    yield* visitSweepPairsSteps(sorted, low, high, visit);
    return;
  }
  const entries = sorted.map((box, order) => ({
    minX: box.minX,
    minY: box.minY,
    maxX: box.maxX,
    maxY: box.maxY,
    order,
    box,
  }));
  const index = yield* ContourBoxIndex.createSteps(entries);
  let pairs = 0;
  for (const a of entries) {
    if (cooperate) yield;
    const candidates = index.query(a).filter((b) => b.order > a.order);
    candidates.sort((a, b) => a.order - b.order);
    for (const b of candidates) {
      pairs += 1;
      if (cooperate && pairs % CHECKPOINT_PAIRS === 0) yield;
      visit(a.box, b.box);
    }
  }
}

function* visitSweepPairsSteps<T extends ContourBox>(
  sorted: ReadonlyArray<T>,
  low: 'minX' | 'minY',
  high: 'maxX' | 'maxY',
  visit: (a: T, b: T) => void,
): TraceSteps<void> {
  const cooperate = yield;
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
