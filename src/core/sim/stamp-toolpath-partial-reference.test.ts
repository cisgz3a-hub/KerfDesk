import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { partialCellCenter, partialGridHasPartialCell } from '../grid';
import type { Toolpath } from '../job';
import type { CncTool } from '../scene';
import { createRemovalGrid, type RemovalGrid, type RemovalGridSpec } from './removal-grid';
import { computeRemovalGrid } from './stamp-toolpath';
import { cuttingSurfaceDz, kernelForTool, type ToolKernel } from './tool-kernels';

const PITCH_MM = 0.3;
const TIP_Z_MM = -1;

const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'hybrid-end', name: 'hybrid end', kind: 'end-mill', diameterMm: 0.8 },
  { id: 'hybrid-ball', name: 'hybrid ball', kind: 'ball-nose', diameterMm: 0.8 },
  { id: 'hybrid-v', name: 'hybrid v', kind: 'v-bit', diameterMm: 0.8, tipAngleDeg: 60 },
  {
    id: 'hybrid-engraving',
    name: 'hybrid engraving',
    kind: 'engraving',
    diameterMm: 0.8,
    tipAngleDeg: 60,
    tipDiameterMm: 0.1,
  },
];

const PARTIAL_GRIDS: ReadonlyArray<{ readonly name: string; readonly spec: RemovalGridSpec }> = [
  {
    name: 'partial X',
    spec: { originX: 0, originY: 0, widthMm: 3.1, heightMm: 3, mmPerCell: PITCH_MM },
  },
  {
    name: 'partial Y',
    spec: { originX: 0, originY: 0, widthMm: 3, heightMm: 3.1, mmPerCell: PITCH_MM },
  },
  {
    name: 'partial X and Y',
    spec: { originX: 0, originY: 0, widthMm: 3.1, heightMm: 3.1, mmPerCell: PITCH_MM },
  },
];

const REGULAR_SPEC: RemovalGridSpec = {
  originX: 0,
  originY: 0,
  widthMm: 3,
  heightMm: 3,
  mmPerCell: PITCH_MM,
};

describe.each(PARTIAL_GRIDS)('partial stamp hybrid reference - $name', ({ spec }) => {
  it.each(TOOLS)('$kind matches the brute-force hybrid at edges and generated points', (tool) => {
    for (const point of explicitPoints(spec)) assertMatchesReference(spec, tool, point);
    fc.assert(
      fc.property(pointArbitrary(spec), (point) => assertMatchesReference(spec, tool, point)),
      { numRuns: 50 },
    );
  });

  it.each(TOOLS)('$kind keeps an interior path identical to the regular-grid baseline', (tool) => {
    const regular = removalForPath(REGULAR_SPEC, tool);
    const partial = removalForPath(spec, tool);
    for (let row = 0; row < regular.heightCells; row += 1) {
      for (let col = 0; col < regular.widthCells; col += 1) {
        expect(partial.depth[row * partial.widthCells + col]).toBe(
          regular.depth[row * regular.widthCells + col],
        );
      }
    }
  });
});

describe('regular-grid stamp parity', () => {
  it.each(TOOLS)('$kind retains the indexed-kernel result across generated points', (tool) => {
    fc.assert(
      fc.property(pointArbitrary(REGULAR_SPEC), (point) =>
        assertMatchesReference(REGULAR_SPEC, tool, point),
      ),
      { numRuns: 50 },
    );
  });
});

describe('shifted terminal-cell cutter reach', () => {
  it('stamps a reachable regular cell beside a short terminal column', () => {
    const pitchMm = 1;
    const spec: RemovalGridSpec = {
      originX: 0,
      originY: 0,
      widthMm: 3.1,
      heightMm: 3,
      mmPerCell: pitchMm,
    };
    const tool: CncTool = {
      id: 'terminal-reach-end',
      name: 'terminal reach end mill',
      kind: 'end-mill',
      diameterMm: 1.5,
    };
    const point = { x: 3.05, y: 1.5 };
    const kernel = kernelForTool(tool, pitchMm);
    const actual = removalForPlunge(spec, kernel, point);

    expect([...actual.depth]).toEqual([...referencePlunge(spec, kernel, point).depth]);
    expect(actual.depth[6]).toBe(TIP_Z_MM);
  });

  it('stamps a reachable regular cell from a cutter center outside the short edge', () => {
    const pitchMm = 1;
    const spec: RemovalGridSpec = {
      originX: 0,
      originY: 0,
      widthMm: 3.1,
      heightMm: 3,
      mmPerCell: pitchMm,
    };
    const tool: CncTool = {
      id: 'outside-terminal-reach-end',
      name: 'outside terminal reach end mill',
      kind: 'end-mill',
      diameterMm: 3.2,
    };
    const point = { x: 4.05, y: 1.5 };
    const kernel = kernelForTool(tool, pitchMm);
    const actual = removalForPlunge(spec, kernel, point);

    expect([...actual.depth]).toEqual([...referencePlunge(spec, kernel, point).depth]);
    expect(actual.depth[6]).toBe(TIP_Z_MM);
  });
});

