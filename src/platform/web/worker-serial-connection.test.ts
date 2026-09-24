// The renderer's half of the worker transport (ADR-334), driven through a fake
// bridge. The real `Worker` is not reachable from this environment, so what is
// proven here is the protocol: ordering, the acknowledged handover that keeps
// a single writer, and that no wait can hang a teardown.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { WRITER_CLOSE_TIMEOUT_MS } from './bounded-writer-close';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';
import {
  createWorkerSerialConnection,
  WORKER_HANDSHAKE_TIMEOUT_MS,
  type SerialWorkerBridge,
} from './worker-serial-connection';

type PortStreams = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

type Harness = {
  readonly connection: ReturnType<typeof createWorkerSerialConnection>;
  readonly sent: Array<{ message: SerialWorkerRequest; transfer: ReadonlyArray<unknown> }>;
  readonly emit: (message: SerialWorkerResponse) => void;
  readonly terminated: () => number;
  readonly closedPort: () => number;
  readonly forgotPort: () => number;
  readonly streams: { readonly readable: ReadableStream; readonly writable: WritableStream };
  /** What the port's `readable`/`writable` getters return from now on. */
  readonly port: PortStreams;
};

function harness(): Harness {
  const sent: Array<{ message: SerialWorkerRequest; transfer: ReadonlyArray<unknown> }> = [];
  const handlers = new Set<(message: SerialWorkerResponse) => void>();
  const counts = { terminated: 0, closed: 0, forgotten: 0 };
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>();
  const port: PortStreams = { readable, writable };
  const bridge: SerialWorkerBridge = {
    postMessage: (message, transfer) => sent.push({ message, transfer: transfer ?? [] }),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    terminate: () => {
      counts.terminated += 1;
    },
  };
  const connection = createWorkerSerialConnection({
    bridge,
    port: {
      get readable() {
        return port.readable;
      },
      get writable() {
        return port.writable;
      },
      close: async () => {
        counts.closed += 1;
      },
      forget: async () => {
        counts.forgotten += 1;
      },
    },
  });
  return {
    connection,
    sent,
    emit: (message) => {
      for (const handler of [...handlers]) handler(message);
    },
    terminated: () => counts.terminated,
    closedPort: () => counts.closed,
    forgotPort: () => counts.forgotten,
    streams: { readable, writable },
    port,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function armedStreamer() {
  return step(createStreamer('G1 X1.000\nG1 X2.000\n', { rxBufferBytes: 11 })).state;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('worker serial connection (ADR-334)', () => {
  it('hands the port over by transferring both streams', () => {
    const h = harness();

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.message).toMatchObject({ kind: 'attach' });
    expect(h.sent[0]?.transfer).toEqual([h.streams.readable, h.streams.writable]);
  });

  it('resolves a write only once the worker has queued the bytes', async () => {
    const h = harness();
    let resolved = false;

    const write = h.connection.write('?').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    h.emit({ kind: 'write-ack', id: 1 });
    await write;
    expect(resolved).toBe(true);
  });

  it('rejects the write the worker could not send, by its own id', async () => {
    const h = harness();

    const first = h.connection.write('G1 X1\n');
    const second = h.connection.write('G1 X2\n');
    h.emit({ kind: 'write-error', id: 1, message: 'port went away' });
    h.emit({ kind: 'write-ack', id: 2 });

    await expect(first).rejects.toThrow('port went away');
    await expect(second).resolves.toBeUndefined();
  });

  it('delivers lines to every subscriber and survives one that throws', () => {
    const h = harness();
    const seen: string[] = [];
    h.connection.onLine(() => {
      throw new Error('subscriber blew up');
    });
    h.connection.onLine((line) => seen.push(line));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    h.emit({ kind: 'line', line: 'ok' });
    h.emit({ kind: 'line', line: '<Idle|MPos:0,0,0|FS:0,0>' });

    expect(seen).toEqual(['ok', '<Idle|MPos:0,0,0|FS:0,0>']);
  });

  it('keeps the refill on this side until the worker establishes the snapshot barrier', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');

    const arming = refill.arm(armedStreamer);
    await Promise.resolve();
    expect(refill.isArmed()).toBe(false);
    expect(h.sent.at(-1)?.message).toMatchObject({ kind: 'prepare-arm' });

    h.emit({ kind: 'ready', id: 1 });
    h.emit({ kind: 'armed', id: 1 });
    await arming;
    expect(refill.isArmed()).toBe(true);
  });

  it('leaves the refill with the worker until it confirms the release', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer);
    h.emit({ kind: 'ready', id: 1 });
    h.emit({ kind: 'armed', id: 1 });
    await arming;

    const releasing = refill.release();
    await Promise.resolve();
    expect(refill.isArmed()).toBe(true);

    h.emit({ kind: 'released', id: 2 });
    await releasing;
    expect(refill.isArmed()).toBe(false);
  });

  it('closes the transport rather than resuming refill after a release timeout', async () => {
    vi.useFakeTimers();
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer);
    h.emit({ kind: 'ready', id: 1 });
    h.emit({ kind: 'armed', id: 1 });
    await arming;

    const releasing = refill.release();
    await vi.advanceTimersByTimeAsync(WORKER_HANDSHAKE_TIMEOUT_MS + 10);
    await releasing;

    expect(refill.isArmed()).toBe(false);
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(1);
    await expect(h.connection.write('G1 X2\n')).rejects.toThrow('not writable');
  });

  it('reports a failed refill to whoever owns the containment', () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const seen: string[] = [];
    refill.onWriteError((message) => seen.push(message));

    h.emit({ kind: 'stream-write-error', message: 'port went away' });

    expect(seen).toEqual(['port went away']);
  });

  it('closes the port only after the worker has let go of the streams', async () => {
    const h = harness();
    const closed: number[] = [];
    h.connection.onClose(() => closed.push(1));

    const closing = h.connection.close();
    await Promise.resolve();
    expect(h.sent.at(-1)?.message).toEqual({ kind: 'close' });
    expect(h.closedPort()).toBe(0);

    h.emit({ kind: 'closed' });
    await closing;
    expect(h.closedPort()).toBe(1);
    expect(h.terminated()).toBe(1);
    expect(closed).toEqual([1]);
  });

  it('does not let a silent worker hang Disconnect', async () => {
    vi.useFakeTimers();
    const h = harness();

    const closing = h.connection.close();
    await vi.advanceTimersByTimeAsync(WORKER_HANDSHAKE_TIMEOUT_MS + 10);
    await closing;

    expect(h.closedPort()).toBe(1);
    expect(h.terminated()).toBe(1);
  });

  it('cannot re-arm a closing connection through late stop and handover replies', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer);
    h.emit({ kind: 'ready', id: 1 });
    h.emit({ kind: 'armed', id: 1 });
    await arming;
    const closing = h.connection.close();
    await Promise.resolve();
    h.emit({ kind: 'refill-stopped' });
    const sentBeforeRetry = h.sent.length;
    const retry = refill.arm(armedStreamer);
    h.emit({ kind: 'ready', id: 2 });
    h.emit({ kind: 'armed', id: 2 });
    h.emit({ kind: 'released', id: 2 });
    try {
      expect(h.sent).toHaveLength(sentBeforeRetry);
      expect(refill.isArmed()).toBe(false);
      await expect(h.connection.write('G1 X900\n')).rejects.toThrow('not writable');
    } finally {
      h.emit({ kind: 'closed' });
      await Promise.all([closing, retry]);
    }
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(1);
  });

  it('treats an unsolicited close as a dropped cable', async () => {
    const h = harness();
    const closed: number[] = [];
    h.connection.onClose(() => closed.push(1));
    const pending = h.connection.write('?');

    h.emit({ kind: 'closed' });

    expect(closed).toEqual([1]);
    await expect(pending).rejects.toThrow('closed before the write completed');
    await expect(h.connection.write('?')).rejects.toThrow('not writable');
    // The worker ended the session itself, having let go of both streams, so
    // nothing may be left behind: not the worker, and not an open port that
    // the next Connect would find "already open" (audit transport-3).
    await settle();
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(1);
  });

  it('still stops the worker and closes the port once when Disconnect follows a drop', async () => {
    const h = harness();
    h.emit({ kind: 'closed' });

    await h.connection.close();
    await h.connection.close();

    // Disconnect after a drop must not ask the departed worker to close again.
    expect(h.sent.filter((entry) => entry.message.kind === 'close')).toEqual([]);
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(1);
  });

  it('revokes the pairing through Forget after letting go of the refill', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer);
    h.emit({ kind: 'ready', id: 1 });
    h.emit({ kind: 'armed', id: 1 });
    await arming;

    const forgetting = h.connection.forget?.();
    await Promise.resolve();
    h.emit({ kind: 'released', id: 2 });
    await Promise.resolve();
    h.emit({ kind: 'closed' });
    await forgetting;

    expect(refill.isArmed()).toBe(false);
    expect(h.closedPort()).toBe(1);
    expect(h.forgotPort()).toBe(1);
  });
});

