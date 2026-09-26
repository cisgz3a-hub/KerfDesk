import type { ContourBox } from './contour-bounds';
import type { TraceSteps } from './trace-steps';

/** Box query over one boundary's edges: every edge whose box meets the
 *  query box, inclusive of touching boundaries, in no particular order. */
export type ContourEdgeQuery<T extends ContourBox> = {
  readonly query: (box: ContourBox) => T[];
};

// Edges of one traced boundary are short and follow the curve, so a split
// into horizontal bands, each sorted by left edge, finds a box's neighbours
// with one binary search per band: a closed curve crosses any band a few
// times, and a long horizontal run is a sorted run. It builds in O(n log n)
// with flat arrays and no tree of per-node objects.
const EDGES_PER_BAND = 4;
const MAX_BANDS = 1 << 14;
const CHECKPOINT_EDGES = 64;
const SEARCH_SLACK = 1e-12;
// Bands this short sort in place by insertion.
const INSERTION_SORT_MAX = 16;

type Layout = { readonly minY: number; readonly bandHeight: number; readonly bands: number };

// Below this many edges a plain scan answers a query faster than the bands
// can be built, and most traced loops are this small.
const SCAN_MAX_EDGES = 32;

/** Build the band index over finite edge boxes within `bounds`. */
export function* contourEdgeBandsSteps<T extends ContourBox>(
  edges: ReadonlyArray<T>,
  bounds: ContourBox,
): TraceSteps<ContourEdgeQuery<T>> {
  const cooperate = yield;
  if (edges.length <= SCAN_MAX_EDGES) return new EdgeScan(edges);
  const layout = bandLayout(edges, bounds);
  const bands = layout.bands;
  const start = new Int32Array(bands + 1);
  for (let e = 0; e < edges.length; e += 1) {
    if (cooperate && e % CHECKPOINT_EDGES === 0) yield;
    const edge = edges[e] as T;
    const high = bandOf(edge.maxY, layout);
    for (let k = bandOf(edge.minY, layout); k <= high; k += 1) {
      start[k + 1] = (start[k + 1] as number) + 1;
    }
  }
  for (let k = 0; k < bands; k += 1) start[k + 1] = (start[k + 1] as number) + (start[k] as number);
  const slots = new Int32Array(start[bands] as number);
  const next = start.slice(0, bands);
  for (let e = 0; e < edges.length; e += 1) {
    const edge = edges[e] as T;
    const high = bandOf(edge.maxY, layout);
    for (let k = bandOf(edge.minY, layout); k <= high; k += 1) {
      const slot = next[k] as number;
      next[k] = slot + 1;
      slots[slot] = e;
    }
  }
  const lefts = new Float64Array(edges.length);
  for (let e = 0; e < edges.length; e += 1) lefts[e] = (edges[e] as T).minX;
  const widest = new Float64Array(bands);
  for (let k = 0; k < bands; k += 1) {
    if (cooperate) yield;
    sortBand(slots, start[k] as number, start[k + 1] as number, lefts);
    widest[k] = bandWidth(slots, start[k] as number, start[k + 1] as number, edges);
  }
  return new EdgeBands(edges, layout, start, slots, widest);
}

// About EDGES_PER_BAND edges per band, but never bands much thinner than a
// typical edge is tall: an edge filed in many thin bands only costs copies.
function bandLayout(edges: ReadonlyArray<ContourBox>, bounds: ContourBox): Layout {
  const span = bounds.maxY - bounds.minY;
  if (!(span > 0) || edges.length === 0) return { minY: bounds.minY, bandHeight: 1, bands: 1 };
  let rise = 0;
  for (const edge of edges) rise += edge.maxY - edge.minY;
  const byCount = Math.ceil(edges.length / EDGES_PER_BAND);
  const byHeight = Math.floor(span / Math.max(Number.MIN_VALUE, (rise / edges.length) * 2));
  const bands = Math.max(1, Math.min(MAX_BANDS, byCount, byHeight));
  return { minY: bounds.minY, bandHeight: span / bands, bands };
}

function bandOf(y: number, layout: Layout): number {
  const band = Math.floor((y - layout.minY) / layout.bandHeight);
  return band < 0 ? 0 : band >= layout.bands ? layout.bands - 1 : band;
}

// Order a band's slots by left edge. Slots are filled in edge order, so a
// stable sort also breaks ties by edge order. Bands are short and arrive
// nearly sorted along the curve (a long horizontal run is one monotone run),
// so a bottom-up merge over the natural runs costs a single pass in the
// usual case and O(k log k) at worst, with no comparator calls.
function sortBand(slots: Int32Array, from: number, to: number, lefts: Float64Array): void {
  if (to - from < 2) return;
  if (to - from <= INSERTION_SORT_MAX) {
    insertionSort(slots, from, to, lefts);
    return;
  }
  let run = slots.slice(from, to);
  if (isDescending(run, lefts)) run.reverse();
  let spare = new Int32Array(run.length);
  for (let width = 1; width < run.length; width *= 2) {
    if (isSorted(run, lefts)) break;
    for (let low = 0; low < run.length; low += 2 * width) {
      mergeRuns(
        run,
        spare,
        lefts,
        low,
        Math.min(low + width, run.length),
        Math.min(low + 2 * width, run.length),
      );
    }
    [run, spare] = [spare, run];
  }
  slots.set(run, from);
}

