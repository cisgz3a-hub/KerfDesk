import { describe, expect, it } from 'vitest';
import { gridPlacements, gridSteps } from './array-grid-layout';
import type { GridArraySpec } from './array-layout-types';

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const GRID: GridArraySpec = { kind: 'grid', rows: 3, columns: 3, spacingX: 2, spacingY: 2 };

describe('grid random orientation', () => {
  it('turns every copy but the original by repeatable quarter turns about its own centre', () => {
    const spec = { ...GRID, randomRotation: { seed: 7, stepDeg: 90 } };
    const first = gridPlacements(BOUNDS, spec);
    expect(gridPlacements(BOUNDS, spec)).toEqual(first);
    expect(first[0]).toEqual({ dx: 0, dy: 0, rotationDeg: 0 });
    for (const placement of first) {
      expect([0, 90, 180, 270]).toContain(placement.rotationDeg);
      if (placement.rotationDeg !== 0) {
        expect(placement.pivot).toEqual({ x: 5 + placement.dx, y: 5 + placement.dy });
      }
    }
    expect(new Set(first.map((placement) => placement.rotationDeg)).size).toBeGreaterThan(1);
    const other = gridPlacements(BOUNDS, { ...GRID, randomRotation: { seed: 8, stepDeg: 90 } });
    expect(other.map((p) => p.rotationDeg)).not.toEqual(first.map((p) => p.rotationDeg));
  });

  it('measures an edge gap from the box any turn of a copy fits, so turned copies never overlap', () => {
    const wide = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
    const gap: GridArraySpec = { ...GRID, spaceBy: 'gap' };
    expect(gridSteps(wide, gap)).toEqual({ stepX: 12, stepY: 6 });
    const quarter = { ...gap, randomRotation: { seed: 7, stepDeg: 90 } };
    expect(gridSteps(wide, quarter)).toEqual({ stepX: 12, stepY: 12 });
    const any = gridSteps(wide, { ...gap, randomRotation: { seed: 7, stepDeg: 0 } });
    expect(any.stepX).toBeCloseTo(Math.hypot(10, 4) + 2, 9);
    expect(any.stepY).toBeCloseTo(Math.hypot(10, 4) + 2, 9);
    expect(gridSteps(wide, { ...gap, randomRotation: { seed: 7, stepDeg: 180 } })).toEqual({
      stepX: 12,
      stepY: 6,
    });
    // A centre distance is the operator's own number and is left as typed.
    const centres = { ...quarter, spaceBy: 'centres' as const };
    expect(gridSteps(wide, centres)).toEqual({ stepX: 2, stepY: 2 });
  });

  it('gives any angle in [0, 360) when the step is zero, and none without the setting', () => {
    const any = gridPlacements(BOUNDS, { ...GRID, randomRotation: { seed: 3, stepDeg: 0 } });
    for (const placement of any) {
      expect(placement.rotationDeg).toBeGreaterThanOrEqual(0);
      expect(placement.rotationDeg).toBeLessThan(360);
    }
    expect(gridPlacements(BOUNDS, GRID).every((placement) => placement.rotationDeg === 0)).toBe(
      true,
    );
  });
});
