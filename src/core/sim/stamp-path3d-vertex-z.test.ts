import { describe, expect, it } from 'vitest';
import { buildToolpath } from '../job';
import type { CncPass, Job, Toolpath } from '../job';
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
const FINE_GRID = { originX: 0, originY: 0, widthMm: 15, heightMm: 15, mmPerCell: 0.1 };

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

function lengthBeforeFirstCut(toolpath: Toolpath): number {
  let length = 0;
  for (const step of toolpath.steps) {
    if (step.kind === 'cut') return length;
    length += step.length;
  }
  throw new Error('Expected a cut step.');
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

  it('uses 3D motion length when the scrubber stops on a steep XYZ segment', () => {
    const steep: CncPass = {
      kind: 'path3d',
      points: [
        { x: 5, y: 15, z: 0 },
        { x: 6, y: 15, z: -10 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([steep]), { startPoint: { x: 5, y: 15 } });
    const cutBudgetMm = 1;
    const grid = expectGrid(
      computeRemovalGrid(toolpath, GRID, kernelForTool(FLAT_TOOL, GRID.mmPerCell), {
        uptoLengthMm: lengthBeforeFirstCut(toolpath) + cutBudgetMm,
      }),
    );

    const expectedZ = -10 * (cutBudgetMm / Math.hypot(1, 10));
    const sampledZ = depthAt(grid, 5, 15);
    expect(sampledZ).toBeGreaterThanOrEqual(expectedZ - 1e-6);
    expect(sampledZ - expectedZ).toBeLessThanOrEqual(GRID.mmPerCell / 2);
    expect(Math.min(...grid.depth)).toBeGreaterThan(-1.1);
  });

  it('stamps only the reached depth when a path3d segment is purely vertical', () => {
    const vertical: CncPass = {
      kind: 'path3d',
      points: [
        { x: 15, y: 15, z: 0 },
        { x: 15, y: 15, z: -5 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([vertical]), { startPoint: { x: 15, y: 15 } });
    const cutBudgetMm = 0.1;
    const grid = expectGrid(
      computeRemovalGrid(toolpath, GRID, kernelForTool(FLAT_TOOL, GRID.mmPerCell), {
        uptoLengthMm: lengthBeforeFirstCut(toolpath) + cutBudgetMm,
      }),
    );

    expect(depthAt(grid, 15, 15)).toBeCloseTo(-cutBudgetMm, 6);
    expect(Math.min(...grid.depth)).toBeCloseTo(-cutBudgetMm, 6);
  });

  it('never restores removed cells as path3d scrub progress advances', () => {
    const constantDepth: CncPass = {
      kind: 'path3d',
      points: [
        { x: 3, y: 3, z: -5 },
        { x: 4, y: 3.5, z: -5 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([constantDepth]), { startPoint: { x: 3, y: 3 } });
    const beforeCutMm = lengthBeforeFirstCut(toolpath);
    const cutLengthMm = Math.hypot(1, 0.5);
    const kernel = kernelForTool(FLAT_TOOL, FINE_GRID.mmPerCell);
    const earlier = expectGrid(
      computeRemovalGrid(toolpath, FINE_GRID, kernel, {
        uptoLengthMm: beforeCutMm + cutLengthMm * 0.6,
      }),
    );
    const later = expectGrid(
      computeRemovalGrid(toolpath, FINE_GRID, kernel, {
        uptoLengthMm: beforeCutMm + cutLengthMm * 0.7,
      }),
    );

    for (let i = 0; i < earlier.depth.length; i += 1) {
      expect(later.depth[i], `cell ${i} became shallower`).toBeLessThanOrEqual(
        earlier.depth[i] ?? 0,
      );
    }
  });

  it('retains the established XY samples in a completed steep segment', () => {
    const steep: CncPass = {
      kind: 'path3d',
      points: [
        { x: 3, y: 3, z: -5 },
        { x: 4, y: 5, z: -1 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([steep]), { startPoint: { x: 3, y: 3 } });
    const grid = expectGrid(
      computeRemovalGrid(toolpath, FINE_GRID, kernelForTool(FLAT_TOOL, FINE_GRID.mmPerCell)),
    );

    const retainedCell = 31 * grid.widthCells + 42;
    expect(grid.depth[retainedCell]).toBeCloseTo(-3.4, 6);
  });

  it('makes exact-total and over-total scrub budgets identical to the finished grid', () => {
    const multiSegment: CncPass = {
      kind: 'path3d',
      points: [
        { x: 3, y: 3, z: -5 },
        { x: 3.1, y: 3.1, z: -5 },
        { x: 3.2, y: 3.3, z: -5 },
      ],
      closed: false,
    };
    const toolpath = buildToolpath(jobOf([multiSegment]), { startPoint: { x: 3, y: 3 } });
    const kernel = kernelForTool(FLAT_TOOL, FINE_GRID.mmPerCell);
    const finished = expectGrid(computeRemovalGrid(toolpath, FINE_GRID, kernel));
    const exactTotal = expectGrid(
      computeRemovalGrid(toolpath, FINE_GRID, kernel, { uptoLengthMm: toolpath.totalLength }),
    );
    const overTotal = expectGrid(
      computeRemovalGrid(toolpath, FINE_GRID, kernel, { uptoLengthMm: toolpath.totalLength + 1 }),
    );

    expect(exactTotal.depth).toEqual(finished.depth);
    expect(overTotal.depth).toEqual(finished.depth);
  });
});
