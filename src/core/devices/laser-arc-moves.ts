// Whether the laser GRBL emitter may write G2/G3 arcs for this machine
// (ADR-432). Arcs are native motion on the GRBL family: GRBL 1.1, grblHAL and
// FluidNC all execute G2/G3 in the XY plane with I/J offsets. A profile that
// names no controller, any other controller, a vendor command set and the
// qualified 4040-safe dialect (its tangential contour entries follow the first
// chord) never get arcs; nor does an enabled rotary (its Y scale turns circles
// into ellipses).
//
// Naming the family is not the same as knowing the firmware. Arcs are on by
// default only for a firmware-family profile: one whose vendor is unnamed or
// 'Generic' (the generic GRBL, grblHAL and FluidNC starters, and machines the
// operator describes by controller alone) on a stock output dialect. A brand
// machine profile (xTool, Sculpfun, Ortur, the Falcon-compatible fallback) runs
// its vendor's firmware build, which the catalogue does not establish, and the
// 'grbl-compatible' dialect is the escape hatch for older firmware; both keep
// G1 lines unless the operator turns arcs on. The operator's 'on' or 'off'
// wins wherever the controller family accepts arcs.

import type { DeviceProfile } from './device-profile';
import { resolveGrblDialect } from './gcode-dialects';

export type LaserArcMoveDevice = Pick<
  DeviceProfile,
  'laserArcMoves' | 'controllerKind' | 'controllerCommandSet' | 'gcodeDialect' | 'rotary' | 'vendor'
>;

/** Whether the controller family is known to execute G2/G3 arcs. */
export function controllerAcceptsLaserArcs(device: LaserArcMoveDevice): boolean {
  const kind = device.controllerKind;
  if (kind !== 'grbl-v1.1' && kind !== 'grblhal' && kind !== 'fluidnc') return false;
  if (device.controllerCommandSet !== undefined) return false;
  const dialect = dialectId(device);
  return dialect !== null && dialect !== 'neotronics-4040-safe';
}

/** Whether arcs are on for this machine while the operator has not chosen. */
export function laserArcMovesDefaultOn(device: LaserArcMoveDevice): boolean {
  if (!controllerAcceptsLaserArcs(device)) return false;
  if (device.vendor !== undefined && device.vendor !== 'Generic') return false;
  return dialectId(device) !== 'grbl-compatible';
}

export function laserArcMovesEnabled(device: LaserArcMoveDevice): boolean {
  if (device.rotary?.enabled === true) return false;
  if (!controllerAcceptsLaserArcs(device)) return false;
  if (device.laserArcMoves === 'off') return false;
  if (device.laserArcMoves === 'on') return true;
  return laserArcMovesDefaultOn(device);
}

/** A loaded profile's `laserArcMoves`: an explicit 'on' or 'off' survives;
 * anything else is omitted, which reads as the profile's default. */
export function laserArcMovesEntry(value: unknown): Pick<DeviceProfile, 'laserArcMoves'> {
  return value === 'on' || value === 'off' ? { laserArcMoves: value } : {};
}

function dialectId(device: LaserArcMoveDevice): string | null {
  try {
    return resolveGrblDialect(device).id;
  } catch {
    // An unknown dialect id is not a known arc-capable output.
    return null;
  }
}
