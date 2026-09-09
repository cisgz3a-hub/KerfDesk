import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { flattenStraightRuns } from './flatten-straight-runs';

describe('straight-run longitudinal features', () => {
  it.each([1, 2, 3])('keeps the finite extent of a near-collinear hairpin at %sx', (scale) => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0.001 },
      { x: 40, y: -0.001 },
      { x: 38, y: 0.001 },
      { x: 20, y: 0 },
    ].map((p) => ({ x: p.x * scale, y: p.y * scale }));
    for (const transform of [
      (p: Vec2) => p,
      (p: Vec2) => ({ x: -p.y + 13, y: p.x - 7 }),
      (p: Vec2) => ({ x: -p.x + 13, y: p.y - 7 }),
    ]) {
      const input = points.map(transform);
      const output = flattenStraightRuns(input, false, new Set(), 1, scale);
      expect(output).toEqual(input);
      expect(output[0]).toBe(input[0]);
      expect(output.at(-1)).toBe(input.at(-1));
    }
  });

  it('preserves a reversal inside the endpoint span, not only an overshoot', () => {
    const input = [0, 20, 10, 30, 40].map((x) => ({ x, y: 0 }));
    expect(flattenStraightRuns(input, false, new Set())).toEqual(input);
  });

  it('keeps a densely sampled turning point even at high Smoothness', () => {
    const input = [
      ...[0, 5, 40].map((x) => ({ x, y: 0 })),
      ...Array.from({ length: 31 }, (_, i) => ({ x: 39 - i * 0.5, y: 0 })),
      { x: 20, y: 0 },
    ];
    const output = flattenStraightRuns(input, false, new Set(), 2.98);
    expect(output.some((p) => p.x === 40 && p.y === 0)).toBe(true);
    expect(output.at(-1)).toBe(input.at(-1));
    expect(output.findIndex((p) => p.x === 40)).toBeLessThan(output.length - 1);
  });

  it('does not turn Smoothness into a longitudinal feature-removal budget', () => {
    const input = [0, 20, 19.9, 30, 40].map((x) => ({ x, y: 0 }));
    expect(flattenStraightRuns(input, false, new Set(), 2.98)).toEqual(input);
  });

  it('retains the deep-notch vertices and exact corners in a closed contour', () => {
    const input = [
      { x: 63, y: 45.5 },
      { x: 63, y: 15 },
      { x: 110, y: 15 },
      { x: 110, y: 110 },
      { x: 15, y: 110 },
      { x: 15, y: 15 },
      { x: 54.921442103304194, y: 13.600372417223957 },
      { x: 60.58006091740042, y: 16.859072850683145 },
      { x: 61.05112493404948, y: 78.3715987892145 },
      { x: 64.3577960898357, y: 75.33577864735184 },
    ];
    const corners = new Set(input.slice(1, 6));
    for (const offset of [0, 4, 8]) {
      const ring = [...input.slice(offset), ...input.slice(0, offset)];
      const output = flattenStraightRuns(ring, true, corners, 2.98);
      expect(output).toHaveLength(input.length);
      for (const point of input) expect(output).toContain(point);
      for (const corner of corners) expect(output.find((p) => p === corner)).toBe(corner);
      expect(output[0]).not.toBe(output.at(-1));
    }
  });

  it.each([1, 2, 3])('still straightens legitimate wavy edges at %sx', (scale) => {
    const input = Array.from({ length: 41 }, (_, x) => ({
      x: x * 2 * scale,
      y: 0.6 * Math.sin(x) * scale,
    }));
    const output = flattenStraightRuns(input, false, new Set(), 1, scale);
    expect(output.length).toBeLessThanOrEqual(input.length * 0.4);
    expect(output[0]).toBe(input[0]);
    expect(output.at(-1)).toBe(input.at(-1));
    for (const p of output) expect(Math.abs(p.y)).toBeLessThanOrEqual(0.6 * scale);
  });
});
