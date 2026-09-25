// A terminal the tracker sees while the Start's execution archive is still
// being built waits for activation (ADR-337). The laser store keeps changing
// while it waits: the operator acknowledges the safety notice, a later notice
// replaces it, trailing oks raise the ack, the stream disappears. The record
// must still be what the tracker first saw, as it is when the archive is
// already active; ADR-341 Amendment 3 restarts a controller error at the
// rejected line only while the interruption still names that line.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step, type StreamerStatus } from '../../core/controllers/grbl';
import type { JobInterruption } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import {
  controllerErrorNotice,
  disconnectDuringJobNotice,
  writeFailedNotice,
} from '../state/laser-safety-notice';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { buildPortClosePatch, initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createStartIntent } from '../state/recovery/start-intent';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-09-24T01:00:00.000Z';
const RUN = 'prearchive-first-terminal';
const REJECTED = 'G1 X20 S100';
const GCODE = `G21\nG90\nG1 X10 S100\n${REJECTED}\nG1 X30 S100\nM5\n`;
const ACKED_AT_TERMINAL = 4;
const REJECTION = controllerErrorNotice(1, 'job', 'error:1', REJECTED);
const CABLE_LOSS = disconnectDuringJobNotice();
const ABORT = { jobStopRequest: { reason: 'operator', streamerEpoch: 0 } } as const;
// The last status report before the terminal: two planner blocks behind ack 3.
const PLANNER_SNAPSHOT = { streamerEpoch: 0, sessionEpoch: 0, ackedLines: 3, queuedBlocks: 2 };
const PLANNER_BACKLOG = { ackedAtStatus: 3, queuedBlocks: 2 };

type Case = {
  readonly name: string;
  readonly status: StreamerStatus;
  readonly atTerminal: Partial<LaserState>;
  /** Store changes while the terminal waits, applied in order. A trailing ok
   * acknowledges a line the controller had already buffered; the port closes
   * through the store's real port-close patch. */
  readonly whileWaiting: ReadonlyArray<
    Partial<LaserState> | 'trailing ok' | 'port closes' | 'stream disappears'
  >;
  readonly recorded: JobInterruption;
};

const REJECTED_INTERRUPTION: JobInterruption = {
  kind: 'controller-error',
  message: REJECTION.message,
  rejectedLine: REJECTED,
};
const ABORT_INTERRUPTION: JobInterruption = {
  kind: 'cancelled',
  message: 'Stopped by the operator (Abort).',
};

const CASES: ReadonlyArray<Case> = [
  {
    name: 'a controller error the operator then acknowledges',
    status: 'errored',
    atTerminal: { safetyNotice: REJECTION },
    whileWaiting: ['trailing ok', { safetyNotice: null }],
    recorded: REJECTED_INTERRUPTION,
  },
  {
    name: 'a controller error followed by cable loss',
    status: 'errored',
    atTerminal: { safetyNotice: REJECTION },
    whileWaiting: ['trailing ok', 'port closes'],
    recorded: REJECTED_INTERRUPTION,
  },
  {
    name: 'a controller error whose stream disappears after the acknowledgement',
    status: 'errored',
    atTerminal: { safetyNotice: REJECTION },
    whileWaiting: ['trailing ok', { safetyNotice: null }, 'stream disappears'],
    recorded: REJECTED_INTERRUPTION,
  },
  {
    name: 'a disconnect the operator then acknowledges',
    status: 'disconnected',
    atTerminal: { safetyNotice: CABLE_LOSS, connection: { kind: 'disconnected' } },
    whileWaiting: [{ safetyNotice: null }],
    recorded: { kind: 'disconnect', message: CABLE_LOSS.message },
  },
  {
    // recordWriteFailure raises this with the port still open. The Abort stays
    // the cause, as it does when the archive is already active.
    name: 'an Abort whose reset write then fails',
    status: 'errored',
    atTerminal: ABORT,
    whileWaiting: [{ safetyNotice: writeFailedNotice('stop') }],
    recorded: ABORT_INTERRUPTION,
  },
  {
    name: 'a controller error with a planner backlog the operator then acknowledges',
    status: 'errored',
    atTerminal: { safetyNotice: REJECTION, streamPlannerSnapshot: PLANNER_SNAPSHOT },
    whileWaiting: ['trailing ok', { safetyNotice: null }],
    recorded: { ...REJECTED_INTERRUPTION, plannerBacklog: PLANNER_BACKLOG },
  },
  {
    // A narrow race: two quiescent Run reports before the reset lands re-prove
    // capacity and rewrite the snapshot of this still-errored stream.
    name: 'a controller error whose planner snapshot a later report rewrites',
    status: 'errored',
    atTerminal: { safetyNotice: REJECTION, streamPlannerSnapshot: PLANNER_SNAPSHOT },
    whileWaiting: [
      'trailing ok',
      {
        streamPlannerSnapshot: {
          streamerEpoch: 0,
          sessionEpoch: 0,
          ackedLines: 4,
          queuedBlocks: 0,
        },
      },
    ],
    recorded: { ...REJECTED_INTERRUPTION, plannerBacklog: PLANNER_BACKLOG },
  },
  {
    name: 'an Abort with a planner backlog whose reset write then fails',
    status: 'errored',
    atTerminal: { ...ABORT, streamPlannerSnapshot: PLANNER_SNAPSHOT },
    whileWaiting: [{ safetyNotice: writeFailedNotice('stop') }],
    recorded: { ...ABORT_INTERRUPTION, plannerBacklog: PLANNER_BACKLOG },
  },
];

