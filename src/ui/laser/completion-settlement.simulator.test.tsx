// Controller simulation only; verifies displayed and persisted completion agree.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { createLayer, createProject } from '../../core/scene';
import { installJobCheckpointTracking } from '../../ui/app/use-job-checkpoint';
import { installFramedRunPermitForCurrentState } from '../../ui/laser/framed-run-testing';
import { LiveJobTimeBadge } from '../../ui/laser/LiveJobTimeBadge';
import { installAutoJobReview, useJobReviewStore } from '../../ui/laser/job-review';
import { runStartJobFlow } from '../../ui/laser/start-job-flow';
import { initialLaserState } from '../../ui/state/laser-store-helpers';
import { useLaserStore } from '../../ui/state/laser-store';
import { RecoveryRepository } from '../../ui/state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../../ui/state/recovery/testing';
import { useStore } from '../../ui/state/store';
import { resetStore, svgObj } from '../../ui/state/test-helpers';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let untrack: (() => void) | null = null;
let uninstallReview: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
  useJobReviewStore.getState().close();
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  untrack?.();
  untrack = null;
  uninstallReview?.();
  uninstallReview = null;
  useJobReviewStore.getState().close();
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

describe('failed post-job settlement', () => {
  it('releases later Idle as interrupted without completing the badge or advancing variables', async () => {
    const base = createProject();
    useStore.setState({
      project: {
        ...base,
        variables: { recordIndex: 0, serialValue: 7, advancement: 'after-successful-stream' },
        scene: {
          ...base.scene,
          objects: [svgObj('audit-settle-line', ['#ff0000'])],
          layers: [createLayer({ id: 'audit-settle', color: '#ff0000' })],
        },
      },
    });
    const rejectedMarker = /^G4 P0\.01$/;
    vi.spyOn(rejectedMarker, 'test').mockImplementation(
      (line) =>
        /^G4 P0\.01$/.test(line) &&
        useLaserStore.getState().controllerOperation?.kind === 'post-job-settle',
    );
    const sim = createGrblSimulator({
      rejectLines: [{ pattern: rejectedMarker, errorCode: 20 }],
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
    const runId = useLaserStore.getState().activeRunId;
    expect(runId).not.toBeNull();
    // Allow acknowledgements and the rejected marker, but stop before the next
    // scheduled status poll so unavailable is observable as a distinct state.
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.outbound()).toContain('G4 P0.01\n');
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: null,
      safetyNotice: { kind: 'controller-error' },
      liveCanvasRun: { timing: { kind: 'unavailable' } },
    });
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(useStore.getState().project.variables?.serialValue).toBe(7);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(LiveJobTimeBadge, { estimate: { kind: 'empty' } })));
    expect(host.querySelector('[data-time-state]')?.getAttribute('data-time-state')).toBe(
      'unavailable',
    );

    // A single Idle after the rejected marker must release physical-busy UI,
    // but it does not satisfy the successful marker + two-Idle receipt contract.
    await act(async () => {
      sim.port.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      for (let index = 0; index < 128; index += 1) await Promise.resolve();
    });
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      safetyNotice: { kind: 'controller-error' },
      liveCanvasRun: { lifecycle: 'errored', timing: { kind: 'unavailable' } },
    });
    expect(host.querySelector('[data-time-state]')?.getAttribute('data-time-state')).toBe(
      'unavailable',
    );
    expect(host.textContent).not.toBe('Complete');
    expect(useStore.getState().project.variables?.serialValue).toBe(7);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId,
      interruption: {
        kind: 'unknown',
        message: 'The job stream ended before clean physical completion.',
      },
    });
  });
});
