import { afterEach, describe, expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { useLaserStore } from './laser-store';

function deferredConnection(capture: (release: () => void) => void): SerialConnection {
  return {
    write: async () => {
      await new Promise<void>((resolve) => capture(resolve));
    },
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function zeroZConnection(capture: (release: () => void) => void): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      if (data.includes('G92 Z0')) await new Promise<void>((resolve) => capture(resolve));
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
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ pendingTransportWrites: 0, pendingUntrackedAcks: 0 });
});

describe('safe-write transport epochs', () => {
  it('does not let an old-session completion erase a new in-flight write', async () => {
    let releaseOld: () => void = () => undefined;
    let releaseNew: () => void = () => undefined;
    const refs: SafeWriteRefs = {
      connection: deferredConnection((release) => {
        releaseOld = release;
      }),
      driver: grblDriver,
      nextTranscriptId: 1,
      writeEpoch: 0,
    };
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);

    const oldWrite = write('G1 X1\n');
    const oldFailure = expect(oldWrite).rejects.toThrow(/serial session changed/i);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    refs.writeEpoch = 1;
    useLaserStore.setState({ pendingTransportWrites: 0, pendingUntrackedAcks: 0 });
    refs.connection = deferredConnection((release) => {
      releaseNew = release;
    });
    const newWrite = write('G1 X2\n');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    releaseOld();
    await oldFailure;
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    releaseNew();
    await newWrite;
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
  });

  it('owns a fast terminal response that arrives before the transport promise resolves', async () => {
    let release: () => void = () => undefined;
    const refs: SafeWriteRefs = {
      connection: deferredConnection((resolve) => {
        release = resolve;
      }),
      driver: grblDriver,
      nextTranscriptId: 1,
      writeEpoch: 0,
    };
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);

    const pending = write('G1 X3\n');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    useLaserStore.setState((state) => ({
      pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - 1),
    }));
    release();
    await pending;

    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('does not reassert work-Z evidence when a reset overtakes deferred G92 Z0', async () => {
    let releaseZero: () => void = () => undefined;
    const connection = zeroZConnection((release) => {
      releaseZero = release;
    });
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    const zeroing = useLaserStore.getState().zeroZHere();
    const zeroFailure = expect(zeroing).rejects.toThrow(
      /serial session changed|controller rebooted/i,
    );
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    const previousEpoch = useLaserStore.getState().workZReferenceEpoch;

    connection.emitLine('Grbl 1.1f');
    await flush();
    expect(useLaserStore.getState().workZReferenceEpoch).toBe(previousEpoch + 1);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();

    releaseZero();
    await zeroFailure;
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });
});
