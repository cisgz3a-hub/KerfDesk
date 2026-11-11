// Why a machine-rail control is switched off, in the store's own words
// (annoyance audit A3-P3-4). A disabled Home, jog arrow or Set origin here used
// to keep its ordinary tooltip, so hovering it said what the button does and
// not why it would not. These read the same messages the store throws when the
// action is refused; the store stays the authority and re-checks every action.

import { CONTROLLER_OPERATION_ACTIVE_MESSAGE } from '../state/laser-controller-operation';
import type { LaserState } from '../state/laser-store';
import {
  AUTOFOCUS_BUSY_MESSAGE,
  CONNECT_MACHINE_FIRST,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  jogFrameCommandBlockMessage,
  setupCommandBlockMessage,
} from '../state/laser-store-helpers';

function notReadyReason(state: LaserState): string | null {
  if (state.connection.kind !== 'connected') return CONNECT_MACHINE_FIRST;
  return state.autofocusBusy ? AUTOFOCUS_BUSY_MESSAGE : null;
}

/** Home, Auto-focus, Set origin here and Review recovery: off while the
 *  machine is not connected or a job, jog, Frame or controller operation runs. */
export function setupControlBlockReason(state: LaserState): string | null {
  return notReadyReason(state) ?? setupCommandBlockMessage(state);
}

/** The jog arrows: everything above, and the machine must report Idle. */
export function jogPadBlockReason(state: LaserState): string | null {
  return notReadyReason(state) ?? jogFrameCommandBlockMessage(state);
}

/** Disconnect and Connect: off only while a jog, Frame or controller operation
 *  holds the link (`connectionControlsBusy`). */
export function connectionControlBlockReason(motionOperation: unknown): string {
  return motionOperation !== null
    ? MOTION_OPERATION_ACTIVE_MESSAGE
    : CONTROLLER_OPERATION_ACTIVE_MESSAGE;
}

/** A disabled control explains itself; an enabled one says what it does. */
export function titleWhenDisabled(disabled: boolean, reason: string | null, title: string): string {
  return disabled && reason !== null ? reason : title;
}
