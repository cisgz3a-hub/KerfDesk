# D3 — test strength (code quality audit C2)

**Question.** Would the tests catch a real bug in the code that controls the beam and the motion?

**Tree.** `origin/main` @ `8fd1b07c1` (`j29-main`, read-only). All mutation happened in the auditor's own copy, `scratchpad\zz-d3\mut`, which has a `node_modules` junction to `j29-main`. Every mutated file was compared with `j29-main` after each list and found restored (`verify-restore.mjs`: 19 of 19 files `ok`).

**Method.**
- 176 hand-written single mutants were applied in 12 safety-critical module groups, one at a time. Each mutant is valid TypeScript and is realistic: a flipped comparison, a dropped `&&` operand, M3/M4 swapped, a dropped `S0`/`M5`/`G90`, an off-by-one, a skipped laser-off, a dropped `await`, and so on.
- **Stage 1.** Each mutant was run against its module's own tests and the obvious neighbours, 9 to 32 files per list (`lists.json`).
- **Stage 2.** Every stage-1 survivor was run again against a wider list of 17 to 79 files: the stage-1 list plus every test file found by content search that exercises the same rule (Marlin and Smoothieware emitters, `emitGcode` and `prepareOutput` integration, Start placement, rotary placement, tool change, Start flows).
- **Runner.** One persistent Vitest 4.1.11 process per list, through `createVitest` and `runTestSpecifications`. The changed file was invalidated with `invalidateFile`, with bail 1, one worker and `testTimeout` 60 s. Each list ran a clean baseline first; all 12 stage-1 and 8 stage-2 baselines passed.
- **Isolation.** The core emitter and streamer lists ran with `isolate: false`, after a baseline proved it safe. Every UI/store list ran isolated: `stop`, `resume` and `rotary` fail a baseline when isolation is off.
- **Memory gate.** Every run waited for at least 1.5 GB of free RAM.

## Headline

**Kill rate: 75 % by the module's own tests (132 of 176), and 81 % once wider neighbours are counted (143 of 176). 33 mutants survive both stages.** Six of the 33 are equivalent or nearly so, which gives 143 of 170 (84 %) on non-equivalent mutants.

- **Strong.**
  - The GRBL streamer (14 of 14) and the Frame/Start permit (14 of 14) killed every mutant.
  - Fill emission killed 10 of 10, one of them only through a neighbour.
  - The oracle-style tests carry most of the weight: the resume emitter oracle, the `cnc-motion-emitter` property test, `grbl-strategy-m3-lit-drain` and `grbl-fill-compaction`. They catch mutants nobody wrote a direct test for.
- **Weak.**
  - **Abort (`laser-job-stop.ts`) kills 4 of 14.** All 10 survivors also passed 41 stop, reset, lifecycle and abort-simulator files.
  - **The Job Review gate kills 5 of 14.** Its "reuse the prepared bytes" shortcut and its run-again guards have no negative test.
  - **Preflight kills 7 of 14 itself.** Five more, including bed bounds under a motion offset, no-go zones under an offset and the rotary wrap, die only in far-away integration tests (`start-job-placement`, `native-coordinate-placement`, `emit-gcode-rotary`).
- **Five survivors would silently change a burn, a stop or a motion**, so they are rated P1 under the "reach main unchecked" clause:
  - Offset Fill passes;
  - the raster feed after a controlled laser-off seek;
  - two Smoothieware Abort guards;
  - the CNC max safe Z.

## Per-module results

Killed (stage 1) means a test in the module's own list failed. Killed (stage 2) means only a wider neighbour failed. Survived means it passed both lists.

| Module | Mutants | Killed (stage 1) | Killed (stage 2 only) | Survived | Not run | Own-test kill rate | Kill rate incl. neighbours |
|---|---|---|---|---|---|---|---|
| GRBL emitter (grbl-strategy, grbl-laser-lines, grbl-power-modes) | 24 | 20 | 2 | 2 | 0 | 83 % | 92 % |
| emit-raster-sweep | 13 | 9 | 2 | 2 | 0 | 69 % | 85 % |
| grbl-fill-emission | 10 | 9 | 1 | 0 | 0 | 90 % | 100 % |
| GRBL streamer (char counting) | 14 | 14 | 0 | 0 | 0 | 100 % | 100 % |
| laser-job-stop (Abort) | 14 | 4 | 0 | 10 | 0 | 29 % | 29 % |
| resume-program (start from line) | 14 | 12 | 0 | 2 | 0 | 86 % | 86 % |
| rotary-transform + rotary-surface-feed | 16 | 14 | 0 | 2 | 0 | 88 % | 88 % |
| framed-run (Frame/Start permit) | 14 | 14 | 0 | 0 | 0 | 100 % | 100 % |
| job-review-gate | 14 | 5 | 0 | 9 | 0 | 36 % | 36 % |
| preflight + bounds predicates | 14 | 7 | 5 | 2 | 0 | 50 % | 86 % |
| CNC spindle / safe Z | 17 | 14 | 1 | 2 | 0 | 82 % | 88 % |
| worker-refill-handover (Marlin worker refill) | 12 | 10 | 0 | 2 | 0 | 83 % | 83 % |
| **Total** | **176** | **132** | **11** | **33** | **0** | **75 %** | **81 %** |

## Full mutant list

- **Anchors** are `file:line` on `8fd1b07c1`.
- **Lists** (exact files in `zz-d3\lists.json`):

  | Key | Files | What it holds |
  |---|---|---|
  | `grbl` | 32 | `src/core/output` GRBL tests |
  | `raster` | 17 | |
  | `fill` | 15 | |
  | `streamer` | 14 | |
  | `stop` | 17 | |
  | `resume` | 19 | |
  | `rotary` | 27 | |
  | `frame` | 17 | |
  | `gate` | 9 | |
  | `preflight` | 19 | |
  | `cnc` | 20 | |
  | `refill` | 13 | |
  | `x_emit` | 79 | `grbl` + `raster` + `fill`, plus Marlin and Smoothieware emitters, `emitGcode` lit-drain, scan-offset compile tests and Job Review facts |
  | `x_stop` | 41 | |
  | `x_resume` | 23 | |
  | `x_rotary` | 31 | |
  | `x_gate` | 22 | |
  | `x_preflight` | 34 | |
  | `x_cnc` | 31 | |
  | `x_refill` | 17 | |

- **"Killed by"** is the first failing test.

