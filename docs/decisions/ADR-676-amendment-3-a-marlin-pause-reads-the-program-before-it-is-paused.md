## ADR-676 Amendment 3 - A Marlin Pause reads what the program holds from a table built behind Start, and decides its beam-off before the release (2026-11-02)

**Status:** Accepted on 2026-11-02 |
**Amends:** ADR-676 Amendment 2 decision 3 (which lines a Pause posts, and when they are decided);
keeps the MA-1 beam plan (`planMarlinStreamPauseBeam`) and its answers unchanged

### Context

Performance audit S1 (`docs/audits/2026-11-02-performance-s1/S1-running-job.md`, refuter-confirmed)
measured **S1-P1-1 (P1)**: a Marlin Pause on a large job blocks the UI thread between handing the
refill back and writing the beam-off.

- `marlinStreamPauseOffLinesFrom` asked two questions of the whole program each time. It walked back
  over every sent line for the inline beam, which a fan-dialect job never finds, then walked forward
  over every later line for one that lights the fan or arms the inline beam. On a fan job the inline
  test never short-circuits.
- Pause posted the release first and ran that walk after it. The worker stops refilling at once, so
  Marlin drains its 15 planned moves in about 50 ms and stops. On the fan dialect the stopped head
  then stays lit until the `M107` arrives (planner.cpp L1388-L1399: with no block queued the fan
  follows the current speed, with no timeout).
- **Measured on main** at 739,048 lines (worker route, fan dialect, 300 blocks/s): every Pause blocked
  283-348 ms, and 3 of 6 left the head lit 281-349 ms. At 29,212 lines there was no long task, and
  the head was lit 0 ms in 4 of 6 Pauses and 16-17 ms in 2.
- The refuter showed the walk predates Amendment 2. Since 1.0.28, `planMarlinStreamPauseBeam` walked
  back over the sent lines, so a Pause late in a large job already blocked (314-516 ms at 89%, and
  2 of 5 lit for 346 and 358 ms). Amendment 2 made every Pause pay for the whole program.

### Decision

1. **What the beam decision needs from a program is read once per stream, into tables by position**
   (`core/controllers/marlin/stream-pause-beam-index.ts`).
   - **Facts pass.** For each position, the last `M106`/`M107` before it; then the last line that
     lights the fan and the last line that arms the inline beam. Only lines with an `M` are parsed,
     and each distinct line once (a fan program repeats `M107` and its `M106 S<n>` values).
   - **Inline replay**, only for a program with an inline mode switch: the inline beam at every
     256th position. The beam is followed afresh from each `M3 I`, `M4 I` or `M5 I`, so it is the beam
     the old walk back to the last switch found.
   - **The answers are exactly the old walk's.** "Some later line lights the fan" becomes "the last
     line that lights it is at or after this position". The held fan speed is read from the one line
     the table names. The held inline beam is replayed over at most 255 lines from a checkpoint.
2. **Both passes run in slices behind Start**, one slice per task (about 2 ms of facts, or about 4 ms of
   replay, on the PC that measured S1), while the job runs.
   - Each slice reads the stream current at that moment, and stops once the stream has ended.
   - **The answers never depend on how far the slices got.** A question reads whatever it still needs
     itself: the plan only up to its position, and the off lines every fact plus the replay up to
     their position. The stream moves at most about 1,000 lines a second and the slices read hundreds
     of thousands, so in practice a Pause reads nothing.
   - **Not in Start itself, and not off the thread.** Start's preparation already blocks for over a
     second at this size (S1-P2-2), and the replay of a 737,105-line inline program costs about
     1.2-1.8 s. Reading in another thread would mean copying the lines there. The slices keep both
     out of any single task.
3. **Pause decides its beam-off before it posts the release, as Abort decides its stop lines**
   (`releaseRefillWithBeamOff` in `laser-stream-pause-beam.ts`). With the decision cheap, nothing at
   all runs between the release and the beam-off writes. The freeze, the notice and the plan still wait
   for the worker's reply, as Amendment 2 decided.
