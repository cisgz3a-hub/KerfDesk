// Pieces that touch at a narrow neck, such as two coasters laid side by side,
// are cut apart (ADR-442 Amendment 2). Every piece pixel's distance to the
// nearest bed pixel is measured exactly (Felzenszwalb and Huttenlocher's
// two-pass transform), and the pixels are flooded from the deepest down. Two
// flooded regions that meet stay apart when each rises well above the level
// where they meet, the watershed's dynamics test; then the line where they
// meet is cut from the mask. A straight-sided union, such as two equal
// squares pushed flush together, has no neck and is not cut: its size flags
// it instead (piece-doubts.ts). Pure core.

// A region must rise this far above where it meets a deeper one to stay apart, mm.
const PROMINENCE_MM = 3;
// And reach at least this far from the bed: half the width of the narrowest piece cut free, mm.
const MIN_DEPTH_MM = 5;
// Depths are bucketed this finely for the flood order, px.
const DEPTH_STEP_PX = 0.25;

/**
 * Distance from each pixel to the nearest pixel that is visible and off,
 * pixels; 0 on such pixels. Pixels the camera did not see are not bed.
 */
export function distanceToBed(
  on: Uint8Array,
  visible: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const far = 1e20;
  const squared = new Float64Array(width * height);
  for (let i = 0; i < squared.length; i += 1) {
    squared[i] = visible[i] === 1 && on[i] !== 1 ? 0 : far;
  }
  const line = new Float64Array(Math.max(width, height));
  const out = new Float64Array(Math.max(width, height));
  for (let x = 0; x < width; x += 1) transformLine(squared, x, width, height, line, out);
  for (let y = 0; y < height; y += 1) transformLine(squared, y * width, 1, width, line, out);
  const distance = new Float32Array(squared.length);
  for (let i = 0; i < distance.length; i += 1) distance[i] = Math.sqrt(squared[i] ?? 0);
  return distance;
}

// One pass of the squared-distance transform along a row or column, in place.
function transformLine(
  values: Float64Array,
  start: number,
  step: number,
  length: number,
  f: Float64Array,
  d: Float64Array,
): void {
  for (let i = 0; i < length; i += 1) f[i] = values[start + i * step] ?? 0;
  const v = new Int32Array(length);
  const z = new Float64Array(length + 1);
  let k = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < length; q += 1) {
    let s = intersection(f, q, v[k] ?? 0);
    while (k > 0 && s <= (z[k] ?? 0)) {
      k -= 1;
      s = intersection(f, q, v[k] ?? 0);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while ((z[k + 1] ?? Infinity) < q) k += 1;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
  for (let i = 0; i < length; i += 1) values[start + i * step] = d[i] ?? 0;
}

function intersection(f: Float64Array, q: number, p: number): number {
  return ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
}

/**
 * Cuts `on` in place along the lines where pieces meet at a neck. `depth`
 * is {@link distanceToBed} of `on`. Returns how many cuts were made.
 */
export function cutAtNecks(
  on: Uint8Array,
  depth: Float32Array,
  width: number,
  pixelsPerMm: number,
): number {
  const order = deepestFirst(on, depth);
  const parent = new Int32Array(on.length).fill(-1);
  const peak = new Float32Array(on.length);
  const prominence = PROMINENCE_MM * pixelsPerMm;
  const minDepth = MIN_DEPTH_MM * pixelsPerMm;
  const height = on.length / width;
  const near = new Int32Array(4);
  const roots = new Int32Array(4);
  for (const p of order) {
    const level = depth[p] ?? 0;
    const count = rootsAround(p, width, height, parent, near, roots);
    if (count === 0) {
      parent[p] = p;
      peak[p] = level;
      continue;
    }
    let main = roots[0] ?? p;
    for (let k = 1; k < count; k += 1) {
      const root = roots[k] ?? p;
      if ((peak[root] ?? 0) > (peak[main] ?? 0)) main = root;
    }
    parent[p] = main;
    for (let k = 0; k < count; k += 1) {
      const root = roots[k] ?? p;
      if (root === main) continue;
      const rise = (peak[root] ?? 0) - level;
      if (rise < prominence || (peak[root] ?? 0) < minDepth) parent[root] = main;
    }
  }
  return cutBetweenBasins(on, parent, width, height);
}

// The distinct flooded regions next to pixel p, written into `roots`; returns how many.
function rootsAround(
  p: number,
  width: number,
  height: number,
  parent: Int32Array,
  near: Int32Array,
  roots: Int32Array,
): number {
  let count = 0;
  const found = neighboursInto(p, width, height, near);
  for (let k = 0; k < found; k += 1) {
    const q = near[k] ?? 0;
    if (parent[q] === -1) continue;
    const root = find(parent, q);
    let seen = false;
    for (let m = 0; m < count; m += 1) seen = seen || roots[m] === root;
    if (!seen) roots[count++] = root;
  }
  return count;
}

// Piece pixels, deepest first: a counting sort on the bucketed depth.
function deepestFirst(on: Uint8Array, depth: Float32Array): Int32Array {
  const bucketOf = (i: number): number => Math.round((depth[i] ?? 0) / DEPTH_STEP_PX);
  let top = 0;
  let total = 0;
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] !== 1) continue;
    top = Math.max(top, bucketOf(i));
    total += 1;
  }
  const starts = new Int32Array(top + 2);
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] === 1) starts[top - bucketOf(i) + 1] = (starts[top - bucketOf(i) + 1] ?? 0) + 1;
  }
  for (let k = 1; k < starts.length; k += 1) starts[k] = (starts[k] ?? 0) + (starts[k - 1] ?? 0);
  const order = new Int32Array(total);
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] !== 1) continue;
    const bucket = top - bucketOf(i);
    order[starts[bucket] ?? 0] = i;
    starts[bucket] = (starts[bucket] ?? 0) + 1;
  }
  return order;
}

// Clears every piece pixel next to one of a lower-numbered basin, so no two
// basins stay 4-connected.
function cutBetweenBasins(
  on: Uint8Array,
  parent: Int32Array,
  width: number,
  height: number,
): number {
  const basin = new Int32Array(on.length).fill(-1);
  for (let i = 0; i < on.length; i += 1) if (on[i] === 1) basin[i] = find(parent, i);
  let cut = 0;
  const near = new Int32Array(4);
  for (let i = 0; i < on.length; i += 1) {
    const own = basin[i] ?? -1;
    if (own === -1) continue;
    const found = neighboursInto(i, width, height, near);
    for (let k = 0; k < found; k += 1) {
      const other = basin[near[k] ?? 0] ?? -1;
      if (other === -1 || other >= own) continue;
      on[i] = 0;
      cut += 1;
      break;
    }
  }
  return cut;
}

// The 4-neighbours of pixel i inside the picture, written into `out`; returns how many.
function neighboursInto(i: number, width: number, height: number, out: Int32Array): number {
  const x = i % width;
  let n = 0;
  if (x > 0) out[n++] = i - 1;
  if (x < width - 1) out[n++] = i + 1;
  if (i >= width) out[n++] = i - width;
  if (i < (height - 1) * width) out[n++] = i + width;
  return n;
}

function find(parent: Int32Array, i: number): number {
  let root = i;
  while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
  let node = i;
  while (node !== root) {
    const next = parent[node] ?? root;
    parent[node] = root;
    node = next;
  }
  return root;
}
