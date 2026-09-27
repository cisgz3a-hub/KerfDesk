// Finishing moves kept out of excluded stock (ADR-482). A masked raster's
// samples clear the excluded blocks where they stand (the dilation proves
// that), but near the mask the tip a cutter needs rises along a curve as the
// ball rolls over a block's edge, so the straight move between two samples can
// dip into it. Each move is checked exactly against every block within reach
// (MaskStock.moveExcess); where it dips in, the lowest point is inserted at
// the blocks' requirement and both halves are checked again. A move still
// failing after the last split is crossed at the highest requirement along it:
// up, across and down. Points are only ever added or raised.

import type { FinishingPoint } from './relief-finishing-path';
import type { MaskStock } from './relief-mask-stock';

const MAX_SPLITS = 12;

export function stockCheckedPath(
  points: ReadonlyArray<FinishingPoint>,
  stock: MaskStock,
): ReadonlyArray<FinishingPoint> {
  const first = points[0];
  if (first === undefined) return points;
  const out: FinishingPoint[] = [first];
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index];
    if (to !== undefined) appendCheckedMove(out, out[out.length - 1] ?? to, to, stock, 0);
  }
  return out;
}

function appendCheckedMove(
  out: FinishingPoint[],
  from: FinishingPoint,
  to: FinishingPoint,
  stock: MaskStock,
  splits: number,
): void {
  const excess = stock.moveExcess(from, to);
  if (excess === null) {
    out.push(to);
    return;
  }
  if (splits >= MAX_SPLITS) {
    // Both ends clear the blocks, so the moves straight up and down cannot
    // enter them, and nothing along the move requires more than `top`.
    const top = Math.max(from.z, to.z, excess.highest);
    if (top > from.z) out.push({ x: from.x, y: from.y, z: top });
    if (top > to.z) out.push({ x: to.x, y: to.y, z: top });
    out.push(to);
    return;
  }
  appendCheckedMove(out, from, excess.point, stock, splits + 1);
  appendCheckedMove(out, excess.point, to, stock, splits + 1);
}
