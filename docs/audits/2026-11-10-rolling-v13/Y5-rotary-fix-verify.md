# Rolling audit v13 — Y5 Rotary fix verification: can a round glass burn right while it turns?

- **When:** 2026-11-10, 12:20–13:40 +0800   **Tree:** origin/main @ `8493f590c`. Repros ran on the scratchpad export `j22-main` (`8493f590c`, `node_modules` a junction) and on a mutable copy of it, `zz-y5\tree` (its own `node_modules` junction, to be removed with `cmd /c rmdir` only). The 1.0.30 comparison ran the 1.0.30 source itself (`j18-main`, `ffd9fe66b`).
- **Requested by** the maintainer on 2026-11-09: "make sure our function to laser a rotary item is also fully build? I need to be able to put in a round glass or whatever and burn perfect burn while it rotates". Rolling v12 X8 found the gaps; this area checks the fixes.
- **Scope:** the v12 X8 fix PRs and what they touch.
  - #1670 (taper warp, ADR-694, project schema 22), #1671 (A/Z axis and presets, ADR-695), #1672 (surface feed, ADR-127 Amd 2, and the X8 P3s), #1673 + #1674 (row-step check, ADR-315 Amd 1), #1677 (main-red fix and the taper factor in the feed), #1686 (rotary camera advice follows the axis, ADR-228 Amd 3).
  - Code read: `src/core/devices/{rotary,rotary-axis,rotary-presets}.ts`, `src/core/job/{rotary-job,rotary-transform,rotary-taper-warp,rotary-taper-profile}.ts`, `src/core/output/{rotary-surface-feed,rotary-axis-output}.ts`, `src/io/gcode/rotary-axis-emit.ts`, `src/core/raster/emit-raster.ts`, `src/core/job/compile-job-raster.ts`, `src/ui/laser/job-review/{rotary-row-step-warnings,rotary-surface-speed-warnings}.ts`, `src/ui/laser/{rotary-axis-start-warnings,rotary-summary,rotary-wrap-preview,unrestored-abort-origin,abort-alarm-recovery,start-job-resume-stream,laser-resume-program,RotaryYTurnJogControls,RotaryTurnJogControls}.ts(x)`, `src/ui/state/{rotary-axis-frame,canvas-frame-perimeter,laser-jog-warnings}.ts`, `src/core/controllers/grbl/{resume-program,laser-resume-reentry}.ts`, `src/io/machine-profile/{machine-profile-io,machine-profile-rotary-version}.ts`, `src/ui/laser/start-job-readiness-policy.ts`.
- **Lenses run:**
  - **L10 fix verification:** every X8 finding re-measured against its original number.
  - **L12 untested merges:** CI of each fix PR and of main after each merge; which cross-PR interactions have a test.
  - **L3 twins:** emitted program against the wrap preview, Frame bounds, the canvas Frame outline, the ETA, Job Review and the inspector.
  - **L4 adversarial:** pens, bowls, geared and untouched rollers, tapers with rollers, Max-feed clamp, Abort and re-run, Start from line, 1.0.29 and 1.0.30 files.
- **Method:**
  - **Own physical model** (`lib.mts`), written from the hardware, not from `rotary.ts`. A chuck turns the part 2π per motion-per-turn units. A roller turns it π·D_roller per turn at the contact radius (the wide end on a taper). A cone's radius is linear along the side. A controller times `F` over the commanded XYZA vector, degrees counted as millimetres on A.
  - **Own G-code reader:** absolute/relative, G0/G1, per-axis G92, F, S, M3/M4/M5.
  - **Own step model:** `lround(units × steps/unit)`, as GRBL's planner does.
  - **Real code paths:** `emitGcode`; `prepareStartJob` with a real `machineSnapshot` and the camera placement latch on; the stress harness's real store, Frame, Job Review, Start and GRBL simulator (grblHAL four-axis with `fourthAxisA`, and stock GRBL); `buildLaserResumeProgram`; `deserializeProject` / `serializeProject`; the `.lfmachine` reader and writer.
  - No browser (see Not verified). No hardware, no camera, no network.
