# Controller audit v4 — E6 Time estimate (`ctl-time-estimate`)

- **When:** 2026-10-23   **Tree:** origin/main @ `71ff820ce` (audit worktree HEAD `3f76fd421`, docs only).
  `git diff 71ff820ce 6649d6590 -- src/core/gcode-time src/core/motion-planner` is empty. Newer main
  (`6649d6590`) changed three consumer files: `gcode-inspection-source.ts`, `gcode-inspector-parse.ts`
  and `RunGcodeFileSummary.tsx`. Main's versions were re-read, and P3-1 and P3-2 still hold there.
- **Scope:**
  - `src/core/gcode-time/**` and `src/core/motion-planner/**`.
  - Consumers:
    - Job Review: `start-job-preparation.ts`, `prepared-job-metrics.ts`, `canvas-job-timing-plan.ts`.
    - Pre-run tile: `live-job-estimate.ts`.
    - Live countdown: `live-job-timing.ts`, `live-canvas-run-timing.ts`.
    - Run review: `RunGcodeFileDialog.tsx`, `RunGcodeFileSummary.tsx`.
    - Inspector: `gcode-inspector-parse.ts`, `gcode-inspector-analysis.ts`, `gcode-inspection-source.ts`.
    - Import preview: `gcode-preview-timing.ts`.
    - Advisories: `stream-throughput-warnings.ts`.
    - Recovery: `planner-backlog-restart.ts`.
  - Governing documents:
    - ADR-525: time estimates model the planner buffer.
    - ADR-255: shared motion planner.
    - ADR-425 decision 2 and its Consequences: the Inspector times for the device as Job Review does.
    - ADR-432: laser G2/G3 timed as `mc_arc`.
    - ADR-630: the Run dialog shows an estimated time.
    - WORKFLOW.md §§ around lines 2430–2520 (estimate, dwell units, countdown) and 9320 (Run dialog).
- **Primary sources fetched this session:**
  - gnea/grbl master: `planner.c`, `nuts_bolts.c`, `config.h`, `motion_control.c` and `gcode.c`.
  - grblHAL core master: `planner.c`, `config.h` and `nuts_bolts.c`.
  - FluidNC main: `MotionControl.cpp`.
  - LightBurn Preview docs (legacy `docs.lightburnsoftware.com/UI/Preview.html` and
    `/latest/Reference/Preview/`).
  - A LightBurn forum `$$` dump for an Ortur Laser Master 1 with `$11=0.050`.
- **Lenses run:**
  - L1, L2, L3, L4 and L7 were run as separate passes.
  - L6 covered only the timing failure path: an unavailable estimate must never block Start.
  - L5 was skipped. The only untrusted input in reach is an opened program, and its trust boundary
    belongs to E4.
- **Method:** an independent GRBL 1.1 time model was written from the sources above and shares no
  code with KerfDesk. Its components:
  - a G-code parser;
  - per-axis `limit_value_by_axis_maximum` for acceleration, rapid rate and junction acceleration;
  - a block-by-block simulation of the 15-block ring;
  - `mc_arc` chords;
  - `delay_sec` dwell steps;
  - `gcode.c` sync rules.

  KerfDesk's timeline was then compared with it on representative jobs, in two oracle modes:
  - **GRBL truth:** GRBL's per-axis model, with no stop between G0 and G1.
  - **KerfDesk assumptions:** one scalar limit, a stop at every G0↔G1 junction, and exact dwells.
    This mode isolates KerfDesk's own modelling from its known and decided simplifications.
- **Counts:** 3 raised → 0 refuted (refuter: 3 confirmed, 0 plausible; no severity changes) → P1 0 /
  P2 0 / P3 3 (+ 7 KNOWN re-observed, 3 decided consequences noted). P3-1's novelty is narrowed:
  ADR-432 already documents the Inspector half.

## Headline

KerfDesk's planner is a faithful GRBL model.
- **Same assumptions:** given the same assumptions, the Job Review and countdown timeline equals the
  independent ring oracle. It agreed to 6 µs over 402 blocks, exactly over a 19,152-block
  bidirectional raster, and to 1 ms over 48 arc cases.
- **Against GRBL's real per-axis behaviour:** the estimate is 1–8% long on laser jobs.
- **Known short cases:** CNC jobs run 7–30% short. The cause is the known Z per-axis gap (PV-1),
  which this audit re-measured.
- **New problems:** they are in the twins that time the same program differently.
  - The Run review and the Inspector time GRBL arcs on display chords, not `mc_arc` chords. That puts
    them off by −38% to +68% against GRBL, and 17% off Job Review on KerfDesk's own native-arc output
    (P3-1).
  - Those two surfaces also read `G4 P` as seconds on Smoothieware and, for opened files, on Marlin
    profiles. That is a 1000× dwell (P3-2).
  - GRBL and grblHAL round every dwell up to 50 ms, which the estimate omits (P3-3).
- **Recovery and safety:** no safety or recovery decision reads the time estimate. The refuter
  stress-tested this; see Verified clean.

## Accuracy: job → KerfDesk → independent → error

Device: the KerfDesk default profile as GRBL 1.1:
- 6000 mm/min, 500 mm/s², `$11` 0.01, 115200 baud;
- independent model: `$110=$111=6000`, `$120=$121=500`, `$12` 0.002, 15 blocks.

