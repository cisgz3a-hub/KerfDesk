// Watches a Ruida job or frame to its end over status reads (ADR-697), as
// meerk40t's status monitor does (controller.py _status_monitor, 0.2 s between
// reads of STATUS_ADDRESSES). A run counts as finished only after the
// controller reported busy at least once and then idle twice in a row, so a
// read taken before the controller begins never ends a run early. No bit for
// "paused" is known (rdjob.py L232-234), so while paused nothing finishes.

import {
  decodeRuidaMachineStatus,
  ruidaStatusBusy,
  RUIDA_MEM_CURRENT_X,
  RUIDA_MEM_CURRENT_Y,
  RUIDA_MEM_MACHINE_STATUS,
  type RuidaMachineStatus,
} from '../../../core/controllers/ruida';
import type { RuidaLinkExchange } from './ruida-link-exchange';

export const RUIDA_STATUS_POLL_MS = 400;
const IDLE_READS_TO_FINISH = 2;
const SILENT_READS_TO_WARN = 3;

export type RuidaMonitorEvents = {
  readonly status: (
    status: RuidaMachineStatus,
    positionMm: { x: number; y: number } | null,
  ) => void;
  readonly finished: () => void;
  readonly silent: () => void;
  readonly paused: () => boolean;
};

export type RuidaMonitor = { readonly stop: () => void };

export function watchRuidaRun(
  exchange: RuidaLinkExchange,
  events: RuidaMonitorEvents,
): RuidaMonitor {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busySeen = false;
  let idleReads = 0;
  let silentReads = 0;
  const poll = async (): Promise<void> => {
    timer = null;
    const reply = await exchange.read(RUIDA_MEM_MACHINE_STATUS);
    if (stopped) return;
    if (reply === null) {
      silentReads += 1;
      if (silentReads === SILENT_READS_TO_WARN) events.silent();
    } else {
      silentReads = 0;
      const status = decodeRuidaMachineStatus(reply.value);
      events.status(status, await readPosition(exchange));
      if (stopped) return;
      if (ruidaStatusBusy(status)) {
        busySeen = true;
        idleReads = 0;
      } else if (busySeen && !events.paused()) {
        idleReads += 1;
      }
      if (idleReads >= IDLE_READS_TO_FINISH) {
        stopped = true;
        events.finished();
        return;
      }
    }
    timer = setTimeout(() => void poll(), RUIDA_STATUS_POLL_MS);
  };
  timer = setTimeout(() => void poll(), RUIDA_STATUS_POLL_MS);
  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

// The controller's own X and Y in mm, as it reports them; informational only.
async function readPosition(exchange: RuidaLinkExchange): Promise<{ x: number; y: number } | null> {
  const x = await exchange.read(RUIDA_MEM_CURRENT_X);
  const y = x === null ? null : await exchange.read(RUIDA_MEM_CURRENT_Y);
  if (x === null || y === null) return null;
  return { x: x.signed / 1000, y: y.signed / 1000 };
}
