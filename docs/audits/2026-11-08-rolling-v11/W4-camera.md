# Rolling audit v11 — Camera (W4 `camera`)

- **When:** 2026-11-08   **Tree:** main @ `5f09e1110` (repro tree: scratchpad `j10-main`, an export of that SHA)
- **Scope:**
  - Code: `src/core/camera/**`, `src/ui/camera/**`, `src/ui/state/camera-*.ts`, `src/platform/web/web-camera*.ts`, and `electron/rtsp-*.ts`, `electron/camera-*.ts`, `electron/private-network-host-policy.ts`.
  - Read alongside: `src/ui/laser/start-job-readiness-policy.ts` (camera Start-from advice), `src/core/job/rotary-*.ts`, `src/ui/job-placement.ts` (Absolute program offset), `src/ui/remote-control/machine-camera.ts` (phone/MCP still), `electron/trusted-renderer-policy.ts` (media permission), and `src/ui/laser/board-capture/**` (Place Board).
  - Governing ADRs: ADR-440 and Amds 1–8, ADR-441 Amd 2 (heights), ADR-446, ADR-449 Amds 1–2, ADR-490 Amd 1, ADR-663 Amds 1–4, ADR-228 Amd 1, ADR-654 Amds 3–4, ADR-141 Amds 1–2, ADR-127 Amd 1 (rotary anchor), ADR-585 (remote camera still); WORKFLOW F-CAM1.
  - L8: the camera-path merges since 2026-10-27 that J5 did not verify: #1478 (camera helper cancellation, after-job refresh owner), #1489 (board Fit/Array split), #1546 (RTSP login probe), #1572 (job-burn-route `findMotionBlock`), #1567 and #1499 (test-only lines). #1463, #1467, #1473, #1437 and #1441 were verified by J5 and only re-checked for regressions.
- **Lenses run:**
  - **L2 (ground truth).** The following were fetched on 2026-11-08:
    - W3C Media Capture and Streams §4.3.1.1;
    - W3C MediaStream Image Capture (focusMode);
    - LightBurn's rotary G-code and camera pages;
    - a public IP-camera address table (named in the security file);
    - RFC 3927.
  - **L3 (twins).** Overlay against compiled G-code, the camera advice against the rotary placement, and the USB mute against the RTSP stall.
  - **L6 (failure paths).** Frozen feed, disappearing camera, timelapse memory and disk-full, calibration corruption.
  - **L8.** As in Scope.
  - **L5.** Credentials, the probe, URL policy and camera consent. Security details are kept outside the repo.
  - **L9.** Entry-point parity: overlay, trace, Find pieces, Print and Cut marks, head capture, Place Board, camera target engrave, phone/MCP still.
  - L1 was folded into the others. L4 and L7 were not run as passes.
- **Repros:** Node 25 with the real TypeScript modules, loaded through an esbuild transform hook (`zz-w4/ts-resolve.mjs`, `zz-w4/register.mjs`). Command, run from scratchpad `zz-w4/`: `node --import ./register.mjs <script>.mts`.
  - `r1-cred.mts` → `r1-cred.out.txt`;
  - `r2-twin.mts` → `r2-twin.out.json`.

  Vitest and the browser were not run: available memory stayed at 1.37–1.42 GB, under the 1.5 GB gate (see Not verified).
- **Counts:** 4 raised → 0 refuted (auditor; refuter PENDING) → P1 0 / P2 2 / P3 2 (+ 18 KNOWN). The KNOWN are:
  - 9 earlier findings still open;
  - the 7 #1546 architecture items;
  - W1-P3-4 and V7-P3-1 from the brief.

## Headline

The overlay maps camera pixels to bed millimetres exactly as the burn does. For three origins × three placements on a homed negative-space GRBL frame, the shader's CPU mirror sampled the same camera pixel as the forward projection, and the compiled Absolute G-code put each placed square's centre back at the same scene point (0.000 mm, R2).

The defects sit around that core:

- **W4-P2-1.** On an active rotary, Job Review's camera advice "Choose Absolute Coordinates to burn it where it is placed" is wrong. Following it turns the cylinder back to work Y 0 before burning: Y 60.9–99.1 becomes Y 0–38.2 in the repro. LightBurn and ADR-127 Amd 1 both say Current Position is the rotary mode. ADR-654 exempted Place Board and the jig from this advice; rotary was missed. J5 noted it under Not verified and did not raise it.
- **W4-P2-2 (security, redacted).**
- **Smaller.** A USB camera that stops sending pictures leaves its last picture on the canvas, with the "not sending pictures" note shown only inside the panel. The #1478 auto-start cancellation also does not reach RTSP and phone cameras.

Of the earlier camera findings, every P1/P2 is fixed on main. Nine P3s are still open, and all seven #1546 architecture items are unchanged.

## Findings

