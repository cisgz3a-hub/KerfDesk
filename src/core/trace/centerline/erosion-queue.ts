// The thinning erosion order: (squared distance, neighbour tie, pixel index)
// ascending. Entries arrive packed as index × 16 + tie. When every distance
// is a non-negative integer — the exact squared distances the field
// provides — the order is served by buckets, one per (distance, tie) key,
// each popping its pixels in index order. Keys are direct-addressed: each
// distinct distance gets a dense rank, the key is rank × 16 + tie, and a
// cursor that only rewinds on a push below it finds the least non-empty key.
// Pops return exactly the comparator heap's sequence: the least key, then
// the least index within it.
//
// An entry pushed while an identical entry (same pixel, same tie) is still
// pending is dropped (ADR-438 amendment, speed wave 2). The two would pop
// back to back; the thinning loop erodes the pixel on the first pop or not
// at all, and in both cases the second pop is a no-op (an eroded pixel never
// returns, and an unchanged neighbourhood gives the same refusal), so the
// erosion sequence is unchanged.

const TIE_SCALE = 16;
// Largest distance served by a dense distance → rank table (32 MiB of
// Int32Array); larger fields rank by binary search over the distinct values.
const DENSE_RANK_LIMIT = 1 << 23;

/** Pops follow the ascending (distance, tie, index) order. An implementation
 *  may drop a push that exactly repeats an entry still pending (the bucket
 *  queue does; the comparator heap does not), so callers must not rely on
 *  size() or on the number of pops, only on the order of distinct entries. */
export type ErosionQueue = {
  readonly push: (entry: number) => void;
  readonly pop: () => number;
  readonly size: () => number;
};

/** Dense ranks of the distinct distances of one field; build them once and
 *  share them between the queues of both thinning passes. */
export type DistanceRanks = {
  readonly count: number;
  readonly rankOf: (distance: number) => number;
};

/** A bucket queue over `distSq`, or null when a distance is not a small
 *  non-negative integer (the caller keeps its comparator heap then).
 *  `pending` is the per-pixel pending-tie bitmask (2 bytes per pixel); a
 *  caller running queues one after another may share one, because a queue
 *  drained to empty leaves it all zero again. */
export function bucketErosionQueue(
  distSq: Float64Array,
  ranks: DistanceRanks | null = distanceRanks(distSq),
  pending: Uint16Array = new Uint16Array(distSq.length),
): ErosionQueue | null {
  if (ranks === null) return null;
  const { rankOf } = ranks;
  const groups = new Array<Array<Bucket | undefined> | undefined>(ranks.count);
  let cursor = 0;
  let size = 0;
  const bucketAt = (rank: number, tie: number): Bucket => {
    let group = groups[rank];
    if (group === undefined) {
      group = new Array<Bucket | undefined>(TIE_SCALE);
      groups[rank] = group;
    }
    let bucket = group[tie];
    if (bucket === undefined) {
      bucket = new Bucket();
      group[tie] = bucket;
    }
    return bucket;
  };
  return {
    push: (entry) => {
      const index = Math.floor(entry / TIE_SCALE);
      const tie = entry - index * TIE_SCALE;
      const bit = 1 << tie;
      if (((pending[index] as number) & bit) !== 0) return;
      pending[index] = (pending[index] as number) | bit;
      const rank = rankOf(distSq[index] as number);
      bucketAt(rank, tie).add(index);
      const key = rank * TIE_SCALE + tie;
      if (key < cursor) cursor = key;
      size += 1;
    },
    pop: () => {
      for (;;) {
        const tie = cursor % TIE_SCALE;
        const bucket = groups[(cursor - tie) / TIE_SCALE]?.[tie];
        if (bucket === undefined || bucket.size() === 0) {
          cursor += 1;
          continue;
        }
        size -= 1;
        const index = bucket.take();
        pending[index] = (pending[index] as number) & ~(1 << tie);
        return index * TIE_SCALE + tie;
      }
    },
    size: () => size,
  };
}

/** Dense ranks of the distinct distances in the field, or null when one is
 *  not a small non-negative integer. */
export function distanceRanks(distSq: Float64Array): DistanceRanks | null {
  const limit = Math.floor(Number.MAX_SAFE_INTEGER / TIE_SCALE) - TIE_SCALE;
  let max = 0;
  for (const d of distSq) {
    if (!(Number.isInteger(d) && d >= 0 && d <= limit)) return null;
    if (d > max) max = d;
  }
  if (max < DENSE_RANK_LIMIT) {
    const table = new Int32Array(max + 1);
    for (const d of distSq) table[d] = 1;
    let count = 0;
    for (let d = 0; d <= max; d += 1) {
      const present = table[d] as number;
      table[d] = count;
      count += present;
    }
    return { count, rankOf: (distance) => table[distance] as number };
  }
  const distinct = Float64Array.from(new Set(distSq)).sort();
  return { count: distinct.length, rankOf: (distance) => lowerBound(distinct, distance) };
}

function lowerBound(sorted: Float64Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as number) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

// One key's pixels: a sorted run consumed by a cursor, pixels appended since
// the run was last sorted, and a heap for stragglers that arrive while the
// run is being drained (merging those into the run each time would cost the
// whole remaining run per pop).
class Bucket {
  private run: Int32Array = new Int32Array(0);
  private cursor = 0;
  private readonly added: number[] = [];
  private readonly late = new MinHeap();

  size(): number {
    return this.run.length - this.cursor + this.added.length + this.late.size;
  }

  add(index: number): void {
    this.added.push(index);
  }

  take(): number {
    if (this.added.length > 0) this.absorb();
    const fromRun = this.cursor < this.run.length ? (this.run[this.cursor] as number) : Infinity;
    if (this.late.size > 0 && this.late.peek() < fromRun) return this.late.pop();
    this.cursor += 1;
    return fromRun;
  }

  private absorb(): void {
    const remaining = this.run.length - this.cursor;
    if (this.added.length * 4 < remaining) {
      for (const index of this.added) this.late.push(index);
    } else {
      const merged = new Int32Array(remaining + this.added.length);
      merged.set(this.run.subarray(this.cursor));
      merged.set(this.added, remaining);
      if (!ascending(merged)) merged.sort();
      this.run = merged;
      this.cursor = 0;
    }
    this.added.length = 0;
  }
}

function ascending(values: Int32Array): boolean {
  for (let k = 1; k < values.length; k += 1) {
    if ((values[k - 1] as number) > (values[k] as number)) return false;
  }
  return true;
}

// Binary min-heap of numbers.
class MinHeap {
  private items: number[] = [];
  size = 0;

  peek(): number {
    return this.items[0] as number;
  }

  push(value: number): void {
    const items = this.items;
    let child = this.size;
    this.size += 1;
    items[child] = value;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const above = items[parent] as number;
      if (above <= value) break;
      items[child] = above;
      child = parent;
    }
    items[child] = value;
  }

  pop(): number {
    const items = this.items;
    const top = items[0] as number;
    this.size -= 1;
    const last = items[this.size] as number;
    items.length = this.size;
    if (this.size === 0) return top;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      if (left >= this.size) break;
      const right = left + 1;
      const child =
        right < this.size && (items[right] as number) < (items[left] as number) ? right : left;
      if ((items[child] as number) >= last) break;
      items[parent] = items[child] as number;
      parent = child;
    }
    items[parent] = last;
    return top;
  }
}
