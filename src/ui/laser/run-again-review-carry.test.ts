// ADR-237 Amendment 3: Run again of an unchanged, already-reviewed laser job
// starts without showing Job Review again. Every other case shows it. These
// run the real Start flow, review gate and recovery repository; only the
// controller's `startJob` is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { isExecutionProvenance } from '../state/recovery/execution-provenance';
import { forgetSessionReviewedRuns } from '../state/session-reviewed-runs';
import { useToastStore } from '../state/toast-store';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { createJobReviewPresentation } from './job-review/job-review-presentation';
import { carriedReviewNotice, RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY } from './run-again-review-carry';
import {
  arrangeFramedLaserJob,
  carriedNotices,
  committingStartJob,
  connectVerifiedLaser,
  finishActiveRun,
  frameAgain,
  NO_GO_WARNING,
  reviewsShownBy,
} from './run-again-review-carry.test-support';
import { runCompletedJobAgainFlow, runFramedPermitStart, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
let uninstallAutoReview: () => void = () => undefined;
let repository: RecoveryRepository;

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

async function finishRun(): Promise<LastCompletedReceipt> {
  const receipt = await finishActiveRun(repository);
  startSpy().mockClear();
  return receipt;
}

async function reviewedFirstRun(): Promise<LastCompletedReceipt> {
  await runStartJobFlow(repository);
  expect(startSpy()).toHaveBeenCalledOnce();
  return finishRun();
}

beforeEach(async () => {
  repository = await arrangeFramedLaserJob(vi.fn(committingStartJob));
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  forgetSessionReviewedRuns();
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('Run again of an unchanged, already-reviewed laser job', () => {
  it('starts without Job Review and records whose review it carried', async () => {
    const shownAtStart = await reviewsShownBy(() => runStartJobFlow(repository));
    expect(shownAtStart).toHaveLength(1);
    expect(shownAtStart[0]?.acknowledgement.kind).toBe('laser-verified');
    expect(carriedNotices()).toEqual([]);
    const firstReview = repository.getSnapshot().activeRun?.artifact.provenance?.review;
    const first = await finishRun();

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(first, repository));

    expect(shown).toEqual([]);
    expect(startSpy()).toHaveBeenCalledExactlyOnceWith(first.artifact.gcode, expect.any(Object));
    expect(carriedNotices()).toEqual([carriedReviewNotice(firstReview?.warningsShown ?? [])]);
    const replay = repository.getSnapshot().activeRun;
    expect(replay?.runId).not.toBe(first.runId);
    const provenance = replay?.artifact.provenance;
    expect(isExecutionProvenance(provenance)).toBe(true);
    expect(provenance).toMatchObject({
      workflow: { kind: 'ordinary-start', completedReplaySourceRunId: first.runId },
      controller: { sessionEpoch: 7 },
      review: {
        warningsShown: firstReview?.warningsShown,
        acknowledgement: { kind: 'laser-verified' },
        laserModeStartEvidence: { controllerSessionEpoch: 7, unverifiedAcknowledged: false },
        carriedOver: {
          fromRunId: first.runId,
          operatorReviewedRunId: first.runId,
          operatorReviewedAtIso: firstReview?.reviewedAtIso,
        },
      },
    });
    // The controller boundary got the same evidence a clicked review hands it.
    expect(startSpy().mock.calls[0]?.[1]).toMatchObject({
      runId: replay?.runId,
      laserModeStartEvidence: { unverifiedAcknowledged: false },
    });
  });

  it('carries the same click through a third run and names the run that was clicked', async () => {
    const first = await reviewedFirstRun();
    const firstReviewedAt = first.artifact.provenance?.review.reviewedAtIso;
    await runCompletedJobAgainFlow(first, repository);
    const second = await finishRun();

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(second, repository));

    expect(shown).toEqual([]);
    expect(startSpy()).toHaveBeenCalledOnce();
    expect(repository.getSnapshot().activeRun?.artifact.provenance?.review).toMatchObject({
      carriedOver: {
        fromRunId: second.runId,
        operatorReviewedRunId: first.runId,
        operatorReviewedAtIso: firstReviewedAt,
      },
    });
  });

  it('carries warnings the operator accepted and lists them under the notice', async () => {
    await frameAgain([NO_GO_WARNING]);
    const first = await reviewedFirstRun();
    const accepted = first.artifact.provenance?.review.warningsShown ?? [];
    expect(accepted).toContain(NO_GO_WARNING);

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(first, repository));

    expect(shown).toEqual([]);
    expect(startSpy()).toHaveBeenCalledOnce();
    const notice = useToastStore
      .getState()
      .toasts.find((toast) => toast.key === RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY);
    expect(notice?.message).toBe(
      `Running the same reviewed job again, with the same ${accepted.length} warnings you accepted in Job Review.`,
    );
    expect(notice?.details).toEqual(accepted);
  });
});

