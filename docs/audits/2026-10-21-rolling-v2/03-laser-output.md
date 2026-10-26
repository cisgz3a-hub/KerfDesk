# Rolling audit v2 — Laser output (03 `laser-output`)

- **When:** 2026-10-21 13:00–16:30   **Tree:** origin/main @ `70c01e11f`
- **Scope:** `src/core/output`, `src/core/job`, `src/core/gcode`, `src/core/raster-output`,
  `src/core/execution-plan`, `src/core/effective-output`, `src/core/laser-second-pass`, plus the
  raster emitter they call (`src/core/raster/emit-raster*.ts`) and the entry
  `src/io/gcode/emit-gcode.ts` / `prepare-output.ts`. PR #1285 (ADR-626 laser leads) in full.
  Governing: PROJECT.md non-negotiables 1–7 and 21, ADR-565, ADR-567, ADR-398, ADR-432,
  ADR-415, ADR-492, ADR-494, ADR-495, ADR-239/ADR-343, ADR-462, ADR-493, ADR-626 (+ Amd 1–7),
  ADR-127, ADR-273.
- **Lenses run:** L1, L2, L3, L4, L5, L6, L7. Six independent lens passes (laser-off/power modes;
  value fidelity; raster; leads; twins; coordinates + test truth), plus an L5 pass by the lead.
  Eight refuters, none of which raised what it refuted. L5 was not assigned for this area but
  produced the top finding.
- **Counts:** 32 raised → 3 merged → 29 unique → 1 refuted → P1 3 / P2 9 / P3 16 (+ 0 KNOWN).
  Two more were refuted in part and kept in narrower form (C-D-3 → P3-10; C-K-1/2 → P2-9).

## Headline

Every GRBL-family rapid is dark (`G0 … S0` on every dialect, 1,600 + 2,500 randomized jobs, no
laser-on travel, no mid-job lit M3 drain), and power, feed, origin and raster values are emitted
as set. The three P1s are outside that core. (1) The laser emitters write the layer id and colour
into G-code comments without the sanitiser the CNC emitter already uses, so a crafted `.lf2` can
inject a full-power burn line that preflight, Frame and Job Review never show. (2, 3) ADR-626
leads burn up to 2 mm into a kept part when a part's outline is open: a CAD DXF drawn as LINE
entities, or a neighbour opened by "Remove overlapping lines". The same open-outline DXF also
silently loses kerf compensation (P2-9), because DXF import never joins LINE ends. The other P2s
are narrower lit stops (Marlin air changes; a held air-on at job end), a rotary placement bug,
a small whole-number `$30` that collapses power, and four disclosures that say something the
program does not do.

## Findings

### P1-1 — A crafted project file injects executable G-code through the laser layer comments
- **Where:** `src/core/output/grbl-strategy.ts:284` (cut header `; layer ${group.layerId} color ${group.color} …`),
  `:311` (offset fill), `:392` (unreached today); `src/core/output/grbl-fill-emission.ts:64`;
  `src/core/raster/emit-raster.ts:293-297`. Loader: `src/io/project/project-layer-shape-validator.ts:37-39`
  (`requireString` only for id, name, colour); `normalizeLayerColor` runs only in `createLayer`.
  Streamer: `src/core/controllers/grbl/streamer.ts:141-151` sends every non-blank line that does not
  start with `;`.
- **Anchor:** Twin + Contract. The CNC emitter passes the same `layerId` through
  `sanitizeGcodeCommentValue` (`src/core/output/cnc-grbl-group-comments.ts:14,174`;
  `src/core/gcode-comments.ts:50`), as does the metadata header (`src/io/gcode/gcode-metadata.ts:170`).
  ADR-273 (DECISIONS.md) requires newline-bearing labels to "remain inert comments instead of
  creating controller commands" for the CNC exporter.
- **Scenario:** Someone shares a `.lf2` whose layer id (or colour) is `cut\nG1 X300 Y10 F100 S1000\n;`.
  It loads through Open, drag-drop, Recent, templates or nested projects (`project-open-parser.ts:61-70`).
  On Start, the program is armed (`M4 S0`) and then runs `G1 X300 Y10 F100 S1000`: a full-power
  burn from wherever the head is to (300, 10). The Frame traces only the compiled job (10..20,
  380..390), preflight reports nothing, and Job Review shows nothing. Marlin and Smoothieware
  (`S1`, full power on 0–1) are affected the same way. A `\r` payload survives in a saved file,
  and GRBL treats CR as end of line.
- **Evidence:** REPRO. A temp Vitest (lead) serialised a project, swapped in the payload,
  then ran `deserializeProject` (→ `kind: ok`) and `emitGcode`. The output contained
  `; layer cut` / `G1 X300 Y10 F100 S1000` / `; color #ff0000 power 30% …`, with preflight issues `[]`.
  The refuter (R1) reproduced it for id and colour on line, scan-fill, offset-fill and image
  layers, and on Marlin and Smoothieware, and checked that the streamer queues the line.
- **Refuter:** CONFIRMED (R1). No entry point normalises ids or colours. `.lbrn`, SVG, DXF, MCP
  (hex regex) and recipes cannot carry the payload; any opened `.lf2` can. `$` lines are stopped
  by `safeWrite` (`laser-safe-write.ts:78`). P1 rather than P2: it can fire the laser
  unexpectedly with no trace in Frame or review. The only precondition is opening a shared file,
  which is a normal workflow.
- **Fix direction:** Route every laser comment value (layer id, colour, and any future label)
  through `sanitizeGcodeCommentValue`. Also consider validating `layer.color` as hex on load.

