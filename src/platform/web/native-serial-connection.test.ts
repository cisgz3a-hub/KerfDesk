import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryOpenNativeSerialConnection } from './native-serial-connection';
import type {
  NativeSerialWorkerRequest,
  NativeSerialWorkerResponse,
} from './native-serial-worker-protocol';

const identity = { usbVendorId: 0x1a86, usbProductId: 0x7523 };

function port(info: SerialPortInfo = identity) {
  return Object.assign(new EventTarget(), {
    readable: null,
    writable: null,
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    getInfo: () => info,
  }) as SerialPort & { open: ReturnType<typeof vi.fn>; forget: ReturnType<typeof vi.fn> };
}

class TestWorker {
  onmessage: ((event: MessageEvent<NativeSerialWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly terminate = vi.fn();
  readonly requests: NativeSerialWorkerRequest[] = [];
  respond: (request: NativeSerialWorkerRequest) => void = (request) => {
    if (request.kind === 'native-probe') this.reply({ kind: 'native-ready', id: request.id });
    if (request.kind === 'native-open') this.reply({ kind: 'native-opened', id: request.id });
    if (request.kind === 'close') this.reply({ kind: 'closed' });
  };
  postMessage(request: NativeSerialWorkerRequest): void {
    this.requests.push(request);
    this.respond(request);
  }
  reply(message: NativeSerialWorkerResponse): void {
    queueMicrotask(() =>
      this.onmessage?.({ data: message } as MessageEvent<NativeSerialWorkerResponse>),
    );
  }
}

function harness() {
  const selected = port();
  const worker = new TestWorker();
  const serial = { getPorts: vi.fn(async () => [selected]) };
  const createWorker = vi.fn(() => worker as unknown as Worker);
  const open = () =>
    tryOpenNativeSerialConnection({
      port: selected,
      serial,
      createWorker,
      options: { baudRate: 115_200, bufferSize: 4096 },
      timeoutMs: 25,
    });
  return { selected, worker, serial, createWorker, open };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('native serial connection ownership', () => {
  it('opens only in the worker and starts its reader after the client subscribes', async () => {
    const h = harness();
    const connection = await h.open();
    expect(connection?.hostedStreaming).toBeDefined();
    expect(h.selected.open).not.toHaveBeenCalled();
    expect(h.worker.requests).toEqual([
      { kind: 'native-probe', id: 1, identity },
      { kind: 'native-open', id: 1, options: { baudRate: 115_200, bufferSize: 4096 } },
      { kind: 'native-start' },
    ]);
    const onLine = vi.fn();
    connection?.onLine(onLine);
    h.worker.reply({ kind: 'line', line: '<Run|MPos:1,2,0>' });
    await Promise.resolve();
    expect(onLine).toHaveBeenCalledExactlyOnceWith('<Run|MPos:1,2,0>');
    await connection?.close();
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['duplicate', 'missing', 'different', 'identity-less'] as const)(
    'retains the exact picked window port when selection is %s',
    async (reason) => {
      const h = harness();
      if (reason === 'duplicate') h.serial.getPorts.mockResolvedValue([h.selected, port()]);
      if (reason === 'missing') h.serial.getPorts.mockResolvedValue([]);
      if (reason === 'different') h.serial.getPorts.mockResolvedValue([port()]);
      if (reason === 'identity-less') vi.spyOn(h.selected, 'getInfo').mockReturnValue({});
      expect(await h.open()).toBeNull();
      expect(h.createWorker).not.toHaveBeenCalled();
      expect(h.selected.open).not.toHaveBeenCalled();
    },
  );

  it('rechecks window identity after the worker probe before allowing an open', async () => {
    const h = harness();
    h.serial.getPorts.mockResolvedValueOnce([h.selected]).mockResolvedValue([h.selected, port()]);
    expect(await h.open()).toBeNull();
    expect(h.worker.requests.map((request) => request.kind)).toEqual(['native-probe']);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['initial', 'recheck'] as const)(
    'bounds a stalled window enumeration at %s',
    async (stage) => {
      vi.useFakeTimers();
      const h = harness();
      h.serial.getPorts.mockImplementation(() => new Promise(() => undefined));
      if (stage === 'recheck') h.serial.getPorts.mockResolvedValueOnce([h.selected]);
      const opening = h.open();
      await vi.advanceTimersByTimeAsync(50);
      expect(await opening).toBeNull();
      expect(h.selected.open).not.toHaveBeenCalled();
      expect(h.worker.requests.some((request) => request.kind === 'native-open')).toBe(false);
    },
  );

  it('refuses a picker identity that changes after the native probe', async () => {
    const h = harness();
    h.worker.respond = (request) => {
      if (request.kind !== 'native-probe') return;
      vi.spyOn(h.selected, 'getInfo').mockReturnValue({
        usbVendorId: 0x0403,
        usbProductId: 0x6001,
      });
      h.worker.reply({ kind: 'native-ready', id: request.id });
    };
    expect(await h.open()).toBeNull();
    expect(h.worker.requests.some((request) => request.kind === 'native-open')).toBe(false);
  });

  it('falls back only when the worker reports unavailability before opening', async () => {
    const h = harness();
    h.worker.respond = (request) => {
      if (request.kind === 'native-probe')
        h.worker.reply({ kind: 'native-unavailable', id: request.id, reason: 'ambiguous' });
    };
    expect(await h.open()).toBeNull();
    expect(h.worker.requests).toHaveLength(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'messageerror'] as const)(
    'handles an asynchronous startup %s before native open',
    async (kind) => {
      const h = harness();
      h.worker.respond = () =>
        queueMicrotask(() => {
          if (kind === 'error') h.worker.onerror?.();
          else h.worker.onmessageerror?.();
        });
      expect(await h.open()).toBeNull();
      expect(h.worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects native open failure without opening the window port', async () => {
    const h = harness();
    h.worker.respond = (request) => {
      if (request.kind === 'native-probe') h.worker.reply({ kind: 'native-ready', id: request.id });
      if (request.kind === 'native-open')
        h.worker.reply({ kind: 'native-open-error', id: request.id, message: 'Port is in use' });
    };
    await expect(h.open()).rejects.toThrow('Port is in use');
    expect(h.selected.open).not.toHaveBeenCalled();
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['probe', 'open'] as const)(
    'bounds a silent %s without uncertain-owner fallback',
    async (stage) => {
      vi.useFakeTimers();
      const h = harness();
      h.worker.respond = (request) => {
        if (stage === 'open' && request.kind === 'native-probe')
          h.worker.reply({ kind: 'native-ready', id: request.id });
      };
      const opening = h.open();
      const result =
        stage === 'probe'
          ? expect(opening).resolves.toBeNull()
          : expect(opening).rejects.toThrow('did not respond');
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(h.worker.terminate).toHaveBeenCalledTimes(1);
      expect(h.selected.open).not.toHaveBeenCalled();
    },
  );

  it('ignores stale handshake replies instead of opening a port under the wrong request', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.worker.respond = (request) => {
      if (request.kind === 'native-probe') h.worker.reply({ kind: 'native-ready', id: 99 });
    };
    const opening = h.open();
    await vi.advanceTimersByTimeAsync(50);
    expect(await opening).toBeNull();
    expect(h.worker.requests.map((request) => request.kind)).toEqual(['native-probe']);
  });

  it('retires the connection and rejects outstanding writes when its worker crashes', async () => {
    const h = harness();
    const connection = await h.open();
    if (connection === null) throw new Error('expected native transport');
    const closed = vi.fn();
    connection.onClose(closed);
    const writing = connection.write('G1 X1\n');
    const rejected = expect(writing).rejects.toThrow('closed before the write completed');
    h.worker.onerror?.();
    h.worker.onmessageerror?.();
    await rejected;
    await connection.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates after EOF and still revokes the exact selected permission on Forget', async () => {
    const h = harness();
    const connection = await h.open();
    if (connection === null) throw new Error('expected native transport');
    const closed = vi.fn();
    connection.onClose(closed);
    h.worker.reply({ kind: 'closed' });
    await Promise.resolve();
    await connection.close();
    await connection.forget?.();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
    expect(h.selected.forget).toHaveBeenCalledTimes(1);
  });

  it('bounds unsolicited EOF cleanup even if the native close never acknowledges', async () => {
    vi.useFakeTimers();
    const h = harness();
    const connection = await h.open();
    if (connection === null) throw new Error('expected native transport');
    const closed = vi.fn();
    connection.onClose(closed);
    h.worker.respond = () => undefined;
    const pending = expect(connection.write('?')).rejects.toThrow('closed before the write');
    h.worker.reply({ kind: 'native-closing' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(connection.write('G1 X1\n')).rejects.toThrow('not writable');
    expect(h.worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24);
    h.worker.reply({ kind: 'native-closing' });
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    await connection.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
    expect(h.worker.requests.filter((request) => request.kind === 'close')).toHaveLength(1);
  });

  it('waits for native cleanup acknowledgement before terminating and clears its deadline', async () => {
    vi.useFakeTimers();
    const h = harness();
    const connection = await h.open();
    if (connection === null) throw new Error('expected native transport');
    const closed = vi.fn();
    connection.onClose(closed);
    h.worker.respond = () => undefined;
    h.worker.reply({ kind: 'native-closing' });
    await vi.advanceTimersByTimeAsync(10);
    expect(closed).not.toHaveBeenCalled();
    expect(h.worker.terminate).not.toHaveBeenCalled();
    h.worker.reply({ kind: 'closed' });
    await connection.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes EOF cleanup and notifies remaining listeners if one close listener throws', async () => {
    const h = harness();
    const connection = await h.open();
    if (connection === null) throw new Error('expected native transport');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const next = vi.fn();
    connection.onClose(() => {
      throw new Error('broken observer');
    });
    connection.onClose(next);
    h.worker.reply({ kind: 'closed' });
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(1);
    expect(h.worker.terminate).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
