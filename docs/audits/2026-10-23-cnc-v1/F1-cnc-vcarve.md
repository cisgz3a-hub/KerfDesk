# CNC audit v1 — F1 V-carve (`cnc-vcarve`)

- **When:** 2026-10-23   **Tree:** origin/main @ `b9202d5aa` (worktree `claude/rolling-audit-20261021` @ `e958f7118` = `b9202d5aa` + audit docs only)
- **Scope:** `src/core/cnc/vcarve-*.ts` (medial axis, detail depth, flat core, depth-stepped passes, emitted-profile certificates, rest finishing, tip reachability, text union, region order, clearance), `src/core/cnc/compile-cnc-operation-groups.ts` (two-stage clearing), `src/core/cnc/collect-cnc-contours.ts` (text union wiring), `src/core/design-carve/layer-surface.ts` (Design Studio V-carve preview), `src/core/sim/stamp-toolpath.ts` (3D viewer removal grid), V-carve fields in `src/ui/layers/CncLayerFields.tsx` / `CncLayerAdvancedFields.tsx`. Governing: ADR-270 (+Amd 1), ADR-274, ADR-280, ADR-285, ADR-286, ADR-287, ADR-318 §6, ADR-319, ADR-453, ADR-576; WORKFLOW F-CNC6; PROJECT.md non-negotiable 21 / rule 7.
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes; L6 lightly (failure flags reach Job Review). L5 skipped: no trust boundary in this area beyond project files, which belong to the project-I/O areas.
- **Counts:** 2 raised → refuter: confirmed 2 / plausible 0 / refuted 0, no severity changes → P1 0 / P2 1 / P3 1 (+1 KNOWN re-observed)

## Headline

An independent oracle compiled 19 V-carve programs through the real path (`compileCncJob` → `cncGrblStrategy.emit`), parsed the G-code, and measured every cutting move against the design outline. The oracle used its own winding-number fill, its own distance function and its own cone-removal grid. No emitted point gouges the outline the compiler sees (worst −0.0003 mm). Against the true glyph curves, the top edge exceeds the outline by at most 0.023 mm. That is the 0.025 mm curve-flattening tolerance of ADR-453, not a planner error. There are no cap violations, no plunges outside the design, no rapids below safe Z, and no descending feed above the plunge rate. The 3D viewer's removal grid agrees with the program within 0.0125 mm.

**The one physical defect is material left behind.** At every inside (reflex) corner of a flat core, a fin of uncut material remains at the foot of the V wall. The fin is about 0.17–0.26 × the floor depth tall and does not change with the Detail setting:
- 0.175 mm at a 1 mm floor;
- 0.337 mm at 2 mm, even with an end-mill clearing stage;
- 0.55 mm around a small square island in default flowing mode with a ¼" 90° bit.

The cause: the flat core is inset with **miter** joins, but the V-bit's footprint is a disc.

## Findings

### P2-1 — Flat-floor V-carve leaves a fin of uncut material at every inside corner (flat core inset with miter joins)

- **Where:**
  - `src/core/cnc/vcarve-medial-floor.ts:33`: `insetContoursChecked(normalizedContours, clampInsetMm)` builds the flat-core boundary that the outermost floor ring follows.
  - That call goes through `src/core/geometry/offset-ladder.ts:67` → `src/core/geometry/kerf-offset.ts:30` (`JoinType.Miter`, miter limit 2 at `:80`).
  - The same miter inset is used by the clearing floor at `src/core/cnc/vcarve-clearance.ts:89`. That use is conservative: it causes no gouge.
  - Called from `src/core/cnc/vcarve-medial-region-plan.ts:78-79`.
