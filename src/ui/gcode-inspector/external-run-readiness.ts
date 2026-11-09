// external-run-readiness — the controller checks an external run shares with
// project Start (ADR-630 Amendment 4). The connected controller's `$30` and
// `$32` go through the same `runControllerReadiness` and the same messages
// that Job Review shows: laser mode on for a router, laser mode off for a
// laser, a `$30` that does not match the profile. Like Job Review, the Run
// review lists them as warnings; none refuses. A laser whose laser mode is off
// or unconfirmed also names rapid commands (G0 and G28/G30 returns) the program makes with the beam on.

import { findLitRapids, type LitRapids } from '../../core/external-program';
import { runControllerReadiness } from '../../core/preflight';
import { machineKindOf, type Project } from '../../core/scene';
import type { LaserState } from '../state/laser-store';

export type ExternalReadinessSource = Pick<
  LaserState,
  | 'connection'
  | 'controllerSettings'
  | 'capabilities'
  | 'activeControllerKind'
  | 'detectedControllerKind'
>;

/** The Run review's controller warnings, in Job Review's own words. None
 * until connected: Frame says to connect first, and there is no controller
 * to describe. */
export function externalControllerWarnings(
  project: Project,
  laser: ExternalReadinessSource,
  litRapids: LitRapids | null,
): ReadonlyArray<string> {
  if (laser.connection.kind !== 'connected') return [];
  const readiness = runControllerReadiness(
    project,
    laser.controllerSettings,
    laser.capabilities.settings,
    laser.detectedControllerKind ?? laser.activeControllerKind,
  );
  const lit = litRapidWarning(project, laser, litRapids);
  return [
    ...(lit === null ? [] : [lit]),
    ...readiness.errors.map((issue) => issue.message),
    ...readiness.warnings.map((issue) => issue.message),
  ];
}

const EXTERNAL_LASER_MODE_UNVERIFIED_START_PROMPT =
  'Controller settings cannot be fully verified.\n\n' +
  'KerfDesk could not confirm, or observed a mismatch in, the GRBL power scale ($30) or laser mode ($32=1) listed in the Run review warnings. Cancel and re-read the controller information when possible. Confirm only if you have independently checked each unverified setting.\n\n' +
  'Start this laser program anyway?';

/** The `$30`/`$32` acknowledgement for an external laser run. It cites the
 * Run review, which this path shows instead of Job Review, and leads with the
 * lit rapids when there are any. `litRapids` is the Inspector worker's scan of
 * `gcode` when there is one (ADR-630 Amendment 9). */
export function externalLaserModeStartPrompt(
  project: Project,
  laser: ExternalReadinessSource,
  gcode: string,
  litRapids?: LitRapids | null,
): string {
  const lit =
    machineKindOf(project.machine) === 'laser'
      ? litRapidWarning(project, laser, litRapids === undefined ? findLitRapids(gcode) : litRapids)
      : null;
  return lit === null
    ? EXTERNAL_LASER_MODE_UNVERIFIED_START_PROMPT
    : `${lit}\n\n${EXTERNAL_LASER_MODE_UNVERIFIED_START_PROMPT}`;
}

// Only a laser on a controller with `$` settings: Marlin and Smoothieware
// have no `$32`, and a Smoothieware G0 never fires the laser.
function litRapidWarning(
  project: Project,
  laser: ExternalReadinessSource,
  litRapids: LitRapids | null,
): string | null {
  if (litRapids === null || machineKindOf(project.machine) !== 'laser') return null;
  if (laser.capabilities.settings === 'none') return null;
  const laserMode = laser.controllerSettings?.laserModeEnabled;
  const storedReturn = storedReturnWarning(litRapids);
  if (laserMode === true) return storedReturn;
  const warning = rapidMoveWarning(litRapids, laserMode, storedReturn);
  return storedReturn === null ? warning : `${warning} ${storedReturn}`;
}

function rapidMoveWarning(
  litRapids: LitRapids,
  laserMode: boolean | undefined,
  storedReturn: string | null,
): string {
  const one = litRapids.count === 1;
  const moves = `${one ? 'One rapid command' : `${litRapids.count} rapid commands`} in this program ${one ? 'runs' : 'run'} with M3 or M4 on and S not set to 0 (first: line ${litRapids.firstLine} of the sent program)`;
  const burns = one
    ? 'it burns a line where the head travels'
    : 'each burns a line where the head travels';
  const darkness =
    storedReturn === null
      ? `Laser mode on, or S0 on ${one ? 'that move' : 'those moves'}, keeps ${one ? 'it' : 'them'} dark.`
      : 'Send S0 or M5 before these commands to switch the beam off.';
  return laserMode === false
    ? `The controller reports $32=0 (laser mode off), so it keeps the beam on during rapid moves. ${moves}: ${burns}. ${darkness}`
    : `Laser mode ($32) is not confirmed. ${moves}. If laser mode is off ($32=0), ${burns}.`;
}

function storedReturnWarning(litRapids: LitRapids): string | null {
  const returns = litRapids.storedPositionReturns;
  if (returns === undefined) return null;
  const one = returns.count === 1;
  return `${one ? 'One' : returns.count} G28/G30 stored-position return ${one ? 'command runs' : 'commands run'} with M3 or M4 on and S not set to 0 (first: line ${returns.firstLine} of the sent program). These returns retain the preceding motion mode, so do not rely on $32 alone to switch the beam off. Send S0 or M5 before the return.`;
}
