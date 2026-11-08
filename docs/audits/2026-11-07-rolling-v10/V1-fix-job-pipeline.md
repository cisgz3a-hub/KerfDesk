# Rolling audit v10 — V1 `fix-job-pipeline`

- **When:** 2026-11-07/08   **Tree:** origin/main @ `5f09e1110` (repro tree `j10-main`, checked identical to `5f09e1110` for every cited file); 1.0.29 side exported from `df2279e26`
- **Scope:** #1575 (ADR-598 Amd 4), #1574 (ADR-337 Amd 1), #1572 (ADR-244 Amd 3), #1576 (ADR-244 Amd 3 correction), #1562 and #1565 (ADR-244 Amd 1/2), #1585 (ADR-255 Amd 3). Original findings S1-P2-2, S4-P2-1 (P3), S4-P2-2, S4-P2-3 (P1), S3-P2-3, S4-P3-3.
- **Lenses run:** L10, L6, L4, L12. L12 from CI history only: free memory stayed at 1.1–2.1 GB, so no e2e or browser run was allowed (rule: 3 GB).
- **Counts:** 3 raised → 0 refuted → P1 0 / P2 0 / P3 3 (+ 2 KNOWN residuals, not counted)

## Headline

No burn-safety defect found. On fixed inputs, G-code is byte-identical between 1.0.29 and main, with headers included. That holds on the direct compile and on the worker's pack/unpack route, for ten projects (the 200- and 50-object mixes and eight golden projects). The new motion-block columns match 1.0.29's object parser field for field (`Object.is`) over 6,000 fuzzed programs (107k blocks), both straight from the parser and after pack → transfer → unpack. Fingerprint, sendable-line count, the oversized-line shortcut and all eight changed preflight scanners also match 1.0.29 on 8,000 fuzzed programs. The ETA is exactly unchanged except where ADR-255 Amd 3 says it should change (GRBL 1.1 and grblHAL with laser mode on). The archive's longest work step is ≤ 5.5 ms at 400k lines (Node). The three P3s are a residual that grows with job size and two places where an ADR and the code disagree.

## Findings

### V1-P3-1 — After the first line, the one IndexedDB `add` that still runs as a single task grows with the archive, and #1572 now archives raster jobs up to ~1.4 M lines
- **Where:** `src/ui/state/recovery/indexeddb-recovery-backend.ts:119` (`store.add(record)`, structured clone of the whole record on the window), reached from `src/ui/state/recovery/recovery-artifact-store.ts:79` after `src/ui/laser/start-job-transmission.ts:104` (`archiveAcceptedFreshRun`, after `startJob` resolved). The cap is `src/ui/state/recovery/execution-artifact-size.ts:3` (64 MB).
- **Anchor:** Contract.
  - AREAS of performance audit S1: 50 ms is the running-job budget for the longest UI task, and S4-P2-3 was raised to P1 for blocks like this.
  - ADR-337 Amendment 1, "What still runs in one task", says: "IndexedDB's structured clone of the finished record runs inside `add` and cannot be split". It gives that task as 50–61 ms on the measured jobs (up to the 507k-line photo).
  - ADR-244 Amendment 3, Consequences: "raster jobs up to about 1.4 million lines now keep a recovery copy, against about 490,000 before".
- **Scenario:** A user Starts a 0.5–1.4 M-line raster job (for example, a photo of roughly 150–170 mm at 10 lines/mm), which 1.0.29 did not archive. After the first line, the record of about 50–64 MB is cloned in one task. An Abort pressed during that task waits for it.
- **Evidence:** REPRO, Node proxy only; no browser run.
  - `zz-v1/time-archive.mjs` stages the real `stageFreshExecutionArtifact` against `MemoryRecoveryStorageBackend`, which does the same structured clone in `putArtifact`.
  - Record clone time: 3.1 ms on the 52k-line golden photo, 18 ms on a 400k-line raster, 26 ms on a 375k-line program, and **48.8 ms on a 1.0 M-line raster**. Linear extrapolation to the 64 MB cap gives about 65–70 ms.
  - Every sliced step stayed ≤ 5.5 ms, so the clone is the only task left over budget.
  - Chrome's IndexedDB serialization was not measured.
- **Severity:** P3.
  - The block is at most about 1.4× the 50 ms budget (proxy). It happens once per Start.
  - It is not a regression: on these jobs 1.0.29 blocked 260–620 ms in one archive task (S4-P2-3).
  - If a browser measure shows ≥ 100 ms on a ~1.4 M-line raster, re-rate it against S4-P2-3's P1 precedent.
