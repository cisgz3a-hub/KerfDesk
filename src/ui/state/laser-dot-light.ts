// The Falcon A1 Pro's LED is its own laser at capped low power (ADR-664).
//
// Its 20 W head has no separate pointer: Creality's software shows where it
// will burn with a "Laser on" button that fires the beam at 1-10% and turns it
// off after 30 s. KerfDesk requests off with a host timer through the ordinary
// positioning-light transaction, with Fire's command, cap and power-override
// baseline. While the dot is lit it holds the Fire latch (`fireActive`), so
// jog, Frame, Start, the Console and overrides refuse, Disconnect and closing
// the window send M5, and the Live Motion bar offers LASER OFF.

import { profileSupportsCapability, type DeviceProfile } from '../../core/devices';
import { isLaserDotLight, laserDotModuleIssue } from '../../core/devices/positioning-light';
import type { LaserDotLight } from '../../core/devices/positioning-light';
import { laserFireRefusal } from '../../core/preflight/laser-module-readiness';
import { machineKindOf } from '../../core/scene';
import { fireOnCommand } from './laser-fire-actions';
import { currentFirePowerS } from './laser-fire-power';
import { connectedLaserModuleEvidence } from './laser-module-probe';
import type { LaserState } from './laser-store';
import { useStore } from './store';

/** Why the dot cannot go on now, or null. Checked before the transaction
 * takes the controller, and again by the device snapshot it captures. */
export function laserDotRefusal(state: LaserState, device: DeviceProfile): string | null {
  if (machineKindOf(useStore.getState().project.machine) !== 'laser')
    return 'The laser dot is unavailable for CNC projects.';
  if (!state.capabilities.lowPowerFire)
    return 'The connected controller cannot switch the laser on at low power.';
  if (!profileSupportsCapability(device, 'low-power-fire'))
    return 'The active machine profile is not approved for low-power laser output.';
  return laserFireRefusal(connectedLaserModuleEvidence(state)) ?? laserDotModuleIssue(device);
}

/** The capped beam-on line for the dot: Fire's `G1 F… M3 S…`, which lights a
 * GRBL laser without moving it. Throws when the cap leaves no positive S. */
export function laserDotOnLine(state: LaserState, light: LaserDotLight): string {
  const device = useStore.getState().project.device;
  const control = { enabled: true, maxPowerPercent: light.powerPercent };
  const powerS = currentFirePowerS(state, control, device.maxPowerS, light.powerPercent);
  if (powerS <= 0) throw new Error('Laser dot power must resolve to a positive S value.');
  return fireOnCommand(powerS, device.framingFeedMmPerMin).trim();
}

/** Whether the Fire latch is the laser dot's, lit by LED on, rather than a
 * held momentary Fire. */
export function laserDotLit(state: Pick<LaserState, 'fireActive' | 'positioningLightEnabled'>) {
  return (
    state.fireActive &&
    state.positioningLightEnabled &&
    isLaserDotLight(useStore.getState().project.device.positioningLight)
  );
}

/** The state the LED controls are judged on: the dot's own Fire latch does not
 * block switching it off, or moving it with the beam off first. */
export function withoutLaserDotLatch<
  T extends Pick<LaserState, 'fireActive' | 'positioningLightEnabled'>,
>(state: T): T {
  return laserDotLit(state) ? { ...state, fireActive: false } : state;
}
