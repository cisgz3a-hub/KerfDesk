# Rolling audit v2 — Preflight, recovery, simulation and timing

- **When:** 2026-10-21   **Tree:** origin/main @ `902f1d0c0` (audit worktree HEAD `639ff4216`;
  `git diff 902f1d0c0 HEAD -- src` is empty)
- **Scope:** `src/core/preflight/**`, `src/core/recovery/**`, `src/core/sim/**`,
  `src/core/gcode-time/**`, `src/core/motion-planner/**`, `src/core/gcode-view/**`. Twins were
  followed into `src/core/controllers/grbl/resume-program.ts` and `laser-resume-reentry.ts` (laser
  resume transform), `src/core/output/smoothieware-strategy.ts` and `marlin-travel-feed.ts` (rapid
  feed), `src/core/external-program/external-program-review.ts` (external-run Frame warnings),
  `src/ui/app/checkpoint-interruption.ts` and `src/ui/laser/laser-recovery-*.ts` (how an
  interruption reaches the restart line), and `src/ui/job-placement.ts` /
  `src/ui/laser/start-job-readiness.ts` (which offset preflight receives).

  Governing documents: ADR-525 (time estimates model the planner buffer), ADR-255 (shared
  motion planner and render model), ADR-398 (restarts cover the planner; Marlin travel feed),
  ADR-341 Amendments 3 and 6 (resume fidelity; continue from where the head stopped), ADR-215 and
  Amendment 1 (CNC pass recovery), ADR-411 and Amendment 1 (CNC Pause and lift), ADR-630 and
  Amendment 1 (external program Frame), ADR-228 / AGENTS.md "policy findings stay Job Review
  warnings".
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes. L6 only on the recovery failure paths
  (what a stop leaves for the restart). L5 skipped: the only untrusted input in reach is an external
  G-code file, whose refusals belong to the external-run area (26 / 05).
- **Primary sources fetched this session:** gnea/grbl `planner.c`, `stepper.c`, `stepper.h`,
  `config.h`, `gcode.c` (master); GRBL wiki FAQ; Smoothieware `Robot.cpp` (edge
  `909b74bab`) and `ConfigSamples/Smoothieboard/config`.
- **Counts:** 4 raised → refuter: 4 confirmed, 0 plausible, 0 refuted → P1 0 / P2 1 / P3 3
  (+ 13 KNOWN re-observed). No severity changes.

## Headline

The time estimate is honest for raster-heavy GRBL jobs within its documented model: an independent
block-by-block simulation of GRBL 1.1's 15-block ring, written from `planner.c`, agrees with the
estimator to 1e-9 s on a 4,059-block bidirectional raster (and on a 100-block ring). The remaining
estimate errors are the known scalar limits (PV-1: Z and per-axis rates/accelerations) and one new
twin: Smoothieware travel is timed at Max feed while the board runs bare `G0` at its own seek rate.
Preflight keeps every policy finding advisory; only compile-integrity codes refuse. The important
gap is in recovery: a lost link is always treated as "the controller kept running its buffer", so
when the controller instead resets or loses power (USB-powered Arduino-class GRBL, or the DTR reset
the automatic reconnect causes) the automatic laser restart begins at the first unacknowledged
line and skips up to a whole planner of acknowledged moves, about 300 mm of cut in the repro.

## Findings

### P2-1 — After a lost link, the automatic laser restart never steps back over the planner, although the controller may have reset or lost power and discarded it
- **Where:**
  - `src/ui/app/checkpoint-interruption.ts:64-68`: `PLANNER_DISCARDING_KINDS` is `cancelled`,
    `controller-error`, `controller-reboot`. A `disconnect` never carries `plannerBacklog`
    (`:39-44`); it only records `sentLines` (`:52-59`).
  - `src/core/recovery/automatic-restart-line.ts:79-80`: with no backlog the restart is the first
    unacknowledged line (`restartFrom`, `:118-127`).
  - `src/ui/state/recovery/recovery-slot-mutations.ts:88,365`: once a run's interruption is
    recorded it is never revised, so a boot banner or lost origin seen on the reconnect does not
    change the recorded kind.
  - The premise is written down in ADR-341 Amendment 6, Context: "a USB link that drops mid-job
    leaves the controller running every line it had already received".
