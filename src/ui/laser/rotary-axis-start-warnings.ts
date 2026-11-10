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
import { formatRotaryTurn } from './abort-rotary-turn';

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

export function rotaryAxisStartWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  machine?: Pick<MachineStartSnapshot, 'rotaryTurnSinceAbort'>,
): string[] {
  if (!rotaryAppliesTo(project.device, project.machine)) return [];
  const turned = abortTurnWarning(project, machine?.rotaryTurnSinceAbort ?? null);
  if (turned !== null) return [turned, ...axisSetupWarnings(project)];
  return axisSetupWarnings(project);
}

// ADR-695 Amendment 1: a re-run after an Abort zeroes the turn where the part
// is now, so it lands as far round as the part turned since the stopped job.
function abortTurnWarning(
  project: Pick<Project, 'device' | 'machine'>,
  turned: MachineStartSnapshot['rotaryTurnSinceAbort'],
): string | null {
  const axis = rotaryOutputAxis(project.device, project.machine);
  if (turned === null || turned === undefined || axis !== turned.axis) return null;
  if (turned.since === null) {
    return (
      `KerfDesk cannot read where the rotary's ${axis} axis is since the job you stopped. This ` +
      "job starts from the part's current turn: turn the part back to where that job started first."
    );
  }
  if (Math.abs(turned.since) < (axis === 'A' ? 0.5 : 0.05)) return null;
  const back = formatRotaryTurn(axis, -turned.since);
  return (
    `Since the job you stopped started, the part has turned ${formatRotaryTurn(axis, turned.since)}. ` +
    "This job starts from the part's current turn, so it lands that far round from the first " +
    `burn. Use Restore saved origin, or turn the part ${back} with the rotary turn buttons first.`
  );
}

function axisSetupWarnings(project: Pick<Project, 'device' | 'machine'>): string[] {
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
