// Audit HF-1 repro: the Falcon's two-line Home ($HX then $HY) on a grblHAL
// controller with homing init lock.
//
// Correct behaviour (upstream grblHAL core, system.c go_home, lines 494-505 at
// d7aaee3d84b1e7010f075d395206afff038d7379):
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
// With `$22` homing init lock on, after `$HX` completes and before `$HY` runs,
// grblHAL is back in Alarm (code 11, no ALARM: line is printed) because Y is
// not yet homed. A `?` serviced in that gap is answered `<Alarm|...>`. The
// vendor Home is still in progress: `$HY` is already written and will home Y,
// after which grblHAL returns to Idle. KerfDesk should not treat that
// between-lines Alarm report as a new alarm that ends the Home; the Home should
// finish on the settle marker and a fresh Idle.
//
// Current KerfDesk: laser-home-alarm-reply.ts only tolerates a stale Alarm reply
// before the FIRST non-Alarm report of the whole Home; the `<Home|...>` report
// of the `$HX` cycle closes that window, so the between-lines `<Alarm|...>` runs
// handleInvalidatingStatus (laser-status-line.ts), which clears the Home owner
// and rejects the pending `$HY` command with "Controller entered Alarm.".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../../ui/commands/connect-options';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

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
  // Control: identical wire sequence without the between-lines Alarm reply.
  // Passes on current code, so the only difference in the failing case below
  // is the `<Alarm|...>` report grblHAL legitimately sends between the lines.
  it('control: finishes the Home when no status is serviced between $HX and $HY', async () => {
    expect(await runFalconHome({ gapAlarmReport: false })).toEqual({
      outcome: 'resolved',
      homingState: 'confirmed',
    });
  });

  it('finishes the Home when grblHAL reports Alarm between $HX and $HY', async () => {
    // Current code: { outcome: 'Controller entered Alarm.', homingState: 'unknown' }.
    expect(await runFalconHome({ gapAlarmReport: true })).toEqual({
      outcome: 'resolved',
      homingState: 'confirmed',
    });
  });
});

async function runFalconHome(options: {
  readonly gapAlarmReport: boolean;
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

  // Power-up with init lock: grblHAL raises ALARM:11 (homing required).
  reported = ALARM;
  port.emitLine('ALARM:11');
  port.emitLine(reported);
  await vi.advanceTimersByTimeAsync(1);
  expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

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
