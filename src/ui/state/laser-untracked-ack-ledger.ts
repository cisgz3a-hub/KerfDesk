export type UntrackedAckReservation = {
  readonly writeEpoch: number;
  /** Exact motion generation that emitted this queued line, or null for
   * console/poll/system ownership. Repeated for every ack in a multi-line
   * reservation so an unrelated error can never retire active motion. */
  readonly motionOperationId: number | null;
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
  motionOperationId: number | null = null,
): UntrackedAckReservation | null {
  if (count <= 0) return null;
  const queue = currentQueue(refs);
  const reservation = { writeEpoch: refs.writeEpoch ?? 0, motionOperationId, remaining: count };
  queue.push(reservation);
  return reservation;
}

/** Consume one terminal response from the oldest current-session write. */
export function consumeUntrackedAck(refs: UntrackedAckLedgerRefs): number | null {
  const queue = currentQueue(refs);
  const reservation = queue[0];
  if (reservation === undefined) return null;
  reservation.remaining = Math.max(0, reservation.remaining - 1);
  if (reservation.remaining === 0) queue.shift();
  return reservation.motionOperationId;
}

function currentQueue(refs: UntrackedAckLedgerRefs): UntrackedAckReservation[] {
  const queue = (refs.untrackedAckReservations ??= []);
  const writeEpoch = refs.writeEpoch ?? 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.writeEpoch !== writeEpoch) queue.splice(index, 1);
  }
  return queue;
}
