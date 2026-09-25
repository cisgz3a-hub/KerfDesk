// Audit HF-2 repro: FluidNC answers `$X` with `ok` in its Critical state
// without unlocking, and KerfDesk records the controller as unlocked.
//
// Upstream FluidNC v4.0.3 (25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f):
// - Protocol.cpp protocol_do_alarm(), lines 458-470: HardLimit, HardStop and
//   SoftLimit set `State::Critical`, print `ALARM:N` and
//   `[MSG:ERR: Reset to continue]`.
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Protocol.cpp#L458-L470
// - ProcessSettings.cpp disable_alarm_lock(), lines 269-285: only
//   `if (state_is(State::Alarm))` unlocks; in Critical nothing changes, the
//   after_unlock macro runs, and the command returns `Error::Ok` (so `ok`).
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L269-L285
// - Report.cpp state_name(), lines 436-439: Critical reports as "Alarm".
// - Protocol.cpp protocol_do_rt_reset(), lines 1152-1157: only a reset leaves
//   Critical.
//
// Correct behaviour: an `ok` to `$X` on FluidNC is not proof the alarm cleared.
// While the controller keeps reporting Alarm after the `ok`, KerfDesk must not
// record the alarm as cleared (the ALARM:2 code stays, and the operator should
// be told a reset is required). Current code: unlockAlarm() applies
// controllerUnlockedPatch on the bare `ok` (laser-autofocus-actions.ts), which
// sets alarmCode null and logs "Controller unlocked", and the following Alarm
// report does not restore the code (laser-status-line.ts handleInvalidatingStatus
// keeps alarmCode as is), so the banner falls back to "Controller reports
// Alarm ... until the machine is homed or unlocked" and offers `$X` again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { useLaserStore } from '../../ui/state/laser-store';
import { resetStore } from '../../ui/state/test-helpers';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('HF-2 FluidNC Critical alarm and $X', () => {
  it('keeps the soft-limit alarm when FluidNC acks $X but still reports Alarm', async () => {
    const port = createFakeSerialPort();
    let reported = IDLE;
    port.onOpen(() =>
      setTimeout(() => port.emitLine("Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]"), 1),
    );
    port.onWrite((data) => {
      if (data === '?') {
        setTimeout(() => port.emitLine(reported), 1);
        return;
      }
      if (!data.endsWith('\n')) return;
      setTimeout(() => {
        if (data === '$$\n') {
          port.emitLine('$20=0');
          port.emitLine('$22=0');
        }
        if (data === '$G\n') port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        // FluidNC answers every one of these (including `$X` in Critical) with ok.
        port.emitLine('ok');
      }, 1);
    });
    await useLaserStore.getState().connect(port.adapter, {
      controllerKind: 'fluidnc',
      baudRate: 115200,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(useLaserStore.getState().activeControllerKind).toBe('fluidnc');

    // A soft-limit violation: FluidNC enters State::Critical.
    reported = ALARM;
    port.emitLine('[MSG:INFO: ALARM: Soft Limit]');
    port.emitLine('ALARM:2');
    port.emitLine('[MSG:ERR: Reset to continue]');
    await vi.advanceTimersByTimeAsync(300);
    expect(useLaserStore.getState().alarmCode).toBe(2);

    let outcome = 'pending';
    useLaserStore
      .getState()
      .unlockAlarm()
      .then(
        () => (outcome = 'resolved'),
        (error: unknown) => (outcome = error instanceof Error ? error.message : String(error)),
      );
    // `$X` -> ok (Critical is unchanged), then the next polls still read Alarm.
    await vi.advanceTimersByTimeAsync(1000);
    expect(port.outbound()).toContain('$X\n');
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

    // Correct: the alarm is not recorded as cleared. Current code: alarmCode
    // is null and the log says "Controller unlocked" (outcome 'resolved').
    expect({ outcome, alarmCode: useLaserStore.getState().alarmCode }).toEqual({
      outcome: expect.not.stringMatching(/^resolved$/),
      alarmCode: 2,
    });
  });
});
