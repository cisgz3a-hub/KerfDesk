// Rolling audit v12 X2-P2-1 (ADR-637 Amendment 10): CNC pass and supervised
// recovery started a CNC job on a machine KerfDesk 1.0.29 may have made from a
// laser without asking, so the recovered program's `M3` and dwell fired the
// beam. Both now refuse, with the same question, until the owner answers.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  useConvertedLaserAnswerStore,
} from '../state/converted-laser-question';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { loadLastMachineSelection } from '../state/last-machine-persistence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resolveProjectMachineCapability } from '../state/project-machine-capability';
import { resetStore } from '../state/test-helpers';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import {
  recoveryProject,
  repository,
  saveInterruptedRun,
} from './cnc-pass-recovery-flow-test-fixtures';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { configureReadyCncRecovery } from './cnc-recovery-flow-testing';
import { CNC_RECOVERY_ASKS_IF_LASER } from './cnc-recovery-open-project';
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const SAVED_BY_1_0_29 = readFileSync(
  resolve('src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json'),
  'utf8',
);
const originalStartJob = useLaserStore.getState().startJob;
const PASS_REVIEW: CncPassRecoveryReview = {
  cutterClear: true,
  spindleStopped: true,
  workholdingConfirmed: true,
  toolConfirmed: true,
  position: { kind: 're-zeroed' },
  groupIndex: 0,
  passIndex: 0,
};
const SUPERVISED_REVIEW = {
  uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
  qualificationId: 'air-cut-2026-10-27',
  cutterClear: true,
  spindleStopped: true,
  positionRequalified: true,
  toolInspected: true,
  workholdingConfirmed: true,
  priorWorkConfirmed: true,
  clearedPathConfirmed: true,
} as const;

/** The machine createStartupProject restores from 1.0.29's last machine. */
function openThe1029Machine(): void {
  const selection = loadLastMachineSelection({
    getItem: () => SAVED_BY_1_0_29,
    setItem: () => undefined,
  });
  if (selection === null) throw new Error('The 1.0.29 last machine did not load');
  useStore.setState({
    project: resolveProjectMachineCapability(
      createProject(selection.profile),
      [],
      selection.machineKind,
    ).project,
  });
}

function resetAnswer(): void {
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  resetAnswer();
  configureReadyCncRecovery(recoveryProject());
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  resetAnswer();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('CNC recovery on the CNC 1.0.29 may have made from a laser', () => {
  it.each([
    ['pass', runCncPassRecoveryFlow, PASS_REVIEW],
    ['supervised', runCncSupervisedRecoveryFlow, SUPERVISED_REVIEW],
  ] as const)(
    'refuses %s recovery before any dialog, asks the question, and keeps the offer',
    async (_name, run, review) => {
      const repo = repository();
      const capsule = await saveInterruptedRun(repo);
      openThe1029Machine();
      const startJob = vi.fn(async () => undefined);
      useLaserStore.setState({ startJob });

      const started = await (run as typeof runCncPassRecoveryFlow)(
        capsule,
        review as CncPassRecoveryReview,
        repo,
      );

      expect(started).toBe(false);
      expect(vi.mocked(jobAwareAlert).mock.calls.map((call) => String(call[0]))).toEqual([
        `Cannot start CNC recovery:\n\n${CNC_RECOVERY_ASKS_IF_LASER}`,
      ]);
      expect(CNC_RECOVERY_ASKS_IF_LASER).toContain('turns the laser on at full power');
      expect(jobAwareConfirm).not.toHaveBeenCalled();
      expect(startJob).not.toHaveBeenCalled();
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
    },
    30_000,
  );

  it('starts pass recovery once the owner answers that it is a CNC router', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    openThe1029Machine();
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    useConvertedLaserAnswerStore.getState().answerRouter();

    expect(await runCncPassRecoveryFlow(capsule, PASS_REVIEW, repo)).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
  }, 30_000);
});