- **Anchor:**
  - **Ground truth:** V-groove geometry. Depth at a point equals that point's distance to the outline divided by tan(half angle): [Carbide 3D forum](https://community.carbide3d.com/t/v-bit-depth-of-cut/52642), "Width of cut / 2 / tan(half angle of bit)". So the carved surface must be z = −min(cap, d/tan(α)) everywhere, including in the conical fan around an inside-corner vertex.
  - **Contract:** WORKFLOW F-CNC6 Success 3–4 says depth is `min((d − r0)/tan(alpha), effective depth)`, and floor routes exist only in the remaining *mathematical* flat core, whose boundary at a reflex vertex is a circular arc. ADR-285 §2–3 says the same. ADR-318 §6 says "walls and corners remain in the finish".
  - **Twin:** `kerf-offset.ts:42-44` documents that when the V-carve stage grows a ring by the bit-cone radius it must use round joins ("a disc, hence round joins"); the flat-core inset uses Miter. The Design Studio preview (`design-carve/layer-surface.ts:1-11`, `applyVCarve`) draws the exact cone surface with no fin, and says "the instant preview and the eventual G-code cannot disagree about shape".
- **Scenario:** a V-carve layer with **Flat floor** on, Floor depth 1 mm, a 6.35 mm 90° V-bit, and an L-shaped region with 8 mm arms. A 90° inside corner sits at machine (58, 342).
  - The outermost floor ring turns at the miter point (57, 343), √2·δ from the vertex instead of δ = 1 mm.
  - A bisector spur also runs from the vertex: G-code lines 280–284, `X57.288Y342.712Z-1.000` → `X57.999Y342.001Z0.000`.
  - The cone around the vertex is only partly swept. Two lobes either side of the bisector stay up to **0.175 mm** shallower than the 1 mm target.
  - Other measured cases:
    - Roboto "AB8" 20 mm with a 60° bit at 1 mm: **0.259 mm** at the A crossbar and B junctions.
    - Tinos-Bold "EH" 30 mm at 1.5 mm: **0.147 mm**.
    - A 16 mm L at 2 mm **with** the 3.175 mm end-mill clearing stage: **0.337 mm**, two lobes of 0.59 mm² each. The end mill never reaches the lobes, and rest finishing keeps the mitered V-bit ring.
    - Default flowing mode (Flat floor off), 40 × 20 mm region with a 0.8 mm square hole, ¼" 90° bit: the flat core sits at the 3.175 mm flank depth, and fins of **0.55 mm** (2.2 mm² each) form at all four island corners.
  - Refining Detail to 0.02 mm (5× finer floor pitch) removes the floor scallops but leaves the fin at exactly 0.1753 mm. No setting removes it.
  - There is no Job Review or Save notice: `passLimited`, `thinResidual` and `offsetFailed` are all false.
  - The 3D viewer's simulation shows the fin (it agrees with the program within 0.004 mm). The Design Studio preview does not.
