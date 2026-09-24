import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
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
    positionEvidenceSuppressed: false,
  });
  vi.restoreAllMocks();
});

describe('home command timeout', () => {
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

// Audit status-2. GRBL services a pending '?' at the end-of-line checkpoint
// before it executes the line (gnea/grbl protocol.c protocol_main_loop:
// protocol_execute_realtime() runs before system_execute_line()), and $H only
// enters the homing state inside system_execute_line. A status query written
// before the operator clicked Home can therefore be answered '<Alarm|...>'
// after KerfDesk wrote $H.
describe('Home from Alarm and a status reply generated before $H executed', () => {
  async function connectInAlarm(writes: string[]): Promise<FakeConnection> {
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    // grblHAL raises ALARM:11 (homing required) at power-up.
    connection.emitLine('ALARM:11');
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    writes.length = 0;
    return connection;
  }

  it('completes Home and clears the startup alarm when that stale Alarm reply lands', async () => {
    const writes: string[] = [];
    const connection = await connectInAlarm(writes);

    const home = useLaserStore.getState().home();
    await flush();
    expect(writes).toEqual(['$H\n']);
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ kind: 'home' });
    expect(useLaserStore.getState().homingState).toBe('homing');

    connection.emitLine('ok');
    await flush();
    expect(writes).toEqual(['$H\n', 'G4 P0.01\n']);
    connection.emitLine('ok');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    await home;
    const state = useLaserStore.getState();
    expect(state.homingState).toBe('confirmed');
    expect(state.alarmCode).toBeNull();
    expect(state.safetyNotice).toBeNull();
  });

  it('still fails Home on an Alarm report after the controller reported homing', async () => {
    const writes: string[] = [];
    const connection = await connectInAlarm(writes);

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('Controller entered Alarm.');
    await flush();
    connection.emitLine('<Home|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    await failure;

    expect(useLaserStore.getState().homingState).toBe('unknown');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('still fails a Home started from Idle on any Alarm report', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('Controller entered Alarm.');
    await flush();
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    await failure;

    expect(useLaserStore.getState().homingState).toBe('unknown');
  });

  it('records a Home that a homing-fail ALARM ended', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('ALARM:8');
    await flush();
    connection.emitLine('ALARM:8');
    await failure;

    expect(useLaserStore.getState().log.at(-1)).toContain('Home failed: ALARM:8');
  });
});

// Audit regressions-2. GRBL-family firmware answers error:N for a Home line it
// will not run (error:5 when $22 homing is disabled; error:3 for $HX when
// HOMING_SINGLE_AXIS_COMMANDS is not compiled in, gnea/grbl config.h) before
// any motion, so the positions it keeps reporting are real.
describe('position evidence after a failed Home', () => {
  const IDLE_AT_5_6 = '<Idle|MPos:5.000,6.000,0.000|FS:0,0>';

  it('reports the controller position again after it refused the Home line', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('error:5');
    await flush();
    connection.emitLine('error:5');
    await failure;
    connection.emitLine(IDLE_AT_5_6);
    await flush();

    const state = useLaserStore.getState();
    expect(state.positionEvidenceSuppressed).toBe(false);
    expect(state.statusReport?.mPos).toEqual({ x: 5, y: 6, z: 0 });
    // Nothing was homed: no proof, and the failure is still reported.
    expect(state.homingState).toBe('unknown');
    expect(state.homingProof).toBeNull();
    expect(state.lastWriteError).toBe('error:5');
  });

  it('keeps positions hidden after a homing cycle that ended in ALARM', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('ALARM:9');
    await flush();
    connection.emitLine('<Home|MPos:3.000,0.000,0.000|FS:0,0>');
    connection.emitLine('ALARM:9');
    await failure;
    connection.emitLine(IDLE_AT_5_6);
    await flush();

    expect(useLaserStore.getState().positionEvidenceSuppressed).toBe(true);
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
  });

  it('keeps a suppression that predates the refused Home', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ positionEvidenceSuppressed: true });

    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow('error:5');
    await flush();
    connection.emitLine('error:5');
    await failure;
    connection.emitLine(IDLE_AT_5_6);
    await flush();

    expect(useLaserStore.getState().positionEvidenceSuppressed).toBe(true);
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
  });
});
