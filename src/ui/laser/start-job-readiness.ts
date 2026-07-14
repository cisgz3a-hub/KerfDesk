import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import type { StatusQueryCapability } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { SimilarityTransform } from '../../core/registration';
import {
  computeJobBounds,
  describeFramePreflightFailure,
  framePreflight,
  type JobOriginPlacement,
} from '../../core/job';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import { runControllerReadiness } from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  type OutputScope,
  type Project,
} from '../../core/scene';
import {
  emitPreparedGcode,
  prepareOutput,
  prepareOutputSnapshot,
  type PreparedOutput,
  type VariableTextRenderer,
} from '../../io/gcode';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import type { FrameVerification } from '../state/frame-verification';
import { cncToolPlan, type CncToolPlanEntry } from '../state/cnc-tool-plan';
import type { WorkZZeroEvidence } from '../state/work-z-zero-evidence';
import { cncAccessoryStartIssue, cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import {
  DEFAULT_JOB_PLACEMENT,
  trustedMotionOffsetForPreflight,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { cameraPlacementSafetyIssue } from '../camera/camera-placement-safety';
import type { HomingState } from '../state/laser-store';
import { cncWorkZeroStartIssue, cncWorkZeroToolStartIssue } from './cnc-start-advisories';
import { requiredFrameIssueFromPrepared } from './required-frame-readiness';
import { canvasPlanRetentionKey, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  controllerReportsInches,
  initialMachinePositionOption,
  okPreparation,
  resolveStartPlacement,
  withControllerReportUnits,
} from './start-job-preparation';
import { collectStartWarnings } from './start-job-warnings';

export const CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE =
  'Custom origin is active, but its physical machine location is not known yet. Wait for an Idle/WCO status report or reset origin before continuing.';
export const STATUS_ALARM_START_MESSAGE =
  'Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe.';
export const CNC_REQUIRES_GRBL_MESSAGE =
  'CNC jobs require a GRBL-family controller (GRBL, grblHAL, FluidNC). The connected firmware does not accept the GRBL CNC dialect — e.g. it reads the G4 spin-up dwell in milliseconds instead of seconds, so the bit would plunge before the spindle is at speed.';

export type StartJobPreparation =
  | {
      readonly ok: true;
      readonly gcode: string;
      readonly warnings: ReadonlyArray<string>;
      readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
      readonly canvasPlan: CanvasMotionPlan;
      // The RESOLVED origin this compile used (undefined = Absolute). The
      // checkpoint stores it so resume reproduces identical bytes (R1).
      readonly jobOrigin?: JobOriginPlacement;
    }
  | {
      readonly ok: false;
      readonly messages: ReadonlyArray<string>;
    };

export type MachineStartSnapshot = {
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly hasActiveStreamer: boolean;
  readonly motionOperationActive?: boolean;
  readonly controllerOperationActive?: boolean;
  readonly autofocusBusy?: boolean;
  readonly workOriginActive?: boolean;
  readonly workZZeroEvidence?: WorkZZeroEvidence | null;
  readonly workZReferenceEpoch?: number;
  readonly controllerSessionEpoch?: number;
  readonly nowMs?: number;
  readonly wcoCache?: WorkCoordinateOffset | null;
  // Last live GRBL Ov: field, cached across intermittent status frames.
  // A known non-default value changes physical feed/RPM independently of the
  // prepared G-code, so CNC Start requires the compiled 100/100/100 baseline.
  readonly ovCache?: OverrideValues | null;
  // Last live GRBL A: observation. This is controller-commanded state, not
  // physical spindle/coolant sensor proof. Known active accessories block CNC
  // Start; null/undefined remains unknown rather than being invented as off.
  readonly accessoryCache?: NonNullable<StatusReport['accessories']> | null;
  // ADR-053 P2 — the last clean Verified Frame, gating verified-origin starts.
  readonly frameVerification?: FrameVerification | null;
  // ADR-094 — how the connected firmware exposes settings. Non-GRBL values
  // relax the $30/$32 readiness proof into an explicit unverified warning.
  readonly settingsCapability?: ReadinessSettingsCapability;
  // ADR-098 — CNC is GRBL-only. False blocks CNC Start outright (the CNC
  // emitter's dialect is unsafe on other firmwares); absent = allowed.
  readonly cncJobsSupported?: boolean;
  readonly activeControllerKind?: ControllerKind;
  readonly detectedControllerKind?: ControllerKind | null;
  // Camera placement is a physical bed-coordinate contract. These optional
  // fields keep non-camera callers backward-compatible while Start and Resume
  // can enforce the same position proof as Frame.
  readonly cameraPlacementActive?: boolean;
  readonly cameraConfirmedPositionEpoch?: number | null;
  readonly cameraPlacementGeometryIssue?: string | null;
  readonly homingState?: HomingState;
  readonly trustedPositionEpoch?: number;
  readonly statusQuery?: StatusQueryCapability;
  readonly reportInches?: boolean;
};

// Machine-state blockers plus the ADR-098 dialect gate: CNC is GRBL-only —
// the emitter's dialect (G4 dwell in seconds) is unsafe on firmwares that
// parse it differently.
function findEarlyStartIssues(project: Project, machine: MachineStartSnapshot): string[] {
  const issues = [...findMachineStartIssues(machine)];
  if (machineKindOf(project.machine) === 'cnc' && machine.cncJobsSupported === false) {
    issues.push(CNC_REQUIRES_GRBL_MESSAGE);
  }
  issues.push(...cncOverrideStartIssues(project, machine.ovCache));
  issues.push(...cncAccessoryStartIssues(project, machine.accessoryCache));
  const workZeroIssue = cncWorkZeroStartIssue(
    project,
    machine.workZZeroEvidence,
    machine.workZReferenceEpoch,
    machine.controllerSessionEpoch,
    machine.nowMs,
  );
  if (workZeroIssue !== null) issues.push(workZeroIssue);
  return issues;
}

function cncAccessoryStartIssues(
  project: Project,
  accessories: NonNullable<StatusReport['accessories']> | null | undefined,
): ReadonlyArray<string> {
  const issue = cncAccessoryStartIssue(machineKindOf(project.machine), accessories);
  return issue === null ? [] : [issue];
}

function cncOverrideStartIssues(
  project: Project,
  overrides: OverrideValues | null | undefined,
): ReadonlyArray<string> {
  const issue = cncOverrideStartIssue(machineKindOf(project.machine), overrides);
  return issue === null ? [] : [issue];
}

export function prepareStartJob(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  // Resume only: the RESOLVED origin the original run compiled with. When set,
  // the compile reuses it (so a 'current-position' job reproduces the frozen
  // head XY and its checkpoint fingerprint) while the live machine is still
  // re-validated through the origin's mode (R1).
  resolvedJobOrigin?: JobOriginPlacement,
  allowRotaryRaster?: boolean,
): StartJobPreparation {
  const gateIssues = findStartGateIssues(project, machine, jobPlacement);
  if (gateIssues.length > 0) return { ok: false, messages: gateIssues };

  const machineWithReportUnits = withControllerReportUnits(machine, controllerSettings);
  const placement = resolveStartPlacement(jobPlacement, machineWithReportUnits, resolvedJobOrigin);
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
  const inspected = inspectPreparedStart(
    prepareOutput(project, {
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    }),
    placement,
    motionOffset,
    machine,
  );
  if (!inspected.ok) return inspected;
  const { prepared, toolPlan } = inspected;

  const { gcode, preflight } = emitPreparedGcode(prepared, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    outputScope,
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...initialMachinePositionOption(machineWithReportUnits),
    allowRotaryRaster: allowRotaryRaster === true,
  });
  if (!preflight.ok) {
    return { ok: false, messages: preflight.issues.map((i) => i.message) };
  }

  const verifiedFrameIssue = requiredFrameIssueFromPrepared({
    device: project.device,
    prepared,
    placement,
    machine,
  });
  if (verifiedFrameIssue !== null) return { ok: false, messages: [verifiedFrameIssue] };

  const controller = runControllerReadiness(project, controllerSettings, readinessMode(machine));
  if (!controller.ok) {
    return { ok: false, messages: controller.errors.map((i) => i.message) };
  }

  const warnings = collectStartWarnings(
    project,
    controllerSettings,
    controller.warnings.map((i) => i.message),
    machine.ovCache,
  );
  return okPreparation(
    gcode,
    warnings,
    placement.jobOrigin,
    toolPlan,
    prepared,
    machine,
    controllerReportsInches(controllerSettings),
    canvasPlanRetentionKey(project, outputScope, jobPlacement),
  );
}

export async function prepareStartJobSnapshot(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
  outputScope: OutputScope,
  allowRotaryRaster: boolean,
  options: {
    readonly clock: () => Date;
    readonly renderVariableText: VariableTextRenderer;
    readonly registration?: SimilarityTransform | null;
  },
): Promise<StartJobPreparation> {
  const gateIssues = findStartGateIssues(project, machine, jobPlacement);
  if (gateIssues.length > 0) return { ok: false, messages: gateIssues };

  const machineWithReportUnits = withControllerReportUnits(machine, controllerSettings);
  const placement = resolveStartPlacement(jobPlacement, machineWithReportUnits, undefined);
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);

  const inspected = inspectPreparedStart(
    await prepareOutputSnapshot(project, {
      clock: options.clock,
      renderVariableText: options.renderVariableText,
      ...registrationOption(options.registration),
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    }),
    placement,
    motionOffset,
    machine,
  );
  if (!inspected.ok) return inspected;
  const { prepared, toolPlan } = inspected;

  const { gcode, preflight } = emitPreparedGcode(prepared, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    outputScope,
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...initialMachinePositionOption(machineWithReportUnits),
    allowRotaryRaster,
  });
  if (!preflight.ok) {
    return { ok: false, messages: preflight.issues.map((issue) => issue.message) };
  }
  const verifiedFrameIssue = requiredFrameIssueFromPrepared({
    device: project.device,
    prepared,
    placement,
    machine,
  });
  if (verifiedFrameIssue !== null) return { ok: false, messages: [verifiedFrameIssue] };

  const controller = runControllerReadiness(project, controllerSettings, readinessMode(machine));
  if (!controller.ok) {
    return { ok: false, messages: controller.errors.map((issue) => issue.message) };
  }
  const warnings = collectStartWarnings(
    project,
    controllerSettings,
    controller.warnings.map((issue) => issue.message),
    machine.ovCache,
  );
  return okPreparation(
    gcode,
    warnings,
    placement.jobOrigin,
    toolPlan,
    prepared,
    machine,
    controllerReportsInches(controllerSettings),
    canvasPlanRetentionKey(project, outputScope, jobPlacement, options.registration),
  );
}

