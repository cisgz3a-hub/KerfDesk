// Operator text for the Ruida network link (ADR-697). Every line says what
// KerfDesk knows and no more: UDP gives no proof a datagram arrived, and this
// link is simulator-tested only.

import type { RuidaMachineStatus } from '../../../core/controllers/ruida';
import type { RuidaExchangeFailure } from './ruida-link-exchange';

export const RUIDA_NOT_QUALIFIED =
  'EXPERIMENTAL: the Ruida network link follows public protocol research and is tested against a simulator only. It has not been qualified on a real controller — keep a hand on the machine’s Stop key.';

export const RUIDA_FRAME_FIRST =
  'Frame this job first: Start runs only after a completed Frame of the same footprint and placement on this connection.';

export const RUIDA_STATUS_SILENT =
  'The controller is not answering status reads. A job it holds may still be running — use Abort, or the Stop key on the controller.';

export function ruidaNoReplyMessage(host: string): string {
  return `No reply from a Ruida controller at ${host} on UDP port 50200. Check the IP address on the controller panel, that this computer is on the same network, and that LightBurn or RDWorks is closed.`;
}

export function ruidaFailureText(failure: RuidaExchangeFailure): string {
  switch (failure) {
    case 'ack-timeout':
      return 'The controller did not acknowledge a datagram within 1 s; nothing was resent.';
    case 'nak-retries-exhausted':
      return 'The controller refused the same datagram four times.';
    case 'command-exceeds-datagram':
      return 'One command is longer than a UDP datagram can carry.';
    case 'link-closed':
      return 'The network link closed.';
    case 'send-failed':
      return 'A datagram could not be sent; delivery is uncertain and nothing was resent.';
    case 'cancelled':
      return 'Sending was cancelled.';
    case 'reply-timeout':
      return 'The controller did not answer a status read.';
  }
}

export function ruidaStatusText(status: RuidaMachineStatus | null): string {
  if (status === null) return 'unknown';
  const busy = [
    status.jobRunning ? 'job running' : null,
    status.moving ? 'moving' : null,
    status.partEnd ? 'part end' : null,
  ].filter((part) => part !== null);
  return busy.length === 0 ? 'idle' : busy.join(', ');
}

export function ruidaStopOutcome(acknowledged: boolean): string {
  return acknowledged
    ? 'The controller acknowledged Stop Process.'
    : 'Stop Process was NOT acknowledged — press Stop on the controller panel now.';
}
