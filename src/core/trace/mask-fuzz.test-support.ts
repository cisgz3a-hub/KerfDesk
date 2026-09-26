// Deterministic random ink masks for the output-identity proofs of the tracer
// speed work (ADR-438 amendment, speed wave 2). Every mask family that has
// broken a lattice or distance algorithm before is represented: dense noise
// (saddles everywhere), sparse noise (1-px specks), solid blobs and rings,
// 1-px lines, ink flush against the border, all-ink and all-paper grids, and
// degenerate 1xN / Nx1 shapes.

import type { InkMask } from './centerline';

/** Small seeded PRNG (mulberry32) so every fuzz run is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MASK_FAMILIES = [
  'noise',
  'sparse',
  'dense',
  'blobs',
  'lines',
  'border',
  'checker',
  'all-ink',
  'all-paper',
] as const;

export type MaskFamily = (typeof MASK_FAMILIES)[number];

type Canvas = {
  readonly width: number;
  readonly height: number;
  readonly ink: Uint8Array;
  readonly random: () => number;
  readonly maxSide: number;
};

function set({ width, height, ink }: Canvas, x: number, y: number): void {
  if (x >= 0 && y >= 0 && x < width && y < height) ink[y * width + x] = 1;
}

function fillRandom({ ink, random }: Canvas, density: number): void {
  for (let i = 0; i < ink.length; i += 1) ink[i] = random() < density ? 1 : 0;
}

function pick(random: () => number, max: number): number {
  return 1 + Math.floor(random() * max);
}

function paintBlobs(canvas: Canvas): void {
  const { width, height, random, maxSide } = canvas;
  for (let blob = pick(random, 4); blob > 0; blob -= 1) {
    const cx = random() * width;
    const cy = random() * height;
    const outer = 1 + random() * maxSide * 0.4;
    const inner = random() < 0.4 ? outer * random() : -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (r <= outer && r > inner) set(canvas, x, y);
      }
    }
  }
}

function paintLines(canvas: Canvas): void {
  const { width, height, random, maxSide } = canvas;
  for (let line = pick(random, 5); line > 0; line -= 1) {
    let x = Math.floor(random() * width);
    let y = Math.floor(random() * height);
    const dx = Math.floor(random() * 3) - 1;
    const dy = Math.floor(random() * 3) - 1;
    for (let step = pick(random, maxSide); step > 0; step -= 1) {
      set(canvas, x, y);
      x += dx;
      y += dy;
    }
  }
}

function paintBorder(canvas: Canvas): void {
  const { width, height, random } = canvas;
  fillRandom(canvas, 0.3);
  for (let x = 0; x < width; x += 1) {
    if (random() < 0.8) set(canvas, x, 0);
    if (random() < 0.8) set(canvas, x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    if (random() < 0.8) set(canvas, 0, y);
    if (random() < 0.8) set(canvas, width - 1, y);
  }
}

function paintChecker(canvas: Canvas): void {
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if ((x + y) % 2 === 0 && canvas.random() < 0.9) set(canvas, x, y);
    }
  }
}

const PAINTERS: Record<MaskFamily, (canvas: Canvas) => void> = {
  noise: (canvas) => fillRandom(canvas, 0.5),
  sparse: (canvas) => fillRandom(canvas, 0.12),
  dense: (canvas) => fillRandom(canvas, 0.85),
  blobs: paintBlobs,
  lines: paintLines,
  border: paintBorder,
  checker: paintChecker,
  'all-ink': (canvas) => canvas.ink.fill(1),
  'all-paper': () => undefined,
};

/** A random mask of the given family; width and height are drawn from 1..maxSide. */
export function fuzzMask(seed: number, family: MaskFamily, maxSide = 24): InkMask {
  const random = seededRandom(seed);
  const width = pick(random, maxSide);
  const height = pick(random, maxSide);
  const ink = new Uint8Array(width * height);
  PAINTERS[family]({ width, height, ink, random, maxSide });
  return { width, height, ink };
}

/** `count` masks cycling through every family, seeded from `seed`. */
export function fuzzMasks(count: number, seed: number, maxSide = 24): InkMask[] {
  const masks: InkMask[] = [];
  for (let i = 0; i < count; i += 1) {
    const family = MASK_FAMILIES[i % MASK_FAMILIES.length] as MaskFamily;
    masks.push(fuzzMask(seed * 1_000_003 + i, family, maxSide));
  }
  return masks;
}
