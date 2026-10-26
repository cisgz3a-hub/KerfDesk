# Rolling audit v2 — Camera (12 `camera`)

- **When:** 2026-10-21 15:40–17:10   **Tree:** origin/main @ `2c8d988db` (audit worktree HEAD
  `3c99e5465`; `git diff 2c8d988db HEAD -- src electron` is empty)
- **Scope:** `src/core/camera/**`, `src/ui/camera/**`, and the camera parts of
  `src/platform/web/web-camera*.ts`, `src/ui/state/camera-*.ts`, `src/ui/laser/print-cut-camera*.ts`,
  `electron/rtsp-camera-stream.ts` (frame geometry only). Coordinate chain mapped as:
  camera pixel (centre = integer) → `undistortPixel` (Kannala-Brandt inverse, bracketed Newton,
  null past the lens fold) → ray → plane z = −h hit (`bedMapper`) → **scene mm** (canvas frame,
  x right, y down) → `toMachineCoords` (origin corner + bed size) → absolute-mode offset from the
  native bed frame and WCO (`runtimeCoordinatePreparationOptions`) → controller coordinates. The
  overlay runs the forward direction per canvas pixel on the GPU (`bed-overlay-shader.ts`); trace,
  Find pieces, Print and Cut marks, burn check and head stitching run the same forward projection
  on the CPU (`warpFrameToBedImage`). Governing: ADR-440, ADR-441 (+ Amd 1–4), ADR-442, ADR-443,
  ADR-446, ADR-448, ADR-449, ADR-490, ADR-635, ADR-642, ADR-228, ADR-375; WORKFLOW F-CAM1..F-CAM13.
  "Place Board" (`src/ui/laser/board-capture/**`) uses head captures, not the camera model, so it has
  no camera transform to compare.
- **Lenses run:** L2 (OpenCV `fisheye.cpp` and `fundam.cpp`, LightBurn camera docs, W3C Media
  Capture and Streams, WHATWG HTML image loading — all fetched), L3, L4, L6, L7 as separate passes;
  L1 folded into L3/L4 (each ADR clause checked against its code). L5 skipped: bridge and RTSP trust
  are KNOWN from area 04, and saved camera records are strictly normalised (checked, see Verified clean).
- **Counts:** 9 raised → 0 refuted (P2-1 narrowed and downgraded to P3; one P2-3 sub-claim
  softened) → P1 0 / P2 3 / P3 6 (+ 2 KNOWN). Refuter: 9 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED;
  severity change: P2-1 P2 → P3.

## Headline

