// Test support (ADR-482): excluded stock checked one excluded cell at a time,
// and random masked maps.
import fc from 'fast-check';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/precision';
import { partialCellEnd, partialCellStart } from '../grid';
import type { CncTool } from '../scene';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';

export const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 },
  { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 2 },
  { id: 'v', name: 'v-bit', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 60 },
];

// Every excluded cell's whole physical rectangle, checked one by one.
export function bruteForceTip(
  map: Heightmap,
  tool: CncTool,
  clearanceMm: number,
  x: number,
  y: number,
): number {
  const radiusMm = tool.diameterMm / 2;
  let best = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      if (map.inclusion?.[j * map.widthCells + i] !== 0) continue;
      const dx = gap(x, partialCellStart(map, 'x', i), partialCellEnd(map, 'x', i));
      const dy = gap(y, partialCellStart(map, 'y', j), partialCellEnd(map, 'y', j));
      const distanceMm = Math.max(0, Math.hypot(dx, dy) - clearanceMm);
      if (distanceMm > radiusMm + 1e-9) continue;
      best = Math.max(
        best,
        CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, distanceMm, radiusMm),
      );
    }
  }
  return best;
}

export function excludedCenters(map: Heightmap): ReadonlyArray<{ x: number; y: number }> {
  const centers: Array<{ x: number; y: number }> = [];
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      if (map.inclusion?.[j * map.widthCells + i] !== 0) continue;
      centers.push({
        x: (partialCellStart(map, 'x', i) + partialCellEnd(map, 'x', i)) / 2,
        y: (partialCellStart(map, 'y', j) + partialCellEnd(map, 'y', j)) / 2,
      });
    }
  }
  return centers;
}

function gap(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

// Sparse masks (a few excluded cells, so the nearest one can sit anywhere
// round a point) and dense ones, on grids with a shortened last cell.
export const maskedMapArb = fc
  .record({
    widthCells: fc.integer({ min: 2, max: 40 }),
    heightCells: fc.integer({ min: 1, max: 40 }),
    mmPerCell: fc.double({ min: 0.1, max: 0.6, noNaN: true }),
    shortX: fc.double({ min: 0, max: 0.9, noNaN: true }),
    shortY: fc.double({ min: 0, max: 0.9, noNaN: true }),
    excluded: fc.array(
      fc.tuple(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
      ),
      { minLength: 1, maxLength: 4 },
    ),
    denseShare: fc.constantFrom(0, 0, 0.3),
    seed: fc.integer(),
  })
  .map((spec): Heightmap => {
    const { widthCells, heightCells } = spec;
    const cells = widthCells * heightCells;
    const random = fc.sample(fc.double({ min: 0, max: 1, noNaN: true }), {
      numRuns: cells,
      seed: spec.seed,
    });
    const inclusion = Uint8Array.from(random, (value) => (value < spec.denseShare ? 0 : 1));
    for (const [u, v] of spec.excluded) {
      const i = Math.min(widthCells - 1, Math.floor(u * widthCells));
      const j = Math.min(heightCells - 1, Math.floor(v * heightCells));
      inclusion[j * widthCells + i] = 0;
    }
    return {
      widthCells,
      heightCells,
      widthMm: (widthCells - spec.shortX) * spec.mmPerCell,
      heightMm: (heightCells - spec.shortY) * spec.mmPerCell,
      mmPerCell: spec.mmPerCell,
      depth: new Float32Array(cells).fill(-1),
      inclusion,
    };
  });
