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

function uPocket(): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 28, y: 40 },
      { x: 28, y: 5 },
      { x: 12, y: 5 },
      { x: 12, y: 40 },
      { x: 0, y: 40 },
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
    const finishPoints = sequence?.finishRings[0]?.points ?? [];
    expect(Math.min(...finishPoints.map((point) => point.x))).toBeCloseTo(2, 3);
    expect(Math.max(...finishPoints.map((point) => point.x))).toBeCloseTo(18, 3);
  });

  it('links each ring to the next by one ring spacing', () => {
    // The ring starts are chosen from the wall inward, so on a straight wall
    // each link steps straight out by the spacing (half the engagement limit).
    // Starting at the ring vertex nearest the previous start chained the links
    // up the right triangle's corner bisector instead, where rings stand the
    // spacing over sin(45 degrees) apart (ADR-154 Amendment 3).
    const triangle: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 0, y: 30 },
      ],
    };
    const cases: ReadonlyArray<readonly [Polyline, number, number]> = [
      [square(0, 0, 20), 4, 0.5],
      [triangle, 3.175, 0.3175],
    ];
    for (const [pocket, diameter, load] of cases) {
      const plan = planAdaptivePocket([pocket], diameter, load);
      if (!plan.ok) throw new Error(plan.reason);
      for (const sequence of plan.sequences) {
        const starts = sequence.rings.map((ring) => ring.points[0]);
        for (let index = 1; index < starts.length; index += 1) {
          const from = starts[index - 1];
          const to = starts[index];
          if (from === undefined || to === undefined) throw new Error('expected ring starts');
          // Interior rings sit on a 0.01 mm grid.
          expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThanOrEqual(load / 2 + 0.015);
        }
      }
    }
  });

  it('partitions island topology without linking across protected stock', () => {
    const result = planAdaptivePocket([square(0, 0, 30), square(10, 10, 10)], 4, 0.5);
    expect(result).toMatchObject({ ok: true, islandPartitions: 8 });
  });

  it('creates one independent sequence per disconnected pocket and is deterministic', () => {
    const contours = [square(0, 0, 20), square(30, 0, 20)];
    const first = planAdaptivePocket(contours, 4, 0.5);
    const second = planAdaptivePocket(contours, 4, 0.5);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.sequences).toHaveLength(2);
  });

  it('splits U-pocket offset branches into independent deterministic sequences', () => {
    const contours = [uPocket()];
    const first = planAdaptivePocket(contours, 4, 2);
    expect(first).toEqual(planAdaptivePocket(contours, 4, 2));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.sequences).toHaveLength(2);
    expect(first.sequences.map((sequence) => sequence.rings.length)).toEqual([4, 3]);
    expect(first.sequences.flatMap((sequence) => sequence.finishRings)).toHaveLength(1);
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
