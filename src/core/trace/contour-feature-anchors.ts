import type { Vec2 } from '../scene';
import type { InkMask } from './centerline';

/** Retain the cap and mouth of a straight one-pixel ink stem or paper channel.
 *  Its terminal cell leads through a narrow run into a wider body. These pins
 *  protect connected detail from bend windows without pinning every stair
 *  corner or imposing a cusp on the final curve. */
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
    const inkLength = terminalStemLength(
      mask,
      Math.floor(midX + rightX / 2),
      Math.floor(midY + rightY / 2),
      rightX,
      rightY,
    );
    const paperLength = terminalStemLength(
      mask,
      Math.floor(midX - rightX / 2),
      Math.floor(midY - rightY / 2),
      -rightX,
      -rightY,
    );
    retainStem(anchors, dense, i, inkLength);
    retainStem(anchors, dense, i, paperLength);
  }
  return anchors;
}

function retainStem(
  anchors: Set<Vec2>,
  dense: ReadonlyArray<Vec2>,
  i: number,
  length: number,
): void {
  if (length === 0) return;
  // A retained cap alone can become the start of a replacement wedge that
  // erases the mouth. Each straight side has one crack per stem cell; the
  // next sample past that side lies on the surrounding body's boundary.
  const n = dense.length;
  const offset = length + 1;
  for (const index of [i, (i + n - offset) % n, (i + offset) % n]) {
    const point = dense[index];
    if (point !== undefined) anchors.add(point);
  }
}

function terminalStemLength(mask: InkMask, x: number, y: number, dx: number, dy: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  const polarity = inkAt(mask, x, y);
  if (sameNeighbours(mask, x, y, polarity) !== 1) return 0;
  for (let length = 1; ; length += 1) {
    x += dx;
    y += dy;
    if (inkAt(mask, x, y) !== polarity) return 0;
    const neighbours = sameNeighbours(mask, x, y, polarity);
    if (neighbours >= 3) return length;
    // A turn or the other end of an isolated line has no wider mouth along
    // this straight run. Leave its ordinary cap to the curve finisher.
    if (neighbours !== 2) return 0;
  }
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
