// Operator text for the Lihuiyu USB link (ADR-703).

import { lhyStatusName } from '../../../core/controllers/lihuiyu/lhy-packet';
import type { LhyLinkFailure } from '../../../core/controllers/lihuiyu/lhy-link';

export const LIHUIYU_NOT_QUALIFIED =
  'Experimental: simulator-tested only, NOT qualified on hardware. Keep a hand on the machine’s power switch and air-cut on scrap first.';

export const LIHUIYU_FRAME_FIRST =
  'Frame this job first: Start runs only the footprint a completed Frame on this connection traced.';

export const LIHUIYU_HOME_FIRST =
  'Home the machine first. The board reports no position, so the link knows where the head is only after Home on this connection.';

export const LIHUIYU_HEAD_MOVED =
  'The head moved since this job was prepared. Press the button again to prepare it from where the head is now.';

export function lihuiyuStatusText(code: number | null): string {
  return code === null ? 'unknown' : lhyStatusName(code);
}

export function lihuiyuFailureText(failure: LhyLinkFailure): string {
  switch (failure) {
    case 'cancelled':
      return 'Sending was cancelled.';
    case 'no-status':
      return 'The board stopped answering status reads.';
    case 'rejected':
      return 'The board rejected the same packet five times (checksum errors).';
  }
}

export function lihuiyuResetOutcome(ok: boolean): string {
  return ok
    ? 'The board acknowledged the reset; the head stopped where it was. Home before the next Absolute job.'
    : 'The reset was not acknowledged: stop the machine with its power switch.';
}

export function lihuiyuLinkLost(reason: string, active: boolean): string {
  const job = active
    ? ' A job the board already holds may keep running without the link — stop the machine with its power switch if needed.'
    : '';
  return `The USB link to the board closed: ${reason}.${job}`;
}
