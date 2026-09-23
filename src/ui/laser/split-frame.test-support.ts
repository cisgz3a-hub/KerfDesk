import { vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import {
  createFramedRunPermit,
  createFrameTrace,
  type FramedRunCandidate,
  type FrameTraceCandidate,
} from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import { hydrateTransferredStartPreparation } from './output-preparation-worker-client';

// Shared harness for the split-Frame tests (ADR-353). The test files own the
// module mocks; everything that does not depend on them lives here.

export type PrepareStartMock = ReturnType<
  typeof vi.fn<typeof OutputWorkerModule.prepareStartOutputOffThread>
>;
type StartRequest = Parameters<typeof OutputWorkerModule.prepareStartOutputOffThread>[0];
type OnFrameBounds = NonNullable<
  Parameters<typeof OutputWorkerModule.prepareStartOutputOffThread>[3]
>;

export function installSplitFrameVectorProject(): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        ...EMPTY_SCENE,
        // eslint-disable-next-line no-restricted-syntax -- scene data: the layer colour the imported path binds to
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'split-frame.svg',
            bounds: { minX: 4, minY: 6, maxX: 24, maxY: 16 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                // eslint-disable-next-line no-restricted-syntax -- scene data: the imported path colour
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 4, y: 6 },
                      { x: 24, y: 16 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

/** The real preparation, with the early outline forwarded like the worker does. */
export function prepareThroughFixture(
  request: StartRequest,
  onFrameBounds: OnFrameBounds | undefined,
): ReturnType<typeof prepareOutputRequestForTest> {
  return prepareOutputRequestForTest(request, onFrameBounds === undefined ? {} : { onFrameBounds });
}

export function preparedStartOf(
  response: Awaited<ReturnType<typeof prepareOutputRequestForTest>>,
): ReturnType<typeof hydrateTransferredStartPreparation> {
  if (response.kind !== 'start') throw new Error('Start test adapter returned no job.');
  return hydrateTransferredStartPreparation(response.result);
}

/** Hold the exact program back until the returned release runs; the outline
 * is still reported as soon as the fixture compiles the job. */
export function gateExactProgram(prepareStart: PrepareStartMock): () => void {
  let releaseProgram: () => void = () => undefined;
  const programGate = new Promise<void>((resolve) => {
    releaseProgram = resolve;
  });
  prepareStart.mockImplementation((request, _p, _s, onFrameBounds) =>
    prepareThroughFixture(request, onFrameBounds).then(async (response) => {
      await programGate;
      return preparedStartOf(response);
    }),
  );
  return () => releaseProgram();
}

export function dispatchedFrameOperation(
  candidate: FramedRunCandidate | FrameTraceCandidate,
): void {
  useLaserStore.setState({
    motionOperation: {
      operationId: 1,
      kind: 'frame',
      candidate,
      sawControllerBusy: true,
      idleStatusReports: 0,
      dispatchComplete: true,
      pendingLines: [],
    },
  });
}

export function completeTraceForTest(candidate: FrameTraceCandidate): void {
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    frameTrace: createFrameTrace(candidate, laser),
  }));
}

export function completeExactFrameForTest(candidate: FramedRunCandidate): void {
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    framedRun: createFramedRunPermit(candidate, laser),
    frameVerification: candidate.frameVerification,
  }));
}

/** A `traceFrame` mock that dispatches and cleanly completes at once. */
export function installCompletingTraceFrame(events: string[]) {
  const traceFrame = vi.fn(
    async (_bounds: JobBounds, _feed: number, candidate: FrameTraceCandidate) => {
      events.push('trace');
      dispatchedFrameOperation(candidate);
      completeTraceForTest(candidate);
    },
  );
  useLaserStore.setState({ traceFrame });
  return traceFrame;
}

export function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  return useToastStore.getState().toasts.at(-1);
}

/** Idle, connected-looking controller state with the exact Frame forbidden. */
export function resetSplitFrameStores(): void {
  installSplitFrameVectorProject();
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  useLaserStore.setState({
    streamer: null,
    statusReport: idleControllerStatusForFrameTest(),
    alarmCode: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    workOriginActive: false,
    wcoCache: null,
    activeWcs: 'G54',
    homingState: 'unknown',
    trustedPositionEpoch: 3,
    framedRun: null,
    frameTrace: null,
    frameVerification: null,
    frame: vi.fn(async () => {
      throw new Error('The exact Frame must not run when the outline was reported early.');
    }),
  });
  useToastStore.setState({ toasts: [] });
}

export function restoreSplitFrameStores(
  originalFrame: ReturnType<typeof useLaserStore.getState>['frame'],
  originalTraceFrame: ReturnType<typeof useLaserStore.getState>['traceFrame'],
): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  useStore.getState().newProject();
  useLaserStore.setState({
    frame: originalFrame,
    traceFrame: originalTraceFrame,
    streamer: null,
    statusReport: null,
    alarmCode: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    framedRun: null,
    frameTrace: null,
    frameVerification: null,
  });
}
