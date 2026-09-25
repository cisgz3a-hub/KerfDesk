// ST-4 repro — on stock GRBL 1.1h a Home cycle longer than 120 s is reported as
// failed, because the Home command's timeout is only refreshed by `<Home|...>`
// status replies and stock GRBL sends none while homing.
//
// Correct behaviour: KerfDesk must not declare a Home failed while a stock GRBL
// controller is still inside its homing cycle. Stock GRBL services no realtime
// command during the homing search/locate loop:
//   grbl/limits.c:319-320
//     // Exit routines: No time to run protocol_execute_realtime() in this loop.
//     if (sys_rt_exec_state & (EXEC_SAFETY_DOOR | EXEC_RESET | EXEC_CYCLE_STOP)) {
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L319-L320
// (the wiki: `?` is answered "immediately (exception: while homing)",
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#status-reporting).
// The `ok` for `$H` is printed only after mc_homing_cycle() returns
// (system.c case 'H' -> mc_homing_cycle; protocol.c:98 report_status_message).
// A search runs up to 1.5 x max travel at $25 (limits.c HOMING_AXIS_SEARCH_SCALAR
// 1.5; defaults.h DEFAULT_HOMING_SEEK_RATE 500 mm/min), so a 1000 mm axis homed
// from its far end needs ~120 s for the XY search alone, plus the Z cycle and
// the locate passes (HOMING_AXIS_LOCATE_SCALAR 5.0 at $24).
// grblHAL differs: its homing loop answers EXEC_STATUS_REPORT
// (grblHAL/core machine_limits.c:445-447), which is what
// laser-home-action.ts HOME_COMMAND_TIMEOUT_MS relies on ("the <Home|...> poll
// replies keep the command alive"). The shared simulator also answers `?` with
// `<Home|...>` during homing, so no test sees the stock-GRBL case.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';
import {
  respondToTestGrblHandshake,
  settleTestGrblHandshake,
} from '../../ui/state/laser-test-start-helpers';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    controllerOperation: null,
    homingState: 'unknown',
  });
  vi.restoreAllMocks();
});

describe('ST-4: Home on a stock GRBL 1.1h that is silent while homing', () => {
  it('is still homing 130 s into a long homing cycle', async () => {
    const connection = makeConnection(async () => undefined);
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine('Grbl 1.1h');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await settleTestGrblHandshake();

    const home = useLaserStore.getState().home().catch((error: unknown) => error);
    await flush();
    expect(useLaserStore.getState().homingState).toBe('homing');

    // Stock GRBL answers nothing while it homes; the status polls go unanswered.
    for (let i = 0; i < 13; i += 1) {
      vi.advanceTimersByTime(10_000);
      await flush();
    }

    const state = useLaserStore.getState();
    expect({
      homingState: state.homingState,
      safetyNotice: state.safetyNotice?.message ?? null,
    }).toEqual({ homingState: 'homing', safetyNotice: null });
    void home;
  });
});
