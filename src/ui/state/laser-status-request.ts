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
// inert to the planner and owes no acknowledgement.
export function statusRequestActions(
  get: () => LaserState,
  refs: { readonly driver: ControllerDriver },
  write: StatusRequestWrite,
): Pick<LaserState, 'requestControllerStatus'> {
  return {
    requestControllerStatus: async () => {
      const query = refs.driver.realtime.statusQuery;
      if (query === null || controllerOperationOwnsPolling(get())) return;
      try {
        await write(query, undefined, 'system');
      } catch {
        // The periodic poll is still running; a failed query is not a refusal.
      }
    },
  };
}
