## ADR-352 - A streaming job costs the UI one store update per line, and nothing it cannot show re-renders or re-rasterizes (2026-09-23)

**Status:** Accepted; measured in headless Chrome against a paced GRBL stand-in, not on hardware. | **Date:** 2026-09-23

### Context

The operator reported that the app is slow and laggy while a big job runs. Earlier work made
Start preparation cheaper (ADR-345) and dense artwork cheaper to repaint (ADR-346), and ADR-333
buffered the per-acknowledgement transcript. None of it measured what the interface costs while
the job itself streams.

A new opt-in harness (`e2e/big-job-run-responsiveness.e2e.ts`, run with
`KERFDESK_BIG_JOB_PERF=1`) makes that measurable. It opens a synthetic 200 × 200 mm fill at 0.1 mm
spacing (214,807 lines), frames and starts it against a paced GRBL 1.1 stand-in
(`e2e/fixtures/paced-grbl-serial.js`: a 15-block planner drained at 500 blocks/s, replies about
2 ms after the write that caused them, counters only) and profiles a steady 20 s run window, then
times hover, wheel zoom and a panel switch. A dumped copy of the project runs against the
production bundle. Production bundle of `main` at 90c791c5f, six runs on one laptop (the spread is the machine):

| During the run (20 s window, ~500 acknowledged lines/s) | Before |
| ------------------------------------------------------- | ------ |
| Main thread busy                                        | 50–62% |
| JavaScript time                                         | 5.6–8.2 s |
| One wheel-zoom notch, to the second frame after it      | 590–980 ms, long tasks up to 756 ms |
| 60 pointer moves over the canvas                        | 2.0–4.0 s |

The profile and a static read of every subsystem named the causes:

- **Three laser-store writes per acknowledged line.** The streamer advance, then
  `pendingTransportWrites` +1 before the refill write and −1 after it. Every write runs every
  mounted selector (~150–210), and the counter flip re-rendered anything selecting it twice per
  line: the closed Board Capture panel ran its whole hook stack about 1,600 times a second.
- **Whole-tree renders.** The keyboard-shortcut hooks lived in `App` and subscribed to the status
  report and to a selector that returned a new object on every main-store write, so the entire
  interface re-rendered on each 250 ms poll and on every pointer move over the canvas.
  `MomentaryFireControl` subscribed to the whole laser store. The machine rail, the Job section and
  the collapsed docked console re-rendered per poll or per transcript publish for values they did
  not show.
- **Per-write selector work.** `canvasMachineRevision` and three `useRuntimeCoordinatePreparation`
  mounts ran `JSON.stringify` of the native-bed evidence on every store write.
- **The burn-route raster was rebuilt on every view change.** A zoom, pan or resize threw the
  append-only raster away and, inside the layout effect, restroked the whole planned route and
  re-walked and restroked the whole confirmed route, just above ADR-346's one-pixel stroker cliff.
- **Recovery checkpoint churn.** A run the recovery repository did not own queued back-to-back
  no-op read-write transactions for the rest of the job (1,142–1,279 per 2,000 acks), and every
  real checkpoint republished a snapshot that re-rendered four always-mounted recovery panels.
- **An unbounded live route scan.** Once the route match went uncertain (the Falcon report showed
  "Route match uncertain"), every status report rescanned every block from the frozen point to the
  acknowledged ceiling: ~46 ms per report late in a 373k-line job, inside a store write.
- **Current Position estimates recompiled the job during the run**, keyed on the moving head.

### Decision

1. **Job refills are counted off the store.** A refill (`safeWrite(..., undefined, 'job')`, one
   per acknowledged line) counts on an epoch-keyed ledger on the store's refs
   (`laser-job-transport-ledger.ts`) instead of `pendingTransportWrites`. Every site that zeroes
   the store counter advances the write epoch first, so the ledger forgets a dead session's
   refills exactly as the store did. Every safety reader — the Start queue fence, Frame/jog
   settlement and cancel, autofocus, controller qualification, Work-Z recovery, the queued-status
   poll policy and the controller-hold diagnostic — reads the combined
   `pendingTransportWriteCount`, so a refill in transport still blocks what it blocked. The Start
   window and Resume chunks keep the store counter. A streaming job now writes the store once per
   line.
2. **Nothing the operator cannot see re-renders for a streaming job.** App-level hooks run in a
   null-rendering leaf (`AppLifecycle`), and the shortcut contexts are built from the stores at
   keypress time. Components select only what they render (`MomentaryFireControl`, the rail's
   controller state, the Job section's stream status by value; the line count lives in a
   `LiveProgressBar` leaf). The Board Capture panel is a gate that reads `open` and mounts its body
   only while open or busy. The docked console stays mounted but holds the transcript it last
   showed while its section is closed. `statusPositionPatch` keeps the WCO, override and accessory
   cache objects when a frame repeats them. The recovery banner arms a timer for its claim-lease
   expiry, since no poll re-renders it any more.
