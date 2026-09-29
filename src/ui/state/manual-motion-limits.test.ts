// How far hold-to-jog and Move laser here may travel (ADR-375). The firmware
// envelope comes from this session's `$$` whether or not a bed frame is
// verified: stock GRBL checks every jog target against it once `$20=1`,
// homed or not (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L37),
// and grblHAL only on homed axes
// (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L686-L699).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { firmwareJogCheckPosition, resolveManualMotionLimits } from './manual-motion-limits';
import { resolveNativeBedFrame, type NativeBedEvidence } from './native-bed-frame';
import { stockNativeEvidence } from './native-bed-frame.test-support';

const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 400,
  bedHeight: 300,
  homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
};
const HOMING_OFF_DEVICE = { ...DEVICE, homing: { ...DEVICE.homing, enabled: false } };

/** Current-session stock GRBL 1.1h: $20=1 $21=1 $23=0 $27=2 $100=$101=250 $130=400 $131=300. */
function softLimitedGrbl(patch: Partial<NativeBedEvidence> = {}): NativeBedEvidence {
  const base = stockNativeEvidence(DEVICE, false, 0);
  return {
    ...base,
    controllerSettings: {
      ...base.controllerSettings,
      softLimitsEnabled: true,
      hardLimitsEnabled: true,
      homingPullOffMm: 2,
      stepsPerMmX: 250,
      stepsPerMmY: 250,
    },
    ...patch,
  };
}

function limitsFor(device: typeof DEVICE, evidence: NativeBedEvidence) {
  return resolveManualMotionLimits(resolveNativeBedFrame(device, evidence), evidence);
}

const GRBL_LIMITS = { minX: -399.99, maxX: -2.01, minY: -299.99, maxY: -2.01 };

describe('manual-motion limits without a verified bed frame', () => {
  it('bounds a profile with homing off by the firmware envelope once $20=1 was read', () => {
    const evidence = softLimitedGrbl();
    expect(resolveNativeBedFrame(HOMING_OFF_DEVICE, evidence)).toBeNull();
    expect(limitsFor(HOMING_OFF_DEVICE, evidence)).toEqual(GRBL_LIMITS);
  });

  it('applies on stock GRBL whatever the homing state, since soft limits are always checked', () => {
    expect(limitsFor(HOMING_OFF_DEVICE, softLimitedGrbl({ homingState: 'unknown' }))).toEqual(
      GRBL_LIMITS,
    );
  });

  it.each<[string, Partial<NativeBedEvidence>]>([
    [
      'soft limits off',
      { controllerSettings: { ...softLimitedGrbl().controllerSettings, softLimitsEnabled: false } },
    ],
    ['no $$ this session', { controllerSettings: null, controllerSettingsObservation: null }],
    [
      '$$ from an earlier session',
      { controllerSettingsObservation: { sessionEpoch: 6, observedAt: 1 } },
    ],
    ['no travel read', { controllerSettings: { softLimitsEnabled: true, homingDirectionMask: 0 } }],
    ['a FluidNC banner', { detectedControllerKind: 'fluidnc' }],
    ['a vendor command set', { activeControllerCommandSet: 'creality-falcon-a1-pro' }],
    ['a Marlin profile', { activeControllerKind: 'marlin', detectedControllerKind: null }],
  ])('keeps the full-travel hold with %s', (_name, patch) => {
    expect(limitsFor(HOMING_OFF_DEVICE, softLimitedGrbl(patch))).toBeNull();
  });

  it('needs $I force-origin evidence for a negative-homing axis', () => {
    const base = softLimitedGrbl();
    const settings = { ...base.controllerSettings, homingDirectionMask: 3 };
    expect(limitsFor(HOMING_OFF_DEVICE, { ...base, controllerSettings: settings })).toEqual({
      minX: -397.99,
      maxX: -0.01,
      minY: -297.99,
      maxY: -0.01,
    });
    const staleBuild = { controllerBuildInfoObservation: { sessionEpoch: 6, observedAt: 1 } };
    expect(
      limitsFor(HOMING_OFF_DEVICE, { ...base, controllerSettings: settings, ...staleBuild }),
    ).toBeNull();
  });

  it('bounds grblHAL only after this session homed it, pulled in on both edges', () => {
    const grblHal = {
      activeControllerKind: 'grblhal' as const,
      detectedControllerKind: 'grblhal' as const,
    };
    expect(
      limitsFor(HOMING_OFF_DEVICE, softLimitedGrbl({ ...grblHal, homingState: 'unknown' })),
    ).toBeNull();
    expect(limitsFor(HOMING_OFF_DEVICE, softLimitedGrbl(grblHal))).toEqual({
      minX: -397.99,
      maxX: -2.01,
      minY: -297.99,
      maxY: -2.01,
    });
  });

  it('keeps half a step of room on a coarse axis from this session $100', () => {
    const base = softLimitedGrbl();
    const coarse = { ...base.controllerSettings, stepsPerMmX: 40 };
    const limits = limitsFor(HOMING_OFF_DEVICE, { ...base, controllerSettings: coarse });
    expect(limits?.minX).toBeCloseTo(-399.9855, 9);
    expect(limits?.minY).toBe(-299.99);
  });

  it('treats a GrblHAL banner behind a GRBL profile as grblHAL', () => {
    const evidence = softLimitedGrbl({ detectedControllerKind: 'grblhal', homingState: 'unknown' });
    expect(limitsFor(HOMING_OFF_DEVICE, evidence)).toBeNull();
  });
});

