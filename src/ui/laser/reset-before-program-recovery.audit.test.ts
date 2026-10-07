import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createJobCheckpoint } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { LASER_START_OVERRIDE_RESET } from '../state/laser-start-override-reset';
import { isJobStartBeforeProgramError } from '../state/laser-start-transmission-error';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { recoveryRepository } from '../state/recovery';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import {
  installResetBoundaryFailure,
  installResetBoundaryState,
  resetBoundaryRecoveryFixture,
  RESET_BOUNDARY_NOW,
} from './reset-before-program-recovery.test-support';
import { streamResumeFromRawLine } from './start-job-resume-stream';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROL_WRITES = [`${grblDriver.commands.settleDwell}\n`, LASER_START_OVERRIDE_RESET];

beforeEach(() => {
  localStorage.clear();
  installResetBoundaryState();
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('a reset-only Start cannot claim program transmission', () => {
  it.each([false, true])(
    'keeps the exact sealed source and releases its claim after reset refusal (closed=%s)',
    async (closed) => {
      const { repository, capsule, fromLine } = await resetBoundaryRecoveryFixture();
      const control = installResetBoundaryFailure('reject', closed);

      expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(false);

      expect(control.writes).toEqual(CONTROL_WRITES);
      expect(control.errors).toHaveLength(1);
      expect(isJobStartBeforeProgramError(control.errors[0])).toBe(true);
      const snapshot = repository.getSnapshot();
      expect(snapshot.recoveryCapsule).toMatchObject({
        runId: capsule.runId,
        ackedLines: capsule.ackedLines,
        interruption: capsule.interruption,
        artifact: { fingerprint: capsule.artifact.fingerprint },
      });
      expect(snapshot.recoveryCapsule?.claim).toBeUndefined();
      expect(snapshot.pendingStart).toBeNull();
      expect(snapshot.activeRun).toBeNull();
      expect(snapshot.executionHistory).toHaveLength(1);
    },
  );

  it('keeps the source retryable when actual Abort wins a pending reset without program bytes', async () => {
    const { repository, capsule, fromLine } = await resetBoundaryRecoveryFixture();
    const control = installResetBoundaryFailure('hold');
    const starting = runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine });
    await control.resetWritten;

    await control.actions.stopJob();
    control.release();

    expect(await starting).toBe(false);
    expect(control.writes).toEqual([
      ...CONTROL_WRITES,
      grblDriver.realtime.softReset,
      'M5\n',
      'M9\n',
    ]);
    expect(isJobStartBeforeProgramError(control.errors[0])).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
    expect(repository.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(useLaserStore.getState().controllerSessionEpoch).toBeGreaterThan(9);
  });

  it.each(['refusal', 'Abort'] as const)(
    'restores its manual checkpoint and keeps the archive after reset-only %s',
    async (boundary) => {
      const { prepared, repository, capsule, fromLine } = await resetBoundaryRecoveryFixture();
      const retire = vi
        .spyOn(recoveryRepository, 'noteUntrackedRunAccepted')
        .mockImplementation(() => repository.noteUntrackedRunAccepted());
      const control = installResetBoundaryFailure(boundary === 'Abort' ? 'hold' : 'reject');
      const checkpoint = createJobCheckpoint({
        gcode: prepared.gcode,
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: RESET_BOUNDARY_NOW,
      });
      writeJobCheckpoint(checkpoint);
      const laser = useLaserStore.getState();
      const starting = streamResumeFromRawLine(
        prepared.prepared.project,
        prepared.gcode,
        fromLine,
        prepared.canvasPlan,
        captureLaserModeStartSnapshot(laser),
        laser,
      );
      if (boundary === 'Abort') {
        await control.resetWritten;
        await control.actions.stopJob();
        control.release();
      }

      expect(await starting).toBe(false);

      expect(control.writes.slice(0, 2)).toEqual(CONTROL_WRITES);
      expect(
        control.writes.every(
          (data) => CONTROL_WRITES.includes(data) || ['\x18', 'M5\n', 'M9\n'].includes(data),
        ),
      ).toBe(true);
      expect(isJobStartBeforeProgramError(control.errors[0])).toBe(true);
      expect(retire).not.toHaveBeenCalled();
      expect(repository.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
      expect(readJobCheckpoint()).toEqual(checkpoint);
    },
  );

  it('does not restore a manual checkpoint replaced while reset was pending', async () => {
    const { prepared, fromLine } = await resetBoundaryRecoveryFixture();
    const control = installResetBoundaryFailure('hold');
    writeJobCheckpoint(
      createJobCheckpoint({
        gcode: prepared.gcode,
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: RESET_BOUNDARY_NOW,
      }),
    );
    const laser = useLaserStore.getState();
    const starting = streamResumeFromRawLine(
      prepared.prepared.project,
      prepared.gcode,
      fromLine,
      prepared.canvasPlan,
      captureLaserModeStartSnapshot(laser),
      laser,
    );
    await control.resetWritten;
    const replacement = createJobCheckpoint({
      gcode: 'G21\nG90\nM5\n',
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-09-22T00:00:01.000Z',
    });
    writeJobCheckpoint(replacement);
    await control.actions.stopJob();
    control.release();

    expect(await starting).toBe(false);
    expect(readJobCheckpoint()).toEqual(replacement);
  });

  it.each(['resolves', 'rejects'] as const)(
    'leaves a replacement owner untouched when the old reset %s without a program attempt',
    async (outcome) => {
      const { repository, capsule, fromLine } = await resetBoundaryRecoveryFixture();
      const control = installResetBoundaryFailure('hold');
      const starting = runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine });
      await control.resetWritten;
      const streamer = step(createStreamer('G1 X99\n')).state;
      const operation = { kind: 'start-arming', phase: 'queue-fence' } as const;
      // Owner-injection invariant: this is not a claim that an ordinary user
      // can create two active sessions. Real Abort is covered separately.
      useLaserStore.setState((state) => ({
        streamer,
        streamerEpoch: state.streamerEpoch + 1,
        controllerSessionEpoch: state.controllerSessionEpoch + 1,
        activeRunId: 'replacement-run',
        controllerOperation: operation,
      }));
      if (outcome === 'rejects') control.rejectReset(new Error('Old reset rejected late.'));
      else control.release();

      expect(await starting).toBe(false);
      expect(control.writes).toEqual(CONTROL_WRITES);
      expect(repository.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
      expect(repository.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(useLaserStore.getState().streamer).toBe(streamer);
      expect(useLaserStore.getState().controllerOperation).toBe(operation);
      expect(useLaserStore.getState().activeRunId).toBe('replacement-run');
      expect(useLaserStore.getState().safetyNotice).toBeNull();
    },
  );
});