- **Novelty:** Partly KNOWN. ADR-337 Amd 1 names the `add` task as a follow-up, but measured it only up to 507k lines. That it grows with size, and that #1572 widened which jobs reach it, is new.
- **Refuter:** PENDING
- **Fix direction:** Measure the `add` in Chrome on a 1.0–1.4 M-line raster. If it exceeds 50 ms, store the record's large columns and program as separate IndexedDB values written in their own tasks, or as Blobs. That is a stored-shape change, so it needs its own ADR amendment.

### V1-P3-2 — ADR-598 Amd 4 says ordinary jobs fall back to the window "without a worker", but only a missing `Worker` global falls back; a worker that fails to start now makes Frame, Start and Save refuse jobs 1.0.29 prepared on the window
- **Where:**
  - `src/ui/workspace/canvas-preparation-policy.ts:139`, `:148-150`: `windowCanStartWorkers()` tests only `typeof Worker !== 'undefined'`.
  - `src/ui/laser/output-preparation-worker-client.ts:215-216` (`runWorker` returns null when `ensureWorker()` does) and `:273-298` (a construction throw gives null; a load error goes to `onerror` and rejects with the infrastructure error).
  - Callers: `src/ui/laser/start-job-source.ts:187-188` refuses with `BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE`, and `src/ui/app/save-gcode-emission.ts:64-67` and `:144-146` fail the Save.
- **Anchor:** Contract. ADR-598 Amendment 4, item 1 (`docs/decisions/ADR-598-performance-worker-and-cache-budgets.md:177`): "Without one those jobs prepare on the window as before."
- **Scenario:** A window has a `Worker` global but cannot construct or load the output-preparation module worker, for example because of a policy that blocks worker scripts or resource exhaustion. A job of 2,000–20,000 work units then fails Frame, Start and Save with "Background compilation is unavailable…" or the worker error. 1.0.29 compiled the same job on the window. The refusal is truthful, so there is no burn risk.
- **Evidence:** READ.
- **Severity:** P3. The conditions are unusual, the message is accurate, and nothing reaches the controller. This is a contract drift with a clear failure path.
- **Novelty:** New. No prior audit or open PR touches these files.
- **Refuter:** PENDING
- **Fix direction:** Either fall back to the direct path when `prepare*OffThread` returns null for a job that is not `costlyCanvasPreparation`, or narrow the ADR sentence to "where the window has no Worker".

### V1-P3-3 — ADR-255 Amd 3 says the blended-rapid ETA follows `$32=1` "which the app reads at connect", but the code follows the profile's expected laser-mode flag
- **Where:**
  - `src/core/gcode-time/program-timing-options.ts:100-110`: `deviceRunsRapidsAsLaserMotion` reads `device.laserModeEnabled`. That is the profile's "Expected on" checkbox (`src/ui/laser/DeviceProfilePowerFields.tsx:79-80`), not `controllerSettings.laserModeEnabled`.
  - Used at `:79`. It feeds the ETA (`src/core/job/estimate-duration.ts:81`), the live countdown (`src/ui/state/canvas-job-timing-plan.ts:78`) and the Inspector.
- **Anchor:** Contract. ADR-255 Amendment 3, Decision 1 (`docs/decisions/ADR-255-amendment-3-grbl-laser-mode-blends-rapids-into-feed-moves.md:33-34`): "a device with `laserModeEnabled` (`$32=1`, which the app reads at connect since #1567)".
- **Scenario:** The profile expects laser mode, but the connected GRBL reports `$32=0`. The badge and the Inspector show the shorter blended time, for a controller that stops at each rapid/feed junction and syncs on S changes.
  - Start of a laser job is refused in this state (`src/core/preflight/controller-readiness.ts:277-278`, `laser-mode-disabled`), so no burn is affected.
  - While designing with no controller, using the profile is the only option, and that is reasonable.
- **Evidence:**
  - READ.
  - REPRO showing that the rule switches on the profile flag only: `zz-v1/cmp-eta.mjs`. Mix-200 gives 11,100.933 s (1.0.29), 6,695.475 s on main with the profile flag on, and 11,100.933 s with it off.
