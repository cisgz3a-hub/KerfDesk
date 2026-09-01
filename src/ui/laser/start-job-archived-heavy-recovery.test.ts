import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CncModule from '../../core/cnc';
import type * as CncOffsetDiagnosticsModule from '../../core/cnc/cnc-offset-ladder-diagnostics';
import type * as VCarveClearanceModule from '../../core/cnc/vcarve-clearance';
import type { StatusReport } from '../../core/controllers/grbl';
import type * as VCarveMedialModule from '../../core/cnc/vcarve-medial';
import type * as CncToolGeometryModule from '../../core/preflight/cnc-tool-geometry';
import type * as GcodeModule from '../../io/gcode';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { createExecutionArtifact, type ExecutionArtifactV1 } from '../state/recovery';
import { resetStore } from '../state/test-helpers';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob } from './start-job-readiness';
import { prepareArchivedRecoverySource } from './start-job-source';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';

const gcodeMocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(),
}));
const vcarveMocks = vi.hoisted(() => ({
  vcarveMedialPasses: vi.fn(),
  vcarveClearanceToolpaths: vi.fn(),
  vcarveClearancePocket: vi.fn(),
}));
const sourceGeometryMocks = vi.hoisted(() => ({
  findCncAdaptivePocketIssues: vi.fn(),
  findCncHelicalEntryIssues: vi.fn(),
  findCncInlayIssues: vi.fn(),
  findCncRestPocketIssues: vi.fn(),
  findDroppedCncLayers: vi.fn(),
  findInvalidCncToolGeometry: vi.fn(),
  findCncOffsetLadderDiagnostics: vi.fn(),
}));

vi.mock('../../io/gcode', async (importOriginal) => {
  const original = await importOriginal<typeof GcodeModule>();
  gcodeMocks.prepareOutput.mockImplementation(original.prepareOutput);
  return { ...original, prepareOutput: gcodeMocks.prepareOutput };
});

vi.mock('../../core/cnc/vcarve-medial', async (importOriginal) => {
  const original = await importOriginal<typeof VCarveMedialModule>();
  vcarveMocks.vcarveMedialPasses.mockImplementation(original.vcarveMedialPasses);
  return { ...original, vcarveMedialPasses: vcarveMocks.vcarveMedialPasses };
});

vi.mock('../../core/cnc/vcarve-clearance', async (importOriginal) => {
  const original = await importOriginal<typeof VCarveClearanceModule>();
  vcarveMocks.vcarveClearanceToolpaths.mockImplementation(original.vcarveClearanceToolpaths);
  vcarveMocks.vcarveClearancePocket.mockImplementation(original.vcarveClearancePocket);
  return {
    ...original,
    vcarveClearanceToolpaths: vcarveMocks.vcarveClearanceToolpaths,
    vcarveClearancePocket: vcarveMocks.vcarveClearancePocket,
  };
});

vi.mock('../../core/cnc', async (importOriginal) => {
  const original = await importOriginal<typeof CncModule>();
  sourceGeometryMocks.findCncAdaptivePocketIssues.mockImplementation(
    original.findCncAdaptivePocketIssues,
  );
  sourceGeometryMocks.findCncHelicalEntryIssues.mockImplementation(
    original.findCncHelicalEntryIssues,
  );
  sourceGeometryMocks.findCncInlayIssues.mockImplementation(original.findCncInlayIssues);
  sourceGeometryMocks.findCncRestPocketIssues.mockImplementation(original.findCncRestPocketIssues);
  sourceGeometryMocks.findDroppedCncLayers.mockImplementation(original.findDroppedCncLayers);
  return {
    ...original,
    findCncAdaptivePocketIssues: sourceGeometryMocks.findCncAdaptivePocketIssues,
    findCncHelicalEntryIssues: sourceGeometryMocks.findCncHelicalEntryIssues,
    findCncInlayIssues: sourceGeometryMocks.findCncInlayIssues,
    findCncRestPocketIssues: sourceGeometryMocks.findCncRestPocketIssues,
    findDroppedCncLayers: sourceGeometryMocks.findDroppedCncLayers,
  };
});

