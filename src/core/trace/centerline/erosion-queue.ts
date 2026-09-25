// The thinning erosion order: (squared distance, neighbour tie, pixel index)
// ascending. Entries arrive packed as index × 16 + tie. When every distance
// is a non-negative integer — the exact squared distances the field
// provides — the order is served by buckets, one per (distance, tie) key,
// each popping its pixels in index order; a small heap orders the non-empty
// keys. Nearly every entry lands in a bucket that is not being drained yet,
// so it is appended and sorted once, instead of costing a sift through one
// heap of every pending entry. Pops return exactly the comparator heap's
// sequence: the least key, then the least index within it.

const TIE_SCALE = 16;

export type ErosionQueue = {
  readonly push: (entry: number) => void;
  readonly pop: () => number;
  readonly size: () => number;
};

/** A bucket queue over `distSq`, or null when a distance is not a small
 *  non-negative integer (the caller keeps its comparator heap then). */
export function bucketErosionQueue(distSq: Float64Array): ErosionQueue | null {
  const limit = Math.floor(Number.MAX_SAFE_INTEGER / TIE_SCALE) - TIE_SCALE;
  for (const d of distSq) if (!(Number.isInteger(d) && d >= 0 && d <= limit)) return null;
  const buckets = new Map<number, Bucket>();
  const keys = new MinHeap();
  let size = 0;
  return {
    push: (entry) => {
      const index = Math.floor(entry / TIE_SCALE);
      const key = (distSq[index] as number) * TIE_SCALE + (entry - index * TIE_SCALE);
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = new Bucket();
        buckets.set(key, bucket);
      }
      bucket.add(index);
      if (!bucket.queued) {
        bucket.queued = true;
        keys.push(key);
      }
      size += 1;
    },
    pop: () => {
      for (;;) {
        const key = keys.peek();
        const bucket = buckets.get(key) as Bucket;
        if (bucket.size() === 0) {
          keys.pop();
          bucket.queued = false;
          continue;
        }
        size -= 1;
        const tie = key % TIE_SCALE;
        return bucket.take() * TIE_SCALE + tie;
      }
    },
    size: () => size,
  };
}

// One key's pixels: a sorted run consumed by a cursor, pixels appended since
// the run was last sorted, and a heap for stragglers that arrive while the
// run is being drained (merging those into the run each time would cost the
// whole remaining run per pop).
class Bucket {
  queued = false;
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
