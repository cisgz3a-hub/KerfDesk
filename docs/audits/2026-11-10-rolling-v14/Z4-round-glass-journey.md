# Rolling audit v14 — Z4 Round-glass journey: can a maker put a glass or tumbler on a rotary and get a perfect burn?

- **When:** 2026-11-11 +0800. **Tree:** origin/main @ `c3856ce06` (scratchpad export `j27-main`, read-only; `node_modules` a junction).
  - All fix PRs had merged: #1742 (`d705cd504`), #1740 (`6fcb6c1f4`), #1743 (`c30c5d986`), #1744 (`645bcf3fc`), #1745 (`95489484e`).
  - Untested-merge partners (L12) read against the rotary: #1732 (Abort auto-restore), #1733 (a jog keeps the Frame), #1735 (Unlock keeps position), #1736 (Run again carries the review).
- **Lenses:** L10 (fix verification), L12 (untested merges), L4 (journey).
- **Method:**
  - **Real code:** `prepareStartJob` (Start's own compile, emit and warnings), `emitGcode`, `prepareOutput`, `machineSpaceJob`, the Job Review rotary detectors with the controller's `$$` values, `buildLaserResumeProgram`, `abortRotaryZero`, `rotaryTurnSinceAbort`, `turnRotaryBackToJobStart` with the real `waitForControllerStatus` and the real laser store state, `rotaryAxisStartWarnings`, `rotaryCameraWarning`, `serializeProject` / `deserializeProject`, `prepareAutosaveRecord` / `readAutosaveRecord`, `emitPreparedMoshiJob` + `decodeMoshiProgram`, `emitRdFile`.
  - **Own G-code reader and physics** (`zz-z4\z4lib.mts`, written for Z4 and checked against `zz-z3\lib.mts` and `zz-z3r\rlib.mts`, not copied):
    - reader: G0–G3 modal, G90/G91, G92 per axis, G53 one-shot moves, `$J=` jogs (never lit), F/S modal, M3/M4/M5;
    - a chuck turns the part 2π per motion-per-turn units; a roller at the widest diameter;
    - feed: F over the length of every commanded axis delta (degrees as mm), with GRBL-planner per-axis rate caps;
    - taper: radius linear along X between rim and base;
    - truth: a design point (x, y) burns at along = x and angle θ = θ₀ + (y − pivot) / r(x), which is ADR-694's documented semantics. The scene's Y points down; a flat bed emits scene y = 20 at machine Y = 380, so the model uses −y.
- **Setups:**
  - **GY:** stock GRBL 1.1, Creality chuck on the Y port (40 mm/turn, `$101`=80, `$111`=6000).
  - **HA:** grblHAL with A (360°/turn, `$103`=8.9, `$113`=10000).
  - **A1:** the Falcon A1 Pro preset on A (dump values `$103`=8.9, `$113`=36000).
  - **FA:** FluidNC with A (rates not read, as announced).
  - **GZ:** stock GRBL with Z (40 mm/turn, `$102`=80, `$112`=1000).
- **Parts:** S80 is an Ø80 straight glass. T88 is an Ø88→Ø72 tumbler, 120 mm side, rim left, artwork 15 mm from the rim.
- **Designs:**
  - text outline;
  - a filled logo (a circle with a square hole) at Fill 0° and 45°, each with and without a 2 mm Ramp;
  - a 30 × 30 mm photo with Jarvis dither at 10 lines/mm;
  - a seam test: a stroke along the side plus a stroke round the part exactly one turn of the reference Ø.
- **Memory:** 0.40–0.72 GB free throughout, under both the Vitest gate (1.5 GB) and the browser gate (2 GB). Only Node scripts ran, at `--max-old-space-size` ≤ 600. No browser, Vitest, hardware, camera or network was used.
- **Counts:** 2 raised → refuter pending → P1 1 / P2 0 / P3 1 (+ 17 known).

## Headline: is a perfect round-glass burn possible today?

**On a straight glass, yes, on every controller tested: GRBL Y, grblHAL A, the A1 Pro preset, FluidNC A and stock GRBL Z.**
- Text lands within 0.003 mm of the design.
- A full-wrap design closes at exactly 360.000°, so the seam has no gap or overlap.
- Every stroke of text, Fill at 0° and 45°, ramped Fill and photo burns at 100.0–100.5 % of the set dose.
- Rows sit at the set interval: 0.0998–0.1005 mm on A, and 0.094–0.1005 mm on a Y chuck after 3-decimal rounding. Where the rotary's steps band the rows, Job Review now says so for Fills too, and names the layer.

**After the usual interruptions it holds within a controller session:**
- Start from line re-enters at 0.0000 mm on A (grblHAL, A1 Pro, FluidNC) and Z (GRBL).
- A turn-back of 221° or 330° finishes and is reported correctly.
- After a power-up or reconnect, KerfDesk refuses the turn-back and Start from line, and says to turn the part by hand, as #1742 intended.
- Saving and reopening, and the autosave recovery, give byte-identical programs.

**On a tapered tumbler, no, whenever the design has a Fill (Z4-P1-1, P1).** With Taper on in Rotary Setup:
- A Fill at any hatch angle except 90° silently loses most or all of its hatch.
- On the Ø88→Ø72 tumbler, a 0° Fill burns 39 % of its lines; a 45° Fill burns one 1.2 mm stroke out of 470; a cross-hatch burns 2 out of 939.
- Even an Ø80→Ø79 taper loses 85 % of a 45° Fill.
- It happens on every G-code controller and every rotary axis (Y, A, Z).
- No warning appears in Start or Job Review, and the program passes preflight.
- On a tumbler, text, photos, ramped Fills and 90° Fills burn correctly.

**Rotary status, plainly:**

| Setup | Straight glass | Tapered tumbler | Abort → re-run (same session) | Abort → power-cycle/reconnect → re-run |
|---|---|---|---|---|
| GRBL, Y-port chuck | Perfect | **Fills lost** (Z4-P1-1); text, photo and ramped Fill perfect | Y keeps work coordinates: re-run exact (Z2) | Re-home / re-zero Y by hand, as on a flat bed |
| grblHAL, A | Perfect | **Fills lost** | Turn-back exact; Start from line 0.0000 mm | Refused, with a "turn the part back by hand" message (by design) |
| Falcon A1 Pro preset, A | Perfect in the model; warns until Test rotation is confirmed; not checked on a real A1 Pro | **Fills lost** | As grblHAL | As grblHAL |
| FluidNC, A | Perfect (steps and rates not read: row banding cannot be checked, as announced) | **Fills lost** | As grblHAL | As grblHAL |
| Stock GRBL, Z | Perfect | **Fills lost** | Turn-back exact; Start from line 0.0000 mm | As grblHAL |

Not measured: Abort latency and lit stops with the camera job watch on, and the worker streaming route. The browser could not run under the memory gate (see Not verified).

## Journey table

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Setup: axis from `$$`/`$I` | **Pass.** An A rotary is refused when the controller reports XYZ (grblHAL, FluidNC), and on stock GRBL. Z is accepted on stock GRBL. An unconfirmed A warns "No Test rotation has been confirmed". The A1 Pro is offered only its A preset (360°). | REPRO `j6-placement.mts` → `out/j6-placement.txt` §1, §3 |
| 2a | Design on Ø80: text, Fill 0°/45° ± Ramp, photo, seam | **Pass** on all 5 setups. Text error ≤ 0.003 mm; seam exactly 360.000°; dose 1.000–1.005; head Y never moves on A/Z (0 moves). | REPRO `j1-burn.mts` → `out/j1-burn-full.txt` |
| 2b | Design on the Ø88→Ø72 tumbler | **FAIL for Fill** (Z4-P1-1). Text within 0.026 mm of the ADR-694 model. Photo and ramped Fill whole. The over-one-turn warning matches the measurement (said 1.13 turns; measured 408.06° = 1.133). | REPRO `j1-burn.mts`, `j2-taper-fill.mts`, `j2b-taper-range.mts` |
| 2c | Ramped Fill at 45° on a rotary (#1743) | **Pass.** It scans along X like the 0° ramp (identical rows and degrees), with the "every pass of this Fill scans along X" notice; no throw on any setup. | `out/j1-burn-full.txt` ramp45 rows |
| 3a | Current Position vs Absolute | **Pass.** Current Position puts the design centre at the head's X and the current turn (0.00°) on Y, A and Z. Absolute on A/Z puts the lowest edge at the current turn. Absolute on Y turns back to work Y 0, which is announced and warned. | `out/j6-placement.txt` §2 |
| 3b | Camera placement advice | **Pass (READ + function).** `rotaryCameraWarning` matches ADR-228 Amd 3: no warning for Absolute on A/Z; Current Position warned on every axis. Overlay picture work runs in the picture worker (#1740). No stub-camera browser run (memory gate). | `out/j6-placement.txt`; READ `capture-overlay-still.ts:33-34`, `helpers/moved-check-capture.ts:47-63` |
| 3c | Job Review advice | **Pass, except Z4-P1-1.** Row-step banding is named for Image and Fill ("Fill layer Logo …1.27 steps"). The ramp notice is present. Nothing about the lost tumbler Fill. | `out/j1-burn-full.txt` warnings |
| 4 | Frame, then Start with the camera watch on; Abort latency | **Not run** (browser gate). The Z-rotary Frame fix (Z2-P3-2) was READ only. | — |
| 5 | Burn: placement, wrap, stretch, seam, dose, rows | **Pass on a straight glass; FAIL for a tumbler Fill** (see 2a/2b). | `j1`, `j2`, `j2b` |
| 6a | Abort mid-job → re-run | **Pass in-session** (Z2 measured; #1742 kept the path). Turn-back of 221.5° and 330° resolves at F1500 and the part ends at the start turn. | REPRO `j4-interrupt.mts` (c) |
| 6b | Abort → power-cycle/reconnect → re-run | **Pass (as designed).** Turn-back refused ("…Turn it back to where that job started by hand."); Start from line refused; Job Review says the controller restarted. | `out/j4-interrupt.txt` (b) |
| 6c | Start from line | **Pass.** A grblHAL, A1 Pro, FluidNC (G92 cleared) and Z GRBL: 43/43 strokes re-enter, worst 0.0000 mm. | `out/j4-interrupt.txt` (a) |
| 6d | Lost link → recovery | **Pass (refusal).** Without a start turn, the A/Z resume is refused. | `out/j4-interrupt.txt` (b) |
| 6e | Slow turn-back over 70° | **Pass at the jog feed; P3 when the axis rate is low** (Z4-P3-1): at `$113`=720°/min a correct 330° turn-back is reported as failed. | `out/j4-interrupt.txt` (c) |
| 6f | Pause/Resume | **Not run** (feed hold is not rotary-specific; no simulator run). | — |
| 7 | Save, reopen, autosave recovery, emit again | **Pass.** 7 setups (Y, Y Reverse + taper, A taper, A1 Pro, FluidNC, Z, Y roller): file and autosave both byte-identical; rotary kept; no load notices. | REPRO `j5-save.mts` → `out/j5-save.txt` |
| 8 | Export routes | **Equal across the G-code dialects** (GRBL, grblHAL, FluidNC, Marlin): the same lit count and length, including the same tumbler Fill loss. Smoothieware emits the same Y mapping (my reader needs M3; READ the program). Ruida `.rd` refuses Fill layers (experimental encoder; feed announced out of scope). Moshi Y rotary burns 97.7–100.0 % (#1744). | REPRO `j3-exports.mts` → `out/j3-exports.txt` |

## Findings

### Z4-P1-1 — On a tapered tumbler, a Fill at any angle but 90° silently loses most or all of its hatch: a 45° Fill burns one 1.2 mm stroke of 470, a 0° Fill 39 %, with no warning

- **Where** (c3856ce06):
  - `src/core/job/rotary-taper-warp.ts:85-89` warps every Fill segment with `warpSegment`. `:163-170` (`pushSplitEdge`) splits any edge with an X extent into a curve until each chord is within 0.001 mm (ADR-694 D6). So a 2-point hatch line that does not lie on the pivot row becomes a 3+ point polyline.
  - `src/core/job/fill-sweeps.ts:52` (`groupFillScanlines`): `if (a === undefined || b === undefined || seg.polyline.length !== 2) continue;`. Every such hatch line is silently dropped before emission.
  - `fill-sweep-plan.ts:53` → `grbl-fill-emission.ts:79` (`planFillSweeps`) then emits only the survivors.
- **Anchor:** ADR-694 D6 ("Cut and fill. Points are warped. An edge with an X extent becomes a curve and is split…"); the maintainer's goal of a tumbler burn.
- **Evidence (REPRO):**
  - `zz-z4\j2-taper-fill.mts` → `out\j2-taper-fill.txt`: Fill segments counted through `prepareOutput` → `machineSpaceJob` → `emitGcode`.
    - Ø88→72 (GRBL Y, A1 Pro A, calibrated roller): 0° keeps 419 segments in the machine-space job, but the program has 258 lit moves (2,193 of 5,624 mm).
    - 10°: 3 lit moves. 30°, 45°, 60°, 135°: 1 lit move. Cross-hatch: 2 lit moves. 90°: all 419.
    - Almost-straight Ø80→79.9: every line kept.
  - `j2b-taper-range.mts` → `out\j2b-taper-range.txt`, lit length as a share of the same job on a straight part:

    | Taper | 0° | 45° | 90° |
    |---|---|---|---|
    | Ø80→Ø79 | 100 % | 14.6 % | 100 % |
    | Ø80→Ø78 | 100 % | 0.4 % | 100 % |
    | Ø80→Ø76 | 100 % | 0.1 % | 101 % |
    | Ø80→Ø70 | 46.3 % | 0.0 % | 103 % |
    | Ø88→Ø72 | 39.0 % | 0.0 % | 105 % |

  - `j1-burn.mts` (real `prepareStartJob`, requireFrame=false):
    - `*/T88/fill45` gives `lit:1` on all five setups, Start OK.
    - Its warnings are only the generic scan-runway and scan-offset notes. Nothing rotary-specific comes from `detectRotaryRowStepWarnings`, `detectRotaryRasterQualificationWarnings` or `detectRotarySurfaceSpeedWarnings`.
    - The GRBL Y program is 15 lines: one S400 move of 1.2 mm between two laser-off moves.
  - `j3-exports.mts`: the same loss on grbl-v1.1, grblHAL, FluidNC and Marlin (Ø88→72: 0° 345 lit moves vs 511, 45° 94 vs 561, the survivors being the text).
- **Scenario:**
  1. A maker sets Taper on in Rotary Setup for an Ø88→Ø72 tumbler (or the ADR's own Ø80→Ø70 cup) and puts a filled logo on it at the default 0° hatch, or the common 45°.
  2. Frame traces the envelope and the canvas shows the whole logo.
  3. Start runs. At 0°, only a band of rows near the artwork's middle row burns; at 45°, nothing visible burns.
  4. The tumbler is spoiled, or must be re-run in register. Nothing warned.
  5. Any Fill on any taper steeper than about 1 mm over 120 mm is affected, on Y, A and Z, on every G-code controller.
- **Severity reasoning:** P1. It harms the job (METHOD §3): the burn is missing or partial on the part. The UI shows the full Fill, the program passes preflight and Start, and no warning names it. Tumbler wraps with filled logos are the main tapered-part use case.
- **Announced?** No. ADR-694 D6 says fills are warped and split; it never says split hatch lines are dropped. ADR-694's golden check compares 1.0.30 files, which have no taper.
- **Novelty:** New. It comes from ADR-694 (taper warp) meeting the scanline grouping (ADR-034/035), not from the v14 fix PRs. Z3 and v13 Y5 measured the dose of the strokes that remained, but never counted them.
- **Fix direction:**
  - Keep a warped hatch line a Fill run. For example, split each warped Fill polyline into its 2-point chords in order before `groupFillScanlines`, so each chord is its own run or sweep, or let the scanline grouping accept a polyline run.
  - Or route warped Fill groups through the polyline (cut-style) emitter at the Fill's speed and power.
  - Add an invariant: the emitted lit length of every Fill group equals its machine-space segment length within tolerance (a preflight or compile-integrity code).
  - Test: a tapered Fill at 0°, 45°, cross-hatch and 90° on Y, A and Z burns the same length as the warp's own segments.

### Z4-P3-1 — The turn-back after Abort waits for the jog feed, not the rotary axis's own max rate: on an A axis slower than about 810°/min, a correct long turn-back is reported as failed

- **Where:** `src/ui/laser/abort-rotary-turn.ts:113-119`. `turnMs = (|back| / feed) × 60 000`, with feed = `clampJogFeed(1500, maxFeed)`, and the wait is `turnMs × 1.5 + 5 s`. The controller's planner holds the jog to `$113` (A) or `$112` (Z). KerfDesk already reads both (`maxRateA` / `maxRateZ`; ADR-695 Amd 1 D5), but not here.
- **Anchor:** ADR-695 Amd 2 D3 ("The turn-back waits for its motion").
- **Evidence (REPRO):** `j4-interrupt.mts` (c): the real `turnRotaryBackToJobStart` and the real `waitForControllerStatus` (real clock), with a stub `jog()` that takes |Δ| / min(feed, axis rate).
  - At `$113`=36000: 221.5° resolves in 8.9 s and 330° in 13.2 s, part at the start turn.
  - At `$113`=720°/min, 330° needs 27.5 s. KerfDesk throws "The rotary did not finish turning back. Check the part." at 24.8 s, and the part then ends at the start turn.
  - Z at `$112`=500 passes for 38 and 75 mm. It fails only with a long per-turn Z travel (over about 90 mm at 500 mm/min).
- **Scenario:** a grblHAL or FluidNC rotary configured slow (a heavy chuck), Abort late in a wrap, then Restore. The operator is told the turn-back failed when it did not, and the Frame offer then refuses to Frame (as in Z2-P2-1). Framing again works.
- **Severity reasoning:** P3. Nothing burns in the wrong place, and the message is a false failure. It needs an axis rate below about 810°/min (or a long Z per turn), which is less common than the Z2-P2-1 case #1742 fixed.
- **Announced?** No. **Novelty:** a residual of Z2-P2-1, left by #1742's fix.
- **Fix direction:** time the wait with min(jog feed, `$113`/`$112` when read), or keep waiting while the status reports Jog/Run and the axis is moving.

## KNOWN: status of each v14 Z1–Z3 item after its fix

| ID | Fix | Status on c3856ce06 | Evidence |
|---|---|---|---|
| Z1-P1-1 overlay shrinks bridge pictures on the UI thread | #1740 | **Fixed by reading** (resize moved to the picture worker, `picture-work.ts`, `machine-frame-feed.ts`). **Not re-measured** in a browser (memory gate). | READ |
| Z1-P2-1 camera start/switch decodes on the UI thread for the moved check | #1740 | **Fixed by reading:** `helpers/moved-check-capture.ts:47-63` captures and thumbnails in the worker. The in-window path is used only when no worker client exists. Not re-measured. | READ |
| Z1-P2-2 Alt+C / Refresh picture decodes on the UI thread | #1740 | **Fixed by reading:** `capture-overlay-still.ts:33-34` (`captureHeldPicture` → `captureStill` in the worker); `refresh-picture.ts:26` uses it. Not re-measured. | READ |
| Z2-P1-1 stale start turn after power-up/reconnect | #1742 | **Fixed.** With the epoch moved: `abortRotaryZero()` is undefined, Start from line is refused, `turnRotaryBackToJobStart` refuses with the hand-turn message, and Job Review says the controller restarted. Same session: 0.0000 mm. | REPRO `j4` (a)(b) |
| Z2-P2-1 3 s turn-back wait | #1742 | **Fixed at the jog feed** (221.5° and 330° resolve). Residual when the axis rate is below the jog feed: Z4-P3-1. | REPRO `j4` (c) |
| Z2-P3-2 (P2) Z-rotary first Frame refused | #1742 | **Fixed by reading:** `framed-run-rotary.ts`; `framed-run.ts:253-263` zeroes Z in both snapshots for a Z-rotary job. The PR's simulator test exists but was not run (Vitest gate). | READ |
| Z3-P1-1 ramped Fill keeps its hatch angle on a rotary | #1743 | **Fixed.** Ramp 45° = ramp 0° rows on all 5 setups (e.g. A: 0.07–42.90°, rows 0.0998–0.1005 mm), with the notice. `mapRasterGroup` throws for any turned raster (`rotary-transform.ts:157-161`). None reached it. | REPRO `j1` |
| Z3-P1-2 Moshi Y rotary: one speed per layer | #1744 | **Fixed.** Strokes round the part burn at 99.5 % (40 mm/turn chuck), 97.7–99.5 % (80 mm/turn), 99.8–99.9 % (roller), with the "runs as N programs" advisory. | REPRO `j3` Moshi table |
| Z3-P2-1 0° Fill rows not checked against the steps | #1745 | **Fixed.** "Fill layer Logo on this rotary: one Y step ($101 = 80 steps/mm) turns the part 0.0785 mm, and the 0.1000 mm Interval is 1.27 steps…", also on A and Z. Re-typed advice not re-measured. | REPRO `j1` warnings |
| Z3-P3-4 row warning names an internal id, calls a ramp an Image | #1745 / #1743 | **Fixed:** names "Fill layer Logo" and "Image layer Photo". | REPRO `j1` |
| Z3-P3-1, Z3-P3-2, Z3-P3-3 | #1745 (ADR-315 Amd 3, ADR-127 Amd 4) | **Fixed by reading** (every-phase advice; a rise must round above 100 %; the notice reads the strokes). New projects reopen with no notice. Not re-measured against 1.0.30 files. | READ; `j5` |
| Z2-P3-1 wording | #1742 | **Partly fixed:** the Restore tooltip now says the part turns back (`AbortStoppedCard.tsx:179-185`). The other lines were not re-read. | READ |
| Z2-P3-3 Review recovery dead end on A/Z | — | **Open.** ADR-695 Amd 2 sends it to the P3 sweep. | READ |
| Z1-P3-1, Z1-P3-2 | — | Outside #1740's ADRs; not re-checked. | — |

## Refuted (my own leads)

- **"Text on a tumbler lands 0.26 mm off".** This was harness sampling, not burn error: 0.026 mm at a 10× finer sample, against ADR-694's model.
- **"Smoothieware emits no burn on a rotary".** My reader needs M3. Smoothieware's program is `fire off`, `M221`, then `G1 … Y3.979 F190 S300`, the same Y mapping as GRBL.
- **"Moshi on a taper burns at 90 %".** My simplified model put the stroke at the reference Ø, past the cone's end. KerfDesk's own advisory says 98–108 %. Not raised.
- **"Absolute on a Y rotary turns the part about 3 turns back".** This is the announced ADR-127 rebase. ADR-228 Amd 2/3 warns about it when the camera is used.
- **"Image rows on a tumbler are finer than set at the narrow end".** Announced in ADR-694 D7 (r/R).
- **L12 #1736:** Run again carries the review only when the warning set is identical (`run-again-review-carry.ts:120-136`). A new rotary warning re-opens the dialog.
- **L12 #1733:** a jog never keeps the Frame of a rotary job (`jog-held-frame.ts:74`).
- **L12 #1732:** the automatic Abort restore excludes rotary jobs (`abort-auto-restore-eligibility.ts:84`).
- **L12 #1735:** it does not touch `machineZeroEpoch`. The epoch moves only at connect (`laser-connection-actions.ts:233`) and at an unowned reset banner (`laser-line-handler.ts:440`).

## Verified clean

- **The burn on a straight glass.** On 5 setups × 7 designs:
  - placement error ≤ 0.003 mm;
  - seam stroke exactly 360.000°;
  - dose 1.000–1.005 with the planner caps on;
  - A/Z programs never command head Y;
  - A jobs end with `G0 X0 A0`, so Run again re-zeroes the same turn.
- **Tumbler.** Text, photo, ramped Fill and 90° Fill are whole. The wrap warning's turn count matches the measurement.
- **Axis detection and the A1 Pro preset.**
- **Placement.** Current Position puts the centre at the head and the current turn on Y, A and Z. The camera advice follows the axis.
- **Interruptions.**
  - Start from line re-enters at 0.0000 mm on A (G92 kept or cleared) and on Z.
  - After a restart, the turn-back and Start from line are refused, and Job Review gives the hand-turn message.
  - Lost-link resume on A/Z is refused.
- **Save, reopen and autosave recovery:** byte-identical on 7 setups.
- **Exports:** the G-code dialects agree. Moshi's feed is matched. Ruida `.rd` refuses Fill layers.

## Not verified

- **Browser runs, all under the memory gate** (0.40–0.72 GB free; the gate is 2 GB):
  - stub-camera placement in the browser;
  - Frame → Start with the camera job watch on;
  - Abort latency and lit stops (50 ms budget);
  - window vs worker streaming routes.
- **The full-store simulator journey** (connect → Frame → Start → Abort → reconnect) and #1742's own simulator tests: Vitest gate (1.5 GB).
- **Pause/Resume** (feed hold).
- **Real text objects** (fonts). The designs used outline polylines, which is what text compiles to.
- **Homing on a Z rotary:** whether `$H` on stock GRBL with Z in its homing cycle turns a Z rotary while it looks for a switch.
- **A USB-powered board whose laser PSU is switched off and on:** the board does not reset, so the epoch does not move, while the steppers lose hold.
- **Hardware:** any real rotary, a real A1 Pro, real cameras.
- **Moshi on a taper,** or with Fills.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z4\`. Run with `node --no-experimental-webstorage --import ./register.mjs <file>`.

- `register.mjs`, `ts-resolve.mjs`: loader, copied from `zz-z3` and pointed at `j27-main`.
- `z4lib.mts`: own G-code reader, rotary physics and scene builders.
- `j1-burn.mts` → `out\j1-burn-full.txt`: burn matrix, 5 setups × 2 parts × 7 designs, with Start and Job Review warnings. Argument `dump` writes the programs (`out\j1-*.gcode`).
- `j2-taper-fill.mts` → `out\j2-taper-fill.txt`: Fill segments through compile, machine space and emit, per angle.
- `j2b-taper-range.mts` → `out\j2b-taper-range.txt`: Fill burned vs taper steepness.
- `j3-exports.mts` → `out\j3-exports.txt`: G-code dialects, Ruida `.rd`, Moshi decode.
- `j4-interrupt.mts` → `out\j4-interrupt.txt`: Start from line, restart refusal, turn-back timing.
- `j5-save.mts` → `out\j5-save.txt`: save, reopen and autosave.
- `j6-placement.mts` → `out\j6-placement.txt`: axis detection, placement and camera advice.
- `dbg-flat.mts`, `dbg-smoothie.mts`: the scene-Y orientation check, and Smoothieware output inspection.

```json
{
  "area": "Z4",
  "tree": "c3856ce06",
  "raised": 2,
  "findings": [
    {"id": "Z4-P1-1", "severity": "P1", "title": "Tapered tumbler: Fill hatch lines split by the taper warp are dropped by groupFillScanlines (45° Fill burns 1 of 470 strokes, 0° Fill 39 %), no warning", "where": ["src/core/job/fill-sweeps.ts:52", "src/core/job/rotary-taper-warp.ts:85-89", "src/core/job/rotary-taper-warp.ts:163-170"], "evidence": "REPRO j1/j2/j2b/j3", "announced": false, "novel": true},
    {"id": "Z4-P3-1", "severity": "P3", "title": "Turn-back wait ignores the rotary axis max rate ($113/$112): a correct 330° turn-back at $113=720 is reported as failed", "where": ["src/ui/laser/abort-rotary-turn.ts:113-119"], "evidence": "REPRO j4(c)", "announced": false, "novel": true}
  ],
  "known": {
    "fixed": ["Z2-P1-1", "Z2-P2-1 (at jog feed)", "Z3-P1-1", "Z3-P1-2", "Z3-P2-1", "Z3-P3-4"],
    "fixed_by_reading": ["Z1-P1-1", "Z1-P2-1", "Z1-P2-2", "Z2-P3-2", "Z3-P3-1", "Z3-P3-2", "Z3-P3-3"],
    "partly_fixed": ["Z2-P3-1"],
    "open": ["Z2-P3-3"],
    "not_rechecked": ["Z1-P3-1", "Z1-P3-2"]
  },
  "verdict": {
    "straight_glass": {"GRBL-Y": "perfect", "grblHAL-A": "perfect", "A1Pro-A": "perfect (model; Test rotation confirm required; no real A1 Pro)", "FluidNC-A": "perfect (steps/rates unread, announced)", "GRBL-Z": "perfect"},
    "tapered_tumbler": "Fill (any angle but 90°) lost on every controller and axis; text, photo, ramped Fill fine",
    "interruptions": "in-session Abort/re-run and Start from line exact; after restart refused with hand-turn message (by design)",
    "not_measured": "browser: camera watch Abort latency/lit stops, worker streaming route"
  }
}
```

Auditor counts: raised 2, P1 1, P2 0, P3 1, known 17

## Refuter (2026-11-11)

### Tree and harness

- **Tree:** scratchpad export `j27-main` (origin/main @ `c3856ce06`), read-only. History was read with read-only `git log` in the main checkout.
- **Own harness** in `zz-z4r\`, written for this refutation. The auditor's `z4lib.mts` was read for the product APIs only; none of the auditor's scripts was run.
  - **Reader (`rlib.mts` `readTape`):** a minimal "burn tape" interpreter.
    - It tracks machine X/Y/Z/A with G90/G91 and G92 offsets, the G0 vs G1–G3 modal, and S and F.
    - M3/M4 enable the laser and M5 disables it; on Smoothieware, S on G1 fires.
    - A move is lit when it is a feed move with S > 0 and the laser enabled. Arcs are counted, not interpolated. None occurred.
  - **Physics (`rlib.mts` `coverage`):** a surface-coverage model, which is a different method from the auditor's stroke and dose matching.
    - Every lit move is laid on the part in (x, s), where s = θ·r(x) is surface mm round the part at that height and θ comes from the turn axis (a chuck turns 2π per unit-per-turn).
    - The move is stamped as a 0.1 mm beam disc every 0.01 mm into a 0.02 mm grid. Because the grid's Jacobian is r(x), the covered area is true surface area, whatever the start turn.
    - Truth comes from ADR-694: a design D mm tall burns D mm round the part at every height. So the covered area should equal the design area.
  - **Steps:** grblHAL's planner rounding, lround(A·$103), for the rows. Whole mils for Moshi.
  - **Turn-back:** a trapezoid jog at min(F, axis rate) with the axis acceleration.
- **Own designs:**
  - a 40 × 25 mm badge with an Ø12 hole (886.98 mm²);
  - plain 40 × 25 and 10 × 25 boxes;
  - an A1 Pro full-wrap outline exactly π·80 tall, with an "F" orientation marker and a 30 × 30 Jarvis photo.
- **Own parts:**
  - S90, a straight Ø90 glass;
  - T90-70, Ø90→Ø70 over 150 mm (rim left, art 20 mm from the rim);
  - P86-64, a pint glass, Ø86→Ø64 over 150;
  - N76-75, almost straight, Ø76→Ø75 over 120.
- **Product entry points:**
  - `prepareStartJob` (Start's own compile, emit and warnings; requireFrame=false);
  - the Job Review rotary detectors;
  - `buildPreviewToolpathUnbounded` and `summarizeToolpathDistances` (the Preview);
  - `prepareStartJob(...).metrics` (the Frame rectangle and the ETA);
  - `rotaryTaperProfile` and `applyRotaryTaperWarp`;
  - `emitPreparedMoshiJob` + `decodeMoshiProgram`;
  - `serializeProject` / `deserializeProject`.
- **Run:** `node --no-experimental-webstorage --max-old-space-size=700 --import ./register.mjs <file>`. Memory was 2.6–3.2 GB free. No Vitest, browser, hardware or network was used.

### Verdicts

**Z4-P1-1: CONFIRMED P1.** The Fill loss is real through Start's own path. The auditor's headline numbers are design-specific: a 0° Fill can lose far more than 61 %. Introduced by **#1670** (the ADR-694 taper warp, merge `ba200a019`, commit `a4edad1a5`, 2026-11-10), not by #1743/#1745.

- **Mechanism (READ, c3856ce06):**
  - `rotary-taper-warp.ts:85-89` warps every Fill segment.
  - `:163-179` (`pushSplitEdge`) adds a vertex wherever the warped chord is more than 0.001 mm off the curve. `:170` is the only early return, and it fires only when a.x === b.x, which is why 90° survives.
  - `fill-sweeps.ts:52` drops every polyline with more than 2 points.
  - `fill-sweep-plan.ts:53` feeds that into `grbl-fill-emission.ts:73`.
  - `git log -L52,52:src/core/job/fill-sweeps.ts` shows that line unchanged since `bbccf42b6` (ADR-034, 2026-06-03).
  - After `ba200a019`, no commit touches `fill-sweeps.ts`, `fill-sweep-plan.ts`, `rotary-taper-warp.ts` or `grbl-fill-emission.ts`. The one later commit in the log is #1672 (`b4c7f7a36`, surface-matched feed), which touches only `rotary-job.ts`.
  - #1670's own `emit-gcode-rotary-taper.test.ts` has no Fill or hatch case (grep: 0 hits).
- **REPRO, real `prepareStartJob`, own reader and coverage model** (`r1-taper-fill.mts` → `out\r1-taper-fill.txt`; 5 controllers × 4 parts × 6 hatches). The badge's covered area as a share of the design:

  | part | 0° | 30° | 45° | 90° | 45° cross | 0° + Ramp |
  |---|---|---|---|---|---|---|
  | S90 | 1.004 | 1.006 | 1.006 | 1.005 | 1.008 | 1.003 |
  | T90-70 | **0.352** | **0.003** | **0.003** | 1.005 | **0.006** | 1.004 |
  | P86-64 | **0.289** | **0.002** | **0.002** | 1.005 | **0.005** | 1.004 |
  | N76-75 (Ø1 over 120) | 1.002 | **0.041** | **0.042** | 1.005 | **0.085** | 1.005 |

  - The rows are identical, to the third decimal, on grbl Y, grblHAL A, grbl Z, Marlin Y and Smoothieware Y.
  - Start returns ok every time, so preflight passes.
  - Job Review's rotary lines on GRBL/grblHAL say nothing about the tapered Fill. They give only the 0° step note on the straight part and the ramp's raster note. On Marlin and Smoothieware, the only line is the generic "could not read … steps ($101)".
- **Which 0° rows survive, and why** (`r2-rows.mts` → `out\r2-rows.txt`):
  - A 0° row at d = y − pivot over a span from a to b keeps 2 points only while |d|·R·|1/r(m) − (1/r(a)+1/r(b))/2| ≤ 0.001 mm. The band shrinks with the square of the span length: on T90-70 it is ±0.95 mm for a 40 mm span, ±8.2 mm for 14 mm, and ±66 mm for 5 mm.
  - The pivot is the job's middle row for Absolute (`rotary-taper-warp.ts:68`) and the anchor row for Current Position.
  - **Solid 40 × 25 box, 0°:** 18 of 250 rows burn (7 %) under Absolute or Current Position centre. Under Current Position front-left, only **10 of 250 (4 %)**, all on one edge, because the pivot is the anchor row.
  - **Narrow 10 × 25 box:** all 250 rows survive under Absolute.
  - **Badge with a hole:** 102 rows survive whole and 5 partly. The survivors are mostly the short spans beside the hole, so the burn is a ring round the hole and the outer field is lost.
  - The auditor's 39 % (and my 35 %) are artefacts of logos with holes. The general result is that only fills narrower than about 10 mm along X survive at 0°.
- **What the operator sees before output** (`r3-frame-eta.mts`, `r1` preview column):
  - **Preview: shows the whole hatch.**
    - `buildPreviewToolpathFromPrepared` builds the route from `prepared.job`, the surface job before the warp (`draw-preview.ts:223`).
    - Measured on T90-70: the Preview's cut length is 8,870.6 mm for 0°, 45° and 90° alike, while the 0° program burns 3,111.9 mm (along X, so the same units).
    - The plan-preview comparison keeps the old route on any mismatch (`executable-plan-preview-route.ts:76-80`).
    - So Preview ≠ output, against ADR-040.
  - **Frame (not a warning, METHOD G6):**
    - At 0° the traced Y range shrinks to the surviving band: 1.43–3.42 of the straight 0–4.40 machine mm. This is because `job-bounds.ts:235-238` bounds a feed-matched Fill by its planned sweeps.
    - At 45° the Frame traces the full envelope, because the surviving pieces are short corner spans.
    - So the auditor's scenario step 2 ("Frame traces the envelope") holds only for angled hatches.
  - **ETA (not a warning):** 10.5 s for the 45° tumbler Fill against 362 s straight; 195 s against 275 s at 0°.
  - **No warning names it:**
    - `hatchRowPositions` (`rotary-row-step-warnings.ts:176`) skips warped rows, so even the surviving rows get no step check.
- **Is the taper on by default?** No.
  - No rotary preset carries a taper (`rotary-presets.ts`: no `taper`).
  - "Tapered part" is opt-in in Rotary Setup.
  - `newRotaryTaper` (`rotary-taper-edit.ts:17-26`) starts straight (top = bottom = Object diameter, 100 mm), so nothing warps until the operator enters both ends.
  - METHOD §3 has no reach clause, so this does not lower P1.
- **Controllers and axes:**
  - Every G-code route shares `groupFillScanlines` through `planFillSweeps`: grbl-v1.1, grblHAL and FluidNC by the shared strategy; Marlin and Smoothieware measured. So do Y, A and Z.
  - **Moshi does not share it.** `moshi-vector-plan.ts:31-48` burns each segment's polyline point to point, with no `groupFillScanlines` (REPRO `r4-moshi.mts`).
    - On T90-70 the Moshi Fill is whole: 0° 791 cut steps, coverage 0.80; 45° 0.92; 90° 0.99.
    - The shortfall from 1.0 is Moshi's row quantisation (Z4-P2-1 below), not hatch loss.
    - But a 45° Fill becomes **3,415 programs**. That is announced by the "runs as N programs" advisory.
  - Ruida `.rd` refuses Fill layers, as the auditor said.
- **Unaffected (REPRO):**
  - ramped Fills (raster), 90° Fills, and Offset-style Fills (`r8-offset-fill.mts`: 0.998 on T90-70);
  - narrow 0° Fills under about 10 mm of X.

**Z4-P3-1: CONFIRMED, re-rated P2.** The defect is real (READ `abort-rotary-turn.ts:108-121`).

- **The wait:** `turnMs × 1.5 + 5 s` at F = `clampJogFeed(1500, maxFeed)`. `$113`/`$112` are parsed (`parse-settings.ts:359`) but not used there.
- **Own model** (`r7-turnback.mts`): a trapezoid jog at min(F1500, rate).
  - Tuned axes pass: at `$113` = 36000 or 1500, a 330° turn-back takes 13–16 s against a 24.8 s wait.
  - At 800°/min, 330° fails.
  - At 500°/min, every turn-back from about 85° fails: 90° takes 10.8 s against a 10.4 s wait, and 180° takes 21.6 s against 15.8 s.
  - At 300°/min, even 45° fails.
- **Why P2, not P3:**
  - The symptom and consequence are exactly Z2-P2-1's, which the ledger rated P2: a correct turn-back reported as "did not finish… Check the part.", the Frame offer refused, and an invitation to turn the part by hand.
  - It is reachable today, so it is not latent, and METHOD §3 gives P3 only to latent defects or polish.
  - KerfDesk's own Job Review keeps users on a slow axis. At `$113` = 500 it says "set this layer to 349 mm/min or less, or raise $113" (REPRO `r7`, real `detectRotarySurfaceSpeedWarnings`). An operator who takes the first option keeps the slow axis and meets the false failure on most re-runs.
  - I recall grblHAL's shipped `DEFAULT_A_MAX_RATE` is 500. That is **not verified** in this tree (no grblHAL source here). GRBL 1.1 generic `DEFAULT_Z_MAX_RATE` is 500 (`grbl-src/defaults.h:37`), but Z per-turn travel rarely exceeds the about-83 mm threshold.
- **Recovery:** clicking Restore again returns at once, because delta is under `SAME_TURN`. Framing again works.

### Challenges to the "Perfect" verdicts

- **A1 Pro, full wrap + Reverse + Current Position + suggested interval + save/reopen.** `r6-a1pro-wrap.mts` → `out\r6-a1pro-wrap-10.txt`, `-6.37.txt`. The verdict holds.
  - **Seam:** the wrap edges sit at A −180.0000 and +180.0000, so |ΔA| = 360.0000° with or without Reverse. The design centre is at the current turn (one `G92`). X is centred at the head (shift 52.5 → head X 150).
  - **Reverse:** on a reversed mount (part angle = −A), the Reverse job puts the marker's top, middle and foot at the same physical angles (94.056°, 108.380°, 122.704°) as the normal job on a normal mount.
  - **Photo rows:**
    - At 10 lines/mm, Job Review warns ("1.27 steps… For even rows, set the line interval to 0.1569 mm (6.37 lines/mm, 2 steps)"). Measured: 300 rows, step gaps 1×217 and 2×82.
    - At the suggested 6.37 lines/mm there is no row warning, and the rows are 191 distinct steps, 2×189 and **one 3-step gap**.
    - That single 0.235 mm band is inside the check's designed tolerance (`OFF_GAP_SHARE = 0.02`, `rotary-row-placement.ts:20,80-83`). Not raised.
  - **Save/reopen:** byte-identical programs, Reverse on and off.
- **Straight glass on Moshi: broken** (new **Z4-P2-1**). The report's Verified clean says "Moshi's feed is matched" and journey row 8 says "Moshi Y rotary burns 97.7–100.0 %". That is true for dose per stroke but not for rows.
  - On a Y chuck, Moshi positions are whole mils of machine Y, so a 0.1 mm Fill or Image interval round the part collapses.
  - Measured on a 40 mm/turn chuck with Ø80: 200 rows land on 126 distinct mils, 0.160 mm apart, and **74 rows burn twice on the row before**.
  - My coverage model independently gives 0.70 of the area for a straight-glass 0° Moshi Fill (`r4`).
  - No advisory appears, and the Moshi route has no Job Review.

### Challenges to KNOWN

- **Z1-P2-2 "Fixed by reading": concur.**
  - `capture-overlay-still.ts:33-34` sends `captureHeldPicture` to `captureStill`.
  - `still-capture.ts:42-62` runs `client.run({ op: 'still', … })` in the picture worker and falls back to the window only with no client or a failed reply.
  - `refresh-picture.ts:26,33` uses it.
- **Z2-P3-2 "Fixed by reading": concur, with a path correction.** The file is `src/ui/state/framed-run.ts:248-267` (and `src/ui/state/framed-run-rotary.ts:21-41`), not `ui/laser`.
  - Z is zeroed in both snapshots only in `framedRunCompletionIssue`.
  - I also checked the Start handoff, `framedRunStartHandoffIssue` (`:271-289`). Its permit snapshot is taken at Frame completion (`createFramedRunPermit` `:204-213`), after the Frame's `G92 Z0`, so the later comparison does not trip on Z.
  - The simulator test was not run.

### New findings

#### Z4-P2-1 — Moshiboard Y rotary: Fill and Image rows are rounded to whole mils of machine Y, so on a chuck 74 of 200 rows burn twice and rows sit 0.16 mm apart instead of 0.10, with no advisory

- **Where** (c3856ce06):
  - The Moshi programs carry absolute mils (ADR-705 base, "native units are mils").
  - `emit-moshi.ts:43-56` encodes the machine-space job and runs only `runMoshiPreflight` plus the encoder notes.
  - `moshi-usb-job.ts:20-38` (Moshi Start) has no Job Review.
  - The rotary row check (`rotary-row-step-warnings.ts:62-96`, ADR-315 Amd 1 and #1745) exists only on the G-code Job Review path.
- **Anchor:**
  - ADR-315 and its Amendment 1: rows that do not fit the rotary's steps are disclosed, as #1745 did for Fill on G-code (Z3-P2-1, P2).
  - ADR-705 Amd 1 D2 ("Said, not hidden").
- **Evidence (REPRO):**
  - `r5-moshi-rows.mts` → `out\r5-moshi-rows.txt`: real `prepareOutput` → `emitPreparedMoshiJob` → `decodeMoshiProgram`, rows counted by own code.

    | Moshi rotary | distinct burned rows / 200 | rows burned twice | row pitch round the part |
    |---|---|---|---|
    | chuck 40 mm/turn, Ø80 | 126 | 74 | 0.160 mm |
    | chuck 50 mm/turn, Ø90 | 140 | 60 | 0.144 mm |
    | roller 150 mm/turn, Ø26 | 200 | 0 | 0.097 / 0.111 mm |
    | flat bed | 200 | 0 | 0.102 / 0.076 mm |

  - `r5b-moshi-image.mts` → `out\r5b-moshi-image.txt`: an Image layer at 10 lines/mm gives the same 126 distinct rows of 200 on the chuck.
  - Advisories are "—" in every case.
  - `r4`: a straight-glass 0° Fill covers 0.70 of its area.
- **Scenario:**
  1. A K40 Moshiboard with the usual chuck rotary on the Y port (Rotary Setup offers Y for Moshi; #1744 used the same 40 mm/turn chuck).
  2. A filled logo or a photo at the default 0.1 mm interval on a straight glass.
  3. Start sends the programs with no warning. The result is a visibly striped burn, coarser rows, and double dose on 37 % of the rows.
- **Severity:** P2, as Z3-P2-1 (the identical G-code row-step defect). The step grid is the hardware's, the output is banded and partly double-dosed, and the app's own check exists but does not run on this route.
- **Announced?** No. ADR-705 Amd 1 states only speed quantisation; its Context line 19 says "the Moshi route has no Job Review".
- **Novelty:** New. It is the Moshi twin of Z3-P2-1, which #1745 fixed for G-code only. The v14 Z3/Z4 Moshi checks measured strokes, not rows.
- **Fix direction:**
  - Run the ADR-315 row check on Moshi with a step of one mil × k (k = surface mm per machine mm), and add its sentence to the Moshi advisories.
  - Or snap the rotary's Fill and Image interval to whole mils on the part, with the notice.
  - Test: decode a Moshi chuck job and assert that no two rows share a mil, or that the advisory is present.

### Not verified

- **Browser:** the canvas Preview and the plan-preview mismatch (REPRO used `buildPreviewToolpathUnbounded`), and the Job Review stat tiles as rendered.
- **Vitest and simulator runs**, including #1742's turn-back tests.
- **grblHAL's shipped `DEFAULT_A_MAX_RATE`** (recalled as 500; not in this tree). FluidNC rotary rates.
- **Moshi on hardware:**
  - whether the board's motor step grid equals the mil grid;
  - how a doubled row looks on glass;
  - whether 3,415 programs for one 45° tapered Fill are practical;
  - Moshi Image rows on a taper.
- **The tapered-part coverage model:** for Moshi, the cone's X origin was taken from the decoded minimum X minus 20 mm; for G-code it was taken from the design.
- **Hardware:** any real rotary or A1 Pro.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z4r\`.

- `register.mjs`, `ts-resolve.mjs`: loader copied from `zz-z4`.
- `rlib.mts`: own reader (`readTape`), surface-coverage model, scene builders.
- `r1-taper-fill.mts` → `out\r1-taper-fill.txt`: Fill coverage, Preview length and Job Review lines; 5 controllers × 4 parts × 6 hatches.
- `r2-rows.mts` → `out\r2-rows.txt`: which 0° rows survive, by placement and design width, plus the analytic band.
- `r3-frame-eta.mts` → `out\r3-frame-eta.txt`: Frame rectangles, ETA and lit extent.
- `r4-moshi.mts` → `out\r4-moshi.txt`: Moshi Fill on a straight glass and the tumbler.
- `r5-moshi-rows.mts`, `r5b-moshi-image.mts` → `out\r5-moshi-rows.txt`, `out\r5b-moshi-image.txt`: Z4-P2-1.
- `r6-a1pro-wrap.mts [linesPerMm]` → `out\r6-a1pro-wrap-10.txt`, `out\r6-a1pro-wrap-6.37.txt`: A1 Pro wrap, Reverse, Current Position, suggested interval, save/reopen.
- `r7-turnback.mts` → `out\r7-turnback.txt`: turn-back wait vs the motion model, and the `$113` advice.
- `r8-offset-fill.mts` → `out\r8-offset-fill.txt`: Offset Fill on the tumbler.

```json
{
  "area": "Z4",
  "refuter": "2026-11-11",
  "tree": "c3856ce06",
  "verdicts": [
    {"id": "Z4-P1-1", "verdict": "CONFIRMED", "severity": "P1", "introduced_by": "#1670 (ADR-694 taper warp, merge ba200a019, commit a4edad1a5); fill-sweeps.ts:52 unchanged since bbccf42b6 (ADR-034)", "evidence": "REPRO r1/r2/r3 via prepareStartJob + own reader + own coverage model", "corrections": ["0° loss is design-dependent: a solid 40 mm-wide 0° Fill keeps 7 % (Absolute) or 4 % (Current Position front-left); the 39 % comes from logos with holes", "Preview shows the full hatch (preview != output, ADR-040)", "Frame shrinks to the surviving band at 0°, full envelope at 45°; ETA 10.5 s vs 362 s", "Moshi does NOT share it (moshi-vector-plan.ts burns polylines); every G-code dialect and Y/A/Z does", "taper is opt-in, no preset carries it; P1 stands (no reach clause)", "Offset-style Fills unaffected"]},
    {"id": "Z4-P3-1", "verdict": "CONFIRMED, re-rated P2", "severity": "P2", "evidence": "READ abort-rotary-turn.ts:108-121 + own motion model r7; Job Review's own advice at $113=500 keeps the slow axis", "reason": "same symptom and consequence as Z2-P2-1 (P2), reachable today"}
  ],
  "new_findings": [
    {"id": "Z4-P2-1", "severity": "P2", "title": "Moshiboard Y rotary: Fill/Image rows rounded to whole mils; on a 40 mm/turn chuck with Ø80, 74 of 200 rows burn twice and rows sit 0.160 mm apart, no advisory", "where": ["src/io/moshi/emit-moshi.ts:43-56", "src/ui/state/moshi-usb/moshi-usb-job.ts:20-38", "src/ui/laser/job-review/rotary-row-step-warnings.ts:62-96 (G-code only)"], "evidence": "REPRO r5/r5b/r4", "announced": false, "novel": true}
  ],
  "perfect_challenges": {"A1Pro_wrap_reverse_currentpos_saveopen": "holds (360.0000°, Reverse mirrors correctly, byte-identical reopen; one tolerated 3-step gap at the suggested interval)", "Moshi_straight_glass": "broken by Z4-P2-1"},
  "known_spot_checks": {"Z1-P2-2": "concur fixed by reading", "Z2-P3-2": "concur fixed by reading; path is src/ui/state/framed-run.ts:248-267; Start handoff also safe"},
  "counts": {"raised": 3, "refuted": 0, "P1": 1, "P2": 2, "P3": 0, "known": 17}
}
```

Refuter counts: raised 3, refuted 0, P1 1, P2 2, P3 0, known 17
