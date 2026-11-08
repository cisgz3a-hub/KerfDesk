# Pro loop v1 — L3 Vector cut and fill

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` from `origin/main` `5f09e1110`
- **Scope:** `src/core/job/fill-hatching.ts`, `fill-overscan.ts`, kerf, tabs, leads, overcut and
  perforation as compiled into Line and Fill output
- **Lenses run:** L1 (ADR-626 leads, ADR-494 tabs, ADR-415 perforation), L3 (scanline against
  offset fill), L4 (winding, document order, nesting depth).
- **Counts:** 1 raised → P3 1 (not fixed: no ground-truth anchor).

## Headline

Cut order, kerf side, tabs, leads, overcut and perforation all compile as a laser cutter needs them.
The one note is a coverage asymmetry in Scan Line fills whose edges sit on the fill's global grid.

## Checks (40 mm square with a 16 mm hole, and a 60 mm / 40 mm / 12 mm island-in-hole)

| Check | Result |
|---|---|
| Inner first | the hole is cut before its outer every time, whatever the document order or winding |
| Kerf 0.1 mm | outer grows (79.9–120.1), hole shrinks (92.1–107.9), an island inside a hole grows again (93.9–106.1) |
| Two parts, two passes | each contour's passes run together, holes before outers |
| Tabs, 4 × 1 mm, skip inner | four gaps on the outer only, 156 mm cut of 160 |
| Leads and overcut | add only to their own contour (2 mm each); arc lead with kerf stays tangent |
| Perforation 2 / 1 mm | 2 mm burns, 1 mm gaps, round both contours |
| Fill styles | Scan Line, Offset and Island all fill 1344 mm² at 1 mm spacing; Cross-hatch doubles it |

## Findings

### P3-P3-1 — A Scan Line fill whose edge lies on its grid burns its first line on that edge

- **Where:** `src/core/job/fill-hatching.ts:133` snaps the first scanline to a multiple of the spacing
  so adjacent shapes share one grid.
- **Anchor:** Twin. The Offset fill of the same shape starts half a spacing inside the edge
  (`ring-fill-offset`: first ring 91.5–108.5 inside a 92–108 hole), and image rows sit at pixel-row
  centres (L2). The Scan Line fill of a 40 mm square placed on whole millimetres burns lines at
  y = 280, 281 … 319: the first on the bottom edge, so half the beam lands outside the shape, and the
  top band of one spacing is left unburned.
- **Scenario:** a design snapped to a millimetre grid, 0.5 mm or 1 mm interval. The fill's bottom edge
  is burned on the line; its top edge stops one interval short.
- **Evidence:** REPRO, `audit/loop-v1/loop3-vector.test.ts` (`ring-fill`).
- **Why not fixed:** a half-spacing grid offset ((k + ½) × spacing) would keep adjacent shapes seamless
  and centre the coverage on grid-aligned edges, but it moves every Scan Line fill by half an interval,
  and no primary source says what LightBurn does here. A maintainer decision, not a defect proven
  against an outside reference.

## Verified clean

Everything in the table.
