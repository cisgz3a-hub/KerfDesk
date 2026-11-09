# Pro loop v2 — T15 Imported SVG geometry through Line and Fill

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-svg.test.ts` (outside the repository): a hand-written SVG with a
  circle, a two-arc path left 0.02 mm open before its `Z`, a cubic/smooth Bézier shape with a
  duplicated point, and a rotated rectangle in a transformed group, through the real import
  (`parseSvg` → `applySvgFragmentImport`) and `emitGcode`.
- **Counts:** 0 raised.

| Check | Result |
|---|---|
| Import | 1 object, 4 polylines, all 4 closed, 105 points, no warnings; the gap and the duplicate point are absorbed |
| Line, 0.1 mm kerf | 259.0 mm burned: the circle (63.5), the arc circle (63.5), the 12 × 8 rotated rectangle (40.8) and the Bézier shape, each grown by the kerf; no lit rapid |
| Fill, 0.5 mm interval | 2345 mm burned across the four regions, inside the import's bounds; no lit rapid |
| Placement | the 100 × 60 mm drawing lands centred on the 400 mm bed (x 155–230) |

Clean.
