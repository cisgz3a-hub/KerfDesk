import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobBounds } from '../../core/job';
import { currentOutputScope, useStore } from '../state';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import {
  createFrameTrace,
  framedRunControllerSnapshot,
  type FramedRunCandidate,
  type FrameTraceCandidate,
} from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import {
  completeExactFrameForTest,
  dispatchedFrameOperation,
  preparedStartOf,
  prepareThroughFixture,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { runFrameNow } from './use-frame-action';

// The split Frame's edges (ADR-353): a cancelled trace releases the worker,
// a preparation without an early outline Frames the exact program as before,
// and a pending trace expires under the permit's own rules.

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
let events: string[];

beforeEach(() => {
  outputWorkerMocks.prepareStart
    .mockReset()
    .mockImplementation((request, _onProgress, _signal, onFrameBounds) =>
      prepareThroughFixture(request, onFrameBounds).then(preparedStartOf),
    );
  resetSplitFrameStores();
  events = [];
});

afterEach(() => {
  restoreSplitFrameStores(originalFrame, originalTraceFrame);
  vi.restoreAllMocks();
});

describe('runFrameNow split Frame edges (ADR-353)', () => {
  it('aborts the exact preparation when the trace is cancelled', async () => {
    const traceFrame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate: FrameTraceCandidate) => {
        dispatchedFrameOperation(candidate);
        useLaserStore.setState((state) => ({
          motionOperation:
            state.motionOperation === null
              ? null
              : { ...state.motionOperation, cancelRequested: true },
        }));
      },
    );
    useLaserStore.setState({ traceFrame });
    let preparationSignal: AbortSignal | undefined;
    outputWorkerMocks.prepareStart.mockImplementation((request, _p, signal, onFrameBounds) => {
      preparationSignal = signal;
      void prepareThroughFixture(request, onFrameBounds);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('Background output preparation cancelled.');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      });
    });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(traceFrame).toHaveBeenCalledTimes(1);
    expect(preparationSignal?.aborted).toBe(true);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useFramePreparationStore.getState().pending).toBe(false);
  });

  it('Frames the exact program as before when no outline is reported early', async () => {
    const traceFrame = vi.fn(async () => {
      throw new Error('No trace was expected without an early outline.');
    });
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        events.push('exact-frame');
        dispatchedFrameOperation(candidate);
        completeExactFrameForTest(candidate);
      },
    );
    useLaserStore.setState({ frame, traceFrame });
    outputWorkerMocks.prepareStart.mockImplementation((request) =>
      prepareThroughFixture(request, undefined).then(preparedStartOf),
    );

    await expect(runFrameNow()).resolves.toBe(true);

    expect(events).toEqual(['exact-frame']);
    expect(traceFrame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun?.candidate.preparedStart.gcode).toEqual(
      expect.any(String),
    );
  });

  it('expires a pending trace on machine activity exactly as it would a permit', () => {
    ensureFramedRunInvalidationSubscriptions();
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const candidate: FrameTraceCandidate = {
      exactProgram: 'deferred',
      project: app.project,
      outputScope: currentOutputScope(app),
      executionSignature: currentReplayExecutionSignature(app),
      controllerBeforeFrame: framedRunControllerSnapshot(laser),
      frameVerification: { boundsSignature: '4,6,24,16', wco: null, workOriginActive: false },
      returnToWorkPosition: { x: 31, y: 42 },
    };
    useLaserStore.setState((state) => ({ frameTrace: createFrameTrace(candidate, state) }));
    expect(useLaserStore.getState().frameTrace?.candidate).toBe(candidate);

    useLaserStore.setState({
      motionOperation: {
        operationId: 7,
        kind: 'jog',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });

    expect(useLaserStore.getState().frameTrace).toBeNull();
  });
});
