// The region passes of light-solid recovery (ADR-401): labelling the flat
// mid-tone areas, rejecting cut-outs, and spreading the accepted solids' iso
// over their transitions. Split from light-solid-fill.ts (the file line cap)
// when their inner loops were written out for speed (tracer speed round,
// 2026-11-05): the same reads and the same visiting order, without a closure
// call or a neighbour array per pixel.

import { nearThickMaterial } from './light-solid-pixels';
import type { SolidPlane } from './light-solid-fill';

/** Radius (source px) of the box mean the flatness test reads. A 5×5 mean
 *  divides independent pixel noise by five. */
export const SMOOTH_RADIUS_PX = 2;
/** Half-width (source px) up to which non-light material around a solid is
 *  an outline or divider; beyond it the material is a ground the solid is
 *  cut out of (a gold star in a black badge, pale letters on a dark plate). */
const OUTLINE_HALF_WIDTH_PX = 8;
/** Largest share of a solid's edge that may border such a ground. */
const MAX_GROUND_CONTACT = 0.5;
/** Iso on a solid's flat pixels: every luma is ink there. */
const SOLID_ISO = 255;

export const REJECTED = 0;
export const CANDIDATE = 1;
export const SURFACE = 2;

/** Flat mid-tone areas, as parallel arrays indexed by area id. */
export type Regions = {
  readonly count: number[];
  readonly sumSq: number[];
  readonly tone: number[];
  readonly rgb: number[];
  readonly border: boolean[];
  readonly status: number[];
};

export type Context = {
  readonly plane: SolidPlane;
  readonly smooth: Float32Array;
  readonly flat: Uint8Array;
  readonly labels: Int32Array;
  readonly queue: Int32Array;
  readonly scale: number;
};

/** Flat pixels whose smoothed luma lies in (lower, upper]. */
type ToneBand = { readonly lower: number; readonly upper: number };

/** 4-connected components of flat mid-tone pixels, with their statistics. */
export function labelRegions(ctx: Context, band: ToneBand): Regions {
  const { labels, smooth } = ctx;
  const regions: Regions = { count: [], sumSq: [], tone: [], rgb: [], border: [], status: [] };
  for (let start = 0; start < smooth.length; start += 1) {
    if (labels[start] !== -1 || !isMidTone(ctx, band, start)) continue;
    floodRegion(ctx, band, start, regions);
  }
  return regions;
}

function isMidTone(ctx: Context, band: ToneBand, i: number): boolean {
  const v = ctx.smooth[i] as number;
  return ctx.flat[i] === 1 && v > band.lower && v <= band.upper;
}

// One region from `start`, breadth first, neighbours left, right, up, down;
// its sums run in the order its pixels are reached.
function floodRegion(ctx: Context, band: ToneBand, start: number, regions: Regions): void {
  const { plane, labels, queue, smooth } = ctx;
  const { width, height, rgba } = plane;
  const id = regions.count.length;
  const lastRow = (height - 1) * width;
  const sums = { sum: 0, sumSq: 0, r: 0, g: 0, b: 0 };
  let border = false;
  labels[start] = id;
  queue[0] = start;
  let tail = 1;
  const claim = (n: number): void => {
    if (labels[n] !== -1 || !isMidTone(ctx, band, n)) return;
    labels[n] = id;
    queue[tail] = n;
    tail += 1;
  };
  for (let head = 0; head < tail; head += 1) {
    const i = queue[head] as number;
    addPixel(sums, smooth[i] as number, rgba, 4 * i);
    const x = i % width;
    if (x === 0 || x === width - 1 || i < width || i >= lastRow) border = true;
    if (x > 0) claim(i - 1);
    if (x < width - 1) claim(i + 1);
    if (i >= width) claim(i - width);
    if (i < lastRow) claim(i + width);
  }
  regions.rgb.push(sums.r, sums.g, sums.b);
  regions.count.push(tail);
  regions.sumSq.push(sums.sumSq);
  regions.tone.push(sums.sum / tail);
  regions.border.push(border);
  regions.status.push(REJECTED);
}

type RegionSums = { sum: number; sumSq: number; r: number; g: number; b: number };

// A pixel's smoothed luma and its RGB; transparent pixels are paper.
function addPixel(sums: RegionSums, v: number, rgba: Uint8ClampedArray, o: number): void {
  sums.sum += v;
  sums.sumSq += v * v;
  const clear = rgba[o + 3] === 0;
  sums.r += clear ? 255 : (rgba[o] as number);
  sums.g += clear ? 255 : (rgba[o + 1] as number);
  sums.b += clear ? 255 : (rgba[o + 2] as number);
}

/** Reject candidates whose edge mostly borders a dark ground rather than
 *  paper or a thin line: they are light shapes cut out of dark ink, which a
 *  brightness threshold leaves open too. Light pixels are paper-toned pixels
 *  and candidate solids. */
