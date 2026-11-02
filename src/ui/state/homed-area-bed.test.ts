// R6-P2-3 (rolling audit v9): only a grblHAL bed widened to the controller's
// whole travel is offered its homed area, and only grblHAL's homed envelope
// warns at Frame (ADR-637 Amendment 5). Stock GRBL and FluidNC are unchanged.
import { describe, expect, it } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { bedCorrectionShift, bedWiderThanHomedArea, grblHalHomedEnvelope } from './homed-area-bed';
import type { NativeBedEvidence } from './native-bed-frame';

// The published A1 Pro `$$`: 363 x 273 of travel, homing on with force
// origin, X and Y toward their minimum, hard limits on and a 5 mm pull-off.
const A1_PRO_SETTINGS: ControllerSettingsSnapshot = {
  bedWidth: 363,
  bedHeight: 273,
  homingEnabled: true,
  homingDirectionMask: 3,
  homingForceSetOrigin: true,
  hardLimitsEnabled: true,
  homingPullOffMm: 5,
  softLimitsEnabled: false,
};

function evidence(kind: ControllerKind, patch: Partial<NativeBedEvidence> = {}): NativeBedEvidence {
  return {
    controllerSessionEpoch: 4,
    controllerSettings: A1_PRO_SETTINGS,
    controllerSettingsObservation: { sessionEpoch: 4, observedAt: 0 },
    activeControllerKind: kind,
    detectedControllerKind: kind,
    homingState: 'confirmed',
    ...patch,
  };
}

const widened: DeviceProfile = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, bedWidth: 363, bedHeight: 273 };

describe('bedWiderThanHomedArea', () => {
  it('names a grblHAL bed widened to the whole travel', () => {
    expect(bedWiderThanHomedArea(widened, evidence('grblhal'))).toEqual({
      bed: { widthMm: 363, heightMm: 273 },
      homedArea: { widthMm: 358, heightMm: 268 },
    });
  });

  it('leaves the preset bed, stock GRBL, FluidNC and an earlier session alone', () => {
    expect(bedWiderThanHomedArea(FALCON_A1_PRO_GRBLHAL_PROFILE, evidence('grblhal'))).toBeNull();
    expect(bedWiderThanHomedArea(widened, evidence('grbl-v1.1'))).toBeNull();
    expect(bedWiderThanHomedArea(widened, evidence('fluidnc'))).toBeNull();
    expect(
      bedWiderThanHomedArea(widened, evidence('grblhal', { controllerSessionEpoch: 5 })),
    ).toBeNull();
    // Hard limits off: grblHAL's envelope is the whole travel.
    const noHardLimits = { ...A1_PRO_SETTINGS, hardLimitsEnabled: false };
    expect(
      bedWiderThanHomedArea(widened, evidence('grblhal', { controllerSettings: noHardLimits })),
    ).toBeNull();
  });
});

describe('grblHalHomedEnvelope', () => {
  it('is the envelope after this session’s Home, without the jog margin', () => {
    expect(grblHalHomedEnvelope(evidence('grblhal'))).toEqual({
      minX: 0,
      maxX: 358,
      minY: 0,
      maxY: 268,
    });
    expect(grblHalHomedEnvelope(evidence('grblhal', { homingState: 'unknown' }))).toBeNull();
  });

  it('is never given for stock GRBL or FluidNC', () => {
    expect(grblHalHomedEnvelope(evidence('grbl-v1.1'))).toBeNull();
    expect(grblHalHomedEnvelope(evidence('fluidnc'))).toBeNull();
  });
});

describe('bedCorrectionShift', () => {
  const change = {
    bed: { widthMm: 363, heightMm: 273 },
    homedArea: { widthMm: 358, heightMm: 268 },
  };
  it('names the axis measured from the far edge', () => {
    expect(bedCorrectionShift('front-left', change)).toBe(
      'Artwork already placed moves 5 mm in machine Y.',
    );
    expect(bedCorrectionShift('rear-right', change)).toBe(
      'Artwork already placed moves 5 mm in machine X.',
    );
    expect(bedCorrectionShift('center', change)).toBe(
      'Artwork already placed moves 2.5 mm in machine X and 2.5 mm in machine Y.',
    );
    expect(bedCorrectionShift('rear-left', change)).toBe(
      'Artwork already placed keeps its machine position.',
    );
  });
});