### P1-2 — Leads burn into the plate when the part's outline is open (CAD DXF drawn as LINE entities)
- **Where:** `src/core/job/laser-lead-sides.ts:104` (`if (!polyline.closed) continue;`);
  `src/core/job/laser-lead-rings.ts:81-96` (rings are closed segments or tab/perforation pieces
  only); `src/core/job/laser-lead-fit.ts:146` (`freeEndInScrap` consults rings only). The DXF
  importer does not join LINEs (`src/io/dxf/dxf-entities.ts:56-61`).
- **Anchor:** Contract. ADR-626 clause 4 says the free end can "never end inside another part";
  "Why this is better" says a lead "never runs into a neighbouring part"; Amendment 1 D3 says an
  unknown side gets no lead plus a warning.
- **Scenario:** Import a DXF whose 80 mm plate outline is four LINE entities, with a CIRCLE r5
  hole, and switch on leads (Auto side). The plate lines are open, so the hole is judged an outer
  contour. Its arc lead-in and lead-out burn about 1.5 mm into the finished plate at cut power,
  and a 90° line lead about 2 mm. There is no diagnostic and no preflight issue. The same output
  also cuts the plate lines before the hole (see P2-9).
- **Evidence:** REPRO (lead, `parseDxf` → `emitGcode`). The import gives
  `["open2","open2","open2","open2","closed24"]`. With the hole centred at machine (40, 360) r5,
  the lead-in is `G0 X46.387 Y358.851 S0` / `G1 X46.165 Y358.850 F1500 S300` … `G1 X45.000 Y360.000`,
  6.5 mm from the centre, in the plate. Issues `[]`. Lens D: 400 burn samples in material, up to
  1.49 mm deep (arc) and 1.99 mm (line 90°).
- **Refuter:** CONFIRMED (R4). The open lines are obstacles but lie 35 mm away. A closed
  LWPOLYLINE outline puts the leads in the hole. **Always inside** works around it. Preview draws
  the lead, but it looks like a normal outer lead.
- **Fix direction:** Treat a contour that open paths in the job could enclose as side-unknown: no
  lead plus the side-unknown warning, as Amendment 1 D3 already does. Do not make open paths
  containers (P2-9). Joining LINE ends on DXF import (P2-9) removes the common trigger.

### P1-3 — With "Remove overlapping lines", a part's leads burn into the neighbour that shares its edge
- **Where:** `src/io/gcode/prepare-output.ts:269` (`optimizePaths`, which runs overlap removal)
  before `:290` (`applyLaserLeads`); `src/core/job/optimize-paths.ts:107-116`;
  `src/core/job/remove-cut-overlaps.ts:140` (the neighbour becomes open pieces);
  `src/core/job/laser-lead-rings.ts:88-96` (open pieces become rings only when compile kept an
  outline, which `compile-line-topology.ts:85-103` does only for tabs and perforation).
- **Anchor:** Contract (ADR-626 clause 4 and "Why this is better"; the ADR never mentions overlap
  removal) + Twin (the scene-side judgement in `laser-lead-sides.ts` still sees the neighbour as
  closed).
- **Scenario:** Two 20 mm squares A and B share the edge x = 40, both on one lead operation, with
  Optimization → Remove overlapping lines on. B loses the shared edge and becomes an open 3-edge
  path. A's outline starts on the shared edge, either as drawn or chosen by the clause-5 restart
  search. R4 found that a plain clockwise rectangle starting at the shared corner with default
  45° line leads is moved to mid-edge by that search. A's leads then go outward, into B. The lead
  crosses no cut line, and the free-end check sees no ring.
- **Evidence:** REPRO (lead). Arc leads: 762 burn samples inside B, max 1.273 mm, first burn
  `G1 X41.052 Y371.254 F1500 S300`. Line 90°: max 2.000 mm (`G1 X40.000 Y370.000 F1500 S300` from
  (42, 370)). With removal off: 0, because B's line blocks the lead and the start moves. Preflight
  issues `[]` in every case.
- **Refuter:** CONFIRMED (R4). The trigger is stronger than first raised: the default 45° line
  lead on a corner start reaches it through the restart search (1.414 mm into B).
- **Fix direction:** Keep whole outlines (`topologyRings`) for contours split by overlap removal,
  as tabs and perforation already do, or fit leads before overlap removal.

### P2-1 — A blank last group writes a held air-on straight after the final lit M3 burn
- **Where:** `src/core/output/grbl-strategy.ts:490` (`releaseHeldLines` before M5);
  `src/core/output/grbl-output-cursor.ts:155-162` (`noteRasterGroupEnd` keeps the held lines);
  `src/__fixtures__/controllers/grbl-lit-drain-checker.ts:42` (ignores lines after the last burn).
- **Anchor:** Contract + Ground truth. ADR-398 Decision 1 accepts only "M9/M5 after the last burn".
  grblHAL `coolant_control.c`: `coolant_set_state_synced` runs `protocol_buffer_synchronize()` and
  then `delay_sec(on_delay)`.
- **Scenario:** Constant-power output (grbl-compatible, the 4040, or a layer set to Constant) with
  air off, followed by a final air-on group that burns nothing: an all-white or 0% image, or a
  cut whose geometry rounds away. The program ends lit burn → `M8` → … → `M5`. `M8` drains the
  planner with the beam lit. On grblHAL (`$673`) or FluidNC (`coolant/delay_ms`) the head then
  sits lit and stationary for the whole on-delay, which is the fire case OR-1 was written for.
- **Evidence:** REPRO (lead): both layers Constant, last group air on and collapsed →
  `G1 X10.000 Y390.000` (S300, M3) / `M8` / `M9` / `M5`, issues `[]`. R2: white image →
  `… S800` / `M8` / `M5` / `M3 S0` / `M5` / `M9`. Lens A's 2,500-job fuzz: 27 such endings and no
  other violation.
- **Refuter:** CONFIRMED (R2), P2 (needs M3 + air-on blank final group + an on-delay).
- **Fix direction:** At job end, drop held transitions after the last burn (nothing follows them),
  or write `M5` before them.

