// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { webSerial } from './web-serial';
import { SERIAL_PORT_CLOSE_TIMEOUT_MS } from './serial-port-close';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['reader cancellation', 'writer drain', 'native close'] as const)(
  'bounds stalled %s without handing the port to a second owner',
  async (stage) => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = Object.assign(new EventTarget(), {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({}),
      forget: vi.fn(async () => undefined),
      open: vi.fn(async () => {
        port.readable = new ReadableStream<Uint8Array>({
          cancel: () => (stage === 'reader cancellation' ? blocked : undefined),
        });
        port.writable = new WritableStream<Uint8Array>({
          close: () => (stage === 'writer drain' ? blocked : undefined),
        });
      }),
      close: vi.fn(async () => {
        if (stage === 'native close') await blocked;
        port.readable = null;
        port.writable = null;
      }),
    });
    vi.stubGlobal('navigator', {
      serial: { getPorts: async () => [], requestPort: async () => port },
    });
    const ref = await webSerial.requestPort();
    if (ref === null) throw new Error('Expected selected port');
    const connection = await ref.open({ baudRate: 115200 });
    const closed = vi.fn();
    connection.onClose(closed);
    const closing = stage === 'writer drain' ? connection.forget!() : connection.close();
    const result = expect(closing).rejects.toThrow('shutdown timed out');
    await vi.advanceTimersByTimeAsync(SERIAL_PORT_CLOSE_TIMEOUT_MS);
    await result;
    expect(closed).toHaveBeenCalledTimes(1);
    await expect(connection.write('G1 X2\n')).rejects.toThrow('not writable');
    await expect(ref.open({ baudRate: 115200, hostedStreaming: true })).rejects.toThrow(
      'still closing',
    );
    expect(port.open).toHaveBeenCalledTimes(1);
    if (stage !== 'native close') expect(port.writable?.locked).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(port.close).toHaveBeenCalledTimes(1);
    await connection.forget?.();
    expect(port.forget).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    const replacement = await ref.open({ baudRate: 115200 });
    expect(port.open).toHaveBeenCalledTimes(2);
    await replacement.close();
    expect(closed).toHaveBeenCalledTimes(1);
  },
);
