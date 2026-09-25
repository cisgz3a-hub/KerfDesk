// The Falcon's two-line Home ($HX then $HY) on a grblHAL controller with its
// homing lock (controller audit 2026-09-25 HF-1).
//
// grblHAL core system.c go_home, lines 494-505 at d7aaee3d:
//
//     if(retval == Status_OK && !sys.abort) {
//         state_set(STATE_IDLE);
//         ...
//         else if(limits_homing_required()) { // Keep alarm state active if homing is required and not all axes homed.
//             sys.alarm = Alarm_HomingRequired;
//             state_set(STATE_ALARM);
//         }
//     }
//
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L494-L505
//
// With `$22` homing lock on, grblHAL is back in Alarm (code 11, no ALARM: line)
// after `$HX` finishes, because Y is not yet homed. A `?` served before `$HY`
// starts reads `<Alarm|...>`. The Home is still in progress: `$HY` is written
// and homes Y, after which grblHAL reports Idle. KerfDesk re-opens the stale
// Alarm window for each further Home line (laser-home-alarm-reply.ts), so the
// Home finishes on the settle marker and a fresh Idle.
//
// Timing: with status reports while homing off by default (config.h:745-753),
// a `?` that arrives during the $HX cycle is served at motion_control.c:960,
// still in the Homing state, so the Alarm report needs a `?` that reaches
// grblHAL between go_home's re-lock and the start of $HY (about one host round
// trip). KerfDesk fast-polls every 250 ms during Home, so this is a race, not
// every Home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';
const HOME = '<Home|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('HF-1 Falcon $HX/$HY Home on grblHAL with homing init lock', () => {
  // Control: identical wire sequence without the between-lines Alarm reply, so
  // the only difference in the cases below is the `<Alarm|...>` report grblHAL
  // legitimately sends between the lines.
  it('control: finishes the Home when no status is serviced between $HX and $HY', async () => {
    expect(await runFalconHome({ gapAlarmReport: false })).toEqual({
      outcome: 'resolved',
      homingState: 'confirmed',
    });
  });

  it('finishes the Home when grblHAL reports Alarm between $HX and $HY', async () => {
    expect(await runFalconHome({ gapAlarmReport: true })).toEqual({
      outcome: 'resolved',
      homingState: 'confirmed',
    });
  });

  // Same re-lock when Home starts from Idle after an Unlock ($X leaves the axes
  // unhomed, so limits_homing_required() is still true after $HX;
  // machine_limits.c:668-673). No stale-Alarm window is open for the first line.
  it('finishes a Home started from Idle when grblHAL re-locks between $HX and $HY', async () => {
    expect(await runFalconHome({ gapAlarmReport: true, startInAlarm: false })).toEqual({
      outcome: 'resolved',
      homingState: 'confirmed',
    });
  });
});

async function runFalconHome(options: {
  readonly gapAlarmReport: boolean;
  readonly startInAlarm?: boolean;
}): Promise<{ readonly outcome: string; readonly homingState: string }> {
  const port = createFakeSerialPort();
  // The controller answers `?` with whatever state the firmware is in.
  let reported = IDLE;
  port.onOpen(() => setTimeout(() => port.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]"), 1));
  port.onWrite((data) => {
    if (data === '?') setTimeout(() => port.emitLine(reported), 1);
  });
  await useLaserStore
    .getState()
    .connect(port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
  await vi.advanceTimersByTimeAsync(1100);

  if (options.startInAlarm !== false) {
    // Power-up with init lock: grblHAL raises ALARM:11 (homing required).
    reported = ALARM;
    port.emitLine('ALARM:11');
    port.emitLine(reported);
    await vi.advanceTimersByTimeAsync(1);
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  } else {
    // Unlocked earlier with $X: Idle, axes still unhomed.
    port.emitLine(IDLE);
    await vi.advanceTimersByTimeAsync(1);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  }

  let outcome = 'pending';
  useLaserStore
    .getState()
    .home()
    .then(
      () => (outcome = 'resolved'),
      (error: unknown) => (outcome = error instanceof Error ? error.message : String(error)),
    );
  await vi.advanceTimersByTimeAsync(1);
  const commandLines = () => port.outbound().filter((line) => line.endsWith('\n'));
  expect(commandLines()).toEqual(['$HX\n']);

  // $HX runs: grblHAL forces a <Home|...> report as homing starts.
  reported = HOME;
  port.emitLine(reported);
  await vi.advanceTimersByTimeAsync(1);
  // $HX finished; Y still unhomed, so grblHAL re-enters Alarm, then acks.
  reported = options.gapAlarmReport ? ALARM : HOME;
  port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(1);
  expect(commandLines()).toEqual(['$HX\n', '$HY\n']);
  // A `?` serviced before $HY executes (end-of-line checkpoint) reads Alarm.
  if (options.gapAlarmReport) port.emitLine(ALARM);
  await vi.advanceTimersByTimeAsync(1);

  // $HY then homes Y and grblHAL returns to Idle.
  reported = HOME;
  port.emitLine(reported);
  await vi.advanceTimersByTimeAsync(1);
  reported = IDLE;
  port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(1);
  if (commandLines().at(-1) === 'G4 P0.01\n') port.emitLine('ok');
  await vi.advanceTimersByTimeAsync(600);

  return { outcome, homingState: useLaserStore.getState().homingState };
}
