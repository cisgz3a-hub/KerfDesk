// dither-blue-noise — the 'blue-noise' error diffusion for photographs and
// portraits (ADR-649).
//
// Fixed-threshold diffusion with one fixed kernel (Floyd–Steinberg, Jarvis,
// Stucki) locks flat midtones — cheeks, foreheads, backgrounds — into "worm"
// mazes and periodic patterns. This mode follows the variable-coefficient
// scheme of Ostromoukhov (SIGGRAPH 2001) with the threshold modulation of
// Zhou & Fang (ACM TOG 2003):
//
//   - the error goes to three neighbours (ahead, behind-below, below) with
//     weights chosen by the pixel's ORIGINAL input level, interpolated
//     between tuned key levels (dither-blue-noise-tables.ts);
//   - the quantizer threshold is 128 + m(level) * n(x, y), where n is white
//     noise in [-1, 1) and m a level-dependent strength. The noise is a hash
//     of the pixel position, never Math.random, so output is reproducible;
//   - rows are scanned serpentine, mirroring the filter on odd rows.
//
// diffuseBlueNoiseRow is the only implementation: dither() calls it on views
// of its full-image buffer and dither-rows calls it on its rolling window, so
// the two paths share every arithmetic step and agree bit-for-bit. The filter
// reaches one row ahead.
//
// Pure-core compliant: no clock, no random, no I/O; deterministic.

import { BLUE_NOISE_KEY_LEVELS, OSTROMOUKHOV_2001_WEIGHTS } from './dither-blue-noise-tables';

const WHITE_LUMA = 255;
const MID_LUMA = 128;
const LEVELS = 256;

/** Rows ahead of the scan line the blue-noise filter writes into. */
export const BLUE_NOISE_ROWS_AHEAD = 1;

export type BlueNoiseCoefficients = {
  readonly ahead: number;
  readonly behindBelow: number;
  readonly below: number;
};

// Per-level tables, built once: normalized weights and the threshold
// modulation strength m (luma units) for every input level 0..255.
const AHEAD = new Float64Array(LEVELS);
const BEHIND_BELOW = new Float64Array(LEVELS);
const BELOW = new Float64Array(LEVELS);
const MODULATION = new Float64Array(LEVELS);
buildLevelTables();

/** The error-filter weights used for an input level (they sum to 1). */
export function blueNoiseCoefficients(level: number): BlueNoiseCoefficients {
  const g = clampLevel(level);
  return { ahead: AHEAD[g] ?? 0, behindBelow: BEHIND_BELOW[g] ?? 0, below: BELOW[g] ?? 0 };
}

/** Threshold modulation strength m(level), in luma units. */
export function blueNoiseModulation(level: number): number {
  return MODULATION[clampLevel(level)] ?? 0;
}

/**
 * Deterministic white noise in [-1, 1) for pixel (x, y): an integer hash of the
 * position (a multiply-xorshift finalizer), so every path and every run that
 * dithers the same grid sees the same threshold at the same pixel.
 */
export function thresholdNoise(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 2_147_483_648 - 1;
}

/** Quantizer threshold at (x, y) for a pixel whose input level is `level`. */
export function blueNoiseThreshold(x: number, y: number, level: number): number {
  return modulatedThreshold(x, y, blueNoiseModulation(level));
}

function modulatedThreshold(x: number, y: number, strength: number): number {
  return strength === 0 ? MID_LUMA : MID_LUMA + strength * thresholdNoise(x, y);
}

/**
 * Quantize row `y` and diffuse its error. `source` is the row's original luma
 * (it selects weights and modulation), `current` the same row with incoming
 * error added (consumed in place), `below` row y + 1's accumulator, or null on
 * the last row, where error leaving the image is dropped as by every other
 * kernel. Writes `sMax` for a burn pixel and 0 otherwise into `out`.
 */
