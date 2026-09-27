// ADR-368 Amendment 2 through the real compiler and the removal simulator the
// 3D preview uses: a tapered ball nose lays out pocket and profile walls, and
// pocket and relief-roughing stepover, by its cut width at depth rather than
// the widest diameter at the top of its flutes.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  taperedBallEnvelope,
  taperedBallHeightMm,
  taperedBallRadiusAtHeightMm,
  type TaperedBallEnvelope,
} from '../cnc-tapered-ball';
import type { Job } from '../job';
import type { RemovalGrid } from '../sim';
import {
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncTool,
  type ReliefObject,
  type SceneObject,
} from '../scene';
import { roughingLoops } from '../relief/relief-roughing-chain.test-support';
import {
  compileWithTool,
  contourPassXs,
  floorResidual,
  gridCells as cells,
  insideBy,
  machineBox,
  removalGrid,
  squareObject as square,
  wallDistanceMm,
  type Box,
} from './layout-removal.test-support';

// Amana 46282, as the audit modeled it: 6.25 mm across the top of the flutes,
// a 1/16" ball tip, 5.4 degrees per side.
const TBN: CncTool = {
  id: 'tbn-46282',
  name: 'Amana 46282 tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};
const TAN_SIDE = Math.tan((5.4 * Math.PI) / 180);
const DEPTH_PER_PASS_MM = 1.5;
const STEPOVER = 0.4;
// A fine strip across one wall, and a coarser grid over a whole floor. A
// floor reading is exact at each cell centre, so the coarser grid only
// samples fewer points; a rib is far wider than one cell.
const WALL_CELL_MM = 0.03;
const FLOOR_CELL_MM = 0.05;
// One cell for where a sample lands plus one for the kernel's rasterization.
const WALL_SLACK_MM = 2 * WALL_CELL_MM;
const FLOOR_SLACK_MM = 2 * FLOOR_CELL_MM;
const Z_SLACK_MM = 0.05;

function envelope(): TaperedBallEnvelope {
  const modeled = taperedBallEnvelope(TBN);
  if (modeled === null) throw new Error('expected a modeled envelope');
  return modeled;
}

// Reference widths straight from the ADR-368 law, independent of the layout
// helper the compiler uses.
function cutRadiusMm(depthMm: number): number {
  return taperedBallRadiusAtHeightMm(envelope(), depthMm);
}

// A ring pattern at the stepover spacing leaves at most the ball's rise one
// spacing from the nearest path, where the innermost ring stops short of the
// centre; between rings it is half that. A rib stands a whole pass or more.
const STEP_MM = STEPOVER * 2 * cutRadiusMm(DEPTH_PER_PASS_MM);
const NO_RIB_MM = taperedBallHeightMm(envelope(), STEP_MM) + Z_SLACK_MM;

function compile(object: SceneObject, patch: Partial<CncLayerSettings>): Job {
  return compileWithTool(object, TBN, {
    depthPerPassMm: DEPTH_PER_PASS_MM,
    stepoverPercent: STEPOVER * 100,
    ...patch,
  });
}

function removal(job: Job, area: Box, cellMm: number): RemovalGrid {
  return removalGrid(job, TBN, area, cellMm);
}

describe('tapered ball-nose profile layout', () => {
  it('lands an outside profile top edge on the line and follows the taper below it', () => {
    const object = square(40, 10);
    const box = machineBox(object);
    const midY = (box.minY + box.maxY) / 2;
    const job = compile(object, { cutType: 'profile-outside', depthMm: 6 });
    const strip = { minX: box.minX - 4, maxX: box.minX + 3, minY: midY - 0.3, maxY: midY + 0.3 };
    const row = cells(removal(job, strip, WALL_CELL_MM));
    // The waste lies left of the square's left edge.
    const toWaste = -1;

    // Nothing inside the drawn line is cut, at any depth.
    for (const cell of row) {
      if ((cell.x - box.minX) * toWaste < -WALL_SLACK_MM) expect(cell.depthMm).toBe(0);
    }
    // The wall meets the line at the stock surface; the widest-diameter offset
    // left it 3.125 - 1.289 = 1.836 mm out.
    expect(wallDistanceMm(row, box.minX, toWaste, -0.05)).toBeLessThanOrEqual(WALL_SLACK_MM);
    // Below the surface it follows the 5.4 degree flank, |Z| tan(5.4 deg) out.
    for (const zMm of [-1, -3, -5]) {
      const outMm = wallDistanceMm(row, box.minX, toWaste, zMm);
      expect(Math.abs(outMm + zMm * TAN_SIDE), `wall at Z${zMm}`).toBeLessThanOrEqual(
        WALL_SLACK_MM,
      );
    }
    // The ball tip reaches the full depth on the path, one cut radius out.
    const deepest = row.reduce((best, cell) => (cell.depthMm < best.depthMm ? cell : best));
    expect(deepest.depthMm).toBeCloseTo(-6, 2);
    expect(Math.abs(box.minX - deepest.x - cutRadiusMm(6))).toBeLessThanOrEqual(WALL_SLACK_MM);
  });

  it('offsets an inside profile inward by the cut radius at the full depth', () => {
    const object = square(40, 10);
    const box = machineBox(object);
    const xs = contourPassXs(compile(object, { cutType: 'profile-inside', depthMm: 3 }));
    // Emitted coordinates sit on the 0.001 mm output grid.
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.abs(Math.min(...xs) - box.minX - cutRadiusMm(3))).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(box.maxX - Math.max(...xs) - cutRadiusMm(3))).toBeLessThanOrEqual(0.0005);
  });
});

