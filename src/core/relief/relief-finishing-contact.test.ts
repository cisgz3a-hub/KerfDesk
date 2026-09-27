import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import {
  checkedPath,
  FINISHING_CONTACT_TOLERANCE_MM,
  type ContactCheck,
} from './relief-finishing-contact';
import { reliefFinishingPlan } from './relief-finishing-strategy';

// ADR-421 Amendment 1: no finishing move cuts into the part between its
// vertices, whether it runs along a row, down the edge column between rows,
// over a hop between skipped runs or round a waterline. Cuts are measured
// normal to the move, as ADR-412 measures them.

const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 };
const END_MILL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 3.175 };
const CELL_MM = 0.25;
const WIDTH_MM = 24;
const HEIGHT_MM = 16;
const FLOOR_MM = -4;
// Distance between the dense checks, and what the checks may miss between
// two of their points: 0.0006 mm at worst over 300 random parts.
const DENSE_MM = 0.01;
const BETWEEN_CHECKS_MM = 0.001;

type Plateau = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly topMm: number;
  readonly runMm: number;
};

function plateauDepth(plateau: Plateau, x: number, y: number): number {
  const outside = Math.max(plateau.x0 - x, x - plateau.x1, plateau.y0 - y, y - plateau.y1, 0);
  if (plateau.runMm === 0) return outside > 0 ? FLOOR_MM : plateau.topMm;
  return plateau.topMm - (outside / plateau.runMm) * (plateau.topMm - FLOOR_MM);
}

function partMap(plateaus: ReadonlyArray<Plateau>): Heightmap {
  const widthCells = Math.round(WIDTH_MM / CELL_MM);
  const heightCells = Math.round(HEIGHT_MM / CELL_MM);
  const depth = new Float32Array(widthCells * heightCells);
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1) {
      const x = (i + 0.5) * CELL_MM;
      const y = (j + 0.5) * CELL_MM;
      depth[j * widthCells + i] = plateaus.reduce(
        (z, plateau) => Math.max(z, plateauDepth(plateau, x, y)),
        FLOOR_MM,
      );
    }
  }
  return {
    widthCells,
    heightCells,
    widthMm: WIDTH_MM,
    heightMm: HEIGHT_MM,
    mmPerCell: CELL_MM,
    depth,
  };
}

// How far the worst point of any move cuts into the part, normal to the move.
function worstCut(map: Heightmap, tool: CncTool, passes: ReadonlyArray<CncPass>): number {
  const field = createSurfaceContactField(map, kernelForTool(tool, map.mmPerCell));
  if (field === null) throw new Error('expected a contact field');
  let worst = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    pass.points.forEach((from, index) => {
      const to = pass.points[index + 1];
      if (to === undefined) return;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      // A vertical move stands on one spot: its ends belong to the moves
      // either side of it.
      if (length === 0) return;
      const cosine = length / Math.hypot(length, to.z - from.z);
      const steps = Math.ceil(length / DENSE_MM);
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = from.x + t * (to.x - from.x);
        const y = from.y + t * (to.y - from.y);
        const z = from.z + t * (to.z - from.z);
        worst = Math.max(worst, (field.constraintAtPoint(x, y, z) - z) * cosine);
      }
    });
  }
  return worst;
}

const plateauArb = fc.record({
  // Plateaus may reach the edge, so the edge column links cross their walls.
  x0: fc.double({ min: -2, max: 16, noNaN: true }),
  y0: fc.double({ min: -2, max: 10, noNaN: true }),
  w: fc.double({ min: 3, max: 10, noNaN: true }),
  h: fc.double({ min: 3, max: 8, noNaN: true }),
  topMm: fc.double({ min: -3.5, max: -0.5, noNaN: true }),
  runMm: fc.constantFrom(0, 0.3, 1.5),
});

describe('finishing moves against the exact contact (ADR-421 Amendment 1)', () => {
  it('leaves no move of any strategy cutting into the part', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(
        fc.array(plateauArb, { minLength: 1, maxLength: 3 }),
        fc.constantFrom<'raster' | 'raster-waterline'>('raster', 'raster-waterline'),
        fc.constantFrom<'x' | 'y'>('x', 'y'),
        fc.constantFrom(BALL, END_MILL),
        fc.boolean(),
        (specs, strategy, rasterAxis, tool, skipFloor) => {
          const map = partMap(
            specs.map((s) => ({
              x0: s.x0,
              y0: s.y0,
              x1: s.x0 + s.w,
              y1: s.y0 + s.h,
              topMm: s.topMm,
              runMm: s.runMm,
            })),
          );
          const passes = reliefFinishingPlan(map, {
            tool,
            kernel: kernelForTool(tool, map.mmPerCell),
            scallopMm: 0.025,
            strategy,
            rasterAxis,
            wallOnRight: true,
            // The floor counts as finished, so the raster skips and hops.
            ...(skipFloor ? { finishedAt: () => FLOOR_MM } : {}),
          });
          expect(worstCut(map, tool, passes)).toBeLessThanOrEqual(
            FINISHING_CONTACT_TOLERANCE_MM + BETWEEN_CHECKS_MM,
          );
        },
      ),
      { numRuns: 12, seed: 421 },
    );
  });

  it('lifts a link down the edge column over a wall parallel to the rows', () => {
    // A vertical step along X reaching both edges: rows run beside it, and
    // only the edge column links between them cross it.
    const map = partMap([{ x0: -2, y0: 8, x1: 26, y1: 18, topMm: -1, runMm: 0 }]);
    const passes = reliefFinishingPlan(map, {
      tool: BALL,
      kernel: kernelForTool(BALL, map.mmPerCell),
      scallopMm: 0.025,
      strategy: 'raster',
      rasterAxis: 'x',
      wallOnRight: true,
    });
    expect(worstCut(map, BALL, passes)).toBeLessThanOrEqual(
      FINISHING_CONTACT_TOLERANCE_MM + BETWEEN_CHECKS_MM,
    );
  });
});