3. **Selectors that run on every store write are memoized on input identity**
   (`canvas-machine-revision.ts`, the native-bed evidence snapshot), and the motion overlay object
   is memoized, keyed on the canvas colour scheme too, so the motion layer repaints only when
   something it draws changed. Preview and the estimate share one placement; in Current Position
   it follows the settled head. Outside Preview the estimate does not recompute while a job runs,
   and its per-project memo keeps four entries.
4. **Recovery progress writes are coalesced and quiet.** One progress write in flight plus one
   waiting slot whose ack is overwritten, not appended. A no-op marks the run untracked. Backends
   skip a put that would write back the record they read. Consumers subscribe through
   `useRecoveryRepositorySelection` to the slots they render. Hydration validates each retained
   artifact once by identity. Terminal interruption writes still carry the exact acknowledged
   line, and once a stream is interrupted no progress write can overtake them.
5. **A view change blits the route raster; the exact raster is rebuilt when the view is quiet**
   (`motion-route-raster.ts`, ADR-346's sprite rule). The previous raster is drawn scaled and
   translated by the view delta, newly confirmed segments keep appending into it in its own view,
   and after 150 ms of quiet the exact raster is rebuilt off to the side in 8 ms time slices,
   then swapped in. A superseded plan's pending rebuild is abandoned. Plans with at least
   `HAIRLINE_STROKE_SEGMENT_THRESHOLD` (20,000) segments draw the planned route, and the scorch at
   its width floor, as 1 px hairlines; batches cull off-canvas segments and chain cuts into
   polylines. The layer does not paint into the unmeasured placeholder bitmap.
6. **The live route scan is bounded to the planner window.** It starts no further back than
   `EXECUTION_WINDOW_BLOCKS` (4,096) motion blocks before the acknowledged ceiling, found by binary
   search on the monotone `sendableLineIndex`; GRBL holds 16 planner blocks and grblHAL 100 by
   default (the Falcon reports 512). This amends ADR-221's 2026-07-27 amendment: the acknowledged
   line count remains the ceiling for route reconciliation and now, less that window, also its
   floor. It still never becomes elapsed or remaining time.
7. **Frame readiness, Job Review and Start scan a program without splitting it**
   (`sendable-line-scan.ts`), keeping `splitLines`' exact definitions.
8. **The idle plan waits for the motion that owns the machine.** It draws the rapid from the
   head, so it is keyed on the Idle position, and it deferred only while the controller reported
   non-Idle. A Frame trace reports Idle between its moves, so every corner started a whole-job
   compile in a fresh worker that was cancelled about half a second later (six in 2.5 s on the
   215k-line fill, all competing with the Frame's own preparation). It now also defers while a
   Frame, jog or probe `motionOperation` is active and plans once when it ends. Likewise the job
   action row compares the status report by controller state only while no Frame permit exists,
   because without a permit its readiness answer is fixed.

9. **A Frame's own preparation has the CPU.** While a Frame prepares (`useFramePreparationStore`
   pending), the background estimate keeps its last value and the idle plan waits (a plan in flight
   is cancelled); each settles once when the Frame ends. Before, the estimate and idle-marker
   workers, serialized through the shared memory lane, ran two more whole-job compiles beside the
   Frame's: on the 215k-line fill the Frame's preparation took 27 s instead of about 8 s alone.
10. **The Start artifact is measured once, without a pair per node.** Staging the recovery
   artifact runs after the first window is on the wire and walked the prepared job's object graph
   twice (a budget pre-check over the inputs, then the finished artifact, which holds the same job
   and enforces the same budget). The pre-check is gone (`assertArchiveMayFit` still refuses the
   hopeless case before any allocation) and the walk takes plain objects and arrays first, with
   `Object.keys` instead of an `Object.entries` pair per property.
11. **Job Review reuses the prepared job's Frame envelope and fill-runway analysis** by identity
   between opening and Confirm.

### Consequences

- Measured with the harness, alternating the two production bundles on the same machine:

  | Production bundle, 214,807-line fill, ~500 lines/s (two runs each) | Before | After |
  | ------------------------------------------------------------------- | ------ | ----- |
  | Main thread busy during a 20 s run window                           | 50–51% | 19–21% |
  | JavaScript time in that window                                      | 5.6–5.9 s | 1.0–1.2 s |
  | Garbage collection in that window                                   | 424–446 ms | 125–240 ms |
  | Longest main-thread gap while streaming                             | 34–51 ms | 15–29 ms |
  | One wheel-zoom notch, to the second frame after it                  | 589–592 ms (long tasks to 384 ms) | 44–46 ms (long tasks to 52 ms) |
  | 60 pointer moves over the canvas, two frames each                   | 2.0–2.1 s | 1.6–1.7 s |
  | Longest task in the Start phase                                     | 865–882 ms | 584–672 ms |
  | Confirm click to 200 acknowledged lines                             | 2.2–2.7 s | 1.8–1.9 s |
  | Background whole-job compiles started during Frame                  | 7 idle-plan + 1 estimate | 1 idle-plan + 0 estimate |
  | Retained heap after a forced GC, start → end of the window         | 220 → 220–222 MB | 219 → 220 MB |

  Frame duration is worker-bound and varied from 8 s to 38 s between identical runs of the
  unchanged build, so it is not claimed as a speed-up; what changed is that Frame no longer
  shares the CPU with background compiles of the same job.
- The per-line store write that remains still runs every mounted selector once, now about 1–2% of
  the main thread at 500 lines/s.
- Dense plans (≥ 20,000 segments) draw the planned route and the floor-width trail one device
  pixel thinner. During a pan, newly exposed canvas shows no route until the 150 ms rebuild; during
  a zoom the stand-in is a scaled bitmap (soft when zooming in) until then.
- The docked console no longer follows the transcript while collapsed; it catches up on opening,
  and keeps its filters and draft. A non-busy Board Capture panel reopens without its transient
  messages. Shortcuts act on store state at the keypress.
- Outside Preview the ETA is not recomputed during a run, including after an edit made during it;
  it settles once the job ends. The live badge shows the run's own timing meanwhile.
- After a failed or no-op progress write, the retry waits for the next 25-line interval, so a crash
  right after a storage error can leave the checkpoint up to two intervals behind. Interruption
  capsules stay exact.
- A route match frozen for more than one window re-matches on the pass the planner is running
  instead of creeping forward from the stale point; in a matched dense raster confirmed progress
  can land up to about two rows nearer the head than before.
- Still open: Workspace re-renders once per status poll during a run (the motion overlay reads
  `liveCanvasRun`, which carries the head), measured at about 33 ms per 20 s; the running route
  is still held as ~13 V8 objects per block (about 100 MB for a 373k-line job; GC stayed near 1% of
  the run); batching acknowledgements per serial read chunk would remove the last per-line store
  write but changes what transition-detecting subscribers observe; the worker-hosted streamer
  (ADR-334) remains opt-in and hardware-unverified. The idle plan and the estimate still key on the
  head position, because they draw and time the lead-in rapid from it, so a settled move recompiles
  the whole job in the background to move that one rapid; decision 9 keeps it away from Frame, and
  splicing the lead-in onto a position-free compile would remove it.

### Alternatives rejected

- **Batching store notifications per read chunk:** removes the last per-line write, but every raw
  subscriber would see coalesced transitions. Not needed once refills left the store.
- **Unmounting the docked console while collapsed:** removed the renders but reset its filters and
  unsent command on every close.
- **One bed-resolution route raster for every view:** soft at working zoom and large; the
  placeholder-then-exact rule keeps the trail crisp once the view settles.
- **A smaller live-scan window:** too small would skip the executing block and confirm route the
  head has not reached; 4,096 costs time only while frozen or in very dense rasters.

### Verification

- New regression tests, each confirmed to fail on the previous code:
  `laser-job-transport-ledger.test.ts` (no store write per refill, fence still sees it, epoch
  reset, failure path), `App.render-isolation.test.tsx`, `BoardCapturePanel.gate.test.tsx`,
  render-count tests for MomentaryFireControl, JobControls, LiveJobTimeBadge and LiveMotionBar,
  `LaserWindow.console-disclosure.test.tsx` (holds the transcript while closed, keeps the draft),
  `workspace-status-poll-renders.test.tsx`, the canvas-machine-revision and native-bed memo
  parity tests, `motion-route-raster.test.ts` (blit per notch, appends into the placeholder,
  settle rebuild, sliced rebuild, superseded plan), `motion-route-visual.test.ts` (software ink
  rasterizer against the previous algorithm: identical below 20k segments, IoU ≥ 0.976 at the
  hairline floor), the live-route window fuzz against the unbounded scan, the coalesced-checkpoint
  and exact-interruption tests, a 4,000-program parity fuzz for the program scans, a 3,000-graph
  parity fuzz pinning the artifact size walk to the previous one byte for byte, the idle-plan tests
  for a Frame trace and a pending Frame preparation, the estimate hold during Frame preparation,
  and `framedRunFieldsEqual`.
- Full vitest suite: 2,343 files pass; the only failure (`adaptive-pocket-verifier`) is a CNC
  geometry test this change does not touch that times out under load and passes alone.
  Typecheck and ESLint pass.
- **NOT verified:** a real machine or the Falcon's grblHAL at 512 planner blocks; the packaged
  Electron runtime; GPUs other than this laptop's; real traced artwork; the Frame duration, whose
  worker-bound timing varied from 8 s to 33 s between identical runs of the unchanged build.
