// Unlock hides the head position only when the alarm it clears can have lost
// it (user annoyance audit A1, A3-P2-1; ADR-367 Amendment 3). The firmware
// facts behind "kept" are cited in alarm-position-kept.ts; these cases pin the
// decision and everything that must still hide.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { controllerUnlockedPatch } from './laser-console-completion';
import {
  alarmAfterBannerPatch,
  noteAlarmBeforeBanner,
  noteOwnResetWrite,
  type ResetAlarmRefs,
} from './laser-reset-alarm';
import { useLaserStore, type LaserState } from './laser-store';
import {
  alarmAcrossBannerPatch,
  alarmRaisedPatch,
  unlockPositionVerdict,
  type AlarmRaisedRecord,
} from './position-kept-alarm';

const CONNECTION = 4;
const SHOWN = {
  positionEvidenceSuppressed: false,
  wcoCache: { x: 25, y: 15, z: 0 },
  workOriginActive: true,
  workOriginSource: 'g92',
} as const;

function raised(code: number, overrides: Partial<AlarmRaisedRecord> = {}): AlarmRaisedRecord {
  return { code, connectionAttempt: CONNECTION, duringHold: false, ...overrides };
}

/** A connected stock GRBL session locked by `code`, position still shown. */
function alarmed(code: number | null, overrides: Partial<LaserState> = {}): LaserState {
  return {
    ...useLaserStore.getState(),
    ...SHOWN,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    alarmCode: code,
    alarmRaised: code === null ? null : raised(code),
    connectionAttempt: CONNECTION,
    resetRequired: false,
    homingState: 'confirmed',
    ...overrides,
  };
}

const HIDDEN = {
  positionEvidenceSuppressed: true,
  wcoCache: null,
  workOriginActive: false,
  workOriginSource: 'none',
};

function lastLog(patch: Partial<LaserState>): string {
  return patch.log?.at(-1) ?? '';
}

describe('controllerUnlockedPatch: which alarms keep the position', () => {
  it('keeps position, work offset and XY origin after a soft limit (ALARM:2)', () => {
    const patch = controllerUnlockedPatch(alarmed(2), 2);

    expect(patch).not.toHaveProperty('positionEvidenceSuppressed');
    expect(patch).not.toHaveProperty('wcoCache');
    expect(patch).not.toHaveProperty('workOriginActive');
    expect(patch).not.toHaveProperty('workOriginSource');
    expect(lastLog(patch)).toContain('after ALARM:2, which keeps the machine position');
  });

  it('still clears Home, Z and Frame evidence after a soft limit', () => {
    const state = alarmed(2);
    const patch = controllerUnlockedPatch(state, 2);

    expect(patch).toMatchObject({
      homingState: 'unknown',
      homingProof: null,
      statusReport: null,
      workZZeroEvidence: null,
      workZReferenceEpoch: state.workZReferenceEpoch + 1,
      frameVerification: null,
      framedRun: null,
      frameTrace: null,
      trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    });
  });

  it.each([
    ['a hard limit', 1],
    ['a reset during motion', 3],
    ['a failed homing cycle', 9],
  ])('hides them after %s', (_name, code) => {
    const patch = controllerUnlockedPatch(alarmed(code), code);

    expect(patch).toMatchObject(HIDDEN);
    expect(lastLog(patch)).toContain(
      `Position not kept: ALARM:${code} is not known to keep the machine position`,
    );
  });

  it('hides them after a code no table lists', () => {
    expect(controllerUnlockedPatch(alarmed(99), 99)).toMatchObject(HIDDEN);
  });

  // The power-on lock of a machine that must home, and any lock KerfDesk
  // connected into: no ALARM:N line was seen.
  it('hides them when no alarm code is on record', () => {
    const patch = controllerUnlockedPatch(alarmed(null), null);

    expect(patch).toMatchObject(HIDDEN);
    expect(lastLog(patch)).toContain('Position not kept: no alarm code was on record');
  });

  it('hides them while the controller still asks for a reset', () => {
    const patch = controllerUnlockedPatch(alarmed(2, { resetRequired: true }), 2);

    expect(patch).toMatchObject(HIDDEN);
    expect(lastLog(patch)).toContain('the controller still asked for a reset');
  });

  // A banner KerfDesk's own reset did not cause drops the record: stock GRBL
  // clears its machine position at power-up and keeps the code on screen.
  it('hides them when the record of the alarm line is gone', () => {
    const patch = controllerUnlockedPatch(alarmed(2, { alarmRaised: null }), 2);

    expect(patch).toMatchObject(HIDDEN);
    expect(lastLog(patch)).toContain(
      'ALARM:2 was not raised on this connection, or the controller restarted since',
    );
  });

  it('hides them when the alarm was raised on an earlier connection', () => {
    const state = alarmed(2, { connectionAttempt: CONNECTION + 1 });

    expect(controllerUnlockedPatch(state, 2)).toMatchObject(HIDDEN);
  });

  it('hides them when the code on record is not the alarm KerfDesk saw raised', () => {
    expect(controllerUnlockedPatch(alarmed(2, { alarmRaised: raised(3) }), 2)).toMatchObject(
      HIDDEN,
    );
  });

  // A soft limit that trips while a feed hold is slowing the machine cuts the
  // motors (gnea/grbl motion_control.c mc_reset) and still reports ALARM:2.
  it('hides them when the soft limit came during a hold', () => {
    const state = alarmed(2, { alarmRaised: raised(2, { duringHold: true }) });
    const patch = controllerUnlockedPatch(state, 2);

    expect(patch).toMatchObject(HIDDEN);
    expect(lastLog(patch)).toContain('came during a hold');
  });

  it('keeps a persistent G54 origin as unknown, not gone, when it hides', () => {
    const patch = controllerUnlockedPatch(alarmed(3, { workOriginSource: 'g54-persistent' }), 3);

    expect(patch).toMatchObject({ workOriginActive: true, workOriginSource: 'unknown' });
  });

  it('leaves an already hidden position hidden after a soft limit', () => {
    const state = alarmed(2, { positionEvidenceSuppressed: true });

    expect({ ...state, ...controllerUnlockedPatch(state, 2) }.positionEvidenceSuppressed).toBe(
      true,
    );
  });

  // A second `$X` needs its own ALARM:N line to keep anything.
  it('reads the record once', () => {
    expect(controllerUnlockedPatch(alarmed(2), 2).alarmRaised).toBeNull();
  });

  it('is unchanged after a failed probe (ALARM:4 and 5)', () => {
    for (const code of [4, 5]) {
      // No record of the alarm line: the probe branch never read one.
      const patch = controllerUnlockedPatch(alarmed(code, { alarmRaised: null }), code);

      expect(patch).not.toHaveProperty('positionEvidenceSuppressed');
      expect(patch).not.toHaveProperty('wcoCache');
      expect(lastLog(patch)).toBe(
        '[lf2] Controller unlocked after a failed probe. Kept position and XY origin evidence; cleared Z, Home, and Frame evidence.',
      );
    }
  });
});

