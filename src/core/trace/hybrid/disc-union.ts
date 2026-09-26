// Union of pixel discs (ADR-454): which pixel centres q lie strictly inside
// at least one disc centred on a site p with squared radius rSq[p]?
//
// That is the reverse Euclidean distance transform: q is covered exactly when
//   max_p (rSq[p] - |q - p|^2) > 0.
// Because |q - p|^2 = dx^2 + dy^2, the maximum separates into a column pass
// and a row pass, each an upper envelope of downward parabolas — the
// Felzenszwalb-Huttenlocher lower envelope applied to -rSq. The work is
// linear in the pixel count however large the discs are, so a solid logo
// with a 60 px inscribed radius costs no more than a hairline.

import { runTraceSteps, type TraceSteps } from '../trace-steps';

/** Squared radius per pixel; any value <= 0 marks "no disc here". */
export type DiscSites = {
  readonly width: number;
  readonly height: number;
  readonly radiusSq: Float64Array;
};

export function discUnion(sites: DiscSites): Uint8Array {
  return runTraceSteps(discUnionSteps(sites));
}

/** 1 where a pixel centre lies strictly inside some site's disc. */
export function* discUnionSteps(sites: DiscSites): TraceSteps<Uint8Array> {
  const cooperate = yield;
  const { width, height, radiusSq } = sites;
  // Envelope values are stored negated (lower envelope of -rSq + d^2), so
  // "covered" means the final value is strictly negative.
  const field = new Float64Array(width * height);
  const scratch = envelopeScratch(Math.max(width, height));
  const column = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    if (cooperate && x % 64 === 0) yield;
    for (let y = 0; y < height; y += 1) {
      const r = radiusSq[y * width + x] ?? 0;
      column[y] = r > 0 ? -r : Infinity;
    }
    lowerEnvelope(column, height, scratch);
    for (let y = 0; y < height; y += 1) field[y * width + x] = scratch.out[y] ?? Infinity;
  }
  const row = new Float64Array(width);
  const covered = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    if (cooperate && y % 64 === 0) yield;
    for (let x = 0; x < width; x += 1) row[x] = field[y * width + x] ?? Infinity;
    lowerEnvelope(row, width, scratch);
    for (let x = 0; x < width; x += 1) {
      if ((scratch.out[x] ?? Infinity) < 0) covered[y * width + x] = 1;
    }
  }
  return covered;
}

type EnvelopeScratch = {
  readonly v: Int32Array;
  readonly z: Float64Array;
  readonly out: Float64Array;
};

function envelopeScratch(n: number): EnvelopeScratch {
  return { v: new Int32Array(n), z: new Float64Array(n + 1), out: new Float64Array(n) };
}

// out[q] = min_p (f[p] + (q - p)^2) over the finite f[p]; Infinity when no
// site exists. Non-sites are skipped rather than modelled as a huge finite
// value, so the intersection arithmetic never mixes 1e15 with pixel sizes.
function lowerEnvelope(f: Float64Array, n: number, s: EnvelopeScratch): void {
  const { v, z, out } = s;
  let k = -1;
  for (let q = 0; q < n; q += 1) {
    const fq = f[q] ?? Infinity;
    if (fq === Infinity) continue;
    if (k < 0) {
      k = 0;
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    let sect = intersection(f, v[k] ?? 0, q);
    while (sect <= (z[k] ?? -Infinity)) {
      k -= 1;
      sect = intersection(f, v[k] ?? 0, q);
    }
    k += 1;
    v[k] = q;
    z[k] = sect;
    z[k + 1] = Infinity;
  }
  if (k < 0) {
    out.fill(Infinity, 0, n);
    return;
  }
  let j = 0;
  for (let q = 0; q < n; q += 1) {
    while ((z[j + 1] ?? Infinity) < q) j += 1;
    const p = v[j] ?? 0;
    out[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

function intersection(f: Float64Array, p: number, q: number): number {
  return ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
}
