// Machine Setup's laser finish position is a canvas position (ADR-493). When
// preparation cannot place it on this job (where the job sits on the bed is
// unknown, or the rotary turns Y into rotation), it is set aside and the job
// ends where it would without one. Job Review says so rather than leaving the
// operator to expect a move the program never makes. Warning only: it never
// refuses Frame or Start (ADR-228).

import { resolveGrblDialect } from '../../core/devices';
import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

// Static bodies; the canvas numbers are the only interpolated part (CLAUDE.md:
// messages are named constants).
const UNPLACED_REASON = 'where the job sits on the bed is unknown';
const ROTARY_REASON = 'the rotary is on';
const FALLBACK_TO_ORIGIN =
  'The head goes to the work origin instead (back to the start for a Current Position job).';
const FALLBACK_STAYS =
  'The head stays where the job ends instead (back to the start for a Current Position job).';
const UNPLACED_HINT =
  'It is placed once the bed mapping is verified: a confirmed Home this session on a controller whose settings, build and travel match the profile bed. Verified Origin jobs never place it.';

export function laserFinishSetAsideWarning(
  xMm: number,
  yMm: number,
  reason: 'unplaced' | 'rotary',
  parksAtOrigin: boolean,
): string {
  const because = reason === 'rotary' ? ROTARY_REASON : UNPLACED_REASON;
  const fallback = parksAtOrigin ? FALLBACK_TO_ORIGIN : FALLBACK_STAYS;
  return (
    `The finish position at canvas X ${formatMm(xMm)} · Y ${formatMm(yMm)} mm is set aside ` +
    `for this job because ${because}. ${fallback}` +
    (reason === 'unplaced' ? ` ${UNPLACED_HINT}` : '')
  );
}

/** One note when the prepared laser job carries a set-aside finish position. */
export function detectLaserFinishSetAsideWarnings(
  project: Project,
  job: Job | undefined,
): ReadonlyArray<string> {
  const finish = job?.laserFinish;
  const configured = project.device.laserFinishPosition;
  if (finish?.kind !== 'set-aside' || configured?.kind !== 'bed') return [];
  return [
    laserFinishSetAsideWarning(
      configured.xMm,
      configured.yMm,
      finish.reason,
      resolveGrblDialect(project.device).parkAtOriginAfterJob,
    ),
  ];
}
