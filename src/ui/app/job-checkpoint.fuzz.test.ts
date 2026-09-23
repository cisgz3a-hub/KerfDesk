// Randomized interleavings for the job checkpoint tracker (ADR-341 §7 and §10).
// Each seed scripts a chain of runs through the real tracker and the real
// recovery repository: random progress, random terminal paths (settled
// completion, cable loss, abort, controller rejection, a stream that vanishes
// before settling) and random storage latency, with the next run sometimes
// starting while the previous terminal is still being persisted. Invariants:
// exactly one terminal per run, completion offered only for settled runs and
// never twice, interruption records carry the acknowledged count at the moment
// of interruption, and no false tracking failure.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { buildPortClosePatch, initialLaserState } from '../state/laser-store-helpers';
import { controllerErrorNotice } from '../state/laser-safety-notice';
import { RecoveryRepository, type RecoveryRepositorySnapshot } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { createStartIntent } from '../state/recovery/start-intent';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const TOTAL = 80;
const GCODE = Array.from({ length: TOTAL }, (_, index) => `G1 X${index} S100`).join('\n');
const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

type Terminal = 'settled' | 'cable' | 'abort' | 'rejected' | 'vanished';
const TERMINALS: ReadonlyArray<Terminal> = ['settled', 'cable', 'abort', 'rejected', 'vanished'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wrap repository writes with seeded latency so persistence interleaves with
 * later store updates in a different order on every seed. */
function withLatency(repository: RecoveryRepository, random: () => number): void {
  for (const method of ['updateProgress', 'interruptRun', 'completeRun'] as const) {
    const original = repository[method].bind(repository) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(repository, method).mockImplementation((async (...args: unknown[]) => {
      await pause(Math.floor(random() * 4));
      const result = await original(...args);
      await pause(Math.floor(random() * 3));
      return result;
    }) as never);
  }
}

/** The production Start protocol (ADR-337): arm the durable intent, retrying
 * as an operator would after "Another job Start is already being prepared";
 * the controller accepts; the archive is staged and activated afterwards.
 * Returns how many Start presses were refused first, and the post-accept
 * archive, which completes in the background while the job streams. */
async function beginRun(
  repository: RecoveryRepository,
  runId: string,
): Promise<{ readonly refused: number; readonly archiving: Promise<void> }> {
  const intent = createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: new Date().toISOString(),
  });
  let refused = 0;
  for (;;) {
    const armed = await repository.armFreshStartIntent(runId, intent);
    if (armed.ok && armed.value) break;
    await repository.cancelPendingStart(runId);
    refused += 1;
    if (refused > 400) throw new Error(`Start for ${runId} stayed blocked by an earlier run.`);
    await pause(5);
  }
  useLaserStore.setState({
    activeRunId: runId,
    streamer: step(createStreamer(GCODE)).state,
    connection: { kind: 'connected' },
    statusReport: IDLE,
    controllerOperation: null,
    safetyNotice: null,
  });
  const archiving = (async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId,
      gcode: GCODE,
      createdAtIso: new Date().toISOString(),
    });
    await repository.stageArtifact(artifact);
    await repository.activateFreshRun(runId);
  })();
  return { refused, archiving };
}

function advance(completed: number): void {
  const streamer = useLaserStore.getState().streamer as StreamerState;
  useLaserStore.setState({ streamer: { ...streamer, completed } });
}

/** Drive one terminal path; returns the acknowledged count at interruption. */
async function finish(terminal: Terminal, random: () => number): Promise<number> {
  const streamer = useLaserStore.getState().streamer as StreamerState;
  const acked = streamer.completed;
  if (terminal === 'settled' || terminal === 'vanished') {
    useLaserStore.setState({
      streamer: { ...streamer, completed: TOTAL, status: 'done' },
      ...(terminal === 'settled'
        ? {
            controllerOperation: {
              kind: 'post-job-settle' as const,
              phase: 'awaiting-idle' as const,
              idleReports: 2,
            },
          }
        : {}),
    });
    await pause(Math.floor(random() * 3));
    useLaserStore.setState({
      streamer: null,
      controllerOperation: null,
      statusReport: { ...IDLE },
    });
    return TOTAL;
  }
  if (terminal === 'cable') {
    useLaserStore.setState(buildPortClosePatch(useLaserStore.getState()));
    await pause(Math.floor(random() * 3));
    // Reconnecting later clears the retained evidence stream.
    useLaserStore.setState({
      streamer: null,
      connection: { kind: 'connected' },
      statusReport: IDLE,
    });
    return acked;
  }
  const status = terminal === 'abort' ? 'cancelled' : 'errored';
  useLaserStore.setState({
    streamer: { ...streamer, status },
    safetyNotice:
      terminal === 'abort'
        ? { kind: 'write-failed', action: 'stop', message: 'Stopped by the operator.' }
        : controllerErrorNotice(1, 'job', 'error:1', 'G1 X9 S100'),
  });
  await pause(Math.floor(random() * 3));
  useLaserStore.setState({ streamer: null });
  return acked;
}

