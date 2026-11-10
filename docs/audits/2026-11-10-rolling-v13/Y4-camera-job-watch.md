# Rolling audit v13 — Y4 Camera job watch

- **When:** 2026-11-10, 10:15–11:20 +0800   **Tree:** origin/main @ `82a9713a4`. Repros ran on a mutable copy of the scratchpad export `j21-main` (`82a9713a4`, `node_modules` a junction), in scratchpad `zz-y4\mut`, plus Node scripts in `zz-y4\`.
  - origin/main has since moved to `9bbc7331d` (#1683, #1684: camera-moved check and calibration grade). `git diff 82a9713a4 origin/main` touches none of `src/ui/camera/job-watch/**`, `src/core/camera/job-watch/**`, `machine-camera.ts`, `decode-jpeg.ts`, `frame-source.ts` or `bed-image.ts`.
  - Open PRs #1681, #1682, #1686 and #1623 touch none of them. #1685 (Y2 logins) touches `electron/camera-frame-proxy.ts` and `camera-frame-sources.ts` for logins only, not the timeouts, queue or failure counting used here.
- **Scope:** watching a job with the camera (ADR-490 + Amd 1): the timelapse, the burn check, how the watcher ties into Start, Pause, Abort, the end of a job and crash recovery; recordings, their size, storage and privacy; failure while a job runs; entry points (PC, phone/MCP camera still, ADR-585); several cameras (ADR-446) and the phone as camera (ADR-448) during a watch.
  - Code read: `src/ui/camera/job-watch/*` (12 files), `src/core/camera/job-watch/*` (6), `src/ui/camera/{frame-source,decode-jpeg,frame-capture,active-camera-model}.ts`, `src/core/camera/model/bed-image.ts`, `src/ui/camera/panel/CameraPanel.tsx`, `src/ui/camera/helpers/install-camera-helpers.ts`, `src/ui/state/{live-canvas-run,laser-job-actions}.ts`, `src/ui/gcode-inspector/external-run.ts`, `src/platform/web/serial-worker-protocol.ts`, `src/ui/remote-control/{machine-camera,adapter}.ts`, `src/ui/remote-access/renderer-delivery.ts`, `src/ui/remote-access/RemoteAccessSection.tsx`, `services/remote-control/{wrangler.jsonc,app/src/core/camera-snapshot.ts,app/src/ui/MachineScreen.tsx}`, `electron/camera-frame-proxy.ts`, `electron/desktop-window-options.ts`.
- **Lenses run:**
  - **L2 (performance, memory, disk):** UI-thread blocks during a running job with the watch on and off; Abort latency; the timelapse's memory over a 1, 4 and 12 hour job; what reaches the disk.
  - **L5 (privacy):** where frames and videos live, their names, project/autosave reach, the phone/MCP camera still.
  - **L6 (failure paths):** the camera refusing, stalling or vanishing mid-job; disk full on Save video.
  - **L9 (entry points):** canvas Start, G-code Inspector "Run on machine", restart, the phone/MCP still.
  - **L12:** CI of the job-watch PRs.
- **Cameras:** synthetic only. A 127.0.0.1:4811 HTTP stub serving one synthetic JPEG (4K: 3840 × 2160, 2.76 MB; 1080p: 694 KB), and in Node a 127.0.0.1:4811 stub camera behind a bridge stand-in on :4812 that runs the real `serveHttpFrame`. The calibrated camera is the repo's wide overhead lens fixture (`model-fixtures.ts`). No real camera, network, ffmpeg or hardware was used. All stubs and my Vite server (port 4898) were stopped at the end.
- **Controller:** the in-page paced GRBL (`zz-w7r-paced-grbl.js`, copied as `zz-y4-paced-grbl.js`), 150 blocks/s, streaming a 40 mm raster disc from the canvas (Frame → Start → Review → Start job).
- **Memory gates:**
  - Browser (headless, one worker, one spec): 9 runs at 2.79–4.17 GB free. One was refused at 1.29 GB and ran later at 3.47 GB. One run of mine hung on a harness bug (my snapshot loop ended before the Abort waited for a frame); I stopped it and re-ran with the fix.
  - Vitest: not needed, none run.
  - Node scripts ran at 0.81–3.5 GB free (outside the gates).
- **Counts:** 5 raised → refuter pending → P1 1 / P2 1 / P3 3 (+ 9 KNOWN re-checked).

## Headline

**The watcher never stalls the stream, and recordings stay bounded, in memory and private. But every picture it takes is decoded, flattened and encoded on the UI thread while the job runs, and an Abort pressed during that work waits for it.**

- **Y4-P1-1.** With the watch on (timelapse every 2 s and burn check), a 4K camera blocks the UI thread for **131–199 ms on every timelapse frame**. An Abort pressed inside the block reached the controller **154 ms** after the key, against **16–19 ms** with the watch off. With a calibrated camera on a homed machine, the flattening adds to that whatever the camera's resolution, measured in Chrome's renderer on a 1080p camera:
  - **274–278 ms** for the burn check's before picture of a whole-bed job, at Start;
  - **149–158 ms** for every whole-bed timelapse frame;
  - **61–85 ms** for every frame of a 200 × 150 mm sign.
  The running-job budget is 50 ms. ADR-490 D2 promises the watcher "cannot hold a job back".
- **Y4-P2-1.** The phone/MCP camera still (`get_camera_snapshot`, ADR-585) does the same work on the PC's UI thread. A client polling it during a job blocks the thread **105–195 ms every ~300 ms** (input delay p90 78 ms, max 224 ms). The relay allows 2 a second per client.

**The stream itself is unaffected.** The serial worker refills on its own (ADR-334), and the lines streamed in 20 s were the same with the watch on as off (3,048–3,171 against 3,012).

**Failure paths mostly hold, with one gap.**
- A stalling camera is tolerated: it was silent for 25 s, through three 10 s timeouts, and the recording continued.
- A camera that refuses connections for **2.5 s ends the whole job's timelapse at 3 of 11 frames** and never resumes. The 5-failure limit is counted in 250 ms retries, about 1 s in all (Y4-P3-1). The operator is told only inside the Camera panel.

**Memory and disk are bounded.**
- At most 480 frames: about 54 MB at 120 KB a frame over a 1, 4 or 12 hour job, with no growth beyond that.
- Nothing is written until **Save video…**, which writes to a file the operator picks, named `timelapse.mp4` or `.webm`, with a toast if it fails.
- Frames and the burn-check picture are never saved with the project or autosave.

**Two silent gaps (Y4-P3-2).** "Record a timelapse" records nothing, and says nothing, for a G-code Inspector run. After a restart it also records nothing for an uncalibrated camera until the Camera panel is opened.

**Privacy (Y4-P3-3).** With the watch ticked the camera stays live with the panel closed. An approved control client can then take stills, and the PC shows no sign of either.

## Measurements

Browser, Chrome for Testing 1248 headless, the paced GRBL streaming a canvas raster. In each case a 20 s probe window pressed a harmless key (F20) every 100 ms, and its input delay was recorded (handler start minus event time). Abort was Ctrl+. through CDP, pressed a set time after the stub had finished sending a frame. "First stop byte" is when GRBL's soft reset (0x18) reached the simulated controller. Source: `out/b1-watch.json`.

| Case | Long tasks in the 20 s window | Probe input delay p90 / max | Abort: key delay / first stop byte after the press |
|---|---|---|---|
| Watch **off**, camera live (4K stub) | **0** | 1 / 11 ms | 0 / **19 ms** |
| Watch **on**, 4K, pressed 21 ms after a frame | 10 × 131–183 ms (one per frame, every ~2.1 s) | 2 / 174 ms | 2 / 16 ms (missed the block) |
| Watch on, 4K, pressed 89 ms after | 10 × 138–199 ms | 2 / 187 ms | 1 / 17 ms (missed) |
| Watch on, 4K, pressed **171 ms** after (inside the block) | 10 × 139–176 ms | 3 / 123 ms | **137 / 154 ms** |
| Watch on, 4K, pressed 206 ms after | 10 × 138–191 ms | 3 / 145 ms | 63 / 81 ms |
| Watch on, **1080p**, plain frames | 1 × 52 ms | 1 / 33 ms | 18 / 29 ms |
| Watch off, `get_camera_snapshot` in a loop (MCP), 4K | **62 × 105–195 ms** (every ~300 ms) | **78 / 224 ms** | 1 / 19 ms (missed) |

The block starts 108–187 ms after the frame leaves the stub: the frame is decoded off the thread first, then drawn, read back, copied and scaled on it.

The calibrated (flat) path, timed in Chrome's renderer with the real `warpFrameToBedImage`, `encodeJpegPicture` and `decodeToRgba` on a 1080p calibrated camera (`out/b4-flat-cost.json`; Node agrees, `out/a1-warp-cost.out.jsonl`):

| Job (bed 400 × 400) | Burn-check before picture (at Start) | Timelapse frame (each interval) |
|---|---|---|
| Coaster 40 mm (60 × 60 mm region) | 14 ms | 8 ms + 3 ms encode |
| Sign 200 × 150 (220 × 170 mm) | 63 ms | 69 ms + 7 ms encode (long tasks 61–85 ms) |
| Whole bed 380 × 380 (400 × 400 mm) | **279 ms** (long tasks 274–278 ms) | **139 ms** + 10 ms encode (long tasks 149–158 ms) |
| Same, 4K camera (Node) | 305–349 ms | 125–149 ms |

These add to the decode and read-back the plain path already costs: 26 ms for 1080p, most of the 131–199 ms for 4K. At Start the before picture and the first timelapse frame are both taken.

## Findings

### Y4-P1-1 — Watching a job decodes, flattens and encodes every picture on the UI thread while the job runs: 131–199 ms per timelapse frame (4K), 149–158 ms (calibrated, whole bed), 274–278 ms for the burn check's first picture at Start, and an Abort pressed inside waits

- **Where (82a9713a4):**
  - `src/ui/camera/job-watch/timelapse-recorder.ts`:
    - `:73-85`: a capture whenever a frame is due while the job runs;
    - `:130-143`: `flattenedPicture` and then `encodeJpeg`, synchronously after the decode.
  - `src/ui/camera/decode-jpeg.ts:26-40`: `createImageBitmap` is async, but `drawImage` and `getImageData` of the full frame run on the UI thread.
  - `src/ui/camera/job-watch/job-watch-camera.ts`:
    - `:86-91`: `warpFrameToBedImage`;
    - `:114-134`: `encodeJpegPicture` copies the full frame (`new Uint8ClampedArray(image.data)`), then `putImageData` and a scaled `drawImage`, all synchronous.
  - `src/ui/camera/job-watch/burn-check-run.ts`:
    - `:27`: `BURN_LIMITS` up to 4 MP;
    - `:86-92`: the before picture, flattened at Start.
  - `src/core/camera/model/bed-image.ts:58-64`: a per-pixel loop, one task.
  - `src/ui/camera/job-watch/job-watch-runner.ts:98-113`: both start with the job.
  - `src/platform/web/serial-worker-protocol.ts:34-37,54-56`: Abort's writes and the release of the worker's refill are the main thread's.
- **Anchor:**
  - **Contract:** ADR-490 D2: "The watcher reads the laser store; it adds no step to Start and cannot hold a job back." D5: "The watcher never refuses or delays a job."
  - **Twin / budget:** performance audit S1 `AREAS.md:25`: "Longest UI block while a job runs | 50 ms | Abort, status and any window-side streaming share this thread".
  - **Precedent:** S4-P2-3 (a 94–622 ms recovery-archive block right after Start), P1 by the coordinator, fixed by #1574. W7-P2-1, P1, fixed by #1639.
- **Scenario:**
  1. A maker has a 4K overhead camera, or a calibrated 1080p one on a homed machine, with **Record a timelapse** (2 s) and **Check the burn** ticked. They start a whole-bed engrave.
  2. For the first ~0.3 s after Start, the UI thread is held by the before picture's flattening. Every 2 s for the rest of the job it is held 130–200 ms for a frame.
  3. They see the head going the wrong way, or a flare, and press Ctrl+. or **ABORT JOB**. If the press lands in a block, the stop waits for it.
- **Evidence:**
  - **REPRO, browser** `zz-y4/mut/e2e/zz-y4-watch.e2e.ts` → `out/b1-watch.json`. The table under Measurements: with the watch off, 0 long tasks and the stop byte 19 ms after the press. With it on (4K), 10 long tasks of 131–199 ms in 20 s, one per frame. Pressed inside one, the key handler started 137 ms late and the stop byte arrived **154 ms** after the press.
  - **REPRO, browser** `zz-y4/mut/e2e/zz-y4-flat-cost.e2e.ts` → `out/b4-flat-cost.json`: the calibrated path's blocks in Chrome's renderer (274–278 ms and 149–158 ms long tasks, whole bed, 1080p).
  - **REPRO, Node** `zz-y4/a1-warp-cost.mts` → `out/a1-warp-cost.out.jsonl`: the same warp at 1080p and 4K.
  - **Not run in the browser:** the flat path inside a streamed job. The paced simulator has no homing, so the plan was not on the bed and the timelapse used plain frames (Amd 1 D3). The flat cost was timed in the renderer with the real functions outside a job.
- **Severity:** P1.
  - **For P1:**
    - An Abort was measured 135 ms later than the control, inside a block the watcher alone adds.
    - The block recurs at every interval for the whole job. The largest, 0.27–0.3 s plus the first frame, falls at Start, which is when an operator most often aborts.
    - S4-P2-3, an Abort delayed up to 0.5 s at Start, was P1 on the same budget. The brief rates a delayed Abort P1.
    - Pause and Resume share the thread and are delayed the same way.
    - METHOD §3 has no reach clause.
  - **For P2:**
    - Each delay is bounded by one block (about 0.15–0.3 s, plus a timelapse frame at Start).
    - The stream itself does not stall: the worker refills on its own, and lines streamed matched the control.
    - A 1080p uncalibrated camera stays near the budget (one 52 ms task in 20 s).
    - The physical E-stop is unaffected.
- **Announced?** No. ADR-490 says the opposite (D2, D5). Its Consequences announce a block only after a finished job ("The check runs in the app window when the job ends. A bed-sized job takes up to a second or so.").
- **Novelty:** new. v11 W4 checked the timelapse's memory and disk, not its thread time. The performance audit S1–S9 did not cover the camera.
- **Fix direction:**
  - Do the frame work off the UI thread. Fetch the blob, `createImageBitmap` it, and transfer the bitmap to a worker. There, read the pixels from an `OffscreenCanvas`, run the warp (pure core), and `convertToBlob` the JPEG. The before picture's `RgbaImage` can stay in the worker until the after picture is compared.
  - For plain frames, at least decode straight to the timelapse size (`createImageBitmap(blob, { resizeWidth })`) and drop the full-frame copy in `encodeJpegPicture`.
  - Add a browser test that runs a job with the watch on and asserts no long task over 50 ms after Start, as the S1/S4 fixes do.
- **Refuter:** PENDING.

### Y4-P2-1 — The phone/MCP camera still is decoded and encoded on the PC's UI thread: a client polling it during a job holds the thread 105–195 ms every ~300 ms

- **Where (82a9713a4):**
  - `src/ui/remote-control/machine-camera.ts`:
    - `:33`: `captureSourceFrame`, the same decode as Y4-P1-1;
    - `:42-72` (`encodeStill`): a full-frame `Uint8ClampedArray` copy and `putImageData`, a scaled `drawImage`, then up to four synchronous `canvas.toDataURL` encodes.
  - `src/ui/remote-control/adapter.ts:74-75,113-126`: "a control-scope read with no ledger entry". It has no pacing of its own.
  - `services/remote-control/wrangler.jsonc`: `CLIENT_LIMIT` 120 a minute per client.
- **Anchor:**
  - **Contract:** ADR-585, row `get_camera_snapshot`: "one JPEG of at most 1024 px". Nothing there allows it to hold the PC.
  - **Twin:** the S1 running-job budget (50 ms).
  - **Docs:** `docs/mcp/remote-control.md` says Abort "remains available while another remote request is pending".
- **Scenario:**
  1. An MCP client, approved for control with artwork sharing on, is asked to "keep an eye on the job" and polls `get_camera_snapshot`. The relay lets it make 2 calls a second.
  2. Each call blocks the PC's UI thread for 105–195 ms with a 4K camera, so the thread is held 20–40 % of the job.
  3. The operator at the PC presses Abort and waits for the current block.
  4. ADR-585's hold-to-jog dead-man also lives in this renderer (an 80 ms poll), though a still and a hold rarely overlap.
- **Evidence:** REPRO, browser, `zz-y4-watch.e2e.ts` with `ZZ_CASE=snapshot` → `out/b1-watch.json` `case-snapshot`. The real `cameraSnapshot` was called in a loop in the page while the canvas job streamed:
  - 72 stills of 272–444 ms each;
  - **62 long tasks of 105–195 ms** in 20 s;
  - probe input delay p50 15 ms, p90 78 ms, max **224 ms** (control: max 11 ms).
  - The single Abort press missed a block (19 ms). The key-delay distribution is what an Abort would see.
- **Severity:** P2.
  - **For P1:** the same Abort-delay class as Y4-P1-1, measured at up to 224 ms of input delay. The brief rates a delayed Abort P1, and METHOD §3 has no reach clause.
  - **For P2:**
    - It needs a client the operator approved for control, with the sharing opt-in, polling the still repeatedly.
    - That client can itself Abort.
    - The phone page takes one still per tap (`MachineScreen.tsx:202-211`).
    - Not measured with a 1080p camera, where the decode is about 26 ms and the encode cost is unmeasured.
- **Announced?** No.
- **Novelty:** new. v3 H8 and v11 W4 checked the still's gating and contents ("pixels only"), not its thread time.
- **Fix direction:**
  - Share Y4-P1-1's off-thread path: decode with `createImageBitmap(blob, { resizeWidth: 1024 })` and encode with `OffscreenCanvas.convertToBlob` in a worker.
  - Pace stills per client on the PC, at most one in flight and one a second, so polling cannot crowd the job.
- **Refuter:** PENDING.

### Y4-P3-1 — A camera that refuses connections for about a second ends the timelapse for the rest of the job: five failures are counted in 250 ms retries, it never resumes when the camera is back, and only the Camera panel says so

- **Where (82a9713a4):**
  - `src/ui/camera/job-watch/timelapse-recorder.ts`:
    - `:27-28` (`TICK_MS = 250`, `MAX_FAILED_CAPTURES = 5`);
    - `:73-81`: a failed capture leaves the frame due, so the next tick 250 ms later retries, and the fifth failure ends the recording;
    - `:68-72`: the note.
  - `src/ui/camera/job-watch/TimelapseResult.tsx:26`: the note is shown only in the panel.
- **Anchor:**
  - **Contract:** ADR-490 D3: "While the job runs (not while paused), one frame is kept every interval."
  - **Twin:** the same recorder tolerates a stalling camera for 50 s (five 10 s bridge timeouts, `camera-frame-proxy.ts:25`), but a refusing one for about 1 s.
  - The brief asks whether the watch reconnects.
- **Scenario:**
  1. A phone (ADR-448) serves the overhead camera. Its screen locks, or the app is backgrounded or reconnects to Wi-Fi, for 2–3 s during a long engrave.
  2. Connections are refused for that time. The timelapse stops for good: "The camera stopped sending pictures. The timelapse stopped at 3 frames."
  3. The camera is back 0.2 s later. The job runs on with no timelapse, and nothing outside the Camera panel says so.
- **Evidence:** REPRO, Node, `zz-y4/b2-blip.mts` → `out/b2-blip.out.jsonl`. The real `startTimelapse` runs through the real `captureSourceFrame` and `fetch`, via a bridge stand-in running the real `serveHttpFrame`, to a stub camera. Only the decode and encode are stubbed.
  - Refused for **2.5 s** at 5 s into a 20 s job: 5 failed fetches within **1.06 s**, and the recording ended at 7.3 s with **3 of 11 frames**. It did not resume.
  - Refused for 1.5 s: 2 failures, survived, 10 frames.
  - Stalled for 25 s (connection accepted, no reply): 3 timeouts of 10 s, survived, 15 of 31 frames.
- **Severity:** P3.
  - **For P2:** the recording the operator asked for is lost for the rest of the job after a short and common outage, with no toast.
  - **For P3:** the job and the project are untouched, and a note exists in the panel.
- **Announced?** Partly. The note names the cause. That a 1 s refusal ends the recording for good is not said.
- **Novelty:** new. v11 W4 "Verified clean" read the 5-failure stop as designed, without timing it.
- **Fix direction:**
  - Retry at the interval, not every 250 ms. Count failures over time (stop only after, say, 30 s without a picture), or never stop while the source is live and skip the missing frames.
  - Resume when pictures return.
  - Raise a toast when a recording stops mid-job.
- **Refuter:** PENDING.

### Y4-P3-2 — "Record a timelapse" records nothing, and says nothing, for a G-code Inspector run; after a restart it also records nothing for an uncalibrated camera until the Camera panel is opened

- **Where (82a9713a4):**
  - The watcher observes only `liveCanvasRun` (`job-watch-runner.ts:73-74`).
    - `live-canvas-run.ts:180` returns no run without a canvas plan.
    - `external-run.ts:267-283` starts the job with no `canvasPlan`, so a G-code Inspector "Run on machine" never starts a recording, and no note is set.
  - After a restart, `install-camera-helpers.ts:86-92` (`startIfCalibrated`) starts only a calibrated camera. Otherwise the camera starts when the panel mounts (`CameraPanel.tsx:148`). The job then gets "The camera was not running when the job started, so there is no timelapse." (`job-watch-runner.ts:269-277`), and the operator sees it only by opening the panel.
- **Anchor:**
  - **Contract:** ADR-490 D1: "While either is ticked, the camera keeps running when the panel closes, so it is there when a job starts." D2: "A job starts when a new live run begins streaming".
  - **Panel text:** `JobWatchSection.tsx:57-59`: "The camera stays on while these are ticked."
- **Scenario:**
  1. Timelapse is ticked, remembered per computer. Tomorrow KerfDesk is reopened with an uncalibrated phone camera, which the timelapse does not need calibrated, and a job runs without anyone opening the Camera panel.
  2. Or a `.nc` file from another program is run from the G-code Inspector.
  3. Either way, no timelapse is recorded and no notice is shown.
- **Evidence:** READ (the lines above). In the browser runs the external-file route of `zz-w7r` was not used for this reason, and only canvas Starts were watched.
- **Severity:** P3. The job is unaffected, and the recording is a convenience the operator asked for and silently does not get.
- **Announced?** No. D1 and the panel text promise the opposite.
- **Novelty:** new.
- **Fix direction:**
  - Start the last camera with KerfDesk when either watch box is ticked, as for a calibrated camera.
  - Watch every streamed run, external ones too, with plain frames and no burn check when there is no canvas plan. Or say in the panel that G-code Inspector runs are not recorded.
  - Show "not recorded: …" as a toast when a ticked watch cannot record.
- **Refuter:** PENDING.

### Y4-P3-3 — With the watch ticked, the camera stays live with the panel closed, and an approved control client can take stills of it; the PC shows no sign of either

- **Where (82a9713a4):**
  - `CameraPanel.tsx:151` and `job-watch-store.ts:54-61` (`jobWatchWantsCamera`): the source outlives the panel.
  - `machine-camera.ts:30-33`: a still needs only a live source.
  - `adapter.ts:113` ("no ledger entry"). No PC notice or indicator was found (searched `src/ui` for a camera-live indicator).
  - `RemoteAccessSection.tsx:51-56`: "Connections approved for machine control can also take still photos from this computer's camera while it is live."
- **Anchor:**
  - **Twin:** the Settings disclosure conditions sharing on the camera being live. The job-watch note says ticking keeps it live, but nothing on the PC shows that it is live with the panel closed, or that a still was taken.
  - ADR-585 requires control approval and the opt-in. It says nothing about telling the PC.
- **Scenario:**
  1. Timelapse is ticked, the Camera panel is closed, and the overlay is off, so the canvas shows no camera.
  2. An approved phone or MCP client takes stills of the workshop at any time, through the first-party relay and possibly an AI provider (`docs/mcp/remote-control.md`).
  3. The PC shows nothing. A network camera has no hardware light.
- **Evidence:** READ.
- **Severity:** P3. It is consented and disclosed in Settings, and the client must be approved for control. This is a visibility gap, not a leak.
- **Announced?** Partly (Settings note).
- **Novelty:** new. v11 W4 verified the still's gating, not its visibility.
- **Fix direction:**
  - Show a small "Camera live" mark while the source is live with the panel closed.
  - Show a brief "Phone took a camera still" notice, or a line in the remote activity list.
- **Refuter:** PENDING.

## KNOWN: status on `82a9713a4`

| ID | Was | Status | Evidence |
|---|---|---|---|
| v2 12-P2-4 (ADR-490 Amd 1) | Burn check graded jobs whose bed position is unknown | **Fixed, holds** | `job-burn-route.ts:41-44`, `burn-check-run.ts:56-72`. The browser runs (no homing) recorded plain frames and gave a reason for no check, as Amd 1 D3 says |
| v2 12-P3-2 | No blank or black frame check in the burn check | **Still open** | nothing in `core/camera/job-watch` or `ui/camera/job-watch` checks luma or blank frames |
| v2 19-P2-1 (ADR-656) | A save picker emptied the file before the video was ready | **Fixed, holds** | `TimelapseResult.tsx:80-97` makes the video first and then `pickPreparedSaveTarget`. A write failure after the pick, such as a full disk, still leaves the chosen file emptied; that is the generic ADR-656 boundary, not raised again |
| v11 W4 "camera disappears mid-job" (Verified clean) | 5 failed captures end the timelapse | **Challenged** by Y4-P3-1 (about 1 s of refusals ends it) | `b2-blip.out.jsonl` |
| v11 W4 "timelapse memory" (Verified clean) | Bounded at 480 frames | **Holds, measured** | `b3-long.out.jsonl`: 1 / 4 / 12 h → 451 / 451 / 339 frames, 54 / 54 / 41 MB at 120 KB a frame, no further heap growth |
| Y2-P3-5 | A live phone or snapshot camera with a refused login is polled twice a second | **Open (Y2)**. Ticking the watch keeps the source live with the panel closed, but the 500 ms poll needs the preview or overlay mounted. The timelapse's own captures stop after 5 failures (Y4-P3-1) | READ |
| Y1-P1-1 | A same-aspect crop used as a rescale | **Open (fix #1681)**. The burn check and flat timelapse go through the same `cameraModelForFrame` (`job-watch-camera.ts:83-85`), so they inherit it | READ |
| Y1-P2-1 | Accuracy off the sheet | **Fixed after this tree** by #1684 (on main `9bbc7331d`). The burn check's 1 mm zone relies on the calibration, so it was exposed until then | READ of the PR title and diff list |
| S4-P2-3 (perf v1) | Recovery archive on the UI thread at Start | **Fixed (#1574)**. Y4-P1-1 is a new block at the same moment, from another source | — |

## Refuted

None raised and then refuted. Candidates dropped before raising:
- **A recording keeps running after the job ends, an Abort or a disconnect.** `ENDED` holds stopped, disconnected, errored and finished (`job-watch-runner.ts:39-44`). Measured: after Ctrl+. the recording was `recording: false` with one final frame added 3 s later (`b1-watch.json`, `watchAfter`). A crash loses the in-memory frames, which ADR-490's Consequences announce ("not saved with the project").
- **A stalled camera hangs the after-picture or the recording.** Through the bridge each capture is bounded at 10 s (`camera-frame-proxy.ts:25,177-181`), and USB at 5 s (`frame-capture.ts:13`). Measured: 25 s of silence, recording continued (`b2-blip`). The window's own `fetchBlob` has no timeout (`decode-jpeg.ts:16-24`), but every frame URL is the bridge's or a `MediaStream`. Not raised.
- **Heavy camera frame rate starves the serial path.** The stream's refill is in the serial worker (ADR-334, `serial-worker-protocol.ts:3-15`), and the job watch takes at most one frame per interval. Lines streamed in 20 s: 3,012 (off) against 3,048–3,171 (on). The one starvation sample in every run, watch off included, is the job's first 12 lines.
- **Background throttling of the desktop window slows the watch.** `desktop-window-options.ts:30`: `backgroundThrottling: false`.

## Verified clean

- **Where recordings live:** frames are `Blob`s in `useJobWatchStore` only. No project, autosave, recovery or template path reads `timelapse` or `bedPicture` (searched `src`).
  - **Save video…** writes only to the file the operator picks, suggested as `timelapse.mp4` or `.webm` (`TimelapseResult.tsx:95`), with no camera address or login.
  - A failure gives "Could not save the timelapse video: <reason>" (`:101-106`).
- **Size:**
  - The 4K stub's timelapse frames were 31 KB (1024 × 576) and the 1080p stub's 65 KB.
  - The cap holds over 12 h (table above).
  - The video encodes at 8 Mbit/s and 15 fps, at most about 32 s, so 32 MB at most (`timelapse-video.ts:18`; `timelapse-frames.ts:7-8`).
- **Pause:** frames are kept only while the run is `running` (`job-watch-runner.ts:109`; ADR-490 D3).
- **Abort / stop:** the burn check reports "The job did not finish, so there is nothing to check." (`job-watch-runner.ts:196-199`).
- **Several cameras (ADR-446):**
  - The watcher uses the live source's own calibration (`ownCameraModel`, `job-watch-camera.ts:45-49`).
  - A head camera (ADR-449) gives plain frames and no burn check.
  - Switching cameras mid-job ends the timelapse with "The camera was turned off or switched." (`timelapse-recorder.ts:88-90`). The after picture then says "The camera did not send a picture after the job.", a wording nit that is not raised.
- **Phone as camera (ADR-448):** a `machine-jpeg` source through the same bridge path, so Y4-P3-1's reproduction is its case.
- **Remote still gating (L9, privacy):** control approval, the sharing opt-in and a live camera are required. Only pixels are returned (`machine-camera.ts:27-39`; `renderer-delivery.ts:53-58`). The Settings note discloses stills and the relay or AI-provider path.
- **Remote Start:** a phone/MCP Start runs the canvas Start flow (`remote-control/machine-execution.ts:8` → `runFramedPermitStart` in `laser/start-job-flow.ts`), with the canvas plan, so it is watched like a PC Start (READ). The still is the only remote camera path, and starting a watch from the phone is not possible (the watch settings are PC-only, `job-watch-settings.ts:19-36`).
- **L12:** the job-watch PRs #1013 (ADR-490), #1373 (Amd 1), #1427, #1463, #1467 and #1572 all have green CI and Browser smoke on their PR heads. Their merge-commit runs were cancelled by the next push.
  - The audited tip `82a9713a4` (a docs merge): CI success; Browser smoke failed in Chrome UX smoke 3/4 with no Playwright report uploaded. Not job-watch code, and not investigated further.

## Not verified

- **The flat (calibrated) path inside a streamed job.** The paced simulator has no homing, so Start produced a job without a bed position and the timelapse recorded plain frames. The flat cost was timed in Chrome's renderer with the real functions outside a job (`b4`), and Abort-in-block was measured on the plain 4K path.
- **The burn check's after-picture comparison** (post-job; ADR-490 says up to about 1 s). It runs after the job has finished, so it was not timed.
- **The remote still with a 1080p camera**, and with a USB camera (`captureStreamFrame` through a `<video>`).
- **The browser edition in a hidden tab.** Chrome throttles timers there. The desktop sets `backgroundThrottling: false`.
- **Real cameras, real phones (lock-screen behaviour), real 4K webcams' decode cost**, and a real controller.
- **Disk full during Save video** was not provoked. It is READ only and covered by v11 W4.

## Repro files

All files are in the scratchpad folder `zz-y4\`. The browser specs live in a mutable copy of `j21-main` (`zz-y4\mut`, `node_modules` a junction; remove it only with `cmd /c rmdir`).

Browser runs: start Vite from `zz-y4\mut` with `node node_modules/vite/bin/vite.js . --config vite.zz.config.ts --mode desktop --host 127.0.0.1 --port 4898 --strictPort`. Then run `node node_modules/@playwright/test/cli.js test e2e/<spec> --config playwright.zz.config.ts --workers=1`, with `ZZ_OUT`, `ZZ_CASE=on|off|snapshot`, `ZZ_PRESS_DELAY` (ms after a served frame), `ZZ_TAG`, `ZZ_FRAME_W` and `ZZ_FRAME_H`.

Node scripts: run from `zz-y4\` with `node --no-experimental-webstorage --import ./register.mjs <script>.mts` (the loader is Y3r's, pointed at `j21-main`).

- `mut/e2e/zz-y4-watch.e2e.ts` → `out/b1-watch.json` (+ `out/b1-*.log`): the job-watch on/off Abort matrix and the remote-still loop (Y4-P1-1, Y4-P2-1). It includes the 127.0.0.1:4811 stub camera.
- `mut/e2e/zz-y4-flat-cost.e2e.ts` → `out/b4-flat-cost.json`: the calibrated path in the renderer (Y4-P1-1).
- `mut/e2e/fixtures/zz-y4-paced-grbl.js`: a copy of `zz-w7r`'s paced GRBL.
- `mut/playwright.zz.config.ts`, `mut/vite.zz.config.ts`: own port 4898, cached Chrome 1248, fflate alias.
- `a1-warp-cost.mts` → `out/a1-warp-cost.out.jsonl`: warp cost at 1080p and 4K (Y4-P1-1).
- `b2-blip.mts` → `out/b2-blip.out.jsonl`: refused and stalled camera mid-job, through the real `serveHttpFrame` (Y4-P3-1).
- `b3-long.mts` → `out/b3-long.out.jsonl`: 1 / 4 / 12 h timelapse memory on a virtual clock (verified clean). Run with `--expose-gc`.

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Y4-P1-1","severity":"P1","area":"camera-job-watch","file":"src/ui/camera/job-watch/timelapse-recorder.ts","line":137,"anchor":"Contract ADR-490 D2 ('cannot hold a job back') and D5; perf S1 budget 50 ms UI block while a job runs; precedent S4-P2-3","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Job watch decodes/flattens/encodes every frame on the UI thread during the job: 131-199 ms per 4K timelapse frame, 149-158 ms per calibrated whole-bed frame, 274-278 ms for the burn-check before picture at Start; Abort pressed inside reached the controller 154 ms after the key vs 16-19 ms with the watch off"},
  {"id":"Y4-P2-1","severity":"P2","area":"camera-job-watch","file":"src/ui/remote-control/machine-camera.ts","line":42,"anchor":"Contract ADR-585 get_camera_snapshot; twin perf S1 50 ms running-job budget","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Phone/MCP camera still decodes and encodes (toDataURL up to 4x) on the PC UI thread; polling during a job gave 62 long tasks of 105-195 ms in 20 s, input delay p90 78 ms / max 224 ms (control max 11 ms); relay allows 2/s per client"},
  {"id":"Y4-P3-1","severity":"P3","area":"camera-job-watch","file":"src/ui/camera/job-watch/timelapse-recorder.ts","line":80,"anchor":"Contract ADR-490 D3 (a frame every interval while the job runs); twin: stall tolerated 50 s vs refusal ~1 s","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"A camera refusing connections for 2.5 s ends the timelapse for the rest of the job (5 failures in 1.06 s via 250 ms retries; 3 of 11 frames), never resumes, told only in the Camera panel"},
  {"id":"Y4-P3-2","severity":"P3","area":"camera-job-watch","file":"src/ui/camera/job-watch/job-watch-runner.ts","line":73,"anchor":"Contract ADR-490 D1 (camera there when a job starts) and D2; panel text 'The camera stays on while these are ticked'","evidence":"READ","verdict":"PENDING","known":false,"summary":"Ticked timelapse silently records nothing for G-code Inspector runs (no canvas plan, no liveCanvasRun) and, after a restart, for an uncalibrated camera until the Camera panel is opened"},
  {"id":"Y4-P3-3","severity":"P3","area":"camera-job-watch","file":"src/ui/remote-control/adapter.ts","line":113,"anchor":"Twin: Settings disclosure 'while it is live' vs job-watch keeping the camera live with no PC indicator","evidence":"READ","verdict":"PENDING","known":false,"summary":"With the watch ticked the camera stays live with the panel closed; approved control clients can take stills at any time and the PC shows no sign of the live camera or of a still being taken"}
]
```

Auditor counts: raised 5, refuted 0, P1 1, P2 1, P3 3, known 9

## Refuter (2026-11-10)

- **Tree.** Repros ran on my own mutable copy of `j21-main` (`82a9713a4`) in scratchpad `zz-y4r\mut` (`node_modules` a junction). Re-checked on origin/main `8493f590c`:
  - Since `82a9713a4`, main has merged #1681, #1682, #1683, #1684 and #1688.
  - None of them changes `src/ui/camera/job-watch/**`, `src/core/camera/job-watch/**`, `decode-jpeg.ts`, `frame-source.ts`, `CameraSourceView.tsx`, `bed-overlay-renderer.ts`, `src/ui/remote-control/**` or `src/platform/web/**`.
  - #1681 adds a redraw dependency to `use-bed-overlay-drawing.ts`. It does not change the MJPEG sampling or the texture upload (Y4-P1-2 below), whose lines move by 3 on main (`:98`, `:132`, `:214-222`).
  - #1681 also changes `camera-model-frame.ts`. On main, a calibrated camera whose frame size differs from its calibration gives plain frames until a resize is proved. A camera calibrated at its own size is still flattened, so the flat-path blocks below are unchanged for it.
  - Open #1685, #1686 and #1687 touch no job-watch, timelapse, remote-still or overlay-upload code.
- **Harness.** Everything here is my own; no auditor script was reused.
  - **Simulator.** `zz-y4r-grbl.js` is a GRBL stand-in whose machine runs on wall-clock time. When the window is blocked, it catches up afterwards: first the 15-block planner, then the lines in its 128-byte RX buffer. Any time left after both are empty is counted as **dry**: the head stood still mid-job. Dry time under `M3` with `S>0` is counted as **lit**.
  - **Machine model.** The block rate (250 or 400 blocks/s) models a short-segment photo or dither raster.
  - **Job.** A real canvas job: a 380 mm square, filled at 0.05 mm with constant power (`M3`). The real Frame → Start → Job Review → Start job path was used.
  - **Camera.** A `127.0.0.1:4892` stub serves synthetic bed photos as a polled JPEG, a 10 fps multipart MJPEG (standing in for the RTSP bridge preview), or a 30 fps canvas `MediaStream` (standing in for a USB camera).
  - **Calibration.** The repo's `savedCameraModel()` fixture.
  - **Homed state.** It is stubbed by one guarded line in my copy of `job-burn-route.ts` (`__ZZ_FORCE_BED__`). The not-verified case "flat path inside a streamed job" therefore ran end to end: `timelapse.flat: true`, and the burn check was armed.
  - **Probes.** A probe key is pressed at random 25–75 ms gaps for 15–20 s. Each run ends with one Ctrl+. Abort, sent through CDP.
  - **GPU.** Headless Chrome 1248 used the real GPU: WebGL reports `ANGLE (Intel(R) Iris(R) Xe Graphics … Direct3D11)`, so this is not SwiftShader.
- **Memory gates.**
  - Browser runs started at 2.68–3.92 GB free, headless, one worker, one spec.
  - One run of mine hung on a harness bug: it waited for a camera fetch that a USB source never makes. I stopped my own processes and re-ran with a timeout.
  - My Vite server (4895) and stub (4892) are stopped.
  - The Node script ran at 3.67 GB free. Vitest was not used.
- **A note on magnitudes.** My long tasks are about half the auditor's on the same paths: 4K plain 77–106 ms against 131–199 ms, and calibrated 1080p whole bed 67–76 ms against 149–158 ms. I put that down to load on the PC at the time. Every path over budget in one set is also over budget in the other.

### Verdicts

**Y4-P1-1 — CONFIRMED, P1.** I reproduced it with my own harness, and the measurement the auditor could not make (a calibrated, bed-placed job streaming) now exists.

| Run (all streamed jobs; watch = timelapse 2 s + burn check) | Long tasks in the window | Key delay at random moments p99 / max | Abort: key delay / stop byte after the press | Window route: dry / lit / longest stop |
|---|---|---|---|---|
| Control: 4K camera live, nothing calibrated, watch off (250 blocks/s) | 0 | 2 / 2 ms | 0 / 10 ms | 0 / 0 / 0 ms |
| Watch on, 720p plain | 0 | 2 / 3 ms | 0 / 7 ms | 11 / 11 / 11 ms |
| Watch on, 4K plain (400/s) | 10 × 77–106 ms | 50 / 62 ms | **55 / 74 ms** (in a block) | 1,275 / 698 / 110 ms (control at 400/s: 533 / 202 / 66) |
| Watch on, 12 MP 4:3 plain (a phone app's photo size, 3.6 MB) | 10 × 108–164 ms | 101 / 130 ms | **66 / 75 ms** (in a block) | 764 / 492 / 161 ms |
| Watch on, 24 MP plain (7.1 MB, under the bridge's 8 MiB cap) | 10 × 218–297 ms | 248 / 283 ms | **197 / 205 ms** (in a block) | 2,034 / 1,049 / 234 ms |
| Watch on, USB 1080p, calibrated, whole bed | 9 × 70–83 ms; at Start 53, 59, 83, **144, 269** ms | 51 / 70 ms | missed | 205 / 101 / 36 ms (control: 0 / 0 / 0) |
| Watch on, 1080p calibrated, whole bed (polled JPEG) | 9 × 67–76 ms; at Start 80, **145** ms | 53 / 68 ms | missed | 2,291 / 1,029 / 76 ms (overlay control: 1,693 / 817 / 26) |
| Watch on, 4K calibrated, whole bed (250/s) | 25 × 60–247 ms (two per frame); at Start 119, **247** ms | 83 / 89 ms | missed | 1,150 / 874 / **373 ms** (overlay control: 439 / 223 / 47) |

- **What the laser does in that time.**
  - Abort is sent from the UI thread on every route. ADR-598 (at `82a9713a4`, `docs/decisions/ADR-598-performance-worker-and-cache-budgets.md:89-92`): the Abort key handler "runs in the capture phase and calls `stopJob` synchronously". On the worker route it then posts the reset to the worker, so it waits behind any block.
  - No software path bypasses the renderer. The Desktop main process writes `0x18` only when a network session ends (`electron/machine-network-session.ts:11,166-178`). The machine's own E-stop and power switch are unaffected.
  - On the worker route the job keeps running during the wait. My in-block presses added 63–64 ms (4K, 12 MP) and 195 ms (24 MP) over the 10–14 ms control. At 6,000 mm/min that is 6–20 mm of extra lit travel; the auditor's 154 ms is 15 mm, and the 0.27–0.3 s Start block is 27–30 mm.
- **What the app's own budgets say.**
  - Perf S1 `AREAS.md` sets 50 ms for the longest UI block while a job runs. ADR-352 Amendment 1 (`:86-88`) holds the job-time interactions it measured to "none over 50 ms".
  - The ADR-490 D2/D5 anchor is weak. D2 ("adds no step to Start and cannot hold a job back") and D5 ("never refuses or delays a job") are about gating Start, not thread time. The finding rests on the budget and on precedent instead.
- **Why it stays P1.**
  - **The window route.** On the ADR-354 fallback the watch drains the controller. This is a stronger mechanism than the one the auditor reported. The fallback applies to a USB adapter with no unique identity, Background streaming turned off, or a worker that will not start (`web-serial.ts:131`, `laser-connect-action.ts:308`).
    - With `M3`, every flattened or 4K+ frame leaves the head stopped and lit for up to 110–373 ms; the clean control has none.
    - That is the K1-P1-1 / S1-P2-1 class.
    - Job Review's only warning for this route (`window-stream-lit-stop-warnings.ts:24-26`) blames "a large edit, Undo or an import" and advises "do not edit the project while it runs". An operator who follows it still gets these stops. By the METHOD §3 G6 rule, that is not a warning of this cause.
  - **The worker route.**
    - Abort and Pause wait behind a block that recurs every interval for the job's first 40 minutes. At the default 5 s, the interval doubles only after 480 frames (`timelapse-frames.ts:30-43`).
    - The largest block falls right after Start.
    - This matches S4-P2-3 (P1, Abort 125–504 ms at Start), not S1-P3-2. S1-P3-2 was P3: one block of 148–189 ms at the job's end, "no refill at stake".
- **Re-scoping, not re-rating.** The finding is narrower than "every picture":
  - A plain 720p or 1080p camera gives no long task: my runs had 0, the auditor's one 52 ms.
  - The blocks need either frames of 4K or more, or a calibrated camera on a job that covers much of the bed. A coaster-sized flat region costs 8–14 ms (auditor `b4`).
  - ADR-448 decision 5 tells phone users to pick "the largest video resolution". That advice is what leads to 4K and 12 MP frames.
- **One correction to the report.** The headline's "The stream itself is unaffected" is refuted for the run the auditor made; see the challenges below.

**Y4-P2-1 — CONFIRMED, P2.**
- **Measurements.** A remote still every 2 s during the job (`cameraSnapshot`, real code):
  - 4K: 10 long tasks of 62–86 ms. Each still took 118–142 ms in all. An Abort pressed in one waited 32 ms for the key and 39 ms for the stop byte.
  - **1080p: no long task.** A still is 42–64 ms in all, split into tasks under 50 ms.
- **Not polled by the phone.**
  - The phone page asks only on a tap. `CameraCard`'s `onClick` is the only caller of `controller.cameraSnapshot()` (`services/remote-control/app/src/ui/MachineScreen.tsx:202-211`, `core/controller.ts:504-507`). The page has no interval or effect that polls it.
  - An MCP client polls at its own pace, inside the relay's `CLIENT_LIMIT` of 120 a minute (`services/remote-control/wrangler.jsonc:41`).
- **Why P2 and not P1.** Each still is one request from a client the operator approved for control, and that client can Abort itself. The block equals one 4K timelapse frame of Y4-P1-1, and both have the same root and fix.
- **Coordinator.** Fix the two as one cluster.

**Y4-P3-1 — CONFIRMED, P3, with sharper numbers.** The real `startTimelapse` ran on a virtual clock (`r3-refuse.mts` → `out/r3-refuse.jsonl`).
- **Refused connections** (a fast bridge 502):
  - An outage that covers a due frame ends the recording when it lasts **1.5 s or more**. That is 5 failures within 1,060 ms, and it never resumes.
  - 1.0–1.2 s survives, with 3–4 failures.
  - At a 5 s interval, an outage that falls between two due frames costs nothing, up to 2.5 s long.
- **A stalling camera** needs 45 s or more to end it: 5 × the bridge's 10 s timeout plus the 250 ms retries. 25 s survived.
- **Severity.** The job is untouched, and the panel names the cause. P3 stays.

**Y4-P3-2 — CONFIRMED, P3 (READ).**
- `external-run.ts:267-283` starts the job with no `canvasPlan`. `liveCanvasStartPatch` returns `{}` for an undefined plan (`live-canvas-run.ts:170-189`), so the watcher (`job-watch-runner.ts:73-74`) never sees an external run.
- `CameraPanel.tsx:148` starts the remembered camera only on mount. `install-camera-helpers.ts` starts it at launch only when calibrated.
- No toast is shown in either case.

**Y4-P3-3 — CONFIRMED, P3; not raised to P2.**
- **For P3.**
  - The still needs a client approved for control and the sharing opt-in, and the Settings note discloses it.
  - A calibrated camera's live picture is on the canvas by default (`camera-store.ts:154`, `overlayVisible: true`), so in the common calibrated case the PC does show the camera.
  - The gap is real only for an uncalibrated camera kept live by the watch, and for the missing record of each still (`adapter.ts:113`, "no ledger entry").
- **Not P2.** It is a visibility gap with consent on both sides, not an exposure needing only local access.

### New finding

**Y4-P1-2 (refuter) — A calibrated camera's live canvas overlay uploads the picture to WebGL on the UI thread. For an RTSP camera it re-uploads about 30 times a second whether or not the frame changed. A 4K RTSP camera holds the thread 97–98 % of every job, watch or no watch: the window-route stream stalls for seconds with the beam lit, and Abort waits 65–83 ms.**

- **Where (82a9713a4; main `8493f590c` +3 lines):**
  - `src/ui/camera/overlay/use-bed-overlay-drawing.ts`:
    - `:95` (`streaming` for `machine-rtsp`);
    - `:109-137` (`watchLiveFrames`, a `requestAnimationFrame` loop that redraws when the key changes);
    - `:211-219` (`liveFrameKey`: for a stream, `Math.floor(performance.now() / STREAM_FRAME_MS)` with `STREAM_FRAME_MS = 33`, so the key changes every 33 ms).
  - `src/ui/camera/overlay/bed-overlay-renderer.ts:148,159-163`: `gl.texImage2D(..., source)` from the `<img>` on every draw.
  - `src/ui/camera/CameraSourceView.tsx:35,82-95`: the MJPEG `<img>`.
  - `src/ui/state/camera-store.ts:154`: the overlay is visible by default.
- **Anchor:**
  - perf S1 `AREAS.md`: "Longest UI block while a job runs | 50 ms".
  - ADR-352 Amendment 1 `:86-88`: none over 50 ms.
  - Twin: commit `493809cda` (2026-10-18) cut USB redraws to the presented frames (59 → 15 a second). The MJPEG path was left sampling at 30 Hz and was measured only with a USB camera.
- **Evidence:** REPRO, browser, watch **off** throughout, 250 blocks/s, `M3` job (`out/r-job.json`):

| Camera (calibrated, overlay visible unless stated) | Long tasks in the window | UI thread blocked | Lines streamed | Dry / lit / longest stop | Abort key / stop byte |
|---|---|---|---|---|---|
| 4K RTSP-style MJPEG, 10 fps, **overlay hidden** | 0 | 0 % | 3,803 in 15 s | 0 / 0 / 0 ms | 1 / 14 ms |
| 4K RTSP-style MJPEG, 10 fps | **278 × 62–79 ms** (20 s) | **97.4 %** | **119 in 20 s** | **19.4 s / 10.7 s / 5.3 s** | 65 / 76 ms |
| Same, repeated, GPU forced on | 205 × 65–95 ms (15 s) | 97.8 % | 111 in 15 s | 11.3 s / 4.1 s / 5.5 s | 74 / 83 ms |
| 1080p RTSP-style MJPEG | 0 (many short tasks) | — | 3,293 in 20 s (−35 %) | 6.1 s / 3.0 s / 59 ms | 2 / 12 ms |
| 4K polled JPEG (laser camera, 1.5 s) | 14 × 59–82 ms | 4.5 % | 4,941 | 439 / 223 / 47 ms | 0 / 5 ms (missed) |
| 4K polled JPEG at the phone's 500 ms (ADR-448 D2) | 41 × 52–80 ms | 13.7 % | 4,801 | 922 / 450 / 64 ms | 1 / 9 ms |
| USB 1080p at 30 fps (`MediaStream`) | 0 | 0 % | 5,063 | 0 / 0 / 0 | 1 / 14 ms |

  - **Attribution.** The same 4K RTSP source with the overlay hidden gives 0 long tasks and no stall. 1080p polled and USB give none. The 4K MJPEG stub sent 10 frames a second while the page made about 14 uploads a second, each a 60–95 ms task. So unchanged frames are uploaded again.
- **Scenario.**
  1. A maker has a 4K RTSP IP camera calibrated over the bed, shown on the canvas as it is by default.
  2. Their USB adapter lacks a unique identity, so KerfDesk streams from the window, and the job is a constant-power (`M3`) photo engrave.
  3. Throughout the job the head stops for up to 5 s at a time with the beam on. That is the burn-through and fire outcome Job Review's window-route advisory describes, here with no edit, Undo or import by the operator.
  4. On the worker route the job streams normally, but every key, Pause and Abort waits up to about 80 ms behind a nearly continuous run of uploads.
- **Severity: P1.**
  - **For P1.**
    - It silently produces wrong physical output on the window route: lit dwell stops of up to 5.5 s, and a job slowed about 35×.
    - METHOD §3 has no reach clause.
    - The only warning (`window-stream-lit-stop-warnings.ts:24-26`) names a different cause and implies that not editing is safe (G6).
  - **For P2.**
    - On the worker route, the default for a USB GRBL adapter with a unique identity, it is an Abort delay of at most 65–95 ms, about 1.3–1.9 times the budget.
    - A `M4` job stops dark, so the job crawls but is not burned.
    - 2K (2560 × 1440) cameras were not measured; 1080p RTSP already costs 35 % of window-route throughput.
  - **Coordinator.** This is the overlay rather than ADR-490's watch, so it may belong to the camera everyday-panel area. It was found here because the live overlay is how an operator watches a job.
- **Announced?** No. Only the code comment at `:206-210` describes the 30 Hz sampling, as a design choice, with no cost stated. I did not find it in an ADR.
- **Novelty:** new. Perf S1–S9 did not cover the camera, Y1–Y3 measured overlay accuracy, not thread time, and #1546's open items do not include it.
- **Fix direction:**
  - Redraw an MJPEG `<img>` only when a new part arrives. Better, decode the stream off the thread: fetch the multipart body, `createImageBitmap` each part in a worker, and upload the `ImageBitmap` or a `VideoFrame`.
  - Cap the overlay's upload size to the canvas's on-screen size (`createImageBitmap(..., { resizeWidth })`).
  - Add a browser guard: a 4K MJPEG overlay during a job with no task over 50 ms.

### Challenges to "Verified clean"

- **"The stream itself is unaffected … the serial worker refills on its own" — refuted for the run the auditor made.**
  - The in-page fake port has no USB identity (`getInfo()` returns `{}`). KerfDesk therefore falls back to the window route (ADR-354 decision 2; `web-serial.ts:122-131`); every run of mine recorded `jobStreamHost: 'window'`. The worker never refilled in that harness.
  - The auditor's simulator (`zz-w7r` copy) also hides catch-up starvation. When its planner empties while lines still sit in its RX queue, it zeroes the elapsed credit without running them and without logging, so lines-streamed counts cannot show a stall.
  - Measured properly, the watch drains the controller on the window route, with `M3` lit stops up to 373 ms (Y4-P1-1 above).
  - On the real worker route (ADR-354), the refill continues by its design and its own evidence. That was not measured here.
- **"Phone as camera" — holds for the failure path, misses the cost.**
  - ADR-448 D5's "largest video resolution" leads to 4K, 12 MP and 24 MP frames, at 108–297 ms per frame.
  - D2's 500 ms poll makes a calibrated 4K phone's overlay block 13.7 % of the job.
- **"Pause" — holds.** Frames are kept only while running. One thing to note: after Resume, the first tick captures at once if a frame is due, so the first block lands right after Resume. This is READ only (`timelapse-recorder.ts:73-76`).
- **"Several cameras (ADR-446)" — holds.**
  - Only one source is live at a time (`camera-store` `sourceState`), so two cameras cannot be watched at once.
  - Switching ends the recording with a note.
- **"Size / 12-hour job" — holds.**
  - The 480-frame cap halves the frames and doubles the interval, so in a long job the blocks also thin out: at 5 s, every 10 s after 40 minutes, and every 20 s after 80.
  - The per-frame transient at 24 MP is several full-frame copies (`decode-jpeg.ts:26-40`, then `new Uint8ClampedArray` in `encodeJpegPicture`). It ran without failure, but its peak was not recorded.
- **"Save video during a running job" — holds.** **Save video…** is offered only once `recording` is false (`TimelapseResult.tsx:19-26`), so never during a watched job.
  - During a later unwatched job it draws 1024 px frames at 15 fps from `createImageBitmap`, which is light. Not measured.
  - A new watched job started while saving replaces the store's frames, but the save keeps its own array.
- **"Crash mid-recording" — holds as announced.**
  - The frames are in-memory `Blob`s, so a renderer crash loses them.
  - The recovery card (ADR-688) does not mention them.
  - ADR-490's Consequences say the timelapse is "not saved with the project". Not raised.
- **"Remote still gating" and "where recordings live" — hold.** I re-read them and found nothing to add.

### Not verified

- **The ADR-354 worker route.** A fake port cannot be opened inside the worker. There, the Y4-P1-1 and Y4-P1-2 effect is the Abort delay alone; the refill should continue.
- **Real cameras.**
  - Real ffmpeg MJPEG previews and 2K RTSP cameras.
  - Real phones (IP Webcam's frame sizes, lock-screen behaviour).
  - USB at 4K.
  - Other GPUs: all runs used an Intel Iris Xe through ANGLE/D3D11.
- **Other builds.** The Electron Desktop build was not run; Vite dev in Chrome 1248 only.
- **Not timed.** Peak memory per 24 MP frame. The burn check's after picture, which runs once the job has finished.
- **The first frame after Resume**, and Save video during an unwatched job, were READ only.

### Repro files

All files are in scratchpad `zz-y4r\`. The browser specs run in `zz-y4r\mut`, a mutable copy of `j21-main` whose `node_modules` is a junction; remove it only with `cmd /c rmdir`.

**How to run.**
- **Vite:** from `mut`, `node node_modules/vite/bin/vite.js . --config vite.zz.config.ts --mode desktop --host 127.0.0.1 --port 4895 --strictPort`.
- **A browser run:** `node node_modules/@playwright/test/cli.js test e2e/zz-y4r-job.e2e.ts --config playwright.zz.config.ts --workers=1`, with these environment variables:
  - `ZZ_CASE=on|off`;
  - `ZZ_W` and `ZZ_H` (frame size);
  - `ZZ_CAL=1` (calibrated, with the homed stub);
  - `ZZ_SRC=jpeg|rtsp|usb`, plus `ZZ_POLL` and `ZZ_OVERLAY=0`;
  - `ZZ_BPS`, `ZZ_INTERVAL` and `ZZ_SNAP_MS`;
  - `ZZ_GPU=1`, `ZZ_PROBE_MS`, `ZZ_OUT` and `ZZ_TAG`.
- **Summary:** `node sum.mjs out/r-job.json [filter]` prints the summary.

**Files.**
- `mut/e2e/zz-y4r-job.e2e.ts`: the job, stub camera (JPEG, MJPEG, USB stream), probes and Abort (Y4-P1-1, Y4-P1-2, Y4-P2-1).
- `mut/e2e/fixtures/zz-y4r-grbl.js`: the wall-clock GRBL with dry and lit accounting.
- `mut/src/ui/camera/job-watch/job-burn-route.ts`: the one-line homed-state stub (`__ZZ_FORCE_BED__`), harness only.
- `mut/playwright.zz.config.ts`, `mut/vite.zz.config.ts`.
- `out/r-job.json`: all 22 browser runs.
- `r3-refuse.mts` → `out/r3-refuse.jsonl`: the outage sweep (Y4-P3-1). Run it with `node --no-experimental-webstorage --import ./register.mjs r3-refuse.mts`; the loader is `ts-resolve.mjs` + `register.mjs` (zz-w4's, with asset stubs).

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Y4-P1-1","refuter":"CONFIRMED","severity":"P1","evidence":"REPRO","note":"own harness; flat path in a streamed job measured; window-route M3 lit stops up to 373 ms per frame; in-block Abort +63/+64/+195 ms (4K/12 MP/24 MP); 720p/1080p plain clean"},
  {"id":"Y4-P2-1","refuter":"CONFIRMED","severity":"P2","evidence":"REPRO","note":"4K still 62-86 ms block; 1080p still no long task; phone asks only on tap; same fix cluster as Y4-P1-1"},
  {"id":"Y4-P3-1","refuter":"CONFIRMED","severity":"P3","evidence":"REPRO","note":"refusal >=1.5 s over a due frame ends it (5 fails in 1.06 s); stall needs >=45 s"},
  {"id":"Y4-P3-2","refuter":"CONFIRMED","severity":"P3","evidence":"READ"},
  {"id":"Y4-P3-3","refuter":"CONFIRMED","severity":"P3","evidence":"READ","note":"calibrated camera is visible on the canvas by default; gap is uncalibrated + no record of stills"},
  {"id":"Y4-P1-2","refuter":"RAISED","severity":"P1","area":"camera-job-watch (overlay)","file":"src/ui/camera/overlay/use-bed-overlay-drawing.ts","line":215,"anchor":"perf S1 50 ms running-job budget; ADR-352 Amd 1; twin 493809cda","evidence":"REPRO","known":false,"summary":"Calibrated camera overlay uploads the live picture with texImage2D on the UI thread; RTSP MJPEG re-uploaded ~30/s regardless of new frames. 4K RTSP: UI thread 97-98% blocked during every job (watch off), window route 109-119 lines in 15-20 s, head stopped 11-19 s with M3 lit 4-11 s (single stops 5.3-5.5 s), Abort 76-83 ms; overlay hidden: 0 long tasks, no stall"}
]
```

Refuter counts: raised 6, refuted 0, P1 2, P2 1, P3 3, known 9
