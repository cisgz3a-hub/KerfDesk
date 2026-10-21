## ADR-648 - Settings survive KerfDesk's own reset (2026-10-20)

**Status:** Accepted, at the maintainer's request to fix D-5 and F-5 first ("keep the settings
across KerfDesk's own resets and only toast when a read finds something new").
**Date:** 2026-10-20

Amends [ADR-611](ADR-611-quiet-controller-information.md) (controller information stays out of
the way) and the reboot-banner rule in WORKFLOW "Controller qualification and Forget Controller"
item 1, under which every banner re-ran the full `$$`, `$I`, `$G` read. Fixes D-5 of
`docs/audits/2026-10-20-controller-design-audit.md`. F-5 of the 2026-10-19 controller audit (the
settings toast) is decided by
[ADR-611 Amendment 2](ADR-611-amendment-2-reconnects-announce-only-news.md); this ADR only stops
KerfDesk's own resets from producing a new read for that toast to announce.

### Context

Every banner cleared `controllerSettings`, `grblSettingsRows` and the `$I` evidence and re-ran
qualification, including the banner that follows a soft reset KerfDesk sent itself: Abort, the
stop after `error:N`, the stream heartbeat and hold stops, and Disconnect's reset. The reset owner
(`claimResetOwnership`) had already cleared the same evidence before writing Ctrl-X.

GRBL keeps its `$` settings and the `$I` build string in EEPROM, and a soft reset reloads them
unchanged. Only the parser's modal state and the active work coordinate system start again. UGS,
CNCjs and LightBurn re-read nothing after a reset; LightBurn reads settings on connect only when
asked. Because KerfDesk's automatic read waits for Idle, an Abort that raised `ALARM:3` left the
settings unread until the operator unlocked. Meanwhile Home on stock GRBL fell back to its
30-minute backstop instead of the `$$`-derived bound (ADR-400). Each of those re-reads also set a
new read time, which the "Machine settings detected" toast announced.

### Decision

1. **Kept across an owned reset.** When KerfDesk's reset owner claims a reset on a connected port,
   it takes the current session's `$$` snapshot: settings, rows, the pending detected-settings
   patch, read time, and the `$I` evidence when this session read it. The snapshot travels on that
   reset's armed beam-off cleanup, the "owned reset boundary". The banner that closes this reset on
   the same port, within the owner's 500 ms banner window, restores it, re-stamped for the new
   controller session. The read time stays the
   original, so nothing announces a read that did not happen. The CNC live caps are published
   again from it.
2. **Only `$G` is read again.** Qualification after that banner waits for the same reset cleanup
   and fresh Idle as before, then reads `$G` (modal state and active WCS), plus `$I` only if this
   session never read it. It marks the controller qualified with its settings verified and logs
   that the settings were kept. The scheduler decides this when the run starts, from whether the
   session still holds the kept `$$` read, so a qualification that times out and resumes on a
   fresh status stays `$G`-only.
3. **Full invalidation stays everywhere else.** These banners still discard the snapshot and
   re-read `$$`, `$I` and `$G`:
   - a banner no owned reset is waiting for: an uncommanded reboot, `$RST=`'s own reset, or a
     late banner after the owner's 500 ms window, even while the owner still waits for a boot;
   - any banner after the first one an owned reset re-arms for;
   - a banner on a new connection;
   - a banner after any setting write went out since the last `$$` read: a `$` assignment
     (`$N=`, `$RST=`, `$I=`, `$N0=`) or FluidNC's `[key]value` form of one, in any whitespace
     form or behind GRBL's ignored `/` block delete, other than a `$J=`/`[J]` jog, or FluidNC
     `$NVX` (`$Settings/Erase`, which erases
     every stored setting with or without a value). This covers writes from the Console, Machine
     Settings and macros, and a job whose program carries one.
   Nothing is retained when no `$$` read completed in the current session or one is in flight.
   `$$` does not report the `$I` string, so a `$I=` or `$RST=` write stays outstanding for the
   `$I` evidence until `$I` itself is read again. Until then an owned reset keeps the `$$` snapshot
   but not the `$I` evidence, and its `$G`-only qualification reads `$I` too.
   The operator's Wake and probe recovery resets keep their full re-read, unchanged.
4. **No toast for a kept snapshot.** A kept snapshot keeps its original read time, so the "Machine
   settings detected" toast, whose rules are ADR-611 Amendment 2's, has no new read to announce
   after KerfDesk's own reset. A completed `$$` read logs "Controller settings read (N)." beside
   Controller info's "Last read" time.

### Consequences

- After Abort, the error stop or a heartbeat stop, the settings, travel and laser limits stay
  known through an `ALARM:3`. Home, and the "Not responding" window for a line still owed its
  reply (ADR-610 Amendment 2), keep the `$$`-derived bound instead of the 30-minute backstop.
  Only `$G` goes over the wire once the controller is Idle again.
- An Abort no longer ends in a settings toast or a settings read.
- The `$G` read still waits for Idle (F-4 of the 2026-10-19 audit stays open).

### Evidence and limits

- `laser-owned-reset-settings.test.ts` pins that the line handler keeps the snapshot for the
  owned reset's banner. It also pins that an uncommanded banner clears it, that a `$` write since
  the read clears it, that a `$I=` write keeps `$I` outstanding, and that only one banner carries
  it. `eeprom-write-line.test.ts` pins which lines count as setting and build-info writes.
- `laser-store-controller-qualification.test.ts` pins Abort, then a `$G`-only re-read with no `$$`
  or `$I`, then qualification and a fresh job, and that an uncommanded banner re-reads `$$`.
- The reset owner drops the snapshot when its 500 ms banner window ends without the banner, so
  `laser-stream-ack-stall.test.ts` and `laser-reset-response-ownership.test.ts` still see a full
  `$$` read at a late boot. `laser-reset-cleanup-interruption.test.ts`,
  `laser-store-controller-recovery.test.ts`, the immediate-greeting case of
  `laser-reset-response-ownership.test.ts` and the browser workflow in
  `production-workflows.spec.ts` now expect `$G` only after Abort's or the error stop's own
  greeting. Three browser specs wait for the settings read itself rather than its toast.
- These are unit, store and browser tests only. No machine was operated.
