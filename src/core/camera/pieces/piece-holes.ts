// A hole in a piece is where the bed shows through it (ADR-442 Amendment 3).
// Anything else the mask leaves out inside a piece, such as a dark knot, a
// burn or a printed mark, is the piece's own material: it is filled in before
// the piece's depth, holes and placement point are measured. Read as a hole, a
// knot at a blank's middle gave the neck cut a ring to split along and the fit
// check a hole to keep the design off (camera audit v2 K6-P1-2, K6-P3-1). A
// region counts as bed when its mean colour lies within the bed's own
// contrast of the bed's colour, judged on its core (the pixels with no piece
// pixel beside them), so the wood blurred into its edge does not count. A
// thin gap between blanks has no core and is never filled; nor is a region
// inside more than one piece, such as a scorch mark between blanks touching
// at their corners. Pure core.

// A region needs at least this many core pixels to be judged by its colour.
const MIN_CORE_PIXELS = 4;

import { colourDistance, type Colour } from './piece-mask';

/**
 * Fills, in `on`, every region the pieces enclose (not reaching the
 * picture's edge or an unseen pixel) whose colour is not the bed's. Returns
 * the pixels filled (1).
 */
export function fillMaterialHoles(
  on: Uint8Array,
  visible: Uint8Array,
  width: number,
  rgb: Float32Array,
  bed: Colour | null,
  bedContrast: number,
): Uint8Array {
  const filled = new Uint8Array(on.length);
  if (bed === null) return filled;
  const height = on.length / width;
  const outside = reachedFromEdge(on, visible, width, height);
  const owner = labelPieces(on, width, height);
  const seen = new Uint8Array(on.length);
  for (let start = 0; start < on.length; start += 1) {
    if (on[start] === 1 || outside[start] === 1 || seen[start] === 1) continue;
    const region = enclosedRegion(on, seen, width, height, start);
    if (!insideOnePiece(region, owner, width, height)) continue;
    const core = region.filter((i) => neighbours(i, width, height).every((j) => on[j] !== 1));
    if (core.length < MIN_CORE_PIXELS) continue;
    if (colourDistance(meanColour(rgb, core), bed) <= bedContrast) continue;
    for (const i of region) {
      on[i] = 1;
      filled[i] = 1;
    }
  }
  return filled;
}

// Off pixels joined to the picture's edge or to a pixel the camera did not see.
function reachedFromEdge(
  on: Uint8Array,
  visible: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const outside = new Uint8Array(on.length);
  const queue: number[] = [];
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] !== 1 && (onPictureEdge(i, width, height) || visible[i] !== 1)) {
      outside[i] = 1;
      queue.push(i);
    }
  }
  for (const i of queue) {
    for (const j of neighbours(i, width, height)) {
      if (on[j] === 1 || outside[j] === 1) continue;
      outside[j] = 1;
      queue.push(j);
    }
  }
  return outside;
}

// Each piece pixel's 4-connected group, numbered from 1; 0 off the pieces.
function onPictureEdge(i: number, width: number, height: number): boolean {
  const x = i % width;
  return x === 0 || x === width - 1 || i < width || i >= (height - 1) * width;
}

function labelPieces(on: Uint8Array, width: number, height: number): Int32Array {
  const owner = new Int32Array(on.length);
  let label = 0;
  for (let start = 0; start < on.length; start += 1) {
    if (on[start] !== 1 || owner[start] !== 0) continue;
    label += 1;
    owner[start] = label;
    const queue = [start];
    for (const i of queue) {
      for (const j of neighbours(i, width, height)) {
        if (on[j] !== 1 || owner[j] !== 0) continue;
        owner[j] = label;
        queue.push(j);
      }
    }
  }
  return owner;
}

function insideOnePiece(
  region: ReadonlyArray<number>,
  owner: Int32Array,
  width: number,
  height: number,
): boolean {
  let only = 0;
  for (const i of region) {
    for (const j of neighbours(i, width, height)) {
      const label = owner[j] ?? 0;
      if (label === 0 || label === only) continue;
      if (only !== 0) return false;
      only = label;
    }
  }
  return only !== 0;
}

function enclosedRegion(
  on: Uint8Array,
  seen: Uint8Array,
  width: number,
  height: number,
  start: number,
): number[] {
  const region = [start];
  seen[start] = 1;
  for (const i of region) {
    for (const j of neighbours(i, width, height)) {
      if (on[j] === 1 || seen[j] === 1) continue;
      seen[j] = 1;
      region.push(j);
    }
  }
  return region;
}

function meanColour(rgb: Float32Array, pixels: ReadonlyArray<number>): Colour {
  const sum = [0, 0, 0];
  for (const i of pixels) {
    for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (rgb[i * 3 + c] ?? 0);
  }
  const n = Math.max(1, pixels.length);
  return [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
}

function neighbours(i: number, width: number, height: number): number[] {
  const x = i % width;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < width - 1) out.push(i + 1);
  if (i >= width) out.push(i - width);
  if (i < (height - 1) * width) out.push(i + width);
  return out;
}
