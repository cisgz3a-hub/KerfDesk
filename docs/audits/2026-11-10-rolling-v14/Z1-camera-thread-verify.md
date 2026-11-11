# Rolling audit v14 — Z1 Camera thread verify

- **When:** 2026-11-10, 17:15–20:20 +0800. **Tree:** origin/main @ `74191e0c7`, which holds #1691 (`21ad46fd7`) and #1695 (`dc7c8dcbb`).
  - Repros ran on a mutable copy of the scratchpad export `j23-main` (`74191e0c7`, `node_modules` a junction), in scratchpad `zz-z1\mut`, plus Node scripts in `zz-z1\`.
  - The only source change in that copy is Y4r's one-line homed-machine stub in `job-burn-route.ts` (`__ZZ_FORCE_BED__`), so a calibrated whole-bed job is placed on the bed and the burn check arms.
  - Since `dc7c8dcbb`, main merged #1696 (docs), #1698, #1693 and #1697. None of them touches `src/ui/camera/**`, `src/core/camera/**`, `src/ui/remote-control/**` or `src/platform/web/**`. #1693 changes one parameter name in `electron/camera-frame-proxy.test.ts`.
- **Scope:** verify the v13 camera fixes:
  - #1691, ADR-440 Amd 10: the overlay's bridge-camera pictures (Y4-P1-2).
  - #1695, ADR-490 Amd 2 and ADR-598 Amd 5: job watch and remote stills in a picture worker (Y4-P1-1, Y4-P2-1).
  - Code read: `src/ui/camera/picture-worker/*` (3 files), `src/ui/camera/overlay/{machine-frame-feed,mjpeg-parts,use-machine-frame,use-bed-overlay-drawing,bed-overlay-renderer,bed-overlay-shader}.ts`, `src/ui/camera/WorkspaceCameraOverlay.tsx`, `src/ui/camera/job-watch/{timelapse-recorder,job-watch-camera,burn-check-run,job-watch-runner}.ts`, `src/ui/remote-control/{machine-camera,adapter}.ts`, `src/ui/camera/{frame-source,frame-capture,decode-jpeg,CameraSourceView}.ts(x)`, `src/ui/camera/helpers/{install-camera-helpers,moved-check}.ts`, `src/ui/state/{camera-source-actions,camera-snapshot-source}.ts`, the three amendment ADRs and both browser guards.
- **Lenses run:**
  - **L10 (fix verification):** every v13 number re-measured with the same setups as Y4 and its refuter.
  - **L3 (twin routes):** USB, RTSP bridge, phone (polled 500 ms) and machine-JPEG cameras; overlay vs job watch vs remote still; camera start and switch (ADR-446); head camera (READ).
  - **L6 (failure paths):** the worker failing to load, crashing and never answering; OffscreenCanvas missing; `resizeWidth` unsupported; flood and stall.
  - **L12:** CI of #1691, #1695 and the merge of both.
- **Cameras:** synthetic only.
  - A 127.0.0.1:4811 stub serves one synthetic bed photo as a JPEG (`/frame.jpg`) or a 10 fps multipart MJPEG (`/mjpeg`, as ffmpeg `mpjpeg` sends it). Sizes: 1080p (631 KB), 4K (2.5 MB), 12 MP 4:3 (3.6 MB) and 24 MP (7.1 MB).
  - A USB camera is a 30 fps canvas `MediaStream`.
  - The calibrated camera is the repo's overhead fixture, calibrated at the frame's own size (`wideLens(W)`). At its fixture size of 1280 × 720, main's ADR-440 Amd 9 check gives plain frames for a 4K picture, so the flat path would not run. The first three calibrated runs were made that way by mistake; they are kept, tagged `-calAt1280x720`, and are not used below.
  - No real camera, network, ffmpeg or hardware was used. My Vite server (127.0.0.1:4897) and stub are stopped.
- **Controller:** Y4r's wall-clock GRBL stand-in (`zz-z1-grbl.js`, a copy of `zz-y4r-grbl.js`), streaming from the window: the fake port has no USB identity, so `jobStreamHost` was `window` in every run. The job is a 380 mm square filled at 0.05 mm with `M3` constant power, through the real Frame → Start → Job Review → Start job path, at 250 or 400 blocks/s.
  - Probes: a key at random 25–75 ms gaps for 20 s, then one Ctrl+. Abort through CDP. Long tasks, and Long Animation Frames with script attribution, are recorded.
- **Memory gates:**
  - Browser runs (headless, one worker, one spec): 22 completed runs at 2.27–4.10 GB free.
  - About fifteen attempts were refused below 2 GB (0.17–1.87 GB free), because other sessions on this PC were using the memory. Each case ran later, except the two under Not verified.
  - Three runs failed:
    - the snapshot loop outlived the test, after the run had saved its data;
    - one Start did not show Pause in time, and was re-run;
    - the OffscreenCanvas-removed run failed before any measurement (see Not verified).
  - Vitest: not used. The Node scripts ran outside the gates.
- **Counts:** 4 raised → refuter pending → P1 1 / P2 1 / P3 2 (+ 6 KNOWN re-checked).

## Headline

**Job watch and remote stills are fixed. The overlay is not: its fix still shrinks every 4K picture on the UI thread.**

- **Fixed (#1695).** Job watch and remote stills no longer block the UI thread at any picture size.
  - Watch on, the timelapse every 2 s plus the burn check: 0 long tasks in 20 s. That holds for 4K, 12 MP and 24 MP plain frames, for 1080p and 4K calibrated whole-bed jobs, and for a calibrated USB camera.
  - Abort's stop byte reached the controller 6–16 ms after the key; with the watch off it was 11–16 ms.
  - The burn check's before picture at Start adds no long task. Start's own 51–82 ms tasks are there with the watch off too, and Long Animation Frame attribution puts them in the Start click, the recovery archive and the output-preparation worker client.
  - The worker's pictures match the old in-window pictures **bit for bit**: the flattened timelapse frame and the burn check's before picture, for three region sizes. Plain frames and stills differ only by resampling (mean 1.1 and 2.5 levels of 255).
  - Remote stills: three clients polling every 50 ms got one shared still every 1.44–1.75 s, with no long task.
- **Not fixed (Z1-P1-1).** #1691 decodes the overlay's pictures with `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })` on the window. Chrome decodes off the thread, but it does the **resize on the UI thread**.
  - Per picture: 67–92 ms for a 4K picture shrunk to 1,340 px, and **118–182 ms at the 1,920 px cap**. 12 MP takes 179–297 ms and 24 MP 292–369 ms.
  - The same call in a worker gives no long task.
  - On a 1920 × 1080 window (the canvas is 1,278 CSS px, so the cap applies) with a calibrated 4K RTSP camera, during a job:
    - the thread was held **30 %** of the time, in 37 tasks of 50–356 ms;
    - an Abort at a random moment would wait p90 135 ms, p99 214 ms, max 326 ms;
    - on the window route, **2,179** lines were streamed in 20 s against 3,407 with the overlay hidden;
    - the head stopped lit for **4.0 s** in all, with single stops up to **407 ms** (control: 2.2 s, at most 52 ms).
  - A 4K phone camera polled every 500 ms gives the same picture: 34 tasks of 141–213 ms, 30 %.
  - The v13 figures were 97–98 %, 119 lines and 5.5 s single stops, so it is much better but still far over the 50 ms budget.
  - The fix's guard passes because it runs at Playwright's 1280 × 720 viewport, where the resize targets 1,340 px and sits near 50 ms.
- **Failure paths (Z1-P3-1).** If the picture worker cannot load, or crashes, the timelapse records nothing for the rest of the job and says nothing. The recorder makes a new worker and fetches a new frame every 250 ms (80 of each in a 20 s job). The burn check blames the camera. A worker that never answers leaves the recording "recording" forever, so Save video is never offered.
- **A missed twin (Z1-P2-1).** Starting or switching a camera during a job (ADR-446), including opening the Camera panel to watch the job, runs the camera-moved check 3 s later. Its capture still decodes the full frame on the UI thread: one **141 ms** block at 4K, and an 138 ms lit stop on the window route.
- **Smaller (Z1-P3-2).** The overlay fits the camera model to the JPEG header's size, but `createImageBitmap` applies EXIF rotation. A picture tagged as turned 90° is then refused as the wrong size, where the old `<img>` path placed it.

## Before and after

v13 figures are from Y4 and its refuter (`82a9713a4`); "now" is `74191e0c7`. All runs stream from the window with `M3`. "Lit stop" is time the simulated head stood still with the beam on.

| v13 measurement | v13 | Now (`74191e0c7`) | Source |
|---|---|---|---|
| Abort with the watch on (stop byte after the key) | 74–205 ms in a block (4K–24 MP); 154 ms (auditor) | **6–16 ms** in all 9 watch-on runs (4K, 12 MP, 24 MP plain; 1080p and 4K calibrated whole bed; USB 1080p calibrated) | `out/z-job.json` |
| Abort with the watch off | 10–19 ms | 11–16 ms | same |
| Long tasks in 20 s, watch on | 10 × 77–106 ms (4K), 108–164 (12 MP), 218–297 (24 MP); 9 × 67–83 ms (calibrated whole bed) | **0** in every case above; probe key delay max 2–16 ms | same |
| Window route, watch on, lit stops | up to 110 ms (4K), 161 (12 MP), 234 (24 MP), 373 ms (4K calibrated) | at 400 blocks/s longest stop 17–18 ms, the same as the watch-off control (18 ms); at 250 blocks/s calibrated 0–12 ms | same |
| Burn-check before picture at Start | 145–278 ms long task | **no camera task**: Start shows 51 and 72 ms tasks with the watch on and 58, 61 and 82 ms with it off (calibrated 4K). LoAF puts them in the Start click, `indexeddb-recovery-backend.ts` and `output-preparation-worker-client.ts`. The before picture went to the worker (`flat-image`, round trip 426–564 ms off the thread) | same, `loaf` |
| RTSP overlay 4K, UI thread held | 97–98 % | **6.6 %** at a 1280 × 720 window (22 tasks of 50–84 ms); **30.2 %** at 1920 × 1080 (37 tasks of 50–356 ms) | same |
| RTSP overlay 4K, lines streamed vs overlay hidden | 109–119 vs 3,803 (15–20 s) | 1280 × 720: 4,979 in 20 s (no hidden control at that size). 1920 × 1080: **2,179 vs 3,407** hidden | same |
| RTSP overlay 4K, lit stops | 4–11 s in all; single stops 5.3–5.5 s | 1280 × 720: 201 ms in all, longest 76 ms. 1920 × 1080: **4.0 s, longest 407 ms** (hidden: 2.2 s, longest 52 ms) | same |
| RTSP overlay 4K, Abort | key 65–74 ms, stop byte 76–83 ms | stop byte 27 and 57 ms (both presses missed a block); probe key delay p99 214 / max 326 ms at 1920 × 1080 | same |
| Phone camera 4K polled at 500 ms, overlay | 41 × 52–80 ms, 13.7 % | 1920 × 1080: **34 × 141–213 ms, 29.9 %**; lines 2,279; longest lit stop 234 ms | same |
| Overlay uploads per picture | ~14 uploads/s for 10 pictures/s (unchanged frames re-uploaded) | **one per picture**: 40 in 20 s at the job pace of 2/s (1,340 × 754 bitmaps, 3.8–6 ms each); 33 at 1,917 × 1,079 (13–27 ms each) | same |
| Remote still 4K | 62–195 ms block per still; 2 a second per client allowed | **0 long tasks**. 3 clients each asking every 50 ms got 54 replies from **13 stills, 1,441–1,752 ms apart**, shared in threes; 51 KB, 1024 × 576 | `snap50x3` |
| Final timelapse frame after the job (in-window, announced) | not timed | 85–135 ms (4K, 12 MP), 322 ms (24 MP), about 3.1 s after Abort | `afterAbort` |

## Findings

### Z1-P1-1 — The overlay's fix still shrinks each bridge-camera picture on the UI thread: a 4K picture costs 118–182 ms at the 1,920 px cap. During a job on a full-HD window the thread is held 30 %, Abort can wait up to 326 ms, and the window route stops lit for up to 407 ms

- **Where (`74191e0c7`):**
  - `src/ui/camera/overlay/machine-frame-feed.ts`:
    - `:100-104` (`defaultDecode`): `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })` on the window;
    - `:82-83`: the resize width is the display width whenever it is under the picture's width;
    - `:41-42`: at most every 100 ms idle and 500 ms in a job.
  - `src/ui/camera/overlay/use-machine-frame.ts:52-54` (`overlayDisplayWidth`): 1.5 × the canvas's device width, capped at 1,920, so any canvas of 1,280 CSS px or more at 100 % scaling, or 854 px at 150 %, gets the cap.
  - `src/ui/camera/WorkspaceCameraOverlay.tsx:69`.
  - The guard, `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts:48-50`, runs at Playwright's default 1280 × 720 viewport (no `setViewportSize`; `playwright.config.ts` sets none), so it tests a 1,340 px resize only.
- **Anchor:**
  - **Contract:** ADR-440 Amd 10 D1 says each new picture "is decoded by `createImageBitmap` from its bytes, which browsers do off the UI thread, already shrunk to what the canvas shows". Its Consequences say "no task over 50 ms".
  - **Budget:** perf S1 `AREAS.md`, 50 ms for the longest UI block while a job runs; ADR-598 Amd 5.
  - **Twin:** the job-watch capture in the same release calls `createImageBitmap(blob)` with no resize (`camera-picture-client.ts:77`) and causes no long task.
  - **Precedent:** v13 Y4-P1-2, the same symptom from the same overlay, P1. K1-P1-1 and S1-P2-1, lit stops on the window route.
- **Scenario:**
  1. A maker has a 4K RTSP IP camera, or a 4K phone camera (ADR-448), calibrated over the bed. The overlay is shown, as it is by default (`camera-store.ts`, `overlayVisible: true`).
  2. KerfDesk runs maximised on a 1920 × 1080 screen, or on any laptop at 125–150 % scaling, so the overlay asks for 1,920 px pictures.
  3. During a job the overlay takes a picture every 500 ms, and each one holds the UI thread 130–360 ms while Chrome shrinks it.
  4. On the window route (an adapter with no unique identity, or Background streaming off), the controller runs dry for up to 0.4 s at a time with the beam lit under `M3`. On either route, an Abort or Pause pressed in a block waits for it.
  5. Between jobs it is 10 pictures a second at most; the measured pace was about 2 a second, each over 100 ms, so a key release that ends a continuous jog also waits.
- **Evidence:**
  - **REPRO, browser** `zz-z1/mut/e2e/zz-z1-decode.e2e.ts` → `out/z-decode.json`. Eight calls of each kind, on a blank page:

    | Picture | `createImageBitmap(blob)` (job watch) | `resizeWidth` 1,340, medium (overlay) | `resizeWidth` 1,920, medium (overlay cap) | 1,340, `low` | 1,340, medium, **in a worker** |
    |---|---|---|---|---|---|
    | 4K | 1 task in 8 (75 ms) | **8 × 67–92 ms** | **8 × 118–182 ms** | 0 | **0** |
    | 12 MP | 0 | 8 × 87–171 ms | 8 × 179–297 ms | 6 × 50–60 ms | 0 |
    | 24 MP | 0 | 8 × 157–218 ms | 8 × 292–369 ms | 8 × 57–86 ms | 0 |

    - Long Animation Frame attribution gives the script only 10–46 ms of each task. The rest is native work in resolving the promise: the resize.
    - In the 12 MP and 24 MP plain column, the tasks recorded are my own `texImage2D` of the full-size bitmap, which the overlay never does. They are excluded.
  - **REPRO, browser** `zz-z1/mut/e2e/zz-z1-job.e2e.ts` → `out/z-job.json`. A calibrated 4K camera, watch off, `M3` whole-bed job, 250 blocks/s, window route, 20 s:

    | Run | Long tasks | UI thread held | Probe key delay p90 / p99 / max | Lines | Dry / lit / longest stop | Overlay uploads |
    |---|---|---|---|---|---|---|
    | RTSP 4K, 1280 × 720 window (bitmap 1,340 × 754) | 22 × 50–84 ms | 6.6 % | 10 / 49 / 57 ms | 4,979 | 343 / 201 / 76 ms | 40 |
    | RTSP 4K, **1920 × 1080** (bitmap 1,917 × 1,079) | **37 × 50–356 ms** (p50 164) | **30.2 %** | **135 / 214 / 326 ms** | **2,179** | **10.6 s / 4.0 s / 407 ms** | 33 |
    | Same, overlay hidden (control) | 0 | 0 % | 6 / 23 / 32 ms | 3,407 | 4.0 s / 2.2 s / 52 ms | 0 |
    | Phone 4K polled at 500 ms, 1920 × 1080 | 34 × 141–213 ms | 29.9 % | 130 / 196 / 206 ms | 2,279 | 9.6 s / 5.0 s / 234 ms | 32 |

    - Each overlay picture lines up with one long animation frame. Script in it is 13–18 ms (`machine-frame-feed.ts`, the promise resolving); the frame lasts 151–357 ms.
    - The control's 4 s of short dry stops is the window route at this PC's load at the time, with no camera work. The snapshot run made at the same time had the same 3,405 lines.
    - Abort: both single presses missed a block (stop byte 27 and 57 ms). The probe distribution is what an Abort at a random moment waits.
    - A laser's own 4K camera at its default 1.5 s poll, at the 1280 × 720 window, gave 12 tasks of 53–108 ms in 20 s, one per picture. Every one is attributed to `machine-frame-feed.ts` (run `on-jpeg-…-cal-…-wfail`, taken under heavier load on this PC). An earlier run of the same setup gave none, so at 1,340 px it depends on the load.
  - The PR's own guard measured no long task at 1,340 px on CI and on the author's machine. On this PC the same width gives 67–92 ms in isolation and 50–84 ms in a job, so the guard sits on the budget line and never tests the cap.
- **Severity:** P1.
  - **For P1:**
    - The brief rates anything that still delays Abort past 50 ms, or stalls a lit stream, P1. Both are measured: probe delays to 326 ms, and lit stops of 407 ms against 52 ms in the control.
    - It is the condition Y4-P1-2 was raised for: a calibrated 4K bridge camera on the default overlay during a job. The 1,920 px cap is the usual case on a full-HD or scaled display, not a corner.
    - METHOD §3 has no reach clause. The ADR states the opposite of the behaviour (D1, Consequences), so it is unannounced.
  - **For P2:**
    - It is 3–30 times better than v13: 30 % of the thread instead of 97 %, single lit stops of 0.4 s instead of 5.5 s.
    - At 1,340 px on a fast CPU the resize may stay under 50 ms, as the guard found on CI.
    - A 1080p camera was not measured with the new feed. Its resize is about a quarter of the 4K cost.
- **Announced?** No. ADR-440 Amd 10 says the picture is shrunk off the UI thread.
- **Novelty:** new. It is a regression of the fix's own claim, so Y4-P1-2 is only partly fixed.
- **Fix direction:**
  - Decode and shrink in a worker: run `createImageBitmap(blob, { resizeWidth })` in the camera picture worker (or one of its own) and transfer the bitmap back. Measured: no long task at any size.
  - Or decode at full size with `createImageBitmap(blob)` (off the thread, measured clean) and let the GPU scale it. A 4K `texImage2D` of a decoded bitmap measured 28–67 ms with a `gl.finish`, so that would need its own check.
  - `resizeQuality: 'low'` alone removes the task at 4K, but not at 12 or 24 MP (50–86 ms).
  - Make the guard run at 1920 × 1080 (or set `devicePixelRatio` 1.5) so the 1,920 px cap is tested, and add a 12 MP polled-JPEG case.
- **Refuter:** PENDING.

### Z1-P2-1 — Starting or switching a camera during a job still decodes a full frame on the UI thread: the camera-moved check's capture 3 s later is a 141 ms block at 4K, with a lit stop on the window route

- **Where (`74191e0c7`):**
  - `src/ui/camera/helpers/install-camera-helpers.ts:114-141` (`checkForMoves`): for every new live source, `MOVED_CHECK_SETTLE_MS` (`:146`, 3 s) later it calls `captureSourceFrame(source)` (`:134`). There is no job check, and no calibration check before the capture.
  - `src/ui/camera/frame-source.ts:116-139` → `src/ui/camera/decode-jpeg.ts:26-40` (`decodeToRgba`): `drawImage` and `getImageData` of the full frame on the UI thread. For USB it is `frame-capture.ts:67-84`.
  - `src/ui/camera/helpers/moved-check.ts:52-89`: with a saved view reference, `viewThumbnail` and `compareViews` then run on the same thread (not measured: my stub camera had no reference, so this is a lower bound).
  - A snapshot or phone camera started mid-job also captures in-window as it starts (`src/ui/state/camera-snapshot-source.ts:82-85`), so that is a second block (READ).
- **Anchor:**
  - **Twin:** ADR-490 Amd 2 moved job watch and stills off the thread because "Abort is sent from the UI thread". This capture is the same `decodeToRgba` that Y4-P1-1 named (`decode-jpeg.ts:26-40`), on a path the fix did not cover.
  - **Budget:** perf S1, 50 ms while a job runs.
  - **Contract:** ADR-446 lets the operator switch cameras at any time, and ADR-663 Amd 1 starts the remembered camera when the Camera panel opens (`CameraPanel.tsx:146-148`).
- **Scenario:**
  1. A job runs with the watch off, so the camera is not live.
  2. The operator opens the Camera panel to watch it. The panel starts the remembered 4K camera, or the operator switches to a second camera (ADR-446).
  3. Three seconds later the moved check holds the UI thread about 140 ms. On the window route the controller runs dry with the beam lit, and an Abort pressed then waits.
- **Evidence:** REPRO, browser, `zz-z1-job.e2e.ts` with `ZZ_SWITCH_MS=4000` → `out/z-job.json`, key `off-jpeg-3840x2160-bps250-i2-switch`. A 4K machine-JPEG camera, uncalibrated, watch off; the probe switches to a second source object 4.04 s into the job:
  - exactly one stub fetch, and **one long task of 141 ms at 7.37 s** (3.3 s after the switch). LoAF attributes 140 ms of it to `decode-jpeg.ts` (the promise after `createImageBitmap`, then `drawImage` and `getImageData`);
  - probe key delay max **107 ms**, against 32–39 ms in the same period's controls;
  - window route: the longest stop was **138 ms**, against 52–54 ms in the overlay-hidden and panel-open controls.
  - The rest of that run was clean: 0 other long tasks in the probe window.
- **Severity:** P2.
  - **For P1:** the brief rates anything that delays Abort past 50 ms, or stalls a lit stream, P1. Both happened here (107 ms key delay; a 138 ms lit stop). Opening the Camera panel to watch a running job is an ordinary act. With a reference saved, the comparison adds to the block.
  - **For P2:** it is one block per camera start or switch, not a recurring one, and only when the operator starts or switches a camera mid-job. In v13, a single operator- or client-triggered block of the same size (a remote still, Y4-P2-1) was rated P2. A 1080p camera's decode is about a quarter of this.
- **Announced?** No.
- **Novelty:** new. The check came with #1680/#1683 (ADR-663 Amd 5), after Y4's tree. Y1 audited its accuracy, not its thread time, and #1695 did not route it through the worker.
- **Fix direction:**
  - Take the moved check's frame through the picture worker: `pictureClient().capture(source)`, then read the thumbnail in the worker. `viewThumbnail` needs only a small picture, so decode with `createImageBitmap(blob, { resizeWidth })` there.
  - Or defer the check while a job is active, and run it when the job ends.
  - Same for the snapshot source's first frame.
- **Refuter:** PENDING.

### Z1-P3-1 — A picture worker that cannot load, or crashes, ends the timelapse silently: no frames, no note, a new worker and a new 4K frame every 250 ms, and the burn check blames the camera; a worker that never answers keeps the recording "recording" forever

- **Where (`74191e0c7`):**
  - `src/ui/camera/picture-worker/camera-picture-client.ts`:
    - `:23-31`: the fallback to the in-window path is chosen only by feature tests (`Worker`, `OffscreenCanvas`, `createImageBitmap`), once, never on a failure;
    - `:37-42` (`failAll`): an `error` or `messageerror` answers every pending request `failed` and drops the worker;
    - `:43-57`: the next request makes a new one;
    - `:60-66`: `run` has no timeout.
  - `src/ui/camera/job-watch/timelapse-recorder.ts`:
    - `:164,177-179`: a `failed` reply becomes `null`;
    - `:84-93`: `null` resets `failures` to 0 and adds nothing, so the frame stays due and the next 250 ms tick tries again, and the 5-failure note never comes.
  - `src/ui/camera/job-watch/burn-check-run.ts:136-141`: a `failed` reply gives "The camera did not send a picture as the job started."
  - `src/ui/camera/job-watch/job-watch-runner.ts:171,193`: `endJob` awaits the before picture before `recorder.finish`, so a request that is never answered leaves `recording: true`.
- **Anchor:**
  - **Contract:** ADR-490 Amd 2 D5: "Where workers are missing … the in-window path stays as it was." A worker that is present but fails has no path.
  - **Twin:** the camera's own failures are counted, end the recording after five, and leave a note (`timelapse-recorder.ts:84-87`, Y4-P3-1). The worker's failures are not counted.
  - **Precedent:** `vite.config.ts:286-302` records that a worker failing to load in the cross-origin-isolated browser edition is a real failure mode ("Trace worker errored"). The camera worker is built under the same `-isolated-` rename.
- **Scenario:**
  1. Record a timelapse and Check the burn are ticked. The camera picture worker fails to load (an out-of-date cached script, a blocked module worker), or it crashes on a 24 MP picture.
  2. The job runs normally, but no frame is kept. The Camera panel shows the recording as running with no note, and the burn check says the camera sent no picture, which is not the cause.
  3. Meanwhile the window fetches a 4K frame and makes a new worker four times a second until the job ends.
- **Evidence:**
  - **REPRO, Node** `zz-z1/n1-worker-fail.mts` → `out/n1-worker-fail.jsonl`. The real `pictureClient`, `startTimelapse` and `takeBeforePicture` ran against a stand-in global `Worker` on a virtual clock, for a 20 s job at a 2 s interval (11 frames due):

    | Worker | Frames | Note | Workers made / frames fetched | Before picture |
    |---|---|---|---|---|
    | works (control) | 10 (+ the final one) | none | 1 / 10–11 | taken |
    | fails to load | **0** | **none**, still `recording: true` | **80 / 80–81** | "The camera did not send a picture as the job started." |
    | crashes after 3 pictures | 2–3 | none | 56–64 / 59–67 | taken (before the crash) |
    | never answers | **0**; the loop waits on the first request for good | none | 1 / 1–2 | **never resolves**, so `endJob` never calls `finish` (READ) |

  - **REPRO, browser** `zz-z1-job.e2e.ts` with `ZZ_WORKER=fail` (the camera worker's script is swapped for one that throws on load) → `out/z-job.json`, key `on-jpeg-3840x2160-cal-bps250-i2-wfail`. 4K calibrated, whole bed, watch on:
    - during the job, **45 workers were made and 45 failed** in about 22 s, with 46 requests and 0 replies, and the stub served 58 frames;
    - the timelapse stayed at 0 frames, `recording: true`, `note: null`;
    - the burn check said "The camera did not send a picture as the job started.";
    - after Abort, only the in-window final frame was kept (1 frame);
    - no long task came from the worker starts. The 12 that occurred are the overlay's resize (Z1-P1-1).
- **Severity:** P3.
  - **For P2:** the recording the operator asked for is lost for the whole job with no note, and the burn check gives a wrong cause. A never-answering worker leaves the recording unfinished, so Save video is never offered.
  - **For P3:** the job and the project are untouched, and Abort is not delayed by the recorder itself. A failing worker should be rare on Desktop.
- **Announced?** No.
- **Novelty:** new. It came with #1695.
- **Fix direction:**
  - Count `failed` replies as failures, and after the first fall back to the in-window path for that recording, or end it with a note: "The camera picture worker stopped …".
  - Stop re-creating the worker after a load failure, and remember it for the session.
  - Give `run` a timeout (say 10 s) that answers `failed`.
  - Burn check: tell a failed worker from a camera that sent nothing.
- **Refuter:** PENDING.

### Z1-P3-2 — The overlay fits the camera model to the JPEG header's size, but the bitmap it draws is EXIF-rotated: a picture tagged as turned 90° is refused as the wrong size (or drawn turned) where the old `<img>` path matched

- **Where (`74191e0c7`):**
  - `src/ui/camera/overlay/machine-frame-feed.ts:78-86`: the size comes from `jpegSize(bytes)` (the SOF header), and the bitmap from `createImageBitmap`, whose default `imageOrientation` is `from-image`;
  - `src/ui/camera/overlay/mjpeg-parts.ts:106-122` (`jpegSize`) reads no EXIF;
  - `src/ui/camera/overlay/use-bed-overlay-drawing.ts:209-212`: a `bitmap` frame's size is that header size, and `:186` fits the model to it.
  - Calibration and job watch decode with `createImageBitmap(blob)` (`decode-jpeg.ts:28`, `camera-picture-client.ts:77`), so they see the rotated size.
- **Anchor:** ADR-440 Amd 10 D2: "The picture's own size, read from the JPEG's frame header, is what the camera model is applied to … a smaller bitmap places the picture exactly as before." Twin: the old overlay used the `<img>`'s `naturalWidth` × `naturalHeight`, which is the rotated size, the same as calibration.
- **Scenario:** a phone camera app, or a snapshot camera, that tags its JPEGs with EXIF orientation 6 or 8 rather than turning the pixels. It is calibrated (in the rotated frame). On the canvas the overlay now says the picture is 640 × 480, not the 480 × 640 it was calibrated at, and draws nothing. Before #1691 it was placed. Orientation 3 (180°) keeps the size, so it is unaffected.
- **Evidence:** REPRO, browser, `zz-z1/mut/e2e/zz-z1-pixels.e2e.ts` → `out/z-pixels.json` (`exifOrientation6`). A 640 × 480 JPEG with an EXIF orientation 6 segment:
  - `jpegSize` gives 640 × 480;
  - `createImageBitmap` gives 480 × 640, and with `resizeWidth` 320 it gives 320 × 427;
  - `<img>` `naturalWidth` × `naturalHeight` gives 480 × 640.
  - Whether a camera in use sends such tags is not known: no real camera was used, and ffmpeg's `mpjpeg` writes none.
- **Severity:** P3. ADR-440 Amd 9's size check turns it into a notice and no picture rather than a misplaced one, and the reach is unknown.
- **Announced?** No.
- **Novelty:** new, from #1691.
- **Fix direction:** decode with `imageOrientation: 'none'` everywhere the model is fitted, or swap the header's width and height when the EXIF orientation is 5–8. Add the case to `mjpeg-parts.test.ts`.
- **Refuter:** PENDING.


## KNOWN: status on `74191e0c7`

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y4-P1-1 (ADR-490 Amd 2) | Job watch decodes, flattens and encodes on the UI thread; Abort 74–205 ms | **Fixed, holds** | 0 long tasks with the watch on at 4K, 12 MP, 24 MP and calibrated whole-bed; Abort 6–16 ms; pictures bit-identical (`z-job.json`, `z-pixels.json`) |
| Y4-P2-1 (ADR-490 Amd 2) | Remote still 62–195 ms per 4K still; no pacing | **Fixed, holds** | 0 long tasks; one still at a time, 1.44–1.75 s apart, shared by overlapping callers (`snap50x3`) |
| Y4-P1-2 (ADR-440 Amd 10) | Overlay re-uploads 4K RTSP 30 times a second; 97–98 % of the thread | **Partly fixed**: one upload per picture, and 2 a second in a job. The shrink stays on the UI thread: **Z1-P1-1** | `z-job.json`, `z-decode.json` |
| Y4-P3-1 | 5 camera failures in 250 ms retries end the timelapse | **Still open**, unchanged (`timelapse-recorder.ts:31-32,84-87,98-101`). The worker path inherits it and adds Z1-P3-1 | READ |
| Y4-P3-2 | No timelapse for G-code Inspector runs or an uncalibrated camera after a restart | **Still open**, unchanged (`job-watch-runner.ts:73-74`) | READ |
| Y4-P3-3 | Camera live with the panel closed; stills leave no trace on the PC | **Still open** | READ (`adapter.ts:113-126`) |

## Refuted

None raised and then refuted. Candidates dropped before raising:
- **"The overlay's smaller bitmap misplaces the picture."** No. In the browser (`z-pixels.json`, `overlayResize`), dots on a 4K picture keep their normalised position after `createImageBitmap(…, { resizeWidth })` to within 0.03–0.27 source pixels on average and 0.54 at most (0.12–0.16 at 1,340 and 1,920 px).
  - That is under 0.13 mm at this model's 0.25 mm per source pixel at the bed centre, and under 0.04 mm at the usual widths: below one pixel of the shrunk picture, with no bias.
  - Rounding the height (695 for 694.1) does not shift anything, because the shader samples by normalised coordinates over the header size (`bed-overlay-shader.ts:172`, `uFrameSize` = the lens's image size).
  - Y3's 0.02 mm geometry is unchanged. Only the picture's sharpness changes.
- **"The 2-a-second overlay during a job makes placement checks stale."** No. The moved check, the rescale verdicts and Check camera take their own frames (`install-camera-helpers.ts:114-141`, `moved-check.ts:52`). The overlay feed only paints. When the job ends the pace returns to 10 a second (`use-machine-frame.ts:32`). The live picture lags by up to 0.5 s plus decode in a job, and it is not used for placement then.
- **"Remote stills can be polled past the pacing."** No. Three callers asking every 50 ms got 13 stills in 20 s, 1,441–1,752 ms apart (the 1 s gap plus about 0.45 s of capture and encode). Each still was shared in threes.
- **"The worker path changes the timelapse's crop or flatten."** No. The flattened timelapse frame and the burn check's before picture are bit-identical to the old in-window ones for whole-bed, sign and coaster regions (`z-pixels.json`: 0 differing channels). The worker gets the full-size bitmap (no resize), so `flattenSpecFor` fits the same capture binding.
- **"A flooding MJPEG camera starves the UI thread through the part reader."** Not raised. At 10 fps 4K the reader's own script is 5–7 ms per frame in the LoAF data, and pictures are dropped down to the newest. 30 fps was not run.

## Verified clean

- **Job watch, every size and route (L10, L3):** listed in the before-and-after table.
  - Plain machine JPEG at 4K, 12 MP and 24 MP; calibrated whole-bed at 1080p and 4K (`flat: true`, burn check `watching`); USB 1080p calibrated (`flat: true`; the bitmap is made from the `<video>`).
  - Every run: 0 long tasks in the 20 s window, and the worker answered every request (round trips 16–144 ms plain, up to 564 ms for the 4 MP before picture).
- **Pixel correctness (`z-pixels.json`):**
  - Flattened timelapse frame and before picture: bit-identical to the old path.
  - Plain timelapse frame: same size, mean difference 1.1 of 255, because the worker draws from the bitmap and not from a full-size canvas copy.
  - Remote still: same 1024 × 576 size, mean 2.5 of 255, because the worker uses `imageSmoothingQuality: 'high'` where the old still used the default.
- **The first frame that cannot be flattened** turns the recording plain from the next tick (250 ms later), not for that frame (`timelapse-recorder.ts:173-174`). The old path kept that first frame plain. This is a 250 ms shift, not a loss.
- **Head camera:** job watch gives plain frames through the worker (`job-watch-camera.ts:48-51`, `isHeadCameraModel`); the stitched bed picture is drawn by `BedPictureOverlay`, outside the feed (READ).
- **USB overlay:** still drawn from the `<video>` on presented frames. At 1080p 30 fps it made 606 uploads of 1.3–3.4 ms in 20 s, with no long task (`on-usb-1920x1080-cal`).
- **The Camera panel's own preview during a job:** a 4K RTSP-style MJPEG `<img>` at 10 fps, with the panel open (overlay not calibrated), gave 0 long tasks, a probe key max of 39 ms and a longest stop of 54 ms (`off-rtsp-…-panelOpen`). ADR-440 Amd 10 D4 leaves it unchanged, and it is not a problem.
- **OffscreenCanvas missing (READ):** `pictureClient()` returns null and the in-window path runs exactly as before (`camera-picture-client.ts:23-31`; ADR-490 Amd 2 D5), so the v13 blocks come back there. Every Chromium that has Web Serial has OffscreenCanvas, so only a network controller in another browser could reach it. My browser run with `OffscreenCanvas` deleted failed before measuring. The reason was not kept, because the next run cleared `test-results`. So this is not measured.
- **`resizeWidth` unsupported:** a browser that rejects the option gets no overlay picture at all and no notice (`machine-frame-feed.ts:88`, `.catch(() => undefined)`). Chromium supports it, so this is not raised (READ).
- **Stalled camera:** an MJPEG stream that stops sending leaves the overlay on its last picture with no notice, and a stream that ends is not reopened (`readStream` calls `onFailure`, which `use-machine-frame.ts:28-40` does not pass). The old hidden `<img>` behaved the same, so this is not a regression. Not raised (READ).
- **L12:**
  - #1691: PR head `f100acf7b`: CI, Browser smoke (its guard ran in "pull request core and changed specs", 59 passed) and Desktop package check all green. Merge commit `21ad46fd7` (push): all three green.
  - #1695: PR head `da736364b` was based on `144e45d76` and did not contain #1691. CI, Browser smoke (its guard listed, 59 passed) and Desktop package check were green. It merged 3 minutes after #1691; the merge commit `dc7c8dcbb`'s three runs were cancelled by the next push.
  - The first commits with both fixes and a green run are `245f6a237` (CI, Desktop package; Browser smoke cancelled), `9810c8c58` (Browser smoke green, CI cancelled) and **`74191e0c7`** (CI, Desktop package check, and Browser smoke 4/4 shards green: 137 + 124 + 131 + 130 passed, 12 skipped).
  - The two fixes share no source file (only `WORKFLOW.md`). Both were measured together in my runs with the watch on and a calibrated overlay.
  - The guards pass on CI. Z1-P1-1 explains why the overlay guard cannot see the cap.

## Not verified

- **The serial-worker route (ADR-354).** The fake port has no USB identity, so every run streamed from the window. On the worker route Z1-P1-1 is an Abort and Pause delay only (the refill carries on).
- **Real cameras, real phones and EXIF tags in the field, ffmpeg's real MJPEG, and 2K RTSP cameras.** A 1080p RTSP camera with the new feed was not measured.
- **Other GPUs and CPUs.** All runs used an Intel Iris Xe through ANGLE/D3D11, headless Chrome for Testing 1248, Vite dev. Electron Desktop was not run. The resize cost is CPU-bound and will differ.
- **The in-window fallback with OffscreenCanvas removed** (the run failed before measuring), and a **30 fps MJPEG flood**: not run. Memory gate refusals left no time for them.
- **4K USB overlay.** It gave no task over 50 ms, but 252 `<video>` uploads of 20–37 ms in 20 s, and the window route ran far below the control (1,441 lines, longest stop 149 ms). My USB stand-in draws a 4K canvas at 30 fps on the page's own thread, so that cost cannot be attributed to the overlay. Not raised; it needs a real 4K webcam (ADR-440 Amd 10 also lists it as unmeasured).
- **A camera with a saved view reference** for Z1-P2-1, so the comparison's own cost is not in the 141 ms.
- **The burn check's after picture and the final timelapse frame** keep the in-window path, as ADR-490 Amd 2 D3 announces. The final frame was seen at 85–135 ms (4K, 12 MP) and 322 ms (24 MP), about 3 s after Abort, when nothing streams.

## Repro files

All files are in the scratchpad folder `zz-z1\`. The browser specs run in `zz-z1\mut`, a mutable copy of `j23-main` (`74191e0c7`) whose `node_modules` is a junction. Remove it only with `cmd /c rmdir`.

**How to run.**
- **Vite:** from `mut`, `node node_modules/vite/bin/vite.js . --config vite.zz.config.ts --mode desktop --host 127.0.0.1 --port 4897 --strictPort`.
- **A browser run:** `run.ps1 -Spec e2e/<spec> -Env @{...}` checks the 2 GB gate, then runs `node node_modules/@playwright/test/cli.js test <spec> --config playwright.zz.config.ts --workers=1`. The job spec takes:
  - `ZZ_CASE=on|off`, `ZZ_W`/`ZZ_H`, `ZZ_CAL=1` (calibrated at the frame size, homed stub);
  - `ZZ_SRC=jpeg|rtsp|usb`, `ZZ_POLL`, `ZZ_FPS`, `ZZ_OVERLAY=0`, `ZZ_PANEL=1`, `ZZ_VIEW=1920x1080`;
  - `ZZ_SNAP_MS`/`ZZ_SNAP_PAR` (still callers), `ZZ_WORKER=fail|hang|noofs`, `ZZ_NORESIZE=1`, `ZZ_SWITCH_MS`, `ZZ_STALL_MS`;
  - `ZZ_BPS`, `ZZ_INTERVAL`, `ZZ_PROBE_MS`, `ZZ_OUT`, `ZZ_TAG`.
- **Summary:** `node sum.mjs out/z-job.json [filter]`; set `LOAF=1` for the attribution lines.
- **Node:** `node --no-experimental-webstorage --import ./register.mjs n1-worker-fail.mts <ok|fail|crash-after-3|hang> [flat]` (loader `ts-resolve.mjs`, pointed at `j23-main`).

**Files.**
- `mut/e2e/zz-z1-job.e2e.ts` → `out/z-job.json`: the job, stub camera (JPEG, MJPEG, USB stream), probes, Abort, upload and worker counters, LoAF (Z1-P1-1, before-and-after table).
- `mut/e2e/zz-z1-decode.e2e.ts` → `out/z-decode.json`: `createImageBitmap` variants and their UI-thread tasks (Z1-P1-1).
- `mut/e2e/zz-z1-pixels.e2e.ts` → `out/z-pixels.json`: worker vs in-window pixels, overlay resize placement, EXIF orientation (Z1-P3-2, Refuted, Verified clean).
- `mut/e2e/fixtures/zz-z1-grbl.js`: a copy of Y4r's wall-clock GRBL with dry and lit accounting.
- `mut/src/ui/camera/job-watch/job-burn-route.ts`: the one-line homed-state stub (harness only).
- `mut/zz-z1-blank.html`, `mut/playwright.zz.config.ts`, `mut/vite.zz.config.ts`, `run.ps1`, `batch.ps1`, `sum.mjs`.
- `n1-worker-fail.mts` → `out/n1-worker-fail.jsonl` (Z1-P3-1).
- `out/gate.log`: free memory at each browser start, including refusals. A `tail` of mine held the file for the last two starts, so those are recorded only as `free-at-start` in the run output: 3.08 and 2.86 GB.

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Z1-P1-1","severity":"P1","area":"camera-thread-verify","file":"src/ui/camera/overlay/machine-frame-feed.ts","line":103,"anchor":"ADR-440 Amd 10 D1 ('decoded off the UI thread, already shrunk') and Consequences; perf S1 50 ms running-job budget; precedent Y4-P1-2, K1-P1-1","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Overlay feed's createImageBitmap(blob,{resizeWidth,resizeQuality:'medium'}) resizes on the UI thread: 4K 67-92 ms at 1340 px, 118-182 ms at the 1920 px cap (12 MP 179-297, 24 MP 292-369); in a worker 0. Calibrated 4K RTSP on a 1920x1080 window during an M3 job: 37 long tasks 50-356 ms, 30% of the thread, probe key p99 214/max 326 ms, window route 2,179 vs 3,407 lines, lit stops 4.0 s, longest 407 ms (control 52); 4K phone poll 500 ms the same (30%). Guard runs at 1280x720 only. Y4-P1-2 partly fixed"},
  {"id":"Z1-P2-1","severity":"P2","area":"camera-thread-verify","file":"src/ui/camera/helpers/install-camera-helpers.ts","line":134,"anchor":"Twin of ADR-490 Amd 2 (decode-jpeg.ts:26-40 on the UI thread, the Y4-P1-1 path); perf S1 50 ms budget; ADR-446 camera switch, ADR-663 Amd 1 panel start","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Camera start/switch mid-job (incl. opening the Camera panel) runs the moved check 3 s later via in-window captureSourceFrame: one 141 ms long task at 4K (LoAF: decode-jpeg.ts), probe key max 107 ms, window-route lit stop 138 ms vs 52-54 control; comparison cost with a saved reference not included"},
  {"id":"Z1-P3-1","severity":"P3","area":"camera-thread-verify","file":"src/ui/camera/picture-worker/camera-picture-client.ts","line":37,"anchor":"ADR-490 Amd 2 D5 (fallback only when workers are missing); twin: camera failures counted and noted (timelapse-recorder.ts:84-87)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Picture worker failing to load/crashing: timelapse 0 frames, recording true, no note; a new worker and a 4K fetch every 250 ms (browser: 45 workers/45 errors/58 frames in ~22 s; Node: 80 in 20 s); burn check blames the camera; a never-answering worker never lets endJob finish the recording (no Save video)"},
  {"id":"Z1-P3-2","severity":"P3","area":"camera-thread-verify","file":"src/ui/camera/overlay/machine-frame-feed.ts","line":78,"anchor":"ADR-440 Amd 10 D2 (header size = model size, placement unchanged); twin: old <img> naturalWidth and calibration use the EXIF-rotated size","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"EXIF orientation 6: jpegSize 640x480 but createImageBitmap 480x640 (<img> 480x640); overlay fits the model to the unrotated header size, so a 90-degree-tagged camera is refused by the Amd 9 size check where it was placed before #1691; reach unknown"}
]
```

Auditor counts: raised 4, refuted 0, P1 1, P2 1, P3 2, known 6

## Refuter (2026-11-10)

- **When:** 2026-11-10 19:30 – 2026-11-11, +0800. **Tree:** the repro tree is `74191e0c7` (a mutable copy of `j23-main` in scratchpad `zz-z1r\mut`, `node_modules` a junction, **no source change at all**: I did not use the homed-machine stub). Every cited line was re-checked on main `a1518de75`.
  - `git log 74191e0c7..origin/main -- src/ui/camera src/core/camera src/ui/remote-control` lists only `ab3226fd1`, `26ead0e8e` and `d6ae2478a` (C2 shared helpers and dead exports). They remove `rememberCameraView`, `liveDetectScale` and a local `positiveOr`. None touches the overlay feed, the picture worker, the recorder, the moved check's capture or the remote still. Every finding below holds on `a1518de75`.
- **Harness (my own).**
  - A stand-alone micro-bench (`bench-run.mjs` + `web/`, no app): synthetic wood-grain-and-noise JPEGs made in the page; a worker pings the window every 4 ms and the window logs how late each ping is handled, as a block detector independent of `longtask`; plus a CDP trace (`toplevel`, `blink`, `skia`, user-timing marks) that shows which thread does the work.
  - The same bench inside the Electron runtime the desktop app ships (`node_modules/electron` 44.5.1 = Chromium **152.0.7977.130**, found in the binary). This is the bare runtime with my page, not KerfDesk.
  - An app spec (`mut/e2e/zz-z1r-job.e2e.ts`): a 380 mm `M3` fill through Frame → Start → Job Review → Start job, streamed from the window to a copy of Y4r's wall-clock GRBL (`zz-z1r-grbl.js`), 250 blocks/s; stub camera on 127.0.0.1:4893 (MJPEG at 10 fps, or polled JPEG). New in my harness:
    - a wrapper logs every `createImageBitmap` call (time, `resizeWidth`), so each block is tied to the overlay's resize;
    - **one Abort aimed** at the next overlay resize (predicted from the logged calls and the median call-to-block gap), not a random press;
    - mid-job actions: a camera switch, or a real Alt+C key;
    - a camera picture worker replaced by a `data:` worker that throws on load (a `Worker` constructor wrapper; counts made, errors and posts);
    - an 8-minute soak with renderer memory sampled every 30 s. It was started (`gate.log`, 2026-11-11 07:35) but the session stopped before it wrote a result; see Not verified.
  - A pixel spec on a blank Vite page (`mut/e2e/zz-z1r-pixels.e2e.ts`) importing the real modules.
- **Runs:** 14 browser or Electron runs, all headless (Electron: hidden window), one worker, one spec, started at 2.30–5.28 GB free (`out/gate.log`). About ten starts were refused below 2 GB (0.08–1.9 GB free) and ran later. One queue run was malformed by my own script (all cases merged into one environment); its output is not used. Vitest was not used. No real camera, network, ffmpeg or hardware. My Vite (4898) is stopped at the end; the stub servers close with each run.
- **Magnitudes:** this PC was loaded by other sessions throughout. Absolute times vary by about ×2 between runs (as Y4r also found); every verdict below rests on effects that were over budget in every run.

### Verdicts

**Z1-P1-1 — CONFIRMED, P1, and wider than raised.** It is not only 4K and not only the 1,920 px cap.

- **The resize runs on the UI thread: proved by a trace, not inferred.** `out/bench-trace.json`, 4K, three calls of each kind:

  | Call | Decode ("Decode Image", `ImageDecoder::DecodeFrameBufferAtIndex`) | Longest renderer-main task | What that task contains |
  |---|---|---|---|
  | `createImageBitmap(blob)` | 90–104 ms on `ThreadPoolForegroundWorker` | **5.7–6.0 ms** | promise resolution only |
  | `{ resizeWidth: 1920, resizeQuality: 'medium' }` | 172–183 ms on the pool | **157–243 ms** | one `RunTask` with no traced child: the native scale in the `ImageBitmap` constructor, run where the promise resolves |
  | `{ resizeWidth: 1920, resizeQuality: 'low' }` | 162–209 ms on the pool | 41–55 ms | the same, cheaper filter |

  So Chromium decodes off the thread and scales on the thread that resolves the promise. In a worker that thread is the worker: 0 window blocks in every worker variant at every size (`bench-matrix*.json`).
- **Electron behaves the same.** In Electron 44.5.1 (Chromium 152), the 4K resize to 1,920 px gave **6 long tasks of 98–166 ms in 6 calls**, to 1,340 px 4 of 64–81 ms; plain decode none; the same resize in a worker none (`out/bench-electron.json`). The 24 MP step of that run threw and is not used. Blink's `ImageBitmap` scaling path is the same in 152 and 156, so the desktop app has this finding.
- **Isolated cost per picture** (window, `medium`; Chrome 156; two matrix runs, `bench-matrix.json`, `bench-matrix2.json`):

  | Picture | 1,340 px | 1,920 px | 1,920 px `low` | 1,920 px `pixelated` | worker |
  |---|---|---|---|---|---|
  | 1080p | 69–82 ms tasks (one run); 25–48 ms ping delay, no task (quiet run, `bench-small.json`) | (1,917: 25–43 ms ping, no task, quiet) | — | — | 0 |
  | 1440p | 0–2 of 6 over 50 (59 ms) | 0–2 of 6 (50–71 ms) | 0 | 0 | 0 |
  | 4K | 52–80 ms | **78–177 ms** | 0 | 0 | 0 |
  | 12 MP | 66–140 ms | **154–317 ms** | 0–1 (59 ms) | 0 | 0 |
  | 24 MP | 99–190 ms | **173–273 ms** | 51–86 ms | 50–55 ms | 0 |

  `low` and `pixelated` are not a fix at 24 MP. `high` is worse at 4K (103–200 ms).
- **In a job (window route, overlay shown, watch off, calibrated at the frame's size; `out/r-job.json`):**

  | Camera / window | Resize to | Long tasks in 20 s | UI held | Probe key p99 / max | Aimed Abort: key / stop byte | Lit stops: total / longest |
  |---|---|---|---|---|---|---|
  | 4K RTSP, **1280 × 720** (the guard's viewport) | 1,340 | **42 × p50 98, max 120 ms** | 20.4 % | 102 / 110 ms | 2 / 26 ms (missed) | 3.7 s / **137 ms** |
  | 4K RTSP, 1920 × 1080 | 1,917 | 40 × p50 121, max 189 | 24.7 % | 144 / 176 | **106 / 123 ms** | 4.0 s / **208 ms** |
  | 4K RTSP, 2560 × 1440 | 1,920 | 40 × p50 116, max 175 | 23.6 % | 138 / 153 | 22 / 31 (missed) | 3.7 s / 194 ms |
  | 4K RTSP, 1280 × 720 at **150 %** scaling | 1,920 | 39 × p50 124, max 207 | 26.1 % | 153 / 180 | **118 / 130 ms** | 3.6 s / 205 ms |
  | **1080p** RTSP, 1920 × 1080 | **1,917** (a 3 px shrink) | 40 × p50 72, max 159 | 15.8 % | 103 / 123 | **58 / 81 ms** | 3.4 s / 137 ms |
  | **1080p** RTSP, 1280 × 720 | 1,340 | 38 × p50 69, max 103 | 13.6 % | 72 / 91 | **59 / 75 ms** | 3.1 s / 118 ms |
  | 4K phone, polled 500 ms, 1920 × 1080 | 1,917 | 35 × p50 176, max 254 | 31.0 % | 189 / 255 | **100 / 118 ms** | 5.2 s / **259 ms** |
  | Control: overlay hidden, 1920 × 1080 | — | 0 | 0 % | 7 / 122 | 1 / 14 | 0.3 s / 64 ms |
  | Control: overlay hidden, 1280 × 720 | — | 0 | 0 % | 8 / 11 | 1 / 19 | 0 / 0 |

  - One long task per overlay picture: 39–40 resize calls and 38–42 long tasks per run; LoAF attributes them to no script (empty source URL) or, once, to `machine-frame-feed.ts`. Script time in them is small; the rest is the native scale.
  - An aimed Abort that landed in a block waited 58–118 ms for the key and 75–130 ms for the stop byte, against 14–19 ms in the controls.
- **Challenges to the report's own numbers.**
  - **"A 1080p camera … its resize is about a quarter of the 4K cost" (For P2) — refuted.** A 1080p RTSP camera, the most common size, gave 38–40 blocks of p50 69–72 ms (max 103–159) in a job, Abort 58–59 / 75–81 ms, and lit stops up to 118–137 ms. On a quiet moment in isolation the same resize is 25–48 ms, so it sits on the budget line and goes over under the app's own load.
  - **A pointless resize.** At a maximised full-HD window the canvas is 1,278 CSS px, so `overlayDisplayWidth` asks for 1,917 px (`use-machine-frame.ts:54`, `Math.round(1278 × 1 × 1.5)`). `machine-frame-feed.ts:82-83` then shrinks a 1,920 px camera by 3 px, paying the whole on-thread scale for nothing.
  - **"1280 × 720: 6.6 %, longest lit stop 76 ms" — not reproduced.** At the guard's own viewport I measured 20.4 % and a 137 ms lit stop. The guard (`e2e/camera-overlay-mjpeg-ui-thread.e2e.ts`, no viewport, so 1280 × 720; idle, not in a job) passing on CI is a fast-CPU result, not a margin.
- **Is the cap the default on a full-HD screen?** Yes. `overlayDisplayWidth` = min(1920, round(CSS width × DPR × 1.5)) (`use-machine-frame.ts:52-55`, called at `WorkspaceCameraOverlay.tsx:69`). A maximised 1920 × 1080 window gives 1,917; any laptop at 150 % with a canvas of 854 CSS px or more, or 125 % with 1,024 px or more, gives 1,920. Measured: 1280 × 720 at 150 % → 1,920.
- **The worker route (ADR-354).** Not run (the fake port has no USB identity). ADR-354 puts the port, read loop and refill in the worker (`ADR-354-native-worker-background-streaming.md:23-27`) and its evidence is a refill through a two-second window stall (`:15-16`, `:67-68`). So on that route the lit stops go away and what remains is the Abort/Pause delay: 58–130 ms per aimed press here, recurring every 500 ms for the whole job. That alone is the Y4-P1-2 worker-route case (Abort 65–95 ms), which Y4r argued as the P2 side.
- **Severity: P1 stays.**
  - On the window route the overlay stops the head lit at every picture, for the whole job, with no edit or other action by the operator: longest stops 118–259 ms against 0–64 ms in the controls, 3.1–5.2 s lit per 20 s. That is wrong physical output (a dwell mark under `M3`), the K1-P1-1 / Y4-P1-2 class; METHOD §3 has no reach clause.
  - No warning names this cause. Job Review's window-route text (`window-stream-lit-stop-warnings.ts:27-38` on `a1518de75`) still names "a large edit, Undo or an import" and says "do not edit the project while it runs". The connect-time notice (`laser-background-streaming-notice.ts:37-38`) says only that "a busy window" can stop the head lit. Neither names the camera overlay, so by the G6 rule neither lowers it.
  - Compared with Y4-P1-2: 4–5 × less thread time (24–31 % vs 97 %) and single stops of 0.1–0.26 s instead of 5.5 s, but still 2–5 × the 50 ms running-job budget (perf S1 `AREAS.md:25`) at every camera size from 1080p and every window size I tried.
- **Fix direction (adds to the auditor's).** Move the `resizeWidth` decode into a worker (the camera picture worker already exists) and transfer the bitmap back: 0 window blocks at every size in my bench, Chrome and Electron. Do not resize when the target is within a few per cent of the picture's width. Run the guard at 1920 × 1080 (or DPR 1.5) **during a streamed job**, with a 1080p case too.

**Z1-P2-1 — CONFIRMED, P2, and larger once a view reference exists.**

- **Repro** (`jpeg-3840x2160-…-switch`): a 4K machine-JPEG camera, uncalibrated, watch off, switched to a second source 4 s into the job. Exactly one in-window `createImageBitmap(blob)` with no resize 3.07 s later, then **one 76 ms long task** at 3.20 s (LoAF: `Promise.resolve`, 76 ms, the `drawImage` + `getImageData` of `decode-jpeg.ts:26-40`). Lit stop in that window 71 ms against 36 ms elsewhere in the run. The auditor's 141 ms is the same path on a busier moment.
- **Not measured by the auditor: the comparison itself.** With a saved view reference, `checkCameraMoved` runs `viewThumbnail(frame, …)` on the UI thread (`moved-check.ts:61`); it reads every pixel of the full frame (`view-shift.ts:44-69`). Measured in the browser on the real function: **47–119 ms at 4K, 152–327 ms at 24 MP** (`out/r-pixels.json`, `viewThumbnailMs`). So a calibrated camera with a reference (the case the moved check exists for) adds that to the decode: roughly 120–260 ms at 4K in one block.
- **How often.** `autoStart` defaults to true (`camera-preference-storage.ts:84`). Opening the Camera panel starts the remembered camera (`CameraPanel.tsx:148`), and closing it stops the camera again when it is not shown on the canvas and the watch is off (`CameraPanel.tsx:151`). So every open of the panel during a job, the ordinary way to look at the job, repeats the block 3 s later. A camera started by the job watch is already live at Start, so the watch does not trigger it.
- **Severity.** P2, as raised. It is one block per camera start or switch, triggered by the operator, like Y4-P2-1. My lit stop (71 ms) is near this PC's control noise (52–64 ms); the auditor's 138 ms is not, and with a reference the block roughly doubles. If the coordinator reads a single 0.1–0.26 s lit dwell as wrong output under METHOD §3, it is P1 on the window route; I did not, because each one needs an operator action and does not recur.

**Z1-P3-1 — CONFIRMED, P3** (own method: a `Worker` wrapper that hands the camera picture worker a `data:` script that throws on load; 4K machine JPEG, watch on, 1280 × 720).
- During the ~24 s job: **48 workers made, 48 `error` events, 48 requests posted**, and the stub served **50 stills**. That is one new worker and one new 4K fetch per 250 ms tick, as the auditor found.
- The timelapse kept **0 frames** during the job, with `note: null`. After Abort only the in-window final frame was kept (1 frame).
- No long task came from the worker churn (0 in the probe window; key p99 15 ms).
- The burn check was `unavailable` here, because my tree has no homed-machine stub, so the "camera sent no picture" wording is the auditor's (READ confirms `burn-check-run.ts:113,136-141`).
- "Never answers" stays READ: `doPictureWork` catches its own errors (`picture-work.ts:55-56`) and an uncaught one fires `error` → `failAll`, so only a true hang reaches it. P3 holds: the job and the project are untouched.

**Z1-P3-2 — CONFIRMED, P3, with a correction to the fix direction.** A 640 × 480 JPEG with an EXIF orientation-6 APP1 segment (`out/r-pixels.json`, `exif6`):
- `jpegSize` gives 640 × 480;
- `createImageBitmap` gives 480 × 640 by default, with `from-image`, **with `imageOrientation: 'none'`**, and with `flipY`; with `resizeWidth: 320` it gives 320 × 427;
- `<img>` gives 480 × 640, and so does `decodeToRgba` (calibration's path).
- So the auditor's first fix, "decode with `imageOrientation: 'none'`", **does not work** in Chrome 156: `none` no longer ignores EXIF. Only the second one does: swap the header's width and height for orientation 5–8, or read the size from the decoded bitmap's aspect.
- Reach is unknown (no real phone tags were tested). P3.

### Challenges to "Verified clean"

- **Job watch, every size — holds.**
  - Worker vs in-window flattening is **bit-identical at 24 MP** as well: 6000 × 4000 and 6528 × 3672, plus 4K, for whole bed (1024 × 1024), sign (1024 × 512) and coaster (360 × 360), with 0 differing channels and max difference 0 (`r-pixels.json`). The worker took 222–895 ms per flatten, all off the thread.
  - The plain timelapse encode through the worker works at 24 MP: 1024 × 683, 192 KB.
- **Worker failure → Z1-P3-1** confirmed above.
- **Phone polled at 500 ms — the overlay part is worse than reported.** 4K at 1920 × 1080: 35 blocks of p50 176 ms (max 254), 31 % held, lit stop 259 ms, aimed Abort 100 / 118 ms. The job-watch part holds: no worker-side block.
- **Two cameras — holds.** Only one source is live (`camera-store.ts:148`, one `sourceState`). A switch is Z1-P2-1.
- **Head camera — holds for job watch (READ), but not for the overlay.** A head camera on a bridge with no stitched `bedPicture` is drawn by `ModelOverlay` (`WorkspaceCameraOverlay.tsx:48-50`), so it goes through the same feed and Z1-P1-1 applies to it as well.
- **Remote still while the timelapse runs; large-bitmap transfer over time:** not measured. The soak run was started but wrote no result before the session stopped.
- **USB overlay, Camera panel preview, OffscreenCanvas missing, stalled camera:** not re-run; I have nothing against them.
- **Missed by "Verified clean": Alt+C during a job.** See Z1-P2-2.

### New finding

**Z1-P2-2 — Alt+C (LightBurn's Update Overlay) or Refresh picture during a job decodes the full frame on the UI thread and uploads it as a held still: a 251 ms block and then a 131 ms block at 4K, with a 148 ms lit stop on the window route**

- **Where (`a1518de75`):**
  - `src/ui/app/shortcuts.ts:363` binds Alt+C, and `src/ui/camera/helpers/refresh-picture.ts:47-56` (`refreshCameraPictureFromKey`) runs it with no job check. The Camera panel's Refresh picture uses the same `refreshCameraPicture` (`:25-37`).
  - `src/ui/camera/capture-overlay-still.ts:63` calls `captureSourceFrame`, which goes through `frame-source.ts` to `decode-jpeg.ts:26-40`: the in-window full-frame `drawImage` + `getImageData`, the path Y4-P1-1 named. `:71-77` then publishes the RGBA still, and the overlay uploads that full-size still to WebGL on the UI thread.
  - `src/ui/camera/helpers/install-camera-helpers.ts:119-121`: a new still also runs `checkCameraMoved` on the full frame (`viewThumbnail`, 47–119 ms at 4K) when a view reference is saved.
- **Anchor:**
  - **Twin:** ADR-490 Amd 2 moved job watch and stills to the worker because "Abort is sent from the UI thread"; this is the same decode on a path it did not cover.
  - **Budget:** perf S1 `AREAS.md:25`, 50 ms while a job runs.
  - **Contract:** ADR-663 Amd 1, Alt+C refreshes the held picture "from anywhere".
- **Evidence:** REPRO, browser, `zz-z1r-job.e2e.ts` with `ZZ_ACT=altc` → `out/r-job.json`, key `jpeg-3840x2160-cal-hidden-v1920x1080@1-bps250-altc`. A calibrated 4K machine JPEG with the overlay hidden (no live feed), a real Alt+C key 4 s into an `M3` job on the window route:
  - one in-window `createImageBitmap(blob)` (no resize) at +70 ms;
  - **a 251 ms long task at +239 ms** (LoAF `Promise.resolve`, 250 ms: decode-to-RGBA), then **a 131 ms task at +505 ms** (LoAF `MessagePort.onmessage` in the React chunk: the render and upload of the 4K still);
  - probe key delay **max 241 ms** in that window, against 28 ms elsewhere in the run;
  - window route: **lit stop 148 ms**, a dry stop of 266 ms, against 55 ms elsewhere.
- **Scenario.** A LightBurn user presses Alt+C during a job to see progress on the bed picture, or clicks Refresh picture in the Camera panel. The UI freezes for about 0.4 s; an Abort pressed then waits up to 0.25 s; on the window route the head stands lit.
- **Severity: P2.** It is one block per press, at the operator's own action, like Z1-P2-1 and Y4-P2-1.
  - For P1: on the window route it is a lit dwell of 148 ms, and Alt+C is the documented LightBurn habit.
  - For P2: it does not recur, and it needs a press.
  - Fix it with Z1-P2-1 as one cluster.
- **Announced?** No. **Novelty:** new. It is not in Y4/Y4r or the Z1 auditor's report. The last-100 PR ledger notes only an ordering defect for Alt+C (#1396), not thread time.
- **Fix direction:**
  - Capture through `pictureClient().capture()`, which decodes off the thread, and hold the still as an `ImageBitmap`, shrunk in the worker to the overlay's width, so the overlay uploads a small bitmap.
  - Run the moved check's thumbnail in the worker.
  - Or defer Alt+C and Refresh while a job streams, with a toast.
  - The same in-window capture serves Trace from camera, Find pieces, print-and-cut and Camera diagnostics (`grep captureSourceFrame`). Those are design-time tools, so they are not raised.

### Not verified

- **The ADR-354 worker route**: no fake port can open in the worker. It is reasoned from the ADR above.
- **KerfDesk Desktop itself.** Only the Electron runtime with my page; Electron's 24 MP step threw and is unused.
- **Real cameras, real phones, real EXIF tags, other CPUs and GPUs.** All on this Iris Xe PC, under other sessions' load.
- **The burn-check wording under a failing worker**: my tree has no homed stub. **"Never answers"**: READ.
- **Any soak**: the 8-minute run never finished (see above), so memory and bitmap transfer over time are unverified.
- **The panel-open trigger of Z1-P2-1 end to end**: needs a bridge or a USB device to auto-start. I switched the source object, which is the same subscription (`install-camera-helpers.ts:116-137`).

### Repro files

All under scratchpad `zz-z1r\` (`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z1r\`). `mut\` is a copy of `j23-main` (`74191e0c7`, unmodified sources) whose `node_modules` is a junction; remove it only with `cmd /c rmdir`.
- `bench-run.mjs` (`trace` | `matrix` | `small`) with `web\bench.html`, `web\bench.js`, `web\ping-worker.js`, `web\decode-worker.js` → `out\bench-trace.json`, `out\bench-matrix.json`, `out\bench-matrix2.json`, `out\bench-small.json`.
- `electron-bench\main.js` (run with `j23-main\node_modules\electron\dist\electron.exe`, via `electron.ps1`) → `out\bench-electron.json`.
- `mut\e2e\zz-z1r-job.e2e.ts` + `mut\e2e\fixtures\zz-z1r-grbl.js` → `out\r-job.json`. Environment: `ZZ_VW/ZZ_VH/ZZ_DPR`, `ZZ_SRC=rtsp|jpeg`, `ZZ_W/ZZ_H`, `ZZ_CAL`, `ZZ_OVERLAY=0`, `ZZ_POLL`, `ZZ_WATCH=on`, `ZZ_ACT=switch|altc`, `ZZ_WFAIL=load`, `ZZ_SNAP_MS`, `ZZ_SOAK_S`, `ZZ_BPS`.
- `mut\e2e\zz-z1r-pixels.e2e.ts` + `mut\zz-z1r-blank.html` → `out\r-pixels.json`.
- `mut\playwright.zz.config.ts`, `mut\vite.zz.config.ts` (Vite on 4898, fflate alias), `run.ps1` (2 GB gate), `queue.ps1`, `smallbench.ps1`, `sum.mjs`, `out\gate.log`.

No security finding, so no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Z1-P1-1","refuter":"CONFIRMED","severity":"P1","evidence":"REPRO","note":"CDP trace: decode on ThreadPoolForegroundWorker, resize = one 157-243 ms CrRendererMain task (plain 6 ms); same in Electron 44.5.1/Chromium 152 (98-166 ms); worker 0. Wider: 1080p cameras (38-40 x p50 69-72 ms, lit 118-137 ms, aimed Abort 58-59/75-81 ms), the guard's 1280x720 viewport (20.4%, lit 137 ms), 150% scaling hits the 1920 cap; 1920 frames resized by 3 px at a full-HD window. Aimed Abort 100-118/118-130 ms at the cap. Worker route = Abort delay only (ADR-354)."},
  {"id":"Z1-P2-1","refuter":"CONFIRMED","severity":"P2","evidence":"REPRO","note":"76 ms decode block 3.2 s after a switch, lit 71 vs 36 ms; viewThumbnail on the UI thread adds 47-119 ms (4K) / 152-327 ms (24 MP) once a view reference exists; repeats on every Camera panel open mid-job (autoStart default true, panel close stops the camera)"},
  {"id":"Z1-P3-1","refuter":"CONFIRMED","severity":"P3","evidence":"REPRO","note":"data: worker that throws on load: 48 workers/48 errors/48 posts/50 stills in ~24 s, 0 frames, note null; never-answers READ"},
  {"id":"Z1-P3-2","refuter":"CONFIRMED","severity":"P3","evidence":"REPRO","note":"imageOrientation 'none' also gives 480x640 in Chrome 156, so that fix direction fails; swap header W/H for orientation 5-8"},
  {"id":"Z1-P2-2","refuter":"RAISED","severity":"P2","area":"camera-thread-verify","file":"src/ui/camera/capture-overlay-still.ts","line":63,"anchor":"Twin of ADR-490 Amd 2 (decode-jpeg.ts:26-40 on the UI thread); perf S1 AREAS.md:25 50 ms; ADR-663 Amd 1 Alt+C","evidence":"REPRO","known":false,"summary":"Alt+C (Update Overlay) or Refresh picture during a job: in-window full-frame decode then a full-size still upload; 4K: 251 ms + 131 ms long tasks, probe key max 241 ms (28 elsewhere), window-route lit stop 148 ms (55 elsewhere); no job gate; moved check adds viewThumbnail with a reference"}
]
```

Refuter counts: raised 5, refuted 0, P1 1, P2 2, P3 2, known 6
