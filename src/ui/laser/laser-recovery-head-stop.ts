// Where the head stands after a lost link (ADR-341 Amendment 6).
//
// A dropped USB link leaves the controller running every line it had received,
// so the head stops at the end of the last line KerfDesk sent and stays there.
// The interruption records how many lines that was. When the saved origin
// cannot come back (a reset cleared it on a machine that was not homed), the
// operator can make the head's current spot that program point and continue
// from the next line without moving the head. That holds only while the
// controller kept running: if the laser itself lost power, the head stopped
// earlier, so the stop also says how far the unconfirmed lines reach back
// along the path (Amendment 8).

import { resumeEntryPointMm, resumeTravelMm } from '../../core/controllers/grbl/resume-program';
import { rawResumeLine } from '../../core/recovery';
import type { RecoveryCapsule } from '../state/recovery';

export type RecoveryHeadStop = {
  /** 1-based file line the head had not reached; continuing restarts here. */
  readonly line: number;
  /** Sendable lines the controller received before the link dropped. */
  readonly sentLines: number;
  /** The program point where the head stands, in mm of work coordinates. */
  readonly pointMm: { readonly x: number; readonly y: number };
  /** Lines sent after the last one the controller confirmed. */
  readonly unconfirmedLines: number;
  /** XY travel in mm those unconfirmed lines cover; null when it cannot be followed. */
  readonly unconfirmedTravelMm: number | null;
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
  if (pointMm === null) return null;
  const confirmedLine = rawResumeLine(artifact.gcode, capsule.ackedLines);
  return {
    line,
    sentLines,
    pointMm,
    unconfirmedLines: sentLines - capsule.ackedLines,
    unconfirmedTravelMm: resumeTravelMm(artifact.gcode, confirmedLine, line),
  };
}
