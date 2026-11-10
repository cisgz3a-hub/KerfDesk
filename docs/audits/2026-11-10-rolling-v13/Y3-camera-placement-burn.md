# Rolling audit v13 — Y3 Camera placement and burn

- **When:** 2026-11-10, 09:25–10:05 +0800   **Tree:** origin/main @ `bf841ff5e`. Repros ran on a mutable copy of the scratchpad export `j20-main` (`bf841ff5e`, `node_modules` a junction), in scratchpad `zz-y3\tree`, plus Node scripts in `zz-y3\`.
  - origin/main has since moved to `b43187780` (#1680, camera-moved check, ADR-663 Amd 5). That merge touches `start-job-readiness-policy.ts` and `start-machine-snapshot.ts` only to add the camera-moved warning to Job Review (KNOWN status below). It does not change the code behind any finding here.
- **Scope:** end-to-end camera placement measured in mm against a known object, from the overlay to the G-code; the camera target and canvas target (ADR-440 Amd 7, ADR-441 Amd 5); camera Print and Cut (ADR-443 + Amds 1, 2); the head camera (ADR-449 + Amd 2, ADR-375 Amd 1); camera placement on a rotary (ADR-228 Amds 1, 2) with the new A/Z axis (ADR-695) and surface feed (ADR-127 Amd 2); Start-route parity for the camera warnings.
  - Code read: `src/ui/camera/{active-camera-model,camera-bed-frame-now,camera-placement-latch,capture-overlay-still}.ts`, `src/ui/camera/overlay/bed-overlay-shader.ts`, `src/ui/camera/head/head-position.ts`, `src/ui/camera/pieces/scan-bed-pieces.ts`, `src/ui/camera/calibrate/{calibration-actions,canvas-target-burn,assumed-target,transient-camera-job,engraved-target-memory}.ts`, `src/core/camera/model/{camera-model,camera-bed-frame,head-camera,bed-image}.ts`, `src/core/camera/marks/{find-marks,match-mark-pair}.ts`, `src/core/camera/pieces/{find-pieces,piece-components,piece-placements}.ts`, `src/ui/laser/{start-job-readiness,start-job-readiness-policy,start-machine-snapshot,start-job-source,print-cut-camera,print-cut-output,print-cut-frame-warnings}.ts`, `src/ui/job-placement.ts`, `src/ui/state/{native-bed-frame,camera-store,print-cut-session-store}.ts`, `src/core/devices/{origin-transform,native-bed-frame,rotary-axis}.ts`, `src/core/registration/*`.
- **Lenses run:**
  - **L1 (measurement):** placement error in mm. A camera with a known, **correct** calibration: the saved record is the truth camera, expressed in the bed frame its rings were engraved in. A Ø40 mm coaster, 4 mm tall, is rendered at known physical bed positions (3 × 3 supersampled). Placement then runs two ways, both with the real code:
    - by eye: the coaster's centroid on the canvas as the overlay's CPU mirror of the GPU shader draws it (`bedOverlayCompositeCoord`, 4 px/mm);
    - with the real Find pieces (`scanBedPieces`).
    An asymmetric 30 mm flag is centred there. The real `prepareStartJob` compiles it against a real `machineSnapshot` of a homed, connected controller. The burn moves (laser on, S > 0) are parsed from the G-code and mapped back to the physical bed: work + WCO → native → bed through the **calibration's** frame.
  - **L3 (twins):**
    - overlay against Find pieces;
    - burn centroid against the coaster;
    - burn vertices against the scene geometry;
    - Frame rectangle against the burn's box;
    - Engrave target (transient) against the canvas target;
    - the rotary advice against the bytes each Start from emits.
  - **L4 (state):** Start from switched after Add target to canvas; G54 offsets; WPos reports; a re-home; a Z move; a bed-size correction after calibration; another origin corner.
  - **L9 (parity):** the routes that build the camera warnings (canvas Start, Job Review, phone/MCP, restart, Engrave target).
  - **L12:** CI of the camera-placement merges since v11.
  - Not run: no browser and no simulated controller stream. The Start preparation was called directly; see Not verified.
- **Cameras:** synthetic only. Two lens models:
  - Y3's own pinhole + Kannala–Brandt render (`y3-lib.ts`);
  - Y1's independent Brown–Conrady truth camera (`truth.mts`, copied) for the one repro that runs the real calibration.
  No real camera, network, ffmpeg or hardware was used.
- **Memory gates:**
  - Vitest ran 4 times, at 3.09, 1.93, 3.24 and 2.85 GB free, one worker each.
  - One Vitest attempt found 1.10 GB free, below the gate. It was not started, and the same file ran later at 3.24 GB.
  - Node scripts ran at 1.2–1.5 GB free. The gates apply to Vitest and browsers only.
- **Counts:** 4 raised → refuter pending → P1 2 / P2 1 / P3 1 (+ 9 KNOWN re-checked).

## Headline

**With a correct calibration, flat-bed placement is exact through the whole pipeline.** Across 64 grid points, 7 named positions and every variation below, the burn landed within **0.02 mm** of the coaster (Find pieces within 0.05 mm), and the burned outline matched the placed geometry to 0.00 mm. The variations were:
- 5 origin corners, stock and force-origin GRBL;
- the Falcon A1 Pro's vendor frame (CoreXY);
- a G54 offset under Absolute;
- rotate, mirror and scale of the artwork;
- a bed-size correction after calibration.

The Frame rectangle sat on the burn's box (0.00 mm). Kerf, fill overscan and lead-ins behave as designed. There is no sign flip, Y inversion or half-pixel shift anywhere in overlay → scene → G-code. The head camera is also exact after a jog, with WPos reports, after an origin change and after a re-home, and it is refused after a 0.5 mm Z move (ADR-449 Amd 2). Engrave target puts every ring exactly where the calibration will look for it: 35 of 35 at 0.00 mm, so H1-P1-1 stays fixed.

**Two placement routes lose the camera's position with no warning that says so:**
- **Y3-P1-1. On a rotary, the camera advice sends the burn away from where the picture shows it.**
  - Current Position (the advised mode) re-centres X on the head. Artwork placed at X 110–130 burned at X 190–210, **80 mm along the cylinder**, while the advice says "the camera picture places the artwork … along the cylinder".
  - On the new A and Z rotaries (ADR-695), Absolute starts from `G92 A0` at the face under the laser and keeps the picture's X. The advice warns against it with a claim that no longer holds ("turns the cylinder back so the job starts at work Y 0").
- **Y3-P1-2. A canvas target burned from Current Position or User Origin is calibrated as if it burned at Absolute.**
  - The rings landed 50–156 mm from the layout.
  - The code sees this: `stampCanvasTargetBurn` returns false. Yet the photo step labels the rings from the layout with no refusal, the calibration grades "Accurate enough for placing artwork by eye" (0.04–0.06 mm), and every later placement is off by the whole offset (**3.6, 14.2 and 70.7 mm** for ring shifts of 3,−2 / 10,−10 / 50,−50 mm).
  - On a first calibration nothing warns at all.

**Camera Print and Cut is accurate to 0.06 mm up to an 89° turn**, but a sheet turned 95°, 135° or **180° (upside down)** has its two marks paired the wrong way round. The dialog reports "turned −85.0°", "−45.0°" or "0.0°", the unusual-registration check (ADR-443 Amd 1) never fires, and the cut lands **128 mm (mean) / 217 mm (max)** from the print (Y3-P2-1). A missing mark and a print scaled past 2 % are refused with clear messages.

Smaller: the Print-and-Cut warning for a non-Absolute Start from does not say that camera-found marks lose the print (Y3-P3-1).

## Placement accuracy table

Error = burn centroid (G-code parsed, mapped to the physical bed) − coaster centre, in mm. "Placed" = where the real overlay mirror shows the coaster's centre (and, where run, Find pieces). The camera is 1280 × 960, f 880, 560 mm above the bed, with mild KB distortion; the coaster is 4 mm tall and Material height is set to 4 mm. Source: `out/a-placement.json`, `out/a11-head.json`.

| Case | Centre | Edges (L / R / back / front) | Corners | Whole bed (grid) | Burned outline vs placed | Frame vs burn box | Camera warning |
|---|---|---|---|---|---|---|---|
| Absolute, front-left 400 × 400, stock GRBL `$23=0` (negative space), overlay | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.01 / 0.00 | 64 pts, max **0.02** | 0.00 | 0.00 | none (correct) |
| same, Find pieces | 0.01 | 0.01 / 0.02 / 0.05 / 0.04 | 0.03 / 0.05 | — | — | — | — |
| Absolute with a G54 set (WCO 37, −22) | 0.01 | 0.00 / 0.00 | — | — | 0.00 | 0.00 | none |
| Current Position, head at 120, 300 (centre anchor) | **129.2** (−80.8, +100.8) | — | — | — | — | 0.00 | yes, flat-bed advice (ADR-228 Amd 1) |
| Current Position, head jogged over the coaster | 1.18 (box centre vs length centroid of the flag: by design) | — | — | — | — | 0.00 | yes |
| User Origin at 80, 320 (front-left anchor) | **149.7** | — | — | — | — | 0.00 | yes |
| Verified Origin, same origin | **149.7** | — | — | — | — | 0.00 | yes |
| Rotate 30° / mirror X / mirror Y / scale 1.5 / rotate 135° + mirror + 0.7 | 0.01 each | — | — | — | 0.00 each | 0.00 | none |
| Origin front-right / rear-left / rear-right / centre (force-origin) | 0.00–0.02 | — | — | — | 0.00 | 0.00 | none |
| Origin front-right / rear-left / rear-right (stock) | 0.02 | — | — | — | 0.00 | 0.00 | none |
| Falcon A1 Pro (grblHAL, vendor frame, CoreXY), overlay and pieces | 0.01 | — | 0.00 / 0.01 | — | 0.00 | 0.00 | none |
| Fill layer (scanline, overscan) | 0.57 (fill centroid vs outline centroid; end points within 0.16) | — | — | — | 0.16 | 0.00 | none |
| Kerf +0.3 mm | 0.03 | — | — | — | 0.42 (= 0.3·√2 at the corners, as set) | 0.00 | none |
| Lead-in on | 0.36 (lead length counted) | — | — | — | 0.00 | 0.11 | none |
| Bed corrected 400 × 400 → 400 × 410 after calibration (model moved, ADR-440 Amd 1) | 0.01 | — | — | — | 0.00 | 0.00 | none |
| Head camera (640 × 480, 70 mm up, 35 / −25 mm beside the beam): at calibration; jogged to 100, 300 and 320, 60 | 0.00 | — | — | — | — | — | — |
| Head camera: WPos reports; origin changed (WCO −150, −120) with MPos, WPos+WCO, WPos with cached WCO; re-homed | 0.00 each | — | — | — | — | — | — |
| Head camera: Z moved 0.5 mm | refused (no overlay), as ADR-449 Amd 2 | | | | | | |
| Overlay at Material height 0, coaster 4 mm / 20 mm tall (operator setting; `a-height.out.jsonl`) | 0.31 / 1.59 | — | — | max 2.11 / 10.85 | — | — | — (the field is in the panel) |
| **Y rotary, Current Position (advised), head at X 200** | **X burned 190–210 vs placed 110–130: 80 mm along the cylinder** | | | | | | rotary advice: "Keep Current Position" (Y3-P1-1) |
| **A or Z rotary, Current Position (advised)** | **same 80 mm in X**; turn centred on the current face | | | | | | same |
| A or Z rotary, Absolute (warned against) | X 110–130, as placed; `G92 A0` / `G92 Z0`, turn 0–38.2 from the current face | | | | | | "Absolute turns the cylinder back … work Y 0" (false on A/Z) |
| **Canvas target burned from Current Position, then calibrated** | every later placement off by the ring offset: **3.6 / 14.2 / 70.7 mm** for ring shifts 3,−2 / 10,−10 / 50,−50 | | | | | | none on a first calibration (Y3-P1-2) |
| Camera Print and Cut, sheet offset ≤ 20 mm, turn 0–89°, print ±1 % | cut vs print **0.02–0.06** | | | | | | — |
| **Camera Print and Cut, sheet turned 95° / 135° / 180°** | **cut vs print 128.6 mean / 217.2 max** | | | | | | none; dialog says "turned −85.0° / −45.0° / 0.0°" (Y3-P2-1) |

## Findings

### Y3-P1-1 — On a rotary, the camera advice sends the burn away from the camera picture: Current Position re-centres X on the head, and on an A or Z rotary the advice warns off Absolute, the one mode that burns where the picture shows

- **Where (bf841ff5e):**
  - `src/ui/laser/start-job-readiness-policy.ts`:
    - `:144`: any active rotary gets the rotary wording, whatever its axis.
    - `:157-170` (`ROTARY_CAMERA_LEAD`, `rotaryCameraWarning`):
      - "On a rotary the camera picture places the artwork only along the cylinder".
      - At Absolute: "Absolute turns the cylinder back so the job starts at work Y 0, not on the face under the laser … Choose Current Position (or User Origin)".
      - At a placed mode: "Keep Current Position, and do not choose Absolute Coordinates".
  - `src/core/devices/rotary-axis.ts` header and `src/core/job/rotary-transform.ts:45-57` (`zeroAtAnchor`): on A or Z, every job starts with `G92 A0` (or `Z0`) at the current turn.
- **Anchor:**
  - **Contract:**
    - ADR-228 Amd 2, Decision 2: the advice "says the camera picture places the artwork only along the cylinder"; its Consequences: "A rotary operator who follows Job Review keeps the turn they set up".
    - ADR-695, Decision 5: "every job and every Frame on A or Z starts with `G92 A0` … An Absolute job's lowest edge maps to 0". Absolute on A/Z therefore starts on the face under the laser.
  - **Twin (L3):** the advice text against the X and turn each Start from emits.
  - **Measurement:** the burned X range against the X where the artwork sits on the camera picture.
- **Scenario:**
  1. A glass sits in the chuck. The maker places a 20 mm logo on the camera picture over the glass at X 110–130. The head is parked at X 200, near the chuck end.
  2. Job Review at Absolute says to choose Current Position. At Current Position it says "the camera picture places the artwork only along the cylinder … Keep Current Position".
  3. The job burns at **X 190–210**, 80 mm along the glass from where the picture showed it (Y, A and Z rotaries alike).
  4. On the A1 Pro's A-axis rotary (ADR-695 preset), Absolute would have burned at X 110–130, starting on the face under the laser. The advice calls that turning "back … to work Y 0". The physical Frame shows the move. The canvas Frame outline does not: it is surface-true (ADR-228 Amd 2, Context).
- **Evidence:** REPRO, `zz-y3/tree/src/zz-y3/y3-d-rotary.test.ts` → `zz-y3/out/d-rotary.json`. It runs the real `emitGcode` and `demotedPolicyWarnings` on Y, A (grblHAL, axis confirmed) and Z rotaries, chuck 360 / Ø60, square at X 110–130, head at work X 200 Y 80.

  | Rotary | Start from | Burn X | Turn | Advice says |
  |---|---|---|---|---|
  | Y | Absolute | 110–130 | Y 0–38.2 (rebased) | choose Current Position |
  | Y | Current Position | **190–210** | Y 60.9–99.1 (current turn) | keep it; the picture places X |
  | A | Absolute | **110–130** | `G92 A0`, A 0–38.2 (from the current face) | "turns the cylinder back … work Y 0", choose Current Position |
  | A | Current Position | **190–210** | A −19.1–19.1 | keep it |
  | Z | Absolute / Current Position | 110–130 / **190–210** | `G92 Z0`, from the current face | as for A |

  - #1671 (ADR-695) did not touch the camera wording or `start-job-rotary-camera-placement.test.ts`. Every rotary case in that test is a Y chuck, and its Current Position head X (120) equals the artwork's centre, which hides the X move.
- **Severity:** P1.
  - **For P1:**
    - The burn lands 80 mm from where the camera picture shows the artwork, with no warning that says so.
    - The text actively claims the picture keeps the position along the cylinder, and on A/Z it warns against the correct mode with a false reason.
    - The brief rates a burn away from the overlay by more than 1 mm with no warning P1. W4-P2-1, the same advice's earlier error, was P1 after its refuter.
  - **For P2:**
    - The advice ends "Watch the Frame", and the physical Frame traces the real X.
    - A rotary operator often jogs the head over the spot to engrave first (LightBurn's rotary guidance). Then Current Position's X is the head's and the picture matters little.
    - On a Y rotary no single Start from keeps both the picture's X and the current turn, so part of this is a wording gap.
- **Announced?** No. ADR-228 Amd 2 and ADR-695 both say the opposite: the picture keeps X, and nothing about camera use on A/Z.
- **Novelty:** new. W4-P2-1 (fixed by #1641) was the Absolute/turn half. X and the A/Z axis did not exist in its repro. v12 X8 was about the rotary engine, not camera advice.
- **Fix direction:**
  - Make the advice axis-aware. On A or Z with camera placement, Absolute keeps the picture's X and starts at the current face: do not warn against it. Say that the job's lowest edge (or its centre, if the anchor changes) starts at the face under the laser.
  - On Y, say what Current Position does to X: "the job is centred on the head along the cylinder too. Jog the head over the artwork on the camera picture first".
  - Better still, give camera placement a rotary mode that keeps X from the picture and the turn from the head.
  - Extend `start-job-rotary-camera-placement.test.ts` with an A and a Z rotary, and a head X away from the artwork.
- **Refuter:** PENDING.

### Y3-P1-2 — A canvas target burned from Current Position or User Origin is calibrated as if it burned at Absolute: graded "Accurate enough", every later placement off by the origin offset, and on a first calibration nothing warns

- **Where (bf841ff5e):**
  - `src/ui/camera/calibrate/canvas-target-burn.ts:45-47`: the code knows. "Only Absolute Coordinates burn the rings where the target put them": a Start from another mode is not stamped, and nothing else happens.
  - `src/ui/camera/calibrate/assumed-target.ts`:
    - `:71-87`: the photo step still uses the remembered layout (`source: 'engraved'`).
    - `:156-162`: it refuses only when the bed frame changed (`unseenBurnAfterChange`).
    - `:145-147`: the only trace is the description's wording, "added to the canvas" instead of "added to the canvas and engraved".
  - `src/ui/camera/calibrate/calibration-actions.ts:157-170`: Add target to canvas sets Absolute, but nothing keeps it there until the rings burn.
  - `src/ui/laser/start-job-readiness-policy.ts:137-146`: the Start-from camera warning needs the placement latch, which a first calibration cannot have, because there is no model yet.
- **Anchor:**
  - **Contract:**
    - ADR-441 Amd 5, Decision 3: the canvas target sets Start from to Absolute Coordinates, "the only mode that burns them where the photo looks".
    - ADR-440 Amd 1 / Amd 5: the calibration records the frame "its rings were placed in".
    - ADR-441 Amd 4, Decision 4: "The grade says what it measured".
  - **Measurement:** the ring offset in the G-code, and the overlay's true error after the real calibration.
- **Scenario:**
  1. A maker with a no-homing diode laser (default Start from: User Origin) or a homed one adds the target to the canvas. The toast says Start from is now Absolute.
  2. Out of habit they set Start from back to User Origin (or Current Position), set the origin at the sheet corner, Frame and Start. The rings burn 50 mm (User Origin) or 156 mm (Current Position) from the layout.
  3. At the photo step the wizard says it looks for "the target added to the canvas from this computer on …". It finds 35/35 rings and grades "Accurate enough for placing artwork by eye", average 0.04–0.06 mm.
  4. Every later camera placement, at Absolute as advised, burns the full ring offset away from the picture: 3.6 mm for a 3,−2 mm offset, 14.2 mm for 10,−10, and 70.7 mm for 50,−50.
  5. On a recalibration with the overlay latched, the only text is the generic "this job burns where Current Position puts it …". The next Check camera compares against the shifted rings and reports no drift.
- **Evidence:** REPRO.
  - `zz-y3/tree/src/zz-y3/y3-b-target.test.ts` → `zz-y3/out/b-target.json`. It runs the real `addCalibrationTargetToCanvas`, `setJobPlacement`, `prepareCurrentStartJob`, `stampCanvasTargetBurn` and `currentAssumedTarget`, on homed stock GRBL with the head at 300, 80.
    - At Absolute: stamped, and the burn sits on the layout.
    - At Current Position: rings +100.0, −120.0 mm off, not stamped, `source: 'engraved'`, `refusal: null`, no camera warning.
    - At User Origin (WCO −150, −150): +50.0, −50.0 mm, not stamped, no refusal, and only the two generic fill warnings.
  - `zz-y3/b-cal.mts` → `zz-y3/b-cal.out.jsonl`. Y1's independent Brown–Conrady renderer (a mild-barrel 720p webcam) photographs rings shifted by the offset. The real `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade` labels them from the layout:

    | Ring shift (mm) | Found | RMS / worst ring | Grade | True overlay error, centre / corners |
    |---|---|---|---|---|
    | 0, 0 (control) | 35/35 | 0.039 / 0.123 | good | 0.04 / 0.06–0.24 |
    | 3, −2 | 35/35 | 0.055 / 0.121 | good | **3.64 / 3.61–3.63** |
    | 10, −10 | 35/35 | 0.049 / 0.128 | good | **14.17 / 14.09–14.19** |
    | 50, −50 | 35/35 | 0.040 / 0.106 | good | **70.74 / 70.67–70.80** |

  - A pure translation of the rings is absorbed exactly by the pose, so no in-sample figure can show it.
- **Severity:** P1.
  - **For P1:**
    - Every camera job after this calibration burns the full offset (mm to tens of mm) from the picture.
    - The grade claims 0.05 mm.
    - On a first calibration nothing warns, and Check camera later confirms the wrong calibration.
    - The code already detects the condition (`stampCanvasTargetBurn` returns false) and drops it.
    - Brief rule: more than 1 mm from the overlay with no warning.
  - **For P2:**
    - It needs the operator to change Start from after the app set Absolute and said so in a toast.
    - With a large offset, the camera picture visibly misaligns with the canvas bed outline (a visible result is not a warning, METHOD §3).
    - Engrave target, the guided path, forces Absolute and is unaffected.
- **Announced?** No. Amd 5 says Absolute is the only mode that works, but nothing enforces or says it when the rings burn otherwise. The photo step's "added to the canvas" (without "and engraved") is the only trace.
- **Novelty:** new. G6-P2-1 (v3) fixed the frame stamp for an Absolute canvas burn. The non-Absolute burn path was not covered.
- **Fix direction:**
  - When a Start streams the canvas rings from a mode other than Absolute, either warn in Job Review ("these are the camera target's rings; they burn where the photo looks only at Absolute Coordinates") or record the job origin used, so the photo step can relabel the rings or refuse.
  - At the photo step, refuse or warn for a canvas target whose burn was never seen (`burnSeen !== true`). Say "KerfDesk did not see this target burn at Absolute Coordinates".
  - Add the Current Position and User Origin cases to `canvas-target-burn.test.ts` and `assumed-target.test.ts`.
- **Refuter:** PENDING.

### Y3-P2-1 — Camera Print and Cut on a sheet turned more than 90° (upside down included) pairs the marks the wrong way round; the dialog reports a small turn, the unusual check never fires, and the cut lands 128 mm (mean) / 217 mm (max) off the print

- **Where (bf841ff5e):**
  - `src/core/camera/marks/match-mark-pair.ts:52-61`: the pair whose marks lie nearest the design's targets wins, "which also picks which mark is target 1". Past a quarter turn, the reversed order is the nearer one.
  - `src/core/registration/registration-check.ts:27` (`SWAPPED_TURN_DEG = 135`): only a registered turn of 135° or more is unusual, and the camera's swapped pair always registers under 90°.
  - `src/ui/laser/print-cut-camera.ts:129-150` (`markPairMessage`) reports that turn.
- **Anchor:**
  - **Contract:** ADR-443 Amd 1 (title and Decision 4): "A registration that looks like a capture mistake is shown, never silent". Its Context names the targets captured in swapped order (turned 180°) as a silent failure to fix. Decision 4 notes that "a sheet laid upside down is possible". ADR-443 Decision 2 says nearest-pair picks target 1.
  - **Measurement:** the cut outline's vertices against the printed outline, on the bed.
- **Scenario:**
  1. A maker prints stickers with two registration rings and lays the sheet on the bed upside down (rotated 180°), or in the other portrait/landscape orientation turned the wrong way (95°–135°).
  2. Find marks with camera fills both points and reports "found both marks 322.1 mm apart … turned 0.0°" (or −85.0°, or −45.0°).
  3. Apply registration raises no "Use this registration anyway" tick, and Job Review shows no unusual-registration line.
  4. The cut runs its outline unrotated (or turned the wrong way) over the sheet: up to 217 mm from the printed artwork.
- **Evidence:** REPRO, `zz-y3/c-printcut.mts` → `zz-y3/c-printcut.out.jsonl`. It renders an A4 sheet on 0.2 mm paper, with two 8 mm rings 322 mm apart and an asymmetric "F", through a correctly calibrated 1280 × 960 camera. It then runs the real `locatePrintCutMarks`, `solveTwoPointRegistration` and `registrationFigures`.

  | Sheet | Marks found | Registered turn | Cut vs print, mean / max (mm) | Unusual? |
  |---|---|---|---|---|
  | offset 12, −7; turn 0 / 3° / 15° | yes | 0.0 / 2.99 / 14.99 | 0.02–0.04 / 0.04–0.06 | no (correct) |
  | print +1 %, turn 2° | yes (scale 1.0101) | 2.01 | 0.03 / 0.04 | no (correct) |
  | turn 60° / 89° | yes | 60.01 / 89.0 | 0.02 / 0.02–0.03 | no (correct) |
  | **turn 95°** | **swapped** | **−85.0** | **128.6 / 217.2** | **no** |
  | **turn 135°** | **swapped** | **−45.0** | **128.6 / 217.2** | **no** |
  | **turn 180° (upside down)** | **swapped** | **0.0** | **128.6 / 217.2** | **no** |
  | second mark covered | none: "found 1 mark-like shape …" | — | — | refused, clear |
  | print +2.5 % | none: "… within 2 %" | — | — | refused, clear |

  - The cut-vs-print figure applies the solved transform to the outline, as `applySimilarityProject` does. The Absolute compile after it was measured exact in part A (0.00 mm).
- **Severity:** P2.
  - **For P1:**
    - The cut lands far off the print, and the dialog states a turn that is plainly wrong for a sheet visibly upside down in the picture.
    - Amd 1 made exactly this case loud for head captures, and here it is silent. Brief rule: more than 1 mm with no warning.
  - **For P2:**
    - Two identical marks cannot encode orientation, so this is inherent to two-mark registration, as in LightBurn.
    - A sheet turned more than 90° from the design is an operator mistake.
    - The Frame traces the cut outline, which will sit visibly away from the printed artwork.
  - **Against P2:** within ±89° (normal placement) it is accurate to 0.06 mm.
- **Announced?** Partly. ADR-443 D2 says the nearest pair decides target 1. That a sheet turned more than 90° is then cut wrongly, and that Amd 1's check cannot see it, is not said.
- **Novelty:** new. ADR-443 Amd 1 (I-4) covered head captures only. No camera case past 15° in `find-marks.test.ts` was found.
- **Fix direction:**
  - Disambiguate with the print itself: correlate the flattened picture against the design's own printed artwork for both pairings and pick the better match. Or support a third mark, or an asymmetric mark.
  - At least, when the found pair's turn is beyond ±60° (where a swap becomes plausible), ask the operator to confirm the sheet's orientation, the way Amd 1 asks for unusual head captures.
- **Refuter:** PENDING.

### Y3-P3-1 — The Print-and-Cut warning for a non-Absolute Start from does not say that camera-found marks then miss the print

- **Where (bf841ff5e):**
  - `src/ui/laser/print-cut-frame-warnings.ts:9-10,22-24`: "Print-and-Cut registration and job-origin placement are both active. The physical Frame traces the combined transform; confirm the traced position before continuing."
  - The camera points carry `coordinateBasis: 'bed'` (`print-cut-session-store.ts:59-60`). A Start from other than Absolute moves the registered job to the origin or head, so the cut moves off the print.
  - The camera Start-from warning (`start-job-readiness-policy.ts:137-151`) appears only while the overlay latch is set. It is not set when the overlay was hidden before Find marks.
- **Anchor:**
  - **Contract:** ADR-443 Decision 4 (a camera point is a bed point).
  - **Twin:** ADR-228 Amd 1's camera advice names the cause ("burns where … puts it, not where the artwork sits on the camera picture") and the fix (Absolute). The Print-and-Cut warning names neither.
- **Scenario:** Print and Cut with camera-found marks, Start from left at User Origin. Job Review says only "confirm the traced position".
- **Evidence:** READ. Part A measured that User Origin moves a placed job by the origin offset (149.7 mm at origin 80, 320).
- **Severity:** P3, wording. A warning exists and the Frame shows the move.
- **Announced?** No. **Novelty:** new.
- **Fix direction:** when either captured point has `bed` basis (camera, or head with the bed mapping) and Start from is not Absolute, say: "The marks were found on the bed, so the cut lines up with the print only at Absolute Coordinates."
- **Refuter:** PENDING.

## KNOWN: status on `bf841ff5e` (and `b43187780` where noted)

| ID | Was | Status | Evidence |
|---|---|---|---|
| H1-P1-1 (v4, ADR-440 Amd 7) | Engrave target compiled without Start's snapshot | **Fixed, measured** | `b-target.json` B1: 35/35 rings at 0.00 mm from the layout on stock GRBL `$23=0`; `transient-camera-job.ts:56-66` |
| W4-P2-1 (v11, ADR-228 Amd 2) | Rotary camera advice said Absolute | **Fixed for the turn on Y** (#1641). X and A/Z are new: Y3-P1-1 | `d-rotary.json` |
| 12-P2-2 (v2, ADR-440 Amd 1) | Bed-size change moved the overlay | **Fixed, measured** | A10: 400 → 410 after calibration, 0.01 mm |
| ADR-449 Amd 2 (H6-P1-2 / H6-P2-1) | Head camera Z | **Holds** | A11: 0.5 mm Z refuses; WPos / WCO / re-home exact |
| Y1-P2-1 | Accuracy off the sheet not in Job Review | **Open (Y1)**. Y3 adds nothing: Job Review still reads no calibration accuracy (`start-machine-snapshot.ts` has no accuracy field) | READ |
| Y1-P2-2 | Camera-moved warning silent or withdrawn | **Fixed after this tree** by #1680 (`b43187780`). On main the warning also reaches Job Review through `machineSnapshot` (`cameraMovedStartWarning`), so canvas, Job Review, phone/MCP and restart all get it | READ of the `bf841ff5e..b43187780` diff |
| Y1-P1-1 | Same-aspect sensor crop used as a resize | **Open (Y1)**. A stale-resolution overlay is not drawn when refused. A same-aspect crop is drawn and nothing at Start knows | READ |
| v2 12-P3-5 | Start-snapshot camera fields unread | **Still unread on `bf841ff5e`**: `cameraConfirmedPositionEpoch`, `cameraPlacementGeometryIssue`. `b43187780` adds a read field (`cameraMovedWarning`) beside them | READ |
| #1546 item 4 | Model in origin-dependent coordinates | **Open (by design)**. Measured harmless across corners when the calibration's origin matches (A7) | `a-placement.json` |

## Refuted

None raised and then refuted. Candidates dropped before raising:
- **Half-pixel shift between calibration, overlay and Find pieces.** The overlay samples at `(pixel + 0.5) / size` (`bed-overlay-shader.ts:172`, CPU mirror `:294`), the bed image puts pixel centres at `+ 0.5` (`bed-image.ts:92-99`), and pieces add `+ 0.5` to centroids (`piece-components.ts:63`). Measured: overlay ≤ 0.02 mm, pieces ≤ 0.05 mm.
- **Y inversion or mirror on a non-front-left origin.** All four other corners, stock and force-origin, are at 0.00–0.02 mm.
- **G54 offset under Absolute.** `absoluteProgramOffset` cancels the WCO exactly (A2: 0.00–0.01 mm).
- **Head camera after an origin change or with WPos reports.** `inferCurrentMachinePosition` adds WCO and the bed mapping is MPos-based (A11: 0.00 mm).
- **Material height left at 0.** Placement on a 4 mm coaster is 0.31 mm off at the centre and 2.11 mm at the far bed; on 20 mm, 1.59 / 10.85 mm. This is the operator's panel setting, labelled "Material height — top of the material above the bed" (`OverlayControls.tsx:179-184`), and it is designed to be ephemeral (`camera-store.ts:62-69`, "Ephemeral, like the material height"). Not raised.

## Verified clean

- **End-to-end placement (L1), flat bed, correct calibration:** max 0.02 mm over 64 grid points and 7 named positions; Find pieces max 0.05 mm (`a-placement.json`).
- **Twin, burn vs geometry:** the burned vertices match the placed scene geometry at 0.00 mm for rotate, mirror X/Y, scale and combinations.
- **Twin, Frame vs burn:** the Frame rectangle's centre sits on the burn box's centre (0.00 mm) in every Absolute case. The lead-in case is 0.11 mm, because the lead extends the burn.
- **Falcon A1 Pro** (vendor positive contract, CoreXY): 0.00–0.01 mm.
- **Camera target:** Engrave target and the canvas target at Absolute burn every ring on its layout position. A canvas target is stamped with the Start's frame (`stampCanvasTargetBurn` → true), and the photo step uses it (`assumedTarget` → "added to the canvas and engraved").
- **Print and Cut** within ±89°, 20 mm offset and 1 % print scale: 0.02–0.06 mm. A missing mark and a print past 2 % are refused with messages that name the cause.
- **Head camera** after a jog, WPos reports, an origin change, a WPos report without WCO (cached) and a re-home: 0.00 mm. A Z move of 0.5 mm refuses use.
- **L9 parity (READ):** every Start route builds its camera warnings through `machineSnapshot` → `demotedPolicyWarnings`:
  - canvas Start and Job Review (`start-job-source.ts:94`, `job-review-gate.ts:315`);
  - phone/MCP (`remote-access/job-review-preparation.ts` → `prepareCurrentStartJob`);
  - restart / Start from line (`start-job-source.ts:357` → `prepareStartJob`);
  - Engrave target (`transient-camera-job.ts:63`, latch forced on).
  The camera Start-from advice is therefore the same on all of them, including Y3-P1-1's rotary wording.
- **L12:**
  - Camera-placement merges since v11: #1641 (`181dfb0d3`) and #1649 are in `c94993aa4`, green per Y1.
  - #1671 (ADR-695, `c08855e04`): CI passed and Browser smoke failed (the KNOWN rotary golden). It changed `start-job-readiness-policy.ts` (rotary axis warnings) but neither the camera rotary advice nor its test; that untested interaction is Y3-P1-1.
  - The audited tip `bf841ff5e`: CI success.
  - #1680 (`b43187780`): CI in progress at the time of writing.

## Not verified

- **No browser and no streamed run.** The overlay was measured through the shader's CPU mirror, which W4 held to the GPU. Start preparation was called directly (`prepareStartJob`, `prepareCurrentStartJob`), not through a Frame → Start on the simulated GRBL. The bytes are the ones Start would stream; the machine's motion is not simulated.
- **Start from line's dialog** shows `source.warnings` for the CNC flows (`cnc-pass-recovery-flow.ts:157,198`). Whether `ManualLaserRestartDialog` lists the camera advice was not traced.
- **Ambiguous mark pairs** (a sheet of repeated labels): designed decoys at 14 mm fell inside each other's clear bands and were not found, so the "nearest pair wins" choice against a real second pair was not reproduced. READ: `markPairMessage` names other fitting pairs (ADR-443 D2).
- **The nudge ring** (ADR-663 Amd 2) after engraving: READ only (it compiles through the same transient job, verified in B1's route).
- **Print and Cut through Start:** the registration was applied with the real solve and `applySimilarityPoint`. The Absolute compile after it is exact per part A, but a full `prepareStartJobSnapshot` with a registration was not run.
- **Real lenses and real sheets:** all synthetic.

## Repro files

All files are in the scratchpad folder `zz-y3\`. The Vitest files live in a mutable copy of `j20-main` (`zz-y3\tree`, `node_modules` a junction; remove it only with `cmd /c rmdir`). Run them from `zz-y3\tree` with `node node_modules\vitest\vitest.mjs run src/zz-y3/<file> --maxWorkers=1`, with `NODE_OPTIONS=--no-experimental-webstorage`. Run the Node scripts from `zz-y3\` with `node --import ./register.mjs <script>.mts` (the loader is Y1's, pointed at `j20-main`).

- `tree/src/zz-y3/y3-lib.ts`: truth camera and record, coaster renderer, overlay-mirror centroid, G-code burn parser, program → physical mapping.
- `tree/src/zz-y3/y3-a-placement.test.ts` → `out/a-placement.json`: the placement matrix (origins, start-from modes, transforms, A1 Pro, fill / kerf / lead-in, bed change).
- `tree/src/zz-y3/y3-a11-head.test.ts` → `out/a11-head.json`: the head camera.
- `tree/src/zz-y3/y3-b-target.test.ts` → `out/b-target.json`: Engrave target, and the canvas target at Absolute, Current Position and User Origin (Y3-P1-2).
- `b-cal.mts` → `b-cal.out.jsonl`: real calibration of shifted rings (Y3-P1-2).
- `tree/src/zz-y3/y3-d-rotary.test.ts` → `out/d-rotary.json`: rotary Y / A / Z × Start from (Y3-P1-1).
- `c-printcut.mts` → `c-printcut.out.jsonl`: camera Print and Cut (Y3-P2-1).
- `a-height.mts` → `a-height.out.jsonl`: Material-height mismatch (informative).
- `truth.mts`, `register.mjs`, `ts-resolve.mjs`: copied from `zz-y1\`.
- `a-run.txt`, `b-run.txt`, `d-run.txt`, `a11-run.txt`: the Vitest logs.

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Y3-P1-1","severity":"P1","area":"camera-placement-burn","file":"src/ui/laser/start-job-readiness-policy.ts","line":164,"anchor":"Contract ADR-228 Amd 2 D2 ('the camera picture places the artwork only along the cylinder') vs ADR-695 D5 (G92 A0, Absolute starts at the current face); twin advice vs emitted bytes","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Rotary camera advice: Current Position (advised) re-centres X on the head (placed X110-130 burned X190-210, 80 mm along the cylinder); on A/Z rotaries Absolute keeps the picture X and starts at the current face, yet is warned against as 'turns the cylinder back to work Y 0'"},
  {"id":"Y3-P1-2","severity":"P1","area":"camera-placement-burn","file":"src/ui/camera/calibrate/canvas-target-burn.ts","line":47,"anchor":"Contract ADR-441 Amd 5 D3 (Absolute is the only mode that burns the rings where the photo looks), ADR-441 Amd 4 D4; measured","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Canvas target burned from Current Position/User Origin (rings 50-156 mm off) is not stamped but the photo step still labels it from the layout with no refusal; real calibration grades good (0.04-0.06 mm) while every later placement is off by the offset (3.6/14.2/70.7 mm); no warning on a first calibration"},
  {"id":"Y3-P2-1","severity":"P2","area":"camera-placement-burn","file":"src/core/camera/marks/match-mark-pair.ts","line":61,"anchor":"Contract ADR-443 Amd 1 ('shown, never silent'; swapped targets turn 180), ADR-443 D2; measured","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Camera Print and Cut on a sheet turned 95/135/180 deg pairs the marks reversed; dialog reports -85/-45/0 deg, unusual check (>=135) never fires; cut 128.6 mm mean / 217.2 mm max off the print; within +-89 deg accurate to 0.06 mm"},
  {"id":"Y3-P3-1","severity":"P3","area":"camera-placement-burn","file":"src/ui/laser/print-cut-frame-warnings.ts","line":9,"anchor":"Twin ADR-228 Amd 1 camera advice names cause and fix; ADR-443 D4 camera points are bed points","evidence":"READ","verdict":"PENDING","known":false,"summary":"Print-and-Cut + non-Absolute Start from warning says only 'confirm the traced position'; with camera (bed-basis) marks the cut misses the print by the origin offset"}
]
```

## Refuter (2026-11-10)

- **Tree:** origin/main @ `82a9713a4` (docs only after `b43187780`). Repros ran against the scratchpad export `j20-main` (`bf841ff5e`).
  - `git diff bf841ff5e origin/main` touches none of the files behind these findings. The exception is `start-job-readiness-policy.ts`, where #1680 adds only the camera-moved line (ADR-663 Amd 5). The rotary wording moved from `:144/:157/:164` to **`:150/:163/:170`**, unchanged.
  - Open PR #1681 (Y1-P1-1, frame-size proof) touches `camera-model-frame.ts`, `frame-rescale-check.ts`, `moved-check.ts` and the overlay drawing. It changes none of the four findings. #1623 is unrelated.
- **Method:** Node only.
  - Free memory was 0.78 GB at the start, then 1.8–4.5 GB, so no Vitest or browser run was attempted. Node scripts are outside the gate.
  - Own scripts, own controller state and own G-code parser. The parser is modal, tracks G90/G91, G20/G21 and G92, and samples arcs.
  - Own work → native → bed map, written by hand for stock GRBL `$23=3` negative space and checked by the Absolute controls.
  - Own synthetic camera: an ideal pinhole, 1600 × 1200, f 1150, mounted back-left at (120, 60, −520) and looking diagonally, with its own ray-caster renderer.
    - For the product's fisheye lens type it is expressed as the Kannala–Brandt series of tan θ (k = 1/3, 2/15, 17/315, 62/2835). It agrees with `projectWorldPoint` to < 0.05 px.
  - It goes through the real `prepareStartJob` with the real `machineSnapshot`, `addCalibrationTargetToCanvas`, `placementAfterSetOrigin`, `stampCanvasTargetBurn`, `currentAssumedTarget`, `calibrateFromBedTarget`, `calibrationGrade`, `locatePrintCutMarks`, `solveTwoPointRegistration` and `registrationFigures`.
  - No real camera, network, ffmpeg or hardware was used.

### Verdicts

**Y3-P1-1: CONFIRMED P1.** The X half is a regression from #1641 on a Y rotary. The A/Z half came with #1671.

`r1-rotary.mts` → `out/r1-rotary.out.jsonl`. Setup:
- a non-square 500 × 300 bed;
- an asymmetric "L" placed at scene X **250–280**;
- the head parked at X **60**;
- a Y roller (100 mm/turn), an A chuck (360°/turn, grblHAL, confirmed) and a Z chuck (GRBL, confirmed), all run through the real Start preparation with the camera latch on.

| Rotary | Start from | Burn X (bed) | Turn | Camera advice |
|---|---|---|---|---|
| Y / A / Z | Absolute | **250–280** (as placed) | Y: 0–31.8 (rebased). A/Z: `G92 A0` / `G92 Z0`, then 0–28.6° / 0–8 (from the current face) | "Absolute turns the cylinder back so the job starts at work Y 0 … Choose Current Position" |
| Y / A / Z | Current Position, centre anchor | **45–75** (205 mm along the part) | about the current turn | "the camera picture places the artwork only along the cylinder … Keep Current Position" |
| Y / A / Z | Current Position, front-left anchor | **60–90** (190 mm) | from the current turn | same |
| Y / A / Z | User Origin at the head | **60–90** | from the origin's turn | "Keep User Origin" |

- **Regression.**
  - Before #1641 (`181dfb0d3^1`), Current Position or User Origin on a rotary got the flat-bed sentence: "this job burns where Current Position puts it, not where the artwork sits on the camera picture". That was true for X.
  - #1641 replaced it with wording saying the picture does place X ("only along the cylinder"), and told the operator to keep the mode that discards it.
  - #1671 then made Absolute on A/Z start at the face under the laser (ADR-695 D5). So on A/Z the advice now warns off the one mode that burns where the picture shows, for a reason that no longer holds.
- **Visible?**
  - The advice is a Job Review warning that names a mode to keep. It is the same through Start-from-line, phone/MCP and the camera target, because all read `machineSnapshot`.
  - The only sign of the X move is the physical Frame and the canvas outline, which are not warnings (METHOD §3, G6 clarification). Nothing reaches the operator that names the move.
- **Should Y and A/Z differ?** Yes.
  - On A/Z, Absolute keeps the picture's X and starts on the current face, so the advice should accept or recommend it.
  - On Y no single mode keeps both: Absolute keeps X but rebases the turn, and Current Position keeps the turn but re-centres X. The advice must say so, for example "jog the head over the artwork on the camera picture first".
- **The test.** `start-job-rotary-camera-placement.test.ts:98` uses `currentPosition: { x: 120, y: 80 }`, the artwork's own centre X. Every rotary there is a Y chuck. The test cannot see the X move or the A/Z axis.
- **Lowering?**
  - The output is wrong: 190–205 mm in my geometry. It scales with the head-to-artwork distance.
  - No warning names it. The auditor's P2 points (operators jog first, "Watch the Frame") do not meet METHOD §3's lowering test.

**Y3-P1-2: CONFIRMED P1, and stronger than raised.** It does not need a deliberate Start-from change.

- **Forced or chosen?** Add target to canvas sets Absolute (`calibration-actions.ts`, `replaceSceneWithGeneratedScene(..., { startFrom: 'absolute' })`), but nothing holds it there. The routine **Set origin** button flips it back silently:
  - `set-origin-placement.ts:23`: "Set origin upgrades Absolute Coordinates to User Origin".
  - `OriginRow.tsx:310`: the toast says only "Origin set to current head position (G92)."
  - A diode user who adds the target, then sets the origin at the sheet corner as usual, burns at User Origin without having touched Start from.
- **Repro.** `r2-target-flow.mts` → `out/r2-target-flow.out.jsonl` (stock GRBL, homed, 400 × 400, head at 300, 80):

  | Flow | Start from at Start | Ring shift vs control (mm) | Stamped | Photo step | Job Review camera line |
  |---|---|---|---|---|---|
  | Add target → Start (control) | absolute | 0 | **true** | "added to the canvas and engraved", no refusal | none |
  | Add target → Set origin at sheet corner (52, 298) → Start | **user-origin** (set by Set origin) | −23.0, +13.2 (**26.5**) | false | "added to the canvas", **no refusal** | **none**; no out-of-bed line either |
  | Add target → Set origin at (40, 310) → Start | user-origin | −35.0, +25.2 (**43.1**) | false | same | none |
  | same, recalibration with the overlay latched | user-origin | 26.5 | false | same | flat-bed "Choose Absolute Coordinates …" (a real warning) |
  | Set origin at the head (300, 80) | user-origin | ~300 | false | same | only out-of-bed lines (large offsets are caught, small ones are not) |

- **Calibration.** `r2b-calibrate.mts` → `out/r2b-calibrate.out.jsonl`. My own camera photographs the shifted rings, and the real calibration labels them from the layout.
  - The rings are found 35/35 in every case.
  - RMS is 0.028–0.033 mm, the same as the control's 0.033.
  - The grade is the same in every case (here "fair: lined up at the height of the 3 mm target sheet only", for this lens). The grade cannot tell a shifted target.
  - True overlay error at bed height afterwards:

    | Ring shift | Overlay error |
    |---|---|
    | 0 (control) | 0.01 at the centre, 0.2–0.9 at the far corners (height-only fit) |
    | 2, 2 | **2.7–3.7** |
    | −23.0, 13.2 | **26.1–27.0** |
    | −35.0, 25.2 | **42.8–43.3** |

  So every later placement carries the whole offset. This reproduces the auditor's 3.6 / 14.2 / 70.7 mm with an independent lens, pose and renderer.
- **Is the missing stamp visible?** Only as a missing word in the photo step's description ("added to the canvas" against "… and engraved"). That is not a warning.
- **Same root as Y1-P2-1?** No.
  - Y1-P2-1 is extrapolation error off the sheet with correct labels.
  - This finding is a correct fit to wrongly labelled rings, a pure translation absorbed by the pose. It shows on the sheet itself, and the fix is in a different place (stamp, refuse or relabel).
- **Lowering?** On a first calibration no warning reaches the operator. The recalibration case gets the flat-bed warning, which is adequate. So P1 holds for the first-calibration path, which is the one every new camera owner takes.

**Y3-P2-1: RE-RATED P2 → P1.** The reach is wider than raised.

`r3-printcut.mts` → `out/r3-printcut.out.jsonl`. My camera, a **landscape** 297 × 210 sheet, 10 mm **cross** marks (not rings), an asymmetric arrow, and two mark layouts:

| Marks | Sheet turn | Paired | Dialog says | Cut vs print, mean / max (mm) | Unusual flag |
|---|---|---|---|---|---|
| diagonal corners | 0–88° | right | turned 0.0–88.0° | 0.02–0.05 / ≤ 0.08 | none (correct) |
| diagonal corners | 92° / 120° / −100° / 270° | **swapped** | −88.0° / −60.0° / 80.0° / 90.0° | **135.7 / 186.4** | **none** |
| diagonal corners | **180° (upside down)**, offset 4,3 and 30,20 | **swapped** | "turned 0.0°" | **135.7 / 186.4** | **none** |
| **both on the top edge** | 0–75° | right | as laid | ≤ 0.07 | none |
| **both on the top edge** | **88°** | **swapped** | "turned −92.0°" | **225.1 / 296.1** | **none** (|−92| < 135) |
| both on the top edge | 92° / 120° / 180° / −100° / 270° | swapped | −88 / −60 / 0 / 80 / 90° | **225.2 / 296.2** | none |

- **Why P1.**
  - It is reachable today: a landscape sheet laid upside down, or a portrait/landscape slip, is one of the commonest placement mistakes.
  - The output position is silently wrong by 136–225 mm on average.
  - The app tells the operator the opposite of the truth: "found both marks … turned 0.0°".
  - ADR-443 Amd 1's "shown, never silent" covers exactly this case on the head-capture route. There, an upside-down sheet captured in design order registers ≈180° and raises the confirm. On the camera route the swapped pairing turns it into a plausible 0°, so the protection is lost.
  - The auditor's P2 arguments do not meet METHOD §3:
    - "operator mistake": there is no reach clause;
    - "inherent to two marks": the camera route has the printed artwork in the same frame, so the ambiguity can be resolved;
    - "the Frame shows it": Frame is not a warning.
  - Within ±88° with diagonal marks it is accurate (≤ 0.08 mm).
- **Challenge to the auditor's "accurate to 0.06 mm up to an 89° turn".** That holds only for marks symmetric about the sheet's turn centre. With both marks on one edge, an **88°** turn already swaps them, and the reported −92° is still under the 135° check.

**Y3-P3-1: CONFIRMED P3.**
- `print-cut-frame-warnings.ts:9-10,22-24` gives only the generic "combined transform; confirm the traced position" line.
- The gap is not specific to camera marks. Head captures, whether in the bed basis or controller-relative, are machine positions too, and a User Origin or Current Position re-anchor moves the registered job off the print just the same. The wording fix should cover both sources.
- A warning exists and names the conflict, so P3 is right.

### Challenges to "Verified clean"

- **"Print and Cut within ±89° … 0.02–0.06 mm": broken.** It is layout-dependent. With marks on one edge, an 88° turn mis-pairs (225 mm), as shown above. It belongs under Y3-P2-1 (now P1).
- **"Flat-bed placement exact (0.02 mm)": holds on the new inputs.** `r4-flatbed.mts` → `out/r4-flatbed.out.jsonl`, through the real Start preparation at Absolute:
  - non-square 500 × 300 bed, artwork near the back-right corner: centroid 0.00 mm, box exact;
  - G54 WCO −37.5, −12.25 reported in mm, and the **same WCO reported in inches (`$13=1`)**: 0.00 mm. Output stays G21, and the inch WCO is converted.
  - **non-default anchor** (centre) at Absolute: ignored, as it should be, 0.00 mm;
  - **kerf** 0.25 mm: box grows 0.25 mm each side; the L's length-centroid moves 0.09 mm by geometry;
  - **group + array** of three copies: box 290–440 × 40–60, exact;
  - **raster** 8 × 6 px with 5 mm pixels (coarse, to amplify any half-pixel error), with WCO 0 and with the inch WCO: dark-pixel burn box 300–340 × 200.05–229.95 against 300–340 × 200–230. That is no half-pixel shift; the 0.05 mm is the scan-row centre.
- **Not run as geometry, read instead:**
  - Undo/Redo and a move after placement: the placement is plain scene coordinates.
  - Start from line and a recovered run: both recompile through `prepareStartJob` / `prepareStartJobFromPrepared` with the run's `jobOrigin` and today's WCO compensation, so they inherit the exactness above.
- **Start-from-line shows the camera warnings: resolved (was "Not verified").**
  - Both the typed line (`runStartFromLineFlow`) and "Choose restart point…" (`ManualLaserRestartDialog`) pass the prepared source to `streamResumeFromRawLine`.
  - `reviewResume` then calls `confirmResumeWarnings(resumeReviewWarnings(source, resume))` (`start-job-resume-stream.ts:171`), which lists `source.warnings` (`resume-review-warnings.ts:35`). Those are built from `machineSnapshot`, camera latch included.
  - The confirm is headed "Controller warning:" (`:42`), a wording nit, not raised.
- **L9 parity:** agreed. My `prepareStartJob` runs gave the same rotary wording that Job Review shows.

### New findings

None raised separately. Set origin silently upgrading Absolute to User Origin is folded into Y3-P1-2 as its main route. With the camera latch on, the flat-bed advice already covers it for ordinary camera jobs.

### Not verified

- No Vitest, browser or streamed run, because memory was below the gate at the start. The Start bytes come from `prepareStartJob`, as in the audit.
- Real lenses, real sheets and a real rotary.
- On A/Z, I did not check whether the picture's Y means anything after the turn is zeroed (out of scope: the picture does not see the circumference).
- The 2.7–3.7 mm (2, 2) case's corner spread includes this pinhole's height-only fit (0.2–0.9 mm in the control).

### Repro files

Folder `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-y3r\`. Run each script from that folder with `node --no-experimental-webstorage --import ./register.mjs <script>.mts`. The loader is a copy of `zz-y3\register.mjs` + `ts-resolve.mjs` and reads `..\j20-main\src`.

| Script | Output | Purpose |
|---|---|---|
| `common.mts` | — | controller state, G-code parser, work → bed map |
| `r1-rotary.mts` | `out\r1-rotary.out.jsonl` | Y3-P1-1 |
| `r2-target-flow.mts` | `out\r2-target-flow.out.jsonl` | Y3-P1-2: Set origin flow, stamp, assumed target, warnings |
| `r2b-calibrate.mts` | `out\r2b-calibrate.out.jsonl` | Y3-P1-2: real calibration of shifted rings, own camera |
| `r3-printcut.mts` | `out\r3-printcut.out.jsonl` | Y3-P2-1 |
| `r4-flatbed.mts` | `out\r4-flatbed.out.jsonl` | flat-bed challenges |

No security finding, so there is no `SECURITY-DETAILS.md`.

Refuter counts: raised 4, refuted 0, P1 3, P2 0, P3 1, known 9
