// 13-mode dither pass for the trace pipeline. Ported from LaserForge 1's
// src/import/Dithering.ts (algorithms only — coefficients are public
// domain image-processing math; the implementation was rewritten for our
// RawImageData shape and pure-core rules).
//
// Why a dither stage for trace input? Photographic / shaded sources have
// continuous tones that thresholdToMonochrome collapses into solid
// black-or-white patches, which then trace as blocky regions. Error
// diffusion turns those tones into spatially-distributed binary dots,
// preserving local average brightness; imagetracerjs then traces around
// the dot pattern and the resulting engrave reads as a halftoned image
// rather than a flat silhouette.
//
// Differences from our existing src/core/raster/dither.ts:
//   - Output: this module returns RGBA RawImageData (binary 0 or 255
//     per channel, alpha=255). raster/dither.ts returns a Uint16Array
//     of S-values for the GRBL emit path.
//   - Modes: 13 (LF1 parity) vs the 3 raster modes.
//   - Scope: only the path INTO imagetracerjs, not the engrave G-code.
//
// All algorithms run in luma space then expand back to RGB. Black-on-
// white convention (ink = 0,0,0,255; background = 255,255,255,255) so
// downstream thresholdToMonochrome / despeckle / tracer behaviour is
// unchanged.
//
// Pure-core compliant: no clock, no random (RNG is a deterministic LCG
// seeded with a fixed constant), no I/O, no globals (the blue-noise
// threshold tile is lazily cached at module scope but the contents are
// fully determined by the size constant — pure function of inputs).

import type { RawImageData } from './trace-image';

export type DitherMode =
  | 'none'
  | 'threshold'
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'ordered'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite'
  | 'blue-noise'
  | 'random';

// Display labels for the import dialog dropdown. Order matches LF1 so
// muscle memory ports over for users coming from LaserForge 1.
export const DITHER_MODES: ReadonlyArray<{ readonly id: DitherMode; readonly name: string }> = [
  { id: 'none', name: 'None' },
  { id: 'threshold', name: 'Threshold' },
  { id: 'floyd-steinberg', name: 'Floyd-Steinberg' },
  { id: 'jarvis', name: 'Jarvis' },
  { id: 'stucki', name: 'Stucki' },
  { id: 'ordered', name: 'Ordered (Bayer 4×4)' },
  { id: 'atkinson', name: 'Atkinson' },
  { id: 'burkes', name: 'Burkes' },
  { id: 'sierra3', name: 'Sierra 3' },
  { id: 'sierra2', name: 'Sierra 2' },
  { id: 'sierra-lite', name: 'Sierra Lite' },
  { id: 'blue-noise', name: 'Blue Noise' },
  { id: 'random', name: 'Random' },
];

// ITU-R BT.601 luma. Matches preprocess.ts / thresholdToMonochrome so a
// pixel's luma reading is consistent across every preprocessing stage.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const DEFAULT_THRESHOLD = 128;

// Extract luma plane from an RGBA buffer. Output is Uint8Array
// (0..255), one byte per pixel.
function lumaPlaneOf(image: RawImageData): Uint8Array {
  const pixelCount = image.width * image.height;
  const out = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    out[p] = Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b);
  }
  return out;
}

