// Operator-facing text for the galvo USB link (ADR-704).

import type { LmcListState } from '../../../core/controllers/jcz/lmc-link';
import type { LmcRunResult } from '../../../core/controllers/jcz/lmc-run';

export const GALVO_NOT_QUALIFIED =
  'Experimental: this galvo link is simulator-tested only and not qualified on a real JCZ board. Frame first, test on scrap at low power, and keep a hand on the machine’s emergency stop.';

export const GALVO_FRAME_FIRST =
  'Frame this job with the red pointer first: Start runs only the footprint the last completed Frame traced.';

export const GALVO_STATUS_SILENT =
  'The board stopped answering status reads. It may still be marking — check the machine.';

export function galvoListStateText(state: LmcListState | null): string {
  switch (state) {
    case null:
      return 'unknown';
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'idle':
      return 'idle';
  }
}

export function galvoRunFailureText(
  result: Extract<LmcRunResult, { readonly ok: false }>,
  linkFailure: string | null,
): string {
  switch (result.failure) {
    case 'cancelled':
      return 'Sending was cancelled.';
    case 'not-ready':
      return 'The board never reported Ready for the next list.';
    case 'link':
      return linkFailure ?? 'The USB exchange failed.';
  }
}

export function galvoStopOutcome(acknowledged: boolean): string {
  return acknowledged
    ? 'Stop Execute acknowledged: the board stopped marking.'
    : 'Stop Execute was not acknowledged. Use the machine’s emergency stop or key switch now.';
}
