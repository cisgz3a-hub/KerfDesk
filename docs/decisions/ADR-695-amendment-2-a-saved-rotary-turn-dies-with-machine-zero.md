## ADR-695 Amendment 2 - A saved rotary turn dies with machine zero; the turn-back waits for its motion; a Z-rotary Frame ignores its own Z (2026-11-11)

**Status:** Accepted; simulator evidence with the real store and Frame. No hardware. |
**Date:** 2026-11-11

Follows rolling audit v14 findings Z2-P1-1 (P1), Z2-P2-1 (P2), Z2-P3-2 (raised to P2 by the
refuter) and Z2-P3-1 (P3) (`docs/audits/2026-11-10-rolling-v14/Z2-rotary-resume-verify.md`).
Amends Amendment 1 Decisions 1 to 4, and Decision 6 of ADR-695 for Z. Keeps ADR-341 Amendment 14's
exclusion of rotary jobs from the automatic Abort restore.

### Context

- **Z2-P1-1.** Amendment 1 saved the turn a stopped A or Z job started from in machine
  coordinates, but without the machine-zero epoch that its X/Y origin carries (ADR-341 Amendment
  13). A power-up or port reopen between the Abort and the re-run clears machine position. Stock
  GRBL clears it at power-up, though not at the soft reset. After that:
  - Job Review and the Frame offer named the wrong turn.
  - Start from line wrote `G53 G0 A<stale>`.
  - Where the Frame offer homes first, it turned the part to the wrong turn and said it had turned
    it back. The error was 11–94 mm round an Ø60 part.
- **Z2-P2-1.** The turn-back jog waited the 3 s meant for a status burst, so a correct turn of more
  than about 75° on A at 1500 °/min ended with "The rotary did not finish turning back".
- **Z2-P3-2.** A Frame on a Z rotary opens with `G92 Z0`. The Frame's completion compared the Z
  work offset and work Z before and after, so the first Frame after any turn change was refused as
  "Controller or machine setup changed during Frame". A is never in those snapshots.

### Decision

1. **The turn carries its epoch.** `RotaryStartTurn.machineZeroEpoch` is the store's
   `machineZeroEpoch` when the Abort read the turn. A later epoch makes the turn stale.
2. **A stale turn is never jogged to.**
   - Restore saved origin (card and Frame offer) restores X/Y and leaves the part where it is.
   - `turnRotaryBackToJobStart` refuses a stale turn outright.
   - Start from line gets no turn, so it is refused (Amendment 1 Decision 4).
   - Job Review and the Frame offer say that the controller restarted, and that the part must be
     turned back to where that job started by hand, or set up again.
3. **The turn-back waits for its motion:** |turn| ÷ feed × 1.5 plus 5 s. `waitForControllerStatus`
   takes a timeout for that.
4. **A Z-rotary Frame ignores Z.** The Frame's completion check sets Z to 0 in both snapshots when
   the framed job's rotary turns on Z. X, Y, the session, the origin source and the epochs stay
   checked.
5. **Wording.** On A or Z, the Restore button's tooltip says the rotary then turns the part back.

### Consequences

- An Abort followed by a power cycle on A or Z ends with the operator turning the part by eye, as on
  a Y-port rotary whose machine position was lost. KerfDesk says so instead of guessing.
- The interrupted job's Review recovery on A or Z is still a dead end (Z2-P3-3). It goes to the P3
  sweep.
