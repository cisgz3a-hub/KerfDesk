import { afterEach, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { completedRun } from '../laser/CompletedJobNotice.test-support';
import { ensureTerminalCanvasRunInvalidationSubscriptions } from '../laser/terminal-canvas-run-invalidation';
import { startLiveCanvasRun, type LiveCanvasRun } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-10-02T01:00:00.000Z';
const GCODE = 'G21\nM4 S0\nG1 X10 F1500 S300\nM5';
let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  useLaserStore.setState(initialLaserState());
  resetStore();
});

it('retires stale display after clean settlement reaches the recovery owner', async () => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [svgObj('burn', ['#000000'])] } },
  });
  // The display observer is installed first, as it can be in the real shell.
  ensureTerminalCanvasRunInvalidationSubscriptions();
  const repo = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  await repo.initialize();
  const completed = vi.fn();
  uninstall = installJobCheckpointTracking(() => NOW, repo, vi.fn(), completed);
  const runId = 'display-cleanup-settlement';
  await repo.stageArtifact(
    await createCurrentTestExecutionArtifact({ runId, gcode: GCODE, createdAtIso: NOW }),
  );
  await repo.activateFreshRun(runId, NOW);
  const active = startLiveCanvasRun(completedRun().plan);
  useLaserStore.setState({
    activeRunId: runId,
    streamer: step(createStreamer(GCODE)).state,
    liveCanvasRun: active,
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: null,
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  });
  const liveProject = useStore.getState().project;
  useStore.setState({
    project: {
      ...liveProject,
      scene: { ...liveProject.scene, objects: [svgObj('next-piece', ['#000000'])] },
    },
  });
  const stream = useLaserStore.getState().streamer;
  if (stream === null) throw new Error('No active stream.');
  useLaserStore.setState({
    streamer: { ...stream, status: 'done', completed: stream.total },
    controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 2 },
  });
  useLaserStore.setState({
    streamer: null,
    controllerOperation: null,
    liveCanvasRun: { ...active, lifecycle: 'finished', timing: { kind: 'complete' } },
  });
  await vi.waitFor(() => expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe(runId));
  expect(completed).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledWith(runId);
  expect(repo.getSnapshot().recoveryCapsule).toBeNull();
  expect(useLaserStore.getState().liveCanvasRun).toBeNull();
});

it.each(['running', 'errored', 'finished'] as const)(
  'pending display cleanup cannot retire a replacement %s execution',
  async (lifecycle: LiveCanvasRun['lifecycle']) => {
    resetStore();
    useLaserStore.setState(initialLaserState());
    ensureTerminalCanvasRunInvalidationSubscriptions();
    const previous = completedRun();
    useLaserStore.setState({ liveCanvasRun: previous });
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, scene: { ...project.scene, objects: [svgObj('new', ['#000000'])] } },
    });
    const replacement = { ...previous, startedAtMs: previous.startedAtMs + 1, lifecycle };
    useLaserStore.setState({ liveCanvasRun: replacement });
    await Promise.resolve();
    expect(useLaserStore.getState().liveCanvasRun).toBe(replacement);
  },
);

it('pending display cleanup cannot retire a new stream with the same plan and clock stamp', async () => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  ensureTerminalCanvasRunInvalidationSubscriptions();
  const previous = completedRun();
  useLaserStore.setState({ liveCanvasRun: previous });
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [svgObj('next', ['#000000'])] } },
  });
  const replacement = { ...previous };
  useLaserStore.setState({ liveCanvasRun: replacement, streamerEpoch: 1 });
  await Promise.resolve();
  expect(useLaserStore.getState().liveCanvasRun).toBe(replacement);
});
