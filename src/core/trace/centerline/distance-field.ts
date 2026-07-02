// Exact squared Euclidean distance to background for every ink pixel —
// two-pass separable lower-envelope transform (Felzenszwalb & Huttenlocher).
// The distance field is the backbone of the centerline rewrite: thinning
// order, spur budgets, and tip extension all read the local stroke radius
// from here. Distances are exact integers (squared), so the thinning bucket
// queue can key on them directly.

const INF = Number.MAX_SAFE_INTEGER;

export type InkMask = {
  readonly width: number;
  readonly height: number;
  /** 1 = ink, 0 = background. Length width*height. */
  readonly ink: Uint8Array;
};

/** distSq[i] = exact squared distance from pixel centre i to the nearest
 *  background pixel centre; 0 for background pixels. */
export function squaredDistanceField(mask: InkMask): Float64Array {
  const { width, height, ink } = mask;
  const distSq = new Float64Array(width * height);
  const column = new Float64Array(height);
  // Pass 1: per-column 1D transform of the 0/INF indicator.
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      column[y] = (ink[y * width + x] ?? 0) === 1 ? INF : 0;
    }
    const transformed = distanceTransform1d(column, height);
    for (let y = 0; y < height; y += 1) {
      distSq[y * width + x] = transformed[y] ?? 0;
    }
  }
  // Pass 2: per-row 1D transform of the column result.
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      row[x] = distSq[y * width + x] ?? 0;
    }
    const transformed = distanceTransform1d(row, width);
    for (let x = 0; x < width; x += 1) {
      distSq[y * width + x] = transformed[x] ?? 0;
    }
  }
  return distSq;
}

type Envelope = {
  readonly v: Int32Array; // parabola roots
  readonly z: Float64Array; // envelope boundaries
  readonly k: number; // last envelope index
};

// 1D squared-distance transform via the lower envelope of parabolas
// rooted at (i, f[i]).
function distanceTransform1d(f: Float64Array, n: number): Float64Array {
  const envelope = buildLowerEnvelope(f, n);
  return sampleEnvelope(f, n, envelope);
}

function buildLowerEnvelope(f: Float64Array, n: number): Envelope {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    const fq = f[q] ?? 0;
    if (fq === INF && (f[v[k] ?? 0] ?? 0) === INF) {
      continue; // both at infinity — parabola intersection is undefined; skip
    }
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
  return { v, z, k };
}

function sampleEnvelope(f: Float64Array, n: number, envelope: Envelope): Float64Array {
  const { v, z } = envelope;
  const d = new Float64Array(n);
  let k = 0;
  for (let q = 0; q < n; q += 1) {
    while ((z[k + 1] ?? Infinity) < q) k += 1;
    const root = v[k] ?? 0;
    const fr = f[root] ?? 0;
    d[q] = fr === INF ? INF : (q - root) * (q - root) + fr;
  }
  return d;
}

function intersection(f: Float64Array, q: number, p: number): number {
  const fq = f[q] ?? 0;
  const fp = f[p] ?? 0;
  if (fp === INF) return -Infinity; // q's parabola is below everywhere left
  if (fq === INF) return Infinity; // q never undercuts p
  return (fq + q * q - (fp + p * p)) / (2 * q - 2 * p);
}

/** Local stroke radius in pixels at index i (0 for background). */
export function radiusAt(distSq: Float64Array, index: number): number {
  return Math.sqrt(distSq[index] ?? 0);
}