describe('checkedPath', () => {
  // A contact that rises along a circle of radius 1 over x in [0, 2].
  const arch: ContactCheck = {
    tipAt: (x, _y, lowerBound) =>
      Math.max(lowerBound, x > 0 && x < 2 ? Math.sqrt(1 - (x - 1) ** 2) - 1 : -1),
    spacingMm: 0.05,
  };

  it('keeps a move that stays on or above the contact', () => {
    const path = [
      { x: -1, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ];
    expect(checkedPath(path, arch)).toEqual(path);
  });

  it('adds points on the contact where a move would cut under it', () => {
    const checked = checkedPath(
      [
        { x: 0, y: 0, z: -1 },
        { x: 2, y: 0, z: -1 },
      ],
      arch,
    );
    expect(checked.length).toBeGreaterThan(2);
    for (const point of checked) {
      expect(point.z).toBeGreaterThanOrEqual(arch.tipAt(point.x, point.y, -Infinity) - 1e-12);
    }
    const top = checked.reduce((z, point) => Math.max(z, point.z), -Infinity);
    expect(top).toBeCloseTo(0, 2);
    expect(worstCutAlong(checked, arch.tipAt)).toBeLessThanOrEqual(
      FINISHING_CONTACT_TOLERANCE_MM + 0.0005,
    );
  });

  it('never lowers a point', () => {
    const path = [
      { x: 0, y: 0, z: -0.5 },
      { x: 1, y: 0, z: 0.2 },
      { x: 2, y: 0, z: -0.9 },
    ];
    const checked = checkedPath(path, arch);
    for (const point of path) expect(checked).toContainEqual(point);
  });

  it('follows a flat end mill up a sampled wall', () => {
    // A flat end mill meeting a vertical wall between two samples 0.25 apart:
    // its contact climbs the facet between them, 4 mm up per mm across.
    const wall: ContactCheck = {
      tipAt: (x, _y, lowerBound) =>
        Math.max(lowerBound, Math.min(0, Math.max(-1, 4 * (x - 0.5) - 1))),
      spacingMm: 0.0625,
    };
    const checked = checkedPath(
      [
        { x: 0, y: 0, z: -1 },
        { x: 1, y: 0, z: 0 },
      ],
      wall,
    );
    expect(checked.length).toBeGreaterThan(2);
    expect(worstCutAlong(checked, wall.tipAt)).toBeLessThanOrEqual(FINISHING_CONTACT_TOLERANCE_MM);
  });

  it('holds the tolerance normal to the move', () => {
    // The same 0.005 mm under the contact is a 0.005 mm cut on a level move
    // but 0.0005 mm on a move ten times as steep, where it stays.
    const level: ContactCheck = {
      tipAt: (_x, _y, lowerBound) => Math.max(lowerBound, 0.005),
      spacingMm: 0.05,
    };
    const steep: ContactCheck = {
      tipAt: (x, _y, lowerBound) => Math.max(lowerBound, 10 * x + 0.005),
      spacingMm: 0.05,
    };
    const flat = [
      { x: 0, y: 0, z: 0.005 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0.005 },
    ];
    const climb = [
      { x: 0, y: 0, z: 0.005 },
      { x: 0.5, y: 0, z: 5 },
      { x: 1, y: 0, z: 10.005 },
    ];
    expect(checkedPath(flat, level)).not.toEqual(flat);
    expect(checkedPath(climb, steep)).toEqual(climb);
  });
});

// The deepest any move of the path cuts under the contact, normal to it.
function worstCutAlong(
  path: ReadonlyArray<{ x: number; y: number; z: number }>,
  tipAt: ContactCheck['tipAt'],
): number {
  let worst = 0;
  path.forEach((from, index) => {
    const to = path[index + 1];
    if (to === undefined) return;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return;
    const cosine = length / Math.hypot(length, to.z - from.z);
    for (let step = 0; step <= 1000; step += 1) {
      const t = step / 1000;
      const z = from.z + t * (to.z - from.z);
      const tip = tipAt(from.x + t * (to.x - from.x), from.y + t * (to.y - from.y), z);
      worst = Math.max(worst, (tip - z) * cosine);
    }
  });
  return worst;
}
