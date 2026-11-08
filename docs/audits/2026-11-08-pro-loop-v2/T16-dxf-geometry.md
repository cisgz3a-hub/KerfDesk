# Pro loop v2 — T16 Imported DXF geometry through Line with kerf

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-dxf.test.ts` (outside the repository): a hand-written DXF with a
  CIRCLE, a half-circle ARC, four LINEs forming a square left 0.01 mm open, and an LWPOLYLINE slot
  with bulges, through `parseDxf` and `emitGcode` with 0.1 mm kerf.
- **Counts:** 0 raised.

| Entity | Result |
|---|---|
| CIRCLE r 10 | closed, grown by the kerf: 63.42 mm burned (2π × 10.1 = 63.46; the chords account for the rest) |
| ARC r 5, 0–180° | open, cut on the line: 15.68 mm (π × 5 = 15.71) |
| Four LINEs, 0.01 mm gap | joined into one open outline, cut on the line (39.99 mm), with the `line-open-outline` warning in Job Review |
| LWPOLYLINE with bulges | skipped by the importer **because the hand-written fixture was malformed**; the importer's bulge handling is covered by `dxf-arc-bulges.test.ts`, which reads the writer's own bulge output back through `parseDxf`. Not re-raised. |

The open 0.01 mm square is the laser counterpart of ADR-672 (CNC outlines within 0.5 mm are closed).
A laser Line layer cuts it as drawn and says so; whether Line should close tiny gaps too is a
product question, not a defect: LightBurn also cuts an open path open and offers Auto-Join as a
separate edit.

Clean for the entities the fixture exercised correctly.
