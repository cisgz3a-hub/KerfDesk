import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import type { FramedRunCandidate, FramedRunPermit } from './framed-run';
import { framedRunControllerSnapshot } from './framed-run';
import {
  captureLaserModeStartSnapshot,
  createLaserModeStartEvidence,
  type LaserModeStartEvidence,
} from './laser-mode-start-evidence';
import { LASER_LIVE_STATUS_TIMEOUT_MESSAGE } from './laser-live-start-readiness';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

const JOB_LINE = 'G1 X10.000 Y5.000 F600 S255';
const JOB_GCODE = `G21\nG90\n${JOB_LINE}\nM5\n`;
const IDLE = '<Idle|MPos:31.000,42.000,0.000|FS:0,0>';

let connections: FakeConnection[] = [];

function makeConnection(
  writes: string[],
  onWrite?: (data: string) => Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emitLine = (line: string): void => {
    for (const handler of [...lineHandlers]) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      await onWrite?.(data);
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine,
    emitClose: () => {
      for (const handler of [...closeHandlers]) handler();
    },
  };
  connections.push(connection);
  return connection;
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
  connection.emitLine(IDLE);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(IDLE);
  await settleTestGrblHandshake();
}

function installPermit(): {
  readonly permit: FramedRunPermit;
  readonly evidence: LaserModeStartEvidence;
} {
  const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;
  useLaserStore.setState({
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch, observedAt: 1 },
  });
  const state = useLaserStore.getState();
  const permit: FramedRunPermit = {
    kind: 'ready',
    candidate: {} as FramedRunCandidate,
    completedStatusSequence: state.statusSequence,
    controller: framedRunControllerSnapshot(state),
  };
  useLaserStore.setState({
    framedRun: permit,
    frameVerification: { boundsSignature: 'fresh-start', wco: null, workOriginActive: false },
  });
  return {
    permit,
    evidence: createLaserModeStartEvidence(
      captureLaserModeStartSnapshot(state),
      1000,
      false,
      false,
    ),
  };
}

async function beginStart(writes: string[]): Promise<{
  readonly started: Promise<void>;
  readonly permit: FramedRunPermit;
}> {
  const { permit, evidence } = installPermit();
  writes.length = 0;
  const started = useLaserStore.getState().startJob(JOB_GCODE, {
    machineKind: 'laser',
    framedRunPermit: permit,
    laserModeStartEvidence: evidence,
  });
  await flush();
  expect(writes).toEqual(['?']);
  return { started, permit };
}

beforeEach(() => {
  connections = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  for (const connection of connections) connection.emitClose();
  vi.restoreAllMocks();
});

describe('ordinary laser Start fresh-status handoff', () => {
  it('does not create a streamer or send job bytes when the final query is silent', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    const { started } = await beginStart(writes);
    const rejected = expect(started).rejects.toThrow(LASER_LIVE_STATUS_TIMEOUT_MESSAGE);

    await vi.advanceTimersByTimeAsync(3_100);

    await rejected;
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(hasJobBytes(writes)).toBe(false);
  });

  it('does not accept a status report delivered before the query write resolves', async () => {
    vi.useFakeTimers();
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const writes: string[] = [];
    const connection = makeConnection(writes, (data) =>
      data === '?' ? queryGate : Promise.resolve(),
    );
    await connectWith(connection);
    const { started } = await beginStart(writes);
    const rejected = expect(started).rejects.toThrow(LASER_LIVE_STATUS_TIMEOUT_MESSAGE);

    connection.emitLine(IDLE);
    releaseQuery();
    await flush();
    await vi.advanceTimersByTimeAsync(3_100);

    await rejected;
    expect(hasJobBytes(writes)).toBe(false);
  });

  it.each([
    ['Run', '<Run|MPos:31.000,42.000,0.000|FS:600,0>'],
    ['Alarm', '<Alarm|MPos:31.000,42.000,0.000|FS:0,0>'],
  ])('rejects a fresh %s report before streamer creation', async (_state, report) => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    const { started } = await beginStart(writes);

    connection.emitLine(report);

    await expect(started).rejects.toThrow(/Run|Alarm|Frame permit|controller/i);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(hasJobBytes(writes)).toBe(false);
  });

  it('rejects a fresh Idle report from a moved work position', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    const { started } = await beginStart(writes);

    connection.emitLine('<Idle|MPos:32.000,42.000,0.000|FS:0,0>');

    await expect(started).rejects.toThrow(/moved|Frame permit/i);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(hasJobBytes(writes)).toBe(false);
  });

  it('rejects a fresh Idle report whose work-origin identity no longer matches the permit', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    const { started } = await beginStart(writes);

    connection.emitLine('<Idle|MPos:31.000,42.000,0.000|WCO:1.000,0.000,0.000|FS:0,0>');

    await expect(started).rejects.toThrow(/origin|Frame permit/i);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(hasJobBytes(writes)).toBe(false);
  });

  it('rejects when the controller reconnects while the final query is pending', async () => {
    const writes: string[] = [];
    const first = makeConnection(writes);
    await connectWith(first);
    const { started } = await beginStart(writes);

    first.emitClose();
    await expect(started).rejects.toThrow(/cancelled|session|connection/i);
    const second = makeConnection(writes);
    await connectWith(second);

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(hasJobBytes(writes)).toBe(false);
  });

  it('streams only after a matched same-session fresh Idle report', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    const { started } = await beginStart(writes);

    connection.emitLine(IDLE);
    await started;

    expect(useLaserStore.getState().streamer).not.toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(hasJobBytes(writes)).toBe(true);
  });
});

function hasJobBytes(writes: ReadonlyArray<string>): boolean {
  return writes.some((write) => write.includes(JOB_LINE));
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}