The camera maths is sound: the lens model matches OpenCV's fisheye model, the inverse is bracketed
and refuses pixels past the lens fold, the DLT seed is Hartley-normalised, and every CPU consumer
uses the same pixel conventions as the GPU overlay. The defects are in what the saved calibration is
tied to. (1) **Opening an older project silently restores its older calibration**, because the
camera model lives in the document's device profile and nothing compares dates or warns
(refuter: this follows ADR-500 Amendment 1 §2, so it is kept as P3, a design call).
(2) **The calibration does not record the scene-to-machine frame its target was engraved in**, so a
later bed-size, origin or native-frame change keeps it and silently shifts the overlay, trace and
Print and Cut marks against the burn (Print and Cut's own captures already key on that frame).
(3) **Head-camera Capture bed/selection jogs to the bed edges without the ADR-375 pull-off clamp**
that Move laser here applies, which can trip a hard-limit alarm. (4) **The burn check grades jobs
whose bed position KerfDesk itself calls unknown** (every no-homing machine) at the artwork, and
reports missed path or stray marks.

## Findings

### P2-1 (now P3) — Opening an older project silently replaces the current camera calibration with that file's older one
- **Where:** `src/ui/state/project-actions.ts:64-80` (`setProject` installs the opened
  `project.device` wholesale); `src/io/project/deserialize-project.ts:352-353` (the file's
  `cameraModel` / `otherCameraModels` are loaded); `src/ui/state/project-bed-reconciliation.ts:55-57`
  (`deviceIdentity` = profile id, name, bed size — the only thing that raises a notice);
  `src/ui/camera/calibrate/use-calibration-photo.ts:147` (Save calibration writes only into the
  current document's device via `updateDeviceProfile`).
- **Anchor:** Ground truth — LightBurn keeps cameras with the device, not the project: "cameras are
  specific to each device", backed up as a separate `.lbcm` camera file
  (https://docs.lightburnsoftware.com/latest/Reference/Cameras/CamerasWindow/ and
  `/Reference/Cameras/EditCamera/`). Twin — every in-flight camera result is retired when the
  device or model changes (`use-camera-trace-lifetime.ts`, `use-calibration-photo.ts` `ownsContext`),
  but a document open that swaps the model itself is not reported. Contract — ADR-441 Amd 1 exists
  so a moved camera is noticed; ADR-446 §1 has projects carry the list, with no rule for which copy wins.
- **Scenario:** The operator calibrates, saves `sign.lf2`, later knocks the camera, recalibrates
  (in another document or unsaved), then opens `sign.lf2`. The opened file's device has the same
  profile id, name and bed, so no reconciliation notice appears. The overlay, Trace from camera,
  Find pieces, Print and Cut marks and the burn check all switch to the older calibration. Nothing
  says so; the Camera panel still shows "Calibrated". With the camera moved 6 mm, the overlay draws
  the material at x = 194 when it lies at x = 200, so artwork placed on it burns 6 mm off. The newer
  calibration is gone unless it was saved in some other file.
- **Evidence:** REPRO (`src/ui/state/zz-12-camera-staleness.test.ts`, deleted): real store,
  `updateDeviceProfile(withSavedCameraModel(...))` with the old model (calibratedAt
  2026-09-26), `serializeProject`, then the new model (camera moved 6 mm, `lookAt([206,-30,-360],…)`),
  then `deserializeProject` + `setProject`. Output: model in use calibratedAt `2026-09-26…`,
  `projectBedReconciliation` `null`; bed point (200, 200) at 3 mm is drawn at `{x: 194.0, y: 200.0}`.
- **Refuter:** CONFIRMED, narrowed; **severity P2 → P3**.
  - **Reproduced.** My repro (`zz-12r-p21`) mounted the real `useMachineProfilePersistence` and
    ran serialize, deserialize and `setProject`. After Open, the model in use is the 26 Sep one,
    `projectBedReconciliation` is null, and bed (200, 200) is drawn at (194.0, 200.0).
  - **Not a broken contract.** ADR-500 Amendment 1 §2 says opening a project "uses that
    document's machine and settings". ADR-446 §1 has projects carry the calibrations. The
    LightBurn anchor does not override an explicit decision.
  - **"The newer calibration is gone" is wrong as stated.** The app's saved machine
    (`kerfdesk.last-machine.v1`) still holds it, and the next start restores it. It is lost only
    after a machine edit in the opened document; one edit rewrote it with the 26 Sep model, and
    **New** also keeps the old model.
  - **Signs the user has.** The Camera panel shows the calibration date
    (`CalibrateCameraControls.tsx:43`), and Frame (ADR-228) shows the real position before Start.
  - **What remains.** No disclosure, and a divergence from LightBurn's per-device cameras. That is
    a maintainer design call, so P3.
- **Fix direction:** Treat camera calibrations as machine data: keep the newer of the open
  document's and the current calibration for each camera, or at least name the switch ("this
  project carries the calibration from 26 Sep; you have a newer one from 21 Oct") in the existing
  reconciliation notice.

### P2-2 — The saved calibration is not tied to the scene-to-machine frame it was engraved in; bed-size, origin or native-frame changes keep it silently
- **Where:** `src/core/camera/model/camera-model-record.ts:23-35` (record holds lens, pose, camera
  binding, accuracy, date; no origin, bed size or native offset); `src/ui/camera/camera-model-frame.ts:17-56`
  (`cameraModelForFrame` checks only camera identity and frame shape); target engraved through
  `src/ui/camera/calibrate/calibration-actions.ts:68-82` with `DEFAULT_JOB_PLACEMENT` (Absolute)
  at `transient-camera-job.ts:55-60`, so ring scene positions become physical positions through
  `toMachineCoords` (`src/core/devices/origin-transform.ts:24-26`, e.g. front-left `y = bedH − y`)
  and the native bed frame. Twin that does key on it: `src/ui/state/native-bed-frame.ts:63-74`
  `nativeBedCaptureFrameKey` (origin, bed width, bed height, native offset), used by Print and Cut
  (`print-cut-camera-request.ts:19`, `print-cut-output.ts:26`, `PrintAndCutDialogHost.tsx:25`).
- **Anchor:** Twin — Print and Cut registration points are invalidated when that frame key changes;
  the camera model, which records the same scene-to-physical mapping more permanently, is not.
  Contract — F-CAM5 "The traced vectors land where the object physically sits"; ADR-440 §5 lists
  what makes a model unusable (another camera, shape or crop) and stops there.
- **Scenario:** A Falcon or diode-laser owner calibrates with bed 400 × 400, front-left origin, then
  corrects Machine Setup to the measured 400 × 410 (or fixes a wrong origin corner, or the native
  bed frame changes because `$130/$131` now match the bed). Every scene point now burns at a
  different machine coordinate — (200, 200) moves from Y200 to Y210; an origin-corner fix mirrors the
  bed — while the overlay, trace, Find pieces and camera Print and Cut marks keep the old mapping.
  No surface says the calibration predates the change. Print and Cut's camera points are even
  stamped with the *current* frame key (`use-print-cut-camera.ts:106-107`), so they pass its own check.
- **Evidence:** REPRO (same deleted file): `updateDeviceProfile({bedHeight: 410})` and
  `({origin: 'rear-left'})` keep the identical `cameraModel` object (`model kept true` both times);
  `cameraModelForFrame` returns `ok`; `toMachineCoords({200,200})` is `{200,200}` at bed 400 and
  `{200,210}` at bed 410 (front-left).
- **Refuter:** CONFIRMED.
  - **Reproduced.** My repro (`zz-12r-p22`, real store) used front-left 400 × 400 with a saved
    model, then `updateDeviceProfile({bedHeight: 410})`.
    - The same model object is kept, and `cameraModelForFrame` returns `ok`.
    - `nativeBedCaptureFrameKey` changes from `["front-left",400,400,null]` to `…,410,null]`.
    - The material the camera sees at machine (200, 200) is still drawn at scene (200, 200),
      which now burns at machine (200, 210).
  - **Check camera does not catch it.** `modelDriftOnMarks`, on rings labelled from the saved
    layout and photographed in place, gives 0 mm drift. The check would suggest **Keep saved
    calibration**.
  - **The assumption is in the code.** `engraved-target-memory.ts:67-69` leaves the bed size out
    because "a changed bed does not move rings already engraved". That holds physically, but not in
    scene coordinates on a front-* origin.
  - **No ADR covers it.** None decides that a calibration survives a frame change.
  - **Severity stays P2.** It needs a Machine Setup correction after calibrating, and Frame still
    shows the true outline.
- **Fix direction:** Save `nativeBedCaptureFrameKey`-equivalent facts (origin, bed size, native
  offset at engrave time) in the record, and have `cameraModelForFrame` report a changed frame the
  way it reports another camera; keep Save/Check as the remedy.

### P2-3 — Head-camera Capture bed/selection jogs onto the homing-side bed edge without the ADR-375 clamp that Move laser here uses
- **Where:** `src/ui/camera/head/head-capture-store.ts:182-188` (`jogHeadTo`:
  `bedPointToNative(positionLaserTarget(head, device), frame)` straight to `jogToMachinePosition`);
  stops clamped only to `[0, bedLength]` at `src/core/camera/model/head-camera.ts:246`. Twin:
  `src/ui/workspace/position-laser-click.ts:67-72` clamps the same target to
  `resolveManualMotionLimits(frame, laser)`.
- **Anchor:** Contract — ADR-449 §4: each capture move is "the same beam-off jog as Move laser here";
  ADR-375 (`ADR-375-controller-audit-2-open-findings.md:124-129`): with hard limits on, Move laser
  here stops `$27` short of the homing switch because reaching it resets GRBL into `ALARM:1` with the
  position lost (gnea/grbl `limits.c` L366-384 cited there).
- **Scenario:** A homed stock-GRBL laser (`$23=3`, hard limits on, `$27=2`), head camera mounted
  beside the module (sees 15–65 mm right of and 20–55 mm behind the beam). **Capture bed** plans
  150 stops; 24 of them target native X = −400, the switch point on the homing side (and the front
  row targets Y = −400). The first such move drives onto the switch: hard-limit alarm, controller
  reset, position lost, capture fails with "The machine stopped moving the head (Alarm)". On firmware
  whose envelope is already pulled in (grblHAL with hard limits, or soft limits rejecting the edge)
  the jog is refused instead; the head never arrives, and after at least 15 s the panel says "The
  head did not come to rest in time." (that path was read, not run).
- **Evidence:** REPRO (`src/core/camera/model/zz-12-head.test.ts`, deleted): `planHeadCaptures(view
  {x:15,y:-55,w:50,h:35}, whole 400 × 400 bed)` → columns `[0, 23.89, … 335]`, rows `[55 … 393.93, 400]`;
  native frame `[-400,0]²`; `jogTravelLimits` (grbl, `$27=2`, hard limits) → x/y `[-397.99, -0.01]`;
  **24 of 150 stops** outside that box, e.g. scene (0, 55) → native (−400, −55). READ for the jog path
  (no clamp between `jogHeadTo` and `runJogToMachinePosition`, `laser-jog-actions.ts:82-134`).
- **Refuter:** CONFIRMED, with one sub-claim softened.
  - **Reproduced on the real path.** My repro (`zz-12r-p23`) drove the real
    `captureWithHeadCamera` → `jogHeadTo`, with `runHeadCapture` stubbed to call only `moveTo`.
    Setup: stock GRBL `$23=0`, `$20=1`, `$21=1`, `$27=2`, front-left 400 × 300, camera 40 mm left
    of and 37 mm in front of the beam.
    - 13 of 48 stops fall outside the ADR-375 box `[−399.99, −2.01] × [−299.99, −2.01]`.
    - 6 of them aim exactly at native 0, the switch point of a `$23=0` axis, e.g. (−318.89, 0).
    - Move laser here sends (−2.01, −2.01) for the same corner.
  - **Ground truth (fetched, gnea/grbl `bfb67f0`).**
    - `limits.c` sets the homed position to `−homing_pulloff` (or `max_travel + homing_pulloff`),
      so the homing-side edge is where the locate cycle found the switch.
    - `system.c` `system_check_travel_limits` is strict (`target > 0 || target < max_travel`), so
      `$20=1` accepts a jog to exactly that edge.
    - The limit ISR runs `mc_reset()` and `EXEC_ALARM_HARD_LIMIT` on any pin change.
    - The v1.1 wiki says `$27` "helps to prevent accidental triggering of the hard limit".
  - **Softened.** The jog returns the head to the switch's trip point, so it *can* trip it.
    Whether the switch closes depends on its repeatability, so "the first such move drives onto
    the switch" should read "can", not "will".
  - **No exemption.** ADR-375 §3 names the moves it leaves unclamped (step jogs, typed moves,
    Frame corners). ADR-449 §4 makes each capture move "the same beam-off jog as Move laser here".
  - **Severity stays P2.** Only head-camera owners with hard limits on can hit it. The grblHAL
    refusal path was not run.
- **Fix direction:** Route head-capture targets through the same `resolveManualMotionLimits` clamp
  (and settle on the clamped target), and let `planHeadCaptures` report the lost edge strip as it
  already does for travel limits.

### P2-4 — The burn check grades jobs whose bed position KerfDesk calls unknown, at the artwork, and reports missed path or stray marks
- **Where:** `src/ui/camera/job-watch/job-burn-route.ts:22-24` (`planPlacesOnBed` looks only at
  status capability); `src/ui/camera/job-watch/burn-check-run.ts:44-58` (`burnCheckBlocker`);
  `src/ui/state/canvas-coordinate-frame.ts:59` (a no-homing machine, Verified Origin, or an unhomed
  machine gets a `relative` frame with no `bed`); `artworkToBedShift` is then zero. The current test
  pins it: `job-burn-route.test.ts:46` "keeps an artwork-relative job without a bed position where
  it is drawn".
- **Anchor:** Contract — ADR-490 §4: only "a plan that can be placed on the bed" is checked,
  "otherwise the panel says why not"; ADR-642 §3 keeps unknown bed positions "relative" with the
  "bed position unverified" label (`UNKNOWN_NATIVE_BED_MESSAGE`, `native-bed-frame.ts:60-61`:
  "physical bed position … must be checked at the machine"). Twin — the canvas says the bed
  position is unknown while the burn check uses it.
- **Scenario:** A no-homing diode laser (default Start-from User Origin) with a fixed, calibrated
  camera and **Check the burn** ticked. The operator sets the origin at the material corner and runs
  a 30 × 20 mm job whose artwork sits at (200, 150) on the canvas. The check photographs and grades
  the bed at x 190–240, y 140–180 (the artwork), not at the origin where the laser burned: "The camera
  sees a change along 0% of the path; where it saw none is red", plus the real burn as amber "marks
  outside the path" when it falls in the picture. Nothing says the bed position was unknown.
- **Evidence:** REPRO (`src/ui/camera/job-watch/zz-12-burn-frame.test.ts`, deleted): device homing
  off, frame `{kind:'relative', jobOriginOffset:{x:-200,y:-230}}` (no `bed`), fixed camera model →
  `planPlacesOnBed true`, `burnCheckBlocker null`, `burnRegion {x:190,y:140,width:50,height:40}`.
- **Refuter:** CONFIRMED.
  - **Reproduced.** My repro (`zz-12r-p24`) ran the real `canvasCoordinateFrame` for a no-homing
    front-left device with a WCO present and User Origin, the no-homing default
    (`defaultJobPlacementForDevice`).
    - The frame is `{kind:'relative', jobOriginOffset:{x:−300,y:−325}}`, with no `bed`.
    - `planPlacesOnBed` is true and `burnCheckBlocker` is null.
    - `burnRegion` is the artwork plus its margin, `{x:290, y:40, width:60, height:45}`.
    - Verified Origin gives the same frame.
  - **Nothing upstream stops it.** `startBurnCheck` (`job-watch-runner.ts:146`) consults only
    `burnCheckBlocker`.
  - **Contract.** ADR-642 §3 shifts the route so the watch still photographs where the job really
    burns, which needs `bed`. ADR-490 §4 asks the panel to say why not otherwise.
  - **The pinning test is narrower than it looks.** `job-burn-route.test.ts:46` asserts only the
    zero shift, not that such a job should be graded.
  - **Severity stays P2.** The check is opt-in, but no-homing diode lasers are common. The result
    is misleading; nothing physical goes wrong.
- **Fix direction:** Treat a `relative` frame without `bed` as "cannot be placed on the bed" in
  `planPlacesOnBed`/`burnCheckBlocker` (Absolute on a no-homing machine after **Confirm bed
  coordinates** could be the one exception), and update the pinning test.

### P3-1 — The forward projection has no fold guard: bed points past the lens's turning point are drawn from pixels that see somewhere else
- **Where:** `src/ui/camera/overlay/bed-overlay-shader.ts:163-167` (and its CPU mirror at `:280-286`);
  `src/core/camera/model/camera-model.ts:58-63` (`projectCameraPoint`); used by
  `src/core/camera/model/bed-image.ts:149` (trace, pieces, marks, burn check, head stitch). The fit
  only rejects a fold *inside* the picture: `fit-determined-lens.ts:61-71`.
- **Anchor:** Twin — `undistortPixel` (`fisheye.ts`) returns null past `fisheyeAngleLimit`, and
  `lensFoldsInPicture`'s own comment says bed points beyond the turn "are drawn back onto pixels
  inside the picture". Ground truth — OpenCV's `fisheye::projectPoints` has no guard either
  (fetched `fisheye.cpp`; only `r > 1e-8` and `|Z| < DBL_MIN` checks), so this is a KerfDesk twin
  gap rather than a departure from OpenCV.
- **Scenario:** A camera that sees part of the bed at steep angles — typically a head camera
  (ADR-449) whose live overlay is drawn over the whole bed — with a fitted lens whose polynomial turns
  back past the picture corner but before 90°. Bed far from the camera is painted with ghost copies
  of the patch it sees, and a trace or Find pieces over that area traces them.
- **Evidence:** REPRO (`src/core/camera/model/zz-12-math.test.ts`, deleted), synthetic lens
  640 × 480, fx 600, k = [0, −0.2, 0, 0] (`lensFoldsInPicture` false, fold radius 0.80 > corner 0.67),
  camera 60 mm above (200, 200): 1000 of the 5 mm bed-grid points outside the true view project
  inside the picture, e.g. bed (0, 0) → pixel (139, 59), which actually sees bed (180.6, 180.6); the
  shader mirror samples a foreign pixel at 935 fragments; `warpFrameToBedImage` makes 23 264 px
  opaque more than 100 mm from the axis. Whether real fits fold before 90° was not measured.
- **Refuter:** CONFIRMED (P3).
  - **Reproduced with another lens.** My repro (`zz-12r-p31`) used 1280 × 720, fx 1000,
    k = [−0.1, −0.12, 0, 0], with `lensFoldsInPicture` false and the camera 80 mm above (150, 120).
  - **Result.** 233 points of the 5 mm grid project into the picture onto a pixel that sees
    somewhere else. For example, bed (330, 20) → pixel (1276, 6), which `pixelToBed` places at
    (227.4, 77.0).
  - **No guard.** `projectCameraPoint`, the shader and its mirror check only depth.
  - **Stays P3.** How often real fits fold before 90° is still unmeasured.
- **Fix direction:** In the shader, its mirror and `projectCameraPoint`, write transparent / return
  null when `atan(r)` exceeds `fisheyeAngleLimit` (pass it as a uniform); add a mirror test past the fold.

### P3-2 — No black or blank frame check: a black after picture reads as "0% of the path" burned
- **Where:** `src/core/camera/job-watch/change-mask.ts` (`brightnessShift` removes the median
  change, so an all-black after picture leaves no "change"); `src/ui/camera/job-watch/BurnCheckResult.tsx`
  (`burnCheckSentences`); capture paths `src/ui/camera/frame-capture.ts:67` and `frame-source.ts`
  never inspect content; `src/ui/state/camera-store.ts:40` and WORKFLOW F-CAM1 "temporary USB mute"
  keep every camera action available while muted.
- **Anchor:** Ground truth — W3C Media Capture and Streams §media-flow: a muted track gives
  zero-information content, "black frames for video"
  (https://www.w3.org/TR/mediacapture-streams/#media-flow). Contract — ADR-490 asks the check to
  say why it could not judge rather than guess.
- **Scenario:** The after picture is black (enclosure light switched off at job end, lens covered,
  or a USB camera muted at that moment). The check says "The camera sees a change along 0% of the path;
  where it saw none is red. No marks outside the path." Find pieces on a black frame says pieces must
  stand out by colour or brightness; Print and Cut says no mark pair was found — each a wrong reason.
- **Evidence:** REPRO (`src/core/camera/job-watch/zz-12-black.test.ts`, deleted): textured
  before picture, all-black after → `{coverage: 0, hiddenShare: 0, strayMarks: 0}`; uniform bed the
  same. Chrome's actual capture of a muted track (black frame vs. the 5 s timeout) not verified.
- **Refuter:** CONFIRMED (P3).
  - **Reproduced.** My repro (`zz-12r-p32`) ran `checkBurn` on a square path with a plywood-like
    before picture (luma 170 ± 12).
    - All-black and near-black (luma 3–4) after pictures both give
      `{coverage: 0, hiddenShare: 0, strayMarks: 0}`. The panel then reads "a change along 0% of
      the path … No marks outside the path".
    - A real burn on the same before picture gives coverage 1.
  - **No check anywhere.** A grep of `src/ui/camera` and `src/core/camera` finds no luma or
    blank-frame check.
  - **Not checked.** What Chrome returns for a muted track.
- **Fix direction:** Flag a frame whose luma spread or mean is near zero (and record `usbAvailability`
  at capture) and say "the camera picture was black" instead of grading it; no new gate needed.

### P3-3 — A machine JPEG camera that stops answering blanks the overlay with no notice, and the source stays "live"
- **Where:** `src/ui/camera/CameraSourceView.tsx:26-33` (`PolledJpeg` gets no `onFailure`, unlike
  the RTSP `MjpegImage`); its stale/error text is rendered inside the 2 × 2 px, opacity-0 holder
  in `WorkspaceCameraOverlay.tsx:95,163`; `use-bed-overlay-drawing.ts:164-167` clears the canvas and
  returns no issue when the frame size is 0.
- **Anchor:** Ground truth — WHATWG HTML "update the image data": a failed pending load makes the
  current request broken, and `naturalWidth` returns 0 when the image is not available
  (https://html.spec.whatwg.org/multipage/images.html#update-the-image-data). Twin — RTSP and USB
  sources leave `live` with a message on failure (`camera-source-lifecycle.ts`); ADR-440 §9 keeps the
  source running with the panel closed precisely for the overlay.
- **Scenario:** Falcon camera via the bridge, panel closed, overlay on. The camera or bridge
  stops; the next poll fails, the overlay disappears, the canvas shows no notice, the source still
  reads as live, and Trace from camera stays enabled until it fails with "Could not capture a camera frame."
- **Evidence:** READ + SOURCE.
- **Refuter:** CONFIRMED (P3) from the code and the spec; not run in a browser.
  - **The source never leaves `live`.** `reportSourceFailure` is called only for USB (track end),
    RTSP (status monitor) and the panel's RTSP preview (`RtspSourceControls.tsx:90`), never for a
    `machine-jpeg` source.
    - So `MACHINE_JPEG_SOURCE_ENDED` (`camera-source-lifecycle.ts:20`) can never be shown.
    - Neither `camera-snapshot-source.ts` nor `activateMachineCamera` watches the source once it
      is live.
  - **The notice is invisible.** The overlay mounts `CameraSourceView` without `onFailure`, inside
    the 2 × 2 px, opacity-0 holder, so its "stale" and "failed" text is never seen.
  - **The spec.** In the WHATWG update-the-image-data steps, a failed load upgrades the pending
    request to a broken current request. `frameSize` then returns null, and the overlay clears with
    no issue text.
- **Fix direction:** Report consecutive poll failures through `reportSourceFailure` as RTSP does,
  and let the overlay show a notice when its live element has no picture.

### P3-4 — A frozen overlay still survives recalibration, project open and bed/origin edits, and is redrawn through the new model
- **Where:** `src/ui/state/camera-store.ts:159-163` (still cleared only by **Live** or a bed picture);
  `use-calibration-photo.ts:135-150` (Save keeps the still); the camera store is not reset by
  `setProject`/`newProject`.
- **Anchor:** Twin — in-flight captures are retired when the model, device or document changes
  (`use-camera-trace-lifetime.ts`); the still, also a capture, is not. Contract — ADR-441 Amd 1:
  recalibrating after a camera move is how the overlay is corrected.
- **Scenario:** The operator freezes a still, the camera gets knocked, they recalibrate and press
  Save: the old still (taken from the old camera position) is drawn through the new pose, offset by
  the movement, and the canvas gives no sign that it is a still or how old it is.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (P3).
  - **Reproduced.** My repro (`zz-12r-p34`, real stores) set a still with `setOverlayStill`. It
    survives all of these:
    - a recalibration save (`updateDeviceProfile(withSavedCameraModel(…))` plus
      `setOverlayVisible(true)`, as `saveCurrent` does);
    - a bed and origin edit;
    - `setProject`;
    - `newProject`.
  - **Only two writers clear it.** **Live** (`useLive` in `use-camera-placement-controls.ts`) and
    `setBedPicture`.
  - **Drawn through the new pose.** The still's capture binding still matches the same camera, so
    `cameraModelForFrame` returns `ok`.
- **Fix direction:** Drop the still (or mark it stale) when the active model changes, and label a
  still overlay on the canvas.

### P3-5 — The camera-placement facts in every Start snapshot are read by nothing since ADR-228, yet still invalidate phone reviews
- **Where:** `src/ui/laser/start-job-readiness.ts:157-161`, `src/ui/laser/start-machine-snapshot.ts:48-50`,
  `src/ui/camera/calibrate/transient-camera-job.ts:146-147` (fields set); no reader in `src`.
  `src/ui/state/camera-store.ts:72-79` still calls the latch a "safety contract".
  `startMachineInputsKey` (`start-job-source.ts:216-221`) includes them, and
  `remote-access/job-review-preparation-owner.ts:16-24` cancels a phone review preparation when the key changes.
- **Anchor:** Contract — DECISIONS ADR-228 (line 10643): camera-placement Start gates removed,
  the panel keeps its own confirmation UI.
- **Scenario:** Pressing **Overlay on**, **Update still**, **Trace from camera**, **Confirm bed
  coordinates** or **Exit camera placement** while a phone is preparing a Job Review cancels that
  preparation, though no compile reads the changed value; a reader of the store comment expects a
  gate that no longer exists.
- **Evidence:** READ (grep for the three field names finds only their writers and type).
- **Refuter:** CONFIRMED (P3).
  - **No reader.** A grep of `src` and `electron` finds the three fields only in their type
    (`start-job-readiness.ts:159-161`) and their writers (`start-machine-snapshot.ts:48-50`,
    `transient-camera-job.ts:146-147`).
  - **Their only use cancels phone reviews.** The `JSON.stringify` in `startMachineInputsKey`
    consumes them. `ownRemoteReviewPreparation` re-checks that key on every camera-store write and
    cancels on a change.
  - **Contract.** ADR-228 (DECISIONS) removed the camera-placement Start gates.
  - **Stays P3.** The cost is one re-preparation.
- **Fix direction:** Remove the three fields from `machineSnapshot` and the readiness type, or
  document them as display-only; fix the store comment.

## KNOWN (not raised again)
- **03-P2-8** — the motion manifest reads every Smoothieware burn as travel, so the camera burn check
  finds no path on Smoothieware (`motion-manifest-parser.ts:156`). Re-encountered through
  `job-burn-route.ts`; nothing new.
- **04-P2-1** (and 04-P3-9 … P3-12, by the brief) — camera bridge port squatting and RTSP/bridge
  security; not re-examined.

## Refuted
- **P2-1 as a P2 broken contract.** Refuted. ADR-500 Amendment 1 §2 has Open use the document's
  machine and settings, and ADR-446 §1 has projects carry the calibrations.
  - Also refuted: the sub-claim that the newer calibration is lost. The app's saved machine keeps
    it until a machine edit is made in the opened document.
  - Kept as P3: there is no disclosure, and LightBurn keeps cameras per device. That is a
    maintainer design call. Raise it again only if that decision changes.
- **P2-3's sub-claim that the first edge stop certainly alarms.** Softened to "can trip". The jog
  returns the head to the switch's trip point, and whether the switch closes depends on its
  repeatability. The finding stands.

Candidates the auditor dropped before raising:
- Undetermined lens terms kept at low ring noise (missing `MIN_POINT_NOISE_PX` floor in `lensSigma`):
  synthetic sweep showed low noise *helps* (worst extrapolated corner 0.05–0.7 mm at 0–0.05 px).
- Camera overlay valid only in Absolute Coords with no surface saying so: ADR-642 §3's canvas badge
  "Drawn over artwork — burns at your origin" covers it (LightBurn's troubleshooting page gives the
  same Absolute Coords advice).
- Trace bounds vs rounded pixel counts at fractional px/mm: ≤ 0.07 mm at the far edge.

## Verified clean
- **Lens model** = OpenCV fisheye: θd = θ(1 + k1θ² + k2θ⁴ + k3θ⁶ + k4θ⁸), x′ = (θd/r)·a, u = fx·x′ + cx
  (OpenCV's optional skew α is not modelled and not fitted). `undistortPixel` is stricter than
  OpenCV's (bracketed Newton inside the first rising stretch, null past the turn or after 64 steps;
  OpenCV clamps θd to ±π/2 and rejects only sign flips).
- **Seed homography** (`plane-pose.ts`): isotropic Hartley normalisation (centroid, mean distance
  √2) as in H&Z; OpenCV's `findHomography` instead scales each axis to unit mean absolute deviation and
  takes the eigenvector of the 9 × 9 LᵀL. Fixing h33 = 1 in normalised coordinates is safe (the point
  centroid maps near the ray centroid); it only seeds LM. Pose decomposition and sign check are correct
  for a plane at z = −h.
- **Degenerate sets** are unreachable: the matcher needs ≥ 8 rings and ≥ 25 % of a grid of at least
  4 × 5, so collinear or duplicate correspondences cannot reach the fit. A mirrored picture is refused
  by the anchor L's cross-product sign.
- **Determined-lens fit under noise:** 300 mm target on a 400 mm bed, wide lens, noise 0–0.3 px,
  three seeds: k3/k4 always dropped, worst extrapolated corner error 0.05–3.3 mm, no blow-ups.
- **Rodrigues near π** (180°-mounted cameras): axis-sign ambiguity costs ≤ 1e-4 rad and only on the seed path.
- **Pixel conventions agree** across `scaleLens` (about the outer edge), the shader `(p + 0.5)/size`,
  `writeBilinear`, `bed-image` (index + 0.5), Find pieces (pixel-corner units with +0.5 centroids),
  find-marks (+0.5) and head stitching. CPU and GPU height-area precedence agree (lowest-first,
  last wins = highest-first, first wins; inclusive edges). Overlay and canvas view transforms differ
  by ≤ 0.5 CSS px of rounding.
- **Capture ownership:** trace, Find pieces, Print and Cut and the calibration photo retire results
  on document, device, camera, height or bed changes; head capture takes the second of two frames
  after settling; USB track end and RTSP liveness move the source out of `live`.
- **Saved records:** strict normalisation (finite, positive focal, 4 distortion terms, ≤ 4000 marks,
  malformed optional fields drop the record); network bindings carry a keyed query fingerprint, so a
  project from another install refuses with "belongs to a different camera".
- **Units:** inch status reports are converted once in `headPositionOnBed`; everything else is mm.

## Not verified
- No real camera, lens, enclosure light or machine was used; the GPU shader was not run (existing
  headless-Chromium mirror tests were relied on).
- Whether real fitted lenses fold before 90° (reach of P3-1).
- Chrome's behaviour when capturing a muted USB track (black frame per spec, or the 5 s timeout).
- The grblHAL / soft-limit refusal path of P2-3 end to end (settle timeout message read, not run).
- Same-aspect resolution modes that crop the sensor: ADR-440 §5 accepts a scaled lens within 1 %
  aspect; LightBurn's docs record the calibration resolution but do not say to recalibrate, and no
  primary source on UVC mode field of view was fetched.
- RTSP stills: whether some cameras answer a new session with a cached keyframe older than the
  3 s burn-check settle.

```json
[
  {"id":"P2-1","severity":"P3","area":"camera","file":"src/ui/state/project-actions.ts","line":64,"anchor":"Ground truth LightBurn cameras are per device (.lbcm), Twin capture-lifetime retirement, Contract ADR-441 Amd 1 / ADR-446 §1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Opening an older project silently restores its older camera calibration (no notice when profile id/name/bed match); by design per ADR-500 Amd 1 §2, downgraded P2 to P3 as a disclosure gap; newer calibration survives in app storage until the next machine edit"},
  {"id":"P2-2","severity":"P2","area":"camera","file":"src/core/camera/model/camera-model-record.ts","line":23,"anchor":"Twin nativeBedCaptureFrameKey (Print and Cut) vs camera model; Contract F-CAM5, ADR-440 §5","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Calibration does not record origin/bed size/native frame of its engraved target; later edits keep it and silently shift overlay, trace and camera Print and Cut marks against the burn"},
  {"id":"P2-3","severity":"P2","area":"camera","file":"src/ui/camera/head/head-capture-store.ts","line":182,"anchor":"Contract ADR-449 §4 (same jog as Move laser here) + ADR-375 pull-off clamp; Twin position-laser-click.ts:67","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Head-camera Capture bed/selection jogs to the homing-side bed edge without the ADR-375 clamp: hard-limit ALARM on stock GRBL, or a refused jog and a 15 s timeout message"},
  {"id":"P2-4","severity":"P2","area":"camera","file":"src/ui/camera/job-watch/job-burn-route.ts","line":22,"anchor":"Contract ADR-490 §4 / ADR-642 §3; Twin UNKNOWN_NATIVE_BED_MESSAGE","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Burn check grades jobs with an unknown bed position (no-homing User Origin etc.) at the artwork and reports missed path/stray marks"},
  {"id":"P3-1","severity":"P3","area":"camera","file":"src/ui/camera/overlay/bed-overlay-shader.ts","line":163,"anchor":"Twin undistortPixel fold limit vs forward projection; OpenCV fisheye.cpp projectPoints (no guard)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Forward projection has no fold guard; bed points past the lens turn are painted/traced from pixels that see elsewhere"},
  {"id":"P3-2","severity":"P3","area":"camera","file":"src/core/camera/job-watch/change-mask.ts","line":1,"anchor":"Ground truth W3C mediacapture muted -> black frames; Contract ADR-490 say why not","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No black/blank frame check: a black after picture reads as 0% of the path burned; other consumers give wrong reasons"},
  {"id":"P3-3","severity":"P3","area":"camera","file":"src/ui/camera/CameraSourceView.tsx","line":26,"anchor":"Ground truth WHATWG img broken -> naturalWidth 0; Twin RTSP/USB failure reporting; ADR-440 §9","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Machine JPEG camera failure blanks the overlay silently and the source stays live"},
  {"id":"P3-4","severity":"P3","area":"camera","file":"src/ui/state/camera-store.ts","line":159,"anchor":"Twin capture-lifetime retirement; Contract ADR-441 Amd 1","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"A frozen overlay still survives recalibration, project open and frame edits and is redrawn through the new model unlabeled"},
  {"id":"P3-5","severity":"P3","area":"camera","file":"src/ui/laser/start-job-readiness.ts","line":157,"anchor":"Contract ADR-228 (camera-placement gates removed)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Camera-placement fields in every Start snapshot are read by nothing yet cancel phone review preparation; store comment still calls it a safety contract"}
]
```
