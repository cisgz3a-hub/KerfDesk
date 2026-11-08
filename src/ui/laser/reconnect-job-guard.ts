// The reconnects that only swap the driver refuse while a job is active
// (rolling audit v10 V3-P2-1, ADR-637 Amendment 8).
//
// Closing a GRBL-family port soft-resets the controller first
// (laser-disconnect-stop.ts), and that reset ends a running or paused job.
// Machine Setup's Save already refused the driver switch then ("a job is
// running"), but the toolbar's Reconnect now, which Save offers when it cannot
// switch, and step 1's Reconnect using selected profile did not: the toolbar
// button stayed enabled mid-burn with a hover saying "Nothing moves". The
// operator's own Disconnect and "Use a different port…" stay unguarded: they
// are the way to end a session on purpose (controller reconnect audit
// 2026-10-16) and promise nothing about the job.

import type { PlatformAdapter } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useStore } from '../state';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

/** Save's own reason, so every reconnect route names the job the same way. */
export const RECONNECT_JOB_RUNNING_REASON = 'a job is running';

/** The hover a reconnect button shows while it is disabled for a job. */
export const RECONNECT_DURING_JOB_TITLE =
  'Not while a job is running: reconnecting resets the controller, which would end the job. ' +
  'Let the job finish or stop it, then reconnect.';

/** Why a driver-swapping reconnect cannot run now, or `null` when no job holds it. */
export function reconnectJobBlocker(streamer: LaserState['streamer']): string | null {
  return isActiveJob(streamer) ? RECONNECT_JOB_RUNNING_REASON : null;
}

/** Throws the refusal when a job is active; reads the live store, not a render. */
export function assertReconnectAllowed(): void {
  if (reconnectJobBlocker(useLaserStore.getState().streamer) === null) return;
  throw new Error(
    `Reconnect waits because ${RECONNECT_JOB_RUNNING_REASON}. Reconnecting resets the ` +
      'controller, which would end the job. Let it finish or stop it first.',
  );
}

/**
 * The toolbar's Reconnect now: reopen the remembered port with the saved
 * profile's driver, the same reconnect as Machine Setup's (U2-P2-1).
 * @param platform The adapter Connect opens the port with.
 */
export async function reconnectWithSavedProfile(platform: PlatformAdapter): Promise<void> {
  assertReconnectAllowed();
  const laser = useLaserStore.getState();
  await laser.disconnect();
  await laser.connect(platform, connectOptionsForDevice(useStore.getState().project.device));
}