describe('manual-motion limits with a verified bed frame', () => {
  it('keeps the homing edge the pull-off clear of the switch', () => {
    const evidence = softLimitedGrbl();
    expect(resolveNativeBedFrame(DEVICE, evidence)?.nativeBounds).toEqual({
      minX: -400,
      maxX: 0,
      minY: -300,
      maxY: 0,
    });
    expect(limitsFor(DEVICE, evidence)).toEqual(GRBL_LIMITS);
  });

  it('insets the switch edge even with soft limits off, and not with hard limits off', () => {
    const base = softLimitedGrbl();
    const softOff = { ...base.controllerSettings, softLimitsEnabled: false };
    expect(limitsFor(DEVICE, { ...base, controllerSettings: softOff })).toEqual({
      minX: -400,
      maxX: -2,
      minY: -300,
      maxY: -2,
    });
    const bothOff = { ...softOff, hardLimitsEnabled: false };
    expect(limitsFor(DEVICE, { ...base, controllerSettings: bothOff })).toEqual({
      minX: -400,
      maxX: 0,
      minY: -300,
      maxY: 0,
    });
  });

  it('uses the Falcon vendor frame as is, since that contract reads no settings', () => {
    const falcon = {
      ...DEVICE,
      controllerKind: 'grblhal' as const,
      controllerCommandSet: 'creality-falcon-a1-pro' as const,
    };
    const evidence: NativeBedEvidence = {
      controllerSessionEpoch: 3,
      homingState: 'confirmed',
      activeControllerKind: 'grblhal',
      activeControllerCommandSet: 'creality-falcon-a1-pro',
      detectedControllerKind: null,
      controllerSettings: null,
    };
    expect(limitsFor(falcon, evidence)).toEqual({ minX: 0, maxX: 400, minY: 0, maxY: 300 });
    // Its banner can read as stock GRBL (audit HF-8), and a Console `$$` can
    // report soft limits; neither brings a `$J=` envelope to a vendor contract.
    const consoleSettings = softLimitedGrbl().controllerSettings ?? null;
    for (const detectedControllerKind of ['grbl-v1.1', 'grblhal'] as const) {
      expect(
        limitsFor(falcon, {
          ...evidence,
          detectedControllerKind,
          controllerSettings: consoleSettings,
          controllerSettingsObservation: { sessionEpoch: 3, observedAt: 1 },
        }),
      ).toEqual({ minX: 0, maxX: 400, minY: 0, maxY: 300 });
    }
  });

  it('keeps a frame the firmware box does not overlap', () => {
    const frame = {
      nativeBounds: { minX: 0, maxX: 400, minY: 0, maxY: 300 },
      nativeToBedOffsetMm: { x: 0, y: 0 },
    };
    expect(resolveManualMotionLimits(frame, softLimitedGrbl())).toEqual(frame.nativeBounds);
  });
});

// After an Unlock without Home KerfDesk hides the reported position, yet $X
// leaves GRBL's own position as it was
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L168)
// and every jog target is still checked against it once $20=1.
describe('the hidden controller MPos a hold is aimed from', () => {
  const hidden = { x: -50, y: -40, z: 0 };

  it('is the firmware position in mm on stock GRBL enforcing soft limits this session', () => {
    expect(
      firmwareJogCheckPosition(softLimitedGrbl({ homingState: 'unknown' }), hidden, false),
    ).toEqual({ x: -50, y: -40 });
    expect(firmwareJogCheckPosition(softLimitedGrbl(), { x: -2, y: -1, z: 0 }, true)).toEqual({
      x: -50.8,
      y: -25.4,
    });
  });

  it.each<[string, Partial<NativeBedEvidence>]>([
    [
      'soft limits off',
      { controllerSettings: { ...softLimitedGrbl().controllerSettings, softLimitsEnabled: false } },
    ],
    [
      '$$ from an earlier session',
      { controllerSettingsObservation: { sessionEpoch: 6, observedAt: 1 } },
    ],
    ['grblHAL', { activeControllerKind: 'grblhal', detectedControllerKind: 'grblhal' }],
    ['a vendor command set', { activeControllerCommandSet: 'creality-falcon-a1-pro' }],
  ])('is not used with %s', (_name, patch) => {
    expect(firmwareJogCheckPosition(softLimitedGrbl(patch), hidden, false)).toBeNull();
  });

  it('is absent when the report carried no MPos ($10=0 or unconfirmed units)', () => {
    expect(firmwareJogCheckPosition(softLimitedGrbl(), null, false)).toBeNull();
    expect(firmwareJogCheckPosition(softLimitedGrbl(), undefined, false)).toBeNull();
  });
});
