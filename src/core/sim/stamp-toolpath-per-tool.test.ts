// Per-step bit stamping (H.7 multi-bit jobs): computeRemovalGrid must stamp
// each cut/plunge with the bit that made it, not with one kernel for the
// whole path. Assertions read depth VALUES against the analytic cone/flat
// laws, so they hold under every origin convention.

import { describe, expect, it } from 'vitest';
import { buildToolpath, type CncPass, type Job } from '../job';
import type { CncTool } from '../scene';
import { computeRemovalGrid } from './stamp-toolpath';
import { probeRemovalGrid } from './removal-grid-probe';
import { kernelForTool } from './tool-kernels';

const FLAT: CncTool = { id: 'em-6', name: '6 mm end mill', kind: 'end-mill', diameterMm: 6 };
const VEE: CncTool = {
  id: 'vb-60',
  name: '60° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 60,
};

const CELL = 0.1;
const SPEC = { originX: 0, originY: 0, widthMm: 40, heightMm: 20, mmPerCell: CELL };
const DEPTH = -2;

// Two straight grooves at the same depth, 20 mm apart: the left one cut by
// the flat end mill, the right one by the v-bit.
function twoBitJob(): Job {
  const groove = (atX: number): CncPass => ({
    kind: 'contour',
    zMm: DEPTH,
    closed: false,
    polyline: [
      { x: atX, y: 4 },
      { x: atX, y: 16 },
    ],
  });
  const group = (layerId: string, toolId: string, atX: number) =>
    ({
      kind: 'cnc',
      layerId,
      color: '#ff0000',
      cutType: 'engrave',
      toolId,
      toolDiameterMm: 6,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 3,
      safeZMm: 3.81,
      passes: [groove(atX)],
    }) as const;
  return { groups: [group('L-flat', FLAT.id, 10), group('L-vee', VEE.id, 30)] };
}

function depthAt(grid: Parameters<typeof probeRemovalGrid>[0], x: number, y: number): number {
  const reading = probeRemovalGrid(grid, { x, y });
  if (reading.kind !== 'inside') throw new Error(`probe (${x}, ${y}) landed off the grid`);
  return reading.depthMm;
}

function gridOf(options: Parameters<typeof computeRemovalGrid>[3]) {
  const result = computeRemovalGrid(
    buildToolpath(twoBitJob(), { startPoint: { x: 0, y: 0 } }),
    SPEC,
    kernelForTool(FLAT, CELL),
    options,
  );
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.grid;
}

const TOOLS = new Map<string, CncTool>([
  [FLAT.id, FLAT],
  [VEE.id, VEE],
]);

describe('computeRemovalGrid — per-step bits', () => {
  it('stamps each groove with its own bit', () => {
    const grid = gridOf({ toolsByToolKey: TOOLS });

    // Flat end mill: full depth right out to its 3 mm radius, nothing beyond.
    expect(depthAt(grid, 10, 10)).toBeCloseTo(DEPTH, 2);
    expect(depthAt(grid, 12.5, 10)).toBeCloseTo(DEPTH, 2);
    expect(depthAt(grid, 13.4, 10)).toBeCloseTo(0, 2);

    // 60° v-bit: cone walls rising at d/tan(30°) from the tip, so the same
    // 2.5 mm offset is already back above the surface, and 0.5 mm out sits at
    // -2 + 0.5/tan(30) = -1.13.
    expect(depthAt(grid, 30, 10)).toBeCloseTo(DEPTH, 2);
    expect(depthAt(grid, 30.5, 10)).toBeCloseTo(DEPTH + 0.5 / Math.tan(Math.PI / 6), 2);
    expect(depthAt(grid, 32.5, 10)).toBeCloseTo(0, 2);
  });

  it('falls back to the kernel argument when a step carries no bit', () => {
    // No map: every step keeps the single-kernel behavior byte for byte.
    const single = gridOf({});
    expect(depthAt(single, 30, 10)).toBeCloseTo(DEPTH, 2);
    // The flat kernel cut a full-depth 6 mm slot where the v-bit ran.
    expect(depthAt(single, 32.5, 10)).toBeCloseTo(DEPTH, 2);
  });

  it('leaves an unknown tool key on the fallback kernel', () => {
    const grid = gridOf({ toolsByToolKey: new Map([['nope', VEE]]) });
    expect(depthAt(grid, 32.5, 10)).toBeCloseTo(DEPTH, 2);
  });

  it('keeps the scrub budget measured along the one ordered path', () => {
    // Half the program: the flat groove (first section) is cut, the vee is
    // not. Per-section rebuilds could not express this.
    const full = gridOf({ toolsByToolKey: TOOLS });
    const path = buildToolpath(twoBitJob(), { startPoint: { x: 0, y: 0 } });
    const half = computeRemovalGrid(path, SPEC, kernelForTool(FLAT, CELL), {
      toolsByToolKey: TOOLS,
      uptoLengthMm: path.totalLength * 0.4,
    });
    if (half.kind !== 'ok') throw new Error(half.reason);
    expect(depthAt(half.grid, 10, 10)).toBeCloseTo(DEPTH, 2);
    expect(depthAt(half.grid, 30, 10)).toBeCloseTo(0, 2);
    // And the finished grid still carves both.
    expect(depthAt(full, 30, 10)).toBeCloseTo(DEPTH, 2);
  });
});