// A UART line error leaves the port open with a fresh `port.readable` (Web
// Serial spec, https://serial.spec.whatwg.org/). Only this thread can reach it.
describe('worker serial connection: line errors (audit connect-1)', () => {
  it('hands the fresh port readable to the worker and keeps the session', () => {
    const h = harness();
    const closed: number[] = [];
    h.connection.onClose(() => closed.push(1));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fresh = new ReadableStream<Uint8Array>();
    h.port.readable = fresh;

    h.emit({ kind: 'read-error', name: 'FramingError' });

    expect(h.sent.at(-1)).toEqual({
      message: { kind: 'reattach-readable', readable: fresh },
      transfer: [fresh],
    });
    expect(closed).toEqual([]);
    expect(h.terminated()).toBe(0);
  });

  it('ends the session like a dropped cable when the port has no readable to give', async () => {
    const h = harness();
    const closed: number[] = [];
    h.connection.onClose(() => closed.push(1));
    h.port.readable = null;

    h.emit({ kind: 'read-error', name: 'ParityError' });
    expect(closed).toEqual([1]);
    // The worker still holds the writer, so it is asked to let go first.
    expect(h.sent.at(-1)?.message).toEqual({ kind: 'close' });
    h.emit({ kind: 'closed' });
    await settle();

    expect(h.sent.some((entry) => entry.message.kind === 'reattach-readable')).toBe(false);
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(1);
  });

  it('does not hand over a readable once Disconnect has begun', async () => {
    const h = harness();
    const closing = h.connection.close();

    h.emit({ kind: 'read-error', name: 'BreakError' });
    h.emit({ kind: 'closed' });
    await closing;

    expect(h.sent.some((entry) => entry.message.kind === 'reattach-readable')).toBe(false);
    expect(h.closedPort()).toBe(1);
  });
});

