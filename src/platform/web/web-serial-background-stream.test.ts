import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { handleLine } from '../../ui/state/laser-line-handler';
import { makeLineHandlerHarness } from '../../ui/state/laser-line-handler.test-support';
import { createSafeWrite } from '../../ui/state/laser-safe-write';
import { webSerial } from './web-serial';

const originalSerialDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');

afterEach(() => {
  if (originalSerialDescriptor === undefined) Reflect.deleteProperty(navigator, 'serial');
  else Object.defineProperty(navigator, 'serial', originalSerialDescriptor);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('background Web Serial refill', () => {
  it('reads and refills an image-like stream while hidden without running timers or animation frames', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const animation = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const written: string[] = [];
    const source: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const port = Object.assign(new EventTarget(), {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          source.controller = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(bytes) {
          written.push(new TextDecoder().decode(bytes));
        },
      }),
      open: async () => undefined,
      close: async () => undefined,
      getInfo: () => ({}),
    });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: async () => port as unknown as SerialPort,
        getPorts: async () => [],
      },
    });
    const selected = await webSerial.requestPort();
    if (selected === null) throw new Error('expected selected serial port');
    const connection = await selected.open({ baudRate: 115_200 });
    const h = makeLineHandlerHarness();
    const refs = { ...h.refs, connection, nextTranscriptId: 1 };
    const safeWrite = createSafeWrite(h.set, h.get, refs);
    connection.onLine((line) => handleLine(h.set, h.get, refs, safeWrite, line));
    const lines = Array.from(
      { length: 30 },
      (_, i) => `G1 X${((i + 1) / 10).toFixed(3)} S${i % 2 === 0 ? 0 : 1000}\n`,
    );
    const first = step(createStreamer(lines.join(''), { rxBufferBytes: 20 }));
    h.set({ streamer: first.state, activeJobMachineKind: 'laser' });
    await safeWrite(first.toSend, undefined, 'job');
    const initialTimerCount = vi.getTimerCount();

    try {
      for (let acknowledged = 1; acknowledged <= 20; acknowledged++) {
        source.controller?.enqueue(new TextEncoder().encode('ok\n'));
        for (let turn = 0; turn < 30; turn++) await Promise.resolve();
        expect(h.get().streamer?.completed).toBe(acknowledged);
      }

      expect(h.get().streamer?.status).toBe('streaming');
      expect(written.join('')).toBe(lines.slice(0, 21).join(''));
      expect(animation).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(initialTimerCount);
    } finally {
      await connection.close();
    }
  });
});
