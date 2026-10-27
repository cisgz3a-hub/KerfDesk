# CNC audit v1 — F7 Preflight, tool reach and motion bounds (`cnc-preflight-reach`)

- **When:** 2026-10-23   **Tree:** origin/main @ `87ecb4f24` (worktree `claude/rolling-audit-20261021` @ `81b81cc8f`; `git diff HEAD origin/main -- src` touches 33 files, none in this area's scope or its twins)
- **Scope:**
  - Core: `src/core/preflight/cnc-*.ts`, `standalone-cnc-preflight.ts`, `blocking-codes.ts`, `no-go-zones.ts` (as the CNC caller uses it), `src/core/invariants/cnc-motion.ts` (plunged-travel / air-descent scan), `src/core/cnc/cnc-tool-reach.ts`, `cnc-reach-geometry.ts`, `radial-envelope.ts`, `cnc-open-contour-omissions.ts`, `cnc-air-floor.ts`, `cnc-pass-air-floors.ts`, `compile-cnc-diagnostics.ts` (`findDroppedCncLayers`).
  - Reach review twins: `src/io/cnc/cnc-program-reach.ts`, `cnc-program-geometry.ts`, `cnc-program-xyz-paths.ts`, `cnc-tool-programs.ts`.
  - Job Review CNC warnings: `job-review-model.ts`, `machine-job-warnings.ts`, `cnc-z-travel-warnings.ts`, `cnc-through-cut-tab-warnings.ts`, `cnc-compiled-depth-warnings.ts`, `cnc-stock-warnings.ts`, `min-feature-warnings.ts`; Save (`save-output-emission.ts`) and tiled save (`tile-emission.ts`, `tiled-output-preparation.ts`).
  - Governing: PROJECT.md rules 7/21 and AGENTS.md "Keep policy findings in Job Review as warnings"; ADR-228/565 (Frame is the sole Start gate); `blocking-codes.ts` (compile-integrity set); ADR-572 (assembly and fixture reach checks are advisory and conservative, incomplete coverage disclosed); ADR-489/520 (air floors); ADR-491 (park height); ADR-433 (minimum-feature warnings); ADR-481 Amendment 2 (omitted open contours counted); WORKFLOW F-CNC3 (CNC preflight list, depth past stock warns).
- **Lenses run:** L1, L3, L4, L5, L7 as separate passes, plus L2 for the outside facts (GRBL `$20`/`$130–$132`, Amana and Whiteside bit dimensions, Fusion collision checks). L6 lightly (the reach review's disclosure path is its failure path). L5 found nothing: assembly and fixture data from `.lf2` are bounded and validated (Verified clean).
- **Counts:** 6 raised → refuter: confirmed 6, plausible 0, refuted 0 → P1 0 / P2 2 / P3 4 (+ 10 KNOWN re-observed). Severity change: P2-3 P2 → P3 (ADR-433 Decision 3 drops sub-half-threshold holes by explicit decision; contract question for the maintainer).

## Headline

The motion that KerfDesk emits is safe in the places this area guards. An independent height-field simulator replayed 20 compiled programs: profiles with tabs, ramps, leads and finish allowance; pockets (offset, lifts, raster, ramp, helix, two-bit rest); engrave; drill; V-carve with and without a clearing bit; and an inlay pair. No `G0` entered stock anywhere: 0 collisions in 1,844 below-Z0 rapids, all of them ADR-489 air descents.

The weak part is the **reach review**, the only check that knows a bit's flute length, stickout, holder or a clamp's height. Three gaps let a modelled crash through with no specific warning:

1. **No flute length, no clamp check.** The clamp check skips the cutter whenever the bit has no flute length, and no shipped or catalog bit has one. A clamp from Machine Setup (default 20 × 20 mm, Z 0 to 15) crossed by a safe-Z rapid at Z3.81 gets no warning. Adding a 12 mm flute length to the same bit makes the warning appear.
2. **Long programs are only partly read.** The flute and stickout depth check reads the program only up to 50,000 lines or 100,000 segments, and an arc counts as 361 segments. On a long program it misses the deepest levels, which a top-down job cuts last, and any later bit section:
   - an 18 mm profile with a 12 mm-flute bit: depth read as 10 mm, no warning;
   - a 1/16" bit with a 4.7 mm flute cutting 8 mm after an `M0` at line 50,472: not read at all.
3. **Small holes are skipped silently.** A pocket or inside-profile layer silently drops closed shapes smaller than half the bit, such as a 2 mm hole under a 1/4" bit. The same shape alone on a layer gets "produced no toolpaths". Holes between half the bit and the full bit get the ADR-433 warning. *(Refuter: reproduced, but ADR-433 Decision 3 drops these holes by explicit decision, so this is a P3 contract question, not a P2 defect.)*

By contract, nothing crash-class blocks Start: out-of-bed, no-go, plunged travel, Z travel, spoilboard, flute, holder and clamp results are all warnings. So these warnings are the whole defence, short of the generic CNC setup attestation.

## Scenario table: preflight result vs emitted program

Real path for every row: `prepareOutput` → `emitPreparedGcode` (runs `runCncPreflight`) → `detectMachineJobWarnings` + `detectCompiledVCarveDepthWarningsForJob` + `detectMinFeatureWarnings` + `cncProgramReachWarnings(project, gcode, cncToolPlan(job))`. That is the same set Job Review and Save show. The emitted column comes from an independent G-code parser written for the audit (`f7-repros/src_io_cnc_zz-f7-harness.test.ts`).

Absolute placement, default 400 × 400 bed, 1/8" bit unless stated. Assembly bits:
- `em3-short`: 1/8", 12 mm flute, 20 mm stickout, ER11 nut from 20 mm.
- `em6-long`: 1/4", 25 mm flute.
- `em16-tiny`: 1/16", 4.7 mm flute, 1/8" shank.

| # | Scenario | Preflight / review result | Block / warn / none | Emitted reality (independent parse) | Source of the result |
|---|---|---|---|---|---|
| S0 | Default project, 1 mm on-path rectangle | Starter-feed note plus **6 generic "CNC reach review" lines** ("Unknown flute length, stickout, shank diameter, holder envelope; assembly clearance is incomplete", "Path coverage is incomplete…", three disclosures) | warn (noise) | Z−1, nothing wrong | `cnc-program-reach.ts:14-24` gate; `cnc-program-geometry.ts:206-210` (P3-1) |
| S1 | Pocket 18 mm in 19 mm stock, `em3-short` | "Cut depth 18 mm exceeds the recorded 12 mm flute length." | warn | deepest Z−18 | `cnc-tool-reach.ts` `reachDepthFindings` |
| S2 | Two bits: `em6-long` pocket 10 mm → `M0` (line 154) → `em16-tiny` profile 8 mm | Flute warning for the 1/16" section only | warn | sections Z−10 / Z−8 | per-`M0` sections, `cnc-program-geometry.ts:53-58` |
| ARCS | 48 round holes (inside profile) 18 mm at 1.5 mm/pass, `em3-short`; 65,444 lines | "stopped at 50000 lines" **and** the flute warning (the first holes reach Z−18 before line 50,000) | warn | Z−18 | shape-major order hides P2-2 here |
| LONG a | 5,000-vertex outline profiled 18 mm at 1 mm/pass, `em3-short` | Only "Program geometry review stopped at 50000 lines"; **no flute warning** | none (disclosure only) | Z−18; first Z below −12 at line 60,283 of 90,415; reviewed depth 10 | P2-2 |
| LONG b | Same outline 10 mm with `em6-long`, then `M0` at line 50,472, `em16-tiny` 8 mm | "…do not have matching counts"; **no flute warning for the 4.7 mm-flute bit** | none | second section Z−8 | P2-2 |
| TILE | S1's 18 mm pocket on a 700 mm stock, two 380 mm tiles | Tiled save: machine warnings, tile advisories and emission advisories all empty; **no flute warning** | none | both tile files Z−18; the same job through Save warns | P3-2 |
| FIX a | Clamp prism X70–90, Y340–400, Z0–15 (Machine Setup default size); `G0 X118.413 Y383.175` at Z3.81 (line 59) crosses it; default 1/8" bit | Reach review: "Unknown flute length…; assembly clearance is incomplete." **No fixture finding** | none | the bit tip passes through the clamp at Z3.81 < 15 | P2-1 |
| FIX b/c | Same clamp, bit with flute 12 (with or without stickout/holder) | "Cutter envelope intersects fixture Clamp 1 along the supplied path." | warn | same rapid | `cnc-tool-reach.ts:153-157` |
| S3 | Park X1000 Y−50, park height 150 | `out-of-bed` X 1000 and Y −50 at line 112 | warn | `G0 X1000 Y−50` at Z150; Z not compared (the default profile has no Z travel) | `cnc-motion-bounds-preflight.ts`; KNOWN JR-3 for Z |
| S6 | Outside profile crossing the bed's right edge | `out-of-bed` X 421.588 (×4) + stock-footprint warning | warn | X 421.588 | `findOutOfBoundsCoords` |
| S4a | Pocket layer: rectangle + one open line | "Layer L1: 1 open contour is omitted. Pocket (clear inside) needs closed outlines…" | warn | rectangle cut, line absent | `cnc-open-contour-issues.ts` |
| S4b | Pocket layer: open lines only | `cnc-open-contours-omitted`, `cnc-layer-empty`, `empty-output` | **block** (`empty-output` is compile integrity) | no program | `blocking-codes.ts` |
| HOLES | Pocket or inside profile: 60 × 40 rectangle + two round holes, d swept 1–6.3 mm, 1/4" and 1/8" bits | d < bit/2 (1/4": 1, 1.5, 2 mm; 1/8": 1 mm): **nothing**. bit/2 ≤ d < bit: ADR-433 "area narrower than the … bit — stays uncut". d ≥ bit: cut | none / warn | no cutting move within 3.5 mm of either hole centre in the silent cases | P2-3 |
| S5c | Pocket: rectangle + 5 × 40 mm slot, 1/4" bit | "1 area narrower than the 6.35 mm bit … narrowest 5 mm at X 102.5 · Y 370" | warn | slot uncut | ADR-433 |
| INLAY | Straight inlay pair, insert depth 5, Pocket depth 8, 6.35 mm stock | nothing | none | female pocket to Z−8 (1.65 mm into the spoilboard) | P3-3 |
| INLAY ctl | Plain pocket 8 mm in 6.35 mm stock | "cuts 8 mm into 6.35 mm stock — 1.65 mm past the bottom, into the spoilboard" | warn | Z−8 | `cnc-through-cut-tab-warnings.ts:86` |
| AIR | 20 programs (see Verified clean) | nothing | none | 0 rapid collisions with simulated stock | `cnc-pass-air-floors.ts`, `cnc-motion.ts` |
| HELIX | Helical entry on a layer with a self-crossing quad | `cnc-helix-entry-invalid` + `cnc-layer-empty` + `empty-output` | block (empty output) | no program | F3 area; named reason |

### Which results block Start (Q5)

Only the compile-integrity set in `blocking-codes.ts:31-47` refuses Start or Save:
- `non-finite-coordinate`, `coordinate-unencodable`, `fluidnc-line-unexecutable`;
- `cnc-tool-geometry-invalid`;
- `empty-output`, `no-output-layer`;
- `relief-needs-cnc`, `focus-test-*`;
- `program-materialization-failed`, `relief-materialization-failed`;
- `cnc-machine-params-invalid`.

Every crash-class result only warns, in the Job Review list, as a post-Save advisory, or in tile advisories. That includes `out-of-bed`, `no-go-zone-collision`, `plunged-travel`, Z travel past `$132`, spoilboard overcut, through-cut without tabs, and flute, stickout, holder and fixture contact. This is the contract (PROJECT.md 7/21, ADR-228/565, ADR-572 "Neither missing descriptions nor predicted contact adds a Start refusal"), so the absence of blocks is not raised. CNC Start also requires the generic setup attestation (`cnc-setup-attestation.ts:4-15`): "Clamps, fixtures … are outside the cutter, rapid, retract, and safe-Z motion envelope". It names no specific clamp or line.

## Findings

### P2-1 — The fixture (clamp) check never models the cutter when the bit has no flute length, and no shipped or catalog bit has one, so a modelled clamp taller than safe Z that a rapid crosses gets no warning

- **Where:** `src/core/cnc/cnc-tool-reach.ts:153-157` (`toolEnvelopes` adds the cutter cylinder only `if (positive(length) && positive(tool.diameterMm))`, where `length = tool.fluteLengthMm`); message `:81`. Gate: `src/io/cnc/cnc-program-reach.ts:14-24`. Shipped bits: `src/core/scene/cnc-tool-starters.ts` (no `fluteLengthMm` on any entry); catalogs `src/ui/machine/cnc-bit-*.ts` (none); only `cnc-tool-assembly-draft.ts` sets it. The clamp editor's default prism is Z 0–15: `src/ui/laser/device-setup/DeviceSetupCncNamedSetup.tsx:118-128`.
- **Anchor:**
  - **Contract:** ADR-572 — "Tool flute, shank, stickout and holder descriptions support bounded, conservative advisory checks against fixture prisms. Incomplete coverage is disclosed." With the flute length unknown, the check drops the cutter as well as the shank and holder. The cutter's diameter and tip position are known, and the tip is part of every possible assembly. A tip-only cylinder invents no dimension. Dropping it is the opposite of conservative.
  - **Twin:** a no-go zone in the same place is caught with the cutter radius (`cnc-preflight.ts:336-357`). The same fixture is caught as soon as any flute length is typed (FIX c).
- **Scenario:**
  1. Machine Setup → Add fixture. The default "Clamp 1" is 20 × 20 mm, Z 0–15. Placed at X70–90 / Y340–400, between two parts.
  2. Default 1/8" end mill, outside profiles 3 mm deep.
  3. The program's `G0 X118.413 Y383.175` (line 59) moves at Z3.81 from X41.588 across X70–90. The independent parse confirms the crossing at Y383.18, so the bit tip passes through the clamp, 11.2 mm below its top.

  Job Review lists six "CNC reach review" lines. The tool-specific one says "Unknown flute length, stickout, shank diameter, holder envelope; assembly clearance is incomplete." Nothing names Clamp 1, so "incomplete" reads as if a partial check passed. The same job with `fluteLengthMm: 12` warns "Cutter envelope intersects fixture Clamp 1 along the supplied path."
- **Evidence:** REPRO.
  - Harness scenarios FIX a/b/c: `F7_ONLY=FIX node ../../../node_modules/vitest/vitest.mjs run src/io/cnc/zz-f7-harness.test.ts`. Copy at `scratchpad/f7-repros/src_io_cnc_zz-f7-harness.test.ts`; program at `FIX_a_default_bit_no_flute_data_clamp_top_15_crossed_by_travel.nc`.
  - Independent crossing scan: a node one-liner over that `.nc` finds `line 59 G0 X118.413 Y383.175 … z 3.81 y at x=80 383.18`.
  - L7: `cnc-tool-reach.test.ts:48-54` ("discloses missing legacy geometry") asserts only `unknown-geometry` and `complete: false`. No test asserts what happens to a fixture on the path of a bit without a flute length.
- **Novelty:** Not KNOWN.
  - The 07-13 workholding architecture audit (lines 52, 919-923, 1142) predates ADR-572. It said no-go zones lack Z and that checks "must include … cutter radius".
  - D5-P2-1 concerns the no-go envelope's tip diameter for engraving bits.
  - No open PR touches the reach files.
- **Refuter:** CONFIRMED, P2 (not P1).
  - **Code.** `toolEnvelopes` (`cnc-tool-reach.ts:153-163`) adds the cutter only when `fluteLengthMm` is positive. The shank also needs a flute length. Only a holder survives without one. No fallback cylinder exists.
  - **Independent REPRO.** Real Job Review path: `prepareCurrentStartJob` → `buildJobReviewModel`, default 1/8" bit, the same clamp (X70–90, Y340–400, Z0–15).
    - The model holds 10 warnings, and none names Clamp 1.
    - The tool line reads "Unknown flute length, stickout, shank diameter, holder envelope; assembly clearance is incomplete." Next to it are "Path coverage is incomplete…", the approach disclosure and the three method disclosures.
    - My own parser finds `G0` line 59, X41.588 → X118.413 at Y383.175, Z3.81, across the clamp.
    - With only `fluteLengthMm: 12` added, the same review adds "Cutter envelope intersects fixture Clamp 1 along the supplied path."
  - **D5 no-go check is separate.** It does not catch the fixture.
    - Fixtures (`project.cncSetup.fixtures`, G54) and no-go zones (`device.noGoZones`, machine XY, no Z) are separate data. Nothing converts one into the other. The only other reader of fixtures is a cache key (`cnc-preparation-dependencies.ts:172`).
    - On the Save path, a no-go zone drawn by hand on the same footprint is caught: "Line 59: the cutter envelope crosses no-go zone … (cutter radius 1.587 mm included)".
    - In Job Review without a trusted machine position, the same zone gives only "No-go zones cannot be checked from this hand-set origin…".
    - A clamp entered only in Machine Setup gets nothing from D5.
  - **The "incomplete" line is not a clear enough warning.** It reaches Job Review, but:
    - it never says that fixtures were left unchecked against the cutter itself;
    - in FIX c the same kind of line ("Unknown stickout…; assembly clearance is incomplete") sits beside a real contact finding, so an operator reads it as "holder and shank partly checked".
  - **Severity: P2, not P1.**
    - The `G0` is the programmed safe-Z travel. The emitted motion is not wrong for the program.
    - ADR-572 makes fixture contact advisory.
    - Before the spindle starts, the CNC Start attestation shows a generic but explicit warning: "Clamps, fixtures … are outside the cutter, rapid, retract, and safe-Z motion envelope" (`cnc-setup-attestation.ts:7`).
    - It stays P2 because the clamp check that the operator configured is silently inert for every catalog bit, and the result misleads.
- **Fix direction:**
  - When the flute length is unknown, still check a cutter cylinder of the known diameter from the tip up to at least the program's deepest cut (or a zero-length tip disc).
  - Report a fixture contact found that way as a contact, not as "incomplete".
  - Add a test with a catalog bit and a clamp on the travel path.

### P2-2 — The flute and stickout depth check reads only the first 50,000 lines or 100,000 segments of the program, so the deepest levels of a long job and any later bit section are never compared with the bit's recorded flute length

- **Where:** `src/io/cnc/cnc-program-geometry.ts:37-38` (`MAX_LINES = 50_000`, `MAX_SEGMENTS = 100_000`), `:124` (an arc line costs 361), `:69-80` (stop and disclose), `:182` (`depthMm` = deepest Z of the parsed paths only). `src/io/cnc/cnc-program-reach.ts:34-41` passes that `section.depthMm` to `analyzeCncToolReach` (`cnc-tool-reach.ts` `reachDepthFindings`).
- **Anchor:**
  - **Twin:** the compiled job already holds the exact deepest represented Z per group and bit, `cncGroupMaximumDepth` (`src/core/cnc/cnc-group-maximum-depth.ts:7-37`). Z travel (`cnc-z-travel-warnings.ts:28`) and the V-carve/relief depth warnings already use it. The reach depth check uses a truncated parse instead.
  - **Contract:** ADR-572 says reach checks are "conservative". A depth check that reports nothing because it stopped reading is not conservative.
- **Scenario:**
  - **(a) One long section.** A traced-style outline with 5,000 vertices, profiled 18 mm deep at 1 mm per pass in 19 mm stock, with a bit recorded as 12 mm flute and 20 mm stickout. The program is 90,415 lines long. It first goes below Z−12 at line 60,283 and reaches Z−18. The review stops at line 50,000 with a section depth of 10 mm, so it gives no flute warning. A 40 × 30 rectangle with the same settings (S1) warns "Cut depth 18 mm exceeds the recorded 12 mm flute length."
  - **(b) A late second bit.** The same outline cut 10 mm with a 1/4" bit, then a 1/16" bit with a 4.7 mm flute and 1/8" shank cutting 8 mm. The bit change `M0` is at line 50,472, so the second section is never parsed and gets no flute warning. The short S2 version of the same job warns.

  Both cases show only the generic "Program geometry review stopped at 50000 lines; remaining motion was not evaluated", listed among the six lines S0 shows on every job (P3-1). With a 1/8" × 1/2" cutter on a 1/4" shank, the shank (6.35 mm) enters the 3.175 mm slot past 12.7 mm (Amana 46341: "1/8 Dia x 1/2 x 1/4 Inch Shank"; Whiteside RD1600: "1/8 … 1/2 … 2" OAL, 1/4" shank).

  Long programs are ordinary:
  - three small V-carve shapes compiled to 42,939 motion segments in this audit;
  - relief jobs run far longer;
  - top-down jobs cut their deepest levels last;
  - arcs (helical entries, adaptive) use the segment budget 361 at a time, about 277 arc lines in all.
- **Evidence:** REPRO. Harness LONG with `F7_GEOM=1` printed:
  - `reviewed section depths [["em3-short",10]]`;
  - `first Z below -12 at line 60283 total lines 90415`;
  - for (b): `M0 lines [50472]`, `reviewed section depths [["em6-long",10]]`.

  The independent parser shows the per-section deepest Z as [−18] and [−10, −8]. The arc-cost path is READ only: the audit's adaptive attempts fell back to offset rings.
- **Novelty:** Not KNOWN. JR-5 (09-24, still open 09-29) is "no flute length on bits". Here the operator *has* entered one and the warning still does not fire.
- **Refuter:** CONFIRMED, P2 (not P1).
  - **Code.** `reserveLine` and `reserveSegments` break the parse at 50,000 lines or 100,000 segments (`cnc-program-geometry.ts:37-38, 75-98`). `finishSection` takes `depthMm` only from the parsed paths (`:181-182`), and sections after the break never exist.
  - **Independent REPRO** (my own geometry and parser, Save path `prepareOutput` → `emitPreparedGcode` → `cncProgramReachWarnings`):
    - **(a)** A 4,000-vertex outline cut 18 mm deep at 1 mm per pass, with a 1/8" bit recorded as 12.7 mm flute, 20 mm stickout and 1/4" shank. The program is 72,325 lines; its first Z below −12.7 is at line 48,223, and it reaches Z−18. The review reports `[["em3-12",13]]`, and its only depth line is "Cut depth 13 mm exceeds the recorded 12.7 mm flute length". It understates the depth by 5 mm, so any flute length from 13 to 18 mm would get no warning at all.
    - **(b)** The same outline cut 10 mm with a 1/4" bit, then a 1/16" bit (4.7 mm flute) cutting 8 mm. The `M0` is at line 112,182. The review reports `[["em6-25",5]]`, while the independent per-section depths are [−10, −8]. The 1/16" bit gets no line at all, only "Program geometry review stopped at 50000 lines…" and "Tool-section geometry and the resolved tool plan do not have matching counts."
  - **Is the cap documented?** `git grep` over `docs/`, `DECISIONS.md`, `WORKFLOW.md` and `PROJECT.md` finds no ADR or workflow that records the 50,000-line or 100,000-segment cap as a trade-off. ADR-572 allows "bounded" checks whose incomplete coverage is disclosed, and the generic truncation line is that disclosure. That covers bounding the *fixture* sweep. It does not cover the *depth* input, which needs no parse: `cncGroupMaximumDepth` (`cnc-group-maximum-depth.ts:7`) is exact and is already used by `cnc-z-travel-warnings.ts` and `cnc-compiled-depth-warnings.ts:88`. The Twin anchor stands.
  - **Severity: P2, not P1.**
    - The emitted depth equals the requested depth, so nothing physical is computed wrong. What is lost is an ADR-572 advisory about the operator's own bit.
    - A truncation disclosure does reach Job Review.
    - It stays P2 because the depth warning that does fire states a wrong depth, and a later bit section gets no reach line at all.
- **Fix direction:**
  - Take the flute and stickout depth for each tool section from the compiled groups (`cncGroupMaximumDepth`), with the section order from `cncToolPlan`. Keep the bounded parse for fixture geometry only.
  - When the parse is truncated, say which bit sections were not reviewed.

### P2-3 (refuter: P3) — On a pocket or inside-profile layer, a closed shape smaller than half the bit is dropped from the program with no warning, while the same shape alone on a layer is reported

- **Where:**
  - `src/core/cnc/compile-cnc-diagnostics.ts:28-32`: a layer counts as not dropped once any group exists for it.
  - `src/core/min-feature/min-feature-analysis.ts:70-74`: `MIN_EXTENT_FACTOR = 0.5`, "half the threshold keeps every hole the check is for".
  - ADR-433 Decision 3: features spanning "less than half the threshold are dropped as specks".
  - Preflight comment `src/core/preflight/cnc-preflight.ts:103-105`.
- **Anchor:**
  - **Twin:** `cnc-layer-empty` exists because "A layer with shapes but zero toolpaths would be SILENTLY omitted from the job … the customer finds out after the cut" (`cnc-preflight.ts:103-105`). The same omission of one shape on a layer with any other output is silent.
  - **Twin:** ADR-433's warning covers holes from half the bit up to the full bit ("the bit cannot enter it, so it stays uncut"). A smaller hole, more certainly uncut, gets nothing. The speck rule's stated reason is laser-specific: "hair spikes and pixel notches the beam rounds off like a corner". A whole closed hole on a CNC pocket is not a speck the bit rounds off; the bit never enters it.
- **Scenario:** A part outline as a pocket or inside profile on one layer, with two round holes. Results with the 1/4" bit:
  - d = 1, 1.5 or 2 mm: no cutting move comes within 3.5 mm of either hole centre, and preflight, machine warnings and min-feature are all empty;
  - d = 3, 3.1, 3.2, 4, 6 or 6.3 mm: the ADR-433 warning fires;
  - same pattern with the 1/8" bit: silent at d = 1 mm, warned at 1.5 to 3.1 mm, cut at ≥ 3.2 mm.

  So a 2 mm pilot or screw hole drawn on a 1/4"-bit inside-profile layer comes out uncut, with nothing in Job Review. The canvas toolpath preview does show no path there.
- **Evidence:** REPRO. Harness HOLES sweep: 2 bits × 9 diameters × 2 cut types, with an independent check for any cutting move near each hole centre. Results above.
- **Novelty:**
  - F5-P2-3 is the inlay pair, which ADR-433 skips altogether. This finding is pocket and inside profile, which ADR-433 does check, losing whole holes to the speck rule.
  - ADR-433's speck rule is a recorded decision, so the refuter may judge this a contract gap (ADR amendment) rather than a code defect.
- **Refuter:** CONFIRMED as behaviour. **Severity changed P2 → P3** (contract question for the maintainer).
  - **Independent REPRO.** A 60 × 40 rectangle plus one round hole at X140 Y360, 3 mm deep.
    - Inside profile, real Job Review path (`prepareCurrentStartJob` → `buildJobReviewModel`):
      - 1/4" bit, d = 2: silent;
      - 1/4" bit, d = 3 and 3.3: "1 area narrower than the 6.35 mm bit … stays uncut";
      - 1/8" bit, d = 1: silent;
      - 1/8" bit, d = 1.5: warned.
    - Pocket, Save path, because the Start path needs the compile worker that jsdom lacks:
      - 1/4" bit, d = 2: only the starter-feed note;
      - 1/4" bit, d = 3: warned;
      - 1/8" bit, d = 1: silent.
    - In every silent case, 0 cutting moves come within 4 mm of the hole centre.
  - **Why P3.** ADR-433 Decision 3 is explicit:
    - "Features whose witness chords span less than half the threshold are dropped as specks …";
    - "A small round hole spans its diameter, so every hole at least half the threshold across is kept too".
    - Decision 1 applies this to CNC `pocket` and `profile-inside`. Amendment 1 re-based the CNC threshold on the bit's cut width and kept the factor.
    - No other clause (PROJECT.md, WORKFLOW F-CNC3, ADR-481 Amendment 2, which covers *open* contours) requires a per-contour report of closed shapes that compile to nothing. `cnc-layer-empty` is scoped to whole layers.
    - So the silence is decided behaviour. The auditor's point stands as an argument for an ADR-433 amendment: the stated rationale, a speck the beam rounds off, does not fit a whole CNC hole, and the hole is more certainly uncut than the half-bit-to-bit holes that do warn.
    - It returns to P2 if the maintainer rejects the speck rule for CNC holes.
- **Fix direction:** For CNC pocket and inside-profile targets, report every closed contour that compiles to no toolpath, per layer with a count and position, or exempt closed contours from the speck rule. Keep the laser speck rule.

### P3-1 — The reach review adds six generic lines to every CNC Job Review of a default project, which hides the real findings

- **Where:**
  - `src/io/cnc/cnc-program-reach.ts:14-24`: the review returns nothing only when there are no fixtures and no tool in the *library* has assembly metadata. `DEFAULT_CNC_TOOLS` carries `shankDiameterMm` on its hobby V-bits (`cnc-tool-starters.ts:131,141,156,…`), so the gate is always open.
  - `src/io/cnc/cnc-program-geometry.ts:206-210`: every review with a section sets `incomplete` (unknown initial approach).
  - `cnc-tool-reach.ts:209` and `:193`: make `incomplete-paths` fire for every section of every program.
- **Anchor:** **Twin.** The gate's intent ("only when the user supplied reach data") depends on unrelated catalog metadata on library entries the job does not use: a library without the hobby V-bits shows nothing. "Path coverage is incomplete … unexamined motion has no clearance result" is a fixed property of the method, not a finding about this program.
- **Scenario:** S0, the default project with a 1 mm on-path rectangle. Job Review shows:
  - "CNC reach review · 3.175 mm (1/8") end mill: Unknown flute length, stickout, shank diameter, holder envelope; assembly clearance is incomplete.";
  - "…Path coverage is incomplete…";
  - four disclosure lines.

  An operator who learns to skip "CNC reach review" lines also skips S1's real flute warning.
