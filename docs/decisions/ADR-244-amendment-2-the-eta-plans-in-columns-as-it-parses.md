## ADR-244 Amendment 2 - The background ETA plans in columns as it parses (2026-11-03)

**Status:** Accepted on 2026-11-03 |
**Amends:** ADR-244 (large-job preview and estimate prepare off the main thread) and its
Amendment 1, with the memory budget of performance audit S1 (1.5 GB peak for the whole app)

### Context

Amendment 1 gave the canvas ETA (`estimateJobDuration`) a totals-only clock,
`buildProgramDuration`, and named what still kept one bed-sized photo (4000 x 3000 at
400 x 300 mm, 10 lines/mm: 8.0 million lines and segments, 76 MB of G-code) above the 1.5 GB
budget (performance audit S1, S3-P2-3):

- the planner's JavaScript objects: a `Block`, a direction and a `PlanEntry` for every segment
  of a span, plus an acceleration array, about 1.3-1.5 GB at peak;
- the parsed render model, 408 MB, kept only to be planned once;
- the program text, 76 MB.

### Decision

1. **A columnar planner for the totals path.** `ColumnarPlan`
   (`src/core/motion-planner/columnar-plan.ts`) holds a span's distance, target speed, entry
   speed and cut flag in typed columns, and its acceleration only once a block's differs from
   the profile's (never on a Cartesian machine): 25 to 33 bytes a segment. It runs
   `planVelocities`' passes in the same order with the same expressions:
   - `capJunctionEntries` as each block arrives, with `junctionPlanningLimits` and
     `junctionVelocity` on the block and the one before it;
   - `capPlannerWindowEntries` from the same running prefix sums of distance, kept in a ring of
     `plannerBlocks + 1` sums rather than one per block; each entry is capped once its window's
     end is known, which is always after its junction cap;
   - `backwardPass`, then `forwardPass`, which hands each finished block to the caller, so the
     block's time is taken at once with `blockTime` (on a reused scratch block) and the
     acceleration from `blockAcceleration`.
   It keeps no exit column: `backwardPass` sets each exit to the next block's entry, and
   `forwardPass` reads that exit before it changes that entry. The columns grow in chunks
   (`ChunkedColumn`) and never copy what they hold, so a span need not be counted first.
2. **The parse feeds the columns.** `buildProgramDuration` gives the render-model builder its
   own segment sink and events array (`StreamedMotion`, `src/core/gcode-time/streamed-motion.ts`;
   `createGcodeRenderModelBuilder` now takes the events array as an optional third argument).
   Each move becomes a block from the values the model would have stored (Float32 positions,
   feed, power and route ends, Uint8 kind and motion, Uint32 line;
   `storedSegmentBlock` in `segment-blocks.ts`, which `segmentBlock` also uses). A line's moves
   wait until the line has been read, when every event of that line is known, then join the
   current span by `motionSpans`' merge (`motion-spans.ts`, moved out of `program-time.ts`). The
   model it returns has its events, lines and line categories but no moves. The missing-feed
   check, which used to read the stored moves, is fed the first such line from the stream
   (`timingUnavailableReason(model, missingFeedLine)`).
3. **The accounting is shared.** `MotionTally` (`program-time.ts`) adds each block's scaled
   seconds to the cut, rapid and feed-travel totals in program order, for both the timeline's
   `buildProgramTime` and the streamed ETA. Amendment 1's `buildProgramMotionTotals` is removed;
   the timeline keeps `planVelocities` over `Block` objects.
4. **The numbers may not change.** Start, the Inspector and Job Review's timelines are
   untouched, and the ETA is the same double as before.

`timingUnavailableReason` also stops spreading the line categories into an array (64 MB for
8 million lines). G-code and its emission are untouched.

### Verification

