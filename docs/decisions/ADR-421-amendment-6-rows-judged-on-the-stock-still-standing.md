## ADR-421 Amendment 6 - Each finishing row is judged on the stock still standing when it arrives (2026-11-14)

**Status:** Accepted; software-verified through analytic G-code stock simulation tests, hardware
qualification pending. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 verification findings N8-P3-1 (P3) and N8-P3-2 (P3), both on Amendment 5.

Amends ADR-421 Amendment 5. The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21)
is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

Amendment 5 stepped a finishing row down wherever the stock the previous bit left under its tip
stood more than one Depth per pass above it. It read that stock as roughing left it, for every
row at once. On a back-and-forth finish the earlier rows' flanks take most of a terrace before
the next row's tip gets there. So the rule added levels where the tip never met a full pass. The
N8 verification found:

- Every relief finishing program got 1–31 % longer (N8-P3-1).
- The ⅛" ball after the ⅛" rougher on the N2 refuter's pyramid met at most 0.60 mm under its tip.
  It still got one step-down level (+22 % path) and the "under the … finishing bit's path" note.
- Gating the rule to pointed bits is not an option. The ⅛" ball on a 10° or 30° ramp does meet
  2.2–2.4 mm under its tip per row without the rule.

Amendment 5 also stated its measure two ways (N8-P3-2). The Verification measure said "the stock
one pass takes off a cell under the tip in all: the feed moves between two rapids". The
Consequences said "no lateral move takes more than 1.5 mm". A back-and-forth finish links its
rows with no rapid between them. Read literally, "between two rapids" then sums every row's flank
cut on a cell. The N8 verifier's reading of that gave 86.8 mm over 1.55 mm, peak 3.85. The
per-row measure the tests meant stayed at or under 1.50 mm.

### Decision

1. **A row is where the path holds its heading.** A finishing (or rest) stretch is cut into rows
   where its path turns more than 60° from the heading the row started on. A raster's row ends at
   its link to the next row; a contour's row is an arc of at most about 60°.
2. **Each row is judged on the stock still standing when it arrives.** The step-down sweeps the
   rows in program order over a copy of the previous bit's stock. Each row's tip reads that copy
   (the same cells round the tip as Amendment 5) before the row itself is swept in. The copy
   stays an upper bound of the real stock anywhere in a cell:
   - each segment is swept at its higher end;
   - a cell is lowered only to where the cutter stands over its farthest corner.
   A small bit, whose cutter covers few whole cells, lowers little and keeps most of Amendment 5's
   levels.
3. **Where a point still meets more than one Depth per pass, nothing else changes.** Its levels
   start from the previous bit's stock, as in Amendment 5, because the levels run before any
   finishing row. The missed-region contact of Amendments 2 and 4 and the path-only note are
   unchanged. No bit kind is exempt.
4. **The promise is per row (N8-P3-2).** No finishing row takes more than one Depth per pass off
   a cell under its tip. A row is the feed moves between two rapids, cut where the path turns more
   than 60° from the heading the row started on. This replaces Amendment 5's "the feed moves
   between two rapids" and "no lateral move takes more than 1.5 mm". What an earlier row's flank
   took off a cell is not the later row's load.

### Verification measure

The analytic G-code stock simulator (`relief-gcode-stock.test-support.ts`) counts the stock one
row takes off each cell, with rows cut exactly as in Decision 4. It reads that total under the
centre of every lateral move. The N7 tests keep a 0.1 mm grid slack (1.6 mm for a 1.5 mm pass).

The N8 verifier's second measure (the N2 refuter's row sweep) is not this one. It counts what
the same row's flank and descent take after a level pass, and still finds short stretches over a
pass, for example 8.8 mm at up to 1.98 mm along the pyramid's boundary wall for the 60° V-bit.
This ADR does not promise that measure.

### Consequences

- In `prepare-relief-n7-under-tip.test.ts`, simulated from the emitted G-code:
  - the ⅛" ball on the pyramid gets no step-down level and no path note. Before this amendment it
    got one level (40 stretches);
  - the ⅛" ball on a 10° and a 30° ramp still steps down and stays within 1.6 mm. With the path
    rule switched off, its rows take 2.20 and 2.34 mm;
  - Amendment 5's five cases still stay within 1.6 mm per row: the 60° V-bit and 30° engraver on
    the pyramid, and the V-bit, 1 mm-tip tapered ball and 1 mm ball on the ellipse.
- Sweeping the standing stock is one more pass over the rows, using the roughing reach's own
  stamp. It runs only when finishing is planned.
- Not verified on hardware.
