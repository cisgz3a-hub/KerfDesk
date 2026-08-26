import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

function makeConnection(
  writes: string[],
  onWrite?: (data: string) => Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emitLine = (line: string): void => {
    for (const handler of [...lineHandlers]) handler(line);
  };
  return {
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

async function beginAutofocus(
  connection: FakeConnection,
  writes: string[],
): Promise<{
  readonly pending: ReturnType<ReturnType<typeof useLaserStore.getState>['autofocus']>;
}> {
  const pending = useLaserStore.getState().autofocus('$HZ1');
  await flush();
  expect(writes.at(-1)).toBe('?');
  expect(writes).not.toContain('$HZ1\n');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  expect(writes.at(-1)).toBe('$HZ1\n');
  return { pending };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  if (useLaserStore.getState().connection.kind === 'connected') {
    await useLaserStore.getState().disconnect();
  }
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
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    framedRun: null,
    frameVerification: null,
    log: [],
    transcript: [],
  });
  vi.restoreAllMocks();
});

describe('store autofocus shared response ownership', () => {
  it('expires a completed Frame permit before autofocus can dispatch', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({
      framedRun: { kind: 'ready' } as ReturnType<typeof useLaserStore.getState>['framedRun'],
      frameVerification: {
        boundsSignature: 'autofocus-expiry',
        wco: null,
        workOriginActive: false,
      },
    });

    const { pending } = await beginAutofocus(connection, writes);

    expect(writes).toEqual(['?', '$HZ1\n']);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await pending;
  });

  it('tracks the command in the shared ledger and keeps status on the main line pump', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;

    const { pending } = await beginAutofocus(connection, writes);

    expect(writes).toEqual(['?', '$HZ1\n']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().autofocusBusy).toBe(true);
    expect(
      useLaserStore.getState().transcript.find((entry) => entry.raw === '$HZ1\n'),
    ).toMatchObject({ direction: 'out', source: 'motion' });

    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().autofocusBusy).toBe(true);

    connection.emitLine('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await pending).kind).toBe('ok');
    expect(useLaserStore.getState().statusReport?.mPos?.z).toBe(-8);
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
  });

  it('consumes an autofocus error without routing it into stream-error handling', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    const { pending } = await beginAutofocus(connection, writes);
    connection.emitLine('error:20');

    expect(await pending).toEqual({ kind: 'rejected', errorCode: 20, raw: 'error:20' });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'controller-error',
      code: 20,
      rejectedLine: '$HZ1',
    });
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
  });

  it('refuses to start while a previous controller response is still owed', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({ pendingUntrackedAcks: 1 });

    const result = await useLaserStore.getState().autofocus('$HZ1');

    expect(result.kind).toBe('preflight-failed');
    if (result.kind === 'preflight-failed') expect(result.reason).toMatch(/previous controller/i);
    expect(writes).not.toContain('$HZ1\n');
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
  });

  it('cancels promptly on physical close instead of waiting for the autofocus timeout', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    const pending = useLaserStore.getState().autofocus('$HZ1');
    await flush();
    connection.emitClose();

    expect((await pending).kind).toBe('preflight-failed');
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('keeps the owed ack after timeout so a late app response remains attributable', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    const { pending } = await beginAutofocus(connection, writes);
    await vi.advanceTimersByTimeAsync(15_100);

    expect((await pending).kind).toBe('timeout');
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'autofocus',
      phase: 'motion-uncertain',
    });

    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'autofocus',
      phase: 'motion-uncertain',
    });
    connection.emitLine('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().statusReport?.mPos?.z).toBe(-8);
  });

  it('does not dispatch from a null or stale cached status without a post-query report', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({ statusReport: null, statusObservation: null });

    const pending = useLaserStore.getState().autofocus('$HZ1');
    await flush();
    expect(writes).toEqual(['?']);
    await vi.advanceTimersByTimeAsync(3_100);

    const result = await pending;
    expect(result.kind).toBe('preflight-failed');
    expect(writes).not.toContain('$HZ1\n');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('rejects a fresh non-Idle report without dispatching autofocus motion', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;

    const pending = useLaserStore.getState().autofocus('$HZ1');
    await flush();
    connection.emitLine('<Run|MPos:0.000,0.000,-1.000|FS:500,0>');

    const result = await pending;
    expect(result.kind).toBe('preflight-failed');
    expect(writes).toEqual(['?']);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('keeps uncertain ownership after early ok without a later Idle', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;
    const { pending } = await beginAutofocus(connection, writes);

    connection.emitLine('ok');
    await flush();
    await vi.advanceTimersByTimeAsync(15_100);

    expect((await pending).kind).toBe('timeout');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'autofocus',
      phase: 'motion-uncertain',
    });
    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await disconnect;
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('clears cached status and retains ownership when the autofocus write is uncertain', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, async (data) => {
      if (data === '$HZ1\n') throw new Error('USB write receipt is unknown.');
    });
    await connectWith(connection);
    writes.length = 0;

    const { pending } = await beginAutofocus(connection, writes);

    expect(await pending).toEqual({
      kind: 'motion-uncertain',
      reason: 'USB write receipt is unknown.',
    });
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'autofocus',
      phase: 'motion-uncertain',
    });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}
