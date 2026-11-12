// A Marlin laser through the real Start flow, review gate and recovery
// repository (annoyance audit A2 B3-P2-1; ADR-095 Amendment 1 and ADR-237
// Amendment 4). Before the operator's power-scale statement every Job Review
// asks, and Run again never carries it. After the statement Job Review shows
// one fact line, Run again carries the review, and the archive records the
// statement as the operator's, never as verified. Only `startJob` is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marlinDriver } from '../../core/controllers';
import {
  createOperatorPowerScaleStatement,
  operatorStatedPowerScaleFact,
  unreportedPowerScaleStartPrompt,
} from '../../core/devices/power-scale-statement';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { isExecutionProvenance } from '../state/recovery/execution-provenance';
import { forgetSessionReviewedRuns } from '../state/session-reviewed-runs';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import {
  arrangeFramedLaserJob,
  carriedNotices,
  committingStartJob,
  finishActiveRun,
  frameAgain,
  reviewsShownBy,
} from './run-again-review-carry.test-support';
import { runCompletedJobAgainFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const STATED_AT = '2026-11-11T10:00:00.000Z';
const originalStartJob = useLaserStore.getState().startJob;
let uninstallAutoReview: () => void = () => undefined;
let repository: RecoveryRepository;

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

function device() {
  return useStore.getState().project.device;
}

/** Record the operator's statement for the profile as it is, then Frame. */
async function stateThePowerScale(): Promise<void> {
  const statement = createOperatorPowerScaleStatement(device(), STATED_AT);
  if (statement === null) throw new Error('fixture: Marlin takes a statement');
  useStore.getState().updateDeviceProfile({ operatorPowerScaleStatement: statement });
  await frameAgain();
}

async function finishRun(): Promise<LastCompletedReceipt> {
  const receipt = await finishActiveRun(repository);
  startSpy().mockClear();
  return receipt;
}

beforeEach(async () => {
  repository = await arrangeFramedLaserJob(vi.fn(committingStartJob));
  // The same job on a Marlin laser: no settings report, no `$` settings.
  useStore.getState().updateDeviceProfile({
    controllerKind: 'marlin',
    gcodeDialect: { dialectId: 'marlin-inline' },
    streamingMode: 'ping-pong',
    maxPowerS: 255,
  });
  useLaserStore.setState({
    capabilities: marlinDriver.capabilities,
    activeControllerKind: 'marlin',
    detectedControllerKind: 'marlin',
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'not-required' },
  });
  await frameAgain();
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

describe('a Marlin laser before the operator has stated the power scale', () => {
  it('is asked on every Start, in Marlin words, and names the check in the warnings', async () => {
    const shown = await reviewsShownBy(() => runStartJobFlow(repository));

    expect(shown).toHaveLength(1);
    expect(shown[0]?.acknowledgement).toEqual({
      kind: 'laser-unverified',
      prompt: unreportedPowerScaleStartPrompt(device()),
    });
    const scaleNotes = shown[0]?.warnings.filter((warning) => /power scale/.test(warning)) ?? [];
    expect(scaleNotes).toHaveLength(1);
    expect(scaleNotes[0]).toContain('Marlin does not report its laser power scale');
    expect(`${scaleNotes[0]}`).not.toMatch(/\$3[0-2]|GRBL/);
    expect(repository.getSnapshot().activeRun?.artifact.provenance?.review).toMatchObject({
      acknowledgement: { kind: 'laser-unverified' },
      laserModeStartEvidence: { settingsCapability: 'none', unverifiedAcknowledged: true },
    });
  });

  it('never gets the Run again shortcut, as the audit found', async () => {
    await runStartJobFlow(repository);
    const first = await finishRun();

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(first, repository));

    expect(shown).toHaveLength(1);
    expect(shown[0]?.acknowledgement.kind).toBe('laser-unverified');
    expect(carriedNotices()).toEqual([]);
  });
});

describe('a Marlin laser after the operator has stated the power scale', () => {
  beforeEach(stateThePowerScale);

  it('shows one fact line in Job Review: no banner, no warning, and not "verified"', async () => {
    const shown = await reviewsShownBy(() => runStartJobFlow(repository));

    expect(shown).toHaveLength(1);
    const statement = device().operatorPowerScaleStatement;
    if (statement === undefined) throw new Error('expected the statement');
    expect(shown[0]?.acknowledgement).toEqual({
      kind: 'laser-operator-stated',
      statement: operatorStatedPowerScaleFact(statement),
    });
    expect(shown[0]?.warnings.filter((warning) => /power scale/.test(warning))).toEqual([]);
  });

  it('archives the run as operator-stated, with the statement and no click claimed', async () => {
    await runStartJobFlow(repository);

    const provenance = repository.getSnapshot().activeRun?.artifact.provenance;
    expect(isExecutionProvenance(provenance)).toBe(true);
    expect(provenance?.review).toMatchObject({
      acknowledgement: { kind: 'laser-operator-stated' },
      laserModeStartEvidence: {
        settingsCapability: 'none',
        unverifiedAcknowledged: false,
        expectedMaxPowerS: 255,
        operatorStatedPowerScale: {
          maxPowerS: 255,
          controllerKind: 'marlin',
          dialectId: 'marlin-inline',
          statedAtIso: STATED_AT,
        },
      },
    });
    expect(startSpy().mock.calls[0]?.[1]).toMatchObject({
      laserModeStartEvidence: {
        unverifiedAcknowledged: false,
        operatorStatedPowerScale: { maxPowerS: 255 },
      },
    });
  });

  it('lets Run again carry the review, and the carried run is operator-stated too', async () => {
    await runStartJobFlow(repository);
    const first = await finishRun();

    const shown = await reviewsShownBy(() => runCompletedJobAgainFlow(first, repository));

    expect(shown).toEqual([]);
    expect(startSpy()).toHaveBeenCalledExactlyOnceWith(first.artifact.gcode, expect.any(Object));
    expect(carriedNotices()).toHaveLength(1);
    const provenance = repository.getSnapshot().activeRun?.artifact.provenance;
    expect(isExecutionProvenance(provenance)).toBe(true);
    expect(provenance?.review).toMatchObject({
      acknowledgement: { kind: 'laser-operator-stated' },
      laserModeStartEvidence: { operatorStatedPowerScale: { statedAtIso: STATED_AT } },
      carriedOver: { fromRunId: first.runId, operatorReviewedRunId: first.runId },
    });
  });

  it('carries nothing once the statement no longer stands, and Start asks again', async () => {
    await runStartJobFlow(repository);
    const first = await finishRun();
    // Unticking it in Machine Setup is a profile edit like any other: the
    // completed run's inputs changed, so Run again does not repeat it at all.
    useStore.getState().updateDeviceProfile({ operatorPowerScaleStatement: undefined });
    await frameAgain();

    await runCompletedJobAgainFlow(first, repository);
    expect(startSpy()).not.toHaveBeenCalled();
    expect(carriedNotices()).toEqual([]);

    const shown = await reviewsShownBy(() => runStartJobFlow(repository));
    expect(shown).toHaveLength(1);
    expect(shown[0]?.acknowledgement.kind).toBe('laser-unverified');
  });
});

describe('the statement and the G-code', () => {
  it('does not change one byte of the program', async () => {
    await runStartJobFlow(repository);
    const before = (await finishRun()).artifact.gcode;
    await stateThePowerScale();
    await runStartJobFlow(repository);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(before);
    expect(before).toContain('S');
  });
});