- `columnar-plan.test.ts` compares every entry, exit, acceleration and block time with
  `planVelocities`' using `Object.is`, on 600-block sequences with axis, diagonal, 3D, repeated
  and reversing directions, zero and tiny lengths, rapid/feed changes, stops after a block and
  feed-matched laser chains. It covers Cartesian and CoreXY, no planner window and windows of 1,
  2, 3, 15, 16, 100 and 10^9 blocks, windows planVelocities ignores (0, -3, 2.5, NaN), spans of
  0 to 5 blocks and spans across the column chunks. Bidirectional raster rows of 0.1 mm pixels
  make the 15-, 16- and 100-block windows set the speed, also after a 10 km lead-in that leaves
  every running distance sum without a pixel's low bits. Shifting the window's end by one block
  fails 9 of its 21 tests (every window from 1 to 100 blocks); dropping the backward exit from
  the forward pass fails all 21.
- `program-duration.test.ts` now also compares with `buildProgramTimeline` (`Object.is` on
  the total, motion, dwell, transport and all three breakdown parts) under CoreXY, planner
  windows of 1, 2, 15 and 100 blocks (with CoreXY and calibration too), a grblHAL CoreXY
  device's real options, and a hand-written program planned in many spans: G4 between moves, a
  G4 before motion in the same block, M0, M1, M2 with motion after it, and M30. It checks that
  missing and zero feeds, a segment budget, an empty program and text that is not G-code give
  the timeline's reasons.
- `estimate-duration-totals-only.test.ts` is unchanged and passes. The timing, planner,
  render-model, job, G-code preview, Inspector, large-job preparation and G-code output suites
  (400 files, 3,571 tests) pass.

Measured in Node 25 on the audit PC with the untracked stage profiler of Amendment 1 (peak RSS
of the test process; a bare process is about 150 MB):

| Photo | Segments | Amendment 1 | Columns, model kept | Columns, streamed parse |
|---|---|---|---|---|
| 2000 x 750 | 1.0 M | 543-550 MB | 399 MB | 323-329 MB |
| 2000 x 1500 | 2.0 M | 825 MB (Amendment 1's run) | 635 MB | 410 MB |
| 4000 x 3000 | 8.0 M | 2.76 GB at the planner, 4.2 GB as a timeline | not run | 861 MB |

- Every run gave the same ETA: 6,363.8728421316555 s, 12,721.010468767634 s, and
  49,443.415147311345 s for the full photo, the very total of Amendment 1's full timeline of
  the same program (G-code SHA-256 `1d9244431a73670e...`).
- At full size, timing adds about 105 MB to the emission's own 756 MB peak. The app's path end
  to end (`largeJobEstimateFromPrepared`: emit, then time) peaks at **740 MB** for one bed
  photo, with the same estimate (13 h 44 min 3 s).
- Speed is unchanged: three interleaved pairs at 1.0 M segments took 2.0-3.1 s before and
  2.0-2.4 s after.
- Amendment 1's quarter-size run with the object planner was stopped by the free-memory
  watchdog (1.5 GB floor) in this session, so the first row is the comparison at a size both
  could finish.

### What the 1.5 GB budget still needs

In Node, one bed-sized photo's preparation now peaks at about 0.6 GB above a bare process, and
the ETA is no longer the larger part of it: the emission is. A fresh app is about 1.03 GB in the
browser, so one photo should land near 1.6 GB there. That is an estimate; the renderer peak was
not measured, because this PC never had the free memory for the browser runs while other work
ran on it.

- **The emission, about 0.6 GB at its peak**, to produce 76 MB of text: the next target.
  Timing the emitter's lines as they are produced would also remove the 76 MB text from the
  ETA, at the cost of a second, streaming emission path.
- **Line arrays, 128 MB**: seconds and dwell per raw line (`Float64`, 8 million lines each).
- **Four photos** still exceed the budget: the ETA times the whole job at once, and its columns,
  line arrays and text grow with it. Scaling the full-size run, four bed photos (32 million
  segments) would need roughly 2.5-3 GB above a bare process; not measured.
- Preview, which needs the whole route, is not covered by any of this.
