import type { ControllerDriver } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { controllerOperationOwnsPolling } from './laser-status-polling-policy';
import type { TranscriptSource } from './laser-transcript';

type StatusRequestWrite = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;

// One realtime status query outside the periodic poll. Frame issues it right
// after the owned G54 selection so its fresh-position wait resolves in one
// round trip; waiting for the next scheduled query instead cost up to a full
// idle-poll period (~1 s) on every Frame that had to select G54. The query is
// inert to the planner and owes no acknowledgement. `complete` asks for every
// report field at once where the driver can (grblHAL 0x87), so a caller
// waiting for WCO need not wait out GRBL's refresh count (ADR-672).
export function statusRequestActions(
  get: () => LaserState,
  refs: { readonly driver: ControllerDriver },
  write: StatusRequestWrite,
): Pick<LaserState, 'requestControllerStatus'> {
  return {
    requestControllerStatus: async (options) => {
      const complete = options?.complete === true ? refs.driver.realtime.completeStatusQuery : null;
      const query = complete ?? refs.driver.realtime.statusQuery;
      if (query === null || controllerOperationOwnsPolling(get())) return;
      try {
        await write(query, undefined, 'system');
      } catch {
        // The periodic poll is still running; a failed query is not a refusal.
      }
    },
  };
}

/** Sends the driver's complete-report request once, where it has one. grblHAL
 * answers 0x87 with every report field, so WCO arrives now instead of after up
 * to ten idle reports (protocol audit P-4, ADR-672). Inert to the planner and
 * owes no acknowledgement; a failed write leaves the ordinary poll running. */
export async function sendCompleteStatusRequest(
  driver: ControllerDriver,
  write: StatusRequestWrite,
): Promise<void> {
  const query = driver.realtime.completeStatusQuery;
  if (query == null) return;
  try {
    await write(query, undefined, 'system');
  } catch {
    // The offset then arrives on the controller's own report count.
  }
}
