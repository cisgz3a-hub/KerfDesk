import {
  fingerprintGcode,
  fingerprintsEqual,
  markResumeInFlight,
  type JobCheckpoint,
} from '../../core/recovery';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';

export function checkpointStartIssue(checkpointToReplace: JobCheckpoint | null): string | null {
  const current = readJobCheckpoint();
  if (checkpointToReplace !== null) {
    if (current !== null && sameCheckpoint(current, checkpointToReplace)) return null;
    return 'The interrupted-job recovery record changed while Start was being prepared. No controller command was sent; review the current recovery banner and try again.';
  }
  if (current === null || !checkpointNeedsOperatorDecision(current)) return null;
  const recoveryChoices =
    current.machineKind === 'cnc'
      ? 'Use Review supervised recovery or Discard recovery record in the recovery banner.'
      : 'Use Review safe recovery, Restart entire job from the beginning, or Discard recovery record in the recovery banner.';
  return (
    `An interrupted ${current.machineKind === 'cnc' ? 'router' : 'laser'} job recovery record is still active ` +
    `(${current.ackedLines} of ${current.sendableLines} lines acknowledged). Start is blocked so that record cannot be overwritten. ` +
    recoveryChoices
  );
}

export function checkpointProgramIssue(
  checkpointToReplace: JobCheckpoint | null,
  gcode: string,
): string | null {
  if (
    checkpointToReplace === null ||
    fingerprintsEqual(fingerprintGcode(gcode), checkpointToReplace.fingerprint)
  ) {
    return null;
  }
  return "The current project no longer produces the interrupted job's G-code. The recovery record was preserved. Re-open the original project, or discard the recovery record explicitly before starting a different job.";
}

export function sameCheckpoint(a: JobCheckpoint, b: JobCheckpoint): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.machineKind === b.machineKind &&
    a.startedAtIso === b.startedAtIso &&
    a.updatedAtIso === b.updatedAtIso &&
    a.sendableLines === b.sendableLines &&
    a.ackedLines === b.ackedLines &&
    a.resumeInFlight === b.resumeInFlight &&
    fingerprintsEqual(a.fingerprint, b.fingerprint)
  );
}

export function markOwnedResumeCheckpoint(
  gcode: string,
  expected: JobCheckpoint | undefined,
  nowIso: string,
): 'changed' | 'marked' | 'not-owned' {
  const current = readJobCheckpoint();
  if (expected !== undefined && (current === null || !sameCheckpoint(current, expected))) {
    return 'changed';
  }
  if (current === null || !fingerprintsEqual(fingerprintGcode(gcode), current.fingerprint)) {
    return 'not-owned';
  }
  writeJobCheckpoint(markResumeInFlight(current, nowIso));
  return 'marked';
}

function checkpointNeedsOperatorDecision(checkpoint: JobCheckpoint): boolean {
  return (
    checkpoint.ackedLines > 0 || checkpoint.resumeInFlight || checkpoint.interruption !== undefined
  );
}
