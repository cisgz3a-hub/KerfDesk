# Rolling audit v5 — Scale and performance

- **When:** 2026-10-28, morning +0800   **Tree:** origin/main @ `93334429e` (#1484 merged; re-fetched at the end, unchanged).
  - **Repros ran on main's exact tree, not the worktree.** They ran in the J7 copy of `git archive 93334429e` (`…\scratchpad\j7-main\`, every tracked file hash-checked by the J7 refuter), one Vitest file at a time.
  - Command: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`, with sizes passed as `J10_*` environment variables.
  - Timing uses the real `process.hrtime.bigint`, captured before Vitest installs fake timers, because the fake clock also fakes `hrtime`. Heap figures are `heapUsed` after two forced GCs.
  - **Machine:** this PC (16 logical cores, about 2.5 GB free), Node 25.8.2 / V8 14.1. ADR-352 measured the same kinds of work in Chromium at 2–3× these Node times, so read every threshold below as optimistic.
- **Scope:** J10 `scale-performance`:
  - UI-thread work that grows with input in Start, Job Review, selection, Undo, autosave/Save and import;
  - long G-code streaming through the real store;
  - Undo history growth;
  - autosave and Save on large projects;
  - every job-time watchdog under a busy UI thread, plus Abort latency.
- **Lenses run:** L4 (size sweeps; busy-UI and streaming interleavings) and L6 (watchdogs, Abort and Save refusal under load). L5 is limited to the remote reach of the quadratic paths (refuted: remote selections are capped at 200 ids).
- **Not run:** browser canvas rendering, React render cost, Electron and hardware.
- **Counts:** 4 raised → 0 refuted → P1 0 / P2 2 / P3 2 (+ 4 KNOWN re-observed, 9 candidates refuted).
  - **Refuter (fresh context):** all four CONFIRMED by the refuter's own REPRO on main's tree (`origin/main` re-fetched 2026-10-28: still `93334429e`).
  - **Severity change:** J10-P3-3 is raised to P2. It is reachable today, because no import caps points. The raw recovery copy that the app offers fails the same way. Precedent: rolling v2 13-P2-1 and 13-P2-2.
  - **J10-P2-1 stays P2, not P1.** On the default transport the job runs as programmed, and the Abort is delayed by one operator gesture, not blocked (see the finding).
  - **Corrections:**
    - J10-P3-2's 0.13 µs per line is the cold first call; warm it is 0.02–0.03.
    - A cancelled drag does not go through `visibleSelectionState`.
  - **Refuter spot-check** of two "holding up" claims: the watchdogs after a 2.5 s block and the log caps both hold. One heartbeat edge with a block just under 2 s is noted under Verified clean.

## Headline

The job-time safety paths hold up under load:

- **Streaming cost per line is flat.** The real store against the GRBL simulator stays at 59–62 µs per line from 8k to 64k lines, all-in.
- **The console stays bounded.** The log, transcript and incident ring stop at 200, 500 and 500 entries.
- **Abort is fast.** A GRBL Abort reaches the wire in 0.4–1.0 ms of CPU time at 4k–128k queued lines.
- **The watchdogs behave.** The heartbeat and acknowledgement watchdogs neither false-fire after 2.5 s, 5 s or six back-to-back 2.1 s UI blocks, nor miss a silent controller. The scheduling grace is capped at three ticks.
- **Autosave stays off the job.** It is skipped while a job streams or is paused, and its UI-thread handoff (pack plus post) costs at most 40–80 ms at 1M points.

What scales badly is **design editing of large selections**:

- **J10-P2-1.** These all look up each selected id with a linear `scene.objects.find`, so their cost is O(selected × objects):
  - a canvas move, scale or rotate drag of a multi-selection, which also writes the store once per selected object per pointer move;
  - arrow nudge, flip and rotate 90°;
  - Undo and Redo;
  - Duplicate.

  One drag frame takes 86 ms at 1,000 selected objects, 0.57–0.65 s at 4,000 and 1.9–2.3 s at 8,000. The fit gives about 3.1 s per pointer move at the 10,000-object project limit. During a job, ABORT and Ctrl+. wait behind the frame in progress.

Three more findings, raised as P3 (the refuter raised J10-P3-3 to P2):

- **J10-P3-1.** Start and Job Review still make several whole-program passes on the UI thread, and two of them break ADR-352 D7's "scan without splitting":
  - hydrating the motion manifest, 0.30 µs per line;
  - building the Job Review model, 0.26 µs per line, or 0.47 on FluidNC;
  - the store's Start, 0.45 µs per line.

  So a 2-hour, roughly 4M-line photo engrave freezes the window for about 1–2 s three times before its first byte.
- **J10-P3-2.** A Marlin Abort regex-scans the whole queued program before writing its first stop line: 132 ms at 1M lines.
- **J10-P3-3 (P2 after the refuter).** A saved `.lf2` takes about 333 bytes per imported vector point, so about 1.6M points reach V8's 536,870,888-character string limit, and Save is then refused. The raw recovery copy that the app offers instead fails the same way. Only the compact autosave keeps the work.

## Scaling table

"100 ms size" and "1 s size" are where a single UI-thread task crosses that time on this PC. They come from the measured points by a linear or quadratic fit. The extrapolations are marked "≈".

| Operation | Thread | Growth (measured points) | 100 ms size | 1 s size | Evidence |
|---|---|---|---|---|---|
| Canvas move-drag of a multi-selection, one pointer move (`apply-transform-drag.ts:65-68`) | UI | **Quadratic**: 500 → 42 ms; 1k → 86; 2k → 203; 4k → 569–649; 8k → 1,865–2,265 | ≈1.2k selected | ≈5.3k selected (10k limit ≈ 3.1 s) | REPRO `zz-j10-drag-frame` |
| Arrow nudge of all selected (`selection-transform-actions.ts:391`) | UI | **Quadratic**: 4k → 66 ms; 8k → 303; 16k → 1,210 | ≈4.6k | ≈14.6k (10k ≈ 0.47 s) | REPRO `zz-j10-design-scale` |
| Flip / rotate 90° of all selected | UI | **Quadratic**: 2k → 15–17 ms; 4k → 57; 8k → 230–255 | ≈5.3k | > limit (10k ≈ 0.36–0.40 s) | REPRO `zz-j10-drag-frame` |
| Undo / Redo after a whole-selection edit (`store-actions.ts:378`) | UI | **Quadratic**: 4k → 65–112 ms; 8k → 326–387; 16k → 1,133–1,207 | ≈4.6k | ≈14.6k (10k ≈ 0.5–0.6 s) | REPRO `zz-j10-design-scale` |
| Duplicate all selected (`duplicate-scene-selection.ts:32,45`) | UI | **Quadratic**: 4k → 158–189 ms; 8k → 815; 16k → 4,385 | ≈2.5–3k | ≈7.5–9k | REPRO `zz-j10-design-scale` |
| One single-object edit with 50 Undo steps held (`pushUndo` + `limitProjectHistory`) | UI | Linear, 0.23 µs per object (16k → 3.6 ms average) | > limit | > limit | REPRO |
| `setProject`, Select All, marquee `selectObjects` | UI | Linear, ≤ 8 ms at 16k | > limit | > limit | REPRO |
| Streaming, per acknowledged line, real store + simulator | UI (per line on both transports) | **Flat** 59–62 µs per line at 8k–64k (86 at 2k, warm-up) | n/a (per line) | n/a | REPRO `zz-j10-stream-scale` |
| Store Start `startJob` (before the first byte) | UI | Linear: 64k → 40 ms; 256k → 116; 512k → 232 | ≈220k lines | ≈2.2M lines | REPRO `zz-j10-stream-scale` |
| Job Review program scans (split tile, throughput `createStreamer`, oversized line, M7, archive bytes) | UI | Linear 0.26 µs per line on GRBL; 0.47 with the FluidNC scan (1M → 264 / 469 ms) | ≈380k (FluidNC ≈210k) | ≈3.8M (FluidNC ≈2.1M) | REPRO `zz-j10-start-scale` |
| Worker → UI hydrate of the motion manifest (`output-preparation-worker-client.ts:95-101`) | UI | Linear 0.28–0.31 µs per line (200k → 60 ms) | ≈330k | ≈3.3M | REPRO `zz-j10-start-scale` |
| Recovery archive staging after the first window (fingerprint, count, pack, clone) | UI, during the job | Linear ≈0.86 µs per line (200k → 172 ms), capped by the 64 MiB archive budget (≈450k lines) | ≈115k | Not reached (≈0.4 s at the budget, plus the size walk and the IndexedDB put, not timed) | REPRO (parts) |
| Marlin no-reset Abort: stop-line scan before the first stop byte | UI, inside Abort | Linear 0.13 µs per line (100k → 12; 400k → 38; 1M → 133 ms) | ≈750k | ≈7.5M | REPRO `zz-j10-start-scale` |
| GRBL Abort: click → reset byte on the wire | UI | Flat, 0.39–1.03 ms at 4k, 32k and 128k lines | n/a | n/a | REPRO `zz-j10-watchdog` D |
| Autosave / Save handoff on the UI thread (`packProjectMessage` + post clone) | UI | Linear: 1M points → pack 31–68 ms, post 9 ms | ≈1.5–3M points | Not reached | REPRO `zz-j10-save-scale` |
| Embedded photo strings in that post clone | UI | Linear 1.3 ms per MB (24 / 48 / 96 MB → 37 / 51 / 124 ms) | ≈75 MB | Past V8's string limit | REPRO |
| Save serialization (one pass of three: serialize, validate-parse, serialize) | Worker | Linear 0.94 µs per point; the file grows **333 B per point** | n/a (worker) | ≈1.06M points per pass | REPRO `zz-j10-save-scale` |
| Renderer memory held for a run | UI heap | Linear: queue 72 B per line; manifest hydrated 277–554 B per line (GC noise); program text ≈20 B per line | n/a | 4M lines ≈ 1.4–2.6 GB | REPRO (KNOWN, ADR-352) |
| Undo memory per step | UI heap | Single-object edit 7.8 B per object (the array copy); whole-selection edit 156 B per object (10k: 1.56 MB per step, 78 MB for 50 steps) | n/a | n/a | REPRO `zz-j10-design-scale` |

## Findings

### J10-P2-1 — A large multi-selection is moved, nudged, flipped, undone and duplicated in O(selected × objects) on the UI thread; a canvas drag of 8,000 selected objects takes about 2 s per pointer move (≈3 s at the 10,000-object project limit), and during a job Abort waits behind it

- **Where:**
  - **Drag.** `src/ui/workspace/apply-transform-drag.ts:65-68` (move), `:122` (selection scale) and `:164-166` (selection rotate) call `setObjectTransform` once per selected object on every pointer move.
    - `src/ui/state/store-actions.ts:346-347` makes each call a full store write. That write maps the whole object array (`applyTransformToScene`, `:400-408`).
    - Wiring: `use-workspace-drag.ts:331` calls `applyTransformDrag`, and `workspace-drag-deps.ts:19` passes the store action.
    - Mouse-down: `drag-state.ts:227-233` (`selectedObjectsForIds`, one `objects.find` per id), `:334-345` (`uniqueId` by `ids.indexOf`, and `moveStartTransforms`, one `objects.find` per id).
  - **Siblings with the same per-id `scene.objects.find`:**
    - `src/ui/state/selection-transform-actions.ts:391-398` (`selectedObjects`): nudge, flip, rotate 90°, rotate by, align and the other selection transforms.
    - `src/ui/state/store-actions.ts:378-392` (`visibleSelectionState`): Undo, Redo and a cancelled drag.
    - `src/ui/state/duplicate-scene-selection.ts:32` (`find` per closure id) and `:45` (`addObject` copies the array per object).
- **Anchor:**
  - **Twin.** The keyboard path applies a whole selection in one write. `applySelectionTransformsToState` (`selection-transform-actions.ts:346-374`) builds one id → transform `Map` and one new object array. The drag path makes k writes, each copying all n objects. `applySelectionScaleDrag` already filters the scene through a `Set` (`apply-transform-drag.ts:108-109`), then writes per object.
  - **Contract.**
    - ADR-352 Context (`docs/decisions/ADR-352-streaming-job-ui-cost.md:30-31`): every store write "runs every mounted selector (~150–210)". This is why ADR-352 cut extra writes per line.
    - PROJECT.md:465, non-negotiable 9 (Abort reachable "from any window state during a job"), for the in-job effect.
  - **Reach.**
    - `PROJECT_SCENE_LIMITS.objects` is 10,000 (`src/io/project/project-scene-integrity-validator.ts:4-9`). Select All selects every object (`selectAllObjects`).
    - The remote is not a route to this: phone and MCP selections are capped at 200 ids (`remote-control/selection-validation.ts:8-9`, `transforms.ts:35`).
- **Scenario:**
  1. A project holds 8,000 objects, for example an exploded DXF sheet, an array of parts, or a broken-apart import. The operator presses Ctrl+A and drags the selection on the canvas.
  2. Each pointer move makes 8,000 store writes, and each write copies the 8,000-element object array. That is about 2 s of store work per move, before React renders, snapping and the canvas repaint. The window freezes while the mouse moves.
  3. The same selection takes 0.30 s to nudge with an arrow key, 0.33–0.39 s to Undo and 0.82 s to Duplicate. Above the limit, at 16,000 (for the fit), nudge and Undo take 1.2 s and Duplicate 4.4 s.
  4. Design editing stays enabled while a job runs. If the operator drags a large selection then, the ABORT button and Ctrl+. wait for the frame in progress (≈2–3 s at 8,000–10,000 objects).
     - On the window transport (Marlin, Smoothieware, network or a port with no unique id), the refill stops for the same time and the planner drains mid-burn (KNOWN mechanism, H8 refuter).
     - On the default GRBL USB worker the stream keeps going, and the heartbeat's host-gap grace absorbs the stall (see Verified clean).
- **Evidence:** REPRO.
  - **Drag frame.** `zz-j10-drag-frame.test.ts` runs the real `transformUpdatesForMoveDrag` and the store's `setObjectTransform` for every update, with every object selected and inside `beginInteraction`. One frame, ms (150 store subscribers modelled / 0):

    | Selected objects | Frame with 150 subscribers | Frame with 0 subscribers |
    |---|---|---|
    | 500 | 38.8 / 44.7 / 42.8 | — |
    | 1,000 | 87.1 / 84.5 / 85.6 | 96.4 / 88.1 / 90.6 |
    | 2,000 | 198.7 / 209.4 / 200.7 | — |
    | 4,000 | 649.4 | 568.8 |
    | 8,000 | 1,864.6 | 2,264.8 |

    The subscriber callbacks are not the cost; the k × n array copies are. A fit of 2.64e-5·n² + 0.047·n ms gives about 3.1 s at 10,000.
  - **Store edits.** `zz-j10-design-scale.test.ts` drives the real store with 16-point closed shapes. Reading 4k → 8k → 16k:
    - nudge of all selected: 66.6 → 302.8 → 1,209.5 ms;
    - Undo: 65.1 → 386.6 → 1,207.0 ms;
    - Redo: 86.9 → 326.0 → 1,133.4 ms;
    - Duplicate: 157.6 → 815.3 → 4,385.0 ms.
  - **Flip and rotate 90°.** At 2k / 4k / 8k: flip 16.8 / 57.2 / 230.0 ms, rotate 90° 15.0 / 56.6 / 255.2 ms.
  - **Linear controls on the same project:** `selectObjects` of all ids 1.6–3.5 ms; Select All 5.7–7.9 ms; deleting all 1.8–5.8 ms; a single-object nudge with 50 Undo steps held 0.6–3.6 ms.
- **Refuter:** **CONFIRMED (own REPRO plus READ). P2 kept.**
  - **What would make it false:**
    - a batched write or an id map on the drag path;
    - frame coalescing that caps the work;
    - an edit lock while a job runs;
    - a jsdom artefact;
    - an ADR that accepts the cost.
  - **None of these holds.**
    - The cited lines are as stated. `apply-transform-drag.ts:65-68`, `:122` and `:164-166` call `setObjectTransform` once per update, and `store-actions.ts:346-347` → `applyTransformToScene` (`:400-408`) maps every object on each call.
    - Mouse-down (`drag-state.ts:227-233`, `:334-347`), `selectedObjects` (`selection-transform-actions.ts:391-398`) and `duplicateClosure` (`duplicate-scene-selection.ts:32,45`) each do one `find` per id.
    - The pointer frame queue (`use-frame-pointer-handlers.ts`) is enabled only for the node and trace-parts tools (`use-workspace-drag.ts:142-148`). It would only coalesce moves anyway; it would not shorten a frame.
    - No job-state check exists in the drag, the selection transforms, Undo or Duplicate. A grep for `isActiveJob` in `src/ui/workspace` finds only the start points and the motion overlay.
    - The cost is plain store work, with no DOM involved, so jsdom is not its source.
  - **REPRO.** `zz-j10r-drag.test.ts` runs the real store with every object selected by `selectAllObjects`, after a 200-object warm-up. Times in ms; drag frames are three runs each:

    | Selected | Drag frame, one write per object (the real path) | Same updates in one `applySelectionTransforms` write | Nudge all | Undo |
    |---|---|---|---|---|
    | 250 | 29.9–40.9 | 0.3–0.5 | 1.4 | 1.3 |
    | 1,000 | 103.9–121.1 | 0.5–0.6 | 5.1 | 6.0 |
    | 2,000 | 231.8–237.6 | 0.7–1.0 | 16.7 | 16.8 |
    | 4,000 | 687.8–726.1 | 1.8–2.8 | 68.3 | 69.1 |

    - **Fit.** The drag frame fits ≈ 0.095·n + 2.0e-5·n² ms. That gives 8k ≈ 2.0 s and 10k ≈ 2.95 s, in line with the auditor's 1.9–2.3 s and 3.1 s.
    - **Cause.** The one-write control is 250–380 times cheaper at the same size, so the per-object store write is the cause.
    - **Siblings.** Nudge and Undo grow about 4× per doubling.
    - Duplicate and flip were not re-run.
  - **Correction (minor).** A cancelled drag (Esc) does not call `visibleSelectionState`. `cancelInteraction` restores the snapshot through `restoredDragSelection` (`store-actions.ts:233-241,351-356`), which is linear. Undo and Redo do call it (`:184`, `:209`).
  - **Severity: P2, not P1 (§3 and NN9).**
    - **Abort waits.** Editing stays enabled during a job. Ctrl+. is a capture-phase `keydown` on the window (`use-job-shortcuts.ts:40-46`). Both it and the ABORT button wait for the frame in progress. A dragging operator reaches ABORT only after releasing the mouse, so the wait is the frame in progress plus at most the last coalesced move: one to two frames.
    - **The output is not wrong on the default path.** A GRBL-family USB connection streams from the ADR-354 worker by default (decision 4). The worker keeps acknowledging and refilling while the renderer is blocked (ADR-354 Consequences, `ADR-354-native-worker-background-streaming.md:59-61`). The same paragraph accepts that "new operator actions still require the renderer". The job runs as programmed, and the Abort lands when the frame ends.
    - **Delayed, not blocked.** NN9 forbids a state in which Abort cannot be reached ("No modal can block it"). The June fix for that (`job-aware-dialogs.ts:1-11`, audit H13) removed native dialogs that block until they are dismissed. This block ends with the operator's own gesture.
      - A delayed Abort is a broken contract with a clear scenario, which is P2. NN9 itself says the control is "not a safety-rated E-stop".
      - H8-P1-1 reached P1 only through the remote security clause (an edit-only client freezing every stop), not through the freeze alone.
    - **Window transport.** There the refill stops too (KNOWN, H8 refuter). The beam stays lit on a stopped head only under constant power (`M3`).
      - The default dialect is GRBL Dynamic: `M4` cuts, fills and rasters (`gcode-dialects.ts:84-104`, ADR-257), and the beam is dark when motion stops.
      - `M3` needs the opt-in GRBL Compatible dialect (`:107-121`). On Marlin and Smoothieware, the beam state at an empty buffer was not checked.
      - That effect belongs to the stall mechanism, which any long UI task during a job triggers (J10-P3-1's archive staging included), not to this finding.
    - **Coordinator note.** The H8 refuter notes document the mechanism: window transport, plus constant power, plus any renderer stall, leaves the beam lit on a stopped head. It has never been raised as its own finding. Under §3 it would be P1 by effect.
  - **Novelty.**
    - No earlier report names the drag's per-object writes or the per-id `find` (searched `docs/audits/` for these files and symbols). The 2026-07-10 sweep praised the same `beginInteraction`/`setObjectTransform` pattern, for Undo, not for cost.
    - The one open PR, #1478, touches none of these files.
- **Fix direction:**
  - Give the drag one batched store action per frame, for example `setObjectTransforms(Map)`: one `map` over the objects and one write, as `applySelectionTransformsToState` already does.
  - Replace the per-id `find`/`indexOf` lookups with an id → object `Map` or a `Set`: `selectedObjects`, `visibleSelectionState`, `selectedObjectsForIds`, `moveStartTransforms`, `uniqueId`, and `duplicateClosure` (append once).
  - Add a budget test next to `laser-workflow-budgets.test.ts`. Its "editing" phase times only `quickNest`.

### J10-P3-1 — Starting a multi-million-line job still makes several whole-program passes on the UI thread; Job Review splits the program and builds a whole second streamer, against ADR-352 D7

- **Where:**
  - **Job Review,** built on the UI thread by `modelFor` (`job-review/job-review-gate.ts:187-210`, `buildJobReviewModel`):
    - `job-review-model.ts:408-409` (`gcodeTile`: `gcode.trimEnd().split('\n').length`);
    - `stream-throughput-warnings.ts:82` and `:151-155` (`measureProgram` builds `createStreamer(gcode)` only to count lines and bytes);
    - per-line scans in `detectM7AirAssistWarnings`, `detectFluidncDivergenceWarnings` and `detectArchiveCapacityWarnings`.
  - **Hydrate:** `output-preparation-worker-client.ts:95-101` (`executionArtifactCanvasPlan` → `unpackMotionManifest`, one object per block and per point).
  - **Store Start:** `laser-job-actions.ts:124-179` (`runStartJob`: `createStreamer` and the other program scans before the first window).
  - **After the first window:** recovery archive staging, `start-job-execution-tracking.ts:162-163` → `createExecutionArtifact`.
- **Anchor:**
  - Contract: ADR-352 D7 (`docs/decisions/ADR-352-streaming-job-ui-cost.md:99-100`): "Frame readiness, Job Review and Start scan a program without splitting it".
  - Twin: `core/controllers/grbl/sendable-line-scan.ts`, already used by `start-job-readiness-policy.ts` and `laser-start-program-assertions.ts`.
- **Scenario:**
  1. A 2-hour photo engrave at 10 lines per mm over 200 mm has about 2,000 rows of about 2,000 pixel runs, so roughly 4M lines.
  2. On this PC that gives three separate UI freezes before the first byte, each extrapolated linearly:
     - hydrate ≈ 1.2 s;
     - Job Review ≈ 1.0 s, or 1.9 s on FluidNC;
     - store Start ≈ 1.8 s.
  3. Job Review also allocates a transient second queue of 72 B per line, about 290 MB.
  4. ADR-352's Chromium measurement shows browser costs are higher: the longest Start-phase task was 584–672 ms at 214,807 lines.
  5. Below about 450k lines, archive staging adds up to about 0.4 s on the UI thread after the first window, while the job runs.
- **Why P3:**
  - **The size is disclosed.** `LARGE_RASTER_PREPARATION_WARNING` (`start-job-readiness-policy.ts:188-189`) says "Preparing and streaming may take several minutes".
  - **No safety path is affected.** Every freeze happens before the first byte, except the bounded archive staging.
  - **Part is contract drift.** The split and the second streamer contradict ADR-352 D7.
- **Evidence:** REPRO in `zz-j10-start-scale.test.ts` and `zz-j10-stream-scale.simulator.test.ts`, measured at sizes up to 1M lines and extrapolated beyond.

  | Step | 200k lines | 500k | 1M | Per line |
  |---|---|---|---|---|
  | Split tile | 3.7 ms | 10.6 | 20.9 | 0.02 µs |
  | `createStreamer` (throughput) | 13.2 | 33.8 | 100.2 | 0.07–0.10 µs |
  | Oversized line | 5.6 | 10.8 | 19.7 | 0.02 µs |
  | M7 warnings | 9.8 | 26.6 | 56.2 | 0.05 µs |
  | FluidNC scan | 26.9 | 94.0 | 204.9 | 0.13–0.20 µs |
  | Archive bytes | 10.7 | — | — | 0.05 µs |
  | Hydrate | 60.4 | — | — | 0.30 µs |

  - **Store `startJob` through the simulator:** 64k → 40.3 ms, 256k → 116.2, 512k → 231.6.
  - **Archive parts at 200k:** fingerprint 13.5, count 11.7, pack 125.6, clone 19.2 ms.
- **Refuter:** **CONFIRMED (own REPRO of the two D7 passes, plus READ). P3 kept.**
  - **What would make it false:**
    - the passes already use `sendable-line-scan`;
    - Job Review is built in a worker;
    - the cost is a warm-up artefact;
    - an ADR accepts it.
  - **None of these holds.**
    - `gcodeTile` splits the program (`job-review-model.ts:408-409`, called at `:210` and `:281`).
    - `measureProgram` builds `createStreamer` (`stream-throughput-warnings.ts:82,151-155`).
    - `modelFor` builds the model on the UI thread from the live laser store (`job-review-gate.ts:187-210`).
    - At the audited SHA, ADR-352 D7 reads "Frame readiness, Job Review and Start scan a program without splitting it" (`ADR-352-streaming-job-ui-cost.md:99-100`).
  - **REPRO** (`zz-j10r-p3.test.ts`, best of three after a warm-up, at 100k / 200k / 400k lines):
    - split: 4.4 / 9.8 / 18.4 ms;
    - `createStreamer`: 10.4 / 23.2 / 46.0 ms.

    That is 0.05 and 0.11 µs per line, the same order as the auditor's 0.02 and 0.07–0.10. Hydrate, the store Start and the archive staging were not re-run.
  - **Why P3 stands.** The cost comes before the first byte and is disclosed by `LARGE_RASTER_PREPARATION_WARNING` (`start-job-readiness-policy.ts:188-189`). The only part inside the job is the archive staging (≤ ≈0.4 s), which inherits the window-transport mechanism described under J10-P2-1.
  - **Novelty.** No earlier report names `gcodeTile` or `measureProgram`.
- **Fix direction:**
  - Count lines and bytes with the sendable-line scan in `gcodeTile` and `measureProgram`, without splitting or building a queue.
  - Compute the M7, FluidNC and oversized-line facts once in the preparation worker, beside the program.
  - Keep the manifest packed and read it through the packed accessors that already exist (`packedBlock*`), instead of hydrating objects.

### J10-P3-2 — A Marlin Abort (and Disconnect) regex-scans the whole queued program before writing the first stop line: 132 ms at 1M lines

- **Where:**
  - `src/ui/state/laser-job-stop.ts:160` calls `noResetStopLines(driver(), initial)` before the cancel and before `stopWithoutReset` writes anything.
  - `laser-quick-stop.ts:30-35` and `:53-56` run `streamer.queued.some((line) => AIR_ON_RE.test(line))` over every queued line.
  - The same call sits in the disconnect safety lines (`laser-disconnect-safety.ts:43,53`) and in error-line containment (`laser-error-line.ts:240`).
- **Anchor:**
  - Contract: PROJECT.md:465, non-negotiable 9.
  - Twin: the GRBL Abort does no work proportional to the program before its reset byte (0.39–1.03 ms at 4k–128k lines, REPRO D below).
  - The scan exists only to decide whether to append `M9` ("Capture that requirement before retiring the queue", `laser-job-stop.ts:158-159`).
- **Scenario:**
  1. A Marlin laser job of 1M lines with no M7 or M8 is running, and the operator presses ABORT.
  2. M107, M410 and `M5 I` go out 132 ms later than they could. This grows at 0.13 µs per line, so about 1 s at 7.5M lines. A job with air assist stops scanning at its first M7 or M8.
- **Evidence:** REPRO, `zz-j10-start-scale.test.ts` "Marlin no-reset Abort": the real `noResetStopLines(marlinDriver, { airAssistOn: false, streamer })` takes 100k → 11.7 ms, 400k → 37.9, 1M → 132.5, and returns `["M107\n","M410\n","M5 I\n"]`.
- **Refuter:** **CONFIRMED (own REPRO). P3 kept; the time per line is corrected.**
  - **What would make it false:**
    - the scan covers only the unsent lines, so it is short late in a job;
    - it stops early;
    - the cost is an artefact.
  - **Checked.**
    - `streamer.queued` holds the whole program, read through a `queueIndex` (`streamer.ts:65,111,386-395`). So `queued.some` also scans the lines already sent, whatever the progress, and stops early only at an `M7` or `M8`.
    - `runNoResetStop` computes the stop lines before `cancelStreamer` and before the first write (`laser-job-stop.ts:160-198`).
  - **REPRO** (`zz-j10r-p3.test.ts`, the real call): it returns `["M107\n","M410\n","M5 I\n"]`.
    - At 1M lines, a mix of `X0.2S14` and `G1 X0.100 Y0.001 S7`, the first call takes 89.4 ms and the second 26.6 ms.
    - Warm, 100k / 200k / 400k lines take 2.1 / 5.3 / 9.7 ms, or 0.02–0.03 µs per line.
  - **Correction.** The finding's 0.13 µs per line is the cold first call. A real Abort is one cold call, so it is ≈ 90–130 ms at 1M lines on this PC. The "≈ 1 s at 7.5M lines" extrapolation is the cold upper bound. P3, as polish.
  - **Novelty.** Controller v3 D1 noted that `AIR_ON_RE` misses `G1 X10 M8`, which is a different symptom.
- **Fix direction:** Record "the program switches air on" once at Start (one boolean on the run, set by the scan that Start already makes), or write the fire-off line before deciding on `M9`.

### J10-P3-3 (raised to P2 by the refuter) — A saved `.lf2` takes about 333 bytes per imported vector point; about 1.6M points reach V8's maximum string length, and Save is then refused

- **Where:**
  - `src/io/project/serialize-project.ts:20-28` writes manual saves with `JSON.stringify(…, null, 2)`.
  - `:77-82` stores `curves: path.curves ?? path.polylines.map(polylineToCurveSubpath)` beside the polylines.
  - `src/io/project/prepare-project-persistence.ts:15-40` serializes, validate-parses and re-serializes in the worker: three passes, two full strings at the peak.
- **Anchor:**
  - Twin: traced images save through `compactLineGeometry` (`serialize-project.ts:55-57`), and the header comment says autosave can omit the indentation.
  - Ground truth: on Node 25.8.2 / V8 14.1.146, `buffer.constants.MAX_STRING_LENGTH` is 536,870,888 (REPRO, `node -e`). Electron 44.5.1's own V8 was not checked.
- **Scenario:**
  1. A detailed imported map or a set of exploded DXF parts reaches about 1.6M points within the 10,000-object limit, about 160 points per object.
  2. The manual-save JSON passes 536.9M characters. `JSON.stringify` throws "Invalid string length".
  3. `prepareProjectForPersistence` catches it and refuses the Save with that message. The work is not lost silently, but it cannot be saved as one file.
  4. About 500 MB of embedded photo base64 does the same (arithmetic).
  5. Below the cliff, a 1M-point project is a 333 MB file, and one serialize pass takes about 0.94 s in the worker.
- **Evidence:** REPRO for size and time, `zz-j10-save-scale.test.ts`:
  - 250k points → 83.1 MB, 217.7 ms;
  - 500k → 166.4 MB, 437.8 ms;
  - 1M → 332.7 MB, 943.8 ms.

  The cliff itself is arithmetic: 536,870,888 / 333 ≈ 1.61M. It was not run, to stay within this PC's memory.
- **Refuter:** **CONFIRMED (own REPRO of the size per point, plus the engine constant). Raised P3 → P2.**
  - **What would make it false:**
    - the 10,000-object limit (ADR-307) or an import budget stops a project short of the cliff;
    - autosave or the recovery copy saves the project anyway;
    - realistic coordinates take fewer bytes per point.
  - **The cliff is reachable.**
    - The project limit counts objects, not points (`project-scene-integrity-validator.ts:4-9`). One imported SVG is one object.
    - `validateSceneBudgets` deliberately applies no point budget (`:17-26`): "Persistence itself must not discard already-valid artwork merely because it is dense".
    - Import point thresholds are advisories, not caps: SVG 250k points (`svg-import-budget.ts:1-15`) and HPGL 250k (`hpgl-size-advisory.ts:3-10`). ADR-268 says "a size threshold may inform but never refuse" (Context, `DECISIONS.md:14027-14029`; decision 1).
    - Only DXF block expansion is refused: past a 500k-point floor, or 1 point per file byte (`dxf-expansion-budget.ts:7-14`). Plain DXF entities are not limited.
    - So one dense SVG, such as a city map, or one large DXF reaches 1.5M points in a single import.
  - **REPRO** (`zz-j10r-p3.test.ts`): the real `serializeProject` on one imported-svg object of 200-point line polylines, at 20k and 80k points. Both sizes gave identical bytes per point:

    | Coordinates | Manual `.lf2` | Compact (autosave) | Manual cliff | Compact cliff |
    |---|---|---|---|---|
    | Full double precision | 348.7 B/pt | 115.2 B/pt | 1.54M points | 4.66M points |
    | Rounded to 3 decimals | 304.2 B/pt | 70.7 B/pt | 1.76M points | 7.59M points |

    On Node 25.8.2, `buffer.constants.MAX_STRING_LENGTH` is 536,870,888 (`node -e`). The throw itself was not run, because of this PC's memory.
  - **What the user loses:**
    - Save is refused with "Invalid string length" (`prepare-project-persistence.ts:17-22`).
    - The app then offers a raw recovery copy (`project-save-action.ts:153-178`). That copy uses the same indented `serializeProject` (`project-save-preparation.ts:36-38`), so it fails too, with "Could not export a recovery copy: Invalid string length".
    - Autosave serializes compactly (`prepare-project-autosave.ts:36`). It keeps working up to ≈ 4.7M points and holds the work for crash recovery, and the in-memory project is kept.
    - So nothing is lost silently, but no file of the project can be written, and the message does not say why.
    - Twin: Open streams a project over 25 MiB so that it "never exists as one decoded string" (`document-import-source.ts:15-27,82`); Save has no such path.
  - **Severity:**
    - **Not P3.** P3 is for latent defects and polish, and this one is reachable today.
    - **Not P1.** Nothing is lost silently, and autosave keeps the work.
    - **P2, by precedent.** Rolling v2 13-P2-1 and 13-P2-2 (a project that opens and edits but cannot be saved) were rated P2. Here the fallback the app offers fails as well, with an opaque message, against ADR-268's "may inform but never refuse".
  - **Novelty.** Rolling v2 16 met "Invalid string length" for relief base64 at import, a different path, caught there.
  - **Fix direction, addendum.** The recovery copy needs the same compact or streamed writer as Save.
- **Fix direction:** Save without indentation, or with indentation only above the geometry. Do not write `curves` that were derived from the polylines. Add a size test.

## KNOWN re-observed

- **ADR-352 Consequences, "Still open"** (`ADR-352-streaming-job-ui-cost.md:161-162`): the running route is held as about 13 V8 objects per block.
  - Re-measured: building the manifest retains 289–328 B per line; the hydrated manifest 277–554 B per line (GC noise); the queued program 72 B per line.
  - At about 4M lines (a 2-hour photo engrave) that is ≈ 1.4–2.6 GB of renderer heap for the run. Peak memory at that size was not run.
- **Rolling v2 13-P3-4.** Each autosave commit and clear JSON-parses both stored snapshots on the UI thread.
  - It is still on main: `autosave-indexeddb-mutations.ts:18-29` → `autosave-record.ts:129-142`.
  - New measurement: photo-dominated snapshot JSON parses at about 0.5 ms per MB (38 / 75 / 150 MB → 16 / 37 / 79 ms, `node` script). The cost therefore matters mainly for vector-heavy projects (13's own repro: 80 MiB in 1,090 ms).
- **Rolling v2 23-P3-7 and 23-P3-8.** The image-editor session stash has no global budget, and the project Undo source budget (`undo-stack.ts:11,16`, 50 steps and 256 MiB) charges `editorDocument` only. Both are unchanged.
  - Measured on the side: Undo is capped at 50 steps, and ordinary edits share structure. A single-object step costs 7.8 B per object, a whole-selection step 156 B per object (78 MB for 50 steps at 10k objects).
- **Rolling v3 H8 refuter note, and ADR-354 Amendment 1.** On the window transport, a UI stall also stops the refill. J10-P2-1 inherits this during a job on Marlin, Smoothieware, network, or a port with no unique id.
- **Already fixed, not re-tested:** H8-P1-1 (#1465), J3-P1-1 (#1481), J6-P2-3 (#1484) and the Q4/Q5 trace speed.

## Refuted

- **"Streaming cost per line grows with job length."** The real store with the simulator costs 86 µs per line at 2k (warm-up), then 69.6 at 8k, 62.0 at 32k and 59.3 at 64k. ADR-352 Amendment 1 batches the acknowledgements of one serial chunk into one store write.
- **"The console or log grows without bound."** At every size, `log` stays at 200, `transcript` at 500 and incidents at 0 of a 500 cap (`laser-store-helpers.ts:32`, `laser-transcript.ts:8`, `laser-incident-history.ts:8`). Batched entries are rings (`laser-transcript-buffer.ts:108-115`).
- **"A 2 s UI block during streaming false-fires the heartbeat or the acknowledgement stall."** REPRO A/B: after 2.5 s, after 5 s, and after six back-to-back 2.1 s blocks each followed by only the overdue poll, there was no notice, no `\x18` and no stream hold, and the job finished.
- **"Repeated UI blocks hide a dead controller indefinitely."**
  - REPRO C: a silent controller was caught after 2.1 s with no blocks.
  - With 1, 3, 4, 6 or 10 blocks of 2.2 s it was caught after 4.3, 8.9, 11.1, 15.8 and 23.1 s.
  - The growth past three blocks only looked unbounded. REPRO E shows the observation stayed fixed (`seq 2`, `completed 197`) while several blocks fell between two 250 ms poll ticks. The cap is three graced ticks (`laser-stream-heartbeat.ts:19`), not three blocks.
  - In a browser each long task is followed by the overdue poll, so the worst case is 3 × block + 2 s.
- **"Autosave stalls a running job."** It returns early while the stream is streaming or paused (`autosave-loop.ts:95`).
- **"Undo history is unbounded."** It holds 50 steps plus a 256 MiB source budget (`undo-stack.ts:11,16`).
- **"The live route reconciliation is O(job) per status report."** The scan is bounded to `EXECUTION_WINDOW_BLOCKS` (4,096) by binary search (`live-route-reconciliation.ts:48,102-114`, ADR-352 D6).
- **"The phone or MCP can reach J10-P2-1 at scale (security)."** Remote selections are capped at 200 ids (`selection-validation.ts:8-9`, `transforms.ts:35`).
- **"Abort latency grows with job size (GRBL)."** REPRO D: 1.03 / 0.39 / 0.51 ms of CPU at 4k / 32k / 128k queued lines, 0 ms of fake time to `\x18`.

Refuter (2026-10-28):

- **No whole finding was refuted.**
- **J10-P2-1 sub-claim: "a cancelled drag" pays `visibleSelectionState`.** Refuted.
  - `cancelInteraction` restores the pre-drag snapshot through `restoredDragSelection` (`store-actions.ts:233-241,351-356`), which is linear.
  - Only Undo and Redo call `visibleSelectionState` (`:184`, `:209`).

## Verified clean

- **Job-time watchdogs** (all on the UI thread's 250 ms status poll, `laser-connection-actions.ts:81,422-460`):

  | Watchdog | Where | Deadline | Under a busy UI thread |
  |---|---|---|---|
  | Active-stream heartbeat (no status or acknowledgement while streaming or `done`) | `laser-stream-heartbeat.ts:7,13,19`; containment `laser-stream-heartbeat-containment.ts:103-135` | 2 s. A host gap of 2 s or more grants one re-query, at most 3 per unchanged observation | REPRO A, B, C, E: no false fire; detected in ≤ 3 graced ticks + 2 s |
  | Acknowledgement stall / stream hold | `laser-stream-stall.ts:18-19`; `laser-stream-hold.ts:55,63` | 10 s outside Run, 90 s in Run; containment at 90 s | The clock restarts after a host gap (`hostWasAway`, `laser-stream-stall.ts:70-72`); REPRO A showed no hold |
  | Lost-reply probe | `laser-lost-ack-reconcile.ts:69` | 2 s | READ |
  | Status-silence deadlines (polled responses) | `laser-controller-qualification.ts:242`; host-aware `laser-status-poll-schedule.ts:18-46` (ADR-356 Amd 1) | 8 s, counted only while the poll runs | READ |
  | Pause/resume transition | `laser-pause-resume-transition.ts:50,55` | 2 s, up to 30 s | READ |
  | Native worker handshake; port close; disconnect writes; reset cleanup | `worker-serial-connection.ts:55`; `serial-port-close.ts:4`; `laser-reset-ownership.ts:41`; `laser-reset-cleanup.ts:20` | 2 s; 5 s; 500 ms; 500 ms | READ |
  | Link loss | port close event | event | READ |

- **Refuter spot-check: the watchdogs under a busy UI thread. CONFIRMED for the blocks claimed.**
  - **REPRO.** `zz-j10r-heartbeat.test.ts` walks the real `detectActiveStreamHeartbeatLoss` and `detectStreamStall` through poll ticks:
    - a 2.5 s block whose overdue tick and next tick both see the old observation stays `ok`;
    - six back-to-back 1.9 s blocks, each followed by the tick and then the reply, stay `ok`.
  - **READ.** The stall clock restarts after a gap of 2 s or more (`laser-stream-stall.ts:70-72`).
  - **One edge, not raised.** The 2 s heartbeat deadline counts from the last *changed* observation, but the scheduling grace needs a 2 s gap since the last *tick* (`laser-stream-heartbeat.ts:64-73`).
    - In the pure walk, a tick that saw nothing new (`at` = T, checked at T + 250 ms) followed by a block of 1.8, 1.9 or 1.99 s gives `LOST` on the overdue tick, if that tick runs before the queued reply. A 1.7 s block does not.
    - The same blocks after a tick that did see something new stay `ok`.
    - The edge needs either a status reply more than one 250 ms tick late, or a browser that runs the overdue interval before an earlier-queued serial read. Neither was observed, and Chromium was not run.
    - The consequence would be serious: a false `LOST` quarantines and resets a healthy job (`laser-stream-heartbeat-containment.ts:103-135`). It is worth a browser check alongside J10-P2-1's in-job drag, whose frames reach this length at about 5–8k selected objects.
- **Refuter spot-check: the log caps. CONFIRMED by READ.**
  - Every append to `log`, `transcript` and `incidentHistory` ends in `slice(-MAX)` or the bounded ring: `laser-store-helpers.ts:64`, `laser-transcript.ts:58`, `laser-incident-history.ts:43` and `laser-transcript-buffer.ts:89-91,108-115`.
  - A search of `src/ui` found no unbounded spread or `push` into these arrays.

- **Memory held per streamed line** is 72 B for the queue (REPRO at 2k–512k). The checkpoint is a small record written every 25 acknowledgements (`job-checkpoint-storage.ts:18`). The serial worker decodes the transferred program one line at a time (`serial-program-buffer.ts:94-125`).
- **Autosave and Save handoff:**
  - Packing reuses buffers (pack 2–3 ms warm at 250k–500k points), and the post clone takes 1.9–8.8 ms.
  - The worker does the serialization.
  - A photo string costs 1.3 ms per MB to clone (REPRO).
- **Selection basics** are linear: `setProject`, Select All, marquee `selectObjects`, and a single-object edit with 50 steps held (REPRO).
- **Off-thread routing** for Start, Save, autosave, import and trace preparation, by READ of `canvas-preparation-policy.ts:30-47`, `project-save-size.ts:7-32` and `autosave-preparation-client.ts:22-60`.

## Not verified

- **No browser.** Canvas rendering and repaint during a drag or a job, React render cost per store write, and Chromium's task ordering after a long task (whether the overdue poll or the queued serial messages run first) were not measured. Every time here is Node; ADR-352 found Chromium 2–3× slower for this kind of work.
- **The native worker transport (ADR-354) was not run.** The window transport was used. It does the same per-line UI-thread work plus the refill, so it is the upper bound.
- **No 1–5M-line streams were run.** The store was measured to 64k lines streamed and 512k started, and the scans to 1M lines; larger sizes are linear extrapolations. Peak renderer memory at 4M lines was not run (this PC's memory).
- **Electron's renderer heap limit** and Electron 44's `MAX_STRING_LENGTH` were not checked.
- **Not timed end to end:** the whole `modelFor`, the archive's size walk and IndexedDB put, opening a 333 MB `.lf2`, and the 1.6M-point Save refusal.
- **J10-P2-1 frame times leave out** snapping (`transformDragWithSnap`), React renders and the canvas repaint, so the real cost is higher.
- **Hardware:** none was used.

## Repro files

Every file below was created in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` (or the scratchpad root) and **deleted at the end**. No repo file except this report was touched.

| File | Purpose |
|---|---|
| `src\ui\state\zz-j10-stream-scale.simulator.test.ts` | Real store + GRBL simulator: stream 2k–64k lines (cost per line, heap, log/transcript/incident sizes); `J10_START_ONLY=1` times `startJob` alone at 64k–512k |
| `src\ui\laser\zz-j10-start-scale.test.ts` | Per-line UI-thread steps of Start, Job Review, hydrate and archive at 25k–1M lines; Marlin `noResetStopLines` at 100k–1M |
| `src\ui\state\zz-j10-design-scale.test.ts` | Real store at 1k–16k objects: open, Select All, nudge, Undo/Redo, Duplicate, delete, Undo memory per step, serialize/pack/clone |
| `src\ui\workspace\zz-j10-drag-frame.test.ts` | One move-drag pointer frame at 500–8k selected objects (real `transformUpdatesForMoveDrag` + `setObjectTransform`); marquee select, flip, rotate 90° |
| `src\ui\state\zz-j10-watchdog.simulator.test.ts` | Heartbeat and stall under simulated UI blocks (A, B), silent controller with 0–10 blocks (C), observation trace (E), Abort click → `\x18` at 4k–128k (D) |
| `src\ui\state\zz-j10-save-scale.test.ts` | Autosave/Save handoff (pack + post) at 250k–1M points; photo-string clone at 24–96 MB; file size per point |
| `…\scratchpad\j10-node\zz-j10-json-parse.mjs` | `JSON.parse` cost of photo-dominated snapshot JSON (for 13-P3-4) |
| Refuter: `src\ui\workspace\zz-j10r-drag.test.ts` | One move-drag frame, per-object writes against one batched write, plus nudge and Undo, at 250–4k selected objects |
| Refuter: `src\ui\state\zz-j10r-p3.test.ts` | Split and `createStreamer` at 100k–400k lines; Marlin `noResetStopLines` cold at 1M and warm at 100k–400k; `.lf2` manual and compact bytes per point |
| Refuter: `src\ui\state\zz-j10r-heartbeat.test.ts` | A pure walk of the heartbeat and stall detectors through 1.7–2.5 s blocks |

The refuter's three files ran from `j7-main` with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=1024"`, one at a time, and were deleted afterwards. No file under `j7-main` other than these was touched.

```json
[
  {"id":"J10-P2-1","severity":"P2","area":"scale-performance","file":"src/ui/workspace/apply-transform-drag.ts","line":67,"anchor":"Twin: applySelectionTransformsToState applies a whole selection in one write via one id->transform Map (selection-transform-actions.ts:346-374), the drag writes once per selected object, each copying the object array (store-actions.ts:346-347,400-408); Contract: ADR-352 Context (every store write runs ~150-210 mounted selectors), PROJECT.md:465 non-negotiable 9 for the in-job effect; reach PROJECT_SCENE_LIMITS.objects 10,000","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j10r-drag (real store, selectAllObjects): one move-drag frame with one setObjectTransform per object 1k 104-121 ms, 2k 232-238, 4k 688-726 (fit 0.095n+2.0e-5n^2 -> 8k ~2.0 s, 10k ~2.95 s) vs 0.5-2.8 ms for the same updates in one applySelectionTransforms write; nudge 5.1/16.7/68.3 and Undo 6.0/16.8/69.1 ms at 1k/2k/4k (quadratic). No isActiveJob gate on drag/selection transforms/Undo/Duplicate; pointer frame queue only for node/trace-parts tools. P2 kept, not P1: default GRBL USB streams from the ADR-354 worker (Consequences accept that operator actions need the renderer), so the job runs as programmed and Abort/Ctrl+. (capture keydown) land after one to two frames; NN9 targets blocking modals (H13 job-aware dialogs); H8-P1-1 was P1 only via the remote security clause. Window-transport lit-beam dwell needs M3 (opt-in GRBL Compatible; default GRBL Dynamic is M4) and is the KNOWN stall mechanism, flagged to the coordinator as unraised. Sub-claim refuted: a cancelled drag restores the snapshot and does not call visibleSelectionState","known":false,"summary":"Multi-selection canvas drag (move/scale/rotate) calls setObjectTransform per selected object per pointer move, each a full store write mapping all objects; per-id scene.objects.find in selectedObjects (nudge/flip/rotate), visibleSelectionState (Undo/Redo), drag-state mouse-down and duplicateClosure. One drag frame: 1k 86 ms, 4k 0.57-0.65 s, 8k 1.9-2.3 s (fit: 10k limit ~3.1 s); nudge all 8k 303 ms, Undo 8k 0.33-0.39 s, Duplicate 8k 0.82 s (16k: 1.2 / 1.2 / 4.4 s). During a job ABORT and Ctrl+. wait for the frame; on the window transport the refill also stops"},
  {"id":"J10-P3-1","severity":"P3","area":"scale-performance","file":"src/ui/laser/job-review/stream-throughput-warnings.ts","line":152,"anchor":"Contract: ADR-352 D7 ('Frame readiness, Job Review and Start scan a program without splitting it'); Twin: sendable-line-scan.ts used by start-job-readiness-policy.ts and laser-start-program-assertions.ts; disclosed by LARGE_RASTER_PREPARATION_WARNING (start-job-readiness-policy.ts:188-189)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j10r-p3: gcodeTile split 4.4/9.8/18.4 ms and measureProgram createStreamer 10.4/23.2/46.0 ms at 100k/200k/400k lines (0.05 / 0.11 us per line); READ job-review-model.ts:408-409 (called :210,:281), stream-throughput-warnings.ts:82,151-155, job-review-gate.ts:187-210 on the UI thread; ADR-352 D7 text at the audited SHA (:99-100). Hydrate, store Start and archive staging not re-run. P3 kept: before the first byte and disclosed by LARGE_RASTER_PREPARATION_WARNING","known":"adjacent: ADR-352 Consequences measured the Start-phase longest task (584-672 ms at 214,807 lines) without listing it open","summary":"Start of a long job runs whole-program passes on the UI thread: hydrate 0.30 us/line, Job Review scans 0.26 us/line (0.47 with FluidNC; gcodeTile splits the program and measureProgram builds a whole createStreamer queue, 72 B/line transient, against ADR-352 D7), store startJob 0.45 us/line (512k: 232 ms). A ~4M-line 2-hour photo engrave: ~1.2 s + 1.0-1.9 s + 1.8 s freezes before the first byte; archive staging after the first window up to ~0.4 s (64 MiB budget)"},
  {"id":"J10-P3-2","severity":"P3","area":"scale-performance","file":"src/ui/state/laser-job-stop.ts","line":160,"anchor":"Contract: PROJECT.md:465 non-negotiable 9; Twin: GRBL Abort reaches \\x18 in 0.39-1.03 ms CPU independent of program size","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j10r-p3: real noResetStopLines(marlinDriver) returns M107/M410/M5 I; 1M lines first (cold) call 89.4 ms, second 26.6 ms; warm 100k/200k/400k 2.1/5.3/9.7 ms (0.02-0.03 us/line). streamer.queued is the whole program with a queueIndex, so the scan covers sent lines too; computed before cancelStreamer and the first write (laser-job-stop.ts:160-198). Corrected: 0.13 us/line is the cold first call, a real Abort is one cold call (~90-130 ms at 1M lines). P3 kept","known":false,"summary":"Marlin (no soft reset) Abort, disconnect safety and error containment compute noResetStopLines first, which regex-scans every queued line for M7/M8 (laser-quick-stop.ts:55) before M107/M410 are written: 100k 11.7 ms, 400k 37.9 ms, 1M 132.5 ms (0.13 us/line, ~1 s at 7.5M lines)"},
  {"id":"J10-P3-3","severity":"P2","area":"scale-performance","file":"src/io/project/serialize-project.ts","line":80,"anchor":"Twin: traced images save via compactLineGeometry (serialize-project.ts:55-57); Ground truth: Node 25.8.2/V8 14.1 buffer.constants.MAX_STRING_LENGTH = 536,870,888 (REPRO)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-j10r-p3: real serializeProject, imported-svg line geometry: manual 348.7 B/pt (full precision) / 304.2 (3 decimals) -> cliff 1.54M / 1.76M points; compact autosave 115.2 / 70.7 B/pt -> 4.66M / 7.59M; MAX_STRING_LENGTH 536,870,888 on Node 25.8.2. Reachable: the 10,000 limit counts objects (one SVG = one object), validateSceneBudgets has no point budget, SVG/HPGL point thresholds are advisories (ADR-268 decision 1, never refuse), only DXF block expansion is capped. The offered raw recovery copy uses the same indented serializer (project-save-preparation.ts:36-38) and fails too; only the compact autosave keeps the work. RAISED P3 -> P2: reachable (not latent), no file can be written, opaque message; precedent rolling v2 13-P2-1/13-P2-2; not P1 because nothing is lost silently and autosave holds the work. Cliff throw itself not run (memory)","known":false,"summary":"Manual .lf2 is 2-space JSON with curves derived from and stored beside polylines: 333 B per imported vector point (250k 83 MB, 1M 333 MB; serialize 0.94 us/point x3 passes in the worker). ~1.6M points (arithmetic) exceed V8's 536,870,888-char string limit; prepareProjectForPersistence then refuses Save with 'Invalid string length'"}
]
```
