// A remote Place Board capture records the head only from a status report that
// reached the PC after the request (ADR-654 Amendment 1). The client cannot see
// the head, and the last report can predate motion the PC does not own (an MPG,
// a pendant). One status query asks for that report at once; a controller that
// is only polled answers on its next idle poll, about a second away.

import { useLaserStore } from '../state/laser-store';
import { RemoteFault } from './fault';
import type { OwnedMachineOperation } from './machine-operation-state';

const FRESH_REPORT_TIMEOUT_MS = 3_000;
const FRESH_REPORT_POLL_MS = 25;
const STATUS_QUERY_INTERVAL_MS = 100;

export const NO_FRESH_BOARD_REPORT_MESSAGE =
  'The machine sent no new position report. Check it on the computer, then try again.';
const SESSION_CHANGED_MESSAGE =
  'The controller connection changed. Check the machine on the computer, then try again.';

/** Null once a report newer than the request finds `blockMessage` clear; otherwise why the
 * capture is refused. A blocked report refuses at once: the head was moving, so the point the
 * client asked for is not where it will stop. */
export async function freshBoardReportRefusal(
  operation: OwnedMachineOperation,
  blockMessage: () => string | null,
): Promise<string | null> {
  const before = useLaserStore.getState();
  const deadline = Date.now() + FRESH_REPORT_TIMEOUT_MS;
  let nextQuery = Date.now();
  for (;;) {
    if (operation.controller.signal.aborted) throw new RemoteFault('cancelled');
    const laser = useLaserStore.getState();
    if (laser.controllerSessionEpoch !== before.controllerSessionEpoch)
      return SESSION_CHANGED_MESSAGE;
    const blocked = blockMessage();
    if (blocked !== null) return blocked;
    if (laser.statusSequence > before.statusSequence) return null;
    if (Date.now() >= deadline) return NO_FRESH_BOARD_REPORT_MESSAGE;
    if (Date.now() >= nextQuery) {
      void laser.requestControllerStatus();
      nextQuery = Date.now() + STATUS_QUERY_INTERVAL_MS;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, FRESH_REPORT_POLL_MS);
    });
  }
}
