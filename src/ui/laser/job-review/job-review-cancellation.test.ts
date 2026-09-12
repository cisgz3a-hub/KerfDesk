import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { resetStore } from '../../state/test-helpers';
import { prepareCurrentStartJob } from '../start-job-source';
import * as workerClient from '../output-preparation-worker-client';
import type { StartJobPreparation } from '../start-job-readiness';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';

beforeEach(() => {
  resetStore();
  useJobReviewStore.getState().close();
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        layers: [createLayer({ id: 'line', color: '#123456' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'line',
            source: 'line.svg',
            transform: IDENTITY_TRANSFORM,
            bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
            paths: [
              {
                color: '#123456',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 10, y: 10 },
                      { x: 20, y: 20 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: null,
    },
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
  });
});

afterEach(() => {
  useJobReviewStore.getState().close();
  vi.restoreAllMocks();
});

async function initialBundle() {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('; '));
  return {
    app,
    laser,
    project: app.project,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
  };
}

function delayedWorker() {
  let resolve: (value: StartJobPreparation) => void = () => undefined;
  const pending = new Promise<StartJobPreparation>((done) => {
    resolve = done;
  });
  let signal: AbortSignal | undefined;
  vi.spyOn(workerClient, 'outputPreparationShouldRunOffThread').mockReturnValue(true);
  const worker = vi
    .spyOn(workerClient, 'prepareStartOutputOffThread')
    .mockImplementation((_request, _progress, owner) => {
      signal = owner;
      return pending;
    });
  return { worker, resolve, signal: () => signal };
}

describe('R1: Job Review owns cancellation during asynchronous preparation', () => {
  it.each(['confirm', 'rebuild'] as const)(
    'cancel during %s preparation cannot return approval',
    async (action) => {
      const initial = await initialBundle();
      const delayed = delayedWorker();
      const review = runJobReviewGate({
        initial,
        checkpointToReplace: null,
        completedReceipt: null,
        purpose: 'frame',
      });
      if (action === 'confirm') useJobReviewStore.getState().confirm();
      else useJobReviewStore.getState().requestRebuild();
      await vi.waitFor(() => expect(delayed.worker).toHaveBeenCalledOnce());
      useJobReviewStore.getState().cancel();
      // Simulate even a late already-produced response: cancellation must win
      // before either displaying that result or returning confirmed approval.
      delayed.resolve(initial.prepared);
      const result = await review;
      expect(delayed.signal()?.aborted).toBe(true);
      expect(result).toBeNull();
      expect(useJobReviewStore.getState().state.kind).toBe('idle');
    },
  );

  it('a cancelled old rebuild cannot close a newly opened review', async () => {
    const initial = await initialBundle();
    const delayed = delayedWorker();
    const review = runJobReviewGate({
      initial,
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => expect(delayed.worker).toHaveBeenCalledOnce());
    const state = useJobReviewStore.getState().state;
    if (state.kind !== 'open') throw new Error('review not open');
    useJobReviewStore.getState().cancelAndClose();
    useJobReviewStore.getState().open(state.model, 'frame');
    delayed.resolve(initial.prepared);
    // Leave a cancel for the legacy gate too, so its missing identity cannot
    // leave the negative control hanging forever.
    useJobReviewStore.getState().cancel();
    await expect(review).resolves.toBeNull();
    expect(useJobReviewStore.getState().state.kind).toBe('open');
  });
});