// Stable, in place and allocation-free: the same order the merge produces.
function insertionSort(slots: Int32Array, from: number, to: number, lefts: Float64Array): void {
  for (let k = from + 1; k < to; k += 1) {
    const slot = slots[k] as number;
    const left = lefts[slot] as number;
    let at = k;
    while (at > from && (lefts[slots[at - 1] as number] as number) > left) {
      slots[at] = slots[at - 1] as number;
      at -= 1;
    }
    slots[at] = slot;
  }
}

function isSorted(run: Int32Array, lefts: Float64Array): boolean {
  for (let k = 1; k < run.length; k += 1) {
    if ((lefts[run[k - 1] as number] as number) > (lefts[run[k] as number] as number)) return false;
  }
  return true;
}

// Strictly descending only: reversing equal keys would break edge-order ties.
function isDescending(run: Int32Array, lefts: Float64Array): boolean {
  for (let k = 1; k < run.length; k += 1) {
    if ((lefts[run[k - 1] as number] as number) <= (lefts[run[k] as number] as number))
      return false;
  }
  return true;
}

function mergeRuns(
  source: Int32Array,
  target: Int32Array,
  lefts: Float64Array,
  low: number,
  middle: number,
  high: number,
): void {
  let a = low;
  let b = middle;
  for (let out = low; out < high; out += 1) {
    const takeLeft =
      b >= high ||
      (a < middle &&
        (lefts[source[a] as number] as number) <= (lefts[source[b] as number] as number));
    target[out] = takeLeft ? (source[a++] as number) : (source[b++] as number);
  }
}

function bandWidth<T extends ContourBox>(
  slots: Int32Array,
  from: number,
  to: number,
  edges: ReadonlyArray<T>,
): number {
  let widest = 0;
  for (let s = from; s < to; s += 1) {
    const edge = edges[slots[s] as number] as T;
    widest = Math.max(widest, edge.maxX - edge.minX);
  }
  return widest;
}

class EdgeScan<T extends ContourBox> implements ContourEdgeQuery<T> {
  constructor(private readonly edges: ReadonlyArray<T>) {}

  query(box: ContourBox): T[] {
    const result: T[] = [];
    for (const edge of this.edges) {
      if (edge.maxX >= box.minX && box.maxX >= edge.minX && edge.maxY >= box.minY) {
        if (box.maxY >= edge.minY) result.push(edge);
      }
    }
    return result;
  }
}

class EdgeBands<T extends ContourBox> implements ContourEdgeQuery<T> {
  // Allocated on the first query: most boundaries are queried rarely.
  private seen: Int32Array | null = null;
  private stamp = 0;

  constructor(
    private readonly edges: ReadonlyArray<T>,
    private readonly layout: Layout,
    private readonly start: Int32Array,
    private readonly slots: Int32Array,
    private readonly widest: Float64Array,
  ) {}

  query(box: ContourBox): T[] {
    const result: T[] = [];
    const { minX, minY, maxX, maxY } = box;
    const seen = (this.seen ??= new Int32Array(this.edges.length));
    const stamp = this.nextStamp(seen);
    const last = bandOf(maxY, this.layout);
    for (let k = bandOf(minY, this.layout); k <= last; k += 1) {
      const to = this.start[k + 1] as number;
      // Widths were rounded when measured; start a hair early so an edge
      // whose right end exactly touches the box is never skipped.
      const width = this.widest[k] as number;
      let s = this.firstReaching(k, minX - width - (width + Math.abs(minX)) * SEARCH_SLACK);
      for (; s < to; s += 1) {
        const e = this.slots[s] as number;
        const edge = this.edges[e] as T;
        if (edge.minX > maxX) break;
        if (seen[e] === stamp) continue;
        if (edge.maxX >= minX && edge.maxY >= minY && maxY >= edge.minY) {
          seen[e] = stamp;
          result.push(edge);
        }
      }
    }
    return result;
  }

  // First slot of band k whose edge starts at or right of `x`.
  private firstReaching(k: number, x: number): number {
    let low = this.start[k] as number;
    let high = this.start[k + 1] as number;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.edges[this.slots[middle] as number] as T).minX < x) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private nextStamp(seen: Int32Array): number {
    if (this.stamp === 0x7fffffff) {
      seen.fill(0);
      this.stamp = 0;
    }
    this.stamp += 1;
    return this.stamp;
  }
}
