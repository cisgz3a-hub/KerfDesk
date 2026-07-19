import { DEFAULT_DEVICE_PROFILE } from '../../../../core/devices';
import type { JobOriginPlacement } from '../../../../core/job';
import {
  DEFAULT_OUTPUT_SCOPE,
  createProject,
  machineKindOf,
  type OutputScope,
  type Project,
} from '../../../../core/scene';
import type { ControllerSettingsSnapshot } from '../../../../core/preflight';
import type { PreparedOutput } from '../../../../io/gcode';
import type { CanvasMotionPlan } from '../../canvas-motion-plan';
import type { CncToolPlanEntry } from '../../cnc-tool-plan';
import { createCncSetupAttestation, type CncSetupAttestation } from '../../cnc-setup-attestation';
import type { LaserState } from '../../laser-store';
import {
  createArchivedControllerObservation,
  createExecutionArtifact,
  type ArchivedControllerObservationInput,
  type ExecutionArtifactV1,
  type RunId,
} from '../execution-artifact';
import { createExecutionProvenance } from '../execution-provenance';
import { ordinaryExecutionEvidence } from '../execution-workflow-evidence';

const DEFAULT_CREATED_AT_ISO = '2026-07-15T10:00:00.000Z';
const DEFAULT_GCODE = 'G21\nG90\nG1 X1\nM5\n';

type CurrentTestArtifactArgs = {
  readonly runId: RunId;
  readonly gcode?: string;
  readonly createdAtIso?: string;
  readonly project?: Project;
  readonly prepared?: Extract<PreparedOutput, { readonly ok: true }>;
  readonly outputScope?: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly canvasPlan?: CanvasMotionPlan;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly recoveryQualification?: string;
  readonly cncSetupAttestation?: CncSetupAttestation;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly controllerObservation?: ArchivedControllerObservationInput;
};

export async function createCurrentTestExecutionArtifact(
  args: CurrentTestArtifactArgs,
): Promise<ExecutionArtifactV1> {
  const context = testArtifactContext(args);
  const archivedControllerObservation = createArchivedControllerObservation({
    controllerSettings: context.controllerSettings,
    observedAtIso: context.createdAtIso,
    controllerObservation: {
      activeControllerKind: context.laser.activeControllerKind,
      detectedControllerKind: context.laser.detectedControllerKind,
      controllerSessionEpoch: context.laser.controllerSessionEpoch,
      ...args.controllerObservation,
    },
  });
  const provenance = await testArtifactProvenance(context, archivedControllerObservation);
  return createExecutionArtifact(
    currentArtifactInput(args, context, archivedControllerObservation, provenance),
  );
}

function testArtifactContext(args: CurrentTestArtifactArgs) {
  const gcode = args.gcode ?? DEFAULT_GCODE;
  const createdAtIso = args.createdAtIso ?? DEFAULT_CREATED_AT_ISO;
  const project = args.prepared?.project ?? args.project ?? createProject(DEFAULT_DEVICE_PROFILE);
  const prepared = args.prepared ?? preparedOutput(project);
  const machineKind = machineKindOf(project.machine);
  const cncSetupAttestation =
    machineKind === 'cnc'
      ? (args.cncSetupAttestation ??
        createCncSetupAttestation(gcode, { trustedPosition: 0, workZReference: 0 }))
      : undefined;
  const laser = provenanceLaserState(project, args.controllerObservation);
  const controllerSettings = args.controllerSettings ?? null;
  return {
    gcode,
    createdAtIso,
    project,
    prepared,
    machineKind,
    cncSetupAttestation,
    laser,
    controllerSettings,
  };
}

async function testArtifactProvenance(
  context: ReturnType<typeof testArtifactContext>,
  archivedControllerObservation: ReturnType<typeof createArchivedControllerObservation>,
) {
  return createExecutionProvenance({
    gcode: context.gcode,
    profile: context.project.device,
    laser: context.laser,
    archivedControllerObservation,
    ...ordinaryExecutionEvidence({
      reviewedAtIso: context.createdAtIso,
      warningsShown: [],
      acknowledgement:
        context.machineKind === 'cnc'
          ? { kind: 'cnc', prompt: 'Test CNC setup confirmation.' }
          : { kind: 'laser-verified' },
      ...(context.machineKind === 'cnc'
        ? {}
        : { laserModeStartEvidence: laserModeEvidence(context.project, context.laser) }),
      ...(context.cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation: context.cncSetupAttestation }),
    }),
  });
}

function currentArtifactInput(
  args: CurrentTestArtifactArgs,
  context: ReturnType<typeof testArtifactContext>,
  archivedControllerObservation: ReturnType<typeof createArchivedControllerObservation>,
  provenance: Awaited<ReturnType<typeof testArtifactProvenance>>,
) {
  return {
    runId: args.runId,
    gcode: context.gcode,
    prepared: context.prepared,
    outputScope: args.outputScope ?? DEFAULT_OUTPUT_SCOPE,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    canvasPlan:
      args.canvasPlan ?? ({ retentionKey: `signature-${args.runId}` } as CanvasMotionPlan),
    ...(args.cncToolPlan === undefined ? {} : { cncToolPlan: args.cncToolPlan }),
    ...(args.recoveryQualification === undefined
      ? {}
      : { recoveryQualification: args.recoveryQualification }),
    controllerSettings: context.controllerSettings,
    archivedControllerObservation,
    createdAtIso: context.createdAtIso,
    provenance,
  };
}

function preparedOutput(project: Project): Extract<PreparedOutput, { readonly ok: true }> {
  return {
    ok: true,
    project,
    job: { groups: [] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
}

function provenanceLaserState(
  project: Project,
  observation: ArchivedControllerObservationInput | undefined,
): LaserState {
  const activeControllerKind =
    observation?.activeControllerKind ?? project.device.controllerKind ?? 'grbl-v1.1';
  const detectedControllerKind = observation?.detectedControllerKind ?? activeControllerKind;
  const controllerSessionEpoch = observation?.controllerSessionEpoch ?? 7;
  return {
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
    controllerSessionEpoch,
    activeControllerKind,
    detectedControllerKind,
    controllerQualification: {
      kind: 'qualified',
      epoch: controllerSessionEpoch,
      settings: 'verified',
    },
    controllerBuildInfo: null,
    controllerBuildInfoRawLines: [],
    controllerBuildInfoObservation: null,
    controllerSettingsObservation: { sessionEpoch: controllerSessionEpoch, observedAt: 1 },
    grblSettingsRows: [{ code: '$32', rawValue: '1' }],
  } as unknown as LaserState;
}

function laserModeEvidence(project: Project, laser: LaserState) {
  return {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    settingsCapability: 'grbl-dollar' as const,
    settingsObservation: { sessionEpoch: laser.controllerSessionEpoch, observedAt: 1 },
    laserModeEnabled: true,
    maxPowerS: project.device.maxPowerS,
    controllerBuildInfo: null,
    buildInfoObservation: null,
    expectedMaxPowerS: project.device.maxPowerS,
    m7Required: false,
    unverifiedAcknowledged: false,
  };
}
