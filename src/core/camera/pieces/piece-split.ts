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
  const { v, z } = lowerEnvelope(f, length);
  let k = 0;
  for (let q = 0; q < length; q += 1) {
    while ((z[k + 1] ?? Infinity) < q) k += 1;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
  for (let i = 0; i < length; i += 1) values[start + i * step] = d[i] ?? 0;
}

// The parabolas of the lower envelope (v) and where each takes over (z).
function lowerEnvelope(
  f: Float64Array,
  length: number,
): { readonly v: Int32Array; readonly z: Float64Array } {
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
  return { v, z };
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
  const height = on.length / width;
  const flood: Flood = {
    parent: new Int32Array(on.length).fill(-1),
    peak: new Float32Array(on.length),
    near: new Int32Array(4),
    roots: new Int32Array(4),
    width,
    height,
    prominence: PROMINENCE_MM * pixelsPerMm,
    minDepth: MIN_DEPTH_MM * pixelsPerMm,
  };
  for (const p of deepestFirst(on, depth)) floodPixel(flood, p, depth[p] ?? 0);
  return cutBetweenBasins(on, flood.parent, width, height);
}

type Flood = {
  /** Flooded region of each pixel (union-find), -1 before it is reached. */
  readonly parent: Int32Array;
  /** Depth of each region's deepest pixel, kept at its root. */
  readonly peak: Float32Array;
  readonly near: Int32Array;
  readonly roots: Int32Array;
  readonly width: number;
  readonly height: number;
  readonly prominence: number;
  readonly minDepth: number;
};

// Pixel p, at depth `level`, joins the deepest region beside it; any other
// region beside it that does not stand clear of that level joins too.
function floodPixel(flood: Flood, p: number, level: number): void {
  const { parent, peak, roots } = flood;
  const count = rootsAround(p, flood.width, flood.height, parent, flood.near, roots);
  if (count === 0) {
    parent[p] = p;
    peak[p] = level;
    return;
  }
  const main = deepestRoot(flood, count, p);
  parent[p] = main;
  for (let k = 0; k < count; k += 1) {
    const root = roots[k] ?? p;
    if (root === main) continue;
    const top = peak[root] ?? 0;
    if (top - level < flood.prominence || top < flood.minDepth) parent[root] = main;
  }
}

function deepestRoot(flood: Flood, count: number, fallback: number): number {
  let main = flood.roots[0] ?? fallback;
  for (let k = 1; k < count; k += 1) {
    const root = flood.roots[k] ?? fallback;
    if ((flood.peak[root] ?? 0) > (flood.peak[main] ?? 0)) main = root;
  }
  return main;
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
  // Each piece pixel's bucket counted from the deepest (0), -1 off the pieces.
  const bucket = new Int32Array(on.length).fill(-1);
  let deepest = 0;
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] !== 1) continue;
    bucket[i] = Math.round((depth[i] ?? 0) / DEPTH_STEP_PX);
    deepest = Math.max(deepest, bucket[i] ?? 0);
  }
  for (let i = 0; i < on.length; i += 1) {
    if ((bucket[i] ?? -1) >= 0) bucket[i] = deepest - (bucket[i] ?? 0);
  }
  return countingOrder(bucket, deepest + 1);
}

// Indices with a bucket of 0 .. buckets - 1, ordered by bucket, stable.
function countingOrder(bucket: Int32Array, buckets: number): Int32Array {
  const starts = new Int32Array(buckets + 1);
  for (const b of bucket) if (b >= 0) starts[b + 1] = (starts[b + 1] ?? 0) + 1;
  for (let k = 1; k < starts.length; k += 1) starts[k] = (starts[k] ?? 0) + (starts[k - 1] ?? 0);
  const order = new Int32Array(starts[buckets] ?? 0);
  bucket.forEach((b, i) => {
    if (b < 0) return;
    order[starts[b] ?? 0] = i;
    starts[b] = (starts[b] ?? 0) + 1;
  });
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
