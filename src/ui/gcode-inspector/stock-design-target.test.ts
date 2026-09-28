import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { reliefMachineSpaceTransform } from '../../core/cnc/relief-machine-space';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import {
  applyTransform,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
  type Transform,
} from '../../core/scene';
import { reliefToProgram, type InspectionRelief } from './inspection-design';
import { compareWithDesign } from './stock-compare';
import { designTarget, NO_DESIGN, type StockCells } from './stock-design-target';

// A flat relief 10 mm square: `depth` deep everywhere its mask includes.
function flat(depth: number, inclusionMask?: ReadonlyArray<number>): ReliefObject {
  return {
    kind: 'relief',
    id: `flat-${depth}`,
    source: 'flat.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: depth,
      samplesU8: [0, 0, 0, 0],
      ...(inclusionMask === undefined ? {} : { inclusionMask }),
    }),
    targetWidthMm: 10,
    reliefDepthMm: depth,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
}

// Heightmap millimetres straight onto program millimetres, moved by (x, y).
function at(relief: ReliefObject, x: number, y: number): InspectionRelief {
  return { relief, toProgram: [1, 0, 0, 1, x, y] };
}

// 20 x 10 cells of 1 mm from (0, 0).
const CELLS: StockCells = { originX: 0, originY: 0, mmPerCell: 1, widthCells: 20, heightCells: 10 };

function cell(target: Float32Array, column: number, row: number): number | undefined {
  return target[row * CELLS.widthCells + column];
}

describe('the relief design the carved stock is compared with (ADR-487)', () => {
  it('lays each relief where it is placed, and nothing elsewhere', () => {
    const target = designTarget(CELLS, [at(flat(2), 5, 0)]);
    if (target === null) throw new Error('no design');
    expect(cell(target, 7, 5)).toBeCloseTo(-2);
    expect(cell(target, 14, 9)).toBeCloseTo(-2);
    expect(cell(target, 4, 5)).toBe(NO_DESIGN);
    expect(cell(target, 15, 5)).toBe(NO_DESIGN);
  });

  it('takes the deeper where reliefs overlap', () => {
    const target = designTarget(CELLS, [at(flat(1), 0, 0), at(flat(3), 5, 0)]);
    if (target === null) throw new Error('no design');
    expect(cell(target, 2, 2)).toBeCloseTo(-1);
    expect(cell(target, 7, 2)).toBeCloseTo(-3);
    expect(cell(target, 12, 2)).toBeCloseTo(-3);
  });

  it("leaves out what a relief's mask leaves out", () => {
    // The mask keeps only the left half.
    const target = designTarget(CELLS, [at(flat(2, [255, 0, 255, 0]), 0, 0)]);
    if (target === null) throw new Error('no design');
    expect(cell(target, 2, 5)).toBeCloseTo(-2);
    expect(cell(target, 8, 5)).toBe(NO_DESIGN);
  });

  it('has no design when no relief lands on the stock', () => {
    expect(designTarget(CELLS, [])).toBeNull();
    expect(designTarget(CELLS, [at(flat(2), 100, 100)])).toBeNull();
  });

  it('places a relief as the compiler does: its own placement, the origin, then the job', () => {
    const turned: Transform = {
      x: 40,
      y: 25,
      scaleX: -1.5,
      scaleY: 2,
      rotationDeg: 70,
      mirrorX: true,
      mirrorY: false,
    };
    const relief = { ...flat(2), transform: turned };
    const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'center' as const };
    const offset = { x: -7, y: 12.5 };
    const [a, b, c, d, e, f] = reliefToProgram(relief, device, offset);
    const residual = reliefMachineSpaceTransform(turned).residualTransform;
    for (const [x, y] of [
      [0, 0],
      [9, 1],
      [3.5, 7.25],
    ] as const) {
      const machine = toMachineCoords(applyTransform({ x, y }, residual), device);
      expect(a * x + c * y + e).toBeCloseTo(machine.x + offset.x, 9);
      expect(b * x + d * y + f).toBeCloseTo(machine.y + offset.y, 9);
    }
  });
});

describe('the carving against the design (ADR-487)', () => {
  it('counts cells left above, within and cut below the design', () => {
    const target = new Float32Array([-1, -1, -1, -1, NO_DESIGN]);
    const depth = new Float32Array([0, -0.95, -1.05, -1.6, -3]);
    expect(compareWithDesign(depth, target, 0.1)).toEqual({
      cells: 4,
      leftover: 1,
      within: 2,
      gouged: 1,
      mostLeftMm: 1,
      deepestGougeMm: expect.closeTo(0.6, 5),
    });
  });
});