- **Lens:** L2 (ground truth), L3 (twin), L6.
- **Anchor:**
  - Contract: ADR-398 Decision 2, "A restart may re-burn moves that had already run; that is
    preferred to skipping moves that never ran" (recut, never skip).
  - Twin: the same planner loss reported as `controller-reboot` during a job steps back a whole
    planner (`planner-size`, 15 blocks on GRBL 1.1); a reboot that happens across a link drop
    does not.
  - Ground truth:
    - GRBL wiki FAQ: "The Arduino's hardware flow control lines are hardwired to reset".
    - KerfDesk's own transport says an open port holds "DTR asserted" (`src/platform/web/web-serial.ts:253`).
    - GRBL acknowledges a line once it is queued, not when it has moved (OR-3 evidence:
      `protocol.c:104`). A reset or power-up clears the planner (`main.c` `plan_reset()`).
    - An Arduino Uno driving a CNC shield takes its logic power from USB, so unplugging the cable
      stops the MCU at once.
- **Scenario:**
  1. Stock GRBL 1.1 on an Arduino-class 328P board runs a vector cut with long lines.
  2. Either the USB link glitches and the device re-enumerates, or the cable is pulled.
  3. In the first case, Web Serial fires `connect` and auto-connect (ADR-420/639) opens the port
     within about a second. DTR is asserted and the 328P resets, throwing away the up to 15
     queued blocks, plus the segment buffer, that were still running.
  4. In the second case, a USB-powered Uno stops immediately.
  5. Either way the run is saved as `disconnect` with `sentLines` and no backlog.
  6. The recovery card's automatic restart is the first unacknowledged line, so every
     acknowledged, never-executed move is skipped. The reconnect shows a fresh boot (banner,
     alarm, lost origin), and the Review offers Restore saved origin or Continue, but the restart
     line does not move.
- **Evidence:** REPRO + SOURCE + READ.
  - Temporary `src/core/recovery/zz-18-disconnect-restart.test.ts` (deleted; copy in the session
    scratchpad `repros-18/`). It uses 60 cuts of about 20 mm (`G1 X0|20 Y<i> S800`), 40
    acknowledged and 45 sent.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/recovery/zz-18-disconnect-restart.test.ts`.
  - Output: `disconnect {"line":41}` → `G1 X20 Y37 S800`, against `controller-reboot` with a
    planner-size backlog `{"line":26,"plannerBacklogBlocks":15}` → `G1 X0 Y22 S800`. That is 15
    cuts, about 300 mm, left unburned if the board reset.
  - The only mitigation is the generic hint "acknowledged command progress … can be ahead of
    the physical cut". Amendment 6's reset caveat covers only the opt-in Continue action.
  - The 2026-10-16 reconnect audit lists "Some boards reset when serial control signals change"
    as a remaining limit, but not its effect on the restart line.
  - The hardware behaviour was not reproduced: no board was reset.
- **Refuter:** CONFIRMED, P2 kept. Not a duplicate of 05-P2-2.
  - **Own repro.** Temporary `src/ui/app/zz-18r-disconnect-reset.test.ts` (deleted; copy in the
    refuter's scratchpad `repros-18r/`). It runs the real `currentRunPlannerBacklog` (GRBL 1.1,
    no `Bf`), `checkpointInterruption` and `automaticRestart` on 80 cuts of 30 mm at F600, with
    50 acknowledged and 54 sent.
    - Disconnect, with or without the notice: `{"kind":"disconnect","sentLines":54}` and no
      backlog. The restart is line 51, `G1 X0 Y47`.
    - The same backlog as `controller-reboot`: restart line 36, `G1 X30 Y32`, stepping back
      15 blocks on the `planner-size` basis.
    - That is 450 mm, about 45 s of cutting. At this feed the planner takes about as long to
      drain, so a reset within a second or two of the drop discards nearly all of it.
  - **Primary sources fetched by the refuter:**
    - Arduino UNO docs, "Automatic (Software) Reset": DTR reaches the 328P reset through
      100 nF, and the board "resets each time a connection is made to it from software"
      (arduino/docs-content `arduino-uno-rev3-with-long-pins`).
    - The Web Serial spec's `open()` steps never mention DTR, and `setSignals()` rejects unless
      the port is already `"opened"`, so a page cannot avoid the edge at open (WICG/serial
      `index.bs`).
    - Chromium's Windows handler sets `config.fDtrControl = DTR_CONTROL_ENABLE` when it
      configures the port (`serial_io_handler_win.cc`). On POSIX the OS asserts DTR at open.
    - GRBL `main.c` runs `plan_reset(); // Clear block buffer and planner variables` on every
      reset.
  - **In code:**
    - `web-serial.ts` never calls `setSignals`.
    - `disconnectedStatePatch` nulls the streamer and `controllerOperation`, so
      `autoConnectAllowed` passes.
    - `onGrantedPortsChange` listens for `navigator.serial` `connect`, so auto-connect reopens
      the port as soon as it re-enumerates.
    - `interruptRunMutation` never revises a recorded capsule.
    - No guard in the Review moves the line. The only mitigation is the generic "can be ahead
      of the physical cut" hint.
  - **Would stepping back be safe?** Yes. Recording a lost link as planner-discarding only ever
    recuts, which ADR-398 Decision 2 prefers. The cost falls on boards that kept running: they
    re-burn up to a whole planner, 15 blocks on GRBL and 100 on grblHAL. So the reconnect-gated
    revision (a boot banner, reset alarm or lost origin on the reconnect) is the better fix.
    The unconditional step-back is the fallback. Neither should change the opt-in Continue from
    where the head stopped, which keeps `sentLines`.
  - **Not a duplicate of 05-P2-2.** 05-P2-2 is an alarm on a `done` stream that is recorded
    `unknown`, through `laser-alarm-line.ts`. This finding is a link drop recorded as
    `disconnect`, and the premise that the controller keeps running. The trigger, code path and
    fix differ. 05-P2-2's aside "if the operator unplugs instead … also not planner-discarding"
    is this finding's mechanism on a `done` stream, so the fixes should be cross-linked.
