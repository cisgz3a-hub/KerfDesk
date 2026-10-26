// Spectral texture measures for a dither's output on a flat grey field.
//
// A dither of a flat grey should look like structureless "blue noise":
// power only at high frequencies, the same in every direction (Ulichney,
// Digital Halftoning, 1987). Worms and blotches put power at LOW frequencies,
// where the eye sees texture; periodic patterns put it in a few spikes. The
// measures below quantify both on the binary output:
//
//   lowFrequencyShare  share of the AC power below half the blue-noise
//                      principal frequency fg = sqrt(min(p, 1 - p)) cycles per
//                      pixel, p the burned fraction. Ideal blue noise has
//                      almost nothing there.
//   anisotropy         Ulichney's anisotropy: the variance of power around each
//                      radial annulus over its squared mean, averaged over the
//                      annuli above fg/2 (weighted by their power). Directional
//                      worms and periodic patterns score high; isotropic noise
//                      averaged over 16 tiles scores near 1/16.
//   peakRatio          the strongest single frequency below 0.45 cycles/pixel
//                      over the mean there; a periodic pattern spikes. (The
//                      checkerboard at 0.71 cycles/pixel is excluded: it is the
//                      finest pattern a grid can hold.)
//
// The field's first 32 rows and columns are skipped while the diffusion
// settles; the rest is cut into 4 x 4 tiles of 64 px whose Hann-windowed
// periodograms are averaged (Bartlett's method) to steady the estimate.

const TILE = 64;
const TILES = 4;
const MARGIN = 32;
const PEAK_BAND = 0.45;
export const TEXTURE_FIELD_SIZE = MARGIN + TILE * TILES;

export type TextureMeasure = {
  readonly burnedFraction: number;
  readonly lowFrequencyShare: number;
  readonly anisotropy: number;
  readonly peakRatio: number;
};

/** Burn flags (1 = burned) for a dither of a flat field of `gray`, row-major. */
export type FlatFieldDither = (gray: number, size: number) => ArrayLike<number>;

export function flatFieldTexture(gray: number, ditherFlat: FlatFieldDither): TextureMeasure {
  const burned = ditherFlat(gray, TEXTURE_FIELD_SIZE);
  const power = new Float64Array(TILE * TILE);
  let burnedCount = 0;
  for (let ty = 0; ty < TILES; ty += 1) {
    for (let tx = 0; tx < TILES; tx += 1) {
      const tile = new Float64Array(TILE * TILE);
      for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) {
          const at = (MARGIN + ty * TILE + y) * TEXTURE_FIELD_SIZE + MARGIN + tx * TILE + x;
          const value = (burned[at] ?? 0) > 0 ? 1 : 0;
          tile[y * TILE + x] = value;
          burnedCount += value;
        }
      }
      const tilePower = periodogram(tile);
      for (let i = 0; i < power.length; i += 1) power[i]! += tilePower[i]! / (TILES * TILES);
    }
  }
  const burnedFraction = burnedCount / (TILES * TILES * TILE * TILE);
  return { burnedFraction, ...spectrumMeasures(power, burnedFraction) };
}

type Bin = { readonly frequency: number; readonly ring: number; readonly power: number };

function spectrumMeasures(power: Float64Array, burnedFraction: number) {
  const principal = Math.sqrt(Math.min(burnedFraction, 1 - burnedFraction));
  const bins = frequencyBins(power);
  const total = sumPower(bins);
  const low = sumPower(bins.filter((bin) => bin.frequency < principal / 2));
  const band = bins.filter((bin) => bin.frequency < PEAK_BAND);
  const bandMean = sumPower(band) / band.length;
  return {
    lowFrequencyShare: total > 0 ? low / total : 0,
    anisotropy: anisotropy(bins, Math.max(1, Math.ceil((principal / 2) * TILE))),
    peakRatio: bandMean > 0 ? Math.max(...band.map((bin) => bin.power)) / bandMean : 0,
  };
}

// Every AC frequency of the tile, in cycles per pixel, with its radial ring.
function frequencyBins(power: Float64Array): ReadonlyArray<Bin> {
  const bins: Bin[] = [];
  for (let v = 0; v < TILE; v += 1) {
    for (let u = 0; u < TILE; u += 1) {
      if (u === 0 && v === 0) continue;
      const radius = Math.hypot(u < TILE / 2 ? u : u - TILE, v < TILE / 2 ? v : v - TILE);
      bins.push({
        frequency: radius / TILE,
        ring: Math.round(radius),
        power: power[v * TILE + u]!,
      });
    }
  }
  return bins;
}

function sumPower(bins: ReadonlyArray<Bin>): number {
  return bins.reduce((sum, bin) => sum + bin.power, 0);
}

// Ulichney's anisotropy per ring from `firstRing` up to 0.5 cycles/pixel,
// averaged with each ring weighted by its power.
function anisotropy(bins: ReadonlyArray<Bin>, firstRing: number): number {
  const rings = new Map<number, number[]>();
  for (const bin of bins) {
    if (bin.ring < firstRing || bin.ring >= TILE / 2) continue;
    const ring = rings.get(bin.ring);
    if (ring === undefined) rings.set(bin.ring, [bin.power]);
    else ring.push(bin.power);
  }
  let weighted = 0;
  let weight = 0;
  for (const powers of rings.values()) {
    const sum = powers.reduce((total, p) => total + p, 0);
    const mean = sum / powers.length;
    if (!(mean > 0) || powers.length < 4) continue;
    const variance = powers.reduce((total, p) => total + p * p, 0) / powers.length - mean * mean;
    weighted += (variance / (mean * mean)) * sum;
    weight += sum;
  }
  return weight > 0 ? weighted / weight : 0;
}

const HANN = Float64Array.from(
  { length: TILE },
  (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / TILE),
);

// |DFT|^2 of the mean-removed, Hann-windowed tile, by row then column FFTs.
function periodogram(tile: Float64Array): Float64Array {
  let mean = 0;
  for (const value of tile) mean += value;
  mean /= tile.length;
  const re = new Float64Array(TILE * TILE);
  const im = new Float64Array(TILE * TILE);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      re[y * TILE + x] = (tile[y * TILE + x]! - mean) * HANN[x]! * HANN[y]!;
    }
  }
  const lineRe = new Float64Array(TILE);
  const lineIm = new Float64Array(TILE);
  for (const byRow of [true, false]) {
    for (let a = 0; a < TILE; a += 1) {
      for (let b = 0; b < TILE; b += 1) {
        const at = byRow ? a * TILE + b : b * TILE + a;
        lineRe[b] = re[at]!;
        lineIm[b] = im[at]!;
      }
      fft(lineRe, lineIm);
      for (let b = 0; b < TILE; b += 1) {
        const at = byRow ? a * TILE + b : b * TILE + a;
        re[at] = lineRe[b]!;
        im[at] = lineIm[b]!;
      }
    }
  }
  return Float64Array.from(re, (r, i) => r * r + im[i]! * im[i]!);
}

// In-place iterative radix-2 FFT; length must be a power of two.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + len / 2;
        const vr = re[b]! * wr - im[b]! * wi;
        const vi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
      }
    }
  }
}
