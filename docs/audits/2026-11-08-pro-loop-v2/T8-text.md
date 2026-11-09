# Pro loop v2 — T8 Text tool

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-text.test.ts` (outside the repository): Roboto "OB8" at 20 mm
  through `textToPolylines`, then a 0.2 mm Scan Line fill through `emitGcode`, judged by the round's
  GRBL model and an even-odd point-in-glyph test on the rendered contours.
- **Counts:** 0 raised.

| Check | Result |
|---|---|
| Glyph contours | 8, every one closed, no missing characters |
| Fill stays inside the ink | 10,290 of 10,630 burn samples inside the glyphs; the 340 outside are row ends on the outline itself |
| Counters left unburned | burn length × interval = 201.6 mm², the glyphs' outer area minus their counters = 201.9 mm² |

The O, B and 8 keep their holes and the fill covers the letters, so the even-odd rule the fill uses
matches the font's contour winding. Clean.
