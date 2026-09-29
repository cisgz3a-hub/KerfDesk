// Trace parity oracle (ADR-438 amendment, speed wave 2).
//
// An output-identical speed change must leave the WHOLE trace result byte for
// byte the same: every ColoredPath field, curves included, in output order.
// This module serialises a trace canonically (sorted object keys, numbers in
// their round-trip decimal form with -0 kept distinct, array order kept) and
// hashes it, and it defines the oracle corpus: the five perceptual fixtures,
// three seeded synthetic noise images, five small edge shapes and, when the
// lab folder is present, the owl and hummingbird. Real art never enters the
// repository; see trace-parity-oracle.test.ts for the env gates.

import { createHash, type Hash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { RawImageData } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { PERCEPTUAL_FIXTURES } from './shapes';

export const PARITY_PRESETS = [
  'Line Art',
  'Photo shading',
  'Centerline',
  'Edge Detection',
  'Smooth',
  'Sharp',
] as const;

export type ParityCase = {
  readonly name: string;
  // Heavy cases (real art, 1024² noise) run only with TRACE_PARITY_HEAVY=1.
  readonly heavy: boolean;
  readonly image: () => RawImageData;
};

export const PARITY_LAB_DIR =
  process.env['TRACE_PARITY_DIR'] ?? 'C:/Users/Asus/AppData/Local/Temp/lfbake';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform RGB noise, one independent byte per channel (the speed study's noise192/noise1024).
export function uniformNoiseImage(size: number, seed: number): RawImageData {
  const random = mulberry32(seed);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = (random() * 256) | 0;
    data[i * 4 + 1] = (random() * 256) | 0;
    data[i * 4 + 2] = (random() * 256) | 0;
    data[i * 4 + 3] = 255;
  }
  return { width: size, height: size, data };
}

// Bilinear value noise on a seeded lattice (the speed study's value1024: cell 3, seed 7).
export function valueNoiseImage(size: number, cell: number, seed: number): RawImageData {
  const random = mulberry32(seed);
  const gridWidth = Math.ceil(size / cell) + 2;
  const lattice = new Float64Array(gridWidth * gridWidth).map(() => random() * 255);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y / cell);
    const fy = y / cell - y0;
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x / cell);
      const fx = x / cell - x0;
      const a = lattice[y0 * gridWidth + x0]!;
      const b = lattice[y0 * gridWidth + x0 + 1]!;
      const c = lattice[(y0 + 1) * gridWidth + x0]!;
      const d = lattice[(y0 + 1) * gridWidth + x0 + 1]!;
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

type Rgba = readonly [number, number, number, number];

function paintedImage(width: number, height: number, paint: (x: number, y: number) => Rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data } satisfies RawImageData;
}

const INK: Rgba = [20, 20, 20, 255];
const PAPER: Rgba = [245, 245, 245, 255];

// Cheap shapes the perceptual fixtures and square noise miss: a non-square
// odd size, 1-pixel-wide rasters in both orientations, alpha coverage, and a
// page whose ink runs off every edge.
export function edgeShapeCases(): ReadonlyArray<ParityCase> {
  const stripe = (t: number): Rgba => (t % 7 < 4 ? INK : PAPER);
  return [
    {
      name: 'noise37x113',
      heavy: false,
      image: () => {
        const random = mulberry32(37);
        return paintedImage(37, 113, () => [
          (random() * 256) | 0,
          (random() * 256) | 0,
          (random() * 256) | 0,
          255,
        ]);
      },
    },
    { name: 'column1x50', heavy: false, image: () => paintedImage(1, 50, (_x, y) => stripe(y)) },
    { name: 'row50x1', heavy: false, image: () => paintedImage(50, 1, (x) => stripe(x)) },
    {
      // Opaque ink disc fading to fully transparent, over transparent black.
      name: 'alpha-disc',
      heavy: false,
      image: () =>
        paintedImage(120, 90, (x, y) => {
          const r = Math.hypot(x - 60, y - 45);
          const alpha = r < 20 ? 255 : r > 40 ? 0 : Math.round((255 * (40 - r)) / 20);
          return alpha === 0 ? [0, 0, 0, 0] : [30, 30, 30, alpha];
        }),
    },
    {
      // Ink everywhere except a paper window holding an ink bar and a dot.
      name: 'ink-border-page',
      heavy: false,
      image: () =>
        paintedImage(200, 150, (x, y) => {
          const window = x >= 30 && x < 170 && y >= 25 && y < 125;
          const bar = x >= 60 && x < 140 && y >= 70 && y < 80;
          const dot = Math.hypot(x - 100, y - 45) < 6;
          return !window || bar || dot ? INK : PAPER;
        }),
    },
  ];
}