describe('Run again still shows Job Review', () => {
  async function expectReviewShown(receipt: LastCompletedReceipt) {
    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(receipt, repository));
    expect(shown).toHaveLength(1);
    expect(carriedNotices()).toEqual([]);
    // The click in that dialog is an ordinary review: nothing was carried.
    expect(startSpy()).toHaveBeenCalledOnce();
    const review = repository.getSnapshot().activeRun?.artifact.provenance?.review;
    expect(review).toBeDefined();
    expect(review).not.toHaveProperty('carriedOver');
    return shown[0];
  }

  it('after a reload, when this session no longer holds the earlier review', async () => {
    const first = await reviewedFirstRun();
    forgetSessionReviewedRuns();

    await expectReviewShown(first);
  });

  it('for a laser whose $30/$32 are no longer verified', async () => {
    const first = await reviewedFirstRun();
    useLaserStore.setState({ controllerSettingsObservation: null });
    await frameAgain();

    const model = await expectReviewShown(first);

    expect(model?.acknowledgement.kind).toBe('laser-unverified');
  });

  it('when a warning has appeared since the approved review', async () => {
    const first = await reviewedFirstRun();
    await frameAgain([NO_GO_WARNING]);

    const model = await expectReviewShown(first);

    expect(model?.warnings).toContain(NO_GO_WARNING);
    expect(first.artifact.provenance?.review.warningsShown).not.toContain(NO_GO_WARNING);
  });

  it('when an approved warning has gone', async () => {
    await frameAgain([NO_GO_WARNING]);
    const first = await reviewedFirstRun();
    await frameAgain();

    const model = await expectReviewShown(first);

    expect(model?.warnings).not.toContain(NO_GO_WARNING);
  });

  it('when the prepared program is not the one the completed run sent', async () => {
    const first = await reviewedFirstRun();
    const changed: LastCompletedReceipt = {
      ...first,
      artifact: {
        ...first.artifact,
        fingerprint: { ...first.artifact.fingerprint, fnv1a: first.artifact.fingerprint.fnv1a ^ 1 },
      },
    };

    await expectReviewShown(changed);
  });

  it('on a different controller session', async () => {
    const first = await reviewedFirstRun();
    connectVerifiedLaser(8);
    await frameAgain();

    const model = await expectReviewShown(first);

    expect(model?.acknowledgement.kind).toBe('laser-verified');
  });

  it('when the caller brings its own review presenter, as the phone remote does', async () => {
    const first = await reviewedFirstRun();
    const permit = await frameAgain();
    const presenter = vi.fn(createJobReviewPresentation);

    const shown = await reviewsShownBy(() =>
      runFramedPermitStart(permit, repository, first, {
        presenter: (model, purpose) => presenter(model, purpose),
      }),
    );

    expect(presenter).toHaveBeenCalledOnce();
    expect(shown).toHaveLength(1);
    expect(startSpy()).toHaveBeenCalledOnce();
    expect(carriedNotices()).toEqual([]);
  });
});

describe('ordinary Start', () => {
  it('always shows Job Review, however recently the same job was reviewed', async () => {
    await reviewedFirstRun();

    const shown = await reviewsShownBy(() => runStartJobFlow(repository));

    expect(shown).toHaveLength(1);
    expect(startSpy()).toHaveBeenCalledOnce();
    expect(carriedNotices()).toEqual([]);
    const provenance = repository.getSnapshot().activeRun?.artifact.provenance;
    expect(provenance?.review).not.toHaveProperty('carriedOver');
    // An ordinary Start repeats no run.
    expect(provenance).toHaveProperty('workflow', { kind: 'ordinary-start' });
  });

  it('cancelled in the dialog starts nothing', async () => {
    await reviewedFirstRun();
    uninstallAutoReview();
    uninstallAutoReview = installAutoJobReview('cancel');

    const shown = await reviewsShownBy(() => runStartJobFlow(repository));

    expect(shown).toHaveLength(1);
    expect(startSpy()).not.toHaveBeenCalled();
  });
});