- **Fix direction:** When the post-reconnect session shows the controller restarted (a boot banner
  or reset alarm, or a lost work offset on a family that resets on open), revise the recorded
  interruption to planner-discarding with the planner-size bound. Alternatively, give every
  `disconnect` the planner-size step-back and leave `sentLines` to the opt-in Continue. Add a
  regression for disconnect followed by a reset.

### P3-1 — Smoothieware travel is timed at Max feed, but the board runs bare `G0` at its own seek rate (Marlin got `G0 F…`, Smoothieware did not)
- **Where:** `src/core/gcode-time/segment-blocks.ts:35-36` (rapid `targetVelocity` =
  `maxFeedMmPerMin`); `src/core/output/smoothieware-strategy.ts:19-28` (GRBL body, `G0 … S0` with
  no F). Twin: `src/core/output/marlin-travel-feed.ts:11-16` writes `F<max feed>` on every Marlin
  `G0` "which is the rate the job estimate times rapids at, so the two agree" (ADR-398 Decision 3,
  which left Smoothieware unchanged).
- **Lens:** L2, L3.
- **Anchor:**
  - Ground truth: Smoothieware `Robot.cpp` runs `case SEEK:` with
    `append_line(gcode, target, this->seek_rate / seconds_per_minute, …)`. `seek_rate` comes from
    `default_seek_rate` with `by_default(100.0F)`, and the sample config sets
    `default_seek_rate 4000`.
  - Twin: the Marlin travel-feed fix.
- **Scenario:** the generic Smoothieware profile (Max feed 6000) runs a two-cut job with 516 mm of
  `G0` travel. Job Review shows 5.76 s of rapid travel. A board on the sample config cruises that
  travel at 4000 mm/min, at least 7.74 s before acceleration, which is 34% more. A board whose
  config omits `default_seek_rate` crawls at 100 mm/min. Time only; no burn changes.
- **Evidence:** REPRO. Temporary `src/core/output/zz-18-smoothie-seek.test.ts` (deleted; copy in
  `repros-18/`). Output: `g0Lines ["G0 X200.000 Y150.000 S0", …]`, `g0CarryF false`,
  `rapidTravelSeconds 5.763`, `cruiseAt4000 7.744`. The Marlin lines on the same job are
  `G0 X200.000 Y150.000 F6000 S0`.
- **Refuter:** CONFIRMED, P3 kept. Two independent lines of evidence; no rerun.
  - **Firmware.** Smoothieware edge `Robot.cpp` reads `seek_rate` from `default_seek_rate`
    with `by_default(100.0F)`, and runs every `G0` at `this->seek_rate / seconds_per_minute`.
    A `G0` with F sets `seek_rate`. The sample config sets `default_seek_rate 4000`.
    smoothieware.org configuration-options describes it as "Default rate for G0 moves".
  - **Code.**
    - `estimate-duration.ts:78` passes `device.maxFeed`, and `segment-blocks.ts:35` times rapids
      at it.
    - `grbl-laser-lines.ts:50-51` writes a bare `G0 X.. Y.. [S0]`, unless a controlled laser-off
      travel feed is set.
    - KerfDesk deliberately keeps the board's configured seek rate for job travel, with
      `M120`/`M121` around jog and Frame (`smoothieware/commands.ts:52-56`,
      `laser-frame-modal-restore.ts`).
  - **Novelty.** Not raised before: the 2026-09-25 SM-5 covered a leaked seek rate, not the
    estimate.
  - **Direction.** The estimate can be short (seek rate below Max feed) or long (above it).
