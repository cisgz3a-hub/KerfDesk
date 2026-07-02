// Distance-ordered homotopic thinning. Pixels are eroded lowest-distance
// first (a min-heap keyed on the exact squared distance field), so the
// surviving 1-px skeleton sits on the ridge of the distance field — the
// geometric centre of each stroke. That ordering is what kills the staircase
// wobble the old Zhang-Suen pass produced: plain two-phase thinning erodes
// asymmetrically on even-width strokes, DOHT cannot.
//
// Topology safety: a pixel is only removed when it is an (8,4) simple point
// (removal preserves both foreground 8-connectivity and background
// 4-connectivity, checked via an exact 256-entry lookup built by brute
// force), and never when it is an endpoint (1 neighbour) or isolated dot.

import type { InkMask } from './distance-field';

// Ring positions around a pixel, clockwise from top-left.
const RING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

// The 4-adjacent-to-centre ring indices (T, R, B, L).
const EDGE_RING_INDICES: ReadonlyArray<number> = [1, 3, 5, 7];

const SIMPLE_LUT = buildSimplePointLut();
const NEIGHBOR_COUNT_LUT = buildNeighborCountLut();

/** Thin an ink mask to a 1-px, 8-connected, topology-preserving skeleton
 *  centred on the distance-field ridge. Returns a new mask (1 = skeleton).
 *
 *  Two phases. Phase 1 anchors CENTERS OF MAXIMAL DISCS (distance-field
 *  local maxima): without anchors, homotopic thinning silently erodes every
 *  protrusion whose removal keeps topology — a whole branch off a ring
 *  vanishes (the ring-notch defect) and stroke tips retreat. Phase 2 re-runs
 *  WITHOUT anchors to reduce the 2-px ridge plateaus of even-width strokes
 *  down to 1 px; by then branches are thin, so their tips are protected by
 *  the endpoint rule and survive (minus at most a pixel, which tip extension
 *  recovers). */
export function thinToMedialAxis(mask: InkMask, distSq: Float64Array): Uint8Array {
  const { width, height, ink } = mask;
  const skeleton = new Uint8Array(ink);
  const anchors = maximalDiscAnchors(mask, distSq);
  thinPass(skeleton, width, height, distSq, anchors);
  thinPass(skeleton, width, height, distSq, null);
  return skeleton;
}

function thinPass(
  skeleton: Uint8Array,
  width: number,
  height: number,
  distSq: Float64Array,
  anchors: Uint8Array | null,
): void {
  const heap: number[] = [];
  for (let i = 0; i < skeleton.length; i += 1) {
    if ((skeleton[i] ?? 0) === 1) heapPush(heap, packEntry(skeleton, width, height, i), distSq);
  }
  while (heap.length > 0) {
    const index = unpackIndex(heapPop(heap, distSq));
    if (!isErodable(skeleton, width, height, index, anchors)) continue;
    skeleton[index] = 0;
    requeueNeighbours(skeleton, width, height, distSq, heap, index);
  }
}

function isErodable(
  skeleton: Uint8Array,
  width: number,
  height: number,
  index: number,
  anchors: Uint8Array | null,
): boolean {
  if ((skeleton[index] ?? 0) !== 1) return false;
  if (anchors !== null && (anchors[index] ?? 0) === 1) return false; // maximal disc centre
  const config = ringConfig(skeleton, width, height, index);
  if ((NEIGHBOR_COUNT_LUT[config] ?? 0) <= 1) return false; // endpoint / isolated dot
  return (SIMPLE_LUT[config] ?? 0) === 1;
}

// Removal may make neighbours simple — re-examine them.
function requeueNeighbours(
  skeleton: Uint8Array,
  width: number,
  height: number,
  distSq: Float64Array,
  heap: number[],
  index: number,
): void {
  const x = index % width;
  const y = (index - x) / width;
  for (const [dx, dy] of RING_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const ni = ny * width + nx;
    if ((skeleton[ni] ?? 0) === 1) {
      heapPush(heap, packEntry(skeleton, width, height, ni), distSq);
    }
  }
}

