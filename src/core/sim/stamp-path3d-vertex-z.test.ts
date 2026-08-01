import { describe, expect, it } from 'vitest';
import { buildToolpath } from '../job';
import type { CncPass, Job } from '../job';
import { gridCellIndex, gridCellOfPoint, type RemovalGrid } from './removal-grid';
import { computeRemovalGrid } from './stamp-toolpath';
import { kernelForTool } from './tool-kernels';

// The simulator is the verification instrument for every depth-producing
// feature (ADR-025 / stamp-toolpath.ts header). Before this fix it collapsed
// a path3d pass's per-vertex Z to its endpoint span and interpolated by arc
// length — a non-monotone profile (down-then-up) whose endpoints sit at the
// surface stamped NOTHING. That blocked honest verification of any
// variable-depth pass (the ADR-279 junction blend needs exactly that).

const FLAT_TOOL = { id: 't', name: 't', kind: 'end-mill', diameterMm: 2 } as const;
const SAFE_Z_MM = 3.81;
const GRID = { originX: 0, originY: 0, widthMm: 30, heightMm: 30, mmPerCell: 0.5 };

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

function expectGrid(result: ReturnType<typeof computeRemovalGrid>) {
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

function depthAt(grid: RemovalGrid, x: number, y: number): number {
  const { cx, cy } = gridCellOfPoint(grid, x, y);
  const index = gridCellIndex(grid, cx, cy);
  if (index === null) throw new Error(`(${x}, ${y}) is outside the grid`);
  return grid.depth[index] ?? 0;
}

describe('computeRemovalGrid — path3d per-vertex Z', () => {
  it('stamps a non-monotone valley exactly at its vertices, linear between', () => {
    // Feed from (5,15) at the surface down to −2 at (15,15) and back up to
    // the surface at (25,15). The endpoint Z span is 0 → 0, which the old
    // endpoint-lerp model read as "no depth at all".
    const valley: CncPass = {
      kind: 'path3d',
      points: [
        { x: 5, y: 15, z: 0 },
        { x: 15, y: 15, z: -2 },
        { x: 25, y: 15, z: 0 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([valley]), { startPoint: { x: 5, y: 15 } });
    const grid = expectGrid(
      computeRemovalGrid(toolpath, GRID, kernelForTool(FLAT_TOOL, GRID.mmPerCell)),
    );
    // Vertex-exact at the valley floor.
    expect(depthAt(grid, 15, 15)).toBeLessThanOrEqual(-1.9);
    expect(depthAt(grid, 15, 15)).toBeGreaterThanOrEqual(-2 - 1e-6);
    // Linear on the flank: at x = 10 the tip is at −1; the 1 mm flat kernel
    // reaches at most 1 mm further downhill, so the cell sees ≤ −1, ≥ −1.3.
    expect(depthAt(grid, 10, 15)).toBeLessThanOrEqual(-0.95);
    expect(depthAt(grid, 10, 15)).toBeGreaterThanOrEqual(-1.3);
    // Deeper along the descent — the profile is a slope, not a plateau.
    expect(depthAt(grid, 12, 15)).toBeLessThan(depthAt(grid, 7, 15));
  });

  it('a closed variable-Z ring with matching first/last Z still cuts its deep side', () => {
    // A square loop whose right side dips to −1 while the seam vertex sits at
    // the surface — the junction-blend shape. Old model: from = to = 0 → the
    // early-out discarded the whole ring.
    const ring: CncPass = {
      kind: 'path3d',
      points: [
        { x: 10, y: 10, z: 0 },
        { x: 20, y: 10, z: -1 },
        { x: 20, y: 20, z: -1 },
        { x: 10, y: 20, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      closed: true,
    };
    const toolpath = buildToolpath(jobOf([ring]), { startPoint: { x: 10, y: 10 } });
    const grid = expectGrid(
      computeRemovalGrid(toolpath, GRID, kernelForTool(FLAT_TOOL, GRID.mmPerCell)),
    );
    // The deep right side is cut to −1…
    expect(depthAt(grid, 20, 15)).toBeLessThanOrEqual(-0.95);
    // …and the surface-level seam corner stays uncut.
    expect(depthAt(grid, 10, 10)).toBeGreaterThanOrEqual(-0.15);
  });
});
