import { describe, expect, it } from 'vitest';
import { gridPlacements, gridSteps } from './array-grid-layout';
import type { GridArraySpec } from './array-layout-types';

// A 20 x 10 mm design whose centre is (20, 25).
const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 30 };
const base: GridArraySpec = { kind: 'grid', rows: 2, columns: 3, spacingX: 5, spacingY: 3 };

function offsets(spec: GridArraySpec): ReadonlyArray<readonly [number, number]> {
  return gridPlacements(bounds, spec).map((placement) => [placement.dx, placement.dy] as const);
}

describe('grid array extras (LBG-T13)', () => {
  it('lays out exactly as before when every new option is at its default', () => {
    const defaults: GridArraySpec = {
      ...base,
      spaceBy: 'gap',
      rowShift: 0,
      columnShift: 0,
      reverseColumns: false,
      reverseRows: false,
      mirrorColumns: 'none',
      mirrorRows: 'none',
    };
    expect(gridPlacements(bounds, defaults)).toEqual(gridPlacements(bounds, base));
    expect(gridPlacements(bounds, base)).toEqual([
      { dx: 0, dy: 0, rotationDeg: 0 },
      { dx: 25, dy: 0, rotationDeg: 0 },
      { dx: 50, dy: 0, rotationDeg: 0 },
      { dx: 0, dy: 13, rotationDeg: 0 },
      { dx: 25, dy: 13, rotationDeg: 0 },
      { dx: 50, dy: 13, rotationDeg: 0 },
    ]);
  });

  it('spaces copies by the distance between centres, which may be less than the design', () => {
    const spec: GridArraySpec = { ...base, spaceBy: 'centres', spacingX: 12, spacingY: 7 };
    expect(gridSteps(bounds, spec)).toEqual({ stepX: 12, stepY: 7 });
    expect(offsets(spec)).toEqual([
      [0, 0],
      [12, 0],
      [24, 0],
      [0, 7],
      [12, 7],
      [24, 7],
    ]);
    expect(gridSteps(bounds, { ...spec, spacingX: -4, spacingY: Number.NaN })).toEqual({
      stepX: 0,
      stepY: 0,
    });
  });

  it('shifts every other row sideways and every other column up or down', () => {
    expect(offsets({ ...base, rows: 3, columns: 2, rowShift: 12.5 })).toEqual([
      [0, 0],
      [25, 0],
      [12.5, 13],
      [37.5, 13],
      [0, 26],
      [25, 26],
    ]);
    expect(offsets({ ...base, rows: 2, columns: 3, columnShift: -6.5 })).toEqual([
      [0, 0],
      [25, -6.5],
      [50, 0],
      [0, 13],
      [25, 6.5],
      [50, 13],
    ]);
  });

  it('builds leftward and upward from the original, which stays put', () => {
    const placements = gridPlacements(bounds, {
      ...base,
      reverseColumns: true,
      reverseRows: true,
    });
    expect(placements.map((placement) => [placement.dx, placement.dy])).toEqual([
      [0, 0],
      [-25, 0],
      [-50, 0],
      [0, -13],
      [-25, -13],
      [-50, -13],
    ]);
    // No negative zero: the original's placement is the identity.
    expect(Object.is(placements[0]?.dx, 0)).toBe(true);
    expect(Object.is(placements[0]?.dy, 0)).toBe(true);
  });

  it('mirrors alternate columns and rows about the design centre', () => {
    const center = { x: 20, y: 25 };
    const placements = gridPlacements(bounds, {
      ...base,
      rows: 2,
      columns: 2,
      mirrorColumns: 'vertical',
    });
    expect(placements.map((placement) => placement.mirror)).toEqual([
      undefined,
      { horizontal: false, vertical: true, center },
      undefined,
      { horizontal: false, vertical: true, center },
    ]);
    const rows = gridPlacements(bounds, { ...base, rows: 3, columns: 1, mirrorRows: 'both' });
    expect(rows.map((placement) => placement.mirror)).toEqual([
      undefined,
      { horizontal: true, vertical: true, center },
      undefined,
    ]);
  });

  it('cancels two mirrors in the same direction, which gives a checkerboard', () => {
    const placements = gridPlacements(bounds, {
      ...base,
      rows: 2,
      columns: 2,
      mirrorColumns: 'vertical',
      mirrorRows: 'both',
    });
    expect(
      placements.map((placement) =>
        placement.mirror === undefined
          ? 'none'
          : `${placement.mirror.horizontal ? 'h' : ''}${placement.mirror.vertical ? 'v' : ''}`,
      ),
    ).toEqual(['none', 'v', 'hv', 'h']);
  });

  it('never shifts or mirrors the original', () => {
    const [first] = gridPlacements(bounds, {
      ...base,
      rowShift: 7,
      columnShift: 7,
      reverseColumns: true,
      mirrorColumns: 'both',
      mirrorRows: 'both',
    });
    expect(first).toEqual({ dx: 0, dy: 0, rotationDeg: 0 });
  });

  it('ignores non-finite shifts from a direct call', () => {
    expect(
      offsets({ ...base, rows: 2, columns: 2, rowShift: Number.NaN, columnShift: Infinity }),
    ).toEqual([
      [0, 0],
      [25, 0],
      [0, 13],
      [25, 13],
    ]);
  });
});
