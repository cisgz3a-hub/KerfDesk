import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelOwnedFramePreparation,
  useFramePreparationStore,
} from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import {
  completeExactFrameForTest,
  completeTraceForTest,
  dispatchedFrameOperation,
  installCompletingTraceFrame,
  lastToast,
  preparedStartOf,
  prepareThroughFixture,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';
import { runFrameNow } from './use-frame-action';

const worker = vi.hoisted(() => ({
  prepare: vi.fn<typeof OutputWorkerModule.prepareStartOutputOffThread>(),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => true,
  prepareStartOutputOffThread: worker.prepare,
}));
const originalFrame = useLaserStore.getState().frame;
const originalTrace = useLaserStore.getState().traceFrame;
beforeEach(() => {
  resetSplitFrameStores();
  worker.prepare.mockReset();
});
afterEach(() => {
  useLaserStore.setState({ pendingUntrackedAcks: 0 });
  restoreSplitFrameStores(originalFrame, originalTrace);
  vi.restoreAllMocks();
});

describe('Frame cancellation at asynchronous boundaries', () => {
  it.each([true, false])(
    'cancels a finished program waiting for the controller queue (early outline: %s)',
    async (earlyOutline) => {
      let finished = false;
      worker.prepare.mockImplementation(async (request, _progress, _signal, onBounds) => {
        const response = await prepareThroughFixture(request, (bounds) => {
          useLaserStore.setState({ pendingUntrackedAcks: 1 });
          if (earlyOutline) onBounds?.(bounds);
        });
        finished = true;
        return preparedStartOf(response);
      });
      const trace = installCompletingTraceFrame([]);
      const frame = vi.fn<typeof originalFrame>(async (_bounds, _feed, candidate) => {
        if (candidate !== undefined) completeExactFrameForTest(candidate);
      });
      useLaserStore.setState({ frame });
      const outcome = runFrameNow();
      await vi.waitFor(() => expect(finished).toBe(true));
      cancelOwnedFramePreparation();
      // The earlier command never ACKs. Cancel must still end preparation.
      await expect(outcome).resolves.toBe(false);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      useLaserStore.setState({ pendingUntrackedAcks: 0 });
      expect(trace).not.toHaveBeenCalled();
      expect(frame).not.toHaveBeenCalled();
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(lastToast()?.message).toBe('Frame preparation cancelled. Nothing was sent.');
    },
  );

  it('ignores a late cancelled program and lets a new Frame own the only permit', async () => {
    let releaseOld: () => void = () => undefined;
    let ready = false;
    worker.prepare.mockImplementation(
      (request, _progress, _signal, onBounds) =>
        new Promise((resolve) => {
          void prepareThroughFixture(request, (bounds) => {
            useLaserStore.setState({ pendingUntrackedAcks: 1 });
            onBounds?.(bounds);
          }).then((response) => {
            releaseOld = () => resolve(preparedStartOf(response));
            ready = true;
          });
        }),
    );
    const trace = installCompletingTraceFrame([]);
    const oldOutcome = runFrameNow();
    await vi.waitFor(() => expect(ready).toBe(true));
    cancelOwnedFramePreparation();
    await expect(oldOutcome).resolves.toBe(false);
    expect(trace).not.toHaveBeenCalled();

    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    worker.prepare.mockImplementation(async (request, _progress, _signal, onBounds) =>
      preparedStartOf(await prepareThroughFixture(request, onBounds)),
    );
    await expect(runFrameNow()).resolves.toBe(true);
    const newPermit = useLaserStore.getState().framedRun;
    releaseOld();
    await Promise.resolve();
    await Promise.resolve();
    expect(useLaserStore.getState().framedRun).toBe(newPermit);
    expect(newPermit).not.toBeNull();
    expect(trace).toHaveBeenCalledTimes(1);
    expect(useFramePreparationStore.getState()).toMatchObject({
      pending: false,
      cancellable: false,
    });
  });

  it('cancels after tracing even if the worker then finishes, without claiming that nothing moved', async () => {
    let releaseProgram: () => void = () => undefined;
    worker.prepare.mockImplementation(
      (request, _progress, _signal, onBounds) =>
        new Promise((resolve) => {
          void prepareThroughFixture(request, onBounds).then((response) => {
            releaseProgram = () => resolve(preparedStartOf(response));
          });
        }),
    );
    const trace = installCompletingTraceFrame([]);
    const outcome = runFrameNow();
    await vi.waitFor(() => expect(useFramePreparationStore.getState().stage).toBe('finishing'));
    cancelOwnedFramePreparation();
    releaseProgram();
    await expect(outcome).resolves.toBe(false);
    expect(trace).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(lastToast()?.message).toBe(
      'Frame preparation cancelled after tracing. No Start permit was issued.',
    );
  });

  it('a stale preparation Cancel click cannot cancel motion once its trace owns the controller', async () => {
    let signal: AbortSignal | undefined;
    worker.prepare.mockImplementation(async (request, _progress, workerSignal, onBounds) => {
      signal = workerSignal;
      return preparedStartOf(await prepareThroughFixture(request, onBounds));
    });
    useLaserStore.setState({
      traceFrame: vi.fn<typeof originalTrace>(async (_bounds, _feed, candidate) => {
        dispatchedFrameOperation(candidate);
        expect(useFramePreparationStore.getState().cancellable).toBe(false);
        cancelOwnedFramePreparation();
        expect(signal?.aborted).toBe(false);
        completeTraceForTest(candidate);
      }),
    });
    await expect(runFrameNow()).resolves.toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
  });

  it('hides preparation Cancel for the exact-program fallback before physical dispatch', async () => {
    worker.prepare.mockImplementation(async (request) =>
      preparedStartOf(await prepareThroughFixture(request, undefined)),
    );
    useLaserStore.setState({
      frame: vi.fn<typeof originalFrame>(async (_bounds, _feed, candidate) => {
        expect(useFramePreparationStore.getState()).toMatchObject({
          stage: 'tracing',
          cancellable: false,
        });
        cancelOwnedFramePreparation();
        if (candidate !== undefined) completeExactFrameForTest(candidate);
      }),
    });
    await expect(runFrameNow()).resolves.toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
  });
});
