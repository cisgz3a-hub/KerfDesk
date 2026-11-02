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

export type DrawnCluster = {
  /** Drawing indexes of the members, ascending. */
  readonly indexes: ReadonlyArray<number>;
  readonly box: AABB;
};

type GappedCluster = { readonly position: number; readonly cluster: DrawnCluster };
type DrawnBox = { readonly index: number; readonly box: AABB };

/**
 * For each cluster, the drawing indexes between its first and last member whose
 * box overlaps the cluster's, ascending. Clusters and the artwork in some
 * cluster's gaps meet in one sweep on x, not one scan of every gap per cluster,
 * so plates drawn apart from their windows stay near linear (R5-P3-1).
 */
export function drawnOverClusters(
  clusters: ReadonlyArray<DrawnCluster>,
  count: number,
  boxAt: (index: number) => AABB | null,
): number[][] {
  const found: number[][] = clusters.map(() => []);
  const gapped: GappedCluster[] = clusters.flatMap((cluster, position) =>
    cluster.indexes.some((index, i) => i > 0 && index - (cluster.indexes[i - 1] as number) > 1)
      ? [{ position, cluster }]
      : [],
  );
  if (gapped.length === 0) return found;
  gapped.sort((a, b) => a.cluster.box.minX - b.cluster.box.minX);
  const drawn = artworkInGaps(gapped, count, boxAt);
  const record = ({ position, cluster }: GappedCluster, { index, box }: DrawnBox): void => {
    if (cluster.box.minY > box.maxY || cluster.box.maxY < box.minY) return;
    if (index > (cluster.indexes[0] as number) && index < (cluster.indexes.at(-1) as number)) {
      (found[position] as number[]).push(index);
    }
  };
  // Each overlapping pair is met once: by whichever box starts first (the
  // cluster on a tie), which reaches the other within its own width.
  sweepStartsWithin(
    gapped,
    drawn,
    (at) => at.cluster.box,
    (item) => item.box,
    false,
    record,
  );
  sweepStartsWithin(
    drawn,
    gapped,
    (item) => item.box,
    (at) => at.cluster.box,
    true,
    (item, at) => record(at, item),
  );
  for (const list of found) list.sort((a, b) => a - b);
  return found;
}

// For each reacher, every target whose box starts inside the reacher's width.
// Both lists are in minX order; `skipTies` leaves out targets starting level.
function sweepStartsWithin<R, T>(
  reachers: ReadonlyArray<R>,
  targets: ReadonlyArray<T>,
  reacherBox: (reacher: R) => AABB,
  targetBox: (target: T) => AABB,
  skipTies: boolean,
  meet: (reacher: R, target: T) => void,
): void {
  let from = 0;
  for (const reacher of reachers) {
    const { minX, maxX } = reacherBox(reacher);
    while (from < targets.length) {
      const start = targetBox(targets[from] as T).minX;
      if (skipTies ? start > minX : start >= minX) break;
      from += 1;
    }
    for (let at = from; at < targets.length; at += 1) {
      const target = targets[at] as T;
      if (targetBox(target).minX > maxX) break;
      meet(reacher, target);
    }
  }
}

function artworkInGaps(
  clusters: ReadonlyArray<GappedCluster>,
  count: number,
  boxAt: (index: number) => AABB | null,
): DrawnBox[] {
  const opened = new Int32Array(count + 1);
  for (const { cluster } of clusters) {
    cluster.indexes.forEach((index, i) => {
      if (i === 0) return;
      (opened[(cluster.indexes[i - 1] as number) + 1] as number) += 1;
      (opened[index] as number) -= 1;
    });
  }
  const drawn: DrawnBox[] = [];
  let open = 0;
  for (let index = 0; index < count; index += 1) {
    open += opened[index] as number;
    const box = open > 0 ? boxAt(index) : null;
    if (box !== null) drawn.push({ index, box });
  }
  return drawn.sort((a, b) => a.box.minX - b.box.minX);
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
