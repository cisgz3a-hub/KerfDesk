// Frame's origin offer while an aborted job's origin is not back (rolling
// audit v10 V3-P2-2, re-rated P1 by the V9 refuter; ADR-341 Amendment 12).
//
// After ABORT JOB the stop request keeps the origin the job ran from
// (`originAtStopMm`), and the Alarm 3 card offers it back. When that restore
// failed or was skipped, the next Frame met "User Origin needs a custom work
// origin" and offered the first-setup repair: set the origin at the head. That
// offer named neither the saved origin nor how far the head had moved, and the
// operator who had just pressed Restore accepted it; the re-run burned
// 4-10 mm off the half-burned piece. While the saved origin stands unrestored,
// the offer names it and the head's distance from it, and its OK puts the saved
// origin back. Set origin here stays in the Machine panel, named in Cancel.

import { useStore } from '../state';
import { currentJobStopRequest } from '../state/job-stop-request';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { withheldControllerMPos } from '../state/laser-status-position';
import { useToastStore } from '../state/toast-store';
import { restoreAbortOriginFromIdle } from './abort-alarm-recovery';
import { formatOriginMm } from './laser-recovery-origin';
import { repairFailed, type BlockedStartRepair } from './start-blocked-repair';

type SavedMm = { readonly x: number; readonly y: number };

/** The origin the operator's Abort recorded for the current stream, or null.
 *  Frame asks only while no origin is set, so a recorded one is unrestored. */
export function unrestoredAbortOrigin(
  state: Pick<LaserState, 'jobStopRequest' | 'streamerEpoch'>,
): SavedMm | null {
  const request = currentJobStopRequest(state);
  if (request?.reason !== 'operator') return null;
  return request.originAtStopMm ?? null;
}

/** The head minus the saved origin, in mm, or null while KerfDesk cannot
 *  tell where the head is in machine coordinates. */
export function headOffsetFromSavedMm(
  state: Pick<LaserState, 'statusReport' | 'wcoCache' | 'controllerSettings'>,
  saved: SavedMm,
): SavedMm | null {
  const reportInches = state.controllerSettings?.reportInches === true;
  const live = inferCurrentMachinePosition(state.statusReport, state.wcoCache, reportInches);
  const withheld = withheldControllerMPos(state.statusReport);
  const scale = reportInches ? 25.4 : 1;
  const head =
    live ?? (withheld === null ? null : { x: withheld.x * scale, y: withheld.y * scale });
  return head === null ? null : { x: head.x - saved.x, y: head.y - saved.y };
}

/** The offer's text: the saved origin, the head's distance from it, and what
 *  OK and Cancel do. */
export function unrestoredOriginOfferPrompt(
  placement: 'User Origin' | 'Verified Origin',
  saved: SavedMm,
  headOffset: SavedMm | null,
  homeFirst: boolean,
): string {
  const where = `X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from machine zero`;
  const distance =
    headOffset === null
      ? 'KerfDesk cannot tell how far the head is from it.'
      : `The head is ${formatOriginMm(Math.hypot(headOffset.x, headOffset.y))} mm from it ` +
        `(X ${signedMm(headOffset.x)}, Y ${signedMm(headOffset.y)} mm).`;
  const ok = homeFirst
    ? 'OK: home the machine (the head moves to its home switches), then put the saved origin ' +
      'back, and Frame the job from it.'
    : 'OK: put the saved origin back with one G92 (the head does not move), and Frame the job ' +
      'from it.';
  return (
    `${placement} needs a custom work origin. The job you stopped ran from ${where}, and that ` +
    `origin was not restored. ${distance}\n\n` +
    `${ok}\n` +
    'Cancel: leave the job blocked. To run from where the head is now instead, use Set origin ' +
    'here in the Machine panel.'
  );
}

/** The Frame offer while the aborted job's origin is unrestored: OK restores it. */
export async function offerRestoreAbortOrigin(
  placement: 'User Origin' | 'Verified Origin',
  saved: SavedMm,
): Promise<BlockedStartRepair> {
  const laser = useLaserStore.getState();
  const homeFirst =
    useStore.getState().project.device.homing.enabled && laser.capabilities.homeFromAlarm !== false;
  const prompt = unrestoredOriginOfferPrompt(
    placement,
    saved,
    headOffsetFromSavedMm(laser, saved),
    homeFirst,
  );
  if (!jobAwareConfirm(prompt)) return 'unrepaired';
  try {
    await restoreAbortOriginFromIdle(saved, homeFirst);
  } catch (cause) {
    return repairFailed('Restore saved origin failed', cause);
  }
  useToastStore
    .getState()
    .pushToast(
      `Origin restored at X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from ` +
        'machine zero.',
      'success',
    );
  return 'retry';
}

function signedMm(value: number): string {
  const text = formatOriginMm(Math.abs(value));
  return text === '0' ? '0' : `${value < 0 ? '−' : '+'}${text}`;
}