let uninstall = (): void => undefined;

afterEach(() => {
  uninstall();
  // initialLaserState() has no stop request or planner snapshot, and setState
  // merges: without these a case would inherit the previous case's causes.
  useLaserStore.setState({
    ...initialLaserState(),
    jobStopRequest: null,
    streamPlannerSnapshot: null,
  });
  vi.restoreAllMocks();
});

async function fixture() {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const reportFailure = vi.fn();
  uninstall = installJobCheckpointTracking(() => NOW, repository, reportFailure);
  const intent = createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
  expect(await repository.armFreshStartIntent(RUN, intent, NOW)).toEqual({ ok: true, value: true });
  return { repository, reportFailure };
}

async function activate(repository: RecoveryRepository) {
  const artifact = await createCurrentTestExecutionArtifact({
    runId: RUN,
    gcode: GCODE,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect(await repository.activateFreshRun(RUN, NOW)).toEqual({ ok: true, value: true });
}

function storeChange(change: Case['whileWaiting'][number]): Partial<LaserState> {
  if (change === 'stream disappears') return { streamer: null };
  if (change === 'port closes') return buildPortClosePatch(useLaserStore.getState());
  if (change !== 'trailing ok') return change;
  const streamer = useLaserStore.getState().streamer;
  if (streamer === null) throw new Error('Expected the terminal stream.');
  return { streamer: { ...streamer, completed: streamer.completed + 1 } };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe.each(['pending', 'already active'] as const)('with the Start archive %s', (archive) => {
  it.each(CASES)('records what the tracker first saw: $name', async (terminal) => {
    const input = await fixture();
    if (archive === 'already active') await activate(input.repository);
    const interrupt = vi.spyOn(input.repository, 'interruptRun');
    const streamer = step(createStreamer(GCODE)).state;
    useLaserStore.setState({
      activeRunId: RUN,
      streamer,
      streamerEpoch: 0,
      connection: { kind: 'connected' },
    });
    useLaserStore.setState({
      streamer: { ...streamer, status: terminal.status, completed: ACKED_AT_TERMINAL },
      ...terminal.atTerminal,
    });
    await vi.waitFor(() => expect(interrupt).toHaveBeenCalled());
    await flush();
    // Before activation the pending Start intent owns the run: the terminal waits.
    expect(input.repository.getSnapshot().recoveryCapsule?.runId).toBe(
      archive === 'pending' ? undefined : RUN,
    );

    for (const change of terminal.whileWaiting) {
      useLaserStore.setState(storeChange(change));
      await flush();
    }

    if (archive === 'pending') await activate(input.repository);
    await vi.waitFor(() => expect(input.repository.getSnapshot().recoveryCapsule?.runId).toBe(RUN));
    const capsule = input.repository.getSnapshot().recoveryCapsule;
    expect(capsule?.interruption).toEqual(terminal.recorded);
    expect(capsule?.ackedLines).toBe(ACKED_AT_TERMINAL);
    expect(input.repository.getSnapshot().activeRun).toBeNull();
    expect(input.reportFailure).not.toHaveBeenCalled();
  });
});