// Project a per-pixel binary mask back into RGBA. mask[p] === 255 means
// "ink" (dark pixel); we write 0,0,0,255. Otherwise white. Alpha is
// always 255 — downstream operators assume opaque pixels.
function maskToRgba(mask: Uint8Array, width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < mask.length; p += 1) {
    const i = p * 4;
    const v = mask[p] === 255 ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

// Entry point. Mode 'none' returns the input unchanged (ref-equal) so
// the trace pipeline can skip the conversion cost when the user hasn't
// opted in. Every other mode allocates a fresh RawImageData.
export function ditherForTrace(
  image: RawImageData,
  mode: DitherMode,
  threshold: number = DEFAULT_THRESHOLD,
): RawImageData {
  if (mode === 'none') return image;
  const luma = lumaPlaneOf(image);
  const mask = ditherToMask(luma, image.width, image.height, mode, threshold);
  return maskToRgba(mask, image.width, image.height);
}

type ErrorDiffusionMode =
  | 'floyd-steinberg'
  | 'jarvis'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra3'
  | 'sierra2'
  | 'sierra-lite';

function isErrorDiffusionMode(mode: DitherMode): mode is ErrorDiffusionMode {
  return (
    mode === 'floyd-steinberg' ||
    mode === 'jarvis' ||
    mode === 'stucki' ||
    mode === 'atkinson' ||
    mode === 'burkes' ||
    mode === 'sierra3' ||
    mode === 'sierra2' ||
    mode === 'sierra-lite'
  );
}

// Dispatcher — split out so ditherForTrace stays under the complexity
// cap. Returns a per-pixel mask where 255 means ink. Exhaustive switch
// so a future DitherMode addition fails the typecheck if unwired.
function ditherToMask(
  luma: Uint8Array,
  width: number,
  height: number,
  mode: DitherMode,
  threshold: number,
): Uint8Array {
  if (isErrorDiffusionMode(mode)) {
    return ditherErrorDiffusion(luma, width, height, threshold, kernelFor(mode));
  }
  switch (mode) {
    case 'none':
      return luma.slice();
    case 'threshold':
      return ditherThreshold(luma, threshold);
    case 'ordered':
      return ditherOrdered(luma, width, height);
    case 'blue-noise':
      return ditherBlueNoise(luma, width, height);
    case 'random':
      return ditherRandom(luma);
  }
}

// Error-diffusion kernel picker — exhaustive over ErrorDiffusionMode
// only (8 arms, complexity 8). Kept tight so future additions show up
// here without inflating ditherToMask.
function kernelFor(mode: ErrorDiffusionMode): DiffusionKernel {
  switch (mode) {
    case 'floyd-steinberg':
      return FLOYD_STEINBERG;
    case 'jarvis':
      return JARVIS;
    case 'stucki':
      return STUCKI;
    case 'atkinson':
      return ATKINSON;
    case 'burkes':
      return BURKES;
    case 'sierra3':
      return SIERRA3;
    case 'sierra2':
      return SIERRA2;
    case 'sierra-lite':
      return SIERRA_LITE;
  }
}

// ─── THRESHOLD ───────────────────────────────────────────────────────

function ditherThreshold(luma: Uint8Array, threshold: number): Uint8Array {
  const out = new Uint8Array(luma.length);
  for (let i = 0; i < luma.length; i += 1) {
    out[i] = (luma[i] ?? 0) < threshold ? 255 : 0;
  }
  return out;
}

// ─── ERROR DIFFUSION ─────────────────────────────────────────────────
// Each kernel describes which neighbour pixels absorb the quantization
// error of the current pixel and at what weight. Coefficients are the
// canonical published values — Floyd & Steinberg 1976; Jarvis, Judice
// & Ninke 1976; Stucki 1981; Atkinson (Apple, 1980s); Burkes 1988;
// Sierra (Frank Sierra, 1989).

type DiffusionKernel = {
  readonly offsets: ReadonlyArray<readonly [number, number, number]>;
  readonly divisor: number;
};

const FLOYD_STEINBERG: DiffusionKernel = {
  offsets: [
    [1, 0, 7],
    [-1, 1, 3],
    [0, 1, 5],
    [1, 1, 1],
  ],
  divisor: 16,
};

const JARVIS: DiffusionKernel = {
  offsets: [
    [1, 0, 7],
    [2, 0, 5],
    [-2, 1, 3],
    [-1, 1, 5],
    [0, 1, 7],
    [1, 1, 5],
    [2, 1, 3],
    [-2, 2, 1],
    [-1, 2, 3],
    [0, 2, 5],
    [1, 2, 3],
    [2, 2, 1],
  ],
  divisor: 48,
};

const STUCKI: DiffusionKernel = {
  offsets: [
    [1, 0, 8],
    [2, 0, 4],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 8],
    [1, 1, 4],
    [2, 1, 2],
    [-2, 2, 1],
    [-1, 2, 2],
    [0, 2, 4],
    [1, 2, 2],
    [2, 2, 1],
  ],
  divisor: 42,
};

