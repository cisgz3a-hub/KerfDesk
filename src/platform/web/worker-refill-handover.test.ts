import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamerState } from '../../core/controllers/grbl';
import type { SerialWorkerRequest } from './serial-worker-protocol';
import { createWorkerRefillHandover } from './worker-refill-handover';

// Audit SER-1: the arm snapshot carries the whole program, so a large job took
// longer than the fixed 2 s deadline to copy to the worker, and the timeout
// closed the port right after Start. The deadline now grows with the program.
const TIMEOUT_MS = 100;

afterEach(() => {
  vi.useRealTimers();
});

function armedWith(queuedLines: number) {
  vi.useFakeTimers();
  const posted: SerialWorkerRequest[] = [];
  const fail = vi.fn();
  const handover = createWorkerRefillHandover({
    post: (message) => posted.push(message),
    timeoutMs: TIMEOUT_MS,
    fail,
    onWriteError: () => () => undefined,
  });
  const snapshot = {
    queued: Array.from({ length: queuedLines }, () => 'G1 X1\n'),
  } as unknown as StreamerState;
  void handover.refill.arm(() => snapshot);
  // The worker answers prepare-arm; the snapshot is posted with the arm.
  expect(handover.receive({ kind: 'ready', id: 1 })).toBe(true);
  expect(posted.map((message) => message.kind)).toEqual(['prepare-arm', 'arm']);
  return { handover, fail };
}

describe('worker refill handover deadline', () => {
  it('gives a large program time to reach the worker before failing', async () => {
    const { fail } = armedWith(1_000_000);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 20);
    expect(fail).not.toHaveBeenCalled();
    // A worker that never answers still fails the handover.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fail).toHaveBeenCalledOnce();
  });

  it('keeps the short deadline for a small program', async () => {
    const { fail } = armedWith(3);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(fail).toHaveBeenCalledOnce();
  });

  it('stops the deadline once the worker has adopted the snapshot', async () => {
    const { handover, fail } = armedWith(1_000_000);
    expect(handover.receive({ kind: 'armed', id: 1 })).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fail).not.toHaveBeenCalled();
    expect(handover.refill.isArmed()).toBe(true);
  });
});
