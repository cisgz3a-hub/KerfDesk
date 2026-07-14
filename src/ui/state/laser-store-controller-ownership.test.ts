import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const CNC_PROGRAM = 'G21\nG90\nM3 S12000\nG1 X1 F300\nM5\n';

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      writes.push(data);
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
}

function adapter(connection: SerialConnection): PlatformAdapter {
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
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
});

describe('unexpected controller terminal ownership', () => {
  it('waits through a late startup banner before owning the settings query reply', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await useLaserStore.getState().connect(adapter(connection));

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(writes).not.toContain('$$\n');

    connection.emitLine('Grbl 1.1f');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flush();
    expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);

    connection.emitLine('$30=1000');
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().unexpectedTerminalResponse).toBeNull();
  });

  it('latches the first orphan response, invalidates setup once, and survives notice dismissal', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);
    const before = cncControllerEpochOf(useLaserStore.getState());
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: before.workZReference },
      frameVerification: {
        boundsSignature: 'verified-before-orphan',
        wco: null,
        workOriginActive: false,
      },
    });

    connection.emitLine('ok');

    expect(useLaserStore.getState().unexpectedTerminalResponse).toMatchObject({
      kind: 'ok',
      raw: 'ok',
    });
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('controller-ownership');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual({
      trustedPosition: before.trustedPosition + 1,
      workZReference: before.workZReference + 1,
    });

    const afterFirst = cncControllerEpochOf(useLaserStore.getState());
    useLaserStore.getState().clearSafetyNotice();
    connection.emitLine('error:7');
    expect(useLaserStore.getState().unexpectedTerminalResponse).toMatchObject({ kind: 'ok' });
    expect(useLaserStore.getState().lastError).toBe(7);
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual(afterFirst);

    connection.emitLine('Grbl 1.1f');
    expect(useLaserStore.getState().unexpectedTerminalResponse).toMatchObject({ kind: 'ok' });
    await useLaserStore.getState().disconnect();
    expect(useLaserStore.getState().unexpectedTerminalResponse).toBeNull();
  });

  it('accepts a terminal response reserved by an app write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);

    const command = useLaserStore.getState().sendConsoleCommand('$G');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    connection.emitLine('ok');
    await command;

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().unexpectedTerminalResponse).toBeNull();
  });

  it('blocks CNC Start before writing its queue fence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);
    writes.length = 0;
    useLaserStore.setState({
      unexpectedTerminalResponse: { kind: 'ok', raw: 'ok', observedAt: Date.now() },
    });
    const attestation = createCncSetupAttestation(
      CNC_PROGRAM,
      cncControllerEpochOf(useLaserStore.getState()),
    );

    await expect(
      useLaserStore.getState().startJob(CNC_PROGRAM, {
        machineKind: 'cnc',
        cncSetupAttestation: attestation,
      }),
    ).rejects.toThrow(/unowned controller reply/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer).toBeNull();
  });
});
