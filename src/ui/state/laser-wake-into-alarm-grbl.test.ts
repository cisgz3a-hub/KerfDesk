// Controller audit 2026-09-25 CG-8 (regression): Wake from Sleep used to
// "fail" on GRBL and grblHAL.
//
// wakeController() writes Ctrl-X and then waits for a fresh Idle report
// (laser-controller-recovery-actions.ts), rejecting on Alarm. But both firmwares
// re-enter ALARM after a soft reset from Sleep, by design:
//   GRBL 1.1h protocol.c L52-L54: `if (sys.state & (STATE_ALARM | STATE_SLEEP)) {
//     report_feedback_message(MESSAGE_ALARM_LOCK); sys.state = STATE_ALARM; }`
//   grblHAL core protocol.c L167-L173: same, "Re-initialize the sleep state as an
//     ALARM mode to ensure user homes or acknowledges".
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L52-L54
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L167-L173
// So the Sleep banner's "Wake (Ctrl-X)" ended in "Wake failed: Controller
// entered Alarm.". A fresh ALARM lock after a commanded wake is the expected
// completion (the next step is Unlock/Home), so Wake resolves 'alarm'.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';

function createStockGrbl(): FakeSerialPort {
  const port = createFakeSerialPort();
  let state: 'Idle' | 'Sleep' | 'Alarm' = 'Idle';
  let rx = '';
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const banner = (): void => emit("Grbl 1.1h ['$' for help]");
  port.onOpen(banner);
  port.onWrite((data) => {
    respondToTestGrblHandshake(data, (line) => emit(line));
    if (data === '$$\n') {
      emit('$22=0');
      emit('$32=1');
      emit('ok');
      return;
    }
    if (data === '$I\n' || data === '$G\n') return; // answered by the handshake helper
    for (const ch of data) {
      if (ch === '?') {
        emit(`<${state}|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>`);
        continue;
      }
      if (ch === '\x18') {
        // protocol_main_loop after the reset: Sleep (or Alarm) comes back as Alarm.
        state = state === 'Idle' ? 'Idle' : 'Alarm';
        banner();
        if (state === 'Alarm') emit("[MSG:'$H'|'$X' to unlock]");
        continue;
      }
      if (ch === '\n') {
        const line = rx.trim();
        rx = '';
        if (line === '$SLP') {
          emit('ok');
          state = 'Sleep';
          emit('[MSG:Sleeping]');
        } else if (line !== '') {
          emit('ok');
        }
        continue;
      }
      if (ch !== '\r') rx += ch;
    }
  });
  return port;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < 1_000 && !done; t += 1) await pump(10);
  return tracked;
}

describe('CG-8: Wake from Sleep on stock GRBL', () => {
  it('completes the commanded wake when the controller comes back locked in ALARM', async () => {
    const port = createStockGrbl();
    useStore.getState().updateDeviceProfile({ controllerKind: 'grbl-v1.1' });
    await useLaserStore.getState().connect(port.adapter, { controllerKind: 'grbl-v1.1' });
    await pump(50);
    await settleTestGrblHandshake().catch(() => undefined);
    await pump(2_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await settle(useLaserStore.getState().releaseMotors());
    await pump(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Sleep');

    const outcome = await settle(
      useLaserStore
        .getState()
        .wakeController()
        .then(
          (result) => result,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
    );
    // Before the fix: "Controller entered Alarm."
    expect(outcome).toBe('alarm');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});
