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
    // From the centre of cell (2, 2), cell (5, 5) is three rings out and
    // 0.884 mm off; cell (6, 2) is four rings out but only 0.875 mm off.
    const inclusion = new Uint8Array(12 * 12).fill(1);
    inclusion[5 * 12 + 5] = 0;
    inclusion[2 * 12 + 6] = 0;
    const map: Heightmap = {
      widthCells: 12,
      heightCells: 12,
      widthMm: 3,
      heightMm: 3,
      mmPerCell: 0.25,
      depth: new Float32Array(144).fill(-1),
      inclusion,
    };
    const tool = TOOLS[0] as CncTool;
    const stock = createMaskStock(map, kernelForTool(tool, map.mmPerCell), 0);

    expect(stock?.tipAt(0.625, 0.625)).toBeCloseTo(
      CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, 0.875, tool.diameterMm / 2),
      12,
    );
  });

  it('stands a quantum above stock top over an excluded cell', () => {
    const map: Heightmap = {
      widthCells: 3,
      heightCells: 1,
      widthMm: 0.75,
      heightMm: 0.25,
      mmPerCell: 0.25,
      depth: new Float32Array(3).fill(-2),
      inclusion: Uint8Array.from([1, 0, 1]),
    };
    const tool = TOOLS[0] as CncTool;
    const stock = createMaskStock(map, kernelForTool(tool, map.mmPerCell), 0.001);

    expect(stock?.tipAt(0.375, 0.125)).toBe(CNC_MASK_EMISSION_Z_CLEARANCE_MM);
    // Just past the cell and its clearance the ball's side meets the block.
    expect(stock?.tipAt(0.5 + 0.5 + 0.001, 0.125)).toBeCloseTo(
      CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, 0.5, 3.175 / 2),
      12,
    );
    expect(stock?.tipAt(0.5 + 1.6 + 0.001, 0.125)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('is absent for a map that excludes nothing', () => {
    const tool = TOOLS[0] as CncTool;
    const map: Heightmap = {
      widthCells: 2,
      heightCells: 2,
      widthMm: 0.5,
      heightMm: 0.5,
      mmPerCell: 0.25,
      depth: new Float32Array(4),
    };
    const kernel = kernelForTool(tool, map.mmPerCell);

    expect(createMaskStock(map, kernel, 0)).toBeNull();
    expect(createMaskStock({ ...map, inclusion: new Uint8Array(4).fill(1) }, kernel, 0)).toBeNull();
  });
});
