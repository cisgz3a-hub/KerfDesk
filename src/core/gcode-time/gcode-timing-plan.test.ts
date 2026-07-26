import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CncGroup, CutGroup, Job } from '../job';
import { cncGrblStrategy, grblStrategy } from '../output';
import {
  buildGcodeTimingPlan,
  plannedProgressAtRoute,
  plannedProgressAtSendableLine,
  plannedSecondsAtRoute,
} from './gcode-timing-plan';

const LIMITS = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};
const CUT_PATH = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
  { x: 10, y: 10 },
];

type LaserAirAssist = { readonly kind: 'enabled' } | { readonly kind: 'disabled' };

const AIR_ASSIST_ENABLED: LaserAirAssist = { kind: 'enabled' };
const AIR_ASSIST_DISABLED: LaserAirAssist = { kind: 'disabled' };

function cncGroup(spindleRpm: number): CncGroup {
  return {
    kind: 'cnc',
    layerId: `spindle-${spindleRpm}`,
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1_000,
    plungeMmPerMin: 300,
    spindleRpm,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [{ kind: 'contour', zMm: -1.5, polyline: CUT_PATH, closed: true }],
  };
}

function laserCutGroup(airAssistMode: LaserAirAssist): CutGroup {
  return {
    kind: 'cut',
    layerId: 'laser-cut',
    color: '#ff0000',
    power: 50,
    speed: 6_000,
    passes: 1,
    airAssist: airAssistMode.kind === 'enabled',
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
        ],
        closed: false,
      },
    ],
  };
}

function laserJob(): Job {
  return { groups: [laserCutGroup(AIR_ASSIST_DISABLED)] };
}

describe('buildGcodeTimingPlan — timeline totals', () => {
  it('times the exact program including a spindle spin-up dwell', () => {
    const result = buildGcodeTimingPlan(
      ['G21 G90', 'M3 S12000', 'G4 P4', 'G1 X60 F600'].join('\n'),
      LIMITS,
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.totalSeconds).toBeGreaterThan(10);
    expect(result.plan.totalSeconds).toBeLessThan(10.2);
    expect(result.plan.dwellSeconds).toBe(4);
    expect(result.plan.motionSeconds).toBeGreaterThan(6);
    expect(plannedSecondsAtRoute(result.plan, 30)).toBeGreaterThan(7);
    const routeProgress = plannedProgressAtRoute(result.plan, 30);
    expect(routeProgress.dwellSeconds).toBe(4);
    expect(routeProgress.totalSeconds).toBe(
      routeProgress.motionSeconds + routeProgress.dwellSeconds,
    );
    expect(plannedProgressAtSendableLine(result.plan, 3)).toEqual({
      motionSeconds: 0,
      dwellSeconds: 4,
      totalSeconds: 4,
    });
  });
});

describe('buildGcodeTimingPlan — emitted command boundaries', () => {
  it('includes every dwell emitted for CNC spindle start and RPM changes', () => {
    const gcode = cncGrblStrategy.emit(
      { groups: [cncGroup(12_000), cncGroup(8_000)] },
      DEFAULT_DEVICE_PROFILE,
    );
    const result = buildGcodeTimingPlan(gcode, LIMITS);

    expect(gcode.match(/^G4 P3\.000$/gmu)).toHaveLength(2);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.dwellSeconds).toBe(6);
    expect(result.plan.totalSeconds).toBeCloseTo(
      result.plan.motionSeconds + result.plan.dwellSeconds,
      9,
    );
    expectStoppedAcrossLastCommand(result.plan, gcode, 'M5');
  });

  it('stops lookahead across emitted laser shutdown and air-assist transitions', () => {
    const shutdownGcode = grblStrategy.emit(laserJob(), DEFAULT_DEVICE_PROFILE);
    const shutdown = buildGcodeTimingPlan(shutdownGcode, LIMITS);
    expect(shutdown.kind).toBe('ok');
    if (shutdown.kind !== 'ok') return;
    expectStoppedAcrossLastCommand(shutdown.plan, shutdownGcode, 'M5');

    const airDevice: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      airAssistCommand: 'M8',
    };
    const airGcode = grblStrategy.emit(
      {
        groups: [
          laserCutGroup(AIR_ASSIST_ENABLED),
          {
            ...laserCutGroup(AIR_ASSIST_DISABLED),
            layerId: 'dry-cut',
            segments: [
              {
                polyline: [
                  { x: 120, y: 10 },
                  { x: 220, y: 10 },
                ],
                closed: false,
              },
            ],
          },
        ],
      },
      airDevice,
    );
    const air = buildGcodeTimingPlan(airGcode, LIMITS);
    expect(air.kind).toBe('ok');
    if (air.kind !== 'ok') return;
    expectStoppedAcrossLastCommand(air.plan, airGcode, 'M9');
  });
});

describe('buildGcodeTimingPlan — position and route projection', () => {
  it('uses the real controller start position for the first emitted move', () => {
    const result = buildGcodeTimingPlan('G21 G90\nG0 X100', LIMITS, {
      x: 100,
      y: 0,
      z: 0,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.totalRouteMm).toBe(0);
    expect(result.plan.totalSeconds).toBe(0);
  });

  it('maps partial route through the planned acceleration profile', () => {
    const result = buildGcodeTimingPlan(
      'G21\nG90\nG1 X1000 F3000',
      {
        accelMmPerSec2: 50,
        junctionDeviationMm: 0.01,
        maxFeedMmPerMin: 6_000,
      },
      { x: 0, y: 0, z: 0 },
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.plan.motionSeconds).toBeCloseTo(21, 5);
    expect(plannedProgressAtRoute(result.plan, 50).motionSeconds).toBeCloseTo(1.5, 5);
  });
});

function expectStoppedAcrossLastCommand(
  plan: Extract<ReturnType<typeof buildGcodeTimingPlan>, { readonly kind: 'ok' }>['plan'],
  gcode: string,
  command: string,
): void {
  const commandLine = gcode.split(/\r\n|\n|\r/).lastIndexOf(command);
  expect(commandLine).toBeGreaterThanOrEqual(0);
  const before = [...plan.segmentRawLine].findLastIndex((line) => line < commandLine);
  const after = [...plan.segmentRawLine].findIndex((line) => line > commandLine);
  expect(before).toBeGreaterThanOrEqual(0);
  expect(after).toBeGreaterThan(before);
  expect(plan.segmentExitVelocityMmPerSec[before]).toBe(0);
  expect(plan.segmentEntryVelocityMmPerSec[after]).toBe(0);
}
