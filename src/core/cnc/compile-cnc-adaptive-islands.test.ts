// CNC audit v1 F2-P1-1 and F2-P2-1 (ADR-154 Amendment 4) through the real
// compiler and emitter. The emitted program is measured by an independent
// height field (program-height-field.test-support.ts), not by the adaptive
// verifier the fix also changed.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
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

const TOOL: CncTool = { id: 'em-4000-f2', name: '4 mm end mill', kind: 'end-mill', diameterMm: 4 };
const RADIUS_MM = TOOL.diameterMm / 2;
const CONFIG: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TOOL],
};
const DEPTH_MM = 3;
const FEED_MM_PER_MIN = 1000;
const PLUNGE_MM_PER_MIN = 300;

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

function adaptiveScene(contours: ReadonlyArray<Polyline>): Scene {
  const points = contours.flatMap((contour) => contour.points);
  return {
    objects: [
      {
        kind: 'imported-svg',
        id: 'pocket',
        source: 'pocket.svg',
        bounds: {
          minX: Math.min(...points.map((point) => point.x)),
          minY: Math.min(...points.map((point) => point.y)),
          maxX: Math.max(...points.map((point) => point.x)),
          maxY: Math.max(...points.map((point) => point.y)),
        },
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
          pocketStrategy: 'adaptive',
          toolId: TOOL.id,
          adaptiveOptimalLoadMm: 0.5,
          depthMm: DEPTH_MM,
          depthPerPassMm: 1.5,
          feedMmPerMin: FEED_MM_PER_MIN,
          plungeMmPerMin: PLUNGE_MM_PER_MIN,
        },
      },
    ],
  };
}

function machineWalls(contours: ReadonlyArray<Polyline>): Vec2[][] {
  return contours.map((contour) =>
    contour.points.map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE)),
  );
}

// Compiles as island adaptive (not the offset fallback) and emits the program.
function islandAdaptiveProgram(contours: ReadonlyArray<Polyline>): ReadonlyArray<ProgramMove> {
  const scene = adaptiveScene(contours);
  const disclosures = findCncAdaptivePocketIssues(scene, DEFAULT_DEVICE_PROFILE, CONFIG);
  expect(disclosures.map((issue) => issue.reason)).toEqual([
    expect.stringContaining('Island adaptive uses'),
  ]);
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, CONFIG);
  return parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
}

function stockTopAt(field: HeightField, point: Vec2): number {
  const col = Math.floor((point.x - field.minX) / field.cellMm);
  const row = Math.floor((point.y - field.minY) / field.cellMm);
  return field.z[row * field.width + col] as number;
}

describe('island adaptive emitted programs', () => {
  it(
    'leaves no stock standing where two islands bounds cross in open stock',
    () => {
      // The island x bounds 36 and 46 cross the other island's y bound 10,
      // and 12 and 22 cross 30, all in open stock. Partition cells meeting
      // there left four full-depth pins, 13.8 mm2 in all, and the verifier
      // certified the plan.
      const contours = [rect(0, 0, 60, 40), rect(12, 10, 10, 10), rect(36, 20, 10, 10)];
      const moves = islandAdaptiveProgram(contours);
      const walls = machineWalls(contours);
      const field = createHeightField(walls, 0.1);
      for (const move of moves) if (!move.rapid) carveMove(field, move, RADIUS_MM);
      const uncut = uncutReachableStock(field, walls, RADIUS_MM, -DEPTH_MM);
      expect(uncut.patches).toEqual([]);
      for (const crossing of [
        { x: 36, y: 10 },
        { x: 46, y: 10 },
        { x: 12, y: 30 },
        { x: 22, y: 30 },
      ])
        expect(
          stockTopAt(field, toMachineCoords(crossing, DEFAULT_DEVICE_PROFILE)),
        ).toBeLessThanOrEqual(-DEPTH_MM + 0.05);
    },
    ciBudgetMs(60_000, 180_000),
  );

  it(
    'cuts a nested pocket wall only after the clearing beside it',
    () => {
      // The whole region's wall cleanup rode on the last planned cell, but
      // the program cut the regions in source order: the nested pocket's
      // wall was slotted at the cutting feed, from a straight plunge, before
      // its own clearing ran.
      const contours = [rect(0, 0, 40, 40), rect(8, 8, 24, 24), rect(14, 14, 12, 12)];
      const moves = islandAdaptiveProgram(contours);
      const walls = machineWalls(contours);
      const field = createHeightField(walls, 0.1);
      let slotMm = 0;
      let plungesIntoStock = 0;
      for (const move of moves) {
        if (move.rapid) continue;
        const length = Math.hypot(move.b.x - move.a.x, move.b.y - move.a.y);
        if (length < 1e-6 && move.b.z < move.a.z && move.b.z < 0) {
          if (stockTopAt(field, move.a) > move.b.z + 0.25) plungesIntoStock += 1;
        }
        const removedMm2 = carveMove(field, move, RADIUS_MM);
        const lateral = Math.abs(move.a.z - move.b.z) < 1e-6 && move.b.z < 0;
        // A full-width slot removes a strip as wide as the cutter.
        if (
          lateral &&
          move.feedMmPerMin === FEED_MM_PER_MIN &&
          length >= 0.5 &&
          removedMm2 / length >= 0.9 * TOOL.diameterMm
        )
          slotMm += length;
      }
      expect(plungesIntoStock).toBe(0);
      expect(slotMm).toBeLessThan(1);
      expect(uncutReachableStock(field, walls, RADIUS_MM, -DEPTH_MM).patches).toEqual([]);
    },
    ciBudgetMs(60_000, 180_000),
  );
});
