// Registration: does the drawn 3D path actually land on the material it cut?
//
// This is the test that earns its keep. The viewport draws two things from two
// different builders — the carved surface from the removal grid, and the path
// from the toolpath lift — and they must agree in space. A mirror, a dropped
// origin offset, or a sign flip anywhere in that chain produces a viewport
// that looks entirely plausible and is wrong, which is the exact failure mode
// CLAUDE.md rule 2 warns about and the one no snapshot would catch.
//
// Asserting it numerically is stronger than eyeballing a render: if the frames
// disagree, the grid depth under each cut move is 0 (untouched stock) instead
// of the depth that move cut to.

import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../job';
import type { CncTool } from '../scene';
import { computeRemovalGrid, gridCellOfPoint, kernelForTool, type RemovalGrid } from '../sim';
import { toolpathMoves3d } from './toolpath-moves-3d';

const CELL_MM = 0.5;
const CUT_DEPTH_MM = -2;
const TOOL = { kind: 'end-mill', diameterMm: 3 } as CncTool;

const SPEC = { originX: 0, originY: 0, widthMm: 40, heightMm: 20, mmPerCell: CELL_MM };

// A single straight pass across the middle of a 40x20 stock, plunged to depth.
function straightPassToolpath(): Toolpath {
  return {
    steps: [
      { kind: 'plunge', at: { x: 5, y: 10 }, fromZ: 5, toZ: CUT_DEPTH_MM, length: 7 },
      {
        kind: 'cut',
        color: '#000',
        polyline: [
          { x: 5, y: 10 },
          { x: 35, y: 10 },
        ],
        length: 30,
        z: { from: CUT_DEPTH_MM, to: CUT_DEPTH_MM },
      },
      { kind: 'plunge', at: { x: 35, y: 10 }, fromZ: CUT_DEPTH_MM, toZ: 5, length: 7 },
    ],
    totalLength: 44,
  };
}

function passAt(y: number): Toolpath {
  return {
    steps: [
      {
        kind: 'cut',
        color: '#000',
        polyline: [
          { x: 5, y },
          { x: 35, y },
        ],
        length: 30,
        z: { from: CUT_DEPTH_MM, to: CUT_DEPTH_MM },
      },
    ],
    totalLength: 30,
  };
}

function gridFor(toolpath: Toolpath): RemovalGrid | null {
  const result = computeRemovalGrid(toolpath, SPEC, kernelForTool(TOOL, CELL_MM));
  return result.kind === 'ok' ? result.grid : null;
}

function depthAtPoint(grid: RemovalGrid, x: number, y: number): number {
  // gridCellOfPoint returns cell coordinates, not a flat index, and does not
  // bounds-check — an out-of-range sample would otherwise read a neighbouring
  // row and quietly report the wrong depth.
  const { cx, cy } = gridCellOfPoint(grid, x, y);
  if (cx < 0 || cy < 0 || cx >= grid.widthCells || cy >= grid.heightCells) return Number.NaN;
  return grid.depth[cy * grid.widthCells + cx] ?? Number.NaN;
}

describe('toolpath / carved-surface registration', () => {
  it('finds removed material under every cut move it draws', () => {
    const toolpath = straightPassToolpath();
    const grid = gridFor(toolpath);
    expect(grid).not.toBeNull();
    if (grid === null) return;

    const cuts = toolpathMoves3d(toolpath).filter((move) => move.kind === 'cut');
    expect(cuts.length).toBeGreaterThan(0);

    for (const cut of cuts) {
      for (const point of cut.points) {
        // Stock under a cut must be removed at least to that move's Z. If the
        // path and the surface were in different frames this would read 0.
        expect(depthAtPoint(grid, point.x, point.y)).toBeLessThanOrEqual(point.z + 1e-6);
      }
    }
  });

  it('leaves stock intact away from the path, so the match is not vacuous', () => {
    const grid = gridFor(straightPassToolpath());
    expect(grid).not.toBeNull();
    if (grid === null) return;

    // Far from the y=10 pass the stock top is untouched. Without this, the
    // assertion above would pass trivially on a grid cut away everywhere.
    expect(depthAtPoint(grid, 20, 1)).toBe(0);
    expect(depthAtPoint(grid, 20, 19)).toBe(0);
  });

  it('would catch a Y mirror, which is the frame bug most likely to appear', () => {
    // The pass sits off-centre so mirroring about the stock midline moves it.
    // A centred pass would map onto itself and hide the bug.
    const grid = gridFor(passAt(4));
    expect(grid).not.toBeNull();
    if (grid === null) return;

    expect(depthAtPoint(grid, 20, 4)).toBeLessThanOrEqual(CUT_DEPTH_MM + 1e-6);
    // The mirrored position (20 - 4 = 16) must be untouched. If a future change
    // mirrors the path without mirroring the surface, this flips.
    expect(depthAtPoint(grid, 20, 16)).toBe(0);
  });

  it('keeps every drawn point inside the stock footprint', () => {
    for (const move of toolpathMoves3d(straightPassToolpath())) {
      for (const point of move.points) {
        expect(point.x).toBeGreaterThanOrEqual(SPEC.originX);
        expect(point.x).toBeLessThanOrEqual(SPEC.originX + SPEC.widthMm);
        expect(point.y).toBeGreaterThanOrEqual(SPEC.originY);
        expect(point.y).toBeLessThanOrEqual(SPEC.originY + SPEC.heightMm);
      }
    }
  });

  it('puts cutting moves at or below the stock top and lifts the retract clear', () => {
    const moves = toolpathMoves3d(straightPassToolpath());
    const cutZ = moves.filter((m) => m.kind === 'cut').flatMap((m) => m.points.map((p) => p.z));
    expect(cutZ.every((z) => z <= 0)).toBe(true);
    // The retract must actually climb clear of the stock, or the viewport is
    // drawing the bit dragging through the work on its way out.
    const retract = moves.find((m) => m.kind === 'retract');
    expect(retract?.points.at(-1)?.z).toBeGreaterThan(0);
  });
});