### W4-P2-1 — On an active rotary, the camera Start-from advice tells the operator to choose Absolute, which turns the cylinder back to work Y 0 before burning
- **Where:**
  - `src/ui/laser/start-job-readiness-policy.ts:125-135`: `cameraPlacementStartFromWarning` has exceptions for Place Board (`:132`) and the jig (`:133`), and nothing for a rotary. `:134` gives the generic advice. `:131` says nothing once Start from is Absolute.
  - The rotary side:
    - `src/core/job/rotary-job.ts:43-45`: an Absolute job gets no rotary anchor.
    - `src/core/job/rotary-transform.ts:7-9,46-53`: "An Absolute job has no anchor and is REBASED so its lowest Y sits at 0".
  - The latch that makes the advice appear: `src/ui/camera/camera-placement-latch.ts:1-7`. It latches whenever a camera picture is drawn, including the camera that starts by itself (ADR-663 Amd 4).
- **Anchor:**
  - **Contract.** ADR-127 Amendment 1, Context, says the rebase "turned the cylinder back about 80 mm to work Y 0..38.2". Its Decision keeps the anchor for placed jobs, because Current Position "already names the cylinder's turn".
  - **Ground truth.** LightBurn, *Rotary Mode — GCode* (https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/, live page, fetched 2026-11-08, no archive link): "In most cases, Current Position is the best Start From mode to use when working with a rotary."
  - **Twin.** ADR-654 Amendment 3 (Place Board) and Amendment 4 (jig) already carve exceptions out of the same advice, because following it burns away from where the job is anchored. The jig exception is "never advises Absolute Coordinates" (ADR-654 Amd 4, Decision). Rotary is the third such anchor and has no exception.
- **Scenario:**
  1. A chuck rotary (360 mm per turn, Ø60) has the tumbler turned so the face to engrave is up, at work Y 80.
  2. The overhead camera is calibrated and starts by itself, so camera placement latches.
  3. The operator sets X along the tumbler on the camera picture and starts from Current Position, as LightBurn advises.
  4. Job Review says: "Camera placement is on, but Start from is Current Position. … Choose Absolute Coordinates to burn it where it is placed, and watch the Frame."
  5. The operator switches to Absolute. The warning goes away. The program now burns Y 0–38.2 instead of Y 60.9–99.1, so the chuck turns about 80 mm of Y travel before the first mark.
  6. The design lands about 42 mm of surface around the tumbler from the face the operator set up, for example on the handle side.

  Nothing at Absolute mentions the rotary. Job Review's machine section only lists that a rotary is on.
- **Evidence:** REPRO with the real `cameraPlacementStartFromWarning` and `emitGcode`. Script `zz-w4/r2-twin.mts`, output `zz-w4/r2-twin.out.json`, key `rotary`.
  - Advice at Current Position: the text quoted above.
  - Current Position (work Y 80): burn Y `60.901..99.099`.
  - Absolute, after following the advice: burn Y `0..38.197`.
  - Advice at Absolute: `null`.
- **Severity:** P2. Following the advice gives a wrong position, in the same way as J5-P2-1 and H6-P3-2. It is not P1, because the operator changes the mode on wording that sounds accurate, and no burn moves without that change (M6-P2-2 precedent).
- **Novelty:** New as a raised finding. H6 and J5 both listed it under Not verified. J5 did not raise it "because the camera picture gives no placement along the circumference". The repro shows the harm does not depend on that: the advice turns the cylinder away from the turn the operator set up.
- **Refuter:** PENDING.
- **Fix direction:** When `rotaryAppliesTo` holds, replace the camera advice with rotary wording. The camera picture places only X along the cylinder, so keep Current Position (or User Origin). Never advise Absolute on a rotary, as ADR-654 Amd 4 does for the jig.

### W4-P2-2 — SECURITY: credential leak into persisted / shared files
- **Class:** credential leak (camera login persisted where it can be shared).
- **Severity:** P2.
- **Details:** redacted until fixed (AREAS.md, Security). The coordinator has the details: scratchpad `zz-w4/SECURITY-DETAILS.md`.
- **Refuter:** PENDING.

### W4-P3-1 — A USB camera that stops sending pictures leaves its last picture drawn on the canvas, and the note saying so is only in the Camera panel
- **Where:**
  - Detection:
    - `src/platform/web/web-camera-stream.ts:48-52`: the stream reports `muted` when no live track is unmuted.
    - `src/ui/state/camera-source-lifecycle.ts:46-47`: `muted` sets `usbAvailability: muted` and the source stays `live`.
    - `src/ui/state/camera-store.ts:41-42`: mute is "informational and never disables camera actions".
  - The only place the note shows: `src/ui/camera/panel/CameraPreviewCard.tsx:22,42-46`, "The camera is not sending pictures for the moment".
  - The canvas:
    - `src/ui/camera/WorkspaceCameraOverlay.tsx:48-66`: the overlay never reads `usbAvailability`, and its notice is only the model issue or WebGL2.
    - `src/ui/camera/overlay/use-bed-overlay-drawing.ts:144-155`: the canvas redraws only on a presented video frame, so it keeps the last one.
