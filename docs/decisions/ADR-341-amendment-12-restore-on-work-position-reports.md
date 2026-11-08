## ADR-341 Amendment 12 - Restore saved origin works on $10=0, its failures are told, and Frame offers an unrestored origin back (2026-11-08)

**Status:** Accepted (rolling audit v10, area V3, finding V3-P2-2, confirmed by an independent
refuter and re-rated P1 by the V9 refuter; the maintainer's standing instruction to fix confirmed
audit findings). Amends Amendment 11 Decisions 3 and 5, and the User and Verified Origin offer of
`start-blocked-setup-offers.ts` (ADR-367). |
**Date:** 2026-11-08

### Context

- Amendment 11's **Restore saved origin** writes `G92 X(m - s)` and so needs the controller's
  machine position m. After Unlock it reads the MPos withheld from the latest report
  (`withheldControllerMPos`).
- Stock GRBL with `$10=0` (work position in status reports) reports `WPos` and, on one report in
  ten at Idle (one in thirty while busy), `WCO:` (report.c). Such a report carries no MPos, so
  nothing was withheld. After Home, `wcoCache` is cleared, and `inferCurrentMachinePosition` needs
  WPos plus a known WCO. KerfDesk polls an Idle machine once a second, so a report with `WCO:` came
  about every 10 s.
- The restore therefore threw "KerfDesk does not know where the head is … Wait for a position
  report and try again" right after `$X`. **Home, then restore origin** failed the same way about
  9 times in 10. On `$10=0` waiting never helped, since position stays withheld until Home or an
  origin write.
- The card reported a failure only on itself. `$X` had already cleared the alarm, so the card was
  unmounted and the message was never seen. There was no toast, and the origin stayed cleared.
- The V9 refuter followed the journey in Chrome. The next Frame did not refuse: with no origin set,
  it offered the first-setup repair, "User Origin needs a custom work origin. OK: set the work
  origin at the current head position". The offer named neither the saved origin nor the head's
  distance from it. Accepting re-ran the job (+9.8, +5.75) and (+10.3, +4.05) mm off the half-burned
  piece, and Job Review read as it had for the first run. The operator had just pressed a button
  promising to put the origin back "without moving the head", and a card closing silently looks
  like success.

### Decision

1. **A $10=0 report that carries WCO gives the withheld position.** GRBL's WPos is MPos - WCO, so
   `withholdPosition` keeps WPos + WCO as the withheld MPos, rounded to the reports' 4 decimals. A
   later report with the same WPos and no `WCO:` keeps it: GRBL sends `WCO:` on the next report
   after any offset change, so an unchanged WPos without one means an unmoved head. The hold-to-jog
   clamp, the other reader, gets the same controller count.
2. **Restore waits a bounded time for an aim point.** When neither the live report nor the withheld
   one gives the machine position, Restore saved origin waits up to 5 s for a fresh report after
   which one exists. While it waits it sends the realtime status query every 250 ms, the busy poll
   rate, so `$10=0`'s one-in-ten `WCO:` arrives within about 2.5 s. It then re-checks the origin
   readiness and writes the one G92 as before. Nothing else is written, and the head does not move.
3. **A failed wait says why.** On a `$10=0` controller: "The saved origin was not written. The
   controller reports only the work position ($10=0), and none of its reports in the last 5 s
   carried the work offset (WCO) that gives the machine position. Try Restore saved origin again
   in a moment, or use Set origin here." With no report at all, the message names the connection.
   A new session, or Alarm or Sleep during the wait, is named. The "Wait for a position report and
   try again" text stays only for the other G92 writers, which do not wait.
4. **The Abort card toasts a failure once its alarm is gone.** When an action fails after the
   alarm cleared (`operatorAbortAlarm` is null), the card reports it through
   `reportControllerActionFailure` as "<button label>: <reason>". A refusal before the unlock,
   while the card is still shown, stays on the card.
5. **Frame offers the unrestored origin back, not one at the head.** While the operator Abort of
   the current stream holds `originAtStopMm` and User or Verified Origin refuses for want of an
   origin, Frame's offer (`unrestored-abort-origin.ts`) says: "User Origin needs a custom work
   origin. The job you stopped ran from X …, Y … mm from machine zero, and that origin was not
   restored. The head is … mm from it (X …, Y … mm)." (or that KerfDesk cannot tell how far).
   - Its OK puts the saved origin back: one G92 without motion, or Home first on a machine with
     homing, as the card's own action does. The Frame then runs from it.
   - Its Cancel leaves the job blocked and names **Set origin here** in the Machine panel for an
     operator who wants the head's position instead. The plain set-origin-at-the-head offer stays
     for every other missing origin.
   - Start needs a completed Frame (ADR-372), so this is the one offer on the way to a re-run.

### Consequences

- Amendment 11's restore now works on GRBL with `$10=0` as it does with `$10=1`, and on
  "Home, then restore origin".
- Every failure after the unlock is visible, including `ABORT_ALARM_NOT_IDLE_MESSAGE` and an
  origin-readiness block.
- A re-run after an Abort lands on the job's own origin unless the operator chooses otherwise in
  the Machine panel, with the distance named first.
- No refusal is added, widened or removed (ADR-228). The extra status queries are realtime bytes
  and need no acknowledgement.

### Verification

- `abort-restore-work-position.simulator.test.tsx`, on the GRBL simulator with its reports
  reshaped to GRBL 1.1's `$10=0` form and `WCO:` cadence: after ABORT JOB, Restore saved origin
  and Home, then restore origin both put the origin back (simulator WCO equals the saved origin,
  one G92, the head unmoved without homing). `$10=1` is the control. With `WCO:` never sent, the
  rendered card's click ends in the toast above, with no G92 and the alarm cleared. The next Frame
  names the saved origin and the head's distance, and its OK writes one G92 that restores it.
- `e2e/abort-unrestored-origin.e2e.ts`, in Chrome with the in-page journey GRBL
  (`e2e/fixtures/journey-grbl-serial.js`, `$10=0`): Start, ABORT JOB, a restore that cannot aim
  (the toast), then Frame. The offer names X 60, Y 40 and the head's distance; Cancel writes no
  G92; OK restores the work offset to (60, 40) and the Frame completes.
- `start-blocked-setup-offers.test.ts`, `laser-status-position.test.ts` and
  `AbortStoppedCard.test.tsx` cover the offer's text and choices, the carried-forward position, and
  the card's toast.
- No hardware was operated; all controllers are simulated.
