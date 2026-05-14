import {
  createUnframedStartOverrideTicket,
  type FrameTicket,
} from '../../src/app/FrameState';
import type { ValidatedJobTicket } from '../../src/core/job/ValidatedJobTicket';

export function makeTestFrameTicket(ticket: ValidatedJobTicket): FrameTicket {
  return createUnframedStartOverrideTicket({
    jobTicketId: ticket.ticketId,
    fingerprint: ticket.fingerprint,
    reason: 'test explicit start without framing',
    grantedAt: 1,
  });
}
