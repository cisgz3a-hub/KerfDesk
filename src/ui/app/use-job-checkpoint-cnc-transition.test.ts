import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import {
  connectAndStartCnc,
  EXPECTED_HEARTBEAT_TIMEOUT_MS,
  flushPromises,
  makeConnectionHarness,
  observeOutcome,
  pauseAtSettledDoor,
  type ConnectionHarness,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import { resetCncPauseResumeTest } from '../../__fixtures__/controllers/cnc-pause-resume-lifecycle';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { initialLaserState } from '../state/laser-store-helpers';
import { controllerErrorNotice } from '../state/laser-safety-notice';
import { useLaserStore } from '../state/laser-store';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-10-07T08:50:00.000Z';
const LATER = '2026-10-07T08:51:00.000Z';
const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
let uninstall: (() => void) | null = null;
let currentHarness: ConnectionHarness | null = null;

function answerResetAndManualReads(harness: ConnectionHarness): void {
  harness.setWriteOverride(async (data) => {
    if (data === RT_SOFT_RESET) {
      harness.connection.emitLine('Grbl 1.1f');
      harness.emitStatus(IDLE);
    }
    if (data === 'M5\n' || data === 'M9\n') harness.connection.emitLine('ok');
    if (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake') return;
    if (data === '$I\n') {
      harness.connection.emitLine('[VER:1.1h.20190830:test]');
      harness.connection.emitLine('[OPT:VM,15,128]');
      harness.connection.emitLine('ok');
    }
    if (data === '$G\n') {
      harness.connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      harness.connection.emitLine('ok');
    }
  });
}

async function pausedTrackedRun(runId: string) {
  const harness = makeConnectionHarness();
  currentHarness = harness;
  answerResetAndManualReads(harness);
  await connectAndStartCnc(harness);
  const acceptedStreamer = useLaserStore.getState().streamer;
  if (acceptedStreamer === null) throw new Error('The CNC test stream did not start.');
  const gcode = acceptedStreamer.queued.join('').trimEnd();
  const project = { ...createProject(DEFAULT_DEVICE_PROFILE), machine: DEFAULT_CNC_MACHINE_CONFIG };
  const artifact = await createCurrentTestExecutionArtifact({
    runId,
    gcode,
    project,
    createdAtIso: NOW,
  });
  expect(artifact.machineKind).toBe('cnc');
  expect(artifact.sendableLines).toBe(acceptedStreamer.total);
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
  expect((await repository.initialize()).ok).toBe(true);
  expect(await repository.stageArtifact(artifact)).toEqual({ ok: true, value: runId });
  expect(await repository.activateFreshRun(runId, NOW)).toEqual({ ok: true, value: true });
  useLaserStore.setState({ activeRunId: runId });
  const reportFailure = vi.fn();
  uninstall = installJobCheckpointTracking(() => LATER, repository, reportFailure);
  const activeRun = repository.getSnapshot().activeRun;
  expect(activeRun).toMatchObject({ runId, artifact, startedAtIso: NOW, ackedLines: 0 });
  const slotsBefore = await backend.readSlots();

  await pauseAtSettledDoor(harness);
  harness.setStatusResponsesEnabled(false);
  vi.useFakeTimers();
  const resume = observeOutcome(useLaserStore.getState().resumeJob());
  await flushPromises();
  await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
  await flushPromises();
  expect(resume.result()).toBe('rejected');
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
  const transitionWarning = useLaserStore.getState().safetyNotice;
  expect(transitionWarning?.kind).toBe('cnc-transition-unconfirmed');
  expect(repository.getSnapshot().activeRun).toEqual(activeRun);
  expect(await backend.readSlots()).toEqual(slotsBefore);
  expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  expect(repository.getSnapshot().executionHistory).toEqual([]);
  expect(useLaserStore.getState().activeRunId).toBe(runId);
  expect(reportFailure).not.toHaveBeenCalled();
  return { harness, repository, backend, artifact, reportFailure, transitionWarning };
}

async function expectTerminal(
  context: Awaited<ReturnType<typeof pausedTrackedRun>>,
  kind: 'cancelled' | 'disconnect' | 'controller-error',
  message: string,
  ackedLines: number,
): Promise<void> {
  await flushPromises();
  await vi.waitFor(() =>
    expect(context.repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId: context.artifact.runId,
      ackedLines,
      artifact: context.artifact,
      interruption: { kind, message },
    }),
  );
  const snapshot = context.repository.getSnapshot();
  expect(snapshot.activeRun).toBeNull();
  expect(snapshot.lastCompletedReceipt).toBeNull();
  expect(snapshot.recoveryCapsule?.interruption.message).not.toBe(
    context.transitionWarning?.message,
  );
  expect(snapshot.executionHistory).toMatchObject([
    { runId: context.artifact.runId, terminalKind: 'interrupted', interruption: { kind, message } },
  ]);
  expect(await context.backend.readSlots()).toMatchObject({
    activeRun: null,
    recoveryCapsule: { runId: context.artifact.runId, interruption: { kind, message } },
    lastCompletedReceipt: null,
  });
  expect(context.reportFailure).not.toHaveBeenCalled();
}

beforeEach(() => useLaserStore.setState(initialLaserState()));

afterEach(async () => {
  uninstall?.();
  uninstall = null;
  currentHarness?.setStatusResponsesEnabled(true);
  currentHarness?.emitStatus(IDLE);
  currentHarness = null;
  await resetCncPauseResumeTest();
  useLaserStore.setState(initialLaserState());
});

describe('real CNC checkpoint persistence after an unconfirmed Resume', () => {
  it('retains the active run through the warning, then records the actual accepted Abort', async () => {
    const context = await pausedTrackedRun('cnc-transition-abort');
    await useLaserStore.getState().stopJob();
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    await expectTerminal(context, 'cancelled', 'Stopped by the operator (Abort).', 0);
  });

  it('retains the active run through the warning, then records an actual Disconnect', async () => {
    const context = await pausedTrackedRun('cnc-transition-disconnect');
    await useLaserStore.getState().disconnect();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    await expectTerminal(context, 'disconnect', 'The serial connection closed during the job.', 0);
  });

  it('records a later controller rejection without archiving the earlier Resume guidance', async () => {
    const context = await pausedTrackedRun('cnc-transition-error');
    const rejectedLine = useLaserStore.getState().streamer?.inFlight[0]?.line ?? '';
    expect(rejectedLine).not.toBe('');
    context.harness.connection.emitLine('error:20');
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    const rejected = controllerErrorNotice(20, 'job', 'error:20', rejectedLine);
    await expectTerminal(context, 'controller-error', rejected.message, 1);
    expect(context.repository.getSnapshot().recoveryCapsule?.interruption.rejectedLine).toBe(
      rejectedLine.trim(),
    );
  });
});