describe('unlockPositionVerdict: every firmware the session may be running must agree', () => {
  it('keeps a soft limit on grblHAL and FluidNC', () => {
    for (const kind of ['grblhal', 'fluidnc'] as const) {
      const state = alarmed(2, { activeControllerKind: kind, detectedControllerKind: kind });
      expect(unlockPositionVerdict(state, 2)).toEqual({ kept: true, code: 2 });
    }
  });

  // 17 is a G-code error on FluidNC and a motor fault on grblHAL.
  it('keeps FluidNC ALARM:17 only when nothing says the board is grblHAL', () => {
    const fluidnc = alarmed(17, {
      activeControllerKind: 'fluidnc',
      detectedControllerKind: 'fluidnc',
    });
    expect(unlockPositionVerdict(fluidnc, 17).kept).toBe(true);
    expect(unlockPositionVerdict({ ...fluidnc, detectedControllerKind: 'grblhal' }, 17).kept).toBe(
      false,
    );
  });

  it('does not keep grblHAL probe protection (ALARM:13)', () => {
    const state = alarmed(13, {
      activeControllerKind: 'grblhal',
      detectedControllerKind: 'grblhal',
    });
    expect(unlockPositionVerdict(state, 13).kept).toBe(false);
  });

  it('keeps nothing on a controller without numbered GRBL alarms', () => {
    const state = alarmed(2, { activeControllerKind: 'marlin', detectedControllerKind: null });
    expect(unlockPositionVerdict(state, 2).kept).toBe(false);
  });
});

describe('alarmRaisedPatch', () => {
  const base = { connectionAttempt: 7, statusReport: null, streamer: null };
  const reporting = (state: StatusReport['state']): StatusReport =>
    ({ state }) as unknown as StatusReport;

  it('records the code and the connection it was raised on', () => {
    const record = { code: 2, connectionAttempt: 7, duringHold: false };
    expect(alarmRaisedPatch(base, 2)).toEqual({ alarmRaised: record });
    expect(alarmRaisedPatch({ ...base, statusReport: reporting('Run') }, 2)).toEqual({
      alarmRaised: record,
    });
  });

  it.each(['Hold', 'Door'] as const)('marks an alarm raised in %s', (state) => {
    const patch = alarmRaisedPatch({ ...base, statusReport: reporting(state) }, 2);
    expect(patch.alarmRaised?.duringHold).toBe(true);
  });

  it('marks an alarm raised while KerfDesk had the job paused', () => {
    const streamer = { status: 'paused' } as unknown as LaserState['streamer'];
    expect(alarmRaisedPatch({ ...base, streamer }, 2).alarmRaised?.duringHold).toBe(true);
  });

  it('a text alarm, which has no code, clears the record', () => {
    expect(alarmRaisedPatch(base, null)).toEqual({ alarmRaised: null });
  });
});

