import type { Vec2 } from '../scene';
import type { InkMask } from './centerline';

/** Retain the cap and mouth of a one-pixel ink tooth or paper notch. The cap
 *  is opposite the cell's only same-polarity neighbour, which belongs to a
 *  wider body. These pins protect connected detail from bend windows without
 *  pinning every stair corner or imposing a cusp on the final curve. */
export function contourFeatureAnchors(
  staircase: ReadonlyArray<Vec2>,
  dense: ReadonlyArray<Vec2>,
  mask: InkMask,
): ReadonlySet<Vec2> {
  const anchors = new Set<Vec2>();
  for (let i = 0; i < staircase.length; i += 1) {
    const a = staircase[i] as Vec2;
    const b = staircase[(i + 1) % staircase.length] as Vec2;
    const point = dense[i];
    if (point === undefined) continue;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const rightX = -(b.y - a.y);
    const rightY = b.x - a.x;
    if (
      isTerminalCap(
        mask,
        Math.floor(midX + rightX / 2),
        Math.floor(midY + rightY / 2),
        rightX,
        rightY,
      ) ||
      isTerminalCap(
        mask,
        Math.floor(midX - rightX / 2),
        Math.floor(midY - rightY / 2),
        -rightX,
        -rightY,
      )
    ) {
      anchors.add(point);
      // A retained cap alone can become the start of a replacement wedge,
      // which erases the step back to the surrounding body. Retain the two
      // samples just beyond the cell's side walls to keep that step too.
      const n = staircase.length;
      const before = dense[(i + n - 2) % n];
      const after = dense[(i + 2) % n];
      if (before !== undefined) anchors.add(before);
      if (after !== undefined) anchors.add(after);
    }
  }
  return anchors;
}

function isTerminalCap(mask: InkMask, x: number, y: number, dx: number, dy: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const polarity = inkAt(mask, x, y);
  if (inkAt(mask, x + dx, y + dy) !== polarity) return false;
  // An isolated thin stroke also has terminal cells, but its round cap is
  // not a one-cell step off a body. Leave those ordinary stroke ends to the
  // existing curve finisher.
  return (
    sameNeighbours(mask, x, y, polarity) === 1 &&
    sameNeighbours(mask, x + dx, y + dy, polarity) >= 3
  );
}

function sameNeighbours(mask: InkMask, x: number, y: number, polarity: number): number {
  let neighbours = 0;
  if (inkAt(mask, x - 1, y) === polarity) neighbours += 1;
  if (inkAt(mask, x + 1, y) === polarity) neighbours += 1;
  if (inkAt(mask, x, y - 1) === polarity) neighbours += 1;
  if (inkAt(mask, x, y + 1) === polarity) neighbours += 1;
  return neighbours;
}

function inkAt(mask: InkMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.ink[y * mask.width + x] ?? 0;
}