vi.mock('../../core/preflight/cnc-tool-geometry', async (importOriginal) => {
  const original = await importOriginal<typeof CncToolGeometryModule>();
  sourceGeometryMocks.findInvalidCncToolGeometry.mockImplementation(
    original.findInvalidCncToolGeometry,
  );
  return {
    ...original,
    findInvalidCncToolGeometry: sourceGeometryMocks.findInvalidCncToolGeometry,
  };
});

vi.mock('../../core/cnc/cnc-offset-ladder-diagnostics', async (importOriginal) => {
  const original = await importOriginal<typeof CncOffsetDiagnosticsModule>();
  sourceGeometryMocks.findCncOffsetLadderDiagnostics.mockImplementation(
    original.findCncOffsetLadderDiagnostics,
  );
  return {
    ...original,
    findCncOffsetLadderDiagnostics: sourceGeometryMocks.findCncOffsetLadderDiagnostics,
  };
});

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const CONTROLLER_SETTINGS = {
  maxPowerS: 12_000,
  minPowerS: 0,
  laserModeEnabled: false,
};

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  gcodeMocks.prepareOutput.mockClear();
  clearSourceGeometryMocks();
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('archived exact costly recovery', () => {
  it('qualifies the bound artifact without synchronously recompiling its project', () => {
    const fixture = exactVCarveArtifact();
    expect(costlyCanvasPreparation(fixture.project)).toBe(true);
    installHealthyLiveQualification(fixture);
    gcodeMocks.prepareOutput.mockClear();
    clearSourceGeometryMocks();

    const recovered = prepareArchivedRecoverySource(fixture.artifact);

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    expect(recovered).not.toBeNull();
    expect(recovered?.gcode).toBe(fixture.artifact.gcode);
    expect(recovered?.canvasPlan).toEqual(fixture.artifact.canvasPlan);
    expect(recovered?.prepared.job).toEqual(fixture.artifact.prepared.job);
    expectNoSourceGeometryPlanning();
  });

  it('does not synchronously rebuild V-carve advisories for a legacy artifact without evidence', () => {
    const fixture = exactVCarveArtifact();
    const { cncCompilation, ...legacyJob } = fixture.artifact.prepared.job;
    void cncCompilation;
    const legacyArtifact: ExecutionArtifactV1 = {
      ...fixture.artifact,
      prepared: { ...fixture.artifact.prepared, job: legacyJob },
    };
    installHealthyLiveQualification(fixture);
    gcodeMocks.prepareOutput.mockClear();
    clearSourceGeometryMocks();

    const recovered = prepareArchivedRecoverySource(legacyArtifact);

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    expectNoSourceGeometryPlanning();
    expect(recovered).not.toBeNull();
    expect(recovered?.gcode).toBe(legacyArtifact.gcode);
    expect(recovered?.prepared.job.cncCompilation).toBeUndefined();
  });

  it('does not rebuild V-carve clearance geometry from a current exact artifact', () => {
    const fixture = exactVCarveArtifact('vcarve-clearance');
    installHealthyLiveQualification(fixture);
    clearSourceGeometryMocks();

    const recovered = prepareArchivedRecoverySource(fixture.artifact);

    expect(recovered).not.toBeNull();
    expect(recovered?.gcode).toBe(fixture.artifact.gcode);
    expectNoSourceGeometryPlanning();
  });

  it('does not rebuild pocket or helical-entry geometry from an exact artifact', () => {
    const fixture = exactVCarveArtifact('pocket-helix');
    expect(costlyCanvasPreparation(fixture.project)).toBe(true);
    installHealthyLiveQualification(fixture);
    clearSourceGeometryMocks();

    const recovered = prepareArchivedRecoverySource(fixture.artifact);

    expect(recovered).not.toBeNull();
    expect(recovered?.gcode).toBe(fixture.artifact.gcode);
    expectNoSourceGeometryPlanning();
  });
});

