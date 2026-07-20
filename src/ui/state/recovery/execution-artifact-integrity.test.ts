import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import type { LaserState } from '../laser-store';
import {
  createArchivedControllerObservation,
  createExecutionArtifact,
  type ExecutionArtifactV1,
} from './execution-artifact';
import { executionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { CURRENT_EXECUTION_ARTIFACT_ORIGIN, emptyRecoverySlots } from './recovery-model';
import {
  computeExecutionProvenanceEnvelopeSha256,
  createExecutionProvenance,
  type ExecutionProvenanceV1,
} from './execution-provenance';
import { RecoveryRepository } from './recovery-repository';
import { hydrateRecoverySnapshot } from './recovery-snapshot';
import {
  laserRecoveryExecutionEvidence,
  ordinaryExecutionEvidence,
  type ExecutionProvenanceEvidenceV2,
} from './execution-workflow-evidence';

const NOW = '2026-07-19T03:00:00.000Z';
const GCODE = 'G21\nG90\nG1 X1 S100\nM5\n';

describe('execution artifact provenance integrity', () => {
  it('rejects every legacy exact artifact regardless of its former provenance shape', async () => {
    const current = await artifactWithCurrentProvenance('run-current');
    const preObservationBindingV2 = await withPreObservationBindingV2(current);
    const v1 = withLegacyV1Provenance(current);
    const legacy = artifactWithoutProvenance('run-pre-provenance');
    const strippedCurrent = withoutProvenance(current);

    expect(current.schemaVersion).toBe(2);
    expect(v1.schemaVersion).toBe(1);
    expect(legacy.schemaVersion).toBe(1);
    await expect(executionArtifactIntegrityIsValid(current)).resolves.toBe(true);
    await expect(executionArtifactIntegrityIsValid(preObservationBindingV2)).resolves.toBe(false);
    await expect(executionArtifactIntegrityIsValid(v1)).resolves.toBe(false);
    await expect(executionArtifactIntegrityIsValid(legacy)).resolves.toBe(false);
    await expect(executionArtifactIntegrityIsValid(strippedCurrent)).resolves.toBe(false);
  });

  it('accepts a high source-line recovery whose newly emitted program is short', async () => {
    const artifact = await artifactWithCurrentProvenance(
      'run-high-source-line',
      laserRecoveryExecutionEvidence({
        sourceRunId: 'run-long-source',
        sourceRevision: 8,
        sourceAckedLines: 499,
        requestedFromLine: 500,
        effectiveFromLine: 500,
        reviewedAtIso: NOW,
        warningsShown: [],
        laserModeStartEvidence: laserModeEvidence(),
      }),
      [{ fromLine: 500 }],
    );

    expect(artifact.sendableLines).toBeLessThan(500);
    await expect(executionArtifactIntegrityIsValid(artifact)).resolves.toBe(true);
  });

  it('rejects tampered hashes, byte counts, embedded profile identity, and lineage', async () => {
    const current = await artifactWithCurrentProvenance(
      'run-tamper',
      laserRecoveryExecutionEvidence({
        sourceRunId: 'run-source',
        sourceRevision: 3,
        sourceAckedLines: 20,
        requestedFromLine: 21,
        effectiveFromLine: 21,
        reviewedAtIso: NOW,
        warningsShown: [],
        laserModeStartEvidence: laserModeEvidence(),
      }),
      [{ fromLine: 21 }],
    );
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>, unknown]> = [
      ['G-code SHA-256', ['provenance', 'content', 'gcodeSha256'], zeroHash()],
      ['G-code UTF-8 count', ['provenance', 'content', 'gcodeUtf8Bytes'], 1],
      ['profile SHA-256', ['provenance', 'content', 'canonicalProfileSha256'], zeroHash()],
      ['profile UTF-8 count', ['provenance', 'content', 'canonicalProfileUtf8Bytes'], 1],
      ['profile identity', ['provenance', 'content', 'profileName'], 'Foreign profile'],
      ['controller identity', ['provenance', 'controller', 'activeKind'], 'fluidnc'],
      ['controller streaming mode', ['controller', 'streamingMode'], 'ping-pong'],
      ['controller RX buffer', ['controller', 'rxBufferBytes'], 121],
      ['recovery lineage', ['provenance', 'workflow', 'requestedFromLine'], 22],
      ['build evidence', ['provenance', 'build', 'gitSha'], 'forged-build'],
      ['review evidence', ['provenance', 'review', 'warningsShown'], ['forged warning']],
      [
        'controller settings evidence',
        ['provenance', 'controller', 'settingsRows'],
        [{ code: '$32', rawValue: '0' }],
      ],
      ['archived WCO evidence', ['archivedControllerObservation', 'wco'], { x: 99, y: 0, z: 0 }],
    ];

    for (const [label, path, value] of cases) {
      await expect(
        executionArtifactIntegrityIsValid(replaceAtPath(current, path, value)),
        label,
      ).resolves.toBe(false);
    }

    const replacedEmbeddedProfile = replaceAtPath(
      current,
      ['prepared', 'project', 'device', 'name'],
      'Tampered embedded profile',
    );
    await expect(executionArtifactIntegrityIsValid(replacedEmbeddedProfile)).resolves.toBe(false);
  });

  it('rejects tampered or removed provenance at stage, hydration, and archive boundaries', async () => {
    const exact = await artifactWithCurrentProvenance('run-boundary-tamper');
    const rejected = [
      replaceAtPath(exact, ['provenance', 'build', 'gitSha'], 'forged-build'),
      withoutProvenance(exact),
      downgradedWithoutProvenance(exact),
    ];

    for (const artifact of rejected) {
      const backend = new MemoryRecoveryStorageBackend();
      const repository = recoveryRepository(backend);
      await repository.initialize();

      await expect(repository.stageArtifact(artifact)).resolves.toEqual({
        ok: false,
        error: 'conflict',
      });

      await backend.putArtifact({
        runId: artifact.runId,
        generation: 0,
        origin: CURRENT_EXECUTION_ARTIFACT_ORIGIN,
        artifact,
      });
      const activeSlots = {
        ...emptyRecoverySlots(0),
        activeRun: {
          runId: artifact.runId,
          ackedLines: 0,
          sendableLines: artifact.sendableLines,
          startedAtIso: NOW,
          updatedAtIso: NOW,
          estimatedArtifactBytes: artifact.estimatedArtifactBytes ?? 0,
        },
      };
      expect((await hydrateRecoverySnapshot(backend, activeSlots)).activeRun).toBeNull();

      await backend.mutateSlots(() => ({
        slots: {
          ...emptyRecoverySlots(0),
          executionHistory: [
            {
              runId: artifact.runId,
              terminalKind: 'completed',
              startedAtIso: NOW,
              terminalAtIso: NOW,
              ackedLines: artifact.sendableLines,
              sendableLines: artifact.sendableLines,
              estimatedArtifactBytes: artifact.estimatedArtifactBytes ?? 0,
            },
          ],
        },
        value: undefined,
      }));
      await repository.refresh();
      await expect(repository.getArchivedExecution(artifact.runId)).resolves.toEqual({
        ok: false,
        error: 'not-found',
      });
    }
  });

  it('rejects a same-run collision with different valid V2 provenance', async () => {
    const runId = 'run-envelope-collision';
    const first = await artifactWithCurrentProvenance(runId);
    const second = await artifactWithCurrentProvenance(
      runId,
      ordinaryExecutionEvidence({
        reviewedAtIso: NOW,
        warningsShown: ['Different reviewed evidence.'],
        acknowledgement: { kind: 'laser-verified' },
        laserModeStartEvidence: laserModeEvidence(),
      }),
    );
    const repository = recoveryRepository(new MemoryRecoveryStorageBackend());
    await repository.initialize();

    await expect(repository.stageArtifact(first)).resolves.toMatchObject({ ok: true });
    await expect(repository.stageArtifact(second)).resolves.toEqual({
      ok: false,
      error: 'conflict',
    });
  });
});

