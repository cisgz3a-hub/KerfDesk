import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, disconnect, onAck, pause, step } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { advanceStream, settleUntrackedAck, streamOwnsTerminalAck } from './laser-stream-ack';

afterEach(() => {
  vi.useRealTimers();
});

describe('advanceStream MPG completion ownership', () => {
  it('starts post-job settlement when the final ack arrives during MPG takeover', () => {
    vi.useFakeTimers();
    const { refs, set, get } = makeLineHandlerHarness();
    set({ streamer: step(createStreamer('M5\n')).state, mpgActive: true });
    const safeWrite = vi.fn(() => new Promise<void>(() => undefined));

    advanceStream(set, get, refs, safeWrite, 'ok');

    expect(get().streamer?.status).toBe('done');
    expect(get().controllerOperation).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(safeWrite).toHaveBeenCalledTimes(1);
  });
});

describe('advanceStream write-failure ownership', () => {
  it('does not contain a replacement stream when an old refill rejects late', async () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const first = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', {
        rxBufferBytes: 30,
      }),
    );
    set({ streamer: first.state, streamerEpoch: 7 });
    let rejectRefill = (_error: Error): void => undefined;
    const safeWrite = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRefill = reject;
        }),
    );

    advanceStream(set, get, refs, safeWrite, 'ok');
    const replacement = step(createStreamer('G1 X99\n')).state;
    set({ streamer: replacement, streamerEpoch: 8, safetyNotice: null });
    rejectRefill(new Error('late old refill rejection'));
    await Promise.resolve();
    await Promise.resolve();

    expect(get().streamer).toBe(replacement);
    expect(get().streamer?.status).toBe('streaming');
    expect(get().safetyNotice).toBeNull();
  });
});

// The transcript tags and buffers a stream-owned acknowledgement before the
// ledger settles (ADR-333), so its predicate has to agree with the routing
// `settleUntrackedAck` actually performs. Neither can be trusted to describe
// the other, so this pins them against each other over the state matrix.
describe('streamOwnsTerminalAck agrees with the settled owner', () => {
  const STREAMERS = {
    none: null,
    streaming: step(createStreamer('G1 X1\nG1 X2\nG1 X3\n')).state,
    paused: pause(step(createStreamer('G1 X1\nG1 X2\nG1 X3\n')).state),
    drained: onAck(step(createStreamer('M5\n')).state, 'ok').state,
    disconnected: disconnect(step(createStreamer('G1 X1\nG1 X2\n')).state),
  } as const;

  for (const [label, streamer] of Object.entries(STREAMERS)) {
    for (const pendingUntrackedAcks of [0, 1, 2]) {
      for (const kind of ['ok', 'error'] as const) {
        it(`matches for a ${kind} with ${label} and ${pendingUntrackedAcks} owed acks`, () => {
          const { refs, set, get } = makeLineHandlerHarness();
          set({ streamer, pendingUntrackedAcks });
          const predicted = streamOwnsTerminalAck(get());

          const settled = settleUntrackedAck(set, get(), kind, refs);

          expect(settled.owner === 'stream', `${label}/${pendingUntrackedAcks}/${kind}`).toBe(
            predicted,
          );
        });
      }
    }
  }
});
