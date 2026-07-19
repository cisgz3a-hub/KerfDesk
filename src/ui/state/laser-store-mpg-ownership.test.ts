import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import {
  createFramedRunPermit,
  framedRunControllerSnapshot,
  type FramedRunCandidate,
} from './framed-run';
import { respondToStockGrblHandshakeQuery } from './laser-controller-handshake.test-support';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

const CNC_PROGRAM = 'G21\nG90\nM3 S12000\nG1 X1 F300\nM5\n';

function makeConnection(
  writes: string[],
  reportMpgOnQuery: boolean,
  autoRespondToQueries = true,
  reportRunDuringSettle = false,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (respondToStockGrblHandshakeQuery(data, connection.emitLine)) return;
      if (!autoRespondToQueries) return;
      if (data === 'G4 P0.01\n') {
        setTimeout(() => {
          if (reportRunDuringSettle) {
            connection.emitLine('<Run|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
          }
          connection.emitLine('ok');
        }, 0);
      }
      if (data === '?') {
        const mpg = reportMpgOnQuery ? '|MPG:1' : '';
        setTimeout(() => {
          connection.emitLine(`<Idle|MPos:0.000,0.000,0.000|FS:0,0${mpg}|Ov:100,100,100>`);
        }, 0);
      }
    },
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
  await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind: 'grbl-v1.1' });
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
}

function currentAttestation() {
  return createCncSetupAttestation(CNC_PROGRAM, cncControllerEpochOf(useLaserStore.getState()));
}

function framedRunCandidate(): FramedRunCandidate {
  return {
    executionSignature: 'mpg-frame-candidate',
    frameVerification: {
      boundsSignature: '0,0,10,10',
      wco: null,
      workOriginActive: false,
    },
    controllerBeforeFrame: framedRunControllerSnapshot(useLaserStore.getState()),
  } as FramedRunCandidate;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
});

describe('grblHAL MPG ownership at CNC Start', () => {
  it('blocks a latched owner before the queue fence', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, false));
    writes.length = 0;
    useLaserStore.setState({ mpgActive: true });

    await expect(
      useLaserStore.getState().startJob(CNC_PROGRAM, {
        machineKind: 'cnc',
        cncSetupAttestation: currentAttestation(),
      }),
    ).rejects.toThrow(/MPG mode active/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('latches fresh acquisition, invalidates setup once, and requires explicit release', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, true);
    await connectWith(connection);
    writes.length = 0;
    const before = cncControllerEpochOf(useLaserStore.getState());
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: before.workZReference },
      frameVerification: {
        boundsSignature: 'verified-before-mpg',
        wco: null,
        workOriginActive: false,
      },
    });

    await expect(
      useLaserStore.getState().startJob(CNC_PROGRAM, {
        machineKind: 'cnc',
        cncSetupAttestation: currentAttestation(),
      }),
    ).rejects.toThrow(/MPG mode active/i);

    expect(writes).toEqual(['G4 P0.01\n', '?']);
    expect(useLaserStore.getState().mpgActive).toBe(true);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual({
      trustedPosition: before.trustedPosition + 1,
      workZReference: before.workZReference + 1,
    });

    const afterAcquisition = cncControllerEpochOf(useLaserStore.getState());
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');
    expect(useLaserStore.getState().mpgActive).toBe(true);
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual(afterAcquisition);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:0>');
    expect(useLaserStore.getState().mpgActive).toBe(false);
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual(afterAcquisition);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');
    connection.emitLine('Grbl 1.1f');
    expect(useLaserStore.getState().mpgActive).toBeNull();
  });

  it('allows CNC Start after explicit MPG release with a fresh attestation', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, false));
    useLaserStore.setState({ mpgActive: false });
    writes.length = 0;

    await useLaserStore.getState().startJob(CNC_PROGRAM, {
      machineKind: 'cnc',
      cncSetupAttestation: currentAttestation(),
    });

    expect(writes).toContain('G4 P0.01\n');
    expect(writes).toContain('?');
    expect(writes.join('')).toContain('G21');
  });

  it('preserves the exact permit through the owned same-position queue-fence Run', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, false, true, true));
    useLaserStore.setState({ mpgActive: false });
    const candidate = framedRunCandidate();
    const permit = createFramedRunPermit(candidate, useLaserStore.getState());
    useLaserStore.setState({
      framedRun: permit,
      frameVerification: candidate.frameVerification,
    });
    writes.length = 0;

    await useLaserStore.getState().startJob(CNC_PROGRAM, {
      machineKind: 'cnc',
      cncSetupAttestation: currentAttestation(),
      framedRunPermit: permit,
    });

    expect(writes.slice(0, 2)).toEqual(['G4 P0.01\n', '?']);
    expect(writes.join('')).toContain('G21');
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBe(candidate.frameVerification);
  });
});

describe('grblHAL MPG ownership of Jog and Frame transport', () => {
  it('refuses Jog and Frame before writing while MPG owns motion control', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, false);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');
    writes.length = 0;

    await expect(useLaserStore.getState().jog({ dx: 1, feed: 500 })).rejects.toThrow(
      /MPG mode active/i,
    );
    await expect(
      useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 500),
    ).rejects.toThrow(/MPG mode active/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('terminates an active Frame and drops queued legs when MPG takes control', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, false, false);
    useStore.getState().setMachineKind('laser');
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 500, framedRunCandidate());
    expect(writes).toContain('M5\n');
    connection.emitLine('ok');
    await flush();
    expect(writes).toContain('M9\n');
    connection.emitLine('ok');
    await flush();
    expect(writes.filter((line) => line.startsWith('$J='))).toHaveLength(1);

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:500,0|MPG:1>');
    await flush();

    expect(writes.filter((line) => line.startsWith('$J='))).toHaveLength(1);
    expect(useLaserStore.getState().mpgActive).toBe(true);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toMatch(/pendant\/MPG took motion control/i);

    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:0>');
    expect(useLaserStore.getState().framedRun).toBeNull();
  });
});
