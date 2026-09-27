// Printed registration marks in a flattened camera picture of the bed
// (ADR-443): small dark shapes on bright paper, such as rings, crosses and
// dots. A mark is a dark group that is about as wide as it is tall, centred on
// itself (its dark pixels balance around the middle of its box, which rings,
// crosses and dots all do), and surrounded by clear paper. The clear-paper
// test is what keeps a honeycomb bed's holes and the printed artwork out. The
// centre is then the darkness-weighted mean over the mark's box, so it does
// not depend on where the threshold fell. Pure core.

import type { BedArea } from '../model/camera-model-accuracy';
import type { RgbaImage } from '../rgba-image';

export type Point = { readonly x: number; readonly y: number };

export type FoundMark = {
  /** Centre, bed mm. */
  readonly centre: Point;
  /** The larger side of the mark's box, mm. */
  readonly sizeMm: number;
  /** How far the dark pixels' centre sits from the box's centre, mm: 0 for a perfectly even mark. */
  readonly offCentreMm: number;
};

export type FindMarksInput = {
  readonly image: RgbaImage;
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  /** Marks between these sizes are kept, mm. */
  readonly minSizeMm: number;
  readonly maxSizeMm: number;
};

// A pixel is dark when it is this much below the brightest paper near it:
// a quarter of the paper's level, and never less than DARK_OFFSET grey levels.
const DARK_SHARE = 0.25;
const DARK_OFFSET = 30;
// Around a mark, from 1.25 to 2 half-sizes out, at most this share may be dark:
// a margin of clear paper as wide as half the mark.
const CLEAR_SHARE = 0.03;
// Box sides within this ratio of each other.
const MAX_ASPECT = 1.4;
// Dark centre within this share of the size from the box's centre.
const MAX_OFF_CENTRE = 0.12;

type Blob = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  sx: number;
  sy: number;
};

export function findMarks(input: FindMarksInput): FoundMark[] {
  const { image, pixelsPerMm: ppm } = input;
  const { width, height } = image;
  const grey = new Float32Array(width * height);
  const seen = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i += 1) {
    const o = i * 4;
    if ((image.data[o + 3] ?? 0) === 0) continue;
    seen[i] = 1;
    grey[i] =
      0.299 * (image.data[o] ?? 0) +
      0.587 * (image.data[o + 1] ?? 0) +
      0.114 * (image.data[o + 2] ?? 0);
  }
  // Reaches past the middle of the largest mark to the paper around it.
  const radiusPx = Math.max(4, Math.round(input.maxSizeMm * ppm));
  const dark = darkMask(grey, seen, width, height, radiusPx);
  const marks: FoundMark[] = [];
  for (const blob of blobs(dark, width, height)) {
    const mark = asMark(blob, { grey, seen, dark, width, height }, input);
    if (mark !== null) marks.push(mark);
  }
  return marks;
}

type Picture = {
  readonly grey: Float32Array;
  readonly seen: Uint8Array;
  readonly dark: Uint8Array;
  readonly width: number;
  readonly height: number;
};

function asMark(blob: Blob, picture: Picture, input: FindMarksInput): FoundMark | null {
  const ppm = input.pixelsPerMm;
  const w = blob.x1 - blob.x0 + 1;
  const h = blob.y1 - blob.y0 + 1;
  const sizePx = Math.max(w, h);
  const sizeMm = sizePx / ppm;
  if (sizeMm < input.minSizeMm || sizeMm > input.maxSizeMm) return null;
  if (Math.max(w, h) / Math.min(w, h) > MAX_ASPECT) return null;
  const boxX = (blob.x0 + blob.x1) / 2;
  const boxY = (blob.y0 + blob.y1) / 2;
  const offCentre = Math.hypot(blob.sx / blob.area - boxX, blob.sy / blob.area - boxY);
  if (offCentre > MAX_OFF_CENTRE * sizePx) return null;
  const paper = clearPaperLevel(picture, boxX, boxY, sizePx / 2);
  if (paper === null) return null;
  const centre = weightedCentre(picture, blob, paper);
  return {
    centre: {
      x: input.region.x + (centre.x + 0.5) / ppm,
      y: input.region.y + (centre.y + 0.5) / ppm,
    },
    sizeMm,
    offCentreMm: offCentre / ppm,
  };
}

// The mean grey of the ring of paper around a mark, or null when that ring
// runs off the picture, into what the camera did not see, or into other dark
// shapes.
function clearPaperLevel(picture: Picture, cx: number, cy: number, half: number): number | null {
  const inner = 1.25 * half;
  const outer = 2 * half + 1;
  let count = 0;
  let darkCount = 0;
  let sum = 0;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y += 1) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x += 1) {
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (d < inner || d > outer) continue;
      if (!seenAt(picture, x, y)) return null;
      const i = y * picture.width + x;
      count += 1;
      if (picture.dark[i] === 1) darkCount += 1;
      else sum += at(picture.grey, i);
    }
  }
  if (count === 0 || darkCount > CLEAR_SHARE * count) return null;
  return sum / (count - darkCount);
}

