// Light-solid recovery's pixel passes were made faster without changing a
// bit (ADR-530 Amendment 10): the box means' column pass reads rows, and the
// thick-material test counts square windows instead of spreading rings. Both
// are checked against the passes they replaced.

import { describe, expect, it } from 'vitest';
import { boxMoments, nearThickMaterial, neighbours8 } from './light-solid-pixels';

describe('light-solid pixel passes', () => {
  it('box means match a pass down each column bit for bit', () => {
    const cases = [
      { width: 37, height: 23, radius: 2 },
      { width: 64, height: 48, radius: 4 },
      { width: 5, height: 40, radius: 4 },
      { width: 40, height: 3, radius: 5 },
      { width: 1, height: 1, radius: 2 },
    ];
    for (const [seed, { width, height, radius }] of cases.entries()) {
      const random = seeded(seed + 1);
      const luma = Float32Array.from({ length: width * height }, () => random() * 255);
      const actual = boxMoments(luma, width, height, radius);
      const expected = referenceBoxMoments(luma, width, height, radius);
      expect(bits(actual.mean)).toEqual(bits(expected.mean));
      expect(bits(actual.meanSquare)).toEqual(bits(expected.meanSquare));
    }
  });

  it('thick material matches breadth-first rings', () => {
    const cases = [
      { width: 61, height: 47, density: 0.02 },
      { width: 61, height: 47, density: 0.2 },
      { width: 30, height: 90, density: 0.6 },
      { width: 9, height: 7, density: 0.3 },
      { width: 25, height: 25, density: 0 },
      { width: 25, height: 25, density: 1 },
    ];
    for (const [seed, { width, height, density }] of cases.entries()) {
      const random = seeded(seed + 11);
      const light = Uint8Array.from({ length: width * height }, () => (random() < density ? 1 : 0));
      for (const span of [
        { halfWidth: 3, reach: 5 },
        { halfWidth: 8, reach: 10 },
        { halfWidth: 0, reach: 2 },
        { halfWidth: 16, reach: 0 },
      ]) {
        const actual = nearThickMaterial(light, width, height, span);
        expect(Array.from(actual)).toEqual(
          Array.from(referenceNearThick(light, width, height, span)),
        );
      }
    }
  });
});

function bits(values: Float32Array): number[] {
  return Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function clamp(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

// The pass pair before the change: rows, then a running sum down each column.
function referenceBoxMoments(
  luma: Float32Array,
  width: number,
  height: number,
  radius: number,
): { readonly mean: Float32Array; readonly meanSquare: Float32Array } {
  const rowMean = new Float32Array(luma.length);
  const rowSquare = new Float32Array(luma.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    let sumSq = 0;
    for (let x = -radius; x <= radius; x += 1) {
      const v = luma[row + clamp(x, width)] as number;
      sum += v;
      sumSq += v * v;
    }
    for (let x = 0; x < width; x += 1) {
      rowMean[row + x] = sum / window;
      rowSquare[row + x] = sumSq / window;
      const out = luma[row + clamp(x - radius, width)] as number;
      const into = luma[row + clamp(x + radius + 1, width)] as number;
      sum += into - out;
      sumSq += into * into - out * out;
    }
  }
  const mean = new Float32Array(luma.length);
  const meanSquare = new Float32Array(luma.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let sumSq = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += rowMean[clamp(y, height) * width + x] as number;
      sumSq += rowSquare[clamp(y, height) * width + x] as number;
    }
    for (let y = 0; y < height; y += 1) {
      mean[y * width + x] = sum / window;
      meanSquare[y * width + x] = sumSq / window;
      const out = clamp(y - radius, height) * width + x;
      const into = clamp(y + radius + 1, height) * width + x;
      sum += (rowMean[into] as number) - (rowMean[out] as number);
      sumSq += (rowSquare[into] as number) - (rowSquare[out] as number);
    }
  }
  return { mean, meanSquare };
}

// The test before the change: 8-connected rings out of the light pixels,
// then out of the thick ones.
function referenceNearThick(
  light: Uint8Array,
  width: number,
  height: number,
  span: { readonly halfWidth: number; readonly reach: number },
): Uint8Array {
  const FAR = 255;
  const distance = new Uint8Array(light.length).fill(FAR);
  const queue = new Int32Array(light.length);
  let tail = 0;
  for (let i = 0; i < light.length; i += 1) {
    if (light[i] !== 1) continue;
    distance[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  spreadRings(distance, width, height, queue, tail, span.halfWidth);
  tail = 0;
  for (let i = 0; i < distance.length; i += 1) {
    if (distance[i] === FAR) {
      distance[i] = 0;
      queue[tail] = i;
      tail += 1;
    } else {
      distance[i] = FAR;
    }
  }
  spreadRings(distance, width, height, queue, tail, span.reach);
  for (let i = 0; i < distance.length; i += 1) distance[i] = distance[i] === FAR ? 0 : 1;
  return distance;
}

function spreadRings(
  distance: Uint8Array,
  width: number,
  height: number,
  queue: Int32Array,
  sources: number,
  rings: number,
): void {
  const around = new Int32Array(8);
  let head = 0;
  let tail = sources;
  for (let ring = 1; ring <= rings && head < tail; ring += 1) {
    const end = tail;
    for (; head < end; head += 1) {
      neighbours8(around, queue[head] as number, width, height);
      for (const n of around) {
        if (n < 0 || distance[n] !== 255) continue;
        distance[n] = ring;
        queue[tail] = n;
        tail += 1;
      }
    }
  }
}
