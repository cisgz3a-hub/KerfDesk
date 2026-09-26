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
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type Job } from '../job';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncTool,
  type ImportedSvg,
  type ReliefObject,
  type Scene,
  type SceneObject,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

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

function square(atMm: number, sizeMm: number): ImportedSvg {
  const points = [
    { x: atMm, y: atMm },
    { x: atMm + sizeMm, y: atMm },
    { x: atMm + sizeMm, y: atMm + sizeMm },
    { x: atMm, y: atMm + sizeMm },
  ];
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: atMm, minY: atMm, maxX: atMm + sizeMm, maxY: atMm + sizeMm },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
  };
}

function compile(object: SceneObject, patch: Partial<CncLayerSettings>): Job {
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          toolId: TBN.id,
          depthPerPassMm: DEPTH_PER_PASS_MM,
          stepoverPercent: STEPOVER * 100,
          // A clean wall to measure: no bridges, no lead arcs in the waste.
          tabsEnabled: false,
          profileLead: { shape: 'none' },
          ...patch,
        },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TBN],
    toolId: TBN.id,
  });
}

type Box = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

// The object's scene bounds in machine coordinates.
function machineBox(object: SceneObject): Box {
  const corners = [
    { x: object.bounds.minX, y: object.bounds.minY },
    { x: object.bounds.maxX, y: object.bounds.maxY },
  ].map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function removal(job: Job, area: Box, cellMm: number): RemovalGrid {
  const result = computeRemovalGrid(
    buildToolpath(job),
    {
      originX: area.minX,
      originY: area.minY,
      widthMm: area.maxX - area.minX,
      heightMm: area.maxY - area.minY,
      mmPerCell: cellMm,
    },
    kernelForTool(TBN, cellMm),
  );
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

type Cell = { readonly x: number; readonly y: number; readonly depthMm: number };

function cells(grid: RemovalGrid): ReadonlyArray<Cell> {
  const out: Cell[] = [];
  for (let row = 0; row < grid.heightCells; row += 1) {
    for (let col = 0; col < grid.widthCells; col += 1) {
      out.push({
        x: grid.originX + (col + 0.5) * grid.mmPerCell,
        y: grid.originY + (row + 0.5) * grid.mmPerCell,
        depthMm: grid.depth[row * grid.widthCells + col] ?? 0,
      });
    }
  }
  return out;
}

// Where the wall stands at `zMm`: the distance from the line, measured toward
// the waste, of the first cell cut at least that deep.
function wallDistanceMm(
  row: ReadonlyArray<Cell>,
  lineX: number,
  wasteSign: 1 | -1,
  zMm: number,
): number {
  const reached = row
    .filter((cell) => cell.depthMm <= zMm)
    .map((cell) => (cell.x - lineX) * wasteSign);
  return reached.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...reached);
}

// How far a cell lies inside the box; negative outside it.
function insideBy(cell: Cell, box: Box): number {
  return Math.min(cell.x - box.minX, box.maxX - cell.x, cell.y - box.minY, box.maxY - cell.y);
}

// The highest the floor stands above `floorZ` over cells at least `marginMm`
// inside the box.
function floorResidual(
  all: ReadonlyArray<Cell>,
  box: Box,
  marginMm: number,
  floorZ: number,
): { readonly cells: number; readonly highestMm: number } {
  let count = 0;
  let highestMm = Number.NEGATIVE_INFINITY;
  for (const cell of all) {
    if (insideBy(cell, box) < marginMm) continue;
    count += 1;
    highestMm = Math.max(highestMm, cell.depthMm - floorZ);
  }
  return { cells: count, highestMm };
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
    const job = compile(object, { cutType: 'profile-inside', depthMm: 3 });
    const xs: number[] = [];
    for (const group of job.groups) {
      if (group.kind !== 'cnc') continue;
      for (const pass of group.passes) {
        if (pass.kind === 'contour') xs.push(...pass.polyline.map((point) => point.x));
      }
    }
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
    const ringMinXs = roughing.passes
      .filter((pass) => pass.kind === 'contour' && pass.zMm === -3)
      .map((pass) => (pass.kind === 'contour' ? Math.min(...pass.polyline.map((p) => p.x)) : 0))
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