- **Anchor:**
  - **Twin.** An RTSP feed that stops producing data is failed after 10 s (`electron/rtsp-camera-stream.ts:14,111-119`). Its source then leaves `live` (`camera-source-lifecycle.ts:96-121`) and the overlay goes away. A USB feed that stops stays drawn, frozen.
  - **Twin.** The panel tells the operator, but the canvas, where placement happens, does not.
  - **Ground truth.** W3C Media Capture and Streams §4.3.1.1 (https://www.w3.org/TR/mediacapture-streams/#media-flow, TR snapshot fetched 2026-11-08): "A MediaStreamTrack is muted when its source is muted", that is, "temporarily unable to provide the track with data".
- **Scenario:**
  1. The panel is closed and the overlay is on, with a calibrated USB webcam.
  2. The webcam stops delivering frames without ending, for example a USB hub or bandwidth stall, or a driver hang.
  3. KerfDesk records `muted`. The canvas keeps showing the last picture, at full opacity, with no notice, and placement stays latched.
  4. Material moved after that moment is not shown. Artwork placed against the picture burns where the material used to be.

  Trace, Find pieces and Refresh take a fresh capture, which may fail instead. That was not run.
- **Evidence:** READ (the four lines above) + SOURCE (W3C). Not run in a browser, because of the memory gate. Whether Chromium shows a muted camera track's last frame or black frames in a `<video>` was not verified. If it shows black frames, the defect reduces to a missing notice.
- **Severity:** P3. Reaching it needs a USB stall that does not end the track. A frozen picture usually also hides material placed after the stall, which the operator is likely to notice. No ADR requires a canvas notice. F-CAM1 makes the mute note informational, and ADR-440 §9 keeps the source on the canvas.
- **Novelty:** New. The machine-JPEG sibling is KNOWN v2 12-P3-3: its "stale" note renders inside the hidden 2 × 2 px holder (`WorkspaceCameraOverlay.tsx:96-101,166-172`). Unchanged.
- **Refuter:** PENDING.
- **Fix direction:**
  - Show a canvas notice while `usbAvailability` is `muted` and the overlay is live. Fade or mark the picture, the same way RTSP and machine-JPEG failures should say so on the canvas.
  - Optionally use the time since the last presented frame from `requestVideoFrameCallback` as the staleness test.

### W4-P3-2 — #1478's auto-start cancellation does not reach RTSP and phone cameras
- **Where:** `src/ui/camera/helpers/auto-start.ts`:
  - `:58`: the comment "Switching off is a cancellation, even if switched on again before discovery ends".
  - `:62-66`: `current()` checks the switch, the abort signal, the source epoch and idle.
  - `:76`: `startAddressCamera(last, deps)` is called without `current`.
  - `:84-93`: it awaits `startRtspSource` / `startSnapshotSource` with no further check. The machine and USB paths re-check `current()` after their awaits (`:108`, `:138-142`).
- **Anchor:** Twin, between the three auto-start paths in one function. Contract, the #1478 comment at `:58`.
- **Scenario:**
  1. The remembered camera is RTSP or a phone.
  2. The operator turns **Start the camera by itself** off while the bridge probe is in flight, which can take up to 5 s (`rtsp-describe.ts:6`), or the helpers are torn down.
  3. The camera still starts and its picture is drawn.
  4. The same sequence for a USB or machine camera is cancelled.
- **Evidence:** READ.
- **Severity:** P3. A setting is not honoured for one in-flight start. Nothing physical is affected.
- **Novelty:** New (L8, #1478).
- **Refuter:** PENDING.
- **Fix direction:** Pass `current` into `startAddressCamera`. Have the store's start actions accept a "still wanted" check after their awaits, or stop the source when `current()` turns false.

## Earlier findings: status on `5f09e1110`

| ID | Was | Status | Evidence on main |
|---|---|---|---|
| v2 12-P2-1 (P3) | Opening an older project swaps in its older calibration | **Fixed** (#1437, ADR-440 Amd 3; J5 re-checked) | `project-bed-reconciliation.ts:142` `withCurrentMachineCamera` |
| v2 12-P2-2 | Calibration not tied to its bed frame | **Fixed** (#1373, ADR-440 Amd 1/4/5) | `camera-bed-frame.ts:43-88`, R2 shows the moved model agrees with the burn |
| v2 12-P2-3 | Head capture jogs to the switch without the ADR-375 clamp | **Fixed** (ADR-449 Amd 1) | `head-capture-store.ts:215-228` goes through `positionLaserNativeTarget` |
| v2 12-P2-4 | Burn check grades jobs with an unknown bed position | **Fixed** (ADR-490 Amd 1) | `job-burn-route.ts:22-44` `planBedPositionKnown` |
| v2 12-P3-1 | No fold guard in the forward projection | **Fixed** (ADR-440 Amd 2) | `camera-model.ts:63-71`; shader `uAngleLimit` (`bed-overlay-shader.ts:72-73`) |
| v2 12-P3-2 | No black or blank frame check in the burn check | **Open** | no luma or blank check in `core/camera/job-watch` or `ui/camera/job-watch` |
| v2 12-P3-3 | Machine-JPEG failure blanks the overlay silently; the source stays live | **Open** | `CameraSourceView.tsx:26-33` (no `onFailure` for `PolledJpeg`); `reportSourceFailure` callers unchanged |
| v2 12-P3-4 | A frozen still survives recalibration, Open and frame edits | **Open** | the only still writers are `camera-store.ts:171-181` and `capture-overlay-still.ts:72` |
| v2 12-P3-5 | Start-snapshot camera fields unread | **Partly fixed** | `cameraPlacementActive` is now read (`start-job-readiness-policy.ts:92-100`); `cameraConfirmedPositionEpoch` and `cameraPlacementGeometryIssue` (`start-machine-snapshot.ts:51-52`) still have no reader; the "safety contract" comment remains (`camera-store.ts:74`) |
| G6-P2-1 (P1), G6-P2-2, G6-P2-3 (P1), G6-P3-3 (P2) | Canvas target frame, machine notice, bed picture frame, nudge homing | **Fixed** (#1463; J5 verified) | unchanged since J5 except #1478's `sameHeights` region fix (`bed-picture-frame.ts:128-149`, correct) |
| G6-P3-1 | After-job refresh re-shows a hidden or exited overlay and re-latches | **Open** | #1478 cancels only on a change *during* the 3 s settle (`schedule-after-job-refresh.ts:19-35`); an Exit before the job still ends in `refreshCameraPicture(... activatePlacement: true)` (`refresh-picture.ts:33`) because `refreshAfterJobs` checks only `overlayStill` (`install-camera-helpers.ts:156-157`) |
| G6-P3-2 | Undoing a nudge keeps the post-nudge view reference | **Open** | key is still `sourceId@calibratedAt` (`view-reference.ts:15`) |
| H6-P1-1, H6-P1-2, H6-P2-1 (P1), H6-P3-2 (P2) | Latch, stitch heights, head Z, Place Board advice | **Fixed** (#1467; J5 verified) | latch `camera-placement-latch.ts`; heights `head-capture-store.ts:275-283` |
| H6-P3-1 | Frame notes only inside the Camera panel | **Open** | readers only `OverlayControls.tsx:39`, `CalibrateCameraControls.tsx:23`, `nudge-actions.ts:141` |
| H6-P3-3 | Every Falcon A1 Pro camera has the same fixed address | **Open** | `camera-frame-proxy.ts:32-37` (four fixed candidates) |
| J5-P2-1 | Jig artwork run told to choose Absolute | **Fixed** (ADR-654 Amd 4) | `start-job-readiness-policy.ts:133,137-139` |
| J5-P2-2 (P1) | Bed-size notice hides an origin change | **Fixed** (ADR-440 Amd 8) | per ADR-440 Amd 8; not re-run |
| J5-P3-1 | ADR-663 Amd 4 D3 against the after-job refresh | **Open** | as G6-P3-1 |

## PR #1546's seven open architecture items (2026-11-02 camera audit)

#1546 fixed the three confirmed bugs. Its RTSP probe was read here (L8) and holds:
- the login goes in the header, never in the request line (`rtsp-describe-auth.ts:12-27`);
- the one repeat uses the same connection (`rtsp-describe.ts:45-60`);
- Digest MD5 with qop=auth or none, otherwise Basic (`:88-120`);
- an unanswerable challenge still counts as a camera found (`rtsp-probe.ts:184-188`).

All seven items are unchanged on main and KNOWN. None was raised again.

| # | Item | Status | Where |
|---|---|---|---|
| 1 | Legacy `CameraProfile` / `camera-transform.ts` is dead code but is still validated and required for the `camera` capability | **Open** | `profile-catalog.ts:290,359-372`; `src/core/camera/camera-transform.ts` still present |
| 2 | Only a one-photo joint lens and pose fit; the `fixedLens` path is unreachable | **Open** | `bed-calibration.ts:27-28,187` accepts `lens`; its only caller `calibration-actions.ts:205-214` never passes one |
| 3 | Accuracy is reported in-sample | **Open** | `bed-calibration.ts:123-146`: rms/max come from the same rings the fit used |
| 4 | The model is stored in origin-dependent scene coordinates | **Open (by design)** | ADR-440 Amd 1: an origin change refuses the model (`camera-bed-frame.ts:53-58`) |
| 5 | Same-aspect frames are assumed to be a plain rescale | **Open** | ADR-440 §5; `camera-model-frame.ts:39-58`, `lensForFrame` 1 % aspect; a sensor-cropping UVC mode is not detected |
| 6 | `MIN_POINTS_PER_VIEW` ignores the free-parameter count | **Open (latent)** | `fit-camera-model.ts:85,119,128`: 6 points (12 residuals) against 14 free parameters; unreachable today because the matcher needs 8 or more rings, and the fit uses priors and drops terms (`fit-determined-lens.ts`) |
| 7 | Inconsistent private-host policies | **Open** | `/probe` allows loopback (`private-network-host-policy.ts:14,64`); `/frame-source` refuses it (`camera-frame-proxy-policy.ts:114-124`); neither allows 169.254/16, which RFC 3927 defines for links with "no other configuration mechanism" (https://www.rfc-editor.org/rfc/rfc3927, fetched 2026-11-08). A camera wired straight to the PC without DHCP is refused. No untrusted input reaches `/probe` (token-gated, typed by the operator) |

## KNOWN (from the brief, not raised again)
- W1-P3-4: the website's camera wording.
- V7-P3-1: camera target engrave shows no "Before you start".

## Refuted
None. Candidates the auditor dropped before raising:
- **Material height not seeded from the project's laser material thickness** (`ProjectLaserMaterial.thicknessMm`, `project.ts:134-137`; camera `surfaceHeightMm` default 0, `camera-store.ts:159`). R2 measures the cost of leaving it at 0 on a 3 mm sheet: 1.49–2.75 mm. Dropped because ADR-441 Amd 2 §5 decides heights are "not saved" and describe "what is on the bed now". The Material height field is in the overlay controls, and LightBurn has "the same single material thickness" (ADR-441 Amd 2, Context).
- **Autofocus webcams change the lens after calibration.** KerfDesk sets no `focusMode` (`web-camera.ts:69-79`), and W3C Image Capture lists "continuous" as a mode. No fetched LightBurn page says autofocus breaks calibration; its camera selection page lists "Fixed focus" as a camera spec. The anchor is too weak. Listed under Not verified.
- **Timelapse memory growth.** Bounded at 480 JPEG frames of at most 1024 px (`timelapse-frames.ts:7,27-42`, `timelapse-recorder.ts:25-26`). See Verified clean.

## Verified clean
- **Overlay ↔ compiled G-code (L3, REPRO `r2-twin`).** Setup: front-left, rear-right and centre origins; stock negative-space native frame [−400, 0]²; scene points (123.4, 287.6), (37.5, 41.25) and (350, 200), each on a 3 mm sheet.
  - `bedOverlayCompositeCoord` (the shader mirror, dpr 1.25, 1000 × 800 canvas) sampled exactly the camera pixel `projectWorldPoint` gives, for 9 of 9 cases.
  - A 10 mm square placed there and compiled by the real `emitGcode` (Absolute, `absoluteProgramOffset` = −native offset, as `job-placement.ts:213-222`) maps back through `nativePointToBed` and `toSceneCoords` to the placed point with a 0.000 mm difference.
  - The calibration target rings compile through the same Start path (#1473, ADR-440 Amd 7; J5 verified).
- **Lens distortion and the fold.** Kannala-Brandt forward and inverse, the guard at the fold (`camera-model.ts:63-71`, `bedMapper` `:110-128`), and the shader mirror holding to it. All unchanged since v2 and G6.
- **Camera moved, zoom and resolution.**
  - A changed frame shape, another camera, an unverifiable network resource, or a changed crop is refused with a reason (`camera-model-frame.ts:16-58`).
  - A bed-size or native-offset change moves the model; an origin change refuses it (`camera-bed-frame.ts:43-88`).
  - The view-reference "camera moved" check exists (ADR-663 Amd 3), with the KNOWN limits in G6-P3-2 and H6-P3-3.
- **Camera disappears mid-job.** A USB track end or an RTSP failure moves the source out of `live` (`camera-source-lifecycle.ts:49-51,96-121`). The timelapse stops with "The camera was turned off or switched." or, after 5 failed captures, "The camera stopped sending pictures." (`timelapse-recorder.ts:76-91`). The burn check and the trace retire on a source change.
- **Timelapse and job watch: memory and disk.** At most 480 frames, halved with a doubled interval at the limit. JPEG at most 1024 px at q 0.82. Nothing is written to disk until **Save video…**. An encode failure gives "Could not make the timelapse video."; a write failure, such as a full disk, gives "Could not save the timelapse video: <reason>" (`TimelapseResult.tsx:78-107`). The machine-JPEG proxy shares one in-flight fetch per URL (`camera-frame-proxy.ts:46-75`), so a hung camera does not grow a queue.
- **RTSP and bridge trust boundary.**
  - Camera addresses travel in POST bodies, not URLs (`rtsp-camera-bridge.ts:183-202`).
  - Camera-naming routes need the client token (`:43,115-123`), and DNS rebinding and no-Origin requests are refused (`:83-109`).
  - FFmpeg stderr is ignored and its errors are app-owned text (`rtsp-camera-stream.ts:73,150-155,235`). FFmpeg concurrency is capped at 4.
  - The HTTP frame proxy sends a login only as Basic, refuses redirects (`camera-frame-proxy.ts:162-185`) and refuses loopback.
  - The query part of a URL is never persisted: only an app-keyed HMAC fingerprint is (`camera-capture-binding.ts:7-9,112-114`).
  - No `console.*` in camera UI, state or platform code.
- **Remote camera.** The phone/MCP still needs control approval, the artwork-sharing opt-in and a camera already live on the PC. It returns pixels only (`machine-camera.ts:18-39`; ADR-585).
- **Camera consent (desktop).** Electron grants `media` only for video, in the main frame, from the trusted renderer origin (`trusted-renderer-policy.ts:83-106`). A camera starts only from the operator's action or the remembered-camera helper (ADR-663 Amd 1).
- **Calibration corruption.** Records normalise strictly, and a malformed record or optional field drops the whole record (v2 Verified clean). Then no overlay is drawn and the panel shows the camera as not calibrated, so nothing is placed through a broken record. A record that is corrupted but still valid numerically is not detectable (no checksum); see Not verified.
- **Place Board.** It uses head captures, not the camera model, so there is no camera transform to diverge. Its advice exception (ADR-654 Amd 3) holds (`start-job-readiness-policy.ts:132`). #1489 only splits Fit and Array enabling (`use-board-placement.ts`).
- **L8 diffs.** #1572 (`job-burn-route.ts:126-128`, `findMotionBlock`, behaviour-equal) and #1478's `sameHeights` region shift (`bed-picture-frame.ts:128-149`) are correct. #1478's capture cancellation is correct for the USB and machine starts, except W4-P3-2.

## Not verified
- **No browser run and no Vitest.** Available memory was 1,371–1,421 MB at every gate, under the 1.5 GB Vitest gate and the 2 GB browser gate. All repros are Node runs with the real modules. The GPU shader itself was not run; its CPU mirror was.
- **Chromium and a muted camera track (W4-P3-1).** Whether Chromium mutes a stalled UVC track, and whether a `<video>` then shows the last frame or black, was not checked. The same goes for what `captureStreamFrame` returns for a muted track: a stale frame, black, or the 5 s timeout.
- **Autofocus and focus breathing.** How far a UVC webcam's continuous autofocus moves the calibrated intrinsics was not measured, and no LightBurn page fetched states the problem.
- **Same-aspect sensor crop (#1546 item 5).** No primary source on UVC mode field of view was found or fetched.
- **One camera-address path.** Not run; detail redacted until W4-P2-2 is fixed (it touches the same data).
- **IPv6 camera hosts.** `URL.hostname` keeps brackets, for example `[fd00::5]`. The probe passes that hostname straight to `socket.connect` (`rtsp-probe.ts:183`), and whether the connect then fails was not run.
- **A record that is corrupted but still valid numerically.** No checksum or plausibility test; reach not assessed.
- **Phone/MCP Job Review parity** for the camera and rotary advice (W2's area). Not re-checked.

```json
[
  {"id":"W4-P2-1","severity":"P2","area":"camera","file":"src/ui/laser/start-job-readiness-policy.ts","line":134,"anchor":"Contract ADR-127 Amd 1 (placed rotary jobs keep the anchor; Absolute rebases to Y 0); Ground truth LightBurn RotaryModeGCode 'Current Position is the best Start From mode' for rotary; Twin ADR-654 Amd 3/4 exemptions (Place Board, jig) with no rotary exemption","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"With camera placement latched and an active rotary, Job Review advises 'Choose Absolute Coordinates to burn it where it is placed'; following it moves a chuck job from Y 60.9-99.1 (cylinder at work Y 80, Current Position) to Y 0-38.2, turning the cylinder ~80 mm of Y before burning, and the advice then disappears"},
  {"id":"W4-P2-2","severity":"P2","area":"camera","file":"redacted","line":0,"anchor":"redacted until fixed (security: credential leak into persisted/shared files)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"SECURITY - credential leak; redacted until fixed"},
  {"id":"W4-P3-1","severity":"P3","area":"camera","file":"src/ui/camera/WorkspaceCameraOverlay.tsx","line":66,"anchor":"Twin RTSP stall fails the source after 10 s vs USB mute keeps it live; panel-only note (CameraPreviewCard.tsx:42-46); Ground truth W3C mediacapture muted = temporarily unable to provide data","evidence":"READ","verdict":"PENDING","known":false,"summary":"A USB camera that stops sending pictures (track muted) leaves its last picture drawn on the canvas with placement latched; the 'not sending pictures' note shows only in the Camera panel"},
  {"id":"W4-P3-2","severity":"P3","area":"camera","file":"src/ui/camera/helpers/auto-start.ts","line":76,"anchor":"Twin USB/machine auto-start re-check current() after awaits; Contract #1478 comment 'Switching off is a cancellation'","evidence":"READ","verdict":"PENDING","known":false,"summary":"The #1478 auto-start cancellation (switch off, teardown) is not passed to RTSP/phone starts, which still start after an in-flight probe"}
]
```

## Refuter (2026-11-08)

Fresh context. Tree: main `5f09e1110` (scratchpad `j10-main`). Repros are Node 25 runs of the real modules through the auditor's loader (reused read-only): from scratchpad `zz-w4r/`, `node --import ../zz-w4/register.mjs <script>.mts`. Memory was 1,251 MB at the first gate and 1,896 MB later, so no browser run (2 GB gate); Vitest was not needed because every claim below ran on the real modules in Node. Ground truth re-fetched on 2026-11-08 (HTTP 200): LightBurn *Rotary Mode — GCode* (https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/) and LightBurn *Camera Alignment* (https://docs.lightburnsoftware.com/latest/Reference/Cameras/Alignment/); both live pages, no archive link, labelled for the 2.2 release candidate.

### Verdicts

**W4-P2-1 — CONFIRMED, SEVERITY CHANGE P2 → P1.**
- **What would make it false:** a rotary branch in the advice or anywhere else in Job Review; Absolute keeping the anchor on a rotary; a preview, canvas Frame outline or warning that shows the operator the burn moved before Start.
- **Checked (READ, pinned):**
  - `src/ui/laser/start-job-readiness-policy.ts:90-103` (`placementWarnings`) is the only caller path; `:125-135` has no rotary branch (`:131` silent at Absolute, `:132` Place Board, `:133` jig, `:134` the generic advice). No camera code reads the rotary (grep of `src/ui/camera`, `src/core/camera`, `src/ui/state/camera-*.ts`: no match).
  - `src/core/job/rotary-job.ts:43-45`: Absolute gets no anchor; `src/core/job/rotary-transform.ts:44-53`: no anchor gives `baseY = range.min`, `forwardOriginY = 0` (the rebase).
  - The only rotary line in Job Review is the machine row `src/ui/laser/job-review/job-review-live-rows.ts:138-144` (`rotaryReviewSummary`, `rotary-summary.ts:38-43`: "Enabled · attachment · mapping"). It says nothing about Start from.
  - The default Start from is Absolute (`src/core/job/job-origin.ts:72`), so the defect needs an operator who first chose Current Position or User Origin, which is what LightBurn advises for a rotary (re-fetched: "the best Start From mode to use when working with a rotary", Positioning). ADR-127 Amendment 1 says the same: its Context says a placed job's work position "already names the cylinder's turn", and Decision 1 keeps the anchor for those jobs. (The auditor attributed that quote to the Decision; it is in the Context.)
- **Refuter REPRO** `zz-w4r/r3-rotary.mts` → `zz-w4r/r3-rotary.out.json`. It uses the real Job Review entry `demotedPolicyWarnings`, the real `prepareOutput`, the canvas Frame outline `framePerimeterForCanvas` (`src/ui/state/canvas-frame-perimeter.ts:12-39`) and the physical Frame bounds (`computeFrameJobMotionBounds` of `machineSpaceJob`). Setup: chuck 360 mm/turn, Ø60, a 20 × 20 mm square placed at scene X 110–130, Y 150–170, camera placement latched.
  - **Current Position, head at (120, 80):** the advice is given ("Choose Absolute Coordinates to burn it where it is placed"). Anchor 80; physical Frame Y 60.901–99.099.
  - **User Origin:** the same advice. Anchor 0; Frame Y −19.099–19.099.
  - **Absolute (after following the advice):** no warning and no advisory. No anchor; physical Frame and burn Y 0–38.197.
  - **Canvas Frame outline: X 110–130, Y 150–170 in all three modes,** exactly on the placed artwork, because the outline is mapped back to the design surface (`rotary-transform.ts:17-27`).
- **Answers to the brief's questions:**
  - **What the operator sees before Start.** Neither the preview nor the canvas Frame outline shows Y 0. Both are surface-true by design (`rotary-job.ts:8-9`). At Absolute the canvas outline sits on the artwork placed on the camera picture, so the canvas agrees with the false advice. Only the physical Frame turns the cylinder, to Y 0–38.2, and METHOD §3 (G6 clarification) says Frame is not a warning.
  - **How far the burn moves.** Every point shifts by 60.9 mm of rotary Y. That is 60.9° of turn on this chuck, or 31.9 mm of surface on Ø60. The auditor's "about 42 mm" is the anchor-to-zero distance, not the shift; the finding stands either way.
  - **Reach.** Rotary plus camera placement is ordinary. The latch turns on whenever a calibrated picture is drawn, including the camera that starts by itself (`src/ui/camera/camera-placement-latch.ts:1-7,14-24`). A rotary user who follows LightBurn's advice is at Current Position. METHOD §3 has no reach clause.
- **Why P1, not P2.**
  - H6-P3-2 and J5-P2-1 stayed at P2 because "the text says truthfully that the job burns where the artwork sits on the canvas" (H6 refuter; J5 "advice that is accurate about where each mode burns").
  - On a rotary that premise is false. Absolute does not burn where the artwork sits; it rebases to Y 0, and the app's own canvas outline then shows it burning where the artwork sits.
  - The app's advice causes a wrong position on the part (§3 P1), with no warning at the mode the advice leads to.
  - To lower it, a refuter must show that the output is right or that a specific warning comes first. Neither holds.
- **Ground-truth note.** LightBurn's Camera Alignment page tells users "Make sure your Start From is set to Absolute Coords" and has no rotary carve-out. LightBurn's own pages therefore conflict in the same way. The contract anchor (ADR-127 Amd 1) and the twin (ADR-654 Amd 3/4, which already exempt two anchored layouts from the advice) are enough on their own.
- The coordinator should re-verify this severity change.

**W4-P2-2 — CONFIRMED, P2 (security: credential leak into persisted / shared files).** Details, the refuter's own REPRO and the severity reasoning are in the scratchpad file `zz-w4/SECURITY-DETAILS.md` under "Refuter (2026-11-08)". They are redacted here until the fix merges (AREAS.md, Security).

**W4-P3-1 — CONFIRMED (READ, two lines), P3.**
- **Line 1 (READ):** `usbAvailability` is written only by the stream lifecycle (`src/ui/state/camera-source-lifecycle.ts:46-47`, `muted` leaves the source `live`). Its only readers are `src/ui/camera/panel/CameraPreviewCard.tsx:22` and `src/ui/camera/panel/UsbCameraSection.tsx:21,90` (grep of `src`). `WorkspaceCameraOverlay.tsx:48-66` never reads it.
- **Line 2 (READ):** the overlay redraws only on a presented video frame (`use-bed-overlay-drawing.ts:144-155`). By contrast, the RTSP stall fails the stream (`electron/rtsp-camera-stream.ts:111-119`).
- **What is not established:** the "frozen last frame" half needs Chromium's behaviour for a muted UVC track. It stays PLAUSIBLE, as the auditor says.
- **Severity:** P3 holds. To be harmed, the operator must move material after the stall and then place artwork against a picture that still shows the old layout. That mismatch is in front of them on the canvas where they place.

**W4-P3-2 — CONFIRMED with a narrower scope, P3.**
- **What holds:** `src/ui/camera/helpers/auto-start.ts:76,84-94` never consults `current()`, so turning the switch off during the RTSP probe (up to 5 s) or the phone snapshot start does not stop that camera.
- **Correction to the twin:**
  - The RTSP and phone paths have no discovery await before the start; `current()` is checked at `:68`, immediately before `startRtspSource`.
  - The USB path re-checks only after `refreshCameras` (`:134-143`). Its own start, `startUsbSource` → `camera.openStream` (`src/ui/state/camera-source-actions.ts:194-199`), is guarded by `sourceEpoch` alone, the same as RTSP (`:242-245,264-268`).
  - So a switch-off during an in-flight USB `getUserMedia` is not honoured either. Only the machine camera, whose activation is synchronous after `:108`, is fully cancellable.
- **Contract:** the #1478 comment at `:58` promises cancellation "before discovery ends", which the RTSP path has no window to break.
- **The real gap:** no in-flight start (USB, RTSP or phone) honours the switch. The fix direction should cover all three, for example by passing `current` into the store's start actions.

### Challenges to "placement is accurate (0.000 mm)"

All of these run the real modules. Results are the worst distance between each placed vertex and the nearest burned vertex mapped back through `nativePointToBed` and `toSceneCoords`, with `absoluteProgramOffset` built by the rule in `src/ui/job-placement.ts:167-184,219-222`.

- **Rotated, mirrored and scaled artwork** (`zz-w4r/r4-twin-variants.mts` → `.out.txt`). Transforms tested: 30° rotation; mirror X with scale 1.3 × 0.8; mirror Y plus 30°. Every vertex was within 0.0004 mm, which is the 3-decimal G-code rounding. **Holds.**
- **Unlisted machine profile / native frame** (same script):
  - rear-left 600 × 300 with a positive frame [0, 600] × [0, 300];
  - front-right 600 × 300 with an offset envelope [−5, 595] × [−3, 297];
  - centre 500 × 320 with a negative frame.

  All within 0.0004 mm. **Holds.**
- **Work offset (G54) on a homed machine** (same script). Two cases: front-left 400 with a negative frame and WCO (−370, −360), and the centre bed with WCO (−250, −100). Within 0.0004 mm. **Holds.**
- **Non-homed machine with a work offset:**
  - With homing off or unconfirmed, `resolveNativeBedFrame` returns null (`src/ui/state/native-bed-frame.ts:99-103`). Absolute then only cancels the WCO (`job-placement.ts:199-210`), so the burn lands relative to the power-up position.
  - This is the generic Absolute assumption, not a camera transform defect. Two notices already cover it: the not-homed bed-check wording (`src/ui/state/frame-bed-edge-warning.ts:29`) and the calibration notice (`src/core/camera/model/camera-bed-frame.ts:126`).
  - Not run; nothing raised.
- **Material height above zero, and height areas** (`zz-w4r/r5-heights.mts` → `.out.txt`). The shader's CPU mirror against `projectWorldPoint` at material heights 0, 12 and 40 mm, and with a 45 mm height area under a 3 mm sheet, showed 0 px difference at every sampled point, inside and outside the area. **Holds.** The 1.5–2.75 mm error from leaving the height at 0 is the operator's field (ADR-441 Amd 2), as the auditor dropped it.
- **Lens distortion.** The twin's `wideLens` fixture already carries Kannala-Brandt terms `[−0.02, 0.01, −0.004, 0.0005]` (`src/core/camera/model/model-fixtures.ts:14-22`), so the auditor's 9/9 and R5 both exercise distortion. **Holds.**
- **Camera target engrave** uses Start's own builder at Absolute with placement forced on: `prepareStartJobSnapshot(..., DEFAULT_JOB_PLACEMENT, ...)` in `src/ui/camera/calibrate/transient-camera-job.ts:56-66`. That is the same transform as a canvas Start. **Holds.**
  - Side observation (`zz-w4r/r6-target-rotary.mts` → `.out.json`), **not raised**. If the rotary switch is left on, the target project keeps the device's rotary (`calibration-actions.ts:104-108`), so the rings compile rebased:
    - roller: Y 0–129.6 instead of 135.2–264.8;
    - chuck: 0–247.5;
    - no preflight issue in either case.

    Reaching this needs the rotary on in software while the gantry Y drives a flat bed. Every Absolute job is then rebased the same way, and Job Review's Rotary row is shown in warning tone. It belongs with the KNOWN "no camera code reads the rotary" (H6, Not verified).
- **Place Board** imports nothing from the camera model (grep of `src/ui/laser/board-capture`: no `camera` match). It uses head captures and its own advice exception (`start-job-readiness-policy.ts:132`). There is no shared transform to diverge. **Holds.**

### New findings

None.

### Not verified (refuter)

- No browser run (memory under the 2 GB gate): the GPU shader itself, Chromium's muted-track rendering (W4-P3-1), and the auto-start timing (W4-P3-2) in a live app.
- One third-party reference for W4-P2-2 was not re-fetched (detail in the security file).

Refuter counts: raised 4, refuted 0, P1 1, P2 1, P3 2, known 18
