// Where the bed changed between two top-down pictures of it (ADR-490): the
// picture taken before a job and the one taken after, both flattened onto the
// same part of the bed by the same camera model, so they line up pixel for
// pixel. Both are softened 3 × 3 against JPEG noise, the overall brightness
// shift (the camera's own exposure) is taken out, and a pixel changed when its
// brightness moved further than the threshold. A lone changed pixel is noise,
// not a mark. Pure core.

import type { RgbaImage } from '../rgba-image';

/** Brightness steps (of 255) a pixel must move to count as changed. */
export const CHANGE_THRESHOLD = 24;

export type ChangeMask = {
  /** 1 where both pictures saw the bed. */
  readonly seen: Uint8Array;
  /** 1 where the bed changed. */
  readonly changed: Uint8Array;
  /** How much brighter the whole after picture is, in brightness steps. */
  readonly brightnessShift: number;
};

/**
 * Where `after` differs from `before`. `ignore` marks pixels left out of the
 * exposure estimate (the burn path, whose change is the point).
 */
export function changeMask(
  before: RgbaImage,
  after: RgbaImage,
  ignore: Uint8Array | null,
  threshold: number = CHANGE_THRESHOLD,
): ChangeMask {
  const { width, height } = before;
  const seen = seenInBoth(before, after);
  const lumaBefore = softenedLuma(before, seen);
  const lumaAfter = softenedLuma(after, seen);
  const shift = brightnessShift(lumaBefore, lumaAfter, seen, ignore);
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i += 1) {
    if (seen[i] !== 1) continue;
    const moved = (lumaAfter[i] ?? 0) - (lumaBefore[i] ?? 0) - shift;
    if (Math.abs(moved) > threshold) raw[i] = 1;
  }
  return { seen, changed: withoutLonePixels(raw, width, height), brightnessShift: shift };
}

function seenInBoth(before: RgbaImage, after: RgbaImage): Uint8Array {
  const count = before.width * before.height;
  const seen = new Uint8Array(count);
  if (after.width !== before.width || after.height !== before.height) return seen;
  for (let i = 0; i < count; i += 1) {
    if ((before.data[i * 4 + 3] ?? 0) > 0 && (after.data[i * 4 + 3] ?? 0) > 0) seen[i] = 1;
  }
  return seen;
}

// Rec. 601 luma averaged over the seen pixels of each 3 × 3 neighbourhood.
function softenedLuma(image: RgbaImage, seen: Uint8Array): Float32Array {
  const { width, height, data } = image;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    luma[i] =
      0.299 * (data[i * 4] ?? 0) + 0.587 * (data[i * 4 + 1] ?? 0) + 0.114 * (data[i * 4 + 2] ?? 0);
  }
  const soft = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      soft[y * width + x] = neighbourhoodMean(luma, seen, width, height, x, y);
    }
  }
  return soft;
}

function neighbourhoodMean(
  luma: Float32Array,
  seen: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let sum = 0;
  let count = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
      const index = ny * width + nx;
      if (seen[index] !== 1) continue;
      sum += luma[index] ?? 0;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

// The median brightness change away from the path: an exposure or lighting
// change moves every pixel alike, while the burn moves only its own.
function brightnessShift(
  before: Float32Array,
  after: Float32Array,
  seen: Uint8Array,
  ignore: Uint8Array | null,
): number {
  const histogram = new Uint32Array(511);
  let total = 0;
  const add = (i: number): void => {
    const step = Math.round((after[i] ?? 0) - (before[i] ?? 0));
    const bin = Math.max(-255, Math.min(255, step)) + 255;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    total += 1;
  };
  for (let i = 0; i < seen.length; i += 1) {
    if (seen[i] === 1 && ignore?.[i] !== 1) add(i);
  }
  if (total === 0) {
    for (let i = 0; i < seen.length; i += 1) if (seen[i] === 1) add(i);
  }
  if (total === 0) return 0;
  let running = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    running += histogram[bin] ?? 0;
    if (running * 2 >= total) return bin - 255;
  }
  return 0;
}

// A changed pixel stays when at least one of its 8 neighbours changed too.
function withoutLonePixels(raw: Uint8Array, width: number, height: number): Uint8Array {
  const kept = new Uint8Array(raw.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (raw[index] === 1 && hasMarkedNeighbour(raw, width, height, x, y)) kept[index] = 1;
    }
  }
  return kept;
}

function hasMarkedNeighbour(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
      if ((nx !== x || ny !== y) && mask[ny * width + nx] === 1) return true;
    }
  }
  return false;
}
