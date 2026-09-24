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
import type { LaserSafetyNotice } from '../state/laser-safety-notice';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
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
const REJECTION: LaserSafetyNotice = {
  kind: 'controller-error',
  code: 1,
  rejectedLine: REJECTED,
  message: 'The controller rejected a line (error:1).',
};
const CABLE_LOSS: LaserSafetyNotice = {
  kind: 'disconnect-during-job',
  message: 'The USB link dropped while the job was running.',
};
const RESET_WRITE_FAILED: LaserSafetyNotice = {
  kind: 'write-failed',
  action: 'stop',
  message: 'The stop command could not be written to the controller.',
};

type Case = {
  readonly name: string;
  readonly status: StreamerStatus;
  readonly atTerminal: Partial<LaserState>;
  /** Store changes while the terminal waits, applied in order. A trailing ok
   * acknowledges a line the controller had already buffered. */
  readonly whileWaiting: ReadonlyArray<Partial<LaserState> | 'trailing ok' | 'stream disappears'>;
  readonly recorded: JobInterruption;
};

const REJECTED_INTERRUPTION: JobInterruption = {
  kind: 'controller-error',
  message: REJECTION.message,
  rejectedLine: REJECTED,
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
    whileWaiting: [
      'trailing ok',
      { safetyNotice: CABLE_LOSS, connection: { kind: 'disconnected' } },
    ],
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
    name: 'an Abort whose reset write then fails',
    status: 'errored',
    atTerminal: { jobStopRequest: { reason: 'operator', streamerEpoch: 0 } },
    whileWaiting: [{ safetyNotice: RESET_WRITE_FAILED }],
    recorded: { kind: 'cancelled', message: 'Stopped by the operator (Abort).' },
  },
];

let uninstall = (): void => undefined;

afterEach(() => {
  uninstall();
  useLaserStore.setState(initialLaserState());
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
