import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/precision';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';
import { createMaskStock } from './relief-mask-stock';
import {
  bruteForceTip,
  excludedCenters,
  maskedMapArb,
  TOOLS,
} from './relief-mask-stock.test-support';

// ADR-484: excluded stock as a cutter centred anywhere meets it.

describe('createMaskStock (ADR-484)', () => {
  it('matches every excluded cell checked one by one, on and off the map', () => {
    fc.assert(
      fc.property(
        maskedMapArb,
        fc.constantFrom(...TOOLS),
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        fc.array(
          fc.tuple(
            fc.double({ min: -0.3, max: 1.3, noNaN: true }),
            fc.double({ min: -0.3, max: 1.3, noNaN: true }),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        // Points round an excluded cell out to just past the cutter's reach,
        // where the nearest cell decides.
        fc.array(
          fc.tuple(
            fc.nat(),
            fc.double({ min: 0, max: 1.2, noNaN: true }),
            fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        (map, tool, clearanceMm, points, around) => {
          const stock = createMaskStock(map, kernelForTool(tool, map.mmPerCell), clearanceMm);
          if (stock === null) throw new Error('expected excluded stock');
          const excluded = excludedCenters(map);
          const reachMm = tool.diameterMm / 2 + clearanceMm + map.mmPerCell;
          const probes = [
            ...points.map(([u, v]) => ({ x: u * map.widthMm, y: v * map.heightMm })),
            ...around.map(([pick, fraction, angle]) => {
              const center = excluded[pick % excluded.length] ?? { x: 0, y: 0 };
              return {
                x: center.x + fraction * reachMm * Math.cos(angle),
                y: center.y + fraction * reachMm * Math.sin(angle),
              };
            }),
          ];
          for (const { x, y } of probes) {
            const expected = bruteForceTip(map, tool, clearanceMm, x, y);
            const actual = stock.tipAt(x, y);
            if (expected === Number.NEGATIVE_INFINITY) {
              expect(actual).toBe(Number.NEGATIVE_INFINITY);
            } else {
              expect(actual).toBeCloseTo(expected, 9);
            }
          }
        },
      ),
      { numRuns: 300, seed: 451 },
    );
  });

  it('matches a lone excluded cell at every distance out past the reach', () => {
    for (const mmPerCell of [0.1, 0.17, 0.25, 0.33]) {
      const cells = Math.ceil(8 / mmPerCell);
      const inclusion = new Uint8Array(cells * cells).fill(1);
      const middle = Math.floor(cells / 2);
      inclusion[middle * cells + middle] = 0;
      const map: Heightmap = {
        widthCells: cells,
        heightCells: cells,
        widthMm: cells * mmPerCell,
        heightMm: cells * mmPerCell,
        mmPerCell,
        depth: new Float32Array(cells * cells).fill(-1),
        inclusion,
      };
      const center = (middle + 0.5) * mmPerCell;
      for (const tool of TOOLS) {
        for (const clearanceMm of [0, 0.05]) {
          const stock = createMaskStock(map, kernelForTool(tool, mmPerCell), clearanceMm);
          const reachMm = tool.diameterMm / 2 + clearanceMm + mmPerCell;
          for (const angle of [0, Math.PI / 9, Math.PI / 4, (5 * Math.PI) / 4]) {
            for (let r = 0; r <= reachMm; r += 0.003) {
              const x = center + r * Math.cos(angle);
              const y = center + r * Math.sin(angle);
              const expected = bruteForceTip(map, tool, clearanceMm, x, y);
              expect(stock?.tipAt(x, y)).toBeCloseTo(expected, 9);
            }
          }
        }
      }
    }
  });

  it('finds a nearer excluded cell one ring further out', () => {
    // From the centre of cell (12, 12), cell (15, 15) is three rings out and
    // 0.884 mm off; cell (16, 12) is four rings out but only 0.875 mm off. The
    // map's edge is 3.125 mm off, out of the ball's reach.
    const inclusion = new Uint8Array(32 * 32).fill(1);
    inclusion[15 * 32 + 15] = 0;
    inclusion[12 * 32 + 16] = 0;
    const map: Heightmap = {
      widthCells: 32,
      heightCells: 32,
      widthMm: 8,
      heightMm: 8,
      mmPerCell: 0.25,
      depth: new Float32Array(32 * 32).fill(-1),
      inclusion,
    };
    const tool = TOOLS[0] as CncTool;
    const stock = createMaskStock(map, kernelForTool(tool, map.mmPerCell), 0);

    expect(stock?.tipAt(3.125, 3.125)).toBeCloseTo(
      CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, 0.875, tool.diameterMm / 2),
      12,
    );
  });

  it('stands a quantum above stock top over an excluded cell', () => {
    // Cell (10, 8) of a 10 x 4 mm map: x 2.5 to 2.75, y 2 to 2.25. Every
    // probe stays more than the ball's reach from the map's edge.
    const inclusion = new Uint8Array(40 * 16).fill(1);
    inclusion[8 * 40 + 10] = 0;
    const map: Heightmap = {
      widthCells: 40,
      heightCells: 16,
      widthMm: 10,
      heightMm: 4,
      mmPerCell: 0.25,
      depth: new Float32Array(40 * 16).fill(-2),
      inclusion,
    };
    const tool = TOOLS[0] as CncTool;
    const stock = createMaskStock(map, kernelForTool(tool, map.mmPerCell), 0.001);

    expect(stock?.tipAt(2.625, 2.125)).toBe(CNC_MASK_EMISSION_Z_CLEARANCE_MM);
    // Just past the cell and its clearance the ball's side meets the block.
    expect(stock?.tipAt(2.75 + 0.5 + 0.001, 2.125)).toBeCloseTo(
      CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, 0.5, 3.175 / 2),
      12,
    );
    expect(stock?.tipAt(2.75 + 1.6 + 0.001, 2.125)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('holds the stock past the edge of a map that excludes nothing (ADR-412 Amendment 2)', () => {
    const tool = TOOLS[1] as CncTool;
    const map: Heightmap = {
      widthCells: 40,
      heightCells: 40,
      widthMm: 10,
      heightMm: 10,
      mmPerCell: 0.25,
      depth: new Float32Array(1600).fill(-1),
    };
    const kernel = kernelForTool(tool, map.mmPerCell);
    for (const candidate of [map, { ...map, inclusion: new Uint8Array(1600).fill(1) }]) {
      const stock = createMaskStock(candidate, kernel, 0.001);
      // Within the 2 mm end mill's reach of the edge its tip keeps to the
      // stock top, and no higher; further in nothing is in reach.
      expect(stock?.tipAt(0.5, 5)).toBe(0);
      expect(stock?.tipAt(5, 9.5)).toBe(0);
      expect(stock?.tipAt(-1, 5)).toBe(0);
      expect(stock?.tipAt(5, 5)).toBe(Number.NEGATIVE_INFINITY);
      // A move along the edge at the stock top passes; one into it is lifted.
      expect(stock?.moveExcess({ x: 0.5, y: 2, z: 0 }, { x: 0.5, y: 8, z: 0 })).toBeNull();
      expect(stock?.moveExcess({ x: 5, y: 5, z: -1 }, { x: 0.5, y: 5, z: -1 })?.point.z).toBe(0);
    }
  });
});
