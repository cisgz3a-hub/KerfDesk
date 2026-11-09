# Pro loop v2 — T12b Adaptive clearing with islands

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-adaptive.test.ts` (outside the repository): a 100 × 60 mm pocket
  with two islands (12 × 20 and 15 × 12 mm), 3 mm deep, adaptive strategy, radial load 30 % of the
  bit; the cutter is stamped every 0.05 mm and the fresh material across each move is measured.
- **Counts:** 0 raised.

| Bit | Island cells cut | Cells cut outside | Floor cells uncut, away from walls | Widest fresh cut | Full-width moves |
|---|---|---|---|---|---|
| 1/8" | 0 | 0 | 0 of 486,896 | 3.17 mm | 6 of 655 |
| 1/4" | 0 | 0 | 0 of 413,744 | 6.20 mm | 6 of 278 |

The six full-width moves per bit are the seed slots that open each of the seven island partitions.
Job Review says so before Start: "Island adaptive uses 7 verified partitions with independent entries
and plunge-feed seed slotting that may engage full cutter width … Adjust Radial engagement or choose
another fill method." Every other move stays within the radial load. The CNC v1 F2 fixes (#1421) hold:
no pin of stock between partitions, no wall ring cut before its pocket is cleared.

Clean: complete coverage, islands and outside untouched, and the one full-width case is disclosed.
