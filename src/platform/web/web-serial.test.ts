import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSerial } from './web-serial';

const originalSerialDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');

class MockReader {
  readonly cancel = vi.fn(async () => undefined);
  readonly releaseLock = vi.fn();
  readonly read: () => Promise<ReadableStreamReadResult<Uint8Array>>;

  constructor(mode: 'pending' | 'done' = 'pending') {
    const doneResult: ReadableStreamReadResult<Uint8Array> = { done: true, value: undefined };
    this.read =
      mode === 'done'
        ? vi.fn(async () => doneResult)
        : vi.fn(
            async () => await new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
          );
  }
}

class MockWriter {
  readonly write = vi.fn(async (_chunk: Uint8Array) => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly releaseLock = vi.fn();
}

class MockPort extends EventTarget implements SerialPort {
  readonly reader: MockReader;
  readonly writer = new MockWriter();
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly open = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly forget = vi.fn(async () => undefined);
  readonly getInfo = vi.fn(() => ({}));

  constructor(readMode: 'pending' | 'done' = 'pending') {
    super();
    this.reader = new MockReader(readMode);
    this.readable = { getReader: () => this.reader } as unknown as ReadableStream<Uint8Array>;
    this.writable = { getWriter: () => this.writer } as unknown as WritableStream<Uint8Array>;
  }

  emitDisconnect(): void {
    this.dispatchEvent(new Event('disconnect'));
  }
}

afterEach(() => {
  if (originalSerialDescriptor === undefined) {
    Reflect.deleteProperty(navigator, 'serial');
  } else {
    Object.defineProperty(navigator, 'serial', originalSerialDescriptor);
  }
  vi.restoreAllMocks();
});

describe('webSerial connection cleanup', () => {
  it('releases reader and writer locks on cable-yank without forgetting the port', async () => {
    const port = installMockSerial(new MockPort());
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('expected port ref');
    const conn = await ref.open({ baudRate: 115200 });
    const onClose = vi.fn();
    conn.onClose(onClose);

    port.emitDisconnect();
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(port.reader.cancel).toHaveBeenCalledTimes(1);
    expect(port.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.writer.close).toHaveBeenCalledTimes(1);
    expect(port.writer.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.close).not.toHaveBeenCalled();
    expect(port.forget).not.toHaveBeenCalled();
  });

  it('releases reader and writer locks when the read loop ends without forgetting the port', async () => {
    const port = installMockSerial(new MockPort('done'));
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('expected port ref');
    await ref.open({ baudRate: 115200 });
    await flushMicrotasks();

    expect(port.reader.cancel).toHaveBeenCalledTimes(1);
    expect(port.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.writer.close).toHaveBeenCalledTimes(1);
    expect(port.writer.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.forget).not.toHaveBeenCalled();
  });

  it('calls forget only on explicit user close', async () => {
    const port = installMockSerial(new MockPort());
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('expected port ref');
    const conn = await ref.open({ baudRate: 115200 });

    await conn.close();

    expect(port.reader.cancel).toHaveBeenCalledTimes(1);
    expect(port.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.writer.close).toHaveBeenCalledTimes(1);
    expect(port.writer.releaseLock).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.forget).toHaveBeenCalledTimes(1);
  });
});

function installMockSerial(port: MockPort): MockPort {
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn(async () => port),
      getPorts: vi.fn(async () => []),
    } satisfies Pick<Serial, 'requestPort' | 'getPorts'>,
  });
  return port;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// M12 (AUDIT-2026-06-10): GRBL extended realtime commands are single raw
// bytes above 0x7F (jog-cancel 0x85, feed/spindle overrides 0x90-0xA2).
// TextEncoder UTF-8-encodes '\x85' into TWO bytes (0xC2 0x85) - vanilla
// GRBL happens to discard unknown high bytes so jog-cancel silently did
// NOTHING, and a firmware that buffers them would corrupt the next line.
describe('webSerial wire encoding (M12)', () => {
  async function openConn(port: MockPort) {
    installMockSerial(port);
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('expected port ref');
    return ref.open({ baudRate: 115200 });
  }

  it('sends realtime bytes above 0x7F as exactly one wire byte', async () => {
    const port = new MockPort();
    const conn = await openConn(port);

    await conn.write('\x85');

    const written = port.writer.write.mock.calls[0]?.[0];
    expect(Array.from(written ?? [])).toEqual([0x85]);
  });

  it('keeps ASCII lines byte-identical to UTF-8', async () => {
    const port = new MockPort();
    const conn = await openConn(port);

    await conn.write('G1 X1 S100\n');

    const written = port.writer.write.mock.calls[0]?.[0];
    expect(Array.from(written ?? [])).toEqual(Array.from(new TextEncoder().encode('G1 X1 S100\n')));
  });

  it('refuses characters that cannot be a single GRBL wire byte', async () => {
    const port = new MockPort();
    const conn = await openConn(port);

    await expect(conn.write('Ω')).rejects.toThrow(/single-byte/i);
  });
});
