// ADR-237 Amendment 3, the cases the flow cannot reach with a small laser job:
// CNC, a review that asks a question, an archive that disagrees with this
// session's memory, and a stand-in whose confirm the review gate refuses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { FramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { hasValidCarriedOver } from '../state/recovery/execution-review-carried-over-validation';
import {
  forgetSessionReviewedRuns,
  noteSessionReviewedRun,
  sessionReviewedRun,
} from '../state/session-reviewed-runs';
import { prepareFramedStartReview } from './framed-start-preparation';
import {
  installAutoJobReview,
  useJobReviewStore,
  type ConfirmedJobReview,
  type JobReviewModel,
  type ReviewedStartBundle,
} from './job-review';
import { modelFor } from './job-review/job-review-gate';
import { requiredFrameIssueFromStart } from './required-frame-readiness';
import { carriedReviewNotice, runAgainReviewCarry } from './run-again-review-carry';
import {
  arrangeFramedLaserJob,
  carriedNotices,
  committingStartJob,
  finishActiveRun,
  frameAgain,
  reviewsShownBy,
} from './run-again-review-carry.test-support';
import { runCompletedJobAgainFlow, runStartJobFlow } from './start-job-flow';

import type * as RequiredFrameReadiness from './required-frame-readiness';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

// The real check, with a seam to make the gate's re-preparation refuse once.
vi.mock('./required-frame-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof RequiredFrameReadiness>();
  return { ...actual, requiredFrameIssueFromStart: vi.fn(actual.requiredFrameIssueFromStart) };
});

const originalStartJob = useLaserStore.getState().startJob;
let uninstallAutoReview: () => void = () => undefined;
let repository: RecoveryRepository;
let first: LastCompletedReceipt;
let permit: FramedRunPermit;
let initial: ReviewedStartBundle;

function carryFor(overrides: Partial<Parameters<typeof runAgainReviewCarry>[0]> = {}) {
  return runAgainReviewCarry({
    permit,
    initial,
    completedReceipt: first,
    options: {},
    ...overrides,
  });
}

function confirmedReview(overrides: Partial<ConfirmedJobReview> = {}): ConfirmedJobReview {
  const snapshot = initial.laserModeStartSnapshot;
  return {
    bundle: initial,
    reviewedAtIso: '2026-11-11T09:00:00.000Z',
    reviewModel: modelFor(initial),
    laserModeStartEvidence: {
      ...snapshot,
      expectedMaxPowerS: initial.project.device.maxPowerS,
      m7Required: false,
      unverifiedAcknowledged: false,
    },
    cncSetupAttestation: undefined,
    ...overrides,
  };
}

