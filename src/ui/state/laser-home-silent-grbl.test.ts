// Home on a stock GRBL 1.1h, which answers no status query while it homes
// (controller audit 2026-09-25 ST-4):
//   grbl/limits.c:319-320
//     // Exit routines: No time to run protocol_execute_realtime() in this loop.
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L319-L320
// (the wiki: `?` is answered "immediately (exception: while homing)").
// The `ok` for `$H` comes only after mc_homing_cycle() returns. A search runs
// up to 1.5 x max travel at $25, so a 1000 mm axis at the default 500 mm/min
// needs 180 s for its search alone. KerfDesk used to time the Home out after
// 120 s of status silence, while the machine went on homing. It now waits for
// the longest cycle the controller's own `$$` settings allow
// (grbl-homing-duration.ts), or a long backstop when they were not read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
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

async function connectedStockGrbl(): Promise<FakeConnection> {
  const connection = makeConnection();
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1h');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await settleTestGrblHandshake();
  return connection;
}

/** Advances in 10 s steps; the status polls stay unanswered, as on GRBL. */
async function homeSilentlyFor(seconds: number): Promise<void> {
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    vi.advanceTimersByTime(10_000);
    await flush();
  }
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
    grblSettingsRows: [],
  });
  vi.restoreAllMocks();
});

describe('Home on a stock GRBL that is silent while homing', () => {
  it('is still homing 130 s into a long cycle when the settings were not read', async () => {
    await connectedStockGrbl();

    const home = useLaserStore
      .getState()
      .home()
      .catch((error: unknown) => error);
    await flush();
    expect(useLaserStore.getState().homingState).toBe('homing');
    await homeSilentlyFor(130);

    const state = useLaserStore.getState();
    expect({
      homingState: state.homingState,
      safetyNotice: state.safetyNotice?.message ?? null,
    }).toEqual({ homingState: 'homing', safetyNotice: null });
    void home;
  });

  it('waits for the longest cycle its settings allow, then says Home did not finish', async () => {
    await connectedStockGrbl();
    // Per axis (1.5 * 100 + 2 * 2) / 600 + 5 * 2 / 60 = 0.4233 min; three axes
    // 76.2 s. With the margin (x1.5 + 30 s) the wait is 144.3 s.
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(
        new Map([
          [24, '60'],
          [25, '600'],
          [26, '0'],
          [27, '2'],
          [130, '100'],
          [131, '100'],
          [132, '100'],
        ]),
      ),
    });

    const home = useLaserStore
      .getState()
      .home()
      .catch((error: unknown) => error);
    await flush();
    await homeSilentlyFor(140);
    expect(useLaserStore.getState().homingState).toBe('homing');

    await homeSilentlyFor(10);
    const state = useLaserStore.getState();
    expect(state.homingState).toBe('unknown');
    expect(state.safetyNotice).toMatchObject({
      kind: 'home-unfinished',
      message: expect.stringContaining('Home did not finish: Home timed out.'),
    });
    await expect(home).resolves.toBeInstanceOf(Error);
  });
});
