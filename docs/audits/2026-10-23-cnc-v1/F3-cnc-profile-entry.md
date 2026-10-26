# CNC audit v1 — F3 Profile side, direction, tabs and entry

- **When:** 2026-10-23 09:55 +0800   **Tree:** origin/main @ `17f4d6b68` (worktree HEAD `2ad5bca8d`;
  `git diff HEAD origin/main` is empty for `src/core/cnc`, `src/core/output`, `src/core/sim`,
  `src/ui/layers` and `src/ui/tutorials`; the differences are laser-job files only)
- **Scope:** `src/core/cnc/profile-paths.ts`, `profile-ordering.ts`, `profile-finishing-stage.ts`,
  `closed-contour-cut-types.ts`, `cnc-tabs.ts`, `cnc-tab-ramp.ts`, `cnc-tab-anchors.ts`,
  `cnc-manual-tab-mapping.ts`, `compiled-tab-rises.ts`, `tabbed-ramp-entry.ts`, `contour-ramp-entry.ts`,
  `contour-ramp-precision.ts`, `helical-entry.ts`, `cnc-helical-pocket-passes.ts`,
  `cnc-helical-issues.ts`, and the profile part of `compile-cnc-layer-passes.ts`,
  `compile-cnc-layer-group.ts` and `compile-cnc-job.ts`. Twins were followed into
  `finish-allowance*.ts`, `motion-polish.ts` (direction, ramp), `geometry/kerf-offset.ts`,
  `output/cnc-grbl-strategy.ts` / `cnc-grbl-helical.ts`, `job/toolpath.ts` and `sim/stamp-toolpath.ts`.
  Lead-ins were checked only where they meet tabs and ramps.
  - Governing: ADR-140 and Amendment 1 (finish allowance), ADR-152 (helical entry), ADR-156
    (manual tabs), ADR-250 Amendment 2 (a ramp owns the entry), ADR-251/252 (climb, hole winding),
    ADR-258 and Amendments 1–4 (tabs), ADR-276 (part order), ADR-368 Amendment 2 item 5 (tab
    windows), ADR-471 (ramp laps), ADR-491 (stay-down links), WORKFLOW.md profile edges
    (lines 5355-5385), PROJECT.md non-negotiable 5 (determinism).
  - Ground truth: PTC Creo profile milling help (climb definition), Vectric 2D Profile help
    (side, nesting, allowance, tabs), Autodesk Fusion 2D Contour reference (finishing passes,
    ramp angle, tabs).
- **Lenses run:** L1, L2, L3, L4 and L7, each as its own pass. L5 not run: no untrusted input
  enters beyond loader-normalised settings (`normalize-layer.ts:119-157` keeps tab width and height
  positive, tabs per shape a positive integer, ramp positive). L6 not run: plan and offset failures
  surface through the known JR-4 / empty-layer diagnostics.
