# S06 · Laser toolpath generation

Products rated: KerfDesk, LightBurn 2.1.03 (Core $99 / Pro $199), LaserGRBL 7.14.1 (dormant ~16 months), XCS (= xTool Studio desktop V1.7.x per phase-0 roster note), Easel (web SaaS).
N/R: MillMage 0.8.02 — CNC-only, no laser toolpath generation (phase-0 coverage note; product page lists only CNC targets). Easel — CNC spindle toolpaths only, no native laser mode; laser use is a third-party workaround (J Tech recommends LightBurn), so it does not compete in this laser-only sector.
Pinned evidence: KerfDesk @ 12fa5132 (worktree HEAD at rating time; evidence pack `data/S06-evidence.json`, targeted vitest re-runs 2026-07-12); competitor versions per `data/phase0.json`.

Scale: anchored 0–10 per design §5.1. `U` = unknown (excluded from roll-ups). The §5.3 fidelity cap applies to 6.3 — KerfDesk's cell above 6 there is backed by PERC evidence re-run during this audit. No §5.4 hardware-dependent (`*`) categories exist in this sector.

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|----------|----------|-----------|----------|-----------|-----|-------|
| 6.1 | Line-mode correctness | 6 [TEST]¹ | 9 [OFF]² | N/R³ | 4 [OFF]⁴ | 5 [OFF]⁵ | N/R⁶ |
| 6.2 | Fill/hatch breadth | 8 [CODE]⁷ | 10 [OFF]⁸ | N/R³ | 2 [OFF]⁹ | 6 [OFF]¹⁰ | N/R⁶ |
| 6.3 | Fill correctness [fidelity] | 7 [PERC]¹¹ | 7 [OFF]¹² | N/R³ | U [OFF]¹³ | U [OFF]¹⁴ | N/R⁶ |
| 6.4 | Kerf offset | 7 [CODE]¹⁵ | 8 [OFF]¹⁶ | N/R³ | 0 [INF]¹⁷ | 6 [OFF]¹⁸ | N/R⁶ |
| 6.5 | Tabs, bridges & perforation | 6 [TEST]¹⁹ | 9 [OFF]²⁰ | N/R³ | 0 [INF]²¹ | 6 [OFF]²² | N/R⁶ |
| 6.6 | Lead-ins & start points | 0 [CODE]²³ | 9 [OFF]²⁴ | N/R³ | 0 [INF]²⁵ | 0 [INF]²⁶ | N/R⁶ |
| 6.7 | Multi-pass & Z-step | 6 [CODE]²⁷ | 9 [OFF]²⁸ | N/R³ | 4 [OFF]²⁹ | 5 [OFF]³⁰ | N/R⁶ |
| 6.8 | Travel optimization | 6 [TEST]³¹ | 9 [OFF]³² | N/R³ | 3 [OFF]³³ | 6 [OFF]³⁴ | N/R⁶ |

**Footnotes (citations)**