- **Evidence:** REPRO + READ.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/cnc/zz-f1-vcarve-oracle.test.ts -t "L-v90"`. The temporary file is now deleted; copies are in the session scratchpad `…/scratchpad/f1-repros/`.
  - Output (`out/L-v90-flat1.json`): `worstShortfallMm 0.1753` at (57.175, 342.575), target 1.000, got 0.825; clusters `[{57.175,342.575,n19,0.0475mm²,0.1753},{57.425,342.825,n19,0.0475mm²,0.1753}]`; `worstOverDepthMm 0`; `outsideCutCells 0`.
  - G-code `out/L.nc:81-84`: `X57.000Y321.000Z-0.999` / `X57.000Y341.625Z-0.999` / `X57.000Y343.000Z-1.000` / `X58.375Y343.000Z-0.999`, the mitered corner.
  - Analytic cross-check for a 90° inside corner: the best removal from the two legs and the bisector spur leaves ≈ 0.18·δ/tan(α), which matches the measured 0.175 at δ = 1.
  - L7: no repo test measures removal at a reflex corner of a flat core (see P3-1).
- **Severity reasoning:** this leaves residual material; it does not gouge. It is bounded (≈0.17–0.26 × floor depth for 90°–120° turns) and visible in the 3D simulation. But an ordinary flat-bottom sign hits it at every inside letter corner, the docs and the Design Studio preview promise a clean cone, and nothing warns. That makes it P2, not P1.
- **Refuter:** **CONFIRMED** (independent REPRO, plus an analytic line and a contract read). Severity unchanged: **P2**.
  - **What would make it false:** a later pass removes the fin; the fin is inherent to a cone in a corner; or an ADR accepts it. None holds.
  - **Own checker.** Own G-code parser, own exact cone sweep (convex minimisation per straight move, no sampling), own polygon distance and parity fill, 0.01 mm cells. Repo code was used only to build the scene and to compile and emit. Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/cnc/zz-f1r-corner.test.ts` (temporary; deleted). Archived copy and outputs are in the session scratchpad `…/scratchpad/f1r-out/`.
  - **Same 8 mm L, Floor depth 1 mm, V90 6.35.** The emitted program is byte-identical to the auditor's `L.nc`. Worst shortfall is **0.177 mm** at (57.43, 342.82), with 0.173 mm on the wall itself (d < δ). Over-depth is 0 and no cell outside the L is cut.
  - **16 mm L, Floor depth 2 mm, EM 3.175 two-stage plus rest finishing.** Worst shortfall is **0.354 mm**: two lobes at the wall foot, 2.0 mm from the vertex. Over-depth is 0. Neither the end-mill stage nor rest finishing removes the fin, and the V-carve has no separate outline pass that could.
  - **Flowing mode (Flat depth off), 20 × 14 mm rectangle with a 0.8 mm square island, ¼" 90° bit.** Four symmetric fins of **0.31 mm** sit on the cone around the island corners. Over-depth is 0. The size differs from the auditor's 40 × 20 case (0.55 mm) because the outer edge is closer, but the cause is the same.
  - **Defect, not physics.** Next to the emitted program, add one arc sweep of radius δ = 1 mm around the reflex vertex at floor depth. The wall shortfall falls to **0.001 mm**, with 0 over-depth and 0 cells cut outside. Add arcs at δ to δ + 0.4 mm, at the program's own 0.1 mm floor pitch, and the corner window's worst shortfall becomes **0.05 mm**. That equals the ordinary floor scallop measured on the straight arm (0.05 mm). Why this works: a cone tip on that arc cuts exactly z = −|p − V| / tan(α/2) near the vertex, which is the target surface. The V-bit can cut the corner; the miter inset is what leaves the fin.
  - **No ADR accepts it.** ADR-319 §6 and F-CNC6 Success 1 accept floor scallops governed by pitch, but the fin does not change with pitch: the auditor's Detail 0.02 run leaves it at 0.1753 mm. ADR-318 §6 says walls and corners stay in the finish. ADR-285 §3 and F-CNC6 Success 4 put floor routes in the *mathematical* flat core, whose boundary at a reflex vertex is an arc. Earlier, ADR-282 §1 called material a disc cannot reach at a mitered corner a fidelity gap; that clause covered convex tips, and its compensating thin-detail stage no longer exists.
  - **Commercial tools.** [Vectric's VCarve Toolpath docs (V12)](https://docs.vectric.com/docs/V12.0/VCarveDesktop/ENU/Help/form/VCarve%20Toolpath%20Creator) say clearance tools "will leave an allowance for the V-Carving tool". They are silent about material left at the corners of a flat region. The Carbide 3D community threads found discuss islands and slivers left by Advanced V-Carve, but none describes an inside-corner fin as expected behaviour. No source found treats the fin as an accepted, disclosed trade-off, so the probe above decides it.
  - **Ground-truth citation checked.** The Carbide 3D forum post does give "Width of cut / 2 / tan(half angle of bit)" (neilferreri).
  - **Severity.** This breaks the explicit depth contract (F-CNC6 Success 3, ADR-285 §2). It hits ordinary flat-bottom lettering and, in default flowing mode, any region wider than the bit's cone. The fin is about 3× the documented floor scallop: 0.177 vs 0.05 mm at 90° (measured here) and 0.259 vs 0.087 mm at 60° (the auditor's figures). The Design Studio preview draws the clean cone (`layer-surface.ts:81-105`), and no setting or notice exposes the fin. It is cosmetic and bounded, never a gouge, so it is not P1. P2 stands.
