// Halftone screening (ADR-242, PP-E) — the classic engrave preparation:
// continuous tone becomes pure black/white dots (AM halftone) or lines
// (newsprint screen) that a laser burns cleanly at fixed power.
//
// Per-pixel spot screening: rotate into screen space, find the cell, and
// ink the pixel when it sits inside the spot whose area tracks the local
// ink density (1 - luma). A screen that runs along the pixel grid uses a
// threshold array ranked by the same spot instead (ADR-242 Amendment 1).
// Everything lands as pure 0/255, alpha-weighted into the selection like
// every other filter.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, lumaByte, MAX_BYTE } from './lut';
import { modulo } from '../math/wrap';

const RGB_CHANNELS = 3;
// Above half ink, circles can no longer add area without overlapping — the
// classic screen switches to white holes shrinking on the dual grid.
const HOLE_CROSSOVER_INK = 0.5;
// sin or cos of the screen angle below this is taken as zero: 90° gives
// cos 6e-17, and the screen still runs along the pixel grid.
const AXIS_EPSILON = 1e-9;
// The R2 low-discrepancy sequence's steps (1/g and 1/g², g the plastic
// number): pixels that tie in a threshold array take turns in a spread-out
// order instead of filling a row from one end.
const R2_STEP_U = 0.7548776662466927;
const R2_STEP_V = 0.5698402909980532;

export type HalftoneParams = {
  /** Screen cell size in pixels (grid pitch). */
  readonly spacingPx: number;
  /** Screen rotation in degrees (45 is the print classic). */
  readonly angleDeg: number;
  readonly shape: 'dot' | 'line';
};

export function halftoneScreenInPlace(
  doc: RgbaBuffer,
  params: HalftoneParams,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const r = clampRectToDoc(doc, rect);
  if (r.width <= 0 || r.height <= 0) return;
  const rad = (params.angleDeg * Math.PI) / 180;
  const screen: ScreenSpec = {
    spacing: Math.max(2, params.spacingPx),
    cos: Math.cos(rad),
    sin: Math.sin(rad),
    shape: params.shape,
  };
  const thresholds = pixelAlignedThresholds(screen);
  // Screening reads local luma from a snapshot so written dots never feed
  // back into neighbouring decisions.
  const source = new Uint8ClampedArray(doc.data);
  for (let y = r.y; y < r.y + r.height; y += 1) {
    for (let x = r.x; x < r.x + r.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const base = idx * RGBA_CHANNELS;
      const ink =
        1 - lumaByte(source[base] ?? 0, source[base + 1] ?? 0, source[base + 2] ?? 0) / MAX_BYTE;
      const black =
        thresholds === null
          ? isInked(x, y, screen, ink)
          : arrayThreshold(thresholds, x, y, screen) < ink;
      writeMono(doc, base, black, alpha);
    }
  }
}

type ScreenSpec = {
  readonly spacing: number;
  readonly cos: number;
  readonly sin: number;
  readonly shape: 'dot' | 'line';
};

// Spot function: inside-the-spot test in rotated screen space. Covered area
// is proportional to ink — dot area (or line thickness) tracks it, which is
// what keeps mid-tones reading as mid-tones after the screen. At an angle off
// the pixel axes the pixels sample every part of the cell and coverage stays
// within about 1% of ink; on the axes they tie, and the threshold array below
// takes over.
function isInked(x: number, y: number, screen: ScreenSpec, ink: number): boolean {
  const u = x * screen.cos + y * screen.sin;
  const v = -x * screen.sin + y * screen.cos;
  const s = screen.spacing;
  if (screen.shape === 'line') {
    const offset = Math.abs(fractionalCell(v, s));
    return offset < (ink * s) / 2;
  }
  if (ink <= HOLE_CROSSOVER_INK) {
    const du = fractionalCell(u, s);
    const dv = fractionalCell(v, s);
    return du * du + dv * dv < (ink * s * s) / Math.PI;
  }
  // Shadow half: white holes at the cell corners shrink toward solid black.
  const hu = fractionalCell(u + s / 2, s);
  const hv = fractionalCell(v + s / 2, s);
  return hu * hu + hv * hv >= ((1 - ink) * s * s) / Math.PI;
}

