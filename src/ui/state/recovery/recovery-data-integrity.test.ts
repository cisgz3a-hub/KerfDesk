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
import {
  emptyRecoverySlots,
  validRecoverySlots,
  type PersistedRecoverySlots,
  type RecoveryCapsuleRecord,
} from './recovery-model';
import { hydrateRecoverySnapshot } from './recovery-snapshot';

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

  it('does not hydrate active or interrupted progress with a mismatched artifact line count', async () => {
    const exact = artifact();
    const backend = new MemoryRecoveryStorageBackend();
    await backend.putArtifact({ runId: exact.runId, generation: 0, artifact: exact });

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