4. **Resume's restated line takes the table over** (`carryStreamPauseBeam`).
   - The restated burn move gets the inline power it already runs at. In inline mode a held power
     above zero is always the unit power, so the move leaves the same beam, and the table read for the
     old array holds for the copy.
   - Without this, the next Pause would read the copy's program from the start again.
5. **Never a line of the other dialect "to be safe".** Amendment 2's "a line too many is harmless"
   holds for a line the program itself uses. Marlin without LASER_FEATURE answers `M5 I` as an
   unknown command, which ends the job (Amendment 2 decision 1). So the off lines still name `M107`
   only when the program uses the fan, and `M5 I` only when it uses the inline beam.

### Consequences

- A Marlin Pause puts its beam-off on the wire with no per-line work, whatever the program's size or
  the stream's position. The ordering in Amendment 2 is unchanged, and so are the lines it sends.
- Resume's plan (the restore lines and the restated move) is read from the same table, so Resume no
  longer walks the sent lines either.
- **Memory.** A 4-byte entry per line, plus a checkpoint object every 256 lines of an inline program.
  That is about 3 MB at 739k lines, against about 1.8 KB of heap per line for the running job.
- **The main thread works for a while after Start.** On a 743,593-line fan program the facts take 24
  slices, about 80-100 ms in all. On a 737,105-line inline program, the replay takes about 360 slices
  and 1.2-1.8 s in all. The test runner saw single slices of 35-106 ms, which a major GC of its
  740k-line heaps caused.
- **Checked, not changed.**
  - Abort, Disconnect, the 90 s hold containment and the line-error stop write
    `noResetStopLines`, which never asked the beam plan. Abort and Disconnect already compute their
    stop lines before they post the release.
  - Tool change reaches the plan only through Pause and Resume.
  - GRBL-family drivers have no stream-side Pause plan.
  - The serial and network workers never compute one.
  - `noResetStopLines` still tests every line for `M7`/`M8` (`streamSwitchesAirOn`). The audit
    measured Abort's `M107` at +8 ms at 739k lines, within budget, so it stays a follow-up.
- **G-code is unchanged.** Nothing in output or compilation changed. Nine compiled programs hash the
  same on this change and on `origin/main` `02c02616e`: three projects × stored / fan / inline
  dialect, up to 208,923 lines.

### Verification

- `stream-pause-beam-index.test.ts`, against the old walk kept verbatim as an oracle
  (`src/__fixtures__/controllers/marlin-stream-pause-beam-scan.ts`):
  - **At every index**, the plan and the off lines match the old walk on these programs:
    - a fan raster and a three-layer inline raster, from the real transforms;
    - three seeded mixed programs (comments, lower case, bare `M106`, `M106 S0`, plain `M3`/`M5` in
      inline mode, `G1 … I`, both dialects);
    - short programs and an empty one.
  - **With the slices part-way.** They run ahead of the questions and behind them.
  - **After Resume restated a burn move.** Every index of the new array matches.
  - **No per-line work.** Line reads are counted through a proxy, not timed, so CI load cannot flake
    the test. On a fan program of over 700,000 lines a Pause and its plan read at most 3 lines
    anywhere in the job. On an inline one they read at most two strides and a short look-ahead.
- `laser-pause-hosted-handback.test.ts`: on a 200,000-line fan program, the release and then the
  `M107` are written with 0 program lines read before either. On main the `M107` came after a walk of
  the whole program.
- `laser-stream-pause-beam-start.test.ts`:
  - one slice per task, none in Start itself;
  - each slice reads the stream current at that moment;
  - the slices stop when the stream ends;
  - no timers for a driver without a plan.
- Unchanged and passing: `stream-pause-beam.test.ts`, `laser-stream-pause-beam.test.ts`,
  `in-window-stall-beam.thread.test.ts` and the Pause and Resume store suites.
- **Node, this tree's own code on this PC.** Each figure is one Pause's off lines and its plan.

  | Program | Old walk | Table |
  |---|---|---|
  | Fan, 743,593 lines | 368-575 ms | 0.016-0.019 ms |
  | Inline, 737,105 lines | 417-828 ms | 0.32-0.62 ms |

- **Chromium** (the S1 harness, production bundle): see the PR.
- **Not verified:** hardware.
