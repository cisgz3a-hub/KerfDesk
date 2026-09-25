// Whether the laser GRBL emitter may write G2/G3 arcs for this machine
// (ADR-407). Arcs are native motion on the GRBL family: GRBL 1.1, grblHAL and
// FluidNC all execute G2/G3 in the XY plane with I/J offsets. Anything else,
// a profile that names no controller, a vendor command set whose firmware
// build is not established, the qualified 4040-safe dialect (its tangential
// contour entries follow the first chord) and an enabled rotary (its Y scale
// turns circles into ellipses) keeps G1 lines. The operator can switch arcs
// off per machine.

import type { DeviceProfile } from './device-profile';
import { resolveGrblDialect } from './gcode-dialects';

export type LaserArcMoveDevice = Pick<
  DeviceProfile,
  'laserArcMoves' | 'controllerKind' | 'controllerCommandSet' | 'gcodeDialect' | 'rotary'
>;

/** Whether the controller family is known to execute G2/G3 arcs. */
export function controllerAcceptsLaserArcs(device: LaserArcMoveDevice): boolean {
  const kind = device.controllerKind;
  if (kind !== 'grbl-v1.1' && kind !== 'grblhal' && kind !== 'fluidnc') return false;
  if (device.controllerCommandSet !== undefined) return false;
  try {
    return resolveGrblDialect(device).id !== 'neotronics-4040-safe';
  } catch {
    // An unknown dialect id is not a known arc-capable output.
    return false;
  }
}

export function laserArcMovesEnabled(device: LaserArcMoveDevice): boolean {
  if (device.laserArcMoves === 'off') return false;
  if (device.rotary?.enabled === true) return false;
  return controllerAcceptsLaserArcs(device);
}
