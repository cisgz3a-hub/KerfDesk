import { describe, expect, it } from 'vitest';
import { arrayPlacements } from './array-layout';

const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 30 };

describe('arrayPlacements', () => {
  it('builds a deterministic row-major grid from the original position', () => {
    expect(
      arrayPlacements(bounds, {
        kind: 'grid',
        rows: 2,
        columns: 2,
        spacingX: 5,
        spacingY: 3,
      }),
    ).toEqual([
      { dx: 0, dy: 0, rotationDeg: 0 },
      { dx: 25, dy: 0, rotationDeg: 0 },
      { dx: 0, dy: 13, rotationDeg: 0 },
      { dx: 25, dy: 13, rotationDeg: 0 },
    ]);
  });

  it('places a circular array around the requested center', () => {
    const placements = arrayPlacements(bounds, {
      kind: 'circular',
      count: 4,
      centerX: 100,
      centerY: 100,
      radius: 20,
      startAngleDeg: 0,
      rotateCopies: false,
    });
    expect(placements[0]).toMatchObject({ dx: 100, dy: 75, rotationDeg: 0 });
    expect(placements[1]?.dx).toBeCloseTo(80);
    expect(placements[1]?.dy).toBeCloseTo(95);
  });

  it.each([270, -90])(
    'keeps exact quadrant placement at the source for start angle %d',
    (startAngleDeg) => {
      expect(
        arrayPlacements(bounds, {
          kind: 'circular',
          count: 1,
          centerX: 20,
          centerY: 35,
          radius: 10,
          startAngleDeg,
          rotateCopies: true,
        })[0],
      ).toMatchObject({ dx: 0, dy: 0 });
    },
  );

  it.each([1e308, -1e308, Number.MAX_VALUE])(
    'reduces huge finite start angle %d before trigonometry',
    (startAngleDeg) => {
      const spec = {
        kind: 'circular' as const,
        count: 4,
        centerX: 20,
        centerY: 25,
        radius: 10,
        rotateCopies: true,
      };
      const placements = arrayPlacements(bounds, { ...spec, startAngleDeg });
      const equivalent = arrayPlacements(bounds, {
        ...spec,
        startAngleDeg: startAngleDeg % 360,
      });

      expect(
        placements.every((placement) =>
          [placement.dx, placement.dy, placement.rotationDeg].every(Number.isFinite),
        ),
      ).toBe(true);
      expect(placements).toEqual(equivalent);
      expect(new Set(placements.map((placement) => `${placement.dx},${placement.dy}`)).size).toBe(
        4,
      );
    },
  );

  it('rotates copies in place over a full turn without duplicating the endpoint', () => {
    expect(
      arrayPlacements(bounds, { kind: 'point-rotation', count: 4, totalAngleDeg: 360 }),
    ).toEqual([
      { dx: 0, dy: 0, rotationDeg: 0 },
      { dx: 0, dy: 0, rotationDeg: 90, pivot: { x: 20, y: 25 } },
      { dx: 0, dy: 0, rotationDeg: 180, pivot: { x: 20, y: 25 } },
      { dx: 0, dy: 0, rotationDeg: 270, pivot: { x: 20, y: 25 } },
    ]);
  });

  it('supports a signed partial point rotation and an identity-only count', () => {
    expect(
      arrayPlacements(bounds, { kind: 'point-rotation', count: 4, totalAngleDeg: -180 }).map(
        (placement) => placement.rotationDeg,
      ),
    ).toEqual([0, -45, -90, -135]);
    expect(
      arrayPlacements(bounds, { kind: 'point-rotation', count: 1, totalAngleDeg: 360 }),
    ).toEqual([{ dx: 0, dy: 0, rotationDeg: 0 }]);
  });

  it('materializes every requested placement without a policy cap', () => {
    expect(
      arrayPlacements(bounds, {
        kind: 'circular',
        count: 501,
        centerX: 100,
        centerY: 100,
        radius: 20,
        startAngleDeg: 0,
        rotateCopies: false,
      }),
    ).toHaveLength(501);
  });

  it('normalizes malformed direct-call inputs without fabricating non-finite placements', () => {
    const placements = arrayPlacements(bounds, {
      kind: 'grid',
      rows: Number.POSITIVE_INFINITY,
      columns: 3,
      spacingX: Number.NaN,
      spacingY: -2,
    });
    expect(placements).toHaveLength(3);
    expect(placements.every((placement) => Number.isFinite(placement.dx))).toBe(true);
  });
});
