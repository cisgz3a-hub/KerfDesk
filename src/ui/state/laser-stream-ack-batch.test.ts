import { describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import type { SafeWriteFn } from './laser-line-shared';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function program(next: () => number, lines: number): string {
  return Array.from({ length: lines }, (_, index) => {
    const x = (next() * 200).toFixed(Math.floor(next() * 4));
    return next() < 0.1 ? `G1X${x}Y${index}S${Math.floor(next() * 1000)}F3000` : `G1X${x}`;
  }).join('\n');
}

// A controller that acknowledges written lines in order, in chunks.
function streamHarness(gcode: string, rxBufferBytes: number) {
  const { refs, set, get } = makeLineHandlerHarness();
  const wire: string[] = [];
  const setCalls = { count: 0 };
  const countingSet: typeof set = (partial) => {
    setCalls.count += 1;
    set(partial);
  };
  const safeWrite = vi.fn<SafeWriteFn>(async (line) => {
    wire.push(line);
  });
  const first = step(createStreamer(gcode, { rxBufferBytes }));
  set({ streamer: first.state });
  wire.push(first.toSend);
  let acked = 0;
  const outstanding = (): number =>
    wire
      .join('')
      .split('\n')
      .filter((line) => line !== '').length - acked;
  const deliver = (lines: ReadonlyArray<string>): void => {
    for (const line of lines) {
      if (line === 'ok') acked += 1;
      handleLine(countingSet, get, refs, safeWrite, line);
    }
  };
  return { get, set, wire, setCalls, safeWrite, outstanding, deliver };
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Streams one seeded job twice: acknowledgements in random chunks, and the same
// acknowledgements one per task (the pre-batching behaviour).
async function streamBothWays(seed: number) {
  const next = random(seed);
  const gcode = program(next, 150 + Math.floor(next() * 250));
  const rx = [120, 256, 1024][seed % 3] ?? 120;
  const chunked = streamHarness(gcode, rx);
  const single = streamHarness(gcode, rx);
  const chooser = random(seed * 7919);
  for (let guard = 0; guard < 5000 && chunked.outstanding() > 0; guard += 1) {
    const size = Math.min(chunked.outstanding(), 1 + Math.floor(chooser() * 24));
    const lines = Array.from({ length: size }, () => 'ok');
    chunked.deliver(lines);
    await drainMicrotasks();
    for (const line of lines) {
      single.deliver([line]);
      await drainMicrotasks();
    }
  }
  return { chunked, single };
}

function streamSummary(stream: ReturnType<typeof streamHarness>) {
  const streamer = stream.get().streamer;
  return {
    wire: stream.wire.join(''),
    status: streamer?.status,
    completed: streamer?.completed,
    queueIndex: streamer?.queueIndex,
  };
}

describe('stream acknowledgements applied per chunk (ADR-352)', () => {
  it('writes the same bytes and reaches the same stream state as one ack at a time', async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { chunked, single } = await streamBothWays(seed);
      expect(streamSummary(chunked)).toEqual(streamSummary(single));
      expect(chunked.get().streamer?.status).toBe('done');
      expect(chunked.setCalls.count).toBeLessThan(single.setCalls.count);
    }
  });

  it('holds a chunk of acks for one store write, then applies them all', async () => {
    const stream = streamHarness(program(random(3), 400), 1024);
    const before = stream.get().streamer;
    const writesBefore = stream.setCalls.count;
    stream.deliver(Array.from({ length: 12 }, () => 'ok'));
    // Nothing observable happened inside the chunk...
    expect(stream.get().streamer).toBe(before);
    await drainMicrotasks();
    // ...and the whole chunk landed as one streamer write and one refill.
    expect(stream.get().streamer?.completed).toBe(12);
    const streamerWrites = stream.setCalls.count - writesBefore;
    expect(streamerWrites).toBeLessThanOrEqual(2);
    expect(stream.safeWrite).toHaveBeenCalledTimes(1);
  });

  it('applies held acks before any other line in the chunk is handled', () => {
    const stream = streamHarness(program(random(5), 400), 1024);
    stream.deliver(['ok', 'ok', 'ok']);
    expect(stream.get().streamer?.completed).toBe(0);
    stream.deliver(['<Run|MPos:1.000,2.000,0.000|FS:3000,0>']);
    expect(stream.get().streamer?.completed).toBe(3);
  });

  it('does not hold an ack while an untracked acknowledgement is owed', () => {
    // Owed untracked acks make ownership depend on the streamer, so every ok is
    // applied the moment it is handled.
    const stream = streamHarness(program(random(9), 400), 1024);
    stream.set({ pendingUntrackedAcks: 1 });
    stream.deliver(['ok']);
    expect(stream.get().streamer?.completed).toBe(1);
  });

  it('finishes a job inside one chunk exactly as one ack at a time does', async () => {
    const gcode = ['G1X1', 'G1X2', 'G1X3'].join('\n');
    const chunked = streamHarness(gcode, 1024);
    const single = streamHarness(gcode, 1024);
    chunked.deliver(['ok', 'ok', 'ok']);
    await drainMicrotasks();
    for (const line of ['ok', 'ok', 'ok']) {
      single.deliver([line]);
      await drainMicrotasks();
    }
    expect(chunked.get().streamer?.status).toBe('done');
    expect(chunked.safeWrite.mock.calls).toEqual(single.safeWrite.mock.calls);
  });
});
