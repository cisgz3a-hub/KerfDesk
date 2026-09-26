// A Machine Setup park is a bed position (ADR-392). When where the job sits on
// the bed is unknown, preparation sets the park aside and the program parks at
// the job's origin instead. Job Review says so rather than leaving the operator
// to expect a park the program never visits. Warning only: it never refuses
// Frame or Start (PROJECT.md rule 21).

import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

// Static body of the advisory; the park numbers are the only interpolated part
// (CLAUDE.md: messages are named constants).
const PARK_SET_ASIDE_WARNING_BODY =
  'is not used: where this job sits on the bed is unknown, so the bit-change and end parks go to ' +
  "the job's origin instead. A confirmed Home with the controller's work offset reported places " +
  'the park; Verified Origin jobs always park at their origin.';

export function cncParkSetAsideWarning(parkXMm: number, parkYMm: number): string {
  return (
    `The Machine Setup park at bed X ${formatMm(parkXMm)} · Y ${formatMm(parkYMm)} mm ` +
    PARK_SET_ASIDE_WARNING_BODY
  );
}

/** Warn when Machine Setup has a park but the prepared job carries none: the
 * compile seam always copies a configured park onto every CNC group, so a job
 * without one had it set aside by placement. */
export function detectCncParkSetAsideWarnings(
  project: Project,
  job: Job | undefined,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || job === undefined) return [];
  const { parkXMm, parkYMm } = machine.params;
  if (parkXMm === undefined && parkYMm === undefined) return [];
  const cncGroups = job.groups.filter((group) => group.kind === 'cnc');
  if (cncGroups.length === 0) return [];
  const parked = cncGroups.some(
    (group) => group.parkXMm !== undefined || group.parkYMm !== undefined,
  );
  return parked ? [] : [cncParkSetAsideWarning(parkXMm ?? 0, parkYMm ?? 0)];
}
