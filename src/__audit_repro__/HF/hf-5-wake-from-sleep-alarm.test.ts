// Audit HF-5 repro: waking a sleeping grblHAL or FluidNC controller is
// reported as a failure, because both firmwares deliberately reboot into Alarm
// after a reset from Sleep, while KerfDesk's wakeController waits for Idle.
//
// Upstream:
// - grblHAL core protocol.c:167-174 (d7aaee3d84b1e7010f075d395206afff038d7379):
//     } else if (state_get() & (STATE_ALARM|STATE_SLEEP)) {
//         // NOTE: Sleep mode disables the stepper drivers and position can't be guaranteed.
//         // Re-initialize the sleep state as an ALARM mode to ensure user homes or acknowledges.
//         ...
//         state_set(STATE_ALARM); // Ensure alarm state is set.
//         grbl.report.feedback_message(Message_AlarmLock);
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L167-L174
// - FluidNC v4.0.3 Protocol.cpp:1158-1159 (protocol_do_rt_reset):
//     } else if (state_is(State::Sleep)) {
//         protocol_do_alarm((void*)ExecAlarm::AbortCycle);
//   https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Protocol.cpp#L1158-L1159
//   (ALARM:3 is printed, then the soft-restart banner.)
// - Stock gnea/grbl protocol.c:49-54 does the same (outside this track).
//
// Correct behaviour: a Ctrl-X wake whose reboot lands in the firmware's
// documented post-sleep Alarm has done its job (the controller is awake and
// asks for Home or Unlock); Wake should resolve and hand over to the Alarm
// banner rather than report "Controller recovery failed". Current code
// (laser-controller-recovery-actions.ts:90-108) waits for a fresh Idle, so the
// Alarm report (grblHAL) or the ALARM:3 line (FluidNC) rejects the wake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import type { ControllerKind } from '../../core/devices';
import { useLaserStore } from '../../ui/state/laser-store';
import { resetStore } from '../../ui/state/test-helpers';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const SLEEP = '<Sleep|MPos:0.000,0.000,0.000|FS:0,0>';
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

type Firmware = {
  readonly kind: ControllerKind;
  readonly banner: string;
  /** Lines the firmware prints after Ctrl-X from Sleep, in wire order. */
  readonly wakeLines: ReadonlyArray<string>;
};

const GRBLHAL: Firmware = {
  kind: 'grblhal',
  banner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
  wakeLines: ["GrblHAL 1.1f ['$' or '$HELP' for help]", "[MSG:'$H'|'$X' to unlock]"],
};

const FLUIDNC: Firmware = {
  kind: 'fluidnc',
  banner: "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]",
  wakeLines: [
    '[MSG:INFO: ALARM: Abort Cycle]',
    'ALARM:3',
    "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]",
  ],
};

async function wakeOutcome(firmware: Firmware): Promise<string> {
  const port = createFakeSerialPort();
  let reported = IDLE;
  port.onOpen(() => setTimeout(() => port.emitLine(firmware.banner), 1));
  port.onWrite((data) => {
    if (data === '?') {
      setTimeout(() => port.emitLine(reported), 1);
      return;
    }
    if (data === '\x18') {
      setTimeout(() => {
        reported = ALARM;
        for (const line of firmware.wakeLines) port.emitLine(line);
      }, 5);
      return;
    }
    if (!data.endsWith('\n')) return;
    setTimeout(() => {
      if (data === '$$\n') port.emitLine('$22=0');
      if (data === '$G\n') port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      port.emitLine('ok');
    }, 1);
  });
  await useLaserStore.getState().connect(port.adapter, {
    controllerKind: firmware.kind,
    baudRate: 115200,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(useLaserStore.getState().activeControllerKind).toBe(firmware.kind);

  // The controller went to Sleep ($SLP from Release motors).
  reported = SLEEP;
  await vi.advanceTimersByTimeAsync(1100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Sleep');

  let outcome = 'pending';
  useLaserStore
    .getState()
    .wakeController()
    .then(
      () => (outcome = 'resolved'),
      (error: unknown) => (outcome = error instanceof Error ? error.message : String(error)),
    );
  await vi.advanceTimersByTimeAsync(3000);
  expect(port.outbound()).toContain('\x18');
  expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  return outcome;
}

describe('HF-5 wake from Sleep on firmwares that reboot into Alarm', () => {
  it('grblHAL: Wake resolves when the controller reboots into its post-sleep Alarm', async () => {
    // Current code: 'Controller entered Alarm.'
    expect(await wakeOutcome(GRBLHAL)).toBe('resolved');
  });

  it('FluidNC: Wake resolves when the controller prints ALARM:3 and reboots', async () => {
    // Current code: 'ALARM:3'
    expect(await wakeOutcome(FLUIDNC)).toBe('resolved');
  });
});
