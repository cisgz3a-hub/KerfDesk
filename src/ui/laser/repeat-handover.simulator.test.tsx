// Real Start and replay handoffs over a controller simulator.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { createLayer, createProject } from '../../core/scene';
import { installJobCheckpointTracking } from '../../ui/app/use-job-checkpoint';
import { installFramedRunPermitForCurrentState } from '../../ui/laser/framed-run-testing';
import { frameProofReset } from '../../ui/state/laser-session-reset';
import {
  captureJobReviewModels,
  installAutoJobReview,
  useJobReviewStore,
} from '../../ui/laser/job-review';
import { currentReplayExecutionSignature, RunAgainControl } from '../../ui/laser/RunAgainControl';
import { hashOnSimulatedClock } from '../../ui/laser/host-sha256-testing';
import { runCompletedJobAgainFlow, runStartJobFlow } from '../../ui/laser/start-job-flow';
import { jobAwareAlert, jobAwareConfirm } from '../../ui/state/job-aware-dialogs';
import { initialLaserState } from '../../ui/state/laser-store-helpers';
import { useLaserStore } from '../../ui/state/laser-store';
import { RecoveryRepository, type LastCompletedReceipt } from '../../ui/state/recovery';
import { isExecutionProvenance } from '../../ui/state/recovery/execution-provenance';
import { forgetSessionReviewedRuns } from '../../ui/state/session-reviewed-runs';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../../ui/state/recovery/testing';
import { useStore } from '../../ui/state/store';
import { resetStore, svgObj } from '../../ui/state/test-helpers';

