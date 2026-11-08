// Machine Setup's Save switches the live connection to the saved profile's
// driver (UX audit U2-P2-1). Connect binds the driver, and a beginner usually
// connects before choosing the machine, so without this a Falcon A1 Pro saved
// on a stock GRBL session homes with $H and jogs with $J=. The switch is the
// same reconnect as step 1's "Reconnect using selected profile": closing and
// reopening the port sends no motion. It runs only while nothing is moving or
// owed; otherwise Save says why and the toolbar offers Reconnect now.

import type { PlatformAdapter } from '../../../platform/types';
import { connectOptionsForDevice } from '../../commands/connect-options';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import {
  driverCommandsName,
  liveDriverMismatch,
  type LiveDriverMismatch,
} from '../live-driver-mismatch';
import { reconnectJobBlocker } from '../reconnect-job-guard';

type LaserState = ReturnType<typeof useLaserStore.getState>;

export type SaveDriverSwitch =
  | { readonly kind: 'not-needed' }
  | { readonly kind: 'reconnected'; readonly mismatch: LiveDriverMismatch }
  | { readonly kind: 'deferred'; readonly mismatch: LiveDriverMismatch; readonly reason: string }
  | { readonly kind: 'failed'; readonly mismatch: LiveDriverMismatch };

// Idle and Alarm are at rest. No report at all is a firmware the old driver
// cannot parse (a Marlin board on the GRBL driver): with no job and no motion
// or command of KerfDesk's own in flight, nothing KerfDesk sent is moving it.
const AT_REST_STATES: ReadonlySet<string> = new Set(['Idle', 'Alarm']);

/**
 * Why Save cannot switch the driver now, or `null` when the reconnect is safe.
 * @param laser The live controller state.
 * @param hasPlatform Whether a platform adapter is available to reopen the port.
 */
export function saveDriverSwitchBlocker(
  laser: Pick<
    LaserState,
    | 'streamer'
    | 'motionOperation'
    | 'controllerOperation'
    | 'statusReport'
    | 'lastConnectionTransport'
  >,
  hasPlatform: boolean,
): string | null {
  if (!hasPlatform) return 'this window cannot reopen the port';
  if (laser.lastConnectionTransport === 'tcp') {
    return 'a network connection reopens only from its own Connect';
  }
  const job = reconnectJobBlocker(laser.streamer);
  if (job !== null) return job;
  if (laser.motionOperation !== null) return 'the machine is moving';
  if (laser.controllerOperation !== null) return 'a controller command is still running';
  const state = laser.statusReport?.state ?? null;
  if (state !== null && !AT_REST_STATES.has(state)) return `the controller reports ${state}`;
  return null;
}

/**
 * After Save: reconnect with the saved profile when the live driver differs and
 * the reconnect is safe, and tell the operator what happened.
 * @param platform The adapter Connect opens the port with, or `null` in a host without one.
 */
export async function switchDriverAfterSave(
  platform: PlatformAdapter | null,
): Promise<SaveDriverSwitch> {
  const laser = useLaserStore.getState();
  const device = useStore.getState().project.device;
  const mismatch = liveDriverMismatch(device, {
    connected: laser.connection.kind === 'connected',
    activeControllerKind: laser.activeControllerKind,
    activeControllerCommandSet: laser.activeControllerCommandSet,
  });
  if (mismatch === null) return { kind: 'not-needed' };
  const pushToast = useToastStore.getState().pushToast;
  const reason = saveDriverSwitchBlocker(laser, platform !== null);
  if (reason !== null || platform === null) {
    pushToast(
      `Machine Setup saved. KerfDesk is still connected with ${driverCommandsName(mismatch.live)} ` +
        `because ${reason ?? 'the port cannot be reopened here'}, so Home, jog and Frame use them. ` +
        `Press Reconnect now in the machine toolbar to use ${driverCommandsName(mismatch.profile)}.`,
      'warning',
    );
    return { kind: 'deferred', mismatch, reason: reason ?? '' };
  }
  try {
    await laser.disconnect();
    await laser.connect(platform, connectOptionsForDevice(device));
  } catch {
    // Connect reports its own failure; the check below reads the outcome.
  }
  if (useLaserStore.getState().connection.kind !== 'connected') {
    pushToast(
      `Machine Setup saved, but reconnecting with ${driverCommandsName(mismatch.profile)} did ` +
        'not open the port. Press Connect to try again.',
      'error',
    );
    return { kind: 'failed', mismatch };
  }
  pushToast(
    `Reconnected with ${driverCommandsName(mismatch.profile)}, as the saved machine uses.`,
    'success',
  );
  return { kind: 'reconnected', mismatch };
}
