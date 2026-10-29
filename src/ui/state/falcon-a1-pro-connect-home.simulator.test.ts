// A Falcon A1 Pro as published, end to end: the `GrblHAL 1.1f` banner and the
// full `$$`, then a Home through the driver (rolling audit v8 N2-P2-1 and
// N2-P3-5; ADR-637 Amendment 4, ADR-322 Amendment 3).
//
// The firmware's travel is 363 x 273 mm, but with `$21=1 $22=43 $23=3 $27=5`
// grblHAL's homed envelope is 0..358 x 0..268, Creality's 358 x 268 mm area:
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139
// So a connect offers no bed change, Job Review's travel fact matches the
// preset, and a bed already widened to the travel still jogs no further than
// the envelope. Host command evidence only; no hardware was operated.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import {
  FALCON_A1_PRO_BANNER,
  FALCON_A1_PRO_DUMP,
} from '../../__fixtures__/controllers/falcon-a1-pro-dump';
import type { DeviceProfile } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { describePatch } from '../laser/DetectedSettingsBanner';
import {
  resetAnnouncedDetectedSettings,
  shouldAnnounceDetectedSettings,
} from '../laser/DetectedSettingsToast';
import { deviceProfileSignature } from '../laser/device-setup/device-setup-nudge';
import { buildControllerReviewFacts } from '../laser/job-review/job-review-live-rows';
import { dispatchPositionLaser } from '../workspace/position-laser-click';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { useLaserStore } from './laser-store';
import { resolveManualMotionLimits } from './manual-motion-limits';
import { resolveNativeBedFrame, selectNativeBedEvidence } from './native-bed-frame';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const PRESET_BED = { minX: 0, minY: 0, maxX: 358, maxY: 268 };
// A setting write, a work-offset read (grblHAL can rewrite a record it reads
// as corrupt), a sleep or a settings reset: none belongs to connect or Home.
const WRITE_LIKE = /^\$(?:\d+=|#|SLP|RST)/i;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  resetAnnouncedDetectedSettings();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  resetAnnouncedDetectedSettings();
  vi.restoreAllMocks();
});

describe('Falcon A1 Pro with its published banner and full $$', () => {
  it('connects without a bed offer, reviews travel in the plain tone and homes onto the preset bed', async () => {
    const device = useA1Pro();
    const port = await connectA1Pro(device);

    expect(port.outbound()).toContain('$$\n');
    expect(sentWrites(port)).toEqual([]);
    expect(port.outbound().some((line) => line.startsWith('$H'))).toBe(false);

    // The offer: the firmware's acceleration, and no bed change.
    const detected = useLaserStore.getState().detectedSettings;
    expect(detected).toMatchObject({ bedWidth: 358, bedHeight: 268, accelMmPerSec2: 1000 });
    const rows = describePatch(detected ?? {}, device).map((row) => row.label);
    expect(rows).toContain('Acceleration');
    expect(rows).not.toContain('Bed width');
    expect(rows).not.toContain('Bed height');
    expect(announces(device)).toBe(true);
    // The controller snapshot keeps the raw travel for the jog envelope.
    expect(useLaserStore.getState().controllerSettings).toMatchObject({
      bedWidth: 363,
      bedHeight: 273,
    });

    expect(travelFact(device)).toEqual({
      label: 'Travel $130 × $131',
      value: '363 × 273 mm, homed area 358 × 268 mm',
      tone: 'default',
    });

    await homeThroughDriver(port);
    expect(motionBox(device)).toEqual({ frame: PRESET_BED, limits: PRESET_BED });
    expect(sentWrites(port)).toEqual([]);

    // Use detected values takes the acceleration and keeps the preset bed.
    applyDetectedSettingsPatch(useLaserStore.getState().detectedSettings);
    expect(useStore.getState().project.device).toMatchObject({
      bedWidth: 358,
      bedHeight: 268,
      accelMmPerSec2: 1000,
    });
  });

  // 1.0.28 offered 363 x 273 at every connect; a profile that took it keeps
  // the wider bed until the operator takes the offer back.
  it('offers the homed area back to a bed widened to the travel and jogs no further than the envelope', async () => {
    const device = useA1Pro({ bedWidth: 363, bedHeight: 273 });
    const port = await connectA1Pro(device);

    const detected = useLaserStore.getState().detectedSettings ?? {};
    expect(describePatch(detected, device)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Bed width',
          oldText: '363.000 mm',
          newText: '358.000 mm',
        }),
        expect.objectContaining({
          label: 'Bed height',
          oldText: '273.000 mm',
          newText: '268.000 mm',
        }),
      ]),
    );
    expect(travelFact(device)).toEqual({
      label: 'Travel $130 × $131',
      value: '363 × 273 mm, homed area 358 × 268 mm — profile bed 363 × 273 mm',
      tone: 'warning',
    });

    await homeThroughDriver(port);
    expect(motionBox(device)).toEqual({
      frame: { minX: 0, minY: 0, maxX: 363, maxY: 273 },
      limits: PRESET_BED,
    });

    // Move laser here at the canvas's far X edge stops at the envelope. The
    // post-Home `$G` read and a fresh status report come first.
    await vi.advanceTimersByTimeAsync(600);
    port.emitLine(IDLE);
    await vi.advanceTimersByTimeAsync(5);
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 0, y: 0, z: 0 });
    dispatchPositionLaser({ x: 363, y: 200 }, device);
    await vi.advanceTimersByTimeAsync(5);
    const jog = port.outbound().find((line) => line.includes('G91'));
    expect(jog).toContain('G1 X358.000');
    expect(sentWrites(port)).toEqual([]);
  });
});