### P2-2 — On Marlin, an air change between operations stops the head with continuous power still on
- **Where:** `src/core/output/marlin-strategy.ts:21` (body built as `grbl-dynamic`, M4);
  `src/core/output/grbl-output-cursor.ts` (holds transitions only under M3);
  `src/core/output/marlin-inline-transform.ts:15-17` (M4 → continuous `M3 I`).
- **Anchor:** Contract (ADR-398: output never drains the planner with a constant-power beam lit)
  + Ground truth (Marlin 2.1.2.5). `M3-M5.cpp` treats `M3 I` as `CUTTER_MODE_CONTINUOUS`.
  `stepper.cpp` switches off at an empty planner only `if (cutter.cutter_mode == CUTTER_MODE_DYNAMIC)`.
  `M7-M9.cpp` starts with `planner.synchronize()`. `planner.cpp` sets `BLOCK_DELAY_FOR_1ST_MOVE 100U`.
- **Scenario:** Marlin inline (or fan) profile, air output M8, operation A with air on followed by
  operation B with air off (or the reverse). `M9`/`M8` is written right after A's last lit move,
  so the head stops lit until the next `G0` block starts, up to about 100 ms. That leaves a dot
  at each such operation boundary. The fan dialect behaves the same way (the idle fan keeps its
  speed until `M107`).
- **Evidence:** REPRO (lead): `G1 X10.000 Y390.000` (lit, `S77` under `M3 I`) / `M9` /
  `G0 X40.000 Y390.000 F6000 S0`. R2 fetched the Marlin source itself and reproduced the result
  for inline and fan.
- **Refuter:** CONFIRMED (R2). The air selector is not gated by controller
  (`DeviceProfilePowerFields.tsx:134-155`). ADR-398 D1 and the OR/MA tracks cover only M3 GRBL
  and Marlin's job-end `M9`.
- **Fix direction:** Give the cursor Marlin's real mode (continuous ⇒ treat like M3), so its
  hold-until-dark rules apply on Marlin too.

### P2-3 — On an active rotary, the Y rebase throws away the Current Position / User Origin anchor
- **Where:** `src/core/job/rotary-transform.ts:32-37` (`applyRotaryYScale` rebases every job so its
  lowest Y is 0), applied after placement at `src/io/gcode/emit-gcode.ts:126`; the finish still
  uses the anchor (`src/core/output/output-strategy.ts:33-39`).
- **Anchor:** Ground truth + Twin. LightBurn's rotary G-code page says Current Position is the best
  Start From mode and output is "centered around the starting position of the laser head".
  `job-origin.ts:202-214` sets the Y anchor; the rotary transform discards it under G90, although
  its own header says rotation is relative to where the cylinder is. ADR-493 items 2 and 5 assume
  "rotation from the job's own start".
- **Scenario:** Chuck rotary (360 mm/turn, 60 mm object). The operator jogs the cylinder to work
  Y 80 and runs a 40×20 mm job from Current Position (centre). The program first turns the
  cylinder about 80 mm back to work Y 0..38.2, burns there, then parks at Y 80. User Origin
  front-left and back-left give byte-identical output.
- **Evidence:** REPRO (lead): rotary `G0 X80.000 Y38.197 S0` … Y 0..38.197, park
  `G0 X100.000 Y80.000 S0`. The same job on a flat bed burns Y 70..90. R5 and lens F reproduced
  the same.
- **Refuter:** CONFIRMED (R5), P2. The Frame uses the same `machineSpaceJob`, so the operator sees
  the shifted position before Start. Nothing re-zeroes Y (`commands.ts:84,99` are manual).
  ADR-127 covers only the canvas position.
- **Fix direction:** For relative placements, rebase rotary Y to the anchor (work Y of the head /
  user origin) instead of 0, or document and disclose that rotary jobs always start at work Y 0.

### P2-4 — A small whole-number `$30` (1…≈20) turns every power into S0 or full power
- **Where:** `src/core/output/grbl-laser-lines.ts:23-24` (`Math.round` for integer maxima);
  `src/core/job/compile-job-raster.ts:157-158`; `src/core/raster/controller-power-scale.ts:19-29`.
- **Anchor:** Ground truth + Contract. GRBL accepts decimal S (`nuts_bolts.c` `read_float`) and maps
  it linearly (`spindle_control.c`: `floor((rpm-rpm_min)*pwm_gradient)`). PROJECT.md
  non-negotiable 7 says power scale must be honest. ADR-567 built a virtual range "so sub-unit
  maxima do not collapse every pixel to zero or one" but kept integer rounding, without
  addressing small integers.
- **Scenario:** The connected controller reports `$30=1`, which is applied automatically under
  ADR-567, or the profile says Max S 1. A 30% Line emits S0, so the laser never fires and the
  only advisories are `long-blank-feed`. A 50% or 70% Line emits S1, which is full power, while
  Job Review says "50% power". A 30% image is refused with "Internal error: G-code generation
  produced no cuts."; a 70% image burns at S1. `$30=2` gives 33% → S1 (50%).
- **Evidence:** REPRO (lens B, R7): `scaleS` max 1: `30%->S0 50%->S1 70%->S1`; max 1.0001:
  `S0.30003`. `emitGcode` at `$30=1`: `power 50%` → `G1 … S1`. Code read (lead) confirms the
  integer branch.
- **Refuter:** CONFIRMED (R7), P2. P1 by effect, but it needs an unusual `$30`, which does
  occur in the field (LightBurn forum, "Low light laser fire is always on 100%").
- **Fix direction:** Use the virtual range whenever the integer range is too coarse (for example
  `maxPowerS < 1000`), or at least warn in Job Review when percentages collapse.