- **Evidence:** REPRO (S0, S1, S3, S4a, S5 outputs).
- **Refuter:** CONFIRMED, P3.
  - The gate (`cnc-program-reach.ts:14-24`) opens when any *library* tool has assembly metadata. `DEFAULT_CNC_MACHINE_CONFIG.tools` is `DEFAULT_CNC_TOOLS` (`machine.ts:374`), which carries `shankDiameterMm` at `cnc-tool-starters.ts:131, 141, 156, 166, 176`.
  - `finishReview` always discloses the unknown-approach line once a section exists (`cnc-program-geometry.ts:206-210`). `disclose` sets `incomplete` (`:217-220`), so `incomplete-paths` fires for every section.
  - My FIX a Job Review run shows exactly these six reach lines.
- **Fix direction:**
  - Open the gate on the job's own section tools or fixtures.
  - Emit the method disclosures once, as a fact row, not as warnings.
  - Raise `incomplete-paths` only for a real truncation or an unparsed section.

### P3-2 — Tiled save runs no reach review, so a flute, stickout or clamp finding that Save and Start show is missing from tile files

- **Where:** `src/ui/app/tile-emission.ts:80-115` (`runCncPreflight` only) and `src/ui/app/tiled-output-preparation.ts:65-79` (`detectMachineJobWarnings` only). `cncProgramReachWarnings` has three callers: `job-review-model.ts:133`, `save-output-emission.ts:95` and `cnc-tool-programs.ts:113`.
- **Anchor:** **Twin** with the Save and Start paths. ADR-572 treats the reach review as an exported-program advisory ("exact exported program identity").
- **Scenario:** S1's 18 mm pocket with the 12 mm-flute bit, on 700 mm stock tiled at 380 mm. Both tile files cut to Z−18. Machine warnings, emission advisories, tile advisories and preparation advisories are all empty. The same prepared job's Save-path review returns "Cut depth 18 mm exceeds the recorded 12 mm flute length."
- **Evidence:** REPRO (harness TILE).
- **Novelty:** E3 (controller v4) covered tile bit changes and parks, not reach.
- **Refuter:** CONFIRMED, P3.
  - `git grep` finds exactly three non-test callers of `cncProgramReachWarnings`: `ui/laser/job-review/job-review-model.ts:133`, `ui/laser/save-output-emission.ts:95` (the path is `src/ui/laser/`, not `src/ui/app/`) and `io/cnc/cnc-tool-programs.ts:113`.
  - The tile path never calls it:
    - `tile-emission.ts:80-115` runs `runCncPreflight` and the V-carve depth check per tile;
    - `tiled-output-preparation.ts:65-79` runs `detectMachineJobWarnings`;
    - `save-tiled-gcode.ts:94-118` toasts only those.
  - The auditor's TILE repro agrees.
