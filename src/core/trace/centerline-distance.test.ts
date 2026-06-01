import { describe, expect, it } from 'vitest';

import { squaredDistanceToBackground } from './centerline-distance';

function mask(
  width: number,
  height: number,
  ink: ReadonlyArray<readonly [number, number]>,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const [x, y] of ink) out[y * width + x] = 1;
  return out;
}

describe('squaredDistanceToBackground', () => {
  it('computes exact squared Euclidean distance from ink to nearest background', () => {
    const ink: Array<readonly [number, number]> = [];
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) ink.push([x, y]);
    }

    const dist = squaredDistanceToBackground(mask(5, 5, ink), 5, 5);

    expect(dist[2 * 5 + 2]).toBe(4);
    expect(dist[2 * 5 + 1]).toBe(1);
    expect(dist[0]).toBe(0);
  });

  it('treats the image edge as background padding', () => {
    const allInk = new Uint8Array(5 * 5).fill(1);

    const dist = squaredDistanceToBackground(allInk, 5, 5);

    expect(dist[2 * 5 + 2]).toBe(4);
    expect(dist[0]).toBe(0);
  });
});
