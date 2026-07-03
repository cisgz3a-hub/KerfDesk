import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

// Mirrors DEFAULT_COMMAND_TIMEOUT_MS in laser-interactive-command.ts — the
// budget a $H ack was previously (and wrongly) held to.
const DEFAULT_COMMAND_TIMEOUT_MS = 8_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
    homingState: 'unknown',
  });
  vi.restoreAllMocks();
});

describe('home command timeout', () => {
  // GRBL only acks $H after the homing cycle physically completes — commonly
  // 10-60 s on real beds. While the cycle runs the controller answers status
  // polls with <Home|...>, which must keep the command alive well past the
  // default 8 s ack budget.
  it('does not time out while Home status reports keep arriving', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    await flush();
    expect(useLaserStore.getState().homingState).toBe('homing');

    // 25 × 6 s = 150 s of cycle time — beyond any fixed budget, so only a
    // status-activity keep-alive keeps the command pending.
    for (let i = 0; i < 25; i += 1) {
      vi.advanceTimersByTime(DEFAULT_COMMAND_TIMEOUT_MS - 2_000);
      connection.emitLine('<Home|MPos:0.000,0.000,0.000|FS:0,0>');
      await flush();
    }

    // 150 s in: still homing, no spurious "home timed out" failure.
    expect(useLaserStore.getState().homingState).toBe('homing');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ kind: 'home' });

    connection.emitLine('ok');
    await flush();
    connection.emitLine('ok');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    await home;
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});