function labImage(name: string): ParityCase | undefined {
  const path = `${PARITY_LAB_DIR}/inputs/${name}.png`;
  if (!existsSync(path)) return undefined;
  return { name, heavy: true, image: () => decodePngFile(path) };
}

export function parityCases(): ReadonlyArray<ParityCase> {
  const cases: ParityCase[] = PERCEPTUAL_FIXTURES.map((fixture) => ({
    name: fixture.name,
    heavy: false,
    image: () => fixture.image,
  }));
  cases.push({ name: 'noise192', heavy: false, image: () => uniformNoiseImage(192, 192) });
  cases.push(...edgeShapeCases());
  for (const lab of [labImage('owl'), labImage('hummingbird')]) if (lab) cases.push(lab);
  cases.push({ name: 'noise1024', heavy: true, image: () => uniformNoiseImage(1024, 1024) });
  cases.push({ name: 'value1024', heavy: true, image: () => valueNoiseImage(1024, 3, 7) });
  return cases;
}

function canonicalNumber(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value);
}

// Feeds `value` into `sink` canonically. Object keys are sorted; `undefined`
// members are skipped (JSON semantics); arrays and typed arrays keep order.
// Only plain objects are walked: a Map, Set, Date or class instance would
// serialise as `{}` and hide its contents from the gate, so it throws.
function writeCanonical(value: unknown, sink: (chunk: string) => void): void {
  if (value === null || value === undefined) {
    sink('null');
  } else if (typeof value === 'number') {
    sink(canonicalNumber(value));
  } else if (typeof value === 'string') {
    sink(JSON.stringify(value));
  } else if (typeof value === 'boolean') {
    sink(value ? 'true' : 'false');
  } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    writeCanonicalItems(value as ArrayLike<unknown>, sink);
  } else if (typeof value === 'object') {
    writeCanonicalRecord(value, sink);
  } else {
    throw new Error(`trace parity: cannot serialise a ${typeof value}`);
  }
}

function writeCanonicalItems(items: ArrayLike<unknown>, sink: (chunk: string) => void): void {
  sink('[');
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) sink(',');
    writeCanonical(items[i], sink);
  }
  sink(']');
}

function writeCanonicalRecord(value: object, sink: (chunk: string) => void): void {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    const kind = (value as { constructor?: { name?: string } }).constructor?.name ?? 'object';
    throw new Error(`trace parity: cannot serialise a ${kind}; only plain objects are walked`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  sink('{');
  keys.forEach((key, index) => {
    if (index > 0) sink(',');
    sink(`${JSON.stringify(key)}:`);
    writeCanonical(record[key], sink);
  });
  sink('}');
}

// The whole canonical text; use only for small results or a first-failure dump.
export function canonicalTraceText(result: unknown): string {
  const parts: string[] = [];
  writeCanonical(result, (chunk) => parts.push(chunk));
  return parts.join('');
}

// sha256 of the canonical text, streamed in 64 KiB chunks so a 1024² noise
// trace never builds one giant string.
export function canonicalTraceHash(result: unknown): string {
  const hash: Hash = createHash('sha256');
  let buffer = '';
  writeCanonical(result, (chunk) => {
    buffer += chunk;
    if (buffer.length >= 65536) {
      hash.update(buffer);
      buffer = '';
    }
  });
  hash.update(buffer);
  return hash.digest('hex');
}

export function parityKey(caseName: string, preset: string): string {
  return `${caseName}|${preset}`;
}
