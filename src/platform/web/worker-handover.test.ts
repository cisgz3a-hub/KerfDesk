import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushWorkerTasks, handoverHarness } from './worker-handover.test-support';

afterEach(() => vi.useRealTimers());

describe('worker refill handover across real streams', () => {
  it('sends each line once when an acknowledgement crosses the prepare request', async () => {
    const h = handoverHarness();
    await h.start();
    const arming = h.connection.hostedStreaming!.arm(h.snapshot);
    // Controller reply arrives before prepare-arm reaches the worker.
    h.ack();
    await flushWorkerTasks();
    h.worker();
    // FIFO: the reply is consumed before ready captures the new stream state.
    h.renderer();
    await h.settle();
    await arming;
    h.ack();
    await h.settle();
    expect(h.written.join('')).toBe('G1 X1.000\nG1 X2.000\nG1 X3.000\n');
    expect(h.delivered).toEqual(['ok', 'ok']);
    await h.close();
  });

  it('holds acknowledgements arriving after ready until the snapshot is adopted', async () => {
    const h = handoverHarness();
    await h.start();
    const arming = h.connection.hostedStreaming!.arm(h.snapshot);
    h.worker();
    h.ack();
    await flushWorkerTasks();
    expect(h.delivered).toEqual([]);
    expect(h.written).toEqual(['G1 X1.000\n']);
    await h.settle();
    await arming;
    h.ack();
    await h.settle();
    expect(h.written.join('')).toBe('G1 X1.000\nG1 X2.000\nG1 X3.000\n');
    expect(h.snapshot().completed).toBe(2);
    await h.close();
  });

  it('returns ownership in wire order with acknowledgements on both sides of release', async () => {
    const h = handoverHarness();
    await h.start();
    const arming = h.connection.hostedStreaming!.arm(h.snapshot);
    await h.settle();
    await arming;
    const releasing = h.connection.hostedStreaming!.release();
    h.ack();
    await flushWorkerTasks(); // worker still owns this refill
    h.worker(); // worker releases before reading the following reply
    h.ack();
    await flushWorkerTasks();
    await h.settle();
    await releasing;
    expect(h.written.join('')).toBe('G1 X1.000\nG1 X2.000\nG1 X3.000\n');
    expect(h.connection.hostedStreaming!.isArmed()).toBe(false);
    await h.close();
  });

  it('cancels a pending arm without accepting its delayed ready response', async () => {
    const h = handoverHarness();
    await h.start();
    const arming = h.connection.hostedStreaming!.arm(h.snapshot);
    h.worker();
    const releasing = h.connection.hostedStreaming!.release();
    h.renderer(); // stale ready cannot install a stream after release
    await h.settle();
    await Promise.all([arming, releasing]);
    expect(h.core.armedStreamer()).toBeNull();
    h.ack();
    await h.settle();
    expect(h.written.join('')).toBe('G1 X1.000\nG1 X2.000\n');
    await h.close();
  });

  it('terminates a silent worker instead of issuing a duplicate refill on timeout', async () => {
    vi.useFakeTimers();
    const h = handoverHarness();
    await h.start();
    const arming = h.connection.hostedStreaming!.arm(h.snapshot);
    await h.settle();
    await arming;
    const releasing = h.connection.hostedStreaming!.release();
    h.ack();
    await flushWorkerTasks();
    // The release request and this acknowledgement's forwarded line are delayed.
    await vi.advanceTimersByTimeAsync(101);
    await releasing;
    h.renderer();
    await h.settle();
    expect(h.isTerminated()).toBe(true);
    expect(h.isClosed()).toBe(true);
    expect(h.written.join('')).toBe('G1 X1.000\nG1 X2.000\n');
    await expect(h.connection.write('G1 X2.000\n')).rejects.toThrow('not writable');
  });
});