// At 0° or 90° with a whole-pixel pitch every cell holds the same s × s
// pixels, and the spot test ties them in groups: a line's rows come in
// mirrored pairs, a dot's pixels in rings of four or eight. The line then
// thickens two rows at a time, so an 8 px screen draws 5 tones and solid
// black keeps a white row (quality audit Q3-P2-1). Ranking the cell's pixels
// by the same spot, ties taken in a spread-out order, gives each pixel its
// own threshold (rank + ½) / s²: a clustered-dot threshold array. Coverage
// is then ink to the nearest 1/s², s² + 1 tones, and full ink is solid.
function pixelAlignedThresholds(screen: ScreenSpec): Float64Array | null {
  const s = screen.spacing;
  const axisAligned = Math.abs(screen.sin) < AXIS_EPSILON || Math.abs(screen.cos) < AXIS_EPSILON;
  if (!axisAligned || !Number.isInteger(s)) return null;
  const cells = s * s;
  const ranks = Array.from({ length: cells }, (_, index) =>
    spotRank(index % s, Math.floor(index / s), screen),
  );
  const order = ranks.map((_, index) => index).sort((a, b) => compareRanks(ranks[a], ranks[b]));
  const thresholds = new Float64Array(cells);
  order.forEach((index, rank) => {
    thresholds[index] = (rank + 0.5) / cells;
  });
  return thresholds;
}

// [phase, spot distance, tie order]: lower inks first. A line inks outward
// from its centre. A dot inks its centre circle first (the highlight dots);
// the rest of the cell follows farthest-from-a-hole first, as the shadow
// holes shrink.
type SpotRank = readonly [number, number, number];

function spotRank(i: number, j: number, screen: ScreenSpec): SpotRank {
  const s = screen.spacing;
  const tie = fraction(i * R2_STEP_U + j * R2_STEP_V);
  if (screen.shape === 'line') return [0, Math.abs(fractionalCell(j, s)), tie];
  const du = fractionalCell(i, s);
  const dv = fractionalCell(j, s);
  const dotArea = (Math.PI * (du * du + dv * dv)) / (s * s);
  if (dotArea < HOLE_CROSSOVER_INK) return [0, dotArea, tie];
  const hu = fractionalCell(i + s / 2, s);
  const hv = fractionalCell(j + s / 2, s);
  return [1, -(Math.PI * (hu * hu + hv * hv)) / (s * s), tie];
}

function compareRanks(a: SpotRank | undefined, b: SpotRank | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// The pixel's cell position comes from the same rotation as isInked, rounded
// to whole pixels, so 90° lands on the grid despite cos(90°) not being 0.
function arrayThreshold(thresholds: Float64Array, x: number, y: number, screen: ScreenSpec) {
  const s = screen.spacing;
  const i = modulo(Math.round(x * screen.cos + y * screen.sin), s);
  const j = modulo(Math.round(-x * screen.sin + y * screen.cos), s);
  return thresholds[j * s + i] ?? 1;
}

// Signed distance to the nearest cell centre along one screen axis.
function fractionalCell(value: number, spacing: number): number {
  return value - Math.round(value / spacing) * spacing;
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

function writeMono(doc: RgbaBuffer, base: number, black: boolean, alpha: number): void {
  const target = black ? 0 : MAX_BYTE;
  for (let c = 0; c < RGB_CHANNELS; c += 1) {
    const sourceValue = doc.data[base + c] ?? 0;
    doc.data[base + c] =
      alpha === MAX_BYTE
        ? target
        : sourceValue + Math.round(((target - sourceValue) * alpha) / MAX_BYTE);
  }
}