- **Memory gates:**
  - Vitest ran once at 3.55 GB free (`y5-abort-rerun.simulator.test.tsx`, one worker).
  - Several Vitest attempts found 0.25–1.15 GB free, below the gate, and were not started (other sessions' processes held the memory); the abort test ran later at 3.55 GB.
  - The repo's own rotary and taper suite (41 files) was **not run locally**. One launch above the gate was given an empty file list by a script error, began the whole suite, and was stopped by me before any rotary result. Every later attempt found 0.5–1.15 GB free. Main's CI at `8493f590c` (all unit shards green) stands in for it.
  - Node scripts ran at 0.25–3.7 GB free. The gates apply to Vitest and browsers only.
- **Counts:** 6 raised → refuter pending → P1 3 / P2 1 / P3 2 (+ 10 KNOWN re-checked).

## Headline

**Not yet. Today the maintainer can put in a round glass and get a perfect vector burn and an even photo, but only on a first run that is not stopped and with the right photo interval. Three routes still spoil the glass without warning.**

**The X8 fixes hold, measured.** On GRBL (Y port), Marlin (Y port), the Falcon A1 Pro, grblHAL and FluidNC (A axis):
- **Geometry:** a full wrap is exactly 360.000°; the seam gap is 0.000 mm and a 20 mm square is 19.999–20.000 mm.
- **Speed and dose:** every unclamped stroke runs within 0.84 % of the layer speed on the surface, along, round and diagonal. This held on seven Y setups (Ø80 glass, Ø10 pen, Ø150 bowl, stock, geared and untouched rollers) and three A setups. X8 measured 15.9 % to 458 %.
- **Max feed:** the clamp holds, and it warns when the Y scale is above 1.
- **Taper:** on an Ø80→Ø70 tumbler a 20 mm square burns 20.00 mm at both ends, one turn is exactly 360° at every height, and the rim and base get the same dose (100–100.2 %).
- **A axis:** A1 Pro owners are offered only the A preset. The program carries `G92 A0`, X and A words and no Y. Start and Frame refuse a controller that reports no A.
- **Returning users:** 18 of 18 projects saved by 1.0.29 and 1.0.30 keep their geometry and image bytes on main; only the intended F words change.
- **Camera advice:** the advice now follows the rotary's axis.

**What still spoils the glass:**
- **Abort and re-run on an A rotary (Y5-P1-1).** The re-run starts from wherever the Abort left the part's turn. It burns 84.0 mm round the glass from the half-burned first run (a 160° stop on an Ø60). Nothing warns. The Y-port control lands 0.00 mm off.
- **Start from line on an A rotary (Y5-P1-2).** The re-entry puts the head back in X but not the part's turn. The first resumed stroke burns a 60.0 mm streak across the glass.
- **The photo-interval advice (Y5-P1-3).** Following the row-step warning's first suggestion (12.73 lines/mm on the Creality chuck) burns 136 of 382 rows of a 30 mm photo twice. After that change the warning goes silent. The second suggestion (6.37 lines/mm) is even.

Smaller:
- **Taper and Max feed (Y5-P2-1).** On a taper the Max-feed clamp can bite without its promised warning: the base of the cup burns 108–111 % on a geared roller.
- **Wording (Y5-P3-1, Y5-P3-2).** The surface-speed warning speaks of "Y feed" on an A rotary. The A1 Pro preset's step arithmetic is off by 4 steps.

**Answer for the maintainer:**
- **Safe today:**
  - On the Falcon A1 Pro with the A preset and a confirmed Test rotation, a straight or tapered glass burns true for text, outlines and fills.
  - Photos are safe at the warning's 2-step interval, or at 12.75 lines/mm on the A1 Pro.
- **Not safe yet:**
  - Never re-run or Start from line after an Abort on A until Y5-P1-1 and Y5-P1-2 are fixed.
  - On a Y-port chuck, do not use the warning's first (1-step) interval.

## X8 fix verification

| X8 finding | Fix | Original number (X8 + refuter, `ffd9fe66b`) | Now (`8493f590c`) | Verdict |
|---|---|---|---|---|
| **X8-P1-1** surface feed | #1672, #1677 | Strokes round the part got 15.9 % of the dose on an Ø80 chuck. Ø150 bowl 8.5 %, Ø10 pen 127 %, stock roller 50.9 %, geared roller 184 %, untouched new roller 458 %. Fill 90° 16 %, 45° 72 %. No warning | All of those setups on GRBL and Marlin (Y), and an Ø10/Ø80/Ø150 chuck on the A1 Pro, grblHAL and FluidNC (A): strokes along, round and diagonal at **99.16–100.64 %**. The worst unclamped stroke over 0.05 mm is 0.84 % off. Clamp: once `k × speed` passes Max feed, round strokes run at 127–1146 % and Job Review warns with the safe speed (`v1-feed.txt`) | **FIXED** (Y5-P3-1: wording on A) |
| X8-P1-1 on a taper | #1677 | (Not measured in X8.) Without the factor, the base ran at 87 % (ADR-127 Amd 2) | Ø80→Ø70 cone, 90° fill: rim 100–100.21 %, base 100–100.19 % (chuck); rollers 100–100.06 %; A1 Pro 100–100.02 %. With the taper off: base 110–114 % (`v2-taper.txt`) | **FIXED**; the clamp case is Y5-P2-1 |
| **X8-P2-1** A/Z axis (P1 per refuter) | #1671 | The A1 Pro was offered the Y-port preset. The program had X and Y words only, and the gantry moved 7.958 mm with the beam on. No warning | A1 Pro: offered only `creality-rotary-kit-pro-chuck-a1-pro` (A, 360°); a new rotary starts on A. Programs on the A1 Pro, grblHAL and FluidNC: `G92 A0` first, words **AX**, 0 Y words, a full wrap is A 0→360, and the job ends at turn 0. GRBL Z: `G92 Z0`, words XZ. A on GRBL or Marlin: refused (`rotary-axis-unexecutable`). Start and Frame refuse 3 reported axes or `AXS:XYZ`. Y left on the A1 Pro gets a Job Review warning. An unconfirmed A gets a Test-rotation warning (`v3-axis.txt`) | **FIXED**, except after an Abort: Y5-P1-1, Y5-P1-2 |
| **X8-P2-2** taper warp (P3 per refuter) | #1670 | Ø80→Ø70, Ø80 entered: base square 17.75 mm (−11.3 %) | Taper on: squares 19.998–20.006 mm at both ends, for Absolute and Current Position, chuck, rollers and A. One turn is 360.000° at Ø80, 77.5, 75, 72.5 and 70.1 (359.999° on the surface-calibrated roller). Taper off: 17.62–19.88 mm. The preview's turns are 251.327 / 219.911 / 221.482 mm = π·Ø. Frame bounds equal the burn bounds plus the fill runways, and the canvas outline is their exact inverse (`v2-taper.txt`) | **FIXED** |
| **X8-P2-3** row-step check | #1673, #1674 | Ø80, `$101`=80: rows 0.0785/0.157 mm; Ø150: 31 % of rows burned twice; no warning | The warning fires at `$101` = 80, 100 and 160 on Ø80 and Ø150, and at `$103` = 8.9 on A; it names the step, the effect and two intervals. The steps-unknown warning appears when no `$$` was read. Flat bed: none. **But the first suggested interval re-creates doubled rows, and the warning then stays silent** (`v6-rowstep.txt`, `v6b-advice.txt`) | **PARTIAL**: Y5-P1-3 |
| X8-P3-1 over-one-turn wording | #1672 | "spans 42.972 mm in Y … (40.000 mm)" | "The artwork wraps 270.0 mm round the part (1.07 turns), more than one turn of the Ø80 mm object (251.3 mm)"; the Ø10 pen and A give the same form | **FIXED** |
| X8-P3-2 Abort offer wording | #1672 | "The head is 12.3 mm from it (Y +12.3 mm)" | "the part has turned +111° since (+12.3 machine mm of Y)"; rollers add the slip note | **FIXED** (Y only; on A see Y5-P1-1) |
| X8-P3-3 presets | #1671 | One preset | Creality Y-port, Creality A1 Pro (A), xTool RA2 Pro chuck and roller; the Ortur, Sculpfun, Atomstack and LaserPecker gaps are named in the source | **FIXED** (Y5-P3-2: A1 Pro arithmetic) |
| X8-P3-4 jog in degrees | #1672, #1671 | Y jog in machine mm only | Y port: "Turn the part" 1–180°, 90° = 10.000 mm on the 40 mm chuck, sign flipped by Reverse. A/Z: own turn buttons, `$J=G91 G21 A15.000 F1500`; Y arrows move the head; jog bounds keep the bed's Y on A/Z | **FIXED** |

## Journey matrix

Ø80 glass (circumference 251.327 mm). The design: text-like outlines (T, O, M and a 20 mm square), a 30 × 15 mm fill at 45°, a 6 mm × one-turn band, and a 20 × 20 mm grayscale photo. It ran through `prepareStartJob` with the camera placement latch on (`v4-journey.txt`). Abort, re-run and Start from line ran in the store and simulator harness (`out/abort-rerun-{A,Y}.json`).

| Step | GRBL 1.1, Y-port Creality chuck 40/turn | Falcon A1 Pro, A chuck 360° | Marlin, Y-port chuck 40/turn |
|---|---|---|---|
| Set up the rotary | Y preset offered; Job Review fact "Y ×0.16 … each move's feed holds the layer speed on the part" | Only the A preset offered; a new rotary starts on A; an unconfirmed A warns | Y only (A refused) |
| Camera advice (#1686) | Absolute: "jog the head over the artwork … then choose Current Position"; Current Position: says it moves X too | Absolute: no warning; Current Position: "Choose Absolute Coordinates" | As GRBL |
| Frame vs burn | Turn 0..40 = burn; X adds the 5 mm runway | Turn 0..360 = burn | Same as GRBL |
| Wrap error / seam | 360.0000°, seam 0.000 mm | 360.0000°, 0.000 mm | 360.0000°, 0.000 mm |
| Aspect (20 mm square) | 19.999 mm round (1.0000) | 20.000 mm (1.0000) | 19.999 mm |
| Line and fill dose | Surface speed 1,495–1,500 and 2,987–3,000 mm/min (≤ 0.43 % off) | 1,499–1,500 and 2,998–3,000 | As GRBL |
| Photo @10 lines/mm | Rows 0.0785 mm ×145 and 0.157 ×54 (banding, warned) | 0.0784 ×145 and 0.157 ×54 (warned) | As GRBL |
| Photo at the advice | 6.37 (2 steps): 0.1571 ×125, one 0.2356 at the edge. 12.73 (1 step): **doubled rows, silent**, Y5-P1-3 | 12.75 (1 step): 0.0784 ×254, even | As GRBL |
| Abort mid-job, re-run from the restored origin | Same turn: shift **0.00 mm** | Re-run **84.00 mm** round the part (stop at 160.4°, Ø60), no warning: **Y5-P1-1** | Not run (simulator harness is GRBL-family only); same Y-port code path |
| Start from line after Abort | First resumed burn exact (0.00 mm) | First resumed burn lit from the stop turn, a **60.0 mm** streak: **Y5-P1-2** | Not run |
| Save → reopen → same bytes | yes | yes | yes |

## Findings

### Y5-P1-1 — On an A or Z rotary, a re-run after Abort starts from the turn the Abort left: the whole re-run lands round the part by that turn, 84.0 mm on an Ø60 glass, with no warning

- **Where (8493f590c):**
  - `src/io/gcode/rotary-axis-emit.ts:37` puts `G92 A0` (or `Z0`) before every job. `src/ui/state/rotary-axis-frame.ts:67` does the same before every Frame. `src/core/output/rotary-axis-output.ts:8-18` explains it: "Nothing reports where a dedicated rotary stands".
  - `src/ui/laser/abort-alarm-recovery.ts:47-53` (`restoreAbortOriginFromIdle`) restores the saved X/Y origin only.
  - `src/ui/laser/unrestored-abort-origin.ts:165-172` (`activeAbortOriginRotary`) returns null on A/Z ("machine Y is the head again; the turn is not in Y"), so the Frame offer says nothing about the turn.
  - The controller does report A: the status MPos carries a fourth value (`src/core/controllers/grbl/status-parser.ts:337`, `reportedAxisCount`), and the simulator reports it too.
- **Anchor:**
  - **Contract:** ADR-341 Amendments 11–13. ABORT JOB keeps the origin the job ran from, and Restore (or the Frame offer) puts it back so the re-run lands on the half-burned piece.
  - **Contract:** ADR-127 Amendment 1. On a Y-port rotary, machine Y counts the turn, so the restore also puts back the angle. X8-P3-2's fix says so.
  - **Twin:** the Y-port control.
- **Scenario:** the A1 Pro with the A preset. A name burns round a glass, and the operator presses ABORT JOB part way (smoke, a wrong power). The part stops 160° on from where the job began.
  - The operator presses Restore saved origin on the Abort card, then Frame and Start. The Frame and the job both send `G92 A0` at the stopped turn.
  - Every line of the re-run burns 160° (84.0 mm on Ø60, 112 mm on Ø80) round the glass from the half-burned first run. The glass carries two offset copies.
  - Nothing says the part must be turned back.
- **Evidence:** REPRO in Vitest with the real store, Frame, Job Review, Start and the GRBL simulator: `zz-y5\tree\src\zz-y5\y5-abort-rerun.simulator.test.tsx` → `zz-y5\out\abort-rerun-A.json` and `abort-rerun-Y.json` (log `vt-abort-rerun.txt`). The burns are mapped to machine units by the test's own tracker.

  | | Turn at stop | `G92` turn of run 1 → run 2 | Same stripe, run 2 − run 1 | Warnings shown |
  |---|---|---|---|---|
  | grblHAL four-axis, A chuck 360°, Ø60 | 160.428° | 0 → **160.428** | **+84.00 mm** (min = max) | Job Review: 3 generic warnings, none about the turn. No confirm, no alert |
  | Stock GRBL, Y-port chuck 40/turn (control) | Y 47.825 | — | **0.00 mm** | none about the turn |

- **Severity:** P1.
  - **For:** METHOD §3, wrong physical output that harms a job. The second burn misses the half-burned first one by the whole stopped turn. The brief rates a glass that cannot get a perfect burn without a warning as P1. The Y-port route gets this right. The A route is the one the maintainer's A1 Pro uses.
  - **Against:**
    - ADR-695 D5 chose "zero at the current turn" deliberately, so a careful operator could turn the part back by hand.
    - The Frame traces from the current turn. But the Frame is not a warning (METHOD §3), and it cannot show the turn offset against the burned work.
    - Whether a real grblHAL keeps A's machine position through the ALARM:3 reset is unverified. The simulator keeps it. If it is lost, no restore could work, and a warning would be the whole fix.
- **Announced?** No. ADR-695 D5 explains `G92 A0` for a fresh job. ADR-695 Consequences list the inspector, estimate and park disclosure, not Abort or re-run.
- **Novelty:** new. X8-P3-2 covered the Y-port wording. `unrestored-abort-origin-rotary.test.ts` is the only Abort test that mentions a rotary, and it covers Y.
- **Fix direction:**
  - Record the controller's machine A (or Z) at the job's `G92 A0` with the stop request.
  - On re-run after an Abort, offer "turn the part back N°" (an A jog to the saved machine turn), or re-apply the saved A offset instead of zeroing again.
  - Until then, have the Abort card and the Frame offer warn on A/Z that the part has turned N° since the job started (the status report carries A), and that a re-run starts from the current turn.
- **Refuter:** PENDING.

### Y5-P1-2 — Start from line (and lost-link recovery) on an A or Z program re-enters at the head's X but not the part's turn: the first resumed stroke burns a streak from wherever the part stopped

- **Where (8493f590c):**
  - `src/core/controllers/grbl/resume-program.ts:204-215` (`applyWord` tracks only X and Y; A and Z words are ignored and `G92` is not refused) and `:344-349` (`positionMove` writes `G0 X… Y… S0` only).
  - `src/ui/laser/start-job-resume-stream.ts:163-166` builds every laser resume with it. Lost-link recovery (`runLaserRecoveryCapsuleFlow`) uses the same `buildLaserResumeProgram`.
  - No rotary check exists in `resume-review-warnings.ts` or `laser-resume-reentry.ts`.
- **Anchor:**
  - **Contract:** ADR-103 G7 and ADR-141. The resume positions with the beam off, then replays with power only on burn motion.
  - **Twin:** the Y-port resume, which re-enters at the right turn.
- **Scenario:** after the Abort above, the operator picks Start from line on the line where the burn should continue (the 7th stripe).
  - The preamble moves the head to X 0 only.
  - The first replayed line, `G1 X26.000 A45.837 F1500 S300`, runs lit from the stopped turn (160.4°) to 45.8°. That is a 60.0 mm diagonal streak across the glass.
  - The following lines land correctly.
  - On firmware whose reset clears G92 (stock GRBL with a Z rotary, and FluidNC; ADR-375, `laser-recovery-origin.ts:49-50`), the whole tail's absolute A or Z values then count from machine zero. Every remaining line shifts by the turn at which the job started (READ).
- **Evidence:** REPRO, same test, `A-resume` and `Y-resume` in `abort-rerun-*.json`.
  - A: preamble `G21, G90, G54, G94, M5, G0 X0 S0, M4 S0, F1500`. The first burn starts at machine turn 160.428 against the expected 45.837: **60.00 mm** on the surface at its start, 0 at its end. The next 5 lines are 0.00 mm off.
  - Y control: preamble `G0 X0 Y5.093 S0`. The first burn is 0.00 mm off.
- **Severity:** P1.
  - **For:** a lit stroke across the part that the design does not contain. That is wrong physical output with no warning, and Start from line is the route an operator uses to finish a stopped glass.
  - **Against:** if the operator resumes from the very line where the job stopped, the turn is already close and the streak is short. The tail itself is right on grblHAL, which keeps G92.
- **Announced?** No. ADR-695 names the inspector, estimate and park disclosure, not resume.
- **Novelty:** new. No resume test has an A or Z word (`grep` of `*resume*.test.ts` for `G92 A0`: none).
- **Fix direction:**
  - Track the rotary axis word in the resume scan and position it in the preamble (`G0 X… A… S0`).
  - Re-issue the job's `G92 A0` offset (saved with the run) before the re-entry move.
  - Until then, refuse Start from line and lost-link restart on an A/Z rotary program, with a message.
- **Refuter:** PENDING.

### Y5-P1-3 — The row-step warning's first suggested interval re-creates doubled rows on a Y-port chuck, and the warning then goes silent

- **Where (8493f590c):**
  - `src/ui/laser/job-review/rotary-row-step-warnings.ts:22`: the tolerance is 0.02 step per row, with no allowance for drift over the image.
  - `:90-111` (`rowStepWarning`, `fewer` at `:100`): the first suggestion is `floor(steps)`, the 1-step pitch, rounded to two decimals for the operator.
  - `src/core/raster/emit-raster.ts:233`: rows sit at `minY + (rowIndex + 0.5) × pitch`, so with a 1-step pitch every row is half a step off the step grid.
  - `:48-50`: coordinates are written to 3 decimals. One step on the chuck is 0.0125 machine mm, so a half step sits on the rounding boundary.
  - `src/core/job/compile-job-raster.ts:174-178`: the pitch is height ÷ round(height × lines/mm), not the typed interval.
- **Anchor:**
  - **Contract:** ADR-315 Amendment 1 D1: "For even rows, set the line interval to …". Its Consequences say the maintainer's photo-on-glass job "now names 12.73 lines/mm (one step) or 6.37 lines/mm (two steps) before Start".
  - **Twin:** the advice against the rows the controller then places.
- **Scenario:** the maintainer engraves a 30 mm photo on an Ø80 glass in the Creality chuck (`$101`=80).
  - Job Review warns of banding and says to set 12.73 lines/mm (1 step) or 6.37 (2 steps). The maintainer takes the first.
  - The program's rows are written at Y 0.006, 0.019, 0.031, 0.044 … (0.48, 1.52, 2.48, 3.52 steps). The controller rounds them to steps 0, 2, 2, 4, 4, 6, 6 ….
  - **136 of 382 rows land on the row before** and burn twice, with a two-step gap beside each. The warning no longer fires. The photo comes out with dark double lines and pale gaps instead of even rows.
- **Evidence:** REPRO, `zz-y5\v6b-advice.mts` → `out\v6b-advice.txt` and `v6c-rows.mts` → `out\v6c-rows.txt`. "Phase 0" means work zero sits on a whole step: Absolute rebases to 0, and a G92 at the head is on a step.

  | Setup | Photo | Advice taken | Rows burned twice (phase 0; worst / mean over 20 phases) | Uneven gaps | Warning after |
  |---|---|---|---|---|---|
  | Y chuck Ø80, `$101`=80 | 10 mm | 12.73 (1 step) | 3 (8 / 2.4) | 4 | none |
  | Y chuck Ø80, `$101`=80 | 30 mm | 12.73 (1 step) | **136** (136 / 9.6) | 245 | **none** |
  | Y chuck Ø80, `$101`=80 | 60 mm | 12.73 (1 step) | 136 (246 / 19.1) | 136 | none |
  | Y chuck Ø150, `$101`=80 | 10–60 mm | 6.79 (1 step) | 7–9 (15–19 / 1.2–8.1) | 7–10 | none |
  | Y chuck Ø80, `$101`=100 | 60 mm | 15.92 (1 step) | 31 | 30 | none |
  | A1 Pro A Ø80, `$103`=8.9 | 10 / 30 / 60 mm | 12.75 (1 step) | 0 / 0 / 7 | 0 / 0 / 7 | none |
  | A1 Pro A Ø150 | 10–60 mm | 6.80 (1 step) | 7 | 7 | none |
  | Any of the above | | the 2-step suggestion | **0** | 0–17 single-step edges | none |

  Before the advice, the same Ø80 30 mm photo at 10 lines/mm had 0 doubled rows and 82 uneven gaps, with the warning shown. Taking the first suggestion trades visible banding for double-burned rows and silences the warning.
- **Severity:** P1.
  - **For:** the brief says anything that still keeps the glass from a perfect burn without a warning is P1. Double dose on a third of the rows is wrong physical output (METHOD §3, power). The app told the operator to make the change and then stopped warning.
  - **Against:**
    - X8-P2-3, the same class, was P2 (the program commands even rows; step resolution is the controller's).
    - The second suggestion works on every Y case measured, and the A1 Pro's own default case (12.75 on Ø80, up to 30 mm) is even.
    - The effect depends on where work zero sits relative to a step. Phase 0 is the usual case and the worst.
- **Announced?** No. ADR-315 Amd 1 says the warning names "the two intervals that fit".
- **Novelty:** new. It is a defect in the X8-P2-3 fix, not a re-raise. `rotary-row-step-warnings.test.ts` checks the text and the step arithmetic, not the rows the controller places.
- **Fix direction:**
  - Check the rows as the controller will place them: model `lround` on the emitted coordinates, including the half-pitch row centre, over the whole image.
  - Suggest only intervals that pass that check, or offer the 2-step interval first.
  - Better: write rotary raster row coordinates on the step grid (more decimals on Y/A, or row centres snapped to whole steps), so a 1-step interval works.
- **Refuter:** PENDING.

### Y5-P2-1 — On a tapered part the Max-feed clamp can bite without Job Review's promised warning: the narrow end burns 108–111 %

- **Where (8493f590c):**
  - `src/core/output/rotary-surface-feed.ts:54-62` clamps each move at `k × f(x)` (taper included, #1677).
  - `src/ui/laser/job-review/rotary-surface-speed-warnings.ts:18-25` decides the warning from `rotaryYScale` alone, and only when it is above 1. It never reads the taper factor.
- **Anchor:**
  - **Contract:** ADR-127 Amendment 2 D4: "Above the profile's Max feed the emitter holds the Max feed. Job Review then warns that those strokes run slower on the part".
  - **Contract:** ADR-694 D10: the local scale is `k × rotaryTaperYFactorAt`.
- **Scenario:** an Ø80→Ø70 tumbler on a geared roller (150 mm per turn, Ø26, k = 1.84), with a 90° fill at 3,200 mm/min and Max feed 6,000.
  - At the base the matched feed needs 6,716. The emitter holds 6,000, so the base strokes get **108.1–111.1 %** of the dose while the rim gets 100–101 %.
  - On a surface-calibrated roller (k = 1) at 5,600 mm/min, the base gets **103.0–105.9 %**.
  - No warning in either case.
- **Evidence:** REPRO, `zz-y5\v7-taper-clamp.mts` → `out\v7-taper-clamp.txt` (max F written 6,000; warning NONE).
- **Severity:** P2, as a missing promised piece (D4's warning).
  - **For P1 (brief):** an uneven burn on the glass with no warning.
  - **Against:** it needs a taper and a layer speed inside a narrow band, between Max feed ÷ (k·r_max/r_min) and Max feed ÷ k. For the cup above that is 2,860–3,270 mm/min on the geared roller, or 5,250–6,000 on the k = 1 roller. The error is at most the taper ratio (14 % here).
- **Announced?** No. **Novelty:** new: #1670 × #1672 × #1677 interaction.
- **Fix direction:** compute the warning from the largest `k × rotaryTaperYFactorAt` over the job's X range (or reuse `surfaceMatchedFeed` and flag any clamped move), and drop the `scale > 1` gate when a taper is on.
- **Refuter:** PENDING.

### Y5-P3-1 — On an A rotary the surface-speed warning says "turns Y ×11.46 … mm/min of Y feed" (degrees, not Y), and it fires on layers with no stroke round the part

- **Where (8493f590c):**
  - `src/ui/laser/job-review/rotary-surface-speed-warnings.ts:29-33`: the text is fixed to Y and mm/min.
  - `:22-25`: any cut or fill layer whose speed × scale passes Max feed warns, even a 0° fill whose strokes all run along X.
  - Related: `src/ui/laser/rotary-summary.ts:27-28` says "(Y not scaled)" for a roller with no roller diameter on any axis.
- **Anchor:** ADR-695 D2 (units are degrees on A) and the warning's own claim ("Strokes round the part run at … mm/min").
- **Evidence:** REPRO, `out\v1-feed.txt`.
  - grblHAL A, Ø10 pen, "Fill 3000 @0°": every stroke is along X at 100 %, yet it warns "a 3000 mm/min stroke round the part needs 34378 mm/min of Y feed, more than the Max feed (6000 mm/min)".
  - The 34,378 is degrees per minute, and nothing turns on Y.
- **Severity:** P3 (wording). The safe speed it names is right for any round stroke.
- **Fix direction:** name the axis and its unit ("A feed, °/min"), and warn only for layers with a non-X stroke.
- **Refuter:** PENDING.

### Y5-P3-2 — The A1 Pro preset's source note says `$103=8.900` "so 360° is one turn of a 3200-step rotary motor"; 8.9 × 360 = 3,204

- **Where (8493f590c):** `src/core/devices/rotary-presets.ts:57`.
- **Anchor:** the note's own arithmetic. ADR-695 D13 marks the preset as not checked on a machine.
- **Scenario:** if the chuck really turns once per 3,200 steps, `A360` turns 360.45°, and a full-wrap design overlaps its seam by 0.31 mm on Ø80 (0.59 mm on Ø150). Test rotation would not show 0.45°.
- **Evidence:** READ plus arithmetic. The hardware step count is unverified; the firmware's 8.9 may already define degrees for that rotary.
- **Severity:** P3 (preset data wording).
- **Fix direction:** correct the sentence, or ask the maintainer to run a 10-turn Test rotation and read the seam.
- **Refuter:** PENDING.

## KNOWN: status on `8493f590c`

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y3-P1-1 (#1686, ADR-228 Amd 3) | Rotary camera advice moved the burn along the part | **Fixed, measured.** A: Absolute gets no advice and burns at the picture's X (X 100–219.3); Current Position is told to choose Absolute. Y: Absolute is told to jog over the artwork, then use Current Position. The camera target refuses with the rotary on (`calibration-actions.ts:96,108`) | `v4-journey.txt` |
| ADR-695 Consequences: the inspector shows an A program flat, the estimate uses Y's limits, the park disclosure | Announced | **Unchanged** (`gcode-inspection-source.ts:143-150` reads only `objectDiameterMm`). Re-checked: ETA cut time 93.4 s vs the program's 93.2 s on the A1 Pro and on grblHAL A, so the estimate is right for burn time | `v8-eta.txt` |
| ADR-694 Consequences: the inspector's 3D wrap is a cylinder and its dose shading ignores the taper | Announced | **Unchanged** (`use-laser-burn.ts:176-181` uses one `πD/wrapY`). By that model the Ø70 end of an even burn shades at about 87.5 % | READ |
| D3-P2-2 | Home not adapted to a Y rotary | Unchanged | READ |
| D3-P3-1 / D3-P3-2 | Positional checks read rotary Y as the bed | Unchanged on Y (`laser-jog-warnings.ts:95-96`). On A/Z, Y is the bed again (correct) | READ |
| D3-P3-3 | Inspector wrap ignores Reverse | Unchanged | READ |
| Y4-P1-1, Y4-P1-2, Y4-P2-1 | Camera UI-thread work during a job | Routed, not rotary | — |
| Y1-, Y2-, Y3-P1-2, Y3-P2-1 | Camera | Not re-tested here | — |
| Open #1623, #1626, #1678 | — | No rotary file touched (`gh pr diff --name-only`) | READ |

## Refuted

Candidates dropped before raising:
- **"The feed clamp on A should use `$113`, not the profile's Max feed."** On the A1 Pro, `$113` = 36,000 = its Max feed, so nothing differs there. The A axis's own rate on other grblHAL and FluidNC builds was not read (see Not verified).
- **"An A1 Pro rotary left on Y burns the gantry silently."** It is warned in Job Review (ADR-695 D10) and not refused, by design (ADR-228: advice, not refusal). X8's refuter asked for at least that.
- **"The taper canvas Frame outline is larger than the design at the rim (36.17 mm against 40)."** It is the exact inverse of the machine-space Frame rectangle, which must enclose the warped design. Correct by design.
- **"Frame bounds start 5 units before the burn."** That is the laser-off fill runway (ADR-239), traced as motion.
- **"A rotary 90° fill takes 2.5× longer than on a flat bed (7 m 59 s against 3 m 13 s)."** Laser-off runways take the matched feed (ADR-127 Amd 2 D2). Time only, and the ETA shows it.

## Verified clean

- **Surface feed (L10, `v1-feed.txt`):**
  - 7 Y setups × 2 controllers and 3 A setups × 3 controllers × 6 layer cases.
  - Along, round and diagonal strokes, plus fill at 0°, 90°, 45° and cross-hatch.
  - Unclamped strokes within 0.84 %. The clamp warns whenever `k > 1` and the layer needs more than Max feed.
- **Taper (L10, `v2-taper.txt`):** chuck, scaled roller, surface roller and A, under Absolute and Current Position. Squares are 20.000 ± 0.006 mm, one turn is 360.000° at five heights, and the dose is even rim to base. Frame bounds equal the burn plus runways, and the preview's turns equal π·Ø.
- **A/Z axis (L10, `v3-axis.txt`):**
  - Presets per command set; the axis per controller.
  - `G92` first, no head Y word, refusals on GRBL A and Marlin A, Start and Frame refusal on 3 axes or `AXS:XYZ`.
  - The unconfirmed-axis warning, degree jog, and Y-port turn jog.
- **Returning users (`v5-returning.txt`):** 6 golden projects (1.0.30's five plus 1.0.29's) × 3 placements, emitted by the 1.0.30 source and by main.
  - 18/18 have identical geometry and image lines; only F words change (3 lines on the 1.0.30 sets, 183 on 1.0.29's).
  - Each changed lit move now moves the surface at the F 1.0.30 wrote, within 0.31 %.
  - The surface roller and the disabled rotary are byte-identical.
- **Schema 22 and `.lfmachine`:**
  - Main saves schema 22 and reopens taper, axis and plain-Y projects intact; 1.0.30 refuses them (`schema-too-new`).
  - `.lfmachine` with an active taper or an A axis is schema 2: main imports it with the taper and axis intact, and 1.0.30 refuses it. So **the taper is not dropped by a 1.0.30 import; it is refused.**
  - A saved-but-off taper writes schema 1, and 1.0.30 keeps the field as it is.
- **Save → reopen → same bytes:** GRBL, A1 Pro and Marlin, both placements, both intervals (`v4-journey.txt`).
- **Twins:** the ETA's burn time matches the program on Y and A (`v8-eta.txt`), and Frame bounds match the program (`v2`, `v4`).
- **L12 CI** (`gh` checks and main's runs):
  - Every fix PR's final head passed CI and Browser smoke: #1670 `91d2758e0`, #1671 `57df2a481`, #1672 `650664e1b`, #1673 `49b1d8d69`, #1674 `44fa225e9`, #1677 `f7ba47713`, #1686 `d3bc15b01`.
  - On main:
    - `ba200a019` (#1670), `c08855e04` (#1671) and `dc78f74b1` (#1673): CI green, Browser smoke red (the #1668 toolbar `role=status` selector, not rotary).
    - `f61a0757a` (#1672): **CI red**, `rotary-summary.test.ts` taper wording.
    - `50f721e4b` (#1674): CI green, smoke cancelled.
    - `4c4b98fd0` (#1677): **all green**.
    - `8b9c42caf` (#1686): cancelled, superseded.
    - `8493f590c`: green.
  - **The semantic conflicts are now covered:**
    - #1670 × #1672: the summary wording (the test was updated), the 1.0.30 goldens against the feed change (a feed-off hash plus a feed-on F-only check), and the taper factor in the feed (`emit-gcode-rotary-taper-surface-feed.test.ts`, which fails at 87 % without it).
    - #1671 × the camera advice (Y3-P1-1): `start-job-rotary-camera-placement.test.ts` now has A and Z with the head away from the artwork.
  - **Still untested interactions:**
    - A/Z × surface feed and A/Z × taper output. No test, but both measured right here.
    - A/Z × Abort and re-run, and A/Z × resume. No test, and both are wrong: Y5-P1-1 and Y5-P1-2.
    - The row-step advice against the emitted rows. No test, and it is wrong: Y5-P1-3.

## Not verified

- **No browser.** Rotary Setup, the Rotary switch and the Job Review dialog were not rendered. The Job Review warnings were read from the functions that build them, and from the open review model in the simulator test.
- **No hardware**, by instruction: no rotary, no A1 Pro, no glass. Every physical figure comes from the own models.
  - Whether a real grblHAL keeps A's machine position through the Abort's ALARM:3 reset is unverified. The simulator keeps it.
  - FluidNC's and other grblHAL builds' A planner semantics are taken from ADR-695 D12 (degrees counted as mm). `$376` rotary-axis handling was not traced.
  - The A axis's own max rate (`$113`) on builds other than the A1 Pro was not read.
- **Marlin streamed run:** the store and simulator harness is GRBL-family only, so Marlin was checked at the emitted-program level, with the same Y-port code path as GRBL.
- **The repo's rotary and taper Vitest files** were not run locally (memory gate); CI on `8493f590c` ran them green.
- **Real text objects:** fonts were not loaded in Node. Text-like SVG outlines stood in.
- **LightBurn parity** for re-running an A-axis job after a stop: not documented, and not researched.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-y5\`.
- **Node scripts:** run with `node --no-experimental-webstorage --import ./register.mjs <file>` from `zz-y5\`. The loader is copied from `zz-y3r` and pointed at `j22-main`.
- **Vitest file:** run from `zz-y5\tree` with `node node_modules\vitest\vitest.mjs run src/zz-y5/y5-abort-rerun.simulator.test.tsx --maxWorkers=1` and `NODE_OPTIONS=--no-experimental-webstorage`. `tree\node_modules` is a junction; remove it only with `cmd /c rmdir`.
- Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | TS loader |
| `lib.mts` | Own hardware model (chuck, roller, calibrated roller, A; cone), own G-code reader (G92 per axis), surface strokes |
| `v1-feed.mts` → `out\v1-feed.txt` | X8-P1-1: 10 setups × 5 controllers × 6 layer cases, dose and the clamp warning (Y5-P3-1) |
| `v2-taper.mts` → `out\v2-taper.txt` | X8-P2-2 and #1677: squares at both ends, dose rim/base, one turn at 5 heights, Frame, canvas outline, preview |
| `v3-axis.mts` → `out\v3-axis.txt` | X8-P2-1 and the P3s: presets, axis words, G92, refusals, Frame plans, jog, wording |
| `v4-journey.mts` → `out\v4-journey.txt` | The journey through `prepareStartJob`: camera advice, wrap, seam, aspect, dose, photo rows, Frame, save → reopen |
| `v5-returning.mts` → `out\v5-returning.txt` | 1.0.29 and 1.0.30 files on the 1.0.30 source and on main; schema 22; `.lfmachine` both ways |
| `v6-rowstep.mts` → `out\v6-rowstep.txt` | X8-P2-3: the warning at 80/100/160 and `$103`, with each suggestion applied |
| `v6b-advice.mts` → `out\v6b-advice.txt` | Y5-P1-3: the advice over 10/30/60 mm photos and 20 offset phases |
| `v6c-rows.mts` → `out\v6c-rows.txt` | Y5-P1-3: the first rows as written, in steps |
| `v7-taper-clamp.mts` → `out\v7-taper-clamp.txt` | Y5-P2-1 |
| `v8-eta.mts` → `out\v8-eta.txt` | ETA twin on Y and A |
| `tree\src\zz-y5\y5-abort-rerun.simulator.test.tsx` → `out\abort-rerun-A.json`, `abort-rerun-Y.json`, `vt-abort-rerun.txt` | Y5-P1-1 and Y5-P1-2: real store, Frame, Job Review, Start and simulator; Abort, Restore, re-run; Start from line |
| `out\rotary-suite-files.txt` | The 41 repo rotary and taper test files selected for a local run that the memory gate never allowed (see Memory gates); `out\vt-rotary-suite.txt` holds only the stopped, mis-launched attempt |

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Y5-P1-1","severity":"P1","area":"rotary-fix-verify","file":"src/io/gcode/rotary-axis-emit.ts","line":37,"anchor":"Contract ADR-341 Amd 11-13 (Abort keeps and restores the origin so the re-run overlays); twin Y-port restore keeps the turn","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"A/Z rotary: re-run after Abort sends G92 A0 at the stopped turn; restore covers X/Y only; re-run lands 84.0 mm round an Ø60 part (160.4° stop) from run 1, no warning; Y-port control 0.00 mm"},
  {"id":"Y5-P1-2","severity":"P1","area":"rotary-fix-verify","file":"src/core/controllers/grbl/resume-program.ts","line":204,"anchor":"Contract ADR-103 G7 / ADR-141 beam-off re-entry; twin Y-port resume","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Start from line / lost-link recovery on A/Z tracks only X/Y; preamble G0 X only; first resumed lit stroke runs from the stopped turn (60.0 mm streak); tail shifts on firmware that clears G92 at reset (READ)"},
  {"id":"Y5-P1-3","severity":"P1","area":"rotary-fix-verify","file":"src/ui/laser/job-review/rotary-row-step-warnings.ts","line":100,"anchor":"Contract ADR-315 Amd 1 D1 ('For even rows, set the line interval to ...'); twin advice vs rows placed","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"First (1-step) suggested interval puts rows at half-step centres written to 3 decimals: Ø80 Creality chuck $101=80, 30 mm photo at 12.73 l/mm burns 136/382 rows twice, then the warning is silent; 2-step suggestion is even"},
  {"id":"Y5-P2-1","severity":"P2","area":"rotary-fix-verify","file":"src/ui/laser/job-review/rotary-surface-speed-warnings.ts","line":18,"anchor":"Contract ADR-127 Amd 2 D4 (clamp -> Job Review warns) with ADR-694 D10 (local scale k·f(x))","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Taper x Max-feed clamp: base of Ø80->Ø70 cup burns 108-111% (geared roller, 3200 mm/min) or 103-106% (k=1 roller, 5600) with no warning; warning reads rotaryYScale only"},
  {"id":"Y5-P3-1","severity":"P3","area":"rotary-fix-verify","file":"src/ui/laser/job-review/rotary-surface-speed-warnings.ts","line":29,"anchor":"ADR-695 D2 units; warning's own claim about strokes round the part","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"On A the clamp warning says 'Y x11.46 ... mm/min of Y feed' (degrees on A) and fires on 0° fills with no round strokes; roller summary says '(Y not scaled)' on A"},
  {"id":"Y5-P3-2","severity":"P3","area":"rotary-fix-verify","file":"src/core/devices/rotary-presets.ts","line":57,"anchor":"Preset note arithmetic; ADR-695 D13 not checked on a machine","evidence":"READ","verdict":"PENDING","known":false,"summary":"A1 Pro preset says $103=8.9 makes 360° one turn of a 3200-step motor; 8.9x360=3204, a 0.45° (0.31 mm on Ø80) seam overlap if the motor is 3200/turn"}
]
```

## Refuter (2026-11-10)

- **Tree:** origin/main @ `144e45d76`. `git log 8493f590c..origin/main -- src` is empty, and every file cited below has the same blob on both SHAs, so the auditor's tree `8493f590c` (`j22-main`) is main's code.
- **Harness:** my own, in `zz-y5r\`.
  - A Node script drives the real `emitGcode`, `prepareOutput`, `buildLaserResumeProgram`, `deserializeProject` and the Job Review detectors.
  - The controller model is my own (`rlib.mts`): per-axis G92 offsets, absolute/relative, a stop part way through a line, G92 kept or cleared at reset, and the GRBL/grblHAL per-axis max-rate cap.
  - The physics is my own: a chuck turns 2π per Motion-per-turn units; a cone on a roller turns at roller speed ÷ the wide-end radius.
  - I did not read the auditor's scripts beyond `v6b`, `v6c` and the abort test's scenario.
- **Runs:**
  - No Vitest and no browser. Free memory was 0.6–3.2 GB. The Node scripts needed neither.
  - No hardware, no network beyond two public pages (LightBurn's docs and GRBL's source).

### Verdicts

| ID | Verdict | Severity | Evidence (mine) |
|---|---|---|---|
| Y5-P1-1 | **CONFIRMED** | P1 | REPRO `r1-abort-resume.txt`, plus READ of the card text |
| Y5-P1-2 | **CONFIRMED, wider** | P1 | REPRO `r1-abort-resume.txt` |
| Y5-P1-3 | **RE-RATED** | P1 → **P2** | REPRO `r2-rowstep.txt`, `r2b-rows.txt` |
| Y5-P2-1 | **RE-RATED** | P2 → **P1** | REPRO `r3-taper-clamp.txt` |
| Y5-P3-1 | **CONFIRMED** | P3 | READ `rotary-surface-speed-warnings.ts:19-33` |
| Y5-P3-2 | **CONFIRMED** | P3 | READ `rotary-presets.ts:57`; 8.9 × 360 = 3,204 |

**Y5-P1-1: CONFIRMED P1.**
- **Repro.** Ø60 glass, a design of five closed shapes and a diagonal, Abort half way through lit move 10 of 21. The part is 126.05° on from where the job began (66.0 mm on the surface). Then Restore puts back `G54 G21 G92 X.. Y..`, and the re-run's own `G92 A0` re-zeroes the stopped turn.
  - **Falcon A1 Pro, A:** every burn of the re-run lands **66.00 mm** round the part from run 1.
  - **FluidNC A and stock GRBL Z:** the same 66.00 mm.
  - **Y-port control:** 0.00 mm.
- **Nothing warns:**
  - The Frame offer goes through `activeAbortOriginRotary()`, which returns null on A/Z (`unrestored-abort-origin.ts:165-172`). Its prompt gives the X/Y distance only.
  - The Abort card *tells the operator the opposite*. `AbortStoppedCard.tsx:217-221`: Restore "puts the origin back where the job started". On grblHAL the card adds "grblHAL keeps your origin … through a reset" (`:213`).
  - The success toast only says to Frame. A Frame is not a warning (METHOD §3, G6 clarification).
- **No natural way to turn the part back:**
  - The A/Z turn-jog buttons exist (`RotaryTurnJogControls.tsx`).
  - But KerfDesk never shows the turn. The status parser keeps only the *count* of MPos values (`status-parser.ts:337-345`), not A's value, so the operator cannot know how many degrees to turn back.
  - Home does not involve the rotary.
- **Premise.** ADR-695 D5's premise "Nothing reports where a dedicated rotary stands" (`rotary-axis-output.ts:10`) is false on grblHAL and FluidNC. MPos carries A, and ADR-695 D8 already counts it.
- **LightBurn parity:**
  - LightBurn's current docs (2.2, fetched 2026-11-10; live URL, no archive link, so context only) have no rotary restart guidance.
  - Its Stop says the job cannot be resumed "right where you left off" (https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/).
  - So LightBurn neither promises nor provides this. KerfDesk's own contract (ADR-341 Amd 11–13) and card text do promise it.
- **No case for lowering:** the output is wrong (position), and no warning reaches the operator.

**Y5-P1-2: CONFIRMED P1, and wider than reported.**
- **No A in the resume:**
  - `applyWord` (`resume-program.ts:204-215`) tracks X/Y only.
  - `positionMove` (`:344-349`) writes `G0 X… Y… S0` only.
  - My resume preambles are all `G21, G90, G54, G94, M5, G0 X20 S0, M4 S0, F…`. There is no `G92 A`/`G0 A`.
- **A1 Pro (grblHAL keeps G92):**
  - From the stopped line itself (an X-only edge here), the burn is right.
  - From the start of the previous shape, the first lit move starts **22.00 mm** off and is 29.7 mm long instead of 20.0.
  - The later moves are right.
- **FluidNC A and stock GRBL Z (G92 cleared at reset, ADR-375):** the auditor's READ claim now reproduces. **Every** tail move lands off: 19.37 mm (FluidNC A) and 174.36 mm (GRBL Z, Ø60, 40 per turn), from the stopped line too.
  - The tail's absolute A/Z values count from machine zero, whatever turn the machine had at job start. My start turn was 37.
- **Start from line does not warn on a rotary.**
  - `LaserRecoveryCanvas.tsx:31-37` says only "A positioned route preview is unavailable for this saved job". It gives no word about the turn.
  - `resume-review-warnings.ts` and `laser-resume-reentry.ts` have no rotary case.

**Y5-P1-3: RE-RATED to P2.** The mechanism is confirmed, but it is the X8-P2-3 class, and the 136-row case needs an exact entry.
- **The arithmetic:**
  - On the Creality chuck, Ø80, `$101`=80: one surface mm is 80 × 40 ÷ (π·80) = 12.7324 steps.
  - The first suggestion, `fewer = max(1, floor(1.273))` = 1, is printed first: "12.73 lines/mm (0.079 mm, 1 step)".
  - 12.73 is a **one-step** pitch, not a half-step pitch.
  - The half step comes from `emit-raster.ts:233`, which puts row centres at `(i + 0.5) × pitch`. With work zero on a step, every row centre is a tie (0.00625, 0.01875 …), and `toFixed(3)` (`:45-50`) breaks the ties alternately: 0.006, 0.019, 0.031, 0.044 = 0.48, 1.52, 2.48, 3.52 steps → `lround` 0, 2, 2, 4 (`r2b-rows.txt`).
- **Reproduced:** 30 mm photo, entered as 12.73 lines/mm: **136 of 382 rows doubled**, and the warning is silent.
- **But Cut Settings has no lines/mm field.** It takes Line Interval in mm or DPI (`CutSettingsImageFields.tsx:283-316`).
- **Through those fields** (30 mm photo, phase 0, `r2-rowstep.txt`):

  | Entry | Rows doubled (phase 0) | Over 20 phases (max / mean) |
  |---|---|---|
  | The printed **0.079 mm** | **4** of 380 | 8 / 6.5 |
  | **DPI 323** | 3 | 9 / 7.2 |
  | DPI 323.34, or interval 0.0785 | 136 | 136 / 9.6 |

  Only an entry that lands in a density window about 0.03 lines/mm wide (382 rows on 30 mm) gives 136.
- **Other cases:**
  - 20 mm photo: 7 doubled.
  - 50 mm photo: 17 doubled.
  - Ø150: 7.
  - Ø70: 110 at the exact entry, 7 at the printed mm.
  - A1 Pro, A: 0–7.
  - Any artwork that extends below the photo moves the phase off the tie: 0 doubled.
  - The 2-step suggestion is clean on every case (0 doubled).
  - The warning stays silent after any 1-step entry.
- **Why P2:**
  - The effect is the X8-P2-3 class: image rows quantised to the rotary's step grid, rated **P2** by the v12 refuter and coordinator on 2026-11-09, for 31 % doubled rows with no warning.
  - Rating this P1 while that stays P2 would split one physical class. The ledger should move both together if it wants P1.
  - The P2 clause fits exactly: "wrong behaviour an ordinary user will hit, with a misleading result". The advice misleads, and then the check goes quiet.
- **Fix direction (adds to the auditor's):**
  - Print the interval to 4 decimals (0.0785).
  - Model `toFixed(3)` and the half-pitch row centre in the check.
  - Or write rotary row coordinates with more decimals.

**Y5-P2-1: RE-RATED to P1.**
- **Reproduced with my own cone and roller physics**, on a 20 oz-style tumbler (Ø88 → Ø72 over 150 mm), 90° fill, Max feed 6000:

  | Roller | Fill speed | Narrow end | Wide end | Warning |
  |---|---|---|---|---|
  | **No roller diameter** (k = 1; `rotary.ts:121` returns exactly 1) | 6000 | **118.7–122.2 %** | 101.2–103.8 % | **none** |
  | No roller diameter | 5400 | 106.8–110.0 % | — | none |
  | 60 mm/turn, Ø20 roller (k 0.955) | 6000 | 113.4–116.7 % | — | none |

  The chuck control is 100.0 % at both ends.
- **The warning can never fire for k ≤ 1.** `rotary-surface-speed-warnings.ts:19-20` gates on `scale > 1`. The emitter clamps at `k × f(x)` (`rotary-surface-feed.ts:54-62`).
- **The auditor's "narrow band" is the common case.** For k ≤ 1 the band is "layer speed between Max feed ÷ f_max and Max feed", and it includes a fill at the profile's Max feed. Tumblers are tapered and usually sit on rollers.
- **Why P1:**
  - This is the X8-P1-1 class: surface dose wrong, silently, rated P1. The error here is up to the taper ratio (22 %).
  - METHOD §3 has no reach clause, and no warning reaches the operator.
  - ADR-127 Amd 2 D4 promised exactly that warning.

**Y5-P3-1: CONFIRMED P3.**
- The text is fixed to "turns Y ×… mm/min of Y feed".
- The gate looks only at `group.speed × scale > maxFeed`, never at stroke direction. So a 0° fill warns.
- The held speed it names is right for round strokes.

**Y5-P3-2: CONFIRMED P3.**
- 3,200 ÷ 360 = 8.889 steps/°, not 8.9.
- Whether the chuck really takes 3,200 steps is unverified (ADR-695 D13). If it does, A360 = 3,204 steps = 360.45°. That is latent preset data.

### Challenges to "Verified clean / fixed"

- **X8-P1-1 "FIXED":**
  - Holds on Y, and on A where `$113` ≥ the needed rate (the A1 Pro's `$113` = 36,000 = its Max feed; `r4-challenges.txt` (a) control: 100.0 %).
  - It **does not hold on Z**, or on any A build whose rate is lower: **new Y5-P1-4**.
  - With a taper on a roller it fails: Y5-P2-1, now P1.
  - Verdict: **FIXED except Y5-P1-4 and Y5-P2-1.**
- **X8-P2-2 taper "FIXED": holds for new inputs** (`r4-challenges.txt` (d), `r4b-crosshatch.txt`).
  - Cross-hatch 0/90 and a 45° fill on the A1 Pro A chuck, Ø88 → Ø72: every along, round and diagonal stroke 100.0 % at both ends.
  - My first square-size reading (20.25 mm) was my own artefact (radius taken at the window centre). Per stroke the round extent is 20 mm ÷ r(x), as designed.
- **Seam and mirror on A and Z: clean.** A full-wrap band spans exactly 360.0000° on A and 40.0000 on Z, so the seam gap is 0.0000 mm. Reverse mirrors within the wrap (an L foot at 331.352° forward and 28.648° reversed). Each job ends at turn 0 with no Y word.
- **A1 Pro with the A preset, Test rotation never confirmed:**
  - Job Review warns (ADR-695 D9), and the program is still produced.
  - This is by design (ADR-228: advice, not refusal). Clean.
- **A 1.0.29 rotary project on an A1 Pro:**
  - The ADR-695 D10 warning fires ("rotary connector is its A axis, but the rotary is set to Y …"). Clean.
  - But **on any machine**, the 1.0.29 golden opens with **no old-project burn notice**, while its round strokes now get 6.28× the dose 1.0.29 gave them (F 238 on 62 of 64 lit moves).
  - ADR-682 Amd 3 D4 says the file, not the release notes, raises such notices: **new Y5-P2-2**.
  - ADR-695 Consequences' "burns what 1.0.29 burned" is no longer true after #1672 (drift, folded into P2-2).
- **Inch display:**
  - No emitter writes `G20`. A grep of `core/output`, `io/gcode` and `core/gcode` finds none, so the display unit cannot reach the program (READ).
  - The rotary fields in inch mode were not rendered.
- **Marlin:**
  - `rotaryAxesForKind` (`rotary-axis.ts:57-68`) gives Marlin Y only, and an A/Z setup is refused (`rotary-axis-unexecutable`).
  - The Y path is the GRBL one the auditor measured (READ; not streamed).

### New findings

**Y5-P1-4: on a Z (or A) rotary, the surface feed and its Max-feed clamp ignore the rotary axis's own max rate (`$112`/`$113`). The controller caps the move silently, and round strokes burn 1.1–4.3× the dose.**
- **Where (`8493f590c` = main):**
  - `rotary-surface-feed.ts:54-62` clamps only at the profile's `maxFeed`.
  - `parse-settings.ts:177-178` derives that from `$110`/`$111` only. `$112`/`$113` are never read, though the same `$$` read takes `$102`/`$103` (`:351-352`).
  - `rotary-surface-speed-warnings.ts:19-25` uses the same `maxFeed`.
- **Ground truth:** the planner caps a G1 block so that no axis passes its max rate.
  - GRBL v1.1h, `planner.c`: `block->rapid_rate = limit_value_by_axis_maximum(settings.max_rate, unit_vec);`, then `plan_compute_profile_nominal_speed` caps non-rapid moves at `rapid_rate` (https://raw.githubusercontent.com/gnea/grbl/v1.1h.20190825/grbl/planner.c, tag-pinned, fetched 2026-11-10).
  - grblHAL does the same over every axis including A (`limit_max_rate_by_axis_maximum`; master, unpinned, context only).
- **Scenario:** the A1 Pro preset itself says "if Test rotation does not turn the chuck, choose Z". ADR-695 cites one turn "at 360 with Z on an A1".
  - The repo's own A1 Pro dump has `$112=2000` against a 36,000 Max feed. The repo's other grblHAL dump has `$112` = 500 and 1,000.
- **REPRO** (`r4-challenges.txt` (a); real emit; own planner cap; dose = layer speed ÷ surface speed):

  | Setup | Layer | Z needed | Dose | Job Review |
  |---|---|---|---|---|
  | A1 Pro, Z, 360 per turn, Ø80, `$112`=2000 | line 1500 | 2,149/min | **107.4 %** | none |
  | | line 3000 | 4,297/min | **214.9 %** | none |
  | | fill 6000 (90°) | 8,594/min | **429.7 %** | none |
  | Stock GRBL, Z chuck 40 per turn, Ø80, `$112`=500 | fill 6000 | 955/min | **191 %** | none |
  | Stock GRBL, Z chuck 40 per turn, Ø30, `$112`=1000 | line 3000 | | **127 %** | none |
  | | fill 6000 | | **255 %** | none |
  | Control: A1 Pro A, `$113`=36000 | all | | 100.0 % | none |

- **Severity:** P1. Silent wrong power. It is reachable today wherever Z is offered (GRBL, grblHAL, FluidNC), and on any A build whose `$113` is below the needed rate.
- **Against:**
  - Whether any A1 Pro really routes the rotary to Z with `$112`=2000 is unverified.
  - A Z-rotary owner may already have raised `$112`.
  - Neither is a warning.
- **Novelty:** new. It is the #1671 × #1672 interaction. ADR-695 D12 covers planner timing, not axis rate. The auditor listed `$113` on other builds as not read.
- **Fix direction:**
  - Read `$112`/`$113` (and FluidNC's per-axis `max_rate`) at connect.
  - Clamp the matched feed so the rotary axis's share stays under its rate.
  - Warn in Job Review as for `maxFeed`. Until the rate is known, warn that it is unchecked.

**Y5-P2-2: a rotary project saved by 1.0.30 or earlier opens with no old-project burn notice, though #1672 changed every round stroke's dose (6.28× on the Ø80 Creality chuck).**
- **Where:**
  - `old-project-burn-notice.ts:79-92` checks frames, records, image dose and the CNC origin, and never the rotary.
  - The 1.0.31 update notes do say rotary projects "may burn darker or lighter".
- **Anchor:** ADR-682 Amendment 3 D4: "What the file holds raises the notices, not the release notes". Its Context names exactly this class: intended dose changes reached old projects unannounced, and a user who skips a release never reads its notes.
- **REPRO** (`r4-challenges.txt` (e)):
  - `deserializeProject` of `__fixtures__/returning-user/1.0.29-rotary.lf2.gz` gives `oldProjectBurn` = **NONE**.
  - Its line and fill layers at 1500 mm/min now write F 238 on 62 round moves. 1.0.29 wrote F 1500, so the surface ran 6.28× faster than now.
  - A user who tuned power on 1.0.29 to make round strokes visible now burns them 6.28× heavier. X8's range was 0.16×–4.6× (more on other setups).
- **Severity:** P2. A broken contract with a clear scenario. It is not silent for anyone who reads 1.0.31's update notes, and the new output is correct for the settings.
- **Fix direction:** add a rotary notice: schema ≤ 21, rotary enabled, k ≠ 1 or a taper, with vector layers.

### Not verified

- **No browser.** Abort card, Frame offer, Start-from-line picker and Job Review were read from code and called as functions.
- **No Vitest.** The real store and GRBL simulator path is the auditor's. My re-run and resume figures come from my own controller model fed with the real emitted and resume programs.
- **No hardware:**
  - Whether a real grblHAL keeps A's machine count through the ALARM:3 reset.
  - The A1 Pro's real rotary routing and its `$112`/`$113` with the rotary fitted.
  - FluidNC's G92 behaviour at reset (taken from ADR-375).
  - Whether the 3,200-step figure is true.
- **grblHAL's `rotary_fix_enable` flag.** grblHAL master's planner re-times mixed linear and rotary moves as inverse time over the linear length when it is on. If a build enables it, ADR-695 D12's premise (F over the whole XYZA vector) fails for diagonal strokes on A.
  - The A1 Pro's value is unknown. The source is master, unpinned.
- **A-axis max-rate defaults** on grblHAL and FluidNC builds other than the A1 Pro.
- **LightBurn's actual behaviour** after a Stop on an A rotary. Its docs are silent.
- **Inch-mode rendering** of the rotary fields.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-y5r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder. The loader is copied from `zz-y5`, pointed at `j22-main`. Nothing in the repo was touched except this section.

| File | What it does |
|---|---|
| `rlib.mts` | Own controller model (per-axis G92, stop part way, reset rules) and scene builders |
| `r1-abort-resume.mts` → `out\r1-abort-resume.txt` | Y5-P1-1 and Y5-P1-2 on the A1 Pro A, FluidNC A, GRBL Z and the Y control |
| `r2-rowstep.mts` → `out\r2-rowstep.txt` | Y5-P1-3: the advice entered as lines/mm, Line Interval mm and DPI; 4 setups × 4 photos × 20 phases |
| `r2b-rows.mts` → `out\r2b-rows.txt` | The rows as written, and the phase moved by artwork below the photo |
| `r3-taper-clamp.mts` → `out\r3-taper-clamp.txt` | Y5-P2-1: k = 1, 0.955 and chuck on a Ø88 → Ø72 tumbler |
| `r4-challenges.mts` → `out\r4-challenges.txt` | Y5-P1-4 (axis max rate), seam and mirror on A and Z, cross-hatch and 45° on a taper, the 1.0.29 golden (Y5-P2-2), the unconfirmed A1 Pro |
| `r4b-crosshatch.mts` → `out\r4b-crosshatch.txt` | Per-pass extents on the taper (explains my 20.25 mm artefact) |

No security finding, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Y5-P1-1","verdict":"CONFIRMED","severity":"P1","evidence":"REPRO","summary":"A1 Pro/FluidNC A and GRBL Z: re-run after Abort+Restore lands 66.00 mm round an Ø60 part (own model); Y control 0.00; Abort card says Restore puts origin back where the job started; A position never shown"},
  {"id":"Y5-P1-2","verdict":"CONFIRMED","severity":"P1","evidence":"REPRO","summary":"Resume preamble G0 X only; A1 Pro 22 mm off first stroke from the previous shape; FluidNC A / GRBL Z whole tail 19.4 / 174.4 mm off (G92 cleared at reset)"},
  {"id":"Y5-P1-3","verdict":"RE-RATED","severity":"P2","evidence":"REPRO","summary":"Mechanism confirmed (half-step row centres + toFixed(3)); 136/382 needs phase 0 and a lines/mm entry no field takes; printed 0.079 mm gives 4/380, DPI 323 gives 3; X8-P2-3 class precedent P2"},
  {"id":"Y5-P2-1","verdict":"RE-RATED","severity":"P1","file":"src/ui/laser/job-review/rotary-surface-speed-warnings.ts","line":20,"evidence":"REPRO","summary":"k=1 roller (no roller diameter) can never warn; Ø88->Ø72 tumbler, 90° fill at Max feed 6000: narrow end 118.7-122.2 %, k 0.955 roller 113-117 %, silent"},
  {"id":"Y5-P3-1","verdict":"CONFIRMED","severity":"P3","evidence":"READ"},
  {"id":"Y5-P3-2","verdict":"CONFIRMED","severity":"P3","evidence":"READ"},
  {"id":"Y5-P1-4","verdict":"NEW","severity":"P1","area":"rotary-fix-verify","file":"src/core/output/rotary-surface-feed.ts","line":58,"anchor":"Ground truth GRBL v1.1h planner.c per-axis rapid_rate cap on G1 (tag v1.1h.20190825); twin Y-port maxFeed from $110/$111","evidence":"REPRO","known":false,"summary":"Z/A rotary feed and clamp use profile Max feed only; $112/$113 never read; A1 Pro Z (preset fallback, 360/turn, $112=2000) round strokes 107-430 % dose, GRBL Z $112=500 fill 191 %, no warning"},
  {"id":"Y5-P2-2","verdict":"NEW","severity":"P2","area":"rotary-fix-verify","file":"src/io/project/old-project-burn-notice.ts","line":79,"anchor":"Contract ADR-682 Amd 3 D4 (the file raises old-project burn notices, not release notes)","evidence":"REPRO","known":false,"summary":"1.0.29 rotary golden opens with no oldProjectBurn notice; round strokes now 6.28x the 1.0.29 dose (F 238 vs 1500)"}
]
```

Refuter counts: raised 8, refuted 0, P1 4, P2 2, P3 2, known 10

**Can the maintainer burn a perfect round glass today?** Only a first, uninterrupted run with the A1 Pro's A preset (Test rotation confirmed) and photos at the 2-step interval. Not after any stop, not on a tapered tumbler on rollers with fills near Max feed, and not on a Z rotary whose Z max rate is low.
