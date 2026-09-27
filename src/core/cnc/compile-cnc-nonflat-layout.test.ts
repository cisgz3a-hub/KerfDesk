// ADR-368 Amendment 3 through the real compiler and the removal simulator the
// 3D preview uses: a ball nose, a V-bit and an engraving bit lay out pocket and
// profile walls, pocket and relief-roughing stepover, and tab windows by their
// cut width at depth rather than their stored diameter.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_CNC_TOOLS, IDENTITY_TRANSFORM, type CncTool, type ReliefObject } from '../scene';
import { roughingLoops } from '../relief/relief-roughing-chain.test-support';
import {
  compileWithTool,
  contourPassXs,
  floorResidual,
  gridCells,
  insideBy,
  machineBox,
  removalGrid,
  squareObject,
  wallDistanceMm,
  type Box,
  type Cell,
} from './layout-removal.test-support';

function starter(id: string): CncTool {
  const tool = DEFAULT_CNC_TOOLS.find((candidate) => candidate.id === id);
  if (tool === undefined) throw new Error(`missing starter bit ${id}`);
  return tool;
}

// The starter 1/4" ball nose and 60 degree 1/4" V-bit, and a 30 degree
// engraver with a 0.2 mm flat on a 1/8" cut.
const BALL = starter('bn-6350');
const V_BIT = starter('vb-60');
const ENGRAVER: CncTool = {
  id: 'eng-30',
  name: '30 degree engraver, 0.2 mm flat',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};
const BALL_RADIUS_MM = 3.175;
const TAN_30 = Math.tan(Math.PI / 6);
const TAN_15 = Math.tan(Math.PI / 12);
// A fine strip across one wall, and a coarser grid over a whole floor. A
// floor reading is exact at each cell centre, so the coarser grid only
// samples fewer points; a rib is far wider than one cell, and stamping cost
// grows with the cube of the cell count per millimetre.
const WALL_CELL_MM = 0.03;
const FLOOR_CELL_MM = 0.1;
// Stamping a whole job takes a few seconds on a slow runner.
const SIMULATOR_TIMEOUT_MS = 30_000;
// One cell for where a sample lands plus one for the kernel's rasterization.
const WALL_SLACK_MM = 2 * WALL_CELL_MM;
const FLOOR_SLACK_MM = 2 * FLOOR_CELL_MM;
const Z_SLACK_MM = 0.05;

// Reference shapes straight from each cutter's geometry, independent of the
// layout helper the compiler uses: the ball's cut radius `heightMm` above its
// tip, and its rise `radiusMm` from its axis.
function ballRadiusMm(heightMm: number): number {
  return heightMm >= BALL_RADIUS_MM
    ? BALL_RADIUS_MM
    : Math.sqrt(heightMm * (2 * BALL_RADIUS_MM - heightMm));
}

function ballRiseMm(radiusMm: number): number {
  return BALL_RADIUS_MM - Math.sqrt(BALL_RADIUS_MM ** 2 - radiusMm ** 2);
}

function around(box: Box, marginMm: number): Box {
  return {
    minX: box.minX - marginMm,
    maxX: box.maxX + marginMm,
    minY: box.minY - marginMm,
    maxY: box.maxY + marginMm,
  };
}

// A thin strip across the box's left wall, mid-way up it.
function leftWallStrip(box: Box): Box {
  const midY = (box.minY + box.maxY) / 2;
  return { minX: box.minX - 5, maxX: box.minX + 2, minY: midY - 0.3, maxY: midY + 0.3 };
}

function midRow(all: ReadonlyArray<Cell>, box: Box): ReadonlyArray<Cell> {
  const midY = (box.minY + box.maxY) / 2;
  return all.filter((cell) => Math.abs(cell.y - midY) < FLOOR_CELL_MM);
}

function deepestCell(row: ReadonlyArray<Cell>): Cell {
  return row.reduce((best, cell) => (cell.depthMm < best.depthMm ? cell : best));
}

// An outside profile's waste lies left of the square's left edge: nothing on
// the part side of the line is cut, at any depth.
function expectPartUncut(row: ReadonlyArray<Cell>, lineX: number): void {
  for (const cell of row) {
    if (cell.x - lineX > WALL_SLACK_MM) expect(cell.depthMm).toBe(0);
  }
}

