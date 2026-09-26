import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import {
  finishedFlatDepthAt,
  finishedFlatDepths,
  mergeFlatLevels,
  reliefFlatLevels,
  type ReliefFlatLevel,
} from './relief-flat-finish';
import { reliefRoughingLadder, type ReliefRoughingOptions } from './relief-roughing';
import type { ReliefRoughingLevel } from './relief-roughing-levels';

// ADR-450: an end mill cuts each flat of the model to its exact height, on the
// roughing level one allowance above it where the depth per pass allows and on
// a level of its own otherwise, and reports what it finished.

const EM: CncTool = { id: 'em', name: '1/8 in end mill', kind: 'end-mill', diameterMm: 3.175 };
const BALL: CncTool = { id: 'bn', name: '1/8 in ball nose', kind: 'ball-nose', diameterMm: 3.175 };
const CELL_MM = 0.4;
const SIZE_MM = 40;

type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

// A floor `floorMm` deep with flat-topped boxes standing on it.
function boxesMap(
  floorMm: number,
  boxes: ReadonlyArray<Box & { readonly zMm: number }>,
): Heightmap {
  const cells = Math.round(SIZE_MM / CELL_MM);
  const depth = new Float32Array(cells * cells).fill(floorMm);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const x = (i + 0.5) * CELL_MM;
      const y = (j + 0.5) * CELL_MM;
      for (const box of boxes) {
        if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) {
          depth[j * cells + i] = Math.max(depth[j * cells + i] ?? floorMm, box.zMm);
        }
      }
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: SIZE_MM,
    heightMm: SIZE_MM,
    mmPerCell: CELL_MM,
    depth,
  };
}

// Adds a cone whose apex stands at `topMm`: a peak, not a flat.
function withCone(
  map: Heightmap,
  cx: number,
  cy: number,
  radiusMm: number,
  topMm: number,
): Heightmap {
  const depth = map.depth.slice();
  const floor = Math.min(...depth);
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      const r = Math.hypot((i + 0.5) * CELL_MM - cx, (j + 0.5) * CELL_MM - cy);
      const z = topMm - (r / radiusMm) * (topMm - floor);
      const index = j * map.widthCells + i;
      depth[index] = Math.max(depth[index] ?? floor, z);
    }
  }
  return { ...map, depth };
}

function zeroLiftTip(map: Heightmap, allowanceMm: number): Float32Array {
  return dilateHeightmapByTool(map, kernelForTool(EM, CELL_MM, 0, allowanceMm), 0);
}

function options(overrides: Partial<ReliefRoughingOptions> = {}): ReliefRoughingOptions {
  return {
    tool: EM,
    reliefDepthMm: 3,
    depthPerPassMm: 1.5,
    stepoverPercent: 40,
    allowanceMm: 0.5,
    finishFlats: true,
    ...overrides,
  };
}

function passHeights(passes: ReadonlyArray<CncPass>): ReadonlyArray<number> {
  return passes.flatMap((pass) =>
    pass.kind === 'contour'
      ? [pass.zMm]
      : pass.kind === 'path3d'
        ? pass.points.map((p) => p.z)
        : [],
  );
}

// The highest model sample under the flat bottom of an end mill at any
// sampled pass position, less the bottom's height: > 0 is a gouge.
function worstGougeMm(map: Heightmap, passes: ReadonlyArray<CncPass>): number {
  let worst = Number.NEGATIVE_INFINITY;
  const radius = EM.diameterMm / 2;
  const check = (x: number, y: number, z: number): void => {
    const i0 = Math.max(0, Math.floor((x - radius) / CELL_MM));
    const i1 = Math.min(map.widthCells - 1, Math.ceil((x + radius) / CELL_MM));
    const j0 = Math.max(0, Math.floor((y - radius) / CELL_MM));
    const j1 = Math.min(map.heightCells - 1, Math.ceil((y + radius) / CELL_MM));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        if (Math.hypot((i + 0.5) * CELL_MM - x, (j + 0.5) * CELL_MM - y) > radius) continue;
        worst = Math.max(worst, (map.depth[j * map.widthCells + i] ?? 0) - z);
      }
    }
  };
  for (const pass of passes) {
    if (pass.kind !== 'contour') continue;
    pass.polyline.forEach((point, index) => {
      check(point.x, point.y, pass.zMm);
      const next = pass.polyline[index + 1];
      if (next !== undefined) check((point.x + next.x) / 2, (point.y + next.y) / 2, pass.zMm);
    });
  }
  return worst;
}

