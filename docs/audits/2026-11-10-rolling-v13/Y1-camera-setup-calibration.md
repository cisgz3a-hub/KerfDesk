# Rolling audit v13 — Y1 Camera setup and calibration

- **When:** 2026-11-10, 07:20–08:30 +0800   **Tree:** origin/main @ `f61a0757a`. Repros ran on the scratchpad export `j19-main` (`f61a0757a`, `node_modules` a junction).
- **Scope:** the setup wizard and everyday panel (ADR-663), the one-photo calibration and its fit (ADR-441 and Amds 1, 4, 7, 8), the accuracy map and Check camera (ADR-441 Amd 1), several cameras per machine (ADR-446), the phone as the overhead camera (ADR-448), the head camera (ADR-449, Amd 2), the camera-moved warning (ADR-663 Amd 3), a resolution change after calibration (ADR-440 §5), and saved calibrations across restart, file open, machine switch and update (ADR-440 Amd 3).
  - Code read: `src/core/camera/{target,model}/**`, `src/ui/camera/{calibrate,helpers,head,panel}/**`, `src/ui/camera/{active-camera-model,camera-model-frame}.ts`, `src/platform/web/web-camera*.ts`, `src/ui/state/camera-source-actions.ts`, the camera lesson and help topic.
- **Lenses run:**
  - **L1 (measurement):** calibration accuracy measured in mm against ground truth. Target photos were rendered by an independent camera model (Brown–Conrady barrel and pincushion, stereographic fisheye, own ray caster), then put through the real `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade`. The true error of the saved model was measured at the centre, target corners, bed edges, bed corners and on a 5–10 mm grid, at the sheet height, at 0 mm and at 20 mm.
  - **L1 (camera moved):** the real `view-shift.ts` chain, wired as `moved-check.ts:99-131`, on rendered views with a textured surround and a gantry, for real moves (slide, roll, pitch, yaw, knocks) and non-moves (noise, light, gantry elsewhere).
  - **L2:** none fetched. The ADRs' own measurements are the contract.
  - **L3 (twins):** the wizard grade against the settings row; the accuracy map's ring colours against the true error at each ring; the repo's own target renderer against the Y1 renderer (blur).
  - **L6:** blur, low contrast, covered rings, target partly at the frame edge, a resolution change, an unplugged or busy USB camera, and a refused permission (READ).
  - **L9:** Tools → Camera (menu, toolbar, Ctrl+K), the panel's callout and settings rows, the moved notice, and the camera lesson and help topic.
  - **L12:** main's CI for #1546, #1641 and #1649.
  - Not run: L4, L5 and L7 as passes. No browser run (see Not verified). No camera, network or hardware was used.
