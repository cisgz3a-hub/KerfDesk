// Regression (ADR-367): an ordinary Frame or Start answered an alarm or a
// missing origin with a red refusal only; the in-place Home, Unlock and Set
// origin offers were reachable from the checkpoint Start alone. Drives the
// real store against the scripted GRBL controller.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import type { JobPlacementSettings } from '../../core/job';
import { connectOptionsForDevice } from '../commands/connect-options';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { resetStore } from '../state/test-helpers';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import {
  HOME_OFFER_PROMPT,
  UNLOCK_OFFER_PROMPT,
  UNLOCKED_NEXT_STEP_MESSAGE,
} from './start-blocked-alarm-offers';
import { SET_ORIGIN_OFFER_PROMPT } from './start-blocked-setup-offers';
import { useStartBlockerStore } from './start-blocker-store';
import { runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';
import type * as OutputPreparationWorker from './output-preparation-worker-client';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

let disposeReview: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  disposeReview = installAutoJobReview('confirm');
});
afterEach(async () => {
  disposeReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

function lineProject(homingEnabled: boolean): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: homingEnabled } },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'artwork',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 30, minY: 40, maxX: 50, maxY: 50 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 30, y: 40 },
                    { x: 50, y: 50 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function connect(
  project: Project,
  jobPlacement: JobPlacementSettings,
  settings: ReadonlyArray<readonly [number, string]>,
) {
  useStore.setState({ project, jobPlacement });
  const sim = createGrblSimulator({ motionMs: 25, homingMs: 200, settings });
  await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(1_500);
  return sim;
}

function repository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => '2026-09-24T12:00:00.000Z',
  });
}

describe('ordinary Frame and Start offer the in-place fixes', () => {
  it('Frame in Alarm offers Home, homes, and completes the Frame', async () => {
    const sim = await connect(lineProject(true), { startFrom: 'absolute', anchor: 'front-left' }, [
      [22, '1'],
      [32, '1'],
    ]);
    // A job aborted mid-motion leaves GRBL in ALARM:3.
    sim.triggerAlarm(3);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(useLaserStore.getState().alarmCode).toBe(3);

    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(12_000);

    expect(await framing).toBe(true);
    expect(jobAwareConfirm).toHaveBeenCalledWith(HOME_OFFER_PROMPT);
    expect(sim.outbound().join('')).toContain('$H\n');
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });

  it('Start in Alarm on a machine without homing unlocks, then asks for a new origin', async () => {
    const sim = await connect(
      lineProject(false),
      { startFrom: 'user-origin', anchor: 'front-left' },
      [
        [22, '0'],
        [32, '1'],
      ],
    );
    sim.triggerAlarm(3);
    await vi.advanceTimersByTimeAsync(1_500);

    const starting = runStartJobFlow(repository());
    await vi.advanceTimersByTimeAsync(2_000);
    await starting;

    // Unlock does not restore the machine position, so the Frame stops with
    // the one next step instead of refusing for a position no report can give.
    expect(jobAwareConfirm).toHaveBeenCalledTimes(1);
    expect(jobAwareConfirm).toHaveBeenCalledWith(UNLOCK_OFFER_PROMPT);
    expect(sim.outbound().join('')).toContain('$X\n');
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
    expect(useStartBlockerStore.getState().messages).toEqual([]);

    // The operator's next step, as the toast says: Set origin, then Frame.
    const settingOrigin = useLaserStore.getState().setOriginHere();
    await vi.advanceTimersByTimeAsync(1_500);
    await settingOrigin;
    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await framing).toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
  });

  it('Start with User Origin and no origin offers Set origin here and frames from the head', async () => {
    const sim = await connect(
      lineProject(false),
      { startFrom: 'user-origin', anchor: 'front-left' },
      [
        [22, '0'],
        [32, '1'],
      ],
    );
    await useLaserStore.getState().jog({ dx: 120, dy: 80, feed: 1_000 });
    await vi.advanceTimersByTimeAsync(1_500);

    const starting = runStartJobFlow(repository());
    await vi.advanceTimersByTimeAsync(12_000);
    await starting;

    expect(jobAwareConfirm).toHaveBeenCalledWith(SET_ORIGIN_OFFER_PROMPT);
    expect(sim.state().g92).toEqual({ x: 120, y: 80, z: 0 });
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });

  it('keeps the ordinary refusal when the operator declines the fix', async () => {
    const sim = await connect(lineProject(true), { startFrom: 'absolute', anchor: 'front-left' }, [
      [22, '1'],
      [32, '1'],
    ]);
    sim.triggerAlarm(3);
    await vi.advanceTimersByTimeAsync(1_500);
    vi.mocked(jobAwareConfirm).mockReturnValue(false);

    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(12_000);

    expect(await framing).toBe(false);
    expect(sim.outbound().join('')).not.toContain('$H\n');
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useStartBlockerStore.getState()).toMatchObject({
      attempt: 'frame',
      messages: expect.arrayContaining([
        'Controller is in Alarm. Home it if the machine has homing switches, or Unlock it once the head is safe, then try again.',
      ]),
    });
  });
});
