import { describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createNativeSerialWorkerRuntime } from './native-serial-worker-runtime';
import { encodeProgramLines } from './serial-program-buffer';
import type { NativeSerialWorkerResponse } from './native-serial-worker-protocol';

const IDENTITY = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
const OPTIONS = { baudRate: 115_200, bufferSize: 4096 };

function deferred() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fakePort(
  options: { opening?: Promise<void>; closing?: Promise<void>; draining?: Promise<void> } = {},
) {
  const bytes: string[] = [];
  const controller: { current?: ReadableStreamDefaultController<Uint8Array> } = {};
  const readable = new ReadableStream<Uint8Array>({
    start(source) {
      controller.current = source;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      bytes.push(new TextDecoder().decode(chunk));
    },
    // The core drains its writer with a bounded close, never a first-move
    // abort (audit transport-4), so a sink that cannot drain is the stall.
    close: () => options.draining,
  });
  const closeLocks: boolean[] = [];
  const port = Object.assign(new EventTarget(), {
    readable,
    writable,
    getInfo: vi.fn(() => IDENTITY),
    open: vi.fn(async (_options: SerialOptions) => {
      await options.opening;
    }),
    close: vi.fn(async () => {
      closeLocks.push(readable.locked || writable.locked);
      await options.closing;
    }),
  }) as SerialPort;
  return {
    port,
    bytes,
    closeLocks,
    push: (text: string) => controller.current?.enqueue(new TextEncoder().encode(text)),
    end: () => controller.current?.close(),
    failRead: () => controller.current?.error(new Error('USB read failed')),
  };
}

function harness(device = fakePort()) {
  const granted = { ports: [device.port] };
  const posted: NativeSerialWorkerResponse[] = [];
  const serial = { getPorts: vi.fn(async () => granted.ports) };
  const runtime = createNativeSerialWorkerRuntime({
    serial,
    post: (message) => posted.push(message),
  });
  return { ...device, granted, posted, serial, runtime };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}

async function probe(h: ReturnType<typeof harness>): Promise<void> {
  h.runtime.handle({ kind: 'native-probe', id: 1, identity: IDENTITY });
  await flush();
}

async function open(h: ReturnType<typeof harness>): Promise<void> {
  await probe(h);
  h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
  await flush();
}

