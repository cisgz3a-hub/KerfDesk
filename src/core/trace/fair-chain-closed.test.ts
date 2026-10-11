import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { fairChainSegments } from './fair-chain';

// The same physical ring must be faired the same way regardless of the
// arbitrary array seam or traversal direction. Half-pixel samples put the
// last ordinary point close to a real corner without making it a corner.
function texturedSquare(scale = 1): { points: Vec2[]; corners: Set<Vec2>; steps: number } {
  const side = 600;
  const steps = side * 2;
  const points: Vec2[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    for (let step = 0; step < steps; step += 1) {
      const u = step / 2;
      const texture = 0.8 * Math.sin((2 * Math.PI * u) / 6);
      const p =
        edge === 0
          ? { x: u, y: texture }
          : edge === 1
            ? { x: side - texture, y: u }
            : edge === 2
              ? { x: side - u, y: side - texture }
              : { x: texture, y: side - u };
      points.push({ x: p.x * scale, y: p.y * scale });
    }
  }
  const corners = new Set([0, 1, 2, 3].map((edge) => points[edge * steps] as Vec2));
  return { points, corners, steps };
}

function rotate<T>(values: ReadonlyArray<T>, start: number): T[] {
  return [...values.slice(start), ...values.slice(0, start)];
}

function maxDistance(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): number {
  expect(a).toHaveLength(b.length);
  return a.reduce((worst, p, i) => {
    const q = b[i] as Vec2;
    return Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
  }, 0);
}

describe('closed corner-delimited fairing', () => {
  for (const scale of [1, 2]) {
    it.each([1, 1200, 1217])(`ignores an array seam at sample %i, scale ${scale}`, (offset) => {
      const { points, corners } = texturedSquare(scale);
      const original = fairChainSegments(points, true, corners, scale);
      const shifted = fairChainSegments(rotate(points, offset), true, corners, scale);
      expect(maxDistance(original, rotate(shifted, points.length - offset))).toBeLessThan(1e-8);
    });

    it(`ignores traversal direction and retains every corner at scale ${scale}`, () => {
      const { points, corners } = texturedSquare(scale);
      const original = fairChainSegments(points, true, corners, scale);
      const reversed = fairChainSegments([...points].reverse(), true, corners, scale).reverse();
      expect(maxDistance(original, reversed)).toBeLessThan(1e-8);
      for (const corner of corners) {
        const index = points.indexOf(corner);
        expect(original[index]).toBe(corner);
        expect(reversed[index]).toBe(corner);
      }
      // The final ordinary sample must be smoothed, not mistaken for an
      // endpoint just because the next corner is across the array seam.
      expect(original.at(-1)).not.toBe(points.at(-1));
      expect(Math.abs((original.at(-1) as Vec2).x)).toBeLessThan(0.1 * scale);
    });

    it(`closes a single-corner ring back onto that corner at scale ${scale}`, () => {
      const { points } = texturedSquare(scale);
      const corner = points[17] as Vec2;
      const corners = new Set([corner]);
      const original = fairChainSegments(points, true, corners, scale);
      const reversed = fairChainSegments([...points].reverse(), true, corners, scale).reverse();
      expect(maxDistance(original, reversed)).toBeLessThan(1e-8);
      expect(original[17]).toBe(corner);
      expect(reversed[17]).toBe(corner);
      expect(original.filter((p) => p === corner)).toHaveLength(1);
    });
  }

  it('retains short corner spans and input ordering without duplicating the closing point', () => {
    const { points, corners } = texturedSquare();
    const finalCorner = points[points.length - 4] as Vec2;
    corners.add(finalCorner);
    const snapshot = JSON.stringify(points);
    const shifted = rotate(points, 31);
    const output = fairChainSegments(shifted, true, corners, 1);
    expect(output).toHaveLength(points.length);
    for (const corner of corners) expect(output[shifted.indexOf(corner)]).toBe(corner);
    for (const p of points.slice(-4)) expect(output[shifted.indexOf(p)]).toBe(p);
    expect(JSON.stringify(points)).toBe(snapshot);
  });

  it('still pins open-chain endpoints and interior corners while smoothing either side', () => {
    const points = Array.from({ length: 481 }, (_, i) => ({
      x: i / 2,
      y: 0.8 * Math.sin((2 * Math.PI * i) / 12),
    }));
    const corner = points[240] as Vec2;
    const forward = fairChainSegments(points, false, new Set([corner]), 1);
    const reversed = fairChainSegments(
      [...points].reverse(),
      false,
      new Set([corner]),
      1,
    ).reverse();
    expect(maxDistance(forward, reversed)).toBeLessThan(1e-8);
    for (const i of [0, 240, 480]) expect(forward[i]).toBe(points[i]);
    for (const i of [99, 339]) expect(Math.abs((forward[i] as Vec2).y)).toBeLessThan(0.15);
  });
});