export function diffuseBlueNoiseRow(
  y: number,
  source: Uint8Array,
  current: Float32Array,
  below: Float32Array | null,
  out: Float64Array,
  sMax: number,
): void {
  const width = current.length;
  const step = y % 2 === 0 ? 1 : -1;
  let x = step === 1 ? 0 : width - 1;
  for (let n = 0; n < width; n += 1, x += step) {
    const level = source[x] ?? WHITE_LUMA;
    const value = current[x] ?? 0;
    const burn = value < modulatedThreshold(x, y, MODULATION[level] ?? 0);
    out[x] = burn ? sMax : 0;
    const err = burn ? value : value - WHITE_LUMA;
    if (err !== 0) spreadError(current, below, x, step, level, err);
  }
}

// Ahead of x on this row; behind it and directly below on the next row.
function spreadError(
  current: Float32Array,
  below: Float32Array | null,
  x: number,
  step: number,
  level: number,
  err: number,
): void {
  addError(current, x + step, err * (AHEAD[level] ?? 0));
  if (below === null) return;
  addError(below, x - step, err * (BEHIND_BELOW[level] ?? 0));
  addError(below, x, err * (BELOW[level] ?? 0));
}

function addError(row: Float32Array, x: number, amount: number): void {
  if (x >= 0 && x < row.length) row[x] = (row[x] ?? 0) + amount;
}

function clampLevel(level: number): number {
  return Math.min(WHITE_LUMA, Math.max(0, Math.round(Number.isFinite(level) ? level : WHITE_LUMA)));
}

// Levels up to the first tuned key level use Ostromoukhov's published weights
// as they are; above it, weights and modulation interpolate linearly between
// key levels. Dark and light tones are mirror images, so level g >= 128 takes
// the entry of 255 - g (Ostromoukhov's assumption A4).
function buildLevelTables(): void {
  const first = BLUE_NOISE_KEY_LEVELS[0];
  if (first === undefined) throw new Error('dither-blue-noise: no key levels');
  for (let g = 0; g < MID_LUMA; g += 1) {
    const weights = g <= first.level ? ostromoukhovWeights(g) : interpolatedWeights(g);
    const strength = g <= first.level ? first.modulation : interpolatedModulation(g);
    for (const level of [g, WHITE_LUMA - g]) {
      AHEAD[level] = weights[0];
      BEHIND_BELOW[level] = weights[1];
      BELOW[level] = weights[2];
      MODULATION[level] = strength;
    }
  }
}

type Weights = readonly [number, number, number];

function ostromoukhovWeights(level: number): Weights {
  const row = OSTROMOUKHOV_2001_WEIGHTS[level];
  if (row === undefined) throw new Error(`dither-blue-noise: no published weights for ${level}`);
  return normalized(row);
}

function normalized(row: Weights): Weights {
  const sum = row[0] + row[1] + row[2];
  return [row[0] / sum, row[1] / sum, row[2] / sum];
}

function interpolatedWeights(level: number): Weights {
  const [lo, hi, t] = keySpan(level);
  const a = normalized(lo.weights);
  const b = normalized(hi.weights);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function interpolatedModulation(level: number): number {
  const [lo, hi, t] = keySpan(level);
  return lo.modulation + (hi.modulation - lo.modulation) * t;
}

type KeyLevel = (typeof BLUE_NOISE_KEY_LEVELS)[number];

function keySpan(level: number): readonly [KeyLevel, KeyLevel, number] {
  for (let i = 1; i < BLUE_NOISE_KEY_LEVELS.length; i += 1) {
    const lo = BLUE_NOISE_KEY_LEVELS[i - 1];
    const hi = BLUE_NOISE_KEY_LEVELS[i];
    if (lo !== undefined && hi !== undefined && level <= hi.level) {
      return [lo, hi, (level - lo.level) / (hi.level - lo.level)];
    }
  }
  throw new Error(`dither-blue-noise: level ${level} is past the last key level`);
}