- **Method:** every design was compiled with `compileCncJob` and emitted with
  `cncGrblStrategy.emit`. An independent harness (`zz-f3-harness.ts`; it imports only the compile
  and emit entry points, the contour collector and the origin transform) then checked the G-code
  text:
  - **Parser:** G0/G1/G2/G3, G17 arcs and helices expanded at 0.02 mm.
  - **Side and size:** every cutting sample's distance to the design boundary minus the cutter
    radius (gouge), whether it lies on the kept side, and the "wall residual" (distance from each
    design-wall point to the nearest full-depth cutter centre, minus r).
  - **Direction:** each full-depth move whose midpoint sits r (or r + allowance) from the wall is
    classified by which side of travel the kept material lies on, in the physical top view
    (machine → scene → +Y away). Climb = kept wall on the right (clockwise spindle).
  - **Tabs:** rise/fall pairs per pass, window length along the path, bridge width
    (distance between the cutter discs at the window ends), and a 0.05–0.1 mm cutter-disc floor
    raster. A bottom-layer flood fill from the sheet decides whether each part is still held.
  - **Ramps and helices:** per-move descent angle, helix centre, radius, wall clearance and
    descent per revolution from the arc words.
  - **Twin:** `buildToolpath` (preview) and `computeRemovalGrid` (the 3D viewer's source) on the
    same Job.
- **Counts:** 6 raised → 0 refuted (refuter: 6 CONFIRMED, 0 PLAUSIBLE; no severity changes; P3-4's
  diameter window corrected to 5.8–6.4 mm) → P1 1 / P2 1 / P3 4 (+3 KNOWN re-observed).

## Headline

Side, size and direction are right: in 21 compiled programs no cutting move came closer than the
cutter radius to a kept wall (worst −0.002 mm, output rounding). Straight walls finished within
0.001 mm of the drawing, and only the r(√2 − 1) = 0.658 mm fillet a round bit must leave stayed in
sharp inside corners. Climb kept the wall on the right in every case, including mirrored, rotated
and reversed artwork and all four non-centre origins.

The defects are in how the finish allowance meets tabs and stock:

- **Parts come free with tabs on (raised P1).** With a finish allowance, two parts spaced between
  one cutter width and one cutter width plus twice the allowance apart share one roughing ring.
  Their finishing tabs are then placed with no reference to the roughing tabs. Each pass's slot
  cuts through the other pass's bridges, and a part is left with no bridge at all.
- **A large allowance is "finished" as a full-depth slot (P2).** At an allowance of one cutter
  width or more, the roughing ring and the finishing ring no longer touch. A ring of stock stays
  standing between them, and the finishing pass cuts full width at full depth in one pass. Its
  entry plunges into solid stock.

Nothing warns about either.

## Findings

### F3-P1-1 — With a finish allowance, a part placed between one and one-plus-two-allowances cutter widths from its neighbour is cut free despite holding tabs

- **Where:**
  - `src/core/cnc/finish-allowance.ts:44-46`: rough and finish toolpaths are grouped into parts
    separately and bucketed back to source parts.
  - `src/core/cnc/finish-allowance.ts:49-60`: each part's finishing passes are built from that
    part's own roughing bucket.
  - `src/core/cnc/finish-allowance.ts:188-191`: the finishing tab centres come from
    `tabFractionsFromReference(toolpath, roughingToolpaths, …)` over that bucket. An empty bucket
    falls back to even spacing from the finishing ring's own seam.
  - `src/core/cnc/finish-allowance-part-buckets.ts:30-37`: a merged roughing ring is given to one
    source part only.
  - `src/core/cnc/cnc-tab-ramp.ts:87-102`: the projection of roughing anchors onto a finishing
    ring.
- **Anchor:** Contract.
  - ADR-140 Decision: the finishing pass "projects the deepest roughing path's physical
    tab-center anchors onto the true contour", which "preserves tab locations".
  - ADR-258 Decision: "Finishing tab centres are still projected from the matching roughing
    toolpath". ADR-258's reason for default-on tabs is that a full-depth profile must not free
    the part under a running spindle.
  - ADR-140: the finishing pass "is appended after the roughing passes". Here one part's
    finishing ring runs before any roughing.
- **Scenario:**
  - Settings: outside profile, 1/8" end mill, 6.35 mm deep (the shipped stock) at 2 mm per pass,
    default tabs (4 per shape, 6 × 2 mm), finish allowance 0.5 mm.
  - Design: two 40 × 30 mm parts 3.6–3.7 mm apart.
  - The roughing offset (r + a = 2.088 mm) closes the gap, so roughing becomes one ring round both
    parts. The finishing offset (r) keeps two rings.
  - Emitted order (`hold-gap3_6.nc`):
    1. Part 0's true-wall ring first, on the depth ladder (lines 18–131). Its four windows wrap
       its corners: rises at lines 105, 110, 115 and so on.
    2. The merged roughing ring (lines 132–266). Its windows are at x 106.7–115.9 (top and bottom
       of part 0) and x 167.7–176.9 (part 1): lines 240, 246, 250 and 256.
    3. Part 1's true-wall ring (lines 267–).
  - No part-0 finishing window overlaps a roughing window:
    - The roughing slot (0.5–3.675 mm from the wall) cuts through every finishing bridge.
    - Part 0's earlier finishing slot (0–3.175 mm) has already cut through both roughing bridges
      beside it.
    - Part 0 therefore loses its last hold during the merged ring's −6 and −6.35 mm passes, with the
      bit running round it.
  - Preflight reports nothing, and the machine-job warnings are empty. Job Review still lists the
    tabs, because the passes do rise.
- **Evidence:** REPRO.
  - Two independent lines of evidence:
    1. Parsed G-code → cutter-disc floor raster → bottom-layer flood fill from the sheet
       (`zz-f3-hold.test.ts`, `zz-f3-holdsweep.test.ts`).
    2. The app's own `computeRemovalGrid(buildToolpath(job))`, the 3D viewer's source, flood-filled
       the same way (`zz-f3-hold3.test.ts`).
  - Outputs:
    - `hold gap3_6: part0:FREE part1:HELD`
    - `hold3 (app removal grid, 3D viewer source) gap3.7 a0.5: part0:FREE part1:HELD`
    - controls: `gap3.7 a0 control: part0:HELD part1:HELD`, `gap5.2 a0.5 control: … HELD`,
      `single: part0:HELD`
  - The sweep frees a part exactly when the gap lies between D and D + 2a:
    - a 0.3 mm: FREE at 3.3–3.7 mm, HELD at 3.1 and 3.9 mm.
    - a 0.5 mm: FREE at 3.3–4.1 mm, HELD at 4.3 and 5.2 mm.
    - a 1.0 mm: FREE at 3.3–4.3 mm, HELD at 5.2 mm.
    - 1/4" bit, a 1 mm, gap 7.5 mm: part 1 FREE.
    - Three 30 mm squares 3.8 mm apart: all three FREE.
    - A 40 × 30 next to a 20 × 50 part: one FREE.
    - With 2 or 8 tabs per shape the windows happened to line up, and the parts were held.
  - The bottom-layer map is `hold2-map.txt`. `zz-f3-warn`: `twoPartsGap3_7Allow05Tabs: preflight [] | jobWarnings []`.
  - Novelty: no audit names it, and there are 0 open PRs (`gh pr list --state open`).
- **Reach:** finish allowance is an Advanced setting, off by default. The gap window is narrow
  (3.18–4.18 mm with a 1/8" bit and 0.5 mm), but it is where an operator lands after widening
  Quick Nest's 2 mm CNC spacing (2026-09-29 P2-review-3) "just past the bit".
- **Refuter:** **CONFIRMED** (REPRO with an independent checker, plus READ); **P1 kept**. What would
  refute it: tabs placed once per source contour, a later pass that leaves a bridge, an app output
  path that differs from the direct emit, a warning somewhere, or a raster that over-cuts bridges.
  None holds.
  - **Independent check** (`zz-f3r-hold.test.ts`, deleted after the run; programs and log in
    `scratchpad/f3r/`).
    - Its own G-code parser handles G0–G3, with arcs cut into 0.05 mm chords.
    - Each move is stamped as a capsule of radius r − 0.05 mm, and again at r − 0.25 mm. Both
      under-cut, so they favour bridges. Cells are 0.05 mm.
    - An 8-connected flood fill runs over the stock left at full depth. Any solid region that does
      not touch the raster edge is free.
    - Two 40 × 30 parts, 1/8" bit, 6.35 mm at 2 mm per pass, default tabs, 0.5 mm allowance:
      - Gaps 3.3, 3.6, 3.9 and 4.1 mm each leave one enclosed region of 1217 mm² (1246 mm² at
        r − 0.25). That is part 0 plus its skin, machine x 99.6–140.5.
      - Held controls: gaps 3.1, 4.3 and 5.2 mm; allowance 0 at 3.6 mm; a single part.
    - The app's own `emitGcode` (prepareOutput, then emit and preflight) gives a byte-identical
      program, `preflight.ok = true` with no issues, and `detectMachineJobWarnings` returns `[]`.
    - A check after every retract shows part 0 first enclosed after lines 230–266, the merged
      ring's Z-6.35 pass. The merged ring's remaining work and part 1's finishing then run beside
      the loose part.
    - In the program, part 0's finishing windows wrap its four corners (lines 68–85 and 105–122).
      The merged ring's windows are at x 106.7–115.9 and 167.7–176.9 (lines 203–220 and 240–257).
      None of them overlap.
  - **Reach is wider than two parts side by side.**
    - A 3 × 2 grid of 30 mm squares 3.5 mm apart at 0.5 mm, and the same grid 3.3 mm apart at
      0.25 mm: all six parts come off the sheet together as one 5580 mm² region.
    - 1/4" bit, two 60 × 40 parts 6.6 mm apart, 0.25 mm allowance: part 1 is free.
    - 0.2 mm allowance at a 3.4 mm gap, and 0.1 mm at 3.25 mm: part 0 is free. The window is 2a
      wide, so it shrinks with the allowance but never closes.
    - A single inside-profile dumbbell (two 20 mm lobes joined by a 3.6 mm neck) at 0.5 mm leaves
      one lobe's 165 mm² slug loose. With no allowance it is held. Here the neck splits roughing
      into two rings, and `closestClosedReference` (`cnc-tab-ramp.ts:106-121`) projects the
      anchors of only one of them onto the single finishing ring. Same root cause.
    - These happened to hold, because their tab windows lined up: 6 tabs per shape; two 50 mm
      squares 3.5 mm apart; a 2 × 2 grid of 30 mm discs 3.6 mm apart; a 3.6 mm notch in one part;
      a part in a 3.6 mm wide hole.
  - **Finishing does keep tabs.** Every finishing pass below the tab top rises (Z-4.35). The defect
    is where the tabs go, not whether they exist. ADR-140 and ADR-258 require finishing tabs, so
    "finishing should drop tabs" is no defence.
  - **No warning.**
    - `runCncPreflight`, and the preflight on the app path, report nothing.
    - The machine-job warnings are empty.
    - The Tabs card (`CncTabFields.tsx`) and Job Review show tabs as on.
    - No code compares part spacing with D + 2a.
  - **Severity: P1 kept.**
    - METHOD §3 sets P1 for silently wrong physical output, and severity follows the failure
      scenario. Here the operator turned tabs on, and Job Review says they are on. Yet a part, or a
      whole grid of parts, is cut loose while the spindle is still running beside it. That is the
      hazard ADR-258 gives as its reason for turning tabs on by default.
    - Reach is narrow. Finish allowance is an Advanced setting, off by default. The spacing must
      fall in a 2a-wide window, and the tab windows must miss each other. The coordinator may weigh
      this, but the window catches whole nested grids and nothing warns.
- **Fix direction:**
  - Place automatic tab anchors once per source contour, the way manual anchors already work:
    they landed within 0.001 mm of the anchor on roughing and finishing, mirrored or rotated, in
    `zz-f3-anchors`. Project them onto every roughing and finishing ring that borders that
    contour.
  - Add a held-part connectivity test for two parts spaced between D and D + 2a.

### F3-P2-1 — A finish allowance of one cutter diameter or more leaves a full-depth ring of stock, and the finishing pass slots full width at full depth in one pass

- **Where:**
  - `src/core/cnc/finish-allowance.ts:135-140`: reach = r + a. A finishing ring lies exactly a from
    its roughing ring, so it always reads as covered and is cut in one full-depth pass.
  - `src/core/cnc/finish-allowance-coverage.ts:1-10`: the premise that roughing "already cleared
    all but the allowance beside the wall".
  - `src/ui/layers/CncFinishAllowanceField.tsx:9`: the field accepts up to 10 mm with no check
    against the bit.
- **Anchor:** Contract.
  - ADR-140 Amendment 1 Context and Decision 1: one full-depth finishing pass is only valid while
    "the finishing cutter only takes that thin skin". Otherwise the finishing path follows the depth
    ladder. That amendment exists because a finishing pass at 200 % of D per pass was reached.
  - Geometry: roughing removes [a, a + D] from the wall and finishing removes [0, D]. For a > D,
    the band [D, a] is never cut and the finishing cutter has stock on both sides.
- **Scenario:**
  - 40 × 30 mm outside profile, 6.35 mm deep at 2 mm per pass, tabs off.
  - 1/8" bit with a 4 mm allowance:
    - The roughing ring sits 5.588 mm from the wall.
    - The finishing pass plunges `G1 Z-6.350 F300` (`finish-allow4.nc` line 102) at its lead point
      3.175 mm from the wall. The cutter there spans 1.59–4.76 mm from the wall and the roughing
      slot starts at 4 mm, so it plunges mostly into solid stock.
    - It then cuts the whole perimeter full width, 6.35 mm (2 × D) deep, at F1000.
    - A 0.825 mm ring (140 mm²) stands to full depth between the two slots. It is loose once both
      slots go through.
  - 1/16" bit with a 2 mm allowance: the slot is 4 × D deep, and a 0.41 mm ring (68.5 mm²) is left.
  - For r < a ≤ D no ring is left, but the finishing engagement is a (more than r) at full depth in
    one pass.
  - Preflight reports nothing. The only machine-job warning is the generic "no holding tabs".
- **Evidence:** REPRO, `zz-f3-finish.test.ts`. Output:
  - `finish allow4: … uncut waste-band area at full depth 140.32 mm2`
  - `allow1sixteenth: … 68.51 mm2`
  - `allow2: … 0 mm2`
  - `zz-f3-warn: allow4: preflight [] | jobWarnings ["Layer L1 cuts through the stock … with no holding tabs …"]`
- **Reach:** usual allowances (0.1–0.5 mm) are far below D. The field accepts any value up to
  10 mm, and small bits reach the condition at 1.6–2 mm.
- **Refuter:** **CONFIRMED** (REPRO with an independent checker, plus READ); P2 kept. What would
  refute it: a check that refuses or warns when the allowance reaches D, a reach rule that steps
  the finishing pass down, or a later pass that clears the band. None holds.
  - **Repro.** 40 × 30 mm outside profile, 6.35 mm deep at 2 mm per pass, tabs off, run through
    the app's `emitGcode`. Engagement was measured on the refuter's own height field: the share of
    the cutter disc over uncut stock, sampled every 0.5 mm along the finishing ring before it runs.
    - **1/8" bit, 4 mm allowance.**
      - Four roughing passes, then one finishing pass at Z-6.35 (lines 102–119).
      - Engagement averages 99.8 % (maximum 100 %): a full-width slot, 2 × D deep, in one pass at
        F1000.
      - The entry `G1 Z-6.350 F300` at (118.413, 303.175) is 3.175 mm from the wall. The roughing
        slot starts 4 mm from the wall, so about 81 % of the plunging disc is over uncut stock.
      - A ring of stock is left standing to full depth between the two slots: 152 mm² with the
        refuter's under-cutting stamp, against the auditor's 140 mm².
    - **1/8" bit, 3 mm allowance:** engagement 96.5 %, no ring.
    - **1/8" bit, 2 mm allowance:** engagement 64 % (a/D) at full depth in one pass, no ring.
    - **1/8" bit, 0.5 mm control:** engagement 9 %.
    - **1/16" bit, 2 mm allowance:** engagement 99.8 % at 4 × D deep, with a 76 mm² ring.
    - **Tabs on, 4 mm allowance:** the bridges hold the ring, but the finishing pass still slots at
      99.8 %.
  - **Bounds.**
    - `CncFinishAllowanceField.tsx:9,24-25` clamps the field to 0–10 mm, with no reference to the
      bit.
    - `normalize-layer.ts:171-172` accepts any non-negative value from a file.
    - Every finishing path lies exactly a from its roughing path, so the reach of r + a
      (`finish-allowance.ts:135-140`) always reads as covered.
    - The preflight passes with no issues. The only machine-job warning is the generic tabs-off
      one.
  - **Severity: P2 kept.**
    - The input is unusual: an allowance at or above D, or above r for the heavy engagement.
    - But the field allows it, and the tooltip promises the allowance is "removed by one full-depth
      finishing pass".
    - What actually runs is a full-depth slot with a high risk of breaking the bit, plus a loose
      ring of stock, and nothing warns.
- **Fix direction:** treat a finishing ring as reached only where it lies within D of roughing. Where
  it does not, step it in (intermediate rings) and follow the depth ladder. Warn when the allowance
  exceeds the bit radius.

### F3-P3-1 — On curved contours the physical bridge is narrower than requested

- **Where:** `src/core/cnc/cnc-tab-ramp.ts:62-67`. The window is W + D measured along the
  cutter-centre path.
- **Anchor:** Contract.
  - WORKFLOW.md:5384-5385: "Tab windows add the full-depth cut width to the tab width, so a bridge
    is never narrower than requested".
  - ADR-368 Amendment 2 item 5 says the same.
  - The `cnc-tab-ramp.ts:62-64` comment: "the PHYSICAL bridge is the requested width".
- **Scenario:** the bridge's narrowest section is the straight distance between the cutter discs
  at the two window ends: chord − D. On a curve the chord of a W + D arc is shorter than the arc.
  With 6 mm tabs:
  - 16 mm disc, outside, 1/4" bit: 5.38 mm (−10 %).
  - 20 mm hole, inside, 1/8" bit: 5.55 mm.
  - 16 mm disc, 1/8" bit: 5.65 mm.
  - Straight edges: 6.00 mm.
- **Evidence:** REPRO, `zz-f3-tabs.test.ts`. `bridgeMin` is `|fall − rise| − D` from the emitted
  XY:
  - `disc16Quarter … bridgeMin [5.38,5.38,5.38,5.38]`
  - `hole20Inside … [5.55,…]`
  - `rect50x30 … [6,6,6,6]`
- **Refuter:** **CONFIRMED** (REPRO plus analytic check); P3 kept.
  - **Repro.** The refuter's own parser paired each tab rise with the next fall in the deepest
    pass, on output from the app's `emitGcode`. Chord between them minus D:
    - 16 mm disc, outside, 1/4" bit: 5.38 mm (×4).
    - 16 mm disc, outside, 1/8" bit: 5.65 mm.
    - 20 mm hole, inside, 1/8" bit: 5.55 mm.
    - 50 × 30 rectangle: 6.00 mm.
  - **Analytic check** for the 16 mm disc with the 1/4" bit:
    - The cutter-centre radius R is 11.175 mm, and the window angle θ = (W + D)/R = 1.105 rad.
    - The chord is 2R·sin(θ/2) = 11.73 mm, and 11.73 − 6.35 = 5.38 mm.
  - The bridge is wider where it meets the part (8.8 mm of arc), but its narrowest section, between
    the two cutter discs, is 5.38 mm. So "never narrower than requested" does not hold on curves.
- **Fix direction:** size each window so that the chord between its ends is W + D, or reword the
  WORKFLOW and ADR claim.

### F3-P3-2 — With a finish allowance, a hole's finishing pass runs after the outer roughing pass has cut the part free

- **Where:** `src/core/cnc/finish-allowance.ts:49-61`. A part is roughed in full (holes, then the
  outer, at every depth) before any of its finishing passes run.
- **Anchor:** Contract. ADR-276 and the `profile-ordering.ts` header: "inner contours stay ahead of
  their own outer", because cutting a hole after the part is freed "machines a workpiece that can
  move".
- **Scenario:**
  - 60 × 40 mm plate with a 20 mm hole, outside profile, 0.5 mm allowance, through cut, tabs off.
  - `finish-orderPlateHole.nc`: hole roughing at lines 18–596, outer roughing at 597–679 (this
    frees the part and its 0.5 mm skin), hole finishing at 680–823, outer finishing at 824–844.
  - With the default tabs the part is held, and the tabs-off through cut already warns that the
    part comes free.
  - The outer finishing after the outer roughing is inherent to ADR-140. The hole is not.
- **Evidence:** REPRO, `zz-f3-finish.test.ts`. Output: `orderPlateHole: hole1:ro@-2 > … > hole1:ro@-6.35 > outer:ro@-2 > … > outer:ro@-6.35 > hole1:FIN@-6.35 > outer…@-6.35`.
- **Refuter:** **CONFIRMED** (REPRO + READ); P3 kept.
  - **Repro.** Passes were classified by width in the app's `emitGcode` output for a 60 × 40
    plate with a Ø20 hole, 0.5 mm allowance, tabs off:
    `holeRough@-2/-4/-6/-6.35 > outerRough@-2/-4/-6/-6.35 > holeFin@-6.35 > outerFin@-6.35`.
  - **Read.** `finish-allowance.ts:49-61` pushes every roughing pass of the part, then every
    finishing pass.
  - **Why P3.** With the default tabs the part stays held, and the tabs-off through cut already
    warns that the part comes free.
- **Fix direction:** finish each inner contour before roughing its outer.

### F3-P3-3 — The Tab height help says "measured up from the cut floor", but with Stock thickness set it is measured from the stock bottom

- **Where:** `src/ui/layers/CncTabFields.tsx:45` and `src/ui/tutorials/cnc-detail-tutorials.ts:81`.
- **Anchor:** Contract. ADR-258 Amendment 3 Decision 1: with Stock thickness set, "a kept tab is one
  tab height above the stock bottom".
- **Scenario:** 6 mm stock set, 6.5 mm cut, 2 mm tab. The tab top is at Z −4, which is 2.5 mm above
  the cut floor, while the tooltip and the tutorial say the height is measured from the cut floor.
  The 2026-07-25 audit checked this tooltip before Amendment 3 existed.
- **Evidence:** READ. The behaviour is pinned by `compile-cnc-stock-tab-gate.test.ts` (Z −4 for
  6.5, 8.15 and 5.5 mm cuts).
- **Refuter:** **CONFIRMED** (READ, two independent lines); P3 kept.
  - **The text.** `CncTabFields.tsx:45` says "measured up from the cut floor", and so does
    `cnc-detail-tutorials.ts:81`.
  - **The code.** `tabHeightAboveCutFloorMm` (`cnc-tabs.ts:88-96`) turns the height into "above the
    stock bottom" whenever the stock thickness is not the shipped 6.35 mm. ADR-258 Amendment 3
    Decision 1 says the same.
  - **Scope.** The tooltip is still right on the shipped stock thickness (Amendment 3 Decision 3).
    Job Review already adds "above the stock bottom" (Decision 4). The drift is limited to the
    tooltip and the tutorial.
- **Fix direction:** say "above the stock bottom when Stock thickness is set, otherwise above the
  cut floor".

### F3-P3-4 — Helical entry reports that the minimum helix "does not fit this pocket" for pockets it fits, and the layer is dropped

- **Where:**
  - `src/core/cnc/helical-entry.ts:54-57`: every ring must take its own helix.
  - `src/core/cnc/helical-entry.ts:231-246`: each helix is the circle tangent inward at an edge
    midpoint of that ring, fitted against the outermost ring.
- **Anchor:** Contract. ADR-152 Decision: "very small inner rings can retain the configured minimum
  diameter without leaving the pocket".
- **Scenario:**
  - Default helix settings when the box is ticked: 8 mm maximum, 2 mm minimum fit, 3°. 1/8" bit,
    6 mm round pocket.
  - The rings have equivalent radii 1.412 and 0.141 mm.
  - A 2 mm helix fits the pocket: its bore is 5.175 mm, centred within 0.41 mm of the pocket
    centre.
  - The innermost ring's inward tangent circle of radius 1 has its centre 0.86 mm off-centre, which
    is only 0.55 mm from the boundary ring, so the plan is refused.
  - Preflight then lists `cnc-layer-empty` ("usually the bit is too wide") and
    `cnc-helix-entry-invalid: … minimum helix diameter does not fit this pocket`, and the layer emits
    nothing.
  - 7 mm and 8 mm pockets pass. With the defaults the window is roughly 5.2–7 mm holes, which
    includes M5 and M6 clearance holes. (Refuter: measured at about 5.8–6.4 mm; see below.)
  - Since ADR-491 only each level's first ring keeps its helix; the later rings' helices are
    replaced by stay-down links.
- **Evidence:** REPRO, `zz-f3-helix2.test.ts`, `zz-f3-helix.test.ts` and `zz-f3-warn.test.ts`.
  Output:
  - `helixfit circle6: rings(eqRadius) [0.141,1.412] plan The configured minimum helix diameter does not fit this pocket.`
  - `circle7 … plan ok`
- **Known overlap:** JR-4 (2026-09-24, partly fixed) covers the whole-layer drop and the
  "bit too wide" wording. This finding is the false fit verdict itself.
- **Refuter:** **CONFIRMED** (REPRO); P3 kept, with the diameter window corrected.
  - **Repro.** Round pockets 3 mm deep at 1.5 mm per pass, 1/8" bit, helix 2–8 mm at 3°, run
    through the app's `emitGcode`:
    - Refused: 5.8, 5.9, 6.0, 6.3 and 6.4 mm. Each gives `cnc-layer-empty`,
      `cnc-helix-entry-invalid` ("does not fit this pocket") and `empty-output`.
    - Planned: 5.3, 5.5, 5.7, 6.5, 6.6, 6.9, 7 and 8 mm.
  - **The window is about 5.8–6.4 mm, not 5.2–7 mm.** It catches the M5 coarse (5.8 mm) and M6
    fine (6.4 mm) clearance holes. The common M5 (5.5 mm) and M6 (6.6 mm) holes plan normally.
  - **Not silent.** The refusal blocks at preflight.
  - **The contract.** ADR-152 does require tangent entries, and a tangent 2 mm helix cannot fit the
    0.14 mm inner ring. What is false is the message "does not fit this pocket" and the ADR's claim
    that small inner rings keep the minimum diameter.
- **Fix direction:** fit the entry helix for the ring that actually receives one. For a ring
  smaller than the minimum helix, allow a non-tangent helix centred in the pocket that ends with a
  short link to the ring start.

## KNOWN (re-observed, not raised)

- **TP-5 / CW-05 (2026-09-24, still open).** Automatic tabs straddle corners. On a 50 × 30 mm part
  all four windows wrap a corner (rises at the corners in `tabs-rect50x30.nc`). Finishing windows
  that wrap a corner leave 5.85–5.91 mm bridges instead of 6.
- **K-4 / TP-5 / AUDIT A5.** The default four tabs cover a 12 mm hole's whole loop when a 1/8" bit
  cuts the hole as part of an outside profile. The hole's deep passes ride at the tab top, so the slug is not cut through. The full-coverage
  advisory is layer-level and stays silent while the outer still cuts deep (`tabs-plateHoleOut`;
  the header comment of `cnc-full-tab-coverage-warnings.ts` documents this).
- **JR-4 (2026-09-24, partly fixed).** A failed helical plan drops the whole layer, and
  `cnc-layer-empty` blames the bit width (`helixCircle6`).

## Refuted

The refuter refuted none of the six raised findings (all CONFIRMED, see each finding).

Auditor-dropped candidates (not raised, so they have no refuter verdicts):

- **Open contours on an Outside or Inside profile are cut on the line with no notice.** Vectric
  offsets open vectors left or right instead. This is documented as WORKFLOW.md "Edge — open paths
  on a profile-outside layer" ("cut on-path (documented fallback)"), so it is not raised.
- **The 3D removal grid differs from my raster by up to 2 mm in about 180 cells per tabbed job.**
  These are bridge-face edge cells that my conservative stamp skips. At every window centre the
  grid reads the tab top (−4.35), as the G-code does (`zz-f3-twin2`). Not a defect.
- **The preview draws plunges from the stock top where the program rapids down to an air floor.**
  This is the ADR-520 air descent. Preview drawing of rapids belongs to the known 2026-09-29
  preview items, and no cut geometry differs.
- **A 0.2 mm helix is effectively a plunge** (61 revolutions per 2 mm level). It honours the
  requested angle against its own circumference, and the operator set the diameter.
- **Tabs do not drop out of the finishing pass.** No such setting exists, and ADR-140 and ADR-258
  require finishing tabs.

## Verified clean

- **Side and size (21 programs, `zz-f3-side`).** Designs: a plate with a round and a square hole,
  a part in a hole (nested), an L with a sharp inside corner, and a reversed L. Cuts: outside and
  inside, with no allowance, 0.3 mm or 0.5 mm, and the 1/8" and 1/4" bits.
  - Worst wall clearance −0.002 mm (output rounding).
  - No cutting sample lies on the kept side.
  - Straight-wall residual ≤ 0.001 mm, so the finished size equals the drawing.
  - The inside-corner residual is exactly r(√2 − 1): 0.658 mm with the 1/8" bit and 1.315 mm with
    the 1/4" bit.
  - Holes in an outside profile are cut inside the hole, and an island in a hole is cut as a part,
    as Vectric's nesting rule describes.
- **Direction (L2).** Climb kept the wall on the right of travel in every classified move:
  - outside and inside;
  - holes and outer boundaries;
  - finishing passes;
  - Front-right, Rear-left and Rear-right origins;
  - mirror X, rotate 37°, mirror Y with rotate 200° on Front-right, and reversed source winding.
  Conventional reversed all of them. This matches PTC Creo ("The tool is to the left of material
  (assuming clockwise spindle rotation)") and ADR-251/252.
- **Tabs on straight runs.**
  - Window length W + D (9.17–9.18 mm).
  - Bridge 6.00 mm.
  - Tab top exactly at −(depth − tab height), with a full-loop pass inserted at the tab top.
  - Every pass below the tab top rises, by vertical moves at the plunge feed.
  - The finishing pass keeps its tabs.
- **Tab position.** Manual anchors (ADR-156) land within 0.001 mm of the anchor on both the
  roughing and finishing passes, with the artwork plain, mirrored or rotated (`zz-f3-anchors`).
- **Ramp (ADR-471).**
  - Maximum descent 10.00° for a 10° request.
  - Descent happens only on the low spans of a tabbed ring, and no cut lands in a tab window.
  - The ramp follows the path's own XY.
  - After the ramp the full ring is cut at depth: the bridges are the only stock left standing on
    the centreline.
  - Leads are off when a ramp is set (ADR-250 Amendment 2).
- **Helical entry (helix mechanics, deferred by F2).**
  - The helix is the tool-centre circle, tangent at the ring start, written as two half-arcs per
    revolution.
  - Clearance from the wall is ≥ 0 (tangent to both walls in an 8 mm slot).
  - Descent per revolution stays within the requested angle: 2.28° for 3°, and 4.55° for 15° with
    one revolution.
  - A rectangle rotated 30° is handled.
  - The 4 mm and 6 mm pocket refusals are reported (one of them falsely: F3-P3-4).
- **Finishing (ADR-140).**
  - The finishing pass removes the allowance at full depth: straight-wall residual 0.001 mm with
    a 0.5 mm allowance.
  - It follows the same direction rule.
  - Each part is roughed at all depths, then finished, in source order. The one exception is
    F3-P1-1.
- **Twin (L3).**
  - G-code → preview, nearest 3D sample: ≤ 0.058 mm for tabs with a lead, tabs with an allowance
    and a ramp, a plate with tabs and an allowance, an inside hole with a 3° ramp, and a helix
    pocket.
  - Cut XY length matches with no tabs (1380.9 against 1380.9 mm).
  - The removal grid reads the tab top at every window centre.
  - Finishing tab windows line up with the roughing windows on single parts.
- **Determinism (PROJECT.md 5).** A tabbed, finish-allowance profile with manual anchors compiles
  byte-identical twice.

## Design → result table

| Design and settings | Measured | Expected | Source |
|---|---|---|---|
| 60 × 40 plate + Ø10 and 15 × 16 holes, outside, 1/8", 6 mm / 2 mm | clearance −0.002; straight residual 0.001; corner 0.658; climb 10/10 | ≥ −0.002; 0; r(√2 − 1) = 0.658; climb | `side-outPlate.nc` |
| same, inside / outside +0.5 mm allowance | −0.001 / −0.002; residual 0.001; climb 137/137, 20/20 | same, allowance removed | `side-inPlateA05`, `side-outPlateA05` |
| part in a hole (50 / 30 / 16 mm), outside and inside | −0.001; residual 0.001; climb 15/15 | kept side right | `side-outRing`, `side-inRing` |
| L with a sharp inside corner, normal and reversed winding, conventional | residual 0.001; corner 0.658; climb 7/7 (conventional 7/7) | as requested | `side-outL*` |
| plate on Front-right, Rear-left, Rear-right; mirrored, rotated, mirror + rotate on Front-right | climb 10–11/10–11 each | climb in the physical frame | `side-outPlateFR` … `-MirFR` |
| plate, 1/4" bit, outside / inside +0.3 mm | residual 0; corner 1.315 | r(√2 − 1) = 1.315 | `side-*Quarter*` |
| 50 × 30, tabs 6 × 2 mm, 6.35 mm / 2 mm | tab top −4.35; windows 9.17–9.18; bridge 6.00 | −4.35; W + D = 9.175; 6 | `tabs-rect50x30.nc` |
| same + 0.5 mm allowance (+ 10° ramp) | finishing windows aligned; bridge 5.85–5.91 at corner-wrapped windows; ramp ≤ 10° | aligned; ≥ 6 (TP-5 corners) | `tabs-rect50x30A05*` |
| 16 mm disc, outside, 1/4", tabs | bridge 5.38 | ≥ 6 (WORKFLOW) | F3-P3-1 |
| 20 mm hole, inside, 1/8", tabs | bridge 5.55 | ≥ 6 | F3-P3-1 |
| 12 mm hole in an outside plate, tabs | hole rides at the tab top; slug not cut through | KNOWN K-4 | `tabs-plateHoleOut` |
| two 40 × 30 parts 3.3–4.1 mm apart, tabs, +0.5 mm allowance | one part has no bridge (raster and removal grid) | each part held by its tabs | F3-P1-1 |
| 40 × 30, +4 mm allowance, 1/8" | 0.825 mm ring left; finishing plunges 6.35 mm into stock | allowance removed by a skin pass | F3-P2-1 |
| plate + Ø20 hole, +0.5 mm allowance, tabs off | hole finished after the outer roughing | inner before its outer | F3-P3-2 |
| Ø20 pocket, helix 8 / 2 / 3° (and 15°) | R 3.999, clearance 1.201, 2.28° (4.55°) | R ≤ 4, inside, ≤ angle | `helix-circle20*.nc` |
| 8 mm slot, helix (1/8" and 1/4") | R 2.413 / 0.825, clearance 0.000 | fits | `helix-slot8*.nc` |
| Ø6 pocket, helix defaults | refused "does not fit", layer dropped | 2 mm helix fits | F3-P3-4 |
| Ø4 pocket, helix defaults | refused | refuse (genuine) | `helix-circle4` |

Repro tests, emitted programs and the log are in
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\f3-repros\`.
Copy the `zz-f3-*.ts` files next to `src/core/cnc/` to run them.

## Not verified

- **Tapered ball-nose and V-bit profiles**, whose wall width differs from the stored diameter
  (ADR-368 Amendments 2 and 3). Not compiled.
- **Stock thickness set (ADR-258 Amendments 3 and 4).** Read only; the repo test pins Z −4.
- **The Wall finishing recipe with several parts.** The order of the split stage groups through
  `orderGroupsIntoToolSections` was read, not run.
- **F3-P1-1 beyond side-by-side parts.** The auditor reasoned about these but did not compile
  them. The refuter later compiled them, with 1/8" bit and 0.5 mm allowance:
  - A part in a 3.6 mm wide hole: held.
  - A 3.6 mm notch: held.
  - A 3 × 2 grid at 3.5 mm: all six parts free.
  - An inside-profile dumbbell with a 3.6 mm neck: one slug free.

  Other shapes, such as curved nests and mixed sizes, remain unverified.
- **Inlay male profiles' tabs** (F5), tiled helices (known 2026-09-29 P2), and recovery re-entry.
- **Fusion's and Vectric's own tab-width definitions.** Their help pages do not say where width is
  measured, so F3-P3-1 rests on KerfDesk's own contract only.
- **Hardware.** No air cut, material cut or machine was operated.

```json
[
  {"id":"F3-P1-1","severity":"P1","area":"cnc-profile-entry","file":"src/core/cnc/finish-allowance.ts","line":188,"anchor":"Contract: ADR-140 Decision (finishing projects the roughing tab anchors, preserving tab locations); ADR-258 Decision (finishing tab centres projected from the matching roughing toolpath; tabs default on so a through profile does not free the part)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"With a finish allowance, parts spaced between D and D+2a share one roughing ring; finishing tabs are placed independently of the roughing tabs and each pass's slot cuts the other's bridges, so a part is left with no bridge (two 40x30 parts 3.3-4.1 mm apart, 1/8in, 0.5 mm: part0 FREE in the G-code raster and the app removal grid; controls held); no warning. Refuter: reproduced with an independent under-cutting raster through emitGcode; a 3x2 grid of 30 mm squares 3.5 mm apart comes off the sheet whole; an inside-profile neck frees a slug"},
  {"id":"F3-P2-1","severity":"P2","area":"cnc-profile-entry","file":"src/core/cnc/finish-allowance.ts","line":135,"anchor":"Contract: ADR-140 and Amendment 1 (one full-depth finishing pass only while the finishing cutter takes a thin skin; otherwise follow the depth ladder)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Allowance >= cutter diameter: reach r+a always covers, so the finishing pass plunges and slots full width at full depth in one pass and a full-depth ring of stock (0.825 mm at a=4 with 1/8in; 0.41 mm at a=2 with 1/16in) stands between the slots; field accepts up to 10 mm, no warning"},
  {"id":"F3-P3-1","severity":"P3","area":"cnc-profile-entry","file":"src/core/cnc/cnc-tab-ramp.ts","line":65,"anchor":"Contract: WORKFLOW.md:5384-5385 and ADR-368 Amd 2 item 5 (a bridge is never narrower than requested)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tab window W+D is measured along the cutter path, so on curves the bridge (chord - D) is narrower than requested: 5.38 mm (16 mm disc, 1/4in), 5.55 mm (20 mm hole, 1/8in) for 6 mm tabs"},
  {"id":"F3-P3-2","severity":"P3","area":"cnc-profile-entry","file":"src/core/cnc/finish-allowance.ts","line":49,"anchor":"Contract: ADR-276 and profile-ordering.ts header (inner contours stay ahead of their own outer)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"With a finish allowance a hole's finishing pass runs after the outer roughing has cut the part free (plate + 20 mm hole, tabs off: hole finish at lines 680-823 after outer roughing 597-679)"},
  {"id":"F3-P3-3","severity":"P3","area":"cnc-profile-entry","file":"src/ui/layers/CncTabFields.tsx","line":45,"anchor":"Contract: ADR-258 Amendment 3 Decision 1 (with Stock thickness set a tab is measured from the stock bottom)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Tab height tooltip and CNC tutorial still say 'measured up from the cut floor'; with Stock thickness set the tab stands on the stock bottom"},
  {"id":"F3-P3-4","severity":"P3","area":"cnc-profile-entry","file":"src/core/cnc/helical-entry.ts","line":55,"anchor":"Contract: ADR-152 Decision (very small inner rings can retain the configured minimum diameter without leaving the pocket)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Default helix (8/2/3 deg) refused as 'does not fit this pocket' in a 6 mm round pocket that a 2 mm helix fits (bore 5.175 mm), because the innermost 0.14 mm ring needs an inward-tangent circle; the layer is dropped (JR-4). Refuter: refusal window with defaults is about 5.8-6.4 mm (5.5, 5.7, 6.5, 6.6, 7 plan)"}
]
```