CNC: `maxFeed` 5000. The independent model uses `$110=$111=5000`, `$112=600`, `$120=$121=500` and
`$122=50` (KerfDesk's own GRBL CNC fixture values).

The KerfDesk column is `buildProgramTimeline(gcode, profile limits, deviceProgramTimingOptions(...))`
motion plus dwell. This is the Job Review and countdown baseline. Transport was 0.004 s or less in
every job.

| Job | KerfDesk | Independent (GRBL truth) | Error | Same-assumption oracle | Source of the error |
|---|---|---|---|---|---|
| J1 vector, 1,123 short G1 segments (sine 0.25 mm steps + noisy Ø30 blob), F1500 | 33.278 s | 31.402 s | **+6.0%** | 33.278 s (0.0%) | Diagonals and junctions get √2 more acceleration in GRBL (per-axis; KNOWN K-1); G0↔G1 stop (decided) |
| J1, F3000 | 31.565 s | 29.291 s | **+7.8%** | 31.565 s | as above |
| J1, F6000 | 31.565 s | 29.284 s | **+7.8%** | 31.565 s | as above |
| J2 bidirectional grayscale raster 30×10 mm, 0.1 mm px, overscan 2.5 mm, F6000 (19,152 blocks, emitted by `grblStrategy`) | 86.754 s | 83.791 s | **+3.5%** | 86.754 s (exact) | G0↔G1 stop at row ends (decided, ADR-525 measured 1.5–4.2%); ring verified — unlimited lookahead would give 55.6 s |
| J3 arc-heavy CNC: 8 helical Ø6 bores (3 turns + clean-up) + rounded-rectangle profile, 3 passes (3,887 blocks) | 93.720 s | 100.975 s | **−7.2% (short)** | Z like XY: 93.244 s; + stop: 93.738 s | Z `$112`/`$122` ignored (KNOWN K-1 = PV-1). Display chords vs `mc_arc` on CNC arcs: 93.720 vs 93.746 s, negligible here (KNOWN K-2) |
| J4 dwells: CNC spin-up `G4 P3`, 40 × (`G1 Z-2 F400`, `G4 P0.125`, `G0 Z1`, `G4 P0.01`), `G4 P2.5` | 49.161 s | 70.170 s | **−29.9% (short)** | exact-dwell oracle 67.570 s | Z rapids/accel (KNOWN K-1) ≈ 18.4 s; **dwell step rounding 2.6 s** (10.9 s vs 13.5 s dwell; P3-3) |
| J5 laser circles r = 1, 2, 5, 10, 25 mm × 4 laps, `G2 … I J`, F3000 | Job Review 26.106 s; **Run review/Inspector 30.486 s** | 25.816 s | JR +1.1%; **RR +18.1%** | 26.104 s | Display chords in the Run review/Inspector (P3-1) |
| J5, F6000 | JR 18.078 s; **RR 28.928 s** | 17.251 s | JR +4.8%; **RR +67.7%** | 18.077 s | as above |
| J6 KerfDesk-compiled native-arc circles r = 2, 5, 10, 25 (ADR-432 fit, `compileJob` + `grblStrategy`), F6000 | JR 13.863 s; **Inspector 16.263 s** | 13.289 s | JR +4.3%; **Inspector +22.4%** (+17.3% vs JR) | 13.863 s | P3-1 |
| J6, F3000 / F1500 | JR 15.751 / 20.828; Insp 16.651 / 20.829 | 15.298 / 20.381 | Insp vs JR +5.7% / 0.0% | 15.751 / 20.828 | P3-1 |

Arc sweep: one full circle each; r 2/10/50/200 mm; F 6000/12000/36000; `$120` 500/3000;
`$11` 0.01/0.05; 48 cases.
- **Job Review's `mc_arc` timing:** equals the same-assumption oracle to 1 ms in every case.
- **Run review and Inspector display-chord timing:** ranges from **0.616×** (r 200, F36000, a 500,
  `$11` 0.05) to **1.575×** (r 10, `$11` 0.01) of the oracle.

All are time-only errors. No burn, position or Start decision depends on them.

## Findings

### P3-1 — The Run review and the Inspector time GRBL-family arcs on display chords, not on the `mc_arc` chords Job Review and the controller use: −38% to +68% against GRBL, and the Inspector disagrees with Job Review on the same native-arc program
- **Where:**
  - `src/ui/gcode-inspector/gcode-inspector-parse.ts:73-82`: the Inspector's `BuildRenderModelOptions`
    carry no `controllerArcToleranceMm`. Main `6649d6590` adds only `stockGrbl` there.
  - `src/ui/gcode-inspector/gcode-inspector-analysis.ts:49-56`: the timing options carry only scales,
    the planner size and the machine kind.
  - `src/ui/gcode-inspector/gcode-inspection-source.ts:134-152`: `deviceInspectionTiming` is
    commented "The same limits and calibration Job Review times the device's jobs with".
  - Twin: `src/core/gcode-time/program-timing-options.ts:56-58` gives Job Review and the countdown
    `controllerArcToleranceMm: GRBL_DEFAULT_ARC_TOLERANCE_MM` for GRBL-family lasers.
  - Arcs are expanded at parse time by `timingArcPoints` (`controller-arc-points.ts:33-52`). Without
    a tolerance, that uses `sampleArcPoints`: 0.05 mm sag, 1°–15° steps.
  - Shown at `RunGcodeFileSummary.tsx:41-47` ("Estimated time") and `inspector-readouts.ts:91`
    ("Est. time").
- **Lens:** L3 (twin), L2 (ground truth), L7.
- **Anchor:**
  - Contract: ADR-425 Consequences, "Job Review and the Inspector now give the same motion time for
    the same program on the same device".
  - Contract: ADR-432, "Laser timing on GRBL-family controllers interpolates G2/G3 as `mc_arc` does".
  - Contract: ADR-630 lists the estimated time in the Run review.
  - Ground truth: gnea/grbl `motion_control.c` `mc_arc`, "uint16_t segments =
    floor(fabs(0.5*angular_travel*radius)/". Every chord is a planner block, with a junction and a
    ring slot.
- **Scenario:**
  1. **Own output.** A GRBL laser project with a line cut of four circles, which ADR-432 fits to
     `G2` arcs, runs at F6000. Job Review shows 13.9 s and the Inspector "Est. time" shows 16.3 s.
     GRBL takes about 13.3 s.
  2. **Run review, long.** An opened GRBL laser program with small circles (r 1–25 mm, `G2 I J`)
     runs at F6000. The Run review says 28.9 s. GRBL runs it in about 17.3 s, so the review is 68%
     long.
  3. **Run review, short.** On a profile with `$11 = 0.05` (seen shipped on an Ortur Laser Master 1)
     and fast feeds, large arcs are timed short. One r 200 circle at F36000 and a = 500 is timed at
     5.8 s against GRBL's 9.5 s. The coarse 15° chords escape the 15-block ring cap that the real
     0.002 mm chords hit.
  4. CNC programs at router feeds are barely affected: 0.03% in J3.
- **Evidence:** REPRO.
  - Temporary repros, now deleted. Copies are in the session scratchpad `e6-repros/`:
    - `src/ui/gcode-inspector/zz-e6-inspector.test.ts`, using the real `inspectGcodeText` and
      `deviceInspectionContext`;
    - `src/core/gcode-time/zz-e6-accuracy.test.ts` (J5);
    - `src/core/gcode-time/zz-e6-arcsweep.test.ts`.
  - Command:
    `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`.
  - Output (`inspector-out.json`): at speed 6000, `jobReview 13.863`, `inspectorRunReview 16.263`,
    `grblOracle 13.289`, `inspectorVsJobReviewPct 17.3`.
  - Output (`arcsweep-out.txt`): `200 36000 500 0.05 | 9.453 5.824 9.453 | 0.616` and
    `10 6000 500 0.01 | 1.266 1.993 1.266 | 1.575`.
  - L7: the ADR-425 parity tests use only straight-line programs, so the divergence is untested:
    - `gcode-inspector-analysis.test.ts:30`: `G1 X200`;
    - `gcode-inspection-source.test.ts:77`: options only.
- **Novelty:** related to the KNOWN WA-3 (K-2 below). WA-3 covers CNC Job Review timing
  (`program-timing-options.ts`), which leaves out the tolerance for CNC. This finding is the
  Inspector and Run review path, which receives it for no machine kind, GRBL lasers included. That
  breaks ADR-432's laser promise on the surface ADR-425 ties to Job Review. ADR-525's Consequences
  mention "display chords elsewhere" generally; ADR-425's twin statement is the specific contract.
  No open PR touches these files: 5 open PRs checked on 2026-10-23.
- **Refuter:** CONFIRMED (REPRO, plus a second independent oracle). Severity P3 is kept, and
  novelty is narrowed.
  - **What would refute it:**
    - a tolerance passed downstream of the Inspector; or
    - display chords that time the same as `mc_arc` chords.

    Neither holds. On origin/main `054d331bc`, `createInspectionReader` still passes no
    `controllerArcToleranceMm`; main added only `stockGrbl`. `analyzeGcodeModel` times the model
    after it has already been cut into chords.
  - **Repro:** the refuter's own `zz-e6r-twins.test.ts`, since deleted; a copy is in the session
    scratchpad `e6r-repros/`, with output in `e6r-out.txt`.
    - **Setup:** one full `G2 I J` circle starting from the arc start, on the default profile as
      GRBL 1.1.
    - **Paths:** the real `inspectGcodeText` was run with the Run review context
      (`deviceInspectionContext(…, 'grbl-v1.1')`) and with the opened-file context
      (`withCurrentDevice`).
    - **Oracle:** a new ring planner, written from `planner.c` junction and ring rules and
      `mc_arc` chord counts. It uses scalar acceleration and 15 blocks, and shares no code with
      KerfDesk or with the auditor's oracle.

    Results:

    | Case | Job Review | Run review / Inspector | Oracle | Run review vs oracle |
    |---|---|---|---|---|
    | r 10, F6000, a 500, `$11` 0.01 | 0.983 s | 1.710 s | 0.983 s | **+74%** |
    | r 2, F6000 | 0.350 s | 0.526 s | 0.350 s | +51% |
    | r 200, F36000, a 500, `$11` 0.05 | 8.188 s | 4.559 s | 8.188 s | **−44%** |
    | r 25, F3000 | 3.242 s | 3.242 s | 3.242 s | 0% |

  - **Ablation:** the same model was built with and without `controllerArcToleranceMm: 0.002`. The
    two builds reproduce the Job Review and Inspector figures exactly, so the missing tolerance
    accounts for the whole gap.
  - **Novelty narrowed:**
    - ADR-432's Consequences (2026-09-25) already say "The G-code Inspector's own timeline is
      unchanged and overstates arc time". They put it on display chords, and list the Inspector's
      timeline as "Not part of this decision".
    - ADR-425 (2026-09-26) then claimed parity with Job Review without amending ADR-432.

    So the Inspector half is a documented limitation that a later contract contradicts. What is
    new:
    - the Run review surface (ADR-630);
    - the short direction (−44%), which ADR-432's "overstates" does not cover.
  - **Severity:** P3. The figure is display-only; the stress test under Verified clean found no
    decision that reads it.
- **Fix direction:**
  - Pass `controllerArcToleranceMm` into the Inspector's render-model options whenever the context's
    controller is GRBL-family:
    - the Run's connected controller;
    - otherwise the profile's controller, for project and opened programs.
  - Do this for both laser and CNC.
  - Add an arc case to the ADR-425 parity test.

### P3-2 — The Run review and the opened-file Inspector read `G4 P` as seconds on Smoothieware, and the opened-file Inspector does so on Marlin profiles too, where the firmware reads milliseconds: a 1000× dwell in the estimate
- **Where:**
  - `src/core/gcode-view/render-model-words.ts:201` (`tally.dwellSeconds = word.value`) and `:256`:
    every `P` on a `G4` becomes seconds.
  - `src/ui/gcode-inspector/gcode-inspector-parse.ts:86-87`: the millisecond conversion
    (`marlin-program-reader.ts:82-87`) runs only when `context.controllerKind === 'marlin'`.
  - `src/ui/gcode-inspector/gcode-inspection-source.ts:157-167`: `withCurrentDevice`, used for an
    opened file (`use-gcode-inspector-slot.tsx:24`), never sets `controllerKind`. So even a Marlin
    profile's opened file is read as GRBL.
  - Twins that refuse instead of guessing:
    - `src/ui/state/canvas-job-timing-plan.ts:14-18,91-101,153-155`: "cannot be estimated without a
      thousandfold guess". It covers Marlin and Smoothieware.
    - `start-job-preparation.ts:136-159`.
  - The import preview discloses "Assumes … G4 P seconds" (`gcode-preview-timing.ts:141`).
- **Lens:** L3, L2, L4.
- **Anchor:**
  - Twin: the countdown and Job Review refuse a dwell-containing estimate when the controller's
    `G4 P` units are unproven, and the Marlin Run review converts them.
  - Contract: WORKFLOW.md:2450-2452 and :2514. A job whose "`G4 P` units do not match the active
    family" must not be given a number.
  - Ground truth: Smoothieware `Robot.cpp` G4 reads P as "decimal seconds" only in grbl mode, and as
    milliseconds otherwise. KerfDesk's own comments cite this: `smoothieware/commands.ts:45-47` and
    `cnc-export-controller-advisory.ts:12` ("reads `G4 P` as milliseconds outside grbl_mode"). The
    laser build's grbl_mode defaults to off: `smoothie-sim-shell.ts:18`, Kernel.cpp. Marlin reads
    P as milliseconds; KerfDesk's own reader says so at `marlin-program-reader.ts:85`.
- **Scenario:**
  1. A Smoothieware laser (stock laser firmware, `grbl_mode` off) opens a program with `G4 P500`
     pierce pauses and chooses Run on machine.
  2. The Run review shows each pause as 500 s; the board waits 0.5 s.
  3. Opening the same file in the Inspector with a Marlin profile does the same. The "of which
     dwell" row shows the 500 s, but no unit assumption is stated.
  4. The estimate is long, never short. The operator is told a 20-pierce job takes about 2.8 hours.
- **Evidence:** REPRO.
  - Temporary `src/ui/gcode-inspector/zz-e6-inspector.test.ts` and `zz-e6-opened.test.ts`; copies
    in `e6-repros/`.
  - Program: `G21/G90/M4 S0/G0 X10 Y10 S0/G4 P500/G1 X20 F600 S300/M5`. Run-review context gives
    `grbl 501.356`, `marlin 1.856`, `smoothieware 501.356` seconds.
  - Opened-file context (`withCurrentDevice`) gives `{"grbl-v1.1":502.02,"marlin":502.02,"smoothieware":502.02}`.
- **Novelty:** not raised before. D4-K-7 and the rolling-v2 09 refutation concern KerfDesk's own
  CNC `G4` on Marlin and Smoothieware, which CNC Start refuses by design (ADR-399). They do not cover
  timing an opened program. Unchanged on main `6649d6590`.
- **Refuter:** CONFIRMED (REPRO + SOURCE). Severity P3 is kept.
  - **What would refute it:** any of these:
    - the Run path converts Smoothieware dwells;
    - opened files carry a `controllerKind`;
    - Smoothieware reads P as seconds.
  - **Repro:** the refuter's own `zz-e6r-twins.test.ts` runs the real `inspectGcodeText` on the
    `G4 P500` program.
    - **Run review context:**
      - `grbl-v1.1`: 501.356 s, dwell 500. Correct for GRBL.
      - `smoothieware`: 501.356 s, dwell 500. Wrong.
      - `marlin`: 1.856 s, dwell 0.5. Converted.
    - **Opened-file context** (`withCurrentDevice`): 500 s of dwell for all three profiles. This is
      the context that `use-gcode-inspector-slot.tsx:24` builds from `gcode-open-action.ts:63-65`,
      which sets no `controllerKind`.
  - **Ground truth, fetched by the refuter:**
    - Smoothieware edge `Robot.cpp` G4 reads "in grbl mode (and linuxcnc) P is decimal seconds",
      and otherwise "in reprap P is milliseconds".
    - `Kernel.cpp` defaults `grbl_mode` to false. It defaults to true only `#ifdef CNC`.
    - So on a Smoothieware CNC build the Run review is right by accident. The finding holds for
      the laser build's default.
  - **Why it stays P3:** no wrong action follows from it.
    - `external-run.ts` reads no timing, and external runs have no countdown.
    - The stream-hold and lost-ack logic uses its own `programmedDwellSeconds`
      (`laser-stream-dwell.ts`). That returns null outside the GRBL family, so the 500 s never
      lengthens a grace period, a stall timeout or an air hold.
  - **Novelty:**
    - Prior `G4 P` unit items all concern KerfDesk's own CNC output on Marlin or Smoothieware:
      2026-07-13, 2026-09-25 CN-1, rolling-v2 09 and D4-K-7.
    - Open PR #1403 touches `RunGcodeFileDialog.tsx`, but only for bit-change labels.
- **Fix direction:**
  - For Smoothieware, and for a Marlin profile's opened file, either:
    - convert `G4 P` from milliseconds as the Marlin reader does, using `X-GRBL_MODE` from the M115
      report when known; or
    - show the estimate as unavailable for dwell-containing programs, as the countdown does.
  - State the dwell-unit assumption next to the Inspector's and the Run review's time, as the
    import preview already does.

### P3-3 — GRBL and grblHAL round every `G4` dwell up to whole 50 ms steps, but the estimate counts the exact `P`, so dwell-heavy programs are timed short
- **Where:**
  - `src/core/gcode-view/render-model-words.ts:256`: `seconds: Math.max(0, tally.dwellSeconds)`.
  - Summed unchanged by `program-time.ts:219-225` (`totalDwellSeconds`) and
    `program-timeline.ts:238-241`.
- **Lens:** L2.
- **Anchor:** Ground truth.
  - gnea/grbl `nuts_bolts.c` `delay_sec`: "uint16_t i = ceil(1000/DWELL_TIME_STEP*seconds);".
    `config.h`: "#define DWELL_TIME_STEP 50 // Integer (1-255) (milliseconds)".
  - grblHAL core `nuts_bolts.c`: "ceilf((1000.0f / DWELL_TIME_STEP) * seconds) + 1". Its loop runs
    `ceil` steps, and grblHAL `config.h` sets `DWELL_TIME_STEP 50`.
  - `mc_dwell` syncs the planner first, which KerfDesk already models.
  - FluidNC uses `dwell_ms(int32 ms)`; its resolution was not checked.
- **Scenario:** a GRBL program with `G4 P0.01` after each of 40 plunges and `G4 P0.125` pierces
  (J4).
  - GRBL waits 50 ms and 150 ms. KerfDesk counts 10 ms and 125 ms.
  - Over 80 dwells the dwell total is 10.9 s against 13.5 s, 2.6 s short.
  - The error is at most 50 ms per dwell, and zero for multiples of 0.05 s. KerfDesk's own CNC
    spin-up dwells (whole seconds) are barely affected.
  - Programs that pulse with tiny dwells (a few ms each) run up to 10× longer per dwell than timed.
- **Evidence:** REPRO + SOURCE.
  - Temporary `zz-e6-accuracy.test.ts` (J4).
  - Output: `kdDwell 10.9`, `oracleDwell 13.5`, `oracleExactDwellTotal 67.57` against `oracle 70.17`.
  - Sources as quoted above.
- **Novelty:** not raised before. The 2026-09-25 audit cites `delay_sec` only for status serving
  every 50 ms, not for timing.
- **Refuter:** CONFIRMED (REPRO + SOURCE). Severity P3 is kept.
  - **Ground truth, fetched by the refuter:**
    - gnea/grbl master `nuts_bolts.c` `delay_sec` computes
      `i = ceil(1000/DWELL_TIME_STEP*seconds)`, then runs `i` passes of
      `_delay_ms(DWELL_TIME_STEP)`.
    - `config.h` defines `DWELL_TIME_STEP 50`.
    - grblHAL core `nuts_bolts.c` computes `ceilf((1000.0f / DWELL_TIME_STEP) * seconds) + 1` and
      loops on `while(--i && ok)`. That is ceil(20·P) passes of 50 ms, the same rounding.
  - **Repro:** 10 × (`G4 P0.01`, `G4 P0.125`, `G4 P0.005`, `G4 P1`) through Job Review's
    `buildProgramTimeline` gives a KerfDesk dwell of 11.4 s. GRBL's step rule gives 12.5 s.
  - **Not decided elsewhere:** no ADR or WORKFLOW clause decides on exact dwells, and ADR-525 says
    nothing about dwell rounding.
  - **Why P3:** the error is at most 50 ms per dwell, and the figure is display-only.
- **Fix direction:** for the GRBL and grblHAL controller kinds, time each `G4` as
  `ceil(P / 0.05) × 0.05` s. Keep FluidNC exact until its `dwell_ms` is checked.

## KNOWN (re-observed, not re-raised)

- **K-1 PV-1 / 18 K-2.** One scalar acceleration (min `$120/$121`) and one max rate (max
  `$110/$111`) are used for every direction and for Z (`segment-blocks.ts:35-37`,
  `parse-settings.ts:162-170`). Re-measured:
  - J1 is +6–8% long on diagonals: GRBL's `limit_value_by_axis_maximum` gives √2 on 45° blocks and
    junctions.
  - J3 is −7.2% short and J4 about −27% short, because of Z.
  - PV-1 already names "Diagonal XY rapids … up to 1.4 times faster". The automatic overscan already
    uses a per-axis along-scan acceleration (`automatic-overscan.ts:48-50`); the estimator does not.
- **K-2 WA-3 / 18 K-3.** CNC arcs are timed on display chords (`program-timing-options.ts:56`). The
  measured effect at CNC feeds is negligible: 93.720 s against 93.746 s in J3.
- **K-3 09-P2-1 (and 26 K-6).** The CNC pre-run tile, the offline Job Review fallback and the
  Inspector time with the laser Max feed: `prepared-job-metrics.ts:43`, `live-job-estimate.ts:168`
  and `gcode-inspection-source.ts:139-141`. Only the countdown uses `deviceForActiveHead`
  (`start-job-preparation.ts:88`).
- **K-4 18-P3-1.** Smoothieware `G0` is timed at Max feed, not the board's seek rate.
- **K-5 C1-P3-2.** The Marlin resume re-entry `G0` carries no F, so it moves at the modal feed while
  being timed at Max feed.
- **K-6 D1-P3-3.** Air-restart repeats stop the head on FluidNC and Smoothieware, but the estimator
  assumes no stop. D1 also lists grblHAL `$673` and FluidNC coolant on-delays as missing from the
  estimate.
- **K-7 D4-P3-6.** The documented dwell-timing helper `cnc-duration-overhead.ts` is dead code.

Decided in ADR-525, not raised:
- the full stop at every G0↔G1 junction: J2's +3.5%;
- the family-default planner size rather than the session's `Bf`/`$I`;
- the assumption that the stream keeps the ring full. Transport is earliest-arrival only;
  ACK/latency starvation is warned in Job Review (`stream-throughput-warnings.ts`), not timed.

## Refuted

Candidates the auditor dropped:

- *KerfDesk's planner diverges from GRBL.* No. The only differences come from K-1 and the decided
  stop.
  - With one scalar limit and the G0↔G1 stop, the independent oracle gives 9.139580 s against
    KerfDesk's 9.139586 s on 402 blocks (`j1-debug.txt`).
  - It gives 86.754 s against 86.754 s on the 19,152-block raster, and matches all 48 arc cases to
    1 ms.
  - A first oracle mode with equal per-axis limits looked 5.6% off. That mode still gives diagonals
    √2 acceleration; the gap is K-1, not a model error.
- *Feed overrides make the live ETA wrong.* No. The pre-run estimate assumes 100%. The countdown
  re-paces motion from confirmed route positions (×0.1 to ×10, at least 1 s samples) and leaves
  dwell and transport unscaled (`live-job-timing.ts:186-216`), so an override is absorbed after a
  few samples.
- *Inch reporting corrupts the start position or feeds.* No.
  - The start position is converted for both Job Review and the Run review, through
    `reportedWorkPositionMm(…, reportInches)`: `start-job-preparation.ts:89` and
    `use-external-program.ts:74`.
  - F takes the block's own G20/G21, as `gcode.c` does (`render-model-words.ts:187-194`).
- *An unavailable estimate blocks Start.* No. It sets the Job Review tile to "Unavailable"
  (`job-review-model.ts:341-350`) and the countdown to unavailable. Start is unchanged, as
  WORKFLOW.md:2452 says.
- *Recovery trusts the time estimate.* No. Restart steps back by planner *movement lines*
  (`planner-backlog-restart.ts:36-71`). The only thing it shares with timing is the planner-size
  table. One arc line holds many blocks, so on arcs this errs toward recutting.
- *Dot-mode laser programs commonly use tiny `G4`s, which would make P3-3 large.* Not established.
  The LightBurn forum shows `G4` used for start and end pauses and cut-through, but no documented
  dot-mode `G4` output. P3-3 stays P3.

## Verified clean

- **Model fidelity (Q1).**
  - The junction formula matches `planner.c`, including the orientation of the half-angle identity.
  - The newest block in the ring is planned to rest. The N−1 window cap equals the block-by-block
    ring.
  - Each block's maximum entry is the minimum of the junction speed and both neighbouring nominal
    speeds.
  - An empty buffer enters at 0, which KerfDesk models as a span start after every sync.
  - Trapezoid and triangle timing are correct.
  - GRBL-family laser arcs in Job Review use exactly the `mc_arc` chord count, with 5e-7 full-circle
    handling and the last chord to the target.
  - Laser-mode sync rules follow `gcode.c`:
    - an S word on a line with axis words does not sync;
    - a standalone S change with the spindle on does;
    - M3/M4/M5 and coolant changes sync;
    - G4 drains before its block, M2/M30 after it.
  - Overscan runways and `S0` feed travel are timed as emitted.
- **Planner sizes.**
  - GRBL: `BLOCK_BUFFER_SIZE 16` with one slot free.
  - grblHAL: `DEFAULT_PLANNER_BUFFER_BLOCKS 100` (config.h), with allocation `size + 1`. Both match
    `controller-planner-blocks.ts`.
- **Inputs (Q2).**
  - The estimate uses profile limits. A `$$` read on connect offers a patch the user applies:
    `$11`, max `$110/$111`, min `$120/$121`.
  - LightBurn works the same way: its estimate comes from the device settings, refreshed by "Read
    From Controller" (LightBurn Preview docs).
  - The countdown and, on main, the Run review take the planner size from the connected controller.
  - `$12` is never read, so the stock 0.002 mm is assumed. See Not verified.
- **Dwell units (Q1/Q2) on the main paths.**
  - GRBL family: seconds.
  - Marlin Run review: converted by the reader.
  - Job Review and countdown on a connected Marlin or Smoothieware controller: refused when the
    program dwells.
  - Laser output has no `G4`.
- **Uses (Q4).** No safety, air, stall, heartbeat or "job finished" decision reads the estimate.
  - Completion is the driver's settle marker plus Idle (WORKFLOW.md "Finishing/Complete").
  - The estimate feeds only displays and the stream-throughput advisories.
  - Air keep-alive has its own estimator (D1).
  - **Refuter stress test (holds).** Every non-test import of `core/gcode-time` and
    `core/motion-planner` outside those folders was followed, along with the consumers of
    `estimateJobDuration`. For each consumer, the refuter asked whether a wrong estimate (CNC 7–30%
    short, arcs −44% to +74%, dwells 1000× long) could change an action.
    - **Job Review and second pass** (`estimate-duration.ts`, `prepared-job-metrics.ts`,
      `live-job-estimate.ts`, `second-pass-execution.ts`, `second-pass-worker.ts`): tiles only.
    - **Stream-throughput advisories** (`stream-throughput-warnings.ts`): the header says "none of
      these can refuse a Start".
    - **Live countdown** (`canvas-job-timing-plan.ts`, `laser-job-timing-handoff.ts`,
      `live-job-timing.ts`, `live-canvas-run-timing.ts`, `live-canvas-run.ts`): display only.
      - `completedJobCanBeDismissed` reads `timing.kind === 'complete'`. Only the lifecycle
        `finished` patch sets that value, never an estimate that has run out.
      - `mayTrustTimingProgress` flows route into timing, not the other way.
    - **Phone and MCP readouts** (`machine-projections.ts`, `status-projections.ts`,
      `prepared-job-review.ts`): readouts only.
    - **Inspector, Run review and import preview** (`gcode-inspector-analysis.ts`,
      `RunGcodeFileSummary.tsx`, `InspectorView.tsx` playback, `gcode-preview-timing.ts`): display
      only. `external-run.ts` reads no timing.
    - **Recovery** (`planner-backlog-restart.ts`): imports only `DEFAULT_PLANNER_BLOCKS`.
      `resume-travel.ts` and `cnc-resume-point.ts` measure distance, not time.
    - **Watchdogs:**
      - The stall timeouts are fixed: 10 s, or 90 s while in Run (`laser-stream-stall.ts`).
      - The heartbeat is a fixed 2 s.
      - The hold notice and containment (`laser-stream-hold.ts`) and the lost-ack Idle proof
        (`laser-lost-ack-reconcile.ts`) use their own `programmedDwellSeconds`. It is GRBL-family
        only, so the render-model dwell behind P3-2 never lengthens a grace period.
      - CNC Pause-and-lift re-entry (`cnc-pause-reentry-run.ts`) times its own spin-up `G4`.
    - **Air:** `air-keep-alive.ts` has its own `moveSecondsUpperBound` and only acts inside the
      GRBL laser emitter. KerfDesk's laser output has no `G4`; its only `G4` emitters are the CNC
      spin-up and the separate start mark. `air-assist-hold.ts` is index logic with no time.
    - **Machine hours** (`machine-hours*.ts`): wall-clock "measured, not estimated".
    - **Lead outside E6, not raised here:** that same watchdog dwell exemption is GRBL-family only.
      So on Smoothieware, which has no busy keepalive, a streamed program dwell longer than the
      90 s hold-notice threshold would be contained as an acknowledgement stall. It fails toward
      stopping, the program is unusual, and it does not involve the estimate.
- **Twin (Q5) for project jobs.**
  - The Job Review timeline and the countdown baseline are the same `canvasJobTimingPlan` object.
  - The pre-run tile differs only by its initial position and the profile's controller kind, and
    K-3 applies to CNC.
  - External runs have no countdown. Its state is "exact emitted-program timing was not prepared",
    which is shown, not invented.

## Not verified

- **No hardware.** Not modelled by the oracle:
  - the stepper segment buffer and `ACCELERATION_TICKS_PER_SECOND` discretisation;
  - the 328P's parse and plan throughput on sub-millimetre chords;
  - the partly filled ring right after each sync;
  - ACK and USB latency starvation.
- **FluidNC** `dwell_ms` resolution, and its planner beyond the cited default.
- **Marlin planner specifics.** Marlin's `SLOWDOWN` and minimum segment time with a draining
  buffer, S-curve acceleration, and Smoothieware's `mm_max_arc_error` arc segmentation. None are
  modelled; the Run review times these dialects with the GRBL model.
- **Vendor `$12` values.** A non-stock `$12` changes `mc_arc` chord counts and therefore time.
- **LightBurn's acceleration model.** The Thunder Laser article returned 403. The LightBurn docs give
  no accuracy figure.
- **Code read only.** The remote and phone ETA projection (`machine-projections.ts`), the
  second-pass workbench estimate, and the rotary `machineSpaceJob` timing (D3) were read, not run.

```json
[
  {"id":"E6-P3-1","severity":"P3","area":"ctl-time-estimate","file":"src/ui/gcode-inspector/gcode-inspector-parse.ts","line":73,"anchor":"Contract: ADR-425 Consequences (Inspector = Job Review motion time), ADR-432 (GRBL laser arcs timed as mc_arc), ADR-630 (Run review estimated time); Ground truth: gnea/grbl motion_control.c mc_arc segment count; Twin: program-timing-options.ts:56-58","evidence":"REPRO","verdict":"CONFIRMED","known":"partial: ADR-432 Consequences documents the Inspector overstating arc time on display chords; Run review surface and short direction are new","summary":"Run review and Inspector time GRBL-family arcs on display chords (no controllerArcToleranceMm): -38%..+68% vs GRBL, Inspector +17% vs Job Review on KerfDesk's own native-arc output at F6000; refuter oracle: +74% (r10 F6000), -44% (r200 F36000 $11 0.05)"},
  {"id":"E6-P3-2","severity":"P3","area":"ctl-time-estimate","file":"src/core/gcode-view/render-model-words.ts","line":201,"anchor":"Twin: canvas-job-timing-plan.ts refuses unproven G4 P units, Marlin Run review converts; Contract: WORKFLOW.md:2450,2514; Ground truth: Smoothieware Robot.cpp G4 P ms outside grbl_mode, Marlin P ms","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Run review (Smoothieware) and opened-file Inspector (Marlin/Smoothieware profiles) time G4 P500 as 500 s; firmware waits 0.5 s"},
  {"id":"E6-P3-3","severity":"P3","area":"ctl-time-estimate","file":"src/core/gcode-view/render-model-words.ts","line":256,"anchor":"Ground truth: gnea/grbl nuts_bolts.c delay_sec ceil(1000/DWELL_TIME_STEP*seconds), config.h DWELL_TIME_STEP 50; grblHAL nuts_bolts.c ceilf","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"GRBL/grblHAL round each G4 up to 50 ms steps; estimate uses exact P (J4: 10.9 s vs 13.5 s dwell)"},
  {"id":"E6-K-1","severity":"P2","area":"ctl-time-estimate","file":"src/core/gcode-time/segment-blocks.ts","line":35,"anchor":"Ground truth: planner.c limit_value_by_axis_maximum","evidence":"REPRO","verdict":"KNOWN","known":"2026-09-24 CNC full audit PV-1; rolling-v2 18 K-2","summary":"Scalar accel/max rate for every direction and Z: laser +6-8% long on diagonals, CNC -7% to -27% short on Z"},
  {"id":"E6-K-2","severity":"P3","area":"ctl-time-estimate","file":"src/core/gcode-time/program-timing-options.ts","line":56,"anchor":"Ground truth: GRBL $12 mc_arc","evidence":"REPRO","verdict":"KNOWN","known":"2026-09-29 WA-3; rolling-v2 18 K-3","summary":"CNC arcs timed on display chords (negligible at router feeds: 93.720 vs 93.746 s)"},
  {"id":"E6-K-3","severity":"P2","area":"ctl-time-estimate","file":"src/ui/laser/prepared-job-metrics.ts","line":43,"anchor":"Contract: ADR-416 D4","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 09-P2-1, 26 K-6","summary":"CNC pre-run tile, offline Job Review and Inspector use the laser Max feed"},
  {"id":"E6-K-4","severity":"P3","area":"ctl-time-estimate","file":"src/core/gcode-time/segment-blocks.ts","line":35,"anchor":"Ground truth: Smoothieware Robot.cpp seek_rate","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 18-P3-1","summary":"Smoothieware G0 timed at Max feed, not seek rate"},
  {"id":"E6-K-5","severity":"P3","area":"ctl-time-estimate","file":"src/core/controllers/grbl/native-laser-resume.ts","line":80,"anchor":"Contract: ADR-398 D3","evidence":"READ","verdict":"KNOWN","known":"controller-v2 C1-P3-2","summary":"Marlin resume re-entry G0 without F is timed at Max feed"},
  {"id":"E6-K-6","severity":"P3","area":"ctl-time-estimate","file":"src/core/output/grbl-strategy.ts","line":504,"anchor":"Twin: estimator assumes no stop at air repeats","evidence":"READ","verdict":"KNOWN","known":"controller-v3 D1-P3-3","summary":"Air-restart repeats stop FluidNC/Smoothieware; estimator assumes none"},
  {"id":"E6-K-7","severity":"P3","area":"ctl-time-estimate","file":"src/core/job/cnc-duration-overhead.ts","line":14,"anchor":"METHOD L7","evidence":"READ","verdict":"KNOWN","known":"controller-v3 D4-P3-6","summary":"Documented dwell-timing helper is dead code"}
]
```