- **Fix direction:** Build the floor ring that the V-bit finish follows from a round-joined erosion, so its reflex corners follow the δ-radius arc around the vertex. The arc's chord tolerance must stay inside the existing 0.01 mm sweep certificate. Alternatively, add a conical arc sweep at floor depth around each reflex vertex. Keep the miter inset for the end-mill clearing floor, which is conservative. Add a removal-grid regression on an L and a square-island region (flat floor, with and without a clearing stage).

### P3-1 — No V-carve test measures missing material at a non-convex flat core; the end-to-end depth-law suite checks only over-depth at vertices

- **Where:**
  - `src/core/cnc/vcarve-depth-law.test.ts:155-183` measures `-z − allowed` at emitted vertices only, against `normalizeClosedPolylinesEvenOddChecked(shape)`, never removal.
  - `src/core/cnc/vcarve-source-accuracy.test.ts:157-245`: the floor-scallop oracles use a 10 × 4 rectangle. The "narrow 30° L" probe sits inside the flat core, away from its reflex vertex.
  - `vcarve-perceptual.test.ts`, `vcarve-floor-depth.test.ts` and `vcarve-rectangle-oracle.audit.test.ts` use squares and rectangles only.
  - `vcarve-medial.test.ts:151` (L junction) checks a single swept-cone probe at full depth with no flat core.
- **Anchor:** Contract. METHOD L7, and AGENTS.md "Reproduce a bug … add a focused regression test when the behavior is substantive". The depth-law header claims the suite "holds the one physical invariant" that the 44 planner modules serve, but it can only see gouges, never missing material.
- **Scenario:** P2-1's 0.18–0.55 mm fins pass every existing V-carve suite. A future change that worsens flat-core coverage at reflex corners would also pass.
- **Evidence:** READ (test inventory), backed by the P2-1 REPRO.
- **Refuter:** **CONFIRMED** (READ, plus the P2-1 REPRO). Severity unchanged: **P3**.
  - **What would make it false:** some suite already measures removal against the target at a reflex corner of a flat core.
  - **Suites that have the shapes but measure the wrong thing.** `vcarve-depth-law.test.ts` already carries an L, a "slab with island" and a "star with reflex corners", run at a 1 mm cap that leaves a flat core. But it measures only `-z − allowed` at emitted vertices, so it can see gouges and never missing material.
  - **Suites that measure removal but would still pass.**
    - `vcarve-rest-finishing.test.ts` "hole and nested island" compares the trimmed finish with the untrimmed one. That comparison is relative, so a fin present in both passes.
    - The body-and-tail probe in `vcarve-thin-perceptual.test.ts` measures only inside the tail window, which excludes the body's reflex corners.
    - `vcarve-perceptual`, `vcarve-floor-depth` and the floor-scallop oracle in `vcarve-source-accuracy` use squares and rectangles only.
    - `compile-cnc-vcarve-text` measures the carved fraction of a join bar, not depth shortfall.
  - **Conclusion.** No suite would fail on the 0.18–0.35 mm fins reproduced under P2-1.
- **Fix direction:** Add an emitted-G-code removal oracle that measures shortfall against `min(cap, d/tan)` on non-convex fixtures (an L, a square island, and one real glyph), alongside the existing over-depth checks.

## Known (re-observed, not raised)

- **The two-stage clearing end mill inherits the V-bit layer's feed and plunge** (`; cnc feed-source: manual`, F1000/F300 on `em3` in `out/rect…nc`). This is KNOWN: 2026-09-24 CNC full audit ("the end mill gets the V-bit's numbers"), which carries over the 13 July cutting-mechanics §14.5 item.

## Refuted

Candidates considered and dropped, so later audits can skip them:

- **Top edge 0.021–0.023 mm past the true glyph outline at concave curves** (counters, bowl joins) in every text case. This is compile-time curve flattening, not the planner. Against the compiled outline (0.025 mm flattening) the breach is ≤ −0.0003 mm (`roboto-AB8-v90-flow-compiledref`). ADR-453 accepts 0.025 mm for every operation. The equivalent "over-depth" (0.040 mm at 60°, 0.087 mm at 30°) is the same XY sag divided by tan(α/2).
  - *Refuter:* the refutation stands. ADR-453's header gives the tolerance as `DEFAULT_MACHINE_CURVE_TOLERANCE_MM`, "0.025 mm at the placement's largest axis scale". It applies to every cubic and arc segment, "for laser and CNC alike". The constant is at `src/core/scene/curve-path.ts:14`.
  - *Refuter, own check:* 5 mm Roboto "KAB8" with a 30° bit gives 0.0236 mm (flowing) and 0.0241 mm (Floor depth 0.5) against curves flattened at 0.002 mm, and −0.0007 mm against the compiled outline.
- **Two overlapping objects knock each other out; an SVG with no `fill-rule` reads even-odd.** Both are by design: ADR-286 §2, the 2026-09-13 Convert-to-Bitmap amendment §2 ("Import without an explicit rule retains its existing legacy interpretation"), and BQ-5 per rolling-v2 area 10.
- **The Design Studio preview draws a 60° cone for an incompatible cutter.** ADR-576 keeps that drawing fallback; no motion is emitted.
- **Floor scallops of `pitch/(2·tan α/2)`** (0.05 mm at 90°, 0.087 mm at 60°, 0.187 mm at 30° with automatic Detail). These are documented in ADR-319 §6, WORKFLOW F-CNC6 and the field tooltip.
- **Flat-tip engraving shortfall of ≈ r0/tan(α/2) at the medial axis** (0.373 mm for a 0.2 mm tip at 30°). This is inherent to a flat tip (ADR-287), not a defect.
- **The tip-reachability miter inset might flag false sub-tip residue at reflex corners.** Refuted by probe: a rounded rectangle with a square hole gives `residualThin: false` at r0 = 0.05/0.1/0.25, because the round dilation of the inset legs covers the vertex fan.
- **Detail 1 / 2.5 / 5 mm produce byte-identical results.** This is not a defect: `computeVCarveMedialAxis` refines automatically until the graph is good, so coarse Detail has no effect. That matches the tooltip ("not an exact whole-artwork tolerance").
- **Medial-axis shortfall up to 0.067 mm** (overlap case), slightly above the 0.05 mm Z tolerance. It is within the 0.05 mm grid discretisation (≈0.0125 mm) plus medial simplification (0.003 mm), so it was not raised.

## Verified clean

Independent oracle results. Every row is the real compile and emit path; the design outline was re-flattened at 0.001 mm from the canonical curves; removal was stamped by the oracle's own swept cone (end mill as a flat disc) on 0.05 mm cells.