- **Severity:** P3 (doc drift). The estimate only, and only in a state where Start is refused.
- **Novelty:** New. The S4-P3-3 refuter asked for the rule to "follow the controller's laser-mode state", and the ADR claims it does.
- **Refuter:** PENDING
- **Fix direction:** When connected, use the reported `$32` if it is known, or correct the ADR sentence to name the profile's expected value.

## Refuted

Candidates this auditor raised and then disproved:
- **Worker transfer detaching window-side manifests.** All window → worker posts copy (`packProjectMessage` → `copyPackedGeometryForTransfer`; second-pass and recovery-preview clients post without a transfer list). Only worker → window transfers move buffers, and the output-preparation and second-pass workers hold no preparation caches that read them again.
- **`start-preparation-wire` re-attaching the wrong scene objects.** Pack/unpack keeps object order (`packed-project-transfer.ts:104,124`). On mix-600 and mix-2000, unpacked projects are `isDeepStrictEqual` to the originals (key order differs) and compile to identical G-code.
- **Columns breaking a consumer that indexes `blocks[i]` or uses array methods.** None was found in non-test source.
- **Frame-first gate measuring different bounds after #1572.** `preparedStartFrameBounds` reads `buildPreparedJobMetrics`' `frameMotionBounds ?? frameJobBounds`, which comes from the same `computeFrameJob*Bounds(machineSpaceJob(...))` as the old `preparedFrameBounds`.
- **Save reuse returning stale G-code.** The key covers options (placement, power scale, metadata), scope, machine, controller settings and WCS. Time-bound saves skip the cache, and a Project change drops it. No other global input to `prepareOutputSnapshot` was found.
- **Sliced archive activating an aborted, finished or superseded run.**
  - `observeFreshExecutionRetention` marks a run superseded when another run becomes active.
  - It records the terminal state, and `activateAcceptedFreshRun` checks `retention.current()` before and after activation (`start-job-execution-tracking.ts:196-220`).
  - Abort is never gated by the archive.
- **#1585 changing anything but displayed time.** `jobTimingPlan` feeds the live canvas countdown only. The planner backlog and watchdogs do not read timing (`checkpoint-interruption.ts:140-151`).

## Verified clean

**L10 per fix:**
- **#1572 / S4-P2-2, S3-P2-3 (emission).**
  - Manifest memory on a 500k-line raster: 288 → **37 bytes a line** (`zz-v1/mem-manifest.mjs`).
  - The columns parser equals 1.0.29's parser on 6,000 fuzzed programs: CR/CRLF, G20/G91, arcs I/J/R, Z, N-words, M2/M30 parks, Smoothieware M221, fan M106/M107, and CNC (`zz-v1/diff-manifest.mjs`, `diff-pack.mjs`, 0 failures).
  - `fingerprintGcode`, `countSendableLines` and `findOversizedLine` with the `longestSendableSpan` shortcut equal 1.0.29's at limits 1–128.
  - The preflight scanners equal 1.0.29's on 8,000 programs (`diff-preflight.mjs`): laser-on travel, out-of-bounds, feed, blank feed, no-go zones, rotary wrap, relative envelope and Y span.
  - #1576's fix for the second-pass worker is the only post-message manifest path that was missed. The recovery-preview worker already validates a packed manifest.
  - The bed photo's Frame was not re-run in a browser.
- **#1575 / S1-P2-2, S4-P2-1.**
  - Routing (`outputPreparationWorkReaches`, 2,000 units, outlines plus fills) matches ADR-598 Amd 4.
  - The wire's cancel is checked between slices, and an `AbortError` becomes the stale-preparation message when inputs changed (`start-job-source.ts:191-197`).
  - Program facts are keyed by preparation object. The final Start assertion keeps the full oversized-line scan (`laser-start-program-assertions.ts:69`); only the Review advisory uses the shortcut.
  - G-code is byte-identical on the direct and packed routes against 1.0.29 (`zz-v1/cmp-gcode.mjs`, headers included):
    - mix-50 `b35a57cb…`, mix-200 `0591e9e2…`;
    - golden 1.0.29 fill-pool, photo-recipe, placed-tabs, cnc-bowtie-pocket and cnc-flat-drill;
    - 1.0.27-cnc.
