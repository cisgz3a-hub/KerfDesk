## ADR-352 Amendment 1 - Acknowledgements of one serial chunk are one store write, and a late-job restore catches up in slices (2026-09-24)

**Status:** Accepted; measured in unit and parity tests, not on hardware. | **Date:** 2026-09-24

### Context

A 298k-line Falcon photo engrave froze Chrome ("Page Unresponsive") at 74% on the build before
ADR-352. A parallel investigation (ADR-356, the serial read loop and the stream watchdog)
reproduced one multi-second stall: after the window was minimised and restored at 74% in a
development build, the longest task was 11.95 s and the thread was 97% busy for 103 s. Its
profile was dominated by the per-acknowledgement path (read loop → stream advance → refill) and
by store-selector fan-out, then by the Machine panel re-rendering on status fields.

ADR-352 cut the per-acknowledgement cost from three store writes to one and fixed the view-change
raster rebuild and the unbounded live-route scan that the investigation also verified. What was
left in this lane:

- one store write per acknowledged line: a burst of hundreds of acknowledgements after a hidden
  window or a busy thread is hundreds of full-store notifications in one task;
- the jog panel followed the status report through `JogPad` and the Zero Z handler, so the whole
  panel re-rendered at every poll of a job, although a job disables it;
- the pre-Start idle plan (a second whole-job route model) stayed in React state for the run;
- after a long gap, one unsliced append of the whole confirmed backlog into the route raster
  (measured at 27.6 ms of JavaScript and 183 ms with raster readback at 74%).

### Decision

1. **Acknowledgements that arrive together are applied together**
   (`laser-stream-ack-batch.ts`). The read loop dispatches every line of a chunk synchronously. A
   stream-owned `ok` is counted and the count is applied in a microtask with `advanceStreamBy`:
   the same `onAck` → `step` sequence per acknowledgement, one store write, one refill write
   carrying the same bytes in the same order, stopping at the first status change so every
   transition keeps its side effects. An acknowledgement is only deferred while that is
   invisible to every other line: the stream is `streaming`, no untracked acknowledgement is
   owed (so ownership cannot depend on the streamer), there is no MPG hold or worker-hosted
   refill, and at least one of its lines stays in flight (so a deferred acknowledgement can
   never complete the job and start the post-job settle writes). Any other line flushes what
   is held before it is handled. The flush runs before any timer, UI event, close handler or the
   next read, and composes with ADR-356's read-loop slicing: each slice ends with one flush.
2. **The jog panel does not follow the status report while a job disables it.** The head
   position lives in a `JogArrows` leaf that selects the report only while the pad is enabled (it
   aims a continuous jog, which a disabled pad cannot start), and Zero Z reads the store when
   clicked.
3. **The idle plan is released while a run is active** and re-planned when it ends, as it already
   was; a finished run's trail stays on screen meanwhile.
4. **A route-raster append after a long gap is sliced.** An existing raster appends newly
   confirmed route in 8 ms slices of up to 4,096 segments and repaints when caught up. An ordinary
   per-poll append (a few hundred segments) is still one stroke, identical to before, and a raster
   with no trail yet is still painted exact at once.

### Consequences

- During steady streaming a USB bridge's several acknowledgements per chunk become one store
  write; after a hidden window a backlog of hundreds becomes one write per chunk (or per ADR-356
  slice) instead of one per line.
- The stream's `completed` count and the refill write move by one microtask; nothing outside the
  chunk's own lines can observe the difference, and the last in-flight line of a job is always
  applied immediately.
- Three tests that asserted synchronously after feeding an `ok` now wait for the flush; one that
  counted refill writes now counts the lines they carried.
- Not changed, on purpose: `liveCanvasRun` is still republished per status report, because every
  report during a run moves the head the motion layer draws; `use-command-store-state` still
  compares five fields per store write (its cost was proportional to the write count, which this
  amendment and ADR-352 reduce). The route model's object count per block (MEM-1) remains open;
  GC was about 1% of a profiled run window.

### Verification

- The incident harness from the ADR-356 investigation (`freeze-late-image-job.e2e.ts`, kept on
  that branch): a synthetic 1,175 × 1,190 px Floyd-Steinberg photo engrave, 316,425 lines, on
  the Falcon A1 Pro profile against a paced grblHAL stand-in (128-block planner), fast-forwarded
  to 73.5% and then run at the incident pace of 45 lines/s. Development build, same machine and
  configuration as its run 5 on the build before ADR-352:

  | At 74% of the job                                   | Before ADR-352 | ADR-352 + this amendment |
  | --------------------------------------------------- | -------------- | ------------------------ |
  | Minimise and restore: longest task                  | 11,952 ms      | 718 ms                   |
  | Minimise and restore: longest main-thread gap       | 17,749 ms      | 867 ms                   |
  | Minimise and restore: gaps over 1 s                 | 28             | 0                        |
  | Minimise and restore: main thread busy              | 97%            | 33%                      |
  | One wheel-zoom notch: longest task                  | 1,132 ms       | none over 50 ms          |
  | Window resize: longest task                         | 800 ms         | none over 50 ms          |
  | Opening the Machine panel: longest task             | 833 ms         | none over 50 ms          |
  | Steady streaming, no input: main thread busy        | 75%            | 21%                      |

  What remains in the restore window is mostly the browser's own work (15 s of native time over
  68 s); the largest JavaScript item is the per-status route reconciliation at 0.4 s. The harness
  cannot truly hide a headless page (visibility stays `visible`; a window minimise stops frames),
  so this is the harness's stand-in for a hidden tab, not a real one.
- `laser-stream-ack-batch.test.ts`: 60 seeded jobs streamed both ways (acknowledgements in random
  chunks of 1–24 versus one per task) produce identical bytes on the wire and identical stream
  state with fewer store writes; a chunk is one streamer write and one refill; a status line
  flushes held acknowledgements before it is handled; nothing is held while an untracked
  acknowledgement is owed; a job finished inside one chunk writes exactly what one-at-a-time
  does. Breaking the refill concatenation fails two of them.
- `JogPad.render-cost.test.tsx`: eight status polls re-render a disabled pad zero times (eight
  before).
- `motion-route-raster.test.ts`: a backlog of ~18,700 wide segments is appended with the first
  task bounded by one slice plus one batch, and the caught-up raster matches a fresh one (IoU >
  0.99 per channel; batches meet at antialiased seams, as a sliced rebuild does). The dense
  zoomed-in visual comparison against the previous algorithm stays exact.
- Full vitest suite on the branch: 2,361 files pass, none fail.
- **NOT verified:** a real hidden tab (headless Chrome keeps the page visible), a production build
  of the late-job image scenario, the packaged Electron runtime, and hardware.
