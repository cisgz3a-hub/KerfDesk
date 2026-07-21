// ADR-237 seam tests for reviewFramedRunForStart: what the Start-time Job
// Review receives for a review-pending permit, and the exact-artifact
// backstop when a confirmed review no longer matches the framed program.
// The happy paths run through the real gate in start-job-flow.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { REVIEW_CHANGED_FRAMED_JOB_MESSAGE } from './framed-run-start-review';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import type { ConfirmedJobReview, ReviewedStartBundle } from './job-review';
import { buildJobReviewModel } from './job-review/job-review-model';
import { runStartJobFlow } from './start-job-flow';

const reviewHarness = vi.hoisted(() => ({
  runJobReviewGate: vi.fn(),
}));

vi.mock('./job-review', async (importOriginal) => {
  // Test-scaffold assertion: vitest types importOriginal as unknown-shaped.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runJobReviewGate: reviewHarness.runJobReviewGate };
});

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

type ReviewGateArgs = {
  readonly initial: ReviewedStartBundle;
  readonly checkpointToReplace: null;
  readonly completedReceipt: null;
  readonly purpose?: 'start' | 'frame';
};

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function runnableProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line-object',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({
    project: runnableProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: {
      kind: 'qualified',
      epoch: CONTROLLER_EPOCH,
      settings: 'verified',
    },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
  reviewHarness.runJobReviewGate.mockReset();
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({
    ...initialLaserState(),
    startJob: originalStartJob,
  });
  vi.restoreAllMocks();
});

describe('reviewFramedRunForStart', () => {
  it('hands the exact framed artifact and Frame WCS disclosure to the Start review', async () => {
    const installed = await installReviewPendingFramedRunPermitForCurrentState();
    const disclosure = 'Controller was using G55. KerfDesk selected G54.';
    const permit = {
      ...installed,
      candidate: { ...installed.candidate, frameWcsNormalizationWarning: disclosure },
    };
    useLaserStore.setState({ framedRun: permit });
    const gateCalls: ReviewGateArgs[] = [];
    reviewHarness.runJobReviewGate.mockImplementation(async (args: ReviewGateArgs) => {
      gateCalls.push(args);
      return null;
    });

    await runStartJobFlow();

    expect(reviewHarness.runJobReviewGate).toHaveBeenCalledTimes(1);
    const args = gateCalls[0];
    if (args === undefined) throw new Error('Expected the Start review gate to receive arguments.');
    expect(args.initial.prepared).toBe(permit.candidate.preparedStart);
    expect(args.initial.project).toBe(permit.candidate.project);
    expect(args.initial.externalEnvironment).toBe(permit.candidate.externalEnvironment);
    expect(args.initial.frameWcsNormalizationWarning).toBe(disclosure);
    expect(args.checkpointToReplace).toBeNull();
    expect(args.completedReceipt).toBeNull();
    // Omitted purpose defaults to 'start' inside the gate.
    expect(args.purpose).toBeUndefined();
    expect(vi.mocked(useLaserStore.getState().startJob)).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBe(permit);
  });

  it('voids the permit when the confirmed review no longer matches the framed artifact', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    reviewHarness.runJobReviewGate.mockImplementation(
      async (args: ReviewGateArgs): Promise<ConfirmedJobReview> => ({
        bundle: {
          ...args.initial,
          prepared: {
            ...args.initial.prepared,
            canvasPlan: {
              ...args.initial.prepared.canvasPlan,
              retentionKey: `${permit.candidate.executionSignature}-edited`,
            },
          },
        },
        reviewedAtIso: '2026-07-21T12:00:00.000Z',
        reviewModel: buildJobReviewModel({
          project: args.initial.project,
          prepared: args.initial.prepared,
          laserModeStartSnapshot: args.initial.laserModeStartSnapshot,
          overrides: args.initial.laser.ovCache,
        }),
        laserModeStartEvidence: undefined,
        cncSetupAttestation: undefined,
      }),
    );

    await runStartJobFlow();

    expect(vi.mocked(useLaserStore.getState().startJob)).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(REVIEW_CHANGED_FRAMED_JOB_MESSAGE);
  });
});
