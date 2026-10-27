## ADR-547 Amendment 1 - An unconfirmed licence is not an ended update year (2026-10-27)

**Status:** Accepted | **Date:** 2026-10-27 | **Amends:** ADR-547 decisions 1, 2 and 4 | **Keeps:** ADR-561 item 5

### Context

Rolling audit v4 finding H10-P2-1 (P2) found that a paying customer could be told a false fact
about the updates they paid for.

1. A paid licence's weekly confirmation, or a trial's daily one, falls due (ADR-623 Amendment 2
   decision 3).
2. The request fails: the computer is offline, or the licence service answers 503 or a 429 rate
   limit.
3. KerfDesk deliberately holds paid and trial updates back until a confirmation succeeds. ADR-561
   item 5 says "unverifiable credentials do not authorise an update", and
   `electron/licensing-free-updates.test.ts` pins that rule.
4. The update check then reported the newer release as `not-covered`. That outcome means a release
   "this licence's updates do not cover" (decision 1), and decision 4 makes the panel name "the
   date its updates ended".
5. So Help > Check for Updates said "KerfDesk 1.0.11 is out, but your licence's updates ended on
   10/6/2027": a date a year away, with no Download button. Help > Licence said "Updates through
   10/6/2027" at the same time.

A user reaches this on the app's own advice:

1. KerfDesk opens offline, and the update panel says to check the connection and try Check now
   again.
2. The user reconnects and chooses Check now.
3. Check now does not run a licence confirmation first, so the false sentence appears.

It lasts until a later confirmation succeeds. That is up to 30 minutes after reconnecting. During a
licence-service outage it is the whole outage, and behind a proxy that blocks only the licence
service it never ends.

### Decision

1. **A failed confirmation has its own update outcome.** Decision 1's outcomes and decision 2's
   states gain `licence-unconfirmed`: the newest release the saved rights cover that waits for a
   licence confirmation to succeed. `not-covered` keeps its meaning, a release the licence's updates
   do not cover.
   - `LicensingUpdateCache` (`electron/licensing-update-cache.ts`) decides each release once:
     - `covered`: it may update;
     - `unconfirmed`: the saved, verified rights cover it, the clock is valid, and only the failed
       confirmation holds it back;
     - `refused`: anything else.
   - Eligibility (`eligible`, `manualEligible`) is still only `covered`, so the block stays exactly
     as strict (ADR-561 item 5).
   - A separate query, `awaitsConfirmation` (the runtime's `isReleaseAwaitingConfirmation` and
     `isManualReleaseAwaitingConfirmation`), answers only "is it unconfirmed?". It words the
     panel. It never makes a release eligible, and every update lane asks it only after
     eligibility has refused.
2. **Every lane reports it the same way.** The manual Windows installer lane
   (`manual-update.ts`), the macOS and Linux download-page lane (`platform-manual-update.ts`) and
   the dormant signed lane (`commercial-update.ts`) all use `heldReleaseState`
   (`update-status.ts`).
   - The signed lane names the newest release that waits for a confirmation, because that is the
     one it takes once the licence is confirmed. If none waits, it still names the newest release
     the licence does not cover.
   - A release the licence's updates do not cover stays `not-covered` when the confirmation also
     fails. A failed confirmation never hides an ended update year.
3. **The panel says so plainly** (decision 4). For `licence-unconfirmed`, Help > Check for Updates
   says:

   > KerfDesk 1.0.11 is out and your licence covers it, but KerfDesk couldn't confirm your licence
   > just now, so the update waits until it does. Check your connection, then open Help > Licence,
   > choose Refresh licence and try Check now again. The version you have keeps working.

   - Refresh licence is the explicit confirmation that clears the hold at once.
   - Without it, the 30-minute schedule clears it once a due confirmation succeeds.
   - Check now stays available, and no Download button is offered while the update waits.
4. **Help > Licence and the update panel agree.** Help > Licence keeps "Pro licence · Updates
   through <date>". The update panel now says the licence covers the release instead of
   contradicting that date. ADR-623 Amendment 2 decision 3 still holds: nothing is shown
   unprompted while the computer is offline. The hold appears only in the update panel the
   customer opened.
5. **"Ended on" names only a date that has passed.** The `not-covered` sentence names the date the
   licence's updates ended only once that date is behind the computer's clock. Otherwise it says
   "your licence's updates don't cover it". A verified release is never dated more than five
   minutes after the check, so a `not-covered` release with a later end date comes from another
   refusal, such as a licence change still in progress. The panel must not invent an ended date
   for it.

### Consequences

- A paying customer whose weekly confirmation fails is told the truth, and what to do, instead of
  being told that their update year ended.
- The block itself is unchanged: paid and active-trial updates still wait for a successful
  confirmation, and Free devices and ended trials still update at once.
- The licence service is asked nothing new. Check now still does not run a confirmation; Refresh
  licence and the schedule do, as before.
- `CommercialUpdateStatus.state` gains one value that the renderer's status parser accepts. The
  renderer and main process ship in one build, so no older peer reads it.
- This decision operates no machine and changes no output. A licence or update never stops a
  running job.

### Tests

- `electron/licensing-update-confirmation.test.ts` runs the real licensing runtime and the real
  manual update service, wired as `desktop-licensing.ts` wires them, against a synthetic licence
  service (never the production one). It covers:
  - an offline confirmation, a 503 and a 429, for a paid licence, and an active trial offline;
  - the reconnect path: offline at launch, Check now, then Refresh licence;
  - a genuinely ended update year;
  - an uncovered release while the confirmation also fails;
  - a covered update with no confirmation due.
- `electron/commercial-update.test.ts` and `electron/platform-manual-update.test.ts` cover the
  other two lanes, and `electron/update-status.test.ts` the status mapping.
- `src/ui/licensing/update-status-text.test.ts` covers the new sentence, Check now, and the rule
  that no future date is called ended.
- `src/platform/electron/licensing.test.ts` covers the renderer's status parser.
