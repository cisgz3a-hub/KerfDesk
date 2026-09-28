// A laser recovery too large for the exact archive (ADR-341 Amendment 8).
//
// A job over the archive budget leaves a fingerprint-only record when it is
// interrupted. Recovering it builds a resume program from the open project,
// and that program's archive is over the budget too, so staging it failed and
// the Review refused to continue the only record the job had. Such an attempt
// now runs without an archive: the claim holds the record while Start is sent,
// and once the controller takes the program the record gives way to a short
// one for the recovery run. That one still names the job's own program and
// counts progress in the job's lines, so a second stop leaves a record the
// Review can continue from again.

import { isSendableGcodeLine } from '../../core/controllers/grbl';
import type { OutputScope } from '../../core/scene';
import type { JobOriginPlacement } from '../../core/job';
import type { LaserState } from '../state/laser-store';
import type { RecoveryRepository, RunId } from '../state/recovery';
import { ExecutionArtifactTooLargeError } from '../state/recovery/execution-artifact-size';
import { createStartIntent } from '../state/recovery/start-intent';
import type {
  UntrackedRunProgressMap,
  UntrackedRunRecord,
} from '../state/recovery/untracked-run-record';
import { laserWorkOffsetMm } from './start-job-execution-tracking';

/** A recovery that runs without an archive, with its record when one can be kept. */
export type UntrackedLaserRecovery = { readonly record?: UntrackedRunRecord };

/** Null unless staging failed because the recovery is over the archive budget. */
export function untrackedLaserRecovery(
  error: unknown,
  args: {
    readonly recoveryRunId: RunId;
    readonly jobGcode: string;
    readonly resumeGcode: string;
    readonly resumeFromLine: number;
    /** Lines the resume builder put before the job's own. */
    readonly resumePreambleLines: number;
    readonly outputScope: OutputScope;
    readonly jobOrigin: JobOriginPlacement | undefined;
    readonly laser: Pick<LaserState, 'controllerSettings' | 'wcoCache'>;
  },
): UntrackedLaserRecovery | null {
  if (!(error instanceof ExecutionArtifactTooLargeError)) return null;
  const progress = resumeProgressMap(
    args.jobGcode,
    args.resumeGcode,
    args.resumeFromLine,
    args.resumePreambleLines,
  );
  if (progress === null) return {};
  const intent = createStartIntent({
    gcode: args.jobGcode,
    machineKind: 'laser',
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    nowIso: new Date().toISOString(),
  });
  return {
    record: {
      runId: args.recoveryRunId,
      intent,
      startWorkOffsetMm: laserWorkOffsetMm(args.laser),
      progress,
    },
  };
}

/** Hands the accepted recovery run to the repository: the claimed capsule
 * becomes the run's archive, or, without one, gives way to its record.
 * False when the repository does not track the run. */
export async function acceptLaserRecoveryRun(
  repository: RecoveryRepository,
  ids: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly recoveryRunId: RunId;
  },
  untracked: UntrackedLaserRecovery | undefined,
): Promise<boolean> {
  if (untracked === undefined) {
    const activated = await repository.activateClaimedRecovery(ids);
    return activated.ok && activated.value;
  }
  const noted = await repository.noteUntrackedRunAccepted(ids.recoveryRunId, untracked.record);
  return noted.ok && untracked.record !== undefined;
}

/** How the resume program's sendable lines line up with the job's: its
 * preamble, then the job's lines from `fromLine` on, one for one. Null when
 * they do not (a Marlin fan restore inserted among them), and a count in one
 * could not be read as a count in the other. */
export function resumeProgressMap(
  jobGcode: string,
  resumeGcode: string,
  fromLine: number,
  preamble: number,
): UntrackedRunProgressMap | null {
  const job = jobGcode.split('\n');
  const resume = resumeGcode.split('\n');
  const tailLines = job.length - (fromLine - 1);
  if (!Number.isInteger(fromLine) || fromLine < 1 || tailLines < 1) return null;
  if (preamble < 0 || resume.length - preamble !== tailLines) return null;
  for (let i = 0; i < tailLines; i += 1) {
    const jobLine = job[fromLine - 1 + i] ?? '';
    if (isSendableGcodeLine(jobLine) !== isSendableGcodeLine(resume[preamble + i] ?? '')) {
      return null;
    }
  }
  return {
    jobLinesBefore: sendableLines(job, fromLine - 1),
    preambleLines: sendableLines(resume, preamble),
  };
}

function sendableLines(lines: ReadonlyArray<string>, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i += 1) if (isSendableGcodeLine(lines[i] ?? '')) count += 1;
  return count;
}