- **Fix direction:** Run `cncProgramReachWarnings` on each tile or bit file. Fixtures are in program coordinates, so for tiles either translate them or disclose that clamp clearance is not checked in tile frames.

### P3-3 — The straight inlay pair's female pocket depth is never compared with stock thickness; the spoilboard warning reads the insert depth

- **Where:**
  - `src/ui/laser/cnc-through-cut-tab-warnings.ts:86`: compares `settings.depthMm` with stock.
  - `src/core/cnc/inlay-pair.ts:55-57` and `inlay-pair-operation.ts:134-138`: the female pocket is cut to `inlayPocketDepthMm`.
  - `src/ui/layers/CncInlayFields.tsx:61-70`: the Pocket depth field accepts up to 200 mm.
- **Anchor:**
  - **Twin:** the emitted pocket depth versus the warning's depth.
  - **Contract:** WORKFLOW F-CNC3 "Warning — depth exceeds stock: Preflight surfaces depth > stock thickness as a Job Review warning".
- **Scenario:** Inlay pair, insert depth (Cut depth) 5, Pocket depth 8, 6.35 mm stock. The female pocket is emitted to Z−8, 1.65 mm into the spoilboard, with no warning. A plain 8 mm pocket gets "1.65 mm past the bottom, into the spoilboard".
- **Evidence:** REPRO (harness INLAY). The tapered pair (`taperedInlay.pocketDepthMm`) has the same mechanism. It was not reproduced, because a 60° 6.35 mm V-bit cannot reach 8 mm and the layer was refused.
- **Refuter:** CONFIRMED, P3.
  - `layerStockWarning` compares `settings.depthMm` with stock (`cnc-through-cut-tab-warnings.ts:86`).
  - The female half is a pocket at `straightInlayPocketDepthMm` = `inlayPocketDepthMm ?? min(3, depthMm)` (`inlay-pair.ts:55-57`, `inlay-pair-operation.ts:134-138`).
  - No other depth-versus-stock check exists. `runCncPreflight` deliberately has no stock-depth cap (`cnc-preflight.test.ts` "does not impose a universal stock-depth cap"), and the compiled-depth warnings cover only V-carve and relief.
  - The auditor's INLAY repro agrees. It stays P3 because the operator typed the Pocket depth.
