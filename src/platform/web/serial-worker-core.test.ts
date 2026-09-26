// The worker's logic, driven with real streams (ADR-334). Nothing here runs
// inside a Worker — that part of the transport has no coverage in this
// environment at all, which is why the logic lives outside the shell.

import { describe, expect, it } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
import { encodeProgramLines } from './serial-program-buffer';
import { MAX_READ_RECOVERIES_WITHOUT_DATA } from './serial-read-recovery';
import { createSerialWorkerCore } from './serial-worker-core';
import type { SerialWorkerResponse } from './serial-worker-protocol';

type Harness = {
  readonly core: ReturnType<typeof createSerialWorkerCore>;
  readonly posted: SerialWorkerResponse[];
  readonly written: string[];
  readonly push: (text: string) => void;
  readonly endStream: () => void;
  readonly failWrites: () => void;
};

function harness(): Harness {
  const posted: SerialWorkerResponse[] = [];
  const written: string[] = [];
  const control: { enqueue?: (bytes: Uint8Array) => void; close?: () => void } = {};
  const sink = { failing: false };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      control.enqueue = (bytes) => controller.enqueue(bytes);
      control.close = () => controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (sink.failing) throw new Error('port went away');
      written.push(new TextDecoder().decode(chunk));
    },
  });
  const core = createSerialWorkerCore({ post: (message) => posted.push(message) });
  core.handle({ kind: 'attach', readable, writable });
  return {
    core,
    posted,
    written,
    push: (text) => control.enqueue?.(new TextEncoder().encode(text)),
    endStream: () => control.close?.(),
    failWrites: () => {
      sink.failing = true;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function streamingJob(rxBufferBytes = 11): StreamerState {
  // An 11-byte window holds exactly one of these lines, so each ok frees room
  // for exactly one refill and the assertions stay readable.
  return step(createStreamer('G1 X1.000\nG1 X2.000\nG1 X3.000\n', { rxBufferBytes })).state;
}

// The program crosses once in its own message; the arm carries only the
// position (ADR-354 Amendment 3).
function armCore(core: Harness['core']): void {
  const { queued, ...position } = streamingJob();
  core.handle({ kind: 'program', programId: 1, ...encodeProgramLines(queued) });
  core.handle({ kind: 'prepare-arm', id: 1 });
  core.handle({ kind: 'arm', id: 1, programId: 1, position });
}

function arm(h: Harness): void {
  armCore(h.core);
}

function lines(posted: ReadonlyArray<SerialWorkerResponse>): ReadonlyArray<string> {
  return posted.flatMap((message) => (message.kind === 'line' ? [message.line] : []));
}

describe('serial worker core (ADR-334)', () => {
  it('forwards every inbound line, in wire order, split across chunks', async () => {
    const h = harness();

    h.push('ok\n<Idle|MPos:0.000,0.000,0.000|FS:0,0>\nerr');
    h.push('or:9\n');
    await flush();

    expect(lines(h.posted)).toEqual(['ok', '<Idle|MPos:0.000,0.000,0.000|FS:0,0>', 'error:9']);
  });

  it('writes nothing until it is armed', async () => {
    const h = harness();

    h.push('ok\nok\n');
    await flush();

    expect(h.written).toEqual([]);
    expect(h.core.armedStreamer()).toBeNull();
  });

  it('refills from an acknowledgement once armed, and still forwards the line', async () => {
    const h = harness();
    arm(h);

    h.push('ok\n');
    await flush();

    expect(h.written).toEqual(['G1 X2.000\n']);
    expect(lines(h.posted)).toEqual(['ok']);
    expect(h.core.armedStreamer()?.completed).toBe(1);
  });

  it('keeps refilling across a burst of acknowledgements, in order', async () => {
    const h = harness();
    arm(h);

    h.push('ok\nok\n');
    await flush();

    expect(h.written).toEqual(['G1 X2.000\n', 'G1 X3.000\n']);
    expect(h.core.armedStreamer()?.completed).toBe(2);
  });

  it('never refills from the tail of an oversized record split across reads', async () => {
    const h = harness();
    arm(h);
    h.push('A'.repeat(65_537));
    await flush();
    h.push('ok\n');
    await flush();

    expect(lines(h.posted)).toEqual([]);
    expect(h.written).toEqual([]);
    expect(h.core.armedStreamer()?.completed).toBe(0);

    // Only a distinct, delimited acknowledgement may advance the job.
    h.push('ok\n');
    await flush();
    expect(lines(h.posted)).toEqual(['ok']);
    expect(h.written).toEqual(['G1 X2.000\n']);
    expect(h.core.armedStreamer()?.completed).toBe(1);
    h.endStream();
    await h.core.readLoop();
  });

  it('acknowledges the handover in both directions and stops writing once released', async () => {
    const h = harness();

    arm(h);
    expect(h.posted.at(-1)).toEqual({ kind: 'armed', id: 1 });

    h.core.handle({ kind: 'release', id: 2 });
    expect(h.posted.at(-1)).toEqual({ kind: 'released', id: 2 });
    expect(h.core.armedStreamer()).toBeNull();

    h.push('ok\n');
    await flush();
    expect(h.written).toEqual([]);
  });

  it('stops refilling when the stream turns terminal', async () => {
    const h = harness();
    arm(h);

    h.push('error:20\n');
    await flush();

    expect(h.written).toEqual([]);
    expect(h.core.armedStreamer()?.status).toBe('errored');
  });

  it('retires the old queue when a reset is written, before its banner arrives', async () => {
    const h = harness();
    arm(h);
    h.core.handle({ kind: 'write', id: 3, data: '\x18' });
    h.push('ok\n');
    await flush();
    expect(h.written).toEqual(['\x18']);
    expect(h.core.armedStreamer()).toBeNull();
    expect(h.posted).toContainEqual({ kind: 'refill-stopped' });
  });

  it('acknowledges a main-thread write and reports its failure against the same id', async () => {
    const h = harness();

    h.core.handle({ kind: 'write', id: 7, data: '?' });
    await flush();
    expect(h.written).toEqual(['?']);
    expect(h.posted).toContainEqual({ kind: 'write-ack', id: 7 });

    h.failWrites();
    h.core.handle({ kind: 'write', id: 8, data: 'G1 X9\n' });
    await flush();
    expect(h.posted).toContainEqual({ kind: 'write-error', id: 8, message: 'port went away' });
  });

  it('reports a failed refill separately, for the containment the main thread owns', async () => {
    const h = harness();
    arm(h);
    h.failWrites();

    h.push('ok\n');
    await flush();

    expect(h.posted).toContainEqual({ kind: 'stream-write-error', message: 'port went away' });
    expect(lines(h.posted)).toEqual(['ok']);
    expect(h.core.armedStreamer()).toBeNull();
    h.push('ok\n');
    await flush();
    expect(h.posted.filter((message) => message.kind === 'stream-write-error')).toHaveLength(1);
  });

  it('reports the port closing when the read stream ends', async () => {
    const h = harness();

    h.endStream();
    await h.core.readLoop();

    expect(h.posted.at(-1)).toEqual({ kind: 'closed' });
  });

  it('releases the stream locks on close, so the owner can close the port', async () => {
    const h = harness();
    arm(h);

    h.core.handle({ kind: 'close' });
    await flush();

    expect(h.core.armedStreamer()).toBeNull();
    expect(h.posted.at(-1)).toEqual({ kind: 'closed' });
    // A cancelled reader ends the loop rather than hanging it.
    await h.core.readLoop();
  });

  // The writer is drained with a bounded close, not aborted (audit
  // transport-4), so a drain that has not settled is what 'closed' must await.
  it('does not announce EOF closure before an asynchronous writable drain releases its lock', async () => {
    let releaseDrain = (): void => undefined;
    const draining = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const readable = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    const writable = new WritableStream<Uint8Array>({ close: () => draining });
    const posted: SerialWorkerResponse[] = [];
    const core = createSerialWorkerCore({ post: (message) => posted.push(message) });
    core.handle({ kind: 'attach', readable, writable });
    await flush();
    expect(posted).not.toContainEqual({ kind: 'closed' });
    expect(writable.locked).toBe(true);
    releaseDrain();
    await core.readLoop();
    await core.close();
    expect(readable.locked || writable.locked).toBe(false);
    expect(posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
  });
});

// A stream the test can fail, standing in for the transferred port readable.
function failingReadable(): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly push: (text: string) => void;
  readonly fail: (name: string) => void;
} {
  let control: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      control = controller;
    },
  });
  return {
    readable,
    push: (text) => control?.enqueue(new TextEncoder().encode(text)),
    fail: (name) => control?.error(new DOMException(`${name} (simulated)`, name)),
  };
}

