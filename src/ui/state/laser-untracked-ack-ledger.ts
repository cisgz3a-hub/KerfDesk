import type { LaserMotionOperationId } from './laser-motion-operation';

export type UntrackedAckReservation = {
  readonly writeEpoch: number;
  /** Exact motion generation that emitted this queued line, or null for
   * console/poll/system ownership. Repeated for every ack in a multi-line
   * reservation so an unrelated error can never retire active motion. */
  readonly motionOperationId: LaserMotionOperationId | null;
  /** The lines this write put on the wire, so an echo can name its owner. */
  readonly lines: ReadonlyArray<string>;
  remaining: number;
};

export type UntrackedAckLedgerRefs = {
  writeEpoch?: number;
  untrackedAckReservations?: UntrackedAckReservation[];
};

/** Reserve FIFO terminal-response ownership for one transport write. */
export function reserveUntrackedAcks(
  refs: UntrackedAckLedgerRefs,
  count: number,
  motionOperationId: LaserMotionOperationId | null = null,
  lines: ReadonlyArray<string> = [],
): UntrackedAckReservation | null {
  if (count <= 0) return null;
  const queue = currentQueue(refs);
  const reservation = {
    writeEpoch: refs.writeEpoch ?? 0,
    motionOperationId,
    lines,
    remaining: count,
  };
  queue.push(reservation);
  return reservation;
}

/** True when a current-session write still owed a reply put such a line on the wire. */
export function owesUntrackedLine(
  refs: UntrackedAckLedgerRefs,
  matches: (line: string) => boolean,
): boolean {
  return currentQueue(refs).some((reservation) => reservation.lines.some(matches));
}

/** The command a nonterminal rejection describes, without settling its debt. */
export function peekUntrackedAck(refs: UntrackedAckLedgerRefs): LaserMotionOperationId | null {
  return currentQueue(refs)[0]?.motionOperationId ?? null;
}

/** Consume one terminal response from the oldest current-session write. */
export function consumeUntrackedAck(refs: UntrackedAckLedgerRefs): LaserMotionOperationId | null {
  const queue = currentQueue(refs);
  const reservation = queue[0];
  if (reservation === undefined) return null;
  reservation.remaining = Math.max(0, reservation.remaining - 1);
  if (reservation.remaining === 0) queue.shift();
  return reservation.motionOperationId;
}

/**
 * Drops every reservation written before the oldest one that put a line
 * `answered` matches on the wire, and returns how many replies they still
 * owed. Only for a caller that holds proof that the controller has answered
 * that line: GRBL-family firmware answers in order, so a reply still owed by an
 * older write will never come (ADR-696). Returns 0, and drops nothing, when no
 * reservation holds such a line.
 */
export function dropUntrackedAcksAheadOf(
  refs: UntrackedAckLedgerRefs,
  answered: (line: string) => boolean,
): number {
  const queue = currentQueue(refs);
  const index = queue.findIndex((reservation) => reservation.lines.some(answered));
  if (index <= 0) return 0;
  return queue.splice(0, index).reduce((owed, reservation) => owed + reservation.remaining, 0);
}

/** True when the oldest current-session reservation put such a line on the wire. */
export function oldestUntrackedLineMatches(
  refs: UntrackedAckLedgerRefs,
  matches: (line: string) => boolean,
): boolean {
  return currentQueue(refs)[0]?.lines.some(matches) ?? false;
}

function currentQueue(refs: UntrackedAckLedgerRefs): UntrackedAckReservation[] {
  const queue = (refs.untrackedAckReservations ??= []);
  const writeEpoch = refs.writeEpoch ?? 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.writeEpoch !== writeEpoch) queue.splice(index, 1);
  }
  return queue;
}