/** Wait (up to 10 s, generous for a loaded machine) until no run is active or
 * pending, and optionally until every listed run has its history record. */
async function settle(
  repository: RecoveryRepository,
  runIds: ReadonlyArray<string> = [],
): Promise<RecoveryRepositorySnapshot> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = repository.getSnapshot();
    const recorded = new Set(snapshot.executionHistory.map((record) => record.runId));
    if (
      snapshot.activeRun === null &&
      snapshot.pendingStart === null &&
      runIds.every((runId) => recorded.has(runId))
    ) {
      return snapshot;
    }
    await pause(5);
  }
  return repository.getSnapshot();
}

type ScriptedRun = { readonly runId: string; readonly terminal: Terminal; readonly acked: number };

/** One scripted run: Start, random progress, a random terminal path, and half
 * the time a pause for persistence before the operator's next Start. */
async function scriptRun(
  repository: RecoveryRepository,
  runId: string,
  random: () => number,
): Promise<{ readonly run: ScriptedRun; readonly archiving: Promise<void> }> {
  const started = await beginRun(repository, runId);
  // The accepted run's archive may still be activating; progress defers.
  await pause(Math.floor(random() * 3));
  let completed = 0;
  const stops = Math.floor(random() * (TOTAL - 1));
  while (completed < stops) {
    completed = Math.min(stops, completed + 1 + Math.floor(random() * 17));
    advance(completed);
    if (random() < 0.3) await pause(Math.floor(random() * 3));
  }
  const terminal = TERMINALS[Math.floor(random() * TERMINALS.length)] ?? 'settled';
  const acked = await finish(terminal, random);
  if (random() < 0.5) {
    await started.archiving;
    await settle(repository);
  }
  useLaserStore.setState({ activeRunId: null });
  return { run: { runId, terminal, acked }, archiving: started.archiving };
}

function expectOneTruthfulTerminalPerRun(
  snapshot: RecoveryRepositorySnapshot,
  script: ReadonlyArray<ScriptedRun>,
): void {
  const history = new Map(snapshot.executionHistory.map((record) => [record.runId, record]));
  for (const { runId, terminal, acked } of script) {
    const record = history.get(runId);
    expect(record, `${runId} has a terminal record`).toBeDefined();
    if (terminal === 'settled') {
      expect(record?.terminalKind, `${runId} settled`).toBe('completed');
    } else {
      expect(record?.terminalKind, `${runId} ${terminal}`).toBe('interrupted');
      expect(record?.ackedLines, `${runId} ${terminal} acknowledged count`).toBe(acked);
    }
  }
}

function expectOffersOnlyForSettledRuns(
  offered: ReadonlyArray<string>,
  script: ReadonlyArray<ScriptedRun>,
): void {
  const settledRuns = script.filter((entry) => entry.terminal === 'settled').map((e) => e.runId);
  expect(new Set(offered).size).toBe(offered.length);
  expect(offered.every((runId) => settledRuns.includes(runId))).toBe(true);
  const last = script.at(-1);
  if (last?.terminal === 'settled') expect(offered.at(-1)).toBe(last.runId);
}

describe('checkpoint tracker under randomized lifecycles and storage latency', () => {
  it.each(Array.from({ length: 12 }, (_, index) => 101 + index * 37))(
    'seed %i: one terminal per run, completion offered only for settled runs',
    async (seed) => {
      const random = mulberry32(seed);
      const repository = new RecoveryRepository({
        backend: new MemoryRecoveryStorageBackend(),
        generationStore: new MemoryRecoveryGenerationStore(),
        legacyStorage: { read: () => null, clear: () => undefined },
      });
      await repository.initialize();
      withLatency(repository, random);
      const offered: string[] = [];
      const reportFailure = vi.fn();
      uninstall = installJobCheckpointTracking(
        () => new Date().toISOString(),
        repository,
        reportFailure,
        (runId) => offered.push(runId),
      );
      const script: ScriptedRun[] = [];
      const archives: Promise<void>[] = [];
      for (let run = 0; run < 8; run += 1) {
        const scripted = await scriptRun(repository, `run-${seed}-${run}`, random);
        script.push(scripted.run);
        archives.push(scripted.archiving);
      }
      await Promise.all(archives);
      const snapshot = await settle(
        repository,
        script.map((entry) => entry.runId),
      );
      await pause(30);
      expectOneTruthfulTerminalPerRun(snapshot, script);
      expectOffersOnlyForSettledRuns(offered, script);
      expect(reportFailure).not.toHaveBeenCalled();
    },
    120_000,
  );
});
