import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildProgramTimeline } from './program-timeline';
import { deviceProgramTimingOptions } from './program-timing-options';

const LIMITS = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

const CASES = [
  {
    name: 'Smoothieware proportional power and fire-off',
    controllerKind: 'smoothieware',
    dialectId: undefined,
    program: [
      'fire off',
      'G21 G90',
      'M221 S100 P0',
      'G1 X100 F6000 S0.25',
      'M400',
      'M221 S50 R10000',
      'G1 X200',
      'M400',
      'M221 S0',
      'G1 X300 S0.5',
      'M400',
      'M221 S100 P1',
      'G1 X400',
      'M400',
    ],
    scales: [2, 2, 3, 2],
    cut: 7.2,
    travel: 3.6,
  },
  {
    name: 'Marlin fan power independent of inline S words',
    controllerKind: 'marlin',
    dialectId: 'marlin-fan',
    program: [
      'G21 G90',
      'M106',
      'G1 X100 F6000',
      'M400',
      'M107',
      'G1 X200 S128',
      'M400',
      'M106 S0',
      'G1 X300',
      'M400',
    ],
    scales: [2, 3, 3],
    cut: 2.4,
    travel: 7.2,
  },
  {
    name: 'default Marlin inline power independent of auxiliary fan commands',
    controllerKind: 'marlin',
    dialectId: undefined,
    program: [
      'G21 G90',
      'M3 I S100',
      'M107',
      'G1 X100 F6000',
      'M400',
      'M5 I',
      'M106 S255',
      'G1 X300',
      'M400',
    ],
    scales: [2, 3],
    cut: 2.4,
    travel: 6.6,
  },
] as const;

describe('native controller timing context', () => {
  it.each(CASES)('calibrates $name from the artifact device', (fixture) => {
    const defaults = { ...DEFAULT_DEVICE_PROFILE };
    // Exercise older persisted profiles that predate an explicit dialect selection.
    Reflect.deleteProperty(defaults, 'gcodeDialect');
    const device: DeviceProfile = {
      ...defaults,
      controllerKind: fixture.controllerKind,
      ...(fixture.dialectId === undefined
        ? {}
        : { gcodeDialect: { dialectId: fixture.dialectId } }),
      estimateCutTimeScale: 2,
      estimateTravelTimeScale: 3,
    };
    const result = buildProgramTimeline(fixture.program.join('\n'), LIMITS, {
      ...deviceProgramTimingOptions(device, 'laser'),
      initialPositionMm: { x: 0, y: 0, z: 0 },
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    // M400 separates each leg. At 100 mm/s with 500 mm/s² acceleration,
    // a stopped leg takes distance / 100 + 100 / 500 before calibration.
    expect(Array.from(result.timeline.segmentTimeScale)).toEqual(fixture.scales);
    expect(result.timeline.breakdown.cutSeconds).toBeCloseTo(fixture.cut, 5);
    expect(result.timeline.breakdown.feedTravelSeconds).toBeCloseTo(fixture.travel, 5);
    expect(result.timeline.breakdown.rapidTravelSeconds).toBe(0);
    expect(result.timeline.motionSeconds).toBeCloseTo(fixture.cut + fixture.travel, 5);
    expect(result.timeline.dwellSeconds).toBe(0);
  });
});