function exactVCarveArtifact(variant: 'vcarve' | 'vcarve-clearance' | 'pocket-helix' = 'vcarve'): {
  readonly artifact: ExecutionArtifactV1;
  readonly project: Project;
  readonly frameVerification: ReturnType<typeof frameVerificationForProject>;
  readonly toolId: string;
} {
  const vBit = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.kind === 'v-bit');
  if (vBit === undefined) throw new Error('V-bit fixture tool missing');
  const endMill = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.kind === 'end-mill');
  if (endMill === undefined) throw new Error('End-mill fixture tool missing');
  const primaryTool = variant === 'pocket-helix' ? endMill : vBit;
  const color = '#7c3aed';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'archived-vcarve-box',
    source: 'archived-vcarve-box.svg',
    bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 30, y: 10 },
              { x: 30, y: 30 },
              { x: 10, y: 30 },
            ],
          },
        ],
      },
    ],
  };
  const project: Project = {
    ...createProject(),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: primaryTool.id },
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'archived-vcarve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: variant === 'pocket-helix' ? 'pocket' : 'v-carve',
            toolId: primaryTool.id,
            depthMm: 1,
            depthPerPassMm: 1,
            vResolutionMm: 1,
            ...(variant === 'vcarve-clearance'
              ? { vCarveFlatDepthEnabled: true, vClearToolId: endMill.id }
              : {}),
            ...(variant === 'pocket-helix'
              ? { helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 } }
              : {}),
          },
        },
      ],
    },
  };
  const workZZeroEvidence = {
    source: 'manual-zero' as const,
    referenceEpoch: 1,
    toolId: primaryTool.id,
  };
  const prepared = prepareStartJob(
    project,
    CONTROLLER_SETTINGS,
    {
      statusReport: IDLE_STATUS,
      alarmCode: null,
      hasActiveStreamer: false,
      settingsCapability: 'grbl-dollar',
      cncJobsSupported: true,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
      workZReferenceEpoch: 1,
      controllerSessionEpoch: 0,
      workZZeroEvidence,
    },
    DEFAULT_JOB_PLACEMENT,
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!prepared.ok)
    throw new Error(`V-carve fixture did not prepare: ${prepared.messages.join('; ')}`);
  const frameVerification = frameVerificationForProject(project);
  return {
    project,
    frameVerification,
    toolId: primaryTool.id,
    artifact: createExecutionArtifact({
      artifactSchemaVersion: 1,
      runId: `archived-heavy-${variant}`,
      gcode: prepared.gcode,
      prepared: prepared.prepared,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      canvasPlan: prepared.canvasPlan,
      controllerSettings: CONTROLLER_SETTINGS,
      createdAtIso: '2026-08-04T00:00:00.000Z',
    }),
  };
}

function clearSourceGeometryMocks(): void {
  for (const mock of [...Object.values(vcarveMocks), ...Object.values(sourceGeometryMocks)]) {
    mock.mockClear();
  }
}

function expectNoSourceGeometryPlanning(): void {
  for (const mock of [...Object.values(vcarveMocks), ...Object.values(sourceGeometryMocks)]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

function installHealthyLiveQualification(fixture: {
  readonly frameVerification: ReturnType<typeof frameVerificationForProject>;
  readonly toolId: string;
}): void {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
    controllerSettings: CONTROLLER_SETTINGS,
    controllerQualification: { kind: 'qualified', epoch: 0, settings: 'verified' },
    detectedControllerKind: 'grbl-v1.1',
    frameVerification: fixture.frameVerification,
    workZReferenceEpoch: 1,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 1,
      toolId: fixture.toolId,
    },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
  });
  useCameraStore.setState({ placementActive: false });
}
