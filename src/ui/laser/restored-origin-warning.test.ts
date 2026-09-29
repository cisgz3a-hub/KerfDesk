// Job Review names a work origin the controller already had when KerfDesk
// connected, and what the firmware says about keeping it (controller audit 2,
// M-4, ADR-375). A warning only: nothing here refuses a job (NN21).

import { describe, expect, it } from 'vitest';
import type { JobOriginPlacement } from '../../core/job';
import { UNKNOWN_NATIVE_BED_MESSAGE } from '../state/native-bed-frame';
import { unknownNativeBedWarning } from './restored-origin-warning';
import type { MachineStartSnapshot } from './start-job-readiness';

const USER_ORIGIN: JobOriginPlacement = { startFrom: 'user-origin', anchor: 'front-left' };
const RESTORED = 'already on the controller when KerfDesk connected';

const restored: MachineStartSnapshot = {
  connected: true,
  statusReport: null,
  alarmCode: null,
  hasActiveStreamer: false,
  workOriginRestored: true,
  homingState: 'unknown',
  activeControllerKind: 'grbl-v1.1',
  detectedControllerKind: 'grbl-v1.1',
  controllerSettings: null,
};

function grblHal(
  settings: NonNullable<MachineStartSnapshot['controllerSettings']> | null,
): MachineStartSnapshot {
  return {
    ...restored,
    activeControllerKind: 'grblhal',
    detectedControllerKind: 'grblhal',
    controllerSettings: settings,
  };
}

describe('unknownNativeBedWarning', () => {
  it('stays the plain unverified-mapping warning unless a User origin job runs from a restored origin', () => {
    const plain = [
      unknownNativeBedWarning(USER_ORIGIN, { ...restored, workOriginRestored: false }),
      unknownNativeBedWarning(USER_ORIGIN, { ...restored, homingState: 'confirmed' }),
      unknownNativeBedWarning({ startFrom: 'absolute', anchor: 'front-left' }, restored),
      unknownNativeBedWarning(
        { startFrom: 'current-position', anchor: 'front-left', currentPosition: { x: 1, y: 2 } },
        restored,
      ),
      unknownNativeBedWarning(undefined, restored),
    ];
    expect(plain).toEqual(plain.map(() => UNKNOWN_NATIVE_BED_MESSAGE));
  });

  it('names the restored origin and what $384 says about Set origin here', () => {
    const cases: readonly [MachineStartSnapshot, string][] = [
      [restored, 'A saved G54 origin survives a power cycle.'],
      [grblHal(null), 'grblHAL keeps Set origin here through a power cycle unless $384=1.'],
      [
        grblHal({ g92PersistenceDisabled: false }),
        'This grblHAL controller keeps Set origin here through a power cycle ($384=0).',
      ],
      [
        grblHal({ g92PersistenceDisabled: true }),
        'does not restore Set origin here at power-up ($384=1), so this is a saved G54 origin',
      ],
    ];
    for (const [machine, note] of cases) {
      const warning = unknownNativeBedWarning(USER_ORIGIN, machine);
      expect(warning.startsWith(UNKNOWN_NATIVE_BED_MESSAGE)).toBe(true);
      expect(warning).toContain(RESTORED);
      expect(warning).toContain(note);
      expect(warning).toContain('Set origin here again.');
    }
  });

  it('adds no firmware note for a controller outside the GRBL family', () => {
    const smoothie: MachineStartSnapshot = {
      ...restored,
      activeControllerKind: 'smoothieware',
      detectedControllerKind: null,
    };
    expect(unknownNativeBedWarning(USER_ORIGIN, smoothie)).toBe(
      unknownNativeBedWarning(USER_ORIGIN, restored).replace(
        ' A saved G54 origin survives a power cycle.',
        '',
      ),
    );
  });

  it('treats a Verified Origin job like a User origin one', () => {
    const verified: JobOriginPlacement = { startFrom: 'verified-origin', anchor: 'front-left' };
    expect(unknownNativeBedWarning(verified, restored)).toContain(RESTORED);
  });
});