// The worker closing its transferred writer only posts the close across; the
// port's own writable is still sending Disconnect's M5/M9 until the pipe that
// holds it finishes (audit transport-4).
describe('worker serial connection: port drain before close (audit transport-4)', () => {
  it('waits for the port writable to finish before closing the port', async () => {
    const h = harness();
    const writable = new WritableStream<Uint8Array>();
    const pipeHold = writable.getWriter();
    h.port.writable = writable;

    const closing = h.connection.close();
    h.emit({ kind: 'closed' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.terminated()).toBe(1);
    expect(h.closedPort()).toBe(0);

    pipeHold.releaseLock();
    await closing;
    expect(h.closedPort()).toBe(1);
  });

  it('closes the port anyway once the drain deadline passes', async () => {
    vi.useFakeTimers();
    const h = harness();
    const writable = new WritableStream<Uint8Array>();
    writable.getWriter();
    h.port.writable = writable;

    const closing = h.connection.close();
    h.emit({ kind: 'closed' });
    await vi.advanceTimersByTimeAsync(WRITER_CLOSE_TIMEOUT_MS - 20);
    expect(h.closedPort()).toBe(0);
    await vi.advanceTimersByTimeAsync(40);
    await closing;

    expect(h.closedPort()).toBe(1);
  });
});
