// A homed grblHAL earns a bed mapping from its own `$$` (annoyance audit A2
// B3-P2-2, ADR-322 Amendment 4), and only from that evidence. The oracle below
// is written from grblHAL's limits_set_work_envelope, not from KerfDesk's
// envelope model:
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139
import { describe, expect, it } from 'vitest';
import { grblHalSettingsMap } from '../../__fixtures__/controllers/grblhal-settings-dump';
import { settingsMapToControllerSettings } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { bedPointToNative, nativePointToBed } from '../../core/devices/native-bed-frame';
import {
  nativeBedFrameStatus,
  resolveNativeBedFrame,
  type NativeBedEvidence,
} from './native-bed-frame';

const TRAVEL = { x: 400, y: 300 };
const PULL_OFF = 2;
// grblHAL's defaults: Z in the first pass, X and Y in the second.
const HOMING_PASSES = { 44: '4', 45: '3' };

function device(widthMm: number, heightMm: number, patch: Partial<DeviceProfile> = {}) {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'grblhal' as const,
    bedWidth: widthMm,
    bedHeight: heightMm,
    homing: { enabled: true, direction: 'front-left' as const },
    ...patch,
  };
}

function homedGrblHal(
  settings: Readonly<Record<number, string>> = {},
  patch: Partial<NativeBedEvidence> = {},
): NativeBedEvidence {
  return {
    controllerSessionEpoch: 7,
    homingState: 'confirmed',
    activeControllerKind: 'grblhal',
    detectedControllerKind: 'grblhal',
    activeControllerCommandSet: null,
    controllerSettings: settingsMapToControllerSettings(
      grblHalSettingsMap({ ...HOMING_PASSES, ...settings }),
    ),
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    controllerBuildInfo: null,
    controllerBuildInfoObservation: null,
    ...patch,
  };
}

/** grblHAL's own envelope for one axis, from machine_limits.c. `maxTravel` is
 * stored negative; `homesNegative` is the axis's `$23` bit. */
function firmwareEnvelope(
  travel: number,
  hardLimits: boolean,
  forceOrigin: boolean,
  homesNegative: boolean,
) {
  const maxTravel = -travel;
  const pulloff = hardLimits ? PULL_OFF : 0;
  if (!forceOrigin) return { min: maxTravel + pulloff, max: 0 - pulloff };
  return homesNegative
    ? { min: 0, max: 0 - (maxTravel + pulloff) }
    : { min: maxTravel + pulloff, max: 0 };
}

describe('a homed grblHAL maps the bed onto its homed envelope', () => {
  for (const hardLimits of [true, false])
    for (const forceOrigin of [false, true]) {
      it.each([0, 1, 2, 3])(
        `hard limits ${String(hardLimits)}, force origin ${String(forceOrigin)}, homing direction mask %i`,
        (mask) => {
          const x = firmwareEnvelope(TRAVEL.x, hardLimits, forceOrigin, (mask & 1) !== 0);
          const y = firmwareEnvelope(TRAVEL.y, hardLimits, forceOrigin, (mask & 2) !== 0);
          const bed = device(x.max - x.min, y.max - y.min);
          const frame = resolveNativeBedFrame(
            bed,
            homedGrblHal({
              21: hardLimits ? '1' : '0',
              22: forceOrigin ? '9' : '1',
              23: String(mask),
              27: PULL_OFF.toFixed(3),
            }),
          );
          expect(frame?.nativeBounds).toEqual({
            minX: x.min,
            maxX: x.max,
            minY: y.min,
            maxY: y.max,
          });
          if (frame == null) throw new Error('expected a frame');
          // The bed's own minimum corner sits on the envelope's minimum corner,
          // and the homing direction never reflects an axis.
          const native = { x: x.min + 50, y: y.min + 30 };
          expect(nativePointToBed(native, frame)).toEqual({ x: 50, y: 30 });
          expect(bedPointToNative({ x: 51, y: 32 }, frame)).toEqual({
            x: native.x + 1,
            y: native.y + 2,
          });
        },
      );
    }

  it('gives the 396 x 296 mm area Machine Setup offers for the fixture dump', () => {
    const status = nativeBedFrameStatus(device(396, 296), homedGrblHal());
    expect(status.reason).toBeNull();
    expect(status.frame?.nativeBounds).toEqual({ minX: -398, maxX: -2, minY: -298, maxY: -2 });
  });
});

