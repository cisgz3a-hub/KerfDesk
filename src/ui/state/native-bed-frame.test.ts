import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type Origin } from '../../core/devices';
import {
  bedPointToNative,
  nativeBedFrame,
  nativePointToBed,
} from '../../core/devices/native-bed-frame';
import {
  nativeBedEvidenceSnapshot,
  resolveNativeBedFrame,
  selectNativeBedEvidence,
  type NativeBedEvidence,
} from './native-bed-frame';
import { stockNativeEvidence } from './native-bed-frame.test-support';

const ORIGINS: Origin[] = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'];
const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 358,
  bedHeight: 268,
  homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
};

describe('verified native controller to profile-bed frame', () => {
  for (const origin of ORIGINS)
    for (const force of [false, true]) {
      it.each([0, 1, 2, 3, 4, 5, 6, 7])(
        `${origin}, force-origin=${String(force)}, mask %i`,
        (mask) => {
          const device = { ...DEVICE, origin };
          const frame = resolveNativeBedFrame(device, stockNativeEvidence(device, force, mask));
          expect(frame).not.toBeNull();
          if (frame === null) throw new Error('qualified fixture');
          // Oracle: stock GRBL always uses negative travel unless build option Z
          // forces the homed switch to zero and that axis homes toward negative.
          const nativeMin = {
            x: force && (mask & 1) !== 0 ? 0 : -358,
            y: force && (mask & 2) !== 0 ? 0 : -268,
          };
          const bedMin = origin === 'center' ? { x: -179, y: -134 } : { x: 0, y: 0 };
          const native = { x: nativeMin.x + 50, y: nativeMin.y + 30 };
          const bed = { x: bedMin.x + 50, y: bedMin.y + 30 };
          expect(nativePointToBed(native, frame)).toEqual(bed);
          expect(bedPointToNative(bed, frame)).toEqual(native);
          // Homing direction never becomes an invented axis reflection.
          expect(nativePointToBed({ x: native.x + 1, y: native.y + 2 }, frame)).toEqual({
            x: bed.x + 1,
            y: bed.y + 2,
          });
        },
      );
    }

  it.each<[string, Partial<NativeBedEvidence>]>([
    ['not homed', { homingState: 'unknown' }],
    ['stale settings', { controllerSettingsObservation: { sessionEpoch: 6, observedAt: 1 } }],
    ['stale build', { controllerBuildInfoObservation: { sessionEpoch: 6, observedAt: 1 } }],
    ['unknown identity', { detectedControllerKind: null }],
    ['fork identity', { detectedControllerKind: 'fluidnc' }],
    ['no build', { controllerBuildInfo: null }],
    [
      'different travel',
      {
        controllerSettings: {
          homingEnabled: true,
          homingDirectionMask: 3,
          bedWidth: 400,
          bedHeight: 268,
        },
      },
    ],
    [
      'no direction evidence',
      { controllerSettings: { homingEnabled: true, bedWidth: 358, bedHeight: 268 } },
    ],
  ])('leaves %s unverified', (_name, patch) => {
    expect(resolveNativeBedFrame(DEVICE, { ...stockNativeEvidence(DEVICE), ...patch })).toBeNull();
  });

  it('uses the official A1 positive convention only with the matching live command set', () => {
    const device = { ...DEVICE, controllerCommandSet: 'creality-falcon-a1-pro' as const };
    const evidence = {
      homingState: 'confirmed',
      activeControllerKind: 'grblhal' as const,
      activeControllerCommandSet: 'creality-falcon-a1-pro' as const,
    };
    expect(resolveNativeBedFrame(device, evidence)?.nativeToBedOffsetMm).toEqual({ x: 0, y: 0 });
    expect(
      resolveNativeBedFrame(device, { ...evidence, activeControllerCommandSet: null }),
    ).toBeNull();
    expect(
      resolveNativeBedFrame(device, { ...evidence, detectedControllerKind: 'fluidnc' }),
    ).toBeNull();
  });

  it('rejects non-finite dimensions instead of inventing a mapping', () => {
    expect(
      nativeBedFrame({ ...DEVICE, bedWidth: NaN }, { minX: -358, minY: -268, maxX: 0, maxY: 0 }),
    ).toBeNull();
  });
});

describe('selectNativeBedEvidence', () => {
  it('reuses one snapshot until a field the snapshot copies changes', () => {
    const evidence = stockNativeEvidence(DEVICE);
    const first = selectNativeBedEvidence(evidence);
    expect(first).toEqual(nativeBedEvidenceSnapshot(evidence));
    // A store set that leaves every evidence field alone (an acknowledged line).
    expect(selectNativeBedEvidence({ ...evidence })).toBe(first);

    // Driven by the snapshot's own keys, so a field added to the snapshot but
    // not to the memo's inputs fails here instead of serving stale evidence.
    let previous = first;
    for (const key of Object.keys(first)) {
      const changed = { ...evidence, [key]: { changedField: key } } as typeof evidence;
      const selected = selectNativeBedEvidence(changed);
      expect(selected).not.toBe(previous);
      expect(selected).toEqual(nativeBedEvidenceSnapshot(changed));
      previous = selectNativeBedEvidence(evidence);
      expect(previous).toEqual(first);
    }
  });
});
