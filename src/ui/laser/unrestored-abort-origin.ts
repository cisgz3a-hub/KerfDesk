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
// the offer names it and the head's distance from it, and its Restore origin
// button puts the saved origin back (an in-app question since ADR-707). Set
// origin here stays in the Machine panel, and the offer says so.
//
// The saved origin is in machine coordinates, and a power-up or the reset a
// board does when its port opens re-zeroes those on a machine without homing
// (rolling audit v12 X1-P1-1, ADR-341 Amendment 13). After either, OK writing
// it put the re-run as far off as the head had been from machine zero. So once
// machine zero may have moved: with homing the offer homes first and says why;
// without homing it restores nothing, and the plain offer to set the origin at
// the head says the saved one can no longer be put back.
//
// On a Y-port rotary, machine Y turns the part instead of moving the head
// (ADR-127 Amendment 1), so the offer names that offset as degrees of turn
// and warns that a part on rollers may have slipped (rolling audit v12
// X8-P3-2). The restore itself is unchanged: machine Y counts rotation.

import { rotaryWrapLimitMm } from '../../core/job';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import { useStore } from '../state';
import { currentJobStopRequest } from '../state/job-stop-request';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { withheldControllerMPos } from '../state/laser-status-position';
import { useToastStore } from '../state/toast-store';
import { restoreAbortOriginFromIdle } from './abort-alarm-recovery';
import { formatRotaryTurn, rotaryStartTurnStale, rotaryTurnSinceStart } from './abort-rotary-turn';
import type { RotaryStartTurn } from '../state/job-stop-request';
import { formatOriginMm } from './laser-recovery-origin';
import { askMachineOffer } from './machine-offer';
import { repairFailed, type BlockedStartRepair } from './start-blocked-repair';

type SavedMm = { readonly x: number; readonly y: number };

/** An active rotary: machine Y mm per turn of the part, and whether it rides
 *  on rollers (which can slip). */
export type AbortOriginRotary = { readonly turnMm: number; readonly roller: boolean };

export type UnrestoredAbortOrigin = {
  readonly saved: SavedMm;
  /** Machine zero may have moved since the Abort read the origin. */
  readonly machineZeroMoved: boolean;
  /** A dedicated-axis rotary's start turn (ADR-695 Amendment 1). */
  readonly turn?: RotaryStartTurn;
};

/** The origin the operator's Abort recorded for the current stream, or null.
 *  Frame asks only while no origin is set, so a recorded one is unrestored. */
export function unrestoredAbortOrigin(
  state: Pick<LaserState, 'jobStopRequest' | 'streamerEpoch' | 'machineZeroEpoch'>,
): UnrestoredAbortOrigin | null {
  const request = currentJobStopRequest(state);
  if (request?.reason !== 'operator' || request.originAtStopMm === undefined) return null;
  return {
    saved: request.originAtStopMm,
    machineZeroMoved: request.originMachineZeroEpoch !== (state.machineZeroEpoch ?? 0),
    ...(request.rotaryStartTurn === undefined ? {} : { turn: request.rotaryStartTurn }),
  };
}

/** Whether putting the saved origin back homes first: the profile has homing
 *  and the controller homes from an alarm, as the Abort card decides. */
export function abortRestoreHomesFirst(): boolean {
  return (
    useStore.getState().project.device.homing.enabled &&
    useLaserStore.getState().capabilities.homeFromAlarm !== false
  );
}

/** Said before the plain set-origin offer when machine zero may have moved on
 *  a machine without homing, so the saved origin cannot be put back. */
