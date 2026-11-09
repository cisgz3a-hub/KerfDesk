// Start checks for the rotary's axis (ADR-695).
// - A controller whose own report has no such axis cannot take the program:
//   its A or Z words would be refused or move nothing. That is a factual
//   refusal, on Start and on Frame alike.
// - The rest are said in Job Review, never refused (ADR-228): a dedicated axis
//   no one has seen turn the rotary, and a machine whose rotary connector is a
//   dedicated axis (the Falcon A1 Pro's is A) with the rotary set to Y.

import {
  rotaryAxisMissingMessage,
  rotaryAxisNeedsConfirmation,
  rotaryAxisOf,
  rotaryAxisReportVerdict,
  type ReportedControllerAxes,
} from '../../core/devices/rotary-axis';
import { rotaryConnectorAxisFor } from '../../core/devices/rotary-presets';
import { rotaryAppliesTo } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import type { Project } from '../../core/scene';
import type { MachineStartSnapshot } from './start-job-readiness';

type AxisSnapshot = Pick<MachineStartSnapshot, 'statusReport' | 'reportedAxisLetters'>;

export function reportedAxesOf(machine: AxisSnapshot): ReportedControllerAxes {
  return {
    statusAxisCount: machine.statusReport?.reportedAxisCount ?? null,
    axisLetters: machine.reportedAxisLetters ?? null,
  };
}

/** The refusal when the controller reports no axis for the rotary, or null. */
export function rotaryAxisMissingIssue(
  project: Pick<Project, 'device' | 'machine'>,
  reported: ReportedControllerAxes,
): string | null {
  const axis = rotaryOutputAxis(project.device, project.machine);
  if (axis === null || rotaryAxisReportVerdict(axis, reported) !== 'missing') return null;
  return rotaryAxisMissingMessage(axis, reported);
}

export function rotaryAxisStartWarnings(project: Pick<Project, 'device' | 'machine'>): string[] {
  if (!rotaryAppliesTo(project.device, project.machine)) return [];
  const rotary = project.device.rotary;
  if (rotary === undefined) return [];
  const axis = rotaryAxisOf(rotary);
  const connector = rotaryConnectorAxisFor(project.device);
  if (axis === 'Y' && connector !== null) {
    return [
      `This machine's rotary connector is its ${connector} axis, but the rotary is set to Y. ` +
        'Unless the rotary is plugged in where the Y motor was, the head moves across the part with ' +
        `the laser on instead of turning it. Choose ${connector} in Rotary Setup.`,
    ];
  }
  if (axis !== 'Y' && rotaryAxisNeedsConfirmation(rotary)) {
    return [
      `No Test rotation has been confirmed on the ${axis} axis yet. Before the first burn, open ` +
        `Rotary Setup, run Test rotation and confirm the rotary turned. If the firmware sends ${axis} ` +
        'to another motor, the job burns over one place, or moves that motor, instead of turning the part.',
    ];
  }
  return [];
}
