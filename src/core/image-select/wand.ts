// Magic-wand selection (ADR-242, flow F-L2).
//
// Tolerance-based region grow: a pixel matches when no RGB channel differs
// from the seed colour by more than the tolerance (alpha ignored — the
// document is opaque). Contiguous mode grows 4-connected from the seed with
// a scanline flood (whole runs filled, only neighbouring run endpoints
// pushed); global mode selects every matching pixel in the document.

import { RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';
import { createEmptyMask, MASK_SOLID, type SelectionMask } from './selection-mask';

export type WandOptions = {
  /** 0..255 max per-channel difference from the seed colour. */
  readonly tolerance: number;
  readonly contiguous: boolean;
};

export function wandSelection(
  buffer: RgbaBuffer,
  seedX: number,
  seedY: number,
  options: WandOptions,
): SelectionMask {
  const mask = createEmptyMask(buffer.width, buffer.height);
  const x = Math.floor(seedX);
  const y = Math.floor(seedY);
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return mask;
  const tolerance = Math.min(255, Math.max(0, options.tolerance));
  const matches = matcherFor(buffer, (y * buffer.width + x) * RGBA_CHANNELS, tolerance);
  if (options.contiguous) floodFrom(mask, x, y, matches);
  else selectGlobally(mask, matches);
  return mask;
}

function matcherFor(
  buffer: RgbaBuffer,
  seedBase: number,
  tolerance: number,
): (pixel: number) => boolean {
  const r = buffer.data[seedBase] ?? 0;
  const g = buffer.data[seedBase + 1] ?? 0;
  const b = buffer.data[seedBase + 2] ?? 0;
  return (pixel: number) => {
    const base = pixel * RGBA_CHANNELS;
    return (
      Math.abs((buffer.data[base] ?? 0) - r) <= tolerance &&
      Math.abs((buffer.data[base + 1] ?? 0) - g) <= tolerance &&
      Math.abs((buffer.data[base + 2] ?? 0) - b) <= tolerance
    );
  };
}

function selectGlobally(mask: SelectionMask, matches: (pixel: number) => boolean): void {
  for (let pixel = 0; pixel < mask.alpha.length; pixel += 1) {
    if (matches(pixel)) mask.alpha[pixel] = MASK_SOLID;
  }
}

type Run = { readonly left: number; readonly right: number; readonly y: number };

// Expand a matching pixel to its full unselected matching run on its row.
function expandRun(mask: SelectionMask, start: number, matches: (pixel: number) => boolean): Run {
  const { width, alpha } = mask;
  const y = Math.floor(start / width);
  const rowStart = y * width;
  const rowEnd = rowStart + width - 1;
  let left = start;
  while (left > rowStart && (alpha[left - 1] ?? 0) === 0 && matches(left - 1)) left -= 1;
  let right = start;
  while (right < rowEnd && (alpha[right + 1] ?? 0) === 0 && matches(right + 1)) right += 1;
  return { left, right, y };
}

function floodFrom(
  mask: SelectionMask,
  seedX: number,
  seedY: number,
  matches: (pixel: number) => boolean,
): void {
  const { width, height, alpha } = mask;
  const stack: number[] = [seedY * width + seedX];
  // Push candidate seeds from the row `dy` above/below a filled run.
  const pushCandidates = (run: Run, dy: number): void => {
    const row = run.y + dy;
    if (row < 0 || row >= height) return;
    const offset = dy * width;
    for (let pixel = run.left; pixel <= run.right; pixel += 1) {
      const neighbour = pixel + offset;
      if ((alpha[neighbour] ?? 0) === 0 && matches(neighbour)) stack.push(neighbour);
    }
  };
  while (stack.length > 0) {
    const start = stack.pop();
    if (start === undefined) break;
    if ((alpha[start] ?? 0) !== 0 || !matches(start)) continue;
    const run = expandRun(mask, start, matches);
    alpha.fill(MASK_SOLID, run.left, run.right + 1);
    pushCandidates(run, -1);
    pushCandidates(run, 1);
  }
}
