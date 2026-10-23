// CNC audit v1 F2-P2-2 (ADR-153 Amendment 1) through the real compiler and
// emitter: above 50% stepover the rest ladder left a full-depth fin along the
// middle of a rest slot. The two-tool program is measured by an independent
// height field (program-height-field.test-support.ts), each section at its
// own cutter radius.

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
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
  uncutReachableStock,
} from './program-height-field.test-support';

const ROUGH_RADIUS_MM = 9.525 / 2;
const FINISH_RADIUS_MM = 3.175 / 2;
const DEPTH_MM = 3;

// A 40 mm square with an arm the 9.525 mm rougher cannot enter.
function squareWithArm(armWidthMm: number): Polyline {
  const low = 20 - armWidthMm / 2;
  const high = 20 + armWidthMm / 2;
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: low },
      { x: 80, y: low },
      { x: 80, y: high },
      { x: 40, y: high },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
  };
}

function restScene(pocket: Polyline, settings: Partial<CncLayerSettings>): Scene {
  return {
    objects: [
      {
        kind: 'imported-svg',
        id: 'pocket',
        source: 'pocket.svg',
        bounds: { minX: 0, minY: 0, maxX: 80, maxY: 40 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: [pocket] }],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'pocket',
          pocketStrategy: 'offset',
          toolId: 'em-3175',
          pocketRoughToolId: 'em-9525',
          depthMm: DEPTH_MM,
          depthPerPassMm: 1.5,
          ...settings,
        },
      },
    ],
  };
}

// Reachable stock the program leaves: the rougher's section, then the
// finishing section after the M0 tool change.
function uncutAfterRest(pocket: Polyline, settings: Partial<CncLayerSettings>): number {
  const job = compileCncJob(
    restScene(pocket, settings),
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const moves = parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
  const sections = [...new Set(moves.map((move) => move.section))];
  expect(sections).toHaveLength(2);
  const walls = [pocket.points.map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE))];
  const field = createHeightField(walls, 0.1);
  for (const move of moves) {
    if (move.rapid) continue;
    carveMove(field, move, move.section === sections[0] ? ROUGH_RADIUS_MM : FINISH_RADIUS_MM);
  }
  return uncutReachableStock(field, walls, FINISH_RADIUS_MM, -DEPTH_MM).totalMm2;
}

const STOCK_AWARE: Partial<CncLayerSettings> = {
  pocketRestStock: {
    kind: 'rough-stage-stock',
    previousToolId: 'em-9525',
    previousToolDiameterMm: 9.525,
    toleranceMm: 0.01,
  },
};

describe('rest pocket ladders above 50% stepover', () => {
  it.each([
    // An 8 mm arm leaves a 4.8 mm rest slot: one ring at 85% swept 3.175 mm
    // from each side and left a 58.9 mm^2 fin (60.8 mm^2 stock-aware).
    ['legacy rest, 85%, 8 mm arm', 8, { stepoverPercent: 85 }],
    ['stock-aware rest, 85%, 8 mm arm', 8, { stepoverPercent: 85, ...STOCK_AWARE }],
    // 7.36 mm^2 at 60% in a 6.6 mm arm.
    ['legacy rest, 60%, 6.6 mm arm', 6.6, { stepoverPercent: 60 }],
    ['stock-aware rest, 60%, 6.6 mm arm', 6.6, { stepoverPercent: 60, ...STOCK_AWARE }],
  ] as const)(
    '%s leaves no reachable stock standing',
    (_name, armWidthMm, settings) => {
      expect(uncutAfterRest(squareWithArm(armWidthMm), settings)).toBe(0);
    },
    ciBudgetMs(60_000, 180_000),
  );
});
