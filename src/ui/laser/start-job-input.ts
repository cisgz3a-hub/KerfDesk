import type { JobOriginPlacement } from '../../core/job';
import type { ControllerSettingsSnapshot, PreflightOptions } from '../../core/preflight';
import type { Project } from '../../core/scene';
import {
  trustedMotionOffsetForPreflight,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import type { MachineStartSnapshot, StartJobPreparation } from './start-job-readiness';
import {
  placementForResolvedOrigin,
  resolveStartPlacement,
  withControllerReportUnits,
} from './start-job-preparation';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';

export const STATUS_ALARM_START_MESSAGE =
  'Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe.';

export type PrepareStartInput =
  | { readonly ok: false; readonly result: StartJobPreparation }
  | {
      readonly ok: true;
      readonly effectivePlacement: JobPlacementSettings;
      readonly machineWithReportUnits: MachineStartSnapshot;
      readonly placement: Extract<ResolvedJobPlacement, { readonly ok: true }>;
      readonly motionOffset: PreflightOptions['motionOffset'];
    };

export function prepareStartInput(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
  resolvedJobOrigin: JobOriginPlacement | undefined,
): PrepareStartInput {
  const effectivePlacement = placementForResolvedOrigin(jobPlacement, resolvedJobOrigin);
  const gateIssues = findMachineStartIssues(machine);
  if (gateIssues.length > 0) return { ok: false, result: { ok: false, messages: gateIssues } };
  const machineWithReportUnits = withControllerReportUnits(machine, controllerSettings);
  const placement = resolveStartPlacement(jobPlacement, machineWithReportUnits, resolvedJobOrigin);
  if (!placement.ok) return { ok: false, result: { ok: false, messages: placement.messages } };
  return {
    ok: true,
    effectivePlacement,
    machineWithReportUnits,
    placement,
    motionOffset: trustedMotionOffsetForPreflight(project.device, placement),
  };
}

export function findMachineStartIssues(machine: MachineStartSnapshot): ReadonlyArray<string> {
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
  if (machine.alarmCode !== null) issues.push(ALARM_ACTIVE_START_MESSAGE);
  if (machine.statusReport === null) {
    issues.push(
      'Controller status is not known yet. Wait for an Idle status report before starting.',
    );
  } else if (machine.statusReport.state === 'Alarm' && machine.alarmCode === null) {
    issues.push(STATUS_ALARM_START_MESSAGE);
  } else if (machine.statusReport.state !== 'Idle') {
    issues.push(machineNotIdleStartMessage(machine.statusReport.state));
  }
  return issues;
}
