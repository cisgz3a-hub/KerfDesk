// The run's program on the worker side (ADR-354 Amendment 3): it crosses once
// as transferred buffers, each arm names it and carries only the position, and
// a line is decoded only when the refill reaches it.

import { describe, expect, it } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
import { decodeProgramLines, encodeProgramLines } from './serial-program-buffer';
import { createSerialWorkerCore } from './serial-worker-core';
import type { SerialWorkerResponse, StreamPosition } from './serial-worker-protocol';

function roundTrip(lines: ReadonlyArray<string>): ReadonlyArray<string> | null {
  const view = decodeProgramLines(encodeProgramLines(lines));
  return view === null ? null : [...view];
}

describe('serial program buffers', () => {
  it('reads back every line of a program exactly and in order', () => {
    const { queued } = createStreamer('G21\nG0 X0 Y0\n; skipped\nG1 X1.000 S1000 (burn)\nM5\n');
    expect(roundTrip(queued)).toEqual(queued);
    expect(roundTrip([])).toEqual([]);
  });

  it('keeps lines exact when some need more than one byte a character', () => {
    const lines = ['G1 X1\n', '(café)\n', 'M117 \u{1F525}\n', '﻿G1 X2\n', ''];
    expect(roundTrip(lines)).toEqual(lines);
  });

  it('refuses a program it could not hand over exactly', () => {
    // UTF-8 would turn a lone surrogate into U+FFFD.
    expect(() => encodeProgramLines(['G1 X1\n', 'M117 \uD83D\n'])).toThrow(RangeError);
    expect(() => encodeProgramLines(['G1 X1\n', 7 as unknown as string])).toThrow(TypeError);
  });

  it('answers the reads a refill makes, like the array it came from, and refuses writes', () => {
    const lines = ['G1 X1\n', 'G1 X2\n', 'G1 X3\n'];
    const view = decodeProgramLines(encodeProgramLines(lines));
    if (view === null) throw new Error('Expected a program.');

    expect(view.length).toBe(3);
    expect(view[1]).toBe('G1 X2\n');
    expect(view[3]).toBeUndefined();
    expect(view.slice(1)).toEqual(['G1 X2\n', 'G1 X3\n']);
    expect(Array.isArray(view)).toBe(true);
    expect(1 in view).toBe(true);
    expect(3 in view).toBe(false);
    expect(() => {
      (view as string[])[0] = 'M3 S1000\n';
    }).toThrow(TypeError);
    expect(view[0]).toBe('G1 X1\n');
  });

  it('turns buffers that do not describe a program into no program at all', () => {
    const good = encodeProgramLines(['G1 X1\n', 'G1 X2\n']);
    const offsets = (values: ReadonlyArray<number>) => new Uint32Array(values).buffer;
    expect(decodeProgramLines({ bytes: good.bytes, offsets: new ArrayBuffer(6) })).toBeNull();
    expect(decodeProgramLines({ bytes: good.bytes, offsets: new ArrayBuffer(0) })).toBeNull();
    expect(decodeProgramLines({ bytes: good.bytes, offsets: offsets([1, 6, 12]) })).toBeNull();
    expect(decodeProgramLines({ bytes: good.bytes, offsets: offsets([0, 6, 11]) })).toBeNull();
  });
});

type WorkerHarness = {
  readonly core: ReturnType<typeof createSerialWorkerCore>;
  readonly posted: SerialWorkerResponse[];
  readonly written: string[];
  readonly push: (text: string) => void;
};

