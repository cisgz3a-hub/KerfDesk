// CNC audit v3 N3-P3-1 and N3-P3-2, through the real compiler and emitter,
// measured by an independent height field (program-height-field.test-support).
//
// N3-P3-1 (ADR-154 Amendment 6): island-adaptive cells met with zero overlap.
// Each cell's finishing ring stopped exactly one radius short of the cut line,
// so a bit a few hundredths undersize left a full-depth foil along every seam.
// The program is replayed here with an undersize cutter.
//
// N3-P3-2 (ADR-105 Amendment 1): raster pockets above 100 % stepover left a
// full-depth strip between each pair of rows (36 × 28 at 150 %: 97 mm²).

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
  type Scene,
  type Vec2,
} from '../scene';
import { findCncAdaptivePocketIssues } from './cnc-adaptive-issues';
import { compileCncJob } from './compile-cnc-job';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
  uncutReachableStock,
  type HeightField,
  type ProgramMove,
} from './program-height-field.test-support';

const TOOL: CncTool = { id: 'em-4000-n3', name: '4 mm end mill', kind: 'end-mill', diameterMm: 4 };
const CONFIG: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TOOL],
};
const DEPTH_MM = 3;
// A 4 mm bit ground 0.04 mm under nominal: well inside a new end mill's
// tolerance, and a re-sharpened one is smaller still.
const UNDERSIZE_RADIUS_MM = 1.98;

function rect(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function pocketScene(contours: ReadonlyArray<Polyline>, cnc: Partial<CncLayerSettings>): Scene {
  return {
    objects: [
      {
        kind: 'imported-svg',
        id: 'pocket',
        source: 'pocket.svg',
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: contours.map((contour) => ({ ...contour })) }],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'pocket',
          toolId: TOOL.id,
          depthMm: DEPTH_MM,
          depthPerPassMm: 1.5,
          ...cnc,
        },
      },
    ],
  };
}

function machine(point: Vec2): Vec2 {
  return toMachineCoords(point, DEFAULT_DEVICE_PROFILE);
}

function program(scene: Scene): ReadonlyArray<ProgramMove> {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, CONFIG);
  return parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
}

function carved(
  moves: ReadonlyArray<ProgramMove>,
  contours: ReadonlyArray<Polyline>,
  radiusMm: number,
  cellMm: number,
): HeightField {
  const field = createHeightField(
    contours.map((contour) => contour.points.map(machine)),
    cellMm,
  );
  for (const move of moves) if (!move.rapid) carveMove(field, move, radiusMm);
  return field;
}

function stockTopAt(field: HeightField, point: Vec2): number {
  const at = machine(point);
  const col = Math.floor((at.x - field.minX) / field.cellMm);
  const row = Math.floor((at.y - field.minY) / field.cellMm);
  return field.z[row * field.width + col] as number;
}

describe('island adaptive cell seams (ADR-154 Amendment 6)', () => {
  it(
    'clears every seam with a bit slightly under its nominal diameter',
    () => {
      // A 10 mm island in a 30 mm square is cut into 8 cells; their seams in
      // open stock lie on x = 10 and 20 (below and above the island) and on
      // y = 10 and 20 (left and right of it).
      const contours = [rect(0, 0, 30, 30), rect(10, 10, 10, 10)];
      const scene = pocketScene(contours, {
        pocketStrategy: 'adaptive',
        adaptiveOptimalLoadMm: 0.5,
      });
      expect(
        findCncAdaptivePocketIssues(scene, DEFAULT_DEVICE_PROFILE, CONFIG).map((i) => i.reason),
      ).toEqual([expect.stringContaining('Island adaptive uses')]);
      const field = carved(program(scene), contours, UNDERSIZE_RADIUS_MM, 0.02);
      const standing: string[] = [];
      for (let along = 0.5; along <= 9.5; along += 0.25)
        for (const point of [
          { x: 10, y: along },
          { x: 20, y: along },
          { x: 10, y: 20 + along },
          { x: 20, y: 20 + along },
          { x: along, y: 10 },
          { x: along, y: 20 },
          { x: 20 + along, y: 10 },
          { x: 20 + along, y: 20 },
        ])
          if (stockTopAt(field, point) > -DEPTH_MM + 0.05) standing.push(`${point.x},${point.y}`);
      expect(standing).toEqual([]);
    },
    ciBudgetMs(60_000, 180_000),
  );
});

describe('raster pockets above 100 % stepover (ADR-105 Amendment 1)', () => {
  it.each([105, 150, 200])('leaves no strip standing at %i percent', (stepoverPercent) => {
    const contours = [rect(0, 0, 36, 28)];
    const scene = pocketScene(contours, { pocketStrategy: 'raster-y', stepoverPercent });
    const field = carved(program(scene), contours, TOOL.diameterMm / 2, 0.05);
    const walls = contours.map((contour) => contour.points.map(machine));
    const uncut = uncutReachableStock(field, walls, TOOL.diameterMm / 2, -DEPTH_MM);
    expect(uncut.totalMm2).toBeLessThan(0.5);
  });
});
