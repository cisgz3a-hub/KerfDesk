import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planAdaptivePocket } from './adaptive-pocket';

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

describe('planAdaptivePocket', () => {
  it('creates round optimal-load levels from an interior entry toward the wall', () => {
    const result = planAdaptivePocket([square(0, 0, 20)], 4, 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sequences).toHaveLength(1);
    const sequence = result.sequences[0];
    expect(sequence?.entryCenter.x).toBeCloseTo(10, 2);
    expect(sequence?.entryCenter.y).toBeCloseTo(10, 2);
    expect(sequence?.entryRadiusMm).toBeGreaterThan(0);
    expect(sequence?.rings.length).toBeGreaterThan(5);
    expect(sequence?.rings.every((ring) => ring.closed)).toBe(true);
  });

  it('refuses island topology instead of crossing uncleared stock', () => {
    const result = planAdaptivePocket([square(0, 0, 30), square(10, 10, 10)], 4, 0.5);
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('island-free'),
    });
  });

  it('creates one independent sequence per disconnected pocket and is deterministic', () => {
    const contours = [square(0, 0, 20), square(30, 0, 20)];
    const first = planAdaptivePocket(contours, 4, 0.5);
    const second = planAdaptivePocket(contours, 4, 0.5);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.sequences).toHaveLength(2);
  });

  it('refuses unsafe load, open contours, and a bit that cannot fit', () => {
    expect(planAdaptivePocket([square(0, 0, 20)], 4, 2.1)).toMatchObject({
      ok: false,
      reason: 'Adaptive optimal load must not exceed half the bit diameter.',
    });
    expect(planAdaptivePocket([{ ...square(0, 0, 20), closed: false }], 4, 0.5)).toMatchObject({
      ok: false,
      reason: 'Adaptive clearing requires closed pocket contours.',
    });
    expect(planAdaptivePocket([square(0, 0, 2)], 4, 0.5)).toMatchObject({
      ok: false,
      reason: 'The selected bit does not fit one of the adaptive pockets.',
    });
  });
});