function workerHarness(): WorkerHarness {
  const posted: SerialWorkerResponse[] = [];
  const written: string[] = [];
  let feed: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      feed = controller;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
    },
  });
  const core = createSerialWorkerCore({ post: (message) => posted.push(message) });
  core.handle({ kind: 'attach', readable, writable });
  return {
    core,
    posted,
    written,
    push: (text) => feed?.enqueue(new TextEncoder().encode(text)),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Three moves, an 11-byte window: each ok frees room for exactly one line. */
function run(): StreamerState {
  return step(createStreamer('G1 X1.000\nG1 X2.000\nG1 X3.000\n', { rxBufferBytes: 11 })).state;
}

function positionOf(streamer: StreamerState): StreamPosition {
  const { queued: _queued, ...position } = streamer;
  return position;
}

function sendProgram(w: WorkerHarness, programId: number, streamer: StreamerState): void {
  w.core.handle({ kind: 'program', programId, ...encodeProgramLines(streamer.queued) });
}

function arm(w: WorkerHarness, id: number, programId: number, position: StreamPosition): void {
  w.core.handle({ kind: 'prepare-arm', id });
  w.core.handle({ kind: 'arm', id, programId, position });
}

describe('serial worker core: the run program', () => {
  it('refills from the program the arm names, reading only the lines it sends', async () => {
    const w = workerHarness();
    const streamer = run();
    sendProgram(w, 4, streamer);
    arm(w, 1, 4, positionOf(streamer));
    expect(w.posted.at(-1)).toEqual({ kind: 'armed', id: 1 });

    w.push('ok\nok\n');
    await flush();
    expect(w.written).toEqual(['G1 X2.000\n', 'G1 X3.000\n']);
    expect(w.core.armedStreamer()?.completed).toBe(2);
  });

  it('hands the refill straight back when an arm names a program it does not hold', async () => {
    const w = workerHarness();
    const streamer = run();
    sendProgram(w, 4, streamer);
    w.core.handle({ kind: 'prepare-arm', id: 1 });
    // An acknowledgement held at the barrier must reach the main thread after
    // the stop, so the main thread refills from it.
    w.push('ok\n');
    await flush();
    w.core.handle({ kind: 'arm', id: 1, programId: 5, position: positionOf(streamer) });
    await flush();

    expect(w.posted.map((message) => message.kind)).toEqual(['ready', 'refill-stopped', 'line']);
    expect(w.written).toEqual([]);
    expect(w.core.armedStreamer()).toBeNull();
    expect(w.core.heldProgram()).toBeNull();
  });

  it('keeps the program across Pause and refills a Resume from a position alone', async () => {
    const w = workerHarness();
    const streamer = run();
    sendProgram(w, 4, streamer);
    arm(w, 1, 4, positionOf(streamer));
    w.core.handle({ kind: 'release', id: 2 });
    expect(w.posted.at(-1)).toEqual({ kind: 'released', id: 2 });
    expect(w.core.heldProgram()).toBe(4);

    // The first line was acknowledged during the hold; Resume wrote the second.
    const resumed = { ...positionOf(streamer), completed: 1 };
    const inFlight = [{ line: 'G1 X2.000\n', bytes: 10 }];
    arm(w, 3, 4, { ...resumed, queueIndex: 2, inFlight });
    w.push('ok\n');
    await flush();

    expect(w.posted.filter((message) => message.kind === 'armed')).toHaveLength(2);
    expect(w.written).toEqual(['G1 X3.000\n']);
  });

  it('retires the program when it releases a stream that has ended', async () => {
    const w = workerHarness();
    const streamer = run();
    sendProgram(w, 4, streamer);
    arm(w, 1, 4, positionOf(streamer));
    w.push('ok\nok\nok\n');
    await flush();
    expect(w.core.armedStreamer()?.status).toBe('done');

    w.core.handle({ kind: 'release', id: 2 });
    expect(w.posted.at(-1)).toEqual({ kind: 'released', id: 2, retiredProgram: 4 });
    expect(w.core.heldProgram()).toBeNull();
  });

  it('retires the program with the refill when a reset is written', () => {
    const w = workerHarness();
    const streamer = run();
    sendProgram(w, 4, streamer);
    arm(w, 1, 4, positionOf(streamer));

    w.core.handle({ kind: 'write', id: 9, data: '\x18' });
    expect(w.posted).toContainEqual({ kind: 'refill-stopped' });
    expect(w.core.heldProgram()).toBeNull();
  });

  it('holds only the newest program', () => {
    const w = workerHarness();
    sendProgram(w, 4, run());
    sendProgram(w, 5, run());
    expect(w.core.heldProgram()).toBe(5);

    arm(w, 1, 4, positionOf(run()));
    expect(w.posted.at(-1)).toEqual({ kind: 'refill-stopped' });
  });

  it('holds no program from buffers that do not describe one', () => {
    const w = workerHarness();
    w.core.handle({
      kind: 'program',
      programId: 4,
      bytes: new ArrayBuffer(4),
      offsets: new ArrayBuffer(0),
    });
    expect(w.core.heldProgram()).toBeNull();

    arm(w, 1, 4, positionOf(run()));
    expect(w.posted.at(-1)).toEqual({ kind: 'refill-stopped' });
  });
});
