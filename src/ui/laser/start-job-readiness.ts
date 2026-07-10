import type { StatusReport } from '../../core/controllers/grbl';
import {
  computeJobBounds,
  describeFramePreflightFailure,
  frameBoundsSignature,
  framePreflight,
} from '../../core/job';
import type { ControllerSettingsSnapshot, ReadinessSettingsCapability } from '../../core/preflight';
import { runControllerReadiness, runPreEmitPreflight } from '../../core/preflight';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  validateOutputScope,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { emitGcode, prepareOutput } from '../../io/gcode';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { isVerifiedFrameValid, type FrameVerification } from '../state/frame-verification';
import {
  DEFAULT_JOB_PLACEMENT,
  resolveJobPlacement,
  trustedMotionOffsetForPreflight,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { detectMachineJobWarnings } from './machine-job-warnings';
import { cncWorkZeroAdvisory } from './cnc-start-advisories';

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
  readonly wcoCache?: WorkCoordinateOffset | null;
  // ADR-053 P2 — the last clean Verified Frame, gating verified-origin starts.
  readonly frameVerification?: FrameVerification | null;
  // ADR-094 — how the connected firmware exposes settings. Non-GRBL values
  // relax the $30/$32 readiness proof into an explicit unverified warning.
  readonly settingsCapability?: ReadinessSettingsCapability;
  // ADR-098 — CNC is GRBL-only. False blocks CNC Start outright (the CNC
  // emitter's dialect is unsafe on other firmwares); absent = allowed.
  readonly cncJobsSupported?: boolean;
};

// Machine-state blockers plus the ADR-098 dialect gate: CNC is GRBL-only —
// the emitter's dialect (G4 dwell in seconds) is unsafe on firmwares that
// parse it differently.
function findEarlyStartIssues(project: Project, machine: MachineStartSnapshot): string[] {
  const issues = [...findMachineStartIssues(machine)];
  if (machineKindOf(project.machine) === 'cnc' && machine.cncJobsSupported === false) {
    issues.push(CNC_REQUIRES_GRBL_MESSAGE);
  }
  return issues;
}

export function prepareStartJob(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
): StartJobPreparation {
  const machineIssues = findEarlyStartIssues(project, machine);
  if (machineIssues.length > 0) return { ok: false, messages: machineIssues };

  const placement = resolveJobPlacement(jobPlacement, machine);
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
  const preEmitIssues = findScopedPreEmitIssues(project, outputScope);
  if (preEmitIssues.length > 0) return { ok: false, messages: preEmitIssues };
  const originBoundsIssue = findPlacementBoundsIssue(project, placement, outputScope, motionOffset);
  if (originBoundsIssue !== null) {
    return { ok: false, messages: [originBoundsIssue] };
  }

  const { gcode, preflight } = emitGcode(project, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    outputScope,
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
  });
  if (!preflight.ok) {
    return { ok: false, messages: preflight.issues.map((i) => i.message) };
  }

  const verifiedFrameIssue = findVerifiedFrameGateIssue(project, placement, outputScope, machine);
  if (verifiedFrameIssue !== null) {
    return { ok: false, messages: [verifiedFrameIssue] };
  }

  const controller = runControllerReadiness(project, controllerSettings, readinessMode(machine));
  if (!controller.ok) {
    return { ok: false, messages: controller.errors.map((i) => i.message) };
  }

  return {
    ok: true,
    gcode,
    warnings: collectStartWarnings(
      project,
      controllerSettings,
      controller.warnings.map((i) => i.message),
      machine,
    ),
  };
}

// The Start-path warning list: controller-readiness warnings, the machine-kind
// advisory set, plus the CNC work-zero advisory (Start-only — it depends on
// live machine state, so it cannot live in detectMachineJobWarnings, which the
// Save path also uses).
function collectStartWarnings(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  controllerWarnings: ReadonlyArray<string>,
  machine: MachineStartSnapshot,
): string[] {
  const workZeroAdvisory = cncWorkZeroAdvisory(project, machine.workOriginActive);
  return [
    ...controllerWarnings,
    ...detectMachineJobWarnings(project, controllerSettings),
    ...(workZeroAdvisory === null ? [] : [workZeroAdvisory]),
  ];
}

function readinessMode(machine: MachineStartSnapshot): ReadinessSettingsCapability {
  return machine.settingsCapability ?? 'grbl-dollar';
}

function findScopedPreEmitIssues(
  project: Project,
  outputScope: OutputScope,
): ReadonlyArray<string> {
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return scoped.messages;
  const outputProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  const preEmit = runPreEmitPreflight(outputProject);
  return preEmit.ok ? [] : preEmit.issues.map((issue) => issue.message);
}

function findPlacementBoundsIssue(
  project: Project,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
  outputScope: OutputScope,
  motionOffset: { readonly x: number; readonly y: number } | undefined,
): string | null {
  if (placement.jobOrigin === undefined || motionOffset === undefined) {
    return null;
  }
  const prepared = prepareOutput(project, { jobOrigin: placement.jobOrigin, outputScope });
  if (!prepared.ok) return null;
  const bounds = computeJobBounds(prepared.job, project.device);
  if (bounds === null) return null;
  const physicalBounds = {
    minX: bounds.minX + motionOffset.x,
    minY: bounds.minY + motionOffset.y,
    maxX: bounds.maxX + motionOffset.x,
    maxY: bounds.maxY + motionOffset.y,
  };
  const preflight = framePreflight(physicalBounds, project.device);
  if (preflight.kind === 'ok') return null;
  if (preflight.kind === 'no-go-zone') {
    return `Selected job origin would place this job through no-go zone "${preflight.zoneName}".`;
  }
  return `Selected job origin would place this job outside the machine bed. ${describeFramePreflightFailure(preflight)}`;
}

// ADR-053 P2 — Verified Origin requires a clean Verified Frame for the current
// job at the current origin before Start. The frame is the physical bounds check
// that replaces the absolute position check we can't do without homing. A
// mismatch (no frame yet, or the job moved/resized or the origin changed since)
// means the frame's guarantee no longer holds, so re-frame. Other start modes
// are unaffected.
function findVerifiedFrameGateIssue(
  project: Project,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
  outputScope: OutputScope,
  machine: MachineStartSnapshot,
): string | null {
  if (placement.jobOrigin?.startFrom !== 'verified-origin') return null;
  const prepared = prepareOutput(project, { jobOrigin: placement.jobOrigin, outputScope });
  if (!prepared.ok) return null;
  const bounds = computeJobBounds(prepared.job, project.device);
  if (bounds === null) return null;
  const valid = isVerifiedFrameValid(machine.frameVerification ?? null, {
    boundsSignature: frameBoundsSignature(bounds),
    wco: machine.wcoCache ?? null,
    workOriginActive: machine.workOriginActive === true,
  });
  if (valid) return null;
  return (
    'Verified Origin needs a Verified Frame first: click Frame to trace the job and confirm ' +
    'it fits, then Start. Re-frame after moving the origin or changing the job.'
  );
}

function findMachineStartIssues(machine: MachineStartSnapshot): ReadonlyArray<string> {
  const issues: string[] = [];
  if (machine.hasActiveStreamer) {
    issues.push('A job is already active. Stop or finish it before starting another.');
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
