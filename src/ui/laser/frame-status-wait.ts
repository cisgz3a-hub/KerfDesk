// Bounded status-query burst for a Frame that would otherwise refuse only
// because a report field has not arrived yet: no status at all right after
// connecting, homing or a reset, or no work-coordinate offset. GRBL includes
// WCO in one Idle report out of ten (and in the next report after a G92/G10
// change), and the idle poll runs about once a second, so an origin-relative
// Frame pressed then was refused for up to ~10 s. The WCO refresh counts
// reports, not time, so a short burst of ordinary realtime `?` queries brings
// the field within a second. The queries are inert to the planner and change
// no setting or offset; the Frame's own gates still judge whatever arrives.

import { useLaserStore, type LaserState } from '../state/laser-store';

const STATUS_WAIT_TIMEOUT_MS = 3_000;
const STATUS_WAIT_POLL_MS = 25;
const STATUS_QUERY_INTERVAL_MS = 100;

/** Resolves true once `satisfied` holds. Resolves false after the timeout, on
 * disconnect or a new controller session, or at once when the controller
 * cannot answer realtime status queries. */
export async function waitForControllerStatus(
  satisfied: (laser: LaserState) => boolean,
): Promise<boolean> {
  const before = useLaserStore.getState();
  if (satisfied(before)) return true;
  if (!answersStatusQueries(before)) return false;
  const deadline = Date.now() + STATUS_WAIT_TIMEOUT_MS;
  let nextQuery = Date.now();
  while (Date.now() <= deadline) {
    const current = useLaserStore.getState();
    if (current.controllerSessionEpoch !== before.controllerSessionEpoch) return false;
    if (!answersStatusQueries(current)) return false;
    if (satisfied(current)) return true;
    if (Date.now() >= nextQuery) {
      void current.requestControllerStatus();
      nextQuery = Date.now() + STATUS_QUERY_INTERVAL_MS;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, STATUS_WAIT_POLL_MS);
    });
  }
  return satisfied(useLaserStore.getState());
}

function answersStatusQueries(laser: LaserState): boolean {
  return (
    laser.connection.kind === 'connected' && laser.capabilities.statusQuery === 'realtime-report'
  );
}