| Id | Where | Mutant | Result | Lists run | Killed by |
|---|---|---|---|---|---|
| G01 | `src/core/output/grbl-strategy.ts:102` | preamble drops G90 | KILLED | grbl | grbl-laser-arc-moves.test.ts > grblStrategy laser arc moves (ADR-432) > selects the G17 plane before the first |
| G02 | `src/core/output/grbl-strategy.ts:116` | postamble never writes M5 | KILLED | grbl | grbl-strategy-4040-contour-exit.test.ts > 4040 contour exit emission (ADR-239 Amendment 2) > switches the lase |
| G03 | `src/core/output/grbl-strategy.ts:420` | M3 re-armed only from M4 (not after a raster's M5) | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G04 | `src/core/output/grbl-strategy.ts:421` | M3->M4 flip drops the clearing M5 | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G05 | `src/core/output/grbl-strategy.ts:470` | mode not reset to off after raster | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G06 | `src/core/output/grbl-strategy.ts:150` | two-point segments dropped (off-by-one) | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G07 | `src/core/output/grbl-strategy.ts:163` | cut burns never noted lit on the cursor (OR-1 hold lost) | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G08 | `src/core/output/grbl-strategy.ts:407` | air off (M9) never written | KILLED | grbl | grbl-strategy-m3-lit-drain.test.ts > OR-1 |
| G09 | `src/core/output/grbl-strategy.ts:238` | focus test accepts S0 as a represented burn | KILLED | grbl | focus-represented-power-regression.test.ts > Focus requires represented positive laser power > omits Z for emi |
| G10 | `src/core/output/grbl-strategy.ts:480` | held lines at job end dropped | KILLED | grbl | grbl-strategy-job-end-held-air.test.ts > 03-P2-1 |
| G11 | `src/core/output/grbl-strategy.ts:484` | postamble skips M5 after an M4 group | KILLED | grbl | grbl-strategy-job-end-held-air.test.ts > 03-P2-1 |
| G12 | `src/core/output/grbl-strategy.ts:335` | image ignores layer scan offset override | KILLED only by a neighbour (stage 2) | grbl + x_emit | split-runway-controller-grid.test.ts > shared split runway endpoints on the controller grid > keeps both Image |
| G13 | `src/core/output/grbl-strategy.ts:332` | image overscan forced to 0 | KILLED | grbl | grbl-fill-compaction.test.ts > compact Fill sweep delivery > reduces 4040 image wire demand while preserving e |
| G14 | `src/core/output/grbl-strategy.ts:333` | image dot width correction dropped | KILLED | grbl | grayscale-dot-width-line-ends.test.ts > Grayscale with Dot Width Correction (Q1-P1-1, ADR-458 Amendment 1) > l |
| G15 | `src/core/output/grbl-strategy.ts:296` | offset fill runs one pass only | SURVIVED (stage 1 and stage 2) | grbl + x_emit |  |
| G16 | `src/core/output/grbl-strategy.ts:443` | stopKeepsPower (Marlin) ignored by cursor | KILLED only by a neighbour (stage 2) | grbl + x_emit | emit-gcode-m3-lit-drain.test.ts > OR-1 through emitGcode on Marlin |
| L01 | `src/core/output/grbl-laser-lines.ts:29` | S scaling floors instead of rounds | KILLED | grbl | grbl-strategy.property.test.ts > grblStrategy property tests > power-scale |
| L02 | `src/core/output/grbl-laser-lines.ts:56` | G0 seek never carries S0 | KILLED | grbl | grbl-strategy.property.test.ts > grblStrategy property tests > emits zero laser-on-travel issues across 100 ra |
| L03 | `src/core/output/grbl-laser-lines.ts:60` | laser-off runway G1 loses its S0 | KILLED | grbl | grbl-fill-compaction-resume.test.ts > lossless Fill motion compaction (ADR-460) > preserves both axes on a 0 d |
| L04 | `src/core/output/grbl-laser-lines.ts:32` | virtual power range loses 0.1 % step | KILLED | grbl | small-whole-number-power-range.test.ts > small whole-number $30 power range > scales vector power in the virtu |
| M01 | `src/core/output/grbl-power-modes.ts:18` | M3/M4 swapped | KILLED | grbl | grbl-fill-compaction-resume.test.ts > lossless Fill motion compaction (ADR-460) > restores G1 and axes after h |
| M02 | `src/core/output/grbl-power-modes.ts:27` | per-layer power mode override ignored | KILLED | grbl | grbl-fill-compaction-resume.test.ts > lossless Fill motion compaction (ADR-460) > restores G1 and axes after h |
| M03 | `src/core/output/grbl-power-modes.ts:28` | fill uses the cut power mode | KILLED | grbl | grbl-strategy-4040-split-entry.test.ts > 4040 split-fill controlled entry emission > shares the enlarged J gap |
| M04 | `src/core/output/grbl-power-modes.ts:44` | raster words report the cut mode | SURVIVED (stage 1 and stage 2) | grbl + x_emit |  |
| R01 | `src/core/raster/emit-raster-sweep.ts:312` | S written only when power rises | KILLED | raster | emit-raster-compaction.test.ts > raster compact motion spelling (ADR-332) > holds the modal motion word, the m |
| R02 | `src/core/raster/emit-raster-sweep.ts:280` | row close (overscan exit) loses S0 | KILLED | raster | emit-raster-compaction.test.ts > raster compact motion spelling (ADR-332) > never emits a power-only block |
| R03 | `src/core/raster/emit-raster-sweep.ts:49` | forward rows lose their lead-in overscan | KILLED | raster | emit-raster-compaction.test.ts > raster compact motion spelling (ADR-332) > holds the modal motion word, the m |
| R04 | `src/core/raster/emit-raster-sweep.ts:53` | scan offset applied to the wrong direction | KILLED | raster | emit-raster-scan-offset.test.ts > emitRasterGroup scan-offset compensation > moves forward and reverse rows ha |
| R05 | `src/core/raster/emit-raster-sweep.ts:43` | active span end off by one pixel | KILLED | raster | emit-raster-scan-offset.test.ts > emitRasterGroup scan-offset compensation > moves forward and reverse rows ha |
| R06 | `src/core/raster/emit-raster-sweep.ts:160` | no row close when overscan 0 and no dot correction | KILLED | raster | emit-raster-scan-offset.test.ts > emitRasterGroup scan-offset compensation > does not apply scan offset when b |
| R07 | `src/core/raster/emit-raster-sweep.ts:206` | lit M3 handover entry excursion skipped | KILLED | raster | grbl-raster-coincident-handoff.test.ts > coincident vector to 'Compatible M3 verbose' Image handoff > darkens  |
| R08 | `src/core/raster/emit-raster-sweep.ts:167` | sweep never reports a lit ending | KILLED | raster | grbl-raster-coincident-handoff.test.ts > coincident M3 Image to following group handoff > retains the Image en |
| R09 | `src/core/raster/emit-raster-sweep.ts:99` | Marlin stopKeepsPower lit stop not reported | KILLED only by a neighbour (stage 2) | raster + x_emit | marlin-raster-lit-end.test.ts > a Marlin image layer with zero overscan ends dark > inline > image, then a cut |
| R10 | `src/core/raster/emit-raster-sweep.ts:134` | engraving F not reasserted after controlled G1 seek | SURVIVED (stage 1 and stage 2) | raster + x_emit |  |
| R11 | `src/core/raster/emit-raster-sweep.ts:202` | zero-length laser-off move written under M3 | SURVIVED (stage 1 and stage 2) | raster + x_emit |  |
| R12 | `src/core/raster/emit-raster-sweep.ts:311` | non-modal-feed dialect loses F on burn runs | KILLED | raster | emit-raster-serial-density.test.ts > raster serial-density evidence fixture > quantifies narrow headroom at 0. |
| R13 | `src/core/raster/emit-raster-sweep.ts:239` | zero-length close marks the sweep dark | KILLED only by a neighbour (stage 2) | raster + x_emit | marlin-raster-lit-end.test.ts > a Marlin image layer with zero overscan ends dark > inline > image, then a cut |
| F01 | `src/core/output/grbl-fill-emission.ts:193` | interior gaps burned at layer power | KILLED | fill | grbl-fill-compaction.test.ts > compact Fill sweep delivery > preserves every decoded move at 0 degrees in both |
| F02 | `src/core/output/grbl-fill-emission.ts:109` | lead-in runway skipped (burn starts at runway start) | KILLED | fill | grbl-fill-compaction.test.ts > compact Fill sweep delivery > brings a dense 0.04 mm Fill sweep below the 11520 |
| F03 | `src/core/output/grbl-fill-emission.ts:127` | rapid/feed runway motion swapped | KILLED | fill | grbl-strategy-generic-fill-runway.test.ts > generic Scan Line feed-matched runway emission > surrounds a sub-m |
| F04 | `src/core/output/grbl-fill-emission.ts:170` | non-modal-feed dialect loses F | KILLED | fill | grbl-fill-compaction.test.ts > compact Fill sweep delivery > reduces 4040 fill wire demand while preserving ex |
| F05 | `src/core/output/grbl-fill-emission.ts:72` | fill ignores layer scan offset override | KILLED only by a neighbour (stage 2) | fill + x_emit | split-runway-controller-grid.test.ts > shared split runway endpoints on the controller grid > keeps reversed F |
| F06 | `src/core/output/grbl-fill-emission.ts:98` | fill drops rotary surface feed match | KILLED | fill | emit-gcode-rotary-surface-feed.test.ts > rotary strokes move the surface at the layer speed (ADR-127 Amd 2) >  |
| F07 | `src/core/output/grbl-fill-emission.ts:75` | scanline fill runs one pass only | KILLED | fill | grbl-fill-compaction.test.ts > compact Fill sweep delivery > preserves every decoded move at 0 degrees in both |
| F08 | `src/core/output/grbl-fill-emission.ts:185` | fill burns never noted lit (OR-1) | KILLED | fill | grbl-fill-compaction-resume.test.ts > lossless Fill motion compaction (ADR-460) > restores G1 and axes after h |
| F09 | `src/core/output/grbl-fill-emission.ts:160` | zero-length test ignores Y | KILLED | fill | grbl-fill-compaction-resume.test.ts > lossless Fill motion compaction (ADR-460) > preserves both axes on a 90  |
| F10 | `src/core/output/grbl-fill-emission.ts:115` | lead-out runway skipped | KILLED | fill | grbl-strategy-generic-fill-runway.test.ts > generic Scan Line feed-matched runway emission > surrounds a sub-m |
| S01 | `src/core/controllers/grbl/streamer.ts:218` | line bytes exclude the newline | KILLED | streamer | streamer-planner-starvation.test.ts > grbl streamer planner starvation (ADR-331) > drains a 512-block planner  |
| S02 | `src/core/controllers/grbl/streamer.ts:209` | ping-pong batches lines | KILLED | streamer | laser-stream-ack-stall.test.ts > acknowledgement stall containment > freezes a non-resettable sender before be |
| S03 | `src/core/controllers/grbl/streamer.ts:221` | EEPROM write not alone in window | KILLED | streamer | eeprom-write-line.test.ts > streamer EEPROM sync point > sends an EEPROM write alone, into an empty window, an |
| S04 | `src/core/controllers/grbl/streamer.ts:302` | ALARM keeps in-flight lines | KILLED | streamer | streamer.test.ts > onAck — consuming acks > an alarm ack wipes ALL in-flight accounting, not just the head lin |
| S05 | `src/core/controllers/grbl/streamer.ts:332` | error:N no longer terminal | KILLED | streamer | streamer.test.ts > onAck — consuming acks > makes an error ack terminal (errored) and refuses to send more (P0 |
| S06 | `src/core/controllers/grbl/streamer.ts:340` | error with nothing in flight ignored | KILLED | streamer | streamer.test.ts > onAck — consuming acks > marks a drained streaming state errored on an error ack with nothi |
| S07 | `src/core/controllers/grbl/streamer.ts:348` | done tail cannot be paused | KILLED | streamer | streamer.test.ts > pause / resume / cancel > pauses an acknowledged tail that is still executing and returns t |
| S08 | `src/core/controllers/grbl/streamer.ts:334` | paused stream promotes to done | KILLED | streamer | streamer.test.ts > onAck — consuming acks > stays paused while the held tail acks out (no done promotion durin |
| S09 | `src/core/controllers/grbl/streamer.ts:184` | errored not terminal | KILLED | streamer | streamer.test.ts > onAck — consuming acks > does not send the next queued line after an error (no laser-on aft |
| S10 | `src/core/controllers/grbl/streamer.ts:274` | tool-change continue does not drop the M0 | KILLED | streamer | streamer-tool-change.test.ts > streamer tool-change pause (CNC-01) > continueToolChange drops the M0, counts i |
| S11 | `src/core/controllers/grbl/streamer.ts:171` | oversized-line fast path off by one | KILLED | streamer | sendable-line-scan.test.ts > longestSendableLineSpan > finds no line over any limit at or above it in "G21\n" |
| S12 | `src/core/controllers/grbl/streamer.ts:409` | wipeInFlight is a no-op | KILLED | streamer | streamer.test.ts > onAck — consuming acks > wipeInFlight clears in-flight accounting without changing status |
| S13 | `src/core/controllers/grbl/streamer.ts:308` | ALARM counted as an acknowledged line | KILLED | streamer | streamer.test.ts > onAck — consuming acks > an alarm ack wipes ALL in-flight accounting, not just the head lin |
| S14 | `src/core/controllers/grbl/streamer.ts:215` | imported M0 swallowed as tool change | KILLED | streamer | streamer-tool-change.test.ts > streamer tool-change pause (CNC-01) > does NOT swallow M0 when toolChangePause  |
| X01 | `src/ui/state/laser-job-stop.ts:312` | non-GRBL reset stop leaves the streamer active | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X02 | `src/ui/state/laser-job-stop.ts:336` | Smoothie reset path does not await refill release | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X03 | `src/ui/state/laser-job-stop.ts:376` | GRBL reset path does not await refill release | KILLED | stop | laser-unowned-motion-stop.simulator.test.ts > Abort completion after reconnect > preserves the replacement con |
| X04 | `src/ui/state/laser-job-stop.ts:203` | Marlin Abort does not cancel the streamer | KILLED | stop | laser-job-stop-write-race.test.ts > Marlin Abort owns delayed transport writes > does not refill during a dela |
| X05 | `src/ui/state/laser-job-stop.ts:456` | stop lines keep writing after ownership lost | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X06 | `src/ui/state/laser-job-stop.ts:444` | quickstop reported sent after a failed write | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X07 | `src/ui/state/laser-job-stop.ts:111` | app-closing waits for jog hold | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X08 | `src/ui/state/laser-job-stop.ts:177` | Marlin stop lines wait behind the refill handback (N1-P2-1 regression) | KILLED | stop | laser-job-stop-write-race.test.ts > Marlin Abort owns delayed transport writes > takes an armed worker refill  |
| X09 | `src/ui/state/laser-job-stop.ts:415` | reset write failure swallowed when epoch unchanged | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X10 | `src/ui/state/laser-job-stop.ts:488` | Z rotary start turn ignores inch reports | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X11 | `src/ui/state/laser-job-stop.ts:221` | stop ownership ignores a newer stream | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X12 | `src/ui/state/laser-job-stop.ts:151` | Abort competes with Disconnect's stop | KILLED | stop | laser-disconnect-command-ownership.test.ts > Abort during a no-reset Disconnect > leaves the stop and the disc |
| X13 | `src/ui/state/laser-job-stop.ts:113` | jog stop result applied after session change | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| X14 | `src/ui/state/laser-job-stop.ts:435` | no-reset stop raises no unconfirmed notice | SURVIVED (stage 1 and stage 2) | stop + x_stop |  |
| P01 | `src/core/controllers/grbl/resume-program.ts:292` | resume preamble drops G90 | KILLED | resume | resume-travel-arcs.test.ts > R1 arc-aware recovery XY travel > control |
| P02 | `src/core/controllers/grbl/resume-program.ts:335` | resume does not start with M5 | KILLED | resume | resume-travel-arcs.test.ts > R1 arc-aware recovery XY travel > control |
| P03 | `src/core/controllers/grbl/resume-program.ts:355` | re-entry G0 loses S0 | KILLED | resume | resume-travel-arcs.test.ts > R1 arc-aware recovery XY travel > control |
| P04 | `src/core/controllers/grbl/resume-program.ts:339` | re-arm without S0 | KILLED | resume | resume-travel-arcs.test.ts > R1 arc-aware recovery XY travel > control |
| P05 | `src/core/controllers/grbl/resume-program.ts:236` | G91 programs not refused | KILLED | resume | resume-program.test.ts > buildResumeProgram > refuses out-of-range lines, G91 programs, and empty tails for la |
| P06 | `src/core/controllers/grbl/resume-program.ts:247` | G54 not tracked as a WCS | SURVIVED (stage 1 and stage 2) | resume + x_resume |  |
| P07 | `src/core/controllers/grbl/resume-program.ts:129` | entry point ignores G20 inches | KILLED | resume | resume-travel-arc-boundaries.test.ts > R1 arc travel geometry boundaries > counts a nonzero I/J full circle an |
| P08 | `src/core/controllers/grbl/resume-program.ts:168` | modal scan includes the resume line | KILLED | resume | resume-program.native-oracle.test.ts > laser resume on 'Smoothieware (M221 power scale)' > burns what the orig |
| P09 | `src/core/controllers/grbl/resume-program.ts:347` | flood air not re-issued | KILLED | resume | resume-program.emitter-oracle.test.ts > laser resume against an independent interpreter of real emitter output |
| P10 | `src/core/controllers/grbl/resume-program.ts:92` | tail skips the chosen line | KILLED | resume | resume-program.emitter-oracle.test.ts > laser resume against an independent interpreter of real emitter output |
| P11 | `src/core/controllers/grbl/resume-program.ts:340` | feed not restored | KILLED | resume | resume-program.emitter-oracle.test.ts > laser resume against an independent interpreter of real emitter output |
| P12 | `src/core/controllers/grbl/resume-program.ts:266` | M4 tracked as M3 | KILLED | resume | resume-program.emitter-oracle.test.ts > laser resume against an independent interpreter of real emitter output |
| P13 | `src/core/controllers/grbl/resume-program.ts:237` | G53 not refused | KILLED | resume | resume-program.test.ts > buildResumeProgram > refuses programs with G53/G28/G30 before the laser resume point |
| P14 | `src/core/controllers/grbl/resume-program.ts:267` | M5 not tracked | SURVIVED (stage 1 and stage 2) | resume + x_resume |  |
| T01 | `src/core/job/rotary-transform.ts:72` | reverse rotary ignored | KILLED | rotary | returning-user-rotary-1-0-30.test.ts > rotary projects saved by 1.0.30 (ADR-694 returning user) > chuck-revers |
| T02 | `src/core/job/rotary-transform.ts:63` | A/Z axis does not start at 0 | KILLED | rotary | emit-gcode-rotary-fill-ramp.test.ts > ramped Fill on a rotary (ADR-699 Amd 1, Z3-P1-1) > Z axis, Current Posit |
| T03 | `src/core/job/rotary-transform.ts:66` | reverse window unscaled | KILLED | rotary | returning-user-rotary-1-0-30.test.ts > rotary projects saved by 1.0.30 (ADR-694 returning user) > chuck-revers |
| T04 | `src/core/job/rotary-transform.ts:94` | reverse at scale 1 returns unmirrored job | KILLED | rotary | rotary-job.test.ts > machineSpaceJob (R3 single source of truth) > reverseAxis on a roller (scale 1) still mir |
| T05 | `src/core/job/rotary-transform.ts:137` | Y range ignores final-pass overcut | KILLED | rotary | laser-leads-edge-cases.test.ts > laser lead edge cases (ADR-626) > maps the final-pass burn through the rotary |
| T06 | `src/core/job/rotary-transform.ts:190` | final pass burn not scaled | KILLED | rotary | laser-leads-edge-cases.test.ts > laser lead edge cases (ADR-626) > maps the final-pass burn through the rotary |
| T07 | `src/core/job/rotary-transform.ts:165` | reverse raster rows not reversed | KILLED | rotary | returning-user-rotary-1-0-30.test.ts > rotary projects saved by 1.0.30 (ADR-694 returning user) > chuck-revers |
| T08 | `src/core/job/rotary-transform.ts:99` | surface Y scale not recorded (feed match lost) | KILLED | rotary | returning-user-rotary-1-0-30.test.ts > rotary projects saved by 1.0.30 (ADR-694 returning user) > chuck with a |
| T09 | `src/core/job/rotary-transform.ts:164` | raster bounds not scaled | KILLED | rotary | returning-user-rotary-1-0-30.test.ts > rotary projects saved by 1.0.30 (ADR-694 returning user) > chuck with a |
| T10 | `src/core/output/rotary-surface-feed.ts:37` | Fill-only rotary job gets no feed match | KILLED | rotary | rotary-axis-rate-warnings.test.ts > the rotary axis max rate in Job Review > warns when strokes round the part |
| T11 | `src/core/output/rotary-surface-feed.ts:99` | surface length multiplies by k | KILLED | rotary | rotary-axis-rate-warnings.test.ts > the rotary axis max rate in Job Review > warns when strokes round the part |
| T12 | `src/core/output/rotary-surface-feed.ts:51` | feed ceiling not applied | KILLED | rotary | emit-gcode-rotary-surface-feed.test.ts > rotary strokes move the surface at the layer speed (ADR-127 Amd 2) >  |
| T13 | `src/core/output/rotary-surface-feed.ts:106` | ceiling below layer feed | SURVIVED (stage 1 and stage 2) | rotary + x_rotary |  |
| T14 | `src/core/output/rotary-surface-feed.ts:98` | taper factor sampled at move start | SURVIVED (stage 1 and stage 2) | rotary + x_rotary |  |
| T15 | `src/core/output/rotary-surface-feed.ts:67` | dose rise always 1 (Job Review warning lost) | KILLED | rotary | rotary-axis-rate-warnings.test.ts > the rotary axis max rate in Job Review > leaves the Y-port Max feed warnin |
| T16 | `src/core/output/rotary-surface-feed.ts:36` | taper at k=1 gets no feed match | KILLED | rotary | rotary-surface-speed-warnings.test.ts > detectRotarySurfaceSpeedWarnings (ADR-127 Amd 2) > warns at the narrow |
| K01 | `src/ui/state/framed-run.ts:277` | Start handoff accepts a newer controller session | KILLED | frame | completed-frame-run.audit.test.ts > reusable Frame rebases only after its own clean execution > refuses to ado |
| K02 | `src/ui/state/framed-run.ts:285` | Start handoff ignores origin change | KILLED | frame | completed-frame-run.audit.test.ts > reusable Frame rebases only after its own clean execution > refuses to ado |
| K03 | `src/ui/state/framed-run.ts:286` | Start handoff ignores head movement | KILLED | frame | completed-frame-run.audit.test.ts > reusable Frame rebases only after its own clean execution > keeps Current  |
| K04 | `src/ui/state/framed-run.ts:319` | Start origin ignores trusted-position epoch | KILLED | frame | completed-frame-run.audit.test.ts > reusable Frame rebases only after its own clean execution > refuses to ado |
| K05 | `src/ui/state/framed-run.ts:307` | Frame completion ignores Z-zero evidence | KILLED | frame | framed-run.test.ts > FramedRun completion evidence > refuses factual controller, origin, or work-Z drift |
| K06 | `src/ui/state/framed-run.ts:432` | position tolerance 1 mm | KILLED | frame | framed-run.test.ts > FramedRun completion evidence > accepts only the dispatched CNC safe-Z return with a repr |
| K07 | `src/ui/state/framed-run.ts:435` | position compare ignores Z | KILLED | frame | framed-run.test.ts > FramedRun completion evidence > accepts only the dispatched CNC safe-Z return with a repr |
| K08 | `src/ui/state/framed-run.ts:410` | MPos used without the WCO it needs | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > refuses missing coordinates |
| K09 | `src/ui/state/framed-run.ts:407` | reported position ignores inch reports | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > rejects 'inch' movement bey |
| K10 | `src/ui/state/framed-run.ts:424` | null WCO equals any WCO | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > accepts a first WCO report  |
| K11 | `src/ui/state/framed-run.ts:263` | Frame completion ignores the return position | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > rejects 'mm' movement beyon |
| K12 | `src/ui/state/framed-run.ts:345` | missing status report counts as same position | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > refuses missing coordinates |
| K13 | `src/ui/state/framed-run.ts:281` | Start handoff ignores report-unit change | KILLED | frame | framed-run-position-representation.test.ts > 'final Start handoff' position reports > binds report-unit interp |
| K14 | `src/ui/state/framed-run.ts:306` | Frame completion ignores trusted-position epoch | KILLED | frame | framed-run-position-representation.test.ts > 'Frame completion' position reports > keeps exact offset and orig |
| J01 | `src/ui/laser/job-review/job-review-gate.ts:183` | same-artifact test ignores G-code bytes | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J02 | `src/ui/laser/job-review/job-review-gate.ts:130` | Confirm accepted on changed/blocked review | KILLED | gate | job-review-gate.test.ts > runJobReviewGate through runStartJobFlow > rebuilds live identity evidence on Confir |
| J03 | `src/ui/laser/job-review/job-review-gate.ts:336` | time-bound job (variable text) reused | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J04 | `src/ui/laser/job-review/job-review-gate.ts:340` | reuse ignores controller preparation staleness | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J05 | `src/ui/laser/job-review/job-review-gate.ts:344` | machine inputs key compared with itself | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J06 | `src/ui/laser/job-review/job-review-gate.ts:356` | coordinate key compared with itself | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J07 | `src/ui/laser/job-review/job-review-gate.ts:482` | frame-first refusal never raised on rebuild | KILLED | gate | run-again-review-carry.conditions.test.ts > a stand-in the review gate refuses > opens the dialog and leaves t |
| J08 | `src/ui/laser/job-review/job-review-gate.ts:452` | run-again replay compile mismatch ignored | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J09 | `src/ui/laser/job-review/job-review-gate.ts:166` | aborted preparation not treated as cancelled | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J10 | `src/ui/laser/job-review/job-review-gate.ts:232` | Frame no-go warnings dropped | KILLED | gate | job-review-gate.test.ts > runJobReviewGate through runStartJobFlow > preserves frame purpose and rebuilds with |
| J11 | `src/ui/laser/job-review/job-review-gate.ts:241` | G54 normalisation warning dropped | KILLED | gate | job-review-gate.test.ts > runJobReviewGate through runStartJobFlow > preserves frame purpose and rebuilds with |
| J12 | `src/ui/laser/job-review/job-review-gate.ts:173` | abandon owner check ignored on signal | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| J13 | `src/ui/laser/job-review/job-review-gate.ts:448` | rebuild drops Frame disclosures | KILLED | gate | job-review-gate.test.ts > runJobReviewGate through runStartJobFlow > preserves frame purpose and rebuilds with |
| J14 | `src/ui/laser/job-review/job-review-gate.ts:423` | run-again signature change ignored | SURVIVED (stage 1 and stage 2) | gate + x_gate |  |
| B01 | `src/core/invariants/predicates.ts:196` | bounds check 1 mm tolerance | KILLED | preflight | standalone-cnc-preflight.test.ts > runStandaloneCncPreflight > enforces device feed and work-origin bed limits |
| B02 | `src/core/invariants/predicates.ts:196` | bounds check ignores the motion offset | KILLED only by a neighbour (stage 2) | preflight + x_preflight | start-job-placement.test.ts > prepareStartJob job placement > warns when a homed custom work origin would push |
| B03 | `src/core/invariants/predicates.ts:176` | arc bulge X max ignores offset | SURVIVED (stage 1 and stage 2) | preflight + x_preflight |  |
| B04 | `src/core/invariants/predicates.ts:100` | bed max Y from width | KILLED | preflight | predicates.test.ts > findOutOfBoundsCoords > flags a G2 arc whose bulge clears the bed even though both endpoi |
| B05 | `src/core/invariants/predicates.ts:136` | G3 arc bulge not checked | KILLED | preflight | predicates.test.ts > findOutOfBoundsCoords > flags a full circle whose radius pokes below the bed |
| B06 | `src/core/invariants/predicates.ts:66` | sticky S only follows S0 (laser-on G0 passes) | KILLED | preflight | preflight.test.ts > runPreflight laser-off travel invariant > flags G0 travel while the laser may still be arm |
| B07 | `src/core/preflight/preflight.ts:324` | flat bed loses its Y check | KILLED only by a neighbour (stage 2) | preflight + x_preflight | emit-gcode-rotary-placement.test.ts > rotary output keeps the placement anchor (03-P2-3) > checks rotary Y by  |
| B08 | `src/core/preflight/preflight.ts:332` | relative envelope used even with a known offset | SURVIVED (stage 1 and stage 2) | preflight + x_preflight |  |
| B09 | `src/core/preflight/preflight.ts:342` | bounds ignore the motion offset | KILLED only by a neighbour (stage 2) | preflight + x_preflight | start-job-placement.test.ts > prepareStartJob job placement > warns when a homed custom work origin would push |
| B10 | `src/core/preflight/preflight.ts:202` | laser-on travel check not run | KILLED | preflight | preflight.test.ts > runPreflight laser-off travel invariant > flags G0 travel while the laser may still be arm |
| B11 | `src/core/preflight/preflight.ts:278` | power over 100 % accepted | KILLED | preflight | preflight.test.ts > runPreflight — F-A10 check 3 |
| B12 | `src/core/preflight/preflight.ts:313` | speed above machine max accepted | KILLED | preflight | preflight.test.ts > runPreflight — F-A10 check 4 |
| B13 | `src/core/preflight/preflight.ts:331` | rotary wrap issue dropped | KILLED only by a neighbour (stage 2) | preflight + x_preflight | emit-gcode-rotary.test.ts > emitGcode rotary (ADR-127) > refuses a job taller than one revolution (wrap) |
| B14 | `src/core/preflight/preflight.ts:258` | no-go zones ignore the motion offset | KILLED only by a neighbour (stage 2) | preflight + x_preflight | native-coordinate-placement.test.ts > native negative runtime placement > detects the real initial approach cr |
| C01 | `src/core/output/cnc-grbl-transitions.ts:113` | M3 without the safe-Z retract | KILLED | cnc | cnc-pass-spans.test.ts > emitCncJobWithPassSpans > maps spans to job group indices and pass indices |
| C02 | `src/core/output/cnc-grbl-transitions.ts:119` | spin-up dwell never written | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > emits the CNC preamble |
| C03 | `src/core/output/cnc-grbl-emit-head.ts:28` | negative safe Z not clamped | SURVIVED (stage 1 and stage 2) | cnc + x_cnc |  |
| C04 | `src/core/output/cnc-grbl-emit-head.ts:29` | retract skipped whenever Z is known | KILLED | cnc | relief-air-floor-emission.test.ts > relief floors survive final placement and output rounding > retains an ide |
| C05 | `src/core/output/cnc-grbl-strategy.ts:307` | contour pass rapids XY without retract | KILLED | cnc | cnc-motion-emitter.property.test.ts > cnc emitter × motion invariant (property) > emitted G-code never travels |
| C06 | `src/core/output/cnc-grbl-entry-descent.ts:31` | plunge written as a rapid | KILLED | cnc | cnc-motion-emitter.property.test.ts > cnc emitter × motion invariant (property) > emitted G-code never travels |
| C07 | `src/core/output/cnc-grbl-entry-descent.ts:41` | air rapid may go below pass Z | KILLED | cnc | cnc-grbl-entry-descent.test.ts > entry descent over a proven air floor (ADR-489) > plunges from safe Z as befo |
| C08 | `src/core/output/cnc-grbl-entry-descent.ts:39` | air rapid clearance 0 | KILLED | cnc | cnc-grbl-entry-descent.test.ts > entry descent over a proven air floor (ADR-489) > rapids a contour pass down  |
| C09 | `src/core/output/cnc-grbl-strategy.ts:170` | job end leaves spindle on | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > ends with retract, spindle off, and XY park |
| C10 | `src/core/output/cnc-grbl-strategy.ts:169` | park height = last group's safe Z | KILLED | cnc | cnc-grbl-park-height.test.ts > CNC park height (ADR-491) > lifts to the park height before the job-end park |
| C11 | `src/core/output/cnc-grbl-transitions.ts:96` | tool change keeps tracked XY (F23) | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > repositions XY after a tool change even when the pass starts at  |
| C12 | `src/core/output/cnc-grbl-transitions.ts:52` | max safe Z not accumulated | SURVIVED (stage 1 and stage 2) | cnc + x_cnc |  |
| C13 | `src/core/output/cnc-grbl-transitions.ts:33` | CNC preamble drops G90 | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > emits the CNC preamble |
| C14 | `src/core/output/cnc-grbl-transitions.ts:114` | spindle started reversed (M4) | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > emits the CNC preamble |
| C15 | `src/core/output/cnc-grbl-transitions.ts:60` | RPM change between groups ignored | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > re-issues spindle speed with a dwell when RPM changes between gr |
| C16 | `src/core/output/cnc-grbl-transitions.ts:88` | modal state not restated after tool-change M0 | KILLED only by a neighbour (stage 2) | cnc + x_cnc | cnc-multi-tool.test.ts > cncGrblStrategy tool changes > inserts one M0 change block between bit sections with  |
| C17 | `src/core/output/cnc-grbl-transitions.ts:73` | spindle not stopped before the tool-change M0 | KILLED | cnc | cnc-grbl-strategy.test.ts > cncGrblStrategy > explicit finish position (current-position placement) > parks to |
| W01 | `src/platform/web/worker-refill-handover.ts:146` | second release restarts the handshake | KILLED | refill | laser-hosted-refill-abort.test.ts > Abort with the worker-hosted refill armed > still bounds a silent worker a |
| W02 | `src/platform/web/worker-refill-handover.ts:84` | stop marker revives a closed owner | KILLED | refill | worker-serial-connection.test.ts > worker serial connection (ADR-334) > cannot re-arm a closing connection thr |
| W03 | `src/platform/web/worker-refill-handover.ts:183` | release reply leaves refill marked armed | KILLED | refill | worker-serial-connection.test.ts > worker serial connection (ADR-334) > leaves the refill with the worker unti |
| W04 | `src/platform/web/worker-refill-handover.ts:213` | handover not marked (both sides refill) | KILLED | refill | worker-serial-connection.test.ts > worker serial connection (ADR-334) > keeps the refill on this side until th |
| W05 | `src/platform/web/worker-refill-handover.ts:236` | stale program id reused | KILLED | refill | worker-refill-handover.test.ts > worker refill handover |
| W06 | `src/platform/web/worker-refill-handover.ts:160` | any release reply forgets the worker program | KILLED | refill | worker-refill-handover.test.ts > worker refill handover |
| W07 | `src/platform/web/worker-refill-handover.ts:112` | silent worker never times out | KILLED (test timed out: the mutant hangs) | refill | laser-hosted-refill-abort.test.ts > Abort with the worker-hosted refill armed > still bounds a silent worker a |
| W08 | `src/platform/web/worker-refill-handover.ts:217` | arm deadline never restarted after program post | KILLED | refill | worker-refill-handover.test.ts > worker refill handover |
| W09 | `src/platform/web/worker-refill-handover.ts:69` | arm while not on main | KILLED | refill | worker-serial-connection.test.ts > worker serial connection (ADR-334) > cannot re-arm a closing connection thr |
| W10 | `src/platform/web/worker-refill-handover.ts:176` | armed reply accepted in any phase | SURVIVED (stage 1 and stage 2) | refill + x_refill |  |
| W11 | `src/platform/web/worker-refill-handover.ts:139` | failed post does not retire the worker | SURVIVED (stage 1 and stage 2) | refill + x_refill |  |
| W12 | `src/platform/web/worker-refill-handover.ts:193` | null snapshot never releases | KILLED | refill | laser-hosted-refill-resume.test.ts > hosted refill after confirmed Pause and Resume > does not hand over a rep |

## Findings

Every finding below is a **test gap**: the code on `main` is correct today, and nothing would stop the mutant's regression. Severity follows what the mutant would do in real use.

### GRBL emitter

#### D3-P1-1 — Offset Fill with more than one pass: nothing checks that every pass is written

- **Where:** `src/core/output/grbl-strategy.ts:296`, the `emitOffsetFillGroup` pass loop.
- **Mutant (G15):** `for (let p = 0; p < group.passes; p += 1)` becomes `p < 1`.
- **What it would do:** an Offset Fill layer set to 2 or more passes burns once. That is a silent under-burn with no warning. `fill-group-build.ts` carries `layer.passes` into the group unchanged, so the loop is the only place the passes happen.
- **Why no test catches it:**
  - It survived all 32 GRBL tests and the 79-file `x_emit` list.
  - The offset-fill tests (`grbl-strategy-offset-fill`, the 4040 contour entry and exit tests) use one pass.
  - The scanline twin, F07, is killed by `grbl-fill-compaction`, which does count passes.
  - The pass loop for cut groups is a separate copy.
- **Severity:** P1, because the mutant silently changes a burn.
- **Fix direction:**
  - Add a test that emits an Offset Fill at passes 1, 2 and 3. It counts the `; pass n of N` blocks and checks that the lit G1 length equals passes × the one-pass length.
  - Better, write one property test over every group kind (cut, scanline Fill, offset Fill, image) asserting that lit length scales with passes.

#### D3-P3-1 — The program-header power-mode line is untested for images

- **Mutant (M04):** `grbl-power-modes.ts:44` reports the raster words with the cut mode.
- **What it would do:** it only changes `effectivePowerModes` in the file-header comment (`gcode-metadata.ts:311-316`). Emission uses `laserModeWord(dialect.rasterPowerMode)` directly.
- **Fix direction:** extend `grbl-power-modes.test.ts` with an image group on a dialect whose raster mode differs from its cut mode.

### Image raster sweep (`emit-raster-sweep.ts`)

Four mutants survived stage 1. R09 and R13 (Marlin lit-stop reporting) are killed only by `marlin-raster-lit-end.test.ts`, which is outside the raster folder. R10 and R11 survive everything.

#### D3-P1-2 — The burn feed after a controlled laser-off seek is unchecked on modal-feed dialects

- **Where:** `src/core/raster/emit-raster-sweep.ts:134`.
- **Mutant (R10):** `feedPending: emitFeed || input.controlledLaserOffTravelFeedMmPerMin !== undefined` becomes `feedPending: emitFeed`.
- **What it would do:** with controlled laser-off travel set (`controlledLaserOffTravelFeedMmPerMin`, settable in Device Setup and clamped to Max feed by `device-profile-patch.ts:33-39`), each image row after the first opens with `G1 … F<travel> S0`.
  - On a dialect with modal F, the row's burn runs then inherit the travel feed and not the layer feed.
  - Example: a layer at 3,000 mm/min with 800 mm/min controlled travel burns rows 2 to N at 800 mm/min, 3.75× the dose.
  - The only catalogue profile that sets it, the Neotronics 4040, uses the `neotronics-4040-safe` dialect with `modalFeedrate: false`. That dialect writes F on every burn and so hides the mutant.
- **Why no test catches it:**
  - It survived 17 raster files and 79 `x_emit` files.
  - Every test that sets controlled travel and was run passed with the mutant: `emit-raster-bounded-split`, `emit-raster-controller-precision`, `grbl-fill-compaction`, `grbl-strategy-machine-compatibility`, `planner-emitted-seek-parity`, `controlled-laser-off-motion-preflight`.
  - None of them checks the effective feed of a burn after a controlled seek on a modal-F dialect.
- **Severity:** P1, because the mutant silently changes a burn. Reach needs a user-set controlled travel on a modal-F GRBL profile; the refuter may weigh that.
- **Fix direction:** emit a three-row image on `grbl-v1.1` with controlled travel set. Read it with a modal F interpreter and assert that every lit move's effective F equals the layer feed. The resume emitter oracle already has such an interpreter.

#### D3-P2-1 — A zero-length laser-off move under M3 is not caught

- **Where:** `emit-raster-sweep.ts:202`.
- **Mutant (R11):** drops `formatting.constantPower` from the "skip a move that does not move the head" test.
- **What it would do:** under M3, a laser-off run that rounds to the head position is written. GRBL drains the planner on it with the beam still at the last power, which is the OR-1 lit stop.
- **Why no test catches it:** `grbl-strategy-m3-lit-drain.test.ts` and the lit-drain checkers never build a row whose S0 run collapses to zero length on the 0.001 mm grid.
- **Severity:** P2. A lit dwell of one planner drain at a rounding tie is real but rare.
- **Fix direction:** add a lit-drain checker case with a 0.0004 mm S0 gap between two burns under M3.

### Abort (`laser-job-stop.ts`): 10 of 14 survive

All 10 survived the 17-file `stop` list and the 41-file `x_stop` list. That list includes `laser-job-stop.smoothie.simulator`, `laser-job-stop.marlin`, `laser-job-stop-write-race`, the five `laser-reset-*` files, the lifecycle simulators for GRBL, Marlin and Smoothieware, `use-unload-stop` and the abort simulators.

#### D3-P1-3 — A Smoothieware Abort's stream freeze is untested

- **Where:** `src/ui/state/laser-job-stop.ts:312`, in `stopWithReset`, the path for a realtime-reset driver outside the GRBL family.
- **Mutant (X01):** `streamer: state.streamer === null ? null : markErrored(state.streamer)` becomes `streamer: state.streamer`.
- **What it would do:** the stream stays `streaming` after Ctrl-X is posted.
  - Until `applyStopOutcome` cancels it, every ack can refill job lines behind the reset.
  - If the reset write rejects, `settleResetWrite` rethrows, `applyStopOutcome` never runs, and the stream is never frozen. The host keeps feeding the job to a port that may still be open, which is exactly what the comment at lines 298-301 says the freeze prevents.
- **Why no test catches it:**
  - The Smoothieware stop tests assert only the state after the outcome, where `applyStopOutcome` (`laser-job-stop-outcome.ts:63-68`) cancels the stream anyway.
  - No test holds the reset write open, or rejects it, and then looks at the stream.
  - The fake serial port never fails a write while the port is open.
- **Severity:** P1, because the mutant silently changes a stop: job bytes continue after Abort.
- **Fix direction:** in `laser-job-stop.smoothie.simulator.test.ts`:
  - make the Ctrl-X write a deferred promise, deliver acks, and assert `streamer.status === 'errored'` and no new job line outbound;
  - reject that write with the port open, and assert the same.

#### D3-P1-4 — A failed Smoothieware reset write can be reported as a clean stop

- **Where:** `laser-job-stop.ts:415`, `settleResetWrite`.
- **Mutant (X09):** `(context.refs.writeEpoch ?? 0) > resetWriteEpoch` becomes `>=`.
- **What it would do:** a reset write that fails on an open port, with no later write, is swallowed.
  - `stopWithReset` returns normally and `applyStopOutcome` shows a normal stop.
  - The controller never received Ctrl-X and keeps executing its queue with the beam lit.
  - Today the error propagates out of `runStopJob`.
- **Why no test catches it:** the only test of the "banner beat the write promise" rule exercises the case where a later write happened. No test rejects the reset write while the port stays open and no reboot was seen.
- **Severity:** P1. A failed stop reported as a success is a silent stop defect.
- **Fix direction:** add two cases on a stub connection:
  - write(Ctrl-X) rejects with the port open and no banner: Abort must reject or raise a stop-unconfirmed notice;
  - the same with a banner first (write epoch advanced): Abort stays quiet.

#### D3-P2-2 — Abort's ownership and ordering guards have no negative test

- **Mutants:**
  - **X02** (`:336`): the Smoothieware path does not await the hosted-refill release.
  - **X05** (`:456`): stop lines keep writing after ownership is lost.
  - **X07** (`:111`): an app-closing Abort waits for the jog hold instead of resetting at once.
  - **X11** (`:221`): ownership ignores a newer stream epoch.
  - **X13** (`:113`): a jog-stop result is applied after the session changed.
- **What they would do:**
  - Each lets a stale Abort act on newer work: it writes M107/M410/M5 into a newly started job, or applies a stop outcome to it.
  - Or a closing page keeps waiting for a hold, so the reset is never sent before the window dies (X07).
- **Why no test catches them:**
  - The race tests cover the GRBL owned path (X03 killed) and the Marlin worker handback (X04 and X08 killed).
  - The Smoothieware branch, the no-reset ownership callbacks and the `app-closing` reason are never driven against a newer owner. `use-unload-stop.test.ts` does not reach `runStopJob` with unowned motion.
- **Severity:** P2. Each needs a race (or closing during a Console jog), and the harm is to the next job.
- **Fix direction:** one table-driven race test per guard. Start Abort, start new work (new stream epoch, or a new connection attempt) before each await settles, and assert that the old Abort writes and sets nothing. Add one `reason: 'app-closing'` case with an unowned jog, asserting a reset byte goes out without waiting.

#### D3-P2-3 — The Z-rotary Abort turn-back ignores inch reports, untested

- **Where:** `laser-job-stop.ts:488`.
- **Mutant (X10):** drops `* (reportInches ? 25.4 : 1)` from the Z-axis start turn.
- **What it would do:** with `$13=1` on a Z-port rotary, the recorded start turn is 25.4× too small. The ADR-695 Amendment 1 turn-back then rotates the part to the wrong angle, and a resume lands its burn there.
- **Why no test catches it:** `rotary-axis-abort.simulator` and `unrestored-abort-origin-rotary` use mm reports.
- **Severity:** P2. It needs both inch reports and a Z rotary.
- **Fix direction:** run the Z-rotary Abort simulator test once with `$13=1`.

#### D3-P3-2 — The quickstop log claims "sent" after a failed write

- **Mutant (X06):** `:444` reports `quickStop: 'sent'` whatever was written.
- **What it would do:** only the `[lf2] Abort quick-stopped` log line is affected. `quickStopPatch` is applied either way.
- **Fix direction:** assert there is no quick-stop log line when one of `M107`/`M410`/`M5` fails to write.

### Start from line (`resume-program.ts`)

#### D3-P2-4 — Resume's modal scan for imported programs: G54 return and M5 untested

- **Mutants:**
  - **P06** (`:247`): `value >= 54` becomes `> 54`, so returning to G54 is not tracked.
  - **P14** (`:267`): M5 is not tracked.
- **What they would do:**
  - **P06:** an imported program that selects G55 and later G54 resumes in G55, so the whole tail is burned in the wrong frame.
  - **P14:** an imported program that turned the beam off with M5 and then has `G1 … S>0` moves meant dark is resumed with `M3 S0` re-armed, so those moves burn.
  - KerfDesk's own programs only use G54 and re-arm before every burn, so the emitter oracle cannot see either mutant.
- **Why no test catches them:** the resume tests use KerfDesk output, plus single-WCS and G91/G53 refusal fixtures. No fixture switches the WCS twice or uses M5 as a beam-off between burns.
- **Severity:** P2, because only imported programs are affected.
- **Fix direction:** add two `resume-program.test.ts` fixtures, `G55 … G54 … <resume>` and `M3 … M5 G1 X10 S800 … <resume>`, asserting the resume preamble's WCS and spindle word.

### Rotary

#### D3-P2-5 — The taper surface feed is sampled at the move's midpoint, untested

- **Where:** `src/core/output/rotary-surface-feed.ts:98`.
- **Mutant (T14):** `rotaryTaperYFactorAt(match.taper, (from.x + to.x) / 2)` becomes `rotaryTaperYFactorAt(match.taper, from.x)`.
- **What it would do:** on a tapered part, a move with a Y component gets the feed for its start radius, not its middle. The dose error grows with the move's X span; it is zero for moves along X.
- **Why no test catches it:** it survived 31 rotary files. The taper feed tests (`emit-gcode-rotary-taper-surface-feed`) use moves that are pure Y or very short in X.
- **Severity:** P2, a dose error on long diagonal strokes round a cone.
- **Fix direction:** add a single 40 mm diagonal stroke on a 30→40 mm radius cone, asserting F against the closed-form midpoint value.

#### D3-P3-3 — Guards that only another layer makes safe

- **Mutants:**
  - **T13** (`rotary-surface-feed.ts:106`): the feed ceiling can sit below the layer feed.
  - **C03** (`cnc-grbl-emit-head.ts:28`): a negative safe Z is not clamped.
- **Why they matter little:** T13 matters only for a layer faster than Max feed, which `runPreflight` refuses (B12 killed). C03 matters only for a negative safe Z. No refusal for that was found in `cnc-preflight.ts`; input clamping was not traced.
- **Fix direction:** a one-line unit test each, so the defence in depth stays.

### Job Review gate (`job-review-gate.ts`): 9 of 14 survive

#### D3-P2-6 — The "reuse the prepared bytes" shortcut and the byte-identity check have no negative test

- **Mutants:**
  - **J01** (`:183`): the same-artifact test ignores the G-code bytes.
  - **J03** (`:336`): a time-bound project is reused.
  - **J04** (`:340`): reuse ignores controller staleness.
  - **J05** (`:344`): the machine-inputs key is compared with itself.
  - **J06** (`:356`): the coordinate key is compared with itself.
- **What they would do:** Confirm binds to bytes prepared against older controller, camera, coordinate or clock facts. With J01, it binds to bytes that differ from the reviewed ones whenever the model does not show the difference. That breaks the ADR-224 promise that "the bundle that streams is provably the bundle the operator last saw".
- **Why no test catches them:** `job-review-gate.reuse.test.ts` proves only that reuse happens when nothing changed. No test changes one input at a time and expects a recompile. All five survived the 22-file `x_gate` list, which includes the Start flow, review-at-start and framed-permit-claim tests.
- **Severity:** P2. The Frame permit's own Start handoff (`framed-run.ts:272-290`, 14 of 14 killed) still refuses a moved head, origin or session. Laser-mode evidence is recaptured. So the remaining harm is in time-bound text and in controller facts outside the permit.
- **Fix direction:** a table test with one row per input: time-bound project, controller preparation, machine-inputs key, coordinate key, and bytes differing under an equal model. Each row asserts that `prepareCurrentStartJob` is called again and that Confirm needs a second click.

#### D3-P2-7 — The run-again replay guards are untested

- **Mutants:**
  - **J08** (`:452`): the replay compile mismatch is ignored.
  - **J14** (`:423`): a change in the replay signature is ignored.
- **What they would do:** Run again proceeds with a compile that no longer matches the completed receipt, without closing the review.
- **Why no test catches them:** the two guards back each other up, and `run-again-review-carry*.test.ts` never makes either fire alone.
- **Severity:** P2.
- **Fix direction:** two tests, each breaking exactly one guard's input.

### Preflight

#### D3-P2-8 — The arc-bulge bounds ignore the offset at max X, untested

- **Where:** `src/core/invariants/predicates.ts:176`.
- **Mutant (B03):** `box.maxX + offset.x > limits.maxX` becomes `box.maxX > limits.maxX`.
- **What it would do:** a G2/G3 arc (CNC, or laser ADR-432 arcs) placed with a motion offset can bulge past the bed's right edge without an issue being raised.
- **Why no test catches it:** the arc tests in `predicates.test.ts` use offset 0, and it survived the 34-file `x_preflight` list.
- **Severity:** P2. It needs an arc, a non-zero offset and the bed's X max.
- **Fix direction:** an arc-bulge case per side with a non-zero `motionOffset`.

#### D3-P3-4 — The relative-origin envelope check is used even with a known offset, untested

- **Mutant (B08):** `preflight.ts:332`.
- **What it would do:** a weaker, extent-only check runs when the exact one could.
- **Fix direction:** one `runPreflight` case with `coordinateMode: 'relative-origin'` and a known `motionOffset`, out of bed by position but not by extent.

#### D3-P3-5 — Rules caught only by far-away tests

Eleven mutants die only in stage 2, through tests in other folders:

| Mutant | Change | Caught only by |
|---|---|---|
| G12 | image scan-offset override | `split-runway-controller-grid` |
| G16 | Marlin `stopKeepsPower` | `emit-gcode-m3-lit-drain` |
| R09, R13 | Marlin lit stop | `marlin-raster-lit-end` |
| F05 | Fill scan-offset override | `split-runway-controller-grid` |
| B02, B09 | bed bounds under a motion offset | `start-job-placement` |
| B07, B07b | flat-bed Y check | `emit-gcode-rotary-placement`; for B07b, `catalogue-output-contracts` |

B07b is a follow-up mutant, outside the 176. It drops only the flat-bed Y check, at `preflight.ts:324`, replacing it with `rotaryXOnlyBounds(bed)`. It was run against `x_preflight`.
| B13 | rotary wrap | `emit-gcode-rotary` |
| B14 | no-go zones under an offset | `native-coordinate-placement` |
| C16 | modal state after the tool-change M0 | `cnc-multi-tool` |

- **Risk:** a developer who runs the module's own tests gets a green result on a real defect. A broad refactor of the catching test would orphan the rule.
- **Severity:** P3, because CI runs the whole suite.
- **Fix direction:** a direct case in each module's own test file. In particular, `preflight.test.ts` should call `runPreflight` with a `motionOffset`, no-go zones under an offset, a flat-bed Y overrun and a rotary wrap.

### CNC

#### D3-P1-5 — Park and tool-change heights after a higher-safe-Z operation are untested

- **Where:** `src/core/output/cnc-grbl-transitions.ts:52`.
- **Mutant (C12):** `state.maxSafeZ = Math.max(state.maxSafeZ, group.safeZMm)` becomes `state.maxSafeZ = group.safeZMm`.
- **What it would do:** in a multi-operation job where an earlier operation has the higher safe Z (to clear clamps), with no park Z set, three moves use the current or last operation's lower safe Z, not the job's highest:
  - the tool-change park lift and its XY rapid (`appendToolChange` → `parkHeightMm(group, maxSafeZ)`);
  - the spindle restart lift after the change;
  - the job-end park.

  The bit then rapids across the fixture lower than the operator asked. `parkHeightMm` (`core/cnc/cnc-park.ts:23-28`) only takes the max with `parkZMm`.
- **Why no test catches it:**
  - It survived 20 CNC files and the 31-file `x_cnc` list, which has multi-tool, park, park-height and tool-change store tests.
  - C10, the job-end park height, was killed only because `cnc-grbl-park-height` sets a park Z.
  - The multi-group fixtures share one safe Z.
- **Severity:** P1, because the mutant silently changes a motion into a collision course; a rapid into clamps harms the job.
- **Fix direction:** a two-operation job with safe Z 15 mm then 3 mm and no park Z. Assert that every XY `G0` after the first operation (tool-change park, job-end park) follows a `G0 Z15`.

### Marlin worker refill and near-equivalent mutants

#### D3-P3-6 — Redundant guards with no direct test

- **Mutants:**
  - **X14:** the no-reset stop notice. It is already set at `:209-215` while a job is active.
  - **J09 and J12:** abort and abandon checks that are repeated after the rebuild.
  - **W10:** an `armed` reply accepted in any phase. Pending-id matching already blocks stale replies.
  - **W11:** a failed post does not retire the worker. The arm deadline or snapshot hold makes this bounded.
- **What they would do:** each is (nearly) equivalent in today's flow. A later edit to the guard that does the work would leave nothing behind.
- **Severity:** P3.
- **Fix direction:** decide per guard whether to delete it or to give it a direct test.

## Fake and simulator review

| Fake / simulator | Real behaviour it skips | Tests whose verdict depends on it |
|---|---|---|
| **GRBL simulator** (`src/__fixtures__/controllers/grbl-simulator.ts`, `grbl-sim-lines.ts`, `grbl-sim-machine.ts`) | <ul><li>Every motion line takes a fixed `motionMs` (default 10 ms), whatever its length or feed, and the position jumps to the target at once, so a status report never shows the head part-way.</li><li>G2/G3 lines are not motion at all (`isMotionLine` admits only G0/G1, `grbl-sim-lines.ts:335-336`): no Run state and no position change.</li><li>`ok` comes back at once, and the RX ring and planner are inert, unless `plannerBlocks` is set. Only 15 of the 52 test files that use it set it.</li><li>Replies come after 1 ms.</li><li>It never splits or merges reply lines.</li></ul>The `motionMs` values used by tests are mostly 1-25 ms; one file uses 400 ms. | <ul><li>Jog and turn-back waits (`rotary-axis-abort.simulator`, `laser-unowned-motion-stop.simulator`, `abort-*.simulator`): any wait shorter than a real move passes. This is the Z2-P2-1 class (KNOWN).</li><li>Resume, Frame and Abort runs with arcs: the head never moves on G2/G3.</li><li>Streaming tests without `plannerBlocks` cannot see an RX overflow. S01 was killed only by the opt-in `streamer-planner-starvation`.</li></ul> |
| **Marlin simulator** (`marlin-simulator.ts`, `marlin-sim-queue.ts`) | <ul><li>Models BUFSIZE 4, a 15-move planner, M410's one-second refusal, the 2 s busy keepalive, and a planner sync for M3/M5/M7-M9/G4.</li><li>Skips: move duration is a fixed `motionMs` (default 10 ms); serial is never partial or lost.</li></ul> | `laser-job-stop.marlin`, `laser-quick-stop`, `laser-stream-hold.marlin`, `laser-lifecycle-marlin.simulator`. Their verdicts on lit-stop timing assume 10 ms moves. |
| **Smoothieware simulator** (`smoothie-simulator.ts`, `smoothie-sim-machine.ts`) | <ul><li>Fixed `motionMs` per move.</li><li>Ctrl-X halts at once.</li><li>The reset write never fails.</li><li>No receive-buffer limit or partial lines were found in the model.</li></ul> | `laser-job-stop.smoothie.simulator`, `laser-alarm-*.smoothie.simulator`, `laser-lifecycle-smoothie.simulator`. All pass with X01 and X09: the simulator cannot make a reset write fail or hang (D3-P1-3, D3-P1-4). |
| **Fake serial port** (`fake-serial-port.ts`) | <ul><li>A write fails only after close; it resolves at once with no backpressure.</li><li>Whole lines only, never chunked.</li><li>No reordering between write and reply.</li></ul> | Every simulator-backed store test. Write-failure paths need hand-written stubs; `laser-job-stop-write-race` has them for Marlin only. |
| **Ruida UDP simulator** (`ruida-udp-simulator.ts`) | <ul><li>A job or Frame is busy for `runReads` status reads (default 3), whatever its length.</li><li>Fixed reply delay.</li></ul> | `ruida-network-store.test`, `RuidaNetworkPanel.test`. This is the D1-P2-2 class (KNOWN; a fast-frame script was owed by #1753). |
| **Moshi simulators** (`moshi-simulator.ts`, `moshi-usb-simulator.ts`) | <ul><li>A program is busy for `busyReads` reads (default 2), whatever its length.</li><li>Estop clears everything at once.</li><li>Bytes are decoded by the repo's own decoder, so encoder and decoder agree by construction.</li></ul> | The 5 Moshi store, panel and link tests. Raster tests with overscan 0 hid D1-P1-1 (KNOWN). |
| **Lihuiyu simulator** (`lihuiyu-simulator.ts`) | <ul><li>Time moves only when the host polls: one packet per status read.</li><li>No wall-clock motion.</li><li>FINISH comes once.</li></ul> | 2 files. A host that polled slowly would see the same verdicts. |
| **e2e `journey-grbl-serial.js`, `paced-grbl-serial.js`** | <ul><li>A fixed `blocksPerSecond` (40 and 500) per block, whatever its length.</li><li>FS is fixed at 3000.</li><li>The position jumps per block.</li><li>WCO is sent on every 10th report (modelled).</li></ul> | Whole-journey e2e specs. Not run in D3 (memory). |

**Pattern.**
- Each controller simulator models protocol order well: acks, buffer counts, alarms, resets, the M410 refusal and EEPROM sync.
- None models motion time from distance and feed, or a transport that fails while open.
- Every survivor in the Abort module lives on one of those two axes.

#### D3-P3-7 — The simulators skip motion time, arcs and open-port write failures

- **Where:**
  - `src/__fixtures__/controllers/grbl-sim-lines.ts:335-346`: fixed `motionMs`; G2/G3 are not motion.
  - `src/__fixtures__/controllers/fake-serial-port.ts:38-41`: a write fails only when the port is closed.
  - `ruida-udp-simulator.ts:73` and `moshi-simulator.ts:119`: busy for a fixed number of reads.
- **What it does:** a test can only fail if the simulator can produce the real behaviour. Waits that are too short, arc moves, and a stop write that fails on a live port cannot be produced.
- **Severity:** P3. It generalises KNOWN Z2-P2-1 and D1-P2-2.
- **Fix direction:**
  - an opt-in `motion: 'kinematic'` mode in the GRBL, Marlin and Smoothieware simulators, where duration = length / feed and status reports interpolate;
  - G2/G3 as motion in the GRBL simulator;
  - a `failWrite(predicate)` hook on the fake serial port;
  - Ruida and Moshi busy time taken from the decoded program length.

## Not verified

- **Not the whole suite.** Stage 2 ran 17 to 79 chosen neighbour files per survivor, not the whole suite (over 10,000 tests). A survivor could still be killed by a test outside those lists. CI on the fix PR is the authority.
- **Equivalence by reading only.** The judgements that X14, J09, J12, W10 and W11 are near-equivalent, and the reach arguments for R10, T13 and C03, come from reading the code, not from a reproduction.
- **Gate mutants not reproduced end to end.** The J-mutants were not reproduced through the real dialog in a browser.
- **No browser or e2e runs.** Free memory was often under 1 GB; Vitest ran only above 1.5 GB.
- **No hardware.**
- **The persistent runner was cross-checked, not bit-identical.** A trial (G01 and G13 killed in 9-12 s) and stage 1 agreed with the plain `vitest run` baseline for the `grbl` list. Within a list, a later mutant could see a transform cached from an earlier one only if `invalidateFile` failed. Every survivor was re-run in a fresh process in stage 2.
- **W07 counted as killed.** The test hung and timed out at 60 s, and a hang is that mutant's effect: a silent worker never times out.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d3\`:

| File | Contents |
|---|---|
| `mutants.json` | The 176 mutants: id, file, find/replace, `nth`, list, description. |
| `mutants2.json` | Stage 2, the 44 survivors. |
| `mutants3.json` | B07b. |
| `lists.json` | Every test list. |
| `pr.mjs` | The persistent Vitest runner: memory gate, baseline, mutate, invalidate, run, restore, verify, and a skip for ids already done. |
| `drive.sh`, `drive2.sh`, `drive3.sh` | The drivers. |
| `run-mutants.mjs` | The first, one-process-per-mutant harness, used for the baselines. |
| `verify-restore.mjs` | Compares every mutated file in `mut` with `j29-main` and restores it if different. |
| `mut\results.jsonl` | Stage 1. |
| `results2.jsonl` | Stage 2. |
| `results3.jsonl` | B07b. |
| `baseline.jsonl`, `baseline-noiso.jsonl` | The plain-CLI baselines. |
| `tally.mjs`, `tally.md` | The tables. |
| `find-tests.mjs`, `grep-tests.mjs`, `ls-tests.mjs`, `fake-users.mjs` | Test discovery and simulator-usage counts. |

Run any list with `NODE_OPTIONS=--no-experimental-webstorage node pr.mjs mutants.json <abs results> <listKey> [--isolate]`.

```json
{
  "area": "D3",
  "tree": "8fd1b07c1",
  "mutants": 176,
  "killedOwnTests": 132,
  "killedNeighboursOnly": 11,
  "survived": 33,
  "notRun": 0,
  "killRateOwn": 0.75,
  "killRateWithNeighbours": 0.81,
  "perModule": {
    "grblEmitter": [24, 20, 2, 2], "rasterSweep": [13, 9, 2, 2], "fillEmission": [10, 9, 1, 0],
    "streamer": [14, 14, 0, 0], "abort": [14, 4, 0, 10], "resume": [14, 12, 0, 2],
    "rotary": [16, 14, 0, 2], "framePermit": [14, 14, 0, 0], "jobReviewGate": [14, 5, 0, 9],
    "preflight": [14, 7, 5, 2], "cnc": [17, 14, 1, 2], "workerRefill": [12, 10, 0, 2]
  },
  "findings": [
    {"id": "D3-P1-1", "severity": "P1", "title": "Offset Fill passes > 1 unchecked (mutant writes one pass)", "where": ["src/core/output/grbl-strategy.ts:296"], "mutants": ["G15"], "novelty": "new"},
    {"id": "D3-P1-2", "severity": "P1", "title": "Raster burn feed after a controlled laser-off G1 seek unchecked on modal-F dialects", "where": ["src/core/raster/emit-raster-sweep.ts:134"], "mutants": ["R10"], "novelty": "new"},
    {"id": "D3-P1-3", "severity": "P1", "title": "Smoothieware Abort stream freeze untested (refill continues behind Ctrl-X / after a failed reset write)", "where": ["src/ui/state/laser-job-stop.ts:312"], "mutants": ["X01"], "novelty": "new"},
    {"id": "D3-P1-4", "severity": "P1", "title": "Failed Smoothieware reset write can be reported as a clean stop", "where": ["src/ui/state/laser-job-stop.ts:415"], "mutants": ["X09"], "novelty": "new"},
    {"id": "D3-P1-5", "severity": "P1", "title": "CNC tool-change/job-end park height after a higher-safe-Z operation untested", "where": ["src/core/output/cnc-grbl-transitions.ts:52"], "mutants": ["C12"], "novelty": "new"},
    {"id": "D3-P2-1", "severity": "P2", "title": "Zero-length S0 raster move under M3 (OR-1 lit drain) uncaught", "where": ["src/core/raster/emit-raster-sweep.ts:202"], "mutants": ["R11"], "novelty": "new"},
    {"id": "D3-P2-2", "severity": "P2", "title": "Abort ownership/ordering guards (Smoothie release await, stale writes, app-closing, newer stream, session) untested", "where": ["src/ui/state/laser-job-stop.ts:111,113,221,336,456"], "mutants": ["X02", "X05", "X07", "X11", "X13"], "novelty": "new"},
    {"id": "D3-P2-3", "severity": "P2", "title": "Z-rotary Abort start turn ignores inch reports, untested", "where": ["src/ui/state/laser-job-stop.ts:488"], "mutants": ["X10"], "novelty": "new"},
    {"id": "D3-P2-4", "severity": "P2", "title": "Resume modal scan: return to G54 and M5 untested (imported programs)", "where": ["src/core/controllers/grbl/resume-program.ts:247,267"], "mutants": ["P06", "P14"], "novelty": "new"},
    {"id": "D3-P2-5", "severity": "P2", "title": "Taper surface feed sampling point untested", "where": ["src/core/output/rotary-surface-feed.ts:98"], "mutants": ["T14"], "novelty": "new"},
    {"id": "D3-P2-6", "severity": "P2", "title": "Job Review reuse shortcut and byte-identity check have no negative test", "where": ["src/ui/laser/job-review/job-review-gate.ts:183,336,340,344,356"], "mutants": ["J01", "J03", "J04", "J05", "J06"], "novelty": "new"},
    {"id": "D3-P2-7", "severity": "P2", "title": "Run-again replay guards untested", "where": ["src/ui/laser/job-review/job-review-gate.ts:423,452"], "mutants": ["J08", "J14"], "novelty": "new"},
    {"id": "D3-P2-8", "severity": "P2", "title": "Arc-bulge bed check ignores offset at max X, untested", "where": ["src/core/invariants/predicates.ts:176"], "mutants": ["B03"], "novelty": "new"},
    {"id": "D3-P3-1", "severity": "P3", "title": "Header power-mode metadata for images untested", "where": ["src/core/output/grbl-power-modes.ts:44"], "mutants": ["M04"], "novelty": "new"},
    {"id": "D3-P3-2", "severity": "P3", "title": "Quickstop log claims sent after a failed write", "where": ["src/ui/state/laser-job-stop.ts:444"], "mutants": ["X06"], "novelty": "new"},
    {"id": "D3-P3-3", "severity": "P3", "title": "Defence-in-depth guards covered only by another layer (feed ceiling, negative safe Z)", "where": ["src/core/output/rotary-surface-feed.ts:106", "src/core/output/cnc-grbl-emit-head.ts:28"], "mutants": ["T13", "C03"], "novelty": "new"},
    {"id": "D3-P3-4", "severity": "P3", "title": "Relative-origin envelope with a known offset untested", "where": ["src/core/preflight/preflight.ts:332"], "mutants": ["B08"], "novelty": "new"},
    {"id": "D3-P3-5", "severity": "P3", "title": "Eleven rules caught only by far-away tests (module tests stay green)", "where": ["src/core/preflight/preflight.ts", "src/core/raster/emit-raster-sweep.ts", "src/core/output/grbl-strategy.ts", "src/core/output/cnc-grbl-transitions.ts:88"], "mutants": ["G12", "G16", "R09", "R13", "F05", "B02", "B07", "B07b", "B09", "B13", "B14", "C16"], "novelty": "new"},
    {"id": "D3-P3-6", "severity": "P3", "title": "Redundant or near-equivalent guards with no direct test", "where": ["src/ui/state/laser-job-stop.ts:435", "src/ui/laser/job-review/job-review-gate.ts:166,173", "src/platform/web/worker-refill-handover.ts:139,176"], "mutants": ["X14", "J09", "J12", "W10", "W11"], "novelty": "new"},
    {"id": "D3-P3-7", "severity": "P3", "title": "Simulators model protocol order but not motion time from distance/feed, arcs, or open-port write failures", "where": ["src/__fixtures__/controllers/grbl-sim-lines.ts:335-346", "src/__fixtures__/controllers/fake-serial-port.ts:38-41", "src/__fixtures__/controllers/ruida-udp-simulator.ts:73", "src/__fixtures__/controllers/moshi-simulator.ts:119"], "mutants": [], "novelty": "generalises KNOWN Z2-P2-1, D1-P2-2"}
  ],
  "known": ["Z2-P2-1", "Z1-P1-1", "D1-P2-2", "D1-P1-1", "Z4-P1-1"],
  "counts": {"raised": 20, "P1": 5, "P2": 8, "P3": 7, "known": 5}
}
```

Auditor counts: raised 20, P1 5, P2 8, P3 7, known 5

## Refuter (2026-11-12)

**Verdict in one line.** Of the five P1s, one is refuted outright (G15 is killed by a test the auditor did not run), one is an equivalent mutant on every input the product can produce (C12), and one overstates its harm (X09: the operator still gets the "Abort was not written, use E-stop" notice). The other two (R10, X01) are real gaps, but they are test gaps over correct code, so they are not P1 by the C1 precedent. The refuter also found that J09, filed by the auditor as "near-equivalent", is **not** equivalent: under that mutant a Cancel pressed during the Confirm re-prepare still starts the job. That is reproduced.

### Tree and harness

- **Tree.** `j29-main` (`origin/main` @ `8fd1b07c1`), read only. All mutation happened in the refuter's own copy, `scratchpad\zz-d3r\mut` (robocopy of `j29-main` without `node_modules`, plus its own `node_modules` junction). After every mutant the runner restores the file and compares it byte for byte with `j29-main`; every run logged `restored ok`. Three probe test files exist only in this copy (listed under Repro files).
- **Runner.** `zz-d3r\rmut.mjs`: one **fresh** `vitest run` process per mutant (no persistent process, no `invalidateFile`), with an explicit file list, `--maxWorkers` 2 or 3, `--testTimeout=60000`, `--bail=1`, the JSON reporter, `NODE_OPTIONS=--no-experimental-webstorage`, and a 1.5 GB free-memory gate. The mutant definitions are the auditor's own (`zz-d3\mutants.json`, same `find`/`replace`/`nth`).
- **Wider lists** (built by `zz-d3r\mklists.mjs` from `j29-main`, each a superset of the auditor's `x_*` list):

  | List | Files | Contents |
  |---|---|---|
  | `emit` | 267 | all of `src/core/output`, `src/core/raster`, `src/io/gcode`; every test containing `fillStyle: 'offset'`, "Follow Shape" or `controlledLaserOffTravel`; `x_emit` |
  | `rotary` | 205 | all of `src/core/output` and `src/io/gcode`; every `src/core`/`src/io` test mentioning taper; `x_rotary` |
  | `cnc` | 192 | CNC tests in `src/core/output` and `src/io/gcode`; every test containing `safeZMm`; core/io tests mentioning tool change, multi-tool or `parkZMm`; `x_cnc` |
  | `preflight` | 53 | all of `src/core/preflight` and `src/core/invariants`; every test containing `motionOffset`; `x_preflight` |
  | `resume` | 62 | all of `src/core/controllers/grbl`; every test naming `buildResumeProgram`/`resume-program`; `x_resume` |
  | `gate` | 109 | all of `src/ui/laser/job-review`; every `src/ui/laser/start-job*`, `run-again*`, `framed-run-start*` test; `x_gate` |
  | `stop` | 92 | every `src/ui/state` and `src/ui/laser` test whose name has job-stop, stop, abort, reset, smoothie, disconnect, quick-stop or lifecycle; every UI test naming `smoothieware` together with `stopJob`/abort; `x_stop` |

- **Baseline.** The `emit` list passed clean on the unmutated copy: 267 files, 2,503 tests, 372 s. For the other lists every surviving mutant ran the whole list green, which is itself a clean baseline of that list.

### Re-run of the survivors (fresh process, wider lists)

| Mutant | Auditor | List (files / tests) | Refuter result |
|---|---|---|---|
| G15 | P1 survivor | `emit` (267) | **KILLED** by `src/core/job/contour-entry-envelope.test.ts` > "uses explicit bounds for each Follow Shape loop and pass": expected the pass-2 runway `X200.000 Y30.000 F800 S0` twice, got once |
| R10 | P1 survivor | `emit` (267 / 2,503) | SURVIVED |
| R11 | P2 survivor | `emit` (267 / 2,503) | SURVIVED |
| M04 | P3 survivor | `emit` (267 / 2,503) | SURVIVED |
| T14 | P2 survivor | `rotary` (205 / 1,809) | SURVIVED |
| C12 | P1 survivor | `cnc` (192 / 1,767) | SURVIVED |
| B03 | P2 survivor | `preflight` (53 / 405) | SURVIVED |
| P06 | P2 survivor | `resume` (62 / 1,024) | SURVIVED |
| P14 | P2 survivor | `resume` (62 / 1,024) | SURVIVED |
| J09 | P3 (near-equivalent) | `gate` (109 / 749) | SURVIVED |
| J01 | P2 survivor | `gate` (109 / 749) | SURVIVED |
| J03 | P2 survivor | `gate` (109 / 749) | SURVIVED |
| X01 | P1 survivor | `stop` (92 / 820) | SURVIVED |
| X09 | P1 survivor | `stop` (92 / 820) | SURVIVED |
| X10 | P2 survivor | `stop` (92 / 820) | SURVIVED |
| X05 | P2 survivor | `stop` (92 / 820) | SURVIVED |

G15's killing test was in the auditor's `rotary`/`x_rotary` lists but not in `grbl` or `x_emit`, which is why stage 2 missed it. It builds an Offset Fill with `passes: 2` on the Neotronics 4040 profile, emits it through `grblStrategy`, and counts the tangential entry runway once per pass. CI runs it on every pull request.

### Reach of each P1

- **G15 (Offset Fill passes).** Reachable: the Passes field is shown for every mode (`src/ui/layers/CutSettingsCommonFields.tsx:46-48`); `vector-group-fields.ts:28` carries `layer.passes` into the group; `fillPassLayers` keeps an Offset fill as one group (`scan-pass-angles.ts:48`), so the emitter loop is the only place passes happen. Reach was never the problem; the kill is.
- **R10 (burn feed after a controlled seek).** Reachable. Device Setup shows an ungated "Controlled seek / G1 S0" checkbox for every profile (`DeviceSetupOptionsStep.tsx:126-131`, `ControlledLaserOffTravelRow.tsx`; ticking it sets `min(800, maxFeed)`). Only `neotronics-4040-safe` sets `modalFeedrate: false` (`gcode-dialects.ts:156`); every other GRBL dialect is modal-F, so a user who ticks it on any other GRBL profile, or changes the 4040 profile's dialect, is exposed. The mutant's effect is shown by reading `emit-raster-sweep.ts:116-136` and `:210-212`: after the row's `G1 … F800 S0` opening, the first burn run writes F only when `feedPending` is set.
  The probe `zz-refuter-r10.test.ts` (a 3 x 3 px image at 3,000 mm/min, controlled seek 800 mm/min, default modal-F input) shows it: main burns rows 1-3 at F3000, F3000, F3000; **R10 burns them at F3000, F800, F800** (row 2 is `G1 X0.000 S500` straight after `G1 X3.000 Y1.500 F800 S0`). That is 3.75 times the dose on every row after the first.
- **X01 / X09 (Smoothieware reset write).** Reproduced with a probe (`zz-refuter-smoothie-abort.test.ts`: real store, Smoothieware simulator, a 300-line ping-pong job, an adapter that either rejects the Ctrl-X write with the port open, or delivers it and holds the write promise for 1 s):

  | Run | Ctrl-X write rejects, port open | Ctrl-X delivered, promise held 1 s |
  |---|---|---|
  | main | Abort rejects; `write-failed` notice "The software Abort command was not written to the controller. Use physical E-stop…"; **0** job lines written after Abort | Abort resolves; stream errored, then cancelled; no notice; controller halted; 0 job lines |
  | X01 | same rejection and notice, but **99 job lines** written after Abort | **1 job line** written behind Ctrl-X; the halted Smoothie answers `!!`; the stream gets a misleading "The controller rejected a command during the job" notice; Abort had not resolved 3 s after the write settled |
  | X09 | Abort **resolves**; the same `write-failed` notice stays; stream `cancelled`; 0 job lines | same as main |

  Is a reset write that fails on an open port realistic? Partly. `settleResetWrite` tests `refs.connection == null`, and on a cable pull the write can reject before the close handler clears the connection, so the "open port" branch is reachable. But Web Serial's writable stream errors stick: once a write rejects, later writes reject too, and the worker path stops its own refill as soon as it sees Ctrl-X (`serial-worker-core.ts:187-191`). So X01's 99-line continuation needs a transport that fails one write and accepts the next, which the refuter does not consider realistic. X01's other window, a delivered Ctrl-X whose promise has not settled while acks arrive, is realistic on a busy stream, and its harm is a misleading notice and a stalled Abort, not a burn (a halted Smoothie refuses G-code: `smoothie-simulator.test.ts:56-63`).
- **C12 (max safe Z).** **Not reachable.** Every `CncGroup` builder takes its safe Z from the one machine-wide parameter: `compile-cnc-pass-group.ts:43`, `cnc-relief-group.ts:47` and `tile-registration.ts:62` all read `config.params.safeZMm` / `machine.params.safeZMm` (`CncMachineParams.safeZMm`, `scene/machine.ts:242`). No operation, layer or tool has its own safe Z. So every group of a compiled job has the same `safeZMm`, and `Math.max(maxSafeZ, g.safeZMm)` equals `g.safeZMm`: the mutant is equivalent on every job the product can produce. It also survived 192 files. The guard protects a future per-operation safe Z (ADR-491's "never below the job's safe Z"), so it is a P3 latent guard like T13 and C03.

### Rating policy

The auditor rated five test gaps P1 under the AREAS clause "lets such a defect reach `main` unchecked". The refuter does not accept that reading for gaps over correct code:

1. **C1's own use of the same words.** C1 defined P1 as "Broken now, or lets breakage reach `main` unchecked" and P2 as "A gap in the checks that already holds a real failure". It used the P1 clause once, for C1-P1-2, a ruleset gap that **had already let** six pull requests merge onto a red `main`. It rated C1-P3-2, a missing lint rule whose 21 candidates were all correct ("a gap with nothing in it today"), **P3**. C2's AREAS copies those meanings. Under that precedent, a gap is P1 only after a defect has actually escaped through it, and P2 only when it already hides one.
2. **A surviving mutant is not an escaped defect.** The code on `main` is correct in every D3 finding. CI runs the whole suite, so the only question is whether some test anywhere fails; G15 shows that a 79-file list cannot answer that.
3. **But a mutant is stronger evidence than C1-P3-2's pattern.** It names one concrete, realistic regression in beam, stop or motion code that CI would merge.

**Decision.** For D3: **no P1 for a test gap over correct code.** **P2** (cap) for a non-equivalent survivor of the full-folder run on a beam, stop or motion rule, whose trigger a user can reach today and whose effect harms a job, a stop or a motion. **P3** for the rest: equivalent or unreachable, an effect on logs or comments only, or killed by a far-away test. The coordinator may prefer the strict letter of AREAS ("P3: no defect found behind it"), which would make every D3 finding P3; the refuter recommends the P2 cap, because the area's question is exactly whether safety regressions would be caught.

### Verdict per finding

| Finding | Auditor | Refuter | Evidence |
|---|---|---|---|
| D3-P1-1 Offset Fill passes (G15) | P1 | **REFUTED** | Killed by `contour-entry-envelope.test.ts` (fresh process, 267-file list). CI would catch it. A direct `grbl-strategy-offset-fill` pass test is still a nice-to-have, not a finding. |
| D3-P1-2 Raster feed after a controlled seek (R10) | P1 | **CONFIRMED, P1 → P2** | Survived 267 files / 2,503 tests. Reach confirmed (ungated checkbox, all modal-F GRBL dialects). Policy: a gap over correct code. |
| D3-P1-3 Smoothieware stream freeze (X01) | P1 | **CONFIRMED, P1 → P2** | Probe: mutant writes 99 job lines after a rejected Abort (unrealistic partial failure) and, realistically, one line behind a pending Ctrl-X that yields a misleading notice and a stalled Abort. Survived 92 stop files / 820 tests. |
| D3-P1-4 Failed reset write reported as clean (X09) | P1 | **REFUTED as described, P1 → P3** | Probe: with X09 the `write-failed` "Abort command was not written … use physical E-stop" notice stays, and 0 job lines follow. Only the promise outcome (resolves, not rejects) and the stream state differ. Not a "clean stop". Survived 92 stop files. |
| D3-P1-5 CNC max safe Z (C12) | P1 | **REFUTED, P1 → P3** | Equivalent on every reachable job: one machine-wide safe Z for every group. Survived 192 files. Keep as a latent-guard P3 (merge into D3-P3-3). |
| D3-P2-1 Zero-length S0 under M3 (R11) | P2 | **CONFIRMED, P2** | Survived 267 files. The lit drain is real GRBL behaviour (a coincident move in M3 laser mode forces a buffer sync at the old power). Reach (an S0 run rounding to zero length) was not reproduced. |
| D3-P2-2 Abort ownership guards (X02, X05, X07, X11, X13) | P2 | **CONFIRMED, P2** (X05 re-run: SURVIVED 92 files) | Not re-reasoned beyond X05; each needs a race. |
| D3-P2-3 Z-rotary inch start turn (X10) | P2 | **CONFIRMED, P2** (SURVIVED 92 files) | `$13=1` is a user setting; a Z-port rotary is supported. |
| D3-P2-4 Resume G54 return and M5 (P06, P14) | P2 | **CONFIRMED, P2** | Both survived all 62 `src/core/controllers/grbl` and resume files. Imported programs only. |
| D3-P2-5 Taper sample point (T14) | P2 | **CONFIRMED, P2** | Survived 205 files. Midpoint sampling is itself an approximation (feed is constant along a move while the radius changes), so no current defect. |
| D3-P2-6 Job Review reuse shortcut (J01, J03, J04, J05, J06) | P2 | **CONFIRMED, P2** (J01: SURVIVED 109 files; J03: SURVIVED 109 files) | Not re-run: J04-J06. |
| D3-P2-7 Run-again replay guards (J08, J14) | P2 | CONFIRMED, P2 (not re-run) | Reasoning accepted. |
| D3-P2-8 Arc bulge at max X under an offset (B03) | P2 | **CONFIRMED, P2** | Survived 53 files including every `motionOffset` test. |
| D3-P3-1 Header power mode (M04) | P3 | CONFIRMED, P3 | Survived 267 files. Only `laserPowerSafetyLine` in the header comment reads it (`gcode-metadata.ts:311-316`). |
| D3-P3-2 Quickstop log (X06) | P3 | CONFIRMED, P3 (not re-run) | |
| D3-P3-3 Guards made safe by another layer (T13, C03) | P3 | CONFIRMED, P3; **add C12** | |
| D3-P3-4 Relative-origin envelope (B08) | P3 | CONFIRMED, P3 (not re-run) | |
| D3-P3-5 Rules caught only far away | P3 | CONFIRMED, P3; **add G15** | G15 joins the list: caught only by `src/core/job/contour-entry-envelope.test.ts`. |
| D3-P3-6 Redundant / near-equivalent guards (X14, J09, J12, W10, W11) | P3 | **PARTLY REFUTED**: J09 moves out (new D3R-P2-1); X14, J12, W10, W11 stay P3 | See the equivalence checks below. |
| D3-P3-7 Simulators skip motion time, arcs, open-port write failures | P3 | CONFIRMED, P3 | The refuter's Smoothieware probe needed a hand-wrapped adapter for exactly this reason. |

### Equivalence checks (X14, J09, J12, W10, W11)

- **X14: equivalent, stronger than the auditor said.** `stopWithoutReset` (`laser-job-stop.ts:425`) has one caller, `freezeAndStopWithoutReset`, which already set the stream to `cancelStreamer(...)` (`:200-216`) and returns early unless `ownsStop()` (same stream epoch). `isActiveJobStatus` excludes `cancelled` (`laser-store-helpers.ts:76-79`), so the `if` at `:435` is false on every path and the block is dead code. Original and mutant do the same thing. Recommend deleting the block (P3).
- **J09: NOT equivalent (refuted).** `reviewPreparationWasCancelled` (`job-review-gate.ts:162-167`) is the only check of `owner.signal` after the Confirm re-prepare on the main-thread path. `prepareCurrentStartJob` tests the signal only on entry (`start-job-source.ts:90`); its background path re-checks it (`:191`), but the main-thread path (`prepareStartJobSnapshot`, which awaits `hydratePagedRasterProject` and `prepareOutputSnapshot`) does not. Probe `zz-refuter-gate-cancel.test.ts`: open the review, give the project a new identity with the same content (no reuse, same bytes), press Confirm, and fire `cancelAndClose()` while `isPreparing`. **main: the gate returns `null`. J09: the gate returns a `ConfirmedJobReview` with the same bytes, so the job would start after the operator cancelled.** It survived the 109-file gate list. Raised as D3R-P2-1.
- **J12: near-equivalent, confirmed.** The same `shouldAbandon()` is checked again after the rebuild (`:123`), so the gate still returns `null`. The only difference is a wasted rebuild and possibly `onFrameMismatch` and `onCompletedReplayChanged` side effects. P3.
- **W10: near-equivalent, confirmed.** `settle` runs only when `message.id === state.pending?.id`, and every phase change makes a new pending id (`begin`), so an `armed` reply for the current id cannot arrive outside `arming` under the protocol. P3.
- **W11: near-equivalent, but the auditor's reason is wrong.** `captureSnapshot` calls `pending.hold()` (clears the deadline) before `workerProgramFor` posts the program (`worker-refill-handover.ts:200-204`). If that post throws, the mutant returns `null` without `deps.fail()`, and nothing restarts the timer, so the arm promise has **no** deadline until the next Abort/Pause (whose `release` resolves it). That is not "bounded by the arm deadline". It needs `postMessage` itself to throw (a `DataCloneError`), so it stays P3, with the corrected reason.

### Killed-mutant spot checks (fresh process, killing file alone, clean baseline first)

| Mutant | Killing file (baseline) | Mutant failure | Real kill? |
|---|---|---|---|
| G01 preamble drops G90 | `grbl-laser-arc-moves.test.ts` (9/9 pass) | preamble `['G21','G54','G94','G17',…]` ≠ `['G21','G90','G54',…]` | Yes: an exact preamble assertion |
| X03 GRBL reset does not await refill release | `laser-unowned-motion-stop.simulator.test.ts` (11/11) | 2 tests: `expect(stopped).toBe(false)` while the release is held | Yes: the test holds the release and asserts Abort waits |
| J07 frame-first refusal never raised | `run-again-review-carry.conditions.test.ts` (31/31) | refusal list empty, expected 1 | Yes |
| C10 park height = last group's safe Z | `cnc-grbl-park-height.test.ts` (3/3) | job end does not lift to the park Z 25 | Yes |
| W07 silent worker never times out | `laser-hosted-refill-abort.test.ts` (2/2, 22 s) | the test times out at 60 s | Yes: the test exists to bound a silent worker, and the hang is the mutant's effect |

All five are behavioural kills, not crashes. None depended on the persistent runner.

### New findings

#### D3R-P2-1: Cancel during the Confirm re-prepare: the only guard has no test

- **Where:** `src/ui/laser/job-review/job-review-gate.ts:123` and `:162-167` (`reviewPreparationWasCancelled`), with `src/ui/laser/start-job-source.ts:80-120` (the main-thread path does not re-check the signal after its awaits).
- **Mutant (J09):** `return signal.aborted || shouldAbandon?.() === true` becomes `return shouldAbandon?.() === true`.
- **Effect, reproduced:** the operator presses Confirm, an input changed identity so the job is recompiled, and the operator presses Cancel (or the review closes) while it is preparing. On `main` the gate returns `null`. Under the mutant it returns a confirmed review and the Start flow streams the job the operator cancelled.
- **Why no test catches it:** survived 109 files (the whole `src/ui/laser/job-review` folder, every Start/run-again/framed-run-start test). `job-review-cancellation.test.ts` cancels only before Confirm or on the background path.
- **Severity:** P2 under the policy above. A gap over correct code, with a user-reachable trigger (Cancel during a slow re-prepare, e.g. paged raster hydration) and a harm (an unwanted start).
- **Fix direction:** the probe above as a regression test: same-content new project identity, Confirm, `cancelAndClose()` on `isPreparing`, expect `null` and no `startJob` call. Optionally make the main-thread `prepareCurrentStartJob` path re-check `signal` before it returns, as the background path does.

No current defect was found behind any survivor. For each P1 and P2 survivor the refuter checked whether `main` itself takes the mutated path anywhere (C12's single safe Z, R10's `feedPending`, X09's notice path, B03's other three sides, P06/P14's modal scan); none does.

### Not verified

- **The whole suite was still not run.** The wider lists hold 53 to 267 files per mutant; CI on a fix pull request remains the authority. G15 shows that list choice matters.
- **Not re-run:** J04, J05, J06, J08, J14, X02, X06, X07, X11, X13, X14, B08, T13, C03, W10, W11, J12. Their verdicts rest on the auditor's runs plus reading.
- **R10's dose effect** was shown on one 3 x 3 px image with the probe's own modal-F tracker, not through `emitGcode` on a real project or a full G-code interpreter.
- **X01's 99-line result needs a partial transport failure.** The refuter judged that unrealistic from Web Serial's sticky stream errors and the worker's Ctrl-X refill stop, not from a hardware test.
- **J09's window** was opened with a microtask in the probe. A real Cancel needs a macrotask gap in the main-thread prepare (paged raster hydration, output snapshot); its length on real projects was not measured.
- **R11's reach** (an S0 run that rounds to zero length under M3) was not reproduced.
- No browser, e2e or hardware runs.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d3r\`:

| File | Contents |
|---|---|
| `rmut.mjs` | Fresh-process runner: memory gate, apply the auditor's mutant, `vitest run` on a list, restore, compare with `j29-main` |
| `mklists.mjs`, `list-*.txt` | The wider lists |
| `drive.sh`, `drive.log` | The driver and its log |
| `runs.jsonl` | The `emit` baseline |
| `wide.jsonl` | Every wide re-run |
| `spot.jsonl`, `l-*.txt` | Killed-mutant spot checks |
| `probes\zz-refuter-smoothie-abort.test.ts` (installed as `mut\src\ui\state\…`) | X01/X09 probe |
| `probes\zz-refuter-gate-cancel.test.ts` (installed as `mut\src\ui\laser\job-review\…`) | J09 probe |
| `mut\src\core\raster\zz-refuter-r10.test.ts` | R10 probe |
| `probe-out.jsonl`, `probe-runs.jsonl` | Probe outputs (`tag` = mutant id, `none` = main) |

```json
{
  "area": "D3",
  "refuter": "2026-11-12",
  "tree": "8fd1b07c1",
  "runner": "fresh vitest process per mutant, wider lists 53-267 files",
  "rerun": {
    "G15": "KILLED (src/core/job/contour-entry-envelope.test.ts)",
    "R10": "SURVIVED emit 267", "R11": "SURVIVED emit 267", "M04": "SURVIVED emit 267",
    "T14": "SURVIVED rotary 205", "C12": "SURVIVED cnc 192", "B03": "SURVIVED preflight 53",
    "P06": "SURVIVED resume 62", "P14": "SURVIVED resume 62", "J09": "SURVIVED gate 109",
    "J01": "SURVIVED gate 109", "J03": "SURVIVED gate 109",
    "X01": "SURVIVED stop 92", "X09": "SURVIVED stop 92", "X10": "SURVIVED stop 92", "X05": "SURVIVED stop 92"
  },
  "verdicts": [
    {"id": "D3-P1-1", "verdict": "REFUTED", "severity": null},
    {"id": "D3-P1-2", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P1-3", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P1-4", "verdict": "REFUTED as described", "severity": "P3"},
    {"id": "D3-P1-5", "verdict": "REFUTED (equivalent on reachable input)", "severity": "P3"},
    {"id": "D3-P2-1", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-2", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-3", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-4", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-5", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-6", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-7", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P2-8", "verdict": "CONFIRMED", "severity": "P2"},
    {"id": "D3-P3-1", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D3-P3-2", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D3-P3-3", "verdict": "CONFIRMED (+C12)", "severity": "P3"},
    {"id": "D3-P3-4", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "D3-P3-5", "verdict": "CONFIRMED (+G15)", "severity": "P3"},
    {"id": "D3-P3-6", "verdict": "PARTLY REFUTED (J09 not equivalent; W11 reason corrected; X14 fully equivalent)", "severity": "P3"},
    {"id": "D3-P3-7", "verdict": "CONFIRMED", "severity": "P3"}
  ],
  "new": [
    {"id": "D3R-P2-1", "severity": "P2", "title": "Cancel during the Confirm re-prepare: the only signal check has no test (J09 not equivalent; reproduced)", "where": ["src/ui/laser/job-review/job-review-gate.ts:123,162-167", "src/ui/laser/start-job-source.ts:80-120"], "mutants": ["J09"]}
  ],
  "policy": "No P1 for a test gap over correct code (C1 precedent: P1 only after an escape, C1-P3-2 for an empty gap). P2 cap for a non-equivalent, reachable beam/stop/motion survivor; P3 otherwise.",
  "spotChecks": {"G01": "real", "X03": "real", "J07": "real", "C10": "real", "W07": "real (hang is the effect)"},
  "counts": {"raised": 21, "refuted": 3, "refutedNote": "G15 dropped; X09 and C12 refuted as P1, kept as P3", "P1": 0, "P2": 11, "P3": 9, "known": 5}
}
```

Refuter counts: raised 21, refuted 3, P1 0, P2 11, P3 9, known 5
