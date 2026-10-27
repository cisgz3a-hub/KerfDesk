# Rolling audit v5 — Camera fixes

- **When:** 2026-10-27, late evening +0800   **Tree:** origin/main @ `09f7c0087`
  - #1463 is `6b3227e27`, #1467 is `84417502d` and #1473 is `d2acacdbe` (merged; read on main, not from the PR ref).
  - **Repros ran on the worktree's `src`.** For the camera paths it equals main: `git diff --name-only HEAD origin/main -- src/ui/camera src/core/camera` lists only `transient-camera-job.ts` and its new test. For #1473, main's `transient-camera-job.ts` was copied to a temporary file and swapped in with `vi.mock`, so the same test ran on the pre-fix and the fixed file.
- **Scope:** fix verification (L10) of:
  - #1463 (ADR-440 Amd 5): canvas target stamped at its burn, bed picture keeps its frame, machine notice, nudge homing;
  - #1467 (ADR-663 Amd 4, ADR-449 Amd 2, ADR-654 Amd 3): placement latch with the picture, stitch heights, head-camera Z, Place Board advice;
  - #1473 (ADR-440 Amd 7): the camera rings compile with Start's `machineSnapshot`;
  - #1437 (ADR-440 Amd 3) and #1441 (ADR-141 Amd 2, ADR-440 Amd 4), re-checked after #1466 changed the same Open code.
  - Findings fixed: G6-P2-1, G6-P2-2, G6-P2-3, G6-P3-3, H6-P1-1, H6-P1-2, H6-P2-1, H6-P3-2 and H1-P1-1.
- **Lenses run:** L10 (main), L9 for the siblings each source report lists, L3 for the advice against each placement contract, L7 for test truth.
  - Not run: L2 (no claim rests on an outside source) and L5 (G7/J4 own the bridge).
  - #1473's Save, Inspector and Run-review parts (H1-P3-1/2/3) were not re-verified; they are output parity, not camera.
