// ADR-154 Amendment 7 (CNC audit v3 AC-6, the maintainer's "Refuse slots at
// 50 %"): adaptive clearing never cuts a full-width slot at the cutting feed,
// whatever its Radial engagement. At 50 % the verifier read a slot as r, equal
// to the limit, and certified 92.5 mm of slot on an L and 22.4 mm on a 44 × 30
// rectangle.
//
// The oracle is the emitted program, carved into an independent height field
// (program-height-field.test-support.ts), and the width each stretch of path
// at the cutting feed removes is read from it.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { CncGroup } from '../job';
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
import { planAdaptivePocket } from './adaptive-pocket';
import { adaptivePocketPasses } from './adaptive-pocket-operation';
import { verifyAdaptivePocket } from './adaptive-pocket-verifier';
import { findCncAdaptivePocketIssues } from './cnc-adaptive-issues';
import { ADAPTIVE_SLOT_REFUSAL } from './cnc-strategy-fallback-notice';
import { collectLayerPolylines, compileCncJob } from './compile-cnc-job';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
} from './program-height-field.test-support';

const TOOL: CncTool = {
  id: 'em-6350-slots',
  name: '1/4" end mill',
  kind: 'end-mill',
  diameterMm: 6.35,
};
const CONFIG: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TOOL],
};
const HALF_LOAD_MM = TOOL.diameterMm / 2;
const DEPTH_MM = 3;
const FEED_MM_PER_MIN = 1000;
const PLUNGE_MM_PER_MIN = 300;

function loop(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

const RECTANGLE_44_X_30 = loop([
  [0, 0],
  [44, 0],
  [44, 30],
  [0, 30],
]);
const L_SHAPE = loop([
  [0, 0],
  [44, 0],
  [44, 16],
  [16, 16],
  [16, 44],
  [0, 44],
]);
const SQUARE_32 = loop([
  [0, 0],
  [32, 0],
  [32, 32],
  [0, 32],
]);

function scene(pocket: Polyline): Scene {
  return {
    objects: [
      {
        kind: 'imported-svg',
        id: 'pocket',
        source: 'pocket.svg',
        bounds: { minX: 0, minY: 0, maxX: 44, maxY: 44 },
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
          pocketStrategy: 'adaptive',
          toolId: TOOL.id,
          adaptiveOptimalLoadMm: HALF_LOAD_MM,
          depthMm: DEPTH_MM,
          depthPerPassMm: 1.5,
          feedMmPerMin: FEED_MM_PER_MIN,
          plungeMmPerMin: PLUNGE_MM_PER_MIN,
        },
      },
    ],
  };
}

/** Machine-space contours, as the compiler plans them. */
function machineContours(pocket: Polyline): ReadonlyArray<Polyline> {
  const target = scene(pocket);
  const layer = target.layers[0];
  if (layer === undefined) throw new Error('expected a layer');
  return collectLayerPolylines(target.objects, layer, DEFAULT_DEVICE_PROFILE);
}

// Each run of lateral moves at the cutting feed is read in windows of at least
// 1 mm of path: the width it cut is the area it lowered by a quarter
// millimetre or more over the window's length. A window at least 0.95 of the
// bit's diameter wide is a full-width slot (the N3 refuter's measure; a window,
// not a move, so a curved ring of short moves is read like a straight one).
const WINDOW_MM = 1;
const SLOT_WIDTH_SHARE = 0.95;

type CutWidths = {
  /** Path at the cutting feed in windows a full-width slot wide. */
  readonly slotMm: number;
  /** The widest window, mm. */
  readonly widestMm: number;
};

function cutWidths(gcode: string, pocket: Polyline): CutWidths {
  const walls = [
    pocket.points.map((point: Vec2) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE)),
  ];
  const field = createHeightField(walls, 0.05);
  let slotMm = 0;
  let windowMm = 0;
  let windowMm2 = 0;
  let widestMm = 0;
  const close = (): void => {
    const widthMm = windowMm >= WINDOW_MM ? windowMm2 / windowMm : 0;
    widestMm = Math.max(widestMm, widthMm);
    if (widthMm >= SLOT_WIDTH_SHARE * TOOL.diameterMm) slotMm += windowMm;
    windowMm = 0;
    windowMm2 = 0;
  };
  for (const move of parseProgramMoves(gcode)) {
    if (move.rapid) {
      close();
      continue;
    }
    const removedMm2 = carveMove(field, move, TOOL.diameterMm / 2);
    const lateral =
      Math.abs(move.a.z - move.b.z) < 1e-6 && move.b.z < 0 && move.feedMmPerMin === FEED_MM_PER_MIN;
    if (!lateral) {
      close();
      continue;
    }
    windowMm += Math.hypot(move.b.x - move.a.x, move.b.y - move.a.y);
    windowMm2 += removedMm2;
    if (windowMm >= WINDOW_MM) close();
  }
  close();
  return { slotMm, widestMm };
}