describe('reliefFlatLevels', () => {
  it('finds the floor and a plateau, but not a peak or a patch smaller than the bit', () => {
    const map = withCone(
      boxesMap(-3, [
        { x0: 24, y0: 6, x1: 34, y1: 16, zMm: -1.5 },
        { x0: 6, y0: 30, x1: 7, y1: 31, zMm: -2 },
      ]),
      12,
      12,
      6,
      -0.5,
    );
    const levels = reliefFlatLevels(map, zeroLiftTip(map, 0.5), EM.diameterMm / 2);
    expect(levels.map((level) => level.zMm)).toEqual([
      expect.closeTo(-1.5, 6),
      expect.closeTo(-3, 6),
    ]);
  });

  it('keeps each flat level off the walls by the allowance', () => {
    const map = boxesMap(-3, [{ x0: 14, y0: 14, x1: 26, y1: 26, zMm: 0 }]);
    const floor = reliefFlatLevels(map, zeroLiftTip(map, 0.5), EM.diameterMm / 2)[0];
    if (floor === undefined) throw new Error('no floor level');
    const reach = EM.diameterMm / 2 + 0.5;
    for (let index = 0; index < floor.mask.length; index += 1) {
      if (floor.mask[index] !== 1) continue;
      const x = ((index % map.widthCells) + 0.5) * CELL_MM;
      const y = (Math.floor(index / map.widthCells) + 0.5) * CELL_MM;
      const gap = Math.max(14 - x, x - 26, 14 - y, y - 26);
      expect(gap).toBeGreaterThanOrEqual(reach - CELL_MM);
    }
  });
});

describe('mergeFlatLevels', () => {
  const flat = (zMm: number): ReliefFlatLevel => ({ zMm, mask: new Uint8Array(1), contours: [] });
  const levels: ReadonlyArray<ReliefRoughingLevel> = [
    { zMm: -1.5, bandFloorMm: null, sliceTopMm: 0 },
    { zMm: -2, bandFloorMm: -2.5, sliceTopMm: -1.5 },
    { zMm: -2.5, bandFloorMm: null, sliceTopMm: -1.5 },
  ];

  it('lets the floor and a band level cut to the flat below them', () => {
    const merged = mergeFlatLevels(levels, [flat(-2.5), flat(-3)], 0.5, 1.5);
    expect([...merged.cutZMm.entries()]).toEqual([
      [1, -2.5],
      [2, -3],
    ]);
    expect(merged.separate).toEqual([]);
  });

  it('keeps a flat apart when the cut would exceed the depth per pass', () => {
    const merged = mergeFlatLevels(levels, [flat(-3)], 0.5, 1.2);
    expect(merged.cutZMm.size).toBe(0);
    expect(merged.separate.map((level) => level.zMm)).toEqual([-3]);
  });

  it('never lowers a ladder level above the floor', () => {
    const merged = mergeFlatLevels(levels, [flat(-2)], 0.5, 1.5);
    expect(merged.cutZMm.size).toBe(0);
    expect(merged.separate).toHaveLength(1);
  });
});