| Design | Bit / mode | Worst over-depth vs design | Worst XY breach vs design [vs compiled outline] | Worst shortfall → source | Notes |
|---|---|---|---|---|---|
| Rect 30×16 | V90 6.35, flat 1 + EM 3.175 two-stage | 0.000 | −0.001 | 0.026 → floor tolerance | rest finishing trimmed; sim Δ 0.0036 |
| L, 8 mm arms | V90 6.35, flat 1 | 0.000 | −0.0007 | **0.175 → reflex fin (P2-1)** | sim Δ 0.0036 |
| L, Detail 0.02 | V90 6.35, flat 1 | 0.000 | −0.0007 | **0.175 → reflex fin (unchanged)** | scallops gone |
| L, 16 mm arms | V90 6.35, flat 2, dpp 1 + EM two-stage | 0.000 | −0.0009 | **0.337 → reflex fin** | end-mill overcut 0; sim Δ 0.0037 |
| Roboto "AB8" 20 mm | V90 6.35, flowing | 0.023 | 0.023 [−0.0003] | 0.027 → Z tolerance | sim Δ 0.009 |
| Roboto "AB8" 20 mm | V60 6.35, flat 1, dpp 0.5 | 0.040 (sag/tan30) | 0.023 | **0.259 → reflex fins (A, B)** | scallops ≤ 0.087 |
| Tinos "AB8" 20 mm (thin serifs) | V30 3.175, flowing | 0.087 (sag/tan15) | 0.023 | 0.101 | |
| Tinos "AB8" 20 mm | Engraving 30°, 0.2 mm tip, flowing | 0.088 | 0.024 | 0.39 → inherent tip flat (0.373) | no tip gouge |
| Rect 40×20 with r3 hole + 0.8 mm square island, spike, 0.5 mm sliver | V90 6.35, flowing | 0.000 | −0.0003 | **0.55 → reflex fins at island corners** | sim Δ 0.0125 |
| Roboto "AB8", letter spacing −0.12 (overlapping) | V90 6.35, flowing | 0.023 | 0.023 | 0.067 | one region, one entry, no seam (overcut = sag only) |
| Pacifico "Drive" 20 mm (script joins) | V60 6.35, flowing | 0.040 | 0.023 | 0.047 | joins carved |
| Roboto "AB8" 40 mm | V90, flat 1 (+EM, too narrow to clear) | 0.023 | 0.023 | **0.251 → reflex fins** | no clearing group, correctly |
| Tinos-Bold "EH" 30 mm | V90, flat 1.5 | 0.022 | 0.022 | **0.147 → reflex fins** | |
| Roboto "AB8" mirrored, rotated 33°, scaleX 1.3 | V60, flowing, dpp 0.7 | 0.036 | 0.021 | — | 11 passes, no gouge |
| 0.15 mm slivers (one attached, one lone) | Engraving 30°, 0.2 mm tip | −0.003 | −0.0007 | lone sliver uncut | `thinResidual` + `passLimited` disclosed |
| Roboto "AB8" | V90, Detail 1 / 2.5 / 5 | 0.023 | 0.023 | 0.030 | identical output |

**Refuter stress test of the no-gouge claim.** The refuter used its own checker and designs the auditor did not try. The claim held.

| Design | Bit / mode | XY breach vs compiled outline [vs fine curves] | Worst over-depth (grid) | Cells cut outside | Worst shortfall |
|---|---|---|---|---|---|
| Roboto "KAB8", **5 mm** | **V30 3.175**, flowing | −0.0007 [0.0236] | 0.000 | 0 | 0.028 |
| Roboto "KAB8", 5 mm | V30 3.175, Floor depth 0.5 | −0.0007 [0.0241] | 0.000 | 0 | 0.227 (note 1) |
| **Self-intersecting** pentagram (r 15) + bowtie, even-odd | V60 6.35, Floor depth 1 | 0.0002 | 0.0003 | 0 | 0.089 (note 2) |

Notes on the table:
1. The automatic 0.1 mm pitch makes the documented 30° floor scallop ≈ 0.187 mm, so most of the 0.227 mm is scallop. The excess was not traced to specific glyph corners.
2. Even-odd turns both shapes into convex triangles that meet at points, so there are no reflex corners. The 0.089 mm is the 60° scallop.

The 0.0002 mm breach and 0.0003 mm over-depth are within the 0.001 mm emitted coordinate grid, so the points where the triangles touch are not cut through.

Other checks that held:
- **Depth law and cap (Q1).** Every emitted sample, at 0.01 mm along every chord, meets −z ≤ min(cap, (d − r0)/tan(α/2)) against the compiled outline. There were 0 cap violations in any program. Flowing mode stops at the flank (`emitted v-carve-actual-max-depth-mm` matches the deepest Z), and the flat floor reaches exactly the cap.
- **Outline fidelity (Q2):**
  - no cutting sample lies outside the design;
  - letter counters, the 0.8 mm island, thin serifs and a 0.5 mm sliver are never breached beyond the ADR-453 sag.
- **Tip limits (Q3):** a flat tip is offset by r0 (no breach); sub-tip material stays uncut and is disclosed. Rest finishing:
  - trims only constant-depth chords whose whole cone lies inside the end mill's actual cleared column;
  - leaves the floor at ≤ 0.026 mm shortfall;
  - causes no end-mill overcut.
