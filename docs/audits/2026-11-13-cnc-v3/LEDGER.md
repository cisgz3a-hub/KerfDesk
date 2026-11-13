# CNC audit v3 — ledger

Plan: [AREAS.md](AREAS.md). Severity follows [METHOD.md §3](../2026-10-21-rolling-v2/METHOD.md):
- **P1:** harms a job, loses work or exposes a secret, or lets such a defect reach `main` unchecked. There is no reach clause, and a visible result is not a warning.
- **P2:** a real defect with limited harm. A test gap behind correct code is P2 at most.
- **P3:** structural.

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| N1 | J1 refutation and every tab path | origin/main @ 9a0b1a80b (auditor and refuter). The coordinator re-read 3464b48e4: no tab, contour or warning file changed. Both wrote their own G-code reader through the real CNC compile; the refuter measured the material each tab leaves (cross-section, and whether the part is still attached), with J1's oracle as a second reader on six programs (agreement within 0.06 mm²) | [N1-j1-refute-and-tabs.md](N1-j1-refute-and-tabs.md) | 6 | 0 | 2 | 1 | 3 | 5 |
| **Total** | | | | **6** | **0** | **2** | **1** | **3** | **5** |

## CNC v2 (J1) findings, now refuted independently

| J1 item | Verdict on main | Fix status |
|---|---|---|
| J1-P1-1 tabs swallow small holes and parts | **CONFIRMED, P1.** Exact threshold: a hole under n·(W+D)/π + D, a part under n·(W+D)/π − D (n tabs of width W, bit D). Defaults: 14.86 mm holes, 8.51 mm parts; with the ¼" bit every hole under 22 mm stays uncut. The warning (`cnc-full-tab-coverage-warnings.ts:76-77`) fires only when a whole layer never cuts below the tab top | proposed in a CNC tabs card |
| J1-P2-1 V-carve at exactly the stock bottom: no warning | **CONFIRMED, P2** (`cnc-compiled-depth-warnings.ts:120`, `warnAtStockBottom` relief-only) | proposed in a CNC depth-warnings card |
| J1-P3-1 a fully tabbed loop re-cut at the tab top per level | CONFIRMED, P3 | P3 sweep |
| J1-P3-2 inlay "Radial fit gap" seats the plug deeper | **Narrowed:** the tooltip has disclosed it since #1418. Still open: a fit gap over glue · tan(half angle) leaves a seam with no note. P3 | P3 sweep |
| J1-P3-3 real 6.35 mm stock reads as never set | CONFIRMED and wider: a 3 mm groove in real 6.35 mm stock also gets 2 mm tab bumps. P3 | **maintainer decision** (changes what a saved thickness means) |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| N1-P2-1→P1 (refuter) | N1 | **Tabs land on corners, and at widths the field allows a part is cut completely free with no warning.** With a cut direction set (default Climb), each loop starts mid-way along its longest edge, so the default 4 tabs sit on or across the corners of squares and near-square rectangles. At defaults the corner tab keeps about 7.2 of 12 mm² (60 %) and still holds by the refuter's load estimate. But a square with 1 mm tabs on the ⅛" bit, or 2.5 mm tabs on the ¼" bit, is cut free; a plate with a square hole loses both the plate and the slug; a 3-tab triangle on the ¼" bit loses a tab even at the default 6 mm. Job Review still lists the tabs, because the program still lifts at each one. "Default direction" holds the same parts. | **READ** on main `3464b48e4`: `motion-polish.ts:74` calls `rotateStartToLongestSegment` for every closed loop once a cut direction is set, moving its start to the longest edge's midpoint; the automatic tabs are then spaced along the perimeter from that start (`cnc-tabs.ts` `splitPassForTabs` → `applyAutomaticTabsToPolylines`). Auditor and refuter **REPRO** (own readers; the refuter's holding cross-section; J1's oracle agrees). | proposed in a CNC tabs card. Fix: keep tabs off corners (place them by arc length away from vertices, or seed them before the seam rotation) and warn when a tab's holding section falls below a floor |
| N1-P2-2→P1 (refuter) | N1 | **An outline that stops 0–3 mm short of its start, cut On path or Outside with Tabs on, is freed with no tabs and no warning.** The same cut with Tabs off warns that the part comes free. SVG import closes a path only when its ends meet within 0.0001 mm, so this is easy to hit (meta audit v1 M6-P1-2 rated near-closed outlines P1). | **READ** on main: `cnc-tabs.ts:129` `splitPassForTabs` returns an open polyline unsplit (`if (!polyline.closed) return [polyline]`), so it gets no tabs, and ADR-258 Amendment 4 limits the Tabs-on warning to closed shapes. Auditor and refuter **REPRO**. | proposed in the CNC tabs card. Fix: give the Tabs-on case the same "part comes free" warning as Tabs off, and consider treating a gap under the bit diameter as closed for tabs. ADR-258 Amd 4's scope needs revisiting |
| N1-P2-3 | N1 | **Default arc leads thin the two tabs beside the seam on small holes** (Ø16: 6.68 mm² against 10.5 with leads off). A lead radius of 4.5 mm or more erases them on a Ø18 hole; the other tabs still held the slug in every probe. Outside cuts are not affected. | Auditor and refuter **REPRO**. | proposed in the CNC tabs card. Fix: keep leads clear of the tab spans, or move the seam between tabs |

### P3s (6, plus J1's three)

- **N1-P3-1:** a shape whose offset splits into two loops gets the full tab count on each loop, and a dragged tab is copied onto every loop.
- **N1-P3-2:** "Edit positions" says it shows the tabs, but it seeds new positions, so one click changes the program.
- **N1-P3-3:** the Tab height tooltip and tutorial say "measured from the cut floor"; with stock thickness set it is measured from the stock bottom, and halved when the tab is as thick as the stock.
- J1-P3-1, J1-P3-2 (narrowed) and J1-P3-3 (maintainer decision), above.

### Verified clean

- **Tab height** is right everywhere measured: default and set stock, overcut, the half-stock rule, skipped tabs and no-tab warnings.
- **No program** lowers the head into a tab, cuts kept material or rapids into stock.
- **Placement:** ramps, finish allowance and curves place tabs correctly, and manual tabs stay on their anchors under rotation, scaling and mirroring.
- **New-gap search (refuter):** two layers on one shape, long strips, very large parts, a layer with its own bit and finish allowance show nothing.

### Not verified

- A physical strength test; the load estimate for corner tabs is arithmetic.
- V-bit profile, relief-projection, tiled and multi-tool tabs (tiling read only).
- Machine runs on the simulator (N5) and the rendered Job Review dialog.