describe('worker-owned native serial transport', () => {
  it('probes without opening, then opens only the exact worker wrapper and starts on request', async () => {
    const h = harness();
    await probe(h);
    expect(h.posted).toEqual([{ kind: 'native-ready', id: 1 }]);
    expect(h.port.open).not.toHaveBeenCalled();

    h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    await flush();
    expect(h.port.open).toHaveBeenCalledExactlyOnceWith(OPTIONS);
    expect(h.serial.getPorts).toHaveBeenCalledTimes(2);
    expect(h.port.readable?.locked).toBe(false);
    h.push('Grbl 1.1h\nok\n');
    await flush();
    expect(h.posted.filter((message) => message.kind === 'line')).toEqual([]);

    h.runtime.handle({ kind: 'native-start' });
    await flush();
    expect(h.posted.filter((message) => message.kind === 'line')).toEqual([
      { kind: 'line', line: 'Grbl 1.1h' },
      { kind: 'line', line: 'ok' },
    ]);
    await h.runtime.close();
    expect(h.closeLocks).toEqual([false]);
  });

  it('refills acknowledged lines in the worker, with one writer and an ordered handover', async () => {
    const h = harness();
    await open(h);
    h.runtime.handle({ kind: 'native-start' });
    const first = step(createStreamer('G1 X1.000\nG1 X2.000\nG1 X3.000\n', { rxBufferBytes: 11 }));
    h.runtime.handle({ kind: 'write', id: 2, data: first.toSend });
    await flush();
    // The program crosses once in its own message (ADR-354 Amendment 3).
    const { queued, ...position } = first.state;
    h.runtime.handle({ kind: 'program', programId: 1, ...encodeProgramLines(queued) });
    h.runtime.handle({ kind: 'prepare-arm', id: 3 });
    h.push('ok\nok\n');
    await flush();
    expect(h.bytes).toEqual(['G1 X1.000\n']);
    h.runtime.handle({ kind: 'arm', id: 3, programId: 1, position });
    await flush();
    expect(h.bytes).toEqual(['G1 X1.000\n', 'G1 X2.000\n', 'G1 X3.000\n']);
    expect(h.posted).toContainEqual({ kind: 'write-ack', id: 2 });
    expect(h.posted.filter((message) => message.kind === 'line')).toHaveLength(2);
    await h.runtime.close();
  });

  it('never opens either device when more than one granted port shares the USB identity', async () => {
    const other = fakePort();
    const h = harness();
    h.granted.ports.push(other.port);
    await probe(h);
    h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    await flush();
    expect(h.posted).toEqual([expect.objectContaining({ kind: 'native-unavailable', id: 1 })]);
    expect(h.port.open).not.toHaveBeenCalled();
    expect(other.port.open).not.toHaveBeenCalled();
  });

  it.each([{}, { usbVendorId: 0x1a86 }, { ...IDENTITY, usbProductId: -1 }])(
    'leaves identity %j unopened because it cannot uniquely identify the selected USB model',
    async (identity) => {
      const h = harness();
      h.runtime.handle({ kind: 'native-probe', id: 1, identity });
      await flush();
      expect(h.posted).toEqual([expect.objectContaining({ kind: 'native-unavailable', id: 1 })]);
      expect(h.serial.getPorts).not.toHaveBeenCalled();
      expect(h.port.open).not.toHaveBeenCalled();
    },
  );

  it('reports unavailable when worker Web Serial is missing', async () => {
    const posted: NativeSerialWorkerResponse[] = [];
    const runtime = createNativeSerialWorkerRuntime({
      serial: null,
      post: (message) => posted.push(message),
    });
    runtime.handle({ kind: 'native-probe', id: 1, identity: IDENTITY });
    await flush();
    expect(posted).toEqual([expect.objectContaining({ kind: 'native-unavailable', id: 1 })]);
  });

  it('leaves the window fallback available if permission enumeration rejects before open', async () => {
    const h = harness();
    h.serial.getPorts.mockRejectedValue(new Error('Permission policy denied serial'));
    await probe(h);
    expect(h.posted).toEqual([expect.objectContaining({ kind: 'native-unavailable', id: 1 })]);
    expect(h.port.open).not.toHaveBeenCalled();
  });

  it.each(['replaced', 'duplicate', 'removed'] as const)(
    'refuses a %s port set at open instead of silently acquiring another owner',
    async (change) => {
      const h = harness();
      const other = fakePort();
      await probe(h);
      h.granted.ports =
        change === 'duplicate' ? [h.port, other.port] : change === 'replaced' ? [other.port] : [];
      h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
      await flush();
      expect(h.posted).toContainEqual(
        expect.objectContaining({ kind: 'native-open-error', id: 1 }),
      );
      expect(h.port.open).not.toHaveBeenCalled();
      expect(other.port.open).not.toHaveBeenCalled();
      expect(h.posted.at(-1)).toEqual({ kind: 'closed' });
    },
  );

  it('ignores stale and duplicated opens so one handshake can acquire at most one port', async () => {
    const h = harness();
    await probe(h);
    h.runtime.handle({ kind: 'native-open', id: 0, options: OPTIONS });
    expect(h.port.open).not.toHaveBeenCalled();
    h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    await flush();
    h.runtime.handle({ kind: 'native-probe', id: 2, identity: IDENTITY });
    h.runtime.handle({ kind: 'native-open', id: 2, options: OPTIONS });
    h.runtime.handle({ kind: 'native-start' });
    h.runtime.handle({ kind: 'native-start' });
    h.runtime.handle({ kind: 'write', id: 4, data: '?' });
    await flush();
    expect(h.port.open).toHaveBeenCalledTimes(1);
    expect(h.bytes).toEqual(['?']);
    expect(h.posted.filter((message) => message.kind === 'native-opened')).toHaveLength(1);
    await h.runtime.close();
  });

  it('rejects early writes without writing any bytes, then accepts them after start', async () => {
    const h = harness();
    await open(h);
    h.runtime.handle({ kind: 'write', id: 5, data: 'G1 X900\n' });
    await flush();
    expect(h.bytes).toEqual([]);
    expect(h.posted).toContainEqual(expect.objectContaining({ kind: 'write-error', id: 5 }));
    h.runtime.handle({ kind: 'native-start' });
    h.runtime.handle({ kind: 'write', id: 6, data: '?' });
    await flush();
    expect(h.bytes).toEqual(['?']);
    await h.runtime.close();
  });

  it('closes an open failure and never falls back to another port', async () => {
    const h = harness();
    vi.mocked(h.port.open).mockRejectedValue(new Error('Native USB open failed'));
    await open(h);
    expect(h.posted).toContainEqual({
      kind: 'native-open-error',
      id: 1,
      message: 'Native USB open failed',
    });
    expect(h.port.open).toHaveBeenCalledTimes(1);
    expect(h.port.close).toHaveBeenCalledTimes(1);
    expect(h.posted.at(-1)).toEqual({ kind: 'closed' });
  });

  it('waits for a pending native open before closing and never advertises that cancelled port', async () => {
    const opening = deferred();
    const h = harness(fakePort({ opening: opening.promise }));
    await open(h);
    const closed = h.runtime.close();
    expect(h.port.close).not.toHaveBeenCalled();
    opening.release();
    await closed;
    expect(h.port.close).toHaveBeenCalledTimes(1);
    expect(h.posted.some((message) => message.kind === 'native-opened')).toBe(false);
    expect(h.posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
  });

  it('releases a partially attached reader if acquiring the writer fails', async () => {
    const h = harness();
    await open(h);
    if (h.port.writable === null) throw new Error('Expected the fake writable stream');
    vi.spyOn(h.port.writable, 'getWriter').mockImplementation(() => {
      throw new Error('Writer allocation failed');
    });
    h.runtime.handle({ kind: 'native-start' });
    await h.runtime.close();
    expect(h.closeLocks).toEqual([false]);
    expect(h.posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
    expect(h.bytes).toEqual([]);
  });

  it('cannot revive a closed session when a delayed permission enumeration settles', async () => {
    const enumeration = deferred();
    const h = harness();
    h.serial.getPorts.mockImplementation(async () => {
      await enumeration.promise;
      return h.granted.ports;
    });
    h.runtime.handle({ kind: 'native-probe', id: 1, identity: IDENTITY });
    await h.runtime.close();
    enumeration.release();
    await flush();
    h.runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    expect(h.port.open).not.toHaveBeenCalled();
    expect(h.posted).toEqual([{ kind: 'native-closing' }, { kind: 'closed' }]);
  });

  it.each(['drain', 'close'] as const)(
    'notifies the client before unsolicited EOF waits on a stalled native %s',
    async (stage) => {
      const blocked = deferred();
      const h = harness(
        fakePort(stage === 'drain' ? { draining: blocked.promise } : { closing: blocked.promise }),
      );
      await open(h);
      h.runtime.handle({ kind: 'native-start' });
      h.end();
      await flush();
      expect(h.posted.filter((message) => message.kind === 'native-closing')).toHaveLength(1);
      expect(h.posted.some((message) => message.kind === 'closed')).toBe(false);
      h.runtime.handle({ kind: 'close' });
      h.runtime.handle({ kind: 'write', id: 5, data: 'G1 X900\n' });
      expect(h.bytes).toEqual([]);
      blocked.release();
      await h.runtime.close();
      expect(h.port.close).toHaveBeenCalledTimes(1);
      expect(h.posted.filter((message) => message.kind === 'native-closing')).toHaveLength(1);
      expect(h.posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
    },
  );

  it('joins a synchronous close response to the early notification without starting cleanup twice', async () => {
    const device = fakePort();
    const posted: NativeSerialWorkerResponse[] = [];
    const runtime = createNativeSerialWorkerRuntime({
      serial: { getPorts: async () => [device.port] },
      post: (message) => {
        posted.push(message);
        if (message.kind === 'native-closing') runtime.handle({ kind: 'close' });
      },
    });
    runtime.handle({ kind: 'native-probe', id: 1, identity: IDENTITY });
    await flush();
    runtime.handle({ kind: 'native-open', id: 1, options: OPTIONS });
    await flush();
    runtime.handle({ kind: 'native-start' });
    device.end();
    await flush();
    await runtime.close();
    expect(device.closeLocks).toEqual([false]);
    expect(posted.filter((message) => message.kind === 'native-closing')).toHaveLength(1);
    expect(posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
  });

  it.each(['eof', 'read-error', 'disconnect', 'explicit'] as const)(
    'closes native ownership after %s only when stream locks and port close have settled',
    async (ending) => {
      const closing = deferred();
      const h = harness(fakePort({ closing: closing.promise }));
      await open(h);
      h.runtime.handle({ kind: 'native-start' });
      if (ending === 'eof') h.end();
      else if (ending === 'read-error') h.failRead();
      else if (ending === 'disconnect') h.port.dispatchEvent(new Event('disconnect'));
      else h.runtime.handle({ kind: 'close' });
      await flush();
      expect(h.closeLocks).toEqual([false]);
      expect(h.posted.some((message) => message.kind === 'closed')).toBe(false);
      closing.release();
      await h.runtime.close();
      h.runtime.handle({ kind: 'close' });
      await h.runtime.close();
      expect(h.port.close).toHaveBeenCalledTimes(1);
      expect(h.posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
    },
  );
});
