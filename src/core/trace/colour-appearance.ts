// Colour layers trace visible sRGB over white, retaining the alpha-64 floor.
// The decoder already composites RGB and tags it; straight RGBA needs exactly
// one composite. Normalize before averaging so alpha is never applied twice.
// Large images read this appearance on demand into a bounded two-row cache,
// avoiding an additional full-source RGBA allocation before the working cap.
// Anti-aliased fringe against transparency stays void (ADR-461 Amendment 1):
// a partial pixel reached from alpha=0 whose alpha is under half that of
// nearby ink of the same colour keeps the edge at ~50 % coverage, while
// visible translucent ink itself (alpha >= 64 near its local peak, or a
// translucent colour hugging different opaque ink) is still traced. The rest
// of that edge shows its ink's own colour (lifted to the plateau's opacity),
// and the resampled working grid applies the same half-coverage rule per cell.
// Mask and lift cost 1 byte a pixel plus a map entry per edge pixel, and only
// on images that hold alpha=0 beside partial alpha.

import { axisContributions, type AxisTap } from '../image-resample/resample-axis';
import type { RawImageData } from './trace-image';

const CHANNELS = 4;
const MAX_BYTE = 255;
/** Keep the quarter-opacity floor from ADR-461 Amendment 1. */
export const VISIBLE_ALPHA_MIN = 64;
// The nearby ink's opacity is the peak alpha within this many pixels.
const FRINGE_REACH = 2;
// A working cell is ink when at least this share of its area is visible.
const HALF_COVERAGE = 0.5;
// Straight-colour distance under which two pixels count as the same ink,
// widened by the rounding error that un-compositing a faint pixel amplifies.
const SAME_INK_TOLERANCE = 40;

/** Native-resolution appearance; opaque/void-only inputs need no new buffer. */
export function colourAppearance(source: RawImageData): RawImageData {
  const { fringe, lift } = transparencyEdges(source);
  let data: Uint8ClampedArray | undefined;
  for (let offset = 0; offset < source.data.length; offset += CHANNELS) {
    const alpha = source.data[offset + 3] as number;
    if (alpha === 0 || alpha === MAX_BYTE) continue;
    data ??= source.data.slice();
    if (alpha < VISIBLE_ALPHA_MIN || fringe?.[offset / CHANNELS] === 1) {
      data[offset + 3] = 0;
      continue;
    }
    const shown = lift?.get(offset / CHANNELS) ?? alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = visibleChannel(source, offset, channel, alpha, shown);
    }
    data[offset + 3] = MAX_BYTE;
  }
  return data === undefined ? source : { ...source, data, rgbCompositedOnWhite: true };
}

/** Area-resample visible colour. A cell is ink when at least half of its area
 *  is visible (the native half-coverage edge, ADR-461 Amendment 1) and takes
 *  the mean appearance of its visible pixels; any other cell stays void. */
export function resampleColourAppearance(
  source: RawImageData,
  width: number,
  height: number,
): RawImageData {
  const edges = transparencyEdges(source);
  const horizontal = axisContributions(source.width, width);
  const vertical = axisContributions(source.height, height);
  const rows = new Map<number, Float64Array>();
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  const accumulated = new Float64Array(width * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    accumulated.fill(0);
    for (const tap of vertical[y] ?? []) {
      const row = cachedRow(source, edges, tap.index, horizontal, rows);
      for (let i = 0; i < accumulated.length; i += 1) {
        accumulated[i] = (accumulated[i] as number) + (row[i] as number) * tap.weight;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const cell = x * CHANNELS;
      const visible = accumulated[cell + 3] as number;
      if (visible <= 0 || visible < HALF_COVERAGE * cellWeight(horizontal[x], vertical[y])) {
        continue;
      }
      const out = (y * width + x) * CHANNELS;
      for (let channel = 0; channel < 3; channel += 1) {
        data[out + channel] = Math.round((accumulated[cell + channel] as number) / visible);
      }
      data[out + 3] = MAX_BYTE;
    }
  }
  return { width, height, data, rgbCompositedOnWhite: true };
}

function cellWeight(
  columns: readonly AxisTap[] | undefined,
  rows: readonly AxisTap[] | undefined,
): number {
  const sum = (taps: readonly AxisTap[] | undefined): number =>
    (taps ?? []).reduce((total, tap) => total + tap.weight, 0);
  return sum(columns) * sum(rows);
}

function cachedRow(
  source: RawImageData,
  edges: TransparencyEdges,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  cache: Map<number, Float64Array>,
): Float64Array {
  const existing = cache.get(y);
  if (existing !== undefined) return existing;
  let row: Float64Array | undefined;
  if (cache.size >= 2) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      row = cache.get(oldest);
      cache.delete(oldest);
    }
  }
  row ??= new Float64Array(contributions.length * CHANNELS);
  horizontalRow(source, edges, y, contributions, row);
  cache.set(y, row);
  return row;
}

