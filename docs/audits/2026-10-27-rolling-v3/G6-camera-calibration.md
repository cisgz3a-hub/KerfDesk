# Rolling audit v3 — Camera and calibration

- **When:** 2026-10-27 10:00–10:40 +0800   **Tree:** origin/main @ `9a2bf6b13` (worktree HEAD `10354f540`; `git diff 9a2bf6b13 HEAD -- src electron` is empty)
- **Scope:** `src/ui/camera`, `src/core/camera`, `src/ui/calibration`, `electron/camera-*`.
  - Changes since rolling v2: the 21 first-parent merges from `git log --first-parent --since=2026-10-21T00:00 origin/main -- <paths>`. Each diff was read in these paths.
    - The camera redesign (ADR-663 and Amd 1–3): #1394, #1396, #1402, #1405.
    - Camera frame fixes (ADR-440 Amd 1, ADR-449 Amd 1, ADR-490 Amd 1): #1373.
    - Fold guard, home-first and target on the canvas (ADR-440 Amd 2, ADR-441 Amd 5–7, ADR-228 Amd 1): #1432.
    - Target sheet (ADR-441 Amd 8): #1434.
    - Bridge identity and frameless calibrations (ADR-141 Amd 2, ADR-440 Amd 4): #1441.
    - Tone calibration UI (ADR-670): #1442, merged without CI, and its CI fix #1449.
    - Smaller follow-ups: #1427, #1429, #1370, #1423, #1411, #1362, #1386.
  - Read alongside, outside the paths:
    - #1437 (ADR-440 Amd 3, `src/ui/state/project-bed-reconciliation.ts`);
    - the jig trace (ADR-633, #1292), which uses no camera model;
    - `src/ui/state/camera-store.ts`, `native-bed-frame.ts` and `project-actions.ts`;
    - `src/ui/app/ProjectBedReconciliationBanner.tsx`;
    - `src/ui/laser/start-job-readiness-policy.ts`.
- **Lenses run:** L8 (main lens), L4, L3, L2.
  - L2 was light. Rec. 601 luma weights and the Sobel kernels were checked against their standard forms in the code. No finding rests on an outside source, and no new source was fetched. The OpenCV fisheye claims were verified in rolling v2 and are unchanged, apart from ADR-440 Amd 2's added fold guard.
  - L5 was not assigned. The bridge keys of ADR-141 Amd 2 were read only for identity and routing; G7 owns `electron/**`.
  - Repros: three temporary Vitest files using the real stores and the real fit on a rendered target photo, plus five existing test files. All of them were deleted afterwards (see the Evidence lines).
- **Counts:** 6 raised → 0 refuted → P1 2 / P2 2 / P3 2 (+ 5 KNOWN re-observed).
- **Refuter (2026-10-27, fresh context):** 6 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. Severity changes: G6-P2-1 P2 → P1, G6-P2-3 P2 → P1 and G6-P3-3 P3 → P2 (IDs kept for traceability). G6-P2-2 stays P2, narrowed: the swap itself is ADR-440 Amd 3's stated design, and the defect is the machine notice. Own repros `zz-g6r-*` (four focused Vitest files, real stores, real fit on a rendered photo) were run with `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`, then deleted.
  - **The Frame question, for all three P2s.** Start always needs a completed Frame of the exact job (PROJECT.md non-negotiable 21; `required-frame-readiness.ts:24-36`), so a Frame always runs before the burn. Nobody has to offer it. But it is a beam-off jog of the job's box (`frame-verification.ts:3`), and nothing in Frame or Job Review compares it with the camera picture. With Absolute Coordinates, a camera-placed job gets no camera text in Job Review (`start-job-readiness-policy.ts:83-90` speaks only for a relative Start from).
  - **So the Frame is not a warning.** It shows the true box, and the operator has to spot a 6–10 mm gap from the material with no prompt to look. ADR-228 Amd 1's Context says the same about the sibling camera mismatch ("Only the Frame shows this, and only to an operator who is watching where the head goes") and adds a Job Review warning for it. Neither §3 ground for keeping a P1 below P1 is met where nothing else warns.
  - **Precedent conflict (for the coordinator).** Three earlier ratings contradict §3 as clarified on 2026-10-23:
    - 12-P2-2 "stays P2" because it "needs a Machine Setup correction after calibrating" (reach, which §3 excludes) and "Frame still shows the true outline" (neither ground);
    - M2-P3-3 was raised only to P2, for the same consequence;
    - M6-P3-1 restored 12-P2-1 to P2 for a silent 6 mm swap.

    By the reasoning above, 12-P2-2, M2-P3-3 and 12-P2-1 are P1 by effect. All three are fixed (#1373, ADR-440 Amd 4, #1437), so the correction is to the record only.

## Headline

The week's camera fixes hold on the paths they patched. Every live camera consumer now reads the calibration through the bed-frame layer, which refuses a frameless calibration or an origin change and moves a framed one exactly. The bed-frame maths agrees with the burn's own scene → native mapping for all five origins. Three siblings slipped past.

- **G6-P2-1.** **Add target to canvas** records the bed frame when the rings are *added*, while they burn later through an ordinary Start. Machine Setup changed in between gives a calibration that is off by the change (10 mm in the repro), and the panel says "KerfDesk moves its picture 10 mm to match the machine". An offline add followed by a homed burn gets the false "not homed" note.
- **G6-P2-2.** #1437 keeps the machine's calibration only when the opened file has the same bed size. A file saved before a bed correction swaps in its older calibration (6 mm off in the repro) behind a machine banner that names the same machine twice. "Use project machine" plus one edit loses the newer calibration for good, which is the loss ADR-440 Amd 3 was written to stop. *(Refuter: Amd 3 Decisions 1 and 4 make the swap and that loss the stated design for a file whose bed size differs. What is wrong is the notice, which cannot tell the two machines apart.)*
- **G6-P2-3.** A head camera's stitched bed picture is frozen in scene millimetres. It does not follow a bed-size change that moves every live model. After an origin change it is still drawn, mirrored against the burn, although ADR-440 Amd 1 refuses the model there.

## Findings

### G6-P2-1 (P1 after refuter) — "Add target to canvas" records the bed frame at add time, not at the burn; a Machine Setup change in between gives a silently offset calibration
- **Where:**
  - `src/ui/camera/calibrate/calibration-actions.ts:164`. `addCalibrationTargetToCanvas` remembers the target with `cameraBedFrameFor(device, useLaserStore.getState())`, the frame at the click. Its twin `engraveCalibrationTarget` reads the frame at `:100` and streams the target right away.
  - `src/ui/camera/calibrate/assumed-target.ts:83`. The photo labels the rings with the remembered area and that frame.
  - `src/core/camera/model/camera-bed-frame.ts:58-63` then moves the fit by `bedFrameShift(remembered, now)`.
- **Anchor:**
  - Contract: ADR-440 Amd 1, Decision 1: "The frame is the one the target's rings were placed in." It continues "For **Engrave target** it is the frame at engraving". ADR-441 Amd 5, Decision 3, bullet 4: "It remembers the layout and bed frame as an engraved target, then minimises the wizard at the photo step". The rings are engraved later, "like any job".
  - Twin: the wizard's Engrave target records the frame at the Start it triggers; the canvas target does not.
- **Scenario:**
  1. A front-left 400 × 400 machine. The operator chooses **Add target to canvas**. That button exists so the target can be added while disconnected.
  2. Before burning, they correct Machine Setup to 400 × 410. The locked rings keep their scene positions, so they now burn 10 mm further from the front.
  3. They Frame and Start the rings, then take the photo. The fit labels the rings in the remembered 400 × 400 frame. The model in use is then moved +10 mm for the 410 bed, on top of rings that were already burned in it.
  4. The overlay draws every mark 10 mm from where it is, and artwork placed on it burns 10 mm away. The Camera panel says "KerfDesk moves its picture 10 mm to match the machine as it is set up now".
  5. Check camera labels the rings in the same saved frame, so it reports no drift.
  - The ordinary variant: the target is added offline, so no native offset is known. Then the operator connects, homes (on the Falcon A1 Pro the vendor contract gives offset (0, 0)) and burns. The saved calibration carries ADR-441 Amd 5's note: "The camera was calibrated before KerfDesk knew where the machine coordinates sit on the bed (the machine was not homed …)". That note is false here, and recalibrating the same way brings it back. A later native-offset change also cannot move the picture, because the recorded offset is unknown.
- **Evidence:** REPRO in `src/ui/camera/calibrate/zz-g6-canvas-frame.test.ts` (deleted). It runs `node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false` with `NODE_OPTIONS=--no-experimental-webstorage` against the real store, `addCalibrationTargetToCanvas`, `updateDeviceProfile({bedHeight: 410})`, `currentAssumedTarget` and `photographTarget` on a rendered 960 px photo of the rings at their burned positions (`wideLens`, `overheadPose`, the fixtures of `calibration-actions.test.ts`). Output:
  - The rings are unchanged on the canvas: `true`. The assumed source is `engraved`, with frame `{"origin":"front-left","bedWidthMm":400,"bedHeightMm":400}`; the frame now is `…"bedHeightMm":410}`.
  - Ring scene (20, 220) burns at machine (20, 190); the remembered frame says (20, 180).
  - The fit has rms 0.113 mm, and the record's frame is 400 × 400. The panel note is "…calibrated on a 400 × 400 mm bed. KerfDesk moves its picture 10 mm…".
  - A mark at machine (200, 210) is drawn at scene (200.00, 210.04), and artwork placed there burns at machine (200.0, 199.96). A mark at (60, 70) burns at (60.05, 60.04).
  - Offline variant: the frame recorded at add has no `nativeToBedOffsetMm`, the frame at the burn has `{"x":0,"y":0}`, and `cameraBedFrameNote` returns the "before KerfDesk knew … not homed" note.
- **Severity:** P2. The effect is a silent position error, so it is P1 by effect. This follows the precedent of 12-P2-2 and M2-P3-3, which were rated P2 for the same consequence because Frame traces the true outline before Start. Only the frame-change variant reaches that effect; the ordinary variant is a misleading note.
- **Refuter:** **CONFIRMED (REPRO); severity P2 → P1.**
  - **What would make it false:**
    - something that re-stamps the frame when the locked rings stream;
    - the remembered target being dropped after a frame change;
    - the rings moving with the bed;
    - a warning before the burn.

    None exists. `onCanvas` is read only for the wizard's wording (`assumed-target.ts:78`). The memory is keyed on profile id or name alone (`engraved-target-memory.ts:112`). `updateDeviceProfile` leaves the scene alone.
  - **REPRO** (`zz-g6r-canvas.test.ts`, deleted). It used the real store and `addCalibrationTargetToCanvas` with the default A4 sheet, then `updateDeviceProfile({bedHeight: 410})`, then `currentAssumedTarget` → `photographTarget` on a rendered 960 px photo of the rings 10 mm further back. Output:
    - The rings are unchanged on the canvas (`true`), and Start from is `absolute`. Ring corner (55, 105) burns at machine (55, 305), while the remembered frame says (55, 295).
    - The assumed target is `engraved` in frame 400 × 400. The fit has rms 0.108 mm, and the record's frame is 400 × 400.
    - The panel says: "KerfDesk moves its picture 10 mm to match the machine as it is set up now".
    - Marks at machine (200, 210), (60, 70) and (340, 300) are drawn where artwork burns at (199.99, 199.91), (59.98, 59.96) and (340.10, 290.09), 10 mm off each time.
    - Control: the same photo fitted with the frame at the photo puts the mark at (199.99, 209.91).
  - **Contract.** ADR-441 Amd 5 Decision 3 does say the button "remembers the layout and bed frame", so the code follows its letter. ADR-440 Amd 1 Decision 1 ties the record to the frame "the target's rings were placed in", and this target's rings are placed at the burn. Amd 5 never weighs a change in between, so the twin and the Amd 1 anchor stand.
  - **The only on-screen hint** is the wizard's layout line "(the bed is now 400 × 410 mm)", which is the correct note for a wizard-engraved target and warns of nothing.
  - **Severity under §3: P1.**
    - The output is wrong. Artwork placed on the material as pictured burns 10 mm away, which is a position error. The overlay exists so "artwork can be placed over the real material" (`WorkspaceCameraOverlay.tsx:5-7`; WORKFLOW F-CAM3).
    - No warning comes before it. The panel's note asserts the picture was moved "to match", Check camera reads the same saved frame (0 drift), and the moved check was just reset by the calibration. The mandatory Frame shows the true box but is not a warning (see the header).
  - **The offline variant** (a false "not homed" note) follows from `camera-bed-frame.ts:127-129` (READ). On its own it is only a misleading note. ADR-441 Amd 5's Consequences accept a needless, conditionally worded note for a related case, so it adds nothing to the severity.
  - **Novelty:** not in `docs/audits/`, and there are no open PRs (`gh pr list --state open` is empty).
  - **Fix-direction caveat:** the frame at the photo is right only when nothing changed between the burn and the photo. Stamping it when the locked target streams is exact.
- **Fix direction:** Remember the canvas target without a frame. Stamp the frame when that target's rings actually stream, by recognising the locked target scene at Start, or simply take the frame at the photo. Alternatively, refuse the remembered target once today's frame differs from the one recorded at add time.

### G6-P2-2 — #1437 keeps the machine's calibration only for an identical bed size; opening a file saved before a bed correction swaps in its older calibration, and "Use project machine" loses the newer one for good
- **Where:**
  - `src/ui/state/project-bed-reconciliation.ts:91`. `withCurrentMachineCamera` returns the file's device when `deviceIdentity` differs. Per `:134`, that identity is profile id | name | bedWidth | bedHeight.
  - `src/ui/app/ProjectBedReconciliationBanner.tsx:13`. The banner names the opened and current machines and says nothing about the camera.
  - `src/ui/state/project-actions.ts:150`. `acceptOpenedProjectMachine` only dismisses the banner.
- **Anchor:**
  - Contract and its context, ADR-440 Amd 3. The Context describes the loss: "The next machine edit then saves the file's profile, without the calibration, as the app's machine, and the calibration is gone for good." Decision 1 keeps the calibration only for the "same profile id, name and bed size". Decision 4: "A file for another machine still brings its whole machine, calibration included, behind the machine notice."
  - Twin: ADR-440 Amd 1 treats a bed-size change as the same camera and re-expresses the calibration exactly. Its Decision 2: "The model in use (`activeCameraModel`) is read through this, so every camera feature follows it". Amd 3 treats the same change as another machine.
- **Scenario:**
  1. The operator calibrates on 1 Oct, saves projects, then corrects the bed from 400 × 400 to 400 × 410.
  2. The camera is knocked, and they recalibrate on 25 Oct.
  3. They open a project saved on 1 Oct. The bed sizes differ, so it is "another machine". The banner reads "Opening it selected "Creality Falcon A1 Pro" instead of the current "Creality Falcon A1 Pro"", the same name twice. No camera toast appears.
  4. While the banner is up, the overlay uses the 1 Oct calibration, 6 mm off.
  5. If they press **Use project machine**, which reads as harmless when both names are the same, the next machine edit persists the old calibration. The 25 Oct one is gone. **Keep current machine** does restore it.
- **Evidence:** REPRO in `src/ui/app/zz-g6-open-bed.test.tsx` (deleted). It used the real store and `useMachineProfilePersistence`, mounted as in `camera-calibration-open.test.tsx`. Output:
  - Before Open, the model in use is `2026-10-25T12:00:00.000Z`. The Open result is `loaded`.
  - The notice is `{"machineChanged":true,"opened":"Default 400×400","previous":"Default 400×400"}`.
  - After Open, the model in use is `2026-10-01T12:00:00.000Z` with bed 400, and the toast list is `[]`.
  - A mark at machine (200, 200), seen by the moved camera, is drawn at scene (194.00, 200.00) and burns at machine (194.00, 200.00).
  - After `acceptOpenedProjectMachine()` and one `updateDeviceProfile`, `loadLastMachine` holds the 1 Oct calibration.
- **Severity:** P2. A clear but camera-silent banner comes first, so this is not P1. It mirrors 12-P2-1, which M6-P3-1 restored to P2. The refuter may judge it a design call under Amd 3 Decision 4.
- **Refuter:** **CONFIRMED (REPRO), narrowed; severity stays P2.**
  - **REPRO** (`zz-g6r-open.test.tsx`, deleted). It used the real store and a mounted `useMachineProfilePersistence`. A framed calibration was made on 23 Oct at 400 × 400 and saved with a file. The bed was then corrected to 410, the camera knocked 6 mm, and a recalibration made on 25 Oct in the 410 frame. Then the 23 Oct file was opened. Output:
    - The notice is `{"machineChanged":true,"workspaceMismatch":false,"opened":"Default 400×400","previous":"Default 400×400"}`. The banner reads "Opening it selected “Default 400×400” instead of the current “Default 400×400”."
    - No toast appears.
    - The model in use is the 23 Oct one. Machine (200, 200) is drawn at scene (194.00, 200.00) and burns at (194.00, 200.00).
    - **Keep current machine** restores the 25 Oct calibration and the 410 bed. **Use project machine** plus one edit leaves `loadLastMachine` with the 23 Oct calibration *and* bed 400.
    - The moved check cannot catch it. `saveViewReference` keeps one reference per camera (`view-reference.ts:20-25`), and `hasViewReference(23 Oct)` is `false` after the recalibration.
  - **Amd 3 Decision 4 does make the swap intended.** Decision 1 defines the same machine as "same profile id, name and bed size". Decision 4 says "A file for another machine still brings its whole machine, calibration included, behind the machine notice". The Consequences list "chooses another machine" as a way the calibration goes, and **Use project machine** is that choice. The swap and the loss are therefore the contract, not a slip past #1437. The Amd 1 twin ("a bed-size change is the same camera") is a design inconsistency for the maintainer, not code against a contract.
  - **What is wrong is the notice Decision 4 relies on.** When only the bed size differs:
    - it names the same machine twice;
    - it gives no bed sizes, because `workspaceMismatch` is false when the file's workspace equals its own bed (`ProjectBedReconciliationBanner.tsx:9-14`);
    - it says nothing about the camera;
    - its primary button reverts the bed correction and the calibration, both for good.

    The banner is misleading for every bed-size-only difference, not only cameras. It also bears on H4/H7.
  - **Severity under §3: P2.**
    - **Not P1.** A warning-styled machine notice reaches the operator before any output and asks for a choice. The model in use is the one the ADR assigns to the opened machine. The 6 mm comes from a physical camera move between the two calibrations.
    - **Not P3.** Under M6-P2-2's rule, "METHOD §3's P3 has no slot for a contract question". A misleading notice an ordinary user meets after a bed correction is P2.
- **Fix direction:** Key "same machine for the camera" on profile id and name, as the calibration's own bed frame already handles the bed size. At minimum, name the camera calibration in the banner when the two calibrations differ, and keep the current one unless "Use project machine" is chosen.

### G6-P2-3 (P1 after refuter) — A head camera's stitched bed picture stays in the scene frame it was captured in: bed-size changes do not move it, and after an origin change it is still drawn, mirrored against the burn
- **Where:**
  - `src/ui/camera/head/head-capture-store.ts:272`. `setBedPicture({ image, region, … })` stores the region in scene mm, with no frame.
  - `src/ui/camera/WorkspaceCameraOverlay.tsx:40`. `if (bedPicture !== null) return <BedPictureOverlay …/>` runs before the model check: "Already on the bed's own grid, so it needs no model".
  - `src/ui/state/camera-store.ts:165-170`. Only another picture, a still, or the burn check clears it.
- **Anchor:**
  - Contract: ADR-440 Amd 1, Decision 2, every camera feature follows the moved model. Decision 3, after an origin change: "The overlay, trace, Find pieces, camera marks, head capture and the burn check do not use the model."
  - Twin: the overlay still (a raw frame) is redrawn through the moved model and is right after a bed change. The pre-flattened bed picture is not.
- **Scenario:**
  1. A head-camera owner runs **Capture bed** on a front-left 400 × 400 bed and leaves the picture on the canvas.
  2. They correct the bed to 400 × 410. The picture stays at its scene position, while that scene position now burns 10 mm further back. Artwork placed on the pictured material burns 10 mm off.
  3. If they instead change the origin to rear-left, the live model is refused as ADR-440 Amd 1 requires. The bed picture is still drawn, and what it shows at scene y 100 lies at machine Y 300 while scene y 100 burns at Y 100.
  4. The camera store is not reset by Open either, so the picture also survives opening another machine's project (12-P3-4's mechanism, here for the flattened picture).
- **Evidence:** REPRO in `src/ui/camera/head/zz-g6-bed-picture.test.ts` (deleted), with the real stores. Output:
  - Picture corner scene (100, 100) shows machine (100, 300).
  - At bed 410: the region is unchanged, `visible true`, the corner now burns at machine (100, 310), and a framed model in the same store is moved (`ok`).
  - After the origin change to rear-left: the region is unchanged, `visible true`, the corner burns at machine (100, 100), and the model is `{"kind":"issue","message":"The camera was calibrated with the origin at the front left…"}`.
- **Severity:** P2. Only head-camera owners who change Machine Setup between capture and placement are exposed. Frame shows the true outline, the same precedent as G6-P2-1.
- **Refuter:** **CONFIRMED (REPRO); severity P2 → P1.**
  - **What would make it false:** a device-change, Open or frame reset of `bedPicture`, or a frame check before `BedPictureOverlay` draws. A search of `src` finds only five writers: head capture, **Use live**, a new still, and the burn check's show and hide (`use-camera-placement-controls.ts:50`, `camera-store.ts:159-170`, `job-watch-runner.ts:247/257`, `BurnCheckResult.tsx:46`). `BedPictureOverlay.tsx:51` draws `region` verbatim.
  - **REPRO** (`zz-g6r-bedpic.test.tsx`, deleted). It used the real stores and a mounted `WorkspaceCameraOverlay` with a framed head-camera record. Output:
    - Picture corner scene (100, 100) shows machine (100, 300).
    - **At bed 410:** the region is unchanged, `visible true`, the canvas is still drawn, and the corner burns at (100, 310). The model is moved (`ok`), and the panel note says "KerfDesk moves its picture 10 mm to match", which is true for the model but false for the picture on screen.
    - **Rear-left:** the region is unchanged, the canvas is still drawn, and the corner burns at (100, 100). The model is `issue`.
    - **After opening another machine's project:** the picture is kept and drawn.
  - **Mitigation checked.** After the origin change, `OverlayControls.tsx:38-40` swaps the overlay controls for the notice "…so the camera picture would not line up with the burn". That partly warns, but only in the Camera panel. It also removes **Show on canvas**, so the stale picture can no longer be hidden there. The bed-size variant has no warning at all.
  - **Severity under §3: P1** on the bed-size variant.
    - Artwork placed on the pictured material burns 10 mm off.
    - The only text the operator sees claims the picture was moved to match.
    - The mandatory Frame is not a warning (see the header).
  - **Novelty:** 12-P3-4 (a frozen still survives Open) is the same mechanism for another store field. The frame-change effect on the stitched picture is new.
- **Fix direction:** Store the picture's `CameraBedFrame` with it (`cameraBedFrameNow()` at capture). Translate the region by `bedFrameShift` when the frame changes, drop it after an origin change or an Open, and say so.

### G6-P3-1 — The after-job refresh brings back an overlay the operator hid or exited, and re-latches camera placement, so ADR-228 Amd 1's warning returns on jobs that do not use the camera
- **Where:**
  - `src/ui/camera/helpers/install-camera-helpers.ts:141-146`. It refreshes whenever a held picture exists, whether the overlay is shown or not.
  - `src/ui/camera/helpers/refresh-picture.ts:33`. `captureOverlayStill(…, { showOverlay: true, activatePlacement: true })`.
  - `src/ui/state/camera-store.ts:184-185`. **Exit camera placement** clears `placementActive` and `overlayVisible` but keeps `overlayStill`.
  - `src/ui/laser/start-job-readiness-policy.ts:83-90` reads `cameraPlacementActive`.
- **Anchor:** Contract.
  - ADR-663 Amd 1: "a held picture (Refresh picture) is taken again when a job finishes". It does not say a hidden overlay is shown again or that placement is re-latched. Only Alt+C is described as doing that.
  - ADR-228 Amd 1: "While camera placement is active and Start from is not Absolute Coordinates, Job Review says: …".
- **Scenario:**
  1. The operator refreshes the picture once, then presses **Exit camera placement** (or **Show on canvas** off) to run User Origin jobs.
  2. After the next job finishes, the overlay reappears.
  3. Every following Job Review says "Camera placement is on, but Start from is User Origin …".
- **Evidence:** READ of the lines above. Nothing between the job finishing and the refresh checks `overlayVisible` or `placementActive`.
- **Refuter:** **CONFIRMED (READ + REPRO); P3 stays.**
  - **READ:** the trigger checks only `refreshAfterJob` and `overlayStill !== null` (`install-camera-helpers.ts:140-141`).
  - **REPRO** (`zz-g6r-p3.test.ts`, deleted), using the real stores:
    - after **Exit camera placement**, visible is false, placement is false and the still is kept;
    - `refreshCameraPicture` then gives `refreshed`, with visible true and placement true.
  - **Contract:** ADR-663 Amd 1 says only that the after-job picture "is taken again". The show-and-latch wording belongs to Alt+C.
  - **Why P3:** no output is wrong. The re-shown overlay and the Job Review warning are true of the state they create.
- **Fix direction:** Refresh after a job only while the overlay is shown. Pass `showOverlay` and `activatePlacement` only for Alt+C and Refresh picture.

### G6-P3-2 — Undoing a nudge fix leaves the "camera moved?" reference at the nudged view, so the check reads "steady" on a calibration that is off by the nudge
- **Where:**
  - `src/core/camera/model/nudge.ts:61-63`. `nudgedCameraModel` keeps `calibratedAt`.
  - `src/ui/camera/calibrate/nudge-actions.ts:144`. `saveViewReference(nudged, …)` after the Fix.
  - `src/ui/camera/helpers/view-reference.ts:14-16`. The reference is keyed only on `sourceId@calibratedAt`.
  - `src/ui/camera/helpers/moved-check.ts:94`. `loadViewReference(own)`.
- **Anchor:**
  - Contract: ADR-663 Amd 3: "When the camera's view is known to match its calibration, KerfDesk keeps a 384-pixel-wide grey thumbnail of it on this computer, one per camera and calibration." ADR-663 Amd 2: "It is saved through the machine profile as one Undo step, and the picture is refreshed."
  - Twin: the profile Undo stack against the machine-local reference.
- **Scenario:**
  1. A lid closes 3 mm differently, and the operator applies **Fix** (a 3 mm nudge). The new view is stored as the reference.
  2. Later, Ctrl+Z past their artwork edits also reverts the nudge, which is one step on the same project Undo stack.
  3. The pre-nudge pose has the same key, so the moved check compares today's view with the post-nudge thumbnail and finds no shift.
  4. The overlay is 3 mm off, and the one helper meant to notice stays quiet.
- **Evidence:** READ. Same key, same camera position, so `measureViewShift` ≈ 0. Not run.
- **Refuter:** **CONFIRMED (REPRO); P3 stays.**
  - **REPRO** (`zz-g6r-p3.test.ts`, deleted), using the real store: a nudge, then `saveViewReference(nudged)`, then `undo()`. The pose is back to the pre-nudge one (`true`), `calibratedAt` is the same, and `hasViewReference` is `true` for the restored record.
  - **Why P3:**
    - The helper is advice only (ADR-663 Amd 3).
    - The Camera panel shows nothing for both `steady` and `unknown` (`CameraMovedNotice.tsx:20-25`), so what the operator sees is the same as with the proposed fix.
    - The model change is an explicit Undo of a step ADR-663 Amd 2 records on purpose.
  - **Fix-direction caveat:** `saveViewReference(nudged)` deletes the camera's older references (`view-reference.ts:20-25`). Re-keying alone therefore turns `steady` into a silent `unknown`. For a warning after Undo, the reference needs to keep the pose it matches.
- **Fix direction:** Key the reference on the pose as well (or on a hash of the record), or drop it when the active record changes identity.

### G6-P3-3 (P2 after refuter) — The nudge ring has none of ADR-441 Amd 5's home-first advice; an unhomed nudge folds the power-on offset into a framed calibration and no later note says so
- **Where:**
  - `src/ui/camera/calibrate/nudge-actions.ts:39-56` (`engraveNudgeRing`, Absolute via the transient job).
  - `src/ui/camera/calibrate/NudgeSteps.tsx:22-85`. It has no homing note; the target step's is at `CalibrationSetupStep.tsx:212-240`.
  - `src/core/camera/model/camera-bed-frame.ts:127-129`. The "before KerfDesk knew" note (`placedBeforeBedWasKnown`) needs the record's own frame to lack an offset.
- **Anchor:**
  - Contract: ADR-441 Amd 5, Decision 1: "While connected, the target step says to home first on a homing machine that is not homed."
  - Twin: the target and the nudge ring are both Absolute transient burns that a camera fit is measured on.
- **Scenario:**
  1. A homing machine, connected but not homed this session, with the head powered up near home.
  2. The operator runs **Fix a small offset** and burns the ring at "bed centre", which lands at the power-on zero plus the centre.
  3. The measured offset, say 4 mm, is under the 10 mm limit, so **Fix** shifts the framed calibration by it.
  4. Once homed, the overlay is 4 mm off. The record keeps its old frame with an offset, so ADR-441 Amd 5's note never fires.
  - Job Review does show the generic `UNKNOWN_NATIVE_BED_MESSAGE` (`start-job-readiness.ts:436`), so this is P3, not P2.
- **Evidence:** READ.
- **Refuter:** **CONFIRMED (READ + REPRO); severity P3 → P2.**
  - **READ:** `NudgeSteps.tsx`, `nudge-actions.ts` and `use-nudge-photo.ts` contain no homing text, while `CalibrationSetupStep.tsx:226-240` has `HOME_BEFORE_TARGET_NOTE`.
  - **REPRO** (`zz-g6r-p3.test.ts`, deleted): `cameraBedFrameNote(nudgedCameraModel(framedWithOffset, {4, 0}), homedFrame)` is `null`, and the nudged record keeps its `nativeToBedOffsetMm` frame.
  - **Reach:** a homing GRBL machine boots in Alarm, and `$X` instead of Home leaves it Idle and unhomed, so the ring burn runs. ADR-228 removed the home gate. The unverified-mapping warning does reach the ring job's review (`transient-camera-job.ts:56-63` uses `prepareStartJobSnapshot`, and `start-job-readiness.ts:436` adds it).
  - **Severity under §3:** the auditor's step down to P3 on that warning has no slot in §3. A warning keeps a finding below P1, and a reachable wrong-position result with a misleading calibration is P2 (compare M6-P2-2).
    - **Kept below P1** because a warning naming the unverified bed mapping reaches the operator at the very burn the Fix measures.
    - **If the coordinator decides** that warning does not cover the later camera placements, it is P1 by the same reasoning as G6-P2-1.
- **Fix direction:** Show the target step's home-first note on the nudge setup step. Refuse **Fix** (or say why) when the ring was burned while `cameraBedFrameNow()` had no native offset but the calibration's frame has one.

## KNOWN (not raised again)
- **12-P3-3:** a machine-JPEG camera that stops answering blanks the overlay silently. This is still open: `CameraSourceView.tsx:26-32` gives `PolledJpeg` no `onFailure`. Since #1441, a bridge restart clears the frame-source registry, so a live source's `/frame.jpg?source=<id>` fails the same way.
- **12-P3-4:** a frozen overlay still survives recalibration and Open. This is still open. G6-P2-3 is a separate sibling: the flattened head-camera picture against a frame change.
- **12-P3-5:** unread camera fields in the Start snapshot. This is partly resolved: ADR-228 Amd 1 now reads `cameraPlacementActive`, but `cameraPlacementGeometryIssue` is still unread (`start-machine-snapshot.ts:51`).
- **G1-P3-2** (tone wedge ignores the object power scale) and **G3-P3-2** (Copy/Paste drops the tone curve) were re-encountered in `src/ui/calibration`; nothing new was found there.
- Fixed and confirmed on main: M2-P3-3 by ADR-440 Amd 4; 12-P3-1 by ADR-440 Amd 2; 04-P2-1 by ADR-141 Amd 2; R100-02 and R100-03 by #1429.
- *Refuter re-check:* 12-P3-3 holds (`CameraSourceView.tsx:26-32`, `PolledJpeg` gets no `onFailure`). 12-P3-5 holds (`start-machine-snapshot.ts:51` is the only reader of `cameraPlacementGeometryIssue`). The G6-P2-3 repro also showed the stitched picture surviving Open, which is 12-P3-4's mechanism.

## Refuted
- **The bridge's random frame ids unbind calibrations at each launch.** Refuted. `cameraSourceIdentity` (`frame-source.ts:61-72`) uses the camera URL (`cameraUrl` or `publicCameraSourceId(url)`), never the bridge id.
- **The frame-source cap evicts a live camera.** Refuted. `CameraFrameSources.register` reuses one id per URL and moves it to the newest place (32 at most).
- **The nudge offset, measured in today's frame and applied to the saved record in an older frame, is wrong.** Refuted. Two frames with one origin corner differ by a translation, so a scene offset is the same in both.
- **A head camera's bed-frame shift is counted twice.** Refuted. `cameraModelInBedFrame` moves the pose and `headAtCalibrationMm` by the same shift, and `modelAtHead` cancels it. That is correct, because the camera rides the head.
- **Confirm bed and origin in the browser Free build.** Refuted. Its controls and the overlay are stubbed there (`scripts/browser-free-build.ts:14-19`). Desktop Free uses runtime gates, and the ADR has the button need no Pro.
- **Dropped:** after Add target to canvas, the operator switches Start from back to a relative mode, and the rings burn elsewhere with no camera warning. The add's toast states that Start from is now Absolute, so this is an operator override. ADR-228 Amd 1's warning needs placement active.

## Verified clean
- **Every camera consumer reads the model through the bed-frame layer:** `activeCameraModel` / `modelInBedFrame` / `cameraModelInBedFrame`. This covers the overlay, trace, Find pieces, fixtures, camera Print and Cut marks (through their callers), head capture (`headCameraRecord`), job watch (`watchCameraNow`), nudge, the moved check and refresh. Raw `device.cameraModel` readers are only labels (`device-setup-option-status.ts:55`), the auto-start trigger and the KNOWN snapshot field.
- **The bed-frame maths matches the burn.** `sceneInBedFrame` uses native = bed − offset, as `bedPointToNative` does. Origin transforms differ between two frames with one corner by a translation for all five origins (algebra on `origin-transform.ts`). `camera-bed-frame.test.ts` passes (12/12).
- **ADR-440 Amd 4 holds on every sibling path.** `openCheck` refuses a frameless record (`camera-calibration-store.ts:202-226`). Nudge says why, the moved check stays silent, and the burn check and head capture give the reason. Confirm uses `withReplacedCameraModel` by identity, so the newest calibration stays the newest.
- **ADR-440 Amd 2 holds on all three projections.** `projectCameraPoint`, the shader and its CPU mirror use the same r = |(x/z, y/z)| and `atan` against `fisheyeAngleLimit`. `bedMapper` uses the same limit.
- **ADR-449 Amd 1.** `jogHeadTo` uses `positionLaserNativeTarget`, the plan uses `positionLaserReach`, and the settle target is the jog's own clamped stop. `head-capture-store.test.ts` passes (5/5).
- **#1437 covers every project-replacing path.** File open, open completion, templates, autosave restore, the production manifest and sheets all go through `setProject` → `withCurrentMachineCamera`. `camera-calibration-open.test.tsx` passes (5/5).
- **Calibration photo and nudge ownership.** Both retire on a document, device, camera, settings or bed-frame change (`use-calibration-photo.ts`, `use-nudge-photo.ts`). A camera unplugged mid-photo is retired.
- **Conflict resolutions kept both sides.** `camera-bed-frame.ts`, `assumed-target.ts`, `nudge-actions.ts` and `camera-calibration-store.ts` each carry the #1373, #1432, #1434 and #1441 parts.
- **The bed frame survives project files and machine-profile IO.** Both go through `normalizeCameraModelRecord` (`camera-model-record.ts:76-107`), and a malformed frame drops the record.
- **USB camera identity is the stream's `deviceId`, not its label,** so two cameras with the same name do not share a calibration.
- **Rec. 601 weights are used consistently.** 0.299/0.587/0.114 appear in `gray.ts`, `change-mask.ts`, `find-marks.ts`, `view-shift.ts`, `picture-quality.ts` and `piece-mask.ts`. The Sobel kernels in `view-shift.ts:235-258` are standard.
- **#1442 merged without CI, and its unit test holds after #1449:** `ToneCalibrationDialog.test.tsx` passes (2/2).

## Not verified
- No camera, machine or GPU was used. No e2e spec was run, `photo-tone-calibration.e2e.ts` included.
- Electron bridge keys and routes (ADR-141 Amd 2) were read only for routing and identity; L5 is G7's.
- A Falcon camera found by discovery is bound to its network URL. A DHCP address change would orphan the calibration ("belongs to a different camera"), and a reused address with the same resolution would bind another camera's calibration. Neither was run or researched against LightBurn.
- A resolution change within the same aspect (ADR-440 §5's 1 % rule) is unchanged from rolling v2's Not verified.
- The moved check's thresholds and its pixel → mm conversion are heuristics checked on synthetic views only.
- Place Board and the jig editor (`src/ui/laser/board-capture`, `src/ui/workspace/registration-jig`) belong to G3 and G9. The jig trace (ADR-633) uses no camera model.
- Sturm & Maybank (1999), cited by ADR-441 Amd 7 for the straight-down focal singularity, was not fetched.

```json
[
  {"id":"G6-P2-1","severity":"P1","area":"camera-calibration","file":"src/ui/camera/calibrate/calibration-actions.ts","line":164,"anchor":"Contract: ADR-440 Amd 1 Decision 1 (frame the rings were placed in), ADR-441 Amd 5 Decision 3; Twin: engraveCalibrationTarget records the frame at its Start (:100)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g6r-canvas: real store, addCalibrationTargetToCanvas, bed 400->410, photographTarget on a rendered photo of the rings 10 mm back; record frame 400x400, rms 0.108; marks at (200,210)/(60,70)/(340,300) burn at (199.99,199.91)/(59.98,59.96)/(340.10,290.09); control with frame-at-photo (199.99,209.91)). onCanvas only words the wizard (assumed-target.ts:78); no re-stamp at Start. Severity P2 -> P1: wrong position, no warning (panel says the picture was moved to match); the mandatory beam-off Frame is not a warning (ADR-228 Amd 1 Context)","known":false,"summary":"Add target to canvas remembers the bed frame at the click, not when the rings burn; a bed 400->410 change in between gives a calibration whose overlay is 10 mm off while the panel says the picture was moved to match, and an offline add then homed burn gets a false 'not homed' note"},
  {"id":"G6-P2-2","severity":"P2","area":"camera-calibration","file":"src/ui/state/project-bed-reconciliation.ts","line":91,"anchor":"Contract/context: ADR-440 Amd 3 (calibration belongs to the machine; loss scenario); Twin: ADR-440 Amd 1 treats a bed-size change as the same camera","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g6r-open: notice machineChanged true, workspaceMismatch false, same name twice; no toast; 23 Oct model draws machine (200,200) at (194,200); Keep current restores 25 Oct + bed 410; Use project + one edit persists 23 Oct + bed 400; moved-check reference for 23 Oct already deleted). Narrowed: ADR-440 Amd 3 D1 (id, name and bed size) + D4 (another machine brings its calibration behind the machine notice) + Consequences make the swap and the loss the design; the defect is the notice, which for a bed-only difference names the same machine twice, shows no bed sizes and says nothing of the camera. P2 kept: a notice comes first (not P1); M6-P2-2 rule (no P3 slot for a contract question)","known":false,"summary":"withCurrentMachineCamera keeps the calibration only for an identical bed size; opening a file saved before a bed correction swaps in its older calibration (6 mm off) behind a banner naming the same machine twice, and Use project machine plus one edit loses the newer calibration permanently"},
  {"id":"G6-P2-3","severity":"P1","area":"camera-calibration","file":"src/ui/camera/WorkspaceCameraOverlay.tsx","line":40,"anchor":"Contract: ADR-440 Amd 1 Decisions 2-3; Twin: overlay still is redrawn through the moved model, the stitched bed picture is not","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g6r-bedpic: mounted WorkspaceCameraOverlay; bed 410 -> region unchanged, still drawn, corner burns at (100,310), panel note says the picture was moved 10 mm; rear-left -> still drawn, corner burns at (100,100), model issue; survives Open of another machine). Only five bedPicture writers, none on device change or Open. Severity P2 -> P1 on the bed-size variant: silent 10 mm, misleading panel note; origin variant warns only in the Camera panel, which also loses Show on canvas","known":false,"summary":"A head camera's stitched bed picture keeps its scene region through bed-size changes (10 mm off) and is still drawn after an origin change refuses the model (mirrored, 200 mm), and survives Open"},
  {"id":"G6-P3-1","severity":"P3","area":"camera-calibration","file":"src/ui/camera/helpers/install-camera-helpers.ts","line":141,"anchor":"Contract: ADR-663 Amd 1 (after-job refresh takes a held picture), ADR-228 Amd 1 (warning while placement active)","evidence":"READ","verdict":"CONFIRMED","refuter":"READ install-camera-helpers.ts:140-141 + REPRO (zz-g6r-p3: after Exit visible/placement false, refreshCameraPicture -> refreshed, visible/placement true). P3 kept: no wrong output","known":false,"summary":"After-job refresh re-shows a hidden or exited overlay and re-latches camera placement, so Job Review's camera Start-from warning returns on unrelated User Origin jobs"},
  {"id":"G6-P3-2","severity":"P3","area":"camera-calibration","file":"src/ui/camera/helpers/view-reference.ts","line":15,"anchor":"Contract: ADR-663 Amd 3 (reference per camera and calibration), Amd 2 (nudge is one Undo step); Twin: profile Undo vs machine-local reference","evidence":"READ","verdict":"CONFIRMED","refuter":"REPRO (zz-g6r-p3: nudge, saveViewReference, undo -> pre-nudge pose, same calibratedAt, hasViewReference true). P3 kept: advisory helper, panel shows nothing for steady or unknown; re-keying alone gives a silent unknown because saveViewReference deletes older references","known":false,"summary":"Undoing a nudge fix keeps the post-nudge view reference under the same sourceId@calibratedAt key, so the camera-moved check reads steady on a calibration off by the nudge"},
  {"id":"G6-P3-3","severity":"P2","area":"camera-calibration","file":"src/ui/camera/calibrate/nudge-actions.ts","line":39,"anchor":"Contract: ADR-441 Amd 5 Decision 1 (home-first advice); Twin: target vs nudge ring transient Absolute burns","evidence":"READ","verdict":"CONFIRMED","refuter":"READ (no homing text in NudgeSteps/nudge-actions/use-nudge-photo; CalibrationSetupStep.tsx:226-240 has it) + REPRO (cameraBedFrameNote of a nudged offset-framed record in a homed frame is null). Severity P3 -> P2: reachable ($X instead of Home), wrong position later; the unverified-mapping warning on the ring burn keeps it below P1 but gives P3 no slot (M6-P2-2)","known":false,"summary":"The nudge ring step lacks the home-first advice; an unhomed nudge (under 10 mm) bakes the power-on offset into a framed calibration and the 'before KerfDesk knew' note never fires; Job Review shows only the generic unknown-mapping warning"}
]
```
