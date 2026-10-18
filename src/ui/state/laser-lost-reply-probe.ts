// laser-lost-reply-probe — the `$G` sent to prove that a GRBL-family
// controller has read every job line whose reply never arrived (ADR-610
// Amendment 1). Kept free of imports so the post-job settle and the Idle
// release can defer to it without an import cycle.

export type LostReplyProbe = {
  readonly writeEpoch: number;
  readonly sessionEpoch: number;
  readonly streamerEpoch: number;
  /** Job lines written before the probe. Each is answered before its `[GC:`. */
  readonly linesBefore: number;
  readonly sentAt: number;
  /** When the transport accepted the probe; null while its write is pending. */
  writtenAt: number | null;
  /** When the `[GC:` report arrived; null until then. */
  provenAt: number | null;
};

export type LostReplyProbeRefs = {
  writeEpoch?: number;
  lostReplyProbe?: LostReplyProbe | null;
};

/** A probe on the current serial session still owes its reply. While it
 *  does, the post-job settle and the Idle release wait: either would take the
 *  probe's `ok` as their own. A reset moves the write epoch and retires it. */
export function lostReplyProbeOutstanding(refs: LostReplyProbeRefs): boolean {
  const probe = refs.lostReplyProbe ?? null;
  return probe !== null && probe.writeEpoch === (refs.writeEpoch ?? 0);
}
