// Label-map cleanup for the colour-layer trace (ADR-402). Own design. After
// every pixel takes its nearest palette colour:
//   1. 1-px-wide mixtures between two other palette colours (anti-aliasing
//      along their seam) are given back to the nearer of the two;
//   2. isolated pixels take their neighbourhood's mode;
//   3. regions below the speck area join the neighbour they share the most
//      boundary with.
//
// Pure core: deterministic, no clock, no random, no I/O. Mutates `labels`.

import { isMixtureOf, projectOnto, type Centre } from './colour-palette';

/** Label of a transparent (untraced) pixel. */
export const TRANSPARENT_LABEL = 255;

type LabelGrid = {
  readonly labels: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** A 1-px-wide run of an in-between colour along the seam of two other
 *  colours is their anti-aliasing, not a region: give each such pixel to the
 *  nearer of the two neighbours (the sub-pixel boundary stage still reads its
 *  exact colour). Reads the original labels so the pass is order-free. */
export function giveMixturesToNeighbours(
  grid: LabelGrid,
  lab: Float32Array,
  weights: Float32Array,
  centres: ReadonlyArray<Centre>,
): void {
  const source: LabelGrid = { ...grid, labels: grid.labels.slice() };
  const between = betweenTable(centres);
  const seen: number[] = [];
  for (let i = 0; i < source.labels.length; i += 1) {
    const m = source.labels[i] as number;
    if (m === TRANSPARENT_LABEL || (weights[i] as number) >= 1) continue;
    otherNeighbourLabels(source, i, seen);
    if (seen.length < 2) continue;
    const pick = mixtureOwner(i, m, seen, lab, centres, between);
    if (pick >= 0) grid.labels[i] = pick;
  }
}

// The distinct opaque labels other than pixel i's own in its 8-neighbourhood.
function otherNeighbourLabels(grid: LabelGrid, i: number, out: number[]): void {
  out.length = 0;
  const own = grid.labels[i] as number;
  forEachNeighbour8(grid, i, (l) => {
    if (l !== own && l !== TRANSPARENT_LABEL && !out.includes(l)) out.push(l);
  });
}

function forEachNeighbour8(grid: LabelGrid, i: number, visit: (label: number) => void): void {
  const x = i % grid.width;
  const y = (i - x) / grid.width;
  const x0 = Math.max(0, x - 1);
  const x1 = Math.min(grid.width - 1, x + 1);
  const y0 = Math.max(0, y - 1);
  const y1 = Math.min(grid.height - 1, y + 1);
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      if (xx !== x || yy !== y) visit(grid.labels[yy * grid.width + xx] as number);
    }
  }
}

// between[(m * k + a) * k + b] === 1 when colour m is a mixture of a and b.
function betweenTable(centres: ReadonlyArray<Centre>): Uint8Array {
  const k = centres.length;
  const table = new Uint8Array(k * k * k);
  for (let m = 0; m < k; m += 1) {
    for (let a = 0; a < k; a += 1) {
      for (let b = 0; b < k; b += 1) {
        if (a === b || a === m || b === m) continue;
        if (isMixtureOf(centres[m] as Centre, centres[a] as Centre, centres[b] as Centre)) {
          table[(m * k + a) * k + b] = 1;
        }
      }
    }
  }
  return table;
}

function mixtureOwner(
  i: number,
  m: number,
  seen: ReadonlyArray<number>,
  lab: Float32Array,
  centres: ReadonlyArray<Centre>,
  between: Uint8Array,
): number {
  const k = centres.length;
  const pixel: Centre = {
    L: lab[i * 3] as number,
    a: lab[i * 3 + 1] as number,
    b: lab[i * 3 + 2] as number,
    w: 0,
  };
  let owner = -1;
  let bestResidual = Number.POSITIVE_INFINITY;
  for (let p = 0; p < seen.length; p += 1) {
    for (let q = p + 1; q < seen.length; q += 1) {
      const a = seen[p] as number;
      const b = seen[q] as number;
      if (between[(m * k + a) * k + b] !== 1) continue;
      const projection = projectOnto(pixel, centres[a] as Centre, centres[b] as Centre);
      if (projection.residual < bestResidual) {
        bestResidual = projection.residual;
        owner = projection.t < 0.5 ? a : b;
      }
    }
  }
  return owner;
}

/** Mode filter for 1-px islands: a pixel none of whose 4-neighbours shares
 *  its label takes the most common label of its 8-neighbourhood (ties to the
 *  lower label). Reads the original labels so the pass is order-free. */
export function modeFilterIsolatedPixels(grid: LabelGrid): void {
  const source: LabelGrid = { ...grid, labels: grid.labels.slice() };
  const counts = new Int32Array(256);
  const n = source.labels.length;
  for (let i = 0; i < n; i += 1) {
    const m = source.labels[i] as number;
    if (m === TRANSPARENT_LABEL || sharesLabel4(source, i, m)) continue;
    const mode = neighbourhoodMode(source, i, counts);
    if (mode >= 0) grid.labels[i] = mode;
  }
}

function sharesLabel4(grid: LabelGrid, i: number, label: number): boolean {
  const n = grid.labels.length;
  for (let d = 0; d < 4; d += 1) {
    const q = neighbour4(i, d, grid.width, n);
    if (q >= 0 && grid.labels[q] === label) return true;
  }
  return false;
}

function neighbourhoodMode(grid: LabelGrid, i: number, counts: Int32Array): number {
  const touched: number[] = [];
  forEachNeighbour8(grid, i, (l) => {
    if (counts[l] === 0) touched.push(l);
    counts[l] = (counts[l] as number) + 1;
  });
  let best = -1;
  let bestCount = 0;
  for (const l of touched) {
    const c = counts[l] as number;
    if (c > bestCount || (c === bestCount && l < best)) {
      bestCount = c;
      best = l;
    }
    counts[l] = 0;
  }
  return best;
}