vi.mock('../../ui/state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let untrack: (() => void) | null = null;
let uninstallReview: (() => void) | null = null;
let stopReviewCapture: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Archive and settlement SHA-256 must not let the simulated machine stream on
  // while WebCrypto waits for a real event-loop turn (see host-sha256-testing).
  hashOnSimulatedClock();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useJobReviewStore.getState().close();
  localStorage.clear();
  vi.mocked(jobAwareConfirm).mockReturnValue(true);
  vi.mocked(jobAwareAlert).mockClear();
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
  stopReviewCapture?.();
  stopReviewCapture = null;
  forgetSessionReviewedRuns();
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

function completedReceipt(repository: RecoveryRepository): LastCompletedReceipt {
  const receipt = repository.getSnapshot().lastCompletedReceipt;
  expect(receipt, 'The settled real run must retain its completion receipt.').not.toBeNull();
  if (receipt === null) throw new Error('Missing settled completion receipt.');
  return receipt;
}

function archivedReview(receipt: LastCompletedReceipt) {
  const review = receipt.artifact.provenance?.review;
  if (review === undefined) throw new Error('The run archived no review.');
  return review;
}

/** The run's own review evidence, marked as carried from the run it repeats
 * and naming the run whose Job Review was actually clicked. */
function expectCarriedReview(
  receipt: LastCompletedReceipt,
  from: { readonly repeats: LastCompletedReceipt; readonly clickedAt: LastCompletedReceipt },
): void {
  const clicked = archivedReview(from.clickedAt);
  expect(archivedReview(receipt)).toMatchObject({
    warningsShown: clicked.warningsShown,
    acknowledgement: { kind: 'laser-verified' },
    laserModeStartEvidence: { unverifiedAcknowledged: false },
    carriedOver: {
      fromRunId: from.repeats.runId,
      operatorReviewedRunId: from.clickedAt.runId,
      operatorReviewedAtIso: clicked.reviewedAtIso,
    },
  });
  expect(isExecutionProvenance(receipt.artifact.provenance)).toBe(true);
}

describe('completion and consecutive same-job replay', () => {
  // The first run is reviewed in the dialog. The simulator's `$30`/`$32` are
  // verified and nothing changes, so the two repeats carry that review and
  // show no dialog (ADR-237 Amendment 3). Every later check still runs.
  it('retains spatial Frame proof through one reviewed and two carried run identities', async () => {
    const reviews = captureJobReviewModels();
    stopReviewCapture = reviews.stop;
    const base = createProject();
    useStore.setState({
      project: {
        ...base,
        scene: {
          ...base.scene,
          objects: [svgObj('audit-repeat-line', ['#ff0000'])],
          layers: [createLayer({ id: 'audit-repeat', color: '#ff0000' })],
        },
      },
    });
    const sim = createGrblSimulator();
    await useLaserStore.getState().connect(sim.adapter);
    await vi.advanceTimersByTimeAsync(1120);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    await installFramedRunPermitForCurrentState();
    const retainedFrame = useLaserStore.getState().frameVerification;
    expect(retainedFrame).not.toBeNull();

    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    });
    await repository.initialize();
    untrack = installJobCheckpointTracking(() => new Date().toISOString(), repository);
    await onClock(runStartJobFlow(repository));
    await vi.advanceTimersByTimeAsync(3000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    const first = completedReceipt(repository);
    expect(useLaserStore.getState().frameVerification).toBe(retainedFrame);
    expect(reviews.models.map((model) => model.acknowledgement.kind)).toEqual(['laser-verified']);
    expect(archivedReview(first)).not.toHaveProperty('carriedOver');

    await onClock(runCompletedJobAgainFlow(first, repository));
    expect(useLaserStore.getState().streamer).not.toBeNull();
    expect(useLaserStore.getState().frameVerification).toBe(retainedFrame);
    await vi.advanceTimersByTimeAsync(3000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    const second = completedReceipt(repository);
    expect(second.runId).not.toBe(first.runId);
    expect(second.artifact.gcode).toBe(first.artifact.gcode);
    expect(second.artifact.executionSignature).toBe(currentReplayExecutionSignature());
    expectCarriedReview(second, { repeats: first, clickedAt: first });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root?.render(createElement(RunAgainControl, { disabled: false, busy: false, repository })),
    );
    const offered = host.querySelector('button');
    expect(offered?.textContent).toBe('Run same job again from start');
    expect(offered?.disabled).toBe(false);

    const beforeThird = sim.outbound().length;
    await act(async () => {
      await onClock(runCompletedJobAgainFlow(second, repository));
    });
    expect(sim.outbound().slice(beforeThird).join('')).toContain('M5');
    expect(useLaserStore.getState().frameVerification).toBe(retainedFrame);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const third = completedReceipt(repository);
    expect(new Set([first.runId, second.runId, third.runId]).size).toBe(3);
    expect(third.artifact.fingerprint).toEqual(first.artifact.fingerprint);
    expect(third.artifact.gcode).toBe(first.artifact.gcode);
    expect(third.artifact.provenance?.review.reviewedAtIso).not.toBe(
      first.artifact.provenance?.review.reviewedAtIso,
    );
    // A repeat of a repeat still names the one click behind all three runs.
    expectCarriedReview(third, { repeats: second, clickedAt: first });
    expect(reviews.models).toHaveLength(1);
    expect(host.querySelector('button')?.textContent).toBe('Run same job again from start');

    // Invalidation during the asynchronous archive/activation boundary must
    // revoke the offer and refuse the wire handoff despite the carried review.
    const armFreshStart = repository.armFreshStartIntent.bind(repository);
    const arming = vi
      .spyOn(repository, 'armFreshStartIntent')
      .mockImplementationOnce(async (...args) => {
        const armed = await armFreshStart(...args);
        useLaserStore.setState(frameProofReset());
        return armed;
      });
    const beforeBoundaryInvalidation = sim.outbound().length;
    await act(async () => {
      await onClock(runCompletedJobAgainFlow(third, repository));
    });
    expect(arming).toHaveBeenCalledOnce();
    expect(sim.outbound().slice(beforeBoundaryInvalidation)).toEqual([]);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe(third.runId);
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    const beforeInvalidReplay = sim.outbound().length;
    await act(async () => {
      await onClock(runCompletedJobAgainFlow(third, repository));
    });
    expect(sim.outbound().slice(beforeInvalidReplay)).toEqual([]);
    expect(host.querySelector('button')?.title).toContain('Frame');
  });
});