async function artifactWithCurrentProvenance(
  runId: string,
  evidence: ExecutionProvenanceEvidenceV2 = ordinaryExecutionEvidence({
    reviewedAtIso: NOW,
    warningsShown: [],
    acknowledgement: { kind: 'laser-verified' },
    laserModeStartEvidence: laserModeEvidence(),
  }),
  laserResumeChain?: ReadonlyArray<{ readonly fromLine: number }>,
): Promise<ExecutionArtifactV1> {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  const laser = provenanceLaserState();
  const archivedControllerObservation = createArchivedControllerObservation({
    controllerSettings: null,
    observedAtIso: NOW,
    controllerObservation: {
      wco: { x: 1, y: 2, z: 3 },
      activeControllerKind: laser.activeControllerKind,
      detectedControllerKind: laser.detectedControllerKind,
      controllerSessionEpoch: laser.controllerSessionEpoch,
    },
  });
  const provenance = await createExecutionProvenance({
    gcode: GCODE,
    profile: project.device,
    laser,
    archivedControllerObservation,
    ...evidence,
  });
  return createExecutionArtifact({
    runId,
    gcode: GCODE,
    prepared: preparedOutput(project),
    ...(laserResumeChain === undefined ? {} : { laserResumeChain }),
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    archivedControllerObservation,
    createdAtIso: NOW,
    provenance,
  });
}

