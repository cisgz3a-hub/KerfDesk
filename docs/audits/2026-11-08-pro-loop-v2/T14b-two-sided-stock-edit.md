# Pro loop v2 — T14b Two-sided split, then a stock edit

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-twosided.test.ts` (outside the repository): a 20 × 12 × 10 mm STL
  block split with the real store action (split 5, web 1, margin 4) on 14 mm stock, then the stock
  thickness edited and both sides compiled through `emitGcode`.
- **Governing:** ADR-580 Amendment 1 (CNC audit v1 F6-P1-1, fixed in #1420).
- **Counts:** 0 raised.

| Stock after the split | Side A deepest | Side B deepest | Material left between the floors |
|---|---|---|---|
| 14 mm (unchanged) | −7.000 | −6.000 | 1.000 mm |
| 18 mm | −9.000 | −8.000 | 1.000 mm |
| 12.5 mm | −6.250 | −5.250 | 1.000 mm |

Each side's depth follows the current stock, so the model stays centred and the holding web stays
exactly 1 mm. Before #1420 the 12.5 mm case cut the part free; it no longer does. Clean.