/** The adaptive plan's own program, emitted whether or not it is certified. */
function plannedAdaptiveGcode(contours: ReadonlyArray<Polyline>): string {
  const plan = planAdaptivePocket(contours, TOOL.diameterMm, HALF_LOAD_MM);
  if (!plan.ok) throw new Error(plan.reason);
  const passes = adaptivePocketPasses(
    {
      kind: 'ok',
      plan,
      verification: { ok: true, coverageRatio: 1, gridMm: 0.25, maxSimulatedEngagementMm: 0 },
    },
    [-1.5, -DEPTH_MM],
  );
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'pocket',
    toolDiameterMm: TOOL.diameterMm,
    feedMmPerMin: FEED_MM_PER_MIN,
    plungeMmPerMin: PLUNGE_MM_PER_MIN,
    spindleRpm: 12_000,
    spindleSpinupSec: 0,
    safeZMm: 3.81,
    passes,
  };
  return cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
}

describe('adaptive clearing at 50 % radial engagement (ADR-154 Amendment 7)', () => {
  // The L's own plan slots about 97 mm at F1000 (the N3 refuter measured
  // 92.5 mm); the rectangle's cuts 0.94 of the bit's width, its contact arc
  // over 170 degrees.
  it.each([
    ['a 44 x 30 rectangle', RECTANGLE_44_X_30, 0],
    ['an L', L_SHAPE, 50],
  ])(
    'refuses the plan for %s, whose program slots at the cutting feed',
    (_label, pocket, slotMm) => {
      const contours = machineContours(pocket);
      const planned = cutWidths(plannedAdaptiveGcode(contours), pocket);
      expect(planned.widestMm).toBeGreaterThan(0.9 * TOOL.diameterMm);
      expect(planned.slotMm).toBeGreaterThanOrEqual(slotMm);
      const plan = planAdaptivePocket(contours, TOOL.diameterMm, HALF_LOAD_MM);
      if (!plan.ok) throw new Error(plan.reason);
      expect(verifyAdaptivePocket(contours, TOOL.diameterMm, plan)).toMatchObject({
        ok: false,
        reason: ADAPTIVE_SLOT_REFUSAL,
      });
      // The compile cuts offset rings instead, and says so before Save.
      const target = scene(pocket);
      expect(
        compileCncJob(target, DEFAULT_DEVICE_PROFILE, CONFIG).cncCompilation?.strategyFallbacks,
      ).toEqual([{ layerId: 'L1', kind: 'adaptive-offset', reason: ADAPTIVE_SLOT_REFUSAL }]);
      expect(findCncAdaptivePocketIssues(target, DEFAULT_DEVICE_PROFILE, CONFIG)).toEqual([
        {
          layerId: 'L1',
          reason: expect.stringContaining("Adaptive can't open this pocket from one entry"),
          fallback: true,
        },
      ]);
    },
    ciBudgetMs(30_000, 90_000),
  );

  it(
    'still cuts a 32 mm square adaptively, with no full-width slot at the cutting feed',
    () => {
      const target = scene(SQUARE_32);
      expect(findCncAdaptivePocketIssues(target, DEFAULT_DEVICE_PROFILE, CONFIG)).toEqual([]);
      const job = compileCncJob(target, DEFAULT_DEVICE_PROFILE, CONFIG);
      expect(job.cncCompilation?.strategyFallbacks ?? []).toEqual([]);
      const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
      const cut = cutWidths(gcode, SQUARE_32);
      expect(cut.slotMm).toBe(0);
      expect(cut.widestMm).toBeLessThan(0.8 * TOOL.diameterMm);
    },
    ciBudgetMs(30_000, 90_000),
  );
});
