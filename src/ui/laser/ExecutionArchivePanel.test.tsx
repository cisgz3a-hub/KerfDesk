import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { LaserState } from '../state/laser-store';
import {
  createExecutionArtifact,
  RecoveryRepository,
  type ExecutionArtifactV1,
} from '../state/recovery';
import { createExecutionProvenance } from '../state/recovery/execution-provenance';
import { ordinaryExecutionEvidence } from '../state/recovery/execution-workflow-evidence';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { decodeExecutionArtifactExport } from './execution-artifact-export-codec';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = '2026-07-19T03:00:00.000Z';
const LATER = '2026-07-19T03:01:00.000Z';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

describe('ExecutionArchivePanel', () => {
  it('shows the operator-facing empty state', async () => {
    const { repository } = createHarness();
    await repository.initialize();
    await render(
      repository,
      platformAdapter(async () => null),
    );

    expect(host?.textContent).toContain('Execution archive (0)');
    expect(host?.textContent).toContain('Export retrieves the exact stored artifact');
    expect(host?.textContent).toContain(
      'No archived executions yet. Completed or interrupted jobs will appear here.',
    );
  });

  it('exports the exact stored artifact in a versioned typed-array-safe envelope', async () => {
    const { repository } = createHarness();
    const stored = await completeArchivedRun(repository, 'run-export-proof');
    let written = '';
    const target: SaveTarget = {
      displayName: 'saved-execution.lfexecution.json',
      write: vi.fn(async (data) => {
        if (typeof data !== 'string') throw new Error('expected JSON text');
        written = data;
      }),
    };
    const save = vi.fn(async () => target);
    const snapshotBefore = structuredClone(repository.getSnapshot());
    await render(repository, platformAdapter(save));

    await act(async () => {
      exportButton(stored.runId).click();
      await vi.waitFor(() => expect(written).not.toBe(''));
    });

    expect(save).toHaveBeenCalledWith({
      suggestedName: 'kerfdesk-execution-2026-07-19-run-export-proof.lfexecution.json',
      extensions: ['.lfexecution.json'],
    });
    expect(JSON.parse(written)).toMatchObject({
      format: 'kerfdesk-execution-artifact',
      schemaVersion: 1,
      encoding: 'tagged-binary-json-v1',
      envelopeSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    await expect(decodeExecutionArtifactExport(written)).resolves.toEqual(stored);
    expect(repository.getSnapshot()).toEqual(snapshotBefore);
    expect(host?.textContent).toContain('Execution exported to saved-execution.lfexecution.json.');
  });

  it('shows an in-panel error when a retained history row has no readable artifact', async () => {
    const { repository, backend } = createHarness();
    const stored = await completeArchivedRun(repository, 'run-missing-artifact');
    await backend.deleteArtifact(stored.runId);
    const save = vi.fn(async () => null);
    await render(repository, platformAdapter(save));

    await act(async () => exportButton(stored.runId).click());

    expect(save).not.toHaveBeenCalled();
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'stored execution artifact is no longer available',
    );
  });

  it('shows an in-panel error when the selected save target cannot be written', async () => {
    const { repository } = createHarness();
    const stored = await completeArchivedRun(repository, 'run-write-failure');
    let writeAttempted = false;
    await render(
      repository,
      platformAdapter(async () => ({
        displayName: 'unwritable.lfexecution.json',
        write: async () => {
          writeAttempted = true;
          throw new Error('disk is read-only');
        },
      })),
    );

    await act(async () => {
      exportButton(stored.runId).click();
      await vi.waitFor(() => expect(writeAttempted).toBe(true));
    });

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not export the stored execution artifact: disk is read-only',
    );
  });
});

function createHarness(): {
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

async function completeArchivedRun(
  repository: RecoveryRepository,
  runId: string,
): Promise<ExecutionArtifactV1> {
  await repository.initialize();
  const gcode = 'G21\nG90\nG1 X1 S100\nM5\n';
  const project = {
    device: DEFAULT_DEVICE_PROFILE,
  } as unknown as Project;
  const archivedControllerObservation = {
    settings: null,
    observedAtIso: NOW,
    activeControllerKind: 'grbl-v1.1' as const,
    detectedControllerKind: 'grbl-v1.1' as const,
    controllerSessionEpoch: 7,
  };
  const provenance = await createExecutionProvenance({
    gcode,
    profile: DEFAULT_DEVICE_PROFILE,
    laser: provenanceLaserState(),
    archivedControllerObservation,
    ...ordinaryExecutionEvidence({
      reviewedAtIso: NOW,
      warningsShown: ['Verify the material test before production.'],
      acknowledgement: { kind: 'laser-verified' },
      laserModeStartEvidence: {
        controllerSessionEpoch: 7,
        settingsCapability: 'grbl-dollar',
        settingsObservation: { sessionEpoch: 7, observedAt: 1 },
        laserModeEnabled: true,
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        controllerBuildInfo: null,
        buildInfoObservation: null,
        expectedMaxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        m7Required: false,
        unverifiedAcknowledged: false,
      },
    }),
  });
  const stored = createExecutionArtifact({
    runId,
    gcode,
    prepared: {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    archivedControllerObservation,
    createdAtIso: NOW,
    provenance,
  });
  expect((await repository.stageArtifact(stored)).ok).toBe(true);
  expect((await repository.activateFreshRun(stored.runId, NOW)).ok).toBe(true);
  expect((await repository.completeRun(stored.runId, LATER)).ok).toBe(true);
  return stored;
}

function provenanceLaserState(): LaserState {
  return {
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0x1a86 },
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

function platformAdapter(save: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

async function render(repository: RecoveryRepository, platform: PlatformAdapter): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={platform}>
        <ExecutionArchivePanel repository={repository} />
      </PlatformProvider>,
    );
  });
}

function exportButton(runId: string): HTMLButtonElement {
  const candidate = host?.querySelector(`[aria-label="Export stored execution ${runId}"]`);
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Expected export button for ${runId}.`);
  }
  return candidate;
}
