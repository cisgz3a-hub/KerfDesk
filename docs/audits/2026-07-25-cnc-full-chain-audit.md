# CNC Settings & Code Audit — Synthesis Report

**Scope:** 12 read-only dimensions over the current `claude/cnc-settings-audit-ac0266` worktree. 62 verified findings, deduped to **41 distinct root causes**: 1 P1, 15 P2, 25 P3.

**Short answer to "are my CNC settings and code correct, and are the defaults the best ones?"**
The settings *plumbing* is in very good shape — every CNC field round-trips through save/load, every field except one has a UI, units are correct end to end, and the emitter's Z-up / feed-word / determinism contracts hold. The defaults are mostly well-chosen and traceable to Easel/Vectric/Onsrud references. What you have is **one likely-inverted milling direction (P1)**, a cluster of **P2 geometry defects in the newer cut types** (v-carve clearance, adaptive clearing, ramp+tabs, missing G17), **two save-blocking data traps** (tab anchors, tiling overlap), and a **surfacing wizard that runs the spindle flat out**.

---

## 1. CODE IS WRONG — the implementation does not do what it says

### P1

#### 1.1 Climb and conventional are inverted
`src/core/cnc/motion-polish.ts:79-83`

`wantsCounterClockwise()` maps `climb` → CCW for `profile-outside` and CW for `profile-inside`/`pocket`. For a right-hand M3 (top-view clockwise) cutter that is the **conventional** direction, so the shipped default `cutDirection: 'climb'` (`machine.ts:316`) emits conventional toolpaths — and an operator who deliberately selects **Conventional** to avoid grabbing on a belt-drive machine receives actual climb.

- **Input → wrong output:** default 20×20 mm `profile-outside` square, `cutDirection: 'climb'` → compiles counter-clockwise (pinned at `compile-cnc-climb-default.test.ts:63`). With M3 the material sits on the LEFT of travel, tooth enters thin / exits thick = up-milling = conventional.
- **Derivation (done twice, independently):** chip thickness `h = f_z·cosθ`; a CW tooth entering the material-on-left arc at θ=90° starts at h=0 and exits at h=max. Force check agrees — reaction opposes the feed (controlled cut). Climb requires material on the RIGHT ⇒ **CW around an outside profile, CCW inside a hole**. Cross-check: G41 (comp left of path ⇒ material right of travel) is climb for a right-hand cutter.
- **Reference:** RouterCIM: "moving around a finished part counter-clockwise is considered conventional… For an outside profile, choose clockwise." Same rule in the handheld-router convention. **Conflict disclosed:** Vectric's own 2D Profile help page labels "Climb (CCW)" for *both* Outside and Inside, which cannot be correct for both and may be where ADR-251 was sourced.
- **Blast radius:** the wrong premise is asserted (not decided) in `motion-polish.ts:7-11`, `machine.ts:55`, ADR-251 (`DECISIONS.md:11646`) and ADR-252 (`:11696`). ADR-252's hole mirror (`motion-polish.ts:51-59`) and ADR-250 lead sides (`profile-lead-passes.ts:53-60,95-110`) both derive from winding and must be re-verified after any swap.
- **Smallest fix:** swap the two return expressions at `motion-polish.ts:80-81`; flip the pinned assertion; correct three comments and amend both ADRs. **Cut a physical coupon before merging** — nothing in the suite measures chip direction.

### P2

#### 1.2 Climb/conventional is *additionally* inverted on `rear-left` and `front-right` origins
`src/core/cnc/motion-polish.ts:57` · `src/core/devices/origin-transform.ts:57-60`

The shoelace test (`polyline-orientation.ts:1-2`) assumes the machine XY frame equals the physical top view. It does not for origins with an even number of axis mirrors relative to the Y-down scene frame. Worked numerically on a unit square: **front-left ✓, center ✓, rear-right ✓, rear-left ✗, front-right ✗**. (The finding as filed said "rear-*"; rear-right is actually fine — its X mirror restores handedness.)

- **Input → wrong output:** device origin `rear-left` (offered in the UI, importable from LightBurn `lbdev-import.ts:249`), profile-outside, `climb` → forced shoelace-positive, which traverses the part CW in the top view. Independent of, and compounding with, 1.1.
- Not affected: kerf offsetting (`kerf-offset.ts:55-61` re-orients by containment) and lead sides (winding-relative). Only climb/conventional is frame-sensitive, because spindle rotation is an external physical fact.
- **Fix:** derive an XY handedness sign from the device origin and multiply `wantCcw` by it inside `enforceCutDirection`. No refusal.

#### 1.3 Two-stage V-carve: the clearance pocket ignores the cone-height cap the ladder applies
`src/core/cnc/vcarve-clearance.ts:42` · `src/core/cnc/compile-cnc-job.ts:192,195`

The ladder clamps every ring to `min(depthMm, coneHeight)` (`vcarve-ladder.ts:59-63,71`); the clearance stage derives both its region boundary *and* its Z ladder from raw `settings.depthMm`.

- **Input → wrong output:** shipped `vb-60` (6.35 mm, 60°), `vClearToolId: em-3175`, `depthMm 8`. coneHeight = 5.499 mm, so no V ring goes below −5.499 — but the clearance pocket offsets inward by 4.619 mm and cuts to **−8.000**. Result: an unreached **2.50 mm vertical step** at inset 4.619, and a floor deeper than the V walls ever reach.
- `vcarve-clearance.ts:6-8` states the region boundary is meant to be "where the ladder's depth law hits the clamp" — the code contradicts its own header. `coneHeight` is computed in exactly one place and never shared.
- Secondary: degenerate-angle fallback disagrees (`vcarve-ladder.ts:103` falls back at `< 1°`, `vcarve-clearance.ts:38-41` only at `<= 0`), and `CncLibraryPanels.tsx:60,70` lets you save a 0.5° custom bit.
- **Fix:** export the cone-height helper and pass `maxDepthMm: Math.min(depthMm, coneHeight)` plus a matching `zPassDepths` to the clearance stage.

#### 1.4 Ramp entry restarts from stock top on tab pieces 2..N
`src/core/cnc/motion-polish.ts:126`

`const fromZ = pass.zMm >= previousZ ? 0 : previousZ;` treats any same-Z pass as a fresh contour. Tab pieces are **open** polylines (`tabs-bridges.ts:175`), so `rampContour` skips the level re-cut (`motion-polish.ts:146-148`), and `applyRampEntry` runs *after* tab splitting.

