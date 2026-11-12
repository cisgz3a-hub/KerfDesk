# E1 `import-and-notice-fixes` — auditor report

**Round:** C2 fix verification, area E1 (lenses L10 fix verification, L12 untested merges).
**Tree:** origin/main @ `66a7a008c` (`scratchpad/j33-main`, read only). Pre-fix comparisons use `j31-main` (`420c5f547`) and `j28-main` (`dcca5b8c4`).
**Fixes verified:** #1750 (ADR-700 Amd 1), #1819 (ADR-700 Amd 2), #1820 (DXF ARC), #1822 (ADR-127 Amd 6), #1762 (ADR-127 Amd 5). All five merge commits are ancestors of `66a7a008c`.

## Headline

Every original C2 repro now passes: the PostScript straight rule imports, the C2 PostScript payloads end in about 0.1 s, a DXF ARC past one turn burns one turn, the old-project notice matches the compiled strokes in all 1,120 reachable combinations, and a Ruida `.rd` on a Y rotary burns within 97.6–102.3 % of the set dose. The fixes' own test files pass on `main` (7 files, 75 tests).

But three P1s remain:

- **E1-P1-1 (SECURITY, redacted).** The PostScript work bound from #1819 can be escaped by another construct. A small file still holds the window thread for minutes; one case was killed at 150 s. The import still runs on the window thread.
- **E1-P1-2 (regression from #1820).** A full-circle ARC written as `start → start + 360` can land one ulp past 360° after decimal rounding, as in `152.2 → 512.2`. It now imports as a near-zero arc, so the circle disappears without a note. Before the fix it was a full circle. This happens for 11.6 % of starts given to 0.1°.
- **E1-P1-3 (pre-existing, new).** PostScript and Illustrator 3–8 hairlines (`0 setlinewidth` / `0 w`) are dropped without a note when the file also has other strokes. A file with only hairlines is refused as "no drawable content".

There are also two P2s:

- **E1-P2-1:** ELLIPSE parameters past one turn still clamp to a full ellipse, which is inconsistent with the fixed ARC.
- **E1-P2-2:** the `.rd` split cuts a 30 mm circle into 30 parts, with 1.5 m of travel and 60 reversals of the rotary's direction instead of 2. The ETA does not include that travel, and the seams it may leave are unverified on hardware.

## Before / after (C2 measurement vs now)

| C2 finding | C2 measurement | Now on `66a7a008c` | Status |
|---|---|---|---|
| D1-P2-4 PS straight rule, no bbox | horizontal or vertical 80 pt line: 0 points, "no drawable content"; refuter: the collinear, zero-height-bbox and thick-stroke cases also give 0 objects | horizontal imports 28.22 × 0.35 mm; vertical 0.35 × 28.22 mm; all 5 refuter cases import 1 object with a success toast (`out/r6.txt`, `out/q4.txt`) | **Fixed.** Residual P3: E1-P3-1 |
| D5-P1-1 (SECURITY, redacted) | the C2 payloads never returned or ran for tens of minutes | every C2 payload ends with the budget error in 75–165 ms; controls are unchanged (details in `zz-e1/SECURITY-DETAILS.md`) | **Fixed for its payloads.** New escape: E1-P1-1 |
| D5-P1-2 DXF ARC over one turn (r = 20, one turn 125.66 mm) | 0→450: 157.04 mm; −360→90: 157.04; 0→720: 251.26; 30→1110: 376.89 | 0→450: 31.41; −360→90: 31.41; 0→720: 125.63; 30→1110: 125.63; refuter set (10 cases, including −Z extrusion): all one turn or less (`out/r10.txt`, `out/q1.txt`) | **Fixed.** Regression: E1-P1-2 |
| D6-P3-3→P2 notice angles (chuck 40, Ø80) | 45° cross-hatch: notice 6.28×, real 1.40×; 30° cross-hatch 6.28× vs 1.93×; 3 passes turned 30°: 6.28× vs 3.32× | the notice equals the change measured from compiled Fill strokes in 1,120 / 1,120 combinations: hatch {0, 15, 30, 45, 60, 90, 135, 170, −30, 400} × cross-hatch × passes/step {1/0, 2/0, 2/90, 3/30, 4/45, 3/180, 2/−60} × scanline/island × object rotation 0/30°, on k < 1 and k > 1 (`out/c1.txt`) | **Fixed** |
| D2-P1-2 `.rd` Y-rotary surface feed | dose round the part 15.9 % (chuck 40/Ø80), 31.8 % (chuck 80/Ø80), 458 % (pen 360/Ø25), no advisory | 101.6 % / 97.8 % on D2's square; decoded per cut over circles: 97.6–102.3 % (k = 0.159), 97.8–102.3 % (k = 4.58), roller and reversed axis the same, taper 97.6–102.5 % of the G-code per-move feed (`d2/out/*.txt`) | **Fixed.** New: E1-P2-2, E1-P3-2 |
| D2-P3-5 Ruida rotary note | ADR-127 Amd 2 said the controller rescales; Rotary Setup said nothing | ADR-127 Amd 5 corrects the reason; Rotary Setup shows `RUIDA_ROTARY_NOTE` on `controllerKind === 'ruida'` only; `RotarySetupHost.ruida-note.test.tsx` passes | **Fixed** (the controller's double-scaling behaviour is still unverified on hardware, as the note says) |

## Findings

### E1-P1-1 — SECURITY (redacted): the PostScript work and time bound can be escaped

- **Where:** redacted (`src/io/postscript/`); details in `zz-e1/SECURITY-DETAILS.md`.
- **Anchor:** ADR-700 Amd 2: "An imported file ends in at most about five seconds of window work". PROJECT.md non-negotiable 9 (Abort reachable during a job), as for D5-P1-1.
- **Evidence: REPRO** (redacted). A file of about 100 bytes:
  - one case did not return and was killed by `timeout 150`;
  - another finished after 16.9 s with the 5 s limit never firing;
  - a third case's output exceeds the importer's own size cap by 7× and takes 10.2 s on the window thread.
- **Scenario:** as D5-P1-1, bounded at minutes instead of for ever. The window freezes for minutes after a crafted or corrupt EPS, PS or AI file is opened or dropped. The operator usually kills the app and loses work since the last autosave. During a window-thread stream (K40, Moshi, window-route GRBL) the stream stalls with Abort unreachable.
- **Severity: P1** (D5-P1-1's rating: it loses work and makes Abort unreachable during a job).
- **Announced?** No. ADR-700 Amd 2 states the opposite: "a future gap in step accounting cannot hang the window either".
- **Novelty:** new: a bypass of #1819's bound. D5's fix direction item 3 (a worker with a wall-clock limit) was not done.
- **Fix direction:** in the security notes (redacted until fixed): close the bypass, bound the whole import including the SVG step, and run the reader off the window thread with Cancel. Add regression tests.

### E1-P1-2 — A full-circle DXF ARC written as start + 360 can import as a near-zero arc (regression from #1820)

- **Where:** `src/io/dxf/dxf-entities.ts:107-117` (`arcSweep`). A difference above 360° by even one ulp leaves the `(-360, 360]` branch. `sweepDeg % 360` then gives about `5.7e-14`, a near-zero arc.
- **Anchor:**
  - The function's own doc comment: "angles a whole number of turns apart mean the same arc … equal angles mean a full circle".
  - ezdxf's `arc_angle_span_deg` gives 360° when the two angles are close, which covers float noise.
  - The pre-fix loop gave a full circle.
- **Evidence: REPRO.**
  - `b3-dxf-e2e-and-ellipse.mts`, real `parseDxf` → Line layer → `emitGcode`, r = 20 mm:
    - `152.2 → 512.2` burns **0.00 mm** with no note (pre-fix on `j31-main`: 125.62 mm);
    - `1.4 → 361.40000000000003` burns 0.00 mm (pre-fix 125.62 mm);
    - controls `0 → 360` and `152.2 → 152.2` burn 125.63 mm.
  - `b4-dxf-mixed.mts`: a LINE plus that ARC imports with `kind: ok` and no notes. The circle becomes a 2-point polyline (pre-fix 46 points).
  - `b2-dxf-full-turn-noise.mts`: the same collapse happens for
    - 416 of 3,600 starts given to 0.1° (11.6 %), with `end = start + 360` printed as its shortest decimal;
    - 3,744 of 36,000 starts given to 0.01°;
    - 862 of 3,600 starts when the end is computed in radians and printed in degrees;
    - 10.7 % of random starts.
  - Outputs: `out/b2.txt`, `out/b3.txt`, `out/b3-prefix.txt`, `out/b4*.txt`.
- **Scenario:** an exporter writes a full circle as an ARC from `s` to `s + 360`. This is the un-normalised-angle class #1820 was written for. For about 1 start in 9 the circle vanishes from the canvas and the job: a cut-out loses its outline, or an engraving loses a ring. There is no note, so the import says it succeeded.
- **Severity: P1.** It is a silently wrong shape and burn, the D5-P1-2 and O2-P1-1 class (METHOD §3, no reach clause).
- **Announced?** No. **Novelty:** new, a regression introduced by #1820. Its tests use only whole-degree angles (0→720, 30→1110).
- **Fix direction:** treat a difference within a tolerance of a whole number of turns (for example `|wrapped| < 1e-9` or relative 1e-12, as ezdxf's `isclose`) as a full turn. Equivalently, reduce in degrees first and then apply the same `≤ 0 → +360` rule to an `isclose`-snapped remainder. Add cases `152.2→512.2`, `1.4→361.40000000000003` and `0→360.00000000000006`.

### E1-P1-3 — PostScript and Illustrator hairlines (zero line width) are dropped, silently when other strokes exist

- **Where:**
  - `src/io/postscript/ps-ops-gstate.ts:69` (`setlinewidth`) and `src/io/postscript/ai-ops.ts:73` (`w`) store 0;
  - `src/io/postscript/ps-svg.ts:48-49` writes `stroke-width="0"` (or rounds widths below 5e-7 to `0`);
  - `src/io/svg/parse-svg.ts:269` treats a zero stroke width as unpainted, which is correct for SVG.
- **Anchor:** the PostScript Language Reference, `setlinewidth`: a width of 0 means the thinnest line the device can render, not "no line". ADR-700: EPS/PS artwork "goes through the ordinary SVG import". The conversion changes the meaning of 0 on the way.
- **Evidence: REPRO** `a2-ps-hairline.mts` and `a4-ps-hairline-toasts.mts` (real converter, real `parseSvg` and the real `importPostscriptFile`):
  - An EPS with an 80 pt `0 setlinewidth` outline plus a 10 pt `1 setlinewidth` square imports 1 polyline of 3.53 × 3.53 mm. The outline is lost, and the toast reads `[success] Imported … — 1 object, 1 color` with no note.
  - The same in Illustrator 8 (`0 w … s`) gives the same result.
  - A file with only hairlines gives "has no drawable content".
  - Controls: `0.001 setlinewidth` imports, and so does a 1 pt square alone.
  - The behaviour is the same on pre-fix `j31-main`.
  - Outputs: `out/a2.txt`, `out/a4.txt`.
- **Scenario:** a CAD or vector program writes cut lines as zero-width hairlines, the usual way to mark laser cut lines, next to some stroked detail. The import reports success and the canvas lacks the cut outline. If the operator does not notice, the job burns the detail and never cuts the part out.
- **Severity: P1** by METHOD §3: silently lost artwork, where a visible result is not a warning. The refuter may weigh reach: hairline-only files fail loudly (P2 shape).
- **Announced?** No. **Novelty:** new. It has been in ADR-700 since #1705 and was not caused by the verified fixes. It was found while checking #1750's edges (the `0 setlinewidth` horizontal rule still imports nothing).
- **Fix direction:** in `paintedSvg`, write a zero or near-zero stroke width as a positive hairline, for example `max(width, 0.001 pt)` or `vector-effect="non-scaling-stroke"` with 1 px. Add a test with a hairline plus a stroked path. The PDF importer writes `stroke-width` from `setLineWidth` the same way (`pdf-vector-page.ts:117-118,155`). That is a READ-only sibling, not driven.

### E1-P2-1 — DXF ELLIPSE parameters past one turn still become a full ellipse, unlike the fixed ARC

- **Where:** `src/io/dxf/dxf-curve-sampling.ts:82-89` (`normalizedSweep`: a positive difference is `Math.min(sweep, FULL_TURN)`), used by `dxf-entities.ts:184-185`.
- **Anchor:** #1820's direction rule for ARC ("angles a whole number of turns apart mean the same arc"); ezdxf normalises ellipse parameters modulo 2π. The brief asks for consistency between ARC, CIRCLE and ELLIPSE.
- **Evidence: REPRO** `b3-dxf-e2e-and-ellipse.mts`, an ELLIPSE with ratio 1 and r = 20:
  - `0 → π/2` burns 31.41 mm;
  - `0 → 2π + π/2` burns **125.63 mm** (a full ellipse), where ARC `0 → 450°` now burns 31.41 mm;
  - `0 → 4π` and `−2π → π/2` burn a full ellipse.
  - Output: `out/b3.txt`.
- **Scenario:** an exporter writing un-normalised ELLIPSE parameters imports a closed ellipse where the drawing has an arc of one. This is the D5-P1-2 shape on the sister entity.
- **Severity: P2.** It is the D5-P1-2 class, but the DXF reference gives ELLIPSE parameters as 0…2π ("2pi for a full ellipse"), so the input is out of spec, and C2 accepted the clamp. The refuter should choose between P1 (D5-P1-2 precedent) and P3.
- **Announced?** No. ADR-700 Amd 2 says its loop-free `normalizedSweep` "equals the former loop's for every ordinary input", which is true.
- **Novelty:** new as a finding. D5 noted the clamp as correct.
- **Fix direction:** share one direction rule (with E1-P1-2's tolerance) between `arcSweep` and `normalizedSweep`.

### E1-P2-2 — The `.rd` speed-class split burns each stroke in many out-of-order pieces: extra rotary travel and reversals that the ETA does not count

- **Where:** `src/core/controllers/ruida/rd-rotary-feed.ts:41-90`. Each cut goes to its class part, reached by a laser-off move (`:70`). Parts are emitted class by class (`:77`).
- **Anchor:**
  - ADR-127 Amd 5 Consequences: "The burn order changes, but each stroke's place does not". That claim is hardware-gated.
  - The G-code and ETA twin: the ETA follows the G-code route (D2 table row 10), which burns each stroke continuously.
- **Evidence: REPRO** `d2/c5-rd-rotary-travel.mts` (decoded `.rd` against G-code, chuck 40/Ø80):
  - One r = 15 mm circle: flat bed gives 1 part, 0 mm of travel and 2 Y reversals. The rotary gives **30 parts, 1,525.6 mm of laser-off travel (124.9 mm of it in Y) and 60 Y-direction reversals**. The G-code route travels 75 mm.
  - A 41-point zigzag: 4 parts, 431 mm of travel and 75 reversals.
  - `d2/c2-rd-rotary-classes.mts`: 30 classes per circle at the 5 % step; 6 circle layers fall back to 20 % classes (91–109 %, announced); 10 or more circle layers are refused (announced).
  - Outputs: `d2/out/c5-rd-rotary-travel.txt`, `d2/out/c2-rd-rotary-classes.txt`.
- **Scenario:** a name engraved round a glass on a Ruida chuck. Each letter's curves are burned as dozens of separate pieces with the chuck reversing between them.
  - Any rotary backlash or slip shifts later pieces against earlier ones, leaving seams or misaligned stroke joins. GRBL and the old `.rd` burned each stroke in one pass.
  - The job also takes longer than the ETA shows, by the added travel and acceleration.
- **Severity: P2.** The extra travel and reversals are real and measured, and so is the ETA gap. The seam harm is unverified on hardware (no Ruida with a rotary has run it, which ADR-127 Amd 5 states).
- **Announced?** Partly. The ADR says the burn order changes; it does not mention reversals, travel or ETA.
- **Novelty:** new. The Moshi twin (ADR-705 Amd 1, `moshiSurfaceSpeedRuns`) has the same shape.
- **Fix direction:**
  - Within a layer, emit class parts in path order rather than class order, merging consecutive same-class pieces.
  - Or emit the original path order with a speed record per run, once a mid-layer speed command is verified.
  - At minimum, count the `.rd` travel in the Ruida ETA and say in the Rotary Setup note that strokes are burned in pieces.

### E1-P3-1 — A near-straight PS rule between 1e-6 and about 1.4e-6 pt tall still imports nothing

- **Where:** `src/io/postscript/ps-svg.ts:106-107` (`grownAxis` threshold `1e-6` pt) against `:122` (`num` rounds to 1e-6) applied to millimetres (×0.3528).
- **Anchor:** ADR-700 Amd 1: an axis with no size grows.
- **Evidence: REPRO** `a1-ps-zero-extent-edges.mts`: heights 1.1e-6 and 1.3e-6 pt write `height="0mm"` and give "SVG has no drawable geometry". Heights ≤ 1e-6 and ≥ 1.42e-6 import. Output: `out/a1.txt`.
- **Scenario:** practically none; rotation noise is far below 1e-6, as the 90° and ±30° cases show.
- **Severity: P3** (a structural threshold mismatch). **Announced?** No. **Novelty:** new.
- **Fix direction:** compare the rounded millimetre size, for example grow when `num(size × MM_PER_POINT) === '0'`.

### E1-P3-2 — The `.rd` advisory blames a Max-feed hold on the speed classes

- **Where:** `src/io/rd/emit-rd.ts:147-158` (`rotaryDoseAdvisory`).
- **Anchor:** ADR-127 Amd 2 D4 (a held feed raises dose); ADR-127 Amd 5 D3.
- **Evidence: REPRO** `d2/c3-rd-rotary-hold-taper.mts`: on a pen 360/Ø25 (k = 4.58) with Max feed 1500, steep strokes are held at 1500 mm/min. The decoded dose is 97.8–183.3 %, and the only text says "the Ruida file runs each layer as parts at a few surface speeds, so strokes burn between 98 % and 183 %". Output: `d2/out/c3-rd-rotary-hold-taper.txt`.
- **Scenario:** the operator reads a classing artefact and does not lower the layer speed, which is the real remedy for a 183 % over-burn. The range itself is right and is shown before output.
- **Severity: P3** (the warning is present, the cause misnamed). **Novelty:** new.
- **Fix direction:** when `maxDose` comes from `surfaceFeedDoseRise > 1`, use the G-code route's hold wording, which names Max feed and the speed.

### E1-P3-3 — A legitimate near-cap EPS uses about 80 % of the new 5 s limit, so a slower PC refuses it as "may loop forever"

- **Where:** `src/io/postscript/ps-vm.ts` `PS_LIMITS.milliseconds` (5,000) with a fixed step cap of 20,000,000.
- **Anchor:** ADR-700 Amd 2 Consequences: "Ordinary EPS files take milliseconds and are unaffected".
- **Evidence: REPRO** `a3-ps-legit-large.mts`:
  - an explicit-coordinate EPS of 1.9 M `lineto` points (41 MiB) imports, with a VM run of **4,105 ms** and 5.1–5.4 s in all;
  - 1.0 M points take 1.6 s;
  - an AI 8 file of 1.9 M curve points takes 2.2 s of VM time.
  - Output: `out/a3.txt`.
- **Scenario:** a large CAD export on a slower laptop, or while a job streams, is refused with a message calling it a runaway loop. Before #1819 it imported.
- **Severity: P3** (a loud refusal of a narrow file class; no job harm). **Novelty:** new.
- **Fix direction:** keep the step and point caps as the size limits and size the wall clock as a hang guard (for example 20–30 s once the reader is in a worker). Or word the time-limit message differently from the step-budget message.

## KNOWN: status of each C2 item

| C2 item | Status on `66a7a008c` |
|---|---|
| D1-P2-4 | Fixed by #1750 (residual P3 E1-P3-1) |
| D5-P1-1 (SECURITY, redacted) | Fixed for its payloads by #1819; bound escaped, see E1-P1-1 (SECURITY, redacted) |
| D5-P3-4 (security, redacted) | Fixed by #1819 and #1820 (the C2 payloads return in 5–9 ms) |
| D5-P1-2 | Fixed by #1820 (regression E1-P1-2; sibling E1-P2-1) |
| D6-P3-3→P2 | Fixed by #1822 |
| D2-P1-2 | Fixed by #1762 (new E1-P2-2, E1-P3-2) |
| D2-P3-5 | Fixed by #1762 (wording and ADR); the controller's own rotary behaviour is still unverified |

## Refuted (candidates dropped)

- **The notice is wrong for Fill Ramp.** All 1,096 matrix mismatches had Ramp on. A Ramp Fill compiles to a raster group with no vector segments. Ramp needs schema 23 (`layer.ts:91-97`), so no project from 1.0.30 or earlier, the only kind the notice is for, can carry it.
- **The `.rd` UDP route still burns 15.92 %.** D2r's `q2` harness reads only the first speed record. With per-part attribution (D2's `readRd`) both Save `.rd` and UDP run the matched part speeds (`d2/out/r2-ruida-rotary-feed.txt`). Both routes call `emitPreparedRdFile`.
- **The notice ignores object rotation.** Fill hatches are world-space, and the notice matched with the object rotated 30°.
- **Taper evaluated in the wrong X frame on `.rd`.** `.rd` steps are the machine-space job's coordinates, the same frame `surfaceMatchedFeed` uses for G-code. The taper classes are within 97.6–102.5 % of the G-code per-move feed.
- **A ±360 or equal-angle ARC changed.** `0→0`, `360→0`, `0→−360`, `10→370` and `720.5→0.5` give a full circle, and `350→10` gives 20°, as before the fix.
- **The PS time limit is caught by `stopped`.** The time limit throws code `budget`, which `stopped` rethrows (`ps-ops-control.ts` `stopped`).

## Verified clean

- **#1750:** horizontal, vertical, dot, rotated (90°, ±30°), fill-only, scaled (0.001), declared zero-width bbox and huge-stroke rules all import (`out/a1.txt`). A box with both dimensions keeps its viewBox (the square control).
- **#1819:**
  - all C2 payloads and controls behave as listed above;
  - the loop variants from the C2 notes end at 5.2–6.3 s;
  - the time limit reaches the user as an error toast (`postscript-import-action.ts:40-42`);
  - ordinary EPS and AI files up to 1 M points import in 0.35–1.6 s.
- **#1820:**
  - negative, equal, huge (±1e20, 1e308), NaN and Inf angles end at once with one turn or less (`out/b1.txt`);
  - −Z extrusion gives the same lengths;
  - bulge extremes are unchanged (`out/r8.txt`);
  - CIRCLE is untouched.
- **#1822:** 1,120 / 1,120 reachable combinations match the compiled strokes on k < 1 and k > 1.
- **#1762:**
  - flat-bed and rotary-off `.rd` bytes are identical to pre-#1762 `j28-main` (SHA-1 `3fcf222f4123`, `d2/out/c4.txt`);
  - the 100-part limit retries at 10 % and 20 % classes, then refuses with a clear message;
  - k < 1, k > 1, roller, reversed axis and taper doses are within the announced bands;
  - CNC `.rd` stays refused (`cnc-unsupported`, READ).
- **Vitest on `66a7a008c`:** `convert-postscript`, `ai-import`, `dxf-arc-sweep`, `dxf-curve-sampling`, `old-project-rotary-feed`, `rd-rotary-feed` and `RotarySetupHost.ruida-note`: 7 files, 75 passed (`out/vitest.txt`).
- **Regressions elsewhere:** none found in other importers (SVG and PDF were not changed by these PRs), save and load (no format change), or the preview. The ETA is covered by E1-P2-2.

## Not verified

- No hardware. Ruida rotary seams and backlash (E1-P2-2) and whether a Ruida's own rotary function scales Y again (D2-P3-5) are unverified.
- No browser run. The renderer freeze of E1-P1-1 is measured in Node; the window effect comes from READ (synchronous call on the window thread).
- One redacted E1-P1-1 variant was extrapolated from timed finite runs, not run to the end (memory).
- The PDF importer's zero-width strokes (E1-P1-3 sibling): READ only.
- The ELLIPSE behaviour of real exporters, and how often exporters write `s + 360` full circles (E1-P1-2 reach), were not researched (no live services).

## Repro files (in `scratchpad/zz-e1/`)

| File | Finding / check | Output |
|---|---|---|
| `r6-eps-line-import.mts`, `q4-ps-zero-extent.mts` | D1-P2-4 re-run | `out/r6.txt`, `out/q4.txt` |
| `a1-ps-zero-extent-edges.mts` | #1750 edges, E1-P3-1 | `out/a1.txt` |
| `a2-ps-hairline.mts`, `a4-ps-hairline-toasts.mts` | E1-P1-3 | `out/a2.txt`, `out/a4.txt` |
| `a3-ps-legit-large.mts` | E1-P3-3, large legitimate files | `out/a3.txt` |
| `sec/*` (redacted) | D5-P1-1 re-run, E1-P1-1 | `out/sec-*.txt`, `SECURITY-DETAILS.md` |
| `r10-dxf-arc-turns.mts`, `q1-dxf-arc-sweep.mts`, `r8-dxf-bulge.mts` | D5-P1-2 re-run, bulge | `out/r10.txt`, `out/q1.txt`, `out/r8.txt` |
| `b1-dxf-arc-edges.mts`, `b2-dxf-full-turn-noise.mts`, `b3-dxf-e2e-and-ellipse.mts`, `b4-dxf-mixed.mts` | E1-P1-2, E1-P2-1 | `out/b1*.txt` … `out/b4*.txt` |
| `c1-notice-matrix.mts` | D6-P3-3 re-measure | `out/c1.txt` |
| `d2/r2-ruida-rotary-feed.mts`, `d2r/q2-ruida-rotary.mts` | D2-P1-2 re-run | `d2/out/`, `d2r/out/` |
| `d2/c2-rd-rotary-classes.mts`, `d2/c3-rd-rotary-hold-taper.mts`, `d2/c4-rd-flatbed-bytes.mts`, `d2/c5-rd-rotary-travel.mts` | E1-P2-2, E1-P3-2, `.rd` edges | `d2/out/c2…c5*.txt` |

Run with `node --no-experimental-webstorage --import ./register.mjs <file>` (loader pointed at `j33-main`).

```json
{
  "area": "E1",
  "tree": "66a7a008c",
  "fixes": ["#1750", "#1819", "#1820", "#1822", "#1762"],
  "c2_status": [
    {"id": "D1-P2-4", "status": "fixed", "by": "#1750"},
    {"id": "D5-P1-1", "security": true, "status": "fixed for its payloads; bound escaped (E1-P1-1)", "by": "#1819"},
    {"id": "D5-P3-4", "security": true, "status": "fixed", "by": "#1819,#1820"},
    {"id": "D5-P1-2", "status": "fixed; regression E1-P1-2", "by": "#1820"},
    {"id": "D6-P3-3", "status": "fixed", "by": "#1822"},
    {"id": "D2-P1-2", "status": "fixed", "by": "#1762"},
    {"id": "D2-P3-5", "status": "fixed (hardware unverified)", "by": "#1762"}
  ],
  "findings": [
    {"id": "E1-P1-1", "severity": "P1", "security": true, "summary": "SECURITY (redacted): the PostScript work/time bound of ADR-700 Amd 2 can be escaped", "evidence": "REPRO", "known": false},
    {"id": "E1-P1-2", "severity": "P1", "file": "src/io/dxf/dxf-entities.ts", "line": 107, "summary": "Full-circle ARC written as start+360 one ulp past 360 imports as a near-zero arc (152.2->512.2 burns 0 mm, pre-fix 125.6 mm); 11.6% of 0.1-degree starts; regression from #1820", "evidence": "REPRO", "known": false},
    {"id": "E1-P1-3", "severity": "P1", "file": "src/io/postscript/ps-svg.ts", "line": 48, "summary": "PS/AI zero-width hairlines written as stroke-width 0 and dropped by the SVG import; silent when other strokes exist", "evidence": "REPRO", "known": false},
    {"id": "E1-P2-1", "severity": "P2", "file": "src/io/dxf/dxf-curve-sampling.ts", "line": 85, "summary": "ELLIPSE parameters past one turn clamp to a full ellipse, inconsistent with the fixed ARC", "evidence": "REPRO", "known": false},
    {"id": "E1-P2-2", "severity": "P2", "file": "src/core/controllers/ruida/rd-rotary-feed.ts", "line": 41, "summary": ".rd speed-class split: 30 parts, 1.5 m travel and 60 rotary reversals per 30 mm circle; ETA misses the travel; seams unverified", "evidence": "REPRO", "known": false},
    {"id": "E1-P3-1", "severity": "P3", "file": "src/io/postscript/ps-svg.ts", "line": 107, "summary": "grownAxis threshold vs num() rounding: 1.1e-6..1.4e-6 pt rules still import nothing", "evidence": "REPRO", "known": false},
    {"id": "E1-P3-2", "severity": "P3", "file": "src/io/rd/emit-rd.ts", "line": 147, "summary": ".rd advisory attributes a Max-feed hold (183% dose) to speed classes", "evidence": "REPRO", "known": false},
    {"id": "E1-P3-3", "severity": "P3", "file": "src/io/postscript/ps-vm.ts", "line": 29, "summary": "Legit 1.9M-point EPS uses 4.1 s of the 5 s limit; slower PCs refuse it as 'may loop forever'", "evidence": "REPRO", "known": false}
  ]
}
```

Auditor counts: raised 8, P1 3, P2 2, P3 3, known 0

## Refuter (2026-11-12)

**Tree and harness.** origin/main @ `66a7a008c` (`scratchpad/j33-main`, read only); pre-fix comparisons on `j31-main` (`420c5f547`). Own repros in `scratchpad/zz-e1r/`, loader copied from `zz-e1`, run with `node --no-experimental-webstorage --import ./register.mjs <file>` under a per-case `timeout`. The auditor's scripts were read for API shape only. Methods differ from the auditor's on purpose:
- DXF: path length of the parsed object, not G-code;
- `.rd`: the encoder's own motion plan (`encodeRdJob(...).motion`) instead of decoded bytes, and both routes timed on the app's clock;
- PostScript hairlines: the app's `importPostscriptFile` under jsdom;
- PDF: real `pdfjs-dist` (legacy build in Node) → `pdfVectorPage` → `parseSvg`;
- security: own payloads written from the notes, one case per process.

No Vitest or browser run (free memory was 2.0–2.6 GB, and none was needed).

### Verdicts

| ID | Verdict | Evidence |
|---|---|---|
| E1-P1-1 (SECURITY, redacted) | **CONFIRMED P1, wider than reported** | REPRO. The import runs on the window thread (READ: `postscript-import-action.ts:39` calls `convertPostscript` synchronously; the caller is `import-vector-dispatch.ts:26`; only the SVG step goes to the worker). It really lasts minutes. One case did not return within 150 s. A second, new construct hit the limit only after 109 s (104 s late). Two finite variants ran 44 s and 67 s with the 5 s limit never firing. The auditor missed further bounds: other operator classes escape the time limit, and there is a memory path to a renderer crash (extrapolated, not run). Details only in `zz-e1r/SECURITY-DETAILS.md`. |
| E1-P1-2 | **CONFIRMED P1** | REPRO `r1-dxf-full-turn.mts`. `152.2 → 512.2` gives 0.00 mm (2 points) on main and 125.57 mm on pre-fix: the pre-fix output really is a full circle. `0 → 360.00000000000006` gives 0 on main and a full circle pre-fix. `0 → 720.0000000000001` gives 0 on main (pre-fix: two turns). A LINE plus that ARC imports `ok` with no notes. Ends written as `(start + 360).toFixed(d)` collapse for 11.6 % of 0.1° starts, 10.4 % of 0.01° starts and 10.9 % of 0.001° starts, but for none at whole or half degrees. No pre-fix collapse was found in any sampled case. **Reach (repo only):** nothing in the repo shows an exporter writing a full circle as ARC `s → s + 360`. KerfDesk's own DXF writer emits bulges, not ARC (ADR-452). There is no ARC fixture. C2 D5 and LEDGER say "which exporters write such angles is unverified offline". The auditor's ezdxf `arc_angle_span_deg` anchor appears nowhere in the repo, so it is unverified here. The in-repo anchors are the `arcSweep` doc comment ("equal angles mean a full circle"; whole turns are "the same arc") and the pre-fix behaviour. METHOD §3 has no reach clause: the input is reachable today and the output is silently wrong, so it stays P1. Credit to #1820: `s → s − 360` with decimal noise collapsed for 108 / 3,600 starts pre-fix and for 0 now. |
| E1-P1-3 | **CONFIRMED P1** (scenario wording corrected) | REPRO `r2-ps-hairline.mts`. Each of these imports with a `[success]` toast, no note, and only the detail (35.28 × 17.64 mm, 28.22 mm, or a 35.28 mm line) where the 98.78 mm outline should be: a `0 setlinewidth` 99 mm outline plus a **fill-only** engrave rectangle; the same outline plus a 0.5 pt circle; AI 8 `0 w … s` plus `1 w`; and a non-zero width that rounds to `0` (0.001 under a 0.0001 scale). Hairline-only gives "has no drawable content". The 0.01 control imports both. **Reach:** no repo fixture uses a zero width (`compatible.ai` and `illustrator-3.ai` use `1 w`; the `__golden__` EPS files use `0.1 setlinewidth`), and no repo comment says zero width is common. So the report's "the usual way to mark laser cut lines" is unsupported here and should read "a hairline cut line". Reach cannot lower a reachable, silent wrong output (METHOD §3), so it stays P1. The PDF sibling is real: see E1-P1-4. |
| E1-P2-1 | **CONFIRMED P2** (not P1, not P3) | REPRO `r3-dxf-ellipse.mts` (a = 20, b = 10). `0 → 2π + π/2` gives a closed 96.81 mm ellipse where the quarter is 24.20 mm; `3π → 3π + π/2` gives the quarter. Main and pre-fix are identical, so it is not a regression. Not P1: the only in-repo reading of ELLIPSE parameters past 2π is the clamp itself (C2 D5 line 87 and LEDGER D5-P1-2: "reduce … as the ELLIPSE path does"), so wrong output is contested, not shown. Not P3: it is reachable and contradicts #1820's rule in the same file. The ELLIPSE clamp is also right on E1-P1-2's float noise: 0 of 3,600 `s → s + 2π` cases fail. That supports sharing a tolerance rather than copying the ARC code. |
| E1-P2-2 | **CONFIRMED P2**; reversal count right; ETA gap quantified | REPRO `r4-rd-split-eta.mts` (encoder motion plan, chuck 40/Ø80). An r = 15 circle of 180 sides gives **30 parts, 1,526 mm of laser-off travel (125 mm in Y), and 60 Y reversals** (flat bed: 1 part, 2 reversals). The 36-side circle gives 9 parts and 18 reversals; 8 letter-size rings give 12 parts and **192 reversals** (16 flat). **ETA gap**, with both routes on the app's clock (`estimateJobDuration` over the machine-space job, against `buildProgramDuration` over the `.rd` moves with each part's speed): circle **11.0 s shown vs 43.6 s (+32.6 s, 4.0×)**; the same at 6,000 mm/min **2.5 s vs 39.3 s (+36.8 s, 16×)**; 8 rings 15.7 s vs 74.4 s (+58.7 s); k > 1 roller (pen 360/Ø25) 11.3 s vs 80.8 s. Caveat: travel is timed with the profile's G0 limits; a Ruida travels at its panel idle speed, so the real gap depends on that speed. Also (`r6-rd-passes.mts`): passes stay inside each class part, so every pass of one speed class burns before the next class starts. Seams are still hardware-unverified, so it stays P2. |
| E1-P3-1 | **CONFIRMED P3** | REPRO `r7-ps-p3s.mts thin`: 1.05e-6, 1.2e-6 and 1.4e-6 pt write `height="0mm"` and import nothing; 1e-6 and 1.42e-6 import 28.22 mm. |
| E1-P3-2 | **CONFIRMED P3** | REPRO `r5-notice-and-rd-edges.mts`. Pen 360/Ø25, Max feed 1500, layer 1200: the only `.rd` advisory reads "…runs each layer as parts at a few surface speeds, so strokes burn between 98 % and 367 %…". READ: the Max-feed hold wording (`rotary-surface-speed-warnings.ts`) is reached only from Job Review. `detectMachineJobWarnings`, which every `.rd` route adds (`rd-job-warnings.ts`), has no rotary check. The number is right and shown before output, so it stays P3. |
| E1-P3-3 | **CONFIRMED P3** | REPRO `r7-ps-p3s.mts big`. A 1.9 M-point explicit-coordinate EPS (43 MiB) imports. Its VM run, timed to the last clock read, took **3,059–3,631 ms (61–73 % of the 5 s limit)**; the whole call took 4.7–5.8 s on this (loaded) PC. 1.0 M points took 2.7 s in total. A PC about 1.4–1.6× slower refuses it as "may loop forever". |

### Challenges to "Verified clean"

- **#1822 (notice): not clean outside imported artwork.** The 1,120-case matrix used only `imported-svg` objects on Fill layers. `outlineAngles` assumes "round the part" for every other object kind (`old-project-rotary-feed.ts:98-99`, stated only in a code comment). A pen-tool horizontal line on a Line layer gets the notice **6.28×**, but its compiled feed is unchanged (1.00×). A pen-tool 45° line also gets 6.28×, against 1.40× compiled. That is D6-P3-3→P2's exact symptom, so it is raised as E1-P2-3. Imported horizontal (no notice, 1.00×) and vertical (6.28× against 6.32×) lines match. Image layers are skipped correctly: raster groups are not feed-matched (`grbl-strategy.ts` `emitRasterGroupHere`). Taper cannot reach the notice, because it starts at schema 22 (`migrations.ts:69`).
- **#1762 (`.rd`): clean on bytes and doses, not on route and time.**
  - Passes do not multiply parts. 1, 2, 4 and 7 passes all give 30 parts, with doses of 97.6–102.3 % and no advisory. So the 100-part retry is reached by layers, not by passes.
  - Clean as reported: flat-bed and rotary-off moves (1 part, 0 travel), and dose bands.
  - The ETA and the reversals are covered in E1-P2-2.
- **#1820:** clean in every direction except E1-P1-2. The `s → s − 360` noise case is now fixed (see the E1-P1-2 row).
- **#1819:** not clean. E1-P1-1 has more escape routes than the auditor listed (redacted).
- **#1750:** clean, apart from E1-P3-1.

### New findings

#### E1-P1-4 — PDF (and PDF-compatible AI) zero-width strokes are dropped from "Editable paths" without a note

- **Where:** `src/io/pdf/pdf-vector-page.ts:117-118` stores `setLineWidth` as given, and `:154-156` writes `stroke-width="0"`. `src/io/svg/svg-presentation.ts:198-204` and `parse-svg.ts:269` then treat the stroke as unpainted.
- **Anchor:**
  - PDF, like PostScript, defines line width 0 as the thinnest line the device can draw.
  - The page note promises "Strokes become cutting centrelines" (`pdf-artwork-source.ts:101`).
  - It is the E1-P1-3 twin, which the auditor read but did not drive.
- **Evidence: REPRO** `r2-ps-hairline.mts` (real `pdfjs-dist` 6.3 legacy `getOperatorList` → `pdfVectorPage` → `parseSvg`):
  - a `0 w` 99 mm outline plus a `1 w` line gives widths `["0","1"]` and imports only the 35.28 mm line, with no notes;
  - the same outline plus a filled rectangle imports only the 35.28 × 17.64 mm rectangle;
  - the `0.01 w` control imports both (98.78 mm).
- **Scenario:** a PDF exported with hairline cut lines is opened, and the user picks "Editable paths". The dialog thumbnail, rendered by pdf.js, shows the outline. The canvas and the job lack it, and the import reports success. The part is engraved but never cut out.
- **Severity: P1** (METHOD §3, as E1-P1-3: a silent wrong output; the thumbnail is a visible result, not a warning). **Announced?** No. **Novelty:** new as a finding; the auditor named it as a READ sibling. It is not caused by the verified fixes.
- **Fix direction:** one shared rule, used by both `ps-svg.ts` and `pdf-vector-page.ts`: write a zero or sub-rounding stroke width as a positive hairline. Add a PDF test with `0 w` plus a stroked path.

#### E1-P2-3 — The old-project rotary notice still gives the worst case for Line strokes on non-imported objects (D6-P3-3→P2 symptom, outside #1822's fix)

- **Where:** `src/io/project/old-project-rotary-feed.ts:98-99` (`outlineAngles` returns `[ROUND_THE_PART]` for any object that is not `imported-svg`), used for Line and offset-Fill operations (`strokeAngles`, `:88-97`).
- **Anchor:**
  - ADR-127 Amd 4 and Amd 6: "only strokes whose dose really changes count", and "the notice names the largest real change, read from the file's own geometry".
  - C2 D6-P3-3→P2 was raised for this mismatch (notice 6.28× against 1.40× real).
- **Evidence: REPRO** `r5-notice-and-rd-edges.mts` (chuck 40/Ø80, Line 600 mm/min; compiled = largest old-feed / new-feed ratio over lit G-code moves):

  | Object | Notice | Compiled |
  |---|---|---|
  | pen-tool (`shape`/polyline) horizontal line | 6.28× | 1.00× |
  | pen-tool 45° line | 6.28× | 1.40× |
  | imported horizontal line | none | 1.00× |
  | imported vertical line | 6.28× | 6.32× |

- **Scenario:** an upgraded rotary project whose strokes are pen-tool, text-free shape or polyline objects is told its strokes now burn up to 6.28× the energy. The operator cuts power by up to 6× and under-burns strokes that did not change.
- **Severity: P2.** It is the same class and rating as D6-P3-3→P2: a misleading notice, with no direct output change.
- **Announced?** Only in a code comment. **Novelty:** new. #1822 fixed Fill hatch angles only; the auditor's matrix had no Line layer and no non-imported object.
- **Fix direction:** read the outline angles from every object kind's own `paths` (shapes, polylines and text all carry them), as for `imported-svg`. Assume the worst case only for objects with no paths. Add Line-layer cases for a pen-tool horizontal line and a 45° line.

### Not verified

- No hardware.
  - Ruida rotary seams, backlash and the real idle speed (E1-P2-2's time gap uses the profile's G0 limits).
  - Whether a Ruida's own rotary function scales Y again.
- No browser run.
  - The E1-P1-1 window freeze is measured in Node; the window-thread claim is READ.
  - The PDF route ran pdf.js's legacy build in Node, not the app's PDF worker. The operator list is the same API.
- E1-P1-1's memory variant is extrapolated from a small count (memory gate). One loop variant is extrapolated from per-call cost.
- Real exporters' ARC full-circle and ELLIPSE-parameter habits, and how often PDF/EPS hairlines use width 0. Nothing in the repo shows this, and nothing was downloaded.

### Repro files (in `scratchpad/zz-e1r/`)

| File | Checks | Output |
|---|---|---|
| `r1-dxf-full-turn.mts` | E1-P1-2, `s − 360` noise, reach sweep | `out/r1.txt` |
| `r2-ps-hairline.mts` | E1-P1-3, E1-P1-4 (PDF via pdf.js) | `out/r2.txt` |
| `r3-dxf-ellipse.mts` | E1-P2-1 | `out/r3.txt` |
| `r4-rd-split-eta.mts` | E1-P2-2 reversals, travel, ETA gap | `out/r4.txt` |
| `r5-notice-and-rd-edges.mts` | E1-P2-3, E1-P3-2, `.rd` passes | `out/r5.txt` |
| `r6-rd-passes.mts` | `.rd` passes vs parts | `out/r6.txt` |
| `r7-ps-p3s.mts` | E1-P3-1 (`thin`), E1-P3-3 (`big <n>`) | `out/r7-thin.txt`, `out/r7-big.txt` |
| redacted | E1-P1-1 | `SECURITY-DETAILS.md` |

```json
{
  "area": "E1",
  "role": "refuter",
  "tree": "66a7a008c",
  "verdicts": [
    {"id": "E1-P1-1", "security": true, "verdict": "CONFIRMED", "severity": "P1", "note": "window thread (READ); >150 s no return, limit 104 s late on a new construct; further escape classes and a memory path (redacted)"},
    {"id": "E1-P1-2", "verdict": "CONFIRMED", "severity": "P1", "note": "152.2->512.2 0 mm vs pre-fix 125.57 mm; 11.6/10.4/10.9 % of 0.1/0.01/0.001-degree starts, 0 % at whole/half degrees; reach unverified in repo, no reach clause"},
    {"id": "E1-P1-3", "verdict": "CONFIRMED", "severity": "P1", "note": "silent with fill-only or stroked detail and with sub-rounding widths; 'usual way' wording unsupported in repo"},
    {"id": "E1-P2-1", "verdict": "CONFIRMED", "severity": "P2", "note": "unchanged pre/post; in-repo reading of ELLIPSE > 2pi is the clamp"},
    {"id": "E1-P2-2", "verdict": "CONFIRMED", "severity": "P2", "note": "30 parts, 60 reversals confirmed from motion plan; ETA 11.0 s shown vs 43.6 s (+32.6 s); 2.5 vs 39.3 s at 6000 mm/min"},
    {"id": "E1-P3-1", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "E1-P3-2", "verdict": "CONFIRMED", "severity": "P3", "note": "98-367 % attributed to classes; hold wording only in Job Review"},
    {"id": "E1-P3-3", "verdict": "CONFIRMED", "severity": "P3", "note": "VM 3.1-3.6 s of 5 s (61-73 %)"}
  ],
  "new_findings": [
    {"id": "E1-P1-4", "severity": "P1", "file": "src/io/pdf/pdf-vector-page.ts", "line": 156, "summary": "PDF zero-width strokes written as stroke-width 0 and dropped from Editable paths without a note (real pdf.js operator list)", "evidence": "REPRO", "known": false},
    {"id": "E1-P2-3", "severity": "P2", "file": "src/io/project/old-project-rotary-feed.ts", "line": 99, "summary": "Old-project rotary notice gives the worst case (6.28x) for Line strokes on non-imported objects; pen-tool horizontal line compiles 1.00x, 45-degree line 1.40x", "evidence": "REPRO", "known": false}
  ],
  "refuted": []
}
```

Refuter counts: raised 10, refuted 0, P1 4, P2 3, P3 3, known 0