- **#1574 / S4-P2-3.**
  - `stageFreshExecutionArtifact` through a stepping runner stores the archive at 52k, 62k, 388k, 400k and 1.0 M lines. The longest step is 1.2–5.5 ms (`zz-v1/time-archive.mjs`).
  - The UTF-8 slicer never splits a surrogate pair (`execution-provenance.ts:286-290`).
  - Node cannot measure the cooperative runner's task gaps: Node drains `MessagePort` messages in one batch, which starved the `setImmediate` probe. The Abort latency is therefore browser-only and not verified here.
- **#1562/#1565 / S3-P2-3 (estimate) and #1585 / S4-P3-3.**
  - ETA old against main (`zz-v1/cmp-eta.mjs`) is **exactly equal** for GRBL with laser mode off, Marlin and FluidNC, and for both golden CNC projects.
  - Only GRBL 1.1 and grblHAL with laser mode on change: mix-200 −39.69 % (matching P3-SWEEP's −39.7 %), fill-pool −3.14 %, photo −2.21 %, tabs −1.53 %.
  - ETA, live countdown and Inspector use the same `deviceProgramTimingOptions` rule (twin consistent).
- **ADR text against code:** ADR-598 Amd 4 (except V1-P3-2), ADR-337 Amd 1, ADR-244 Amd 3 (including the 1.4 M-line archive side effect) and ADR-255 Amd 3 (except V1-P3-3) match the code.

**L6 and L4 (READ):**
- Worker error, crash or termination rejects all pending work with a named failure and no motion.
- Abort, disconnect, Pause/Resume, or a second Start during the sliced archive leave the archive to the retention and supersede checks.
- A second Start during preparation is held by the permit claim (`start-job-flow.ts:146-152`).
- Edits during the now-asynchronous ordinary-job preparation are caught by `ownCurrentStartPreparation`, which observes project, print-cut, experimental and controller stores.

**L12 (CI history):** Browser smoke on main was red at `ede14589b` (#1572) and `f2f2f09aa` (#1575):
- `second-pass-replay.spec.ts:18` and `production-workflows.spec.ts:1129` were fixed by #1576.
- `workspace-large-raster.e2e.ts:19` (hover redraws 1, expected 0) is the timing flake addressed by #1600 (`e2e/fixtures/workspace-responsiveness.ts`). It is KNOWN.

Browser smoke, CI and the desktop package check were green on main at `45cbf63f9` (after #1576) and at `31562b5db` (#1585). None of the V1 PRs merged during the 2026-11-05 Actions outage.

**KNOWN residuals (not counted):**
- S1-P2-2's first Frame after an edit at 375k lines still computes the execution signature on the window (0.2–0.3 s; ADR-598 Amd 4 Limits).
- Start → Job Review shows no progress text. The blocks are now under the 200 ms budget, so the finding's anchor is met.

**Regression tests:** On main, these pass (Vitest, 12 tests):
- `start-preparation-wire.test.ts`
- `start-job-archive-slices.test.ts`
- `junction-laser-mode.test.ts`

On the pre-fix commit they cannot pass. The modules or step APIs are absent, and the junction rule they assert did not exist (READ).

## Not verified

- **No browser or e2e runs.** Free memory was 1.1–2.1 GB throughout, below the 3 GB floor. Not re-measured:
  - Abort latency after the first line (S4-P2-3's repro);
  - the bed photo's Frame and Start memory (S4-P2-2);
  - Start → Review blocks at 375k lines (S1-P2-2);
  - Chrome's IndexedDB `add` time (V1-P3-1);
  - the full related e2e specs (L12 relies on CI history above).
- **Vitest rule breach.** The one Vitest run (3 files) started when free memory was 1.13 GB, below the 1.5 GB rule; the pre-run check was read after launch. It completed without incident. No further Vitest was run. `output-preparation-routing.test.ts`, `save-emission-reuse.test.ts`, `motion-block-columns.test.ts` and `second-pass-worker-handoff.test.ts` were not run locally.
- **Golden coverage gaps.** Text-bearing golden projects (`1.0.29-unaffected` and the frames sets) were not compiled: no fonts in the Node bundle. V2 covers them.
- **Worker G-code route.** The Start G-code on the worker route was checked through `unpackProjectMessage(packProjectMessage())` and the same emitter. The real `output-preparation-worker` module was not run.
- **Marlin and network-serial transports** were not exercised. The archive path is shared code (READ).

Repro scripts and outputs: `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v1\` (`diff-manifest.mjs`, `diff-pack.mjs`, `diff-preflight.mjs`, `cmp-gcode.mjs`, `cmp-pack.mjs`, `cmp-eta.mjs`, `time-archive.mjs`, `mem-manifest.mjs`, `out/*.gcode`).

```json
[
  {"id":"V1-P3-1","severity":"P3","area":"V1 fix-job-pipeline","file":"src/ui/state/recovery/indexeddb-recovery-backend.ts","line":119,"anchor":"Contract: perf S1 AREAS 50 ms running-job budget; ADR-337 Amd 1 'What still runs in one task'; ADR-244 Amd 3 archive side effect","evidence":"REPRO (Node proxy: record clone 48.8 ms at 1.0 M raster lines)","verdict":"PENDING","known":"partly (ADR-337 Amd 1 follow-up; scale new)","summary":"The single IndexedDB add after the first line grows with the archive; #1572 now archives raster jobs up to ~1.4 M lines, proxy ~50-70 ms against the 50 ms budget"},
  {"id":"V1-P3-2","severity":"P3","area":"V1 fix-job-pipeline","file":"src/ui/workspace/canvas-preparation-policy.ts","line":148,"anchor":"Contract: ADR-598 Amd 4 item 1 'Without one those jobs prepare on the window as before'","evidence":"READ","verdict":"PENDING","known":"new","summary":"Only a missing Worker global falls back to the window; a worker that fails to start makes Frame/Start/Save refuse 2k-20k-unit jobs 1.0.29 prepared on the window"},
  {"id":"V1-P3-3","severity":"P3","area":"V1 fix-job-pipeline","file":"src/core/gcode-time/program-timing-options.ts","line":100,"anchor":"Contract: ADR-255 Amd 3 Decision 1 '$32=1, which the app reads at connect'","evidence":"READ + REPRO (cmp-eta.mjs)","verdict":"PENDING","known":"new","summary":"Blended-rapid ETA follows the profile's expected laser-mode flag, not the controller's reported $32; Start is refused when they disagree, so estimate only"}
]
```

## Refuter (2026-11-08)

Fresh context. Tree `j10-main` (checked identical to `5f09e1110` for every file cited below); 1.0.29 side is the auditor's `zz-v1/old` export (checked identical to `df2279e26` for `emit-gcode.ts`, `motion-manifest.ts` and `execution-artifact.ts`). Scripts and output: `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v1r\`.

**Memory gate.** Free memory was read 11 times over about 100 minutes (906, 945, 1,621, 1,280, 1,494, 1,493, 1,424, 1,584, 1,676, 1,659 and 1,760 MB). It never reached the 3 GB that a browser run needs, so nothing ran in Chrome. All timings below are from Node 25, with production-mode esbuild bundles of the real modules. One Vitest run started at 1,659 MB free.

### Verdicts

**V1-P3-1: CONFIRMED at P3, with the proxy corrected. The browser figure is still owed.**
- The mechanism is confirmed: `indexeddb-recovery-backend.ts:119` (`store.add(record)`) serializes the whole record in one task. It is reached from `recovery-artifact-store.ts:79`.
- **The auditor's proxy understates the record and overstates the work.**
  - `zz-v1/time-archive.mjs` stages an empty project with `job: { groups: [] }`. The real record carries the prepared project and the compiled job (`prepared` in `execution-artifact.ts`).
  - It also times `structuredClone`, which serializes and then deserializes. IndexedDB's `add` only serializes.
- I built the record from real compiled jobs (`zz-v1r/real-record.mjs`, which stages through `stageFreshExecutionArtifact` and captures the record handed to `putArtifact`). Times are three warm runs after `gc()`:

  | Job | Lines | Record (est.) | `v8.serialize` | `structuredClone` |
  |---|---|---|---|---|
  | Grayscale photo, 60 mm, random luma | 301,160 | 17.6 MB | 8.2–8.3 ms | 12.1–12.2 ms |
  | Grayscale photo, 100 mm, random luma | 838,376 | 49.0 MB | **30.3–30.5 ms** | 46.9–48.8 ms |
  | `everydayMixedDesign(200)` | 53,992 | 10.2 MB | 8.8–9.0 ms (1.5–1.6 without `prepared`) | 25.0–26.2 ms |
  | `everydayMixedDesign(1400)` | 163,112 | 32.8 MB | 28.2–29.6 ms (5.0–5.6 without `prepared`) | 79.4–86.9 ms |

  A 150 mm photo (1.88 M lines) is over the 64 MB budget and is not archived.
- **For raster jobs the scale claim does not reach the re-rate line.** Linear from 30 ms at 49 MB, the serializer costs about 40 ms at the 64 MB cap. That is under 50 ms, and far from 100 ms.
- **Object-heavy fill jobs are the open risk.** The serializer's cost there is mostly the prepared project and job, not the program. ADR-337 Amd 1's own Chrome profile (`ADR-337-amendment-1-accepted-run-archive-in-slices.md:87-90`) gives 50–73 ms for this `add` on the 200-object mix, about 6–8 × Node's `v8.serialize` of the same shape.
  - From mix-200 to mix-1400 the `prepared` share grows about 3× in Node (7.4 → 23 ms), so the Chrome `add` on mix-1400 *may* reach 150–200 ms.
  - That is an extrapolation, not a measurement.
- **Rating.** It stays P3 until a browser measure exists. If Chrome shows 100 ms or more on mix-1400 or the 375k Fill, re-rate it to the S4-P2-3 P1 class, as the brief says. The fix direction should name object-heavy fill jobs, not only large rasters.
- **Novelty:** partly KNOWN, as the auditor says.

**V1-P3-2: CONFIRMED at P3.**
- **Reach.** The `null` branch (`output-preparation-worker-client.ts:215-216`, then `start-job-source.ts:187-188`) is practically unreachable:
  - `ordinaryOutputPrefersWorker` already returns false when `Worker` is undefined (`canvas-preparation-policy.ts:139,148-150`);
  - a same-origin module-worker URL does not throw on construction in Chromium or Electron, and Electron's CSP allows `worker-src 'self' data: blob:` (`electron/main.ts:201`).
- **What a user can really hit** is a worker that is constructed but fails to *load*. Then `onerror` (`output-preparation-worker-client.ts:285-290`) rejects with "Background output preparation worker errored." This has happened in production before: the repo documents cached worker scripts without COEP that failed to load ("Trace worker errored"), in `vite.config.ts:282-291`.
- **What the user sees.** Frame is the first step that prepares (Start needs a completed Frame). Through `framed-start-preparation.ts:72-73` → `reportFrameRefusal` (`frame-dispatch-support.ts:138-146`), Frame shows an error toast and a Start blocker with that text. Nothing reaches the controller. The same 2k–20k-unit job also fails Preview, the estimate and Save, where 1.0.29 compiled it on the window. Preview already fails in that state for 20k+ jobs and for tracing, so the user meets one more symptom of a broken deployment, not a new silent failure.
- **Rating.** The contract drift is real. The trigger is a deployment or environment fault, and the message is truthful, so P3 stands. If the coordinator reads "a broken contract with a clear failure scenario" (METHOD §3 P2) strictly, the only concrete trigger is a COEP or stale-chunk worker load failure. I do not think that is an ordinary user's path.

**V1-P3-3: CONFIRMED at P3 (doc drift).**
- `deviceRunsRapidsAsLaserMotion` reads `device.laserModeEnabled` (`program-timing-options.ts:100-110`).
- The only writer in the UI is the profile checkbox (`DeviceProfilePowerFields.tsx:80`).
- `profileWithControllerFacts` (`core/devices/profile-application.ts`), which would merge the controller's reported `laserModeEnabled` into the profile, has no caller outside `core/devices`, so connecting never syncs it.
- Start refuses a laser job when the controller reports `$32=0` (`controller-readiness.ts:277-278`). So only the estimate is wrong, as the auditor says.
- The ADR sentence (ADR-255 Amendment 3, Decision 1, lines 33-34: "which the app reads at connect since #1567") describes code that does not exist.

### New finding

#### V1-P1-1 (found by refuter): after the first line, activating the archived run validates the new archive in one synchronous pass, a 110–156 ms block on 0.84–1.0 M-line jobs and over 50 ms at 375k lines
- **Where** (`5f09e1110`):
  - `start-job-transmission.ts:104` → `:198` `activateAcceptedFreshRun` → `start-job-execution-tracking.ts:200-201` `repository.activateFreshRun`.
  - That calls `recovery-repository.ts:183-190` → `recovery-activation-coordinator.ts:35-50`, which passes the staged record as `additionalArtifacts` → `mutateAndRefresh` → `refreshAfterMutation` (`recovery-repository.ts:412,424-431`).
  - Then `recovery-snapshot-coordinator.ts:81-82` → `recovery-snapshot.ts:79-81` `knownArtifactCanHydrate` → `:104-107` → `isValidatedExecutionArtifact` (`:119-126`).
  - The new artifact's identity is not yet in `validatedExecutionArtifacts`, so this runs `isExecutionArtifact` (`execution-artifact.ts:305-306`, `runWorkSteps`). That fingerprints the whole program, validates the packed manifest's columns point by point and counts sendable lines, all in one synchronous drain on the window.
- **Anchor:** Contract.
  - Performance audit S1 AREAS: 50 ms is the longest UI block while a job runs, and P1 is "a UI block that delays Abort … while a job runs".
  - ADR-337 Amendment 1, Decision 1–2: every whole-program pass "on this path" is stepped and drained by the cooperative runner. Its "What still runs in one task" names only IndexedDB's `add` and the CNC event manifest.
  - S4-P2-3, which the coordinator raised to P1, set the fix's budget at "no long task over 50 ms from the first line on, for the 100 mm photo and the 375k Fill".
- **Scenario:** A user Starts a large raster or Fill job and sees the head start in the wrong place. Right after the first line, the window runs this pass. An Abort, Pause or status update waits behind it. On the USB window route the streamer waits too.
- **Evidence:** REPRO.
  1. **One synchronous drain, located.** `zz-v1r/activate-block.mjs` uses a bundle whose `work-steps` module is swapped for an instrumented copy that counts how many checkpoints each `runWorkSteps` call crosses. The script stages the archive through a runner that yields every 8 ms (every stage drain crosses 0 checkpoints, longest step ≤ 3.6 ms), then calls the real `activateAcceptedFreshRun` against `RecoveryRepository` + `MemoryRecoveryStorageBackend`. Exactly one drain crosses checkpoints, with the stack `isExecutionArtifact ← isValidatedExecutionArtifact ← isValidatedRecoveryArtifact ← knownArtifactCanHydrate ← artifactMap ← hydrateRecoveryState ← RecoverySnapshotCoordinator.refresh`:

     | Program (`zz-v1/program-gen.mjs`) | Lines | Drain (checkpoints, ms) | Activation total | `isExecutionArtifact`, fresh identity |
     |---|---|---|---|---|
     | Test program, 20k moves | 20,693 | 17, 5.1 ms | 14.0 ms | 6.8 ms |
     | 1.0.29 golden photo | 52,363 | 23, 8.3 ms | 17.7 ms | 11.4 ms |
     | Test program, 375k moves | 387,853 | 367, **68.0 ms** | 77.2 ms | 85.1 ms |
     | Raster, 375 rows | 375,381 | 258, **53.1–59.1 ms** (2 runs) | 61.3–67.7 ms | 59.6–66.0 ms |
     | Raster, 1,000 rows | 1,001,006 | 695, **139.3 ms** | 149.4 ms | 156.3 ms |

     The 1.4 M-row raster was over budget, so it was not staged and not activated.
  2. **Real compiled jobs** (`zz-v1r/real-record.mjs`), `isExecutionArtifact` on a fresh identity, three runs:
     - 100 mm grayscale photo, 838k lines: **110–132 ms**;
     - 60 mm photo, 301k lines: 36–41 ms;
     - mix-1400 (163k lines): 36–39 ms;
     - mix-200: 10–11 ms.
  3. **Test gap.** `start-job-archive-slices.test.ts:244-276`, the guard that "no synchronous drain crosses a single checkpoint", covers `stageFreshExecutionArtifact` and `untrackedLaserRunRecord` but never activation, so this pass is outside it.
- **Why Node is a fair proxy here:** the work is pure JS string scanning, hashing and typed-array walks on the same V8. That is unlike the IndexedDB serializer in V1-P3-1. A Chrome measure is still owed.
- **Severity: P1 (proposed).**
  - The block is 110–156 ms after the first line on 0.84–1.0 M-line raster jobs, over the brief's 100 ms re-rate line. It is 53–85 ms at 375k lines, which misses the S4-P2-3 fix's own 50 ms acceptance budget.
  - It is the same class as S4-P2-3 (P1): a UI block that delays Abort while a job runs.
  - It is not a regression in size: 1.0.29 ran this inside its 260–620 ms block. But it leaves the ledgered P1 only partly fixed, and #1572 now archives, and therefore activates, rasters between about 490k and about 1.2 M lines that 1.0.29 never activated.
  - The coordinator should re-verify in Chrome before ledgering. If Chrome lands under 100 ms on ordinary jobs, rate it P2 (over 50 ms at 375k, a broken ADR-337 Amd 1 contract with a clear scenario).
- **Novelty:** New. ADR-337 Amd 1 attributes every long task left after the first line to the IndexedDB `add`. No open PR touches `recovery-snapshot.ts` or the activation coordinator (open PR list checked 2026-11-08).
- **Fix direction:** mark the staged artifact as validated once `artifactMayStage` (`recovery-artifact-store.ts:155-164`) has validated it through the runner. That is the same identity the refresh receives. The alternative is to let the refresh accept a pre-validated record. Then extend the archive-slices guard test through `activateAcceptedFreshRun`. Byte-identical: no stored bytes change.

### Challenges to "Verified clean"

- **"Abort is never gated by the archive".** This is true of the control flow, but Abort's latency is gated by V1-P1-1's unsliced drain and by the `add` (V1-P3-1). "Every sliced step stayed ≤ 5.5 ms, so the clone is the only task left over budget" is wrong: `time-archive.mjs` times `stageFreshExecutionArtifact` only and never runs activation.
- **The regression tests "cannot pass on the pre-fix commit".** Granted, but they do not cover activation, which is why V1-P1-1 survived #1574.
- **G-code byte identity: CONFIRMED on 22 inputs the auditor did not use** (`zz-v1r/cmp-variants.mjs`, 1.0.29 bundle against main bundle, real bundled fonts loaded from disk, raw output including headers). All 22 were SAME:
  - **Text goldens:** 1.0.27-text-frames (three variants), 1.0.28-fresh-frames, 1.0.29-line-rule-frames, 1.0.29-repaired-frames, 1.0.29-unaffected (45,486 lines, variable text), 1.0.28-unaffected, 1.0.27-unaffected, 1.0.27-whole-job (two variants).
  - **CNC:** 1.0.28-cnc-bowtie-absolute, -pocket and -flat-drill.
  - **Photo variants:** 4× scale grayscale (229,739 lines); Floyd unidirectional rotated 30°; Stucki negative at 20 l/mm (206,603 lines); threshold on Marlin; Jarvis on grblHAL.
  - **Fill and tabs:** fill-pool crosshatch at 45° unidirectional; fill spacing 0.05 with overscan 0 on Smoothieware; placed-tabs with 3 passes and kerf 0.1.
  - The auditor's own `out/*.old/new.gcode` pairs also compare equal byte for byte (`cmp`). Their two "unaffected" files were empty: those projects were refused for variable text, which is closed above.
- **Abort or Pause during the sliced Start handoff (#1575).** The handoff and the 24 ms fill-rebuild slices run before `startJob`, so there is no stream, beam or motion to stop. The owner's signal (`start-preparation-owner.ts:42-75`) cancels between slices (`start-preparation-wire.ts:125,274`). Clean.
- **Abort or Pause during the archive slices (#1574).** Between 8 ms slices the `MessageChannel` runner gives way to input, so Abort is prompt *except* behind the two unsliced tasks above. Retention and supersede checks (`start-job-execution-tracking.ts:196-220`) settle a run that ended first. Clean apart from V1-P1-1 and V1-P3-1.
- **Worker crash or termination mid-preparation.** `onerror`/`onmessageerror` → `rejectAllPendingAndRetireWorker` (`output-preparation-worker-client.ts:285-298`) rejects every pending request with a named infrastructure failure, and the next request builds a fresh worker. In Chromium a worker out-of-memory takes down the renderer, so it cannot silently hang. Clean (READ).
- **Stale program after an edit during preparation.** Agreed with the auditor (`start-preparation-owner.ts`, Job Review's Confirm compares bytes). Nothing new.
- **Now-verified items from "Not verified".** Vitest on `j10-main`: `output-preparation-routing`, `save-emission-reuse`, `motion-block-columns`, `second-pass-worker-handoff`, `start-preparation-wire` and `start-job-archive-slices`: **6 files, 55 tests passed** (`zz-v1r/vitest-run.txt`). Text-bearing goldens are now compiled (above).
- **Still not verified:** any browser run, including Chrome's `add` time, V1-P1-1 in Chrome, Abort latency, the bed photo's Frame and the full e2e specs (memory gate).

Refuter counts: raised 4 (3 reviewed + 1 new), refuted 0, P1 1, P2 0, P3 3, known 0 (V1-P3-1 stays partly known, as the auditor rated it)