- **Fix direction:** Write `F<profile max feed>` on Smoothieware `G0` lines, as Marlin does (and
  restate the cut feed after), or time Smoothieware rapids at a profile seek rate.

### P3-2 — The external-run Frame leaves out the intermediate point GRBL visits in work coordinates for `G28`/`G30` with axis words
- **Where:**
  - `src/core/gcode-view/render-model-placement.ts:10-11`, comment: "G10, G28, G30 and G92 claim
    the line's axis words as their own data, so they are not a move". At `:107-114`, `G30` is
    `unplaced`.
  - `src/core/gcode-view/gcode-render-model-builder.ts:237-253`: `emitHome` draws to work 0 and
    only `forget`s the axes, never including a point.
  - `src/core/external-program/external-program-review.ts:89-91` warns only "moves to a stored
    position (G28 or G30)".
- **Lens:** L2, L3.
- **Anchor:**
  - Ground truth: GRBL `gcode.c`: "Move to intermediate position before going home. Obeys current
    coordinate system and offsets and absolute and incremental modes", then
    `if (axis_command) { mc_line(gc_block.values.xyz, pl_data); }`.
  - Contract: ADR-630 Amendment 1 item 1. The outline holds the motion the program places in its
    starting work coordinates.
- **Scenario:**
  1. An external CNC program ends with `G90 G28 X0 Y0`, a common older-post idiom. The part is
     at X50–60.
  2. GRBL rapids to work X0 Y0, then to the stored position.
  3. The Frame outline, and the bed and no-go checks built on it, cover only X40–60. A clamp at
     the work origin is never framed.
  4. The warning says only "stored position", so the operator is not told about the work-origin
     leg.
  5. The `G91 G28 Z0` idiom is unaffected (zero intermediate move).
- **Evidence:** REPRO. Temporary `src/core/gcode-view/zz-18-g28-frame.test.ts` (deleted; copy in
  `repros-18/`). `buildGcodeRenderModel(…, { boundsFromStart: true, initialPositionMm: {40,40,0} })`
  gives `programBounds` X 40–60, Y 40–60 for `… G28 X0 Y0` and for `… G30 X0 Y0`, against X 0–60,
  Y 0–60 for `… G0 X0 Y0`.