- **Fix direction:** Take the spoilboard depth from compiled group depth (`cncGroupMaximumDepth`) for every non-relief cut type, as the V-carve and relief warnings already do.

## KNOWN (re-observed, not re-raised)

- **09-24 JR-3 (09-29 "partly fixed"):** Z travel is compared only as a span (deepest cut + safe Z or park height vs `$132` or the profile's travel). It is never compared with a known work offset, so Z0 set near the top of travel is not caught. With no `zTravelMm` (the default profile), the park height of 150 in S3 is not checked at all. Out-of-bed covers X and Y only.
- **09-24 JR-5 (open at 09-29):** shipped and catalog bits have no flute length, so a deep cut gets no flute warning unless the operator fills in the ADR-572 assembly editor. Re-observed: no `fluteLengthMm` in any starter or catalog. P2-1 and P2-2 are distinct: they fail even when the data is present, or for the cutter itself.
- **09-24 warning wording:** `cnc-layer-empty`, `cnc-open-contours-omitted` and the spoilboard warning say "Layer L1" (the layer id), not the name.
- **E3-P2-1 / E3-P2-2 (controller v4):** tile bit files and the tile park frame.
- **D5-P2-1 / D5-P3-3 / D5-P3-4 (controller v3):** the no-go envelope's tip diameter for engraving bits; relative-origin zone scans and messages.
- **M1-P2-2 (meta v1):** cross-operation contour overlap has no warning.
- **F5-P2-3:** the inlay pair drops strokes narrower than the bit.
- **F3 helical entry:** "requires one island-free pocket per layer". Seen here as a named refusal; F3's area.
- **09-29 AC-4:** V-carve flat depth past the bit's reach. Not re-measured.
- **ADR-433 laser speck rule.** Kept for laser; P2-3 concerns only its CNC consequence.

## Refuted

**Refuter (2026-10-23):** none of the six raised findings was refuted. These refutation attempts failed:
- **"D5 no-go zones already catch the clamp" (P2-1).** Fixtures are not no-go zones, and a Job Review with no trusted machine position does not check zones.
- **"ADR-572's bounded disclosure covers the depth check" (P2-2).** The bound is needed for the fixture sweep, not for depth; exact compiled depth is available.
- **"ADR-433 accepts the dropped holes" (P2-3).** This attempt succeeded only for severity: P2 → P3.

Candidates dropped before raising:
- **A rapid descends into uncut stock through an air floor.** No. The floor is set only for a pass whose point list is byte-identical to an earlier pass of the same kind in the same group (`cnc-pass-air-floors.ts:31-43, 81-93`), at that pass's highest represented Z, and only from safe Z (`cnc-grbl-entry-descent.ts:35-41`). Recovery and tiles strip floors. The 20-program simulation found 0 collisions.
- **Multi-bit sections misaligned with the tool plan.** No. `M0` is emitted only on a tool change (`cnc-grbl-transitions.ts:84-101`), and `cncToolPlan` pushes on the same key change (`cnc-tool-plan.ts:15-26`). S2 shows 2 sections and 2 plan entries. Already verified in rolling-v2 09.
- **Tile frames raising false out-of-bed warnings.** No. Tiles are clipped and translated to their own min corner (`tile-plan.ts:88-231`), so tile coordinates stay inside the bed.
- **Inlay pair dropped with no notice.** No. `hasOwnEmptyLayerNotice` skips it, but `findCncInlayIssues` reports the plan's failure reason (`cnc-inlay-issues.ts:43-48`).
- **Flute check fooled by ramps, tabs, helices or leads.** No. Depth is the deepest Z of every parsed motion, including `G2`/`G3` Z (S1, S2, ARCS: 48 inside-profile holes, 65,444 lines, warned at Z−18 because each hole is cut to full depth before the next).

## Verified clean

- **No rapid into uncut stock (Q3).** Independent height-field simulator, 0.1 mm grid. A flat cutter is swept exactly; a V-bit cone is sampled; each `M0` section uses its own bit. 20 programs, 1,844 below-Z0 rapids, 0 rapid collisions, and no `plunged-travel` issue from the post-emit scan:
  - profiles: outside with tabs plus a 10° ramp; outside with tabs and no ramp; inside with tabs and a 3 mm line lead; outside with a 0.5 mm finish allowance; outside with retract between passes;
  - on-path open path, with and without ramp;
  - pockets: offset; offset with lifts; raster-X; 5° ramp; helix (single pocket and two pockets); adaptive (offset fallback); 1/4" rough + 1/8" finish;
  - engrave; drill;
  - V-carve with a 60° V-bit; V-carve with flat depth and a 1/8" clearing bit;
  - straight inlay pair.

  Every below-Z0 `G0` was a Z-only ADR-489 descent that stopped at least 1 mm above already-cut floor. The post-emit scanner (`cnc-motion.ts:137-182`) accepts a below-safe `G0` only as Z-only, from safe Z, followed by a lower `G1` plunge, and ≥ 1 mm above the deepest fed Z.
- **Reach depth check (when the program fits the budget).** It uses the real deepest emitted Z, including tabs, ramps, helices, leads and finish allowance, per bit section of a multi-bit job (S1, S2, ARCS).
- **Fixture geometry.** The cylinder-versus-prism test is exact for linear segments (`cnc-reach-geometry.ts`). Rapids at safe Z are included as travel steps (`cnc-program-xyz-paths.ts:31-39`). Contact is detected once a flute length exists (FIX b/c).
- **Open contours (Q4).** Counted per layer from the compiled contours (`cnc-open-contour-omissions.ts`). An all-open layer gets `cnc-layer-empty` plus `empty-output`.
- **Park outside travel (Q2).** The park line is scanned like any move, giving `out-of-bed` X and Y at its line (S3).
- **Out-of-bed scan.** The scan includes arc bulges (`predicates.ts:138-151`). The Start path switches to the relative envelope when the origin is unknown.
- **Spoilboard warning.** Matches the emitted depth for profile, pocket, engrave and drill (`settings.depthMm` is the compiled depth there). V-carve and relief use compiled depth.
- **L5.** Assembly fields are positive and finite; holders are at most 32 segments, and a malformed holder drops the whole holder (`cnc-tool-assembly.ts:9-47`). Fixtures are capped at 128 and validated (`project-cnc-setup-validator.ts:25-50`). Names render as text.
- **Standalone surfacing preflight.**
  - Feed and RPM limits are checked.
  - Work-origin bounds are checked against the bed size.
  - Plunged travel and spindle-start clearance are checked.
  - It fails closed on enabled no-go zones, because its work origin is unknown (`standalone-cnc-preflight.ts:120-131`).
- **Ground truth.**
  - GRBL wiki: soft limits need "homing to be enabled and accurate axis maximum travel settings"; `$130–$132` "sets the maximum travel from end to end".
  - Fusion collision avoidance uses "Shaft & Holder" clearances, and its simulation reports "Holder collides with stock" and rapid-into-stock collisions. KerfDesk's stickout check (depth > stickout) is the 2.5D analogue.

## Not verified

- **The arc-cost path of P2-2** (an adaptive or helix program exhausting 100,000 segments before its deepest level). READ only: both adaptive attempts fell back to offset rings under the engagement check.
- **Tapered inlay depth versus stock (P3-3).** Mechanism READ only.
- **Two-sided jobs (`cncSideHeader`) and fixture coordinates on side B.**
- **Recovery and Start-from-line programs.** No reach review is run on them, and their preflight belongs to area 18 / D5-P2-4.
- **Relief programs in the air-floor simulator.** F6's area; relief floors use `relief-air-floor-proof.ts`.
- **Hardware, air cuts and controller soft-limit behaviour.**
- **The Run G-code file review for external programs.** It has no reach review. E4's area.

Sources: [GRBL v1.1 Configuration](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration); [Amana 46341 listing (eoasaw)](https://eoasaw.com/?p=221357); [Whiteside RD1600 / WRD1600](https://superiorcarbide.com/wrd1600); [Fusion: Avoid collisions in a toolpath](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-AVOID-COLLISIONS.htm); [Fusion machine simulation collision detection (Autodesk blog)](https://www.autodesk.com/products/fusion-360/blog/fusion-machine-simulation-collision-detection/).

Repro copies: `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\f7-repros\` (`src_io_cnc_zz-f7-harness.test.ts` with modes `ALL`, `S5`, `HOLES`, `FIX`, `LONG`, `ARCS`, `TILE`, `INLAY`, `HELIX` via `F7_ONLY`, plus `F7_GEOM=1`; `src_io_cnc_zz-f7-airfloor.test.ts` via `F7_ONLY=AIR`; dumped `.nc` programs).

```json
[
  {"id":"F7-P2-1","severity":"P2","area":"cnc-preflight-reach","file":"src/core/cnc/cnc-tool-reach.ts","line":156,"anchor":"Contract: ADR-572 conservative advisory fixture checks; Twin: no-go zone check uses the cutter radius (cnc-preflight.ts:336)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"refuter":"Reproduced via real Job Review (prepareCurrentStartJob -> buildJobReviewModel): 10 warnings, none names Clamp 1; G0 line 59 at Z3.81 crosses it; fluteLengthMm 12 makes it warn. Fixtures are not no-go zones (separate data, no conversion). P2 not P1: motion is the programmed safe-Z travel, ADR-572 advisory, CNC Start attestation names clamps vs safe-Z envelope","summary":"Fixture clearance adds no cutter envelope without a flute length, which no shipped or catalog bit has; a default 15 mm clamp crossed by a G0 at Z3.81 gets no warning, only 'assembly clearance is incomplete'; typing a 12 mm flute length makes it warn"},
  {"id":"F7-P2-2","severity":"P2","area":"cnc-preflight-reach","file":"src/io/cnc/cnc-program-geometry.ts","line":37,"anchor":"Twin: cncGroupMaximumDepth (compiled exact depth) used by Z travel and V-carve/relief depth warnings; Contract: ADR-572 conservative","evidence":"REPRO","verdict":"CONFIRMED","known":false,"refuter":"Independent repro: 72,325-line 18 mm profile reviewed as 13 mm (first Z<-12.7 at line 48,223); second bit after M0 at line 112,182 never reviewed (reviewed [[em6-25,5]] vs actual [-10,-8]). Cap not documented beyond ADR-572's generic 'bounded'/disclosure; depth needs no parse (cncGroupMaximumDepth). P2 not P1: emitted depth is the requested depth; truncation disclosure reaches Job Review","summary":"Flute/stickout depth comes from a parse capped at 50k lines/100k segments (arc = 361): an 18 mm cut with a 12 mm flute reads as 10 mm (Z-12 first at line 60,283), and a 1/16in 4.7 mm-flute bit after M0 at line 50,472 is never checked; no flute warning"},
  {"id":"F7-P2-3","severity":"P3","severityRaised":"P2","area":"cnc-preflight-reach","file":"src/core/min-feature/min-feature-analysis.ts","line":74,"anchor":"Twin: cnc-layer-empty (cnc-preflight.ts:103) reports the same omission for a whole layer; ADR-433 speck rationale is laser-specific","evidence":"REPRO","verdict":"CONFIRMED","known":false,"refuter":"Reproduced (inside profile via Job Review, pocket via Save path): 1/4in d=2 and 1/8in d=1 silent and uncut; d>=bit/2 warned. ADR-433 Decision 3 explicitly drops sub-half-threshold holes as specks and applies to CNC pocket/profile-inside (Decision 1, Amendment 1 kept the factor); no other clause requires per-contour reporting. Severity P2->P3: contract question (ADR-433 amendment) for the maintainer","summary":"Pocket/inside-profile shapes smaller than half the bit (2 mm hole, 1/4in bit) compile to nothing with no warning when the layer has other output; holes from half the bit to the bit are warned"},
  {"id":"F7-P3-1","severity":"P3","area":"cnc-preflight-reach","file":"src/io/cnc/cnc-program-reach.ts","line":14,"anchor":"Twin: gate intent vs starter V-bit shank metadata; incomplete-paths fixed by method","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Gate opens on DEFAULT_CNC_TOOLS shankDiameterMm (cnc-tool-starters.ts:131..176); finishReview always discloses the approach line so incomplete-paths always fires; six lines seen in refuter FIX a Job Review run","known":false,"summary":"Every default CNC Job Review gets six generic 'CNC reach review' lines (unknown geometry, path coverage incomplete, disclosures) because starter V-bits carry shank metadata and the unknown initial approach always marks coverage incomplete"},
  {"id":"F7-P3-2","severity":"P3","area":"cnc-preflight-reach","file":"src/ui/app/tile-emission.ts","line":80,"anchor":"Twin: Save (src/ui/laser/save-output-emission.ts:95) and Start (job-review-model.ts:133) run cncProgramReachWarnings","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Only three non-test callers of cncProgramReachWarnings; tile-emission.ts, tiled-output-preparation.ts and save-tiled-gcode.ts never call it","known":false,"summary":"Tiled save runs no reach review: an 18 mm cut with a 12 mm-flute bit warns on Save but not in tile files"},
  {"id":"F7-P3-3","severity":"P3","area":"cnc-preflight-reach","file":"src/ui/laser/cnc-through-cut-tab-warnings.ts","line":86,"anchor":"Twin: inlay-pair-operation.ts:137 cuts inlayPocketDepthMm; Contract: WORKFLOW F-CNC3 depth past stock warns","evidence":"REPRO","verdict":"CONFIRMED","refuter":"layerStockWarning reads settings.depthMm; female pocket uses straightInlayPocketDepthMm; no other depth-vs-stock check covers inlay","known":false,"summary":"Straight inlay Pocket depth 8 in 6.35 mm stock cuts 1.65 mm into the spoilboard with no warning; the spoilboard check reads the insert depth"}
]
```
