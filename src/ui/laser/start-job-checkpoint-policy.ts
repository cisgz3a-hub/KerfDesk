import {
  fingerprintGcode,
  fingerprintsEqual,
  markResumeInFlight,
  type JobCheckpoint,
} from '../../core/recovery';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';

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

export function markOwnedResumeCheckpoint(gcode: string, nowIso: string): 'marked' | 'not-owned' {
  const current = readJobCheckpoint();
  if (current === null || !fingerprintsEqual(fingerprintGcode(gcode), current.fingerprint)) {
    return 'not-owned';
  }
  writeJobCheckpoint(markResumeInFlight(current, nowIso));
  return 'marked';
}
