// Where the head stands after a lost link (ADR-341 Amendment 6).
//
// A dropped USB link leaves the controller running every line it had received,
// so the head stops at the end of the last line KerfDesk sent and stays there.
// The interruption records how many lines that was. When the saved origin
// cannot come back (a reset cleared it on a machine that was not homed), the
// operator can make the head's current spot that program point and continue
// from the next line without moving the head.

import { resumeEntryPointMm } from '../../core/controllers/grbl/resume-program';
import { rawResumeLine } from '../../core/recovery';
import type { RecoveryCapsule } from '../state/recovery';

export type RecoveryHeadStop = {
  /** 1-based file line the head had not reached; continuing restarts here. */
  readonly line: number;
  /** Sendable lines the controller received before the link dropped. */
  readonly sentLines: number;
  /** The program point where the head stands, in mm of work coordinates. */
  readonly pointMm: { readonly x: number; readonly y: number };
};

/** Null unless the run was an archived laser job cut off by a lost link with
 * lines still to run, and the program up to the stop can be followed. */
export function recoveryHeadStop(capsule: RecoveryCapsule): RecoveryHeadStop | null {
  const { artifact, interruption } = capsule;
  if (artifact.kind !== 'exact-execution' || artifact.machineKind !== 'laser') return null;
  if (interruption.kind !== 'disconnect' || interruption.sentLines === undefined) return null;
  const sentLines = Math.max(interruption.sentLines, capsule.ackedLines);
  if (sentLines >= capsule.sendableLines) return null;
  const line = rawResumeLine(artifact.gcode, sentLines);
  const pointMm = resumeEntryPointMm(artifact.gcode, line);
  return pointMm === null ? null : { line, sentLines, pointMm };
}
