import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { resolveCameraSafeFramePlacement } from '../laser/camera-frame-placement';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await settleTestGrblHandshake();
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
  it.each([
    { source: 'g54-persistent', name: 'zero G54', wco: '0.000,0.000,7.000', active: false },
    { source: 'g54-persistent', name: 'retained G54', wco: '200.398,170.323,7.000', active: true },
    { source: 'g92', name: 'zero G92', wco: '0.000,0.000,7.000', active: false },
    { source: 'g92', name: 'retained G92', wco: '200.398,170.323,7.000', active: true },
  ] as const)(
    'reconciles the $name XY offset only after fresh post-Home WCO',
    async ({ source, wco, active }) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      useLaserStore.setState({ workOriginActive: true, workOriginSource: source });
      writes.length = 0;

      const home = useLaserStore.getState().home();
      await flush();
      connection.emitLine('ok');
      await flush();
      connection.emitLine('ok');
      await flush();
      connection.emitLine(`<Idle|MPos:-399.000,-399.000,0.000|WCO:${wco}|FS:0,0>`);
      await home;
      expect(useLaserStore.getState().homingState).toBe('confirmed');
      expect(useLaserStore.getState().workOriginSource).toBe('unknown');
      expect(useLaserStore.getState().wcoCache).toBeNull();
      expect(useLaserStore.getState().statusReport).toMatchObject({
        state: 'Idle',
        mPos: null,
        wPos: null,
        wco: null,
      });

      for (const position of ['MPos:-399.000,-399.000,0.000', 'WPos:0.000,0.000,0.000']) {
        connection.emitLine(`<Idle|${position}|FS:0,0>`);
        await flush();
        const snapshot = useLaserStore.getState();
        expect(
          resolveCameraSafeFramePlacement(
            createProject(),
            { startFrom: 'absolute', anchor: 'front-left' },
            { ...snapshot, trustedPositionEpoch: snapshot.trustedPositionEpoch },
          ).ok,
        ).toBe(false);
      }

      connection.emitLine(`<Idle|MPos:-399.000,-399.000,0.000|WCO:${wco}|FS:0,0>`);
      await flush();
      const state = useLaserStore.getState();
      expect(state.workOriginActive).toBe(active);
      expect(state.workOriginSource).toBe(active ? 'unknown' : 'none');
      expect(state.wcoCache?.z).toBe(7);
      expect(state.wcoCache?.x).toBe(active ? 200.398 : 0);
      expect(state.wcoCache?.y).toBe(active ? 170.323 : 0);
      expect(writes.some((line) => /\b(?:G92|G10)/.test(line))).toBe(false);
      if (!active) {
        expect(
          resolveCameraSafeFramePlacement(
            createProject(),
            { startFrom: 'absolute', anchor: 'front-left' },
            { ...state, trustedPositionEpoch: state.trustedPositionEpoch },
          ).ok,
        ).toBe(true);
      }
    },
  );

  it.each(['Run', 'Hold', 'Jog'] as const)(
    'writes no Home command while the controller is known %s',
    async (controllerState) => {
      const writes: string[] = [];
      let rejectUnexpectedWrite = false;
      const connection = makeConnection(async (data) => {
        writes.push(data);
        if (rejectUnexpectedWrite) throw new Error(`unexpected wire write: ${data}`);
      });
      await connectWith(connection);
      writes.length = 0;
      rejectUnexpectedWrite = true;
      useLaserStore.setState({
        statusReport: {
          ...useLaserStore.getState().statusReport,
          state: controllerState,
        } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>,
      });

      await expect(useLaserStore.getState().home()).rejects.toThrow(/Idle or Alarm/i);

      expect(writes).toEqual([]);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
    },
  );

  it('retains intentional Home-from-Alarm recovery', async () => {
    const writes: string[] = [];
    let rejectCapturedHome = false;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (rejectCapturedHome && data === '$H\n') throw new Error('captured Alarm recovery Home');
    });
    await connectWith(connection);
    writes.length = 0;
    rejectCapturedHome = true;
    useLaserStore.setState({
      alarmCode: 1,
      statusReport: {
        ...useLaserStore.getState().statusReport,
        state: 'Alarm',
      } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>,
    });

    await expect(useLaserStore.getState().home()).rejects.toThrow('captured Alarm recovery Home');

    expect(writes).toEqual(['$H\n']);
  });

  it('writes no Home command before any controller status or Alarm evidence exists', async () => {
    const writes: string[] = [];
    let rejectUnexpectedWrite = false;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (rejectUnexpectedWrite) throw new Error(`unexpected wire write: ${data}`);
    });
    await connectWith(connection);
    writes.length = 0;
    rejectUnexpectedWrite = true;
    useLaserStore.setState({ statusReport: null, statusObservation: null, alarmCode: null });

    await expect(useLaserStore.getState().home()).rejects.toThrow(/known Idle or Alarm/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('writes no Home command while an older terminal acknowledgement is owed', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    await useLaserStore.getState().sendConsoleCommand('G92 X0');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    await expect(useLaserStore.getState().home()).rejects.toThrow(
      /previous controller write and terminal acknowledgement/i,
    );

    expect(writes).toEqual(['G92 X0\n']);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

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
    const state = useLaserStore.getState();
    expect(state.homingState).toBe('confirmed');
    expect(state.positionEvidenceSuppressed).toBe(false);
    expect(state.controllerOperation).toBeNull();
    expect(state.homingProof).toEqual({
      sessionEpoch: state.controllerSessionEpoch,
      positionEpoch: state.trustedPositionEpoch,
      confirmedStatusSequence: state.statusObservation?.sequence,
    });
  });

  it('cannot confirm Home when a reboot lands after the final Idle observation', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    await flush();
    connection.emitLine('ok');
    await flush();
    connection.emitLine('ok');
    await flush();

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('Grbl 1.1h');
    await flush();

    await expect(home).rejects.toThrow(/invalidated|reboot/i);
    expect(useLaserStore.getState().homingState).toBe('unknown');
    expect(useLaserStore.getState().homingProof).toBeNull();
    expect(useLaserStore.getState().positionEvidenceSuppressed).toBe(true);
  });
});
