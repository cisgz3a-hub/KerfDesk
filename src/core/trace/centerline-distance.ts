const DISTANCE_INFINITY = 1e20;

type DistanceEnvelope = {
  readonly vertices: Int32Array;
  readonly breakpoints: Float64Array;
  readonly firstFinite: number;
};

// Exact squared Euclidean distance transform using the separable
// lower-envelope formula from Felzenszwalb/Huttenlocher:
// Df(p) = min_q ((p - q)^2 + f(q)).
export function squaredDistanceToBackground(
  mask: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const columnPass = new Float64Array(width * height);
  const out = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) {
    const column = new Float64Array(height);
    for (let y = 0; y < height; y += 1) {
      column[y] = isBackground(mask, width, height, x, y) ? 0 : DISTANCE_INFINITY;
    }
    const transformed = distanceTransform1d(column);
    for (let y = 0; y < height; y += 1) {
      columnPass[indexOf(x, y, width)] = transformed[y] ?? DISTANCE_INFINITY;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = new Float64Array(width);
    for (let x = 0; x < width; x += 1) {
      row[x] = columnPass[indexOf(x, y, width)] ?? DISTANCE_INFINITY;
    }
    const transformed = distanceTransform1d(row);
    for (let x = 0; x < width; x += 1) {
      out[indexOf(x, y, width)] = transformed[x] ?? DISTANCE_INFINITY;
    }
  }
  return out;
}

function distanceTransform1d(samples: Float64Array): Float64Array {
  const distances = new Float64Array(samples.length);
  distances.fill(DISTANCE_INFINITY);
  const envelope = buildDistanceEnvelope(samples);
  if (envelope === null) return distances;
  return evaluateDistanceEnvelope(samples, envelope, distances);
}

function buildDistanceEnvelope(samples: Float64Array): DistanceEnvelope | null {
  const n = samples.length;
  const firstFinite = firstFiniteIndex(samples);
  if (firstFinite === -1) return null;

  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = firstFinite;
  z[0] = Number.NEGATIVE_INFINITY;
  z[1] = Number.POSITIVE_INFINITY;

  for (let q = firstFinite + 1; q < n; q += 1) {
    if (!isFiniteSample(samples[q] ?? DISTANCE_INFINITY)) continue;
    let s = intersection(samples, q, v[k] ?? firstFinite);
    while (s <= (z[k] ?? Number.NEGATIVE_INFINITY)) {
      k -= 1;
      s = intersection(samples, q, v[k] ?? firstFinite);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Number.POSITIVE_INFINITY;
  }

  return { vertices: v, breakpoints: z, firstFinite };
}

function evaluateDistanceEnvelope(
  samples: Float64Array,
  envelope: DistanceEnvelope,
  distances: Float64Array,
): Float64Array {
  let k = 0;
  const n = samples.length;
  for (let q = 0; q < n; q += 1) {
    while ((envelope.breakpoints[k + 1] ?? Number.POSITIVE_INFINITY) < q) k += 1;
    const source = envelope.vertices[k] ?? envelope.firstFinite;
    const delta = q - source;
    distances[q] = delta * delta + (samples[source] ?? DISTANCE_INFINITY);
  }
  return distances;
}

function firstFiniteIndex(samples: Float64Array): number {
  for (let i = 0; i < samples.length; i += 1) {
    if (isFiniteSample(samples[i] ?? DISTANCE_INFINITY)) return i;
  }
  return -1;
}

function intersection(samples: Float64Array, q: number, r: number): number {
  const fq = samples[q] ?? DISTANCE_INFINITY;
  const fr = samples[r] ?? DISTANCE_INFINITY;
  return (fq + q * q - (fr + r * r)) / (2 * q - 2 * r);
}

function isFiniteSample(value: number): boolean {
  return value < DISTANCE_INFINITY / 2;
}

function isBackground(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return (
    x === 0 || y === 0 || x === width - 1 || y === height - 1 || mask[indexOf(x, y, width)] === 0
  );
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