const ATKINSON: DiffusionKernel = {
  offsets: [
    [1, 0, 1],
    [2, 0, 1],
    [-1, 1, 1],
    [0, 1, 1],
    [1, 1, 1],
    [0, 2, 1],
  ],
  divisor: 8,
};

const BURKES: DiffusionKernel = {
  offsets: [
    [1, 0, 8],
    [2, 0, 4],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 8],
    [1, 1, 4],
    [2, 1, 2],
  ],
  divisor: 32,
};

const SIERRA3: DiffusionKernel = {
  offsets: [
    [1, 0, 5],
    [2, 0, 3],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 5],
    [1, 1, 4],
    [2, 1, 2],
    [-1, 2, 2],
    [0, 2, 3],
    [1, 2, 2],
  ],
  divisor: 32,
};

const SIERRA2: DiffusionKernel = {
  offsets: [
    [1, 0, 4],
    [2, 0, 3],
    [-2, 1, 1],
    [-1, 1, 2],
    [0, 1, 3],
    [1, 1, 2],
    [2, 1, 1],
  ],
  divisor: 16,
};

const SIERRA_LITE: DiffusionKernel = {
  offsets: [
    [1, 0, 2],
    [-1, 1, 1],
    [0, 1, 1],
  ],
  divisor: 4,
};

// Serpentine scan — even rows L→R, odd rows R→L with mirrored kernel
// dx. Breaks the directional coherence that produces diagonal "worm"
// patterns on mid-tone gradients (LF1 T1-34). Kernel coefficients are
// unchanged; only the scan order and dx sign flip per row.
function ditherErrorDiffusion(
  luma: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  kernel: DiffusionKernel,
): Uint8Array {
  const buf = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i += 1) buf[i] = luma[i] ?? 0;
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < height; y += 1) {
    const reverse = (y & 1) === 1;
    const xStart = reverse ? width - 1 : 0;
    const xStep = reverse ? -1 : 1;
    const xEnd = reverse ? -1 : width;
    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = y * width + x;
      const oldVal = buf[i] ?? 0;
      const newVal = oldVal < threshold ? 0 : 255;
      out[i] = newVal === 0 ? 255 : 0;
      diffuseError(buf, kernel, oldVal - newVal, x, y, width, height, reverse);
    }
  }
  return out;
}

// Extracted to keep ditherErrorDiffusion under the complexity cap.
// Pushes `error` to each neighbour at its kernel weight. On reverse
// rows we mirror dx so the error flows ahead of the cursor regardless
// of scan direction.
function diffuseError(
  buf: Float32Array,
  kernel: DiffusionKernel,
  error: number,
  x: number,
  y: number,
  width: number,
  height: number,
  reverse: boolean,
): void {
  for (const [dx, dy, weight] of kernel.offsets) {
    const nx = x + (reverse ? -dx : dx);
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const ni = ny * width + nx;
    buf[ni] = (buf[ni] ?? 0) + (error * weight) / kernel.divisor;
  }
}

// ─── ORDERED (BAYER 4×4) ─────────────────────────────────────────────
// Classic Bayer matrix — a 4×4 tile whose values map 0..15 onto a
// regular dot pattern. Tile-able; produces a deterministic structured
// halftone. Looks artificial up close but engraves consistently.

const BAYER_4X4: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// BAYER_4X4 is a literal 4×4 constant, but `noUncheckedIndexedAccess`
// makes every index lookup possibly-undefined. Default to 0 (threshold
// zero → pixel is always treated as background) so the typecheck is
// satisfied without sprinkling non-null assertions.
function bayerAt(y: number, x: number): number {
  const row = BAYER_4X4[y % 4];
  if (row === undefined) return 0;
  return row[x % 4] ?? 0;
}

function ditherOrdered(luma: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Bayer cell 0..15 → threshold in (0, 255).
      const thresh = ((bayerAt(y, x) + 0.5) / 16) * 255;
      const i = y * width + x;
      out[i] = (luma[i] ?? 0) < thresh ? 255 : 0;
    }
  }
  return out;
}