// Nothing outside a pocket's line is cut, and nothing below its floor.
function expectInsidePocket(all: ReadonlyArray<Cell>, box: Box, depthMm: number): void {
  for (const cell of all) {
    if (insideBy(cell, box) < -FLOOR_SLACK_MM) expect(cell.depthMm).toBe(0);
    expect(cell.depthMm).toBeGreaterThanOrEqual(-depthMm);
  }
}

describe('ball-nose layout', () => {
  it(
    'lands a shallow outside profile on the line and follows the ball below it',
    { timeout: SIMULATOR_TIMEOUT_MS },
    () => {
      // 1 mm down the 6.35 mm ball cuts 4.626 mm wide. Its stored radius left
      // the top edge 0.862 mm out, the part 1.72 mm oversize.
      const object = squareObject(40, 10);
      const box = machineBox(object);
      const depthMm = 1;
      const job = compileWithTool(object, BALL, {
        cutType: 'profile-outside',
        depthMm,
        depthPerPassMm: 1.5,
      });
      const row = gridCells(removalGrid(job, BALL, leftWallStrip(box), WALL_CELL_MM));
      expectPartUncut(row, box.minX);
      // The path runs one cut radius out; at Z the wall is where the ball,
      // depth + Z above its tip, is as wide as that.
      const pathOutMm = ballRadiusMm(depthMm);
      for (const zMm of [-0.05, -0.25, -0.5]) {
        const expectedMm = pathOutMm - ballRadiusMm(depthMm + zMm);
        const outMm = wallDistanceMm(row, box.minX, -1, zMm);
        expect(Math.abs(outMm - expectedMm), `wall at Z${zMm}`).toBeLessThanOrEqual(WALL_SLACK_MM);
      }
      const bottom = deepestCell(row);
      expect(bottom.depthMm).toBeCloseTo(-depthMm, 2);
      expect(Math.abs(box.minX - bottom.x - pathOutMm)).toBeLessThanOrEqual(WALL_SLACK_MM);
    },
  );

  it('keeps the stored radius once the cut is a radius deep', () => {
    const object = squareObject(40, 10);
    const box = machineBox(object);
    const xs = contourPassXs(
      compileWithTool(object, BALL, { cutType: 'profile-inside', depthMm: 4, depthPerPassMm: 1.5 }),
    );
    // Emitted coordinates sit on the 0.001 mm output grid.
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.abs(Math.min(...xs) - box.minX - BALL_RADIUS_MM)).toBeLessThanOrEqual(0.0005);
  });

  it(
    'clears a pocket at a large stepover over shallow passes without ribs',
    { timeout: SIMULATOR_TIMEOUT_MS },
    () => {
      // 90% of the stored 6.35 mm spaced rings 5.715 mm apart, but each 1 mm
      // pass cuts only 4.626 mm wide: ridges 1.79 mm tall stood between the
      // rings, 0.79 mm above every pass.
      const object = squareObject(40, 20);
      const box = machineBox(object);
      const depthMm = 2;
      const passMm = 1;
      const job = compileWithTool(object, BALL, {
        cutType: 'pocket',
        depthMm,
        depthPerPassMm: passMm,
        stepoverPercent: 90,
      });
      const all = gridCells(removalGrid(job, BALL, around(box, 1), FLOOR_CELL_MM));
      expectInsidePocket(all, box, depthMm);
      // Mid-side, the wall meets the line at the stock surface.
      const expectedInMm = ballRadiusMm(depthMm) - ballRadiusMm(depthMm - 0.05);
      const row = midRow(all, box);
      expect(wallDistanceMm(row, box.minX, 1, -0.05)).toBeLessThanOrEqual(
        expectedInMm + FLOOR_SLACK_MM,
      );
      // Between parallel rings only the ball's rise half a spacing out stands;
      // nowhere does the floor stand a whole pass high.
      const spacingMm = 0.9 * 2 * ballRadiusMm(passMm);
      const floorMarginMm = ballRadiusMm(depthMm) + FLOOR_SLACK_MM;
      const betweenRings = floorResidual(row, box, floorMarginMm, -depthMm);
      expect(betweenRings.cells).toBeGreaterThan(100);
      expect(betweenRings.highestMm).toBeLessThanOrEqual(ballRiseMm(spacingMm / 2) + Z_SLACK_MM);
      const floor = floorResidual(all, box, floorMarginMm, -depthMm);
      expect(floor.cells).toBeGreaterThan(10000);
      expect(floor.highestMm).toBeLessThanOrEqual(passMm + Z_SLACK_MM);
    },
  );

  it('spaces relief roughing rings by its cut width over one level', () => {
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'floor.png',
      // One sample at the darkest code: a flat floor at the full depth.
      reliefSource: testReliefHeightfield({
        width: 1,
        height: 1,
        physicalWidthMm: 30,
        physicalHeightMm: 30,
        maxDepthMm: 3,
        samplesU8: [0],
      }),
      targetWidthMm: 30,
      reliefDepthMm: 3,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      transform: IDENTITY_TRANSFORM,
    };
    const job = compileWithTool(relief, BALL, {
      depthPerPassMm: 1.5,
      stepoverPercent: 40,
      finishAllowanceMm: 0,
    });
    const [roughing] = job.groups.filter(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-rough',
    );
    if (roughing?.kind !== 'cnc') throw new Error('expected a relief roughing group');
    // A 1.5 mm level engages 5.394 mm of the ball, so 40% steps 2.158 mm,
    // where the stored diameter stepped 2.54 mm.
    const ringMinXs = roughingLoops(roughing.passes)
      .filter((loop) => loop.zMm === -3)
      .map((loop) => Math.min(...loop.points.map((p) => p.x)))
      .sort((a, b) => a - b);
    expect(ringMinXs.length).toBeGreaterThan(3);
    const stepMm = 0.4 * 2 * ballRadiusMm(1.5);
    for (let ring = 1; ring < ringMinXs.length; ring += 1) {
      const spacingMm = (ringMinXs[ring] ?? 0) - (ringMinXs[ring - 1] ?? 0);
      expect(Math.abs(spacingMm - stepMm)).toBeLessThanOrEqual(0.001);
    }
  });
});

