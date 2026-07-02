// H.6b acceptance (AUDIT ".nc re-import simulator match"): parsing
// KerfDesk's OWN CNC export must produce the same material removal as the
// native compile→toolpath pipeline. Coordinates round-trip through the
// emitter's decimal formatting, so the comparison is a cut-footprint IoU +
// deepest-cell check, not byte equality.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { buildToolpath, computeJobBounds } from '../../core/job';
import { cncGrblStrategy } from '../../core/output';
import { computeRemovalGrid, kernelForTool } from '../../core/sim';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  activeCncTool,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../../core/scene';
import { parseGcodeProgram } from './parse-gcode-program';

const GRID_MARGIN_MM = 5;
const GRID_CELL_MM = 0.5;

function squareScene(): Scene {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'square.svg',
    bounds: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 40, y: 10 },
              { x: 40, y: 40 },
              { x: 10, y: 40 },
            ],
          },
        ],
      },
    ],
  };
  const layer = {
    ...createLayer({ id: '#ff0000', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const, depthMm: 3 },
  };
  return { objects: [object], layers: [layer] };
}

describe('.nc re-import parity with the native simulator pipeline', () => {
  it('parsing our own CNC export reproduces the native removal footprint', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const machine = DEFAULT_CNC_MACHINE_CONFIG;
    const job = compileCncJob(squareScene(), device, machine);
    const gcode = cncGrblStrategy.emit(job, device);

    const parsed = parseGcodeProgram(gcode);
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    expect(parsed.toolpath.steps.length).toBeGreaterThan(0);

    // The device origin transform places the job elsewhere on the bed —
    // derive the grid from the compiled job's own machine-space bounds.
    const bounds = computeJobBounds(job);
    if (bounds === null) throw new Error('job compiled to no geometry');
    const gridSpec = {
      originX: bounds.minX - GRID_MARGIN_MM,
      originY: bounds.minY - GRID_MARGIN_MM,
      widthMm: bounds.maxX - bounds.minX + 2 * GRID_MARGIN_MM,
      heightMm: bounds.maxY - bounds.minY + 2 * GRID_MARGIN_MM,
      mmPerCell: GRID_CELL_MM,
    };
    const kernel = kernelForTool(activeCncTool(machine), gridSpec.mmPerCell);
    const native = computeRemovalGrid(
      buildToolpath(job, { startPoint: { x: 0, y: 0 } }),
      gridSpec,
      kernel,
    );
    const reimported = computeRemovalGrid(parsed.toolpath, gridSpec, kernel);

    let both = 0;
    let either = 0;
    let deepestNative = 0;
    let deepestReimported = 0;
    for (let i = 0; i < native.depth.length; i += 1) {
      const a = (native.depth[i] ?? 0) < -1e-6;
      const b = (reimported.depth[i] ?? 0) < -1e-6;
      if (a && b) both += 1;
      if (a || b) either += 1;
      deepestNative = Math.min(deepestNative, native.depth[i] ?? 0);
      deepestReimported = Math.min(deepestReimported, reimported.depth[i] ?? 0);
    }
    expect(either).toBeGreaterThan(0);
    // Text formatting shifts coordinates by ≤1e-3 mm; the footprints must
    // still agree almost everywhere.
    expect(both / either).toBeGreaterThanOrEqual(0.98);
    expect(Math.abs(deepestNative - deepestReimported)).toBeLessThanOrEqual(1e-3 + 1e-9);
  });
});
