// unowned-controller-output — a laser the controller reports on at Idle that no
// job, operation, jog, Frame or Fire here owns (rolling audit v5 J2-P2-1,
// ADR-375 Amendment 9).
//
// A Console `M3 S…`, or a G-code file that ends without `M5`, leaves the
// controller's spindle output on at Idle: GRBL sets it as soon as the planner
// empties and keeps it until M5, a reset or an alarm, and its next report says
// so with `A:S` (M3) or `A:C` (M4).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c
// The Live Motion bar, Ctrl+., the crash screen and an ordinary close offered no
// way off, while the update close already counted that report as busy. A CNC
// spindle keeps its own Stop spindle & coolant, which asks first because the
// cutter may be in the work (AccessoryResetControls), so this is laser only.

import type { StatusReport } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

type Accessories = NonNullable<StatusReport['accessories']>;

/** The laser on, alone or with air assist. A string, so a store selector stays stable. */
export type UnownedControllerOutput = 'laser' | 'laser-and-air';

type OutputEvidence = Pick<
  LaserState,
  | 'connection'
  | 'streamer'
  | 'controllerOperation'
  | 'motionOperation'
  | 'fireActive'
  | 'statusReport'
  | 'accessoryCache'
>;

/** GRBL omits A:/Ov: between accessory observations. The canonical cache also
 *  retains grblHAL tool-change/secondary-spindle evidence. */
export function reportedAccessories(
  state: Pick<LaserState, 'accessoryCache' | 'statusReport'>,
): Accessories | null {
  return state.accessoryCache ?? state.statusReport?.accessories ?? null;
}

/** The output the controller reports on at Idle when nothing here owns it, or null. */
export function unownedControllerOutput(
  state: OutputEvidence,
  machineKind: MachineKind,
): UnownedControllerOutput | null {
  if (machineKind !== 'laser' || state.connection.kind !== 'connected') return null;
  if (state.statusReport?.state !== 'Idle' || hasOutputOwner(state)) return null;
  const accessories = reportedAccessories(state);
  // With a second grblHAL spindle the one reported on may not be the one M5
  // turns off; Stop spindle & coolant stays hidden for the same reason.
  if (accessories === null || accessories.secondarySpindlePresent === true) return null;
  if (!accessories.spindleCw && !accessories.spindleCcw) return null;
  return accessories.flood || accessories.mist ? 'laser-and-air' : 'laser';
}

/** One block, as Stop spindle & coolant sends. M5/M9 are the Console's fail-off
 *  sequence, so they need no fresh status round trip first. */
export function outputOffCommand(output: UnownedControllerOutput): string {
  return output === 'laser-and-air' ? 'M5 M9' : 'M5';
}

/** Sends the off block for the output reported now; a no-op once nothing is. */
export function turnUnownedOutputOff(
  laser: Pick<LaserState, 'sendConsoleCommand'> & OutputEvidence,
  machineKind: MachineKind,
): Promise<void> {
  const output = unownedControllerOutput(laser, machineKind);
  return output === null ? Promise.resolve() : laser.sendConsoleCommand(outputOffCommand(output));
}

// The Live Motion bar's owners, which carry their own stop.
function hasOutputOwner(state: OutputEvidence): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.controllerOperation !== null ||
    state.motionOperation !== null ||
    state.fireActive
  );
}
