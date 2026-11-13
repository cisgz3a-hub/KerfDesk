// CNC recovery checks Work Z against the bit its own program starts with
// (rolling audit v4 H3-P1-1, ADR-215 Amendment 2).
//
// Recovery qualifies the archived job as Start does, and Start's advisory names
// the WHOLE job's first bit (start-job-prepared-inspection.ts). A pass recovery
// that resumes in a later operation streams only that operation's bit, with no
// M0 before it, so the advisory named the wrong cutter: with the right bit
// zeroed it said to load the first one, and with the first one still zeroed it
// said nothing, and the later passes cut with the wrong bit at its Z zero.
//
// Recovery therefore drops the archived job's first-bit advisory and refuses
// unless Work Z was set for the recovery program's own first bit. Recovery is
// not an ordinary Start: re-zeroing or probing with that bit clears it. The
// final recovery assertion (recovery-start-authorization.ts) refuses any Work Z
// change after this check, so the zero checked here is the one that streams.
//
// An Abort's reset voids the live record, so the check also reads the record
// that reset voided, and refuses a zero the reset cleared or one it cannot
// name after a bit change (cnc-recovery-work-z.ts, ADR-215 Amendment 3).

import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';
import type { RecoveryCapsule } from '../state/recovery';
import { cncToolPlan } from '../state/cnc-tool-plan';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { WorkZZeroEvidence } from '../state/work-z-zero-evidence';
import {
  CNC_UNKNOWN_INITIAL_TOOL_START_MESSAGE,
  cncWorkZeroToolStartIssue,
} from './cnc-start-advisories';
import type { PreparedRecoverySource } from './start-job-source';
import {
  cncRecoveryWorkZ,
  cncRecoveryWorkZEvidence,
  cncRecoveryWorkZIssue,
} from './cnc-recovery-work-z';

const RECOVERY_SUBJECT = 'The recovery program';

/** The archived job's warnings without Start's first-bit advisory, which
 * names the whole job's first bit rather than the recovery program's. A job
 * that names no first bit keeps its advisory: no bit can be checked. */
export function withoutArchivedFirstBitAdvisory(
  warnings: ReadonlyArray<string>,
  project: Project,
  archivedJob: Job,
  evidence: WorkZZeroEvidence | null | undefined,
): ReadonlyArray<string> {
  const advisory = cncWorkZeroToolStartIssue(project, evidence, cncToolPlan(archivedJob)[0]);
  if (advisory === null || advisory === CNC_UNKNOWN_INITIAL_TOOL_START_MESSAGE) return warnings;
  return warnings.filter((warning) => warning !== advisory);
}

/** Why `recoveryJob` may not stream on this Work Z, or null when Work Z was set
 * for its first bit. No Work Z at all is the no-work-zero check's to report,
 * and a sealed job that names no bit cannot be recompiled, so neither refuses. */
export function cncRecoveryStartBitIssue(
  project: Project,
  recoveryJob: Job,
  evidence: WorkZZeroEvidence | null | undefined,
): string | null {
  const firstTool = cncToolPlan(recoveryJob)[0];
  if (evidence === null || evidence === undefined || firstTool?.id === null) return null;
  return cncWorkZeroToolStartIssue(project, evidence, firstTool, RECOVERY_SUBJECT);
}

/** Alerts and returns true when `recoveryJob` may not stream on the Work Z its
 * source was qualified against, before any claim or controller write. */
export function refuseCncRecoveryStartBit(
  source: Pick<PreparedRecoverySource, 'project' | 'controllerSnapshot'>,
  recoveryJob: Job,
  capsule: RecoveryCapsule,
): boolean {
  const workZ = cncRecoveryWorkZ(source.controllerSnapshot, capsule);
  const issue =
    cncRecoveryWorkZIssue(source.project, recoveryJob, workZ) ??
    cncRecoveryStartBitIssue(source.project, recoveryJob, cncRecoveryWorkZEvidence(workZ));
  if (issue === null) return false;
  jobAwareAlert(`Cannot start CNC recovery:\n\n${issue}`);
  return true;
}
