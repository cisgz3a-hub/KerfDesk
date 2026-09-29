// Writer 3 regressions from the independent output audit. These compare real
// emitter programs with a separate GRBL planner-drain model and kinematics.
import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CutGroup } from '../job';
import { grblStrategy } from '../output/grbl-strategy';
import { buildLaserSecondPassProgram } from './build-program';
import { simulateProgram } from './program-oracle.test-helper';
import type { LaserSecondPassSelection } from './types';

const PAINT_ALL: LaserSecondPassSelection = {
  version: 1,
  maxPowerS: 1000,
  strokes: [{ id: 'all', mode: 'paint', radiusMm: 100, powerScale: 1, points: [{ x: 20, y: 20 }] }],
};

function cut(layerId: string, x: number, airAssist: boolean, length = 10): CutGroup {
  return {
    kind: 'cut',
    layerId,
    color: '#000000',
    power: 60,
    speed: 1200,
    passes: 1,
    powerMode: 'constant',
    airAssist,
    segments: [
      {
        closed: false,
        polyline: [
          { x, y: 20 },
          { x: x + length, y: 20 },
        ],
      },
    ],
  };
}

describe('writer 3 keeps the original dark transition guarantees', () => {
  it.each(['M4G1X10000000000000008S300\nM5', 'M5'])(
    'falls back to a distinct source endpoint when bounded interpolation rounds away: %s',
    (tail) => {
      const source = `G21\nG90\nM3S0\nG0X10000000000000000Y0S0\nG1X10000000000000004F600S300\n${tail}\n`;
      const derived = buildLaserSecondPassProgram(source, {
        ...PAINT_ALL,
        strokes: [{ ...PAINT_ALL.strokes[0]!, points: [{ x: 10000000000000004, y: 0 }] }],
      });
      if (derived.kind !== 'ready') throw new Error(derived.message);
      expect(
        findM3LitPlannerDrains(derived.gcode + '\nM3S0\nG1X100F600S100\nM5\n'),
        derived.gcode,
      ).toEqual([]);
    },
  );
  it.each([
    ['M7', false, 20],
    ['M7', true, 30],
    ['M8', false, 30],
    ['M8', true, 20],
  ] as const)(
    '%s air transition, first air=%s, next start=%s never drains a lit M3 beam',
    (airAssistCommand, firstAir, nextStart) => {
      const source = grblStrategy.emit(
        { groups: [cut('first', 10, firstAir), cut('second', nextStart, !firstAir)] },
        { ...DEFAULT_DEVICE_PROFILE, airAssistCommand },
        { finishPosition: null },
      );
      expect(findM3LitPlannerDrains(source), source).toEqual([]);
      const derived = buildLaserSecondPassProgram(source, PAINT_ALL);
      if (derived.kind !== 'ready') throw new Error(derived.message);
      expect(
        findM3LitPlannerDrains(derived.gcode),
        `SOURCE:\n${source}\nDERIVED:\n${derived.gcode}`,
      ).toEqual([]);
    },
  );

  it('keeps a coincident mode-change darkening excursion from the original program', () => {
    const first = cut('first', 10, false);
    const second = { ...cut('second', 20, false), powerMode: 'dynamic' as const };
    const source = grblStrategy.emit(
      { groups: [first, second] },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' },
      { finishPosition: null },
    );
    expect(findM3LitPlannerDrains(source), source).toEqual([]);
    const derived = buildLaserSecondPassProgram(source, PAINT_ALL);
    if (derived.kind !== 'ready') throw new Error(derived.message);
    expect(
      findM3LitPlannerDrains(derived.gcode),
      `SOURCE:\n${source}\nDERIVED:\n${derived.gcode}`,
    ).toEqual([]);
  });

  it('never uses an opposing short cut endpoint as a coincident dark excursion', () => {
    const source = grblStrategy.emit(
      {
        groups: [
          cut('first', 10, false),
          { ...cut('second', 19.5, false, 0.5), powerMode: 'dynamic' },
        ],
      },
      DEFAULT_DEVICE_PROFILE,
      { finishPosition: null },
    );
    expect(findM3LitPlannerDrains(source), source).toEqual([]);
    const derived = buildLaserSecondPassProgram(source, PAINT_ALL);
    if (derived.kind !== 'ready') throw new Error(derived.message);
    expect(findM3LitPlannerDrains(derived.gcode), derived.gcode).toEqual([]);
    expect(derived.gcode).toContain('G0X19.5Y20S0\nM5\nM4 S0');
    expect(derived.motionBounds).toEqual({ minX: 10, maxX: 20, minY: 20, maxY: 20 });
  });

  it('uses controlled dark motion for a coincident mode transition', () => {
    const source = grblStrategy.emit(
      { groups: [cut('first', 10, false), { ...cut('second', 20, true), powerMode: 'dynamic' }] },
      {
        ...DEFAULT_DEVICE_PROFILE,
        airAssistCommand: 'M8',
        controlledLaserOffTravelFeedMmPerMin: 800,
      },
      { finishPosition: null },
    );
    const derived = buildLaserSecondPassProgram(source, PAINT_ALL);
    if (derived.kind !== 'ready') throw new Error(derived.message);
    expect(findM3LitPlannerDrains(derived.gcode), derived.gcode).toEqual([]);
    expect(derived.gcode).not.toMatch(/^G0/m);
  });

  it('darkens before a mode change combined with the next source motion', () => {
    const source = 'G21\nG90\nM3S0\nG0X10Y20S0\nG1X20F1200S600\nM4G1X30S600\nM5\n';
    const derived = buildLaserSecondPassProgram(source, PAINT_ALL);
    if (derived.kind !== 'ready') throw new Error(derived.message);
    expect(findM3LitPlannerDrains(derived.gcode), derived.gcode).toEqual([]);
    expect(
      simulateProgram(derived.gcode)
        .filter((move) => move.power > 0)
        .map((move) => move.mode),
    ).toEqual([3, 4]);
  });
  it.each([10, 0.5])(
    'darkens before final M5 within the last %s mm edge and keeps the endpoint',
    (length) => {
      const source = grblStrategy.emit(
        { groups: [cut('final', 10, false, length)] },
        DEFAULT_DEVICE_PROFILE,
        { finishPosition: null },
      );
      const result = buildLaserSecondPassProgram(source, PAINT_ALL);
      if (result.kind !== 'ready') throw new Error(result.message);
      // The checker deliberately excludes ordinary job endings. Append a
      // later probe burn solely so it inspects this program's final M5 too.
      const includeFinalDrain = (program: string) => program + '\nM3S0\nG1X100F600S100\nM5\n';
      expect(findM3LitPlannerDrains(includeFinalDrain(source))).not.toEqual([]);
      expect(findM3LitPlannerDrains(includeFinalDrain(result.gcode)), result.gcode).toEqual([]);
      const moves = simulateProgram(result.gcode);
      expect(moves.at(-1)?.to).toEqual({ x: 10 + length, y: 20 });
      expect(moves.slice(-2).every((move) => move.power === 0)).toBe(true);
      expect(result.motionBounds).toEqual({ minX: 10, maxX: 10 + length, minY: 20, maxY: 20 });
      expect(result.burnLengthMm).toBe(length);
    },
  );
});

