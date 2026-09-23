import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadSlice, READ_LOOP_SLICE_MS } from './serial-read-slice';
import { webSerial } from './web-serial';

// ADR-356: a controller backlog (the host fell behind while the machine kept
// answering) used to be dispatched as one task, because a read whose chunk is
// already queued resolves as a microtask. These pin that input, rendering and
// timers get turns while such a backlog drains, without reordering, losing or
// repeating a line.

const originalSerialDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
const BACKLOG_LINES = 400;
const PER_LINE_WORK_MS = 0.1;

class QueuedReader {
  readonly cancel = vi.fn(async () => this.deliver({ done: true, value: undefined }));
  readonly releaseLock = vi.fn();
  private readonly queued: ReadableStreamReadResult<Uint8Array>[] = [];
  private resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;

  // A queued chunk resolves the read without a task boundary, as a Web
  // Serial readable does for bytes Chromium already holds.
  read = vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
      this.resolveRead = resolve;
    });
  });

  push(text: string): void {
    this.deliver({ done: false, value: new TextEncoder().encode(text) });
  }

  private deliver(result: ReadableStreamReadResult<Uint8Array>): void {
    const resolve = this.resolveRead;
    this.resolveRead = undefined;
    if (resolve !== undefined) resolve(result);
    else this.queued.push(result);
  }
}

class QueuedPort extends EventTarget {
  readonly reader = new QueuedReader();
  readonly writer = {
    close: vi.fn(async () => undefined),
    releaseLock: vi.fn(),
    write: vi.fn(async () => undefined),
  };
  readonly readable = { getReader: () => this.reader } as unknown as ReadableStream<Uint8Array>;
  readonly writable = { getWriter: () => this.writer } as unknown as WritableStream<Uint8Array>;
  readonly open = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly getInfo = vi.fn(() => ({}));
}

afterEach(() => {
  if (originalSerialDescriptor === undefined) Reflect.deleteProperty(navigator, 'serial');
  else Object.defineProperty(navigator, 'serial', originalSerialDescriptor);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Browsers run each posted message as its own task, so input, rendering and
// due timers get turns between them; Node drains a chain of MessagePort
// messages in one go. The loop tests therefore run the timer fallback, which
// Node interleaves the way a browser interleaves message tasks.
describe('web serial read loop slicing (ADR-356)', () => {
  beforeEach(() => {
    vi.stubGlobal('MessageChannel', undefined);
  });

  it('lets another task run while a backlog of slow lines drains, keeping every line in order', async () => {
    const { port, connection } = await openQueuedPort();
    const records: string[] = [];
    let recordsWhenTimerRan: number | null = null;
    connection.onLine((line) => {
      busyWait(PER_LINE_WORK_MS);
      records.push(line);
    });

    try {
      setTimeout(() => {
        recordsWhenTimerRan = records.length;
      }, 0);
      port.reader.push(backlog(0, BACKLOG_LINES / 2));
      port.reader.push(backlog(BACKLOG_LINES / 2, BACKLOG_LINES));
      await vi.waitFor(() => expect(records).toHaveLength(BACKLOG_LINES), { timeout: 5_000 });

      expect(recordsWhenTimerRan).not.toBeNull();
      expect(recordsWhenTimerRan).toBeLessThan(BACKLOG_LINES);
      expect(records).toEqual(Array.from({ length: BACKLOG_LINES }, (_, index) => `ok ${index}`));
    } finally {
      await connection.close();
    }
  });

  it('delivers no further lines once the connection is closed during a yield', async () => {
    const { port, connection } = await openQueuedPort();
    const records: string[] = [];
    let recordsAtClose: number | null = null;
    connection.onLine((line) => {
      busyWait(PER_LINE_WORK_MS);
      records.push(line);
    });

    setTimeout(() => {
      recordsAtClose = records.length;
      void connection.close();
    }, 0);
    port.reader.push(backlog(0, BACKLOG_LINES));
    await vi.waitFor(() => expect(port.close).toHaveBeenCalled(), { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recordsAtClose).not.toBeNull();
    expect(recordsAtClose).toBeLessThan(BACKLOG_LINES);
    expect(records).toHaveLength(recordsAtClose ?? -1);
  });
});

describe('createReadSlice', () => {
  it('spends its budget within one task and starts a fresh one after the event loop turns', async () => {
    let clock = 0;
    const slice = createReadSlice(() => clock);
    try {
      clock += READ_LOOP_SLICE_MS;
      slice.resumed();
      expect(slice.spent()).toBe(true);

      await vi.waitFor(() => {
        slice.resumed();
        expect(slice.spent()).toBe(false);
      });
    } finally {
      slice.close();
    }
  });

  it('resumes after a yield on a later task, not within the current one', async () => {
    const slice = createReadSlice(() => 0);
    const order: string[] = [];
    try {
      const yielded = slice.yieldTask().then(() => order.push('resumed'));
      queueMicrotask(() => order.push('microtask'));
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(['microtask']);
      await yielded;
      expect(order).toEqual(['microtask', 'resumed']);
    } finally {
      slice.close();
    }
  });

  it('yields to a later task and restarts the budget', async () => {
    let clock = 0;
    const slice = createReadSlice(() => clock);
    let timerRan = false;
    try {
      clock += READ_LOOP_SLICE_MS;
      setTimeout(() => {
        timerRan = true;
      }, 0);
      await slice.yieldTask();
      expect(slice.spent()).toBe(false);
      await vi.waitFor(() => expect(timerRan).toBe(true));
    } finally {
      slice.close();
    }
  });
});

async function openQueuedPort() {
  const port = new QueuedPort();
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn(async () => port as unknown as SerialPort),
      getPorts: vi.fn(async () => []),
    } satisfies Pick<Serial, 'requestPort' | 'getPorts'>,
  });
  const reference = await webSerial.requestPort();
  if (reference === null) throw new Error('expected a selected serial port');
  const connection = await reference.open({ baudRate: 115_200 });
  return { port, connection };
}

function backlog(from: number, to: number): string {
  let text = '';
  for (let index = from; index < to; index += 1) text += `ok ${index}\n`;
  return text;
}

function busyWait(ms: number): number {
  const until = performance.now() + ms;
  let spins = 0;
  while (performance.now() < until) spins += 1;
  return spins;
}
