// laser-hosted-refill — the store's side of handing the character-counting
// refill to the serial worker, and taking it back (ADR-334).
//
// The rule the whole design rests on: exactly one side writes refills, and the
// handover happens only through the transport's acknowledged handshake. So
// every store action that changes the stream's status — pause, resume, tool
// change — takes the refill back FIRST, and `advanceStream` writes nothing
// while the worker holds it. Abort posts its realtime reset first: the worker
// retires its refill on that write, and the release follows only to bound a
// silent worker.
//
// Everything else is unchanged. The worker forwards every line, so the
// acknowledgement ledger, the safety handlers and the streamer state on this
// side run exactly as they do on the main-thread transport. That is what makes
// this reversible: with the refill released, the app is byte-for-byte the app
// it was before.

import type { StreamerState } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';

type ConnectionRefs = { connection?: SerialConnection | null };

export function hostedRefill(refs: ConnectionRefs): HostedStreamRefill | null {
  return refs.connection?.hostedStreaming ?? null;
}

/** True while the worker owns the refill, so this side must not write one. */
export function hostedRefillArmed(refs: ConnectionRefs): boolean {
  return hostedRefill(refs)?.isArmed() === true;
}

/**
 * Hand the refill over from exactly this stream position. Called after the
 * first window is on the wire, so the worker adopts a state whose in-flight
 * bytes are already accounted for and simply continues.
 */
export async function armHostedRefill(
  refs: ConnectionRefs,
  readStreamer: () => StreamerState | null,
): Promise<void> {
  const refill = hostedRefill(refs);
  const streamer = readStreamer();
  if (refill === null || streamer === null || streamer.status !== 'streaming') return;
  await refill.arm(() => {
    const current = readStreamer();
    return current?.status === 'streaming' ? current : null;
  });
}

/**
 * Take the refill back and wait for the transport to confirm. Every caller
 * that is about to change the stream's status must await this, or the two
 * sides would briefly disagree about who writes next. The one exception is a
 * realtime reset, which the worker treats as its own release.
 */
export async function releaseHostedRefill(refs: ConnectionRefs): Promise<void> {
  const refill = hostedRefill(refs);
  if (refill === null) return;
  await refill.release();
}
