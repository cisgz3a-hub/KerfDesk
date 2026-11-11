# Rolling audit v14 — Z3 Rotary feed verify: does the glass burn evenly round the part, and does KerfDesk say so when it can't?

- **When:** 2026-11-11 +0800. **Tree:** origin/main @ `236cccf6e`.
  - #1698 (`2ec550c34`, ADR-127 Amd 3 + ADR-315 Amd 2) merged as `9810c8c58`, and also inside #1697 as `81041133f`.
  - Since then, only three commits touch the files below:
    - `ab3226fd1` (shared helpers, no result change);
    - ADR-699 (`91f9406b6`, 3D Sliced and Fill Ramp);
    - ADR-705 (`41ad2106a`, Moshiboard).
  - The last two are checked here as untested merges.
  - Repros ran on the scratchpad export `j25-main` (`236cccf6e`, `node_modules` a junction). The 1.0.30 comparison ran the 1.0.30 source itself (`j18-main`, `ffd9fe66b`). Neither tree was edited.
- **Scope:** v13 Y5-P2-1 (taper clamp warning), Y5-P1-3 (row-step rounding), Y5-P2-2 (old-project notice), and regressions of the feed rule.
  - **Code read:**
    - `src/core/output/{rotary-surface-feed,grbl-strategy,grbl-fill-emission,grbl-polyline-burns}.ts`
    - `src/ui/laser/job-review/{rotary-surface-speed-warnings,rotary-row-step-warnings,rotary-row-placement,job-review-model}.ts`
    - `src/io/project/{old-project-rotary-feed,old-project-burn-notice,deserialize-project}.ts`
    - `src/ui/state/{old-project-burn-review,old-project-burn-messages,project-load-notices,autosave-record}.ts`
    - `src/core/job/{rotary-job,rotary-transform,rotary-taper-warp,rotary-taper-profile,fill-ramp,compile-job-raster,estimate-duration}.ts`
    - `src/io/moshi/emit-moshi.ts`, `src/core/controllers/moshi/moshi-job-encoder.ts`, `src/ui/state/moshi-usb/moshi-usb-job.ts`
    - ADR-127 Amd 2/3, ADR-315 Amd 2, ADR-694, ADR-695 (+Amd 1), ADR-698, ADR-699, ADR-705.
- **Lenses:**
  - **L10:** every Y5 number re-measured.
  - **L12:** #1698 × ADR-699, × ADR-705, × ADR-695 Amd 1.
  - **L3:** Y port vs A vs Z; GRBL, Marlin, grblHAL, the A1 Pro preset, FluidNC, Moshi; Job Review vs the program vs the ETA.
