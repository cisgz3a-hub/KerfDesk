import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

const CNC_PROGRAM = 'G21\nG90\nM3 S12000\nG1 X1 F300\nM5\n';

function makeConnection(writes: string[], reportMpgOnQuery: boolean): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
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
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
}

function currentAttestation() {
  return createCncSetupAttestation(CNC_PROGRAM, cncControllerEpochOf(useLaserStore.getState()));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
});
