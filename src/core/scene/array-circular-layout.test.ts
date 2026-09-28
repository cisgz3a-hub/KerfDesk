import { describe, expect, it } from 'vitest';
import { circularPlacements, circularSweep, isWholeTurns } from './array-circular-layout';
import type { CircularArraySpec } from './array-layout-types';

// A 20 x 10 mm design centred on (20, 25), on a 10 mm ring around (100, 100).
const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 30 };
const base: CircularArraySpec = {
  kind: 'circular',
  count: 5,
  centerX: 100,
  centerY: 100,
  radius: 10,
  startAngleDeg: 0,
  rotateCopies: false,
};

// Where each copy's centre lands, as an angle round the ring.
function ringAngles(spec: CircularArraySpec): number[] {
  return circularPlacements(bounds, spec).map((placement) => {
    const x = 20 + placement.dx - spec.centerX;
    const y = 25 + placement.dy - spec.centerY;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    return Math.round((angle < 0 ? angle + 360 : angle) * 1e6) / 1e6;
  });
}

describe('circular array arcs (LBG-T14)', () => {
  it('spreads evenly all the way round exactly as before when no arc is given', () => {
    const placements = circularPlacements(bounds, { ...base, count: 3, rotateCopies: true });
    expect(ringAngles({ ...base, count: 3 })).toEqual([0, 120, 240]);
    expect(placements.map((placement) => placement.rotationDeg)).toEqual([
      90,
      0 + 120 + 90,
      0 + 240 + 90,
    ]);
    expect(circularSweep({ ...base, count: 4 })).toEqual({
      count: 4,
      startDeg: 0,
      stepDeg: 90,
      sweepDeg: 270,
    });
  });

  it('places copies from the start to the end angle, both included', () => {
    const spec: CircularArraySpec = { ...base, arc: { kind: 'end', endAngleDeg: 90 } };
    expect(ringAngles(spec)).toEqual([0, 22.5, 45, 67.5, 90]);
    // The quarter-turn end lands exactly below the centre.
    expect(circularPlacements(bounds, spec)[4]).toMatchObject({ dx: 80, dy: 85 });
  });

  it('does not double the last copy when the end is a whole turn from the start', () => {
    for (const endAngleDeg of [360, -360, 720]) {
      const angles = ringAngles({ ...base, count: 4, arc: { kind: 'end', endAngleDeg } });
      expect(new Set(angles.map((angle) => angle % 360)).size).toBe(endAngleDeg === 720 ? 2 : 4);
    }
    expect(ringAngles({ ...base, count: 4, arc: { kind: 'end', endAngleDeg: 360 } })).toEqual(
      ringAngles({ ...base, count: 4 }),
    );
    expect(ringAngles({ ...base, count: 4, arc: { kind: 'end', endAngleDeg: -360 } })).toEqual([
      0, 270, 180, 90,
    ]);
    // Floating-point starts still count as a whole turn.
    const offset: CircularArraySpec = {
      ...base,
      count: 4,
      startAngleDeg: 0.1,
      arc: { kind: 'end', endAngleDeg: 360.1 },
    };
    expect(circularSweep(offset).stepDeg).toBeCloseTo(90, 9);
  });

  it('runs anticlockwise when the end is below the start', () => {
    expect(
      ringAngles({ ...base, count: 3, startAngleDeg: 90, arc: { kind: 'end', endAngleDeg: -90 } }),
    ).toEqual([90, 0, 270]);
  });

  it('places copies a set step apart, either way round', () => {
    expect(ringAngles({ ...base, count: 4, arc: { kind: 'step', stepAngleDeg: 30 } })).toEqual([
      0, 30, 60, 90,
    ]);
    expect(
      ringAngles({
        ...base,
        count: 3,
        startAngleDeg: 45,
        arc: { kind: 'step', stepAngleDeg: -45 },
      }),
    ).toEqual([45, 0, 315]);
    expect(circularSweep({ ...base, count: 4, arc: { kind: 'step', stepAngleDeg: 30 } })).toEqual({
      count: 4,
      startDeg: 0,
      stepDeg: 30,
      sweepDeg: 90,
    });
  });

  it('turns rotated copies by their own angle on a partial arc', () => {
    const placements = circularPlacements(bounds, {
      ...base,
      count: 3,
      rotateCopies: true,
      arc: { kind: 'end', endAngleDeg: 90 },
    });
    expect(placements.map((placement) => placement.rotationDeg)).toEqual([90, 135, 180]);
  });

  it('keeps a single copy at the start and never divides by zero', () => {
    const one = circularPlacements(bounds, {
      ...base,
      count: 1,
      arc: { kind: 'end', endAngleDeg: 90 },
    });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ dx: 90, dy: 75 });
    expect(ringAngles({ ...base, count: 3, arc: { kind: 'end', endAngleDeg: 0 } })).toEqual([
      0, 0, 0,
    ]);
  });

  it('keeps malformed direct-call angles finite', () => {
    for (const spec of [
      { ...base, arc: { kind: 'end' as const, endAngleDeg: Number.NaN } },
      { ...base, arc: { kind: 'step' as const, stepAngleDeg: Infinity } },
      { ...base, startAngleDeg: 1e308, arc: { kind: 'end' as const, endAngleDeg: -1e308 } },
      { ...base, arc: { kind: 'step' as const, stepAngleDeg: 1e308 } },
    ]) {
      const placements = circularPlacements(bounds, { ...spec, rotateCopies: true });
      expect(
        placements.every((placement) =>
          [placement.dx, placement.dy, placement.rotationDeg].every(Number.isFinite),
        ),
      ).toBe(true);
    }
  });

  it('recognises whole turns only', () => {
    expect([360, -360, 720, 360.0000000001].map(isWholeTurns)).toEqual([true, true, true, true]);
    expect([0, 180, 359, 540, 360.01].map(isWholeTurns)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
