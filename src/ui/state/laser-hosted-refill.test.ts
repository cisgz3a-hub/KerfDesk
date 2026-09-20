import { describe, expect, it, vi } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import {
  armHostedRefill,
  hostedRefill,
  hostedRefillArmed,
  releaseHostedRefill,
} from './laser-hosted-refill';
import { advanceStream } from './laser-stream-ack';
import type { SafeWriteFn } from './laser-line-shared';

type FakeRefill = HostedStreamRefill & {
  readonly armCalls: () => ReadonlyArray<StreamerState>;
  readonly releaseCalls: () => number;
  readonly setArmed: (armed: boolean) => void;
};

function fakeRefill(): FakeRefill {
  const state = { armed: false, releases: 0 };
  const armed: StreamerState[] = [];
  return {
    isArmed: () => state.armed,
    arm: async (streamer) => {
      armed.push(streamer as StreamerState);
      state.armed = true;
    },
    release: async () => {
      state.releases += 1;
      state.armed = false;
    },
    onWriteError: () => () => undefined,
    armCalls: () => armed,
    releaseCalls: () => state.releases,
    setArmed: (value) => {
      state.armed = value;
    },
  };
}

function connectionWith(refill: HostedStreamRefill | undefined): SerialConnection {
  return {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
    ...(refill === undefined ? {} : { hostedStreaming: refill }),
  };
}

/** An 11-byte window: one line in flight, one refill due per acknowledgement. */
function streamingJob(lineCount = 3): StreamerState {
  const gcode = Array.from({ length: lineCount }, (_, i) => `G1 X${i + 1}.000`).join('\n');
  return step(createStreamer(gcode, { rxBufferBytes: 11 })).state;
}

describe('hosted refill helpers (ADR-334)', () => {
  it('treats a transport without hosting as this side writing refills', async () => {
    expect(hostedRefill({})).toBeNull();
    expect(hostedRefill({ connection: connectionWith(undefined) })).toBeNull();
    expect(hostedRefillArmed({})).toBe(false);

    // Both calls are no-ops rather than throwing on the ordinary transport.
    await armHostedRefill({}, streamingJob());
    await releaseHostedRefill({});
  });

  it('hands over only a stream that is actually streaming', async () => {
    const refill = fakeRefill();
    const refs = { connection: connectionWith(refill) };

    await armHostedRefill(refs, null);
    await armHostedRefill(refs, { ...streamingJob(), status: 'paused' });
    expect(refill.armCalls()).toEqual([]);

    const streaming = streamingJob();
    await armHostedRefill(refs, streaming);
    expect(refill.armCalls()).toEqual([streaming]);
    expect(hostedRefillArmed(refs)).toBe(true);
  });
});

describe('advanceStream with the refill handed over (ADR-334)', () => {
  it('advances its own accounting without writing the refill twice', () => {
    const refill = fakeRefill();
    const { refs, set, get } = makeLineHandlerHarness();
    refs.connection = connectionWith(refill);
    set({ streamer: streamingJob() });
    const safeWrite = vi.fn(async () => undefined);
    refill.setArmed(true);

    advanceStream(set, get, refs, safeWrite, 'ok');

    // The worker wrote those bytes from the same step on the same line.
    expect(safeWrite).not.toHaveBeenCalled();
    expect(get().streamer?.completed).toBe(1);
    expect(get().streamer?.status).toBe('streaming');
    expect(refill.releaseCalls()).toBe(0);
  });

  it('writes the refill itself when the transport cannot host it', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    refs.connection = connectionWith(undefined);
    set({ streamer: streamingJob() });
    const safeWrite = vi.fn(async () => undefined);

    advanceStream(set, get, refs, safeWrite, 'ok');

    expect(safeWrite).toHaveBeenCalledWith('G1 X2.000\n', undefined, 'job');
  });

  it('takes the refill back the moment the stream stops simply streaming', () => {
    const refill = fakeRefill();
    const { refs, set, get } = makeLineHandlerHarness();
    refs.connection = connectionWith(refill);
    // One line, already in flight: its acknowledgement finishes the stream.
    set({ streamer: step(createStreamer('M5\n')).state });
    const safeWrite: SafeWriteFn = vi.fn(async () => undefined);
    refill.setArmed(true);

    advanceStream(set, get, refs, safeWrite, 'ok');

    expect(get().streamer?.status).toBe('done');
    expect(refill.releaseCalls()).toBe(1);
    // The post-job settle writes from this side, as it always has; what must
    // not happen is a second refill for a line the worker already sent.
    expect(vi.mocked(safeWrite).mock.calls.some((call) => call[2] === 'job')).toBe(false);
  });

  it('takes it back when an error makes the stream terminal', () => {
    const refill = fakeRefill();
    const { refs, set, get } = makeLineHandlerHarness();
    refs.connection = connectionWith(refill);
    set({ streamer: streamingJob() });
    const safeWrite = vi.fn(async () => undefined);
    refill.setArmed(true);

    advanceStream(set, get, refs, safeWrite, 'error');

    expect(get().streamer?.status).toBe('errored');
    expect(refill.releaseCalls()).toBe(1);
  });
});
