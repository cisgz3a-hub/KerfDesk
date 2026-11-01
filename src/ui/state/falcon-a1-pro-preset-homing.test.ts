// Rolling audit v6 K3-P2-1 and K3-P3-1 (ADR-322 Amendment 3): the Falcon A1
// Pro firmware homes ($22=43), so its preset does, and its vendor bed frame,
// Absolute preflight and jog limits apply after a Home; the contract reads $$.

import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import { settingsMapToControllerSettings } from '../../core/controllers/grbl/parse-settings';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { defaultJobPlacementForDevice, trustedMotionOffsetForPreflight } from '../job-placement';
import {
  captureLaserModeStartSnapshot,
  laserModeStartSnapshotIsVerified,
} from './laser-mode-start-evidence';
import { resolveManualMotionLimits } from './manual-motion-limits';
import { resolveNativeBedFrame, type NativeBedEvidence } from './native-bed-frame';

const preset = FALCON_A1_PRO_GRBLHAL_PROFILE;
const driver = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');

const homedEvidence: NativeBedEvidence = {
  homingState: 'confirmed',
  activeControllerKind: 'grblhal',
  activeControllerCommandSet: 'creality-falcon-a1-pro',
  detectedControllerKind: 'grblhal',
};

// The rows KerfDesk reads, as both published A1 Pro dumps give them
// (barebaric/rayforge PR #461; LightBurn forum topic 177926, post 3).
const A1_PRO_DUMP = new Map<number, string>([
  [10, '511'],
  [13, '0'],
  [20, '0'],
  [21, '1'],
  [22, '43'],
  [23, '3'],
  [27, '5.000'],
  [30, '1000.000'],
  [31, '0.000'],
  [32, '1'],
  [62, '0'],
  [110, '36000.000'],
  [111, '36000.000'],
  [120, '1000.000'],
  [121, '1000.000'],
  [130, '363.000'],
  [131, '273.000'],
]);

describe('Falcon A1 Pro preset homing (K3-P2-1)', () => {
  it('homes at the front left, as the firmware reports', () => {
    expect(preset.homing).toEqual({ enabled: true, direction: 'front-left' });
    expect(preset.kinematics).toBe('corexy');
    expect(settingsMapToControllerSettings(A1_PRO_DUMP)).toMatchObject({
      homingEnabled: true,
      homingDirectionMask: 3,
      softLimitsEnabled: false,
    });
    expect(driver.commands.home).toBe('$HX\n$HY');
  });

  it('starts from Absolute by default', () => {
    expect(defaultJobPlacementForDevice(preset).startFrom).toBe('absolute');
  });

  it('applies the vendor bed frame and jog limits once homed this session', () => {
    const frame = resolveNativeBedFrame(preset, homedEvidence);
    expect(frame?.nativeBounds).toEqual({ minX: 0, minY: 0, maxX: 358, maxY: 268 });
    expect(frame?.nativeToBedOffsetMm).toEqual({ x: 0, y: 0 });
    expect(resolveManualMotionLimits(frame ?? null, homedEvidence)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 358,
      maxY: 268,
    });
    // Before a Home this session, nothing is assumed.
    expect(resolveNativeBedFrame(preset, { ...homedEvidence, homingState: 'unknown' })).toBeNull();
  });

  it('checks an Absolute job against the bed instead of its size only', () => {
    expect(trustedMotionOffsetForPreflight(preset, { ok: true }, homedEvidence)).toEqual({
      x: 0,
      y: 0,
    });
    // The shipped preset before this change: no frame, so a size-only check.
    const homingOff = { ...preset, homing: { enabled: false, direction: 'front-left' as const } };
    expect(trustedMotionOffsetForPreflight(homingOff, { ok: true }, homedEvidence)).toBeUndefined();
  });
});

describe('Falcon A1 Pro settings read (K3-P3-1)', () => {
  it('verifies $30 and $32 from the $$ it reads at connect', () => {
    const snapshot = captureLaserModeStartSnapshot({
      controllerSessionEpoch: 4,
      capabilities: { settings: driver.capabilities.settings },
      controllerSettings: settingsMapToControllerSettings(A1_PRO_DUMP),
      controllerSettingsObservation: { sessionEpoch: 4, observedAt: 1000 },
    });
    expect(driver.capabilities.settings).toBe('grbl-dollar-read');
    expect(laserModeStartSnapshotIsVerified(snapshot, preset.maxPowerS)).toBe(true);
  });
});
