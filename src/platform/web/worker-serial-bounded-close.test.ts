// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { SERIAL_PORT_CLOSE_TIMEOUT_MS } from './serial-port-close';
import type { SerialWorkerResponse } from './serial-worker-protocol';
import { createWorkerSerialConnection } from './worker-serial-connection';
import { webSerial } from './web-serial';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['transferred writer lock', 'native close'] as const)(
  'bounds %s while retaining the selected port through late cleanup and Forget',
  async (stage) => {
    vi.useFakeTimers();
    let releaseClose: () => void = () => undefined;
    const blockedClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const readable = new ReadableStream<Uint8Array>();
    const writable = new WritableStream<Uint8Array>();
    // A real WHATWG stream lock represents the transfer pipe still draining
    // after its worker has replied and terminated (ADR-599).
    const writer = stage === 'transferred writer lock' ? writable.getWriter() : null;
    const port = Object.assign(new EventTarget(), {
      readable: readable as ReadableStream<Uint8Array> | null,
      writable: writable as WritableStream<Uint8Array> | null,
      getInfo: () => ({}),
      forget: vi.fn(async () => undefined),
      open: vi.fn(async () => {
        port.readable = new ReadableStream<Uint8Array>();
        port.writable = new WritableStream<Uint8Array>();
      }),
      close: vi.fn(async () => {
        if (stage === 'native close') await blockedClose;
        expect(port.readable?.locked).not.toBe(true);
        expect(port.writable?.locked).not.toBe(true);
        port.readable = null;
        port.writable = null;
      }),
    });
    vi.stubGlobal('navigator', {
      serial: { getPorts: async () => [], requestPort: async () => port },
    });
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('Expected selected port');
    let respond: (message: SerialWorkerResponse) => void = () => undefined;
    const post = vi.fn();
    const terminate = vi.fn();
    const connection = createWorkerSerialConnection({
      port,
      bridge: {
        postMessage: post,
        onMessage: (handler) => {
          respond = handler;
          return () => undefined;
        },
        terminate,
      },
    });
    const closed = vi.fn();
    connection.onClose(closed);
    const closing = connection.close();
    const closeResult = expect(closing).rejects.toThrow('shutdown timed out');
    // Ownership must already be registered during the handshake, before the
    // worker replies or the port's own close method is reached.
    await expect(ref.open({ baudRate: 115200, hostedStreaming: true })).rejects.toThrow(
      'still closing',
    );
    expect(port.open).not.toHaveBeenCalled();
    expect(port.close).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ kind: 'close' });
    respond({ kind: 'closed' });
    const forgetting = connection.forget!();
    const forgetResult = expect(forgetting).rejects.toThrow('shutdown timed out');
    await vi.advanceTimersByTimeAsync(SERIAL_PORT_CLOSE_TIMEOUT_MS);
    await Promise.all([closeResult, forgetResult]);
    expect(port.forget).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(connection.write('G1 X2\n')).rejects.toThrow('not writable');
    await expect(ref.open({ baudRate: 115200 })).rejects.toThrow('still closing');
    expect(port.open).not.toHaveBeenCalled();
    if (stage === 'transferred writer lock') {
      expect(writable.locked).toBe(true);
      expect(port.close).not.toHaveBeenCalled();
      writer?.releaseLock();
    } else {
      expect(port.close).toHaveBeenCalledTimes(1);
      releaseClose();
    }
    // A long-stalled transfer backs off polling, but actual release must still
    // finish cleanup within its capped polling delay before ownership is reused.
    await vi.advanceTimersByTimeAsync(1_000);
    await connection.forget?.();
    expect(port.forget).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    const replacement = await ref.open({ baudRate: 115200 });
    expect(port.open).toHaveBeenCalledTimes(1);
    await replacement.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  },
);

it('reports failed native close instead of revoking permission as if it succeeded', async () => {
  const forget = vi.fn(async () => undefined);
  const close = vi.fn(async () => {
    throw new Error('Native close failed');
  });
  let respond: (message: SerialWorkerResponse) => void = () => undefined;
  const connection = createWorkerSerialConnection({
    port: {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      close,
      forget,
    },
    bridge: {
      postMessage: (message) => {
        if (message.kind === 'close') respond({ kind: 'closed' });
      },
      onMessage: (handler) => {
        respond = handler;
        return () => undefined;
      },
      terminate: () => undefined,
    },
  });
  await expect(connection.forget?.()).rejects.toThrow('Native close failed');
  expect(forget).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