- **Input → wrong output:** 10 mm stock, depth 10, depth/pass 2, tabs on (h 3, 4/shape), `rampEntryDeg 15`. Ladder −2,−4,−6,−7,{4 pieces}@−8,{4 pieces}@−10. Piece 1 @−10 ramps correctly from −8. Pieces 2–4 get `fromZ = 0`, ramp length 10/tan15 = **37.3 mm** — longer than the piece — so the tool never reaches full depth over that arc and the piece terminates in a **vertical full-depth plunge** at `appendRampSpan`'s tail. The −8→−10 increment is left uncut along that whole segment.
- Requires the opt-in ramp angle *plus* tabs; the UI only makes ramp exclusive with helical entry, not tabs.
- **Reference:** VCarve/Fusion ramp each increment from the previous depth level, per segment, and never leave a segment shallower than its level.
- **Fix:** have `contourMajorPasses`/`depthMajorPasses` supply the entry Z per pass instead of inferring it from `previousZ`.

#### 1.5 The CNC preamble never emits G17, but the emitter produces plane-dependent G2/G3
`src/core/output/cnc-grbl-strategy.ts:106-112` · `src/core/cnc/surfacing.ts:88-93`

Preamble is `G21 / G90 / G54 / G94` — no plane word — while helical entry (`helical-entry.ts:134`) and adaptive clearing (`adaptive-pocket-operation.ts:90`) emit real `G2/G3 X Y Z I J F` (`cnc-grbl-helical.ts:34`). No soft reset is sent before a job, so GRBL's modal plane is whatever the console or a `$N` startup block last set.

- **Input → wrong output:** operator types `G18` in the Super Console, then runs an adaptive pocket. `G3 X50 Y40 Z-3 I5 J0` is read in the XZ plane — invalid offset pair, Z becomes the circular axis: `error:33` mid-cut or a swing through the stock.
- The file's own comments give this exact rationale for G54 (`:108-110`) and for G94 (`surfacing.ts:91-93`). G17 is the one modal word in that family that was left out. Our own parser *requires* G17 semantics on input (`parse-gcode-program.ts:199-201`).
- **Reference:** Fusion's generic GRBL post writes `G90 G94 G17 G21` in `onOpen`.
- **Fix:** one line — `lines.push('G17');` after G94 in both files. Snapshot regen with an acknowledgment line.

#### 1.6 Adaptive clearing flattens every ring into one polyline
`src/core/cnc/adaptive-pocket-operation.ts:85`

`sequence.rings.flatMap((ring) => ring.points)` yields a single `helical-contour` pass; the emitter has no ring concept and links every vertex with `G1` at full depth (`cnc-grbl-strategy.ts:236-239,436`). One offset *level* can be several disjoint components (`adaptive-pocket.ts:103-106`), so a dumbbell/necked pocket links lobe A to lobe B with a straight full-width slot at the pass depth.

- **Mitigated at shipped settings:** `verifyAdaptivePocket` measures the connector (`adaptive-pocket-verifier.ts:57`) and rejects the plan, so nothing dangerous is emitted at the default 0.1·D optimal load — the operator gets an adaptive-clearing error instead.
- **The hole:** `measuredLoad` saturates at exactly `toolRadius` (`:221`), and both the request check and the UI (`AdaptivePocketFields.tsx:26`) permit an optimal load of `diameter/2 = toolRadius`. At or near that setting the engagement check can never fail and the full-width connector **ships**.
- **Contrast:** the plain offset pocket emits one pass per ring (`compile-cnc-job.ts:412-423`), so the emitter retracts and rapids between them. Only the adaptive path merges.
- **Fix:** stop flattening — first ring as the helical pass, each remaining ring as its own `{ kind: 'contour', closed: true }` pass, exactly the shape the offset strategy already produces.

#### 1.7 Pass-boundary recovery: flat `path3d` lead passes are advertised recoverable, then refused
`src/core/recovery/cnc-supervised-recovery-job.ts:57-58`

`recoverySupport` grants `'runway-v1'` to flat path3d (`cnc-recovery-manifest.ts:139-146`), `contourViewOf` deliberately presents it as a contour (`cnc-contour-runway-source.ts:33-43`), the planner returns a full `review-plan` (pinned at `cnc-contour-runway.test.ts:116`) — and then the job builder re-reads the **raw** pass and refuses `kind !== 'contour'`.

- **Input → wrong output:** any ADR-250-led closed profile (the *default* for profile-outside/inside) is interrupted → the event is selectable, the operator completes the entire evidence checklist, clicks start, and gets the unlabelled alert **"Recovery planning was refused (invalid-source-job)."** (`describeRecoveryRefusal` has no label for that reason.)
- Green suite: `cnc-supervised-recovery-job.test.ts` has no path3d case.
- **Fix:** resolve the source pass through the same `contourViewOf` view the planner used. This *removes* a refusal.

#### 1.8 Job Review's pass count is off by one on imperial depths
`src/ui/laser/job-review/job-review-detail-facts.ts:101-104`

`Math.ceil(depthMm / depthPerPassMm)` duplicates the emitter's rounding rule without the epsilon and per-pass clamp of `zPassDepths` (`depth-passes.ts:13-17`, `DEPTH_EPS = 1e-9`).

- **Verified numerically:** 19.05/1.5875 = 12.000000000000002 → UI **13**, emitted **12**. 19.05/3.175 → 7 vs 6. 19.05/6.35 → 4 vs 3. 9.525/3.175 → 4 vs 3. Metric pairs agree; this bites precisely the ¾″ stock / imperial bit combinations a router user reaches for.
- **Fix:** delete `depthPassCount`, call `zPassDepths(...).length`.

#### 1.9 Layers where the bit fits *some* shapes report nothing
`src/core/cnc/compile-cnc-diagnostics.ts:29-31`

`findDroppedCncLayers` is all-or-nothing: one machinable shape keeps the group non-null, so the partial drop produces no `cnc-layer-empty` issue and no Job Review warning, while the row still shows the full artwork count (`JobReviewLayersTable.tsx:173`).

