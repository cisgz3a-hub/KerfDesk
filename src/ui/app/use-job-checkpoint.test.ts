import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { createExecutionArtifact, RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const GCODE = Array.from({ length: 60 }, (_, index) => `G1 X${index} S100`).join('\n');
const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function repository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

function executionArtifact(runId: string) {
  const project = {
    device: {
      controllerKind: 'grbl-v1.1',
      streamingMode: 'char-counted',
      rxBufferBytes: 120,
    },
  } as unknown as Project;
  return createExecutionArtifact({
    runId,
    gcode: GCODE,
    prepared: {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: runId } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
}

function baseStreamer(): StreamerState {
  return step(createStreamer(GCODE)).state;
}

async function startTrackedRun(repo: RecoveryRepository, runId: string): Promise<void> {
  await repo.stageArtifact(executionArtifact(runId));
  await repo.activateFreshRun(runId, NOW);
  useLaserStore.setState({
    activeRunId: runId,
    streamer: baseStreamer(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
  });
}

async function waitForAck(repo: RecoveryRepository, count: number): Promise<void> {
  await vi.waitFor(() => expect(repo.getSnapshot().activeRun?.ackedLines).toBe(count));
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  useLaserStore.setState(initialLaserState());
});

describe('installJobCheckpointTracking', () => {
  it('advances only the owned run at the acknowledgement interval', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-a');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({ streamer: { ...base, completed: 10 } });
    expect(repo.getSnapshot().activeRun?.ackedLines).toBe(0);
    useLaserStore.setState({ streamer: { ...base, completed: 25 } });
    await waitForAck(repo, 25);

    useLaserStore.setState({ activeRunId: 'foreign', streamer: { ...base, completed: 50 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repo.getSnapshot().activeRun?.ackedLines).toBe(25);
  });

  it('moves a terminal stream into the isolated recovery capsule', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-a');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({
      safetyNotice: { kind: 'disconnect-during-job', message: 'USB connection was lost.' },
      streamer: { ...base, completed: 12, status: 'disconnected' },
    });
    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule).toMatchObject({
        runId: 'run-a',
        ackedLines: 12,
        interruption: { kind: 'disconnect' },
      }),
    );
  });

  it('creates a replay receipt only after done settles to connected Idle', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-done');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({
      streamer: { ...base, completed: 60, status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    useLaserStore.setState({
      streamer: null,
      controllerOperation: null,
      statusReport: IDLE_STATUS,
    });

    await vi.waitFor(() => expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-done'));
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('does not lose terminal settlement when a tiny run finishes before repository activation', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await repo.stageArtifact(executionArtifact('run-tiny'));
    const base = baseStreamer();
    useLaserStore.setState({
      activeRunId: 'run-tiny',
      streamer: { ...base, completed: 60, status: 'done' },
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    useLaserStore.setState({ streamer: null, controllerOperation: null });

    await vi.waitFor(() => expect(useLaserStore.getState().activeRunId).toBeNull());
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    await repo.activateFreshRun('run-tiny', NOW);
    await vi.waitFor(() => expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-tiny'));
    expect(repo.getSnapshot().activeRun).toBeNull();
  });

  it('does not create a replay receipt when done is released without settle proof', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-unsettled-done');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({ streamer: { ...base, completed: 60, status: 'done' } });
    useLaserStore.setState({ streamer: null, statusReport: IDLE_STATUS });

    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-unsettled-done'),
    );
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('treats disappearance before settled done as an interruption and clears stale ownership', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-lost');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({ streamer: { ...base, completed: 7 } });
    useLaserStore.setState({ streamer: null });

    await vi.waitFor(() => expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-lost'));
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });
});