- **Text union (Q4):** overlapping glyphs within one text object compile to one region with one entry and no double-depth seam (ADR-286).
- **Order and safety (Q5).** Every XY rapid is at safe Z (3.81). Each region is entered with `G1 Z0` at plunge feed at a zero-clearance boundary point. Regions are region-major: 3 entries for 3 letters across 6 depth passes. An independent feed script (`f1-repros/feedcheck.js`) found every descending G1 with Z rate ≤ 300.0 mm/min (= plunge) and lateral F ≤ 1000 (ADR-285 §6).
- **Twin (Q6).** `computeRemovalGrid`, which the 2D overlay and the CNC 3D viewer use, matches the oracle's stamp within 0.0125 mm on 4 designs. G-code provenance prints `v-carve-depth: flowing-width|flat-floor` and the actual max depth. In flowing mode it omits the dormant requested depth (WORKFLOW F-CNC6 Edge 3).
- **Defaults.** `vCarveFlatDepthEnabled ?? true` is read identically by the compiler, clearing stage, preflight, diagnostics, preview and UI. Field bounds: Floor depth ≥ 0.05, depth per pass ≥ 0.05, Detail 0–5.

## Not verified

- **Physical cutting**: air cut, wood, chip load and surface finish. No hardware was operated.
- **The bit catalog's real-world angles and diameters** (`cnc-tool-starters.ts`, `src/ui/machine/cnc-bit-*.ts`). These are in F4's scope; only their use as planner inputs was exercised.
- **Very large artwork at the 4,096-sample per-region budget**: the oracle cost was too high on the loaded PC. ADR-285 discloses this as `passLimited`; it was not measured here.
- **Tapered V-bit inlays** (F5). They reuse this planner with Flat floor on (`tapered-inlay-operation.ts:105`), so P2-1's fins probably also appear at the female pocket's inside corners and the male background's floor. Whether that affects seating is for F5.
- **The G-code Inspector's separate stock sweep** (tip-snapping is KNOWN from the 09-29 audit), and the 3D pane at coarse UI cell sizes (PV-2, KNOWN).
- **Worker-split compilation versus synchronous compilation.** Only the synchronous path was measured; existing tests pin their equality.

```json
[
  {"id":"F1-P2-1","severity":"P2","area":"cnc-vcarve","file":"src/core/cnc/vcarve-medial-floor.ts","line":33,"anchor":"Ground truth (V-groove depth = d/tan(α/2)); Contract (WORKFLOW F-CNC6 Success 3-4, ADR-285 §2-3, ADR-318 §6); Twin (kerf-offset.ts:42-44 round joins for V-carve disc growth; design-carve/layer-surface.ts preview)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Independent cone-sweep checker: 0.177 mm (8 mm L, 1 mm floor), 0.354 mm (16 mm L, 2 mm floor, EM two-stage + rest finishing), 0.31 mm (0.8 mm island, flowing); 0 over-depth. One δ-radius arc sweep at floor depth around the reflex vertex cuts the wall shortfall to 0.001 mm with no overcut, so the V-bit can cut the corner and the fin comes from the miter inset. No ADR or vendor doc accepts it. Severity unchanged.","known":false,"summary":"Flat-core boundary is inset with miter joins, so every inside (reflex) corner of a flat-floor V-carve keeps a fin of uncut material 0.17-0.26 x floor depth tall (0.175 mm at 1 mm, 0.337 mm at 2 mm with end-mill clearing, 0.55 mm around a small square island in flowing mode); Detail does not change it and nothing warns."},
  {"id":"F1-P3-1","severity":"P3","area":"cnc-vcarve","file":"src/core/cnc/vcarve-depth-law.test.ts","line":155,"anchor":"Contract (METHOD L7; AGENTS.md focused regression tests)","evidence":"READ","verdict":"CONFIRMED","refuter":"Depth-law suite has L/island/reflex-star fixtures with flat cores but checks over-depth only; rest-finishing island test is relative (trimmed vs untrimmed); thin-perceptual tail window excludes the reflex corners. No suite would fail on the reproduced fins. Severity unchanged.","known":false,"summary":"No V-carve test measures removed material at a non-convex flat core: removal/scallop oracles use rectangles and squares only, and the end-to-end depth-law suite checks only over-depth at emitted vertices, so P2-1 passes every suite."}
]
```
