import { describe, expect, it } from 'vitest';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/precision';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';
import { outsideStockDistanceMm, outsideStockStrips } from './heightmap-outside-stock';
import { dilateHeightmapByTool } from './heightmap-tool-offset';

// ADR-412 Amendment 2: the stock past a relief map's edge stands at the stock
// top, so no cutter reaches past the relief's own footprint.

const END_MILL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 2 };
const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 2 };

const ROWS = 21;
const MIDDLE_ROW = 10;

// A uniform floor 3 mm deep, `widthMm` wide and 21 cells tall; the tests read
// its middle row, whose centre stands 2.6 mm from the near and far sides.
function floorMap(widthMm: number, mmPerCell: number): Heightmap {
  const widthCells = Math.ceil(widthMm / mmPerCell - 1e-9);
  return {
    widthCells,
    heightCells: ROWS,
    widthMm,
    heightMm: ROWS * mmPerCell,
    mmPerCell,
    depth: new Float32Array(widthCells * ROWS).fill(-3),
  };
}

function middleRow(map: Heightmap, tip: Float32Array): ReadonlyArray<number> {
  return [...tip.slice(MIDDLE_ROW * map.widthCells, (MIDDLE_ROW + 1) * map.widthCells)];
}

function centerX(map: Heightmap, cx: number): number {
  const start = cx * map.mmPerCell;
  return (start + Math.min(start + map.mmPerCell, map.widthMm)) / 2;
}

describe('the stock past a relief map edge', () => {
  it('lies straight across the nearest side, a shortened terminal cell included', () => {
    const extent = { widthMm: 10.3, heightMm: 4 };
    expect(outsideStockDistanceMm(extent, 0.5, 2)).toBe(0.5);
    expect(outsideStockDistanceMm(extent, 10.15, 2)).toBeCloseTo(0.15, 12);
    expect(outsideStockDistanceMm(extent, 5, 3.9)).toBeCloseTo(0.1, 12);
    expect(outsideStockDistanceMm(extent, 5, 2)).toBe(2);
    expect(outsideStockDistanceMm(extent, -1, 2)).toBe(0);
  });

  it('is covered by four strips that reach past every point a cutter can touch', () => {
    const strips = outsideStockStrips({ widthMm: 10, heightMm: 4 }, 2);
    const covered = (x: number, y: number): boolean =>
      strips.some((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
    for (const [x, y] of [
      [-2, 2],
      [12, 2],
      [5, -2],
      [5, 6],
      [-2, -2],
      [12, 6],
      [-0.001, 0.001],
    ] as const) {
      expect(covered(x, y)).toBe(true);
    }
    expect(covered(5, 2)).toBe(false);
  });

  it('holds an end mill at the stock top within its reach of the edge', () => {
    // 10.3 mm on 0.25 mm cells ends in a 0.05 mm terminal cell.
    const map = floorMap(10.3, 0.25);
    const kernel = kernelForTool(END_MILL, map.mmPerCell);
    const row = middleRow(map, dilateHeightmapByTool(map, kernel, 0));
    for (let cx = 0; cx < map.widthCells; cx += 1) {
      const x = centerX(map, cx);
      const distance = Math.min(x, map.widthMm - x) - kernel.maskPathUncertaintyMm;
      // Within reach the tip may not descend at all; beyond it, to the floor.
      expect(row[cx], `x ${x}`).toBe(distance <= kernel.radiusMm ? 0 : -3);
    }
    expect(row.filter((tip) => tip === -3)).toHaveLength(33);
  });

  it('lets a ball descend along its own profile as it leaves the edge', () => {
    const map = floorMap(10.3, 0.25);
    const kernel = kernelForTool(BALL, map.mmPerCell);
    const row = middleRow(map, dilateHeightmapByTool(map, kernel, 0));
    for (let cx = 0; cx < map.widthCells; cx += 1) {
      const x = centerX(map, cx);
      const distance = Math.max(0, Math.min(x, map.widthMm - x) - kernel.maskPathUncertaintyMm);
      if (distance > kernel.radiusMm) {
        expect(row[cx]).toBe(-3);
        continue;
      }
      const law = CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(BALL, distance, 1);
      expect(row[cx], `x ${x}`).toBeCloseTo(Math.min(0, Math.max(-3, law)), 6);
    }
  });

  it('leaves a relief whose edge stands at the stock top as it was', () => {
    const base = floorMap(10, 0.25);
    const depth = new Float32Array(40 * ROWS).fill(0);
    for (let row = 0; row < ROWS; row += 1) depth.fill(-3, row * 40 + 8, row * 40 + 32);
    const map: Heightmap = { ...base, depth };
    const kernel = kernelForTool(END_MILL, map.mmPerCell);
    const tip = middleRow(map, dilateHeightmapByTool(map, kernel, 0));
    // The 2 mm rims' own surface already holds the end mill a radius off
    // them: cell 11's centre (2.875) is 1 mm from the last rim sample (1.875).
    expect([...tip]).toEqual([
      ...new Array<number>(12).fill(0),
      ...new Array<number>(16).fill(-3),
      ...new Array<number>(12).fill(0),
    ]);
  });
});
