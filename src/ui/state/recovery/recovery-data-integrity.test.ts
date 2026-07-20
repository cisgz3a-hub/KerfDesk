import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import {
  createExecutionArtifact,
  isExecutionArtifact,
  isLegacyFingerprintArtifact,
  type ExecutionArtifactV1,
  type LegacyFingerprintOnlyArtifactV1,
} from './execution-artifact';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { matchesStoredArtifact } from './recovery-artifact-identity';
import {
  emptyRecoverySlots,
  CURRENT_EXECUTION_ARTIFACT_ORIGIN,
  LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
  MAX_PERSISTED_EXECUTION_HISTORY_INPUT_RUNS,
  MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
  validStoredArtifact,
  validRecoverySlots,
  type PersistedRecoverySlots,
  type RecoveryCapsuleRecord,
} from './recovery-model';
import { hydrateRecoverySnapshot } from './recovery-snapshot';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-07-15T10:00:00.000Z';

function artifact(runId = 'run-integrity'): ExecutionArtifactV1 {
  const project = {
    device: {
      controllerKind: 'grbl-v1.1',
      streamingMode: 'char-counted',
      rxBufferBytes: 120,
    },
  } as unknown as Project;
  return createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: 'G21\nG90\nG1 X1\nM5\n',
    prepared: {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
}

function legacyArtifact(exact: ExecutionArtifactV1): LegacyFingerprintOnlyArtifactV1 {
  return {
    schemaVersion: 1,
    kind: 'legacy-fingerprint-only',
    runId: exact.runId,
    createdAtIso: NOW,
    migratedAtIso: NOW,
    fingerprint: exact.fingerprint,
    sendableLines: exact.sendableLines,
    machineKind: exact.machineKind,
    outputScope: DEFAULT_OUTPUT_SCOPE,
  };
}

function capsuleFor(exact: ExecutionArtifactV1): RecoveryCapsuleRecord {
  return {
    runId: exact.runId,
    artifactKind: exact.kind,
    revision: 1,
    ackedLines: 1,
    sendableLines: exact.sendableLines,
    interruption: { kind: 'disconnect', message: 'Cable removed.' },
    updatedAtIso: NOW,
  };
}

describe('recovery persistence validation', () => {
  it('binds exact artifact schema to its immutable storage origin', () => {
    const legacy = artifact();
    const migratedRecord = {
      runId: legacy.runId,
      generation: 0,
      origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
      artifact: legacy,
    };

    expect(validStoredArtifact(migratedRecord)).toEqual(migratedRecord);
    expect(
      validStoredArtifact({ ...migratedRecord, origin: CURRENT_EXECUTION_ARTIFACT_ORIGIN }),
    ).toBeNull();
  });

  it('binds legacy-checkpoint origin to schema v1', () => {
    const legacy = legacyArtifact(artifact());
    const record = {
      runId: legacy.runId,
      generation: 0,
      origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
      artifact: legacy,
    };

    expect(validStoredArtifact(record)).toEqual(record);
    expect(
      validStoredArtifact({
        ...record,
        artifact: { ...legacy, schemaVersion: 2 },
      }),
    ).toBeNull();
  });

  it('accepts only a fully matching legacy checkpoint collision', async () => {
    const exact = artifact('run-legacy-collision');
    const legacy = legacyArtifact(exact);
    const backend = new MemoryRecoveryStorageBackend();
    await backend.putArtifact({
      runId: legacy.runId,
      generation: 0,
      origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
      artifact: legacy,
    });

    await expect(
      matchesStoredArtifact(backend, 0, {
        ...legacy,
        // A retry may occur later after the artifact insert succeeded but the
        // slot transaction failed. Migration time is not checkpoint identity.
        migratedAtIso: '2026-07-15T10:05:00.000Z',
      }),
    ).resolves.toBe(true);
    await expect(
      matchesStoredArtifact(backend, 0, {
        ...legacy,
        fingerprint: { ...legacy.fingerprint, fnv1a: legacy.fingerprint.fnv1a + 1 },
      }),
    ).resolves.toBe(false);
    await expect(
      matchesStoredArtifact(backend, 0, {
        ...legacy,
        sendableLines: legacy.sendableLines + 1,
      }),
    ).resolves.toBe(false);
  });

  it('requires a complete OutputScope in exact and legacy artifact guards', () => {
    const exact = artifact();
    const legacy = legacyArtifact(exact);
    expect(isExecutionArtifact(exact)).toBe(true);
    expect(isLegacyFingerprintArtifact(legacy)).toBe(true);

    expect(
      isExecutionArtifact({
        ...exact,
        outputScope: { cutSelectedGraphics: false, selectedObjectIds: [] },
      }),
    ).toBe(false);
    expect(
      isLegacyFingerprintArtifact({
        ...legacy,
        outputScope: {
          cutSelectedGraphics: false,
          useSelectionOrigin: false,
          selectedObjectIds: [7],
        },
      }),
    ).toBe(false);
  });

  it('accepts only supported JobInterruption variants and fields', () => {
    const exact = artifact();
    const valid = {
      ...emptyRecoverySlots(0),
      recoveryCapsule: {
        ...capsuleFor(exact),
        interruption: {
          kind: 'controller-error',
          message: 'Controller rejected a line.',
          rejectedLine: 'G1 X1',
        },
      },
    } satisfies PersistedRecoverySlots;
    expect(validRecoverySlots(valid, 0).recoveryCapsule?.interruption).toEqual(
      valid.recoveryCapsule.interruption,
    );

    expect(
      validRecoverySlots(
        {
          ...valid,
          recoveryCapsule: {
            ...valid.recoveryCapsule,
            interruption: { kind: 'made-up', message: 'Not a real variant.' },
          },
        },
        0,
      ).recoveryCapsule,
    ).toBeNull();
    expect(
      validRecoverySlots(
        {
          ...valid,
          recoveryCapsule: {
            ...valid.recoveryCapsule,
            interruption: {
              kind: 'controller-error',
              message: 'Malformed rejected line.',
              rejectedLine: 42,
            },
          },
        },
        0,
      ).recoveryCapsule,
    ).toBeNull();
  });

  it('drops only malformed v3 history entries without erasing valid recovery state', () => {
    const exact = artifact('run-history-integrity');
    const base = emptyRecoverySlots(7);
    const activeRun = {
      runId: 'run-active',
      ackedLines: 1,
      sendableLines: 4,
      startedAtIso: NOW,
      updatedAtIso: NOW,
      estimatedArtifactBytes: 512,
    };
    const recoveryCapsule = capsuleFor(exact);
    const lastCompletedReceipt = { runId: 'run-completed', completedAtIso: NOW };
    const pendingStart = {
      runId: 'run-pending',
      kind: 'fresh' as const,
      sendableLines: 4,
      armedAtIso: NOW,
    };
    const validHistory = {
      runId: 'run-history-valid',
      terminalKind: 'completed' as const,
      startedAtIso: NOW,
      terminalAtIso: NOW,
      ackedLines: 4,
      sendableLines: 4,
      estimatedArtifactBytes: 1024,
    };

    const parsed = validRecoverySlots(
      {
        ...base,
        activeRun,
        recoveryCapsule,
        lastCompletedReceipt,
        pendingStart,
        executionHistory: [
          validHistory,
          { ...validHistory, runId: 'run-history-corrupt', estimatedArtifactBytes: -1 },
        ],
      },
      7,
    );

    expect(parsed).toMatchObject({
      generation: 7,
      activeRun,
      recoveryCapsule,
      lastCompletedReceipt,
      pendingStart,
    });
    expect(parsed.executionHistory).toEqual([validHistory]);
  });

  it('caps untrusted persisted history input before hydration work', () => {
    const entries = Array.from({ length: 70 }, (_, index) => ({
      runId: `run-untrusted-history-${index}`,
      terminalKind: 'completed' as const,
      startedAtIso: NOW,
      terminalAtIso: NOW,
      ackedLines: 1,
      sendableLines: 1,
      estimatedArtifactBytes: 0,
    }));

    const parsed = validRecoverySlots({ ...emptyRecoverySlots(0), executionHistory: entries }, 0);
    expect(parsed.executionHistory).toHaveLength(MAX_PERSISTED_EXECUTION_HISTORY_INPUT_RUNS);
    expect(parsed.executionHistory[0]?.runId).toBe('run-untrusted-history-6');
    expect(parsed.executionHistory.at(-1)?.runId).toBe('run-untrusted-history-69');
  });

  it('does not hydrate active or interrupted progress with a mismatched artifact line count', async () => {
    const exact = await createCurrentTestExecutionArtifact({ runId: 'run-line-count-mismatch' });
    const backend = new MemoryRecoveryStorageBackend();
    await backend.putArtifact({
      runId: exact.runId,
      generation: 0,
      origin: CURRENT_EXECUTION_ARTIFACT_ORIGIN,
      artifact: exact,
    });

    const matchingActive = {
      runId: exact.runId,
      ackedLines: 1,
      sendableLines: exact.sendableLines,
      startedAtIso: NOW,
      updatedAtIso: NOW,
    };
    const activeSlots: PersistedRecoverySlots = {
      ...emptyRecoverySlots(0),
      activeRun: { ...matchingActive, sendableLines: exact.sendableLines + 1 },
    };
    expect((await hydrateRecoverySnapshot(backend, activeSlots)).activeRun).toBeNull();

    const capsuleSlots: PersistedRecoverySlots = {
      ...emptyRecoverySlots(0),
      recoveryCapsule: {
        ...capsuleFor(exact),
        sendableLines: exact.sendableLines + 1,
      },
    };
    expect((await hydrateRecoverySnapshot(backend, capsuleSlots)).recoveryCapsule).toBeNull();

    const matchingSlots: PersistedRecoverySlots = {
      ...emptyRecoverySlots(0),
      activeRun: matchingActive,
    };
    expect((await hydrateRecoverySnapshot(backend, matchingSlots)).activeRun?.runId).toBe(
      exact.runId,
    );
  });
});