// Anchor = ink pixel whose squared distance is >= every 8-neighbour's (the
// centre of a maximal inscribed disc). Non-strict, so even-width ridge
// plateaus anchor as 2-px ribbons — phase 2 thins those.
function maximalDiscAnchors(mask: InkMask, distSq: Float64Array): Uint8Array {
  const { width, height, ink } = mask;
  const anchors = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i += 1) {
    if ((ink[i] ?? 0) !== 1) continue;
    if (isLocalDistanceMax(distSq, width, height, i)) anchors[i] = 1;
  }
  return anchors;
}

function isLocalDistanceMax(
  distSq: Float64Array,
  width: number,
  height: number,
  i: number,
): boolean {
  const own = distSq[i] ?? 0;
  const x = i % width;
  const y = (i - x) / width;
  for (const [dx, dy] of RING_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    const neighbor =
      nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : (distSq[ny * width + nx] ?? 0);
    if (neighbor > own) return false;
  }
  return true;
}

/** 8-bit neighbourhood configuration of the ring around `index`. */
export function ringConfig(grid: Uint8Array, width: number, height: number, index: number): number {
  const x = index % width;
  const y = (index - x) / width;
  let config = 0;
  for (let i = 0; i < RING_OFFSETS.length; i += 1) {
    const offset = RING_OFFSETS[i];
    if (offset === undefined) continue;
    const nx = x + offset[0];
    const ny = y + offset[1];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if ((grid[ny * width + nx] ?? 0) === 1) config |= 1 << i;
  }
  return config;
}

/** Number of set ring neighbours for a configuration. */
export function ringNeighborCount(config: number): number {
  return NEIGHBOR_COUNT_LUT[config] ?? 0;
}

// --- min-heap keyed on (distSq asc, fg-neighbours DESC, index asc) ---
//
// Entries pack (pixel index << 4) | (8 - fg-neighbour count at push time).
// Preferring MORE-neighboured pixels at equal distance is load-bearing: the
// 2-px ridge ribbon of an even-width stroke would otherwise erode tip-row
// first in index order and unzip the whole arm (tip pixels have ~3 neighbours
// so the endpoint guard never fires). Ribbon-side pixels have ~5 neighbours;
// eroding them first reduces the ribbon to 1 px width, after which the tip IS
// an endpoint and survives. Counts go stale as pixels erode, but staleness
// only affects order — every pop re-checks the live neighbourhood.

const ENTRY_TIE_BITS = 4;
const ENTRY_TIE_MASK = (1 << ENTRY_TIE_BITS) - 1;
const MAX_RING_NEIGHBORS = 8;

function packEntry(skeleton: Uint8Array, width: number, height: number, index: number): number {
  const count = ringNeighborCount(ringConfig(skeleton, width, height, index));
  return index * (1 << ENTRY_TIE_BITS) + (MAX_RING_NEIGHBORS - count);
}

function unpackIndex(entry: number): number {
  return Math.floor(entry / (1 << ENTRY_TIE_BITS));
}

function heapLess(a: number, b: number, distSq: Float64Array): boolean {
  const ia = unpackIndex(a);
  const ib = unpackIndex(b);
  const da = distSq[ia] ?? 0;
  const db = distSq[ib] ?? 0;
  if (da !== db) return da < db;
  const ta = a & ENTRY_TIE_MASK;
  const tb = b & ENTRY_TIE_MASK;
  if (ta !== tb) return ta < tb;
  return ia < ib;
}

function heapPush(heap: number[], value: number, distSq: Float64Array): void {
  heap.push(value);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    const pv = heap[parent] ?? 0;
    const cv = heap[child] ?? 0;
    if (!heapLess(cv, pv, distSq)) break;
    heap[parent] = cv;
    heap[child] = pv;
    child = parent;
  }
}