describe('V-bit layout', () => {
  it(
    'lands an outside profile top edge on the line and follows the cone below it',
    { timeout: SIMULATOR_TIMEOUT_MS },
    () => {
      // 3 mm down the 60 degree bit cuts 3.464 mm wide. Its stored radius left
      // the top edge 1.443 mm out.
      const object = squareObject(40, 10);
      const box = machineBox(object);
      const depthMm = 3;
      const job = compileWithTool(object, V_BIT, {
        cutType: 'profile-outside',
        depthMm,
        depthPerPassMm: 1.5,
      });
      const row = gridCells(removalGrid(job, V_BIT, leftWallStrip(box), WALL_CELL_MM));
      expectPartUncut(row, box.minX);
      // The wall leaves the line at the surface and moves out |Z| tan 30 below.
      for (const zMm of [-0.05, -1, -2]) {
        const outMm = wallDistanceMm(row, box.minX, -1, zMm);
        expect(Math.abs(outMm + zMm * TAN_30), `wall at Z${zMm}`).toBeLessThanOrEqual(
          WALL_SLACK_MM,
        );
      }
      // The point reaches the full depth on the path, one cut radius out; the
      // nearest cell centre can sit up to a cell off the point.
      const bottom = deepestCell(row);
      expect(bottom.depthMm).toBeGreaterThanOrEqual(-depthMm);
      expect(bottom.depthMm).toBeLessThanOrEqual(-depthMm + WALL_CELL_MM / TAN_30);
      expect(Math.abs(box.minX - bottom.x - depthMm * TAN_30)).toBeLessThanOrEqual(WALL_SLACK_MM);
    },
  );

  it(
    'meets the line with a pocket and leaves no rib above a pass',
    { timeout: SIMULATOR_TIMEOUT_MS },
    () => {
      // 40% of the stored 6.35 mm spaced rings 2.54 mm apart, where each 1.5 mm
      // pass cuts 1.732 mm wide: ridges 2.2 mm tall stood between the rings.
      const object = squareObject(40, 16);
      const box = machineBox(object);
      const depthMm = 3;
      const passMm = 1.5;
      const job = compileWithTool(object, V_BIT, {
        cutType: 'pocket',
        depthMm,
        depthPerPassMm: passMm,
        stepoverPercent: 40,
      });
      const all = gridCells(removalGrid(job, V_BIT, around(box, 1), FLOOR_CELL_MM));
      expectInsidePocket(all, box, depthMm);
      expect(wallDistanceMm(midRow(all, box), box.minX, 1, -0.05)).toBeLessThanOrEqual(
        0.05 * TAN_30 + FLOOR_SLACK_MM,
      );
      // The cone rises one spacing from the nearest path at most, where the
      // innermost ring stops short of the centre: 1.2 mm, under the pass.
      const spacingMm = 0.4 * 2 * passMm * TAN_30;
      const noRibMm = spacingMm / TAN_30 + Z_SLACK_MM;
      const floor = floorResidual(all, box, depthMm * TAN_30 + FLOOR_SLACK_MM, -depthMm);
      expect(floor.cells).toBeGreaterThan(10000);
      expect(floor.highestMm).toBeLessThanOrEqual(noRibMm);
      expect(noRibMm).toBeLessThan(passMm);
    },
  );

  it(
    'holds an on-path part with bridges no narrower than requested',
    { timeout: SIMULATOR_TIMEOUT_MS },
    () => {
      // 3 mm stock, 3 mm deep, 1 mm tabs 4 mm wide. A tab window adds the cut
      // width at the full depth, 3.464 mm; the full-depth cone then eats
      // 1 mm x tan 30 into each end at the tab top. The stored diameter left a
      // 9.2 mm bridge there.
      const object = squareObject(40, 20);
      const box = machineBox(object);
      const job = compileWithTool(
        object,
        V_BIT,
        {
          cutType: 'profile-on-path',
          depthMm: 3,
          depthPerPassMm: 1.5,
          tabsEnabled: true,
          tabsPerShape: 4,
          tabWidthMm: 4,
          tabHeightMm: 1,
        },
        3,
      );
      // Along the left edge's centreline, the bridge top stays at the tab top.
      // One column of cells is centred on the line; a float sliver beyond it is
      // not read.
      const midY = (box.minY + box.maxY) / 2;
      const halfCell = WALL_CELL_MM / 2;
      const line = {
        minX: box.minX - halfCell,
        maxX: box.minX + halfCell,
        minY: midY - 8,
        maxY: midY + 8,
      };
      const bridge = gridCells(removalGrid(job, V_BIT, line, WALL_CELL_MM)).filter(
        (cell) => Math.abs(cell.x - box.minX) < halfCell / 2 && cell.depthMm >= -2 - 1e-6,
      );
      const topWidthMm = bridge.length * WALL_CELL_MM;
      const expectedMm = 4 + 2 * 3 * TAN_30 - 2 * 1 * TAN_30;
      expect(topWidthMm).toBeGreaterThanOrEqual(4);
      expect(Math.abs(topWidthMm - expectedMm)).toBeLessThanOrEqual(WALL_SLACK_MM);
    },
  );
});

describe('engraving-bit layout', () => {
  it('offsets an inside profile by its cone and tip flat at the full depth', () => {
    // 1 mm down the engraver cuts 0.2 + 2 tan 15 = 0.736 mm wide; its stored
    // 3.175 mm diameter put the path 1.22 mm too far in.
    const object = squareObject(40, 10);
    const box = machineBox(object);
    const xs = contourPassXs(
      compileWithTool(object, ENGRAVER, {
        cutType: 'profile-inside',
        depthMm: 1,
        depthPerPassMm: 0.5,
      }),
    );
    const pathInMm = 0.1 + 1 * TAN_15;
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.abs(Math.min(...xs) - box.minX - pathInMm)).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(box.maxX - Math.max(...xs) - pathInMm)).toBeLessThanOrEqual(0.0005);
  });
});
