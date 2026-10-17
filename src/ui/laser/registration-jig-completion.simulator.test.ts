// Real Start flow, emitter and controller simulator; no hardware is operated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import {
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  registrationRunState,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { cancelRegistrationJigCompletion } from './registration-jig-stream-completion';
import { runStartJobFlow } from './start-job-flow';

let untrack: (() => void) | null = null;
let uninstallReview: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useStore.setState({ registrationArtworkOutputSnapshot: null });
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
  useJobReviewStore.getState().close();
  // The real Start flow runs its single Job Review; confirm it as the operator would.
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  cancelRegistrationJigCompletion();
  untrack?.();
  untrack = null;
  uninstallReview?.();
  uninstallReview = null;
  useJobReviewStore.getState().close();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function onClock<T>(pending: Promise<T>): Promise<T> {
  let settled = false;
  const outcome = pending
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      settled = true;
    });
  for (let tick = 0; tick < 2000 && !settled; tick += 1) await vi.advanceTimersByTimeAsync(1);
  expect(settled, 'The owned simulator action did not settle.').toBe(true);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

function prepareOutlineScene(): { enabled: string; disabled: string } {
  useStore.getState().addRegistrationBox(80, 40);
  for (const [id, color] of [
    ['jig-enabled-art', '#0000ff'],
    ['jig-disabled-art', '#00aa00'],
  ] as const) {
    useStore.getState().drawShape(
      createRectangle({
        id,
        color,
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
      }),
    );
  }
  const scene = useStore.getState().project.scene;
  const operationId = (id: string): string => {
    const object = scene.objects.find((item) => item.id === id);
    const operation = object && primaryOperationForObject(object, scene.layers);
    if (!operation) throw new Error(`Missing artwork operation for ${id}`);
    return operation.id;
  };
  const enabled = operationId('jig-enabled-art');
  const disabled = operationId('jig-disabled-art');
  useStore.getState().setLayerParam(disabled, { output: false });
  useStore.setState(({ project }) => ({
    project: {
      ...project,
      variables: { recordIndex: 0, serialValue: 7, advancement: 'after-successful-stream' },
    },
  }));
  useStore.getState().setRegistrationOutput('box');
  return { enabled, disabled };
}

async function startOutline(rejectSettlement = false) {
  // Reject only the post-job settlement marker, not any earlier dwell in the run.
  const rejectedMarker = /^G4 P0\.01$/;
  vi.spyOn(rejectedMarker, 'test').mockImplementation(
    (line) =>
      /^G4 P0\.01$/.test(line) &&
      useLaserStore.getState().controllerOperation?.kind === 'post-job-settle',
  );
  const sim = createGrblSimulator({
    ...(rejectSettlement ? { rejectLines: [{ pattern: rejectedMarker, errorCode: 20 }] } : {}),
  });
  await useLaserStore.getState().connect(sim.adapter);
  await vi.advanceTimersByTimeAsync(1120);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  await installFramedRunPermitForCurrentState();
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  untrack = installJobCheckpointTracking(() => new Date().toISOString(), repository);
  await onClock(runStartJobFlow(repository));
  expect(useLaserStore.getState().activeRunId).not.toBeNull();
  return { sim, repository };
}

function outputFlags(): Record<string, boolean> {
  return Object.fromEntries(
    useStore.getState().project.scene.layers.map((layer) => [layer.id, layer.output]),
  );
}

describe('registration jig completion through the real Start flow', () => {
  it('switches only after clean settlement, preserving disabled artwork and unconsumed variable records', async () => {
    const { enabled, disabled } = prepareOutlineScene();
    const { sim, repository } = await startOutline();
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.outbound()).toContain('G4 P0.01\n');
    expect(useLaserStore.getState().streamer?.status).toBe('done');
    expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
    expect(useStore.getState().project.variables?.serialValue).toBe(7);

    await vi.advanceTimersByTimeAsync(3000);
    expect(useLaserStore.getState()).toMatchObject({ streamer: null, controllerOperation: null });
    expect(repository.getSnapshot().lastCompletedReceipt).not.toBeNull();
    expect(registrationRunState(useStore.getState().project.scene)).toBe('artwork');
    expect(outputFlags()).toMatchObject({
      [REGISTRATION_LAYER_ID]: false,
      [enabled]: true,
      [disabled]: false,
    });
    // The outline run burns no artwork, so it must not consume a variable record.
    expect(useStore.getState().project.variables?.serialValue).toBe(7);
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message.includes('set focus for its top surface')),
    ).toBe(true);
  });

  it('keeps Outline only after a rejected settlement marker even when later Idle releases the stream', async () => {
    const { enabled, disabled } = prepareOutlineScene();
    const { sim, repository } = await startOutline(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.outbound()).toContain('G4 P0.01\n');
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: null,
      safetyNotice: { kind: 'controller-error' },
    });
    sim.port.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    for (let index = 0; index < 128; index += 1) await Promise.resolve();
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
    expect(outputFlags()).toMatchObject({
      [REGISTRATION_LAYER_ID]: true,
      [enabled]: false,
      [disabled]: false,
    });
    expect(useStore.getState().project.variables?.serialValue).toBe(7);
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message.startsWith('Outline finished.')),
    ).toBe(false);
  });
});
