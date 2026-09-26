import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { partialCellCenter } from '../grid';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import {
  densestSample,
  oracleContact,
  triangulatedSurface,
} from './heightmap-surface-contact-oracle.test-support';

// ADR-412: the exact cutter contact with the triangulated heightmap. Known
// answers pin every closed form; an independent search oracle and dense
// surface samples check arbitrary masked and shortened-edge maps.

const FLAT: CncTool = { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 1.4 };
const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 1.4 };
const V_BIT: CncTool = { id: 'v', name: 'v-bit', kind: 'v-bit', diameterMm: 1.4, tipAngleDeg: 60 };
const ENGRAVING: CncTool = {
  id: 'engraving',
  name: 'engraving',
  kind: 'engraving',
  diameterMm: 1.4,
  tipAngleDeg: 45,
  tipDiameterMm: 0.2,
};
const TAPERED: CncTool = {
  id: 'tapered',
  name: 'tapered ball',
  kind: 'tapered-ball-nose',
  diameterMm: 1.4,
  tipDiameterMm: 0.5,
  tipAngleDeg: 30,
};
const TOOLS = [FLAT, BALL, V_BIT, ENGRAVING, TAPERED] as const;

function rampMap(slopeX: number, slopeY: number, cells = 25, mmPerCell = 0.2): Heightmap {
  const depth = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      depth[j * cells + i] = -5 + slopeX * (i + 0.5) * mmPerCell + slopeY * (j + 0.5) * mmPerCell;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * mmPerCell,
    heightMm: cells * mmPerCell,
    mmPerCell,
    depth,
  };
}

function contactAt(map: Heightmap, kernel: ToolKernel, cx: number, cy: number): number {
  const field = createSurfaceContactField(map, kernel);
  if (field === null) throw new Error('expected a contact field');
  return field.constraint(cx, cy, Number.NEGATIVE_INFINITY);
}

describe('surface contact — known answers on a plane', () => {
  const MID = 12;
  const R = 0.7;

  function planeTip(tool: CncTool, slope: number): { actual: number; surface: number } {
    // A ramp along a diagonal exercises both triangle orientations.
    const along = slope / Math.SQRT2;
    const map = rampMap(along, along);
    const kernel = kernelForTool(tool, map.mmPerCell);
    return {
      actual: contactAt(map, kernel, MID, MID),
      surface: map.depth[MID * map.widthCells + MID] ?? 0,
    };
  }

  it.each([0, 0.3, 1, 2.5])('lifts a flat end mill by slope x radius (slope %s)', (slope) => {
    const { actual, surface } = planeTip(FLAT, slope);
    expect(actual).toBeCloseTo(surface + slope * R, 5);
  });

  it.each([0, 0.3, 1, 2.5, 6])('seats a ball on its tangent point (slope %s)', (slope) => {
    const { actual, surface } = planeTip(BALL, slope);
    expect(actual).toBeCloseTo(surface + R * (Math.sqrt(1 + slope * slope) - 1), 5);
  });

  it.each([0.5, 1.5])('keeps a v-bit on its tip below the flank slope (slope %s)', (slope) => {
    const { actual, surface } = planeTip(V_BIT, slope);
    expect(actual).toBeCloseTo(surface, 5);
  });

  it.each([2, 4])('moves a v-bit contact to the rim above the flank slope (slope %s)', (slope) => {
    const kernel = kernelForTool(V_BIT, 0.2);
    const { actual, surface } = planeTip(V_BIT, slope);
    expect(actual).toBeCloseTo(surface + slope * R - kernel.surfaceDzAtRadius(R), 5);
  });

  it.each([0.5, 2])('seats an engraving bit on its flat land edge (slope %s)', (slope) => {
    const { actual, surface } = planeTip(ENGRAVING, slope);
    expect(actual).toBeCloseTo(surface + slope * 0.1, 5);
  });

  it('moves an engraving contact to the rim above the flank slope', () => {
    const kernel = kernelForTool(ENGRAVING, 0.2);
    const { actual, surface } = planeTip(ENGRAVING, 4);
    expect(actual).toBeCloseTo(surface + 4 * R - kernel.surfaceDzAtRadius(R), 5);
  });

  it.each([0.3, 1])('seats a tapered ball on its ball below the flank (slope %s)', (slope) => {
    const ball = 0.25;
    const { actual, surface } = planeTip(TAPERED, slope);
    expect(actual).toBeCloseTo(surface + ball * (Math.sqrt(1 + slope * slope) - 1), 5);
  });

  it('moves a tapered ball contact to the rim above the flank slope', () => {
    const kernel = kernelForTool(TAPERED, 0.2);
    const { actual, surface } = planeTip(TAPERED, 6);
    expect(actual).toBeCloseTo(surface + 6 * R - kernel.surfaceDzAtRadius(R), 5);
  });
});

describe('surface contact — known answer on a ridge edge', () => {
  it.each([0.5, 0])('finds a ball contact on a ridge sloping %s between samples', (k) => {
    // Roof z = -3 + k x - m |y - y0| with the ridge on row 10; a ball centred
    // d = 0.3 mm off the ridge can only touch the ridge line itself.
    const mmPerCell = 0.1;
    const cells = 41;
    const ridgeRow = 10;
    const m = 8;
    const depth = new Float32Array(cells * 21);
    for (let j = 0; j < 21; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        depth[j * cells + i] =
          -3 + k * (i + 0.5) * mmPerCell - m * Math.abs(j - ridgeRow) * mmPerCell;
      }
    }
    const map: Heightmap = {
      widthCells: cells,
      heightCells: 21,
      widthMm: cells * mmPerCell,
      heightMm: 21 * mmPerCell,
      mmPerCell,
      depth,
    };
    const R = 0.7;
    const d = 0.3;
    const cx = 20;
    const ridgeAtCenter = -3 + k * (cx + 0.5) * mmPerCell;
    const rho = Math.sqrt(R * R - d * d);
    const expected = ridgeAtCenter + rho * Math.sqrt(1 + k * k) - R;

    const actual = contactAt(map, kernelForTool(BALL, mmPerCell), cx, ridgeRow - 3);

    expect(actual).toBeCloseTo(expected, 5);
  });
});

