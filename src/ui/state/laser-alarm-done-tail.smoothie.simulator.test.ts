// Rolling audit 2026-10-21, 05-P2-2: Smoothieware answers a move once it is
// queued and holds up to 32 (GcodeDispatch.cpp, Conveyor.cpp), so after the
// last `ok` the stream is 'done' while the planner still moves. A kill button
// or hard limit then flushed that queue, but the 'done' stream stayed 'done',
// the next Idle released it as an unexplained stop with no planner step-back,
// and recovery restarted at the last line: the discarded moves were skipped.
// The alarm now ends the run 'cancelled', recorded exactly as the same alarm
// one acknowledgement earlier is.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Conveyor.cpp

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { RecoveryRepository } from './recovery';
import {
  createCurrentTestExecutionArtifact,
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from './recovery/testing';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const LINES = 40;
const JOB = Array.from({ length: LINES }, (_, i) => `G1 X${i} Y1 F600 S0.5`).join('\n');
const NOW = '2026-10-21T12:00:00.000Z';
// DEFAULT_PLANNER_BLOCKS.smoothieware: Conveyor's `planner_queue_size` default.
const SMOOTHIE_PLANNER_BLOCKS = 32;

let untrack = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  untrack();
  untrack = () => undefined;
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    activeRunId: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A tracked 40-line job on a Smoothieware board whose moves take 5 s each,
 * so every line is answered long before the planner has run them. */
async function trackedSmoothieJob(): Promise<{
  readonly sim: SmoothieSimulator;
  readonly repository: RecoveryRepository;
}> {
  const sim = createSmoothieSimulator({ motionMs: 5_000 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  const runId = 'smoothie-done-tail';
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  expect((await repository.initialize()).ok).toBe(true);
  const artifact = await createCurrentTestExecutionArtifact({
    runId,
    gcode: JOB,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  await startTestLaserJob(JOB, { runId, streamingMode: 'ping-pong' });
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
  untrack = installJobCheckpointTracking(() => NOW, repository);
  return { sim, repository };
}

async function untilAcknowledged(lines: number): Promise<void> {
  for (
    let tick = 0;
    tick < 400 && (useLaserStore.getState().streamer?.completed ?? 0) < lines;
    tick += 1
  ) {
    await pump(1);
  }
  expect(useLaserStore.getState().streamer?.completed).toBe(lines);
}

async function savedCapsule(repository: RecoveryRepository) {
  for (let tick = 0; tick < 200 && repository.getSnapshot().recoveryCapsule === null; tick += 1) {
    await pump(1);
  }
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('No recovery capsule was saved.');
  return capsule;
}

function expectPlannerStepBack(
  capsule: Awaited<ReturnType<typeof savedCapsule>>,
  ackedLines: number,
): void {
  expect(capsule.ackedLines).toBe(ackedLines);
  expect(capsule.interruption).toMatchObject({
    kind: 'cancelled',
    plannerBacklog: {
      ackedAtStatus: ackedLines,
      queuedBlocks: SMOOTHIE_PLANNER_BLOCKS,
      bound: 'planner-size',
    },
  });
  const restart = automaticRestart(JOB, capsule.ackedLines, capsule.interruption);
  // The restart steps back over the whole planner the halt discarded.
  expect(restart.line).toBe(Math.max(1, ackedLines - SMOOTHIE_PLANNER_BLOCKS + 1));
  expect(restart.plannerBacklogBlocks).toBe(SMOOTHIE_PLANNER_BLOCKS);
}

describe('05-P2-2: a Smoothieware halt after the last acknowledgement', () => {
  it('records the kill button after the last ok as a planner-discarding stop', async () => {
    const { sim, repository } = await trackedSmoothieJob();
    await untilAcknowledged(LINES);
    const before = useLaserStore.getState();
    expect(before.streamer?.status).toBe('done');
    expect(before.controllerOperation?.kind).toBe('post-job-settle');
    expect(sim.state().pendingMotions).toBeGreaterThan(0);

    sim.pressKillButton();
    await pump(5);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().controllerOperation).toBeNull();

    expectPlannerStepBack(await savedCapsule(repository), LINES);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });

  it('records a halt seen only in the Alarm status report the same way', async () => {
    const { sim, repository } = await trackedSmoothieJob();
    await untilAcknowledged(LINES);
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    // A halt whose ALARM text was lost: only the next status report says it.
    sim.triggerHalt();
    for (
      let tick = 0;
      tick < 2_000 && useLaserStore.getState().statusReport?.state !== 'Alarm';
      tick += 1
    ) {
      await pump(1);
    }
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');

    expectPlannerStepBack(await savedCapsule(repository), LINES);
  });

  it('records it as the same alarm is recorded while lines are still streaming', async () => {
    const { sim, repository } = await trackedSmoothieJob();
    await untilAcknowledged(20);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    sim.pressKillButton();
    await pump(5);
    // A reply already on its way can land before the alarm line does.
    const stopped = useLaserStore.getState().streamer;
    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.completed).toBeLessThan(LINES);
    expectPlannerStepBack(await savedCapsule(repository), stopped?.completed ?? -1);
  });
});