function heapPop(heap: number[], distSq: Float64Array): number {
  const top = heap[0] ?? 0;
  const last = heap.pop();
  if (heap.length === 0 || last === undefined) return top;
  heap[0] = last;
  siftDown(heap, distSq);
  return top;
}

function siftDown(heap: number[], distSq: Float64Array): void {
  let parent = 0;
  for (;;) {
    const smallest = smallestOfFamily(heap, distSq, parent);
    if (smallest === parent) return;
    const tmp = heap[parent] ?? 0;
    heap[parent] = heap[smallest] ?? 0;
    heap[smallest] = tmp;
    parent = smallest;
  }
}

function smallestOfFamily(heap: number[], distSq: Float64Array, parent: number): number {
  const left = parent * 2 + 1;
  const right = left + 1;
  let smallest = parent;
  if (left < heap.length && heapLess(heap[left] ?? 0, heap[smallest] ?? 0, distSq)) {
    smallest = left;
  }
  if (right < heap.length && heapLess(heap[right] ?? 0, heap[smallest] ?? 0, distSq)) {
    smallest = right;
  }
  return smallest;
}

// --- exact (8,4) simple-point lookup, built by brute force at module load ---

function buildSimplePointLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let config = 0; config < 256; config += 1) {
    lut[config] = isSimpleConfig(config) ? 1 : 0;
  }
  return lut;
}

function buildNeighborCountLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let config = 0; config < 256; config += 1) {
    let count = 0;
    for (let i = 0; i < 8; i += 1) if ((config & (1 << i)) !== 0) count += 1;
    lut[config] = count;
  }
  return lut;
}

// A centre pixel is (8,4)-simple iff the ring foreground forms exactly one
// 8-connected component AND the ring background 4-adjacent to the centre
// forms exactly one 4-connected component.
function isSimpleConfig(config: number): boolean {
  const fg: number[] = [];
  const bg: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    if ((config & (1 << i)) !== 0) fg.push(i);
    else bg.push(i);
  }
  if (fg.length === 0) return false; // isolated — never simple
  const fg8 = countComponents(fg, (a, b) => cellsAdjacent(a, b, 8));
  if (fg8 !== 1) return false;
  const bg4 = countComponents(bg, (a, b) => cellsAdjacent(a, b, 4));
  // Only background components touching a 4-neighbour of the centre matter.
  const touching = componentsTouchingEdges(bg, (a, b) => cellsAdjacent(a, b, 4));
  return bg4 >= 1 && touching === 1;
}

function cellsAdjacent(a: number, b: number, connectivity: 4 | 8): boolean {
  const oa = RING_OFFSETS[a];
  const ob = RING_OFFSETS[b];
  if (oa === undefined || ob === undefined) return false;
  const dx = Math.abs(oa[0] - ob[0]);
  const dy = Math.abs(oa[1] - ob[1]);
  if (dx === 0 && dy === 0) return false;
  if (connectivity === 8) return dx <= 1 && dy <= 1;
  return dx + dy === 1;
}

function countComponents(
  cells: ReadonlyArray<number>,
  adjacent: (a: number, b: number) => boolean,
): number {
  const seen = new Set<number>();
  let components = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    components += 1;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cell = queue.pop();
      if (cell === undefined) break;
      for (const other of cells) {
        if (!seen.has(other) && adjacent(cell, other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
  }
  return components;
}

// Count background components that include at least one edge (T/R/B/L) cell.
function componentsTouchingEdges(
  cells: ReadonlyArray<number>,
  adjacent: (a: number, b: number) => boolean,
): number {
  const seen = new Set<number>();
  let touching = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    const queue = [start];
    const component: number[] = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cell = queue.pop();
      if (cell === undefined) break;
      for (const other of cells) {
        if (!seen.has(other) && adjacent(cell, other)) {
          seen.add(other);
          component.push(other);
          queue.push(other);
        }
      }
    }
    if (component.some((cell) => EDGE_RING_INDICES.includes(cell))) touching += 1;
  }
  return touching;
}
