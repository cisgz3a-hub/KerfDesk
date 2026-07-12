import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { planRestPocketToolpaths } from './rest-pocket';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe('planRestPocketToolpaths', () => {
  it('targets only stock left by a larger round cutter in square corners', () => {
    const result = planRestPocketToolpaths([square(0, 0, 20)], 6, 2, 40);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restRegions).toHaveLength(4);
    expect(result.toolpaths.length).toBeGreaterThanOrEqual(4);
    for (const toolpath of result.toolpaths) {
      for (const point of toolpath.points) {
        expect(point.x).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(point.x).toBeLessThanOrEqual(19 + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(point.y).toBeLessThanOrEqual(19 + 1e-6);
      }
    }
  });

  it('keeps rest paths out of an island and inside the current cutter center region', () => {
    const result = planRestPocketToolpaths([square(0, 0, 30), square(10, 10, 10)], 6, 2, 40);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toolpaths.length).toBeGreaterThan(0);
    for (const toolpath of result.toolpaths) {
      for (const point of toolpath.points) {
        const insideIslandClearance =
          point.x > 9 - 1e-6 && point.x < 21 + 1e-6 && point.y > 9 - 1e-6 && point.y < 21 + 1e-6;
        expect(insideIslandClearance).toBe(false);
      }
    }
  });

  it('is deterministic and emits finite closed toolpaths', () => {
    const input = [square(0, 0, 20)];
    const first = planRestPocketToolpaths(input, 6, 2, 35);
    const second = planRestPocketToolpaths(input, 6, 2, 35);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    for (const toolpath of first.toolpaths) {
      expect(toolpath.closed).toBe(true);
      expect(toolpath.points.every(finitePoint)).toBe(true);
    }
  });

  it('refuses invalid tool ordering, open contours, and an oversized rougher', () => {
    expect(planRestPocketToolpaths([square(0, 0, 20)], 2, 2, 40)).toMatchObject({
      ok: false,
      reason: 'The roughing bit must be larger than the finishing bit.',
    });
    expect(
      planRestPocketToolpaths([{ ...square(0, 0, 20), closed: false }], 6, 2, 40),
    ).toMatchObject({ ok: false, reason: 'Rest machining requires closed pocket contours.' });
    expect(planRestPocketToolpaths([square(0, 0, 4)], 10, 2, 40)).toMatchObject({
      ok: false,
      reason: 'The roughing bit does not fit this pocket.',
    });
  });
});

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
