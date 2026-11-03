// The connection's driver against the saved profile's (UX audit U2-P2-1).
// Connect binds the driver from the profile, and saving a profile while
// connected does not rebind it, so Home, jog and Frame keep the old commands
// until a reconnect. Machine Setup's Save reconnects when it is safe
// (save-driver-switch.ts); these words say so where the operator looks: Review,
// the toolbar's machine name and its Reconnect now notice.

import { selectControllerDriver, type ControllerDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import type { LiveControllerIdentity } from './controller-identity-warnings';

export type LiveDriverMismatch = {
  /** The driver the live connection uses. */
  readonly live: ControllerDriver;
  /** The driver the profile asks Connect for. */
  readonly profile: ControllerDriver;
};

export type LiveDriverSession = Pick<
  LiveControllerIdentity,
  'activeControllerKind' | 'activeControllerCommandSet'
> & { readonly connected: boolean };

/**
 * The live connection's driver when it is not the one the profile selects.
 * @param profile Controller fields of the saved profile or Machine Setup draft.
 * @param session The live connection's bound driver.
 * @returns Both drivers, or `null` when disconnected or matching.
 */
export function liveDriverMismatch(
  profile: Pick<DeviceProfile, 'controllerKind' | 'controllerCommandSet'>,
  session: LiveDriverSession,
): LiveDriverMismatch | null {
  if (!session.connected) return null;
  const wanted = selectControllerDriver(profile.controllerKind, profile.controllerCommandSet);
  const live = selectControllerDriver(
    session.activeControllerKind,
    session.activeControllerCommandSet ?? undefined,
  );
  if (wanted.kind === live.kind && (wanted.commandSet ?? null) === (live.commandSet ?? null)) {
    return null;
  }
  return { live, profile: wanted };
}

/** "the generic grblHAL commands", or a vendor contract's own label. */
export function driverCommandsName(driver: ControllerDriver): string {
  return driver.commandSet === undefined
    ? `the generic ${driver.label} commands`
    : `the ${driver.label}`;
}

/**
 * Review's line while the draft needs another driver: Save reconnects, so
 * the setup is not called "internally consistent" with a stale driver live.
 */
export function reviewDriverSwitchText(mismatch: LiveDriverMismatch): string {
  return (
    `You are connected with ${driverCommandsName(mismatch.live)}, but this setup uses ` +
    `${driverCommandsName(mismatch.profile)}. Saving reconnects to use them, which does not ` +
    'run or home the machine. If the machine is busy, Save keeps the connection and the ' +
    'toolbar offers Reconnect now; until then Home, jog and Frame use the old commands.'
  );
}

/** Review's status line: the draft's issues, else a pending driver switch, else ready. */
export function reviewStatusText(
  issues: ReadonlyArray<string>,
  driverSwitch: string | null,
): string {
  if (issues.length > 0) return 'Fix the issues below, then return here to save your setup.';
  if (driverSwitch !== null) return driverSwitch;
  return 'Software configuration is internally consistent. Saving will not run or home the machine.';
}

/** The toolbar's notice beside Reconnect now. */
export function toolbarDriverMismatchText(mismatch: LiveDriverMismatch): string {
  return (
    `Connected with ${driverCommandsName(mismatch.live)}. This machine uses ` +
    `${driverCommandsName(mismatch.profile)}: Home, jog and Frame use the old ones until you ` +
    'reconnect.'
  );
}

const VENDOR_COMMAND_SET_TAG = /\s*\(vendor command set\)\s*$/i;

/**
 * The toolbar's machine name. A preset that names its vendor command set does
 * not name it while another driver is live; the live driver is named instead.
 */
export function toolbarMachineName(name: string, mismatch: LiveDriverMismatch | null): string {
  if (mismatch === null) return name;
  const base = name.replace(VENDOR_COMMAND_SET_TAG, '');
  return `${base} (connected with ${mismatch.live.label} commands)`;
}