- **Repros:** three temporary Vitest files plus six existing test files, run one at a time with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose --disableConsoleIntercept`.
  - The temporary files were `zz-j5-transient.test.ts` (with `zz-j5-transient-main.ts`), `zz-j5-jig-advice.test.ts` and `zz-j5-banner.test.tsx`. All are deleted from the worktree.
  - Copies for the refuter are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j5-repros\`.
- **Counts:** 3 raised → 0 refuted → P1 1 / P2 1 / P3 1 (+ 7 KNOWN re-observed).
  - **Refuter (fresh context):** all three CONFIRMED. J5-P2-1 and J5-P2-2 by the refuter's own REPRO, J5-P3-1 by two READ lines. **Severity change:** J5-P2-2 is raised to P1 under §3, because the notice names the bed, not the origin and no-go zone that move and unguard the burn.

## Headline

All nine findings these PRs name are fixed on main, and each regression test fails on the pre-fix code. The fixes merged without losing each other's lines, and #1437 still holds after #1466 reworked the same Open code.

Two siblings slipped past:

- **J5-P2-1.** ADR-654 Amd 3 stopped the camera advice "Choose Absolute Coordinates" on Place Board jobs only. A registration jig's artwork run still gets it. Following it burns the artwork 198 mm away from the outline that run 1 just burned (repro). #1467 makes this more likely, because the latch now turns on whenever the picture is drawn, for example when the operator looks at the camera to place the blank in the outline.
- **J5-P2-2 (P1 after refuter).** #1463's new bed-size notice says only the bed (and the camera) differ. The opened file's whole machine is in use, though. A file saved before an origin and bed correction opens front-left on a rear-right machine, and the notice talks only about the bed. In the refuter's repro the same line moves from `G1 X381 Y20` to `G1 X20 Y380`, and a clamp no-go zone's collision warning disappears.

## Fix verification (L10)

| Fix | Original repro on main | Siblings checked | Test fails on the pre-fix code |
|---|---|---|---|
| G6-P2-1 canvas target (#1463 D1-2) | `canvas-target-burn.test.ts` 5/5. The rendered-photo fit with a 400→410 change in between puts (200,210), (60,70) and (340,300) within 0.5 mm. The control fit in the add frame is still 10 mm off | Head-camera target; offline add then homed burn; Run G-code file (no permit, so no stamp: `external-run.ts:247-262`); Engrave target streams also pass the stamp, then `rememberTarget` overwrites it | yes (`stampCanvasTargetBurn` is new) |
| G6-P2-3 bed picture frame (#1463 D3) | `bed-picture-frame.test.tsx` 12/12: moved with the bed, dropped on an origin change or another machine, kept on the same machine | Burn-check picture carries `taken`; a picture survives Open of the same machine | yes |
| G6-P2-2 machine notice (#1463 D4) | Banner names both beds and both calibration dates; Keep current machine comes first | **J5-P2-2** (another origin behind a bed-size notice) | yes |
| G6-P3-3 nudge homing (#1463 D5) | `HOME_BEFORE_NUDGE_NOTE` at `NudgeSteps.tsx:97,149`; `withUnknownNativeOffset` on Fix | `nudgeRingBedFrame` resets on `openNudge`/`openSetup` (`camera-calibration-store.ts:166-200`) | yes |
| H6-P1-1 latch (#1467, ADR-663 Amd 4) | `camera-placement-latch.test.tsx`: the Falcon A1 Pro auto-start latches with the panel never opened, and Job Review warns | The only writers of `placementActive` are `activatePlacement`, `deactivatePlacement` (which also hides the picture) and `captureOverlayStill`, so no path clears the latch while the picture stays shown. The overlay is mounted in both canvas views (`App.tsx:201-209`) | yes (the old overlay never latched) |
| H6-P1-2 stitch heights (#1467, ADR-449 Amd 2 D1-2) | `head-camera-heights.test.ts` 6/6: the 20 mm box is now < 0.1 mm off (pre-fix control 6.7 mm) | Burn-check picture keeps `heightAreas` (`burn-check-run.ts:133-137`); Capture here and Capture bed both flatten at the heights they record | yes |
| H6-P2-1 head Z (#1467, ADR-449 Amd 2 D3-5) | 1.43 mm at +6 mm reproduced, 0.2 mm tolerance < 0.15 mm, refusal and round-trip pass | Every head-camera consumer goes through `activeCameraModel` (overlay, trace, Find pieces, fixtures, Print and Cut marks) or checks Z itself (`head-capture-store.ts:135`); the burn check and nudge are fixed-camera only; a 2-axis report parses Z as 0 (`status-parser.test.ts:29`) | yes |
| H6-P3-2 Place Board advice (#1467, ADR-654 Amd 3) | `start-job-camera-placement.test.ts` covers the User Origin, Verified Origin and Absolute cases | **J5-P2-1** (the registration jig); Print and Cut already expects Absolute (`print-cut-frame-warnings.ts:22-24`) | yes |
| H1-P1-1 camera rings (#1473, ADR-440 Amd 7) | Own repro (below) on stock GRBL `$23=0`, `$30=255`, profile S1000 | Only two transient camera callers (`calibration-actions.ts:96`, `nudge-actions.ts:50`); every other Start builds `machineSnapshot`; no registration rides the transient compile | **yes, run:** the pre-fix file fails the parity |

**#1473 repro output** (`zz-j5-transient.test.ts`). Real `engraveCalibrationTarget`, real `addCalibrationTargetToCanvas` + `prepareCurrentStartJob`; only the Frame dispatch and dialogs are stubbed.

- **Pre-fix:** `transientFrame {minX:70,minY:115.2,maxX:330,maxY:284.8}`, `transientS [350]`; canvas `{-330..-70, -284.8..-115.2}`, `canvasS [89]`; `identical false`. The record frame offset is `{x:400,y:400}`. The confirm carries "mapping is unverified" and "no current controller power range". The test fails.
- **Fixed:** `transientFrame` equals the canvas Frame (X-330..-70), `transientS [89]`, `identical true`. The record offset `{x:400,y:400}` now matches the program, and neither false warning appears. 1 passed.

## Findings

### J5-P2-1 — A registration jig's artwork run is still told to "Choose Absolute Coordinates", which burns the artwork about 198 mm from the outline burned in run 1; ADR-654 Amd 3 exempted only Place Board, and #1467 now latches the advice whenever the picture is drawn

- **Where:**
  - `src/ui/laser/start-job-readiness-policy.ts:94-96,106-115`. `hasPlaceBoardOutline` matches only `provenance === 'captured-board'`. For every other latched, non-Absolute job, `cameraPlacementStartFromWarning` returns the Absolute advice (`:114`). A jig box has no provenance or `'jig'` (`core/scene/scene-object.ts:521-525`).
  - `src/ui/camera/camera-placement-latch.ts:14-33` (via `WorkspaceCameraOverlay.tsx:40`). The latch now turns on whenever the overlay draws a picture.
  - The two-run contract it breaks is `src/io/gcode/prepare-output.ts:393-411`: both runs anchor to the box.
  - After run 1, `registration-jig-stream-completion.ts:194-200` switches to Artwork only: "Place the piece inside the outline … then Start the artwork."
- **Anchor:**
  - **Contract.** ADR-057 Decision (`DECISIONS.md:3443-3447`): the box is "burned once as a physical placement reference", and "both burn from the same origin so the art lands where it sits relative to the box". Decision 2 makes them two runs.
  - **Twin.** ADR-654 Amd 3 Decision 1 gives Place Board, the other registration-box workflow, its own wording, and "It never advises Absolute Coordinates". The jig box shares `findRegistrationBoxes` and the box anchor, but gets the generic advice.
  - **Twin.** The H6-P3-2 refuter rated the same advice-breaks-the-anchor defect P2.
- **Scenario:**
  1. The operator has a calibrated camera (or the Falcon A1 Pro camera) and a jig box on the canvas. Start from is User Origin, front-left, with WCO (15, 25).
  2. Run 1 burns the outline at machine X15–115 Y25–85. KerfDesk switches to Artwork only and says to place the piece inside the outline.
  3. To see the outline, the operator looks at the camera picture: they open it, or it auto-starts, or the after-job refresh shows it (G6-P3-1). The overlay draws it, so placement latches (ADR-663 Amd 4). Before #1467 only opening the panel did this.
  4. Job Review for the artwork run says: "Camera placement is on, but Start from is User Origin … Choose Absolute Coordinates to burn it where it is placed, and watch the Frame."
  5. Following that advice moves the artwork from machine X55–75 Y45–65, inside the outline, to X190–210 Y190–210. That is 135 mm and 145 mm off, wholly outside the burned outline. Job Review at Absolute says nothing about the jig.
  - The phone and MCP Start read the same Job Review warnings (`machineSnapshot`), so they give the same advice.
  - A hidden but latched picture, which is the designed state, shows nothing that contradicts the advice.
- **Evidence:** REPRO `src/ui/laser/zz-j5-jig-advice.test.ts` (deleted; copy in `scratchpad\j5-repros\`).
  - **Setup:** the real store with `addRegistrationBox(100, 60)` and a 20 mm square inside the box, then `setRegistrationOutput('box' | 'artwork')`. The compile is real `prepareStartJob` with `cameraPlacementActive: true`, homing confirmed and WCO (15, 25), with `requireFrame` off.
  - **Output** (1 passed):
    - `boxProvenance "(absent = jig)"`, box at scene (150..250, 170..230), run states `["box","artwork"]`;
    - `boxRunWork {0..100, 0..60}` and `artUserOriginWork {40..60, 20..40}`, so the art lies inside the outline;
    - `artAbsoluteWork {175..195, 165..185}`, which is machine X190–210 Y190–210 after the WCO;
    - `advice ["Camera placement is on, but Start from is User Origin. … Choose Absolute Coordinates to burn it where it is placed, and watch the Frame."]`;
    - `absWarningsMentionJig []`.
- **Severity:** P2. Following the advice on the artwork run burns off the outline, and a Place Board job with the same defect was rated P2 (H6-P3-2 after its refuter, M6-P2-2). Not P1: the operator changes the mode on the advice, and the text is true about where each mode burns.
- **Novelty:** H6's auditor dropped "The jig conflicts with camera placement", reasoning that Absolute "burns box and artwork at their scene positions together". That holds only if both runs use Absolute. ADR-057's runs are separate Starts, and the advice can first appear, or first be followed, at the artwork run. Not elsewhere in `docs/audits/`; no open PRs.
- **Refuter:** **CONFIRMED (own REPRO); severity stays P2.**
  - **What would make it false.**
    - The jig never runs at User Origin.
    - Something already ties the artwork run to the outline run's Start from.
    - The advice never reaches the artwork run.
    - The latch can only be on from before run 1, so the advice would come at run 1 and both runs would follow it.
  - **The jig does use User Origin.** ADR-057's Decision pairs the jig with Set Origin and Verified Origin (`DECISIONS.md:3476`, "Pairs with Set Origin (ADR-021) / Verified Origin"). Its Amendment (`DECISIONS.md:3498-3500`) calls Absolute the homed-machine alternative ("in **Absolute** mode both runs emit at their true on-canvas positions"). Nothing pins either mode: neither `RegistrationJigPanel.tsx` nor `registration-command-family.ts` reads or sets `startFrom`. The completion observer keeps `jobPlacement` only to cancel its own switch (`registration-jig-stream-completion.ts:34,162`). Nothing records which Start from the outline burned with.
  - **REPRO** (`src/ui/laser/zz-j5r-jig.test.ts`, deleted). It was written fresh: an 80 × 50 box, a 10 mm square 35/20 mm inside it, the real `prepareStartJob`, WCO (15, 25), and machine extents of the lit G1 moves (work + WCO). Output, 2 passed:
    - The outline run at User Origin gets **0** camera warnings with the latch off and **1** with it on. So the defect needs the latch to come on between the runs, or advice ignored at run 1.
    - The outline burns at machine X15–95 Y25–75. The artwork at User Origin burns at X50–60 Y45–55, inside it.
    - With the latch on, the artwork run at User Origin gets "… Choose Absolute Coordinates to burn it where it is placed, and watch the Frame."
    - The artwork at Absolute burns at X195–205 Y195–205, wholly outside the outline. Its warnings are only the generic unverified-mapping and S1000-profile notes; neither names the jig or the outline.
    - **Control.** With both runs at Absolute, the outline is X160–240 Y175–225 and the art X195–205 Y195–205, so they stay together. With a captured-board box, the twin gets the Place Board wording, not Absolute.
  - **Reach without any camera step by the operator.** Suppose a still is held and placement was exited before run 1. `refreshAfterJobs` (`install-camera-helpers.ts:144-159`, `refreshAfterJob` defaults to true at `camera-preference-storage.ts:157`) refreshes when run 1 finishes, and `refresh-picture.ts:33` passes `activatePlacement: true`. The advice then appears for the first time at the artwork run (KNOWN G6-P3-1, J5-P3-1).
  - **Severity under §3: P2.**
    - **Not P1.** The operator changes the mode on advice that is accurate about where each mode burns. The same Job Review also shows the jig's own step "Keep its X/Y placement and the work origin unchanged" (`JobReviewRegistrationJig.tsx:43-46`). That is a contradicting instruction, if not a named warning. This matches H6-P3-2.
    - **Not P3.** Reachable advice that, when followed, burns the art off the burned outline breaks ADR-057's two-run contract (M6-P2-2).
  - **Novelty.** No open PRs (`gh pr list --state open` is empty). In `docs/audits/`, the only jig plus camera-advice hit is H6's dropped candidate (`H6-camera-placement.md:374`).
- **Fix direction:** Treat any registration box like a captured board in `placementWarnings`. Advise keeping the Start from the outline was burned with, never Absolute, and warn when the artwork run's Start from differs from the outline run's.

### J5-P2-2 (P1 after refuter) — #1463's bed-size machine notice tells the operator only the bed (and camera) differ, while the opened file's whole machine, origin included, is in use

- **Where:**
  - `src/ui/state/project-bed-reconciliation.ts:63,69-71`. `bedSizeOnly` is `machineChanged && sameProfile`: the same profile id and name. Nothing checks that the other machine fields match.
  - `src/ui/app/ProjectBedReconciliationBanner.tsx:19-34,57-66`. The banner text names only the bed: "The project's … bed is in use for now. Keep current machine keeps your … bed. Use project machine replaces it with the file's".
  - `project-bed-reconciliation.ts:150`. For another identity, `withCurrentMachineSetup` keeps none of the current machine and returns `replaced: []`, so no toast lists what changed either.
- **Anchor:**
  - **Contract.** ADR-440 Amd 5 Decision 4 (`ADR-440-amendment-5-bed-frame-siblings.md:58-63`) applies the bed wording when the file has the same profile id and name "and only its bed size differs". The code applies it whenever the bed size differs.
  - **Twin.** #1466 (ADR-500 Amd 2) names a replaced origin, homing and no-go zones in its toast for a same-identity Open (`replacedSetupLabels`, `:240-251`). The bed-differs Open names none of them.
  - **Contract.** PROJECT.md origin honesty (as cited by H4-P1-1).
- **Scenario:**
  1. The operator corrects the machine to rear-right and 400 × 410, keeping the same profile.
  2. They open a file saved before both corrections (front-left, 400 × 400).
  3. The notice says only that the file was saved with a 400 × 400 bed and "The project's 400 × 400 mm bed is in use for now".
  4. The origin in use is front-left. A mark at canvas (20, 20) is placed at machine (20, 380) instead of (380, 20) on the corrected machine.
  5. **Use project machine** is described as replacing the bed, but it also keeps the old origin and every other setting. The next machine edit saves them (the same loss as H4-P1-1, through the other branch).
- **Evidence:** REPRO `src/ui/app/zz-j5-banner.test.tsx` (deleted; copy in `scratchpad\j5-repros\`).
  - **Setup:** the real store and `setProject`, with the banner mounted.
  - **Output** (1 passed): `bedSizeOnly true`, `mentionsOrigin false`, `originInUse "front-left"`, `bedInUse [400,400]`, `scene20_20_burnsAt_fileMachine {x:20,y:380}`, `…currentMachine {x:380,y:20}`.
  - **Banner text:** "This project was saved for “Falcon A1 Pro” with a 400 × 400 mm bed, and your “Falcon A1 Pro” is set up with a 400 × 410 mm bed. The project's 400 × 400 mm bed is in use for now. Keep current machine keeps your 400 × 410 mm bed. Use project machine replaces it with the file's …".
- **Severity:** P2, matching G6-P2-2: a warning-styled notice reaches the operator before output and asks for a choice. A refuter may argue P1 under §3, because the notice names the bed, not the origin, which is the mismatch that moves the output. Before #1463 the generic notice at least said the file "selected" another machine.
- **Novelty:** G6-P2-2's refuter noted "The banner is misleading for every bed-size-only difference", and H4 noted #1463's `bedSizeOnly` (`H4-machine-setup-connect.md:82`). Neither raised a file that differs in more than the bed under the new wording. J7 (#1466) may overlap. No open PRs.
- **Refuter:** **CONFIRMED (own REPRO). Severity P2 → P1.**
  - **What would make it false.**
    - #1466 keeps the current origin for this file too.
    - Another toast or notice names the origin.
    - Start or Job Review reads the open notice.
    - Keep current machine fails to restore the origin.
    - No Machine Setup edit can give a same-id, same-name profile with another bed.
  - **#1466 does not reach it.** `deviceIdentity` is `profileId|name|bedWidth|bedHeight` (`project-bed-reconciliation.ts:289-291`). A bed difference therefore makes it "another machine", and `withCurrentMachineSetup` returns the file's project with `replaced: []` (`:150`). ADR-500 Amd 2 Decision 3 makes that intended: "A file for another machine is unchanged. It still brings its whole machine behind the machine notice". The defect is the notice that Decision 3 relies on. ADR-440 Amd 5 Decision 4 (`:58-59`) gives the bed wording only when "only its bed size differs".
  - **Nothing else speaks.**
    - `projectBedReconciliation` is read only by the banner, the persistence hook and the Undo context (`git grep` on main). Start and Job Review do not read it.
    - `core/devices/native-bed-frame.ts:12-14` says the mapping "never guesses or reverses an axis from homing direction", so no controller check names the corner either.
    - `deviceProfileWithInteractivePatch` keeps `profileId` and `name` on a bed or origin edit (`core/devices/device-profile-patch.ts:8-12`), so the case comes from ordinary Machine Setup corrections.
  - **REPRO** (`src/ui/app/zz-j5r-bed.test.tsx`, deleted). It was written fresh, with the real store, the mounted persistence hook and the banner, `serializeProject`/`deserializeProject` + `setProject`, and output from `emitGcode`. Three cases passed.
    - **Before Open:** the machine is rear-right, 400 × 410, with a clamp zone (0,0)–(60,60). It burns `G1 X381.000 Y20.000 F1500 S500`, with 1 no-go collision.
    - **Open of a file saved before the corrections** (front-left, 400 × 400, no zones):
      - the result is `loaded`, with `bedSizeOnly true` and toasts `[]`;
      - the banner text names no origin, corner, zone or homing (the regex `origin|corner|front|rear|no-go|zone|homing` finds nothing);
      - in use: origin `front-left`, bed 400 × 400, 0 zones;
      - the burn is `G1 X20.000 Y380.000 F1500 S500` with **0** no-go collisions.
    - **Use project machine plus one frame-speed edit** remembers `{origin:"front-left", bedHeight:400, zones:0}`. The operator's origin and zone corrections are lost.
    - **Control: same bed, origin and zone differ** (the #1466 path). The file opens with rear-right and the zone kept, the burn is unchanged, and the toast says "This file's machine settings were not used (origin and no-go zones) …".
    - **Control: Keep current machine** restores rear-right, 400 × 410 and the zone. The primary button is safe.
  - **Severity under §3: P1.**
    - **Why P1.** The burn moves about 360 mm per axis on the operator's real machine, and a configured clamp guard disappears. That is wrong physical output, and it is reachable today.
    - **Why the notice does not lower it.** Under the 2026-10-27 clarification, a finding is lowered only when "the app itself tells the operator about the specific mismatch before output". This notice tells them about a different, 10 mm mismatch. It also asserts that the bed is what differs, and that **Use project machine** "replaces it", meaning the bed.
    - **Why G6-P2-2 stayed P2.** That notice said the file "selected" another machine, which covered the whole swap. The error there came from a physical camera move. #1463's wording narrows the stated difference to the bed. It now misdirects, not merely under-informs.
    - **The twin.** This is H4-P1-1's P1 effect (old origin and zones back, then remembered) through the bed-differs branch.
- **Fix direction:**
  - Set `bedSizeOnly` only when every machine field except the bed size matches (reuse `replacedSetupLabels`).
  - Otherwise name the other differing settings (origin, homing, no-go zones, …) in the notice, as the same-machine toast does.

### J5-P3-1 — ADR-663 Amd 4 Decision 3 says Exit camera placement keeps the picture from coming back by itself; its own Consequences, and the code, bring it back after the next job

- **Where:**
  - `docs/decisions/ADR-663-amendment-4-placement-latches-with-the-picture.md:35-37`: "**Exit camera placement** clears it and hides the picture, so it does not come back by itself."
  - The same file's `:45-46`: "G6-P3-1 … is unchanged".
  - The code: `camera-store.ts:196-197` keeps `overlayStill` on Exit. `install-camera-helpers.ts:144-159` refreshes whenever a still is held, and `refresh-picture.ts:33` passes `showOverlay: true, activatePlacement: true`.
- **Anchor:** Contract. The ADR text against the code and against its own Consequences.
- **Scenario:** The operator refreshes the picture once, presses **Exit camera placement** and runs a job. With the default `refreshAfterJob` on, the picture comes back and placement re-latches when that job finishes.
- **Evidence:** READ (lines above). The G6 refuter's REPRO of G6-P3-1 (`refreshed`, visible and placement true after Exit) still applies: `refresh-picture.ts` and `refreshAfterJobs` are unchanged since.
- **Severity:** P3, doc/code drift. The behaviour is KNOWN G6-P3-1.
- **Refuter:** **CONFIRMED (READ, two lines); P3.**
  - `deactivatePlacement` sets `placementActive: false, overlayVisible: false` and leaves `overlayStill` (main `camera-store.ts:196-197`).
  - `refreshAfterJobs` checks only `refreshAfterJob` and `overlayStill !== null`, never `overlayVisible` (`install-camera-helpers.ts:151-152`). `refreshAfterJob` defaults to `true` (`camera-preference-storage.ts:157`), and the refresh shows the picture and latches placement (`camera/helpers/refresh-picture.ts:33`). It needs a live camera (`:29`).
  - So Decision 3's "does not come back by itself" is false for the next finished job, as the same ADR's Consequences concede. Doc/code drift; the behaviour is KNOWN G6-P3-1.
- **Fix direction:** Fix G6-P3-1 (refresh after a job only while the picture is shown), or correct Decision 3 to except the after-job refresh.

## KNOWN (re-observed, not raised again)

- **G6-P3-1:** the after-job refresh re-shows and re-latches a hidden overlay. It is unchanged. J5-P3-1 is the ADR text that contradicts it, and J5-P2-1's step 3 is one route into the latch.
- **G6-P3-2:** the view reference is keyed `sourceId@calibratedAt` (`view-reference.ts:14-16`), so it survives a nudge Undo. Unchanged.
- **H6-P3-1:** `useOwnCameraFrameNote` is read only in the panel (`OverlayControls.tsx:39`, `CalibrateCameraControls.tsx:23`). Unchanged.
- **H6-P3-3:** the Falcon A1 Pro camera's identity is a fixed RNDIS URL. Unchanged.
- **12-P3-3:** `PolledJpeg` gets no `onFailure` (`CameraSourceView.tsx:26-32`). A dead machine-JPEG source stays `live`, so after #1467 it also keeps latching placement.
  - **Refuter severity look: stays P3.**
    - A machine-JPEG source goes `live` only after it has answered. The machine camera must be discovered as `found` (`camera-source-actions.ts:164-180`), and a snapshot source needs a first frame (`camera-snapshot-source.ts:46-66`).
    - The latch is sticky, so a camera that dies after its picture was drawn had already latched before #1467. The only new case is a source that dies while hidden and is then drawn blank. Showing it from the panel latched before #1467 too.
    - The effect is the generic camera advice appearing with no visible picture. It is still advice, and the blank overlay contradicts "the camera picture shows positions on the bed". No new reach that §3 would rate P2.
- **12-P3-4:** a held still and a burn-check picture survive Open of the same machine.
- **12-P3-5:** `cameraConfirmedPositionEpoch` and `cameraPlacementGeometryIssue` are still read by nothing but `start-machine-snapshot.ts:50-51`.

## Refuted

The refuter refuted none of the three raised findings.

Candidates the auditor dropped:

- **H6-P1-1's fixture sibling** (`use-fixture-review.ts:70-73`: applying a fixture with the camera stopped latches nothing). Dropped:
  - no camera picture is involved;
  - the dialog already says "The current camera context is unavailable. Saved geometry is historical placement intent" (`fixture-layout.ts:93-96`) and needs a "reviewed" tick;
  - ADR-228 Amd 1 keys on camera placement, which a stopped camera is not.
- **The canvas target is stamped by a saved G-code run.** Refuted. Run G-code file streams without `framedRunPermit` (`external-run.ts:247-262`), so `completedFrameRunOwner` stays null. ADR-440 Amd 5 Decision 2's refusal applies as written.
- **A wizard Engrave target re-stamps an older canvas target.** Harmless. The stamp at stream start (`laser-job-actions.ts:415-421`) is overwritten by `rememberTarget(…, onCanvas false)` once the transient job returns (`calibration-actions.ts:112`).
- **#1473's `frameVerification` in the transient snapshot fails the ring job against the operator's own Frame.** Refuted. With `requireFrame: false` the Frame check is skipped (`start-job-readiness.ts:341-347`).
- **The latch can be cleared while the picture stays drawn, so it never re-arms.** Refuted. `deactivatePlacement` is the only clearing writer, and it also hides the picture (`camera-store.ts:196-197`).
- **A 2-axis controller stores a NaN Z, so the head mount is dropped on reload.** Refuted. The status parser fills Z with 0 (`status-parser.test.ts:29`).
- **`sameHeights` compares the stored region, not the moved one, after a bed-size change** (`bed-picture-frame.ts:128-131`). Not raised. Height areas are scene mm that do not follow a bed-frame change anywhere (live overlay included), so this is that general design, not a gap in the fix.

## Verified clean

- **Conflict resolutions.** Every code line #1463 added is on main except ten. #1467 rewrote nine of them to add the heights while keeping `taken`: seven in `bed-picture-frame.ts` and one each in `head-capture-store.ts` and `BedPictureOverlay.tsx`. The tenth is a doc-comment line in `calibration-actions.ts`. Every line #1467 added is on main. #1473 touched only `transient-camera-job.ts` among the camera files. (Script: each added non-comment line of each commit's `src` diff was grepped in `git show origin/main:<file>`.)
- **Test truth.** Each named regression test exercises code that did not exist or did not act before its fix:
  - `canvas-target-burn.test.ts` (its control reproduces G6-P2-1);
  - `bed-picture-frame.test.tsx` and `camera-placement-latch.test.tsx`;
  - `head-camera-heights.test.ts` (its control reproduces 6.7 mm and 1.43 mm);
  - `start-job-camera-placement.test.ts`;
  - `transient-camera-job.compile.test.ts`, whose parity failure on the pre-fix snapshot was run here.
- **#1437 after #1466.** `camera-calibration-open.test.tsx` passes 5/5 on code equal to main's Open path (the worktree differs only in the #1476 load notices). `withCurrentMachineSetup` runs after the camera step and keeps its camera fields (`project-bed-reconciliation.ts:145-159`).
- **#1441 and ADR-440 Amd 4.** None of #1463, #1467 or #1473 touched `frame-source.ts`, `camera-resource-identity.ts`, `saved-cameras.ts`, `camera-model-frame.ts` or `electron/camera-*`.
  - A frameless record is still refused first in `modelInBedFrame`, so it never reaches the new latch, Z or stamp paths.
  - Head capture refuses it in `headCameraRecord` (`head-capture-store.ts:164-172`).
- **ADR text vs code.** Each Decision matches the code: ADR-440 Amd 5 D1–D3 and D5; ADR-663 Amd 4 D1–D2; ADR-449 Amd 2 D1–D5 (including the panel wording in `head-z-note.ts:9-20`); ADR-654 Amd 3 D1–D3; ADR-440 Amd 7 D1. The exceptions are J5-P2-2 (Amd 5 D4) and J5-P3-1 (Amd 4 D3).
- **Electron vs browser; USB vs bridge vs network.** The latch keys on `sourceState.kind === 'live'` and a model, whatever the source. The browser Free build stubs the overlay and skips the auto-start (`install-camera-helpers.ts:47-50`).
- **Phone and MCP.** `get_camera_snapshot` is a raw still that places nothing (`electron/mcp/machine-tool-info.ts:85-88`). Remote Start reads the PC's latch through `machineSnapshot`.

## Not verified

- **Hardware.** No camera, machine or Falcon A1 Pro was used, and no e2e spec was run.
- **Rotary with the camera advice.** ADR-127 Amd 1 says an Absolute rotary job's "flat-bed Y means nothing on a cylinder", so "Choose Absolute Coordinates to burn it where it is placed" is not literally true on a rotary job. #1467 makes that advice appear whenever the picture is drawn. Not run, and not raised, because the camera picture gives no placement along the circumference.
- **#1473's Save, Inspector and Run G-code file parts** (H1-P3-1/2/3) are output parity outside camera scope; J9 or a later area should verify them.
- **A stamp at stream start for a run that fails before any ring burns.** `burnSeen` would be set for rings that never burned. Read only, not run.

```json
[
  {"id":"J5-P2-1","severity":"P2","area":"fix-camera","file":"src/ui/laser/start-job-readiness-policy.ts","line":106,"anchor":"Contract: ADR-057 Decision (box burned once; both runs burn from the same origin; two runs); Twin: ADR-654 Amd 3 D1 exempts only captured-board boxes ('It never advises Absolute Coordinates'); ADR-663 Amd 4 latch now set whenever the picture is drawn","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A registration jig's artwork run with camera placement latched gets 'Choose Absolute Coordinates to burn it where it is placed'; following it moves the art from machine X55-75 Y45-65 (inside the outline run 1 burned at User Origin, WCO 15,25) to X190-210 Y190-210, 198 mm away, with no jig warning at Absolute. hasPlaceBoardOutline matches only captured-board provenance; #1467's overlay latch makes the advice appear once the operator views the burned outline","refuter":"REPRO (zz-j5r-jig.test.ts, own): real prepareStartJob, WCO 15,25; outline at User Origin X15-95 Y25-75, art at User Origin X50-60 Y45-55 inside; latched art run at User Origin gets 'Choose Absolute Coordinates'; art at Absolute X195-205 Y195-205 with no jig warning; outline run gets the advice only if already latched (0 unlatched, 1 latched), so the defect needs the latch to start between runs, which the after-job refresh does unprompted when a still is held. Nothing pins or records the jig's Start from. Severity stays P2 (H6-P3-2, M6-P2-2): followed advice burns off the outline; not P1 because the operator changes the mode on accurate wording and the same Job Review says 'Keep ... the work origin unchanged'"},
  {"id":"J5-P2-2","severity":"P1","area":"fix-camera","file":"src/ui/app/ProjectBedReconciliationBanner.tsx","line":19,"anchor":"Contract: ADR-440 Amd 5 D4 ('same profile id and name and only its bed size differs'); Twin: #1466 same-machine Open toast names a replaced origin, homing and zones (replacedSetupLabels); PROJECT.md origin honesty","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"bedSizeOnly is set for any same id+name file whose bed differs, and the #1463 banner then says only 'The project's 400 x 400 mm bed is in use for now'; a file saved before an origin and bed correction opens front-left on a rear-right 400x410 machine (canvas (20,20) at machine (20,380) instead of (380,20)) with no word about the origin, and Use project machine is described as replacing only the bed","refuter":"REPRO (zz-j5r-bed.test.tsx, own): real store, persistence hook, banner, serialize/deserialize + setProject, emitGcode. Rear-right 400x410 with a clamp zone burns G1 X381 Y20 (1 no-go collision); opening a front-left 400x400 file gives bedSizeOnly true, no toast, a banner naming no origin/zone, and G1 X20 Y380 with 0 collisions; Use project machine + one edit remembers front-left, 400, no zones. Same-bed control keeps origin and zone and toasts them; Keep current machine restores all. deviceIdentity includes the bed, so #1466 does not apply (ADR-500 Amd 2 D3). Severity P2 -> P1 under METHOD 3 (2026-10-27): wrong position (about 360 mm per axis) and a dropped no-go guard, and the only notice names a different 10 mm bed mismatch"},
  {"id":"J5-P3-1","severity":"P3","area":"fix-camera","file":"docs/decisions/ADR-663-amendment-4-placement-latches-with-the-picture.md","line":36,"anchor":"Contract: ADR-663 Amd 4 Decision 3 vs its own Consequences (G6-P3-1 unchanged) and refresh-picture.ts:33","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"ADR-663 Amd 4 D3 says Exit camera placement hides the picture 'so it does not come back by itself', but the after-job refresh (KNOWN G6-P3-1, unchanged) shows it and re-latches placement after the next job whenever a still is held","refuter":"READ (two lines): deactivatePlacement leaves overlayStill (camera-store.ts:196-197); refreshAfterJobs checks only refreshAfterJob (default true) and overlayStill, and refresh-picture.ts:33 shows and latches. Doc/code drift; behaviour is KNOWN G6-P3-1"}
]
```
