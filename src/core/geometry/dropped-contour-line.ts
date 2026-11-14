// How much of a closed contour's line a derived outline left behind (ADR-486
// Amendment 5, tools audit T1 T35-P2-1, T35R-P2-1 and T35R-P2-2).
//
// Kerf Offset reads closed contours by the even-odd rule, then offsets them.
// A stretch where the contour runs back over itself (a "P" whose closing line
// runs down its own stem, a stick with a loop at its end) has no inside, and a
// stretch whose two sides lie closer than the kerf has none left once it
// shrinks. Either way that stretch has no offset line near it, so it is not
// cut, while the rest of the contour is. Amendment 4's no-area test reads whole
// contours only, so it could not see this.
//
// The check walks each source contour in short steps and asks whether some
// line of the result lies within `reachMm` of each step. Runs of steps with no
// line near them, at least `minRunMm` long, are what was dropped. The length is
// then counted once where the contour runs back over itself, so a 25 mm stem
// the closing line retraces reads as 25 mm of line, not 50 mm of contour.

import type { Vec2 } from '../scene';

export type DroppedLineOptions = {
  /** How far from a source point a result line may lie and still cut it. */
  readonly reachMm: number;
  /** The shortest dropped run of the contour that counts. */
  readonly minRunMm: number;
};

type Segment = { readonly a: Vec2; readonly b: Vec2 };
type Sample = { readonly point: Vec2; readonly weight: number; readonly dropped: boolean };

/**
 * For each closed `sources` ring, the length of its line (millimetres, counted
 * once where it runs back over itself) that no `result` ring passes near. A
 * ring the result left behind entirely reads 0: other checks name those.
 */
export function partlyDroppedLineMm(
  sources: ReadonlyArray<ReadonlyArray<Vec2>>,
  result: ReadonlyArray<ReadonlyArray<Vec2>>,
  options: DroppedLineOptions,
): ReadonlyArray<number> {
  const { reachMm, minRunMm } = options;
  if (!(reachMm > 0) || !(minRunMm > 0)) return sources.map(() => 0);
  const step = Math.min(Math.max(minRunMm / 10, 0.005), 0.25);
  const grid = new SegmentGrid(Math.max(2 * reachMm, 0.5));
  for (const ring of result) grid.addRing(ring);
  return sources.map((ring) => {
    const samples = sampleRing(ring, step, (point) => !grid.within(point, reachMm));
    return countedOnce(droppedRuns(samples, minRunMm), reachMm + step);
  });
}

// Midpoints of equal steps along each edge, the closing edge included.
function sampleRing(
  ring: ReadonlyArray<Vec2>,
  step: number,
  isDropped: (point: Vec2) => boolean,
): Sample[] {
  const samples: Sample[] = [];
  for (const [index, a] of ring.entries()) {
    const b = ring[(index + 1) % ring.length] as Vec2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > 0)) continue;
    const count = Math.ceil(length / step);
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) / count;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      samples.push({ point, weight: length / count, dropped: isDropped(point) });
    }
  }
  return samples;
}

// Runs of dropped samples, in ring order, at least `minRunMm` long. None when
// nothing or everything was dropped.
function droppedRuns(samples: ReadonlyArray<Sample>, minRunMm: number): Sample[][] {
  const kept = samples.findIndex((sample) => !sample.dropped);
  if (kept < 0) return [];
  const runs: Sample[][] = [];
  let run: Sample[] = [];
  for (let offset = 1; offset <= samples.length; offset += 1) {
    const sample = samples[(kept + offset) % samples.length] as Sample;
    if (sample.dropped) {
      run.push(sample);
      continue;
    }
    if (run.length > 0) runs.push(run);
    run = [];
  }
  return runs.filter((each) => each.reduce((sum, sample) => sum + sample.weight, 0) >= minRunMm);
}

// A sample within `radius` of one already counted, from another run or from
// further along its own run, lies on a stretch the contour retraces.
function countedOnce(runs: ReadonlyArray<ReadonlyArray<Sample>>, radius: number): number {
  const counted = new PointGrid(radius);
  let total = 0;
  for (const [runIndex, run] of runs.entries()) {
    let along = 0;
    for (const sample of run) {
      if (!counted.near(sample.point, runIndex, along, radius)) {
        counted.add(sample.point, runIndex, along);
        total += sample.weight;
      }
      along += sample.weight;
    }
  }
  return total;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

// Result segments bucketed by the cells their points pass through, sampled
// every half cell. A segment within `reach` of a query point (reach at most
// half a cell) has a sample less than one cell away, so the 3 × 3 cells round
// the query find it.
class SegmentGrid {
  private readonly cells = new Map<string, Segment[]>();
  constructor(private readonly cell: number) {}

  addRing(ring: ReadonlyArray<Vec2>): void {
    for (const [index, a] of ring.entries()) {
      const b = ring[(index + 1) % ring.length] as Vec2;
      const segment = { a, b };
      const count = Math.max(1, Math.ceil((2 * Math.hypot(b.x - a.x, b.y - a.y)) / this.cell));
      let last = '';
      for (let k = 0; k <= count; k += 1) {
        const t = k / count;
        const key = cellKey(
          Math.floor((a.x + (b.x - a.x) * t) / this.cell),
          Math.floor((a.y + (b.y - a.y) * t) / this.cell),
        );
        if (key === last) continue;
        last = key;
        const bucket = this.cells.get(key);
        if (bucket === undefined) this.cells.set(key, [segment]);
        else if (bucket[bucket.length - 1] !== segment) bucket.push(segment);
      }
    }
  }

  within(point: Vec2, reach: number): boolean {
    const cx = Math.floor(point.x / this.cell);
    const cy = Math.floor(point.y / this.cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
        if (bucket?.some((segment) => distanceToSegment(point, segment) <= reach)) return true;
      }
    }
    return false;
  }
}

type CountedPoint = { readonly point: Vec2; readonly run: number; readonly along: number };

class PointGrid {
  private readonly cells = new Map<string, CountedPoint[]>();
  constructor(private readonly cell: number) {}

  add(point: Vec2, run: number, along: number): void {
    const key = cellKey(Math.floor(point.x / this.cell), Math.floor(point.y / this.cell));
    const bucket = this.cells.get(key);
    const entry = { point, run, along };
    if (bucket === undefined) this.cells.set(key, [entry]);
    else bucket.push(entry);
  }

  near(point: Vec2, run: number, along: number, radius: number): boolean {
    const cx = Math.floor(point.x / this.cell);
    const cy = Math.floor(point.y / this.cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
        const hit = bucket?.some(
          (entry) =>
            Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= radius &&
            (entry.run !== run || along - entry.along > 3 * radius),
        );
        if (hit === true) return true;
      }
    }
    return false;
  }
}

function distanceToSegment(point: Vec2, { a, b }: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
      : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