function useA1Pro(patch: Partial<DeviceProfile> = {}): DeviceProfile {
  useStore.getState().updateDeviceProfile({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, ...patch });
  return useStore.getState().project.device;
}

async function connectA1Pro(device: DeviceProfile) {
  const port = createFakeSerialPort();
  port.onOpen(() => setTimeout(() => port.emitLine(FALCON_A1_PRO_BANNER), 1));
  port.onWrite((data) => {
    if (data === '?') setTimeout(() => port.emitLine(IDLE), 1);
    if (data === '$$\n') {
      setTimeout(() => {
        for (const row of FALCON_A1_PRO_DUMP) port.emitLine(row);
        port.emitLine('ok');
      }, 1);
    }
    // Connect and a completed Home read the active WCS.
    if (data === '$G\n') {
      setTimeout(() => {
        port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        port.emitLine('ok');
      }, 1);
    }
  });
  await useLaserStore.getState().connect(port.adapter, connectOptionsForDevice(device));
  await vi.advanceTimersByTimeAsync(1100);
  expect(useLaserStore.getState().detectedControllerKind).toBe('grblhal');
  return port;
}

// The contract's Home: `$HX`, then `$HY`, each with its own acknowledgement,
// then the settle marker and a fresh Idle.
async function homeThroughDriver(port: ReturnType<typeof createFakeSerialPort>): Promise<void> {
  const home = useLaserStore.getState().home();
  await vi.advanceTimersByTimeAsync(1);
  expect(commandLines(port)).toEqual(['$HX\n']);
  port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(1);
  expect(commandLines(port)).toEqual(['$HX\n', '$HY\n']);
  port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(1);
  expect(port.outbound().at(-1)).toBe('G4 P0.01\n');
  port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(1);
  port.emitLine(IDLE);
  await vi.advanceTimersByTimeAsync(5);
  await home;
  expect(useLaserStore.getState().homingState).toBe('confirmed');
}

function commandLines(port: ReturnType<typeof createFakeSerialPort>): string[] {
  return port
    .outbound()
    .filter((line) => line.endsWith('\n') && line !== '$G\n' && line !== '$$\n');
}

function sentWrites(port: ReturnType<typeof createFakeSerialPort>): string[] {
  return port
    .outbound()
    .flatMap((data) => data.split('\n'))
    .filter((line) => WRITE_LIKE.test(line.trim()));
}

function announces(device: DeviceProfile): boolean {
  const laser = useLaserStore.getState();
  return shouldAnnounceDetectedSettings(deviceProfileSignature(device, 'laser'), {
    patch: laser.detectedSettings,
    current: device,
    controllerSettings: laser.controllerSettings,
    settingsRows: laser.grblSettingsRows,
  });
}

function travelFact(device: DeviceProfile) {
  const laser = useLaserStore.getState();
  const facts = buildControllerReviewFacts({
    isConnected: true,
    machineKind: 'laser',
    statusReport: laser.statusReport,
    alarmCode: laser.alarmCode,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
    controllerSettings: laser.controllerSettings,
    activeWcs: laser.activeWcs,
    overrides: laser.ovCache,
    profileMaxPowerS: device.maxPowerS,
    profileBedWidth: device.bedWidth,
    profileBedHeight: device.bedHeight,
  });
  return facts.find((fact) => fact.label === 'Travel $130 × $131');
}

function motionBox(device: DeviceProfile) {
  const evidence = selectNativeBedEvidence(useLaserStore.getState());
  const frame = resolveNativeBedFrame(device, evidence);
  return {
    frame: frame?.nativeBounds,
    limits: resolveManualMotionLimits(frame, evidence),
  };
}