export function restartedOriginNote(saved: SavedMm): string {
  return (
    `The job you stopped ran from ${originWhere(saved)}, but the controller has restarted ` +
    'since then, and without homing its machine zero may have moved, so that origin cannot ' +
    'be put back. Move the head to where the job should start first.'
  );
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

export const RESTORE_ORIGIN_OFFER_TITLE = 'Restore the saved origin?';

/** The offer's button: it says when the machine homes first. */
export function restoreOriginOfferButton(homeFirst: boolean): string {
  return homeFirst ? 'Home and restore origin' : 'Restore origin';
}

/** The offer's text: the saved origin, the head's distance from it (or, when
 *  machine zero may have moved, why Home comes first), and what its button does. */
export function unrestoredOriginOfferPrompt(
  placement: 'User Origin' | 'Verified Origin',
  saved: SavedMm,
  headOffset: SavedMm | null,
  homeFirst: boolean,
  machineZeroMoved = false,
  rotary: AbortOriginRotary | null = null,
): string {
  const where = originWhere(saved);
  const distance = machineZeroMoved
    ? 'The controller has restarted since then, so its machine zero may have moved: Home ' +
      'measures it again before the origin goes back.'
    : headOffset === null
      ? 'KerfDesk cannot tell how far the head is from it.'
      : rotary === null
        ? `The head is ${formatOriginMm(Math.hypot(headOffset.x, headOffset.y))} mm from it ` +
          `(X ${signedMm(headOffset.x)}, Y ${signedMm(headOffset.y)} mm).`
        : rotaryOffsetText(headOffset, rotary);
  const button = restoreOriginOfferButton(homeFirst);
  const action = homeFirst
    ? `"${button}" homes the machine (the head moves to its home switches), then puts the saved ` +
      'origin back, and Frame goes on from it.'
    : `"${button}" puts the saved origin back with one G92 (the head does not move), and Frame ` +
      'goes on from it.';
  return (
    `${placement} needs a custom work origin. The job you stopped ran from ${where}, and that ` +
    `origin was not restored. ${distance}\n\n` +
    `${action}\n\n` +
    'To run from where the head is now instead, cancel and use Set origin here in the Machine ' +
    'panel.'
  );
}

/** The Frame offer while the aborted job's origin is unrestored: OK restores it.
 *  The caller makes it only while machine zero is unmoved or the restore homes. */
export async function offerRestoreAbortOrigin(
  placement: 'User Origin' | 'Verified Origin',
  { saved, machineZeroMoved, turn }: UnrestoredAbortOrigin,
): Promise<BlockedStartRepair> {
  const homeFirst = abortRestoreHomesFirst();
  const prompt =
    unrestoredOriginOfferPrompt(
      placement,
      saved,
      headOffsetFromSavedMm(useLaserStore.getState(), saved),
      homeFirst,
      machineZeroMoved,
      activeAbortOriginRotary(),
    ) + abortTurnOfferNote(turn, restoreOriginOfferButton(homeFirst));
  const accepted = await askMachineOffer(
    {
      title: RESTORE_ORIGIN_OFFER_TITLE,
      message: prompt,
      confirmLabel: restoreOriginOfferButton(homeFirst),
    },
    // Still the same stopped job's origin, still not put back.
    (now) => {
      const standing = unrestoredAbortOrigin(now);
      return (
        standing !== null &&
        standing.saved.x === saved.x &&
        standing.saved.y === saved.y &&
        standing.machineZeroMoved === machineZeroMoved &&
        abortRestoreHomesFirst() === homeFirst
      );
    },
  );
  if (!accepted) return 'unrepaired';
  try {
    await (turn === undefined
      ? restoreAbortOriginFromIdle(saved, homeFirst)
      : restoreAbortOriginFromIdle(saved, homeFirst, turn));
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

/** ADR-695 Amendment 1: on an A or Z rotary, how far the part has turned since
 *  the stopped job started, and that the offer's button turns it back. Called
 *  with the turn alone, as before ADR-707, it names the button the offer shows
 *  on this machine. */
export function abortTurnOfferNote(
  turn: RotaryStartTurn | undefined,
  button: string = restoreOriginOfferButton(abortRestoreHomesFirst()),
): string {
  if (turn === undefined) return '';
  if (rotaryStartTurnStale(useLaserStore.getState(), turn)) {
    return (
      '\n\nOn the rotary, the controller has restarted since the job you stopped, so KerfDesk ' +
      `no longer knows the turn it started from. "${button}" does not turn the part: turn it ` +
      'back to where that job started by hand, or set it up again.'
    );
  }
  const since = rotaryTurnSinceStart(useLaserStore.getState(), turn);
  const how =
    since === null
      ? `KerfDesk cannot read the rotary's ${turn.axis} axis right now`
      : `the part has turned ${formatRotaryTurn(turn.axis, since)} since the job started`;
  return `

On the rotary, ${how}. "${button}" also turns it back to where the job started.`;
}

/** The project's active rotary, or null on a flat bed or a CNC. */
export function activeAbortOriginRotary(): AbortOriginRotary | null {
  const { device, machine } = useStore.getState().project;
  // On A or Z (ADR-695) machine Y is the head again; the turn is not in Y.
  if (rotaryOutputAxis(device, machine) !== null) return null;
  const turnMm = rotaryWrapLimitMm(device, machine);
  if (turnMm === null || !(turnMm > 0)) return null;
  return { turnMm, roller: device.rotary?.type === 'roller' };
}

// X8-P3-2: X is still the head; Y is how far the part has turned.
function rotaryOffsetText(headOffset: SavedMm, rotary: AbortOriginRotary): string {
  const degrees = (360 * headOffset.y) / rotary.turnMm;
  const turned =
    Math.abs(degrees) < 0.5
      ? 'the part is at the same turn'
      : `the part has turned ${signedDegrees(degrees)} since (${signedMm(headOffset.y)} machine mm of Y)`;
  const slip = rotary.roller
    ? ' A part on rollers may also have slipped, so check where the seam is before you run.'
    : '';
  return `The head is ${signedMm(headOffset.x)} mm from it in X, and ${turned}.${slip}`;
}

function signedDegrees(value: number): string {
  const text = String(Math.round(Math.abs(value)));
  return `${value < 0 ? '−' : '+'}${text}°`;
}

function originWhere(saved: SavedMm): string {
  return `X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from machine zero`;
}

function signedMm(value: number): string {
  const text = formatOriginMm(Math.abs(value));
  return text === '0' ? '0' : `${value < 0 ? '−' : '+'}${text}`;
}
