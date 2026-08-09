import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../job';
import type { CncTool } from '../scene';
import type { RemovalGrid, RemovalGridSpec } from './removal-grid';
import { computeRemovalGrid } from './stamp-toolpath';
import { kernelForTool } from './tool-kernels';

const PITCH_MM = 0.3;
const TOOL_RADIUS_MM = 0.4;
const CROSS_AXIS_MM = 0.45;

const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'edge-end', name: 'edge end mill', kind: 'end-mill', diameterMm: TOOL_RADIUS_MM * 2 },
  { id: 'edge-ball', name: 'edge ball nose', kind: 'ball-nose', diameterMm: TOOL_RADIUS_MM * 2 },
];

const GRIDS: ReadonlyArray<{ readonly name: string; readonly spec: RemovalGridSpec }> = [
  {
    name: 'regular',
    spec: { originX: 0, originY: 0, widthMm: 1.2, heightMm: 1.2, mmPerCell: PITCH_MM },
  },
  {
    name: 'partial',
    spec: { originX: 0, originY: 0, widthMm: 1, heightMm: 1, mmPerCell: PITCH_MM },
  },
];

const EDGES = [
  { axis: 'x', side: 'min' },
  { axis: 'x', side: 'max' },
  { axis: 'y', side: 'min' },
  { axis: 'y', side: 'max' },
] as const;

describe.each(GRIDS)('computeRemovalGrid - $name grid boundary overlap', ({ spec }) => {
  describe.each(EDGES)('$axis $side edge', ({ axis, side }) => {
    it.each(TOOLS)(
      '$kind stamps exact and just-outside overlap, but not beyond its radius',
      (tool) => {
        const edge = edgeCoordinate(spec, axis, side);
        const direction = side === 'min' ? -1 : 1;
        const exact = removalAt(spec, tool, pointAt(axis, edge));
        const outside = removalAt(
          spec,
          tool,
          pointAt(axis, edge + direction * (TOOL_RADIUS_MM / 2)),
        );
        const beyond = removalAt(
          spec,
          tool,
          pointAt(axis, edge + direction * (TOOL_RADIUS_MM + PITCH_MM)),
        );

        expect(boundaryDepth(exact, axis, side)).toBeLessThan(0);
        expect(boundaryDepth(outside, axis, side)).toBeLessThan(0);
        expect([...beyond.depth].every((depth) => depth === 0)).toBe(true);
      },
    );
  });
});

function removalAt(
  spec: RemovalGridSpec,
  tool: CncTool,
  point: { readonly x: number; readonly y: number },
): RemovalGrid {
  const toolpath: Toolpath = {
    steps: [{ kind: 'plunge', at: point, fromZ: 0, toZ: -1, length: 1 }],
    totalLength: 1,
  };
  const result = computeRemovalGrid(toolpath, spec, kernelForTool(tool, PITCH_MM));
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

function pointAt(
  axis: (typeof EDGES)[number]['axis'],
  coordinateMm: number,
): { readonly x: number; readonly y: number } {
  return axis === 'x'
    ? { x: coordinateMm, y: CROSS_AXIS_MM }
    : { x: CROSS_AXIS_MM, y: coordinateMm };
}

function edgeCoordinate(
  spec: RemovalGridSpec,
  axis: (typeof EDGES)[number]['axis'],
  side: (typeof EDGES)[number]['side'],
): number {
  if (side === 'min') return axis === 'x' ? spec.originX : spec.originY;
  return axis === 'x' ? spec.originX + spec.widthMm : spec.originY + spec.heightMm;
}

function boundaryDepth(
  grid: RemovalGrid,
  axis: (typeof EDGES)[number]['axis'],
  side: (typeof EDGES)[number]['side'],
): number {
  const cross = Math.floor(CROSS_AXIS_MM / grid.mmPerCell);
  const col = axis === 'x' ? (side === 'min' ? 0 : grid.widthCells - 1) : cross;
  const row = axis === 'y' ? (side === 'min' ? 0 : grid.heightCells - 1) : cross;
  return grid.depth[row * grid.widthCells + col] ?? 0;
}
