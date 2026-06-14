import type { StatusReport } from '../../core/controllers/grbl';
import { computeJobBounds, describeFramePreflightFailure, framePreflight } from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { runControllerReadiness, runPreEmitPreflight } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { emitGcode, prepareOutput } from '../../io/gcode';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import {
  DEFAULT_JOB_PLACEMENT,
  resolveJobPlacement,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import { detectJobIntentWarnings } from './job-intent-warnings';

export const CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE =
  'Custom origin is active, but its physical machine location is not known yet. Wait for an Idle/WCO status report or reset origin before continuing.';
export const STATUS_ALARM_START_MESSAGE =
  'Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe.';

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
  readonly autofocusBusy?: boolean;
  readonly workOriginActive?: boolean;
  readonly wcoCache?: WorkCoordinateOffset | null;
};

export function prepareStartJob(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
): StartJobPreparation {
  const machineIssues = findMachineStartIssues(machine);
  if (machineIssues.length > 0) return { ok: false, messages: machineIssues };

  const placement = resolveJobPlacement(jobPlacement, machine);
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const preEmit = runPreEmitPreflight(project);
  if (!preEmit.ok) {
    return { ok: false, messages: preEmit.issues.map((i) => i.message) };
  }
  const originBoundsIssue = findPlacementBoundsIssue(project, placement);
  if (originBoundsIssue !== null) {
    return { ok: false, messages: [originBoundsIssue] };
  }

  const { gcode, preflight } = emitGcode(project, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(placement.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: placement.preflightMotionOffset }),
  });
  if (!preflight.ok) {
    return { ok: false, messages: preflight.issues.map((i) => i.message) };
  }

  const controller = runControllerReadiness(project, controllerSettings);
  if (!controller.ok) {
    return { ok: false, messages: controller.errors.map((i) => i.message) };
  }

  return {
    ok: true,
    gcode,
    warnings: [...controller.warnings.map((i) => i.message), ...detectJobIntentWarnings(project)],
  };
}

function findPlacementBoundsIssue(
  project: Project,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
): string | null {
  if (placement.jobOrigin === undefined || placement.preflightMotionOffset === undefined) {
    return null;
  }
  const prepared = prepareOutput(project, { jobOrigin: placement.jobOrigin });
  if (!prepared.ok) return null;
  const bounds = computeJobBounds(prepared.job);
  if (bounds === null) return null;
  const physicalBounds = {
    minX: bounds.minX + placement.preflightMotionOffset.x,
    minY: bounds.minY + placement.preflightMotionOffset.y,
    maxX: bounds.maxX + placement.preflightMotionOffset.x,
    maxY: bounds.maxY + placement.preflightMotionOffset.y,
  };
  const preflight = framePreflight(physicalBounds, project.device);
  if (preflight.kind === 'ok') return null;
  return `Selected job origin would place this job outside the machine bed. ${describeFramePreflightFailure(preflight)}`;
}

function findMachineStartIssues(machine: MachineStartSnapshot): ReadonlyArray<string> {
  const issues: string[] = [];
  if (machine.hasActiveStreamer) {
    issues.push('A job is already active. Stop or finish it before starting another.');
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
