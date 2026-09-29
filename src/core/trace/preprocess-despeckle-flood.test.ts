// Speck removal floods on one typed stack and stops listing a region once it
// is too large to erase (ADR-530 Amendment 10). It must erase exactly what
// the flood that listed every region erased, and hand the judge the same
// regions in the same order.

import { describe, expect, it } from 'vitest';
import { despeckle, lumaAt, type InkMarkJudge } from './preprocess';
import {
  createSaddleResolver,
  type SaddlePolicyInput,
  type SaddleResolver,
} from './saddle-connectivity';
import type { RawImageData } from './trace-image';

type Connectivity = 4 | 8 | SaddlePolicyInput;

describe('speck removal flood', () => {
  it('erases and judges what listing every region did', () => {
    const connectivities: Connectivity[] = [
      4,
      8,
      { turnPolicy: 'auto' },
      { turnPolicy: 'auto', pixelScale: 2 },
      { turnPolicy: 'connect-ink' },
    ];
    for (const seed of [3, 5, 8]) {
      const image = speckledMask(83, 57, seed);
      for (const connectivity of connectivities) {
        for (const minPixels of [4, 12, 60]) {
          const actual = judged((judge) => despeckle(image, minPixels, connectivity, judge));
          const expected = judged((judge) =>
            referenceDespeckle(image, minPixels, connectivity, judge),
          );
          expect(actual.calls).toEqual(expected.calls);
          expect(Array.from(actual.out.data)).toEqual(Array.from(expected.out.data));
        }
      }
    }
  });
});

// Keeps every third region it is asked about, recording each one.
function judged(run: (judge: InkMarkJudge) => RawImageData): {
  readonly calls: number[][];
  readonly out: RawImageData;
} {
  const calls: number[][] = [];
  const out = run((region) => {
    calls.push([...region]);
    return calls.length % 3 === 0;
  });
  return { calls, out };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// Random specks, one-pixel diagonal strokes (joined only across corners) and
// solid blocks, so some regions pass every size limit.
function speckledMask(width: number, height: number, seed: number): RawImageData {
  const random = seeded(seed);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  };
  for (let i = 0; i < width * height; i += 1) {
    if (random() < 0.12) ink(i % width, Math.floor(i / width));
  }
  for (let k = 0; k < 4; k += 1) {
    const x0 = Math.floor(random() * width);
    const y0 = Math.floor(random() * height);
    const dx = random() < 0.5 ? 1 : -1;
    for (let t = 0; t < 40; t += 1) ink(x0 + dx * t, y0 + t);
    for (let y = 0; y < 6; y += 1) for (let x = 0; x < 8; x += 1) ink(x0 + x, y0 - y);
  }
  return { width, height, data };
}

// Speck removal before the change: every region listed in full.
function referenceDespeckle(
  image: RawImageData,
  minPixels: number,
  connectivity: Connectivity,
  judge: InkMarkJudge,
): RawImageData {
  const { width: w, height: h } = image;
  const out = new Uint8ClampedArray(image.data);
  const visited = new Uint8Array(w * h);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i += 1) ink[i] = lumaAt(image.data, i * 4) < 128 ? 1 : 0;
  const saddles =
    typeof connectivity === 'number'
      ? null
      : createSaddleResolver(
          { width: w, height: h, ink },
          connectivity.turnPolicy,
          connectivity.field,
          connectivity.pixelScale,
        );
  const joins = (cx: number, cy: number, nx: number, ny: number): boolean => {
    if (connectivity === 8) return true;
    if (saddles === null) return false;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) return false;
    if (ink[cy * w + nx] === 1 || ink[ny * w + cx] === 1) return true;
    return saddles(Math.max(cx, nx), Math.max(cy, ny));
  };
  for (let start = 0; start < w * h; start += 1) {
    if (visited[start] !== 0) continue;
    visited[start] = 1;
    if (ink[start] !== 1) continue;
    const region = referenceRegion({ ink, visited, w, h, saddles, joins }, start, connectivity);
    if (region.length < minPixels && judge(region, ink) !== true) {
      for (const r of region) out.fill(255, r * 4, r * 4 + 4);
    }
  }
  return { width: w, height: h, data: out };
}

function referenceRegion(
  grid: {
    readonly ink: Uint8Array;
    readonly visited: Uint8Array;
    readonly w: number;
    readonly h: number;
    readonly saddles: SaddleResolver | null;
    readonly joins: (cx: number, cy: number, nx: number, ny: number) => boolean;
  },
  start: number,
  connectivity: Connectivity,
): number[] {
  const { ink, visited, w, h, joins } = grid;
  const region = [start];
  const queue = [start];
  const visit = (nx: number, ny: number): void => {
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
    const ni = ny * w + nx;
    if (visited[ni] !== 0) return;
    visited[ni] = 1;
    if (ink[ni] === 1) {
      region.push(ni);
      queue.push(ni);
    }
  };
  while (queue.length > 0) {
    const cur = queue.pop() ?? 0;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    visit(cx - 1, cy);
    visit(cx + 1, cy);
    visit(cx, cy - 1);
    visit(cx, cy + 1);
    if (connectivity === 4) continue;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      if (joins(cx, cy, cx + sx, cy + sy)) visit(cx + sx, cy + sy);
    }
  }
  return region;
}
