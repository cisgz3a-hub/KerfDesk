import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type * as GcodeModule from '../../io/gcode';
import {
  cncControllerEpochOf,
  cncSetupAttestationMatches,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import {
  configureReadyCncRecovery,
  expectRecoveryWarningEvidence,
  injectPreflightIssues,
  injectRecoveryJobCompileIntegrityFailure,
  expectWholeProgramReplay,
  recoveryWarningFixtureIssues,
} from './cnc-recovery-flow-testing';
import { cncPassRecoveryDefaultPoint } from './cnc-pass-recovery-model';
import { expectCncPassRecoveryProvenance } from './cnc-pass-recovery-provenance-testing';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { frameVerificationForProject } from './frame-verification-testing';
import {
  ARCHIVED_WCO,
  recoveryProject,
  repository,
  saveInterruptedRun,
} from './cnc-pass-recovery-flow-test-fixtures';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

// Spy that defaults to the real emitter; a single test overrides one call to
// inject a preflight finding it cannot otherwise provoke.
vi.mock('../../io/gcode', async (importOriginal) => {
  const actual = await importOriginal<typeof GcodeModule>();
  return { ...actual, emitPreparedGcode: vi.fn(actual.emitPreparedGcode) };
});

const originalStartJob = useLaserStore.getState().startJob;
const baseReview: CncPassRecoveryReview = {
  cutterClear: true,
  spindleStopped: true,
  workholdingConfirmed: true,
  toolConfirmed: true,
  position: { kind: 're-zeroed' },
  groupIndex: 0,
  passIndex: 0,
};

beforeEach(() => {
  localStorage.clear();
  resetStore();
  configureReadyCncRecovery(recoveryProject());
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('cncPassRecoveryDefaultPoint', () => {
  it('defaults to the first pass while acked progress is inside the planner reserve', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    expect(cncPassRecoveryDefaultPoint(capsule)).toMatchObject({
      kind: 'resume-at-pass',
      groupIndex: 0,
      passIndex: 0,
      provenCompletePassCount: 0,
    });
  });
});

describe('runCncPassRecoveryFlow', () => {
  it('streams the sealed job from the default boundary without touching the open project', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const unrelatedOpenProject = createProject();
    useStore.setState({ project: unrelatedOpenProject });
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, baseReview, repo);

    expect(started).toBe(true);
    expect(useStore.getState().project).toBe(unrelatedOpenProject);
    expect(startJob).toHaveBeenCalledTimes(1);
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    expectWholeProgramReplay(recoveryGcode, capsule);
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
    const options = startJob.mock.calls[0]?.[1] as
      | {
          readonly cncSetupAttestation?: CncSetupAttestation;
          readonly machineKind?: string;
          readonly runId?: string;
        }
      | undefined;
    expect(options?.machineKind).toBe('cnc');
    expect(options?.runId).toBe(repo.getSnapshot().activeRun?.runId);
    expectCncPassRecoveryProvenance(repo, capsule, baseReview);
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        recoveryGcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('slices at a later boundary after the explicit late-pick warning', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const originalGcode = capsule.artifact.kind === 'exact-execution' ? capsule.artifact.gcode : '';
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 1 }, repo);

    expect(started).toBe(true);
    const warning = vi.mocked(jobAwareConfirm).mock.calls[0]?.[0] ?? '';
    expect(warning).toContain('START LATER THAN THE COMPUTED SAFE PASS?');
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    expect(recoveryGcode).not.toBe(originalGcode);
    expect(recoveryGcode).toContain('; cnc operation: profile-on-path; passes: 2');
    expect(recoveryGcode).toMatchSnapshot();
  });

  it('aborts without controller writes when the late-pick warning is declined', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    vi.mocked(jobAwareConfirm).mockReturnValueOnce(false);

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 1 }, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(repo.getSnapshot().recoveryCapsule).not.toBeNull();
  });

  it('refuses when the physical checklist is incomplete', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, cutterClear: false },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('cutter');
  });

  it('accepts retained position when the live work offset matches the archived one', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    // The WCO became known after the seeding Frame ran with a null WCO; the
    // operator re-frames at the live offset so the frame-first gate still
    // matches when recovery re-prepares this exact job (ADR-228).
    useLaserStore.setState({
      startJob,
      wcoCache: { ...ARCHIVED_WCO },
      frameVerification: frameVerificationForProject(useStore.getState().project, {
        wco: ARCHIVED_WCO,
      }),
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('accepts the same physical offset after reconnect changes report units', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo, {
      workOffset: { x: 25.4, y: 50.8, z: 12.7 },
    });
    const startJob = vi.fn(
      async (_gcode: string, options?: { assertFinalStartAuthorized?: () => void }) => {
        options?.assertFinalStartAuthorized?.();
      },
    );
    useLaserStore.setState({
      startJob,
      controllerSettings: { ...useLaserStore.getState().controllerSettings, reportInches: true },
      wcoCache: { x: 1, y: 2, z: 0.5 },
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledOnce();
  });

  it('refuses equal raw offsets that represent different physical origins after reconnect', async () => {
    const repo = repository();
    const workOffset = { x: 1, y: 2, z: 0.5 };
    const capsule = await saveInterruptedRun(repo, { workOffset });
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({
      startJob,
      controllerSettings: { ...useLaserStore.getState().controllerSettings, reportInches: true },
      wcoCache: workOffset,
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('work offset differs'));
  });

  it('rechecks report-unit certainty at the final recovery handoff', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(
      async (_gcode: string, options?: { assertFinalStartAuthorized?: () => void }) => {
        options?.assertFinalStartAuthorized?.();
      },
    );
    useLaserStore.setState({ startJob, wcoCache: ARCHIVED_WCO });
    const claim = repo.claimRecovery.bind(repo);
    vi.spyOn(repo, 'claimRecovery').mockImplementation(async (args) => {
      useLaserStore.setState({ reportUnitsUnconfirmed: true });
      return claim(args);
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('units are unconfirmed'));
    expect(repo.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
    expect(repo.getSnapshot().activeRun).toBeNull();
  });

  it('refuses when the live work offset drifts from the archive during the claim', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    // The real startJob runs this assertion synchronously at the wire
    // boundary, immediately before streamer creation.
    const startJob = vi.fn(
      async (_gcode: string, options?: { assertFinalStartAuthorized?: () => void }) => {
        options?.assertFinalStartAuthorized?.();
      },
    );
    // The WCO became known after the seeding Frame ran with a null WCO; the
    // operator re-frames at the live offset so the frame-first gate still
    // matches when recovery re-prepares this exact job (ADR-228).
    useLaserStore.setState({
      startJob,
      wcoCache: { ...ARCHIVED_WCO },
      frameVerification: frameVerificationForProject(useStore.getState().project, {
        wco: ARCHIVED_WCO,
      }),
    });
    const claim = repo.claimRecovery.bind(repo);
    vi.spyOn(repo, 'claimRecovery').mockImplementation(async (args) => {
      // A status frame lands while the operator reads the confirmation
      // dialogs or while the claim awaits storage: the live WCO no longer
      // matches the archived run, and no epoch records the change.
      useLaserStore.setState({ wcoCache: { x: 0, y: 0.2, z: 0 } });
      return claim(args);
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    const alerts = vi.mocked(jobAwareAlert).mock.calls.map(([message]) => String(message));
    expect(alerts.some((message) => message.includes('No recovery G-code was sent'))).toBe(true);
    expect(repo.getSnapshot().recoveryCapsule).not.toBeNull();
  });

  it('refuses retained position when the live work offset differs', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob, wcoCache: { x: 0, y: 0.2, z: 0 } });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('differs');
  });

  it('refuses retained position without an archived work-offset baseline', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo, { archiveWco: false });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain(
      'no archived work-offset observation',
    );
  });

  it('refuses retained position after a controller reboot interruption', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo, { interruptionKind: 'controller-reboot' });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('rebooted');
  });

  it('refuses a pass that does not exist in the sealed job', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 99 }, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('does not exist');
  });

  // Rule 7 / ADR-228 regression pin. `preflight.ok` is false for ANY issue, so
  // checking it directly refused recovery over heuristic policy findings and
  // stranded a partially-cut workpiece. Only compile integrity may refuse.
  it('starts recovery with one copy of more than 128 repeated policy advisories', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const issues = recoveryWarningFixtureIssues();
    await injectPreflightIssues(issues);

    const started = await runCncPassRecoveryFlow(capsule, baseReview, repo);

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jobAwareAlert)).not.toHaveBeenCalled();
    expectRecoveryWarningEvidence(
      vi.mocked(jobAwareConfirm).mock.calls.map(([message]) => String(message)),
      issues,
      repo.getSnapshot().activeRun?.artifact.provenance?.review?.warningsShown,
    );
  });

  it('still refuses recovery on a compile-integrity failure', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const injection = await injectRecoveryJobCompileIntegrityFailure();

    const started = await runCncPassRecoveryFlow(capsule, baseReview, repo);

    injection.assertRefusal(
      started,
      startJob.mock.calls.length,
      vi.mocked(jobAwareAlert).mock.calls.map(([message]) => String(message)),
    );
  });
});
