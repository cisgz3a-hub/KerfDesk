// The renderer's half of the worker transport (ADR-334), driven through a fake
// bridge. The real `Worker` is not reachable from this environment, so what is
// proven here is the protocol: ordering, the acknowledged handover that keeps
// a single writer, and that no wait can hang a teardown.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';
import {
  createWorkerSerialConnection,
  WORKER_HANDSHAKE_TIMEOUT_MS,
  type SerialWorkerBridge,
} from './worker-serial-connection';

type Harness = {
  readonly connection: ReturnType<typeof createWorkerSerialConnection>;
  readonly sent: Array<{ message: SerialWorkerRequest; transfer: ReadonlyArray<unknown> }>;
  readonly emit: (message: SerialWorkerResponse) => void;
  readonly terminated: () => number;
  readonly closedPort: () => number;
  readonly forgotPort: () => number;
  readonly streams: { readonly readable: ReadableStream; readonly writable: WritableStream };
};

function harness(): Harness {
  const sent: Array<{ message: SerialWorkerRequest; transfer: ReadonlyArray<unknown> }> = [];
  const handlers = new Set<(message: SerialWorkerResponse) => void>();
  const counts = { terminated: 0, closed: 0, forgotten: 0 };
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>();
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
      readable,
      writable,
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
  };
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

  // The invariant the whole design rests on: ownership changes only on the
  // worker's own acknowledgement, so the two sides can never both be writing.
  it('keeps the refill on this side until the worker confirms the arm', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');

    const arming = refill.arm(armedStreamer());
    await Promise.resolve();
    expect(refill.isArmed()).toBe(false);
    expect(h.sent.at(-1)?.message).toMatchObject({ kind: 'arm' });

    h.emit({ kind: 'armed' });
    await arming;
    expect(refill.isArmed()).toBe(true);
  });

  it('leaves the refill with the worker until it confirms the release', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer());
    h.emit({ kind: 'armed' });
    await arming;

    const releasing = refill.release();
    await Promise.resolve();
    expect(refill.isArmed()).toBe(true);

    h.emit({ kind: 'released' });
    await releasing;
    expect(refill.isArmed()).toBe(false);
  });

  it('takes the refill back anyway when the worker stops answering', async () => {
    vi.useFakeTimers();
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer());
    h.emit({ kind: 'armed' });
    await arming;

    const releasing = refill.release();
    await vi.advanceTimersByTimeAsync(WORKER_HANDSHAKE_TIMEOUT_MS + 10);
    await releasing;

    // Better this side writes refills than nobody does.
    expect(refill.isArmed()).toBe(false);
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

  it('treats an unsolicited close as a dropped cable', async () => {
    const h = harness();
    const closed: number[] = [];
    h.connection.onClose(() => closed.push(1));
    const pending = h.connection.write('?');

    h.emit({ kind: 'closed' });

    expect(closed).toEqual([1]);
    await expect(pending).rejects.toThrow('closed before the write completed');
    await expect(h.connection.write('?')).rejects.toThrow('not writable');
  });

  it('revokes the pairing through Forget after letting go of the refill', async () => {
    const h = harness();
    const refill = h.connection.hostedStreaming;
    if (refill === undefined) throw new Error('expected a hosted-refill transport');
    const arming = refill.arm(armedStreamer());
    h.emit({ kind: 'armed' });
    await arming;

    const forgetting = h.connection.forget?.();
    await Promise.resolve();
    h.emit({ kind: 'released' });
    await Promise.resolve();
    h.emit({ kind: 'closed' });
    await forgetting;

    expect(refill.isArmed()).toBe(false);
    expect(h.closedPort()).toBe(1);
    expect(h.forgotPort()).toBe(1);
  });
});
