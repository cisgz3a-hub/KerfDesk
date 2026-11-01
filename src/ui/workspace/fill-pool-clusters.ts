// Members of one Fill pool linked by overlapping boxes (ADR-683): only they can
// change one another's parity. A sweep on x keeps a large array of
// side-by-side parts near linear. When every box overlaps (thousands of
// stacked circles) every pair is still visited, so that step is one compare
// of group labels, and groups merge smaller into larger (rolling audit v8
// N6-P3-3: a quarter of the union-find it replaced).

import type { AABB } from '../../core/scene';

/** Positions in `boxes` grouped by overlap: each group ascending, groups by first position. */
export function overlappingGroups(boxes: ReadonlyArray<AABB>): number[][] {
  const count = boxes.length;
  const order = boxes
    .map((_, position) => position)
    .sort((a, b) => (boxes[a] as AABB).minX - (boxes[b] as AABB).minX);
  // Sweep slots: the boxes in x order, as flat arrays the inner loop reads.
  const minX = new Float64Array(count);
  const maxX = new Float64Array(count);
  const minY = new Float64Array(count);
  const maxY = new Float64Array(count);
  const label = new Int32Array(count);
  const groups: number[][] = [];
  order.forEach((position, slot) => {
    const box = boxes[position] as AABB;
    minX[slot] = box.minX;
    maxX[slot] = box.maxX;
    minY[slot] = box.minY;
    maxY[slot] = box.maxY;
    label[slot] = slot;
    groups.push([slot]);
  });
  for (let a = 0; a < count; a += 1) {
    const right = maxX[a] as number;
    const bottom = minY[a] as number;
    const top = maxY[a] as number;
    for (let b = a + 1; b < count && (minX[b] as number) <= right; b += 1) {
      if (label[b] !== label[a] && (minY[b] as number) <= top && (maxY[b] as number) >= bottom) {
        merge(label, groups, label[a] as number, label[b] as number);
      }
    }
  }
  return groups
    .filter((group) => group.length > 0)
    .map((group) => group.map((slot) => order[slot] as number).sort((x, y) => x - y))
    .sort((x, y) => (x[0] as number) - (y[0] as number));
}

function merge(label: Int32Array, groups: number[][], a: number, b: number): void {
  const groupA = groups[a] as number[];
  const groupB = groups[b] as number[];
  const [keep, kept, gone] =
    groupA.length >= groupB.length ? [a, groupA, groupB] : [b, groupB, groupA];
  for (const slot of gone) {
    label[slot] = keep;
    kept.push(slot);
  }
  gone.length = 0;
}
