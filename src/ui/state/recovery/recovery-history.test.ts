import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, createProject, type Project } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import type { LaserState } from '../laser-store';
import {
  createArchivedControllerObservation,
  createExecutionArtifact,
  estimateExecutionArtifactBytes,
  type ExecutionArtifactV1,
  type RunId,
} from './execution-artifact';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { STAGED_ARTIFACT_LEASE_MS } from './recovery-artifact-staging';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { createExecutionProvenance } from './execution-provenance';
import { RecoveryRepository } from './recovery-repository';
import { ordinaryExecutionEvidence } from './execution-workflow-evidence';

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';

function harness(): {
  readonly repository: RecoveryRepository;
  readonly backend: MemoryRecoveryStorageBackend;
} {
  const backend = new MemoryRecoveryStorageBackend();
  return {
    backend,
    repository: new RecoveryRepository({
      backend,
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => LATER,
    }),
  };
}

function repositoryFor(
  backend: MemoryRecoveryStorageBackend,
  generationStore: MemoryRecoveryGenerationStore,
): RecoveryRepository {
  return new RecoveryRepository({
    backend,
    generationStore,
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

async function artifact(
  runId: RunId,
  gcode = 'G21\nG90\nG1 X1\nM5\n',
  auditRasterFixture?: string,
): Promise<ExecutionArtifactV1> {
  const baseProject = createProject(DEFAULT_DEVICE_PROFILE);
  const project =
    auditRasterFixture === undefined
      ? baseProject
      : ({ ...baseProject, auditRasterFixture } as Project);
  const prepared = {
    ok: true,
    project,
    job: { groups: [] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
  const laser = provenanceLaserState();
  const archivedControllerObservation = createArchivedControllerObservation({
    controllerSettings: null,
    observedAtIso: NOW,
    controllerObservation: {
      activeControllerKind: laser.activeControllerKind,
      detectedControllerKind: laser.detectedControllerKind,
      controllerSessionEpoch: laser.controllerSessionEpoch,
    },
  });
  const provenance = await createExecutionProvenance({
    gcode,
    profile: project.device,
    laser,
    archivedControllerObservation,
    ...ordinaryExecutionEvidence({
      reviewedAtIso: NOW,
      warningsShown: [],
      acknowledgement: { kind: 'laser-verified' },
      laserModeStartEvidence: laserModeEvidence(),
    }),
  });
  return createExecutionArtifact({
    runId,
    gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    archivedControllerObservation,
    createdAtIso: NOW,
    provenance,
  });
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

function resultValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown },
): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, received ${String(result.error)}.`);
  return result.value;
}

describe('RecoveryRepository execution history', () => {
  it('migrates repository schema v2 with an empty execution history', async () => {
    const { repository, backend } = harness();
    await backend.mutateSlots(() => ({
      slots: {
        schemaVersion: 2,
        generation: 0,
        revision: 0,
        activeRun: null,
        recoveryCapsule: null,
        lastCompletedReceipt: null,
        pendingStart: null,
      } as never,
      value: undefined,
    }));

    expect((await repository.refresh()).ok).toBe(true);
    expect(repository.getSnapshot().executionHistory).toEqual([]);
  });

  it('retains the newest twenty terminal executions and exposes exact artifacts', async () => {
    const { repository, backend } = harness();
    for (let index = 0; index < 21; index += 1) {
      const runId = `run-history-${index}`;
      await repository.stageArtifact(await artifact(runId, `G21\nG1 X${index}\nM5\n`));
      await repository.activateFreshRun(runId, NOW);
      await repository.completeRun(runId, LATER);
    }

    const history = repository.getSnapshot().executionHistory;
    expect(history).toHaveLength(20);
    expect(history[0]?.runId).toBe('run-history-1');
    expect(history.at(-1)).toMatchObject({
      runId: 'run-history-20',
      terminalKind: 'completed',
      ackedLines: 3,
      sendableLines: 3,
    });
    expect(await backend.getArtifact('run-history-0')).toBeNull();
    expect(await repository.getArchivedExecution('run-history-0')).toEqual({
      ok: false,
      error: 'not-found',
    });
    const retained = resultValue(await repository.getArchivedExecution('run-history-20'));
    expect(retained.gcode).toBe('G21\nG1 X20\nM5\n');
  });

  it('bounds and re-sizes persisted history during hydration instead of trusting stored estimates', async () => {
    const { repository, backend } = harness();
    const artifacts = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        artifact(`run-persisted-history-${index}`, `G21\nG1 X${index}\nM5\n`),
      ),
    );
    for (const exact of artifacts) {
      await repository.stageArtifact(exact);
    }
    await backend.mutateSlots(() => ({
      slots: {
        schemaVersion: 3,
        generation: 0,
        revision: 0,
        activeRun: null,
        recoveryCapsule: null,
        lastCompletedReceipt: null,
        pendingStart: null,
        executionHistory: artifacts.map((exact) => ({
          runId: exact.runId,
          terminalKind: 'completed' as const,
          startedAtIso: NOW,
          terminalAtIso: LATER,
          ackedLines: exact.sendableLines,
          sendableLines: exact.sendableLines,
          estimatedArtifactBytes: 0,
        })),
      },
      value: undefined,
    }));

    expect((await repository.refresh()).ok).toBe(true);
    const history = repository.getSnapshot().executionHistory;
    expect(history).toHaveLength(20);
    expect(history[0]?.runId).toBe('run-persisted-history-5');
    expect(history.at(-1)?.runId).toBe('run-persisted-history-24');
    for (const record of history) {
      const exact = artifacts.find((candidate) => candidate.runId === record.runId);
      expect(exact).toBeDefined();
      expect(record.estimatedArtifactBytes).toBe(
        estimateExecutionArtifactBytes(exact as ExecutionArtifactV1),
      );
      expect(record.estimatedArtifactBytes).toBeGreaterThan(0);
    }
  });

  it('records terminal acknowledgement counts and interruption outcome', async () => {
    const { repository } = harness();
    const exact = await artifact('run-terminal', 'G21\nG1 X1\nG1 X2\nM5\n');
    await repository.stageArtifact(exact);
    await repository.activateFreshRun(exact.runId, NOW);
    await repository.updateProgress(exact.runId, 2, LATER);
    await repository.interruptRun(
      exact.runId,
      3,
      { kind: 'disconnect', message: 'Cable removed.' },
      LATER,
    );

    expect(repository.getSnapshot().executionHistory.at(-1)).toMatchObject({
      runId: exact.runId,
      terminalKind: 'interrupted',
      ackedLines: 3,
      sendableLines: 4,
      interruption: { kind: 'disconnect', message: 'Cable removed.' },
    });
  });

  it('recomputes a missing artifact estimate from the full 2 MiB prepared project', async () => {
    const { repository } = harness();
    const current = await artifact(
      'run-large-missing-estimate',
      'G21\nG90\nG1 X1\nM5\n',
      'R'.repeat(2 * 1024 * 1024),
    );
    const { estimatedArtifactBytes: _oldEstimate, ...withoutEstimate } = current;

    expect((await repository.stageArtifact(withoutEstimate as ExecutionArtifactV1)).ok).toBe(true);
    expect((await repository.activateFreshRun(current.runId, NOW)).ok).toBe(true);
    expect((await repository.completeRun(current.runId, LATER)).ok).toBe(true);

    expect(
      repository.getSnapshot().executionHistory.at(-1)?.estimatedArtifactBytes,
    ).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('retries a transient displaced-artifact deletion on a later mutation', async () => {
    const { repository, backend } = harness();
    for (let index = 0; index < 21; index += 1) {
      const runId = `run-cleanup-mutation-${index}`;
      await repository.stageArtifact(await artifact(runId));
      await repository.activateFreshRun(runId, NOW);
      if (index === 20) backend.failNext('delete-artifact');
      await repository.completeRun(runId, LATER);
    }

    expect(await backend.getArtifact('run-cleanup-mutation-0')).not.toBeNull();
    expect((await repository.discardCompletedReceipt('run-cleanup-mutation-20')).ok).toBe(true);
    expect(await backend.getArtifact('run-cleanup-mutation-0')).toBeNull();
    expect(await repository.getArchivedExecution('run-cleanup-mutation-1')).toMatchObject({
      ok: true,
    });
  });

  it('reconciles an orphan left by a transient deletion failure after reload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    try {
      const backend = new MemoryRecoveryStorageBackend();
      const generationStore = new MemoryRecoveryGenerationStore();
      const firstRepository = repositoryFor(backend, generationStore);
      for (let index = 0; index < 21; index += 1) {
        const runId = `run-cleanup-reload-${index}`;
        await firstRepository.stageArtifact(await artifact(runId));
        await firstRepository.activateFreshRun(runId, NOW);
        if (index === 20) backend.failNext('delete-artifact');
        await firstRepository.completeRun(runId, LATER);
      }
      expect(await backend.getArtifact('run-cleanup-reload-0')).not.toBeNull();

      const reloadedRepository = repositoryFor(backend, generationStore);
      expect((await reloadedRepository.initialize()).ok).toBe(true);
      expect(await backend.getArtifact('run-cleanup-reload-0')).not.toBeNull();

      await vi.advanceTimersByTimeAsync(STAGED_ARTIFACT_LEASE_MS);
      expect(await backend.getArtifact('run-cleanup-reload-0')).toBeNull();
      expect(await reloadedRepository.getArchivedExecution('run-cleanup-reload-1')).toMatchObject({
        ok: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