describe('the mapping resolves only on that evidence', () => {
  const bed = device(396, 296);

  it.each<[string, NativeBedEvidence, string]>([
    ['no Home in this connection', homedGrblHal({}, { homingState: 'unknown' }), 'not-homed'],
    ['a Home still running', homedGrblHal({}, { homingState: 'homing' }), 'not-homed'],
    [
      'settings read in an earlier connection',
      homedGrblHal({}, { controllerSettingsObservation: { sessionEpoch: 6, observedAt: 1 } }),
      'settings-unread',
    ],
    ['no settings read', homedGrblHal({}, { controllerSettings: null }), 'settings-unread'],
    ['no greeting seen', homedGrblHal({}, { detectedControllerKind: null }), 'settings-unread'],
    ['homing off on the controller', homedGrblHal({ 22: '0' }), 'report-incomplete'],
  ])('%s gives no mapping', (_label, evidence, reason) => {
    const status = nativeBedFrameStatus(bed, evidence);
    expect(status.frame).toBeNull();
    expect(status.reason?.kind).toBe(reason);
  });

  it('gives no mapping when a homing pass does not cover both X and Y', () => {
    // Only X is homed: grblHAL keeps no envelope for Y at all.
    const yUnhomed = nativeBedFrameStatus(bed, homedGrblHal({ 44: '4', 45: '1' }));
    expect(yUnhomed).toEqual({ frame: null, reason: { kind: 'report-incomplete' } });
    const split = nativeBedFrameStatus(bed, homedGrblHal({ 44: '1', 45: '2' }));
    expect(split.frame).not.toBeNull();
  });

  it.each<[string, ReadonlyArray<number>]>([
    ['the homing passes', [44, 45]],
    ['hard limits', [21]],
    ['the pull-off', [27]],
    ['the homing direction', [23]],
    ['a travel', [131]],
  ])('gives no mapping when the dump leaves out %s', (_label, missing) => {
    const map = grblHalSettingsMap(HOMING_PASSES);
    for (const id of missing) map.delete(id);
    const evidence = homedGrblHal({}, { controllerSettings: settingsMapToControllerSettings(map) });
    expect(nativeBedFrameStatus(bed, evidence)).toEqual({
      frame: null,
      reason: { kind: 'report-incomplete' },
    });
  });

  it('gives no mapping to a build whose $22 does not report force origin', () => {
    // COMPATIBILITY_LEVEL above 1 prints $22 as 0 or 1 and lists no $384.
    const map = grblHalSettingsMap(HOMING_PASSES);
    map.delete(384);
    const evidence = homedGrblHal({}, { controllerSettings: settingsMapToControllerSettings(map) });
    expect(nativeBedFrameStatus(bed, evidence).reason?.kind).toBe('report-incomplete');
  });

  it('gives no mapping when the profile bed is not the homed area, and says which', () => {
    const status = nativeBedFrameStatus(device(400, 300), homedGrblHal());
    expect(status).toEqual({
      frame: null,
      reason: { kind: 'bed-differs', homedArea: { widthMm: 396, heightMm: 296 } },
    });
  });

  it('gives no mapping when the profile has homing off', () => {
    const off = device(396, 296, { homing: { enabled: false, direction: 'front-left' } });
    expect(nativeBedFrameStatus(off, homedGrblHal()).reason).toEqual({ kind: 'homing-off' });
  });

  it.each(['fluidnc', 'marlin', 'smoothieware', 'grbl-v1.1'] as const)(
    'gives no mapping when the greeting names %s under a grblHAL profile',
    (detected) => {
      const status = nativeBedFrameStatus(
        bed,
        homedGrblHal({}, { detectedControllerKind: detected }),
      );
      expect(status.frame).toBeNull();
      expect(status.reason?.kind).toBe('firmware');
    },
  );

  it('gives no mapping to a command set whose contract did not hold', () => {
    const status = nativeBedFrameStatus(
      bed,
      homedGrblHal({}, { activeControllerCommandSet: 'creality-falcon-a1-pro' }),
    );
    expect(status).toEqual({
      frame: null,
      reason: { kind: 'firmware', firmware: 'vendor-mismatch' },
    });
  });
});

describe('firmware that reports nothing to place the bed', () => {
  it.each(['fluidnc', 'marlin', 'smoothieware'] as const)(
    'a homed %s has no mapping, whatever its travel report says',
    (kind) => {
      const bed = device(400, 300, { controllerKind: kind });
      const status = nativeBedFrameStatus(
        bed,
        homedGrblHal({}, { activeControllerKind: kind, detectedControllerKind: kind }),
      );
      expect(status).toEqual({ frame: null, reason: { kind: 'firmware', firmware: kind } });
    },
  );
});