### P2-5 — `$30=0` and `$31 ≥ $30` are misdescribed, although stock GRBL then fires full PWM on every S0 move
- **Where:** `src/core/controllers/grbl/parse-settings.ts:150,287` (drops `$30=0` as "not
  reported"); `src/core/preflight/controller-readiness.ts:207-215` ("did not confirm $30"),
  `:243-247` ("Low nonzero power values may burn hotter"). These files are cross-area
  (controllers/preflight); they are reported here because they decide whether this area's S0
  means off.
- **Anchor:** Ground truth. gnea/grbl `spindle_control.c` checks
  `(settings.rpm_min >= settings.rpm_max) || (rpm >= settings.rpm_max)` and returns max PWM before
  the `rpm == 0` branch. `stepper.c` calls it for S0 blocks while M3/M4 is active. `settings.c`
  rejects only negatives. Contract: non-negotiable 3 relies on S0 meaning off.
- **Scenario:** The controller reports `$30=0`, or `$31=$30=1000`. On stock GRBL every
  `G0 … S0`, every S0 runway and the preamble `M4 S0` drive full PWM. KerfDesk says only that
  `$30` was "not confirmed" (it was reported), or that low values "may burn hotter".
- **Evidence:** REPRO + SOURCE (lens B, R7). With `$30=0`, the snapshot has no `maxPowerS` and the
  warning is `power-scale-unverified`. With `$30=$31=1000`, only `min-power-nonzero` appears.
  Code read (lead) confirms `value > 0` at `parse-settings.ts:287`.
- **Refuter:** CONFIRMED (R7), P2 (firmware misconfiguration; KerfDesk's fault is the misleading
  message, and under ADR-565 this can only be a warning). grblHAL's PWM computation differs and
  was not confirmed.
- **Fix direction:** Keep `$30=0` as a reported value and add a named Job Review warning
  ("controller fires full power even at S0") for `$30 ≤ $31`.

### P2-6 — The 4040 contour entry is reported as "effective" when no entry is emitted (and on the stock 4040 it never is)
- **Where:** `src/core/job/contour-entry.ts:77` (no entry when `contourEntryBounds` is null);
  `src/core/output/grbl-laser-lines.ts:64` (comment, used at `grbl-strategy.ts:284,311`);
  `src/ui/laser/job-review/job-review-contour-entry-facts.ts:14-30`;
  `src/ui/laser/job-review/job-review-effective-operations.ts:273-279`.
- **Anchor:** Twin + Contract. ADR-343 deliberately omits the entry when bounds are unknown, while
  ADR-239's disclosure and Job Review's "facts from the exact compiled Job" still claim it.
- **Scenario:** The Neotronics 4040 profile has homing off by default, so `resolveNativeBedFrame`
  returns null and `runtimeCoordinatePreparationOptions` (`job-placement.ts:187-198`) sets
  `contourEntryBounds: null` for every placement, Absolute included. Every live job therefore
  starts burning from rest, which is what ADR-239 exists to stop. Meanwhile the file says
  `contour-entry 5.000 mm effective laser-off feed` and Job Review says "5 mm effective target …
  laser off".
- **Evidence:** REPRO (lead): 4040 with `{contourEntryBounds: null}` → comment present, then
  `G1 X30.000 Y370.000 F800 S0 ; kerfdesk:laser-off-motion` / `G1 X50.000 Y370.000 F1500 S300`
  (no ramp). With default options: ramp `G1 X30.000 Y370.000 F1500 S0`. R6 reproduced it with the
  live options for Absolute, User Origin and Current Position.
- **Refuter:** CONFIRMED (R6), with wider scope than first raised.
- **Fix direction:** Derive the comment and Job Review fact from whether an entry was actually
  emitted. Separately, ask the maintainer whether ADR-239 should apply when only the bed size
  (not its native position) is known.

### P2-7 — Image overscan over 5 mm fills Job Review and Save with false "long blank feed … regenerate" warnings
- **Where:** `src/core/raster/emit-raster-sweep.ts:224-245, 258-277` (image runways written without
  the marker); `src/core/preflight/laser-off-motion-policy.ts:72` (only marked lines are excused);
  `src/core/preflight/preflight.ts:364-378`.
- **Anchor:** Contract + Twin. ADR-415 §4 and ADR-495 §4 say the allowance for marked laser-off runs
  covers the largest image overscan. The scan-line fill emitter marks its runways
  (`laserOffRunwayLine`); the image emitter does not.
- **Scenario:** An image with Overscan 8–25 mm, or Automatic at about 4,050 mm/min or faster
  (500 mm/s²). KerfDesk's own runway advisory recommends about 10 mm at 6,000 mm/min, so
  following it produces up to five `long-blank-feed` warnings ("Regenerate output or lower the
  fill blank-feed threshold", a threshold the UI does not have) in Job Review and the Save toasts.
- **Evidence:** REPRO (lens C, lens E, R3, independently): with `imageOverscanMm: 10`, `ok=false`
  and 4 × `long-blank-feed: … blank G1 feed move 10.000 mm exceeds 5.000 mm`; the same layout as
  a fill is clean. Code read (lead) confirms line 72.
- **Refuter:** CONFIRMED (R3), P2 at the low end (advisory only, never blocks: `blocking-codes.ts:32-48`).
- **Fix direction:** Mark image runway lines with `kerfdesk:laser-off-motion`, or excuse unmarked
  raster S0 runways up to the image overscan.

### P2-8 — The motion manifest reads every Smoothieware burn as travel, so the live job view is wrong
- **Where:** `src/core/job/motion-manifest-parser.ts:156` (beam on only for M3/M4/M106) and
  `:187-199`; the emitter rewrites M3/M4 to `M400` + `M221 S100 P0`
  (`src/core/output/smoothieware-strategy.ts:63`).
- **Anchor:** Twin. The Inspector render model has a Smoothieware power mode and counts 392 mm
  of cutting; the manifest counts 0.
- **Scenario:** Every Smoothieware laser job. The live canvas draws burns as travel
  (`draw-canvas-motion-route.ts:134,153`), with no burn glow or trail (`draw-burn-trail.ts:34-38`)
  and no job-start marker. The camera burn check says "The camera could not see the job's path."
  (`BurnCheckResult.tsx:90`), and the executable plan reports 0 mm of process.
- **Evidence:** REPRO (lead): `buildMotionManifest(smoothieGcode)` kinds = 6 × `travel`; GRBL =
  `travel, process ×4, park`. R6 and lens E reproduced it.
- **Refuter:** CONFIRMED (R6), P2 at the low end (display and monitoring, no machine effect). The
  claimed "nothing to burn" text was corrected to the camera message above.
- **Fix direction:** Teach the manifest Smoothieware's `M221 S100 P…` / `M221 S0` power state, as
  the Inspector already does.

### P2-9 — Open outlines (a CAD DXF drawn as LINE entities) silently lose kerf compensation and inside-first, with no warning
- **Where:** cross-area root cause in `src/io/dxf/dxf-entities.ts:56-61`: each LINE becomes an
  open 2-point polyline, and nothing chains coincident ends on import (`dxf-import-action.ts`
  says only "Imported N paths"). There is also no Line-layer advisory for open paths. The engine
  follows the closed-shape rule: `src/core/job/laser-lead-sides.ts:104` feeds
  `kerf-scene-sides.ts:62`, and `compile-line-topology.ts` nests closed segments only (ADR-486
  Amd 2: "original open paths never become invented closed parents").
- **Anchor:** Twin + Ground truth.
  - Twin: Fill warns about open contours (`offset-fill-open-contour`) and CNC warns too
    (`cnc-open-contours-omitted`), but a Line layer with kerf, inside-first or leads says nothing.
  - Ground truth: LightBurn documents the same closed-only rule, and that the outer shape "must
    be closed" for inside-first. A LightBurn staff forum post says its DXF import auto-closes
    lines whose ends meet within the tolerance
    (forum.lightburnsoftware.com/t/dxf-import-circle-is-broken-into-small-segments/50968; forum,
    not docs).
- **Scenario:** The same 80 mm plate DXF (four LINEs plus a CIRCLE r5) on a Line layer with Kerf
  Offset 0.2 mm.
  - The hole is offset as an outer part, so its mean radius is 5.202 instead of 4.800, which makes
    the hole 0.8 mm oversize.
  - The plate lines get no compensation (0..80 instead of −0.2..80.2), so the plate is 0.4 mm
    undersize.
  - With default optimisation the four plate lines are cut before the hole, so the part can be
    freed before its hole is cut.
  - Diagnostics, advisories and preflight are all empty.
- **Evidence:** REPRO (lead, `parseDxf` → `emitGcode`): `holeMeanR=5.2016 outlineX=0.000..80.000 issues=[]`.
  R4 and R8: a closed LWPOLYLINE outline gives r 4.7997 and an outline at −0.2..80.2. Lead's leads
  run (P1-2): the four plate `G1` lines are emitted before the hole.
- **Refuter:** CONFIRMED as behaviour (R8, P2). R8 REFUTED it as a kerf or inside-first engine defect:
  those follow the documented closed-shape rule (tooltip "closed Line cuts",
  `CutSettingsCommonFields.tsx:144`), which LightBurn shares. The defect is the missing join and
  warning, so the coordinator may route the fix to area 14 (vector importers).
- **Fix direction:** Chain coincident LINE/ARC endpoints on DXF import within a tolerance, and add a
  Line-layer advisory for open paths when kerf offset, inside-first or leads are in use. Do not
  make open paths containers in the kerf or lead code.

### P3 findings (one entry each; all NEW, all refuter-CONFIRMED unless noted)
- **P3-1** `src/core/output/air-keep-alive.ts:107`: on Marlin with Air restart ticked, the keep-alive
  inserts `M8` between lit burn moves, about every 3 moves, and each is a lit stop of up to 100 ms
  (same root cause as P2-2; ADR-462 line 56 says "Under M4 any stop is already dark", which is
  false on Marlin). REPRO (lens A, R2).
- **P3-2** `src/core/preflight/preflight.ts:302-316`: the out-of-bed overscan hint always says
  "left/right edges", even for a 90° image or fill whose runways run in Y. REPRO.
- **P3-3** `src/core/raster/controller-power-scale.ts:32-42`: fractional `$30` raster S words carry
  float noise (`X54S20.301000000000002`, `S.23099999999999998`), unlike vector `scaleS`
  (`toPrecision(12)`). GRBL drops the extra digits silently (`nuts_bolts.c`), so the only cost
  is bytes. Merged from lens C and lens B. REPRO.
- **P3-4** `src/core/job/compile-job-raster.ts:163-167`: on very small images the row pitch is
  height ÷ round(height × lines/mm) (for example 0.0833 mm for a 0.1 mm interval at 0.25 mm tall).
  This is deliberate even spreading; `raster-units.ts` overstates "the interval the compiler will
  burn". REPRO.
- **P3-5** `src/core/preflight/relative-motion-envelope.ts:43,55`: the relative span check seeds
  work (0, 0) even for Current Position jobs, which never visit it. With the head at X 380 and a
  40 mm job, it warns "spans 420 mm … Scale the artwork down". Advisory only; lens proposed P2,
  refuter P3. REPRO.
- **P3-6** `src/core/job/job-coordinate-encodability.ts:94-96`: the laser finish position is never
  checked, so a hand-edited `xMm: 1e21` emits `G0 X1e+21`. `1e20` would also pass the regex, so a
  range check is needed too. REPRO.
- **P3-7** (L7) `src/core/output/__fixtures__/laser-job-arbitraries.ts`, `grbl-strategy.property.test.ts`:
  the laser-off and bounds properties use only `DEFAULT_DEVICE_PROFILE` (M4), cut and fill only,
  in-bed points. They never fuzz M3 dialects, raster, `powerMode` or the 4040 travel, so they hold
  by construction (non-negotiable 13). READ + REPRO (the lead lens's 1,600-run fuzz over those
  cases found nothing today).
- **P3-8** (L7) `src/core/raster/emit-raster.property.test.ts:58-67, 86-101`: `startsWith('G0 ')`
  and `/^G[01]\s+X/` match nothing on the compact spelling the default dialect ships, and no
  property asserts a dark overscan. REPRO.
- **P3-9** (L7) No lead test uses a `jobOrigin`, and none checks lead output under a
  non-front-left origin; no test combines rotary with a placement mode (it would have caught
  P2-3). Corrected by R5: `canvas-start-editing-leads-arcs.audit.test.ts:24` uses two origins but
  checks only the start.
- **P3-10** ADR-626 clause 4 and "Why this is better" overstate Amendment 1 D1. With Cut selected
  graphics or an output-off neighbour, uncut parts are not obstacles, so a lead can end inside
  them (0.773 mm at a 0.5 mm gap; up to the lead length). Raised as P2; refuted as a contract
  break (Amendment 1 D1 chose this) and kept as doc drift for a maintainer decision. REPRO.
- **P3-11** `src/ui/laser/job-intent-warnings.ts:255-274`: the traced-artwork warning names the
  dialect default (M4) even when a layer forces Constant (`M3 S0` emitted) or on Marlin (`M3 I`).
  It should use `vectorPowerWord`. REPRO.
- **P3-12** `src/core/gcode-view/finding-checks.ts:91-106`: the Inspector flags KerfDesk's own Focus
  Test output (`G0` after `G91 / G1 Z-1 / G90`) as "rapid below Z0". Inspector only. REPRO.
- **P3-13** `src/core/job/job-bounds.ts:176-182`: for arc-fitted contours the Frame reads only the
  arcs, but the overcut final pass is written as chords up to 0.025 mm outside them (measured
  0–0.0089 mm). Physically negligible (non-negotiable 21 in principle). REPRO.
- **P3-14** `src/io/gcode/executable-plan-parity.ts:105-145`: parity compares endpoints only, so
  P2-8's 0 mm process and a 4040 exit runway labelled `park` pass. No consumer acts on either
  today. REPRO.
- **P3-15** `src/ui/app/file-actions.ts:255`: Save evaluates readiness against the saved profile
  while the bytes use the connected `$30` (`save-gcode-emission.ts:60`). The toast says the file
  "may not run safely" when it is correct; Start (`start-job-readiness.ts:345`) is right. REPRO.
- **P3-16** `src/ui/laser/job-review/job-review-effective-operations.ts:240-243`: the laser summary
  shows the unrounded speed (88.9 mm/min, typical with the Inches preference) while the program
  writes `F88`; the CNC summary at `:215` rounds. REPRO.

## Refuted
- **C-C-3** Scan angle 180° emits the same rows as 0°, and 90° rows step right to left, unlike
  LightBurn's row order. Refuted: ADR-492 §1 decides that 0 and 180 mean "along X" and verifies
  identical G-code. The burned picture is identical; only the row order differs.
- **C-D-3** (as a contract break) Leads ignore uncut neighbours under an output scope. Amendment 1
  D1 chose this; kept as P3-10 doc drift.
- **C-K-1 / C-K-2** (as engine defects) An open-outline hole gets outward kerf, and the outer lines
  are cut before the hole. Refuted at `kerf-scene-sides.ts` / inside-first: both follow the
  documented closed-shape rule that LightBurn shares ("only works with shapes that are closed";
  "The outer shape must be closed"). Kept as P2-9 at the import/advisory level.
- Duplicates merged: C-E-2 → P2-7 (third independent repro); C-B-3 → P3-3; C-K-1 + C-K-2 → P2-9.
- Considered and dropped by a refuter: a zero-width image makes `emitGcode` throw
  ("bounds must be positive"). It is caught (`output-preparation-worker.ts:35-39`,
  `start-job-source.ts:186-195`) and the canvas clamps scale, so there is no user-visible crash.

## Verified clean
- **Laser off on travel (non-negotiable 3):** every GRBL dialect has `requiresS0OnRapid: true`
  (`gcode-dialects.ts`), so the no-S0 branch at `grbl-laser-lines.ts:51` is unreachable. Every seek,
  excursion, raster travel (`emit-raster-travel.ts:102`), park and 4040 controlled `G1 … S0`
  carries S0. 14 project scenarios + 27 burn-geometry scenarios + 2,500 random jobs (lens A) and a
  1,600-run M3/M4/raster/air fuzz (lens F), checked with `findLaserOnTravelIssues`,
  `findM3LitPlannerDrains` and a `$32=0` oracle, all clean.
- **GRBL ground truth** (laser-mode wiki fetched): G0 "will never turn on and always disable the
  laser"; S0 turns the laser off; M4 is off when not moving. With `$32=0`, `G0 … S0` sets S0
  before moving.
- **Mid-job M3 (OR-1):** no lit planner drain across passes, cut→fill→raster→cut, M3↔M4,
  alternating air, coincident starts, blank groups, focus test, raster-last. Held lines are never
  lost mid-job.
- **No lit G1 joins separate shapes:** arcs (multi-pass + overcut), ADR-239 entries, tabs and
  tab power, perforation, scan/offset/island fill, raster at 0° and 30°.
- **No partial output (non-negotiable 4):** emission builds one string; unencodable coordinates and
  out-of-memory errors return `gcode: ''`; other errors throw before any write.
- **Values:** power 0–100 validated on load and clamped in compile (`effective-output.ts`); 0.04% →
  S0, 0.05% → S1, 99.95% → S1000. Fractional and huge `$30` (0.5, 100.5, 65535, 123456789) are
  spelled exactly, with no exponent. The execution copy leaves `device.maxPowerS` unchanged.
  Overrides, `byOperation`, tab-span power, air M7/M8/M9 per group, speed over `maxFeed` (clamped
  and disclosed), passes and G21-only are all correct; there is no laser Z step to drop.
  Min power is not used for GRBL vectors, matching LightBurn's documentation.
- **Number formatting:** `formatGcodeDecimal` expands exponents; coordinates are 3 dp with −0
  canonicalised; no locale formatting; `formatGcodePowerS`'s leading-dot form fits GRBL's 8-digit
  `read_float`.
- **Raster:** overscan is dark at both ends at burn feed on M4, M3, the 4040, Marlin and Smoothie,
  with the set length (0/3/10/25 mm) and the automatic formula. Overscan is inside job and Frame
  bounds. Scan offset applies to reverse rows only, interpolated and clamped as ADR-052 says. Rows
  are pixel-centred inside the image. S mapping (dark = more, white = S0, min power, negative) is
  correct. Angles and cross-hatch are correct. All-white, 1×1 and blank rows behave.
- **Coordinates:** 5 origins × {absolute, user origin, current position} give the right signs and
  anchors. There are no device mirror or rotate settings. The only `G91` (Focus Test) is restored
  on the next line. Parks come after M5/`M5 I`/M107/`M221 S0`. The out-of-bed check scans every
  emitted motion line. Rotary scale is applied exactly once.
- **Leads (ADR-626):** 65 adversarial geometry runs (C shapes, nested islands, touching and
  overlapping parts, tiny holes, figure-8s, acute tips), kerf ±0.1/±0.3, copies, bed corner: 0
  intrusions when every part is a closed contour in the job. Power and feed are constant across
  lead and contour on 5 dialects; each pass leads in and out; overcut runs on the final pass only;
  output is byte-identical with leads off.
- **Twins:** across 48 configurations the emitted program stays inside `computeFrameJobMotionBounds`
  (except P3-13). Preview cut length and extent match the lit G-code. The time estimate re-emits
  through the same strategy and matches a timeline of the real program to 1 ms. The second-pass
  writer keeps mode, S, F and darkness. `grblPowerModeWordsForJob` and the park target agree with
  emission. Start re-checks the prepared motion-bounds signature against the completed Frame
  (ADR-565).

## Not verified
- No hardware, air-cut or material runs. Marlin dwell timing and grblHAL/FluidNC on-delays come
  from firmware source only; grblHAL's PWM path for `$30 ≤ $31` was not confirmed.
- Ruida `.rd` bytes, CNC output, recovery/resume transforms, live route reconciliation, streamed
  (row-provider) rasters above about 4 M pixels, and the rotary seam in emitted lead G-code.
- UI-level wiring was traced in code for P2-8, P3-5 and P3-15; it was not driven in a browser.
- The SVG import path for layer colours normalises through `createLayer` (R1), but other
  importers were only read.

```json
[
  {"id":"P1-1","severity":"P1","area":"laser-output","file":"src/core/output/grbl-strategy.ts","line":284,"anchor":"Twin+Contract: cnc-grbl-group-comments.ts sanitizes layerId; ADR-273","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Unsanitised layer id/colour in laser G-code comments lets a crafted .lf2 inject an unframed full-power burn line"},
  {"id":"P1-2","severity":"P1","area":"laser-output","file":"src/core/job/laser-lead-sides.ts","line":104,"anchor":"Contract: ADR-626 clause 4, Amd 1 D3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Leads burn ~1.5-2 mm into the plate when the outer outline is open (DXF LINE entities): hole judged outer, no warning"},
  {"id":"P1-3","severity":"P1","area":"laser-output","file":"src/io/gcode/prepare-output.ts","line":269,"anchor":"Contract: ADR-626 clause 4; Twin: laser-lead-sides vs laser-lead-rings","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remove overlapping lines opens a neighbour's outline before leads, so a lead burns up to 2 mm into the neighbour part"},
  {"id":"P2-1","severity":"P2","area":"laser-output","file":"src/core/output/grbl-strategy.ts","line":490,"anchor":"Contract: ADR-398 D1; Ground truth: grblHAL coolant_control.c on_delay","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A blank last group releases a held M8/M7 straight after the final lit M3 burn; with an air on-delay the beam dwells lit"},
  {"id":"P2-2","severity":"P2","area":"laser-output","file":"src/core/output/marlin-strategy.ts","line":21,"anchor":"Contract: ADR-398; Ground truth: Marlin 2.1.2.5 M7-M9 synchronize, CUTTER_MODE_CONTINUOUS","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On Marlin, an air change between operations is written right after a lit burn, stopping the head with continuous power on"},
  {"id":"P2-3","severity":"P2","area":"laser-output","file":"src/core/job/rotary-transform.ts","line":32,"anchor":"Ground truth: LightBurn rotary Current Position; Twin: job-origin.ts anchor","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Rotary Y rebase to 0 discards the Current Position / User Origin Y anchor, so the cylinder turns before burning"},
  {"id":"P2-4","severity":"P2","area":"laser-output","file":"src/core/output/grbl-laser-lines.ts","line":23,"anchor":"Ground truth: GRBL decimal S, linear PWM; Contract: NN7, ADR-567","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A small whole-number $30 (e.g. 1) rounds every power to S0 or full power while Job Review shows the set percentage"},
  {"id":"P2-5","severity":"P2","area":"laser-output","file":"src/core/controllers/grbl/parse-settings.ts","line":150,"anchor":"Ground truth: gnea/grbl spindle_control.c rpm_min>=rpm_max -> max PWM","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"$30=0 and $31>=$30 (stock GRBL fires full PWM on S0) are reported as 'not confirmed' / 'may burn hotter'"},
  {"id":"P2-6","severity":"P2","area":"laser-output","file":"src/core/output/grbl-laser-lines.ts","line":64,"anchor":"Twin+Contract: ADR-239 disclosure vs ADR-343 omission","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"4040 contour entry is reported as effective in G-code and Job Review while every live job with unknown bounds emits none"},
  {"id":"P2-7","severity":"P2","area":"laser-output","file":"src/core/raster/emit-raster-sweep.ts","line":224,"anchor":"Contract: ADR-415 s4, ADR-495 s4; Twin: fill runway marker","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Image overscan over 5 mm raises false long-blank-feed 'regenerate output' warnings because raster runways are unmarked"},
  {"id":"P2-8","severity":"P2","area":"laser-output","file":"src/core/job/motion-manifest-parser.ts","line":156,"anchor":"Twin: Inspector smoothieware power mode vs manifest","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Motion manifest classifies every Smoothieware burn as travel: live canvas, burn trail, start marker and camera check are wrong"},
  {"id":"P2-9","severity":"P2","area":"laser-output","file":"src/io/dxf/dxf-entities.ts","line":56,"anchor":"Twin: Fill/CNC open-contour advisories vs none on Line; Ground truth: LightBurn closed-only rule + DXF auto-close (forum)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Open DXF LINE outlines silently lose kerf compensation (hole +0.8 mm, plate -0.4 mm) and inside-first; no join on import, no Line-layer warning (cross-area: importers)"},
  {"id":"P3-1","severity":"P3","area":"laser-output","file":"src/core/output/air-keep-alive.ts","line":107,"anchor":"Contract: ADR-462; Ground truth: Marlin M8 synchronize","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Air keep-alive on Marlin inserts M8 between lit burn moves (lit stops)"},
  {"id":"P3-2","severity":"P3","area":"laser-output","file":"src/core/preflight/preflight.ts","line":302,"anchor":"Twin: ADR-492 runways along scan line","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Out-of-bed overscan hint says left/right even when runways run in Y"},
  {"id":"P3-3","severity":"P3","area":"laser-output","file":"src/core/raster/controller-power-scale.ts","line":32,"anchor":"Twin: scaleS toPrecision(12)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Fractional $30 raster S words carry float noise (wasted bytes)"},
  {"id":"P3-4","severity":"P3","area":"laser-output","file":"src/core/job/compile-job-raster.ts","line":163,"anchor":"Twin: raster-units.ts interval claim","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Small images burn a row pitch up to ~17% off the displayed line interval"},
  {"id":"P3-5","severity":"P3","area":"laser-output","file":"src/core/preflight/relative-motion-envelope.ts","line":43,"anchor":"Twin: finishOptionsForJobOrigin / Frame envelope","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Relative span check seeds work 0,0 for Current Position jobs, giving a false 'exceeds the bed' advisory"},
  {"id":"P3-6","severity":"P3","area":"laser-output","file":"src/core/job/job-coordinate-encodability.ts","line":94,"anchor":"Twin: CNC park is checked","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Laser finish position bypasses the coordinate-encodability check (G0 X1e+21)"},
  {"id":"P3-7","severity":"P3","area":"laser-output","file":"src/core/output/__fixtures__/laser-job-arbitraries.ts","line":1,"anchor":"Contract: NN13","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Laser-off/bounds property tests never generate M3 dialects, raster, powerMode or 4040 travel"},
  {"id":"P3-8","severity":"P3","area":"laser-output","file":"src/core/raster/emit-raster.property.test.ts","line":58,"anchor":"Contract: NN3, NN13","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Raster property predicates are vacuous on the shipped compact spelling; no dark-overscan property"},
  {"id":"P3-9","severity":"P3","area":"laser-output","file":"src/io/gcode/laser-leads-output.test.ts","line":1,"anchor":"Contract: ADR-626 Amd 1, NN2","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No lead test with a jobOrigin or non-front-left output check; no rotary+placement test"},
  {"id":"P3-10","severity":"P3","area":"laser-output","file":"src/core/job/laser-lead-rings.ts","line":67,"anchor":"Contract: ADR-626 clause 4 vs Amd 1 D1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Doc drift: under an output scope leads can end inside uncut neighbour parts, contrary to clause 4's wording"},
  {"id":"P3-11","severity":"P3","area":"laser-output","file":"src/ui/laser/job-intent-warnings.ts","line":255,"anchor":"Twin: vectorPowerWord","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Traced-artwork warning names M4 when a layer forces Constant (M3) or on Marlin"},
  {"id":"P3-12","severity":"P3","area":"laser-output","file":"src/core/gcode-view/finding-checks.ts","line":91,"anchor":"Twin: laser machineKind Z semantics","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Inspector flags KerfDesk's own Focus Test as rapid below Z0"},
  {"id":"P3-13","severity":"P3","area":"laser-output","file":"src/core/job/job-bounds.ts","line":176,"anchor":"Twin/Contract: NN21 Frame vs emitted","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Frame up to 0.025 mm smaller than a chord overcut pass on arc-fitted contours"},
  {"id":"P3-14","severity":"P3","area":"laser-output","file":"src/io/gcode/executable-plan-parity.ts","line":105,"anchor":"Twin: plan intent vs program","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Executable-plan parity compares endpoints only; wrong process/park labels pass"},
  {"id":"P3-15","severity":"P3","area":"laser-output","file":"src/ui/app/file-actions.ts","line":255,"anchor":"Twin: start-job-readiness.ts uses execution copy","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Save toast reports a $30 mismatch for a file already scaled to the connected $30"},
  {"id":"P3-16","severity":"P3","area":"laser-output","file":"src/ui/laser/job-review/job-review-effective-operations.ts","line":240,"anchor":"Twin: feed-word.ts floor","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Job Review laser speed is unrounded while the program writes the floored F"}
]
```