function artifactWithoutProvenance(runId: string): ExecutionArtifactV1 {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  return createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: GCODE,
    prepared: preparedOutput(project),
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
}

function withLegacyV1Provenance(artifact: ExecutionArtifactV1): ExecutionArtifactV1 {
  const provenance = artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion !== 2) {
    throw new Error('Expected current provenance.');
  }
  const {
    workflow: _workflow,
    envelopeSha256: _envelopeSha256,
    archivedControllerObservationSha256: _observationSha256,
    ...legacyProvenance
  } = provenance;
  return {
    ...artifact,
    schemaVersion: 1,
    provenance: { ...legacyProvenance, schemaVersion: 1 } as ExecutionProvenanceV1,
  };
}

function withoutProvenance(artifact: ExecutionArtifactV1): ExecutionArtifactV1 {
  const clone = structuredClone(artifact) as ExecutionArtifactV1 & {
    provenance?: ExecutionArtifactV1['provenance'];
  };
  delete clone.provenance;
  return clone;
}

function downgradedWithoutProvenance(artifact: ExecutionArtifactV1): ExecutionArtifactV1 {
  const clone = structuredClone(artifact) as ExecutionArtifactV1 & {
    provenance?: ExecutionArtifactV1['provenance'];
    estimatedArtifactBytes?: number;
  };
  Object.assign(clone, { schemaVersion: 1 });
  delete clone.provenance;
  delete clone.estimatedArtifactBytes;
  return clone;
}

async function withPreObservationBindingV2(
  artifact: ExecutionArtifactV1,
): Promise<ExecutionArtifactV1> {
  const provenance = artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion !== 2) {
    throw new Error('Expected current provenance.');
  }
  const {
    archivedControllerObservationSha256: _observationSha256,
    envelopeSha256: _envelopeSha256,
    ...unsigned
  } = provenance;
  return {
    ...artifact,
    schemaVersion: 1,
    provenance: {
      ...unsigned,
      envelopeSha256: await computeExecutionProvenanceEnvelopeSha256(unsigned),
    },
  };
}

function preparedOutput(project: ReturnType<typeof createProject>) {
  return {
    ok: true,
    project,
    job: { groups: [] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
}

function provenanceLaserState(): LaserState {
  return {
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerBuildInfo: null,
    controllerBuildInfoRawLines: [],
    controllerBuildInfoObservation: null,
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    grblSettingsRows: [{ code: '$32', rawValue: '1' }],
  } as unknown as LaserState;
}

function laserModeEvidence() {
  return {
    controllerSessionEpoch: 7,
    settingsCapability: 'grbl-dollar' as const,
    settingsObservation: { sessionEpoch: 7, observedAt: 1 },
    laserModeEnabled: true,
    maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
    controllerBuildInfo: null,
    buildInfoObservation: null,
    expectedMaxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
    m7Required: false,
    unverifiedAcknowledged: false,
  };
}

function recoveryRepository(backend: MemoryRecoveryStorageBackend): RecoveryRepository {
  return new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
}

function replaceAtPath(
  artifact: ExecutionArtifactV1,
  path: ReadonlyArray<string>,
  value: unknown,
): ExecutionArtifactV1 {
  const clone: unknown = structuredClone(artifact);
  let cursor = clone;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(cursor)) throw new Error(`Invalid test path at ${key}.`);
    cursor = cursor[key];
  }
  const finalKey = path.at(-1);
  if (!isRecord(cursor) || finalKey === undefined) throw new Error('Invalid test path.');
  cursor[finalKey] = value;
  return clone as ExecutionArtifactV1;
}

function zeroHash(): `sha256:${string}` {
  return `sha256:${'0'.repeat(64)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
