## ADR-244 Amendment 1 - The background ETA times the program from totals, not a whole timeline (2026-11-03)

**Status:** Accepted on 2026-11-03 |
**Amends:** ADR-244 (large-job preview and estimate prepare off the main thread), with the
memory budget of performance audit S1 (1.5 GB peak for the whole app)

### Context

Performance audit S1, area S3 (`docs/audits/2026-11-02-performance-s1/S3-save-open-import.md`),
confirmed S3-P2-3. While the ADR-244 worker prepared the canvas ETA of a project with photos,
the renderer reached 2.9-4.2 GB with one bed-sized photo (4000 x 3000 at 400 x 300 mm,
10 lines/mm) and over 5 GB with four. Most of it lay outside the JavaScript heap.

Profiling that photo's ETA in Node on the same code:

- The emitted program is 76 MB of text, 8.0 million lines and 8.0 million segments.
- `estimateJobDuration` reads five numbers: the total, the motion breakdown, dwell, transport
  and the count of manual pauses. It got them from `buildProgramTimeline`, which also builds the
  Inspector's and Start's clocks:
  - nine per-segment arrays in `buildProgramTime` (360 MB);
  - thirteen per-line and per-sendable-line arrays and seven per-segment clock arrays
    (1,249 MB of typed arrays in all);
  - two whole-program `split`s into 8 million strings each.
- Peak RSS by stage: compile 0.19 GB, emit 0.75 GB, parse 1.13 GB, planner 2.76 GB, and the
  full timeline 4.2 GB.

### Decision

1. **The ETA uses `buildProgramDuration`.** It shares the timeline's parse and timing checks
   (`parseTimedProgram`), its planner walk (`walkProgramMotion`, now behind both
   `buildProgramTime` and `buildProgramMotionTotals`) and its serial transport clock
   (`createTransportClock`, now behind `programTransportTime` too). It keeps one seconds value
   per raw line and one dwell value per raw line, and walks the raw lines without splitting the
   program (`forEachRawLine`).
2. **The numbers may not change.** It accumulates in the timeline's order: segment seconds into
   their line, then line by line, with transport fed each line's start time. The totals are the
   same doubles the timeline reports, not merely close ones. The ETA, Job Review's duration and
   every caller of `estimateJobDuration` are unchanged; Start's and the Inspector's timelines
   still use `buildProgramTimeline`.
3. **Blocks are built per planner span** (`segmentBlocks(model, limits, start, end)`), not for
   the whole program and then sliced, in both paths.

G-code and its emission are untouched.

### Verification

- `program-duration.test.ts` compares the totals with `buildProgramTimeline`'s using `Object.is`
  on generated programs with cuts, rapids, laser-off feeds, arcs, Z, dwells, M0/M1 pauses,
  comments and all three line endings. It covers no serial link, 115,200 and 9,600 baud, host
  tool-change pauses, a 16-block planner window, calibrated time scales and a device's real
  timing options. It also checks that `forEachRawLine` visits exactly the lines of
  `split(/\r\n|\n|\r/)`.
- `estimate-duration-totals-only.test.ts` compiles a dithered photo, fails if
  `estimateJobDuration` calls `buildProgramTimeline`, and checks the result against the
  timeline's.
- The ETA, Job Review and preparation suites (60 files, 508 tests) pass with no expected value
  changed.

Measured in Node 25 on the audit PC: at a quarter of the photo (2000 x 1500 at 200 x 150 mm,
2.0 million lines) both clocks give 12,721.010468767634 s. The process peak was 1,066 MB with
the full timeline and 825 MB with this amendment; above the emitted program, 717 MB became
476 MB. The ETA path end to end (`largeJobEstimateFromPrepared`) peaked at 825 MB with the same
estimate.
The full-size photo was not re-timed both ways, and the renderer peak was not measured in the
browser: other work on this 16 GB PC kept free memory under the 4 GB those runs need. Peaks
scale with the number of segments, so one bed-sized photo should fall from about 4.2 GB to
about 3 GB in Node; that is an estimate.

### What the 1.5 GB budget still needs

This removes about a third of the ETA's memory above the program text, not enough for one
bed-sized photo to fit 1.5 GB for the whole app (a fresh app is about 1.0 GB). What remains, at
8 million segments:

- **The planner's JavaScript objects, about 1.3-1.5 GB at peak.** Every segment becomes a
  `Block` with a direction object and a `PlanEntry`, plus an acceleration array, for the whole
  span. A columnar planner for the totals path (distance, target velocity, acceleration, entry
  and exit in `Float64Array`s, with the same junction and window caps and the same backward and
  forward passes) would hold about 40 bytes per segment, about 320 MB. Its passes must stay
  exactly those of `planVelocities`, proven the same way as here.
- **The parsed render model, 408 MB.** The totals path needs each segment's length, direction,
  feed, power, kind and line only once. Feeding the parser straight into the planner columns
  would drop the stored positions.
- **The program text, 76 MB**, which the ETA emits whole. Timing the emitter's lines as they are
  produced would remove it, at the cost of a second, streaming emission path.

With the first two, the ETA's peak for one bed-sized photo would be roughly the program, the
planner columns and the two line arrays: about 0.5-0.6 GB above the app. Four photos would still
exceed the budget, because the ETA times the whole job at once. Preview, which needs the whole
route, is not covered by any of this.
