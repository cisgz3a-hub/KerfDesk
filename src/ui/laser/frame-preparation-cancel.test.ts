// Controller audit gap-start-4: a preparation worker that never answered kept
// Frame and Start busy ("Preparing the exact job for Frame…") with no deadline
// and no way out. The owned preparation now offers Cancel until motion starts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelOwnedFramePreparation,
  framePreparationCancelled,
  publishFramePreparationStage,
  registerFramePreparationAbort,
  runOwnedFrame,
  useFramePreparationStore,
} from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import {
  lastToast,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';
import { runFrameNow } from './use-frame-action';

const outputWorkerMocks = vi.hoisted(() => ({
  prepareStart: vi.fn<typeof OutputWorkerModule.prepareStartOutputOffThread>(),
}));

vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => true,
  prepareStartOutputOffThread: outputWorkerMocks.prepareStart,
}));

const originalFrame = useLaserStore.getState().frame;
const originalTraceFrame = useLaserStore.getState().traceFrame;

beforeEach(() => {
  resetSplitFrameStores();
  // A worker that never answers; only an abort ends its preparation.
  outputWorkerMocks.prepareStart.mockReset().mockImplementation(
    (_request, _progress, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('Background output preparation cancelled.');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
  );
});

afterEach(() => {
  restoreSplitFrameStores(originalFrame, originalTraceFrame);
  vi.restoreAllMocks();
});

describe('cancelling an owned Frame preparation', () => {
  it('ends a preparation the worker never answers, quietly and with nothing sent', async () => {
    const frame = vi.fn(async () => undefined);
    const traceFrame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame, traceFrame });

    const framing = runFrameNow();
    await vi.waitFor(() => expect(useFramePreparationStore.getState().cancellable).toBe(true));
    cancelOwnedFramePreparation();

    await expect(framing).resolves.toBe(false);
    expect(frame).not.toHaveBeenCalled();
    expect(traceFrame).not.toHaveBeenCalled();
    expect(useFramePreparationStore.getState()).toMatchObject({
      pending: false,
      cancellable: false,
    });
    expect(lastToast()?.message).toBe('Frame preparation cancelled. Nothing was sent.');
  });

  it('is not offered while the outline trace moves the machine', async () => {
    await runOwnedFrame(async () => {
      const release = registerFramePreparationAbort(() => undefined);
      expect(useFramePreparationStore.getState().cancellable).toBe(true);
      publishFramePreparationStage('tracing');
      expect(useFramePreparationStore.getState().cancellable).toBe(false);
      publishFramePreparationStage('finishing');
      expect(useFramePreparationStore.getState().cancellable).toBe(true);
      release();
      expect(useFramePreparationStore.getState().cancellable).toBe(false);
      return false;
    });
    expect(framePreparationCancelled()).toBe(false);
  });
});
