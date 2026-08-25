import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import {
  dilateHeightmapByTool,
  dilateHeightmapByToolWithMaskEvidence,
} from './heightmap-tool-offset';
import {
  bruteForcePhysicalDilation,
  legacyRegularDilation,
} from './heightmap-tool-offset-test-reference';

const WIDTH_CELLS = 6;
const HEIGHT_CELLS = 5;
const CELL_COUNT = WIDTH_CELLS * HEIGHT_CELLS;
const CELL_MM = 0.5;
const PROPERTY_RUNS = 12;
const PARTIAL_AXES = ['x', 'y', 'both'] as const;
type PartialAxes = (typeof PARTIAL_AXES)[number];

const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 1.4 },
  { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 1.4 },
  { id: 'v-bit', name: 'v-bit', kind: 'v-bit', diameterMm: 1.4, tipAngleDeg: 60 },
  {
    id: 'engraving',
    name: 'engraving',
    kind: 'engraving',
    diameterMm: 1.4,
    tipAngleDeg: 45,
    tipDiameterMm: 0.2,
  },
];

const DEPTHS = fc.array(fc.integer({ min: -6_000, max: 0 }), {
  minLength: CELL_COUNT,
  maxLength: CELL_COUNT,
});
const MASK = fc.array(fc.boolean(), { minLength: CELL_COUNT, maxLength: CELL_COUNT });
const ALLOWANCE = fc.integer({ min: 0, max: 250 });

function partialMap(
  axes: PartialAxes,
  depths: ReadonlyArray<number>,
  mask: ReadonlyArray<boolean> | undefined,
): Heightmap {
  const widthMm = axes === 'x' || axes === 'both' ? 2.825 : WIDTH_CELLS * CELL_MM;
  const heightMm = axes === 'y' || axes === 'both' ? 2.2 : HEIGHT_CELLS * CELL_MM;
  return {
    widthCells: WIDTH_CELLS,
    heightCells: HEIGHT_CELLS,
    widthMm,
    heightMm,
    mmPerCell: CELL_MM,
    depth: Float32Array.from(depths, (depth) => depth / 1_000),
    ...(mask === undefined
      ? {}
      : { inclusion: Uint8Array.from(mask, (isIncluded) => (isIncluded ? 1 : 0)) }),
  };
}

function exactExtentMap(
  depths: ReadonlyArray<number>,
  mask: ReadonlyArray<boolean> | undefined,
): Heightmap {
  return {
    ...partialMap('x', depths, mask),
    widthMm: WIDTH_CELLS * CELL_MM,
    heightMm: HEIGHT_CELLS * CELL_MM,
  };
}

function expectSameBits(actual: Float32Array, expected: Float32Array): void {
  expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer));
}

describe('partial-edge dilation equivalence', () => {
  const cases = PARTIAL_AXES.flatMap((axes) =>
    TOOLS.flatMap((tool) => [
      { axes, tool, isMasked: false },
      { axes, tool, isMasked: true },
    ]),
  );

  it.each(cases)(
    'matches a physical brute-force oracle for $axes / $tool.kind / masked=$isMasked',
    ({ axes, tool, isMasked }) => {
      fc.assert(
        fc.property(DEPTHS, MASK, ALLOWANCE, (depths, mask, allowanceMicrons) => {
          const map = partialMap(axes, depths, isMasked ? mask : undefined);
          const kernel = kernelForTool(tool, map.mmPerCell, map.mmPerCell / 7);
          const allowanceMm = allowanceMicrons / 1_000;
          const expected = bruteForcePhysicalDilation(map, kernel, allowanceMm);
          const actual = dilateHeightmapByToolWithMaskEvidence(map, kernel, allowanceMm);

          expectSameBits(actual.tipDepth, expected.tipDepth);
          expect(actual.touchesExcluded).toEqual(expected.touchesExcluded);
          expectSameBits(dilateHeightmapByTool(map, kernel, allowanceMm), expected.tipDepth);
        }),
        { numRuns: PROPERTY_RUNS },
      );
    },
  );

  it.each(TOOLS)('preserves exact-divisible Uint32 output for $kind tools', (tool) => {
    fc.assert(
      fc.property(DEPTHS, MASK, ALLOWANCE, fc.boolean(), (depths, mask, allowance, masked) => {
        const map = exactExtentMap(depths, masked ? mask : undefined);
        const kernel = kernelForTool(tool, map.mmPerCell, map.mmPerCell / 9);
        const allowanceMm = allowance / 1_000;
        const expected = legacyRegularDilation(map, kernel, allowanceMm);
        const actual = dilateHeightmapByToolWithMaskEvidence(map, kernel, allowanceMm);

        expectSameBits(actual.tipDepth, expected.tipDepth);
        expect(actual.touchesExcluded).toEqual(expected.touchesExcluded);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('keeps a max-finite flat terminal shift finite and reaches a boundary sample', () => {
    const mmPerCell = Number.MAX_VALUE * 0.75;
    const tool: CncTool = {
      id: 'max-finite-flat',
      name: 'max-finite flat',
      kind: 'end-mill',
      diameterMm: Number.MAX_VALUE,
    };
    const kernel: ToolKernel = {
      tool,
      radiusMm: Number.MAX_VALUE / 2,
      mmPerCell,
      radiusCells: 1,
      surfaceCandidateSpanCells: 2,
      offsets: [{ dx: 0, dy: 0, dz: 0 }],
      surfaceDzAtRadius: () => 0,
      maskCellCandidateSpanCells: 0,
      maskSweepCandidateSpanCells: 0,
      maskPathUncertaintyMm: 0,
      maskSweepPathUncertaintyMm: 0,
    };
    const map: Heightmap = {
      widthCells: 2,
      heightCells: 1,
      widthMm: Number.MAX_VALUE,
      heightMm: mmPerCell,
      mmPerCell,
      depth: Float32Array.from([0, -1]),
    };

    expect([...dilateHeightmapByTool(map, kernel, 0)]).toEqual([0, 0]);
  });
});