¹ `src/core/scene/polyline-closure.ts:26-45` (withClosingPoint re-seals closed polylines); `src/core/job/compile-job.ts:418` (applied to every line-mode segment); `src/core/job/compile-job-closure.test.ts` (3 tests green, targeted vitest 2026-07-12); `src/core/invariants/non-finite-coords.ts:1-11` (NaN/Infinity emit guard); `src/core/job/optimize-paths.ts:30-34` (direction-aware reversal of open polylines only). No user seam/start-point/direction control exists (repo grep, absence evidence).
² https://docs.lightburnsoftware.com/2.1/Reference/SetStartPoint/ ; https://support.salasers.com/using-the-start-point-editor-in-lightburn-for-co2-lasers ; https://forum.lightburnsoftware.com/t/starting-point-when-cutting/54451
³ https://lightburnsoftware.com/products/millmage-core — CNC-only, no laser toolpath generation.
⁴ https://lasergrbl.com/perfect-cut-with-lasergrbl/ ; https://lasergrbl.com/usage/raster-image-import/vectorization-tool/ ; absence of seam/direction docs: https://lasergrbl.com/usage/ [INF].
⁵ https://support.xtool.com/article/1885 (Cut processing type); https://support.xtool.com/article/1425 (closed-shape ≤0.05 mm gap rule); seam/direction absence [INF]: https://support.xtool.com/learning-center
⁶ https://www.inventables.com/pages/easel ; https://jtechphotonics.com/?page_id=1980 ; https://forum.easel.com/t/how-to-burn-first-laser-project/32522 — no native laser mode.
⁷ `src/core/scene/layer.ts:18,32-37` (fillStyle scanline|offset|island; hatchAngleDeg, hatchSpacingMm, fillOverscanMm, fillBidirectional, fillCrossHatch); `src/core/job/fill-hatching.ts:1-60`; `src/core/job/offset-fill.ts:13-26`; `src/core/job/island-fill.ts:32-40`; DECISIONS.md:1268,1498,1567,1646,1717,1872,2804 (ADR-031/033/034/035/036/038/052); `src/core/job/compile-job-fill.test.ts` + `fill-hatching.test.ts` (25 tests green 2026-07-12); sub-layers `layer.ts:46-51,204-208` (un-ADR'd divergence, full-sweep S3-F6); Offset Fill placement defect docs/audits/2026-07-10-full-sweep-audit.md:505-513 (S3-F11).
⁸ https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/ ; https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/
⁹ https://lasergrbl.com/usage/raster-image-import/vectorization-tool/ (silhouette "filling pass" only); no vector-fill settings pages [INF]: https://lasergrbl.com/usage/
¹⁰ https://support.xtool.com/article/1905 ; https://support.xtool.com/article/2428 ; https://support.xtool.com/article/1904 (angle, cross-hatch, lines/cm, bi/uni, scanning-way; no offset-fill or fill+line stacking documented).
¹¹ `src/__fixtures__/perceptual/toolpath-rasterize.test.ts:27-97` (3 tests re-run green 2026-07-12: fill toolpath AND emitted G-code rasterized vs source masks — solid IoU≥0.9, annulus hole preserved IoU≥0.85, cross-hatch IoU≥0.78, at 32×32 px); `src/__fixtures__/perceptual/gcode-rasterize.test.ts` (4 tests green, instrument tested first per ADR-025, DECISIONS.md:868); `src/core/job/fill-rule.ts:5-11` (evenodd default, nonzero for text layers); `src/core/job/fill-hatching-nonzero.test.ts` (2 tests green).
¹² https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/ (grouping semantics governing hole/nesting behavior); de-facto reference status is [INF] (forum ubiquity, no systematic complaints located) — cannot anchor headlines.
¹³ https://lasergrbl.com/usage/raster-image-import/vectorization-tool/ — filling pass exists; no evidence found on hole/even-odd, shared-edge, or small-feature behavior [INF].
¹⁴ https://support.xtool.com/article/3450 — vector fill display exists; no evidence found on hole/even-odd, shared-edge, or small-feature behavior [INF].
¹⁵ `src/core/scene/layer.ts:27` (kerfOffsetMm); `src/core/job/compile-job.ts:421-428` (line mode, closed contours only); `src/core/geometry/kerf-offset.ts:9-32,59-65` (clipper2 miter inflate, containment-depth hole orientation, R6 tryVectorOp guard); `src/core/geometry/kerf-offset-op-failure.test.ts` (1 test green 2026-07-12).
¹⁶ https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/ (Kerf Offset, positive outward / negative inward).
¹⁷ https://lasergrbl.com/usage/ — no kerf setting in any documented page (absence inference) [INF].
¹⁸ https://support.xtool.com/article/1425 ; https://support.xtool.com/article/2426 (−1…+1 mm, two decimals, closed shapes only); https://support.xtool.com/community-support/detail/6253 (community: some vectors not recognized as closed).
¹⁹ `src/core/scene/layer.ts:28-31` (tabsEnabled, tabSizeMm, tabsPerShape, tabSkipInnerShapes); `src/core/job/compile-job-tabs-bridges.test.ts` (2 tests green 2026-07-12); `src/ui/layers/CutSettingsCommonFields.tsx:80-88` (UI-exposed); perforation/dot-mode absence: docs/audits/2026-07-10-full-sweep-audit.md:482-483 + grep 'perforat' = no matches; drag-placeable tabs deferred DECISIONS.md:4418.
²⁰ https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/ (Tabs/Bridges AND Perforation Mode, all laser types).
²¹ https://lasergrbl.com/usage/ — no tab/perforation page in nav (absence inference) [INF].
²² https://support.xtool.com/article/1894 (Tab Generation: size + optional non-zero tab cut power); https://support.xtool.com/article/3278 ; https://support.xtool.com/community-support/detail/3856 (dashed-line perforation-style technique).
²³ Absence evidence: repo-wide grep `leadIn|lead-in|startPoint|start point` — no vector-cut lead-in or start-point feature; the only "lead-in" is fill/raster overscan runway (ADR-031/033, DECISIONS.md:1268,1498; `src/core/output/grbl-strategy.test.ts:203-235` — laser-off rapids, a scan feature not a cut lead-in).
²⁴ https://docs.lightburnsoftware.com/2.1/Reference/SetStartPoint/ (any node, either direction); https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/ (Lead-In/Out angle/length — DSP lasers only, not GCode/Core devices).
²⁵ https://lasergrbl.com/usage/ — no such pages in nav [INF].
²⁶ https://support.xtool.com/learning-center — no lead-in/start-point article found [INF].
²⁷ `src/core/scene/layer.ts:25` (passes ≥1); `src/core/job/compile-job.ts:197` (clamp); `src/core/output/grbl-strategy.ts:119-122,151-152,181-182` (per-pass emit loops for cut/fill/offset-fill); Z-step absence: grep zStep/stepdown/zPerPass = no laser matches + docs/audits/2026-07-10-full-sweep-audit.md:482-483; sub-layers workaround `layer.ts:46-51`.
²⁸ https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/ ; https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/ (Number of Passes + Z Offset + Z Step per Pass).
²⁹ https://lasergrbl.com/usage/load-and-send/ (whole-program loop counter; Z step absent from multi-pass doc [INF]).
³⁰ https://support.xtool.com/article/2425 ; https://support.xtool.com/article/1891 (Pass parameter up to 10); no per-pass Z step documented — depth via auto-focus or separate Embossing feature [INF]: https://support.xtool.com/article/1325
³¹ `src/core/job/optimize-paths.ts:1-48,129-136` (deterministic NN, inside-first containment buckets, MAX_NEAREST_NEIGHBOR_SEGMENTS=2000 silent cutoff); `src/core/job/optimize-paths.test.ts` (19 tests green 2026-07-12); `src/ui/laser/OptimizationSettingsDialog.tsx:28-31` (single checkbox, no further knobs); docs/audits/2026-07-10-full-sweep-audit.md:571-575 (S4-F4 silent cutoff, still present); PROJECT.md:75 (doc fixed; stale 2-opt comment survives at optimize-paths.ts:3).
³² https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/ ; https://forum.lightburnsoftware.com/t/how-to-optimize-moves/13470 ; https://forum.lightburnsoftware.com/t/optimization-settings-and-actual-cut-path/16172
³³ https://lasergrbl.com/usage/raster-image-import/vectorization-tool/ ("Optimize Travel" inside vectorization tool only); https://lasergrbl.com/perfect-cut-with-lasergrbl/ (fixed inner-before-outer); no optimization for imported G-code/SVG jobs.
³⁴ https://support.xtool.com/article/1301 (Auto-plan); https://support.xtool.com/article/1902 (User-define manual path/sequence); https://support.xtool.com/article/880 (layer-drag order; F1-only Smart Engraving).

### State of play

This sector effectively reduces to a three-way contest — LightBurn, KerfDesk, xTool Studio — with LaserGRBL a distant fourth and both CNC products (MillMage, Easel) out of the sector entirely. LightBurn is the leader in seven of eight categories and the reason is consistent across them: everywhere KerfDesk has built a correct core, LightBurn has built the same core *plus* the user-control layer around it — seam and direction control on top of line cutting, perforation and dot modes on top of tabs, Z-step on top of multi-pass, a multi-strategy Cut Planner on top of travel ordering. KerfDesk's ratings (mostly 6–8) versus LightBurn's (8–10) tell that single story eight times.

KerfDesk's strongest ground is fill. The per-layer fill model (6.2) is genuinely deep: hatch angle and spacing with a 0.05 mm floor, snake/unidirectional, cross-hatch, three fill styles including clipper2 concentric offset fill and island fill, per-layer overscan with ADR-031/033/034 sweep engineering, M4 dynamic power, and fill+line stacking via sub-layers. That is parity with LightBurn's core (8), short of its 10 only on flood fill, documented fill-grouping semantics (all-at-once/groups/individually), and two in-tree defects: Offset Fill hidden inside the Fill dialog instead of the Mode dropdown where a LightBurn switcher looks (S3-F11), and the sub-layer mechanism itself being an un-ADR'd divergence from LightBurn's model (S3-F6) — both classify as bugs per §5.6, not choices. On fill *correctness* (6.3), the fidelity-capped category, KerfDesk is the only product in the roster with perceptual proof of any kind, re-run during this audit: compiled toolpaths and emitted G-code rasterized back against source masks preserve holes (even-odd), pass solid and cross-hatch IoU thresholds, and the nonzero rule auto-selects for text glyph winding. That PERC evidence lifts KerfDesk above the cap to 7 — but the masks are 32×32 px, so small features, thin slivers, shared edges, and real-resolution hatch quality are unproven, and no side-by-side against LightBurn exists. LightBurn's own correctness cell is documented-existence plus an [INF] ubiquity signal, so the two sit tied at 7 and neither tie-break direction is currently provable.

The sector's one outright absence is 6.6: KerfDesk has no start-point control, no seam placement, and no vector lead-in/out at all — the only thing answering to "lead-in" in the tree is the fill/raster overscan runway, a scan feature. LightBurn's Set Start Point tool (any node, either direction; lead-in/out on DSP devices) is exactly the kind of daily cut-quality control a CO₂ user leans on to hide seams, and its absence also leaks into 6.1: KerfDesk's line-mode *correctness* core is real and test-verified (the DXF seam-drop open-cut bug is fixed via withClosingPoint at compile, a repo-wide non-finite-coordinate guard covers every producer, travel optimization is direction-aware), but the user can neither move a seam nor set cut direction, which the category explicitly measures. Notably, neither LaserGRBL nor xTool Studio documents seam/direction control either — this is a LightBurn-only capability in the roster — but those absence findings are [INF] and cannot anchor a win.

Against the non-LightBurn field, KerfDesk holds up well. LaserGRBL's toolpath generation is thin: fill exists only as a silhouette "filling pass" inside its vectorization tool, multi-pass is a whole-program loop counter, travel optimization applies only to vectorized jobs, and kerf, tabs, and lead-ins are undocumented anywhere in its official usage docs. xTool Studio is the more serious free competitor: documented kerf offset (−1…+1 mm, closed shapes), tab generation with a tab-power snap-off aid KerfDesk lacks, fill with angle/cross-hatch/density controls, up-to-10 passes, and a two-mode path planner (auto-plan plus fully manual sequence definition). KerfDesk beats it on fill breadth (offset/island styles, fill+line stacking, overscan engineering) and matches it on tabs, kerf, and travel; it has no answer to KerfDesk's per-layer settings depth, and nothing in its docs addresses fill correctness.

Two structural caveats govern the numbers. First, almost nothing in this sector has been verified perceptually beyond the three 32×32 fill fixtures: kerf-compensated output has never been rendered or dimension-checked, tab geometry has never been rendered, and travel-reduction quality has never been benchmarked against LightBurn's optimizer — the silent 2,000-segment cutoff (S4-F4), which keeps source order with no UI indication, is exactly the kind of behavior a production user would hit blind. Second, every KerfDesk hardware pass remains CLAIMED per the standing ledger, so no cut on real material backs any rating on either side. For personas this sector weighs 9/100 for the LightBurn-switcher and 8/100 for the production shop — the 6.6 absence and the 6.5/6.7 control gaps land directly on both.

### Where we win / where we lose

- WIN 6.2 (+6 vs LaserGRBL) — KerfDesk's full per-layer fill model (angle, spacing, cross-hatch, snake, three fill styles, overscan) versus LaserGRBL's single silhouette filling-pass inside its vectorizer. [pending adversarial verification per §5.5]
- WIN 6.2 (+2 vs XCS) — KerfDesk adds concentric offset fill, island fill, and fill+line sub-layer stacking that xTool Studio's documented scanline-only fill lacks. [pending adversarial verification per §5.5]
- (6.3 is a tie at 7 with LightBurn, not a claimed win: KerfDesk holds the roster's only perceptual fill-correctness proof, but at 32×32 px with no side-by-side; LightBurn's reference status is [INF]. Sent to adversarial verification per §5.5 as a KerfDesk-≥-competitor cell.)
- LOSE 6.6 (−9 vs LightBurn) — no start-point/seam placement or vector lead-in/out at all versus LightBurn's Set Start Point tool (lead-in/out DSP-only) → G-S06-1
- LOSE 6.1 (−3 vs LightBurn) — line-mode closure/guard correctness is test-proven, but there is zero user control of seam position or cut direction, which the category measures → G-S06-2
- LOSE 6.5 (−3 vs LightBurn) — no perforation mode, no dot mode, no manual/drag-placed tabs (deferred per DECISIONS.md:4418); auto tabs only → G-S06-3
- LOSE 6.7 (−3 vs LightBurn) — no Z Offset / Z Step per pass in laser output; multi-pass is repetition-only with a sub-layer workaround → G-S06-4
- LOSE 6.8 (−3 vs LightBurn) — single "Reduce travel moves" checkbox versus LightBurn's multi-strategy Cut Planner; plus the silent 2,000-segment optimizer cutoff with no UI indication (S4-F4) → G-S06-5
- LOSE 6.2 (−2 vs LightBurn) — no flood fill or fill-grouping modes; Offset Fill hidden outside the Mode dropdown (S3-F11) and sub-layers un-ADR'd (S3-F6), both §5.6 severity-bumped → G-S06-6

### Gaps feeding the register

- G-S06-1 · 6.6 Lead-ins & start points · vs LightBurn · Δ−9 · un-ADR'd absence (shared LightBurn workflow, no ADR records the omission) · start-point/seam control is the headline ask; lead-in/out is DSP-only even in LightBurn so seam control is the actionable half.
- G-S06-2 · 6.1 Line-mode correctness · vs LightBurn · Δ−3 · un-ADR'd · add cut-direction and seam-position control on top of the already-correct closure core.
- G-S06-3 · 6.5 Tabs & perforation · vs LightBurn · Δ−3 · partially recorded (drag tabs deferred, DECISIONS.md:4418; perforation absence un-ADR'd) · perforation/dash mode is the missing LightBurn-parity feature.
- G-S06-4 · 6.7 Multi-pass Z-step · vs LightBurn · Δ−3 · un-ADR'd · per-pass Z step/offset for thick-material cutting; requires Z-capable laser profiles.
- G-S06-5 · 6.8 Travel optimization · vs LightBurn · Δ−3 · cutoff un-ADR'd (S4-F4) · surface the 2,000-segment fallback in UI and add ordering strategies (by-layer/priority/direction-change reduction).
- G-S06-6 · 6.2 Fill breadth · vs LightBurn · Δ−2 · un-ADR'd (S3-F6, S3-F11) · move Offset Fill into the Mode dropdown; document or ADR the sub-layer model; flood-fill/grouping are the remaining breadth items.

### Not verified

- 6.3 (fidelity): PERC proof is three 32×32 px fixtures only — small features, thin slivers, shared edges between same-layer shapes, and hatch quality at real output resolution unproven; the IoU thresholds' own calibration is flagged unvalidated (full-sweep audit:1964); no comparison against LightBurn fill output; no hardware burn. ADR-128's maintainer perceptual pass covers trace, not fill.
- 6.1: no perceptual/rendered comparison of line-mode output against source geometry; seam/start-point/direction-control absence verified by grep only, not a UI walk.
- 6.4: kerf-compensated output never rendered or dimension-checked; no cut-and-measure hardware calibration ever verified; corner/join parity with LightBurn unchecked.
- 6.5: tab geometry never rendered or burned; placement quality (corner avoidance) unproven; perforation/dot absence rests on grep + prior audit.
- 6.6: absence conclusion rests on repo-wide grep plus the 2026-07-10 audits; the running UI was not walked this session.
- 6.7: multi-pass registration on real material never verified — every KerfDesk hardware pass remains CLAIMED per the standing ledger.
- 6.8: travel-reduction quality never benchmarked against LightBurn's optimizer; behavior above the 2,000-segment cutoff on real dense designs untested; grbl-strategy overscan test cited from tree, not re-run this session.
- Competitor U/INF cells: LaserGRBL and XCS fill correctness (6.3) are U; LaserGRBL 6.4/6.5/6.6 and XCS 6.6 are [INF] absence inferences; LightBurn's 6.3 reference-quality status is [INF] — none of these may anchor headline conclusions.
- No hardware verification anywhere in this sector, either side (design §11).