function horizontalRow(
  source: RawImageData,
  { fringe, lift }: TransparencyEdges,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  row: Float64Array,
): void {
  row.fill(0);
  contributions.forEach((taps, x) => {
    const out = x * CHANNELS;
    for (const tap of taps) {
      const pixel = y * source.width + tap.index;
      const src = pixel * CHANNELS;
      const alpha = fringe?.[pixel] === 1 ? 0 : (source.data[src + 3] as number);
      // Coverage is binary here: partial alpha has already contributed to the
      // visible RGB. Weighting it again would disagree with flattened artwork.
      // A void source pixel adds neither colour (its RGB is hidden) nor
      // coverage; the cell's colour is the mean of its visible pixels.
      if (alpha < VISIBLE_ALPHA_MIN) continue;
      const shown = lift?.get(pixel) ?? alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = visibleChannel(source, src, channel, alpha, shown);
        row[out + channel] = (row[out + channel] as number) + value * tap.weight;
      }
      row[out + 3] = (row[out + 3] as number) + tap.weight;
    }
  });
}

// The pixel's colour composited on white at opacity `shown`: its own alpha,
// or the lifted opacity of the ink whose anti-aliased edge it is.
function visibleChannel(
  source: RawImageData,
  offset: number,
  channel: number,
  alpha: number,
  shown = alpha,
): number {
  const value = source.data[offset + channel] as number;
  if (source.rgbCompositedOnWhite === true) {
    if (shown === alpha) return value;
    return Math.round(MAX_BYTE - ((MAX_BYTE - value) * shown) / alpha);
  }
  if (shown === MAX_BYTE) return value;
  const coverage = shown / MAX_BYTE;
  // Match the byte-valued decoder representation before any averaging.
  return Math.round(value * coverage + MAX_BYTE * (1 - coverage));
}

type TransparencyEdges = {
  /** 1 where a partial pixel is void fringe; null when there is none. */
  readonly fringe: Uint8Array | null;
  /** Edge pixel -> the opacity of the solid ink it anti-aliases. */
  readonly lift: Map<number, number> | null;
};

/** The fringe mask alone (see `transparencyEdges`). */
export function transparencyFringe(source: RawImageData): Uint8Array | null {
  return transparencyEdges(source).fringe;
}

/** Anti-aliased edges against transparency (ADR-461 Amendment 1).
 *  Fringe: partial-alpha pixels under half the alpha of nearby ink of the
 *  same colour that connect (8-way, through such fringe) to an alpha=0 pixel;
 *  they stay void. Alpha >= 128 is never fringe, so this voids a subset of
 *  what the former alpha-128 cutoff voided. Lift: the edge's remaining partial
 *  pixels (from the void or fringe inwards, alpha rising) take the opacity of
 *  a same-colour plateau within reach, so an edge shows its ink's colour, not
 *  a lighter mixture that a requested colour count would split off as a crumb
 *  layer. Images without alpha=0 return after one scan; otherwise only pixels
 *  beside alpha=0 and the flood frontiers are tested, and the 1-byte-a-pixel
 *  mask exists only when alpha=0 lies beside partial alpha. */
export function transparencyEdges(source: RawImageData): TransparencyEdges {
  const n = source.width * source.height;
  let hasVoid = false;
  for (let p = 0; p < n && !hasVoid; p += 1) hasVoid = source.data[p * CHANNELS + 3] === 0;
  const flood = hasVoid ? floodFringe(source) : null;
  if (flood === null) return { fringe: null, lift: null };
  const { mask, found, kept } = flood;
  const lift = liftEdges(source, mask, kept);
  for (let p = 0; p < n; p += 1) {
    if ((mask[p] as number) > 1) mask[p] = 0;
  }
  return { fringe: found ? mask : null, lift: lift.size > 0 ? lift : null };
}

// Flood the fringe from every partial pixel beside alpha=0. mask: 1 = fringe,
// 2 = tested and kept; `kept` lists the kept partial pixels (lift seeds).
function floodFringe(
  source: RawImageData,
): { mask: Uint8Array; found: boolean; kept: number[] } | null {
  const n = source.width * source.height;
  const alphaAt = (p: number): number => source.data[p * CHANNELS + 3] as number;
  const partial = (p: number): boolean => alphaAt(p) > 0 && alphaAt(p) < MAX_BYTE;
  let mask: Uint8Array | null = null;
  let found = false;
  const kept: number[] = [];
  const stack: number[] = [];
  const claim = (m: Uint8Array, p: number): boolean => {
    if (m[p] !== 0) return false;
    const fringe = partial(p) && isFringe(source, p);
    m[p] = fringe ? 1 : 2;
    if (!fringe && partial(p)) kept.push(p);
    return fringe;
  };
  for (let p = 0; p < n; p += 1) {
    if (!partial(p) || (mask !== null && mask[p] !== 0)) continue;
    if (!touches(source, p, (q) => alphaAt(q) === 0)) continue;
    const m = (mask ??= new Uint8Array(n));
    if (!claim(m, p)) continue;
    found = true;
    stack.push(p);
    while (stack.length > 0) {
      touches(source, stack.pop() as number, (q) => {
        if (claim(m, q)) stack.push(q);
        return false;
      });
    }
  }
  return mask === null ? null : { mask, found, kept };
}

