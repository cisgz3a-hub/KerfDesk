// The words for "no bed mapping" name the real reason for the firmware and
// session, and say what works today (annoyance audit A2 B3-P2-2).
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import type { NativeBedEvidence } from './native-bed-frame';
import { stockNativeEvidence } from './native-bed-frame.test-support';
import {
  BED_UNKNOWN_WORKAROUND,
  nativeBedUnknownReviewNote,
  positionLaserUnavailableMessage,
  relativeViewHelp,
} from './native-bed-unknown-reason';

function device(controllerKind: ControllerKind, homing = true) {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind,
    homing: { enabled: homing, direction: 'front-left' as const },
  };
}

function homed(kind: ControllerKind): NativeBedEvidence {
  return {
    ...stockNativeEvidence(device(kind)),
    activeControllerKind: kind,
    detectedControllerKind: kind,
  };
}

const NO_HOME_HELPS = /Home does not tell KerfDesk where the bed is/;

describe('a firmware no Home can map', () => {
  it.each<[ControllerKind, RegExp]>([
    ['fluidnc', /FluidNC does not report .*mpos_mm/],
    ['marlin', /Marlin's home position and travel are fixed in the firmware build/],
    ['smoothieware', /Smoothieware's homing position is in the board's config file/],
  ])('%s: every surface names the firmware, and none says to Home', (kind, why) => {
    const texts = [
      positionLaserUnavailableMessage(device(kind), homed(kind)),
      nativeBedUnknownReviewNote(device(kind), homed(kind)) ?? '',
      relativeViewHelp(device(kind), homed(kind), true),
      // Before connecting, the profile already says which firmware it is.
      relativeViewHelp(device(kind), { homingState: 'unknown' }, false),
    ];
    for (const text of texts) {
      expect(text).toMatch(why);
      expect(text).toMatch(NO_HOME_HELPS);
      expect(text).not.toMatch(/normal until your machine is connected and homed/);
      expect(text).not.toMatch(/supported coordinate mapping/);
    }
    expect(texts[0]).toMatch(/Jog the head to the point instead\.$/);
    expect(texts[2]).toContain(BED_UNKNOWN_WORKAROUND);
    expect(texts[3]).toContain(BED_UNKNOWN_WORKAROUND);
  });
});

describe('a firmware that can be mapped', () => {
  it('says to Home when that is what is missing', () => {
    const notHomed = { ...stockNativeEvidence(device('grbl-v1.1')), homingState: 'unknown' };
    const text = positionLaserUnavailableMessage(device('grbl-v1.1'), notHomed);
    expect(text).toContain('The machine has not been homed in this connection. Press Home');
    expect(text).not.toMatch(/Jog the head to the point instead/);
  });

  it('keeps the first-run hover before a connection', () => {
    for (const kind of ['grbl-v1.1', 'grblhal'] as const) {
      expect(relativeViewHelp(device(kind), { homingState: 'unknown' }, false)).toMatch(
        /This is normal until your machine is connected and homed\.$/,
      );
    }
  });

  it('says homing is off rather than promising a Home that cannot happen', () => {
    for (const connected of [true, false]) {
      const text = relativeViewHelp(
        device('grbl-v1.1', false),
        { homingState: 'unknown', activeControllerKind: 'grbl-v1.1' },
        connected,
      );
      expect(text).toContain('This machine profile has homing off');
      expect(text).not.toMatch(/normal until your machine is connected and homed/);
    }
  });

  it('names a bed that is not the homed area, with both sizes', () => {
    const profile = { ...device('grbl-v1.1'), bedWidth: 300, bedHeight: 200 };
    const evidence = stockNativeEvidence({ ...profile, bedWidth: 400, bedHeight: 400 });
    expect(nativeBedUnknownReviewNote(profile, evidence)).toBe(
      "Why: The machine profile's bed is 300 × 200 mm, but the controller's homed area is 400 × 400 mm, so KerfDesk cannot tell where the bed sits inside it. Machine Setup offers the controller's values.",
    );
  });

  it('has nothing to add once the mapping is known', () => {
    const profile = device('grbl-v1.1');
    expect(nativeBedUnknownReviewNote(profile, stockNativeEvidence(profile))).toBeNull();
  });
});