describe('finishedFlatDepths', () => {
  it('marks the cells the bottom sweeps, the lowest height winning', () => {
    const map = boxesMap(-3, []);
    const centre = 50 * map.widthCells + 50;
    const one = (zMm: number): { zMm: number; mask: Uint8Array } => {
      const mask = new Uint8Array(map.depth.length);
      mask[centre] = 1;
      return { zMm, mask };
    };
    const finished = finishedFlatDepths(map, [one(-2), one(-3)], EM.diameterMm / 2);
    const x = 50.5 * CELL_MM;
    expect(finishedFlatDepthAt(finished, x, x)).toBe(-3);
    // The sweep is taken two cells short of the radius (1.59 mm): cell
    // centres 0.4 mm away are in it, 0.8 mm away are not.
    expect(finishedFlatDepthAt(finished, x + CELL_MM, x - CELL_MM)).toBe(-3);
    expect(finishedFlatDepthAt(finished, x + 2 * CELL_MM, x)).toBeNaN();
    expect(finishedFlatDepthAt(finished, -1, x)).toBeNaN();
  });
});

describe('relief roughing with flat finishing (ADR-450)', () => {
  const plaque = boxesMap(-3, [{ x0: 24, y0: 6, x1: 34, y1: 16, zMm: -1 }]);

  it('cuts the floor and the plateau on their own roughing levels', () => {
    const off = reliefRoughingLadder(plaque, options({ finishFlats: false }));
    const on = reliefRoughingLadder(plaque, options());
    expect(on.levels).toHaveLength(off.levels.length);
    expect(Math.min(...passHeights(off.passes))).toBeCloseTo(-2.5, 6);
    expect(Math.min(...passHeights(on.passes))).toBeCloseTo(-3, 6);
    expect(passHeights(on.passes)).toContainEqual(expect.closeTo(-1, 6));
    expect(worstGougeMm(plaque, on.passes)).toBeLessThanOrEqual(1e-6);
    expect(on.finishedFlats).toBeDefined();
    const finished = on.finishedFlats;
    if (finished === undefined) return;
    expect(finishedFlatDepthAt(finished, 5, 35)).toBeCloseTo(-3, 6);
    expect(finishedFlatDepthAt(finished, 29, 11)).toBeCloseTo(-1, 6);
  });

  it('gives a flat its own level when the depth per pass leaves no room', () => {
    const shallow = boxesMap(-2, []);
    const on = reliefRoughingLadder(shallow, options({ reliefDepthMm: 2, allowanceMm: 1 }));
    const off = reliefRoughingLadder(
      shallow,
      options({ reliefDepthMm: 2, allowanceMm: 1, finishFlats: false }),
    );
    expect(on.levels).toHaveLength(off.levels.length + 1);
    // The floor level at -1 (one allowance up) would cut 2 mm to reach the
    // floor, so the floor gets a level of its own, entered from -1.
    expect(on.levels[on.levels.length - 1]?.zMm).toBeCloseTo(-2, 6);
    expect(on.levels[on.levels.length - 1]?.sliceTopMm).toBeCloseTo(-1, 6);
  });

  it('leaves a ball nose roughing bit as it was', () => {
    const off = reliefRoughingLadder(plaque, options({ tool: BALL, finishFlats: false }));
    const on = reliefRoughingLadder(plaque, options({ tool: BALL }));
    expect(on.passes).toEqual(off.passes);
    expect(on.finishedFlats).toBeUndefined();
  });

  it('never cuts below the model, whatever the flats and settings', () => {
    const box = fc.record({
      x0: fc.integer({ min: 2, max: 26 }),
      y0: fc.integer({ min: 2, max: 26 }),
      size: fc.integer({ min: 3, max: 12 }),
      zMm: fc.double({ min: -2.9, max: -0.1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(box, { minLength: 1, maxLength: 3 }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (boxes, allowanceMm, depthPerPassMm) => {
          const map = boxesMap(
            -3,
            boxes.map((b) => ({
              x0: b.x0,
              y0: b.y0,
              x1: b.x0 + b.size,
              y1: b.y0 + b.size,
              zMm: b.zMm,
            })),
          );
          const ladder = reliefRoughingLadder(map, options({ allowanceMm, depthPerPassMm }));
          expect(worstGougeMm(map, ladder.passes)).toBeLessThanOrEqual(1e-5);
        },
      ),
      { numRuns: 12, seed: 450 },
    );
  });
});