- **Refuter:** CONFIRMED, P3 kept.
  - **Own repro.** Temporary `src/core/gcode-view/zz-18r-g28-frame.test.ts` (deleted). It builds
    a square at X/Y 50–60, read from 45,45 with `boundsFromStart`.
    - `G28 X10 Y10`, `G30 X10 Y10` and `G91 G28 X-20 Y0` all give `programBounds` X 45–60,
      Y 45–60.
    - `G0 X10 Y10` gives X 10–60, Y 10–60.
    - So a non-zero intermediate point, and an incremental one, are dropped as well.
  - **GRBL `gcode.c`** (master), fetched by the refuter:
    - G28/G30 axis words are "an intermediate target position that observes all the current
      coordinate system and G92 offsets".
    - Execution runs `if (axis_command) { mc_line(gc_block.values.xyz, pl_data); }` before the
      stored-position leg.
  - **In code.** `emitHome` only `forget`s the axes, and never calls `program.moveTo` or
    `include`.
  - **Against ADR-630.** Its stated reason for leaving G28/G30 out ("cannot place them in the
    work coordinates the program starts in") does not hold for this leg.
  - **Side note.** The Inspector's `emitHome` also draws the leg to work 0, whatever the axis
    words, so for `G28 X10 Y10` the drawn leg is wrong too. That drawing is the KNOWN PV-3 (K-5)
    family.
- **Fix direction:** Include the `G28`/`G30` axis-word target, resolved in the current G90/G91 and
  units, in the outline as an ordinary placed rapid, and only then mark the axes unknown. Reword
  the warning to name both legs and correct the code comment.

### P3-3 — The laser resume parser cannot read the leading-dot numbers KerfDesk emits, so a resumed line gets a second `S` word (GRBL `error:25`)
- **Where:**
  - `src/core/controllers/grbl/laser-resume-reentry.ts:59-60`: `WORD_RE` and
    `POWER_OR_COMMENT_RE` require a digit before the point.
  - `src/core/controllers/grbl/resume-program.ts:66`: the same `WORD_RE`.
  - Emitter: `src/core/gcode/decimal-word.ts:25-29`. `formatGcodePowerS` drops the leading zero of
    a long fraction.
  - Raster S words for a non-integer `$30` on GRBL-family controllers carry float noise:
    `src/core/raster/controller-power-scale.ts:19-27`, and report 03 P3-3 observed
    `S.23099999999999998`.
- **Lens:** L3, L4.
- **Anchor:**
  - Twin: the shared word scanners accept `.231` (03 verified clean "leading-dot form fits GRBL's
    `read_float`").
  - Ground truth: GRBL `gcode.c` fails a repeated word (`STATUS_GCODE_WORD_REPEATED`, error 25).
- **Scenario:**
  1. A GRBL raster with a fractional `$30` (for example 10.5) is resumed at a line
     `X3S.23100000000000007` after an earlier `S5`.
  2. The scanner misses the `S`, judges the line a burn at `S5`, and appends one.
  3. The first resumed burn line becomes `G1X3S.23100000000000007 S5`.
  4. GRBL rejects it, and the stream stops on the error and resets (K-4 of report 05). The
     resume never proceeds.
  5. `state.sValue` also misses every such `S`.
  6. Latent: it needs a non-integer `$30`.
- **Evidence:** REPRO. Temporary `src/core/controllers/grbl/zz-18-resume-leading-dot.test.ts`
  (deleted; copy in `repros-18/`). Output: `"formatted":".23100000000000007"` and resumed lines
  `["…","G0 X2 Y0 S0","M4 S0","F1000","G1X3S.23100000000000007 S5","X4S0","M5"]`.
- **Refuter:** CONFIRMED, P3 kept.
  - **Own repro.** Temporary `src/core/controllers/grbl/zz-18r-resume-leading-dot.test.ts`
    (deleted).
    - `formatGcodePowerS(0.7*0.33)` gives `.23099999999999998`.
    - `buildResumeProgram` at `G1X3S.23099999999999998`, after a lit `X2S12`, writes
      `G1X3S.23099999999999998 S12`: two S words.
    - The same line spelled `S0.231` resumes unchanged, `G1X3S0.231`.
  - **The append needs a lit S before the resume line.** After a dark `S0` nothing is appended.
    Raster rows are lit in this way.
  - **GRBL source:**
    - `read_float` (`nuts_bolts.c`) accepts a leading `.`.
    - `gcode.c:326` fails a repeated value word with `STATUS_GCODE_WORD_REPEATED`.
  - **Twin.** The shared scanner `GCODE_WORD_PATTERN` accepts `\.\d+`.
  - **Reachability.** The noisy S words come from 03-P3-3, which is confirmed. Fixing that
    emitter noise would hide most cases, but the parser gap stays.
- **Fix direction:** Use the shared `core/gcode` word scanner, or a number pattern
  `[-+]?(\d+\.?\d*|\.\d+)`, in both regexes. Add a resume test on leading-dot S words.

## KNOWN (re-observed, not re-raised)

- **K-1** The laser automatic restart's planner step-back (`planner-backlog-restart.ts:43-73`)
  counts planner blocks only. GRBL discards a block from the ring as soon as all its steps are in
  the 6-slot segment buffer (`stepper.c`: "All steps are set to be executed in the segment
  buffer", then `plan_discard_current_block()`; `stepper.h` `SEGMENT_BUFFER_SIZE 6`). A reset can
  therefore drop up to about 5 segments (about 50 ms of motion, `DT_SEGMENT` 10 ms) that lie
  before the 15th-newest line. The CNC twin adds the segment lag
  (`cnc-resume-point.ts:51`, `segmentLag: 6`); the laser restart does not. Known as OR-3's
  "Optionally add the segment-buffer lag" (2026-09-25 OR track) and "right to within the segment
  buffer" (controller full audit). Never decided.
- **K-2** PV-1 (2026-09-24 CNC full audit, still open): timing uses one acceleration (min of
  `$120/$121`) and one max rate (max of `$110/$111`, `parse-settings.ts:150-162`) for every
  direction and for Z. `segment-blocks.ts:35-37` is unchanged.
- **K-3** WA-3 (2026-09-29): CNC arcs are timed on display chords (`program-timing-options.ts:56`).
- **K-4** WA-4 (2026-09-29): G18/G19 arcs are skipped (`gcode-render-model-builder.ts:362-365`).
- **K-5** PV-3 (2026-09-24): `G10`/`G92`/`G53`/`G28` axis words are drawn as moves in the
  Inspector (`render-model-words.ts` keeps the axis words of unsupported G codes).
- **K-6** `ARC_RADIUS_TOLERANCE_MM = 0.127` against GRBL's 0.005 mm / 0.1 % / 0.5 mm checks, and
  the strict R-form `h_x2_div_d < 0` (2026-07-25 full chain; 2026-09-24 CNC full audit). The
  constant and its "0.005 in" comment are still at `render-model-arc-center.ts:9-10`.
- **K-7** 03-P2-7: false long-blank-feed warnings for image overscan (`laser-off-motion-policy.ts`).
- **K-8** 03-P3-2: the overscan hint says left/right (`preflight.ts:306-315`).
- **K-9** 03-P3-5: the relative envelope seeds 0,0 (`relative-motion-envelope.ts:43`).
- **K-10** 03-P3-12: the Inspector flags Focus Test as a rapid below Z0.
- **K-11** 05-P2-1 and 05-P2-2: Start from line on a resume program, and a late alarm recorded
  without a backlog. Both are untouched.
- **K-12** 09-P2-1: CNC estimates use the laser Max feed.
- **K-13** PV-2 (2026-09-24): the 3D pane samples thin V-bit lines too coarsely
  (`stamp-toolpath.ts` half-cell sampling).

Decided, not raised: ADR-525 times with the family's default planner size, not the session's
`Bf`/`$I` (recovery does use the session size), and keeps a full stop at every `G0`↔`G1`
junction. Both are recorded consequences and push the estimate long.

## Refuted

Candidates the auditor dropped:

- *The ring-window model misreads GRBL.* No. An independent simulation (ring k..k+14, newest
  block planned to rest, `max_entry = min(nominal², prev nominal², junction)`, forward cap) gives
  16.461446556 s against the estimator's 16.461446557 s, and 10.079188263 s against
  10.079188263 s for 100 blocks (`repros-18/…ring-oracle`).
- *The junction formula has the angle inverted.* No. `sinHalf = sqrt((1+prev·next)/2)` equals
  planner.c's `sqrt(0.5*(1-junction_cos_theta))` with the negated dot product.
- *The `mc_arc` chord count differs.* No. `floor(|0.5·θ·r| / sqrt(tol·(2r−tol)))`, with at least
  one chord, matches.
- *A rejected line repeated within the receive window makes the restart skip.* Masked: every
  `controller-error` carries a planner backlog, which steps back further, and the
  nearest-copy rule is tested deliberately.
- *`cnc-tool-geometry-invalid` refuses a policy choice (non-flat roughing or clearing bit).*
  The compiler cannot produce a flat-floor program with that cutter, so this is a compile
  integrity fact, not a policy judgement. A missing bit is also a fact.
- *The M7-unsupported finding should refuse.* AGENTS.md allows refusing a factual failure but
  does not require it. It is warned in Job Review.
- *CNC recovery preflight uses the native WCO as the bed offset.* No. Start and recovery both
  carry `trustedMotionOffsetForPreflight` (bed-converted, `start-job-readiness.ts:258`).
- *Pause and lift loses a `G92` Z zero on its soft reset.* No. `cnc-pause-lift.ts:244-297`
  rewrites one `G92` before anything moves.
- *Zero-length moves desynchronise timing from GRBL.* No. The render model drops moves at or below
  1e-9 mm, and KerfDesk output writes no zero-length moves (ADR-398). GRBL's M3 sync on a
  zero-length move is not reachable from KerfDesk output.

## Verified clean

- **Planner twin (Q1):** the ring cap (`plan-velocities.ts:42-60`) equals GRBL's "newest block from
  a complete stop" over a full ring, independently simulated. Synchronization boundaries match
  GRBL: M3/M4/M5 change, standalone S with the spindle on, coolant, G4 (before motion),
  M2/M30 (after), and Smoothieware/Marlin M400. Nominal speed is the minimum of both neighbours.
  GRBL-family laser arcs are timed on `mc_arc` chords. The transport model counts trimmed bytes +
  LF at 10 bits/byte, as the streamer sends them.
- **Preflight policy (Q2):** `COMPILE_INTEGRITY_PREFLIGHT_CODES` holds only non-finite or
  unencodable coordinates, a FluidNC line too long to execute, empty output, no output layer,
  materialization failures, CNC machine parameters that cannot be formatted, tool geometry the
  compiler cannot honour, and Focus-on-CNC. Out-of-bed, no-go, speed/power, scan offset,
  controller readiness (errors demoted, `start-job-controller-policy.ts`), compiled-work size
  and open contours are advisory. Start, Save, tiles, CNC tool programs and CNC recovery share
  the one set.
- **Preflight bounds per origin (Q2):**
  - Absolute uses the bed-converted WCO when the native frame is known, otherwise program
    coordinates against the profile bed.
  - User Origin and Current Position use the WCO in bed coordinates.
  - Verified Origin always uses the span-only check (ADR-053).
  - Rotary overrides Y to [0, wrap].
  - The native-bed frame is a pure translation, so "program + offset" is exact.
- **Factual line limits:** the GRBL 79-character significant-line limit, grblHAL's 256, FluidNC's
  127-byte payload and the RX window are checked at Start (`line-buffer-limit.ts`) and in emit
  for FluidNC. Feed words never use an exponent (`feed-word.ts`); fractional feeds stay
  fractional.
- **CNC pass resume (Q3):** the proven bound is acked − (planner size + segment lag, floor 32 on
  GRBL), capped at the last acknowledged tool-change M0. The default pass contains the first
  unproven line. Every later pass and group is kept, and air floors are stripped, so every
  pass plunges from safe Z.
- **CNC Pause-and-lift re-entry:** the earliest 3D match inside the same reserve window, arcs
  entered at their start, the modal subset refusing G91/G92/G53/G28/inches, and a lift to the
  highest rapid since the last bit change.
- **Laser resume chains:** recovery of a recovery is computed on, and replayed against, the
  archived resume program. The lineage replay (`recovery-artifact-binding.ts`) reproduces sealed
  bytes before reuse.
- **G-code view twin (Q4):**
  - R-form side selection (positive R minor, negative R major; CW/CCW) matches GRBL's
    `h_x2_div_d` sign rules.
  - I/J are always incremental, F takes the block's own G20/G21, and G91 accumulates.
  - Full circle when the end equals the start, with the same angular-travel sense as `mc_arc`.
  - M2/M30 resets match `gcode.c`.
  - Frame bounds use the exact arc box.

## Not verified

- No hardware. The P2-1 board behaviour (DTR auto-reset on open, USB-powered MCU) is taken from
  the GRBL FAQ, KerfDesk's transport comment and Arduino board design. No board was reset
  mid-job, and the timing of auto-reconnect against the planner drain was not measured.
- GRBL's AVR planning throughput (whether a 328P can parse and plan fine raster lines as fast
  as the ring model assumes), grblHAL/FluidNC segment and planner details beyond the cited
  defaults, and Smoothieware acceleration and junction defaults in timing.
- `src/core/sim` kernels were read, not re-derived (PV-2 aside). The removal grid's agreement with
  emitted CNC G-code (leads, ramps, tabs) belongs to the CNC areas.
- The recovery review dialogs, the restart picker UI and external-run dialog wiring were traced in
  code only.

```json
[
  {"id":"P2-1","severity":"P2","area":"preflight-recovery","file":"src/ui/app/checkpoint-interruption.ts","line":64,"anchor":"Contract: ADR-398 D2 recut-never-skip; Twin: controller-reboot gets planner-size step-back; Ground truth: GRBL FAQ (flow-control lines hardwired to reset), web-serial.ts:253 DTR asserted on open, GRBL acks on queue","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A lost link is always 'disconnect' with no planner backlog; when the controller resets (DTR on auto-reconnect) or loses USB power, the automatic laser restart starts at the first unacked line and skips up to a planner of acknowledged moves (~300 mm in repro)"},
  {"id":"P3-1","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-time/segment-blocks.ts","line":35,"anchor":"Ground truth: Smoothieware Robot.cpp SEEK uses seek_rate (default_seek_rate, sample 4000, code default 100); Twin: marlin-travel-feed.ts writes F on G0","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Smoothieware G0 travel is timed at Max feed while the board runs bare G0 at its seek rate (5.76 s shown vs >=7.74 s at the sample 4000)"},
  {"id":"P3-2","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-view/render-model-placement.ts","line":10,"anchor":"Ground truth: GRBL gcode.c G28/G30 intermediate move obeys current coordinate system and G90/G91; Contract: ADR-630 Amd 1 item 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"External-run Frame outline (and bed/no-go checks) omit the work-coordinate intermediate point of G28/G30 with axis words; warning names only the stored position"},
  {"id":"P3-3","severity":"P3","area":"preflight-recovery","file":"src/core/controllers/grbl/laser-resume-reentry.ts","line":59,"anchor":"Twin: emitter's leading-dot S (decimal-word.ts:25) vs resume WORD_RE; Ground truth: GRBL gcode.c repeated word error 25","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Resume parser misses leading-dot S words (fractional $30 raster); the rewritten tail line gets a second S and GRBL rejects it"},
  {"id":"K-1","severity":"P3","area":"preflight-recovery","file":"src/core/recovery/planner-backlog-restart.ts","line":43,"anchor":"Ground truth: GRBL stepper.c discards a planner block once its steps are in the 6-slot segment buffer; Twin: cnc-resume-point.ts segmentLag","evidence":"SOURCE","verdict":"PENDING","known":"2026-09-25 controller audit OR-3 ('Optionally add the segment-buffer lag')","summary":"Laser restart step-back omits GRBL's segment buffer (~50 ms of motion)"},
  {"id":"K-2","severity":"P2","area":"preflight-recovery","file":"src/core/gcode-time/segment-blocks.ts","line":35,"anchor":"Ground truth: planner.c limit_value_by_axis_maximum","evidence":"READ","verdict":"PENDING","known":"2026-09-24 CNC full audit PV-1","summary":"Timing uses scalar accel/max rate for all directions and Z"},
  {"id":"K-3","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-time/program-timing-options.ts","line":56,"anchor":"Ground truth: GRBL $12 mc_arc","evidence":"READ","verdict":"PENDING","known":"2026-09-29 CNC second pass WA-3","summary":"CNC arcs timed on display chords"},
  {"id":"K-4","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-view/gcode-render-model-builder.ts","line":362,"anchor":"Ground truth: GRBL G18/G19 arcs","evidence":"READ","verdict":"PENDING","known":"2026-09-29 CNC second pass WA-4","summary":"G18/G19 arcs skipped without advancing position"},
  {"id":"K-5","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-view/render-model-words.ts","line":314,"anchor":"Ground truth: GRBL G10/G92/G53/G28 semantics","evidence":"READ","verdict":"PENDING","known":"2026-09-24 CNC full audit PV-3","summary":"Inspector draws G10/G92/G53/G28 axis words as moves"},
  {"id":"K-6","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-view/render-model-arc-center.ts","line":10,"anchor":"Ground truth: gcode.c delta_r 0.005 mm / 0.1% / 0.5 mm","evidence":"READ","verdict":"PENDING","known":"2026-07-25 full chain audit; 2026-09-24 CNC full audit","summary":"Arc radius tolerance 0.127 mm (comment reads GRBL's 0.005 mm as inches)"},
  {"id":"K-7","severity":"P2","area":"preflight-recovery","file":"src/core/preflight/laser-off-motion-policy.ts","line":72,"anchor":"Contract: ADR-415/495","evidence":"READ","verdict":"PENDING","known":"03-P2-7","summary":"Image overscan raises false long-blank-feed warnings"},
  {"id":"K-8","severity":"P3","area":"preflight-recovery","file":"src/core/preflight/preflight.ts","line":306,"anchor":"Twin: ADR-492","evidence":"READ","verdict":"PENDING","known":"03-P3-2","summary":"Overscan out-of-bed hint always says left/right"},
  {"id":"K-9","severity":"P3","area":"preflight-recovery","file":"src/core/preflight/relative-motion-envelope.ts","line":43,"anchor":"Twin: Frame envelope","evidence":"READ","verdict":"PENDING","known":"03-P3-5","summary":"Relative span check seeds work 0,0"},
  {"id":"K-10","severity":"P3","area":"preflight-recovery","file":"src/core/gcode-view/finding-checks.ts","line":91,"anchor":"Twin: laser Z semantics","evidence":"READ","verdict":"PENDING","known":"03-P3-12","summary":"Inspector flags Focus Test as rapid below Z0"},
  {"id":"K-11","severity":"P2","area":"preflight-recovery","file":"src/core/recovery/automatic-restart-line.ts","line":79,"anchor":"Contract: recut never skip","evidence":"READ","verdict":"PENDING","known":"05-P2-1, 05-P2-2","summary":"Start from line on resume programs; late alarm recorded without backlog"},
  {"id":"K-12","severity":"P2","area":"preflight-recovery","file":"src/core/job/estimate-duration.ts","line":78,"anchor":"Contract: ADR-416 D4","evidence":"READ","verdict":"PENDING","known":"09-P2-1","summary":"CNC estimates use the laser Max feed"},
  {"id":"K-13","severity":"P3","area":"preflight-recovery","file":"src/core/sim/stamp-toolpath.ts","line":15,"anchor":"Contract: module promise no touched cell skipped","evidence":"READ","verdict":"PENDING","known":"2026-09-24 CNC full audit PV-2","summary":"3D pane misses thin V-bit lines at half-cell sampling"}
]
```