describe('alarmAcrossBannerPatch: what a reboot banner leaves of the alarm', () => {
  const grblHal = (overrides: Partial<LaserState> = {}): LaserState =>
    alarmed(2, {
      activeControllerKind: 'grblhal',
      detectedControllerKind: 'grblhal',
      resetRequired: true,
      ...overrides,
    });

  it('keeps the record through a reset KerfDesk wrote, and drops it at any other banner', () => {
    expect(alarmAcrossBannerPatch(alarmed(2), 2, true)).toEqual({
      alarmCode: 2,
      alarmRaised: raised(2),
    });
    // The code no status report followed stays on screen, as before; the
    // record goes, so the next Unlock hides.
    expect(alarmAcrossBannerPatch(alarmed(2), 2, false)).toEqual({
      alarmCode: 2,
      alarmRaised: null,
    });
  });

  // grblHAL answers status reports in its critical-event loop, so the soft
  // limit's code had been dropped by the banner of the reset it asked for.
  it('grblHAL: keeps a soft limit through the reset KerfDesk sent for it', () => {
    expect(alarmAcrossBannerPatch(grblHal(), null, true)).toEqual({
      alarmCode: 2,
      alarmRaised: raised(2),
    });
  });

  // Wake clears alarmCode before its banner arrives; the record still names
  // the alarm that asked for the reset.
  it('grblHAL: reads the code from the record, not from alarmCode', () => {
    expect(alarmAcrossBannerPatch(grblHal({ alarmCode: null }), null, true).alarmCode).toBe(2);
  });

  it('keeps no code through a banner KerfDesk did not ask for', () => {
    expect(alarmAcrossBannerPatch(grblHal(), null, false)).toEqual({
      alarmCode: null,
      alarmRaised: null,
    });
  });

  it('keeps no code when no critical event asked for the reset', () => {
    expect(alarmAcrossBannerPatch(grblHal({ resetRequired: false }), null, true).alarmCode).toBe(
      null,
    );
  });

  it('keeps no code for an alarm that loses position', () => {
    const hardLimit = grblHal({ alarmCode: 1, alarmRaised: raised(1) });
    expect(alarmAcrossBannerPatch(hardLimit, null, true).alarmCode).toBeNull();
  });

  // FluidNC leaves its Critical state for Idle on a reset, or raises ALARM:14.
  it('keeps no code on FluidNC', () => {
    const fluidnc = grblHal({ activeControllerKind: 'fluidnc', detectedControllerKind: 'fluidnc' });
    expect(alarmAcrossBannerPatch(fluidnc, null, true).alarmCode).toBeNull();
  });
});

// The Reset and Wake buttons write their soft reset outside the reset
// transaction, and their recovery operation can end before the banner arrives,
// so the write itself marks the next banner as KerfDesk's own.
describe('alarmAfterBannerPatch: which banner answers a reset KerfDesk wrote', () => {
  const RESET = '\x18';

  afterEach(() => {
    vi.useRealTimers();
  });

  function refsAfterSoftLimit(): ResetAlarmRefs {
    const refs: ResetAlarmRefs = {};
    noteAlarmBeforeBanner(refs, 2);
    return refs;
  }

  it('the banner after a soft reset KerfDesk wrote keeps the record', () => {
    const refs = refsAfterSoftLimit();
    noteOwnResetWrite(refs, RESET, RESET);

    expect(alarmAfterBannerPatch(refs, alarmed(2), false).alarmRaised).toEqual(raised(2));
  });

  it('a banner with no reset written is a restart: the record goes', () => {
    const refs = refsAfterSoftLimit();
    noteOwnResetWrite(refs, '$X\n', RESET);
    noteOwnResetWrite(refs, RESET, null);

    expect(alarmAfterBannerPatch(refs, alarmed(2), false)).toEqual({
      alarmCode: 2,
      alarmRaised: null,
    });
  });

  it('a second banner is not taken for the same reset', () => {
    const refs = refsAfterSoftLimit();
    noteOwnResetWrite(refs, RESET, RESET);
    const afterFirst = { ...alarmed(2), ...alarmAfterBannerPatch(refs, alarmed(2), false) };

    expect(alarmAfterBannerPatch(refs, afterFirst, false)).toEqual({
      alarmCode: null,
      alarmRaised: null,
    });
  });

  it('a banner long after the reset was written is not its answer', () => {
    vi.useFakeTimers();
    const refs = refsAfterSoftLimit();
    noteOwnResetWrite(refs, RESET, RESET);
    vi.advanceTimersByTime(10_001);

    expect(alarmAfterBannerPatch(refs, alarmed(2), false).alarmRaised).toBeNull();
  });

  it('the banner an Abort or Disconnect transaction awaits keeps it too', () => {
    expect(alarmAfterBannerPatch(refsAfterSoftLimit(), alarmed(2), true).alarmRaised).toEqual(
      raised(2),
    );
  });
});