export function rejectCutOuts(ctx: Context, regions: Regions, paperLike: number): void {
  const { plane, smooth, labels, scale } = ctx;
  const candidate = new Uint8Array(regions.count.length);
  regions.status.forEach((status, id) => {
    if (status === CANDIDATE) candidate[id] = 1;
  });
  const light = new Uint8Array(labels.length);
  for (let i = 0; i < light.length; i += 1) {
    const id = labels[i] as number;
    light[i] = (smooth[i] as number) > paperLike || (id >= 0 && candidate[id] === 1) ? 1 : 0;
  }
  const halfWidth = Math.round(OUTLINE_HALF_WIDTH_PX * scale);
  const span = { halfWidth, reach: halfWidth + Math.ceil(2 * scale) };
  const near = nearThickMaterial(light, plane.width, plane.height, span);
  const { edge, grounded } = edgeContacts(ctx, candidate, near);
  edge.forEach((count, id) => {
    if ((grounded[id] as number) > MAX_GROUND_CONTACT * count) regions.status[id] = REJECTED;
  });
}

// Per candidate, its edge pixels (a 4-neighbour inside the image carries
// another label) and those of them near thick material.
function edgeContacts(
  ctx: Context,
  candidate: Uint8Array,
  near: Uint8Array,
): { readonly edge: Int32Array; readonly grounded: Int32Array } {
  const { labels } = ctx;
  const { width, height } = ctx.plane;
  const edge = new Int32Array(candidate.length);
  const grounded = new Int32Array(candidate.length);
  const lastRow = (height - 1) * width;
  for (let i = 0; i < labels.length; i += 1) {
    const id = labels[i] as number;
    if (id < 0 || candidate[id] !== 1 || !onRegionEdge(labels, i, id, width, lastRow)) continue;
    edge[id] = (edge[id] as number) + 1;
    if (near[i] === 1) grounded[id] = (grounded[id] as number) + 1;
  }
  return { edge, grounded };
}

function onRegionEdge(
  labels: Int32Array,
  i: number,
  id: number,
  width: number,
  lastRow: number,
): boolean {
  const x = i % width;
  return (
    (x > 0 && labels[i - 1] !== id) ||
    (x < width - 1 && labels[i + 1] !== id) ||
    (i >= width && labels[i - width] !== id) ||
    (i < lastRow && labels[i + width] !== id)
  );
}

const DX8 = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY8 = [0, 0, -1, 1, -1, -1, 1, 1];

/** Iso field: SOLID_ISO on accepted solids' flat pixels, and their tone/paper
 *  midpoint on the transition pixels each solid owns. Ownership spreads from
 *  every flat mid-tone area at once, one ring per step, through non-flat
 *  pixels only, so a transition pixel belongs to the nearest area. */
export function solidIso(ctx: Context, regions: Regions, paperLuma: number): Float32Array {
  const { labels, queue, scale } = ctx;
  const iso = new Float32Array(labels.length).fill(-Infinity);
  // The level an owner's transition takes, or null for a rejected owner.
  const levels = regions.tone.map((tone, id) =>
    regions.status[id] === CANDIDATE ? Math.fround((tone + paperLuma) / 2) : null,
  );
  let tail = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const id = labels[i] as number;
    if (id < 0) continue;
    if (regions.status[id] === CANDIDATE) iso[i] = SOLID_ISO;
    queue[tail] = i;
    tail += 1;
  }
  // The transition around a flat area spans the smoothing window on both
  // sides of the edge, plus a pixel of anti-aliasing.
  const reach = Math.ceil((2 * SMOOTH_RADIUS_PX + 2) * scale);
  let head = 0;
  for (let ring = 0; ring < reach && head < tail; ring += 1) {
    const end = tail;
    for (; head < end; head += 1) tail = spreadOwner(ctx, iso, levels, queue[head] as number, tail);
  }
  return iso;
}

// Give pixel i's owner every unowned non-flat 8-neighbour, in
// light-solid-pixels.ts neighbours8's order; returns the new queue length.
function spreadOwner(
  ctx: Context,
  iso: Float32Array,
  levels: ReadonlyArray<number | null>,
  i: number,
  tail: number,
): number {
  const { flat, labels, queue } = ctx;
  const { width, height } = ctx.plane;
  const owner = labels[i] as number;
  const level = levels[owner] ?? null;
  const x = i % width;
  const y = (i - x) / width;
  let end = tail;
  for (let k = 0; k < 8; k += 1) {
    const nx = x + (DX8[k] as number);
    const ny = y + (DY8[k] as number);
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const n = ny * width + nx;
    if (flat[n] === 1 || labels[n] !== -1) continue;
    labels[n] = owner;
    if (level !== null) iso[n] = level;
    queue[end] = n;
    end += 1;
  }
  return end;
}