- **Input → wrong output:** pocket layer, 3.175 mm bit, ten rounded rects of which three are 2.5 mm wide → the three are silently omitted; discovered after the cut. The compiled result is *correct* (the bit genuinely doesn't fit) — the gap is reporting granularity. Partially visible in the toolpath preview.
- **Reference:** Easel reports per shape; VCarve lists the specific vectors it could not clear.
- **Fix:** run `xyToolpathsForCutType` shape-by-shape in the diagnostic and emit a Job Review warning naming the count. No refusal.

### P3 (behavioural)

| # | Finding | Location |
|---|---|---|
| 1.10 | **Pocket ring ladder leaves an uncut core when stepover > 50%.** Loop breaks on the first empty offset with no centre ring. 6.35 mm bit at 85% (UI max) in an R=8.175 pocket → one ring at ρ=5.0, sweeping to r=1.825 → a **3.65 mm full-depth pillar**. Residue exists whenever `step > radius`. Default 40% is safe. Fix: bisect to a final innermost ring; do **not** clamp the stepover. | `pocket-paths.ts:41-46` |
| 1.11 | **Relief finishing skips the far-Y edge.** `for (row = 0; row < heightCells; row += rowStep)` never emits a closing row. em-6350 finish tool, mmPerCell 0.635 → rowStep 4; with 100 cells, rows 97-99 (1.9 mm) keep the 0.5 mm roughing allowance. The sibling generator does it right (`surfacing.ts:67-68` pushes the far edge explicitly). | `relief-finishing.ts:41` |
| 1.12 | **Inlay male insert bypasses the default-on ADR-250 lead.** `compileStraightInlayGroups` calls `cncGroupForPasses` directly; `applyProfileLeadPasses` exists only in `cncGroupForLayer`. The insert is compiled as `profile-outside` (`inlay-pair-operation.ts:56`) and plunges full-depth onto the very wall that has to fit the pocket. | `compile-cnc-job.ts:71-77` |
| 1.13 | **Coolant runs through the M0 tool change.** `appendToolChange` emits M5 + M0 with no M9 before and no M7/M8 after; coolant is opened once in the preamble and closed once in the postamble. Flood keeps spraying while your hands are in the machine. | `cnc-grbl-transitions.ts:60-79` |
| 1.14 | **Simulator ignores `retractBetweenPasses`,** breaking its own stated step-for-step emitter contract (`toolpath-cnc.ts:3-6`). Divergent for engrave, profile-on-path, tabbed profiles and leads-off profiles (default led profiles happen to agree, because leads move each pass's start XY). Preview/scrubber lengths run short; G-code is correct. Property test's `group()` helper never sets the flag. | `toolpath-cnc.ts:55-67` |
| 1.15 | **3D pane simulates every layer with the machine's active bit.** One kernel from `activeCncTool` for the whole toolpath, while the compiler resolves per layer. A layer overridden to em-1588 is drawn as a 6.35 mm gouge — 4× too wide. Same defect in `use-cnc-removal-grid.ts:51`. Preview only. | `Cnc3DPane.tsx:106` |
| 1.16 | **V-carve "needs a v-bit" alert reads the machine bit, not the layer bit.** UI uses `activeCncTool`, preflight uses `layerCncTool`. Wrong in both directions: false alarm claiming "Preflight blocks output" when it won't, and *silence* when the export will actually be refused. | `CncLayerAdvancedFields.tsx:277-278` vs `cnc-preflight.ts:148` |
| 1.17 | **Job Review shows stored, not compiled, feed/plunge/RPM.** Reachable via a foreign `.lf2` or a lowered profile ceiling (the warnings list does name it). *Always* wrong for `drill` layers, whose emitted feed is `min(feed, plunge)` (`compile-cnc-job.ts:152-155`). Fix: read the row from the compiled `CncGroup`, keep the raw setting as the edit target. | `JobReviewLayersTable.tsx:159` |
| 1.18 | **Stock-vs-travel warning ignores `stock.originOffset`.** 300×300 stock at offset (150,150) on 400×400 travel → 50 mm past X travel, no warning. The sibling detector already does the extent arithmetic (`cnc-stock-warnings.ts:21-26`). Toolpath bounds are still checked, so this is advisory-only blindness. | `cnc-machine-limit-warnings.ts:35-48` |
| 1.19 | **Depth-past-stock only warns for profile cuts with tabs off.** A pocket/engrave/v-carve/relief layer set past stock thickness produces no warning anywhere — 6.35 mm stock, 8 mm pocket → 1.65 mm into the spoilboard, silently. Easel warns for every carve type. (Spoilboard overcut is legitimate — warn, never block.) | `cnc-through-cut-tab-warnings.ts:23-26` |
| 1.20 | **Feeds calculator opens with hardcoded `'plywood-mdf'` / 2 flutes,** ignoring the layer's own `feedSource.materialKey` / `fluteCount`. Previews and (on Apply) commits the wrong material's numbers under that layer's name. `CncMaterialRow` binds correctly; this panel doesn't. | `FeedsCalculatorRow.tsx:22-23` |
| 1.21 | **`device.cncSubProfile` is the only device block with no shape validation and no load-time normalization,** and `machine-actions.ts:173-177` *replaces* `machine.params` with it wholesale on the first Laser→CNC switch. Only externally-edited files can carry a bad block, and both dangerous outcomes are already contained (`Math.max(0, safeZ)`; NaN caught as `non-finite-coordinate`). Inconsistent contract, not a live hazard. | `deserialize-project.ts:246-296` |
| 1.22 | **Line-art contour selection is geometric, not source-scoped** — it also removes outer contours of text glyphs and imported SVG rings whose wall is under the layer bit. For a real end mill that *is* ADR-218's documented case. The genuine defect is the threshold using `CncTool.diameterMm` for V/engraving bits (eng-15 is a 3.175 mm **shank**), so an engrave layer discards outlines a sub-millimetre groove would cut fine. Partial drops are invisible (see 1.9). | `compile-cnc-job.ts:227` · `line-art-contours.ts:66` |

### P3 (documentation and labels — code is fine, the words are wrong)

| Location | What it says | What is true |
|---|---|---|
| `CncSetupPanel.tsx:116` | "Cut depths deeper than this (plus 1 mm) are **blocked**." | Nothing is blocked. `cnc-preflight.ts` never reads stock; `cnc-preflight.test.ts:321-336` explicitly pins "does not impose a universal stock-depth cap". **Do not add the block** — reword. |
| `cnc-through-cut-tab-warnings.ts:4-5` | "The out-of-box default layer is exactly this (depth == stock == 6.35 mm)." | Default `depthMm` is 1 (`machine.ts:302`) — the advisory can never fire out of the box. Changed by 11e6cc04 without updating the header. |
| `cnc-accessory-readiness.ts:38,44,50,57,64-65` | "**CNC Start is blocked** because…" ×5 | ADR-228 demoted all of these to Job Review warnings (`DECISIONS.md:9906`); they render under "Warnings — none block the start". Also: `cncOverrideFinalStartIssue` (`:104`) has no production caller, and the JSDoc at `:62-63` references blocked-Start fix offers ADR-228 deleted. |
| `cnc-live-start-readiness.ts:34-35` | Uses the 3-second **timeout** message for the "driver has no realtime status query at all" case — "…try again" for a condition retrying can never fix. Reachable: Marlin/Ruida drivers have `statusQuery: null` and the dialect gate was demoted. | Needs its own constant. |
| `ImportImageDialog.tsx:298-301`, `scene-object.ts:191-193` | "Curves stay at imagetracerjs's analytic fidelity through to compile" / "pre-traced (via imagetracerjs + parseSvg)" | All three shipped filled presets run the **in-house contour backend**; `contour-trace.ts:325` resamples the fitted cubics away, so CNC receives line-only subpaths and `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` is an identity round-trip on traced geometry. (No fidelity consequence — sagitta ≈ 0.0003 mm.) `trace-to-paths.ts:1-6` is accurate for its own lane, just unqualified. |
| `circular-arc.ts:20-21`, `parse-gcode-program.ts:22-23` | "Match the GRBL-order tolerance…: 0.005 **in**" → 0.127 mm | GRBL's check is 0.005 **mm** and 0.1% of radius — 25.4× tighter. **No emission impact**: no production code produces a `CncArcPass` (`appendArcPass` is dead), and the real arc emitter validates with `end === start`, so delta is identically 0. Fix the comment; do **not** tighten the import parser. |
| `feeds-calculator.ts:5-8,61` | "industry-typical mid-range values… the numbers every manufacturer chart clusters around" | The table sits at the conservative hobby end (roughly on top of Easel/Carbide Create defaults, well below Sienci's linear rule and Onsrud charts). The values are a defensible starter; the wording overclaims. |
| `DECISIONS.md:11609-11610` (ADR-250) | "`profileLead` is not yet round-tripped by the `.lf2` serializer and there is no UI; both are follow-ups." | The persistence half landed (`normalize-layer.ts:146`). The UI half has not (see 3.5). |
| `SurfacingPanel.tsx` (spindle), `cnc-machine-catalog.ts` | see §2 | |

---

## 2. DEFAULT IS WRONG — the code is right, the shipped value is not

### P2

#### 2.1 Spoilboard surfacing always commands the machine's **maximum** spindle RPM
`src/ui/machine/SurfacingPanel.tsx:111` — *found independently by three dimensions*

`spindleRpm: machine.params.spindleMaxRpm` → `M3 S${round(rpm)}` (`surfacing.ts:95`). Feed and plunge are `Math.min`'d against sane constants (2500/600); **spindle alone is taken at the ceiling**, and the panel renders only four fields (Width, Height, Stepover %, Total depth) — no spindle control at all.

- **Input → wrong output:** apply the Shapeoko XXL preset (`cnc-machine-catalog.ts:49,57` → `spindleMaxRpm: 30000`), chuck a large surfacing bit, Save surfacing G-code → the file contains **`M3 S30000`**. X-Carve and Onefinity presets give 24000. Nothing corrects it downstream: `capSpindle` is not on this path, and `standalone-cnc-preflight.ts:54-59` accepts `rpm <= spindleMaxRpm`, which equality satisfies.
- **Internally inconsistent with your own defaults:** the field is documented as the **$30 ceiling** (`machine.ts:200`, `cnc-machine-catalog.ts:18`, `DECISIONS.md:5300-5302`) yet is used here as an operating value, while every layer-based operation ships 12000 RPM (`machine.ts:307`). On the shipped default machine (12000) the two coincide, so it only appears after a catalog preset.
- **Reference:** gSender and OpenBuilds facing wizards take spindle RPM as a first-class input; no CAM package derives facing RPM from the machine maximum.
- **Fix:** add a Spindle field (plus, while you're there, feed/plunge/depth-per-pass, which are equally hard-wired) seeded from `DEFAULT_CNC_LAYER_SETTINGS.spindleRpm`. `SurfacingParams` already accepts all of them.

#### 2.2 V-bit / engraving layers get end-mill chipload keyed off the **shoulder** diameter
`src/core/cnc/machine-starters/resolve-cnc-auto-settings.ts:97-103` · `src/core/cnc/feeds-calculator.ts:94-101`

`chiploadFor` bands purely on `tool.diameterMm` with no tool-kind test, and for a V-bit `diameterMm` is where the cone reaches full width (proved by the app's own `coneHeight = diameterMm/2/tan(θ/2)`), not a cutting diameter.

- **Input → wrong output:** `vb-90` (12.7 mm) v-carve layer, hardwood, 12000 RPM, 2 flutes, default generic profile (maxFeed 6000): chipload 0.15 → **feed 3600 mm/min (142 in/min)**, plunge 1440, **depthPerPass 5.1 mm**. Both reach the machine (`compile-cnc-job.ts:164`; depth drives the v-carve ladder). Applied in **bulk** — `projectWithStockMaterial` rewrites every layer on a project-material pick.
- **The same file already knows better on the sibling path:** `:72` bails with `if (starterTool?.kind !== 'end-mill' …) return null;`. `resolveCncMaterialFeedPatch` has no kind awareness.
- **Two agents disagreed and both are partly right — you decide.** WORKFLOW.md F-CNC24 ("Edge — v-bits and unusual bits", `:2932-2935`) *documents* that the calculator uses diameter regardless of kind and that for v-carving it is "a rough guide only", and ADR-233 §6 makes these editable suggestions with no compile authority. So it is not undocumented. But (a) the caveat appears on **no operator surface** — not the layer hint (`CncMaterialRow.tsx:97`), not the calculator result line, not Job Review (`job-review-detail-facts.ts:125-141` prints only "Hardwood recipe (2 flutes)"); and (b) VCarve's default 30° V-bit tool record is ~19,000 RPM / .0005″ per tooth / 30 in/min — roughly ⅕ this feed.
- **On your own 4040** a starter exists and clamps feed to 600 / plunge ≤120 / depth ≤0.75, so you are protected there. Every other profile, including the default, is exposed.
- **Fix (two options, both non-guard):** *Recommended* — pass an `effectiveDiameterMm` derived from `tool.kind`/`tipAngleDeg` into `calculateFeeds`, leaving the chart untouched. *Minimum* — surface the F-CNC24 caveat on the layer hint and the Job Review feed-source line. **Do not** make the material select a silent no-op for V-bits: that disables an available action.

### P3

| # | Finding | Detail |
|---|---|---|
| 2.3 | **CNC machine presets cannot seed a max feed.** `CncMachinePreset` (`cnc-machine-catalog.ts:12-22`) has no feed field, so `device.maxFeed` stays at the **6000 mm/min diode-laser default** (`device-profile.ts:311`) after picking a router. Effect is bounded: `maxFeed` is only a permissive `lesserPositive` ceiling and GRBL clamps to $110/$111 itself — so an optimistic offline ceiling and ETA, not a bad cut. Fix: optional `maxFeedMmPerMin` on the preset. |
| 2.4 | **Default `spindleRpm` (12000) equals default `spindleMaxRpm` (12000).** Not a defect on its own, but it puts every untouched layer on the boundary — see the refusal it triggers at 4.4. Consider shipping the layer default below the ceiling. |
| 2.5 | **`eng-15` (15° engraving bit) is inert.** Its only distinguishing field is `tipAngleDeg`, read by v-carve alone — and preflight restricts v-carve to `kind === 'v-bit'` (documented in WORKFLOW.md F-CNC6). The sim kernel models `'engraving'` as **flat** (`tool-kernels.ts:44-58`, `return 0`). `CncLibraryPanels.tsx:60` collects the angle for custom engraving bits too, equally inertly. And `CncTool` has no tip-width field, so simply widening the preflight would be wrong (a 0.2 mm flat tip at 15° would be commanded ~0.76 mm too deep). Fix: drop `eng-15` until tip width is modelled, or add `tipWidthMm` and let the ladder accept it. |
| 2.6 | **Band edge 1.5 mm puts 1/16″ (1.588 mm) bits in the 1/8″ band — contested, recommend no action.** Two dimensions reached opposite conclusions using the same external rule: one says shift the edge to 1.5875 so 1/16″ gets the small-bit chipload; the other computed that this **halves** the 1/16″ feed to 480 mm/min, moving it *further* from reference. The comment on `feeds-calculator.ts:58` makes no 1/16″ claim, so there is no code/comment contradiction. Leave it; at most annotate the first edge as a metric micro-bit band. |

---

## 3. SETTING IS LOST — round-trip, seeding and UI-binding losses

**The good news first:** every one of the 31 `CncLayerSettings` fields, all 6 `CncMachineParams`, all 5 `CncStock`, all 4 `CncTiling` and all 5 `CncTool` fields are **written, read, validated and (except one) editable**. The serializer is `JSON.stringify(project)`, so nothing is dropped on write. The two previously-known bugs of this shape (profileLead rejected on save, `retractBetweenPasses` dropped) are genuinely fixed. No path re-seeds a hand-typed layer: every `resolveCncAutoLayerSettings` caller gates on a proven-fresh operation, and `withoutCncFeedProvenance` strips provenance the moment you edit a feed field.

The remaining losses are all whole-block or whole-file refusals.

### P2

#### 3.1 More than 512 CNC tab anchors makes the project unsavable
`src/io/project/project-cnc-tab-validator.ts:5`

`if (!Array.isArray(value) || value.length > 512)` is a **policy cap wearing a shape check's clothes**. Anchors seed per closed contour, not per object (`cnc-tab-anchors.ts:40-55`), and an SVG import buckets every same-colour contour into ONE object (`parse-svg.ts:434-460`).

- **Input → wrong output:** a 140-part nest on a profile-outside layer at the **default** 4 tabs/shape → 560 anchors → Ctrl+S, Save As **and autosave** all fail with ``Could not save project: missing or invalid `scene.objects[0].cncTabAnchors` ``, and the offered salvage copy is written by the raw serializer so it **cannot be reopened**. At the UI max of 16 tabs/shape the threshold falls to 33 contours.
- **Recoverable in-app:** the "Reset automatic" button (`CncTabPositionControls.tsx:58-69`) clears the anchors — but nothing in the message says so.
- No ADR governs 512; no test pins it.
- **Fix:** delete the `|| value.length > 512` clause, keep the per-anchor structural validation. That *narrows* an existing refusal.

#### 3.2 Tiling block silently dropped when overlap ≥ the smaller tile dimension → save refused
`src/io/project/deserialize-project.ts:173-179`

The loader returns `{}` (key absent) for a combination the UI freely permits: `CncTilingPanel` clamps tile width/height (min 20) and overlap (max 100) **independently**, with no cross-field check, and `updateCncMachine` stores the patch verbatim.

- **Input → wrong output:** Tile 60×60, Overlap 100 → the ADR-204 drift check compares by key presence (`persistence-semantic-integrity.ts:57`) and every save fails with ``saving would change `machine.tiling` during validation`` — with nothing naming Overlap as the culprit. If such a file is ever loaded, tiling vanishes and Save G-code writes one un-tiled file (`save-tiled-gcode.ts:38`).
- The clause protects nothing: `planTiles` already floors the step at `MIN_TILE_STEP_MM`.
- **Fix:** drop the `overlapMm >= Math.min(w, h)` clause; let a degenerate overlap be a Job Review warning.

#### 3.3 Machine Setup writes detected `$30` into CNC spindle max without checking `$32`
`src/ui/laser/device-setup/device-setup-flow.ts:298-304`

The condition is `state.machineKind !== 'cnc' || !positive(patch.maxPowerS)` — no `laserModeEnabled === false` term, unlike **both** siblings (`cnc-detected-apply.ts:29-32`, `cnc-controller-caps.ts:14-16`), whose comments state the rule: on a hybrid, `$30` is laser PWM scale while `$32=1`, not spindle RPM.

- **Input → wrong output (your own 4040):** profile ships `maxPowerS: 1000, laserModeEnabled: true` with `cncSubProfile.spindleMaxRpm: 12000`. Type 12000 into Spindle maximum, connect, click **Use detected values** → `spindleMaxRpm` becomes **1000**. Every layer is then `capSpindle`'d to **S1000** while its feed still assumes 12000 RPM — a 12× chipload increase on a 3.175 mm 2-flute cutter.
- **Not silent, but not consented:** the number *is* visible on the Review step before Save; what's missing is the consent surface — `describePatch` has no spindle row, and on the 4040 (profile 1000 == detected 1000) the Max-power row doesn't even render.
- Current behaviour is **pinned** by `device-setup-flow.test.ts:182-191`, which asserts $30 is accepted with `laserModeEnabled: true`.
- **Fix:** add the `patch.laserModeEnabled === false` term; update that test and add a `$32=0` case. The Job Review `spindle-scale-mismatch` advisory already tells the operator the two disagree.

#### 3.4 Job Review's spindle cell allows 0 RPM; the layer editor's minimum is 1000
`src/ui/laser/job-review/JobReviewLayerCells.tsx:174-181` vs `CncLayerAdvancedFields.tsx:122`

`min={0}` + `Math.max(range.min, stepped)` means typing `0` commits exactly 0, straight to the store, through `capSpindle` (which returns 0 for `<= 0`) to **`M3 S0`** — a plunge with the spindle commanded stopped.

- Requires deliberate entry; no default, load path or preset can produce it (`normalize-layer.ts` uses `positiveOr`, rejecting 0). The Job Review warnings list *does* name it ("spindle 0 RPM is outside (0, 12000]").
- **Careful:** raising the cell's minimum to 1000 is itself an input clamp, which rule 7's verb list covers ("caps, clamps"). It would newly forbid typing 1–999 in the review. **Your call** — I'd extract the 1000 literal to a shared constant and use it in both editors, on the grounds that the cell already clamps and the minimum is simply the wrong number, but it is a judgment about widening an existing clamp.

### P3

| # | Finding | Detail |
|---|---|---|
| 3.5 | **`profileLead` is the only CNC field with no UI anywhere** — *found by three dimensions*. Declared `machine.ts:178`, default-ON (`profile-lead-passes.ts:76-81` → tool-radius arc, 90° sweep), persisted (`normalize-layer.ts:146`), rewrites every closed untabbed profile pass. Zero hits under `src/ui`, and no Job Review disclosure line. You cannot pick line/none, change the radius, or even see that a lead exists; the only escapes are enabling tabs or a ramp angle (unrelated settings) or hand-editing the JSON. ADR-250 records this as an accepted deferral, and the three compile-time fallbacks (bed, self-collision, sibling) degrade to the legacy plunge rather than into the part — so it is an orphan control, not a hazard. Fix: a Lead-in row next to `CncFinishAllowanceField`, plus a Job Review fact. |
| 3.6 | **Park X/Y cannot express "absent" and renders it as 0.** `value={machine.params.parkXMm ?? 0}` with a plain NumberRow — there is no clear control, so typing 120 then 0 to "undo" leaves a committed 0, not absence. The distinction is load-bearing: `parkFields` returns `{}` only when *both* are undefined, and `cnc-grbl-transitions.ts:22-31` documents that absence exists so a head-relative job parks at its own start rather than rapiding to zero. Same `?? 0` pattern at `DeviceSetupMachineStep.tsx:138-151`. `ClearableNumberField` already exists (used for `rampEntryDeg`). |
| 3.7 | **Inlay pair's three defining parameters are behind the Advanced toggle** (default off, `ui-store.ts:37-43`) while "Inlay pair" is offered in the always-visible Cut type dropdown and Basic relabels Cut depth → **"Insert depth"**. Pocket depth, fit clearance and pair spacing are silently defaulted to `min(3, depthMm)` and 0.1 mm/side. Fix: render `CncInlayFields` from `CncLayerFields.tsx` next to the depth field (it already self-hides for other cut types). |
| 3.8 | **Cut direction is inert for profile-on-path and engrave** (`wantsCounterClockwise` returns null) yet the select renders for them, and **Job Review prints the stored direction unconditionally** (`job-review-detail-facts.ts:71`) — telling you an engrave layer runs "climb" when nothing happened. The tooltip already scopes the control to profile/pocket. Safest fix is the Job Review line, not hiding the input (hiding an available input is on rule 7's verb list, even though cut-type-scoped visibility is an established pattern here). |
| 3.9 | **`applyPreset` never clears `detectedApplied`,** so after "Use detected values" → click a catalog card, `DeviceSetupConnectStep.tsx:206-211` still says "Detected values applied to this setup draft" over a draft that is now the catalog profile verbatim. (Note: `profileWithControllerFacts` being an orphan is **not** a defect — `device-setup-flow.ts:64-65` and its test explicitly pin "Identity never rewrites a chosen profile.") |
| 3.10 | **Third copy of the ADR-218 `'inner'` literal** in `CncLineArtContoursField.tsx:38` without the sync comment the other two carry, plus a fourth local re-implementation of `lineArtSelectionApplies` at `:29-33`. No defect today (all three agree; the default is written explicitly). The import fix is blocked by the over-cap `core/cnc` barrel — add the ADR-218 sync comment instead. |

---

## 4. RULE-7 VIOLATIONS — guards that exist and should not

All four are **pre-existing**, not newly added. None is a transport precondition, compile-integrity failure, or handoff-consistency check. None was introduced in violation of rule 7 — they predate or sit outside ADR-228's demotion sweep. But every one of them refuses (or gates) an action that Start itself only warns about.

#### 4.1 `confirmControllerReadiness` gates all three G-code export paths — P2
`src/ui/app/confirm-controller-readiness.ts:15-26` → `file-actions.ts:184`, `save-tiled-gcode.ts:59`, `SurfacingPanel.tsx:126`

A modal "Save anyway?" before writing a `.nc` file whenever the connected controller's settings disagree. Its own header calls itself a gate. The identical `laser-mode-enabled` finding is correctly demoted on the Start path — `start-job-controller-policy.ts:17-31` says verbatim *"Frame-first (rule 7 / ADR-228): controller-capability findings are Job Review advisories, never Start refusals."* The export path did not get the same treatment, even though the same file already demotes correctly one line earlier (`file-actions.ts:175-177`).

**Worse:** `jobAwareConfirm` **fails closed** during an active job (`job-aware-dialogs.ts:33-39`), so mid-job a Save silently aborts with only *"A job is running — stop it before discarding or replacing work."* — a message about discarding work, on an action that writes a file.

**Fix:** delete it and its three call sites; route `readiness.errors` through the existing post-save advisory channel and/or the G-code header comment block. Saving a file moves no axis.

#### 4.2 Save G-code refuses what Start streams — P3
`src/ui/app/save-preflight-policy.ts:8-10` · `save-tiled-gcode.ts:83-90`

`ADVISORY_SAVE_PREFLIGHT_CODES` contains exactly one code (`scan-offset-above-cap`); everything else aborts the save. The Start twin blocks on only five compile-integrity codes. A CNC job 2 mm over the bed streams after a Frame but **cannot be exported to a file**. Tiled export is stricter still — any issue at all kills the whole tile set.

Deliberately scoped and test-pinned (`save-preflight-policy.test.ts:7-19`), and ADR-232's warn-only sentence is written for *Frame and Start*. **This is a policy decision for you, not a bug.** If you want symmetry: reuse `EMIT_BLOCKING_PREFLIGHT_CODES` on both paths.

#### 4.3 Enabled no-go zones make CNC export impossible — P3
`standalone-cnc-preflight.ts:80-90` (comment literally reads *"so fail closed instead"*) and `cnc-preflight.ts:190-201`

Two legacy refusals, both export-only: the surfacing save is refused whenever **any** no-go zone is enabled; the scene Save G-code is refused for any hand-set-origin placement with no trusted offset. On a no-homing router with one clamp zone, that is **every user-origin job, every time, with no geometric cause** — while Start demotes the same code to a warning. Both predate rule 7 and carry a documented rationale (a zero WCO would falsely claim work origin == machine zero).

#### 4.4 Layer spindle above the machine ceiling refuses Start — P3
`src/core/preflight/cnc-preflight.ts:137-144`

`compile-cnc-job.ts:166` already clamps via `capSpindle`, so the program factually *can* be produced and can never emit an out-of-range S — this is a policy refusal, not compile integrity. Because the layer default equals the ceiling (2.4), lowering Spindle max to 10000 puts every hand-tuned layer above it at once. Narrower than it looks: auto-provenance layers self-heal on the same edit, and one field edit clears it. **Fix:** delete the ceiling arm (keep `!(spindleRpm > 0)`); surface "layer requests 12000, ceiling is 10000 — the job will run at 10000" as a Job Review warning.

#### 4.5 CNC Resume is hard-blocked — P3, **and this is a document conflict, not a code bug**
`laser-job-pause-resume.ts:98,268-276` · `LiveMotionBar.tsx:91`

The code is a literal implementation of ADR-180 (`DECISIONS.md:7716`, Accepted, unamended on this branch), which ADR-228 never touched (its lists are Start-only). So: ADR-180's fail-closed engagement boundary vs CLAUDE.md rule 7's closed list of permitted refusals. **Your call, and per my session memory you have already made it** — a branch reversing ADR-180 (one-click `~`+refill, advisory notice, `assertResumeAllowed` removed) exists as PR #392, CI green, held unmerged pending an air-cut. Nothing to do here beyond landing that.

*(One sub-claim in the raw finding was wrong and I'm flagging it so it doesn't get "cleaned up": the `else if (resumeByte !== null)` branch at `laser-job-pause-resume.ts:121-123` is **not** dead — it is the live path for a laser job on Smoothieware, whose driver has `safetyDoor: null`.)*

---

## CLEAN — verified correct, stop worrying about these

**Emission contract (`cnc-grbl-strategy.ts` and friends) — audited line by line, one defect found (G17), everything else correct:**
- **Z-up invariant holds in the emitter, not just in a test.** Every `G0` carrying X/Y is preceded by an `appendRetract` on the same code path (contour :294-301, arc :330-333, path3d :383-390, helix :249-253, postamble :158-162, tool change :61-64), and `appendRetract` only ever emits `G0 Z<max(0, safeZ)>`. **No rapid ever targets a Z below safe.**
- Preamble/postamble ordering: safe-Z lift **before** M3, `G4 P<sec>` (GRBL P is seconds ✓), M5, M9 only if coolant was opened, park at modal safe Z.
- **Feed words:** every pass's first cutting move carries an explicit F; pure-vertical segments inside a path3d correctly switch to the plunge feed. No stale-F path exists.
- **Arc I/J** are incremental with correct sign; `sampleCircularArcPoints` pins `points[0] = arc.start`, so the positioning rapid and the I/J origin are the same point.
- **Determinism:** no `Math.random`, no `Date.now`, no clock anywhere in `core/output`, `core/cnc`, `core/job`. `Set` used only for `.size`; the one `Map` is iterated in insertion order. Fixed `toFixed(3)`, LF endings.
- Longest motion line ~45 bytes; comments stripped before streaming — no oversized-line exposure.
- Tool change sequence and modal-state survival across M0 are correct; head x/y/z are voided so the next pass re-issues its own positioning at safe Z.

**Geometry:**
- **Cutter compensation side is correct** (outside +r, inside −r, on-path 0), and `kerf-offset` re-orients by containment so holes offset the opposite way — frame-agnostic, unaffected by finding 1.2.
- **ADR-252 hole mirroring is intact**, and its regression test correctly measures against the tool-center ring, not the drawn boundary.
- **Depth ladder is exact:** lands precisely on `-depthMm` for non-integer multiples, emits one pass when `depth < depthPerPass`, epsilon prevents a spurious final pass.
- `finishAllowanceMm` is radial only, never applied to Z, and only for profile-outside/inside.
- **Tabs:** identical arc positions on every pass, `tabHeightMm` measured up from the cut floor consistently in type / code / tooltip, tab height ≥ depth degenerates to tabs-on-every-pass, and a perimeter-swallowed window returns no pieces — the loop stays one bridge rather than freeing the part.
- **ADR-250 leads:** waste side resolved per contour by winding, checked against the **tool-center ring**; the depth-pass survival fix (contourSignature, not array identity) is intact.
- **Ramp backtrack fix holds** for the multi-segment case (the tab case is finding 1.4).
- `stepoverPercent` is applied to **diameter**, not radius.
- **The traced-closed-curve S-cusp is fixed** — `cubic-fit.ts:50-51,122-131,307-313` forces G1 at the seam (commit 7281fe4d), and the legacy binary tail is seam-continuous too. **No needles reach G-code**: sub-micron steps are dropped at the 3-decimal emit grid, and the kerf lane additionally collapses at 0.005 mm.
- Trace winding is deterministic and nothing downstream keys off its absolute sign. Hole/nested classification uses one shared even-odd containment test.

**V-carve / relief / drill / inlay / helical / surfacing (hand-verified numerically):**
- V-carve depth law uses the **half** angle correctly (60° bit, 1 mm inset → 1.732 mm; width/depth = 1.1547) — no off-by-half.
- `vResolutionMm 0` = auto tool/8 with a 0.1 mm floor, matching the type comment. `adaptiveOptimalLoadMm` absent = 10% of diameter, matching.
- Ball-nose scallop row spacing `s = 2√(c(2r−c))` correct.
- Helical G2/G3 I/J radius = the tool-center circle, and the fit test keeps it inside the radius-inset pocket ring.
- Surfacing far-edge row coverage correct (no missing strip). Registration-hole seams identical in both adjacent tiles.
- Drill peck derives from `depthPerPassMm` with full retract to stock top; peck cycles survive tile clipping intact.

**Feeds/materials chain:**
- **No silent-overwrite path exists.** Every auto-seed call site gates on a proven-fresh operation; editing any feed field strips provenance immediately. The one bulk rewrite is an explicit, undoable operator action on a control labelled as such.
- Rounding never breaches a cap (round-then-clamp order is correct in every branch).
- `$112 → zMaxFeed`, `$110/$111 → maxFeedX/Y`, all mm/min — **no unit-crossing bug anywhere in the controller-settings chain**, and GRBL stores `$$` in mm regardless of `$13`, so not converting the dump is right while status/feed reports *are* converted.
- `DEPTH_FACTOR` 0.5 matches Easel's half-diameter rule; `PLUNGE_FACTOR` 0.4 matches Easel's 40% rule; all bands sit inside the Shapeoko hobby ranges.
- Aluminum values are survivable on a hobby router (0.02 mm/tooth at 1/8″ = 0.0008″, inside the 0.0005–0.001″ reference).

**Defaults verified against reference and found correct:** `safeZMm 3.81` (= Easel's 0.150″, and genuinely measured from stock top since Z0 = stock top per the emitter contract); `depthPerPassMm 1.5` (= Easel's preloaded .06″ for a 1/8″ bit, 47% of the default bit); `stepoverPercent 40` (inside Vectric's <50% band); tabs 6 × 2 mm × 4; stock 400×400×6.35 on a 400×400 bed; tiling 380/380/20 (step 360, fits the bed); `spindleSpinupSec 3`; `DEFAULT_ASSUMED_FLUTE_COUNT 2`. **Tool library diameters are all correct for their imperial names**, no duplicate ids. Every "absent field means X" comment was checked against the compiler and all are accurate.

**Persistence:** 100% of CNC fields survive `.lf2` save/load. Old v1/v2 laser projects correctly do **not** get injected with a CNC machine block. Custom-tool deletion re-points the active `toolId`. UI bounds and loader bounds agree (tip angle 179 vs <180 — no off-by-one).

**Rule-7 compliance on the paths that matter:** the Start path is clean — controller-readiness errors, dialect, override values, and accessory latches are all demoted to Job Review advisories; the wire-level assert checks only transport state. No new guard was found in any CNC settings control; every disabled state in the layer panels gates a helper action with no target, not machine output.

**Overrides / pause / recovery:** all thirteen GRBL v1.1 realtime override bytes match the spec exactly and are written as bare bytes that cannot land in the line buffer; `Ov:` is parsed in the right order and the displayed percentage is always the controller's, never an optimistic local guess. CNC pause correctly uses `!` and never the safety-door byte, leaving the spindle commanded — right for a router. Pass-boundary recovery re-entry is sound: fresh preamble, absolute per-pass `zMm` so slicing never shifts depth, first move a rapid at safe Z into material the previous depth pass already cleared. `resolveCncResumePoint` rewinds conservatively and can only recut, never skip.

---

## NOT VERIFIED — read this before acting

**Nothing in this audit is hardware-verified. Nothing is perceptually verified.** No G-code was cut, air-cut, streamed, simulated or rendered; no toolpath was drawn; no golden image was diffed; no coupon was run. Twelve agents read the tree and did arithmetic.

Specifically:

- **No tests were run.** This was a read-only audit and every agent chose to spend its budget reading rather than executing. Where a report says a behaviour is "correct", that is code reading — and green tests would not prove fidelity anyway (Karpathy's law).
- **Finding 1.1 (climb inversion) is a physics derivation, not a measurement**, done independently twice and cross-checked against the G41 convention and two secondary sources — with a directly conflicting Vectric help page disclosed. **A physical A/B coupon is the only way to settle it.** Do not merge a direction swap on the strength of this report.
- **1.2 (origin handedness)** rests on the code's own documented axis semantics plus a handedness derivation on paper, not on a machine.
- **1.4's "piece shorter than the ramp"** case is traced through `appendRampSpan`, not observed. **1.10's uncut core** is derived analytically from the offset ladder, not measured against Clipper output. **1.6's dumbbell pocket** was never constructed.
- **2.2's "5× the reference V-carve feed"** rests on a Vectric-forum summary of the default V-bit tool record, not a page fetched and read in full; the structural claim (V-bit chipload must be derated) is independently supported. The claim that VCarve/Carbide store V-bit feeds on the tool record is general product knowledge, **medium confidence**.
- **The chipload chart comparison** could not reach the primary Onsrud/ShopBot/Amana PDFs (404 / 403 / binary parse failure). It rests on the Cutter Shop reproduction plus Sienci and Shapeoko. Two dimensions applied the same Sienci rule in **opposite directions** on adjacent bands — treat all chart-tuning findings as low-confidence.
- **GRBL firmware source was not opened.** Statements about arc radius-error thresholds and G17 being the reset default are from knowledge, not from a file in this tree. `$30/$31/$32` defaults and the `G4 P` unit *were* verified against the wiki.
- **The 4040's real reported `$30`/`$32`** were taken from the shipped profile values and the in-code comments, not from your machine.
- **No UI was rendered.** Every UI claim is from source — no browser, no screenshots, no dev server (correctly, per the side-effect-free rule).
- **Not audited at all:** laser-side everything, Ruida/Marlin/Smoothie transports, the firmware-write queue, IndexedDB recovery internals, mesh-to-heightmap / marching-squares, the sim tool kernels beyond `tool-kernels.ts`, the material-library wizard, `cnc-machine-catalog` bed dimensions for Shapeoko/X-Carve/Onefinity (LongMill and Genmitsu were spot-checked), and the pass-span/no-go/bounds scanners.
- **The tree was not mutated.** No file was created, edited or deleted; no `git` mutation, no `vitest -u`.

---

**Recommended action:** Cut a single physical coupon to settle finding 1.1 before touching anything else — mill the same 20×20 outside profile twice with `cutDirection` set to Climb and then Conventional, and compare edge finish and chip throw. That one 10-minute test decides whether the top finding is a P1 code swap (plus ADR-251/252 amendments and a re-check of ADR-250 lead sides and the ADR-252 hole mirror) or a doc-only correction, and it is the only item in this report where the right fix genuinely depends on hardware.