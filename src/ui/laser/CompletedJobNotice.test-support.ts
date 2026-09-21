import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { useStore } from '../state';
import { startLiveCanvasRun, type LiveCanvasRun } from '../state/canvas-motion-plan';
import { laserCountdownTestHandoff } from '../state/laser-countdown-test-handoff';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

export const COMPLETED_GCODE = 'G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5';
const STARTED_AT = '2026-09-21T10:00:00.000Z';
const COMPLETED_AT = '2026-09-21T10:01:00.000Z';

export function completedRun(): LiveCanvasRun {
  const { canvasPlan } = laserCountdownTestHandoff({
    gcode: COMPLETED_GCODE,
    retentionKey: currentReplayExecutionSignature(),
    capability: 'realtime',
  });
  return {
    ...startLiveCanvasRun(canvasPlan, Date.parse(STARTED_AT)),
    lifecycle: 'finished',
    timing: { kind: 'complete' },
    endedAtMs: Date.parse(COMPLETED_AT),
  };
}

export function showCompletedRun(run = completedRun()): LiveCanvasRun {
  useLaserStore.setState({
    liveCanvasRun: run,
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 10, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  });
  return run;
}

export async function completedRepository(run: LiveCanvasRun): Promise<RecoveryRepository> {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => COMPLETED_AT,
  });
  await repository.initialize();
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'run-completed-display',
    gcode: COMPLETED_GCODE,
    prepared: {
      ok: true,
      project: useStore.getState().project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: run.plan,
    controllerSettings: null,
    createdAtIso: STARTED_AT,
  });
  await repository.stageArtifact(artifact);
  await repository.activateFreshRun(artifact.runId, STARTED_AT);
  await repository.completeRun(artifact.runId, COMPLETED_AT);
  return repository;
}