/** Regions (4-connected, one label) smaller than minArea join the neighbour
 *  label they share the most boundary with (ties to the lower label).
 *  Transparent regions stay. The smallest regions go first, and a region that
 *  joins another is re-measured as the merged whole (union-find), so two
 *  touching specks are judged together and neither is left behind as an
 *  orphaned speck when the other moves on. */
export function absorbSmallRegions(grid: LabelGrid, minArea: number): void {
  if (!(minArea > 1)) return;
  const regions = labelRegions(grid, minArea);
  const { size, members } = regions;
  const queue = members.flatMap((pixels, id) => (pixels === null ? [] : [id]));
  queue.sort((a, b) => (size[a] as number) - (size[b] as number) || a - b);
  const shared = new Int32Array(256);
  // A worklist: an array iterator also visits the roots pushed below.
  for (const queued of queue) {
    const r = regions.find(queued);
    const own = members[r];
    if (own === null || own === undefined || (size[r] as number) >= minArea) continue;
    const label = grid.labels[own[0] as number] as number;
    if (label === TRANSPARENT_LABEL) continue;
    const best = mostSharedNeighbour(grid, own, label, shared);
    if (best < 0) continue;
    for (const p of own) grid.labels[p] = best;
    const root = unionWithNeighbours(grid, regions, r, best);
    if ((size[root] as number) < minArea) queue.push(root);
  }
}

// Keep the invariant "4-adjacent regions never share a label": after region r
// took `label`, union it with every neighbouring region carrying that label.
function unionWithNeighbours(grid: LabelGrid, regions: Regions, r: number, label: number): number {
  const n = grid.labels.length;
  let root = r;
  for (const p of regions.members[r] ?? []) {
    for (let d = 0; d < 4; d += 1) {
      const q = neighbour4(p, d, grid.width, n);
      if (q < 0 || grid.labels[q] !== label) continue;
      const other = regions.find(regions.component[q] as number);
      if (other !== root) root = regions.union(root, other);
    }
  }
  return root;
}

type Regions = {
  /** Region id of every pixel (4-connected, one label). */
  readonly component: Int32Array;
  readonly size: number[];
  /** Pixels of a region below the speck area; null for a large region. */
  readonly members: Array<number[] | null>;
  readonly find: (id: number) => number;
  /** Merge two roots; returns the surviving root. */
  readonly union: (a: number, b: number) => number;
};

function labelRegions(grid: LabelGrid, minArea: number): Regions {
  const n = grid.labels.length;
  const component = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const parent: number[] = [];
  const size: number[] = [];
  const members: Array<number[] | null> = [];
  for (let start = 0; start < n; start += 1) {
    if (component[start] !== -1) continue;
    const pixels = floodComponent(grid, start, parent.length, component, stack);
    parent.push(parent.length);
    size.push(pixels.length);
    members.push(pixels.length < minArea ? pixels : null);
  }
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root] as number;
    for (let c = id; c !== root; ) {
      const next = parent[c] as number;
      parent[c] = root;
      c = next;
    }
    return root;
  };
  const union = (a: number, b: number): number => {
    const keep = (size[a] as number) >= (size[b] as number) ? a : b;
    const gone = keep === a ? b : a;
    parent[gone] = keep;
    size[keep] = (size[keep] as number) + (size[gone] as number);
    const kept = members[keep] ?? null;
    const moved = members[gone] ?? null;
    members[keep] = kept === null || moved === null ? null : kept.concat(moved);
    members[gone] = null;
    return keep;
  };
  return { component, size, members, find, union };
}

function floodComponent(
  grid: LabelGrid,
  start: number,
  id: number,
  component: Int32Array,
  stack: Int32Array,
): number[] {
  const n = grid.labels.length;
  const label = grid.labels[start];
  const members: number[] = [];
  let top = 0;
  stack[top++] = start;
  component[start] = id;
  while (top > 0) {
    const p = stack[--top] as number;
    members.push(p);
    for (let d = 0; d < 4; d += 1) {
      const q = neighbour4(p, d, grid.width, n);
      if (q < 0 || component[q] !== -1 || grid.labels[q] !== label) continue;
      component[q] = id;
      stack[top++] = q;
    }
  }
  return members;
}

function mostSharedNeighbour(
  grid: LabelGrid,
  members: ReadonlyArray<number>,
  label: number,
  shared: Int32Array,
): number {
  const n = grid.labels.length;
  const touched: number[] = [];
  for (const p of members) {
    for (let d = 0; d < 4; d += 1) {
      const q = neighbour4(p, d, grid.width, n);
      const l = q < 0 ? label : (grid.labels[q] as number);
      if (l === label) continue;
      if (shared[l] === 0) touched.push(l);
      shared[l] = (shared[l] as number) + 1;
    }
  }
  let best = -1;
  let bestShared = 0;
  for (const l of touched) {
    const s = shared[l] as number;
    if (s > bestShared || (s === bestShared && l < best)) {
      bestShared = s;
      best = l;
    }
    shared[l] = 0;
  }
  return best;
}

/** The d-th 4-neighbour (W, E, N, S) of pixel p, or -1 outside the image. */
export function neighbour4(p: number, d: number, width: number, n: number): number {
  if (d === 0) return p % width > 0 ? p - 1 : -1;
  if (d === 1) return p % width < width - 1 ? p + 1 : -1;
  if (d === 2) return p >= width ? p - width : -1;
  return p + width < n ? p + width : -1;
}
