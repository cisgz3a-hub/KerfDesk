import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath } from '../job';
import { computeRemovalGrid, kernelForTool } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { cncGrblStrategy } from '../output';
import { compileCncJob } from './compile-cnc-job';

// Perceptual verification (ADR-025 pattern): V-carve a 10 mm square with a
// 90° bit through the REAL pipeline (compileCncJob → buildToolpath → removal
// grid) and compare against the ANALYTIC groove: at tan(45°) = 1 the carved
// surface inside the square is z(x, y) = −min(distToBoundary, maxDepth) — a
// pyramid frustum. This is the geometric proof that V-carve carves a V.

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

const SIZE = 10;
const AT = 50;
const MAX_DEPTH = 2;
const RESOLUTION = 0.25;
const CELL = 0.2;

function expectGrid(result: ReturnType<typeof computeRemovalGrid>) {
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

function vcarveScene(): Scene {
  const square: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: AT, minY: AT, maxX: AT + SIZE, maxY: AT + SIZE },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: AT, y: AT },
              { x: AT + SIZE, y: AT },
              { x: AT + SIZE, y: AT + SIZE },
              { x: AT, y: AT + SIZE },
            ],
          },
        ],
      },
    ],
  };
  return {
    objects: [square],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          depthMm: MAX_DEPTH,
          depthPerPassMm: MAX_DEPTH,
          vResolutionMm: RESOLUTION,
        },
      },
    ],
  };
}

function vbitConfig(): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [VBIT_90],
    toolId: VBIT_90.id,
  };
}

describe('v-carve — perceptual (analytic pyramid field)', () => {
  it('carves the analytic V-groove within tolerance and covers the square (IoU ≥ 0.97)', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const job = compileCncJob(vcarveScene(), device, vbitConfig());
    const toolpath = buildToolpath(job);

    // Analytic square in machine coords (origin transform may flip Y).
    const c1 = toMachineCoords({ x: AT, y: AT }, device);
    const c2 = toMachineCoords({ x: AT + SIZE, y: AT + SIZE }, device);
    const [minX, maxX] = [Math.min(c1.x, c2.x), Math.max(c1.x, c2.x)];
    const [minY, maxY] = [Math.min(c1.y, c2.y), Math.max(c1.y, c2.y)];

    const grid = expectGrid(
      computeRemovalGrid(
        toolpath,
        {
          originX: minX - 3,
          originY: minY - 3,
          widthMm: SIZE + 6,
          heightMm: SIZE + 6,
          mmPerCell: CELL,
        },
        kernelForTool(VBIT_90, CELL),
      ),
    );

    // Per-cell tolerance: ring spacing + grid discretization.
    const tolerance = RESOLUTION + 2 * CELL;
    let maxError = 0;
    let errorSum = 0;
    let insideCells = 0;
    let intersection = 0;
    let union = 0;
    for (let cy = 0; cy < grid.heightCells; cy += 1) {
      for (let cx = 0; cx < grid.widthCells; cx += 1) {
        const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        const inSquare = x >= minX && x <= maxX && y >= minY && y <= maxY;
        const cellDepth = grid.depth[cy * grid.widthCells + cx] ?? 0;
        const cut = cellDepth < 0;
        if (inSquare || cut) union += 1;
        if (inSquare && cut) intersection += 1;
        if (!inSquare) continue;
        const distToBoundary = Math.min(x - minX, maxX - x, y - minY, maxY - y);
        const analytic = -Math.min(distToBoundary, MAX_DEPTH);
        const error = Math.abs(cellDepth - analytic);
        maxError = Math.max(maxError, error);
        errorSum += error;
        insideCells += 1;
      }
    }
    expect(insideCells).toBeGreaterThan(0);
    expect(maxError).toBeLessThanOrEqual(tolerance);
    expect(errorSum / insideCells).toBeLessThanOrEqual(tolerance / 3);
    expect(intersection / union).toBeGreaterThanOrEqual(0.97);
  });

  it('emits deterministic, invariant-clean G-code for the v-carve job (snapshot)', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const job = compileCncJob(vcarveScene(), device, vbitConfig());
    const gcode = cncGrblStrategy.emit(job, device);
    expect(gcode.length).toBeGreaterThan(0);
    expect(gcode).toMatchSnapshot();
  });
});
