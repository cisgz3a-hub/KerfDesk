# Pro loop v2 — T5 leads and overcut, T6 perforation, T9 nested cut order

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-tools-b.test.ts` (outside the repository), `emitGcode` plus the
  round's GRBL model.
- **Counts:** 0 raised.

## T5 Leads and overcut with kerf

A 40 mm part with a 16 mm hole; kerf 0.1 mm, 2 mm line leads in and out at 90°, side Automatic,
1 mm overcut.

| Contour | Offset outline | Burn length | First burned point |
|---|---|---|---|
| Hole | 15.8 mm (shrunk 0.1 per side) | 68.200 = 63.2 + 2 + 2 + 1 | inside the hole, on the scrap |
| Part | 40.2 mm (grown 0.1 per side) | 165.800 = 160.8 + 2 + 2 + 1 | outside the part, on the scrap |

Automatic puts each lead on the scrap side, as ADR-626 says and as LightBurn's lead-in guidance
intends: the lead's pierce mark falls on material that is thrown away.

## T6 Perforation with two passes

3 mm burns, 2 mm gaps on an 80 mm outline, two passes: 32 burns, 96.00 mm in total (2 × 80 × 3/5),
and the second pass repeats the first pass's dashes exactly, so the gaps stay uncut.

## T9 Cut order across nested parts

Part B (12 mm with a 4 mm hole) sits inside the 24 mm hole of part A (50 mm). Cut order by contour
width: 4 → 12 → 24 → 50 mm. Every hole is cut before the outline that holds it, and the inner part is
cut free before the hole around it, which LightBurn's "Cut inner shapes first" also does.

## Verified clean

All three.
