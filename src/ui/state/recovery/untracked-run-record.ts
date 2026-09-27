// A short record for a laser run too large for the exact recovery archive
// (ADR-341 Amendment 8).
//
// Start goes ahead without an archive when the job and its images outgrow the
// budget, and such a run used to leave nothing behind: no card after a lost
// connection, no saved origin, no stop. The repository now keeps the run's
// Start intent and the work offset reported at Start in memory while it runs,
// and an interruption writes them as a fingerprint-only capsule: the card
// shows, the Review can put the origin back and continue once the current
// project reproduces the program.
//
// A recovery of such a job runs a resume program, not the job's own. Its
// record still names the job's program, and `progress` maps the resume
// program's line counts back onto the job's, so a second interruption leaves
// a record the Review can continue from again.

import type { JobCheckpoint, JobInterruption } from '../../../core/recovery';
import type { LegacyFingerprintOnlyArtifactV1, RunId } from './execution-artifact';
import { startIntentStandInArtifact } from './start-intent';

/** How a resume program's sendable lines line up with the job's: its preamble
 * comes first, then the job's own lines from the restart on, one for one. */
export type UntrackedRunProgressMap = {
  /** Sendable lines of the job before the restart line. */
  readonly jobLinesBefore: number;
  /** Sendable lines of the resume preamble. */
  readonly preambleLines: number;
};

export type UntrackedRunRecord = {
  readonly runId: RunId;
  /** The job's own program: its fingerprint, length and placement. */
  readonly intent: JobCheckpoint;
  /** Work offset in mm reported at Start; null when the controller had reported none. */
  readonly startWorkOffsetMm: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** Present when the run streamed a resume program instead of the job itself. */
  readonly progress?: UntrackedRunProgressMap;
};

export function untrackedRunArtifact(
  record: UntrackedRunRecord,
  nowIso: string,
): LegacyFingerprintOnlyArtifactV1 {
  const artifact = startIntentStandInArtifact(record.runId, record.intent, nowIso);
  return record.startWorkOffsetMm === null
    ? artifact
    : { ...artifact, startWorkOffsetMm: record.startWorkOffsetMm };
}

export function untrackedRunCheckpoint(
  record: UntrackedRunRecord,
  ackedLines: number,
  interruption: JobInterruption,
  updatedAtIso: string,
): JobCheckpoint {
  const toJob = (lines: number): number => jobLines(record, lines);
  const { plannerBacklog, sentLines } = interruption;
  return {
    ...record.intent,
    ackedLines: toJob(ackedLines),
    interruption: {
      ...interruption,
      ...(sentLines === undefined ? {} : { sentLines: toJob(sentLines) }),
      ...(plannerBacklog === undefined
        ? {}
        : {
            plannerBacklog: {
              ...plannerBacklog,
              ackedAtStatus: toJob(plannerBacklog.ackedAtStatus),
            },
          }),
    },
    updatedAtIso,
  };
}

/** A count of the run's own sendable lines, as a count of the job's. */
function jobLines(record: UntrackedRunRecord, runLines: number): number {
  const progress = record.progress;
  const lines =
    progress === undefined
      ? runLines
      : progress.jobLinesBefore + Math.max(0, runLines - progress.preambleLines);
  return Math.min(Math.max(0, lines), record.intent.sendableLines);
}