// Flood from the kept edge pixels inwards (alpha rising), lifting each to the
// alpha of a same-colour plateau within reach; mask value 3 marks visited.
function liftEdges(
  source: RawImageData,
  mask: Uint8Array,
  seeds: readonly number[],
): Map<number, number> {
  const lift = new Map<number, number>();
  const stack = seeds.slice();
  for (const p of stack) mask[p] = 3;
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const alpha = source.data[p * CHANNELS + 3] as number;
    const peak = plateauPeak(source, p);
    if (peak <= alpha) continue;
    lift.set(p, peak);
    touches(source, p, (q) => {
      const a = source.data[q * CHANNELS + 3] as number;
      if (mask[q] === 0 && a > alpha && a < MAX_BYTE) {
        mask[q] = 3;
        stack.push(q);
      }
      return false;
    });
  }
  return lift;
}

// Highest alpha of a same-colour plateau pixel (no 8-neighbour more opaque)
// within reach of p; a smooth glow or shadow gradient has none nearby.
function plateauPeak(source: RawImageData, p: number): number {
  const { width, height, data } = source;
  const x = p % width;
  const y = (p - x) / width;
  let peak = 0;
  const y1 = Math.min(height - 1, y + FRINGE_REACH);
  const x1 = Math.min(width - 1, x + FRINGE_REACH);
  for (let yy = Math.max(0, y - FRINGE_REACH); yy <= y1; yy += 1) {
    for (let xx = Math.max(0, x - FRINGE_REACH); xx <= x1; xx += 1) {
      const q = yy * width + xx;
      const a = data[q * CHANNELS + 3] as number;
      if (a <= peak || !sameInk(source, p, q)) continue;
      if (!touches(source, q, (r) => (data[r * CHANNELS + 3] as number) > a)) peak = a;
    }
  }
  return peak;
}

// Fringe: alpha under half the alpha of same-colour ink within reach.
function isFringe(source: RawImageData, p: number): boolean {
  const alpha = source.data[p * CHANNELS + 3] as number;
  const x = p % source.width;
  const y = (p - x) / source.width;
  const y1 = Math.min(source.height - 1, y + FRINGE_REACH);
  const x1 = Math.min(source.width - 1, x + FRINGE_REACH);
  for (let yy = Math.max(0, y - FRINGE_REACH); yy <= y1; yy += 1) {
    for (let xx = Math.max(0, x - FRINGE_REACH); xx <= x1; xx += 1) {
      const q = yy * source.width + xx;
      const peak = source.data[q * CHANNELS + 3] as number;
      if (peak > 2 * alpha && sameInk(source, p, q)) return true;
    }
  }
  return false;
}

// Same straight (un-composited) colour, within the rounding of faint pixels.
function sameInk(source: RawImageData, p: number, q: number): boolean {
  const alphaP = source.data[p * CHANNELS + 3] as number;
  const alphaQ = source.data[q * CHANNELS + 3] as number;
  const tolerance = SAME_INK_TOLERANCE + MAX_BYTE / alphaP + MAX_BYTE / alphaQ;
  for (let channel = 0; channel < 3; channel += 1) {
    const a = straightChannel(source, p * CHANNELS, channel, alphaP);
    const b = straightChannel(source, q * CHANNELS, channel, alphaQ);
    if (Math.abs(a - b) > tolerance) return false;
  }
  return true;
}

function straightChannel(
  source: RawImageData,
  offset: number,
  channel: number,
  alpha: number,
): number {
  const value = source.data[offset + channel] as number;
  if (source.rgbCompositedOnWhite !== true || alpha === MAX_BYTE) return value;
  return MAX_BYTE - ((MAX_BYTE - value) * MAX_BYTE) / alpha;
}

// True when any 8-neighbour of p satisfies `test` (every neighbour is visited
// until one does).
function touches(source: RawImageData, p: number, test: (q: number) => boolean): boolean {
  const x = p % source.width;
  const y = (p - x) / source.width;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(source.height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(source.width - 1, x + 1); xx += 1) {
      if ((xx !== x || yy !== y) && test(yy * source.width + xx)) return true;
    }
  }
  return false;
}