describe('tapered ball-nose pocket layout', () => {
  it('meets the line at the surface and clears the floor without ribs', () => {
    const object = square(40, 8);
    const box = machineBox(object);
    const depthMm = 3;
    const grid = removal(
      compile(object, { cutType: 'pocket', depthMm }),
      { minX: box.minX - 1, maxX: box.maxX + 1, minY: box.minY - 1, maxY: box.maxY + 1 },
      FLOOR_CELL_MM,
    );
    const all = cells(grid);

    // Nothing outside the drawn line is cut, and nothing below the floor.
    for (const cell of all) {
      if (insideBy(cell, box) < -FLOOR_SLACK_MM) expect(cell.depthMm).toBe(0);
      expect(cell.depthMm).toBeGreaterThanOrEqual(-depthMm);
    }
    // Mid-side, the wall meets the line at the surface; the widest-diameter
    // offset left it 3.125 - 1.006 = 2.119 mm inside.
    const midY = (box.minY + box.maxY) / 2;
    const row = all.filter((cell) => Math.abs(cell.y - midY) < FLOOR_CELL_MM);
    expect(wallDistanceMm(row, box.minX, 1, -0.05)).toBeLessThanOrEqual(FLOOR_SLACK_MM);
    // Wherever the tip reaches the floor, only a scallop stands above it; the
    // widest-diameter stepover left full-height ribs between the rings.
    const floor = floorResidual(all, box, cutRadiusMm(depthMm) + FLOOR_SLACK_MM, -depthMm);
    expect(floor.cells).toBeGreaterThan(1000);
    expect(floor.highestMm).toBeLessThanOrEqual(NO_RIB_MM);
    expect(NO_RIB_MM).toBeLessThan(DEPTH_PER_PASS_MM / 3);
  });
});

describe('tapered ball-nose relief roughing', () => {
  it('spaces its rings so no rib stands between them', () => {
    // A relief sits where its transform puts it; identity keeps it at the
    // scene origin, so its bounds start there too.
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'floor.png',
      // One sample at the darkest code: a flat floor at the full depth.
      reliefSource: testReliefHeightfield({
        width: 1,
        height: 1,
        physicalWidthMm: 10,
        physicalHeightMm: 10,
        maxDepthMm: 3,
        samplesU8: [0],
      }),
      targetWidthMm: 10,
      reliefDepthMm: 3,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    };
    const job = compile(relief, { finishAllowanceMm: 0 });
    const [roughing] = job.groups.filter(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-rough',
    );
    if (roughing?.kind !== 'cnc') throw new Error('expected a relief roughing group');

    // Each level's rings step in by the stepover of the cut width over one
    // level (0.691 mm), where the widest diameter stepped 2.5 mm.
    const ringMinXs = roughingLoops(roughing.passes)
      .filter((loop) => loop.zMm === -3)
      .map((loop) => Math.min(...loop.points.map((p) => p.x)))
      .sort((a, b) => a - b);
    expect(ringMinXs.length).toBeGreaterThan(3);
    for (let ring = 1; ring < ringMinXs.length; ring += 1) {
      const spacingMm = (ringMinXs[ring] ?? 0) - (ringMinXs[ring - 1] ?? 0);
      expect(Math.abs(spacingMm - STEP_MM)).toBeLessThanOrEqual(0.001);
    }

    // Between the rings the floor stands no higher than a scallop; the
    // widest-diameter stepover left ribs 0.77 mm wide standing to the top of
    // each 1.5 mm level. That includes the half of the relief holding the ring
    // seams, now that each ring closes back on its start (ADR-289 Amendment 1).
    const box = machineBox(relief);
    const floor = floorResidual(cells(removal(job, box, FLOOR_CELL_MM)), box, 2, -3);
    expect(floor.cells).toBeGreaterThan(1000);
    expect(floor.highestMm).toBeLessThanOrEqual(NO_RIB_MM);
  });
});
