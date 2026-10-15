// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSerial } from './web-serial';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Uses real Streams: abort cannot settle while a sink write is in flight.
// close retains its native ownership until both streams actually finish.
class ClosingPort extends EventTarget {
  opened = false;
  closing = false;
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private source: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly sent: string[] = [];
  readonly blockedWrite = deferred();
  readonly blockedCancel = deferred();
  stallWrite = false;
  stallCancel = false;
  readonly getInfo = () => ({});
  readonly open = vi.fn(async () => {
    if (this.opened) throw new Error('The port is already open.');
    this.opened = true;
    this.readable = new ReadableStream<Uint8Array>({
      start: (source) => {
        this.source = source;
      },
      cancel: () => (this.stallCancel ? this.blockedCancel.promise : undefined),
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (bytes) => {
        if (this.stallWrite) await this.blockedWrite.promise;
        this.sent.push(new TextDecoder().decode(bytes));
      },
    });
  });
  readonly close = vi.fn(async () => {
    if (this.readable?.locked || this.writable?.locked) throw new Error('Streams are locked.');
    if (this.closing) throw new Error('The port is already closing.');
    this.closing = true;
    await Promise.all([this.readable?.cancel(), this.writable?.abort()]);
    this.opened = false;
    this.closing = false;
    this.readable = null;
    this.writable = null;
  });
  emit(text: string): void {
    this.source?.enqueue(new TextEncoder().encode(text));
  }
}

async function connect(port: ClosingPort) {
  vi.stubGlobal('navigator', {
    serial: { getPorts: async () => [port], requestPort: async () => port },
  });
  const ref = (await webSerial.grantedPorts?.())?.[0];
  if (ref === undefined) throw new Error('Expected granted port.');
  return { ref, connection: await ref.open({ baudRate: 115200 }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('main-thread serial teardown', () => {
  it('drops remaining lines from a chunk when a subscriber closes the connection', async () => {
    const port = new ClosingPort();
    const { connection } = await connect(port);
    const lines: string[] = [];
    connection.onLine((line) => {
      lines.push(line);
      void connection.close();
    });
    port.emit('first\nlate\n');
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    await connection.close();
    expect(lines).toEqual(['first']);
  });

  it('reports a bounded failure while retaining a port with an in-flight write', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new ClosingPort();
    port.stallWrite = true;
    const { connection, ref } = await connect(port);
    const onClose = vi.fn();
    connection.onClose(onClose);
    const writing = connection.write('M5\n').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const closing = expect(connection.close()).rejects.toThrow('Serial shutdown timed out');
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      await closing;
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(port.close).not.toHaveBeenCalled();
      // A host deadline cannot claim that the OS released this port.
      expect(port.opened).toBe(true);
      expect(port.closing).toBe(false);
      const reopened = expect(ref.open({ baudRate: 115200 })).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);
      await reopened;
      expect(port.open).toHaveBeenCalledTimes(1);
    } finally {
      port.blockedWrite.resolve();
      await writing;
      await closing;
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(port.opened).toBe(false);
    expect(port.close).toHaveBeenCalledTimes(1);
    port.stallWrite = false;
    const next = await ref.open({ baudRate: 115200 });
    await next.close();
  });

  it('refuses new writes immediately when closing begins', async () => {
    const port = new ClosingPort();
    port.stallCancel = true;
    const { connection } = await connect(port);
    const closing = connection.close();
    try {
      await expect(connection.write('G1 X900\n')).rejects.toThrow('not writable');
      expect(port.sent).toEqual([]);
    } finally {
      port.blockedCancel.resolve();
      await connection.close();
      await closing;
    }
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.opened).toBe(false);
  });

  it('bounds caller waiting while retaining ownership until reader cancellation completes', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new ClosingPort();
    port.stallCancel = true;
    const { connection, ref } = await connect(port);
    const closing = expect(connection.close()).rejects.toThrow('Serial shutdown timed out');
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      await closing;
      expect(port.close).not.toHaveBeenCalled();
      await expect(ref.open({ baudRate: 115200 })).rejects.toThrow('still closing');
      expect(port.open).toHaveBeenCalledTimes(1);
    } finally {
      port.blockedCancel.resolve();
      await connection.close();
      await closing;
    }
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.opened).toBe(false);
  });

  it('makes a second close join the cleanup already in progress', async () => {
    const port = new ClosingPort();
    port.stallCancel = true;
    const { connection } = await connect(port);
    const first = connection.close();
    let secondFinished = false;
    const second = connection.close().then(() => {
      secondFinished = true;
    });
    try {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(secondFinished).toBe(false);
    } finally {
      port.blockedCancel.resolve();
      await Promise.all([first, second]);
    }
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('keeps closing and notifies remaining subscribers when a close subscriber throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = new ClosingPort();
    const { connection } = await connect(port);
    const closed = vi.fn();
    connection.onClose(() => {
      throw new Error('Broken observer.');
    });
    connection.onClose(closed);
    await expect(connection.close()).resolves.toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(port.opened).toBe(false);
  });
});
