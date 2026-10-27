# Rolling audit v4 — Camera placement

- **When:** 2026-10-27 15:00–16:10 +0800   **Tree:** origin/main @ `a59f74ff9` (the worktree's `src` is identical: `git diff HEAD a59f74ff9 -- src` is empty).
  - **Merged after the tree** (`git fetch`, origin/main @ `105d6374c`):
    - #1463 (`6b3227e27`, ADR-440 Amd 5): the camera fixes for G6-P2-1, G6-P2-2, G6-P2-3 and G6-P3-3;
    - #1460 (`d5bd5fbf8`, ADR-654 Amd 1): remote board capture keeps the PC Capture gate (G7-P3-1);
    - #1464: tone calibration, not camera placement.
  - **Each finding was re-checked on origin/main.** `git diff --stat a59f74ff9 origin/main` is empty for every file cited below except `head-capture-store.ts`. There #1463 adds only the picture's `taken` frame; the height it flattens at and the missing height areas are unchanged (main `:269-275`).
  - *Refuter correction:* `install-camera-helpers.ts` and `camera-store.ts` also changed on main (#1463). The changes add the `followBedPictureFrame` and `watchCanvasTargetBurns` helpers and the `BedPicture.taken` type, and touch neither the auto-start, the defaults nor the latch. Only the line numbers move: on main the auto-start is `install-camera-helpers.ts:49,83-101`, and the defaults are `camera-store.ts:152,160`.
- **Scope:** every way a camera-based placement reaches a burn, and what each one trusts and checks.
  - **Overlay:**
    - `src/ui/camera/WorkspaceCameraOverlay.tsx`, `OverlayControls.tsx`, `use-camera-placement-controls.ts`;
    - `active-camera-model.ts`, `camera-bed-frame-now.ts`, `camera-model-frame.ts`;
    - `helpers/*` (auto-start, refresh, moved check).
  - **Camera tools:** trace (`use-trace-from-camera.ts`), Find pieces and fixtures (`pieces/*`), head camera (`head/*`, `core/camera/model/head-camera*.ts`) and the calibration actions.
  - **Print and Cut camera marks:** `src/ui/laser/use-print-cut-camera.ts`, `print-cut-camera-request.ts`, `print-cut-output.ts`, `print-cut-frame-warnings.ts`.
  - **Place Board and the jig:** `src/ui/laser/board-capture/*`, `src/ui/state/board-capture-actions.ts`, `src/ui/workspace/registration-jig/*` and `src/io/gcode/prepare-output.ts:395-412`.
  - **Start and placement:**
    - `start-job-readiness-policy.ts` and `start-machine-snapshot.ts`;
    - `src/ui/job-placement.ts` and `native-bed-frame.ts`;
    - `canvas-motion-badge.tsx` and `restored-origin-warning.ts`.
  - **Camera identity:** `frame-source.ts`, `saved-cameras.ts`, `camera-resource-identity.ts`, `electron/camera-frame-proxy.ts` and `src/platform/web/web-camera.ts`.
  - **Governing ADRs:**
    - ADR-228 Amd 1;
    - ADR-440 Amds 1–5;
    - ADR-441 Amds 2 and 5;
    - ADR-446 and ADR-449;
    - ADR-663 Amds 1 and 3;
    - ADR-654, ADR-057 and ADR-642 §3;
    - WORKFLOW F-CAM3 and F-CAM12.
- **Lenses run:**
  - **L9 entry-point parity (main lens).** The path table is below.
  - **L3 twins.** Head-camera picture against the live overlay; moved check against frame notes.
  - **L1.** Only for the clauses cited.
  - **Not run:**
    - L2: no claim rests on an outside source;
    - L5: the bridge trust boundary is G7's;
    - L6;
    - L7: no test-truth claim is raised.
- **Repros:** two temporary Vitest files, both deleted. Each was run with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose`.
  - `src/ui/camera/helpers/zz-h6-autostart.test.tsx` ran the real code throughout:
    - the stores and `installCameraHelpers` with a fake bridge;
    - `machineSnapshot` and `prepareStartJob`;
    - `<OverlayControls/>`.
  - `src/core/camera/model/zz-h6-stitch-height.test.ts` ran the real `stitchHeadCameraPictures` and `warpFrameToBedImage` on rendered frames.
- **Counts:** 6 raised → 0 refuted → P1 3 / P2 1 / P3 2 (+ 6 KNOWN re-observed).
  - **Refuter verdicts:** 5 CONFIRMED and 1 PLAUSIBLE (H6-P3-3).
  - **Severity changes:** H6-P2-1 is raised to P1 and H6-P3-2 to P2.
  - **Refuter repros:** two temporary Vitest files with their own geometry, both deleted:
    - `src/ui/camera/helpers/zz-h6r-autostart.test.tsx`;
    - `src/core/camera/model/zz-h6r-stitch.test.ts`.

## Headline

ADR-663 Amendment 1 moved the everyday overlay out of the Camera panel. A calibrated camera now starts by itself and draws the bed on the canvas. ADR-228 Amendment 1's Job Review warning, though, is keyed on a placement latch that only the panel, Refresh, Alt+C and Trace set.

- **The Falcon A1 Pro profile ships with homing off, so Start from defaults to User Origin.** On that profile, artwork placed on the auto-started picture burns at the origin with no camera word anywhere. In the repro it burned 199 mm from where the picture showed it (H6-P1-1).
- **A head camera's stitched picture ignores height areas and keeps the material height it was captured at.** The live overlay and trace honour both. A 20 mm box was drawn 6.5 mm off (H6-P1-2), and a head camera's Z is never recorded at all (H6-P2-1, P1 after the refuter).
- **The fixes that merged today hold on their own paths.** #1463 makes the frame follow for the canvas target and the bed picture, and #1460 gates remote board capture. Their siblings above slipped past.

## Entry-point parity (L9)

The columns: what each path trusts, and which checks run before the burn. "Latch" means `placementActive`, which feeds the Job Review camera Start-from warning.

| Path | Bed frame | Head position | Surface height / areas | Camera identity | Checks before the burn |
|---|---|---|---|---|---|
| Overlay, panel opened (live, still, Alt+C) | `activeCameraModel` → `modelInBedFrame` (moved, or refused after an origin change) | n/a (fixed) | re-projected at the height and areas set now | capture binding (`camera-model-frame.ts:17-59`) | latch; moved check (panel, or a toast when the panel is closed); frame notes in the panel; Frame |
| **Overlay auto-started, panel never opened** | same | n/a | same | same | **no latch, so no Job Review camera warning** (H6-P1-1); **frame notes never shown** (H6-P3-1); moved-check toast; Frame |
| Trace from camera / Trace area | model at the click | live head (head camera) | at capture; an in-flight capture retires on a change | binding | latch (`use-trace-from-camera.ts:67`) |
| Find pieces → place on pieces | same | same | the scan is retired when height, areas, model or bed change (`piece-scan-context.ts:6-28`) | binding | latch through the panel effect |
| Fixture reuse | camera-geometry key against the saved one | — | warns when the height or areas differ (`fixture-layout.ts:113-130`) | live required for the context | dialog warnings and a "reviewed" tick; latch only when the camera is live (sibling of H6-P1-1) |
| Head camera live overlay | `cameraModelInBedFrame` | live, homed only (`head-position.ts:22-34`) | re-projected | binding | **Z never recorded** (H6-P2-1) |
| Head camera Capture here / Capture bed (stitched) | frame and machine recorded (main, #1463) | settles at Idle within 0.1 mm, second of two frames | **flattened at the capture height; areas ignored; no later check** (H6-P1-2) | binding | latch through the panel effect |
| Print and Cut camera marks | `trustedPositionEpoch` + `nativeBedCaptureFrameKey` + profile (`print-cut-camera-request.ts:12-38`) | — | at find | binding | own Start-from warning (`print-cut-frame-warnings.ts:22-24`); withheld from CNC |
| Engrave target / nudge ring | hand-built snapshot | — | sheet thickness | — | **H1-P1-1 KNOWN** |
| Add target to canvas | frame stamped at the framed Start (main, #1463) | — | sheet thickness | — | an unseen burn after a change is refused (main) |
| Place Board (PC, MCP, outline) | head captures, no camera model; G92 at the physical corner | live head | — | — | gated capture (main, #1460); the camera warning gives advice that breaks it (H6-P3-2) |
| Jig editor | camera-free; every run anchored to the box (ADR-057) | — | — | — | the camera advice (Absolute) keeps box and art together |
| Run again / Start from line | archived compile, receipt signature | — | — | — | H2-P1-1 KNOWN (Print and Cut registration dropped on Start from line) |
| Reopened project | #1437 keeps the machine's calibration; G6-P2-2 notice fixed on main | — | the camera store survives Open | — | 12-P3-4 KNOWN (a still survives Open) |
| Second machine, same camera | profile id, name and bed size | — | — | URL + app-local key: **every A1 Pro has the same URL** (H6-P3-3) | moved check only |
| Bridge / network camera | as above | — | — | as above | 12-P3-3 KNOWN (a dead JPEG poll is silent) |
| Electron vs browser | — | — | — | the USB `deviceId` and the network key are per app, so a foreign calibration is refused, not misapplied | — |

## Findings

### H6-P1-1 — A calibrated camera that starts by itself draws the bed on the canvas without latching camera placement, so Job Review never gives ADR-228 Amd 1's warning; on the Falcon A1 Pro profile (User Origin by default) the artwork burns about 200 mm from where the picture showed it

- **Where:**
  - **The latch.** `src/ui/camera/use-camera-placement-controls.ts:34-37` latches only while it is mounted. Its one caller is `CalibratedOverlayControls` inside the Camera panel (`src/ui/camera/OverlayControls.tsx:63`).
  - **The other writers.** Refresh, Alt+C and the after-job refresh (`capture-overlay-still.ts:66`, `helpers/refresh-picture.ts:33`) and Trace (`use-trace-from-camera.ts:67`) also latch.
  - **The auto-start.**
    - `src/ui/camera/helpers/install-camera-helpers.ts:38,72-90` starts the camera with KerfDesk, on a new calibration and when the laser connects.
    - `src/ui/state/camera-store.ts:142,150` default to `overlayVisible: true` and `placementActive: false`.
    - The canvas then draws the picture (`WorkspaceCameraOverlay.tsx:34-42`).
  - **The warning.** `src/ui/laser/start-job-readiness-policy.ts:90` returns null unless `cameraPlacementActive`.
  - **The default.** `src/ui/job-placement.ts:44` gives a homing-off machine User Origin. The shipped Falcon A1 Pro profile inherits `homing.enabled: false` (`core/devices/device-profile.ts:408`).
- **Anchor:**
  - **Contract, ADR-228 Amd 1 Decision.** "While camera placement is active and Start from is not Absolute Coordinates", Job Review says so.
  - **Contract, its Context.** It explains why: "Only the Frame shows this".
  - **Twin, ADR-663 Amd 1.** The auto-start says "its picture then shows on the canvas without opening the panel". Its sibling Alt+C "latches camera placement, as **Refresh picture** does".
  - **The store's own comment** (`camera-store.ts:72-75`): the latch "Latches once the aligned overlay is used for physical placement".
- **Scenario:**
  1. A Falcon A1 Pro owner calibrates the camera once.
  2. Next session KerfDesk opens and the laser connects. The laser's camera starts by itself, and the bed shows on the canvas. The Camera panel is never opened.
  3. They drag artwork onto a blank in the picture, at machine X200–220 Y98–118. Start from is User Origin, the default. Start's fix offer asks for **Set origin here**, and they click it.
  4. Job Review has no camera line, and the burn lands at the origin.
  5. Opening the Camera panel even once would have latched placement and shown the warning.
- **Evidence:** REPRO `zz-h6-autostart.test.tsx` (deleted). It used the real `installCameraHelpers` with a fake bridge (`last camera = machine`), the real `FALCON_A1_PRO_GRBLHAL_PROFILE` with a framed 358 × 268 calibration, and the real `machineSnapshot` and `prepareStartJob`. A 20 × 20 mm square sat at scene (200, 150)–(220, 170), with WCO (15, 25). Output:
  - `default Start from for the Falcon A1 Pro profile: user-origin`.
  - After the auto-start: `{"panelOpen":false,"overlayVisible":true,"modelInUse":true,"placementActive":false,"snapshotCameraPlacementActive":false}`.
  - Job Review warnings with the panel never opened: only the generic `The controller-to-bed coordinate mapping is unverified. The canvas is artwork-relative; …` and the profile-S1000 power note.
  - The burn is at work X0..20 Y0..20, so machine X15–35 Y25–45. The Absolute burn, where the picture shows the artwork, is X200..220 Y98..118. The two are 185 mm and 73 mm apart (199 mm).
  - After mounting `<OverlayControls/>` once, `placementActive` is true and Job Review says "Camera placement is on, but Start from is User Origin. …".
- **Severity:** P1.
  - **The output is wrong.** The burn lands at a different position, with no warning that names the camera.
  - **The generic message is not that warning.** The unverified-mapping text is on every job of a homing-off machine, and its "the canvas is artwork-relative" says nothing of the camera picture. That text already existed when ADR-228 Amd 1 added the camera-specific warning for this exact case.
  - **The canvas badge does not cover it.** Its camera wording ("Drawn over artwork — burns at your origin", `canvas-motion-badge.tsx:216-218`) appears only when the bed position is known. With homing off, `frame.bed` is undefined and it says "Relative view — physical bed position unverified" (`:213`, READ).
  - **The planned route is drawn over the artwork,** which sits on the camera picture (ADR-642 §3).
  - **The homed variant is milder.** A homing machine with a hand-chosen User Origin or Current Position does get that camera badge on the canvas, so that variant alone would be P2.
- **Sibling (READ):** fixture reuse with the camera stopped (`use-fixture-review.ts:70-73`) places camera-measured slot positions with the panel open but `overlayUsable` false, so nothing latches.
- **Novelty:** not in `docs/audits/`. G6-P3-1 is the opposite: the after-job refresh latches too eagerly. `gh pr list --state open` is empty.
- **Refuter:** CONFIRMED (REPRO, own harness), P1 kept.
  - **What would make it false:**
    - the auto-start off by default or unreachable;
    - a second latch writer;
    - Start from defaulting to Absolute;
    - a camera-specific warning elsewhere;
    - a change on main.
  - **Reachability (all READ on main).**
    - `DEFAULT_CAMERA_HELPERS.autoStart` is `true` (`camera-preference-storage.ts:155-157`).
    - `useCameraHelpers` runs from `App.tsx:162`. Only the hosted Free build skips the start.
    - `placementActive` is not persisted.
    - The latch has exactly four writers (`git grep` on main): the panel hook (one caller, `OverlayControls.tsx:63`), `captureOverlayStill` via Refresh or `refresh-picture.ts:33`, and Trace.
    - A fresh app's Start from comes from `project.jobSetup.placement` (`project.ts:213`): `user-origin` while homing is off. Picking the Falcon profile (homing off) keeps it.
  - **REPRO.** `zz-h6r-autostart.test.tsx` (deleted) used:
    - the real `installCameraHelpers` with a fake bridge (`last camera = machine`);
    - the real Falcon A1 Pro profile with a 358 × 268 framed calibration;
    - a mounted `<WorkspaceCameraOverlay/>`.
  - **REPRO output.**
    - After the auto-start: `{"panelOpen":false,"overlayVisible":true,"modelActive":true,"placementActive":false,"overlayDomNodes":1}`.
    - Real `machineSnapshot` and `prepareStartJob` at User Origin, WCO (15, 25): work X0..20 Y0..20. The only warnings are the generic `UNKNOWN_NATIVE_BED_MESSAGE` and the S1000 note.
    - The Absolute compile reaches X220 Y118, as the auditor's X200–220 Y98–118 says.
    - With the latch set, the "Camera placement is on, but Start from is User Origin…" line appears.
  - **No camera-specific text reaches the operator.**
    - `resolveNativeBedFrame` returns null with homing off, so the canvas badge is "Relative view — physical bed position unverified".
    - The other position texts are the generic unverified-mapping warning and the Set-origin refusal. None names the camera picture.
    - Nothing on the canvas moves: the artwork stays on the picture and only the Frame goes elsewhere.
  - **Main.** The latch, the auto-start condition, the defaults and `cameraPlacementStartFromWarning` are unchanged. #1463 only adds helpers beside them.
  - **Novelty.** Open PRs: none. G6-P3-1 is the opposite case.
  - **Severity.** P1 per §3 (2026-10-23 and 2026-10-27): the burn position differs from the picture, and no warning naming the mismatch is given.
  - **Test-harness note.** `resetStore` seeds `DEFAULT_JOB_PLACEMENT` (Absolute), so a test must set User Origin itself. The app does not.
- **Fix direction:** Latch placement wherever the calibrated picture is drawn on the canvas, for example in `WorkspaceCameraOverlay` when it draws a model or bed picture, not in the panel hook. Or key the warning on "a calibrated picture is shown" as well as the latch.

### H6-P1-2 — A head camera's stitched bed picture ignores height areas and keeps the material height it was captured at; the live overlay and trace honour both, so artwork placed on a raised object burns 6.5 mm off its picture

- **Where:**
  - `src/ui/camera/head/head-capture-store.ts:266-272` (main `:269-275`). `stitchHeadCameraPictures(record, pictures, { region, pixelsPerMm, surfaceHeightMm })` gets no `heightAreas`. `StitchOptions` has no field for them (`core/camera/model/head-camera-stitch.ts:21-26`).
  - `BedPicture.surfaceHeightMm` is written and never read, on main too. The only frame check, `bedPictureNow` (main `bed-picture-frame.ts`), compares the frame and the machine, not the height.
  - `WorkspaceCameraOverlay.tsx:40` draws the picture before `ModelOverlay`, so a head camera's picture gets no `HeightAreaOutlines` either.
  - The **Raised objects** fold is still offered for a head camera (`OverlayControls.tsx:101-107`), and so is **Material height** (`:96`).
- **Anchor:**
  - **Contract, WORKFLOW F-CAM3 (Object heights).** "The overlay shows each area at its own height, with a dashed outline".
  - **Contract, ADR-449 Decision 2.** The features that follow the head include "the overlay, Trace from camera, Find pieces, the accuracy map, height areas".
  - **Twin, the live overlay.** It re-projects at the height and areas set now (`use-bed-overlay-drawing.ts`).
  - **Twin, the trace.** `warpFrameToBedImage` takes `heightAreas`.
  - **Twin, the piece scan.** A completed scan is retired when the height or areas change (`piece-scan-context.ts:24-25`).
  - **What the ADR accepts, and what it does not.** ADR-449 Consequences accept only the capture-height half: "flattened at the material height set when it was taken". Nothing in the UI or WORKFLOW F-CAM12 says it, and nothing accepts ignoring areas.
- **Scenario A (areas):**
  1. A head-camera owner has a 3 mm sheet and a 20 mm box. They add a height area of 20 mm over the box, as F-CAM3 says to.
  2. They press **Capture selection**.
  3. The joined picture flattens the box top at 3 mm. A mark on the box is drawn 6.5 mm from where it is.
  4. Artwork placed on it burns 6.5 mm off. **Trace area** over the same box lands correctly.
- **Scenario B (height after capture):**
  1. They capture at the default 0 mm.
  2. Then they set **Material height** to 6 mm for a 6 mm sheet. The field's tooltip says "set this to the top of your material so its edges line up".
  3. The picture does not change, and nothing says it needs a new capture. Marks stay 1.9 mm off at 19 mm from the lens axis.
- **Evidence:** REPRO `zz-h6-stitch-height.test.ts` (deleted).
  - **Setup:** a head camera 70 mm above the bed (fx 900, 1280 × 720, beam offset (3, −2), exact pose and mount), and frames rendered with `pixelToBed` at the true surface height. Each frame has one dark 3 mm square at bed (120, 107), with the head at (100, 100).
  - **Measured with** the real `stitchHeadCameraPictures` and `warpFrameToBedImage`, by the dark-pixel centroid. Output:
    - 6 mm sheet, picture taken at 0 mm: drawn at (121.63, 107.88), **off 1.85 mm**.
    - Control, picture taken at 6 mm: drawn at (120.00, 107.00), off 0.00 mm.
    - 20 mm box, sheet 3 mm, stitched: drawn at (125.75, 110.00), **off 6.49 mm**.
    - The live warp of the same frame with the box's height area: drawn at (120.00, 107.00).
  - **Where the error grows.** It is proportional to the distance from the lens axis; the usable view reaches about ±40 mm.
- **Severity:** P1 for scenario A.
  - **The output is wrong.** The operator did what F-CAM3 asks, and the position is off with no notice.
  - **The Frame is not a warning** (METHOD §3).
  - **Precedent.** G6-P2-3 was raised to P1 for the same picture being drawn off after a frame change.
  - **Scenario B alone would be P2.** ADR-449 Consequences assign it to the operator, but the app never says so.
- **Novelty:** G6-P2-3 and #1463 (ADR-440 Amd 5 Decision 3) fixed only the bed frame and machine of this picture. Height areas and the capture height are new.
- **Refuter:** CONFIRMED (REPRO with independent geometry, plus READ on main), P1 kept.
  - **What would make it false:**
    - main passing the areas, or re-stitching on a height change;
    - a notice;
    - the ADR accepting both halves.
  - **READ on main.**
    - `StitchOptions` (`head-camera-stitch.ts:21-26`) has no `heightAreas`, and `addPicture` calls `warpFrameToBedImage` without them.
    - `showPictures` (main `head-capture-store.ts:258-278`) passes `region`, `pixelsPerMm` and `surfaceHeightMm` only.
    - `BedPicture.surfaceHeightMm` has no reader.
    - `bedPictureNow` and `followBedPictureFrame` compare only the frame and the machine.
    - `setSurfaceHeightMm` and the height-area setters leave `bedPicture` alone.
    - The only height text in `head/` is the "does not see the bed at this material height" refusal before capture.
  - **REPRO setup.** `zz-h6r-stitch.test.ts` (deleted) used the fixture of `head-camera.test.ts`: 60 mm up, fx 500, 640 × 360, offset (30, 10), head at (150, 120). Frames were rendered by ray-casting with the real `bedMapper`. Measured with the real `stitchHeadCameraPictures` and `warpFrameToBedImage`, by the dark centroid, for a mark 15.8 mm from the axis.
  - **REPRO output.**
    - 20 mm box on a 3 mm sheet: stitched 6.72 mm off. The warp with the box's area is 0.00 mm off.
    - 6 mm sheet captured at 0 mm: 1.75 mm off. Captured at 6 mm: 0.00 mm off.
    - Both match the ray geometry (15.8 × 57/40 and 15.8 × 60/54).
  - **Anchor note.**
    - ADR-449 Decision 2's list is about the model following the head, not about the joined picture.
    - Scenario A rests on F-CAM3 ("The overlay shows each area at its own height"), on the **Raised objects** fold being offered for a head camera (main `OverlayControls.tsx:101-107`), and on the trace and live twins.
    - The Consequences sentence accepts only the capture height, and it is in the ADR only, not in the app or in F-CAM12.
  - **Severity.**
    - P1 for A.
    - B alone is also P1 under §3 (2026-10-23): 1.75 mm silent, and the ADR's "needs a new capture" never reaches the operator. The auditor's "B alone would be P2" is not adopted.
  - **Novelty.** Not in `docs/audits/`. 12-camera's pixel-convention check of "head stitching" did not cover heights.
- **Fix direction:**
  - Pass `heightAreas` into the stitch (each picture's `warpFrameToBedImage` already accepts them) and draw the area outlines over a bed picture.
  - Record the areas with the picture.
  - When the material height or areas later differ from those recorded, clear the picture with a notice, as `bedPictureNow` does for an origin change, or say "Capture again to use the new height".

### H6-P2-1 (P1 after refuter) — A head camera never records the head's Z: after autofocus or a Z move the live overlay, trace, Find pieces and captures are off, and nothing says so

- **Where:**
  - `core/camera/model/camera-model-record.ts:46`: the mount holds `headAtCalibrationMm: Vec2` only.
  - `core/camera/model/head-camera.ts:45-58`: `modelAtHead` shifts the pose by XY.
  - `ui/camera/head/head-position.ts:22-34`: the head position is XY, and the reported Z is dropped.
  - **Z moves are reachable in laser mode.** Autofocus is offered there (`ControllerConnectionControls.tsx`); the A1 Pro profile's command is `$HZ1`.
- **Anchor:**
  - **Twin.** XY head motion is followed live (ADR-449 Decision 2), Z is not.
  - **Contract, ADR-449 Consequences.** "after changing Z, return it there or calibrate again".
  - **What the operator is told.** That duty appears in no UI text and not in WORKFLOW F-CAM12. `git grep` finds it only in the ADR.
- **Scenario:**
  1. A head camera rides on a Z-moving laser head.
  2. The operator autofocuses on a thicker sheet, so the head rises 6 mm.
  3. The overlay, Trace from camera, Find pieces and Capture here/bed all assume the camera is at its calibration height.
  4. Marks are drawn 1.5 mm off at 19 mm from the lens axis, and about 3 mm off at the edge of the usable view (proportional, not run).
  5. Artwork placed on them burns off by the same amount.
- **Evidence:** REPRO in the same file.
  - **Setup:** a frame rendered with the camera 76 mm up was warped through the 70 mm calibration at the same head XY.
  - **Output:** "mark at (120.00, 107.00) drawn at (118.63, 106.38), off 1.51 mm".
  - **READ:** no head-camera code reads Z (`git grep` over `src/ui/camera` and `head-camera.ts`).
- **Severity:** P2.
  - **The output is wrong, and nothing in the app says so.** That is P1 by effect.
  - **But the governing ADR assigns the step to the operator.** The defect is that the operator is never told. A refuter applying METHOD §3 strictly may raise it.
- **Refuter:** CONFIRMED (REPRO with independent geometry, plus READ on main). **Severity P2 → P1.**
  - **What would make it false:**
    - Z recorded anywhere;
    - a warning in the app;
    - Z moves unreachable with a head camera.
  - **READ on main.**
    - `CameraMount` is `{ kind, headAtCalibrationMm: Vec2 }`.
    - `headPositionOnBed` returns XY.
    - `git grep "return it there"` finds only `docs/decisions/ADR-449-camera-on-the-laser-head.md:65-66`. No UI string mentions Z for a head camera.
    - Autofocus and Z jogs are offered in laser mode.
  - **REPRO** (same deleted file, with the head camera 60 mm up):
    - **Camera raised 6 mm, sheet at 0:** the live warp is 1.43 mm off at 15.8 mm from the axis, against 0.00 mm for the control. That is 15.8 × 60/66.
    - **Autofocus case** (6 mm sheet, head up 6 mm): with **Material height** set to 6 as its tooltip asks, 1.64 mm off. Left at 0, 0.00 mm, because a pure Z shift cancels.
  - **The error depends on what the operator does next.** It is silent whichever way the operator goes: following the height tooltip after autofocus misplaces, and so does any Z jog or defocus.
  - **Severity:** raised to P1 under §3 (2026-10-23).
    - The position is wrong and reachable.
    - The only text is the ADR's Consequences line, which never reaches the operator. A refuter may lower a P1 only for a warning that reaches the operator, and an operator duty written in an ADR is not one.
  - **Novelty.** Not in `docs/audits/`.
- **Fix direction:** Record the reported Z in the head mount at calibration (and at **Check camera**). Then either shift the model by ΔZ along the camera axis, or refuse it with a notice when |Z − Z_cal| exceeds a tolerance. At minimum, say ADR-449's rule in the panel.

### H6-P3-1 — The bed-frame notes ("calibrated before KerfDesk knew …", "moves its picture N mm") are shown only in the Camera panel; the auto-started overlay shows the picture without them, while the moved-check sibling toasts when the panel is closed

- **Where:**
  - `useOwnCameraFrameNote` has only two readers: `OverlayControls.tsx:35-40` and `calibrate/CalibrateCameraControls.tsx:23,85-88`. Both are inside the Camera panel. The same holds on main.
  - The twin toast is `helpers/moved-check.ts:167-171`.
  - The note text is `core/camera/model/camera-bed-frame.ts:124-125`.
- **Anchor:**
  - **Twin, ADR-663 Amd 3.** The moved warning: "toast says the same when the panel is closed".
  - **The note itself.** ADR-441 Amd 5's unverified-frame note is the after-the-fact warning for a calibration made unhomed.
- **Scenario:**
  1. The operator calibrated on a homing machine without homing, ignoring the target step's advice.
  2. Next session they home. The camera starts by itself.
  3. The overlay draws a model whose rings were placed at power-on-relative positions.
  4. "If the picture does not line up with a burn, home the machine and calibrate the camera again" is never seen unless the panel is opened.
- **Evidence:** READ (`git grep` of the readers on origin/main).
- **Severity:** P3. It is an advisory note. The home-first advice was shown at calibration time, and the moved check, if the camera's surround moved, still toasts.
- **Refuter:** CONFIRMED, P3 kept, with a corrected reason.
  - **Evidence (two lines).**
    - READ on main: `cameraBedFrameNote` is called only from `OverlayControls.tsx:35`, `CalibrateCameraControls.tsx:23` and `nudge-actions.ts:141`, all in the panel.
    - The H6-P1-1 repro shows the overlay drawn with the panel closed.
  - **Why the auditor's reason is wrong.** The moved check does not cover this case. It looks for camera movement against its saved surround, not a frame that was unknown at calibration, and it stays silent on a poor match.
  - **What keeps it at P3.** `HOME_BEFORE_TARGET_NOTE` (`CalibrationSetupStep.tsx:239-240`) names this exact consequence before the target burn: the calibration "would hold only until the next Home". The hidden panel note is a reminder of a warning already given.
  - **The moved half is information only.** Its model is moved exactly.
- **Fix direction:** Push the unverified and moved notes as one keyed toast when the calibrated picture is first drawn with the panel closed, as the moved check does.

### H6-P3-2 (P2 after refuter) — On a Place Board job the camera Start-from warning advises Absolute Coordinates, which would burn the artwork at its centred canvas outline, off the registered board

- **Where:**
  - `start-job-readiness-policy.ts:92`: "Choose Absolute Coordinates to burn it where it is placed".
  - `state/board-capture-actions.ts:3,36-40,73-74`: the board outline "centers it fresh on the bed" and placement is `user-origin` with a G92 at the physical corner.
- **Anchor:**
  - **Twin.** One guard's advice contradicts another path's placement contract.
  - **Contract, ADR-654 Decision 3.** The outline is "centred and kept out of the burn".
  - **Contract, ADR-654 Decision 5.** "Placement switches to User Origin, front-left".
- **Scenario:**
  1. With camera placement latched, the operator registers a board with Place Board.
  2. Job Review says the job burns at User Origin, "not where the artwork sits on the camera picture", and advises Absolute.
  3. Following that advice burns the artwork at the centred outline. On a 400 mm bed and a 100 × 50 board at (20, 20), that is about 130 mm off the board.
- **Evidence:** READ.
- **Severity:** P3. It is advice, the operator changes the mode deliberately, and the camera picture itself shows the artwork off the board.
- **Refuter:** CONFIRMED (READ, two lines). **Severity P3 → P2.**
  - **Evidence.**
    - `cameraPlacementStartFromWarning` fires for any job that is latched and not Absolute (main `start-job-readiness-policy.ts:86-93`).
    - main `board-capture-actions.ts:36-45,58-75` centres the outline and sets User Origin.
    - Nothing in Start or Job Review checks `captured-board` with Absolute. `job-review-registration-jig.ts:21` only excludes it from the jig review.
  - **Why it is reachable.** The latch is sticky for the session (G6-P3-1). While it is latched with the picture hidden, the designed state of `camera-store.ts:73-75`, the operator sees no picture that would contradict the advice.
  - **Severity.** P2 per M6-P2-2: §3's P3 has no slot for reachable advice that, when followed, burns the artwork off the board. ADR-654 Decisions 3 and 5 give the failure scenario.
  - **Not P1.** The operator changes the mode, and the text says truthfully that the job burns where the artwork sits on the canvas.
- **Fix direction:** Skip the camera Start-from warning when the anchor is a captured board (`captured-board` provenance) or Print and Cut. Alternatively, word it for that case.

### H6-P3-3 — The Falcon A1 Pro camera's identity is its RNDIS URL, which every A1 Pro shares, so a second unit (or a replacement) silently binds the first unit's calibration

- **Where:**
  - The fixed candidates are `http://192.168.10.1:8080/media/getCapturePhoto` and three more (`electron/camera-frame-proxy.ts:33-36`, `src/platform/web/web-camera.ts:17-22`).
  - The identity is that URL plus an HMAC of its query under an app-local key (`ui/camera/frame-source.ts:61-88`, `ui/state/camera-resource-identity.ts:8-20`).
  - `core/camera/model/saved-cameras.ts:36-44` (`modelBelongsTo`) matches on it.
  - #1437's "same machine" test is profile id, name and bed size (`project-bed-reconciliation.ts:134`).
- **Anchor:**
  - **Twin.** ADR-446 binds each calibration "to its own camera". The USB path uses the stream's `deviceId`; the network path has no per-unit fact.
  - **The defect is the binding, not ADR-440 Amd 3.** Amd 3 says the calibration belongs to the machine.
- **Scenario:**
  1. A workshop with two A1 Pros on one PC (or a unit returned from repair) uses the catalog profile.
  2. The second unit's camera answers at the same URL, so the first unit's lens and pose are used.
  3. Only the moved check (ADR-663 Amd 3), and only with a ≥ 1 mm surround shift and a good match, can notice.
- **Evidence:** READ. Not run: no second unit.
- **Severity:** P3. It needs two units of one model, and the moved-check toast usually speaks.
- **Refuter:** PLAUSIBLE, P3 kept.
  - **READ on main.**
    - The four fixed candidates are in both copies: `electron/camera-frame-proxy.ts:32-37` and `web-camera.ts`.
    - `networkIdentity` builds the identity from the URL and the query fingerprint, and `modelBelongsTo` (`saved-cameras.ts:36-44`) compares only kind, id and fingerprint, so no per-unit fact exists.
  - **Not verified on hardware:** that every A1 Pro answers at the same RNDIS address.
  - **The reach is narrower than stated.**
    - The calibration lives on the machine profile, so a second unit saved as its own machine has no calibration to borrow.
    - It needs two units on one machine entry, or a replaced unit.
  - **Correction.** The moved check says nothing on a poor match (`moved-check.ts:5-6`). A second unit's different surround may therefore not toast either.
- **Fix direction:** Add a per-unit fact to the network binding: the controller's serial or banner if the vendor command set exposes one, or the camera's own reported id. Alternatively, run the moved check before the first overlay on every connect and refuse a strong mismatch.

## KNOWN (re-observed, not raised again)

- **H1-P1-1.** Engrave target and the nudge ring compile through `transientMachineSnapshot`. The file is unchanged on origin/main, so the fix card stands.
- **H2-P1-1.** Start from line drops the Print-and-Cut registration. Camera-found marks are included, since they feed the same session.
- **G6-P3-1.** The after-job refresh re-shows and re-latches a hidden overlay. It is the opposite of H6-P1-1, and both should be fixed together around one "picture is drawn" signal.
- **12-P3-3.** A dead machine-JPEG poll blanks the overlay silently (`CameraSourceView.tsx`, unchanged on main).
- **12-P3-4.** A frozen still survives Open and recalibration.
- **12-P3-5.** The camera fields in the Start snapshot. `cameraConfirmedPositionEpoch` and `cameraPlacementGeometryIssue` are still unread, so **Confirm bed coordinates** (`OverlayControls.tsx:223-232`) changes only the status colour.
- **Fixed on main and confirmed by reading:**
  - G6-P2-1: the canvas target is stamped at the framed Start (`canvas-target-burn.ts`);
  - G6-P2-3: the bed picture's frame and machine (`bed-picture-frame.ts`);
  - G6-P2-2: the notice;
  - G6-P3-3: the nudge advice;
  - G7-P3-1: the remote board gate.
- *Refuter check of the KNOWN items:*
  - **Unchanged on main:** `transient-camera-job.ts` and `CameraSourceView.tsx`.
  - **Still unread:** `cameraConfirmedPositionEpoch` and `cameraPlacementGeometryIssue`. `git grep` on main finds only `start-machine-snapshot.ts` and `transient-camera-job.ts`.
  - **The IDs exist:**
    - 12-P3-3, 12-P3-4 and 12-P3-5 in `2026-10-21-rolling-v2/12-camera.md`;
    - G6-P3-1 in G6;
    - H2-P1-1 in H2.
  - **The fixes are on main.** The #1463 and #1460 commit titles name exactly G6-P2-1, G6-P2-2, G6-P2-3, G6-P3-3 and G7-P3-1.

## Refuted

The refuter refuted none of the six raised findings. H6-P3-3 stays PLAUSIBLE.

Candidates the auditor dropped:

- **Fixture templates ignore the origin in their basis** (`fixtureBasis` keys profile and bed size only). An origin change refuses the model, so the review always shows "The current camera context is unavailable…" or "No camera context was recorded…". The apply also needs the "reviewed" tick.
- **A trace dialog or Print-and-Cut proposal keeps its picture after a later height change.** Each is a snapshot that was correct at its capture height. In-flight captures do retire (`use-camera-trace-lifetime.ts:24-48`).
- **The jig conflicts with camera placement.** Following the camera advice (Absolute) burns box and artwork at their scene positions together. In User Origin both anchor to the box (`prepare-output.ts:409-410`), so they stay consistent either way.
- **With no camera running, the newest calibration (possibly another camera's) draws a held still.** `cameraModelForFrame` refuses a still whose capture binding names another camera (`camera-model-frame.ts:26-33`).
- **Electron and browser exchange calibrations wrongly.** A USB `deviceId` and the network identity key are per app, so the other app gets "belongs to a different camera" or "cannot be verified": a refusal, not a misplacement.
- **Run again re-burns a camera-placed job after the picture was refreshed.** Run again replays the receipt-bound job (`start-job-flow.ts:100, 215-223`). A refresh changes no scene position.

## Verified clean

- **The model is read the same way everywhere.** Every placement consumer gets it through `activeCameraModel`, then `modelInBedFrame`, then `cameraModelForFrame`. That covers the overlay, trace, Find pieces, fixtures, Print and Cut marks and the head camera. The binding check runs on every captured frame.
- **Trace, Find pieces and Print and Cut marks retire in-flight work.** This happens on a document, camera, model-identity, height, area or bed-size change. A head camera's model identity is per head position (`active-camera-model.ts:46-60`), so a head that moves mid-capture retires the capture. A completed piece scan is retired too.
- **Print and Cut camera marks are tied to the frame.** They are keyed on `trustedPositionEpoch`, `nativeBedCaptureFrameKey` and the profile, carry their own Start-from warning, and are withheld from CNC.
- **The head camera needs a verified native frame for its head position, as Move laser here does.** Capture settles at Idle within 0.1 mm and uses the second of two frames. Refresh, Alt+C and the after-job refresh refuse a head camera.
- **#1463 holds on its own paths:**
  - the canvas target is stamped on `completedFrameRunOwner` at stream start for a framed Absolute Start (`laser-job-actions.ts`, main);
  - the bed and burn-check pictures carry `taken`;
  - an origin change or another machine clears them, with a notice.
- **The repro's other numbers held.** The Absolute compile of the camera-placed square on the A1 Pro profile lands where the picture shows it (X200–220 Y98–118 for scene Y150–170 on the 268 mm bed).

## Not verified

- **Hardware.** No camera or machine was used. Where the Falcon A1 Pro's camera is mounted (ADR-446 calls it a lid camera) and whether a unit homes itself at power-on were not checked.
- **Rotary with camera placement.** No camera code reads `rotary`. An Absolute rotary job scales Y (`rotary-job.ts`), so artwork placed on the picture of a cylinder would not burn where shown. This was not run.
- **CNC mode.** The laser-fitted calibration is used for CNC placement. Print and Cut is withheld from CNC because "a spindle sits at another offset" (`print-cut-output.ts:11-14`), but KerfDesk models no laser-to-spindle offset anywhere. Not raised.
- **A head camera on a network source.** Trace, Find pieces and Print-and-Cut marks take a single frame with no settle. Head capture takes the second of two for exactly this reason. The window is narrow, because the lifetime check retires on any head move, and it was not run.
- **Phone and MCP Job Review parity for the camera warning.** That is H8's area. They share `machineSnapshot`, so H6-P1-1 applies to them as well.
- **The fixture-reuse sibling of H6-P1-1 and the canvas badge texts** were read, not rendered.

```json
[
  {"id":"H6-P1-1","severity":"P1","area":"camera-placement","file":"src/ui/camera/use-camera-placement-controls.ts","line":34,"anchor":"Contract: ADR-228 Amd 1 Decision (warning while camera placement is active and Start from is not Absolute) and Context ('Only the Frame shows this'); Twin: ADR-663 Amd 1 Alt+C/Refresh latch placement, the auto-start shows the picture 'without opening the panel' and latches nothing","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-h6r-autostart: real installCameraHelpers + fake bridge, real Falcon A1 Pro profile with a 358x268 framed calibration, mounted WorkspaceCameraOverlay: panelOpen false, overlayVisible true, model active, placementActive false; real machineSnapshot + prepareStartJob at User Origin WCO (15,25): work X0..20 Y0..20 with only UNKNOWN_NATIVE_BED_MESSAGE + S1000 note; Absolute compile reaches X220 Y118; latched -> camera warning). READ main: autoStart default true, App.tsx:162, four latch writers, createProject user-origin for homing off, badge says only Relative view. #1463 adds helpers beside the latch, not to it. P1 kept: no warning names the camera mismatch (METHOD 3, 2026-10-23/27)","known":false,"summary":"The placement latch is set only by the Camera panel's effect, Refresh/Alt+C and Trace; a calibrated camera started by the helpers draws the bed on the canvas with placementActive false, so Job Review omits the camera Start-from warning. On the shipped Falcon A1 Pro profile (homing off, default User Origin) a square placed on the picture at X200-220 Y98-118 burned at X15-35 Y25-45 (199 mm away) with only the generic unverified-mapping text; opening the panel once latches and the warning appears"},
  {"id":"H6-P1-2","severity":"P1","area":"camera-placement","file":"src/ui/camera/head/head-capture-store.ts","line":266,"anchor":"Contract: WORKFLOW F-CAM3 'The overlay shows each area at its own height', ADR-449 Decision 2 (height areas follow the head); Twin: live overlay/trace warp with heightAreas and re-project at the height set now, piece scans retire on height/area change","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-h6r-stitch, independent geometry: 60 mm head camera fx500 640x360, ray-cast frames via bedMapper, real stitchHeadCameraPictures/warpFrameToBedImage): 20 mm box on 3 mm sheet stitched 6.72 mm off vs 0.00 with the area; 6 mm sheet captured at 0 is 1.75 mm off vs 0.00 at 6. READ main: StitchOptions has no heightAreas, showPictures passes none, BedPicture.surfaceHeightMm unread, bedPictureNow checks frame/machine only, no height notice. ADR-449 Decision 2 is about the model following the head; A rests on F-CAM3 + Raised objects offered for a head camera + twins. P1 kept; B alone is also P1 (ADR duty never reaches the operator)","known":false,"summary":"stitchHeadCameraPictures gets no heightAreas and the stored BedPicture.surfaceHeightMm is never read; a mark on a 20 mm box (area set, sheet 3 mm) is drawn 6.49 mm off while the live warp with the area is exact, and a picture captured at 0 mm stays 1.85 mm off after Material height is set to 6 mm, with no notice (main unchanged apart from the frame fix)"},
  {"id":"H6-P2-1","severity":"P1","area":"camera-placement","file":"src/core/camera/model/head-camera.ts","line":45,"anchor":"Twin: head XY followed live (ADR-449 Decision 2), Z never recorded (mount is Vec2); Contract: ADR-449 Consequences 'after changing Z, return it there or calibrate again', said nowhere in the UI or WORKFLOW F-CAM12","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-h6r-stitch): camera raised 6 mm, sheet 0: live warp 1.43 mm off at 15.8 mm from axis (control 0.00); autofocus case (6 mm sheet, head +6) with Material height set to 6 as the tooltip asks: 1.64 mm off, left at 0: 0.00. READ main: CameraMount is Vec2, headPositionOnBed XY, the Z rule is only in ADR-449 lines 65-66. Severity P2 -> P1: wrong position, reachable (autofocus/Z jog), and an ADR-only operator duty is not a warning that reaches the operator (METHOD 3, 2026-10-23)","known":false,"summary":"A head camera's calibration records only the head's XY; after autofocus or a Z move of 6 mm the live overlay draws a mark 1.51 mm off at 19 mm from the lens axis (about 3 mm at the usable edge), affecting overlay, trace, Find pieces and captures, and nothing tells the operator"},
  {"id":"H6-P3-1","severity":"P3","area":"camera-placement","file":"src/ui/camera/OverlayControls.tsx","line":35,"anchor":"Twin: ADR-663 Amd 3 moved warning toasts when the panel is closed; ADR-441 Amd 5 unverified-frame note and ADR-440 Amd 1 moved note are panel-only","evidence":"READ","verdict":"CONFIRMED","refuter":"READ main (cameraBedFrameNote readers: OverlayControls.tsx:35, CalibrateCameraControls.tsx:23, nudge-actions.ts:141, all in the panel) + the H6-P1-1 repro (overlay drawn with the panel closed). P3 kept for a corrected reason: the moved check does not cover an unhomed calibration, but HOME_BEFORE_TARGET_NOTE names this exact consequence before the target burn; the moved half is information only","known":false,"summary":"useOwnCameraFrameNote is read only inside the Camera panel, so the auto-started overlay shows a calibration made before homing (or moved to a new bed) without its 'home and calibrate again' / 'moves its picture N mm' note, while the moved check toasts when the panel is closed"},
  {"id":"H6-P3-2","severity":"P2","area":"camera-placement","file":"src/ui/laser/start-job-readiness-policy.ts","line":92,"anchor":"Twin: camera Start-from advice vs Place Board placement contract (ADR-654 Decisions 3 and 5: outline centred, User Origin front-left with G92)","evidence":"READ","verdict":"CONFIRMED","refuter":"READ (two lines): the policy fires for any latched job that is not Absolute (main :86-93); board-capture-actions centres the outline and sets User Origin; no captured-board plus Absolute guard in Start or Job Review. The latch is sticky (G6-P3-1), and latched with the picture hidden is a designed state. Severity P3 -> P2 per M6-P2-2: reachable advice that, when followed, burns off the board; not P1 because the operator changes the mode on accurate wording","known":false,"summary":"With camera placement latched, a Place Board job gets 'Choose Absolute Coordinates to burn it where it is placed', which would burn the artwork at the centred canvas outline, off the registered board"},
  {"id":"H6-P3-3","severity":"P3","area":"camera-placement","file":"src/ui/camera/frame-source.ts","line":61,"anchor":"Twin: ADR-446 each calibration bound to its own camera; USB binds a deviceId, the Falcon network camera only a fixed RNDIS URL plus an app-local HMAC of its query","evidence":"READ","verdict":"PLAUSIBLE","refuter":"READ main: four fixed candidate URLs in both copies, and the identity is URL + query fingerprint (modelBelongsTo) with no per-unit fact. Not verified on hardware that every unit shares the address. Reach needs two units on one machine entry or a replaced unit. The moved check is silent on a poor match (moved-check.ts:5-6), so it may not catch it either. P3 kept","known":false,"summary":"Every Falcon A1 Pro camera answers at http://192.168.10.1:8080/media/getCapturePhoto, so a second unit or a replacement on the same PC and profile silently binds the first unit's lens and pose; only the moved check can notice"}
]
```
