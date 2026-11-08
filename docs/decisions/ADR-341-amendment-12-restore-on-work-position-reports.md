## ADR-341 Amendment 12 - Restore saved origin works on $10=0, and the Abort card's failures are toasts (2026-11-08)

**Status:** Accepted (rolling audit v10, area V3, finding V3-P2-2, confirmed by an independent
refuter; the maintainer's standing instruction to fix confirmed audit findings). Amends
Amendment 11 Decisions 3 and 5. |
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

### Decision

1. **A $10=0 report that carries WCO gives the withheld position.** GRBL's WPos is MPos - WCO, so
   `withholdPosition` keeps WPos + WCO as the withheld MPos, rounded to the reports' 4 decimals.
   The hold-to-jog clamp, the other reader, gets the same controller count.
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

### Consequences

- Amendment 11's restore now works on GRBL with `$10=0` as it does with `$10=1`, and on
  "Home, then restore origin".
- Every failure after the unlock is visible, including `ABORT_ALARM_NOT_IDLE_MESSAGE` and an
  origin-readiness block.
- No refusal is added, widened or removed (ADR-228). The extra status queries are realtime bytes
  and need no acknowledgement.

### Verification

- `abort-restore-work-position.simulator.test.tsx`, on the GRBL simulator with its reports
  reshaped to GRBL 1.1's `$10=0` form and `WCO:` cadence: after ABORT JOB, Restore saved origin
  and Home, then restore origin both put the origin back (simulator WCO equals the saved origin,
  one G92, the head unmoved without homing). `$10=1` is the control. With `WCO:` never sent, the
  rendered card's click ends in the toast above, with no G92 and the alarm cleared.
- `AbortStoppedCard.test.tsx`: a failure after the alarm cleared is a toast; a failure while the
  alarm holds stays on the card.
- No hardware was operated; all controllers are simulated.