function seenAt(picture: Picture, x: number, y: number): boolean {
  const inside = x >= 0 && y >= 0 && x < picture.width && y < picture.height;
  return inside && picture.seen[y * picture.width + x] === 1;
}

function at(values: Float32Array, i: number): number {
  return values[i] ?? 0;
}

// Darkness below the paper, summed over the mark's box and a pixel around it.
function weightedCentre(picture: Picture, blob: Blob, paper: number): Point {
  let weight = 0;
  let sx = 0;
  let sy = 0;
  for (let y = blob.y0 - 1; y <= blob.y1 + 1; y += 1) {
    for (let x = blob.x0 - 1; x <= blob.x1 + 1; x += 1) {
      if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) continue;
      const w = Math.max(0, paper - (picture.grey[y * picture.width + x] ?? paper));
      weight += w;
      sx += w * x;
      sy += w * y;
    }
  }
  return weight > 0
    ? { x: sx / weight, y: sy / weight }
    : { x: blob.sx / blob.area, y: blob.sy / blob.area };
}

// 1 where a seen pixel is darker than the brightest paper near it by a
// quarter (and at least DARK_OFFSET grey levels). The brightest nearby value
// is the paper whether the bed or artwork is close or not, where a mean would
// be pulled down by them and lose thin, blurred lines.
function darkMask(
  grey: Float32Array,
  seen: Uint8Array,
  width: number,
  height: number,
  radiusPx: number,
): Uint8Array {
  const bright = new Float32Array(grey.length);
  for (let i = 0; i < grey.length; i += 1) bright[i] = seen[i] === 1 ? (grey[i] ?? 0) : 0;
  runningMax(bright, width, height, radiusPx, true);
  runningMax(bright, width, height, radiusPx, false);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    if (seen[i] !== 1) continue;
    const paper = bright[i] ?? 0;
    mask[i] = (grey[i] ?? 0) < paper - Math.max(DARK_OFFSET, DARK_SHARE * paper) ? 1 : 0;
  }
  return mask;
}

// In place: the maximum over a window of 2r+1 along rows or columns.
function runningMax(
  plane: Float32Array,
  width: number,
  height: number,
  r: number,
  rows: boolean,
): void {
  const length = rows ? width : height;
  const lines = rows ? height : width;
  const step = rows ? 1 : width;
  const scratch = {
    line: new Float32Array(length),
    prefix: new Float32Array(length),
    suffix: new Float32Array(length),
  };
  for (let l = 0; l < lines; l += 1) {
    const base = rows ? l * width : l;
    for (let i = 0; i < length; i += 1) scratch.line[i] = at(plane, base + i * step);
    windowMax(scratch, r);
    for (let i = 0; i < length; i += 1) plane[base + i * step] = at(scratch.line, i);
  }
}

// In place: each value of `line` becomes the maximum within r of it, in time
// independent of r (van Herk / Gil-Werman: block prefix and suffix maxima).
function windowMax(
  scratch: { line: Float32Array; prefix: Float32Array; suffix: Float32Array },
  r: number,
): void {
  const { line, prefix, suffix } = scratch;
  const n = line.length;
  const block = 2 * r + 1;
  for (let i = 0; i < n; i += 1) {
    prefix[i] = i % block === 0 ? at(line, i) : Math.max(at(prefix, i - 1), at(line, i));
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const blockEnd = i === n - 1 || (i + 1) % block === 0;
    suffix[i] = blockEnd ? at(line, i) : Math.max(at(suffix, i + 1), at(line, i));
  }
  for (let i = 0; i < n; i += 1) {
    line[i] = Math.max(at(suffix, Math.max(0, i - r)), at(prefix, Math.min(n - 1, i + r)));
  }
}

// 8-connected groups of dark pixels with their boxes and pixel sums.
function blobs(dark: Uint8Array, width: number, height: number): Blob[] {
  const visited = new Uint8Array(dark.length);
  const out: Blob[] = [];
  for (let start = 0; start < dark.length; start += 1) {
    if (dark[start] !== 1 || visited[start] === 1) continue;
    visited[start] = 1;
    out.push(flood(start, { dark, visited, width, height }));
  }
  return out;
}

function flood(
  start: number,
  grid: { dark: Uint8Array; visited: Uint8Array; width: number; height: number },
): Blob {
  const { dark, visited, width, height } = grid;
  const blob: Blob = { x0: width, y0: height, x1: -1, y1: -1, area: 0, sx: 0, sy: 0 };
  const queue = [start];
  for (const i of queue) {
    const x = i % width;
    const y = (i - x) / width;
    blob.x0 = Math.min(blob.x0, x);
    blob.y0 = Math.min(blob.y0, y);
    blob.x1 = Math.max(blob.x1, x);
    blob.y1 = Math.max(blob.y1, y);
    blob.area += 1;
    blob.sx += x;
    blob.sy += y;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (dark[j] !== 1 || visited[j] === 1) continue;
        visited[j] = 1;
        queue.push(j);
      }
    }
  }
  return blob;
}
