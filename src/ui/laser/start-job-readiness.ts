import type { StatusReport } from '../../core/controllers/grbl';
import {
  applyJobOrigin,
  compileJob,
  computeJobBounds,
  describeFramePreflightFailure,
  framePreflight,
  offsetJobBounds,
  USER_ORIGIN_JOB_PLACEMENT,
} from '../../core/job';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import { runControllerReadiness } from '../../core/preflight';
import type { Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { hasCustomOrigin, type WorkCoordinateOffset } from '../state/origin-actions';
import { detectJobIntentWarnings } from './job-intent-warnings';

export const CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE =
  'Custom origin is active, but its physical machine location is not known yet. Wait for an Idle/WCO status report or reset origin before continuing.';

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
): StartJobPreparation {
  const machineIssues = findMachineStartIssues(machine);
  if (machineIssues.length > 0) return { ok: false, messages: machineIssues };

  const useUserOrigin = usesUserOrigin(machine);
  const originOffset = resolveUserOriginOffset(machine, useUserOrigin);
  if (originOffset === 'unknown') {
    return { ok: false, messages: [CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE] };
  }
  const originBoundsIssue = findOriginBoundsIssue(project, machine, useUserOrigin);
  if (originBoundsIssue !== null) {
    return { ok: false, messages: [originBoundsIssue] };
  }

  const { gcode, preflight } = useUserOrigin
    ? emitGcode(project, {
        jobOrigin: USER_ORIGIN_JOB_PLACEMENT,
        preflightMotionOffset: originOffset ?? undefined,
      })
    : emitGcode(project);
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

function usesUserOrigin(machine: MachineStartSnapshot): boolean {
  return machine.workOriginActive === true || hasCustomOrigin(machine.wcoCache ?? null);
}

function resolveUserOriginOffset(
  machine: MachineStartSnapshot,
  useUserOrigin: boolean,
): WorkCoordinateOffset | 'unknown' | null {
  if (!useUserOrigin) return null;
  if (machine.wcoCache === null || machine.wcoCache === undefined) return 'unknown';
  return machine.wcoCache;
}

function findOriginBoundsIssue(
  project: Project,
  machine: MachineStartSnapshot,
  useUserOrigin: boolean,
): string | null {
  if (!useUserOrigin || machine.wcoCache === null || machine.wcoCache === undefined) return null;
  const job = applyJobOrigin(compileJob(project.scene, project.device), USER_ORIGIN_JOB_PLACEMENT);
  const bounds = computeJobBounds(job);
  if (bounds === null) return null;
  const physicalBounds = offsetJobBounds(bounds, machine.wcoCache);
  const preflight = framePreflight(physicalBounds, project.device);
  if (preflight.kind === 'ok') return null;
  return `Custom origin would place this job outside the machine bed. ${describeFramePreflightFailure(preflight)}`;
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
  } else if (machine.statusReport.state !== 'Idle') {
    issues.push(`Machine must be Idle before starting (currently ${machine.statusReport.state}).`);
  }
  return issues;
}