function assertMatchesReference(
  spec: RemovalGridSpec,
  tool: CncTool,
  point: { readonly x: number; readonly y: number },
): void {
  const kernel = kernelForTool(tool, PITCH_MM);
  const actual = removalForPlunge(spec, kernel, point);
  const expected = referencePlunge(spec, kernel, point);
  expect([...actual.depth]).toEqual([...expected.depth]);
}

function removalForPlunge(
  spec: RemovalGridSpec,
  kernel: ToolKernel,
  point: { readonly x: number; readonly y: number },
): RemovalGrid {
  return expectGrid(
    computeRemovalGrid(
      {
        steps: [{ kind: 'plunge', at: point, fromZ: 0, toZ: TIP_Z_MM, length: -TIP_Z_MM }],
        totalLength: -TIP_Z_MM,
      },
      spec,
      kernel,
    ),
  );
}

function referencePlunge(
  spec: RemovalGridSpec,
  kernel: ToolKernel,
  point: { readonly x: number; readonly y: number },
): RemovalGrid {
  const created = createRemovalGrid(spec);
  if (created.kind === 'error') throw new Error(created.reason);
  const grid = created.grid;
  const cx = Math.floor((point.x - grid.originX) / grid.mmPerCell);
  const cy = Math.floor((point.y - grid.originY) / grid.mmPerCell);
  for (let row = 0; row < grid.heightCells; row += 1) {
    for (let col = 0; col < grid.widthCells; col += 1) {
      const surfaceZ = referenceSurfaceZ(grid, kernel, point, cx, cy, col, row);
      if (surfaceZ < 0) grid.depth[row * grid.widthCells + col] = surfaceZ;
    }
  }
  return grid;
}

function referenceSurfaceZ(
  grid: RemovalGrid,
  kernel: ToolKernel,
  point: { readonly x: number; readonly y: number },
  cx: number,
  cy: number,
  col: number,
  row: number,
): number {
  const terminalCellIsInRange =
    (partialGridHasPartialCell(grid, 'x') &&
      Math.abs(cx - (grid.widthCells - 1)) <= kernel.surfaceCandidateSpanCells) ||
    (partialGridHasPartialCell(grid, 'y') &&
      Math.abs(cy - (grid.heightCells - 1)) <= kernel.surfaceCandidateSpanCells);
  if (!terminalCellIsInRange) {
    const offset = kernel.offsets.find((item) => item.dx === col - cx && item.dy === row - cy);
    return offset === undefined ? 0 : TIP_Z_MM + offset.dz;
  }
  const centerX = grid.originX + partialCellCenter(grid, 'x', col);
  const centerY = grid.originY + partialCellCenter(grid, 'y', row);
  const distanceMm = Math.hypot(centerX - point.x, centerY - point.y);
  return distanceMm > kernel.radiusMm
    ? 0
    : TIP_Z_MM + cuttingSurfaceDz(kernel.tool, distanceMm, kernel.radiusMm);
}

function explicitPoints(
  spec: RemovalGridSpec,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return [
    { x: 1.5, y: 1.5 },
    { x: spec.widthMm, y: 1.5 },
    { x: 1.5, y: spec.heightMm },
    { x: spec.widthMm + 0.2, y: spec.heightMm + 0.2 },
    { x: -0.2, y: -0.2 },
  ];
}

function pointArbitrary(spec: RemovalGridSpec) {
  return fc.record({
    x: fc.integer({ min: -50, max: Math.ceil((spec.widthMm + 0.5) * 100) }).map((n) => n / 100),
    y: fc.integer({ min: -50, max: Math.ceil((spec.heightMm + 0.5) * 100) }).map((n) => n / 100),
  });
}

function removalForPath(spec: RemovalGridSpec, tool: CncTool): RemovalGrid {
  const points = [
    { x: 0.6, y: 0.6 },
    { x: 1.5, y: 0.6 },
    { x: 1.5, y: 1.5 },
    { x: 0.6, y: 1.5 },
  ];
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from !== undefined && to !== undefined) length += Math.hypot(to.x - from.x, to.y - from.y);
  }
  const toolpath: Toolpath = {
    steps: [
      {
        kind: 'cut',
        color: '#000000',
        polyline: points,
        length,
        z: { from: TIP_Z_MM, to: TIP_Z_MM },
      },
    ],
    totalLength: length,
  };
  return expectGrid(computeRemovalGrid(toolpath, spec, kernelForTool(tool, PITCH_MM)));
}

function expectGrid(result: ReturnType<typeof computeRemovalGrid>): RemovalGrid {
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}
