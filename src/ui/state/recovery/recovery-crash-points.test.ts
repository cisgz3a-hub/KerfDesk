// The app can die between any two storage steps of a job's life: Start intent,
// post-accept archive, activation, progress, interruption, recovery claim,
// recovery archive, recovery hand-off, recovery activation and completion
// (ADR-337, ADR-341). A restart must always surface exactly one truthful record:
// a recovery capsule whenever motion may have begun and not provably finished,
// the completion receipt once it did, never both and never nothing.

import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { RecoveryRepository } from './recovery-repository';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { createStartIntent } from './start-intent';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const GCODE = Array.from({ length: 80 }, (_, index) => `G1 X${index} S100`).join('\n');
const LEGACY = { read: () => null, clear: () => undefined };

type Expected =
  | { readonly kind: 'nothing' }
  | {
      readonly kind: 'capsule';
      readonly runId: string;
      readonly acked: number;
      readonly artifact: 'exact-execution' | 'legacy-fingerprint-only';
      readonly cause: 'unknown' | 'disconnect';
    }
  | { readonly kind: 'receipt'; readonly runId: string };

const CRASH_POINTS: ReadonlyArray<readonly [string, Expected]> = [
  ['before anything', { kind: 'nothing' }],
  [
    'after the Start intent',
    {
      kind: 'capsule',
      runId: 'run-1',
      acked: 0,
      artifact: 'legacy-fingerprint-only',
      cause: 'unknown',
    },
  ],
  [
    'after the post-accept archive',
    { kind: 'capsule', runId: 'run-1', acked: 0, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after activation',
    { kind: 'capsule', runId: 'run-1', acked: 0, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after progress 25',
    { kind: 'capsule', runId: 'run-1', acked: 25, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after progress 50',
    { kind: 'capsule', runId: 'run-1', acked: 50, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after the disconnect record',
    {
      kind: 'capsule',
      runId: 'run-1',
      acked: 57,
      artifact: 'exact-execution',
      cause: 'disconnect',
    },
  ],
  [
    'after claiming recovery',
    {
      kind: 'capsule',
      runId: 'run-1',
      acked: 57,
      artifact: 'exact-execution',
      cause: 'disconnect',
    },
  ],
  [
    'after the recovery archive',
    {
      kind: 'capsule',
      runId: 'run-1',
      acked: 57,
      artifact: 'exact-execution',
      cause: 'disconnect',
    },
  ],
  [
    'after the recovery hand-off',
    { kind: 'capsule', runId: 'run-2', acked: 0, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after recovery activation',
    { kind: 'capsule', runId: 'run-2', acked: 0, artifact: 'exact-execution', cause: 'unknown' },
  ],
  [
    'after recovery progress 25',
    { kind: 'capsule', runId: 'run-2', acked: 25, artifact: 'exact-execution', cause: 'unknown' },
  ],
  ['after the recovery completed', { kind: 'receipt', runId: 'run-2' }],
];

function lifecycle(repository: RecoveryRepository): Array<() => Promise<unknown>> {
  const revision = () => repository.getSnapshot().recoveryCapsule?.revision ?? -1;
  const handoff = () => ({
    sourceRunId: 'run-1',
    sourceRevision: revision(),
    attemptId: 'attempt-1',
    recoveryRunId: 'run-2',
  });
  return [
    () =>
      repository.armFreshStartIntent(
        'run-1',
        createStartIntent({
          gcode: GCODE,
          machineKind: 'laser',
          outputScope: DEFAULT_OUTPUT_SCOPE,
          nowIso: new Date().toISOString(),
        }),
      ),
    async () =>
      repository.stageArtifact(
        await createCurrentTestExecutionArtifact({ runId: 'run-1', gcode: GCODE }),
      ),
    () => repository.activateFreshRun('run-1'),
    () => repository.updateProgress('run-1', 25),
    () => repository.updateProgress('run-1', 50),
    () => repository.interruptRun('run-1', 57, { kind: 'disconnect', message: 'cable' }),
    () =>
      repository.claimRecovery({ runId: 'run-1', revision: revision(), attemptId: 'attempt-1' }),
    async () =>
      repository.stageArtifact(
        await createCurrentTestExecutionArtifact({ runId: 'run-2', gcode: GCODE }),
      ),
    () => repository.armClaimedRecoveryStart(handoff()),
    () => repository.activateClaimedRecovery(handoff()),
    () => repository.updateProgress('run-2', 25),
    () => repository.completeRun('run-2'),
  ];
}

describe('restart after the app dies at every storage step of a job and its recovery', () => {
  it.each(CRASH_POINTS.map(([name, expected], crashAfter) => ({ name, expected, crashAfter })))(
    'dies $name: the restart shows the one truthful record',
    async ({ expected, crashAfter }) => {
      const backend = new MemoryRecoveryStorageBackend();
      const generationStore = new MemoryRecoveryGenerationStore();
      const before = new RecoveryRepository({ backend, generationStore, legacyStorage: LEGACY });
      await before.initialize();
      const steps = lifecycle(before);
      for (const step of steps.slice(0, crashAfter)) {
        expect(await step()).toMatchObject({ ok: true });
      }
      // Restart a minute later, after any Start hand-off lease has lapsed.
      const after = new RecoveryRepository({
        backend,
        generationStore,
        legacyStorage: LEGACY,
        nowIso: () => new Date(Date.now() + 60_000).toISOString(),
      });
      expect((await after.initialize()).ok).toBe(true);
      const snapshot = after.getSnapshot();
      expect(snapshot.activeRun).toBeNull();
      expect(snapshot.pendingStart).toBeNull();
      const runIds = snapshot.executionHistory.map((record) => record.runId);
      expect(new Set(runIds).size).toBe(runIds.length);
      if (expected.kind === 'nothing') {
        expect(snapshot.recoveryCapsule).toBeNull();
        expect(snapshot.lastCompletedReceipt).toBeNull();
        return;
      }
      if (expected.kind === 'receipt') {
        expect(snapshot.recoveryCapsule).toBeNull();
        expect(snapshot.lastCompletedReceipt?.runId).toBe(expected.runId);
        return;
      }
      expect(snapshot.lastCompletedReceipt).toBeNull();
      expect(snapshot.recoveryCapsule).toMatchObject({
        runId: expected.runId,
        ackedLines: expected.acked,
        artifact: { kind: expected.artifact },
        interruption: { kind: expected.cause },
      });
      if (expected.artifact === 'exact-execution') {
        const archived = await after.getArchivedExecution(expected.runId);
        expect(archived).toMatchObject({
          ok: true,
          value: { runId: expected.runId, gcode: GCODE },
        });
      }
      // A recovered run keeps its original ancestor for lineage replay and painting.
      if (expected.runId === 'run-2') {
        expect(await after.getArchivedExecution('run-1')).toMatchObject({ ok: true });
      }
    },
  );
});
