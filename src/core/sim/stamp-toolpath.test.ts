import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath } from '../job';
import type { CncPass, Job } from '../job';
import { compileCncJob } from '../cnc';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  activeCncTool,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { computeRemovalGrid } from './stamp-toolpath';
import { kernelForTool } from './tool-kernels';

const SAFE_Z_MM = 3.81;
const FLAT_TOOL = { id: 't', name: 't', kind: 'end-mill', diameterMm: 2 } as const;

function jobOf(passes: ReadonlyArray<CncPass>): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'L1',
        color: '#ff0000',
        cutType: 'engrave',
        toolDiameterMm: FLAT_TOOL.diameterMm,
        feedMmPerMin: 1000,
        plungeMmPerMin: 300,
        spindleRpm: 12000,
        spindleSpinupSec: 3,
        safeZMm: SAFE_Z_MM,
        passes,
      },
    ],
  };
}

// Property tests run on a small coarse grid (60 × 60 cells) so 100 seeds
// finish fast; the perceptual test below uses the fine grid.
const GRID_SPEC = { originX: 0, originY: 0, widthMm: 30, heightMm: 30, mmPerCell: 0.5 };

function expectGrid(result: ReturnType<typeof computeRemovalGrid>) {
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

describe('computeRemovalGrid — properties', () => {
  const gridCoord = fc.integer({ min: 500, max: 2500 }).map((n) => n / 100);
  const gridDepth = fc.integer({ min: -500, max: -10 }).map((n) => n / 100);
  const passes = fc.array(
    fc
      .record({
        polyline: fc.array(fc.record({ x: gridCoord, y: gridCoord }), {
          minLength: 2,
          maxLength: 5,
        }),
        zMm: gridDepth,
      })
      .map(({ polyline, zMm }): CncPass => ({ kind: 'contour', zMm, polyline, closed: false })),
    { minLength: 1, maxLength: 4 },
  );

  it('never records a depth below the deepest commanded Z (100 seeds)', () => {
    fc.assert(
      fc.property(passes, (ps) => {
        const toolpath = buildToolpath(jobOf(ps), { startPoint: { x: 0, y: 0 } });
        const grid = expectGrid(
          computeRemovalGrid(toolpath, GRID_SPEC, kernelForTool(FLAT_TOOL, GRID_SPEC.mmPerCell)),
        );
        const deepestCommanded = Math.min(...ps.map((p) => (p.kind === 'contour' ? p.zMm : 0)));
        let deepestCell = 0;
        for (const cellDepth of grid.depth) {
          deepestCell = Math.min(deepestCell, cellDepth);
        }
        expect(deepestCell).toBeGreaterThanOrEqual(deepestCommanded - 1e-6);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic (100 seeds)', () => {
    fc.assert(
      fc.property(passes, (ps) => {
        const toolpath = buildToolpath(jobOf(ps), { startPoint: { x: 0, y: 0 } });
        const kernel = kernelForTool(FLAT_TOOL, GRID_SPEC.mmPerCell);
        const a = expectGrid(computeRemovalGrid(toolpath, GRID_SPEC, kernel));
        const b = expectGrid(computeRemovalGrid(toolpath, GRID_SPEC, kernel));
        let mismatches = 0;
        for (let i = 0; i < a.depth.length; i += 1) {
          if (a.depth[i] !== b.depth[i]) mismatches += 1;
        }
        expect(mismatches).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('is monotonic in scrub progress (100 seeds)', () => {
    fc.assert(
      fc.property(passes, fc.integer({ min: 0, max: 100 }), (ps, pct) => {
        const toolpath = buildToolpath(jobOf(ps), { startPoint: { x: 0, y: 0 } });
        const kernel = kernelForTool(FLAT_TOOL, GRID_SPEC.mmPerCell);
        const partial = expectGrid(
          computeRemovalGrid(toolpath, GRID_SPEC, kernel, {
            uptoLengthMm: (toolpath.totalLength * pct) / 100,
          }),
        );
        const full = expectGrid(computeRemovalGrid(toolpath, GRID_SPEC, kernel));
        let violations = 0;
        for (let i = 0; i < full.depth.length; i += 1) {
          if ((partial.depth[i] ?? 0) < (full.depth[i] ?? 0)) violations += 1;
        }
        expect(violations).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// Perceptual (ADR-025 pattern): pocket a known 20 mm square through the REAL
// pipeline (compileCncJob → buildToolpath → removal grid) and compare the cut
// footprint against the analytic square. This verifies the pocket engine's
// coverage end-to-end — an uncut center or a leaked ring drops the IoU.
describe('pocket removal — perceptual', () => {
  it('a pocketed square covers the analytic square with IoU ≥ 0.98', () => {
    const size = 20;
    const at = 50;
    const square: ImportedSvg = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'O1.svg',
      bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: true,
              points: [
                { x: at, y: at },
                { x: at + size, y: at },
                { x: at + size, y: at + size },
                { x: at, y: at + size },
              ],
            },
          ],
        },
      ],
    };
    const scene: Scene = {
      objects: [square],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', depthMm: 2, depthPerPassMm: 2 },
        },
      ],
    };
    const device = DEFAULT_DEVICE_PROFILE;
    const config = DEFAULT_CNC_MACHINE_CONFIG;
    const job = compileCncJob(scene, device, config);
    const toolpath = buildToolpath(job);
    const tool = activeCncTool(config);
    // Analytic square in machine coords (origin transform may flip Y).
    const c1 = toMachineCoords({ x: at, y: at }, device);
    const c2 = toMachineCoords({ x: at + size, y: at + size }, device);
    const [minX, maxX] = [Math.min(c1.x, c2.x), Math.max(c1.x, c2.x)];
    const [minY, maxY] = [Math.min(c1.y, c2.y), Math.max(c1.y, c2.y)];
    const grid = expectGrid(
      computeRemovalGrid(
        toolpath,
        {
          originX: minX - 5,
          originY: minY - 5,
          widthMm: size + 10,
          heightMm: size + 10,
          mmPerCell: 0.2,
        },
        kernelForTool(tool, 0.2),
      ),
    );

    let intersection = 0;
    let union = 0;
    for (let cy = 0; cy < grid.heightCells; cy += 1) {
      for (let cx = 0; cx < grid.widthCells; cx += 1) {
        const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        const inSquare = x >= minX && x <= maxX && y >= minY && y <= maxY;
        const cut = (grid.depth[cy * grid.widthCells + cx] ?? 0) < 0;
        if (inSquare && cut) intersection += 1;
        if (inSquare || cut) union += 1;
      }
    }
    expect(union).toBeGreaterThan(0);
    const iou = intersection / union;
    expect(iou).toBeGreaterThanOrEqual(0.98);
  });
});