function attachedTo(readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>) {
  const posted: SerialWorkerResponse[] = [];
  const core = createSerialWorkerCore({ post: (message) => posted.push(message) });
  core.handle({ kind: 'attach', readable, writable });
  return { core, posted };
}

describe('serial worker core: how the read side ends (audits connect-1, transport-3/4)', () => {
  it('asks for a fresh readable after a UART line error, keeping the writer and the refill', async () => {
    const first = failingReadable();
    const written: string[] = [];
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        written.push(new TextDecoder().decode(chunk));
      },
    });
    const w = attachedTo(first.readable, writable);
    armCore(w.core);

    first.fail('FramingError');
    await w.core.readLoop();
    expect(w.posted.at(-1)).toEqual({ kind: 'read-error', name: 'FramingError' });
    expect(w.posted).not.toContainEqual({ kind: 'closed' });
    expect(writable.locked).toBe(true);

    const second = failingReadable();
    w.core.handle({ kind: 'reattach-readable', readable: second.readable });
    second.push('ok\n');
    await flush();

    expect(lines(w.posted)).toEqual(['ok']);
    expect(written).toEqual(['G1 X2.000\n']);
    expect(w.core.armedStreamer()?.completed).toBe(1);
  });

  it('drops the record a line error cut short instead of gluing it to the next stream', async () => {
    const first = failingReadable();
    const w = attachedTo(first.readable, new WritableStream<Uint8Array>());
    first.push('<Idle|MPos:1.');
    await flush();
    first.fail('ParityError');
    await w.core.readLoop();

    const second = failingReadable();
    w.core.handle({ kind: 'reattach-readable', readable: second.readable });
    second.push('9,0,0>\nok\n');
    await flush();

    // Bytes went missing at the error, so the halves joined would read as a
    // plausible but wrong position report ('<Idle|MPos:1.9,0,0>'). The tail
    // alone is not a status report at all.
    expect(lines(w.posted)).toEqual(['9,0,0>', 'ok']);
  });

  it('lets go of both streams before reporting that its read side ended', async () => {
    const source = failingReadable();
    const writable = new WritableStream<Uint8Array>();
    const posted: Array<{ message: SerialWorkerResponse; writableLocked: boolean }> = [];
    const core = createSerialWorkerCore({
      post: (message) => posted.push({ message, writableLocked: writable.locked }),
    });
    core.handle({ kind: 'attach', readable: source.readable, writable });

    source.fail('NetworkError');
    await core.readLoop();
    await flush();

    // A port whose writable is still locked cannot be closed, and the next
    // Connect to it throws "The port is already open" (audit transport-3).
    expect(posted.at(-1)).toEqual({ message: { kind: 'closed' }, writableLocked: false });
    expect(source.readable.locked).toBe(false);
  });

  it('treats line errors as final once fresh streams keep failing without a byte', async () => {
    let current = failingReadable();
    const w = attachedTo(current.readable, new WritableStream<Uint8Array>());
    let recoveries = 0;
    for (;;) {
      current.fail('BreakError');
      await w.core.readLoop();
      await flush();
      if (w.posted.at(-1)?.kind !== 'read-error') break;
      recoveries += 1;
      current = failingReadable();
      w.core.handle({ kind: 'reattach-readable', readable: current.readable });
    }

    expect(recoveries).toBe(MAX_READ_RECOVERIES_WITHOUT_DATA);
    expect(w.posted.at(-1)).toEqual({ kind: 'closed' });
  });

  it('closes its writer on Disconnect rather than aborting it, so queued bytes still drain', async () => {
    // Streams spec: abort() discards every chunk still queued, and Chromium's
    // serial sink implements it as a transmit-buffer flush; close() drains.
    const sinkCalls: string[] = [];
    const writable = new WritableStream<Uint8Array>({
      close: () => {
        sinkCalls.push('close');
      },
      abort: () => {
        sinkCalls.push('abort');
      },
    });
    const w = attachedTo(failingReadable().readable, writable);

    w.core.handle({ kind: 'close' });
    await flush();

    expect(sinkCalls).toEqual(['close']);
    expect(w.posted.at(-1)).toEqual({ kind: 'closed' });
  });

  it('still lets go of a replacement readable that crosses with Disconnect', async () => {
    const w = attachedTo(failingReadable().readable, new WritableStream<Uint8Array>());
    w.core.handle({ kind: 'close' });
    await flush();
    let cancelled = false;
    const late = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
    });

    w.core.handle({ kind: 'reattach-readable', readable: late });
    await flush();

    expect(cancelled).toBe(true);
    expect(w.posted.filter((message) => message.kind === 'closed')).toHaveLength(1);
  });
});
