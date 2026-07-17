import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect. Answer
      // ONLY the handshake's $G (controllerOperation is still the connection
      // handshake): an operator console $G lands with no active operation and
      // drives its own reply, so it must not be auto-answered here.
      if (
        data === '$G\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => emit(line),
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
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
});

describe('ordinary controller terminal responses', () => {
  it('waits through a late startup banner before owning the settings query reply', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await useLaserStore.getState().connect(adapter(connection));

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(writes).not.toContain('$$\n');

    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flush();
    expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);

    connection.emitLine('$30=1000');
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('ignores an unsolicited ok without invalidating setup or blocking jog', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);
    const before = cncControllerEpochOf(useLaserStore.getState());
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: before.workZReference },
      frameVerification: {
        boundsSignature: 'verified-before-ok',
        wco: null,
        workOriginActive: false,
      },
    });

    connection.emitLine('ok');

    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();
    expect(useLaserStore.getState().frameVerification).not.toBeNull();
    expect(cncControllerEpochOf(useLaserStore.getState())).toEqual(before);

    writes.length = 0;
    await useLaserStore.getState().jog({ dx: 5, feed: 1000 });
    expect(writes).toContain('$J=G91 G21 X5.000 F1000\n');
  });

  it('still settles a terminal response reserved by an app write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);

    const command = useLaserStore.getState().sendConsoleCommand('$G');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    connection.emitLine('ok');
    await command;

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});