it('retains original attainable speed inside a short-overscan row', () => {
  const source = grblStrategy.emit(
    {
      groups: [
        {
          kind: 'raster',
          layerId: 'photo',
          color: '#000000',
          power: 60,
          speed: 6000,
          passes: 1,
          airAssist: false,
          pixelWidth: 100,
          pixelHeight: 1,
          sValues: new Uint16Array(100).fill(600),
          bounds: { minX: 20, maxX: 120, minY: 20, maxY: 21 },
          overscanMm: 1,
          dotWidthCorrectionMm: 0,
        },
      ],
    },
    {
      ...DEFAULT_DEVICE_PROFILE,
      maxFeed: 6000,
      accelMmPerSec2: 500,
      gcodeDialect: { dialectId: 'grbl-compatible' },
    },
    { finishPosition: null },
  );
  const selection: LaserSecondPassSelection = {
    ...PAINT_ALL,
    strokes: [
      { id: 'spot', mode: 'paint', powerScale: 1, radiusMm: 1, points: [{ x: 70, y: 20.5 }] },
    ],
  };
  const result = buildLaserSecondPassProgram(source, selection);
  if (result.kind !== 'ready') throw new Error(result.message);
  const sourceFeed = simulateProgram(source).filter((motion) => !motion.rapid);
  const secondFeed = simulateProgram(result.gcode).filter((motion) => !motion.rapid);
  // Independent one-axis kinematic bound, with rest at each row end:
  // v(x) = min(commanded feed, sqrt(2 a distance from either end)).
  // 100 mm/s at the source centre; only sqrt(2000) in the shortened sweep.
  const speedAt = (moves: typeof sourceFeed, x: number) =>
    Math.min(
      100,
      Math.sqrt(2 * 500 * (x - moves[0]!.from.x)),
      Math.sqrt(2 * 500 * (moves.at(-1)!.to.x - x)),
    );
  expect(sourceFeed.some((move) => move.mode === 3 && move.power === 600)).toBe(true);
  expect(speedAt(sourceFeed, 70)).toBe(100);
  expect(speedAt(secondFeed, 70), `SOURCE:\n${source}\nDERIVED:\n${result.gcode}`).toBe(100);
});