beforeEach(async () => {
  repository = await arrangeFramedLaserJob(vi.fn(committingStartJob));
  uninstallAutoReview = installAutoJobReview('confirm');
  await runStartJobFlow(repository);
  first = await finishActiveRun(repository);
  vi.mocked(useLaserStore.getState().startJob).mockClear();
  permit = await frameAgain();
  const prepared = await prepareFramedStartReview(permit);
  if (prepared === null) throw new Error('Expected a prepared review bundle.');
  initial = prepared;
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  forgetSessionReviewedRuns();
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('whether Run again has a review to carry', () => {
  it('has one for the unchanged laser job this session reviewed', () => {
    expect(carryFor()).not.toBeNull();
  });

  it.each([
    ['an ordinary Start, which repeats no run', () => ({ completedReceipt: null })],
    [
      'a CNC job, whose setup attestation is clicked for each run',
      () => ({
        initial: {
          ...initial,
          project: { ...initial.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
        },
      }),
    ],
    [
      'a tool-owned permit',
      () => ({
        permit: {
          ...permit,
          candidate: { ...permit.candidate, authorizationContext: 'transient-camera' as const },
        },
      }),
    ],
    [
      'a preparation made on another controller session',
      () => ({
        initial: { ...initial, laser: { ...initial.laser, controllerSessionEpoch: 8 } },
      }),
    ],
  ])('has none for %s', (_name, overrides) => {
    expect(carryFor(overrides())).toBeNull();
  });

  it('has none when the completed run was archived with other warnings than this session remembers', () => {
    const provenance = first.artifact.provenance;
    if (provenance?.schemaVersion !== 2) throw new Error('Expected current provenance.');
    const disagreeing: LastCompletedReceipt = {
      ...first,
      artifact: {
        ...first.artifact,
        provenance: {
          ...provenance,
          review: { ...provenance.review, warningsShown: ['Something else was shown.'] },
        },
      },
    };

    expect(carryFor({ completedReceipt: disagreeing })).toBeNull();
  });

  it('has none for a run the archive holds no provenance for', () => {
    const { provenance: _dropped, ...artifact } = first.artifact;

    expect(carryFor({ completedReceipt: { ...first, artifact } })).toBeNull();
  });
});

describe('the review the dialog would show', () => {
  function shows(model: JobReviewModel, purpose: 'start' | 'laser-second-pass' = 'start') {
    const carry = carryFor();
    if (carry === null) throw new Error('Expected a review to carry.');
    const presentation = carry.presenter(model, purpose);
    const dialogOpen = useJobReviewStore.getState().state.kind === 'open';
    presentation?.dispose();
    return { stoodIn: carry.stoodInForDialog(), dialogOpen };
  }

  it('is stood in for when it asks nothing new', () => {
    expect(shows(modelFor(initial))).toEqual({ stoodIn: true, dialogOpen: false });
  });

  it.each<[string, (model: JobReviewModel) => JobReviewModel]>([
    [
      'the CNC setup question',
      (model) => ({
        ...model,
        machineKind: 'cnc',
        acknowledgement: { kind: 'cnc', prompt: 'Is the work clamped?' },
      }),
    ],
    [
      'the unverified laser-mode acknowledgement',
      (model) => ({ ...model, acknowledgement: { kind: 'laser-unverified', prompt: 'Check.' } }),
    ],
    [
      'the converted-laser machine-type question',
      (model) => ({
        ...model,
        convertedLaser: {} as NonNullable<JobReviewModel['convertedLaser']>,
      }),
    ],
    ['one more warning', (model) => ({ ...model, warnings: [...model.warnings, 'New.'] })],
    ['one warning fewer', (model) => ({ ...model, warnings: model.warnings.slice(1) })],
  ])('opens the dialog for %s', (_name, change) => {
    expect(shows(change(modelFor(initial)))).toEqual({ stoodIn: false, dialogOpen: true });
  });

  it('opens the dialog for any purpose but an ordinary Start', () => {
    expect(shows(modelFor(initial), 'laser-second-pass')).toEqual({
      stoodIn: false,
      dialogOpen: true,
    });
  });

  it('does not treat warning order as a change', () => {
    const model = modelFor(initial);
    expect(model.warnings.length).toBeGreaterThan(1);

    expect(shows({ ...model, warnings: [...model.warnings].reverse() }).stoodIn).toBe(true);
  });
});

describe('a stand-in the review gate confirmed', () => {
  function carriedOver(review: ConfirmedJobReview) {
    const carry = carryFor();
    if (carry === null) throw new Error('Expected a review to carry.');
    return carry.carriedOver(review);
  }

  it('names the repeated run and the run whose dialog was clicked', () => {
    expect(carriedOver(confirmedReview())).toEqual({
      fromRunId: first.runId,
      operatorReviewedRunId: first.runId,
      operatorReviewedAtIso: first.artifact.provenance?.review.reviewedAtIso,
    });
  });

  it.each<[string, () => Partial<ConfirmedJobReview>]>([
    ['carries no laser-mode evidence', () => ({ laserModeStartEvidence: undefined })],
    [
      'claims an acknowledgement nobody gave',
      () => ({
        laserModeStartEvidence: {
          ...confirmedReview().laserModeStartEvidence!,
          unverifiedAcknowledged: true,
        },
      }),
    ],
    [
      're-prepared with a different warning',
      () => ({ reviewModel: { ...modelFor(initial), warnings: ['Different.'] } }),
    ],
    [
      're-prepared a different program',
      () => ({
        bundle: { ...initial, prepared: { ...initial.prepared, gcode: 'G21\nG90\nM5' } },
      }),
    ],
    [
      're-prepared on another controller session',
      () => ({ bundle: { ...initial, laser: { ...initial.laser, controllerSessionEpoch: 8 } } }),
    ],
  ])('is not carried when it %s', (_name, overrides) => {
    expect(carriedOver(confirmedReview(overrides()))).toBeNull();
  });
});

describe('a stand-in the review gate refuses', () => {
  it('opens the dialog and leaves the Frame to the click made there', async () => {
    const framed = useLaserStore.getState().completedFrame;
    // The gate prepares again after the stand-in's confirm and finds a blocker.
    vi.mocked(requiredFrameIssueFromStart).mockReturnValueOnce('Frame this job again.');

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(first, repository));

    // The stand-in revoked nothing; the dialog opened and its click started the job.
    expect(shown).toHaveLength(1);
    expect(useLaserStore.getState().completedFrame?.candidate.spatialSignature).toBe(
      framed?.candidate.spatialSignature,
    );
    expect(useLaserStore.getState().startJob).toHaveBeenCalledOnce();
    expect(carriedNotices()).toEqual([]);
    expect(repository.getSnapshot().activeRun?.artifact.provenance?.review).not.toHaveProperty(
      'carriedOver',
    );
  });
});

describe('the record of a carried review', () => {
  const workflow = { kind: 'ordinary-start', completedReplaySourceRunId: 'run-a' } as const;
  const carried = {
    fromRunId: 'run-a',
    operatorReviewedRunId: 'run-a',
    operatorReviewedAtIso: '2026-11-11T09:00:00.000Z',
  };
  const review = { acknowledgement: { kind: 'laser-verified' }, carriedOver: carried };

  it('is valid on a laser-verified Run again of the run it names, and optional', () => {
    expect(hasValidCarriedOver(review, workflow)).toBe(true);
    expect(hasValidCarriedOver({ acknowledgement: { kind: 'cnc' } }, workflow)).toBe(true);
  });

  it.each<[string, Record<string, unknown>, Parameters<typeof hasValidCarriedOver>[1]]>([
    ['names another run than the workflow repeats', review, { kind: 'ordinary-start' }],
    [
      'sits on an acknowledged review',
      { ...review, acknowledgement: { kind: 'laser-unverified', prompt: 'x' } },
      workflow,
    ],
    [
      'sits on a CNC review',
      { ...review, acknowledgement: { kind: 'cnc', prompt: 'x' } },
      workflow,
    ],
    [
      'has no usable time',
      { ...review, carriedOver: { ...carried, operatorReviewedAtIso: 'yesterday' } },
      workflow,
    ],
    [
      'names no clicked run',
      { ...review, carriedOver: { ...carried, operatorReviewedRunId: '' } },
      workflow,
    ],
    ['is not a record', { ...review, carriedOver: 'run-a' }, workflow],
  ])('is rejected when it %s', (_name, value, workflowValue) => {
    expect(hasValidCarriedOver(value, workflowValue)).toBe(false);
  });

  it('says how many warnings were carried', () => {
    expect(carriedReviewNotice([])).toBe('Running the same reviewed job again.');
    expect(carriedReviewNotice(['a'])).toBe(
      'Running the same reviewed job again, with the same warning you accepted in Job Review.',
    );
    expect(carriedReviewNotice(['a', 'b'])).toBe(
      'Running the same reviewed job again, with the same 2 warnings you accepted in Job Review.',
    );
  });
});

describe('what this session remembers of reviewed runs', () => {
  const run = (runId: string) => ({
    runId,
    controllerSessionEpoch: 7,
    warnings: ['a'],
    operatorReviewedRunId: runId,
    operatorReviewedAtIso: '2026-11-11T09:00:00.000Z',
  });

  it('keeps the latest few runs and nothing after a reload', () => {
    forgetSessionReviewedRuns();
    for (let index = 0; index < 10; index += 1) noteSessionReviewedRun(run(`run-${index}`));

    expect(sessionReviewedRun('run-0')).toBeNull();
    expect(sessionReviewedRun('run-1')).toBeNull();
    expect(sessionReviewedRun('run-2')).toEqual(run('run-2'));
    expect(sessionReviewedRun('run-9')).toEqual(run('run-9'));

    forgetSessionReviewedRuns();
    expect(sessionReviewedRun('run-9')).toBeNull();
  });
});
