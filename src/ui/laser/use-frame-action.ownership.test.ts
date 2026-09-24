import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelOwnedFramePreparation,
  useFramePreparationStore,
} from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import {
  installCompletingTraceFrame,
  completeTraceForTest,
  dispatchedFrameOperation,
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

describe('split Frame preparation owns cancellation and physical motion', () => {
  it('keeps preparation alive through the status and position changes of its own clean outline trace', async () => {
    let releaseProgram: () => void = () => undefined;
    let wasAborted = false;
    worker.prepare.mockImplementation(
      (request, _progress, signal, onBounds) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              wasAborted = true;
              reject(new DOMException('Cancelled', 'AbortError'));
            },
            { once: true },
          );
          void prepareThroughFixture(request, onBounds).then((response) => {
            releaseProgram = () => resolve(preparedStartOf(response));
          });
        }),
    );
    const initialStatus = useLaserStore.getState().statusReport!;
    const trace = vi.fn<typeof originalTrace>(async (_bounds, _feed, candidate) => {
      dispatchedFrameOperation(candidate);
      useLaserStore.setState((state) => ({
        statusSequence: state.statusSequence + 1,
        statusReport: { ...initialStatus, state: 'Jog', mPos: { x: 4, y: 6, z: 0 } },
      }));
      useLaserStore.setState((state) => ({
        statusSequence: state.statusSequence + 1,
        statusReport: initialStatus,
      }));
      completeTraceForTest(candidate);
    });
    useLaserStore.setState({ traceFrame: trace });
    const outcome = runFrameNow();
    await vi.waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    releaseProgram();
    const accepted = await outcome;
    expect({ wasAborted, accepted, permit: useLaserStore.getState().framedRun !== null }).toEqual({
      wasAborted: false,
      accepted: true,
      permit: true,
    });
  });

  it('never dispatches the already compiled outline after Cancel while a preceding acknowledgement is pending', async () => {
    let outlineReady = false;
    worker.prepare.mockImplementation(
      (request, _progress, signal, onBounds) =>
        new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
          void prepareThroughFixture(request, (bounds) => {
            // A queued controller query began while compilation was running.
            useLaserStore.setState({ pendingUntrackedAcks: 1 });
            onBounds?.(bounds);
            outlineReady = true;
          });
        }),
    );
    const events: string[] = [];
    const trace = installCompletingTraceFrame(events);
    const outcome = runFrameNow();
    await vi.waitFor(() => expect(outlineReady).toBe(true));
    expect(useFramePreparationStore.getState().cancellable).toBe(true);
    expect(trace).not.toHaveBeenCalled();
    cancelOwnedFramePreparation();
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    await expect(outcome).resolves.toBe(false);
    expect({ dispatched: trace.mock.calls.length, toast: lastToast()?.message }).toEqual({
      dispatched: 0,
      toast: 'Frame preparation cancelled. Nothing was sent.',
    });
  });
});