describe('surface contact — level edges', () => {
  it('finds a v-bit contact at the nearest approach of a level edge', () => {
    // Found by the oracle property below: on a level edge the stationary
    // quadratic has a double root that rounding turned into no root.
    const depths = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, -531, 0, 0, 0, 0, -685, -1216, -685, 0, 0, 0, -9, -531, 0, -463, 0,
      0, 0, 0, 0, 0,
    ];
    const map: Heightmap = {
      widthCells: 6,
      heightCells: 5,
      widthMm: 2.825,
      heightMm: 2.2,
      mmPerCell: 0.5,
      depth: Float32Array.from(depths, (depth) => depth / 1_000),
    };
    const kernel = kernelForTool(V_BIT, map.mmPerCell);
    // The level edge (2.25, 1.75)-(1.75, 2.1) at z = 0, seen from the sample
    // (1.75, 1.25): |(-0.5, 0.35) x (-0.5, -0.5)| / |(-0.5, 0.35)|.
    const nearest = 0.425 / Math.hypot(0.5, 0.35);
    expect(contactAt(map, kernel, 3, 2)).toBeCloseTo(-kernel.surfaceDzAtRadius(nearest), 6);
  });
});

describe('surface contact — field bounds', () => {
  it('has no field for a single sample or a zero-radius cutter', () => {
    const single: Heightmap = {
      widthCells: 1,
      heightCells: 1,
      widthMm: 1,
      heightMm: 1,
      mmPerCell: 1,
      depth: Float32Array.from([-1]),
    };
    expect(createSurfaceContactField(single, kernelForTool(BALL, 1))).toBeNull();
    const point: CncTool = { ...FLAT, diameterMm: 0 };
    expect(createSurfaceContactField(rampMap(0, 0), kernelForTool(point, 0.2))).toBeNull();
  });

  it('keeps a lower bound that the surface does not exceed', () => {
    const map = rampMap(0, 0);
    const field = createSurfaceContactField(map, kernelForTool(BALL, map.mmPerCell));
    expect(field?.constraint(3, 3, 0)).toBe(0);
    expect(field?.constraint(3, 3, -10)).toBeCloseTo(-5, 6);
  });

  it('never builds surface from mask-excluded samples', () => {
    const map: Heightmap = {
      ...rampMap(0, 0, 5, 1),
      depth: new Float32Array(25).fill(-4),
      inclusion: Uint8Array.from(Array.from({ length: 25 }, (_, index) => (index === 12 ? 0 : 1))),
    };
    map.depth[12] = 0;
    const kernel = kernelForTool({ ...FLAT, diameterMm: 3 }, 1);
    expect(contactAt(map, kernel, 1, 2)).toBeCloseTo(-4, 6);
  });
});

const WIDTH = 6;
const HEIGHT = 5;
const CELL_MM = 0.5;
const DEPTHS = fc.array(fc.integer({ min: -6_000, max: 0 }), {
  minLength: WIDTH * HEIGHT,
  maxLength: WIDTH * HEIGHT,
});
const MASK = fc.array(fc.boolean(), { minLength: WIDTH * HEIGHT, maxLength: WIDTH * HEIGHT });
// Planar-quad and pruning shortcuts are exact to 1e-6 mm, far below the
// 0.001 mm emit grid.
const TOLERANCE_MM = 3e-6;

describe('surface contact — independent oracle', () => {
  const cases = TOOLS.flatMap((tool) => [
    { tool, growthMm: 0 },
    { tool, growthMm: 0.3 },
  ]);

  it.each(cases)(
    'matches the oracle for $tool.kind grown by $growthMm mm',
    ({ tool, growthMm }) => {
      fc.assert(
        fc.property(DEPTHS, MASK, fc.boolean(), fc.boolean(), (depths, mask, masked, partial) => {
          const map: Heightmap = {
            widthCells: WIDTH,
            heightCells: HEIGHT,
            widthMm: partial ? 2.825 : WIDTH * CELL_MM,
            heightMm: partial ? 2.2 : HEIGHT * CELL_MM,
            mmPerCell: CELL_MM,
            depth: Float32Array.from(depths, (depth) => depth / 1_000),
            ...(masked ? { inclusion: Uint8Array.from(mask, (isIn) => (isIn ? 1 : 0)) } : {}),
          };
          const kernel = kernelForTool(tool, CELL_MM, 0, growthMm);
          const field = createSurfaceContactField(map, kernel);
          const surface = triangulatedSurface(map);
          for (let cy = 0; cy < HEIGHT; cy += 1) {
            for (let cx = 0; cx < WIDTH; cx += 1) {
              const xc = partialCellCenter(map, 'x', cx);
              const yc = partialCellCenter(map, 'y', cy);
              const actual = field?.constraint(cx, cy, Number.NEGATIVE_INFINITY);
              const expected = oracleContact(kernel, surface, xc, yc);
              if (expected === Number.NEGATIVE_INFINITY) {
                expect(actual).toBe(Number.NEGATIVE_INFINITY);
                continue;
              }
              expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(TOLERANCE_MM);
              expect(densestSample(kernel, surface, xc, yc)).toBeLessThanOrEqual(
                (actual ?? 0) + TOLERANCE_MM,
              );
            }
          }
        }),
        { numRuns: 8 },
      );
    },
  );
});
