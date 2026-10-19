import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { hasOwnedControllerReset } from './laser-reset-cleanup';
import { lostReplyProbeOutstanding, type LostReplyProbeRefs } from './laser-lost-reply-probe';

export function shouldReleaseStreamerAtIdle(
  state: Pick<LaserState, 'streamer' | 'controllerOperation'>,
  report: StatusReport,
  refs: LostReplyProbeRefs = {},
): boolean {
  const { streamer, controllerOperation } = state;
  if (streamer === null || report.state !== 'Idle') return false;
  if (hasOwnedControllerReset(controllerOperation)) return false;
  if (streamer.status === 'errored') return true;
  // A finished job whose lost-reply probe is still out waits for its reply,
  // then the ordinary settle releases it (ADR-610 Amendment 1).
  if (lostReplyProbeOutstanding(refs)) return false;
  return streamer.status === 'done' && controllerOperation === null;
}