function registrationOption(registration: SimilarityTransform | null | undefined): {
  readonly registration?: SimilarityTransform | null;
} {
  return registration === undefined ? {} : { registration };
}

function readinessMode(machine: MachineStartSnapshot): ReadinessSettingsCapability {
  return machine.settingsCapability ?? 'grbl-dollar';
}

type PreparedStartInspection =
  | {
      readonly ok: true;
      readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
      readonly toolPlan: ReadonlyArray<CncToolPlanEntry>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

function inspectPreparedStart(
  prepared: PreparedOutput,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  motionOffset: { readonly x: number; readonly y: number } | undefined,
  machine: MachineStartSnapshot,
): PreparedStartInspection {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const originIssue = placementBoundsIssueFromPrepared(prepared, placement, motionOffset);
  if (originIssue !== null) return { ok: false, messages: [originIssue] };
  const toolPlan = cncToolPlan(prepared.job);
  const toolIssue = cncWorkZeroToolStartIssue(
    prepared.project,
    machine.workZZeroEvidence,
    toolPlan[0],
  );
  return toolIssue === null
    ? { ok: true, prepared, toolPlan }
    : { ok: false, messages: [toolIssue] };
}

function placementBoundsIssueFromPrepared(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
  motionOffset: { readonly x: number; readonly y: number } | undefined,
): string | null {
  if (placement.jobOrigin === undefined || motionOffset === undefined) return null;
  const bounds = computeJobBounds(prepared.job, prepared.project.device);
  if (bounds === null) return null;
  const physicalBounds = {
    minX: bounds.minX + motionOffset.x,
    minY: bounds.minY + motionOffset.y,
    maxX: bounds.maxX + motionOffset.x,
    maxY: bounds.maxY + motionOffset.y,
  };
  const preflight = framePreflight(physicalBounds, prepared.project.device);
  if (preflight.kind === 'ok') return null;
  if (preflight.kind === 'no-go-zone') {
    return `Selected job origin would place this job through no-go zone "${preflight.zoneName}".`;
  }
  return `Selected job origin would place this job outside the machine bed. ${describeFramePreflightFailure(preflight)}`;
}

function findMachineStartIssues(machine: MachineStartSnapshot): ReadonlyArray<string> {
  const issues: string[] = [];
  if (machine.hasActiveStreamer) {
    issues.push('A job is already active. Request ABORT or finish it before starting another.');
  }
  if (machine.motionOperationActive === true) {
    issues.push('A jog or frame operation is active. Wait for it to finish before starting.');
  }
  if (machine.controllerOperationActive === true) {
    issues.push('A controller operation is active. Wait for it to finish before starting.');
  }
  if (machine.autofocusBusy === true) {
    issues.push('Auto-focus is running. Wait for it to finish before starting a job.');
  }
  if (machine.alarmCode !== null) {
    issues.push('Controller is in alarm state. Clear the alarm before starting.');
  }
  if (machine.statusReport === null) {
    issues.push(
      'Controller status is not known yet. Wait for an Idle status report before starting.',
    );
  } else if (machine.statusReport.state === 'Alarm' && machine.alarmCode === null) {
    issues.push(STATUS_ALARM_START_MESSAGE);
  } else if (machine.statusReport.state !== 'Idle') {
    issues.push(`Machine must be Idle before starting (currently ${machine.statusReport.state}).`);
  }
  return issues;
}

function findCameraPlacementIssue(
  project: Project,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
): string | null {
  return cameraPlacementSafetyIssue({
    active: machine.cameraPlacementActive === true,
    startFrom: jobPlacement.startFrom,
    homingEnabled: project.device.homing.enabled,
    homingState: machine.homingState ?? 'unknown',
    trustedPositionEpoch: machine.trustedPositionEpoch ?? 0,
    confirmedPositionEpoch: machine.cameraConfirmedPositionEpoch ?? null,
    geometryIssue: machine.cameraPlacementGeometryIssue ?? null,
  });
}

function findStartGateIssues(
  project: Project,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
): ReadonlyArray<string> {
  const machineIssues = findEarlyStartIssues(project, machine);
  if (machineIssues.length > 0) return machineIssues;
  const cameraIssue = findCameraPlacementIssue(project, machine, jobPlacement);
  return cameraIssue === null ? [] : [cameraIssue];
}