- **Memory gates:** 2.8–3.1 GB free at each check. Vitest ran on one worker. Node repros ran the real modules.
- **Counts:** 7 raised → refuter pending → P1 0 / P2 2 / P3 5 (+ 21 KNOWN: 12 earlier camera findings still open, #1546's 7 architecture items, and W4-P2-1 and W4-P2-2, both fixed).

## Headline

**On the target sheet the calibration is as accurate as it says.** In 15 rendered cases the camera was centred on the sheet or aimed at it. In those cases the true error on the target was 0.05–0.20 mm at its worst. Every ring colour on the accuracy map matched the true error at that ring, apart from 1 understated ring in about 1,000 (Verified clean). At 20 mm material the error grew by at most 0.15 mm once the camera height was pinned. A straight-down camera without a measured height was graded "fair, lined up at the sheet height only", as ADR-441 Amd 7 promises.

**Off the sheet, the "good" grade does not hold for a camera that sits off the sheet's centre line (Y1-P2-1).**
- With the default 300 × 200 mm sheet and the camera 60, 100 or 150 mm to one side, the overlay was **7.8, 17.8 and 35.6 mm** off at the far bed corner.
- The grade stayed "Accurate enough for placing artwork by eye." The only signal was the advice that about 68 % of the bed "is estimated".
- ADR-441 Amd 8 states the rest of the bed is "within about 1.3 mm", and the setup tooltip says A4 "calibrates the whole bed well".
- A full-bed sheet brings the same cameras back to 0.7–1.4 mm.

**The camera-moved warning misses the moves it most needs to catch (Y1-P2-2).**
- It stays silent on a roll about the lens axis of 1° or more (5.0–16.1 mm at the bed corners).
- It stays silent on a hard knock (a 40 mm slide, or a 6° pitch that puts the bed centre 57 mm off).
- In each case the edge match falls under 0.6. The check then publishes "unknown", which also **withdraws a warning already showing**.
- Small slides and tilts are caught, but the distance shown is 0.56–0.7 of the true one (Y1-P3-2).

Smaller:
- the settings row repeats "Accurate enough…" without the extrapolation caveat (Y1-P3-1);
- a slightly soft photo is blamed on something covering the discs (Y1-P3-3);
- a head or clamp over the sheet's edge is graded "a target engraved with other settings" (Y1-P3-4);
- the lesson and help topic still describe the pre-ADR-441 setup (Y1-P3-5).

**Resolution change.** A pure resize and a browser crop are handled correctly: the first holds at native accuracy, the second is refused with a reason. A 4:3 mode is refused. The KNOWN same-aspect sensor crop (#1546 item 5) was measured at **60 mm on the target, with no notice**. It is still open.

**Saved calibration** survives restart, file open, machine switch (named before it is replaced) and older records (READ + 859 passing camera tests). Per-camera binding uses the track's real device id, so a stale USB id that falls back to another camera does not borrow the first camera's calibration.

**L12.** No camera merge broke main. #1641 and #1649 are in `c94993aa4`, whose CI passed. The current tip `f61a0757a` is red on the rotary 1.0.30 golden and a responsive-toolbar spec (KNOWN, v12 rotary sessions).

## Matrix

| Path | Route | Result |
|---|---|---|
| New camera → Set up camera | panel callout `CameraSetupCallout.tsx:49` → wizard (Camera, Mounting, Picture, Target, Photo, Save) | holds (Vitest `CameraCalibrationWizard*.test.tsx` pass) |
| Re-run setup | Settings → Recalibrate… (`CalibrateCameraControls.tsx:44`) opens at Target; remembered target (ADR-441 Amd 4 D5) | holds (READ + Vitest) |
| Check camera | Settings → Check camera… (`:52`) and the moved notice (`CameraMovedNotice.tsx:46`) | holds on the rings; verdict uses `max(0.3, 1.5 × rms)` |
| Several cameras (ADR-446) | `savedModelFor` by kind + id (+ query for network) (`saved-cameras.ts:36-52`) | holds; the USB id is the track's own (`web-camera-stream.ts:11`) |
| Phone as overhead camera (ADR-448) | `machine-jpeg` source, bound to its public address + query fingerprint | holds (READ). Not run: no bridge outside Electron |
| Head camera (ADR-449, Amd 2) | `headPositionOnBed` reads MPos or WPos+WCO (`head-position.ts:27-40`); `modelAtHead`; Z ±0.2 mm refusal (`head-camera.ts:66-83`) | holds (READ + `head-position.test.ts`); an origin change moves WCO, not the head |
| Entry points (L9) | Tools → Camera / Ctrl+K toggle the panel only (`camera-command-family.ts:1-3`); every action is inside the panel | parity holds; lesson and help wording stale (Y1-P3-5) |
| Accuracy on the sheet, 15 centred or aimed cases | real pipeline vs truth | 0.05–0.20 mm worst (on-target grid), ring map honest |
| Accuracy off the sheet, centred camera | real pipeline vs truth | 0.6–2.1 mm worst, graded good + "estimated" advice (as ADR-441 Amd 8) |
| **Accuracy off the sheet, off-centre camera** | real pipeline vs truth | **7.8 / 17.8 / 35.6 mm, graded good: Y1-P2-1** |
| Too few views | there is one photo by design (ADR-441); 25–30 of 35 rings | fits; covered edge columns misgraded (Y1-P3-4) |
| Target at the frame edge | camera 150 mm off | on-target 0.93 mm (area corner 1.37 mm) vs reported worst ring 0.25 mm; folded into Y1-P2-1 |
| Low contrast (marks 150 on 190, noise 6) | real pipeline | 35/35, on-target 0.13 mm. Holds |
| Blur σ 1 px / ≥1.5 px | Y1 renderer and the repo's own renderer | σ 1: 30/35 ok (Y1) or fails (repo fixture); ≥1.5: fails, wrong cause named (Y1-P3-3) |
| Strong barrel (k1 −0.48) on A4 | real pipeline | refused "lens-folds" with the right message; full-bed sheet fits (0.64 mm off-target) |
| 1080p → 1280 × 720 pure resize | `cameraModelForFrame` → `lensForFrame` | used, 0.12 mm on target (same as native). Holds |
| 1080p → 720p crop-and-scale | same | refused with "The camera crop differs…". Holds |
| 1080p → 720p native sensor crop | same | **used, 60 mm on target, no notice** (KNOWN #1546 item 5) |
| 1080p → 640 × 480 | same | refused with the shape message. Holds |
| Bed size or machine changed | `modelInBedFrame` / `camera-bed-frame.ts` | moves the model or refuses on an origin change (ADR-440 Amd 1/5/8; W4 verified, unchanged) |
| Restart / file open / update | profile persistence; ADR-440 Amd 3 keep-current; record normalisers | holds (READ + `camera-calibration-open.test.tsx`, `project-camera-model.test.ts`) |
| Camera-moved: no move (noise, light ×1.4, gantry at 150 or 5) | real view-shift chain | steady, 0.00–0.12 mm. Holds |
| Camera-moved: slide 2 / 5 mm, pitch 0.5 / 1°, yaw 1° | same | warns, but understated for slides (Y1-P3-2) |
| **Camera-moved: roll 1–3°, 40 mm slide, 6° pitch** | same | **silent while 5–108 mm off: Y1-P2-2** |
| USB unplugged / denied / busy | `camera-source-actions.ts:184-225`, `web-camera.ts:45-64` | ended → source leaves live; denied → `denied`; busy → error message; photo null → "Could not take a photo…" (`calibration-actions.ts:199-202`). Holds (READ) |

## Accuracy table

True overlay error (mm) of the saved model: artwork drawn at bed point P against what really lies under that pixel. The material is at the sheet height (3 mm). The bed is 400 × 400 mm and the sheet is the default 300 × 200 mm, centred, unless the row says "full bed". "n/v" means not in view. "Reported" is the wizard's average / worst-ring figures.

| Case (truth camera) | Rings | Reported | Grade | Centre | Target corner | Bed edge (left) | Bed corners in view | Worst on target | Worst off target | Worst off target at 20 mm |
|---|---|---|---|---|---|---|---|---|---|---|
| 720p webcam, Brown k1 −0.32 k2 0.11, 31° tilt | 35/35 | 0.06 / 0.12 | good | 0.04 | 0.18 | 0.24 | 0.37–0.62 | 0.13 | 1.26 | 1.20 |
| same, full bed | 100/100 | 0.05 / 0.12 | good | 0.05 | 0.15 | 0.06 | 0.04–0.15 | 0.09 | 0.27 | 0.39 |
| 720p webcam, mild barrel k1 −0.12 | 35/35 | 0.04 / 0.12 | good | 0.04 | 0.05 | 0.05 | 0.09–0.11 | 0.05 | 1.17 | 1.71 |
| 720p webcam, strong barrel k1 −0.48 k2 0.2 | — | refused "lens-folds" | — | — | — | — | — | — | — | — |
| same, full bed | 100/100 | 0.07 / 0.14 | good | 0.05 | 0.29 | 0.03 | 0.06–0.29 | 0.08 | 0.64 | 0.97 |
| 1080p phone, pincushion k1 +0.08, near straight down | 35/35 | 0.02 / 0.04 | fair (sheet height only) | 0.01 | 0.13 | 0.25 | 1.45–1.46 | 0.10 | 2.07 | 2.49 |
| same, height typed 563 mm | 35/35 | 0.02 / 0.04 | good | 0.01 | 0.14 | 0.26 | 1.53 | 0.10 | 2.14 | 2.41 |
| 1280 × 960 lid fisheye (stereographic) | 35/35 | 0.09 / 0.18 | good | 0.10 | 0.09 | 0.18 | 0.36–1.35 | 0.20 | 1.54 | 1.70 |
| same, full bed | 90/100 | 0.12 / 0.35 | good | 0.08 | 0.02 | 0.03 | 0.02–0.15 | 0.14 | 0.17 | 0.18 |
| fisheye at a lid corner, aimed at the bed centre | 34/35 | 0.13 / 0.30 | good | 0.06 | 0.06 | 0.10 | 0.30–0.73 | 0.20 | 0.78 | 0.86 |
| webcam at a corner, aimed at the bed centre | 35/35 | 0.05 / 0.15 | good | 0.06 | 0.09 | 0.04 | 0.11–1.71 | 0.09 | 1.80 | 1.80 |
| side-mounted, 45° perspective, k1 −0.12 | 35/35 | 0.06 / 0.13 | good | 0.05 | 0.06 | 0.00 | 0.64 | 0.13 | 0.68 | 0.77 |
| same, full bed | 96/100 | 0.07 / 0.15 | good | 0.07 | n/v | 0.03 | 0.03–0.04 | 0.08 | 0.07 | 0.08 |
| 31° webcam, low contrast (marks 150 on 190, noise 6) | 35/35 | 0.06 / 0.13 | good | 0.06 | 0.16 | 0.27 | 0.51–0.71 | 0.13 | 1.34 | 1.26 |
| 31° webcam, blur σ 1 px | 30/35 | 0.04 / 0.08 | good | 0.04 | 0.13 | 0.17 | 0.24–0.37 | 0.10 | 1.06 | 1.03 |
| 31° webcam, blur σ 1.5 / 2 / 3.5 px | — | refused "anchors-not-found" | — | — | — | — | — | — | — | — |
| 31° webcam, 200 × 150 sheet | 30/30 | 0.07 / 0.13 | good | 0.02 | 0.07 | 0.39 | 0.16–1.61 | 0.13 | 2.05 | 2.02 |
| **31° webcam, camera 60 mm off-centre** | 35/35 | 0.05 / 0.10 | **good** | 0.06 | 0.28 | 0.35 | 0.23–**5.99** | 0.22 | **7.83** | **9.74** |
| **same, 100 mm off-centre** | 35/35 | 0.06 / 0.13 | **good** | 0.04 | 0.18 | 0.29 | 0.21–**14.98** | 0.20 | **17.83** | **21.14** |
| **same, 150 mm off-centre** | 35/35 | 0.09 / 0.25 | **good** | 0.05 | **1.37** | **1.01** | 0.14–**31.67** | **0.93** | **35.59** | **40.72** |
| same, 150 mm off-centre, full bed | 100/100 | 0.11 / 0.31 | good | 0.10 | n/v | 0.17 | 0.07–0.20 | 0.83 | 0.95 | 0.67 |
| mild barrel, 150 mm off-centre | 35/35 | 0.08 / 0.22 | good | 0.08 | 0.97 | 0.97 | 0.18–0.52 | 0.72 | 15.77 | 12.90 |

Share of the visible bed off by more than 1 / 2 / 5 mm (`m6-offcentre-map`, 5 mm grid, about 6,430 points):

| Camera offset | Default 300 × 200 sheet | Full-bed sheet |
|---|---|---|
| 0 mm | 3.1 % / 0 % / 0 % (worst 1.26 mm) | 0 / 0 / 0 (0.27 mm) |
| 30 mm | 0.2 % / 0 % / 0 % (2.93 mm) | 0 / 0 / 0 (0.31 mm) |
| 60 mm | 1.1 % / 0.7 % / 0.2 % (7.83 mm) | 0 / 0 / 0 (0.71 mm) |
| 100 mm | 3.8 % / 2.7 % / 1.3 % (17.83 mm) | 0 / 0 / 0 (1.40 mm) |
| 150 mm | 9.6 % / 7.4 % / 4.6 % (35.59 mm) | 0 / 0 / 0 (0.95 mm) |

Every row was graded "good".

Resolution change (`m3-resolution`), calibrated at 1920 × 1080 (0.03 mm average):

| Frame now | `cameraModelForFrame` | On-target worst | Off-target worst |
|---|---|---|---|
| 1280 × 720, pure resize | used | 0.12 | 1.10 |
| 1280 × 720, browser crop-and-scale | refused: "The camera crop differs from its calibration…" | — | — |
| 1280 × 720, native sensor centre crop | **used, no notice** | **60.06** (centre 4.88) | 114.22 |
| 640 × 480 | refused: "The camera picture is 640 × 480, a different shape…" | — | — |

## Findings

### Y1-P2-1 — With the default A4 sheet, a camera off the sheet's centre line is graded "Accurate enough for placing artwork by eye" while the overlay is 8–36 mm off at the far bed corner

- **Where (f61a0757a):**
  - `src/ui/camera/calibrate/calibration-result.ts`:
    - `:94` (`GOOD_RMS_MM = 0.25`) and `:124-130`: the grade comes from the in-sample ring RMS alone.
    - `:98` and `:153-160`: past 25 % "outside", the only addition is the sentence "outside the target the picture is estimated", with no figure.
  - `src/core/camera/target/bed-calibration.ts:123-146`: the figures are measured on the matched rings only. `:86-95`: below 40 rings, one distortion term.
  - `src/ui/camera/calibrate/camera-calibration-store.ts:147-151`: default sheet 300 × 200 mm.
  - `src/ui/camera/calibrate/CalibrationSetupStep.tsx:54`: the tooltip says "About A4 (300 × 200 mm) calibrates the whole bed well".
  - The overlay has no tint or limit outside the target. The accuracy map's dashed outline and legend are the only canvas signal, and only when the map is on.
- **Anchor:**
  - **Contract:**
    - ADR-441 Amendment 8, Consequences: "Across the rest of the bed it is within about 1.3 mm and is reported as estimated there".
    - ADR-441 Amendment 4, Decision 4: "The grade says what it measured."
    - ADR-441 §6: good is "up to 0.25 mm average error".
  - **Measurement:** the true error, measured against ground truth, on 6,400+ visible bed points (accuracy table above).
  - **Lens:** L1.
- **Scenario:**
  1. A maker's USB webcam sits on the right of the enclosure lid, 100 mm right of the bed's centre line, looking down and forward, as mounts often are when the lid hinge or the laser head is in the way.
  2. They follow the wizard's default and engrave the target on an A4 sheet in the middle of the bed. All 35 rings are found, and the result reads "Accurate enough for placing artwork by eye", average 0.06 mm, worst ring 0.13 mm. The advice adds that about 68 % of the bed lies outside the target and is estimated.
  3. Later they place a name on a coaster lying near the front-left corner on the camera picture.
  4. The overlay there is 15 mm off, so the burn lands 15 mm from where the coaster appears.
  5. With the camera 150 mm off-centre, 4.6 % of the visible bed is more than 5 mm off, and the corner is 35.6 mm off.
  6. Inside the target's own dashed area (its corner, 1.37 mm) the error is 5 times the reported worst ring.
- **Evidence:** REPRO. The scripts are `zz-y1/m4-variants.mts` (→ `.out.jsonl`) and `zz-y1/m6-offcentre-map.mts` (→ `.out.jsonl`); the truth model is `zz-y1/truth.mts` and the harness is `zz-y1/m1-accuracy.mts`.
  - The truth camera is a Brown–Conrady lens, 720p, fx 700, k1 −0.32, k2 0.11. The target photo is ray-cast with a honeycomb bed, vignetting and noise σ 2.
  - The calibration runs the real `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade`.
  - The error is measured with the saved model's `projectWorldPoint` against the truth back-projection.
  - The ring map's colours matched the true error at every ring, so the understatement is entirely off the rings.
  - Control: a full-bed sheet gives 0.71 / 1.40 / 0.95 mm worst for the same three offsets.
  - Control: a camera at a corner but **aimed** at the bed centre gives 1.80 mm.
- **Severity:** P2.
  - **For P1:** wrong placement of 8–36 mm leads to a misplaced burn. The headline at the moment of saving, and the settings row afterwards, call it accurate (METHOD §3: a false "accurate" readout). The brief rates such a readout P1 or P2.
  - **For P2:**
    - The grade does say in words that the picture outside the target is estimated.
    - ADR-441 Amd 4 lists "clipping or tinting the overlay outside the target" as out of scope.
    - The error is confined to the part of the bed furthest from the sheet. A 30 mm mismatch at the bed edge is visible in the picture against the canvas bed outline.
  - **Against P2:** a centred camera, which the ADR's fixtures are, stays within the ADR's 1.3 mm. Reaching the error needs an off-centre mount.
- **Announced?** Partly. That the area outside the target is estimated is announced (Amd 4 D4, Amd 8). Its size is announced as "about 1.3 mm". The off-centre case, and errors one to two orders of magnitude larger, are not.
- **Novelty:** new as a measurement and a finding.
  - It is related to KNOWN #1546 item 3 ("accuracy is reported in-sample"). That item is about the rings; this is the extrapolated bed, which no figure covers.
  - v2 12 measured "worst extrapolated corner 0.05–3.3 mm" on centred fixtures and did not raise it.
- **Fix direction:**
  - Measure the extrapolation risk instead of only its share: for example, the largest camera ray angle that sees the bed against the largest angle any ring covered, or a leave-out refit across the far rings.
  - Do not grade "good" when the bed the camera sees reaches well past the rings' angular range. Name the region ("the front-left of the bed may be several millimetres off") and suggest a larger sheet placed towards it.
  - Correct the tooltip at `CalibrationSetupStep.tsx:54`.
  - Optionally tint the overlay beyond the target (ADR-441 Amd 4's deferred item).
  - Add an off-centre rendered case to `bed-calibration.test.ts`.
- **Refuter:** PENDING.

### Y1-P2-2 — The camera-moved warning is silent on a roll of 1° or more and on a hard knock, and a weaker later match withdraws a warning already shown

- **Where (f61a0757a):**
  - `src/core/camera/model/view-shift.ts`:
    - `:121-131` and `:263-291`: a translation-only NCC of edge maps.
    - `:31` `MAX_SHIFT_PX = 16`.
    - `:37` `MIN_MATCH_SCORE = 0.6`.
  - `src/ui/camera/helpers/moved-check.ts`:
    - `:110-111`: a weak or failed match publishes `unknown`.
    - `:156-158`: `publish` replaces the state, so a showing `moved` becomes `unknown`.
  - `src/ui/camera/panel/CameraMovedNotice.tsx:20-26`: the notice renders only while the state is `moved`.
- **Anchor:**
  - **Contract:** ADR-663 Amendment 3, Consequences: "A knocked camera or a lid that closes differently is noticed at the next refresh, before a job burns in the wrong place, with the fix one click away." The maintainer asked for a warning that "tell[s] you when the calibration is probably off" (ADR-663 Amd 3, Context).
  - **Measurement:** the true bed error after each move, measured against the views rendered for the reference and the current frame.
  - **Twin:** a 0.5° roll (2.7 mm at the corners) warns; a 1° roll (5.4 mm) does not.
- **Scenario:**
  1. A camera on a single-screw lid bracket is bumped while loading material and turns 1–2° about its lens axis.
  2. At the next Refresh picture the centre of the bed still lines up (0.1–0.2 mm), but the corners are 5–11 mm off. The edge match scores 0.47–0.54, so the check says nothing.
  3. The maker places artwork near a corner, and it burns 5–11 mm off.
  4. Variant: a first small bump warns ("about 1.5 mm"). The maker carries on, and a second bump makes it worse. The next refresh matches weakly, the state turns `unknown`, and the warning disappears from the panel.
- **Evidence:** REPRO, `zz-y1/m2-moved.mts` → `zz-y1/m2-moved.out.jsonl`.
  - The camera is the repo's `wideLens(640)` + `overheadPose()`. The scene is a 400 mm bed with aluminium-extrusion frame rails, a wooden table and a gantry beam 40 mm up; 74 % of the view is surround.

  | Case | True error centre / worst corner (mm) | Check result |
  |---|---|---|
  | no move (noise; light ×1.4; gantry at 150 or 5) | 0 / 0 | steady 0.00–0.12 mm (score 0.90–1.00) |
  | slide 2 mm / 5 mm | 2.0 / 2.0; 5.0 / 5.0 | moved ~1.4 / ~2.8 mm (Y1-P3-2) |
  | pitch 0.5° / 1° | 4.4 / 7.9; 8.9 / 15.9 | moved ~4.0 / ~7.5 mm |
  | yaw 1° | 7.4 / 11.1 | moved ~7.0 mm |
  | roll 0.5° | 0.06 / 2.7 | moved ~1.5 mm (read as an x slide) |
  | **roll 1° / 2° / 3°** | **0.12 / 5.4; 0.23 / 10.7; 0.35 / 16.1** | **unknown (silent), score 0.54 / 0.47 / 0.35** |
  | **knock: 40 mm slide** | **40 / 40** | **unknown (silent), score 0.45** |
  | **knock: 6° pitch** | **57 / 108** | **unknown (silent), score 0.54** |
  | roll 1° with the gantry moved | 0.12 / 5.4 | unknown (silent) |

  - The withdrawal of a showing warning is READ (`moved-check.ts:156-158` with `CameraMovedNotice.tsx:20-26`).
- **Severity:** P2.
  - **For P1:** a misplaced burn of 5–108 mm with no warning, on the helper whose stated purpose is to catch exactly that.
  - **For P2:**
    - ADR-663 Amd 3 Decision says "Any weaker match … says nothing", so silence on a weak match is announced as a limit.
    - The helper only advises.
    - Large knocks are visible in the picture against the canvas bed.
  - **Against P2:** the operator is the primary check, and Check camera remains available.
  - The rotation case still lands at P2. It leaves the centre right and the corners several millimetres off, so the picture looks right where people look first.
- **Announced?** The silence on a weak match is announced. That a roll of a degree, or a knock, always produces a weak match is not, and the Consequences sentence claims the knock case. That a later weak match clears a showing warning is not announced.
- **Novelty:** new. G6 listed "the moved check's thresholds and its pixel → mm conversion" under Not verified. H6-P3-3 and G6-P3-2 are different cases (KNOWN; same key and same URL).
- **Fix direction:**
  - Estimate a similarity transform (shift + rotation, optionally scale), or match a few surround patches separately and fit a homography. Report the worst bed-corner displacement, not the centre's.
  - A strong mismatch over a rich surround (much edge energy, score far below the reference's self-score) should say "the view around the bed has changed a lot: check the camera", not nothing.
  - Keep a `moved` state until a steady result or a dismissal replaces it, not an `unknown`.
  - Add rendered roll and knock cases to `view-shift.test.ts`.
- **Refuter:** PENDING.

### Y1-P3-1 — The Camera settings row says "Accurate enough for placing artwork by eye" without the "outside the target is estimated" caveat the wizard gave

- **Where (f61a0757a):**
  - `src/ui/camera/calibrate/CalibrateCameraControls.tsx:74-77` prints `calibrationGrade(model).headline` only.
  - The caveat is in `.advice` (`calibration-result.ts:128`).
  - `SavedCamerasSection.tsx:48-50` prints the average only.
- **Anchor:**
  - **Contract:** ADR-441 Amd 4 D4 ("When a quarter or more of the bed … lies outside the target, the grade adds that share").
  - **Twin:** ADR-441 Amd 7 D3 keeps its own caveat in the row ("The calibration row in Camera settings keeps showing this after saving"), because it is in the headline. The extrapolation caveat lives in the advice and is dropped.
- **Scenario:** after saving the default A4 calibration, Camera settings shows "average error 0.06 mm. Accurate enough for placing artwork by eye." for every case in the accuracy table, including the 35.6 mm one.
- **Evidence:** READ, with the grades from the `m1`/`m4`/`m6` repros.
- **Severity:** P3. It is wording; the wizard said it once. It compounds Y1-P2-1.
- **Announced?** No. **Novelty:** new.
- **Fix direction:** add a short "measured on the target only; elsewhere estimated" clause to the row when `shareOutsideTarget ≥ 0.25`. Or fold the caveat into the headline as Amd 7 did.
- **Refuter:** PENDING.

### Y1-P3-2 — The camera-moved warning understates a slide: 2 mm reads "about 1.4 mm", 5 mm "about 2.8 mm", and moves of 1–1.4 mm go unremarked

- **Where (f61a0757a):** `src/core/camera/model/view-shift.ts:216-232` (`viewShiftOnBedOffsetMm`). The shift is measured in thumbnail pixels on the surround, at the edge of a wide lens where a millimetre spans fewer pixels. It is then applied at the bed centre's pixel, where a millimetre spans more. `moved-check.ts:112-131` uses that figure for the threshold and the message.
- **Anchor:**
  - **Contract:** ADR-663 Amd 3 Decision: "the shift is turned into millimetres at the middle of the bed. At 1 mm or more … warns". Its Consequences say "moves well under a millimetre go unremarked", not moves over one.
  - **Measurement:** `m2-moved` slide rows (table in Y1-P2-2).
- **Scenario:** a camera slides 1.3 mm on its rail. The check measures about 0.9 mm and stays silent; the overlay is 1.3 mm off everywhere. A 5 mm slide is announced as about 2.8 mm, and the operator may judge it small.
- **Evidence:** REPRO `zz-y1/m2-moved.mts` (slide 2 mm → `MOVED ~1.4 mm`, shift −0.57 px; 5 mm → `~2.8 mm`, −1.12 px).
- **Severity:** P3. A warning still fires from about 1.4 mm, and its number is advisory. The nudge fix measures its own ring.
- **Announced?** No. **Novelty:** new (G6 Not verified named the conversion).
- **Fix direction:** convert at the surround pixels where the shift was measured (the median of `toBed(p + shift) − toBed(p)` over the masked pixels), or report a range.
- **Refuter:** PENDING.

### Y1-P3-3 — A slightly soft calibration photo fails as "the three solid discs were not found. Make sure nothing covers them", and the picture check never looks at sharpness

- **Where (f61a0757a):**
  - `src/ui/camera/calibrate/calibration-result.ts:205-206` (`anchors-not-found`) and `:203-204` (`no-marks`).
  - `src/core/camera/picture-quality.ts:8-36` measures brightness and mm per pixel only.
  - `PictureCheckStep.tsx:55` lists "the picture is sharp" as a reminder.
- **Anchor:**
  - **Contract:** ADR-441 Amd 6 and Amd 7 D6 set the precedent that a failure names its real cause ("names the wrong cause", Amd 7 Context).
  - **Twin:** rings too small get their own message; blur does not.
- **Scenario:** a webcam whose focus drifted slightly (Gaussian σ 1–1.5 px) takes the photo. The wizard says the discs are covered, "including the laser head", and the maker moves the head and retries the same blurred picture.
- **Evidence:** REPRO.
  - `zz-y1/m5-blur-fixture.mts` → `.out.jsonl`, on the repo's own `renderTargetScene` (wideLens, overhead pose, default A4 sheet). At 1280 px, σ 0 calibrates (35/35); σ 1 gives `anchors-not-found` (7 rings, 0 anchors detected); σ ≥ 1.5 gives `no-marks`. At 1920 px, σ 1.5 gives `anchors-not-found`.
  - On the Y1 renderer (`m1`): σ 1 calibrates 30/35; σ 1.5, 2 and 3.5 give `anchors-not-found`.
- **Severity:** P3. Nothing is calibrated wrongly. The cost is a misleading retry loop.
- **Announced?** No. **Novelty:** new.
- **Fix direction:** add a sharpness measure (for example the variance of the Laplacian, or the edge width of detected ring candidates) to the picture check and to the failure path, and say "the picture looks out of focus".
- **Refuter:** PENDING.

### Y1-P3-4 — A head or clamp over the sheet's edge columns gets a "rough" grade: "These rings look like a target engraved with other settings"

- **Where (f61a0757a):**
  - `src/core/camera/target/missing-outer-band.ts:42-55`: missing outer rings count as "in view" when their projected positions are inside the picture. Whether something covers them is not considered.
  - `calibration-result.ts:101-102,171-181` gives the rough grade and the margin advice.
- **Anchor:**
  - **Contract:** ADR-441 Amd 4 D6 targets a target engraved with other settings. Its own measurement is a 9 × 9 of 10 × 10 grid.
  - **Twin:** `calibrationFailureMessage('anchors-not-found')` already names the laser head as a likely cover.
- **Scenario:** the laser head is parked over the left edge of the A4 sheet, or a magnet holds it flat there. 25 of 35 rings form a complete 5 × 5 grid. The result says "rough: … engraved with other settings" and asks the maker to change the margin or engrave a new target. The fit is fine: 0.31 mm worst on the target.
- **Evidence:** REPRO `zz-y1/m4-variants.mts`, case `webcamBarrel-headCoversLeft` (cover x 40–150, y 90–310, 60 mm up).
- **Severity:** P3. The wrong advice costs a re-engrave. Saving is still offered, and the saved-calibration check then leans to "keep".
- **Announced?** No. **Novelty:** new.
- **Fix direction:** before calling the band missing, check the picture where the missing rings would be: a uniform dark or uniform region there is a cover, not a missing ring. Or name the cover as the first cause in the advice.
- **Refuter:** PENDING.

### Y1-P3-5 — The camera lesson and the Camera help topic describe the setup before ADR-441 and Amd 8

- **Where (f61a0757a):**
  - `src/ui/tutorials/placement-tutorials.ts:14`: "a flat sheet of scrap that covers the bed".
  - `:27`: "cover the bed with one flat sheet".
  - `src/ui/help/command-help-topics.ts:106-109`: Camera opens "lens calibration, bed alignment" (the two wizards ADR-441 removed).
- **Anchor:**
  - **Twin (L9):** the wizard asks for a 300 × 200 mm sheet by default (`camera-calibration-store.ts:147-151`; `CalibrationSetupStep.tsx:44` "in the middle of the bed").
  - **Contract:** ADR-441 Amd 8 D1; ADR-441 Context ("one wizard").
- **Scenario:** a learner reads the lesson, then meets a wizard asking for sheet width and height. Help names tools that no longer exist.
  - Given Y1-P2-1, the lesson's full-bed advice is the more accurate one. The fix should reconcile the two, not just copy the wizard.
- **Evidence:** READ.
- **Severity:** P3, wording.
- **Announced?** No. **Novelty:** new. It is distinct from KNOWN V8-P3-5 (the lesson's Pro marks) and W1-P3-4 (website wording).
- **Fix direction:** reword the lesson step: "a flat sheet in the middle of the bed. A4 works, and a larger sheet measures more of the bed, especially for a camera that is not centred". Update the help topic to "set up and calibrate, overlay, trace".
- **Refuter:** PENDING.

## KNOWN: status on `f61a0757a`

| ID | Was | Status | Evidence |
|---|---|---|---|
| W4-P2-1 (P1 after refuter) | Rotary camera advice says Absolute | **Fixed** (#1641, ADR-228 Amd 2) | `start-job-readiness-policy.ts:107-109,141-169` (`rotaryCameraWarning`). Y3/Y5 own its re-audit |
| W4-P2-2 (security) | redacted | **Fixed per #1649** (ADR-692) | Y2 owns the verification |
| W4-P3-1 | USB mute leaves the last picture on the canvas | **Open** | `usbAvailability` is read only in `CameraPreviewCard.tsx`, `UsbCameraSection.tsx` |
| W4-P3-2 | Auto-start cancellation misses RTSP/phone/USB in flight | **Open** | `auto-start.ts:68,76,85` unchanged |
| v2 12-P3-2 | No blank or black frame check in the burn check | **Open** | no luma/blank test in `core/camera/job-watch` (only `change-mask.ts` diffs) |
| v2 12-P3-3 | Machine-JPEG failure blanks silently | **Open** | `CameraSourceView.tsx:28-32`: `PolledJpeg` still gets no `onFailure` |
| v2 12-P3-4 | Frozen still survives recalibration, Open, frame edits | **Open** | still writers only `camera-store.ts:173-181`, `capture-overlay-still.ts:72` |
| v2 12-P3-5 | Start-snapshot camera fields unread | **Partly fixed (unchanged)** | `start-machine-snapshot.ts:54-55` write; no reader of `cameraConfirmedPositionEpoch` / `cameraPlacementGeometryIssue` |
| G6-P3-1 / J5-P3-1 | After-job refresh re-shows a hidden or exited overlay | **Open** | `refresh-picture.ts:33` `activatePlacement: true`; `install-camera-helpers.ts:149-157` checks only `overlayStill` |
| G6-P3-2 | Nudge undo keeps the post-nudge view reference | **Open** | key `sourceId@calibratedAt` (`view-reference.ts:17`) |
| H6-P3-1 | Frame notes only inside the Camera panel | **Open** | readers `CalibrateCameraControls.tsx`, `CameraFrameNotice.tsx`, `OverlayControls.tsx` |
| H6-P3-3 | Every A1 Pro camera has the same fixed address | **Open** | `electron/camera-frame-proxy.ts:33-36` |
| #1546 item 1 | Legacy `CameraProfile` / `camera-transform.ts` | **Open** | `src/core/camera/camera-transform.ts` (367 lines) present |
| #1546 item 2 | `fixedLens` path unreachable | **Open** | `calibration-actions.ts:205-215` passes no `lens` |
| #1546 item 3 | Accuracy reported in-sample | **Open** | `bed-calibration.ts:123-146`. Measured here: on the rings it is honest; off them see Y1-P2-1 |
| #1546 item 4 | Model in origin-dependent coordinates | **Open (by design)** | ADR-440 Amd 1 |
| #1546 item 5 | Same-aspect frame assumed a plain rescale | **Open, now measured** | `camera-model-frame.ts:51-58`. A native 720p sensor crop of a 1080p calibration: 60 mm on target, used with no notice (`m3`) |
| #1546 item 6 | `MIN_POINTS_PER_VIEW` vs free parameters | **Open (latent)** | unchanged |
| #1546 item 7 | Inconsistent private-host policies | **Open** | Y2's area |
| W1-P3-4, V7-P3-1, V8-P3-5 | website wording; target engrave "Before you start"; lesson Pro marks | KNOWN, not re-checked | brief |

## Refuted

None raised and then refuted. Candidates dropped before raising:
- **A stale USB device id silently borrows another camera's calibration.** `requestStream` asks for `deviceId: { ideal }` and falls back to the default camera (`web-camera.ts:45-64,69-79`). The source id, though, is the track's own `getSettings().deviceId` (`web-camera-stream.ts:11`), so the fallback camera is not matched to the first camera's calibration. Holds.
- **A calibration from before cameras were recorded is applied to any camera.** True (`saved-cameras.ts:59-67`; `camera-model-frame.ts:24-25`), but ADR-446 Decision 2 states it ("counts as any camera's own, as it did"). Not raised.
- **Low-contrast target.** Marks at 150 on a 190 sheet with noise σ 6 still calibrated 35/35 at native accuracy. Holds.
- **Strong barrel lens on an A4 sheet.** Refused with "The rings cover too little of the picture…", which names the right fix. Holds.
- **The accuracy map understates the error at the rings.** In about 1,000 rings across 22 cases, 1 ring's colour understated its true error (green against 0.39 mm, off-centre full-bed case). Not raised.

## Verified clean

- **On-target accuracy (L1).** 0.05–0.20 mm worst over 15 cases with the camera centred on or aimed at the sheet, with four independent lens families. The reported average / worst agree with the truth within a few hundredths. At 20 mm material the on-target error stays ≤ 0.25 mm, and the height was recovered within 1 mm, except straight down without a typed height (574 against 560 mm, graded fair as Amd 7 requires).
- **The accuracy map (ADR-441 Amd 1).** Ring colours follow the true error at the rings (above). The saved marks round to the micrometre (`camera-model-accuracy.ts:51-73`).
- **Resolution switch.** A pure resize is exact. Crop-and-scale and another shape are refused with reasons (`m3`).
- **Camera-moved check on non-moves.** Noise, a light at ×1.4 and the gantry moved across the surround all read steady (≤ 0.12 mm). No false alarms.
- **Head camera.** The head position is MPos, or WPos plus WCO (`head-position.ts:27-40`), so an origin change or G92 does not move the camera model. Unhomed means no position, and no overlay. Z away by more than 0.2 mm refuses use (`head-camera.ts:76-83`). `head-position.test.ts` covers WPos+WCO and inch reports.
- **Saved calibrations.** Restart (profile persistence); opening a file for the same machine keeps the machine's calibration (ADR-440 Amd 3, `camera-calibration-open.test.tsx`); a machine switch names "camera calibration" before replacing it (`machine-choice-replaces.ts:35`); records without a bed frame, binding or view reference load with their notices (`CalibrateCameraControls.tsx:79-84`).
- **Failure paths (READ).** Track ended leaves `live`. A refused permission gives `denied`. A busy device (`NotReadableError`) shows an error with a message (`camera-source-actions.ts:205-224`). A failed capture at the photo step says "Could not take a photo. Check that the camera is running." (`calibration-actions.ts:199-202`). Engraving does not need the camera.
- **Vitest:** `src/core/camera`, `src/ui/camera`, `src/ui/state/camera*`: 113 files, 859 tests passed on `f61a0757a` (Node 25, one worker, `NODE_OPTIONS=--no-experimental-webstorage`; `zz-y1/vitest-camera.out.txt`).
- **L12.**
  - #1546 (`02c02616e`): main CI, Browser smoke and Desktop package passed.
  - #1641 (`59d66bb86`): main CI failed on `electron/native-smoke.test.ts`, not camera code.
  - #1649 (`751a0fc32`): CI cancelled by the next push.
  - Both #1641 and #1649 are in `c94993aa4`, whose main CI passed. Their PR heads passed every required check.
  - The tip `f61a0757a` is red on the rotary 1.0.30 golden (`rotary-summary` text) and `workspace-responsive.e2e.ts` (KNOWN v12 rotary work).

## Not verified

- **No browser run.** The wizard, the panel and a stub USB camera were not driven in Chromium. Memory allowed it (≥ 2.8 GB); the choice was time. A fake-device route (Chrome's file-backed fake capture fed a rendered target) would exercise the real `getUserMedia` → capture → wizard path. It is the natural next "camera test".
- **The GPU overlay shader**: its CPU mirror was verified in W4. Placement accuracy on the canvas is Y3's area.
- **Phone camera** end to end: needs the Electron bridge. READ only.
- **Real lenses**: all lenses are synthetic. Autofocus breathing, rolling shutter and JPEG artefacts are not modelled.
- **Moved check on a plain or dark surround**, and on surrounds with depth (enclosure walls above the bed plane). Only a flat textured surround was rendered.
- **Golden returning-user projects carry no camera calibration.** None of the 24 `.lf2.gz` / `.json` goldens in `src/__fixtures__/returning-user` contains `cameraModel`. Loading an older calibration rests on the normaliser unit tests only.

## Repro files

All files are in scratchpad `zz-y1\`. Run them from that folder with `node --import ./register.mjs <script>.mts`. The loader is a copy of `zz-w4`'s, pointed at `j19-main`, with asset and `?query` imports stubbed.

- `truth.mts`: the independent truth cameras and the target / bed / surround renderer.
- `selftest.mts`: truth round-trip and framing.
- `m1-accuracy.mts` → `m1-accuracy.out.jsonl`: the accuracy table's base cases.
- `m2-moved.mts` → `m2-moved.out.jsonl`: the camera-moved check.
- `m3-resolution.mts` → `m3-resolution.out.jsonl`: the resolution change.
- `m4-variants.mts` → `m4-variants.out.jsonl`: off-centre, corner, blur and cover variants.
- `m5-blur-fixture.mts` → `m5-blur-fixture.out.jsonl`: blur on the repo's own renderer.
- `m6-offcentre-map.mts` → `m6-offcentre-map.out.jsonl`: the share of the bed past 1 / 2 / 5 mm.
- `vitest-camera.out.txt`: the Vitest run.

```json
[
  {"id":"Y1-P2-1","severity":"P2","area":"camera-setup-calibration","file":"src/ui/camera/calibrate/calibration-result.ts","line":124,"anchor":"Contract ADR-441 Amd 8 Consequences 'Across the rest of the bed it is within about 1.3 mm'; Amd 4 D4; measured vs ground truth","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Default A4 sheet with a camera 60/100/150 mm off the sheet centre line: graded 'Accurate enough for placing artwork by eye' (ring RMS 0.05-0.09 mm) while the overlay is 7.8/17.8/35.6 mm off at the far bed corner; full-bed sheet 0.7-1.4 mm"},
  {"id":"Y1-P2-2","severity":"P2","area":"camera-setup-calibration","file":"src/ui/camera/helpers/moved-check.ts","line":111,"anchor":"Contract ADR-663 Amd 3 Consequences 'A knocked camera ... is noticed at the next refresh'; measured vs ground truth","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Translation-only edge NCC: roll 1-3 deg (corners 5.4-16.1 mm off), 40 mm slide and 6 deg pitch (57-108 mm) score <0.6 and stay silent; a later weak match publishes 'unknown' and withdraws a showing warning"},
  {"id":"Y1-P3-1","severity":"P3","area":"camera-setup-calibration","file":"src/ui/camera/calibrate/CalibrateCameraControls.tsx","line":76,"anchor":"Contract ADR-441 Amd 4 D4; twin Amd 7 D3 caveat kept in the row","evidence":"READ","verdict":"PENDING","known":false,"summary":"Settings row shows the grade headline 'Accurate enough...' without the 'outside the target is estimated' advice"},
  {"id":"Y1-P3-2","severity":"P3","area":"camera-setup-calibration","file":"src/core/camera/model/view-shift.ts","line":222,"anchor":"Contract ADR-663 Amd 3 Decision (mm at the middle of the bed, warn from 1 mm); measured","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Peripheral pixel shift applied at the bed centre: 2 mm slide reads ~1.4 mm, 5 mm ~2.8 mm; 1-1.4 mm moves silent"},
  {"id":"Y1-P3-3","severity":"P3","area":"camera-setup-calibration","file":"src/ui/camera/calibrate/calibration-result.ts","line":205,"anchor":"Contract ADR-441 Amd 7 (failures name the real cause); twin rings-too-small message","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Blur sigma 1-1.5 px fails as 'discs not found, make sure nothing covers them' or 'no rings'; picture check has no sharpness measure"},
  {"id":"Y1-P3-4","severity":"P3","area":"camera-setup-calibration","file":"src/core/camera/target/missing-outer-band.ts","line":55,"anchor":"Contract ADR-441 Amd 4 D6 (layout mismatch), twin anchors-not-found names the head as a cover","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Covered edge columns (head/clamp) graded rough 'engraved with other settings' with margin advice; true on-target error 0.31 mm"},
  {"id":"Y1-P3-5","severity":"P3","area":"camera-setup-calibration","file":"src/ui/tutorials/placement-tutorials.ts","line":27,"anchor":"Twin wizard default 300x200 sheet (ADR-441 Amd 8 D1); help topic names removed wizards (ADR-441)","evidence":"READ","verdict":"PENDING","known":false,"summary":"Lesson says cover the bed with one sheet; help topic says 'lens calibration, bed alignment'"}
]
```

## Refuter (2026-11-10)

- **Who / when:** fresh refuter, 2026-11-10, 08:40–09:45 +0800. Code: origin/main @ `f61a0757a` (export `j19-main`). `git log f61a0757a..origin/main -- src/core/camera src/ui/camera` is empty; origin/main is now `4c4b98fd0` (#1677, rotary only), so nothing below has moved.
- **Setup notes:** the checkout is on `claude/rolling-audit-v12-j`, not `claude/rolling-audit-v13`; I did not switch. `AREAS.md` does not exist yet in `docs/audits/2026-11-10-rolling-v13/` (only this report), so the scope was taken from this report's header and the brief.
- **Method:** my own truth camera and ray caster (`zz-y1r/truthr.mts`), built without the auditor's `truth.mts` or the repo's `renderTargetScene`:
  - **Lens families:** pinhole; Brown radial k1..k3 plus tangential p1/p2 plus pixel skew; Fitzgibbon division; equisolid fisheye.
  - **Pose and inversion:** look-at plus roll. The inverse is a numeric-Jacobian Newton solve, with a round trip of 1e-10 mm or better (`r0-selftest.out.jsonl`).
  - **Scene:** a slat bed (bright blades every 20 mm on a dark tray), not honeycomb; a chequered frame rail; a block-textured surround; a laser head or clamp as a raised occluder; and a gantry beam. The sheet has a low wood grain.
  - **Rendering:** 2 × 2 supersampling, optics blur σ 0.6 px, Gaussian noise, and optional cos⁴ vignetting or gain.
  - **Chain:** everything goes through the real `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade` / `shareOutsideTarget`, and the real `view-shift.ts` functions wired exactly as `moved-check.ts:87-131`.
  - **Vitest:** one focused spec on the real `checkCameraMoved` and `CameraMovedNotice`, in a scratch copy of the tree (`zz-y1r/tree`, node_modules junction since removed with `cmd /c rmdir`).
- **Memory:** 2.47–2.81 GB free at each check. One Vitest run (1 worker, 1 file), all else Node. No browser, camera, network or hardware.

### Verdicts

#### Y1-P2-1 — CONFIRMED, RE-RATED P2 → **P1**

The extrapolated bed is silently millimetres off under an "Accurate enough" grade. This holds for centred cameras too, not only off-centre ones.

My own cameras use the default 300 × 200 sheet with a 5 mm margin (`camera-calibration-store.ts:147-151`) on the 400 × 400 bed. Material is at the sheet height (3 mm). The true overlay error was measured on a 5 mm grid.

| My case (`r1`, `r1b`, `r1c`) | Rings | Reported avg / worst ring | Grade | Worst on target | Worst on the bed | Share of visible bed > 2 mm |
|---|---|---|---|---|---|---|
| 1280 × 720 Brown (k1 −0.25, k2 0.07, k3 −0.008, p1/p2), **centred**, 36° tilt | 35/35 | 0.055 / 0.158 | good | 0.18 | **2.64** | 0.1 % |
| 3840 × 2160 (4K) same lens, **centred** | 35/35 | 0.033 / 0.076 | good | 0.21 | **2.84** | 0.3 % |
| 1080p same lens, 30° oblique from the back, **centred** | 35/35 | 0.033 / 0.079 | good | 0.21 | **2.62** | 0.1 % |
| 720p strong Brown (k1 −0.31, k2 0.10, k3 −0.012), **centred** | 35/35 | 0.062 / 0.114 | good | 0.29 | **5.23** (bed corner) | 2.8 % |
| 600 × 400 bed, 1080p Brown, **centred** | 35/35 | 0.041 / 0.086 | good | 0.11 | **5.82** (bed corner) | 3.9 % (12.6 % > 1 mm) |
| 720p Brown, 60 mm off-centre | 35/35 | 0.054 / 0.121 | good | 0.32 | 3.77 | 1.0 % |
| 4K Brown, 80 mm off-centre | 35/35 | 0.038 / 0.108 | good | 0.41 | 4.05 | 1.5 % |
| 720p strong Brown, 100 mm off-centre | 35/35 | 0.095 / 0.247 | good | **0.86** | 3.18 | 3.9 % |
| same camera, sheet 300 × 300 (49 rings, two terms) | 48/49 | 0.059 / 0.129 | good | 0.64 | **9.87** (12.04 at 20 mm) | 1.9 % |
| 720p wide pinhole (f 600), 100 mm off-centre | 35/35 | 0.139 / 0.262 | fair (sheet height only) | **1.15** | **11.95** | 6.8 % |
| 720p pinhole, 100 mm off-centre, aimed at the bed centre | 35/35 | 0.052 / 0.106 | fair (sheet height only) | 0.26 | 4.09 | 0.9 % |
| 1080p 30° side mount | 35/35 | 0.039 / 0.098 | good | 0.21 | 1.65 | 0 % |
| 720p division (λ −0.22), 60 mm off-centre | 35/35 | 0.043 / 0.066 | good | 0.09 | 0.75 | 0 % |

- **The finding holds with independent lenses and renderer.**
  - Every row except the division lens and the side mount breaks ADR-441 Amendment 8's "Across the rest of the bed it is within about 1.3 mm".
  - The grades are "good" (or Amd 7's "fair" for a straight-down-like pinhole).
  - The ring colours agreed with the truth at every ring in all of these rows.
- **The magnitude depends on the lens.** The auditor's k1 −0.32 / k2 0.11 lens gave 8–36 mm. My lenses give 2.6–12 mm. Both are 2–25 times the ADR's figure and 10–50 times the 0.25 mm the grade calls "below what anyone can see" (`calibration-result.ts:91-94`).
- **The auditor's "Against P2" premise is refuted.** It said a centred camera stays within the ADR's 1.3 mm. My centred cameras give 2.6 / 2.8 / 2.6 / 5.2 / 5.8 mm. So does my self-test (2.22 mm, `r0-selftest.out.jsonl`).
- **The matrix row "Accuracy off the sheet, centred camera … 0.6–2.1 mm (as ADR-441 Amd 8)" does not hold for my lenses.**
- **A larger sheet is usually, but not always, the fix (`r1c-sheetsize.out.jsonl`).**
  - 300 × 300 cut the far-bed worst from 5.23 to 1.28 mm (strong lens, centred), 2.64 to 0.65 (Brown, centred) and 3.77 to 1.59 (60 mm off).
  - It made the 100 mm off-centre strong lens worse: 3.18 to 9.87 mm. The second lens term (40–59 rings, `bed-calibration.ts:86-95`) extrapolated badly.
  - Any fix must measure the extrapolation, not only steer people to a larger sheet.
- **Does anything warn later? No.** Grep over `src` outside tests:
  - `calibrationGrade`, `rmsErrorMm`, `onlyAtTargetHeight` and the target area are read only in `src/ui/camera/{calibrate,panel,pieces}`, `core/camera/**` and the board-capture circle confirmation.
  - Job Review, Start readiness (`start-job-readiness-policy.ts`), Frame and the overlay never read the calibration's extrapolated share or accuracy.
  - The only signals are:
    - the wizard's one-time advice, which has no size or region and whose fix is wrong (new Y1-P3-6);
    - the accuracy map's dashed outline, only while the map is switched on.
  - The settings row afterwards shows only "Accurate enough for placing artwork by eye." (Y1-P3-1).
- **Why P1 (METHOD §3, no reach clause).** It is a silent position error in KerfDesk's own computed mapping. Artwork placed on the camera picture over material in the outer bed burns 2.6–36 mm from where the material appears. The precedents:
  - 12-P2-2 and 12-P2-1 (camera position error, "Frame is not a warning", corrected to P1 by G6);
  - W4-P2-1 (camera-driven misburn, P1);
  - 12-P2-1 again, which was lowered "by design" and corrected back. So ADR-441 Amd 4's "out of scope: clipping or tinting" does not lower it.
- **The auditor's P2 arguments rebutted:**
  1. "The grade says the picture outside the target is estimated." That is not a warning of the specific mismatch. It gives no size, it names no region, it appears once, and it prescribes a no-op ("A smaller margin measures more of the bed", `:159`). The ADR's own sentence promises ~1.3 mm, so a reader who looks it up is reassured.
  2. Amd 4's out-of-scope list. By design does not lower a P1 by effect (precedent 12-P2-1).
  3. "Visible against the canvas bed outline." A visible result is not a warning (METHOD §3). Material in the outer bed has no reference edge in the picture to compare against.
- **Reach:**
  - The default sheet is the wizard's default.
  - Every camera with a lens beyond about 75° and a 400 mm or larger bed reaches 2+ mm.
  - A 600 × 400 bed with a centred 1080p camera reaches 5.8 mm.
- **Evidence:** REPRO, `zz-y1r/r1-offsheet.out.jsonl`, `r1b-widelens.out.jsonl`, `r1c-sheetsize.out.jsonl`.

#### Y1-P2-2 — CONFIRMED, RE-RATED P2 → **P1**

The knock check misses most knocks, including smaller turns than the auditor found, and it withdraws a correct warning.

My camera: 1280 × 720 Brown (k1 −0.20, k2 0.05, p1), 420 mm up at the back. It was calibrated with the real chain on the default sheet (35/35, 0.097 mm). The surround is 71 % of the thumbnail (block texture, rails). Each "current" frame has different material on the bed. Results are from the real `viewThumbnail` / `surroundMask` / `measureViewShift` / `viewShiftOnBedOffsetMm` (`r2-moved-webcam.out.jsonl`):

| Move | True error: centre / worst bed edge (mm) | Check (score) |
|---|---|---|
| none; light ×1.35; gantry at the front / back | 0.03 / 0.58 (calibration only) | steady 0.00–0.01 mm (0.99–1.00) |
| slide 1.5 / 3 / 5 / 10 mm | 1.5 / 3.0 / 5.0 / 10.0 | moved 1.35 / 2.07 / 3.56 / 7.23 mm (Y1-P3-2) |
| **slide 20 mm** | 20 / 20.3 | **unknown (0.59)** |
| **roll 0.5° / 1° / 1.5° / 2°** | 0.05 / 2.7; 0.08 / 5.3; 0.12 / 8.0; 0.16 / 10.6 | **unknown (0.50 / 0.31 / 0.22 / 0.18)** |
| pitch 1° | 9.8 / 15.9 | moved 9.3 mm |
| **pitch 3°** | **30.1 / 50.1** | **unknown (0.48)** |
| yaw 1° | 8.5 / 11.9 | moved 10.0 mm |
| **knock: slide 6 mm + roll 1°** | 5.9 / 9.5 | **unknown (0.36)** |
| **knock: pitch 2° + yaw 1°** | 21.6 / 38.7 | **unknown (0.55)** |
| camera drops 5 mm | 2.9 / 6.0 | moved 3.0 mm |
| **focus breathing +1 % / +2 %** | 0.02 / 3.9; 0.07 / 7.3 | **unknown (0.46 / 0.31)** |

- **This is worse than the auditor measured.**
  - A **0.5°** roll is already silent here; the auditor's warned.
  - A 3° pitch that puts the bed **centre** 30 mm off is silent. So "the picture looks right where people look first" is not the only failure mode.
  - Focus breathing of 1–2 %, which a phone or autofocus webcam can do (ADR-448 D5 asks for focus locked "where the app allows"), is silent at 3.9–7.3 mm.
- **The withdrawal, reproduced on the real store and notice.** The Vitest spec `tree/src/ui/camera/helpers/zz-y1r-withdraw.test.tsx` (my own block-texture scene, not the repo's sinusoid fixture; log `zz-y1r/r5-withdraw.vitest.txt`, 1 passed):
  - `checkCameraMoved` on a 12, −7 px slide returns `moved`, and `CameraMovedNotice` renders "The camera may have moved…".
  - A further bump (+6 px and a 1.5° turn) returns `unknown`, and the notice then renders nothing.
  - With the panel open, no toast was ever pushed (`moved-check.ts:156-171` toasts only when the panel is closed). The operator who did not read the panel at that moment has nothing left.
- **Does anything else warn? No.** No Start, Job Review or Frame code reads `useCameraMovedStore` (grep: only `moved-check.ts`, `CameraMovedNotice.tsx` and `install-camera-helpers.ts`). `unknown` and `steady` look identical in the UI: nothing shown.
- **Why P1.**
  - ADR-663 Amendment 3, Consequences, promises "A knocked camera or a lid that closes differently is noticed at the next refresh, before a job burns in the wrong place".
  - Measured: every knock other than a small pure slide, ≤1° pitch or yaw, or a drop is silent, at 2.7–50 mm.
  - The app also actively withdraws a correct, showing warning on the next weaker match while the camera is still (more) displaced. The burn then lands 5–50 mm off with no warning present.
  - The auditor's P2 arguments rebutted:
    - "Silence on a weak match is announced": the Decision's "says nothing" contradicts the Consequences' knock promise, and an announced design does not lower a P1 by effect (12-P2-1 precedent).
    - "The helper only advises": an advisory that is absent at output is no warning.
    - "Large knocks are visible": not a warning (METHOD §3).
  - For the meta audit: the strongest P1 core is the **withdrawal** (an app action that removes a true warning before the misplaced burn). If the meta audit holds that silence alone, where the move is caused by a physical knock, is a detection gap rather than "produces wrong output", the never-warned part would be P2. I rate the finding P1 as a whole.
- **Evidence:** REPRO, `zz-y1r/r2-moved.mts` → `r2-moved-webcam.out.jsonl`; `zz-y1r/r5-withdraw.vitest.txt`.

#### Y1-P3-1 — CONFIRMED, P3

READ: `CalibrateCameraControls.tsx:74-77` prints `calibrationGrade(model).headline` only.
- The Amd 7 twin holds because its caveat is in the headline ("Lined up at the height of the … sheet only").
- The extrapolation caveat lives in `.advice` and is dropped.
- All my cases above would read "average error 0.03–0.10 mm. Accurate enough for placing artwork by eye." in Camera settings.
- It stays P3 as wording. It is one link in Y1-P2-1's no-signal chain.

#### Y1-P3-2 — CONFIRMED, P3

My slides read at 0.69–0.90 of the true move: 1.5 → 1.35, 3 → 2.07, 5 → 3.56, 10 → 7.23 mm (`r2-moved-webcam.out.jsonl`).
- By interpolation a slide of about 1.1 mm or less reads under 1 mm and stays silent, against Amd 3's 1 mm threshold "at the middle of the bed".
- Pitch, yaw and drop are close to the centre's true value (9.3 vs 9.8, 10.0 vs 8.5, 3.0 vs 2.9 mm). They are understated against the edges (15.9, 11.9, 6.0 mm), which the auditor's fix (report the worst bed-corner displacement) also covers.

#### Y1-P3-3 — CONFIRMED, P3

On my renderer (`r4-p3.out.jsonl`):
- 720p, blur σ 0.8 / 1.0 px: calibrates (35/35).
- 720p, σ 1.3 / 1.6 / 2.2 px: `anchors-not-found`, "The three solid discs … were not found. Make sure nothing covers them, including the laser head."
- 1080p: σ 1.6 calibrates; σ 2.4 fails the same way.
- `picture-quality.ts` measures brightness and mm per pixel only (READ).
- The onset differs from the auditor's (σ 1–1.5), but the wrong cause is named in every failing case.

#### Y1-P3-4 — CONFIRMED, P3

A dark head block 60 mm up over the target's left columns (`headOverLeftColumns-720`):
- 30/35 rings found, graded rough: "These rings look like a target engraved with other settings … 6 × 5 grid, but the layout assumed has 7 × 5", with margin advice.
- The true on-target worst is 0.40 mm.
- A 40 mm clamp 25 mm up over the right column hid no ring centre and graded good (35/35).

#### Y1-P3-5 — CONFIRMED, P3

READ:
- `placement-tutorials.ts:14` reads "a flat sheet of scrap that covers the bed".
- `:27` reads "cover the bed with one flat sheet".
- `:29` reads "Rings are engraved across the bed".
- `command-help-topics.ts:109` reads "lens calibration, bed alignment".

Given Y1-P2-1 and `r1c`, the lesson's full-bed advice is the more accurate one. The fix should reword the wizard and tooltip, not the lesson alone.

#### KNOWN #1546 item 5 (same-aspect frame treated as a plain rescale) — RE-RATED to **P1**, recorded as Y1-P1-1 (below)

### Challenges to "Verified clean" and "What holds"

- **On-target accuracy 0.05–0.20 mm.**
  - Holds for centred or aimed cameras: 0.10–0.29 mm in my renders.
  - It fails for off-centre cameras from 60 mm, not only at the auditor's 150 mm. The on-target worst between and beside the rings is 0.66 / 0.86 / 0.89 / 1.15 mm while the reported worst ring is 0.13–0.26 mm (pinhole off 60/100, strong Brown off 100, wide pinhole off 100).
  - The in-sample ring figure understates the target area itself by 3–5 times. Folded into Y1-P2-1.
- **Accuracy off the sheet for a centred camera.** Refuted for my lenses: 2.2–5.8 mm against the matrix's "0.6–2.1 mm (as ADR-441 Amd 8)" (Y1-P2-1 table).
- **Ring colours (~1,000 rings, 1 mismatch).** Holds broadly:
  - About 1,260 rings over my 30 calibrations: 5 understated, all in the 600 × 400 full-bed case (150 rings, average 0.163 mm, true on-target worst 0.82 mm against a reported worst ring of 0.569).
  - The map is honest at the rings. It is silent off them.
- **Resolution resize.** Holds: a pure resize to 1280 × 720 reproduces native accuracy exactly (0.16 on target, 2.62 bed worst; `r3-frame.out.jsonl`). Crop-and-scale and 4:3 refusals were not re-run (READ: `camera-model-frame.ts:39-58`).
- **The moved check's false-alarm rate.** Holds: no move, light ×1.35, and the gantry front or back all read steady at ≤ 0.01 mm. Its miss rate is Y1-P2-2.
- **Persistence (restart, file open, machine switch) and the head camera's jog / origin following.** Not re-verified by the refuter. READ of `head-position.ts` is consistent with the auditor; no new input was tried.
- **New inputs:**
  - **Strong vignetting:** 85 % cos⁴ falloff with noise σ 4, or gain 0.35. Calibrates 35/35, 0.13 mm on target. Holds.
  - **4K sensor:** holds on target (0.21 mm). Off target 2.84 mm centred, 4.05 mm at 80 mm off (Y1-P2-1).
  - **Camera 30° oblique:** from the back, 2.62 mm off target, graded good (Y1-P2-1); from the side, 1.65 mm.
  - **Off-square bed (600 × 400):** centred camera 5.82 mm and 12.6 % of the bed over 1 mm, graded good (Y1-P2-1). The full-bed sheet brings it to 0.94 mm.
  - **Phone with autofocus breathing (ADR-448):**
    - A 1 % / 2 % focal change leaves the frame size unchanged, so the binding matches and the model is used: 2.0 / 3.9 mm on target, 3.7 / 7.6 mm on the bed (`r3-frame.out.jsonl`).
    - The moved check reads `unknown` (`r2`).
    - A 1.25× app zoom gives 38 mm on target, used silently.
    - ADR-448 Decision 5 asks for "no zoom" and focus locked "where the app allows", so this is not raised separately. It is evidence for Y1-P2-2: the one check that could see it is silent.
  - **Rolling shutter skew:** not modelled. A fixed camera photographing a still bed has no motion for the shutter to skew. Only a camera shaking during the photo would, and that was not rendered.
  - **Several cameras per machine (ADR-446).** Holds as announced (READ):
    - `ownModelFor` (`saved-cameras.ts:59-67`) gives an unbound pre-binding calibration to any camera, and `cameraModelForFrame` treats a record without `capture` as `match` (`camera-model-frame.ts:24-25`). Announced by ADR-446 D2, not reproduced, not raised.
    - Identical USB webcams swapped between ports could exchange browser device ids and therefore calibrations. Not verified (see below).
- **Lens-folds message "names the right fix".** Partly: "Engrave a larger target (a smaller margin, …)" (`calibration-result.ts:216`). On the default sheet the margin is already 5 mm, so the parenthesis is a no-op (Y1-P3-6).

### New findings

#### Y1-P1-1 — A frame of the calibrated shape but another size is used as a plain rescale even when it is a sensor crop: 62 mm off on the target, with no notice (KNOWN #1546 item 5, re-rated)

- **Where (f61a0757a):**
  - `src/ui/camera/camera-model-frame.ts:39-58`: only `crop-and-scale` is refused.
  - `src/core/camera/camera-capture-binding.ts:83-89`: the geometry match is an aspect ratio within 0.001 for `none` / `unknown`.
  - `src/core/camera/model/camera-model-record.ts:63-75`: `lensForFrame` scales.
  - USB asks for `ideal` 1920 × 1080 (`web-camera.ts:71-72`), so a camera that cannot give it falls back to another mode silently. A phone or machine-JPEG source is `unknown` and serves whatever size its app is set to.
- **Anchor:** ADR-440 §5: "Another shape, a frame from another camera, … or a changed crop is reported and not drawn or traced". A sensor crop is a changed crop, but it is not reported. Measured against ground truth.
- **Scenario:**
  1. A 1080p calibration is saved.
  2. The camera now delivers 1280 × 720 that is the sensor's centre window, for either the USB source (`resizeMode: 'none'`) or a phone source (`unknown`).
  3. `cameraModelForFrame` returns `ok` with the lens scaled by 2/3.
  4. The overlay is 0.67 mm off at the bed centre, **62.0 mm** at the target's edge and 116.7 mm on the bed (`r3-frame.out.jsonl`, my own 1080p Brown camera, 30° oblique). The auditor's renderer gave 60 mm.
  5. Nothing is shown. The moved check would compare a differently scaled view and fall to `unknown` (Y1-P2-2).
- **Severity: P1.** It is a silent position error, and a visible 60 mm misfit is not a warning (METHOD §3).
  - The code path is reachable today for any source whose size changes at the same aspect.
  - Whether common UVC webcams or phone apps crop rather than scale at a lower same-aspect mode is **UNVERIFIED** (no network; W4 found no primary source either).
  - If the maintainer confirms that no supported source crops at the same aspect, it is latent: P3.
  - Narrow reach otherwise does not lower it (METHOD §3).
- **Novelty:** KNOWN as #1546 architecture item 5, never rated. The 60 / 62 mm measurements (Y1, refuter) are new. Counted under P1, not KNOWN.
- **Fix direction:** treat any size change of a `none` / `unknown` source as needing confirmation: a Check camera ring, or the view-reference comparison at the new scale. Or store the sensor field of view (the matching bed corners' pixels) and refuse when a re-detected target or surround does not scale.

#### Y1-P3-6 — The extrapolation advice prescribes a fix that cannot help: "A smaller margin measures more of the bed"

- **Where (f61a0757a):**
  - `src/ui/camera/calibrate/calibration-result.ts:159` (bed camera).
  - `:216` (lens-folds: "(a smaller margin, …)").
- **Anchor:**
  - ADR-441 Amendment 8 D1 made the sheet size the lever ("The target step asks for Sheet width and Sheet height"). The margin is inside the sheet, 5 mm by default (`camera-calibration-store.ts:147`).
  - Twin: the head-camera branch at `:158` correctly says "A larger target size measures more of it".
- **Scenario:**
  1. In every default-sheet calibration above, the result says about 58–76 % of the bed is estimated and suggests a smaller margin.
  2. Going from 5 mm to 0 mm adds about 10 mm to each side of a 290 × 190 area, which is a small fraction of the estimated bed.
  3. The size of the sheet, the change that does help in most cases (`r1c`), is not mentioned.
- **Severity:** P3, wording. It is the only signal for Y1-P2-1, so its fix belongs with it.
- **Announced?** No. **Novelty:** new (stale since Amd 8).
- **Fix direction:** "A larger sheet measures more of the bed" with the size that would cover the camera's view. Drop the margin parenthesis in the lens-folds message for a part-bed sheet.

### Not verified

- **Reach of Y1-P1-1:** whether real UVC webcams or phone camera apps deliver a same-aspect lower mode as a sensor crop. Not checked: no network allowed.
- **Chrome device ids for identical USB webcams:** whether they follow the USB port, so that swapping two of them hands each the other's calibration with a `match` binding. No source fetched. If true, it is a P1 candidate in the same class as H6-P3-3 (address-keyed identity).
- **Full-bed sheet `anchors-unclear`:** on my renderer the full-bed sheet failed for 2 of 7 cameras:
  - the moved-check webcam, f 640, 420 mm up;
  - the strong Brown lens 100 mm off-centre.

  The other five calibrated 89–150 rings. This may be my renderer's far, foreshortened rings losing their holes, so it is not raised. It matters to Y1-P2-1's fix direction (a full-bed sheet as the cure).
- **Lid fisheye at 1280 × 960, 260 mm up:** refused `rings-too-small` (8.1 px), with the right message. A 16 mm ring was not tried.
- **Not run:** browser, real lenses, JPEG artefacts, head camera, persistence across restart, file open and machine switch, the GPU overlay shader, and crop-and-scale / 4:3 refusals (READ only).
- **Moved check with a plain or dark surround, or a surround with depth:** not rendered (same gap as the auditor).

### Repro files

All are in scratchpad `zz-y1r\`. Run them from there with `node --import ./register.mjs <script>.mts > <out>`. `register.mjs` and `ts-resolve.mjs` are copies of `zz-y1`'s loader, pointed at `j19-main`.

- `truthr.mts`: the refuter's own truth cameras (pinhole, Brown with k3, tangential and skew, division, equisolid), the look-at / roll / move pose, and the ray caster (slat bed, rails, block surround, occluders, gantry, vignetting, blur, noise).
- `harness.mts`: the real calibration chain, the overlay-error survey and the ring-colour check.
- `r0-selftest.mts` → `r0-selftest.out.jsonl`: round trip, orientation, one centred calibration.
- `r1-offsheet.mts` → `r1-offsheet.out.jsonl`, `r1b-widelens.mts` → `r1b-widelens.out.jsonl`, `r1c-sheetsize.mts` → `r1c-sheetsize.out.jsonl`: Y1-P2-1 and the sheet-size comparison.
- `r2-moved.mts` → `r2-moved-webcam.out.jsonl`: Y1-P2-2 and Y1-P3-2.
- `r3-frame.mts` → `r3-frame.out.jsonl`: Y1-P1-1, resize, zoom and focus breathing.
- `r4-p3.mts` → `r4-p3.out.jsonl`: Y1-P3-3, Y1-P3-4, vignetting, dim light, straight down with a typed height.
- `tree\src\ui\camera\helpers\zz-y1r-withdraw.test.tsx` → `r5-withdraw.vitest.txt`: the real withdrawal. The tree is a scratch copy; its node_modules junction has been removed.

```json
[
  {"id":"Y1-P2-1","severity":"P1","verdict":"RE-RATED","from":"P2","evidence":"REPRO (refuter, own renderer)","summary":"Default 300x200 sheet: far bed 2.6-5.8 mm off for CENTRED cameras (4K, 30 deg oblique, 600x400 bed) and 3-12 mm off-centre, graded 'Accurate enough'; ADR-441 Amd 8 says ~1.3 mm; no later signal (Job Review/Start/overlay read no accuracy); advice prescribes a no-op"},
  {"id":"Y1-P2-2","severity":"P1","verdict":"RE-RATED","from":"P2","evidence":"REPRO (refuter, own scene + real checkCameraMoved/CameraMovedNotice Vitest)","summary":"Silent (unknown) on roll 0.5-2 deg (2.7-10.6 mm), pitch 3 deg (30/50 mm), 20 mm slide, combined knocks, focus breathing 1-2 %; a later weak match withdraws a showing warning (reproduced); nothing at Start reads the state"},
  {"id":"Y1-P3-1","severity":"P3","verdict":"CONFIRMED","evidence":"READ"},
  {"id":"Y1-P3-2","severity":"P3","verdict":"CONFIRMED","evidence":"REPRO","summary":"slides read at 0.69-0.90 of true (1.5->1.35, 3->2.07, 5->3.56, 10->7.23 mm)"},
  {"id":"Y1-P3-3","severity":"P3","verdict":"CONFIRMED","evidence":"REPRO","summary":"blur sigma 1.3-2.2 px (720p), 2.4 px (1080p) -> anchors-not-found 'make sure nothing covers them'"},
  {"id":"Y1-P3-4","severity":"P3","verdict":"CONFIRMED","evidence":"REPRO","summary":"head over left columns: 6x5 of 7x5, rough 'engraved with other settings', true on-target 0.40 mm"},
  {"id":"Y1-P3-5","severity":"P3","verdict":"CONFIRMED","evidence":"READ"},
  {"id":"Y1-P1-1","severity":"P1","verdict":"NEW (re-rate of KNOWN #1546 item 5)","file":"src/ui/camera/camera-model-frame.ts","line":51,"evidence":"REPRO; reach UNVERIFIED","summary":"1080p calibration used on a same-aspect 720p sensor crop (usb 'none' or phone 'unknown'): 62 mm on target, 117 mm on bed, no notice"},
  {"id":"Y1-P3-6","severity":"P3","verdict":"NEW","file":"src/ui/camera/calibrate/calibration-result.ts","line":159,"evidence":"READ + REPRO (advice text in every r1 case)","summary":"Extrapolation advice says 'A smaller margin measures more of the bed' (default margin 5 mm inside the sheet); the lever since ADR-441 Amd 8 is sheet size; lens-folds message likewise"}
]
```

Refuter counts: raised 2, refuted 0, P1 3, P2 0, P3 6, known 20
