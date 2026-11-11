// A Frame refused while KerfDesk withholds the head position (ADR-367
// Amendment 2).
//
// Unlock, from the rail's Alarm card or `$X` typed in the Console, voids the
// reported position until Home or Set origin here re-establishes it
// (controllerUnlockedPatch, laser-status-position.ts). ADR-367 Decision 2 handed
// over to Set origin only for the Unlock the Frame itself offers; after any
// other Unlock the Frame refused with "Wait for a complete status report", or
// for an Absolute job "Wait for a fresh Idle status report", on every retry,
// while full reports kept arriving. No report can satisfy those, so while the
// position is withheld they are said with the way out instead. A machine
// without homing is not told to home.

import {
  ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE,
  CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE,
} from '../job-placement';
import type { LaserState } from '../state/laser-store';

export const FRAME_WORK_POSITION_UNKNOWN_MESSAGE =
  'The controller did not report a usable work position. Wait for a complete status report, then Frame again.';
export const FRAME_G54_POSITION_UNREPORTED_MESSAGE =
  'G54 was selected, but the controller did not report a fresh Idle position in that coordinate system. Wait for a complete status report, then Frame again.';
export const FRAME_ZERO_Z_POSITION_UNREPORTED_MESSAGE =
  'Work Z was set, but the controller did not report the fresh Idle position needed to build an exact Frame. Wait for a complete status report, then Frame again.';

const WAIT_FOR_REPORT_MESSAGES: ReadonlySet<string> = new Set([
  FRAME_WORK_POSITION_UNKNOWN_MESSAGE,
  FRAME_G54_POSITION_UNREPORTED_MESSAGE,
  FRAME_ZERO_Z_POSITION_UNREPORTED_MESSAGE,
  ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE,
  CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE,
]);

export function positionWithheldFrameMessage(homingEnabled: boolean): string {
  return homingEnabled
    ? 'Position is unknown after Unlock or Release motors. Home the machine, or move the head to where the job should start and use Set origin here. Then Frame again.'
    : 'Position is unknown after Unlock or Release motors. Move the head to where the job should start and use Set origin here, then Frame again.';
}

type WithheldEvidence = Pick<LaserState, 'positionEvidenceSuppressed' | 'reportUnitsUnconfirmed'>;

/** The same remedy for a control that is not Frame: Move to position, the
 *  origin row and Fire told the operator to wait for a report, or said nothing,
 *  while the position stayed hidden (user annoyance audit A1, A3-P2-1; ADR-367
 *  Amendment 3). Null when the position is not withheld, or when unconfirmed
 *  report units withhold it, which a `$$` read restores. */
export function positionWithheldMessage(
  laser: WithheldEvidence,
  homingEnabled: boolean,
): string | null {
  if (laser.positionEvidenceSuppressed !== true || laser.reportUnitsUnconfirmed === true) {
    return null;
  }
  return homingEnabled
    ? 'Position is unknown after Unlock or Release motors. Home the machine, or move the head to where the job should start and use Set origin here.'
    : 'Position is unknown after Unlock or Release motors. Move the head to where the job should start and use Set origin here.';
}

/** The origin row's short form of it; the row's tooltip carries the sentence. */
export function positionWithheldOriginLabel(homingEnabled: boolean): string {
  return homingEnabled
    ? 'unknown (Home, or jog to the start and Set origin here)'
    : 'unknown (jog to the start and Set origin here)';
}

/** The Frame refusals, with each "wait for a report" one said as its remedy
 *  while the position is withheld. Unconfirmed report units keep theirs: a
 *  `$$` read, not Home, brings that position back. */
export function withPositionWithheldRemedy(
  messages: ReadonlyArray<string>,
  laser: Pick<LaserState, 'positionEvidenceSuppressed' | 'reportUnitsUnconfirmed'>,
  homingEnabled: boolean,
): ReadonlyArray<string> {
  if (laser.positionEvidenceSuppressed !== true || laser.reportUnitsUnconfirmed === true) {
    return messages;
  }
  const remedy = positionWithheldFrameMessage(homingEnabled);
  const said = messages.map((message) =>
    WAIT_FOR_REPORT_MESSAGES.has(message) ? remedy : message,
  );
  // Two refusals that both meant "wait" become one remedy.
  return said.filter((message, index) => message !== remedy || said.indexOf(remedy) === index);
}
