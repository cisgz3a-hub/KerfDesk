// Controller audit 2026-09-25 GP-2, HF-2, HF-3 (regression). After a critical
// event GRBL-family firmware prints "Reset to continue" and accepts only a soft
// reset: gnea/grbl answers nothing (protocol.c:224-236), grblHAL answers
// `$X`/`$H` with error:79 (system.c:1179-1181), FluidNC acknowledges `$X`
// without unlocking (ProcessSettings.cpp:269-286). KerfDesk used to send `$X`
// into that state; stock GRBL then left an acknowledgement owed for good.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L218-L237
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L269-L286

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import type { ControllerKind } from '../../core/devices';
import { RESET_REQUIRED_MESSAGE } from './controller-reset-required';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

type Board = {
  readonly port: ReturnType<typeof createFakeSerialPort>;
  reported: string;
  answerLines: boolean;
};

async function connect(kind: ControllerKind, banner: string): Promise<Board> {
  const port = createFakeSerialPort();
  const board: Board = { port, reported: IDLE, answerLines: true };
  port.onOpen(() => setTimeout(() => port.emitLine(banner), 1));
  port.onWrite((data) => {
    if (data === '?') {
      if (board.answerLines) setTimeout(() => port.emitLine(board.reported), 1);
      return;
    }
    if (data === '\x18') {
      setTimeout(() => {
        board.answerLines = true;
        port.emitLine(banner);
        port.emitLine("[MSG:'$H'|'$X' to unlock]");
      }, 1);
      return;
    }
    if (!data.endsWith('\n') || !board.answerLines) return;
    setTimeout(() => {
      if (data === '$$\n') port.emitLine('$22=0');
      if (data === '$G\n') port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      port.emitLine('ok');
    }, 1);
  });
  await useLaserStore.getState().connect(port.adapter, { controllerKind: kind, baudRate: 115200 });
  await vi.advanceTimersByTimeAsync(2000);
  return board;
}

function outcomeOf(pending: Promise<unknown>): { value: string } {
  const outcome = { value: 'pending' };
  pending.then(
    () => (outcome.value = 'resolved'),
    (error: unknown) => (outcome.value = error instanceof Error ? error.message : String(error)),
  );
  return outcome;
}

describe('reset required after a critical event', () => {
  it.each([1, 2])(
    'GRBL ALARM:%i: holds Unlock, Home and the Console until the soft reset',
    async (code) => {
      const board = await connect('grbl-v1.1', "Grbl 1.1h ['$' for help]");
      // The critical loop answers nothing at all until Ctrl-X.
      board.answerLines = false;
      board.reported = ALARM;
      board.port.emitLine(`ALARM:${code}`);
      board.port.emitLine('[MSG:Reset to continue]');
      await vi.advanceTimersByTimeAsync(100);
      expect(useLaserStore.getState().resetRequired).toBe(true);
      const before = board.port.outbound().length;

      const unlock = outcomeOf(useLaserStore.getState().unlockAlarm());
      const home = outcomeOf(useLaserStore.getState().home());
      const consoleUnlock = outcomeOf(useLaserStore.getState().sendConsoleCommand('$X'));
      await vi.advanceTimersByTimeAsync(100);

      expect(unlock.value).toBe(RESET_REQUIRED_MESSAGE);
      expect(home.value).toBe(RESET_REQUIRED_MESSAGE);
      expect(consoleUnlock.value).toBe(RESET_REQUIRED_MESSAGE);
      const written = board.port.outbound().slice(before);
      expect(written.filter((data) => data !== '?')).toEqual([]);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

      // Reset: Ctrl-X, the reboot banner ends the latch, the controller is
      // locked in Alarm as after any reset from a critical event.
      const reset = outcomeOf(useLaserStore.getState().wakeController());
      await vi.advanceTimersByTimeAsync(2000);
      expect(board.port.outbound()).toContain('\x18');
      expect(useLaserStore.getState().resetRequired).toBe(false);
      expect(reset.value).toBe('resolved');
    },
  );

  it('FluidNC: the ERR form of the message latches, so `$X` is never sent', async () => {
    const board = await connect('fluidnc', "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]");
    board.reported = ALARM;
    board.port.emitLine('[MSG:INFO: ALARM: Soft Limit]');
    board.port.emitLine('ALARM:2');
    board.port.emitLine('[MSG:ERR: Reset to continue]');
    await vi.advanceTimersByTimeAsync(300);

    const unlock = outcomeOf(useLaserStore.getState().unlockAlarm());
    await vi.advanceTimersByTimeAsync(500);

    expect(unlock.value).toBe(RESET_REQUIRED_MESSAGE);
    expect(board.port.outbound()).not.toContain('$X\n');
    expect(useLaserStore.getState().alarmCode).toBe(2);
  });

  it('FluidNC: an acknowledged `$X` keeps the alarm while the controller still reports Alarm', async () => {
    const board = await connect('fluidnc', "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]");
    // Connected after the event: the "Reset to continue" message was missed.
    board.reported = ALARM;
    board.port.emitLine('ALARM:2');
    await vi.advanceTimersByTimeAsync(300);

    const unlock = outcomeOf(useLaserStore.getState().unlockAlarm());
    await vi.advanceTimersByTimeAsync(1000);

    expect(board.port.outbound()).toContain('$X\n');
    expect(unlock.value).toBe('resolved');
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    expect(useLaserStore.getState().alarmCode).toBe(2);
  });
});