// ─── BLUE NOISE ──────────────────────────────────────────────────────
// Void-and-cluster threshold tile. Each cell is placed at the
// most-empty position (largest distance to the nearest already-placed
// cell, toroidally measured), with a hash-based deterministic tie
// break. The result is a tileable threshold field whose Fourier
// spectrum has a hole at low frequencies — perceptually pleasant
// halftone with no visible regular structure. LF1 tile size 16×16.

const BLUE_NOISE_TILE_SIZE = 16;
let blueNoiseTileCache: Uint8Array | null = null;

function toroidalDistanceSq(a: number, b: number, size: number): number {
  const ax = a % size;
  const ay = Math.floor(a / size);
  const bx = b % size;
  const by = Math.floor(b / size);
  const dxRaw = Math.abs(ax - bx);
  const dyRaw = Math.abs(ay - by);
  const dx = Math.min(dxRaw, size - dxRaw);
  const dy = Math.min(dyRaw, size - dyRaw);
  return dx * dx + dy * dy;
}

// Cheap integer hash for tie-breaking. Deterministic — same index
// always returns the same value, so the tile is the same on every
// machine. (We don't use Math.random anywhere in core.)
function tieBreakHash(index: number): number {
  let n = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

// Build the 16×16 threshold tile. ~256 placements × 256 candidates =
// 65,536 distance checks. Runs once per process; cached.
function buildBlueNoiseTile(size: number): Uint8Array {
  const cellCount = size * size;
  const ranks = new Uint16Array(cellCount);
  const occupied = new Uint8Array(cellCount);
  const placed: number[] = [];
  for (let rank = 0; rank < cellCount; rank += 1) {
    let bestIndex = -1;
    let bestDistance = -1;
    let bestTie = -1;
    for (let index = 0; index < cellCount; index += 1) {
      if (occupied[index] === 1) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const filled of placed) {
        const d = toroidalDistanceSq(index, filled, size);
        if (d < nearest) nearest = d;
      }
      const candidate = placed.length === 0 ? Number.POSITIVE_INFINITY : nearest;
      const tie = tieBreakHash(index);
      if (candidate > bestDistance || (candidate === bestDistance && tie > bestTie)) {
        bestIndex = index;
        bestDistance = candidate;
        bestTie = tie;
      }
    }
    occupied[bestIndex] = 1;
    placed.push(bestIndex);
    ranks[bestIndex] = rank;
  }
  const thresholds = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    const r = ranks[i] ?? 0;
    thresholds[i] = Math.max(1, Math.min(255, Math.floor(((cellCount - r) / cellCount) * 256)));
  }
  return thresholds;
}

function getBlueNoiseTile(): Uint8Array {
  if (blueNoiseTileCache === null) {
    blueNoiseTileCache = buildBlueNoiseTile(BLUE_NOISE_TILE_SIZE);
  }
  return blueNoiseTileCache;
}

function ditherBlueNoise(luma: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(luma.length);
  const tile = getBlueNoiseTile();
  const size = BLUE_NOISE_TILE_SIZE;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = tile[(y % size) * size + (x % size)] ?? 0;
      const i = y * width + x;
      out[i] = (luma[i] ?? 0) < t ? 255 : 0;
    }
  }
  return out;
}

// ─── RANDOM ──────────────────────────────────────────────────────────
// LCG with fixed seed 42 — deterministic across runs, fully replayable
// in tests. The "random" name is a UX label; the algorithm is just
// each pixel thresholded against a per-pixel PRNG draw. Noisy halftone
// with no visible structure but typically inferior to blue noise.

function ditherRandom(luma: Uint8Array): Uint8Array {
  const out = new Uint8Array(luma.length);
  let seed = 42;
  for (let i = 0; i < luma.length; i += 1) {
    // LCG: same constants LF1 used; 31-bit mask keeps the seed positive.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const thresh = (seed / 0x7fffffff) * 255;
    out[i] = (luma[i] ?? 0) < thresh ? 255 : 0;
  }
  return out;
}
