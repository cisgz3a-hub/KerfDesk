## ADR-648 - Settings survive KerfDesk's own reset, and the settings toast speaks only when a read finds something new (2026-10-20)

**Status:** Accepted, at the maintainer's request to fix D-5 and F-5 first ("keep the settings
across KerfDesk's own resets and only toast when a read finds something new").
**Date:** 2026-10-20

Amends [ADR-611](ADR-611-quiet-controller-information.md) (controller information stays out of
the way) and the reboot-banner rule in WORKFLOW "Controller qualification and Forget Controller"
item 1, under which every banner re-ran the full `$$`, `$I`, `$G` read. Fixes D-5 of
`docs/audits/2026-10-20-controller-design-audit.md` and F-5 of the 2026-10-19 controller audit.

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
30-minute backstop instead of the `$$`-derived bound (ADR-400).

Each completed read also pushed an 8 s "Machine settings detected" toast, with "controller
settings were read successfully" when there was nothing to report. So every connect and every
Abort that reset the board ended in a toast about a routine read.

### Decision

1. **Kept across an owned reset.** When KerfDesk's reset owner claims a reset on a connected port,
   it takes the current session's `$$` snapshot: settings, rows, the pending detected-settings
   patch, read time, and the `$I` evidence when this session read it. The snapshot travels on that
   reset's armed beam-off cleanup, the "owned reset boundary". The banner that closes this reset on
   the same port restores it, re-stamped for the new controller session. The read time stays the
   original, so nothing announces a read that did not happen. The CNC live caps are published
   again from it.
2. **Only `$G` is read again.** Qualification after that banner waits for the same reset cleanup
   and fresh Idle as before, then reads `$G` (modal state and active WCS), plus `$I` only if this
   session never read it. It marks the controller qualified with its settings verified and logs
   that the settings were kept.
3. **Full invalidation stays everywhere else.** These banners still discard the snapshot and
   re-read `$$`, `$I` and `$G`:
   - a banner no owned reset is waiting for: an uncommanded reboot, `$RST=`'s own reset, or a
     banner after the reset owner's wait ended;
   - any banner after the first one an owned reset re-arms for;
   - a banner on a new connection;
   - a banner after any `$` assignment (`$N=`, `$RST=`, `$I=`, `$N0=`) went out since the last
     `$$` read. This covers writes from the Console, Machine Settings and macros, and a job whose
     program carries one.
   Nothing is retained when no `$$` read completed in the current session or one is in flight.
   The operator's Wake and probe recovery resets keep their full re-read, unchanged.
4. **The toast speaks only for something new.** A completed read pushes the "Machine settings
   detected" toast only when it found a profile update or review item that the last read on the
   same port (USB vendor and product, or network) did not report in this run of the app. A read
   with nothing to report is silent. Its plain result is a log line, "Controller settings read
   (N).", and Controller info's "Last read" time. Machine Setup's detected-settings lane is
   unchanged.

### Consequences

- After Abort, the error stop or a heartbeat stop, the settings, travel and laser limits stay
  known through an `ALARM:3`. Home, and the "Not responding" window for a line still owed its
  reply (ADR-610 Amendment 2), keep the `$$`-derived bound instead of the 30-minute backstop.
  Only `$G` goes over the wire once the controller is Idle again.
- Reconnecting to the same machine, or re-reading its settings, no longer repeats the toast.
- The `$G` read still waits for Idle (F-4 of the 2026-10-19 audit stays open).

### Evidence and limits

- `laser-owned-reset-settings.test.ts` pins that the line handler keeps the snapshot for the
  owned reset's banner. It also pins that an uncommanded banner clears it, that a `$` write since
  the read clears it, and that only one banner carries it.
- `laser-store-controller-qualification.test.ts` pins Abort, then a `$G`-only re-read with no `$$`
  or `$I`, then qualification and a fresh job, and that an uncommanded banner re-reads `$$`.
- `DetectedSettingsToast.test.ts` pins that the toast is silent on an unchanged or empty read and
  reappears for a new item or another port.
- These are unit and store tests only. No machine was operated.
