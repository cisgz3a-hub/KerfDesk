# K4 — Job watch and timelapse (camera audit v2, `job-watch-and-timelapse`)

**Question.** While a job runs, can the camera slow, stall or stop it? Is the timelapse complete, in order and kept to the end of a long job, through camera stalls, drops, bad frames, disconnects, pause, abort and a camera coming back? Are frames bound to the right job moment, and is memory and disk bounded? In scope: the timelapse recorder and its export, the job-watch runner and UI, the picture worker, frame capture and the capture binding, picture quality, the live bridge-camera picture that follows the job on the canvas, and the Electron frame proxy, frame sources and RTSP preview sessions.

v13 Y4 and v14 Z1 measured the UI-thread cost of job watch, stills and the overlay. Their items are listed under KNOWN and not raised again.

**Tree.** `origin/main` @ `ba08a81af` (read-only export `j42-main`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera electron` (fetched 2026-11-14) touches only `core/camera/model/extrapolation-estimate*` and `ui/camera/calibrate/calibration-result.ts` (#1917, K1). No file read or run here changed, so every result stands on current main.

**Method.**
- **Stub camera** (`stub-cam.mjs`, its own process, 127.0.0.1:5311):
  - Snapshot GET `/shot.jpg` and multipart MJPEG `/stream.mjpg` (ffmpeg's `mpjpeg` framing, standing in for the bridge's RTSP preview).
  - JPEGs made with the repo's `sharp`: 640 × 480 (136 KB), 1280 × 720 (405 KB), 3840 × 2160 (4.15 MB) and a 11.6 MB 4K (over the bridge's 8 MiB cap).
  - Every served JPEG carries a COM segment `K4 seq=<n> t=<ms>`, so the receiver can check order and when the frame left the camera.
  - Modes: steady, slow (500 ms a frame / 2 fps), bursty, stall (held, then answered), hang (never answered), refuse (socket reset), drop mid-body, malformed bytes, truncated JPEG (60 %), huge, wrong content type (text/plain JPEG), an HTML login page, HTTP 500, no Content-Length, a 20 MiB part. A failure mode can be limited to the next N requests.
  - A stub GRBL on 127.0.0.1:5315 (TCP, `ok` per line).
- **Bridge stand-in** (`k4lib.mts`, 127.0.0.1:5313): the real `/frame.jpg` steps minus the address policy, which refuses loopback. That is the real `CameraFrameSources` (registry and the ADR-692 Amd 1 back-off) plus the real `serveHttpFrame` (10 s timeout, 8 MiB cap, per-host queue, content checks).
- **Decode stand-in:** `createImageBitmap` returns a "bitmap" of the JPEG header's size (the real `jpegSize`) and rejects non-JPEG bytes, as Chrome does. The worker's encode passes the bytes through, so each kept frame keeps its stamp. Everything else is the app's code:
  - `startTimelapse` and `captureSourceBitmap` (fetch + bitmap);
  - `installJobWatch` on the real laser store's `liveCanvasRun`;
  - `flattenSpecFor` / `cameraModelForFrame` with the repo's calibrated fixture (`savedCameraModel`, 1280 × 720);
  - `startMachineFrameFeed` + `MjpegPartReader`;
  - `RtspPreviewSessions` + `monitorRtspSource` + the camera store's `reportSourceFailure`;
  - `MachineNetworkSession`.
- **Clocks.** Real clock for E1–E5 and E7, with 2 s timelapse intervals and 30–90 s jobs. Virtual clock for the 12 h job (E8).
- **Limits.** One test process at a time next to the stub, `--max-old-space-size=380`, with 1.4–2.0 GB free. No Vitest, browser, pnpm, real camera, ffmpeg (not installed) or hardware. Both stub processes were stopped at the end (ports 5311–5319 free).

## Headline

**The job itself is safe from the camera; the recording is not.** No path was found where a camera stall, drop, flood or bad frame holds or stops the G-code stream:
- job watch takes at most one picture per interval;
- the frame work stays in the picture worker (ADR-490 Amd 2, KNOWN fixes);
- the bridge bounds every request (10 s, 8 MiB);
- the MJPEG reader bounds every part (16 MiB) and header (4 KB).

Frames are always kept in order, nothing is written to disk before Save video, and a 12-hour job keeps 310 evenly spaced frames (74 MB). **But the timelapse is lost to quite ordinary events, and nothing outside the Camera panel says so:**

- **K4-P2-1 — two camera hiccups about a second apart end the timelapse for the rest of the job.** The bridge's back-off (ADR-692 Amd 1, after Y4) answers instantly with 503 after any failed picture. The recorder retries every 250 ms and stops for good after 5 failures in a row. So one real failure plus three instant 503s plus one more real failure ends it.
  - In the runs: a 20 s refusal ended it at 11.4 s with 5 of 26 frames; two refused requests ended it with 5 of 16; a 3 s login page ended it.
  - A stall now needs only about 21 s (two 10 s bridge timeouts). The 60 s stall kept 5 of 46 frames, and a 30 s hang 5 of 38.
  - Y4 verified a 25 s stall as tolerated (Y4r: 45 s or more needed). That no longer holds.
  - The recording never resumes when the camera returns.
- **K4-P2-2 — the job watch turns an RTSP camera off whenever nothing on screen is showing its preview.** The bridge fails an RTSP preview session as soon as its last viewer closes, or 15 s after start if nobody claimed it. The window's 1 s monitor then turns the camera off: "RTSP preview stopped… press Reconnect".
  - Job watch promises "The camera stays on while these are ticked". Instead, closing the panel with an uncalibrated or hidden overlay, Alt+C, or the burn check's own after picture (drawn on the canvas automatically) kills the camera within 40 ms of the session failing.
  - The recording then ends mid-job ("The camera was turned off or switched", 4 of 13 frames), or the next job gets no timelapse and no burn check.
  - One viewer's ffmpeg hiccup kills it for every viewer.
- **K4-P2-3 — the next run silently throws away the last recording.** Continue after a lost connection, Second pass, or any new watched job empties the timelapse at once.
  - Continue 1 s after a disconnect discarded the first 20 s (10 frames). The final frame of a job is never taken if the next run starts within 3 s.
  - ADR-490's Consequences announce this to the maintainer ("live until the next watched job"). Nothing tells the operator, and Save video is not offered first.
- **K4-P3-1:** a calibrated (flat) recording whose camera changes picture size mid-job stops adding frames with no note. It keeps "Recording the timelapse: 5 frames" and re-fetches 2.5–3.6 pictures a second instead of one per 2 s.
- **K4-P3-2:** a truncated JPEG (the camera closed cleanly mid-picture) passes the bridge and is kept as a timelapse frame (5 of 5 in the run).

**Worst outcome per area:**
- **Job:** none found. No attributable slow-down at realistic camera rates in the main process (E5); the renderer side is KNOWN-fixed.
- **Recording:**
  - K4-P2-1 / K4-P2-2: stops mid-job after a short camera or bridge event, and never resumes.
  - K4-P2-3: a whole long job's recording is lost at Continue.
- **Live picture:** a snapshot or phone camera that stops leaves its last picture on the canvas with no mark for 30–38 s and longer. That is KNOWN (v2 12-P3-3 / W4-P3-1), now in a new form.
- **Memory and disk:** bounded.

## Tables

### E1 — the timelapse recorder through the bridge (`e1-recorder.out.jsonl`)

Real `startTimelapse` on the worker path, real `captureSourceBitmap`, the bridge stand-in with the real back-off. Interval 2 s. Failures start at about 9–10 s. "Failures" counts each failed capture; "503" is the bridge holding the camera back.

| Scenario | Frames kept / expected | Failures (real + held 503) | Job effect | Recording effect | Warned? | Verdict |
|---|---|---|---|---|---|---|
| Steady 640 × 480 | 16 / 16, in order, final frame | 0 | none | complete; stamp lag 6–38 ms | — | clean |
| Steady 4K (4.15 MB) | 15 / 16, in order | 0 | none | complete; capture up to 226 ms | — | clean |
| Slow camera (500 ms a frame) | 16 / 16 | 0 | none | complete; frames 501–531 ms after the request | — | clean |
| Stall 15 s (then answers) | 17 / 23 | 1 timeout + 3 | none | gap, then resumes | — | clean (just) |
| **Stall 60 s** | **6 / 46** (5 + final) | 2 timeouts + 3 | none | **ended at 31.4 s**, not resumed when the camera answered at 70 s | panel note only | **K4-P2-1** |
| **Hang 30 s, then back** | **6 / 38** | 2 timeouts + 3 | none | **ended at 31.4 s**; camera fine for the last 35 s | panel note only | **K4-P2-1** |
| Refuse 1 request | 15 / 16 | 1 + 3 | none | 1 frame late | — | clean (4 of the 5 allowed) |
| HTTP 500, 1 request | 15 / 16 | 1 + 3 | none | as above | — | clean (just) |
| **Refuse 2 requests** | **6 / 16** | 2 + 3 | none | **ended at 11.5 s** | panel note only | **K4-P2-1** |
| Refuse 1.5 s | 16 / 16 | 1 + 3 | none | survived: the outage ended before the 2nd real attempt | — | clean |
| **Refuse 20 s, then back** | **6 / 26** | 2 + 3 | none | **ended at 11.4 s**; not resumed | panel note only | **K4-P2-1** |
| Drop mid-body (1 request) | 15 / 16 | 1 + 3 | none | 1 frame late | — | clean |
| Malformed bytes (1 request) | 16 / 16 | 1 (window decode) | none | — | — | clean |
| **Malformed bytes 10 s** | **6 / 16** | 5 (window decode, no 503) | none | ended at 11.4 s | panel note only | Y4-P3-1 (KNOWN) |
| **Truncated JPEG 10 s** | 16 / 16 | 0 | none | **5 cut frames kept** (avg 119 KB) | no | **K4-P3-2** |
| Over 8 MiB, 10 s | 6 / 16 | 2 + 3 | none | ended at 11.4 s ("Camera frame is too large." is never shown) | panel note only | K4-P2-1 |
| Wrong content type (JPEG bytes) | 16 / 16 | 0 | none | accepted by the JPEG magic | — | clean |
| **HTML login page 3 s** | **6 / 16** | 2 + 3 | none | ended at 11.4 s | panel note only | **K4-P2-1** |

All 18 runs kept their frames in strictly increasing camera order, with the final frame last.

### E2 — the job-watch runner over job lifecycles (`e2-runner.out.jsonl`)

Real `installJobWatch` on the real laser store's `liveCanvasRun`, timelapse 2 s, stub camera.

| Scenario | Job effect | Recording effect | Warned? | Verdict |
|---|---|---|---|---|
| Run 10 s, pause 10 s, run 10 s, finish | none | 11 frames in order, **0 camera requests while paused**, final frame added, Save video offered | — | clean |
| Abort at 15 s | none | 8 frames; the final frame 3 s later (9); `recording: false` | — | clean |
| **Disconnect at 20 s, Continue 1 s later** | none | **the 10 frames vanish when the continued run starts**; the store ends with only the continued job's 6 frames | no | **K4-P2-3** |
| **Disconnect, Save video on screen for 10 s, then Continue** | none | the finished 11-frame timelapse is replaced the moment the new run starts | no | **K4-P2-3** |
| **Second job 2 s after a finish** | none | the first job's 8 frames **and its final frame** are gone | no | **K4-P2-3** (announced in the ADR) |
| Camera turned off at 10 s, reconnected at 12 s | none | ended at 5 frames; **never resumes** in the 14 s after | panel note | Y4-P3-1 class (no resume) |

### E3 — an RTSP camera's preview session under job watch (`e3-rtsp-session.out.jsonl`)

Real `RtspPreviewSessions`, `monitorRtspSource` and `reportSourceFailure`. The timelapse is real and gets its stills from the stub. "Claim" is a preview `<img>` or the overlay feed opening `/stream.mjpg`.

| Scenario | Session | Camera | Recording | Warned? | Verdict |
|---|---|---|---|---|---|
| **One viewer closes mid-job** (panel closed; or overlay switched to a held or burn-check picture) | failed at once: "RTSP preview connection closed." | **error after 39 ms** | **ended, 4 of 13 frames**, "The camera was turned off or switched." | panel only | **K4-P2-2** |
| **Never claimed** (camera started with the overlay off and the panel closed) | failed at 15 s: "did not start in time" | **error at 15.1 s** | **ended, 8 of 13** | panel only | **K4-P2-2** |
| Two viewers, one closes | stays live | live | complete (10 / 11) | — | clean |
| **Two viewers, one connection's ffmpeg stops** | failed for both | **error after 52 ms** | **ended, 4 of 11** | panel only | **K4-P2-2** |

### E4 — the live bridge-camera picture that follows the job (`e4-feed.out.jsonl`)

Real `startMachineFrameFeed` + `MjpegPartReader` at job pacing (500 ms).

| Stream / poll | Frames, order | Longest gap | Failure reported? | Memory peak | Verdict |
|---|---|---|---|---|---|
| MJPEG 4K steady, 10 fps | 29 in 15 s, in order; age p50 93 / max 145 ms | 565 ms | — | 99 MB (4 MB parts) | clean |
| 2 fps / bursty | 30 / 15, in order | 516 / 1,649 ms | — | 24–25 MB | clean |
| Stall 30 s (no bytes, connection open) | resumes, in order | **29,984 ms** | **no** (the bridge's 10 s ffmpeg timeout is what ends it in production, then K4-P2-2 follows) | 30 MB | see K4-P2-2 |
| Drop after 20 parts | 6 | — | yes, at 2.4 s | 21 MB | clean |
| Malformed part every 3rd / no Content-Length / text/plain type | 27 / 29 / 20, in order | ≤ 1.1 s | — | 27–33 MB | clean (skipped and recovered) |
| A 20 MiB part | 39, in order | 683 ms | — | 42 MB | clean (part dropped, bounded) |
| **Snapshot poll, camera refuses 5–25 s** | last frame at **4.8 s**, none after, though the camera was back at 25 s (bridge back-off up to 16 s) | **≥ 30 s** to the end of the run | **no** | 19 MB | KNOWN 12-P3-3 / W4-P3-1 |
| **Snapshot poll, camera hangs 5–35 s** | resumes at 44 s | **38,179 ms** | **no** | 19 MB | KNOWN 12-P3-3 / W4-P3-1 |

### E5 — the camera bridge and a network-streamed job share the desktop main process (`e5-mainproc.out.jsonl`)

Real `MachineNetworkSession` (grblHAL raw TCP), a character-counting sender, the bridge stand-in in the same process, and a separate puller process standing in for the window. 10 s per case. The PC was busy: the idle event-loop p99 was 90–130 ms, so only large effects count.

| Camera load on the bridge | Lines/s | Ack p99 / max | Loop delay p99 / max | Verdict |
|---|---|---|---|---|
| Off (5 runs) | 1,594–2,627 | 18–22 / 72–127 ms | 90–131 / 136–173 ms | baseline |
| 4K polled about every 500 ms (phone overlay) | 1,359 | 24 / 397 ms | 136 / 650 ms | within noise, one spike |
| 4K about 2 a second (overlay + timelapse) | 1,964 | 27 / 160 ms | 150 / 207 ms | within noise |
| 640 × 480 back to back, about 25 a second | 988 | 39 / 117 ms | 141 / 192 ms | load the app never makes |
| 4K back to back, about 7 a second (30 MB/s) | 443 | 113 / 204 ms | 199 / 286 ms | load the app never makes |
| 11.6 MB frames refused at the cap | 1,184 | 25 / 174 ms | 126 / 194 ms | within noise |

No starvation attributable to the camera at the rates the app asks for. Not raised (see Not verified).

### E7 — a calibrated recording whose camera changes size mid-job (`e7-flat-size-change.out.jsonl`)

| From 10 s the camera sends | Frames added 10–30 s / expected | Camera requests a second | Note | Verdict |
|---|---|---|---|---|
| 1280 × 720 (as calibrated; control) | 10 / 10 | 0.5 | — | clean |
| **640 × 480 (another shape)** | **0 / 10** | **3.6** | **none**; "recording" stays true | **K4-P3-1** |
| **3840 × 2160 (same shape, resize not proved)** | **0 / 10** | **2.5** | **none** | **K4-P3-1** |

### E8 — a 12-hour job on a virtual clock (`e8-long-job.out.jsonl`)

| Job | Frames kept | Spacing | Retained | Heap | Verdict |
|---|---|---|---|---|---|
| 12 h, 2 s interval, paused from 6 h to 7 h, 250 KB frames, 300 ms captures | 310 (1,750 captures) | 128.05–128.1 s, plus the one pause gap | 74 MB | 29 → 28 MB used, RSS 182 MB | clean |

## Findings

### K4-P2-1 — Since the bridge's back-off, two camera hiccups about a second apart end the timelapse for the rest of the job: a 2-request refusal, a 3 s login page or a stall of about 21 s is now enough, and it never resumes

- **Where (`ba08a81af`):**
  - `src/ui/camera/job-watch/timelapse-recorder.ts`:
    - `:31-32`: `TICK_MS = 250`, `MAX_FAILED_CAPTURES = 5`.
    - `:84-87`: a failed capture leaves the frame due, so the next tick retries 250 ms later. The fifth failure in a row calls `end`, and nothing restarts it (`:106-115`).
  - `electron/camera-frame-sources.ts`:
    - `:19-20`: `FIRST_RETRY_MS = 1000`, `LONGEST_RETRY_MS = 16_000`.
    - `:66-86`: `heldBack` and `noteFrame`.
  - `electron/camera-frame-proxy.ts:133-137`: a held-back camera gets an instant `503`.
  - `src/ui/camera/picture-worker/camera-picture-client.ts:76-77`: `!response.ok` → null → one failure.
  - The back-off came with #1685 (`66e5568e1`, ADR-692 Amd 1 §5, 2026-11-10), after Y4's tree.
- **Anchor:**
  - **Contract:** ADR-490 D3: "While the job runs (not while paused), one frame is kept every interval."
  - **Twin / verified clean:** Y4 "A stalling camera is tolerated: it was silent for 25 s … and the recording continued". Y4r: a stall needs 45 s or more to end it. Z1's KNOWN table read Y4-P3-1 as "unchanged".
  - ADR-692 Amd 1 §5 aims the back-off at "the several views polling it", not at ending recordings.
- **Evidence:** **REPRO** `e1-recorder.mts` → `e1-recorder.out.jsonl`, through the real recorder, capture, `serveHttpFrame` and `CameraFrameSources`.
  - Each first failure is followed by exactly three held 503s at 250 ms (`bridge503: 3`). The next real attempt comes about 1.06 s after the first. If it fails too, that is failure 5.
    - **Refused 2 requests:** ended at 11.5 s with 5 frames (16 expected).
    - **HTML login page for 3 s:** ended at 11.4 s with 5 frames.
    - **Refused 20 s:** ended at 11.4 s with 5 of 26 frames.
    - **Over 8 MiB:** ended at 11.4 s with 5 of 16.
    - **Stall 60 s:** two 10 s timeouts (10.35 s and 21.43 s), ended at 31.4 s, 5 of 46 frames.
    - **Hang 30 s:** the same, 5 of 38 frames, although the camera answered from 40 s and the final frame was taken.
  - Survivors: one refused / 500 / dropped request (4 failures, one short of the limit), a 15 s stall (its second attempt was answered), and refusals of up to about 1 s.
- **Scenario:**
  1. A phone camera (ADR-448) or snapshot camera watches a 3-hour engrave with **Record a timelapse** ticked.
  2. Its Wi-Fi drops for 20 s at 40 minutes in, or the phone shows a lock screen for 3 s, or the camera reboots.
  3. The timelapse stops at the frames taken so far. The job runs on for 2 h 20 min unrecorded, with the camera back the whole time.
  4. The only sign is a note inside the Camera panel. With the panel closed, the operator finds out after the job.
- **Severity:** **P2.**
  - **For P1:** the brief lists "a timelapse silently losing … the user's recording at the end of a long job" as P1-class. The trigger is now a short, common outage. It is a regression of a tolerance an earlier round verified. METHOD §3 has no reach clause.
  - **For P2:** the job and the frames already taken are kept. Save video works. A note names the cause in the panel. Y4-P3-1, the same symptom with a longer trigger, was confirmed P3.
- **Announced?** No. The note says the camera stopped; that the recording will not resume, and that a ~1 s pair of failures is enough, is not said.
- **Novelty:** new. A cross-component regression: ADR-692 Amd 1's back-off turns the recorder's 250 ms retries into instant failures. It shares Y4-P3-1's root (still open), and one fix covers both.
- **Fix direction:**
  - Count failures over time, not in a row. For example, stop only after 60 s without a picture, or never stop while the source is live and skip the missing frames.
  - Retry at the interval, or at the bridge's `retryAt`, not every 250 ms. Do not count a held-back 503 as a camera failure.
  - Resume when pictures come back.
  - Raise a toast when a recording stops mid-job.
  - Add a test with `CameraFrameSources` in the loop.

### K4-P2-2 — Job watch keeps an RTSP camera "on" with the panel closed, but the bridge fails its preview session when the last viewer closes, and the window then turns the camera off: the recording ends mid-job, or the next job has no timelapse and no burn check

- **Where (`ba08a81af`):**
  - `electron/rtsp-camera-session.ts`:
    - `:91-94`: `markClosed` fails the session when its last connection closes.
    - `:83-85`: `markFailed` fails it for every connection.
    - `:25`, `:113-118`: a session nobody claims fails after 15 s.
  - `electron/rtsp-camera-stream.ts:176-183`: the client going away calls `onClosed`. `:145-153`: 10 s without ffmpeg output calls `onFailure`.
  - `src/ui/state/camera-source-lifecycle.ts:96-121`: `monitorRtspSource` polls every 1 s, and `failed` → `reportSourceFailure` → `sourceState: error`, "RTSP preview stopped… press Reconnect". There is no automatic reconnect.
  - **What closes the last viewer, by READ:**
    - `CameraPanel.tsx:151` keeps the source when the panel closes if `jobWatchWantsCamera()`, but the panel's `<img>` closes.
    - `WorkspaceCameraOverlay.tsx:49`: a `bedPicture` replaces the live overlay.
    - `:62`: a held still (Alt+C / Refresh) does the same.
    - `job-watch-runner.ts:222`: the watcher calls `showBurnCheckOnCanvas()` itself after every checked job.
    - `use-machine-frame.ts:28-48`: the overlay feed (the only other viewer) closes with it.
  - The timelapse then ends: `timelapse-recorder.ts:108-110`.
- **Anchor:**
  - **Contract:** ADR-490 D1: "While either is ticked, the camera keeps running when the panel closes, so it is there when a job starts."
  - **Panel text** (`JobWatchSection.tsx:58`): "The camera stays on while these are ticked."
  - **Twin:** a USB or snapshot camera does stay on (Y4 "Verified clean").
- **Evidence:** **REPRO** `e3-rtsp-session.mts` → `e3-rtsp-session.out.jsonl` (real sessions, monitor, store and recorder):
  - The last viewer closing at 8.0 s turned the camera off 39 ms later. The timelapse ended at 4 of 13 frames with "The camera was turned off or switched."
  - Never claimed: the camera was turned off at 15.1 s, 8 of 13 frames.
  - One of two viewers' ffmpeg failing: off 52 ms later.
  - The control (one of two viewers closes) stayed live and complete.
  - The React unmounts that close the connection are READ.
- **Scenario:**
  1. An RTSP IP camera, calibrated, with the overlay on, timelapse and burn check ticked, and the Camera panel closed.
  2. Job 1 finishes. The watcher draws the burn-check picture on the canvas. That replaces the live overlay, the preview's last connection closes, and the camera is off within about a second.
  3. Job 2 starts: "The camera was not running when the job started, so there is no timelapse." The burn check is unavailable, and the live picture is gone.
  4. Also, mid-job: pressing Alt+C or Refresh picture, closing the panel with an uncalibrated camera, or one 10 s hiccup in the panel's ffmpeg preview ends the current recording and the burn check.
- **Severity:** **P2.**
  - **For P1:** the recording and the check the operator asked for are lost in the default calibrated set-up, with no camera fault at all. The trigger is the watcher's own action.
  - **For P2:** the job is unaffected. The camera shows an error state in the panel, and the overlay disappears (visible, but not a warning).
- **Announced?** No. The panel text and ADR-490 D1 promise the opposite.
- **Novelty:** new. The session-close rule (`cf4ec9ca7`, #562, 2026-08-01) predates job watch (ADR-490, 2026-09-27), which did not account for it. Y4 and Z1 used snapshot, USB and MJPEG stand-ins with no preview session.
- **Fix direction:**
  - Have the bridge treat "no viewers" as idle, not failed. Fail only on an ffmpeg failure, and per connection, not the shared session.
  - Or have job watch hold its own preview claim, or monitor stills instead of the preview while watching.
  - Reconnect an RTSP source automatically while a watch wants it.
  - Toast when a watched camera stops.

### K4-P2-3 — Continue after a lost connection, Second pass, or any new watched job empties the last timelapse at once, with no prompt to save it; a run started within 3 s of the end also loses the final frame

- **Where (`ba08a81af`):**
  - `src/ui/camera/job-watch/job-watch-runner.ts`:
    - `:62-66`: a new run ends the old job as `stopped` and begins a new one.
    - `:98`: `useJobWatchStore.setState({ timelapse: null })`.
    - `:188`: the old job's `endJob` returns before `finish` once the generation moved.
  - New runs come from `laser-recovery-flow.ts:162-191` (Continue rebuilds a canvas plan) and `second-pass-execution.ts:177`.
- **Anchor:**
  - **ADR-490 Consequences:** "A job continued after a lost connection is a new job to the watcher. It starts a new timelapse…" and "The timelapse and the check live until the next watched job or **Clear**."
  - **Twin:** Clear and Save video are explicit operator actions in the panel. Here the loss rides on Continue, a machine action.
- **Evidence:** **REPRO** `e2-runner.mts` → `e2-runner.out.jsonl`:
  - Continue 1 s after a disconnect: the store went from 10 frames to 0, and ended with only the continued job's 6.
  - With Save video on screen for 10 s, Continue replaced the finished 11 frames.
  - A second job 2 s after a finish dropped the first job's 8 frames and its final frame.
- **Scenario:**
  1. A 4-hour photo engrave with a timelapse. The USB cable is knocked out at 3 h 30.
  2. The operator reconnects and presses **Continue**, the recovery the app offers.
  3. The 3.5-hour timelapse is replaced the moment the continued run starts. The video of the job is the last 30 minutes.
- **Severity:** **P2**, with a **maintainer decision**.
  - **For P1:** this is the brief's "silently losing the user's recording at the end of a long job" almost word for word. A visible result is not a warning.
  - **For P2:** the ADR decided the replacement, and the panel shows Save video before Continue, if it is open.
- **Announced?** To the maintainer, in ADR-490's Consequences. Not to the operator: no prompt, toast or note.
- **Novelty:** new as a finding. Y4 listed "the timelapse and check live until the next watched job" under verified-clean storage, without the Continue case.
- **Fix direction:**
  - Make a continued run after a lost connection (the same `recoveryRunId` / plan) append to the same timelapse.
  - Otherwise keep the previous recording until it is saved or cleared, and ask once ("Save the last timelapse first?") when a new watched run would replace an unsaved one.
  - Take the final frame even when the next run starts within 3 s, or say it was skipped.

### K4-P3-1 — A calibrated (flat) timelapse whose camera changes picture size mid-job stops adding frames, says nothing, shows "Recording…", and re-fetches pictures every 250 ms

- **Where:**
  - `timelapse-recorder.ts`:
    - `:164-174` (`workedFrame`): a `flattenSpecFor` issue or an `unseen` reply after the first frame returns `null`.
    - `:89-93`: `null` resets `failures` to 0 and adds nothing, so the frame stays due and is retried at the next 250 ms tick.
    - `:192` does the same in the window path.
  - `camera-model-frame.ts:31-44`: another shape, or a size not proved a resize, is an issue.
- **Anchor:** ADR-490 D3 (a frame every interval). Twin: camera failures are counted and noted (`:84-87`), while these are not. Z1-P3-1 is the worker-crash sibling of the same uncounted path.
- **Evidence:** **REPRO** `e7-flat-size-change.mts` → `e7-flat-size-change.out.jsonl`:
  - 0 of 10 frames from 10–30 s at 640 × 480 or 3840 × 2160, with `note: null` and `recording: true`.
  - The camera was fetched 3.6 and 2.5 times a second, against 0.5 in the control.
- **Scenario:** a phone camera app or an RTSP camera drops its resolution on a weak link during a long job. The panel keeps showing "Recording the timelapse: N frames" for the rest of the job, which then has a few minutes of video. Meanwhile the camera is polled at up to 7 times the planned rate.
- **Severity:** P3. The job is unaffected, and the burn check says why when it compares.
- **Announced?** No.
- **Novelty:** new trigger. It overlaps Z1-P3-1 (worker failures uncounted).
- **Fix direction:** count `null` and `unseen` results as misses, at the interval and not every tick. After a first flat frame, fall back to a plain frame with a note ("The camera's picture size changed; the rest of the timelapse is unflattened"), or stop with a note.

### K4-P3-2 — A JPEG cut short by a camera that closes cleanly passes the bridge and is kept as a timelapse frame

- **Where:** `electron/camera-frame-proxy.ts:209-220` checks only that the frame is non-empty and has the JPEG magic or an image type. No end marker (FF D9) is checked. `camera-picture-client.ts:78` accepts whatever `createImageBitmap` accepts.
- **Anchor:** the bridge's own content checks, which refuse an empty or non-image frame. ADR-490 D3.
- **Evidence:** **REPRO** (bridge side) `e1-recorder.mts`, `truncated-10s`: 5 of 5 truncated frames (60 % of the bytes) were served 200 and kept, with no failure. Whether Chromium decodes them, which it usually does with a grey lower part, is **not verified** (no browser).
- **Severity:** P3. The recording has a few corrupt frames and the job is unaffected.
- **Novelty:** new.
- **Fix direction:** have the bridge refuse a frame without an end marker (or one shorter than its Content-Length) as "Camera sent an incomplete picture.", which the existing failure path then handles.

## KNOWN: status on `ba08a81af`

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y4-P1-1 (ADR-490 Amd 2) | Job-watch picture work on the UI thread | **Fixed, holds** (Z1). The worker path is what E1/E2/E7 drove; `beforeImage` and `workedFrame` use the client | READ `burn-check-run.ts:121-146`, `timelapse-recorder.ts:151-175` |
| Y4-P2-1 | Remote still on the UI thread | Fixed (Z1); not re-run | — |
| Y4-P1-2 / Z1-P1-1 | Overlay upload / shrink on the UI thread | **Fixed by READ** (ADR-440 Amd 11: shrink in the worker, `machine-frame-feed.ts:113-119`) | READ; not run in a browser |
| Z1-P2-1, Z1-P2-2 | Moved-check capture and Alt+C decode in the window | **Fixed by READ** (`moved-check-capture.ts:45-60`, `capture-overlay-still.ts:33-34` via the worker) | READ |
| **Y4-P3-1** | 5 failures in 250 ms retries end the timelapse | **Still open, and worse:** with the bridge back-off, two real failures about 1 s apart are enough → **K4-P2-1** | E1 |
| Y4-P3-2 | No timelapse for G-code Inspector runs, or for an uncalibrated camera after a restart | Still open (`job-watch-runner.ts:74-75` watches `liveCanvasRun` only) | READ |
| Y4-P3-3 | Camera live with the panel closed; stills leave no trace | Still open; not re-checked beyond READ | READ |
| Z1-P3-1 | Picture-worker failure → silent, 250 ms retries | Still open (`'failed'` → `jpegOf` null → `failures = 0`, `:89-93`); K4-P3-1 is the same path with a new trigger | READ + E7 |
| Z1-P3-2 | EXIF orientation vs header size | Still open (no orientation handling in `mjpeg-parts.ts`, `picture-work*.ts`) | READ |
| v2 12-P3-2 | No blank or frozen frame check in the burn check | Still open: a camera that serves the same picture before and after reads as "a change along 0% of the path" in red | READ (`burn-comparison.ts`) |
| v2 12-P3-3 / W4-P3-1 | A camera that stops leaves its last picture on the canvas with no sign | **Still open, now for bridge cameras on the new feed:** `pollJpeg` swallows failures and `useMachineFrame` passes no `onFailure`. Refused 5–25 s: last picture at 4.8 s, still shown at 35 s (the back-off adds up to 16 s after the camera is back). Hung 5–35 s: a 38 s gap. No notice | **REPRO** E4 |
| ADR-490 Consequences | The burn check runs in the window at job end | As announced; not timed | READ |

## Refuted (candidates dropped)

- **A camera stall or flood starves the G-code stream.** Job watch takes one picture per due interval, serially, and never more than one in flight (`timelapse-recorder.ts:106-115`). The bridge serialises per host and shares one fetch per URL (`camera-frame-proxy.ts:59-80`). In the desktop main process (E5), realistic camera rates showed no attributable change in a network-streamed job; only back-to-back 4K at about 7 frames a second (30 MB/s, far over anything the app requests) cut the stand-in sender from about 1,600–2,600 to 443 lines a second.
- **Frames out of order or from the wrong moment.** Every one of 18 + 6 + 3 runs kept frames in strictly increasing camera order, with the final frame last. A frame is a fresh capture (stamp lag 0–38 ms on a fast camera, 501–531 ms on a 500 ms camera). The bridge only joins a fetch already in flight, which is older than the request. That is conservative for the burn check, whose "already burned" guard is read after the picture arrived (`burn-check-run.ts:98-112`).
- **The timelapse grows without bound.** 12 h → 310 frames, 74 MB at 250 KB a frame, heap flat (E8). Bridge registries are capped (32 sources, 64 sessions). The MJPEG reader drops parts over 16 MiB and headers over 4 KB, and recovered from a 20 MiB part (42 MB peak, E4).
- **Recording during a pause.** 0 camera requests in a 10 s pause (E2).
- **The recording after Abort.** Ends with the 3 s final frame, `recording: false`, Save video offered (E2).

## Verified clean

- **Pause / Resume / Abort / finish:** in order, with the final frame (E2).
- **Slow, bursty and 4K cameras:** complete. Captures of up to 226 ms (4K) and 539 ms (slow camera) do not shift the 2 s spacing, because the request time sets it (E1).
- **Single failures:** one refused, HTTP 500, dropped-mid-body or malformed answer costs one late frame (E1).
- **MJPEG preview robustness:** malformed parts, no Content-Length, a wrong content type and a dropped stream are skipped or reported. Ordering holds (E4).
- **Disk:** nothing is written before **Save video…**. The video is made in memory (at most about 32 MB) and written only to the file the operator picks (READ `TimelapseResult.tsx:177-207`). No temp files.
- **Capture binding:** a frame of another shape, or an unproved size, is refused for flattening, never flattened with the wrong lens (`camera-model-frame.ts:31-44`; E7). The cost of that refusal is K4-P3-1.
- **Picture quality** (`picture-quality.ts`): sampling is capped at 40,000 pixels and used only by the setup wizard's advice; nothing in job watch reads it.

## Not verified

- **Chromium itself:** no browser was allowed. That covers the decode of truncated JPEGs (K4-P3-2), the React unmounts that close the RTSP preview (K4-P2-2, READ), `MediaRecorder` export, the worker route of Web Serial, and the canvas freeze in the browser (the feed behaviour was run in Node).
- **Real RTSP / ffmpeg:** ffmpeg is not installed. The preview session state machine and monitor were run; the 10 s activity timeout and the ffmpeg exit paths are READ.
- **E5 under load:** this PC's idle event-loop p99 was 90–130 ms (other sessions), so small main-process effects could not be resolved. A quiet machine and a real controller with a 15-block planner would be needed to rule out short starvations on raster jobs over the network.
- **App close mid-recording:** frames are in-memory `Blob`s and are lost, as ADR-490 announces ("not saved with the project"). Not run.
- **Disk full on Save video** (KNOWN boundary), **real phones and cameras**, and the remote still.

## Repro files

All files are in scratchpad `zz-k4\`. Run from there with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file>`, adding `--expose-gc` for E4 and E8. The stub must be running for E1–E5 and E7: `node stub-cam.mjs`, on 127.0.0.1:5311 (camera) and :5315 (GRBL).

- `gen-frames.cjs` → `frames/{small,hd,4k,huge}.jpg` (sharp).
- `stub-cam.mjs`: stub camera and GRBL; `GET /ctl?mode=…&size=…&count=…&stallMs=…`.
- `k4lib.mts`: the bridge stand-in (real `serveHttpFrame` + `CameraFrameSources`) on :5313, the decode stand-in and the stamp reader.
- `e1-recorder.mts` → `e1-recorder.out.jsonl`, `e1.log` (K4-P2-1, K4-P3-2, verified clean).
- `e2-runner.mts` → `e2-runner.out.jsonl` (K4-P2-3, pause and abort).
- `e3-rtsp-session.mts` → `e3-rtsp-session.out.jsonl` (K4-P2-2).
- `e4-feed.mts` → `e4-feed.out.jsonl`, `e4.log` (KNOWN 12-P3-3 / W4-P3-1, MJPEG robustness).
- `e5-mainproc.mts` (`paced` for the realistic cases) → `e5-mainproc.out.jsonl`.
- `e7-flat-size-change.mts` → `e7-flat-size-change.out.jsonl` (K4-P3-1).
- `e8-long-job.mts` → `e8-long-job.out.jsonl` (bounded memory).

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"K4-P2-1","severity":"P2","area":"job-watch-and-timelapse","file":"src/ui/camera/job-watch/timelapse-recorder.ts","line":86,"anchor":"ADR-490 D3; Y4 verified a 25 s stall tolerated (Y4r >=45 s); ADR-692 Amd 1 §5 back-off","evidence":"REPRO","known":false,"summary":"Bridge back-off (66e5568e1) answers instant 503s after a failure; the recorder's 250 ms retries count them, so two real failures ~1 s apart end the timelapse for the rest of the job: refuse 2 requests 5/16 frames, login page 3 s 5/16, refuse 20 s 5/26, stall 60 s 5/46 (ended at 31.4 s), hang 30 s 5/38; never resumes; panel note only"},
  {"id":"K4-P2-2","severity":"P2","area":"job-watch-and-timelapse","file":"electron/rtsp-camera-session.ts","line":92,"anchor":"ADR-490 D1 'camera keeps running when the panel closes'; panel text 'The camera stays on while these are ticked'","evidence":"REPRO","known":false,"summary":"RTSP preview session fails when its last viewer closes (or after 15 s unclaimed, or one viewer's ffmpeg fails); monitorRtspSource then turns the camera off (39-52 ms). Panel close with no live overlay, Alt+C, or the watcher's own burn-check picture on the canvas kills the camera: recording ends mid-job (4 of 13 frames) or the next job has no timelapse/burn check; no reconnect"},
  {"id":"K4-P2-3","severity":"P2","area":"job-watch-and-timelapse","file":"src/ui/camera/job-watch/job-watch-runner.ts","line":98,"anchor":"ADR-490 Consequences (announced to maintainer only); brief: silent loss of a long job's recording","evidence":"REPRO","known":false,"summary":"Continue after a lost connection, Second pass or any new watched run empties the previous timelapse at once with no prompt (10 frames gone 1 s after disconnect; finished 11-frame timelapse replaced); a run within 3 s of the end also loses the final frame; maintainer decision"},
  {"id":"K4-P3-1","severity":"P3","area":"job-watch-and-timelapse","file":"src/ui/camera/job-watch/timelapse-recorder.ts","line":173,"anchor":"ADR-490 D3; twin: camera failures are counted and noted; sibling Z1-P3-1","evidence":"REPRO","known":false,"summary":"Flat timelapse after a mid-job frame-size change (another shape or unproved resize) adds 0 of 10 frames, no note, recording stays true, camera fetched 2.5-3.6/s instead of 0.5/s"},
  {"id":"K4-P3-2","severity":"P3","area":"job-watch-and-timelapse","file":"electron/camera-frame-proxy.ts","line":213,"anchor":"bridge's own content checks; ADR-490 D3","evidence":"REPRO","known":false,"summary":"A JPEG truncated by a cleanly closing camera passes the bridge (no FF D9 check) and is kept as a timelapse frame (5/5); Chromium decode not verified"}
]
```

Auditor counts: raised 5, refuted 0, P1 0, P2 3, P3 2, known 12

## Refuter (2026-11-14)

**Tree and harness.** Same read-only export `j42-main` (`origin/main` @ `ba08a81af`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera electron` at `53393cc16` (after #1917 / #1918 / #1919) touches only `core/camera/model/extrapolation-estimate*`, `head-camera-estimate*` and `ui/camera/calibrate/*` (Nudge, calibration result). Nothing in job watch, the recorder, the picture client, the overlay feed, the bridge, the frame sources or the RTSP sessions changed, so every result here stands on current main.

My files are in `zz-k4r\`. I read the auditor's scripts for API shape only; nothing imports a `zz-k4` file. My method differs on purpose:
- **The real bridge server, not a stand-in.** `startLocalRtspCameraBridge(5323)` (open development mode) runs in-process, so `/frame-source`, `/frame.jpg` (the real `handleFrameRequest` with its held-back 503), `/probe`, `/stream.mjpg` (the real `handleStream` → `streamWithFfmpeg`), and `/stream-status` are the app's own routes and HTTP lifecycle. My loader (`ts-resolve.mjs`) swaps only four modules:
  - the address policy, so loopback is allowed;
  - `node:child_process` inside `rtsp-camera-stream.ts`: an in-process **fake ffmpeg** that answers `-version`, writes an mpjpeg part every 100 ms, writes one JPEG for a still, and can be told to exit on its own or to stall;
  - the RTSP login relay and probe (no-ops).
- **The real window side.** `createHttpCameraBridge` (the web bridge client) and the real camera store:
  - `startRtspSource` → probe → live → the real `monitorRtspSource`;
  - `registerFrameSource` for snapshot cameras;
  - the real `startMachineFrameFeed` (overlay: `pollJpeg` at the snapshot camera's 500 ms, `readStream` for RTSP);
  - the real `startTimelapse` with the real `captureSourceBitmap`;
  - the real `installJobWatch` on the real laser store.
- **My own stub camera** (`rlib.mts`, 127.0.0.1:5321, in-process), scripted per request: ok, refuse (socket reset), HTML, HTTP 500, stall until a time, hang, and three kinds of truncation. My own JPEG-shaped frames and header reader (`jpeg.mts`) stand in for `createImageBitmap`.
- **The panel's `<img>`** is a `fetch` of the preview URL, aborted when the panel closes. That is the same `res` 'close' the bridge sees; the auditor READ this step.
- **Runs.** One test process at a time (≤ 350 MB, peak RSS about 120 MB). For r5, a plain-Node camera and puller ran beside it. 330 MB–1.07 GB free; the PC was paging, and loading the store modules alone took up to 3 min 20 s. No Vitest, browser, pnpm, ffmpeg, real camera or hardware. All my servers (5321, 5323, 5325, 5326) were stopped; no listener is left on 5320–5329.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
|---|---|---|---|
| K4-P2-1 | **CONFIRMED, and worse than reported.** With the overlay showing the same phone or snapshot camera, a single camera stall of just over 10 s, or a 1.2 s refusal, ends the recording. The recorder's own 5 failures are then all **held 503s**: it never asked the camera itself | **P2** (merge Y4-P3-1 into it) | `r1-backoff.mts` |
| K4-P2-2 | **CONFIRMED end to end** through the real bridge HTTP close path, the real store and monitor | **P2** | `r2-rtsp.mts` |
| K4-P2-3 | **CONFIRMED** with the real runner | **P2**, maintainer decision (not P1, argued below) | `r3-runner.mts` |
| K4-P3-1 | **CONFIRMED by READ** (exact lines); not re-run | P3 | READ |
| K4-P3-2 | **CONFIRMED, narrowed.** A cut picture passes only when the camera sends no length, or a length matching the cut bytes. A declared length cut short is refused | P3 | `r4-bridge.mts` part A |

**K4-P2-1: CONFIRMED; worse with the overlay on; P2.**

Real bridge, 2 s interval, outage from 9.5 s. Frames are kept / about 12 expected for a 24 s job (21–23 for 40–44 s). All 18 runs kept frames in strictly increasing camera order.

| Outage | Recorder alone | With the real overlay polling the same source every 500 ms |
|---|---|---|
| none (control) | 12 | 12 |
| 1 refused request | 11 (1 × 502, 3 × 503, then 200) | 12 (the overlay took the refusal; the recorder got one 503) |
| 2 refused requests | **5, ended at ~12 s** (502, 3 × 503, 502) | **5** |
| refuse 600 ms | 12 (window missed the recorder) | 12 |
| refuse 1.2 s | 12 (window missed the recorder's request) | **5: the recorder ended on 5 × 503 and never reached the camera.** The overlay's two refused polls (9.58 s, 10.63 s) set the back-off to 1 s, then 2 s |
| refuse 2.5 s / HTML page 3 s | **5** | **5** |
| stall 16 s (requests held until 25.5 s) | 13 / 21: first timeout at 20.7 s, retry at ~21.9 s answered | **5 / 21: ended at ~21 s after one timeout.** The recorder's request joined the overlay's stalled upstream fetch, and both got the 502 at 19.9 s |
| stall 25 s | **5 / 23, ended at 31.7 s** (timeouts 20.6 s and 31.7 s). Y4 measured a 25 s stall as tolerated | **5 / 23** |

- **Thresholds (recorder alone).**
  - For a refusal it is about 1.07 s of continuous outage: the first real failure, three held 503s, then the second real attempt. That is **unchanged from Y4-P3-1** (1.06 s). The back-off adds the two-separate-blips trigger.
  - For a stall it falls from 45–50 s (Y4r) to about 21 s.
- **With the overlay on**, the usual calibrated phone or snapshot set-up, both thresholds drop. About 1.1 s of refusal, or one stall of more than 10 s, is enough. The recorder counts the 503s caused by the overlay's failures (`camera-picture-client.ts:76-77` → `timelapse-recorder.ts:84-87`).
- **The double count** behind the 16 s case is raised separately below (K4r-P3-1).
- **Operator told?** No toast (READ: neither `timelapse-recorder.ts` nor `job-watch-runner.ts` raises one). The only sign is the note in the Camera panel, "The camera stopped sending pictures. The timelapse stopped at 5 frames." It never resumes.
- **Severity: P2, not P1.**
  - The frames already taken are kept and Save video works, so no stored work is deleted.
  - What is lost is the rest of a recording that was never made. The job is untouched.
  - P2 rather than Y4's P3: the trigger is now any ordinary 1 s Wi-Fi or lock-screen blip, or one 10 s stall with the overlay on, and the operator learns of it only after the job.
  - Y4-P3-1 is the same root and the same fix. The coordinator should close it into K4-P2-1.

**K4-P2-2: CONFIRMED end to end; P2.**

Real bridge + fake ffmpeg, real store `startRtspSource` and monitor, real overlay `readStream`, real recorder (stills through `/frame.jpg` → `serveRtspFrame` → fake ffmpeg still).

| Scenario | Session (from `/stream-status`) | Camera | Recording |
|---|---|---|---|
| Panel + overlay, panel closes at 6.3 s (control) | live throughout | live | 10 / 11 |
| …then the overlay feed stops at 12.4 s (the burn-check picture, an Alt+C still, or the overlay hidden) | **failed 12.5 s**, "RTSP preview connection closed." | **error 13.2 s**, "RTSP preview stopped. Check the camera and bridge, then press Reconnect." | **7 / 12**, "The camera was turned off or switched." |
| Panel only (uncalibrated, or overlay off), panel closes at 6.0 s | **failed 6.2 s** | **error 6.2 s** | **3 / 11** |
| Panel + overlay, the panel connection's ffmpeg exits at 6.3 s | **failed 6.5 s**, "FFmpeg camera preview ended unexpectedly." | **error 7.1 s**, though the overlay's own stream was healthy (40 frames, no failure) | **4 / 11** |
| Panel + overlay, the panel connection's ffmpeg stalls at 6.3 s | **failed 16.4 s** (10 s watchdog), "stopped producing data" | error 16.3 s | **8 / 16** |

- **After any failure, the same session refuses a new viewer** (`409 "RTSP preview session is missing or expired."`). Nothing reconnects; only the operator's Reconnect does.
- **The React steps are READ:**
  - `WorkspaceCameraOverlay.tsx:49` swaps `ModelOverlay` for `BedPictureOverlay` when `bedPicture` is set;
  - `:62` drops `liveSource` while an `overlayStill` is held;
  - the `useMachineFrame` cleanup aborts the feed;
  - `job-watch-runner.ts:222` → `showBurnCheckOnCanvas` (`:260-266`) sets `bedPicture` after every checked job.
- **Correction.** The panel-only case means every RTSP camera that is not drawn live on the canvas dies the moment the panel closes. So "The camera stays on while these are ticked" (`JobWatchSection.tsx:58`) is false for it from the start. The next job then shows "The camera was not running when the job started, so there is no timelapse" (`job-watch-runner.ts:283`).
- **Severity: P2.** The job is unaffected, and nothing stored is lost. The recording and the burn check the operator asked for are not made. The cause is the app's own view changes, or a hiccup in one viewer's ffmpeg.

**K4-P2-3: CONFIRMED; P2 with a maintainer decision.** Real `installJobWatch` (`r3-runner.out.jsonl`).

| Step | Store |
|---|---|
| Job A runs 12 s, loses its connection | 6 frames, recording |
| 8 s later | 7 frames (final frame added), **Save video shown** |
| Continue: a new run with the rebuilt plan, 14 ms later | **0 frames**, recording; the 7 frames are gone, no note |
| Job B finishes, and job C (Second pass / next job) starts 1 s later | B's 3 frames gone; **B's final frame never taken** (`finalFramesTakenForB: 0`; `endJob` checks `isCurrent()` before the capture, `:185-188`) |

- READ: `laser-recovery-flow.ts:162-191` rebuilds the canvas plan with a new `recoveryRunId`, so the watcher sees a new run (`job-watch-runner.ts:62-66`) and clears the store (`:98`).
- **Why P2 and not P1.**
  - ADR-490's Consequences decide exactly this: "a new job to the watcher. It starts a new timelapse" and "live until the next watched job or **Clear**".
  - The timelapse is a by-product the app records, not work the operator made or stored. The project and the job's output are untouched.
  - **For P1:** METHOD §3 counts no announcement to the maintainer as a warning to the operator. Continue is a recovery step, taken when the operator is busiest. No prompt or toast is given.
  - **The maintainer should decide** whether a continued run appends to the same recording.

**K4-P3-1: CONFIRMED by READ; P3.**
- `timelapse-recorder.ts:166-174`: a `flattenSpecFor` issue (`camera-model-frame.ts:31-44`: another shape, or an unproved resize) or an `unseen` reply after the first frame returns `null`.
- `:89-93`: `null` resets `failures` and adds nothing. The frame stays due and is fetched again at the next 250 ms tick, with "Recording…" still shown.
- Not re-run: memory and time went to K4-P2-1 / K4-P2-2. The auditor's E7 numbers are consistent with the 250 ms tick plus capture time.

**K4-P3-2: CONFIRMED, narrowed; P3.** Through the real bridge (`r4-bridge.out.jsonl`, part A):

| Camera sends | Bridge |
|---|---|
| Content-Length of the whole picture, 60 % sent, then the connection drops | **502** "Camera frame fetch failed." (undici rejects the short body) |
| No Content-Length, 60 % sent, clean close | **200**, 18,039 bytes, JPEG header ok, **no FF D9** |
| A cut picture whose Content-Length matches what is sent | **200**, no FF D9 |
| HTML / HTTP 500 | 502 "did not return an image" / "returned HTTP 500" |

- So the case needs a close-delimited or chunked camera server, or a camera that cuts its own buffer. That is narrower than "closes cleanly mid-picture".
- Chromium's decode of such a frame is still not verified.

### "Safe" claims (spot-check)

- **At most one picture per interval.** Confirmed in every r1 run: each recorder request comes 2.0–2.2 s after the last kept frame, except the 250 ms retries after a failure.
- **Pause takes no pictures.** READ only (`jobRunning` is `lifecycle === 'running'`, `job-watch-runner.ts:110`; `tick` returns at `:79`).
- **Abort keeps the recording.** r3 shows the disconnected run keeping 7 frames with Save video offered until the next run.
- **Frames in order.** 18 of 18 r1 runs strictly increasing.
- **Bridge bounds (10 s, 8 MiB).** The 10 s timeout is seen in the stall runs (502 at about 10.0–10.1 s after the request). 8 MiB not re-run.
- **Nothing on disk before Save video; 12 h bounded.**
  - READ only: `addTimelapseFrame` caps at 480 frames by halving.
  - `encodeTimelapseVideo` decodes one frame at a time and closes it, holding only the recorder's chunks (8 Mbit/s × video length, about 32 MB for 480 frames).
  - The file is written only through `pickPreparedSaveTarget`.
- **"No camera-attributable G-code slow-down": challenged, not refuted.**
  - `r5-main.mts` runs the real bridge in one process with my own character-counting sender and in-process "GRBL" (1 ms per ok). The camera and the window's pulls run in a second plain-Node process, so only the bridge's work lands on the sender's event loop.
  - Two repetitions:

    | Camera load through the bridge | Lines/s | Ack p99 / max (ms) | Loop p99 / max (ms) |
    |---|---|---|---|
    | idle (6 runs) | 310–371 | 21–47 / 30–90 | 20–39 / 22–90 |
    | 4 MB every 500 ms (phone overlay) | 254–282 | 108–126 / **524–561** | 86–127 / **508–530** |
    | 4 MB every 400 ms (overlay + timelapse) | 294–298 | 89–133 / 195–229 | 88–119 / 174–311 |
    | 400 KB every 400 ms | 308–371 | 22–60 / 28–137 | 20–52 / 22–75 |
    | 4 MB back to back (no app rate) | 240–260 | 101–112 / 136–181 | 99–108 / 128–183 |

  - At 4K-sized snapshot frames, the app's own rates raise the main-process event-loop p99 3–5× and cost about 20 % of the stand-in sender. There is one ~0.5 s stall per first loaded run, which matches the auditor's single 650 ms spike in E5. 720p-sized frames are within noise.
  - My PC was paging (330 MB–1 GB free), which can inflate buffer copies. No real controller or IPC path was in the loop, so planner starvation was not shown.
  - Not counted. A quiet-machine run with the real `MachineNetworkSession` and IPC is owed before "no slow-down" is called verified for 4K phone cameras on network-streamed jobs.
- **KNOWN 12-P3-3 / W4-P3-1 (frozen picture): confirmed.**
  - `pollJpeg` (`machine-frame-feed.ts:145-170`) ignores a non-ok answer and catches errors.
  - `useMachineFrame` (`use-machine-frame.ts:31-40`) passes no `onFailure`, so a snapshot or phone camera's last picture stays with no mark.
  - In r1's overlay runs, the overlay got 503s for up to 2 s after each failure (1–16 s by design), with no frame and no sign.

### New findings

**K4r-P3-1: one failed camera fetch shared by two waiting views is counted twice by the bridge's back-off, so it holds the camera back 2 s (4 s with three views) after one failure, and every view's 503 counts against the timelapse.**
- **Where:**
  - `electron/camera-frame-proxy.ts:62-64`: concurrent requests for the same camera URL share one in-flight fetch;
  - `:142`: each request then calls `sources.noteFrame(sourceId, failure)`;
  - `electron/camera-frame-sources.ts:83-85`: each call adds a failure and doubles the wait.
- **Anchor.** ADR-692 Amendment 1 (`camera-frame-sources.ts:15-18`): "After a failed picture the camera is left alone for a while, longer each time". That is one step per failed ask of the camera.
- **Evidence:** REPRO, `r1-backoff.mts` `stall-16s+overlay500`.
  - The overlay's request (9.88 s) and the recorder's (10.6 s) shared the stalled upstream fetch, and both got 502 at 19.90 s.
  - The recorder's 503s then ran to 20.97 s, 1.07 s after the failure, where a 1 s back-off would already have let it through. The overlay's 503 at 21.45 s fits the same 2 s back-off.
  - The recorder ended on 4 held 503s after that single shared timeout, 5 of 21 frames. The same 16 s stall without the overlay kept 13 of 21.
- **Severity: P3.** The defect is in the accounting. Its harm lands through K4-P2-1 (a stopped recording) and KNOWN W4-P3-1 (a longer freeze).
- **Fix direction:** note the outcome once per upstream fetch (inside `fetchFrameBytesQueued`), not once per waiting request. With K4-P2-1, do not count a held 503 as a camera failure in the recorder.

### Not verified

- Chromium (no browser): the decode of a truncated JPEG, the React unmounts (READ), and MediaRecorder encode memory.
- The real ffmpeg process exit and stdout timing: the fake reproduces the stream module's events, not ffmpeg itself.
- K4-P3-1 not re-run.
- The E5 / r5 main-process effect on a quiet machine with a real controller and the IPC path.
- App close mid-recording. READ: frames are in-memory `Blob`s, with no unload guard for an unsaved timelapse. ADR-490 says "not saved with the project".
- Two cameras: one `sourceState` at a time. A switch mid-job ends the recording with "turned off or switched", as designed (`watchCameraStillRunning`).
- A camera unplugged during Save video: the encode reads the stored Blobs only (READ).

### Repro files

All in `zz-k4r\`. Run from there with `node --max-old-space-size=350 --no-experimental-webstorage --import ./register.mjs <file>`.
- `ts-resolve.mjs` (module swaps), `stubs\*.mts` (policy, fake ffmpeg, relay, probe), `jpeg.mts`, `rlib.mts` (stub camera, real bridge, Origin header, decode stand-in).
- `rall.mts` runs `r4-bridge.mts`, `r1-backoff.mts` and `r2-rtsp.mts` in one process, because module loading took minutes. Outputs: `r4-bridge.out.jsonl`, `r1-backoff.out.jsonl`, `r2-rtsp.out.jsonl`, `rall.log`.
  - `r4` part B shares one process between the camera, the bridge and the puller, so its numbers are confounded. Use `r5` instead.
- `r3-runner.mts` → `r3-runner.out.jsonl`.
- `r5-cam.mjs` (plain Node: camera on :5321 and puller on :5326) + `r5-main.mts` → `r5-main.out.jsonl`.

```json
[
  {"id":"K4-P2-1","verdict":"confirmed","severity":"P2","note":"real bridge server + real overlay pollJpeg: recorder alone ends after refuse ~1.07 s (unchanged from Y4) or 2 refused requests, stall 25 s -> 5/23 ended 31.7 s (Y4 tolerated 25 s), stall 16 s survives; WITH the overlay polling the same phone/snapshot source: refuse 1.2 s -> ended on 5 held 503s without the recorder ever reaching the camera, stall 16 s -> 5/21 ended ~21 s after ONE timeout; no toast; merge Y4-P3-1"},
  {"id":"K4-P2-2","verdict":"confirmed","severity":"P2","note":"end to end via real bridge HTTP close path + fake ffmpeg + real startRtspSource/monitor/overlay readStream: overlay stops after panel closed -> session failed 12.5 s, camera error 13.2 s, 7/12; panel-only close -> error 6.2 s, 3/11; one viewer's ffmpeg exits -> error 7.1 s although the overlay stream was healthy, 4/11; ffmpeg stall -> 10 s watchdog, 8/16; session then refuses new viewers (409), no reconnect; every RTSP camera not drawn live dies at panel close"},
  {"id":"K4-P2-3","verdict":"confirmed","severity":"P2","note":"real installJobWatch: Continue (new plan) 14 ms after a finished 7-frame timelapse with Save video shown -> 0 frames, no note; next job 1 s after finish -> previous frames gone and final frame never captured (isCurrent check before capture); not P1: ADR-490 decided it and the recording is an app by-product, not stored user work; maintainer decision"},
  {"id":"K4-P3-1","verdict":"confirmed (READ)","severity":"P3","note":"timelapse-recorder.ts:166-174 null on flatten issue/unseen after first frame, :89-93 resets failures, frame stays due -> 250 ms re-fetch; not re-run"},
  {"id":"K4-P3-2","verdict":"confirmed, narrowed","severity":"P3","note":"real bridge: declared Content-Length cut short -> 502 refused; no Content-Length (close-delimited) cut or self-consistent cut picture -> 200 without FF D9; Chromium decode not verified"},
  {"id":"K4r-P3-1","severity":"P3","area":"job-watch-and-timelapse","file":"electron/camera-frame-proxy.ts","line":142,"anchor":"ADR-692 Amd 1 (camera-frame-sources.ts:15-18) back-off one step per failed ask","evidence":"REPRO","known":false,"summary":"Concurrent /frame.jpg requests share one upstream fetch (:62-64) but each calls noteFrame (:142), so one failure counts twice (2 s hold, 4 s with three views); overlay + recorder sharing one 10 s stall -> recorder ended on 4 held 503s, 5/21 frames vs 13/21 without the overlay"}
]
```

Refuter counts: raised 1, refuted 0, P1 0, P2 3, P3 3, known 2