- **Method:**
  - **Real code:**
    - output: `emitGcode`, `prepareOutput`, `machineSpaceJob`, `estimateJobDuration`;
    - Moshi: `emitPreparedMoshiJob` and the real `decodeMoshiProgram`;
    - project loading: `deserializeProject`, `pushProjectLoadNotices`, `oldProjectBurnReviewWarnings`;
    - Job Review: the detectors `detectRotarySurfaceSpeedWarnings`, `detectRotaryRowStepWarnings` and `detectRotaryRasterQualificationWarnings`. `job-review-model.ts:114-119` calls them with the prepared job and the live `$$` settings.
  - **Own physics** (`zz-z3\lib.mts`, copied from the v13 Y5 auditor's hardware model, not from `rotary.ts`):
    - A chuck turns the part 2π per motion-per-turn units.
    - A roller drives the part at its wide end.
    - A cone's radius is linear along the side.
    - The controller times F over the commanded XYZA vector, with degrees counted as mm on A.
    - Dose = layer speed ÷ surface speed.
  - **Own G-code reader:** per-axis G92, G0/G1, F, S, M3/M4/M5.
  - **Own step model:** `lround(work × steps/unit)` with work zero on a whole step. Phases are moved by real artwork, not by arithmetic.
  - **Own planner cap** for the A/Z rate: a block is held so no axis passes its `$11x` rate (GRBL planner.c `limit_value_by_axis_maximum`, as v13 cited it).
  - No browser and no hardware. The only network use was one `gh` read of #1698's checks.
- **Memory:** Node scripts only, at 3.9–4.0 GB free. No Vitest or browser was run (see Not verified).
- **Counts:** 7 raised → refuter pending → P1 2 / P2 1 / P3 4 (+ 5 known).
- **Note:** the coordinator saved this report from the auditor's final message, because the harness blocked the auditor's own file write.

## Headline

**#1698 fixes all three Y5 items, measured. The taper warning is exact, the row advice lands evenly, and old projects say their burn changed. But two routes that merged after #1698 ignore the feed rule and spoil the glass silently: a ramped Fill on a rotary, and any rotary on a Moshiboard.**

**Fixed (Y5-P2-1).** I emitted 192 jobs: 6 setups, both taper directions, Reverse, a line and fills at 0°, 45° and 90°, on GRBL, Marlin, grblHAL, FluidNC and the A1 Pro. Every job that Max feed holds back now warns before Start.
- For lines and 90° fills, the warning's "up to N %" is within 0.4 points of the measured worst dose (121 % said, 121.3 % measured; 223 % vs 222.8 %).
- For 45° fills it reads high (173 % vs 171.4 %; 400 % vs 395.7 %).
- The suggested speed burns at 100.00–100.12 %, and the warning then goes away.
- It is silent wherever nothing is held.
- v13 measured 108–122 % at the narrow end, with no warning.

**Fixed (Y5-P1-3).** v13's case (Ø80 glass, Creality chuck, `$101`=80, 30 mm photo at one step) still doubles 136 of 382 rows. Now Job Review says exactly that and points to 0.1571 mm.
- Every suggested interval, typed as printed, lands evenly:
  - on the Y chuck at 80, 100 and 160 steps/mm;
  - on Ø70;
  - on a taper.
- The seam on a full wrap is 0.1571 mm, the same as every other gap.
- One leftover: the A1 Pro's one-step advice (Z3-P3-1).

**Fixed (Y5-P2-2).** The 1.0.29 golden and exactly the scaled 1.0.30 goldens now open with a notice:
- "up to 6.28×" on the chuck (6.30× measured against the 1.0.30 source);
- "up to 1.96×" on the roller (1.97× measured).
- Disabled, surface-calibrated and image-only projects stay quiet, and their output is byte-identical.
- It also fires on old projects whose output did not change (Z3-P3-3).

**What still spoils the glass (new; both are untested merges):**
- **A ramped Fill (ADR-699) on a rotary (Z3-P1-1).** The ramp keeps its hatch angle on a rotary, which images never do.
  - At 30° or 45° on the A1 Pro (A), the job passes every check. It burns the shape 45–61 mm along the glass and 82–134° round it from where it was drawn, at 116 % dose.
  - At 90°, or on a Y-port rotary, it is refused with a false reason ("wraps 8.63 turns").
- **A Moshiboard with a Y-port rotary (Z3-P1-2).** The Moshi encoder writes one speed per layer.
  - Strokes round an Ø80 glass in the Creality chuck burn at 15.9 % of the set energy, and on a geared roller at 184 %.
  - That is exactly X8-P1-1, which #1672 fixed for G-code. There is no warning.

**Smaller:**
- **0° Fill rows (Z3-P2-1).** Fill hatch lines round the part sit on the same step grid as image rows, but nothing checks them.
  - The default 0.1 mm hatch on an Ø150 bowl burns 96 of 300 rows twice.
  - A 0.05 mm hatch on Ø80 burns 218 of 600 twice.
  - Both are silent. An image at the same pitch warns.
- **P3s:**
  - the A1 Pro's one-step advice depends on where the photo sits (Z3-P3-1);
  - an "up to 100 %" warning on a 0° fill at Max feed on a taper (Z3-P3-2);
  - the old-project notice on unchanged output (Z3-P3-3);
  - the row-step warning naming a ramped Fill "Image layer operation-…" (Z3-P3-4).

**Answer for the maintainer:**
- **Safe today on G-code controllers:**
  - tapered or straight glass, lines and fills at any angle, as long as the fill has no ramp;
  - photos at the interval Job Review names, on the Y chuck, wherever the photo sits;
  - Job Review tells you whenever Max feed or the rotary's own rate holds a stroke back, and the speed it suggests burns evenly.
- **Not safe yet:**
  - a Fill with Ramp length set, unless its hatch angle is 0° and Cross-hatch is off;
  - any rotary job on a Moshiboard;
  - 0° fills on a large part (an Ø150 bowl), or with a hatch under one rotary step (0.0785 mm on Ø80).

## Before and after vs v13

| v13 finding | Fix | v13 number (`8493f590c`) | Now (`236cccf6e`) | Verdict |
|---|---|---|---|---|
| **Y5-P2-1** taper × Max-feed clamp (refuter: P1) | #1698, ADR-127 Amd 3 D1 | Ø80→Ø70 cup, geared roller, 3200 mm/min: base 108–111 %, no warning. Ø88→Ø72 tumbler, k = 1 roller, 6000 mm/min: narrow end 118.7–122.2 %, no warning; none could ever fire for k ≤ 1 | Ø88→Ø72 tumbler over 150 mm, 192 jobs (`t1-taper-clamp.txt`). Every held job warns (83/83): k = 1 at 5056 mm/min (102.2 %, warns 102 %); k = 1 at 6000 (121.3 %, warns 121 %); geared roller (222.8 %, warns 223 %); grblHAL/FluidNC A (158.0 %, warns 158 %). Both taper directions, top left or right, and Reverse give the same. At the suggested speed: 100.00–100.12 %, warning gone. A1 Pro A (Max feed 36,000) is never held and never warns. With the A/Z axis rate as well (`t8-taper-axisrate.txt`), both warnings appear and the lower speed burns 100.02–100.24 % | **FIXED** (noise at 100 %: Z3-P3-2) |
| **Y5-P1-3** row-step advice (refuter: P2) | #1698, ADR-315 Amd 2 | 12.73 lines/mm on Ø80, `$101`=80, 30 mm photo: 136/382 rows burned twice, warning silent | The same entry: 136/382 doubled, and Job Review says "136 of its 382 rows land on the row before and burn twice. … set the line interval to 0.1571 mm (6.37 lines/mm, 2 steps)" (`t2c-old-case.txt`). Each suggested interval, typed as printed: 0 doubled and ≤ 2 off gaps on 10 setups × 6 layouts × 3 heights (`t2-rows.txt`), and at 20 phases on the Y chuck (`t2b-phase.txt`). Ø150: "no interval lands every row; 0.1473 mm comes closest, with 7 of 68 rows doubled", and it stays warned | **FIXED** (A1 Pro one-step leftover: Z3-P3-1) |
| **Y5-P2-2** old-project notice | #1698, ADR-127 Amd 3 D2 | 1.0.29 golden: no notice; round strokes 6.28× the old dose | 1.0.29 golden: "up to 6.28×" in the toast and in Job Review; measured against the 1.0.30 source, 1–6.30× on 62 of 64 lit moves. 1.0.30 goldens: chuck and reversed chuck "up to 6.28×" (6.30× measured); scaled roller "up to 1.96×" (1.97×); surface roller and disabled: no notice, byte-identical (`t6-oldproject.txt`) | **FIXED** (false notices: Z3-P3-3) |

## Findings

### Z3-P1-1 — A ramped Fill on a rotary keeps its hatch angle: at 30° or 45° on an A rotary it burns 45–61 mm along the glass and 82–134° round it from the design, with no warning

- **Where (236cccf6e):**
  - `src/core/job/fill-ramp.ts:60-66` takes the angles from `layer.hatchAngleDeg` (plus 90° for Cross-hatch), with no rotary rule. `:125` keeps `scanAngleDeg` on the raster group.
  - Images have that rule. `src/core/job/compile-job-raster.ts:151-163` (`rasterScanRuns`) scans every pass along X on a rotary and raises `image-scan-angle-rotary` (ADR-492 D9).
  - `src/core/job/rotary-transform.ts:139-145` (`mapRasterGroup`) then scales `bounds.minY/maxY` as if they were bed Y. A turned raster's bounds are in its own scan frame.
- **Anchor:**
  - **Contract:** ADR-492 D9 ("A rotary scans every pass along X") and ADR-127 (one machine-space job for every consumer).
  - **Twin:** the same 45° Fill without a ramp burns at X 60–80, A 0–28.65°, exactly the design. The same ramp at 0° also burns right.
- **Scenario:** the maintainer engraves a stamp-style badge round a glass on the A1 Pro (A preset). The badge is a 45° Fill with Ramp length 2 mm, the stamp look ADR-699 adds.
  - Job Review shows the generic rotary-raster note and a row-step note. Start is allowed.
  - The badge burns about 45 mm further along the glass and about 134° further round it than drawn, as diagonal stripes at 116 % dose.
  - The Frame traces the same wrong place. A Frame is not a warning (METHOD §3).
- **Evidence:** REPRO.
  - `zz-z3\t4c-ramp-review.mts` → `out\t4c-ramp-review.txt`. A1 Pro A, Ø80, a 20 mm square drawn at X 60–80 (design turn 0–28.65°):

    | Fill | Preflight | Burn X | Burn A | Review |
    |---|---|---|---|---|
    | 0°, ramp 2 mm | ok | 60–80 | 0.21–28.72° | row-step note + raster note |
    | **45°, ramp 2 mm** | **ok** | **105.26–133.89** | **134.12–162.75°** | the same two notes only |
    | **30°, ramp 2 mm** | **ok** | **115.45–141.31** | **81.77–111.96°** | the same two notes only |
    | 45°, no ramp (control) | ok | 60–80 | 0–28.65° | none |
    | 0°, ramp, Cross-hatch | refused: "wraps 288.0 mm … (1.15 turns)", "X out of bed: −0.215" | | | |

  - `t4-ramp90.mts` and `t4b-ramp-small.mts` → `out\t4-ramp90.txt`, `out\t4b-ramp-small.txt`:
    - **FluidNC A, 45°:** X 171.26–199.89 (design 60–80), A 200–229°. The offset follows the bed size.
    - **Own physics, A1 Pro 45°:** the stripes run diagonally at 115.7–116.2 % dose. A raster gets no feed match, because ADR-127 Amd 2 D3 assumes rows along X.
    - **Y port:** every case (90° and 45°, 4 mm and 20 mm squares) is refused with "The artwork wraps 2167.7 mm round the part (8.63 turns)" or "1293.2 mm (5.15 turns)", whatever the design's size.
    - **A and FluidNC at 90°:** every case is refused with "X out of bed: −0.215".
    - In those refused cases the glass is safe, but the reason given is false.
- **Severity:** P1.
  - **For:** METHOD §3: wrong physical output (position) that harms the job, with no warning. Start is allowed on the maintainer's own machine. METHOD has no reach clause.
  - **Against:**
    - Ramp is made for flat rubber stamps; a ramped Fill on glass is unusual.
    - On a Y-port rotary, and at 90° on A, the job is refused (but with a false reason).
- **Announced?** No. ADR-699 does not mention a rotary; its Consequences list only the `.rd` refusal.
- **Novelty:** new. It comes from ADR-699 × ADR-492 D9 × ADR-695. No test combines `fillRampLengthMm` with a rotary (grep of `*.test.ts*`).
- **Fix direction:**
  - Give ramped fills the image rule on a rotary: scan at 0° only, drop Cross-hatch and per-pass angles, and raise the same `image-scan-angle-rotary` diagnostic.
  - Or refuse a turned raster inside `machineSpaceJob`, so that no later route can emit one.
  - Add a test that emits a ramped 45° Fill on Y, A and Z and checks that it lands on the design.

### Z3-P1-2 — A Moshiboard with a Y-port rotary writes one speed per layer: strokes round an Ø80 glass in the Creality chuck burn at 15.9 % of the set energy, on a geared roller at 184 %, with no warning

- **Where (236cccf6e):**
  - `src/io/moshi/emit-moshi.ts:38-44` lets a Y-port rotary through ("A Moshi rotary turns on its own Y") and encodes `machineSpaceJob(...)`.
  - `src/core/controllers/moshi/moshi-job-encoder.ts:111-117` writes the whole vector program at `group.speed / 60` mm/s.
  - The feed match exists only in the GRBL strategy (`src/core/output/grbl-strategy.ts:439`, `rotaryFeedMatchFor`).
  - The Moshi panel shows only the encoder's advisories (`src/ui/moshi-usb/MoshiUsbDetails.tsx:67-70`). There is no Job Review and no rotary feed warning on this route.
- **Anchor:**
  - **Contract:** ADR-127 Amendment 2: Speed is the speed across the material, on a rotary as on a flat bed.
  - **Twin:** the same design emitted as G-code burns at 99.2–100.6 % in every direction (v13 Y5; here 100.0–100.3 % on the chuck cases in `t1-taper-clamp.txt`).
- **Scenario:** a K40-class Moshiboard with its Y motor swapped for a rotary (the usual K40 rotary), the Creality chuck preset and an Ø80 glass.
  - A name is outlined at 1500 mm/min. Strokes along the glass burn at 100 %; strokes round it burn at 15.9 %.
  - On a geared roller (150 mm per turn, Ø26), strokes round the part burn at 184 %, enough to chip glass.
- **Evidence:** REPRO, `zz-z3\t5-moshi.mts` → `out\t5-moshi.txt`.
  - It runs the real `prepareOutput` and `emitPreparedMoshiJob`, decodes the programs with the real `decodeMoshiProgram`, and applies own chuck physics.
  - The doses are for strokes round the part. A pure round stroke gives the same figure under any diagonal timing law.

  | Setup | Line 1500, along / round | Fill 90° 3000, round | Advisories | Rotary feed warning |
  |---|---|---|---|---|
  | Creality chuck, Ø80 (k 0.159) | 100 % / **15.9 %** | **15.9 %** | none | none |
  | Geared roller 150/Ø26, Ø80 (k 1.84) | 100 % / **183.6 %** | **183.6 %** | none | none |
  | No rotary (control) | 100 % / 100 % | 100 % | none | none |

- **Severity:** P1.
  - **For:** the X8-P1-1 class (rated P1 in v12): wrong dose, silently. No reach clause.
  - **Against:** Moshiboard support is days old and USB-only. A Moshi rotary has not been reported in the field, and no hardware has run it.
- **Announced?** No. ADR-705 does not mention a rotary. ADR-127 Amd 2 put only Ruida `.rd` out of scope.
- **Novelty:** new. ADR-705 (`41ad2106a`) merged after #1698. No test combines Moshi with a rotary.
- **Fix direction:**
  - A speed change ends a Moshi program. So split each vector group into programs by matched speed (whole mm/s), using `surfaceMatchedFeed` per move.
  - Or, until then, refuse a Y-port rotary on a Moshiboard with a message, as A/Z already are (`emit-moshi.ts:41-42`).
  - Add a Moshi + rotary test that decodes the programs and checks the surface speed.

### Z3-P2-1 — 0° Fill hatch rows round the part are never checked against the rotary's steps: the default 0.1 mm hatch on an Ø150 bowl burns 96 of 300 rows twice, with no warning

- **Where (236cccf6e):** `src/ui/laser/job-review/rotary-row-step-warnings.ts:64` checks only `kind === 'raster'` groups.
  - A scanline Fill's hatch lines along X are rows round the part too, written to 3 decimals.
  - They are never checked.
- **Anchor:**
  - **Contract (class):** ADR-315 Amendments 1 and 2. The controller puts every row on a whole step; the warning names the effect and the intervals that fit.
  - **Twin:** an image layer at the same pitch on the same part warns ("rows land 0.0785 or 0.1571 mm apart and band").
- **Scenario:** a name filled at 0° on an Ø150 bowl in the Creality chuck, with the default 0.1 mm hatch. 0° is the default hatch angle, and the usual choice on a rotary because the part never turns while the beam is lit.
  - One Y step turns the part 0.1473 mm, so a 0.1 mm hatch is 0.68 steps.
  - A third of the hatch lines land on the line before and burn twice, beside a full-step gap. The fill shows dark and pale stripes.
- **Evidence:** REPRO, `zz-z3\t3-seam-fill.mts` → `out\t3-seam-fill.txt` (part b). A 30 × 30 mm square, 0° Fill at 3000 mm/min, Absolute; rows read from the program and stepped with `lround`:

  | Setup | Hatch (mm) | Steps per row | Rows doubled | Gaps (steps:count) | Job Review |
  |---|---|---|---|---|---|
  | Y chuck Ø80, `$101`=80 | 0.1 (default) | 1.27 | 0 | 1:217 2:82 (bands) | none |
  | Y chuck Ø80 | 0.05 | 0.64 | **218 / 600** | 0:218 1:381 | none |
  | Y chuck Ø80 | 0.08 | 1.02 | 4 / 375 | 0:4 1:359 2:11 | none |
  | Y chuck **Ø150** | **0.1 (default)** | 0.68 | **96 / 300** | 0:96 1:203 | **none** |
  | Y chuck Ø150 | 0.05 | 0.34 | 396 / 600 | | none |
  | A1 Pro A Ø80, `$103`=8.9 | 0.05 | 0.64 | 217 / 600 | | none |
  | Image layer, Y chuck Ø150, 10 lines/mm (twin) | 0.1 | 0.68 | 96 / 300 | | **warns** |

- **Severity:** P2.
  - It is the X8-P2-3 / Y5-P1-3 class (rows quantised to the rotary's steps). The v12 and v13 refuters and coordinators rated that class P2.
  - The program commands the right rows, and on Ø80 at the default hatch the effect is banding only.
- **Announced?** No. ADR-315 and its amendments speak only of image layers.
- **Novelty:** new. v12 X8 and v13 Y5 measured image rows only. `rotary-row-step-warnings.test.ts` has no fill case.
- **Fix direction:** run the same placement check over scanline and island Fill groups whose hatch rows run along X.
  - Use the hatch spacing as the pitch and the fill's own row count.
  - Word the advice as the Fill's Interval.
  - Ramped fills are rasters and are already covered.

### Z3-P3-1 — The A1 Pro's one-step advice (0.0784 mm) doubles one or two rows at about half of the places a photo can sit, and the warning then stays silent

- **Where (236cccf6e):**
  - `src/ui/laser/job-review/rotary-row-placement.ts:41-43` models rows only from work zero on a whole step, which is one phase.
  - `:116-118` judges each candidate interval at that phase only.
- **Anchor:** the advice "For even rows, set the line interval to 0.0784 mm (12.76 lines/mm, 1 step)". ADR-315 Amd 2's Consequences say phase is modelled at a whole step only and ties may shift, which partly announces this.
- **Mechanism:** typed as printed, 0.0784 mm gives 128 rows on a 10 mm photo.
  - That is a pitch of 0.078125 mm, or 0.996 A steps. Across the photo the rows drift 0.51 step against the step grid.
  - Wherever that drift crosses a rounding boundary, two rows land on the same step.
  - At phase 0, where the photo is the job's lowest artwork, it never crosses one, so the check passes.
- **Evidence:** REPRO, `zz-z3\t2b-phase.mts` → `out\t2b-phase.txt`, and `t2-rows.mts` (Current Position, centre anchor). The phase is moved by a 2 mm line drawn beside the photo, as text under a photo would move it.

  | A1 Pro A Ø80, `$103`=8.9 | Phases with a doubled row (of 20) | Worst doubled | Warning |
  |---|---|---|---|
  | 0.0784 mm (1 step), 10 mm photo | **10** | 1 | silent |
  | 0.0784 mm (1 step), 30 mm photo | **11** | 2 | silent |
  | 0.1569 mm (2 steps), 10/30/60 mm | 0 | 0 | — |
  | Y chuck 0.1571 mm (2 steps), 80 or 160 steps/mm | 0 | 0 | — |

- **Severity:** P3. One or two dark lines in a photo, on one of the two intervals offered. The other offered interval (2 steps) is clean at every phase.
- **Fix direction:** judge each candidate over several phases (for example 8 across one step), or prefer step counts whose drift over the image (rows × |pitch − n steps|) stays under half a step.

### Z3-P3-2 — At the Max feed itself, a 0° Fill on a taper warns "They burn up to 100 % of the energy you set … set this layer to 5999 mm/min", "most at the narrow end"

- **Where (236cccf6e):**
  - `src/ui/laser/job-review/rotary-surface-speed-warnings.ts:46` warns on any rise above 1, and `:56` rounds the rise to a whole per cent.
  - On a taper, lines along X away from the pivot row lean (ADR-694 D5). So at a layer speed equal to the Max feed, each of them is held back by a hair.
- **Evidence:** REPRO, `out\t1-taper-clamp.txt`.
  - All 10 tapered 0° fills at 6000 mm/min warn: 9 say "up to 100 %" and 1 says "101 %".
  - The measured dose is 100.0–100.1 %.
- **Severity:** P3. A false warning that contradicts itself; it teaches the operator to ignore the real one.
- **Fix direction:** warn only when the rise is at least 1 % (`Math.round(rise × 100) > 100`), and say "narrow end" only when the worst move is at the narrow end.

### Z3-P3-3 — The old-project rotary notice fires on 1.0.30 projects whose output did not change

- **Where (236cccf6e):**
  - `src/io/project/old-project-rotary-feed.ts:25` requires only `yScale !== 1` plus any non-image output (`:29-38`).
  - `:41-52` prints `1 / k` as the factor.
- **Evidence:** REPRO, `zz-z3\t6-oldproject.mts` → `out\t6-oldproject.txt`. The files were built and saved by the 1.0.30 source, opened on main, and emitted by both builds.

  | 1.0.30 file | Output now vs 1.0.30 | Notice |
  |---|---|---|
  | Chuck, 0° Fill only | byte-identical | "up to 6.28×" |
  | Chuck, one line along X | byte-identical | "up to 6.28×" |
  | Roller with k = 0.998 | at most 1.002× | "up to 1.00×" |
  | Placeholder roller (k 4.58), line 1500, now held at Max feed | 0.25× | "as little as 0.22×" |

- **Severity:** P3. It over-warns, and says something changed when nothing did. ADR-127 Amd 3 D2 does say "line, cut or fill output", so this works as written.
- **Fix direction:** raise the notice only when some move's `surfaceMatchedFeed` differs from the layer speed by more than 1 %, and print the largest real ratio.

### Z3-P3-4 — The row-step warning names a layer by its internal id ("Image layer operation-…") and calls a ramped Fill an image

- **Where (236cccf6e):** `src/ui/laser/job-review/rotary-row-step-warnings.ts:121` prints `group.layerId`.
  - The Max-feed and axis-rate warnings beside it look up the layer's name.
  - A ramped Fill compiles to a raster, so it reads "Image layer F … set the line interval", although the Fill's field is its Interval.
- **Evidence:**
  - READ: real layer ids look like `operation-wood-portrait` (`1.0.29-photo-recipe` golden) or `operation-<object id>` (`artwork-operation.ts:188`).
  - REPRO for the ramp wording: `out\t3-seam-fill.txt` (part c).
- **Severity:** P3 (wording). For images it predates #1698.
- **Fix direction:** look up the layer name as the other two warnings do, and say "Fill layer … Interval" for a `fillRamp` group.

## KNOWN: status on 236cccf6e

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y5-P2-1 | Taper clamp silent (refuter P1) | **Fixed**, measured: 83/83 held jobs warn; the suggested speed burns ≤ 100.12 % | `t1-taper-clamp.txt`, `t8-taper-axisrate.txt` |
| Y5-P1-3 | One-step advice doubled 136/382 rows silently (refuter P2) | **Fixed** on the Y chuck: the case now warns with the exact count, and every suggested interval lands evenly at every phase. A1 Pro leftover: Z3-P3-1 | `t2-rows.txt`, `t2b-phase.txt`, `t2c-old-case.txt` |
| Y5-P2-2 | No old-project notice | **Fixed**: the 1.0.29 golden and exactly the scaled 1.0.30 goldens get the notice, with the right factor. File > Open, Job Review, autosave recovery (`autosave-record.ts:91-98`), templates and sheets all go through it. Over-notice: Z3-P3-3 | `t6-oldproject.txt` |
| ADR-694 / ADR-695 Consequences: the inspector draws a cylinder of Object diameter and shows an A program flat | Announced | Unchanged; not raised again | READ |
| ADR-127 Amd 2: Ruida `.rd` keeps a per-layer speed on a rotary | Announced as out of scope | Unchanged. The Ruida UDP route (#1707) sends `.rd`, so it inherits this | READ |

## Refuted

Candidates dropped before raising:
- **"The warning counts the taper twice."** The warning maps the prepared job once, with the same `machineSpaceJob` the emitter uses (`emit-gcode.ts:308`). Its numbers match the emitted F and the measured dose.
- **"The ETA ignores the new F."** `estimateJobDuration` emits through the same strategy and times that program (`estimate-duration.ts:62-75`).
  - On the chuck, the ETA's cut time is 32.03 s against 32.03 s summed from the program.
  - Where acceleration counts it is longer than the plain sum (`t7-twins.txt`).
- **"A CNC project with a rotary saved on its device gets scaled."** Its program is identical with and without the rotary, with no feed comment (`t7-twins.txt` (b)).
- **"Overscan on the rotary turns the part while lit."** Image runways stay on X; no lit move turns the part (`t7-twins.txt` (c)).
- **"Frame speed burns the glass."** The rotary Frame plan has tool-off lines only (`rotary-axis-frame.ts:64-67`).
- **"The 45° fill on a taper is a silent clamp (100.6 %)."** Its feed is 5011, under the Max feed. This is the one-feed-per-sweep error ADR-127 Amd 2 announced ("a few percent off" at the ends of an angled hatch).
- **"Simple view or the guided first job hides the warnings."** Per ADR-698, Simple view changes no Job Review content, and the guide adds no Start path (READ).
- **"A 1.0.30 `.lfmachine` should raise the notice."** A machine profile holds no artwork or operation settings, so no file's burn changed. ADR-682 Amd 3 ties notices to what a project file holds.
- **"3D Sliced breaks on a rotary."** Each pass is a raster along X at 100 % dose, and the row-step check covers each pass (`t3-seam-fill.txt` (c)).

## Verified clean

- **Taper clamp warning (L10):** 192 jobs (`t1-taper-clamp.txt`).
  - Controllers: GRBL and Marlin (Y), grblHAL and FluidNC (A), the A1 Pro (A), GRBL (Z).
  - Setups: chuck, stock roller, geared roller, k = 1 roller, placeholder roller.
  - Tapers: Ø88→Ø72 and Ø72→Ø88, top left and right, Reverse.
  - Layers: a line and Fills at 0°, 45° and 90°.
  - The warning appears exactly when a move is held, matches the emitted F and the dose, and its suggested speed clears it.
- **Axis rate on a taper (L12 with ADR-695 Amd 1):** both warnings appear together, and the lower speed burns at 100.02–100.24 % (`t8-taper-axisrate.txt`).
- **Rows (L10):** 10 setups × 6 layouts × 10/30/60 mm photos (`t2-rows.txt`).
  - Setups: Y at 80/100/160 steps/mm; Ø70, Ø80 and Ø150; a taper; Marlin; A1 Pro and FluidNC A.
  - Layouts: Absolute alone, artwork beside the photo, Current Position (centre and front-left anchor), Reverse, Jarvis dither.
- **Seam on a full wrap** (`t3-seam-fill.txt` (a)):
  - Y chuck at 0.1571 mm: 1600 rows, every gap 2 steps, seam 2 steps = 0.1571 mm.
  - A1 Pro at 0.1569 mm: 1602 rows, seam 0.1569 mm.
  - At the old one-step interval: 65 of 3202 rows doubled, and now warned.
- **Old-project notice:** 6 goldens plus 11 files saved by the 1.0.30 source. With layer output off or the rotary off, it stays quiet (`t6-oldproject.txt`).
- **L12 CI:** #1698's head `42e22c608` passed every check (`gh pr view 1698`): unit shards 1–4, typecheck, Browser smoke, Chrome UX smoke and the packaging gate. Its tests cover the k ≤ 1 taper case, the 136-row case and the goldens' notice.

## Not verified

- **No browser.** The Job Review dialog and the Moshi panel were not rendered; their text comes from the functions that build them.
- **No local Vitest.** The repo's rotary suites were not run here; #1698's CI was green.
- **Start was not driven for Z3-P1-1.** `emitGcode`'s preflight passed; `prepareStartJob` and the camera latch were not run.
- **No hardware.** A Moshiboard rotary has not been reported in the field, and its diagonal timing law is unknown. The round-stroke figures do not depend on it.
- **Planners:** grblHAL's `rotary_fix_enable` and FluidNC's planner, as in v13.
- **LightBurn:** its behaviour for a ramped fill on a rotary was not researched.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z3\`. Run each one from that folder with `node --no-experimental-webstorage --import ./register.mjs <file>`. The loader is copied from `zz-z2` and pointed at `j25-main`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | TS loader |
| `lib.mts` | Own hardware model (chuck, roller, calibrated roller, A; cone), own G-code reader, surface strokes; copied from the v13 Y5 auditor |
| `t1-taper-clamp.mts` → `out\t1-taper-clamp.txt` | Y5-P2-1: 192 jobs; dose at both ends, the warning and its numbers, a re-run at its suggested speed (also Z3-P3-2) |
| `t2-rows.mts` → `out\t2-rows.txt` | Y5-P1-3: rows read from the program; each suggested interval typed back in |
| `t2b-phase.mts` → `out\t2b-phase.txt` | The suggested intervals over 20 phases (Z3-P3-1) |
| `t2c-old-case.mts` → `out\t2c-old-case.txt` | v13's 136-row case on main |
| `t3-seam-fill.mts` → `out\t3-seam-fill.txt` | Full-wrap seam; 0° Fill rows (Z3-P2-1); Fill Ramp and 3D Sliced on a rotary |
| `t4-ramp90.mts`, `t4b-ramp-small.mts`, `t4c-ramp-review.mts` → `out\t4*.txt` | Z3-P1-1 |
| `t5-moshi.mts` → `out\t5-moshi.txt` | Z3-P1-2 |
| `t6-oldproject.mts` → `out\t6-oldproject.txt` | Y5-P2-2 against the 1.0.30 source (also Z3-P3-3) |
| `t7-twins.mts` → `out\t7-twins.txt` | ETA, CNC, overscan |
| `t8-taper-axisrate.mts` → `out\t8-taper-axisrate.txt` | Taper clamp × A/Z axis rate |

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Z3-P1-1","severity":"P1","area":"rotary-feed-verify","file":"src/core/job/fill-ramp.ts","line":60,"anchor":"Contract ADR-492 D9 (a rotary scans every pass along X) and ADR-127 single machine-space job; twin: the same 45° Fill without a ramp lands on the design","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Ramped Fill (ADR-699) keeps its hatch angle on a rotary; mapRasterGroup scales scan-frame bounds as bed Y. A1 Pro A, 45°/30°: preflight ok, burns X 105-134 / 115-141 (design 60-80) at A 134-163° / 82-112° (design 0-28.65°), 116 % dose, no warning; Y port and 90° refused with false reasons ('wraps 8.63 turns', 'X out of bed')"},
  {"id":"Z3-P1-2","severity":"P1","area":"rotary-feed-verify","file":"src/core/controllers/moshi/moshi-job-encoder.ts","line":111,"anchor":"Contract ADR-127 Amd 2 (Speed is the speed across the material on a rotary); twin: the same job as G-code burns 99-101 %","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Moshiboard (ADR-705) + Y-port rotary: one speed per vector program, no surface feed match; strokes round an Ø80 glass in the Creality chuck 15.9 %, geared roller 183.6 %; no advisory, no Job Review on the Moshi route"},
  {"id":"Z3-P2-1","severity":"P2","area":"rotary-feed-verify","file":"src/ui/laser/job-review/rotary-row-step-warnings.ts","line":64,"anchor":"Contract class ADR-315 Amd 1/2 (rows on the rotary's steps, warned with intervals that fit); twin: an image at the same pitch warns","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"0° Fill hatch rows round the part are never step-checked: default 0.1 mm hatch on Ø150 chuck doubles 96/300 rows, 0.05 mm on Ø80 doubles 218/600 (A1 Pro 217/600), Ø80 default bands; Job Review silent"},
  {"id":"Z3-P3-1","severity":"P3","area":"rotary-feed-verify","file":"src/ui/laser/job-review/rotary-row-placement.ts","line":41,"anchor":"The advice 'For even rows, set ... 0.0784 mm (1 step)'; ADR-315 Amd 2 phase caveat (partly announced)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"A1 Pro A Ø80: one-step advice 0.0784 mm (pitch 0.996 step, drift 0.51 step) doubles 1-2 rows in 10-11 of 20 photo positions, silently; 2-step advice clean everywhere"},
  {"id":"Z3-P3-2","severity":"P3","area":"rotary-feed-verify","file":"src/ui/laser/job-review/rotary-surface-speed-warnings.ts","line":46,"anchor":"The warning's own claim (held strokes burn more); measured 100.0 %","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"At layer speed = Max feed, 0° fills on a taper warn 'up to 100 % ... set 5999 mm/min', 'most at the narrow end' (10/10 cases), measured 100.0-100.1 %"},
  {"id":"Z3-P3-3","severity":"P3","area":"rotary-feed-verify","file":"src/io/project/old-project-rotary-feed.ts","line":25,"anchor":"ADR-682 Amd 3 (notices for what changed); measured against the 1.0.30 source","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Notice 'up to 6.28x' on 1.0.30 projects with only 0° fill or along-X lines (byte-identical output); 'up to 1.00x' for k 0.998; 'as little as 0.22x' when the clamp makes it 0.25x"},
  {"id":"Z3-P3-4","severity":"P3","area":"rotary-feed-verify","file":"src/ui/laser/job-review/rotary-row-step-warnings.ts","line":121,"anchor":"Twin: the Max-feed and axis-rate warnings name the layer","evidence":"READ","verdict":"PENDING","known":false,"summary":"Row-step warning prints the internal layer id ('Image layer operation-...') and calls a ramped Fill an image with a 'line interval'"}
]
```

Auditor counts: raised 7, P1 2, P2 1, P3 4, known 5

## Refuter (2026-11-11)

- **Tree:** `j25-main` = origin/main @ `236cccf6e`, read only (not edited; `node_modules` junction untouched).
- **Harness:** own files in `scratchpad\zz-z3r\`. The loader (`register.mjs`, `ts-resolve.mjs`) is copied from `zz-z3`. Nothing else is reused from the auditor's `lib.mts`.
  - **Own scene builder and own G-code reader** (`rlib.mts`): modal G0–G3, G90/G91, per-axis G92, F, S, M3/M4/M5.
  - **Own physics:**
    - A chuck turns the part 2π per mm/turn of Y, or 360° of A.
    - A roller drives the surface at the roller's surface. On a taper, the roller drives the part at its wide end.
    - Dose = layer speed ÷ surface speed. The controller times F over the commanded (X, rotary) vector, with A degrees counted as mm.
  - **Own step model:** `lround(Y × $101)` from a whole-step zero.
  - **Moshi:** the real `decodeMoshiProgram` reads the bytes (they are binary). The physics is my own.
  - **Start:** the real `prepareStartJob` was driven with `requireFrame = false`, an Idle status and `$I` axes `XYZA`.
- **Memory:** Node scripts only, at about 4.0 GB free. No Vitest, no browser, no hardware.

### Verdicts

**Z3-P1-1: CONFIRMED P1, and wider than reported.** REPRO `r1-ramp.txt`, `r2-start.txt`, `r2b-start-90.txt`, `r6-companion.txt`. READ:
- `fill-ramp.ts:60-66,125`
- `rotary-transform.ts:114-121` (`jobYRange`) and `:139-145` (`mapRasterGroup`)
- `raster-scan-frame.ts:60-68`

**Reachability.** Cut Settings → Fill detail shows Scan angle (`CutSettingsFillFields.tsx:34-44`) and the Ramp fields (`:78-80`, `CutSettingsFillRampFields.tsx`) on every device. No field depends on the rotary. The image rule (`compile-job-raster.ts:153-163`) is never applied to a ramped Fill.

**Mechanism.** `mapRasterGroup` scales the turned raster's scan-frame `minY/maxY` as if they were bed Y. `jobYRange` (`rotary-transform.ts:118-121`) also takes the scan-frame `minY` as the job's lowest bed Y.

**Offset (own reader).** A 20 mm square at X 60–80, Ø80, ramp 2 mm, Absolute:
- **A1 Pro A (preset):**
  - 45° burns X 105.26–133.89 and A 134.12–162.76°. The design is X 60–80, A 0–28.65°. The dose is 115.94–115.98 %, the same as the auditor's figure.
  - 30° burns X 115.45–141.31 and A 81.77–111.96° at 107.1 %.
  - 5°, 10°, 15° and 20° are also displaced: X +15 to +47 mm and A +8 to +48°.
  - The offset depends on where the design sits. A design at Y 0–20 burns at X 135–164 at 45°.
- **The Y port is not safe.** The auditor reports that every Y-port case is refused. That holds only for Save G-code at 30° and above:
  - 5°, 10°, 15° and 20° pass `emitGcode` preflight on a GRBL Y chuck (80 mm/turn).
  - At 15°, the design (X 60–80, Y 0–6.37) burns at X 135.53–158.05 and Y 38.08–48.73. That is about 120 mm further round, stretched to 33.5 mm instead of 20 mm, at 79 % dose.
- **Start allows every case it was given.** `prepareStartJob` returned ok for A1 Pro 0/30/45° and for Y 10/15/30/45°.
  - Only compile-integrity codes block at Start (`start-job-readiness-policy.ts:314-328, 393-409`). The wrap check ("wraps 2.71 turns") and the bed check reach the operator as Job Review warnings, with false reasons. At 90°, that held only because my snapshot gave no trusted work offset (see Not verified).
  - With Current Position (centre), no wrap warning appears at all. Measured (design X 60–80):
    - GRBL-Y 45° burns X 26.25–46.26 and Y 93.74–113.75, with the head at Y 70.
    - A1 Pro 45° burns X 126.58–155.22.
  - None of the Start warnings is about the angle or the position.
- **Other layers move too (new evidence, same root cause).** A plain Line layer beside the ramped Fill (design X 100–120, round 0–28.65°) burns:
  - at A 160.04–188.69° when the Fill is at 45°, and A 38.98–67.63° at 15°, on the A1 Pro;
  - at Y 10.09–16.46 (about 32 mm round) when the Fill is at 15° on the Y port.
  - So one ramped Fill moves every layer of the job round the part. Only the ramped layer turns its scan. The fix must also cover `jobYRange`.

**Severity.** P1 stands. No warning names the mismatch for the A1 Pro at 5–45°, for the Y port at 5–20°, or for any Current Position case. The generic rotary-raster note and the row-step note do not either. Frame is not a warning (METHOD §3, G6).

**Correction to the report.** On the Y port the job is not "refused". Below about 25° it runs silently. Above that, Start runs it with a false wrap or out-of-bed warning.

**Z3-P1-2: CONFIRMED P1.** REPRO `r3-moshi.txt`. READ:
- `emit-moshi.ts:38-44`
- `moshi-job-encoder.ts:111-117`
- `moshi-programs.ts:16-27`: one `vectorSpeed` header per program, and no speed command inside it
- `moshi-usb-job.ts:20-38`

**Reachability.**
- Tools → Rotary Setup… is always enabled (`rotary-command-family.ts`).
- `RotarySetupHost` offers `rotaryAxesForController({ controllerKind: 'moshi' })`, which is `['Y']` (`rotary-axis.ts:57-68`).
- No UI path checks the profile's `capabilities` for `'rotary'`; `GENERIC_MOSHI_PROFILE` lacks it, but nothing reads that.
- `prepareMoshiUsbJob` → `emitPreparedMoshiJob` → `machineSpaceJob` → one program per group at `group.speed / 60`. No Job Review runs on the Moshi route. The panel lists only the advisories (`MoshiUsbDetails.tsx:67-73`), and there are none here.

**Measured** (Line 1500 mm/min, Ø80, decoded at 25 mm/s):

| Setup | Round strokes |
|---|---|
| Chuck 40 mm/turn | 15.9 % |
| Chuck 80 mm/turn | 31.8 % |
| Roller 150 mm/turn, Ø26 | 183.6 % |
| Calibrated roller (mm/turn = π × roller Ø) | 100 % |
| No rotary | 100 % |

Strokes along X burn at 100 % in every setup.

**Severity.** P1 stands; it is the X8-P1-1 class.
- **Against it:**
  - The profile and the panel say "EXPERIMENTAL … not qualified", which is a general disclaimer, not a warning about this mismatch.
  - A calibrated roller (k = 1) is unaffected.
  - The `.rd` twin is the announced Ruida exception (ADR-127 Amd 2 "Out of scope"). ADR-705 announces nothing about the rotary.
- **Fix direction.** I agree with the auditor. Note that a Moshi vector speed is a whole mm/s byte (1–256), so splitting each group by speed quantises the match.

**Z3-P2-1: CONFIRMED P2.** REPRO `r4-fillrows.txt` (own reader, own `lround` step model). READ `rotary-row-step-warnings.ts:64`: only `kind === 'raster'` groups are checked.

Measured (Y chuck 40 mm/turn, `$101`=80, 30 × 30 mm square, 0° Fill):

| Setup | Hatch (mm) | Rows doubled |
|---|---|---|
| Ø150 | 0.1 (default) | 96 / 300 |
| Ø80 | 0.05 | 218 / 600 |
| Ø150 | 0.05 | 396 / 600 |
| Ø120 | 0.1 (default) | 45 / 300 (new) |
| Ø100 | 0.1 (default) | 3 / 300 |

- Ø80 at 0.1 mm doubles none, but its gaps alternate between 1 and 2 steps (217 and 82).
- Job Review's row-step detector is silent in every case.

P2 matches the class precedent (the X8-P2-3 and Y5-P1-3 refuters).

**Z3-P3-1: CONFIRMED P3 (READ).** `rotary-row-placement.ts:42` models rows only from `(i + 0.5) × pitch` at one phase. I did not re-run the auditor's 20-phase repro.

**Z3-P3-2: CONFIRMED P3 (READ).** The Max-feed warning has the pattern at `rotary-surface-speed-warnings.ts:46,56`, and the A/Z axis-rate warning repeats it at `:144` and `:104`. A rise of 1.004 prints "up to 100 %". The taper words ("most at the narrow end") are added whenever a taper is on (`:50`).

**Z3-P3-3: CONFIRMED P3 (READ).** `old-project-rotary-feed.ts:25` requires only `yScale !== 1` plus any non-image output. Its message prints 1/k regardless of what the strokes are.

**Z3-P3-4: CONFIRMED P3 (READ).** `rotary-row-step-warnings.ts:121` prints `Image layer ${group.layerId}`.
- For a turned ramped raster, the pitch comes from scan-frame bounds (`:91-95`). That is also wrong geometry, but it falls under Z3-P1-1's fix.

### KNOWN and Verified clean: challenges

- **Y5-P2-1, taper clamp warning: the "fixed" verdict holds by own physics.** `r5-taper.txt`: a k = 1 roller with Ø20 rollers, Ø88→Ø72 over 150 mm, top on the left, Max feed 6000.

  | Layer speed | Narrow end | Middle | Wide end | Warning |
  |---|---|---|---|---|
  | 6000 | 122.2 % | 110.0 % | 100 % | "up to 122 % … 4909" |
  | 5000 | 101.9 % | 100 % | 100 % | "102 %" |
  | 4909 (the suggested speed) | 100.0 % | 100.0 % | 100.0 % | none |
  | 4000 | 100 % | 100 % | 100 % | none |

- **Y5-P1-3, row advice; Y5-P2-2, old-project notice.** Not re-measured independently. READ agrees with the mechanism.
- **Ruida UDP (#1707).** `emit-rd.ts:70-77` applies `machineSpaceJob`; the `.rd` file keeps one speed per layer. This is announced in ADR-127 Amd 2 "Out of scope", so it stays KNOWN. The ADR's phrase "uses the controller's own rotary settings" leaves open whether a Ruida with its own rotary on gets the Y scale twice. That falls under the known "Not verified, as in D3".
- **3D Sliced on a rotary: clean (READ).** Sliced passes go through `appendObjectRasterGroups` → `rasterScanRuns` (`compile-job-raster.ts:116-123`), which forces 0° and raises `image-scan-angle-rotary`.
- **Ramp per-pass angle.** `fillPassLayers` (`scan-pass-angles.ts:45-54`) turns a 0° ramped Fill with Angle per pass into turned rasters. This is the same Z3-P1-1 root cause, already in the auditor's fix direction.
- **The auditor's Refuted list.** I agree with all nine entries. The ETA, CNC, overscan and Frame-speed entries were not re-run.

### New findings

None. The Y-port small angles and the moved companion layers are evidence for Z3-P1-1 (the same root cause and fix), not separate findings.

### Not verified

- **Start with a trusted work offset.** My machine snapshot had no WCO, so Start ran in relative-origin preflight mode. The 90° and 165° cases, whose burns leave the bed, were not tested with a trusted bed check. The A1 Pro 5–45° and Y 5–20° burns stay on the bed, so a bed check would not catch them.
- **The Frame permit path** (`requireFrame = true`), the camera latch and the rendered Job Review dialog were not run.
- **Moshi hardware:** the diagonal timing law of the Moshi speed byte. Pure round strokes do not depend on it.
- **Z3-P3-1's phase sweep and Z3-P3-3's byte-identical claim:** READ only.
- **Moshi images on a rotary:** rows are snapped to mils, with no row-step check. Not measured.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z3r\`. Run each from that folder with `node --no-experimental-webstorage --import ./register.mjs <file>`.

| File | What it does |
|---|---|
| `rlib.mts` | Own builder and G-code reader |
| `r1-ramp.mts` → `out\r1-ramp.txt` | Ramp × angle × A/Y × position; burn place, span and dose |
| `r2-start.mts`, `r2b-start-90.mts` → `out\r2-start.txt`, `out\r2b-start-90.txt` | `prepareStartJob` verdicts and warnings |
| `r3-moshi.mts` → `out\r3-moshi.txt` | Moshi + Y rotary dose from decoded programs |
| `r4-fillrows.mts` → `out\r4-fillrows.txt` | 0° Fill rows against Y steps |
| `r5-taper.mts` → `out\r5-taper.txt` | Taper clamp warning against own physics |
| `r6-companion.mts` → `out\r6-companion.txt` | A Line layer moved by a turned ramped Fill |

```json
[
  {"id":"Z3-P1-1","severity":"P1","verdict":"CONFIRMED","evidence":"REPRO","file":"src/core/job/rotary-transform.ts","line":139,"note":"Wider than reported: Y port 5-20 deg passes preflight and Start silently (15 deg: +75 mm along, ~120 mm round, 79 % dose, 33.5 mm instead of 20 mm); Start allows 30/45 deg Y with only a false wrap warning; Current Position gets no warning; jobYRange (rotary-transform.ts:114-121) also moves every other layer round the part (Line layer +160 deg at 45 deg on A1 Pro)"},
  {"id":"Z3-P1-2","severity":"P1","verdict":"CONFIRMED","evidence":"REPRO","file":"src/core/controllers/moshi/moshi-job-encoder.ts","line":111,"note":"Reachable: Rotary Setup always enabled, Moshi offers axis Y, no capability gate; one vectorSpeed per program; chuck 40 mm/turn 15.9 %, 80 mm/turn 31.8 %, roller 150/26 183.6 %, calibrated roller 100 %; no advisory"},
  {"id":"Z3-P2-1","severity":"P2","verdict":"CONFIRMED","evidence":"REPRO","file":"src/ui/laser/job-review/rotary-row-step-warnings.ts","line":64,"note":"Own reader: Ø150 default 96/300, Ø120 default 45/300, Ø80 0.05 mm 218/600; Job Review silent"},
  {"id":"Z3-P3-1","severity":"P3","verdict":"CONFIRMED","evidence":"READ","file":"src/ui/laser/job-review/rotary-row-placement.ts","line":42},
  {"id":"Z3-P3-2","severity":"P3","verdict":"CONFIRMED","evidence":"READ","file":"src/ui/laser/job-review/rotary-surface-speed-warnings.ts","line":46,"note":"same pattern in the axis-rate warning at :144/:104"},
  {"id":"Z3-P3-3","severity":"P3","verdict":"CONFIRMED","evidence":"READ","file":"src/io/project/old-project-rotary-feed.ts","line":25},
  {"id":"Z3-P3-4","severity":"P3","verdict":"CONFIRMED","evidence":"READ","file":"src/ui/laser/job-review/rotary-row-step-warnings.ts","line":121}
]
```

Refuter counts: raised 7, refuted 0, P1 2, P2 1, P3 4, known 5
