# Rolling audit v4 — Undo and guards

- **When:** 2026-10-27   **Tree:** the audit worktree's `src/` is `origin/main` @ `a59f74ff9`. After
  `git fetch`, `origin/main` is `105d6374c` (#1460–#1464). Every citation below is to
  `origin/main` @ `105d6374c` (`git show origin/main:<path>`).
  - The repros ran on the `a59f74ff9` tree. Every file they exercise is byte-identical on
    `105d6374c`: `project-actions.ts`, `store-actions.ts`, `board-capture-actions.ts`,
    `board-outline-register.ts`, `setup-history-context.ts`, `remote-control/arrange.ts`,
    `detected-settings-action.ts` and `use-machine-profile-persistence.ts`.
  - Two cited files did change. `job-machine-lock.ts` gained ADR-416 Amendment 3 (#1462).
    `project-bed-reconciliation.ts` and `ProjectBedReconciliationBanner.tsx` gained the
    ADR-440 Amendment 5 wording (#1463). Neither change touches the paths these findings use.
- **Scope:** every way to change the project or the machine profile while a job runs, during a
  hold, or right after a job. That covers:
  - Undo and Redo, including the Undo list, the phone and MCP;
  - Open, New, Recent, templates, autosave restore, and sheet and production-row switches;
  - paste, drag and drop;
  - Machine Setup, its import and the detected-settings banner;
  - the profile switch, the Laser/CNC toggle and the bed-reconciliation banner;
  - the CNC panel, rotary setup and the material library;
  - Place Board, the camera target, phone and MCP writes, and a second window.

  The guards are:
  - `store-setters.ts` (`jobMachineGuardSetter`, the Pro, relief-link and numbering setters);
  - `commitProjectEdit` and `commitProjectEditNow` (#1346, ADR-592 Amd 2) and the
    `kerfdesk/no-raw-project-set-state` lint rule;
  - `job-machine-lock.ts` (#1419, ADR-416 Amd 2; #1462, Amd 3);
  - the setup-history context that Undo restores with the project (`setup-history-context.ts`);
  - the Start execution signature (`start-job-authorization.ts`).
- **Lenses run:**
  - L9 (entry-point parity), the main lens.
  - L4 (interleavings: Undo and Redo around a banner choice, a capture, a held job, and remote
    calls during a desktop gesture).
  - L1 (ADR-416 Amd 2/3, ADR-654, ADR-440 Amd 5, ADR-584).
  - L3 (twin setters).
  - L2, L5, L6 and L7 were not run as separate passes. No outside-world claim is made, and the
    trust boundary is H8's.
- **Counts:** 4 raised → 0 refuted → P1 2 / P2 0 / P3 2 (+5 KNOWN re-observed).
  - Refuter: 4 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED.
  - One severity change: H9-P2-1 is raised from P2 to P1.
  - One half of H9-P3-2 (detected-settings Apply) is refuted as unreachable today. Its rotary
    half carries the finding at P3.

## Headline

The job machine lock holds. Every store action, `setProject` and Undo/Redo pass through it,
Start re-checks the execution signature at the last synchronous moment, and no raw write path
touches the machine. The gaps are Undo restoring a *different* state than the operator chose.

- **"Keep current machine" (H9-P1-1).** The bed-reconciliation banner's safe choice is not an
  Undo step. One Ctrl+Z (of any earlier edit) or a Redo silently reinstalls the opened file's
  machine with no banner. A front-left origin's first travel moves from `Y360` to `Y350`. The
  persistence hook then saves the rejected machine as the app's machine for the next session.
- **Place Board (H9-P2-1, P1 after refuter).** Undoing a board registration leaves Start From at
  User Origin, although ADR-654 says one Undo step covers the whole change. The next Start burns
  at the `G92` board corner, not where the restored canvas shows the artwork, and nothing warns of
  the mismatch.
- Two smaller items concern Undo or Apply results that are reported as successful when the job
  lock refused them.

## Entry-point parity (L9)

| Write path | Setter | Job lock | One Undo step / restores live setup | Result |
|---|---|---|---|---|
| Ctrl+Z, Ctrl+Y, menu, Undo list (`store-actions.ts:152-217`) | `numberingEditGuardSetter(documentSet)` | own check first (`:171`, `:197`) + setter | restores the step's setup context (`:172-190`) | Clean |
| Phone / MCP `undo`, `redo` (`arrange.ts:209-218`) | same store action | yes | yes | **H9-P3-1** (refusal not in receipt) |
| Open, Recent, template, autosave restore, sheet, production row (`project-actions.ts:86-114`) | `documentSet` | pre-check returns `job-machine-locked`; all 7 callers handle it | history cleared (F-A14) | Clean (H4-P1-1 KNOWN) |
| New (`project-actions.ts:115-143`) | `documentSet` | setter | history cleared | Clean |
| Banner "Keep current machine" (`project-actions.ts:151-152,187-221`) | `documentSet` | setter | **no Undo step, no setup context, redo kept** | **H9-P1-1** |
| Banner "Use project machine" (`:150`) | `documentSet` | — (notice only) | n/a | Clean |
| Machine Setup Save, profile pick, import (`machine-setup-actions.ts:62-138`) | `set` | UI check (Amd 1) + setter | one step, context captured (`:87`) | Clean |
| Machine panel, feed ceiling, no-go zones, rotary toggle (`store-actions.ts:88-99`) | `set` | setter | one step, context captured (`:90`) | Clean |
| Rotary setup Apply / Generate (`RotarySetupHost.tsx:20-41`) | `updateDeviceProfile` | setter refuses | — | **H9-P3-2** (success toast, scene replaced) |
| Detected settings Apply (`laser-store.ts:510-516`) | `updateDeviceProfile` / `applyCncMachineSetup` | setter refuses | one step | **H9-P3-2** (logs "Applied"). Refuter: no production caller on either tree, so latent |
| Laser/CNC toggle (`MachineModeToggle.tsx:33-44`) | `set` | UI check + setter agree (Amd 3) | one step, context captured (`machine-actions.ts:197`) | Clean |
| CNC panel: bit, stock, safe Z, preset (`machine-actions.ts:131-190`) | `set` | setter (params compared) | one step | Clean |
| Place Board capture / register / resize (`board-capture-actions.ts:57-96,210-229`; `board-outline-register.ts:26-65`) | `set` | setter (artwork only) | **live placement changed, no context captured** | **H9-P2-1** |
| Camera "Add target to canvas" (`calibration-actions.ts:156-166`) | `replaceSceneWithGeneratedScene` + separate `setJobPlacement` | setter | placement outside the step | **H9-P2-1** (second site, READ) |
| Material library apply / linked refresh (`material-library-actions.ts:77-195`) | `set` | setter (layers allowed) | one step | Clean |
| Paste (scene, layer settings), drop import | `set` via Pro setter | setter (artwork allowed) | one step | Clean |
| Drag (`interactionActions`) | `interactionSet` | setter | one step; Undo mid-drag cancels | 08-P3-1 KNOWN |
| Jig editor, Photo engraving, AI, Studio, barcode, My artwork | `commitProjectEdit[Now]` | setter | one step | Clean |
| Joint resize, Stamp, camera fixture review / template | `proOperationMutationSetter(useStore.setState)` | **skipped**, but no machine field written | one step | KNOWN class 08 K-1 (two new call sites) |
| Polyline fairing upgrade, Review "reveal artwork", library sync | raw `useStore.setState` | skipped; no machine field | none (upgrade, selection) | KNOWN 06-P3-6; others clean |
| Start arming window | — | `currentLaserForAuthorizedStartNow` compares the execution signature synchronously before the streamer (`start-job-authorization.ts:50-52`) | — | Clean |

## Findings

### H9-P1-1 — Undo or Redo after "Keep current machine" silently reinstalls the opened file's machine, and the app then saves it as its own machine
- **Where:**
  - `src/ui/state/project-actions.ts:151-152` (`keepCurrentMachineForOpenedProject`) and
    `:187-221` (`keepCurrentMachinePatch`). The patch replaces `project.device` and `machine` with
    the notice's previous machine, and can switch mode. It does not:
    - push the opened project onto `undoStack`;
    - clear `redoStack`;
    - call `captureSetupHistoryContext`.
  - `src/ui/state/store-actions.ts:167-191` and `:193-216`: Undo and Redo restore whole project
    snapshots. Every snapshot taken between Open and Keep carries the opened file's device.
  - `src/ui/app/use-machine-profile-persistence.ts:14-31`: any device change within the same
    `projectDocumentEpoch` is written as the app's last machine (`rememberLastMachine`).
  - The banner's Keep buttons are at `src/ui/app/ProjectBedReconciliationBanner.tsx:28,51`.
- **Anchor:**
  - **Contract:** ADR-416 Decision 5 (`docs/decisions/ADR-416-laser-and-cnc-keep-their-own-settings.md:62-66`)
    lists "keeping the current machine for an opened file" as a mode switch, and says "Undo and
    Redo of a mode toggle restore the live placement" so that saving after Undo cannot overwrite
    either head.
  - **Contract:** ADR-440 Amendment 5 Decision 4
    (`ADR-440-amendment-5-bed-frame-siblings.md:60-63`): Keep current machine is "the safe
    choice", the one that "keeps the current bed and calibration".
  - **Twin:** every other machine change is its own Undo step with its setup context:
    - `updateDeviceProfile` (`store-actions.ts:88-99`);
    - `replaceDeviceProfile` (`:107-125`);
    - the mode toggle (`machine-actions.ts:194-241`, comment: "Undo/Redo must restore them
      together, like a Machine Setup save");
    - Machine Setup Save (`machine-setup-actions.ts:87`).
- **Scenario:**
  1. The operator corrected the bed to 400 × 410 mm (front-left origin, homing on).
  2. They open a file saved before that correction (same profile id and name, bed 400 × 400). The
     banner offers **Keep current machine** first.
  3. Before answering, they move or add artwork, which is ordinary since the banner does not block.
  4. They click **Keep current machine**. The bed is 410 again and the banner closes.
  5. Later they press Ctrl+Z to undo an artwork edit. The project goes back to the snapshot taken
     before that edit, so the bed is 400 again.
     - There is no banner, toast or other notice.
     - The artwork still burns, but every Absolute Y on a front-origin machine moves 10 mm.
     - The camera calibration also becomes the file's copy whenever the two differ, which G6-P2-2
       measured as 6 mm off.
  6. The persistence hook saves the 400 bed as the app's machine, so the next session also
     starts with it.
  - **Redo variant:** an edit, then Undo, then **Keep current machine**, then Redo. Redo restores
    the opened machine the same way, because Keep leaves the redo stack alone.
  - **A file from another machine:** a different name or profile id is the general banner case.
    The Undo then brings back that machine's origin, homing, controller and no-go zones.
- **Evidence:** REPRO.
  - **Store test:** a temporary `src/ui/state/zz-h9-undo-guards.test.ts` (deleted). It used the
    real store, `setProject`, `drawShape`, `keepCurrentMachineForOpenedProject`, `undo` and
    `redo`, and emitted with `prepareOutput` + `emitPreparedGcode` using the live placement.
  - **Command:** `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-h9-undo-guards.test.ts`
    → passed.
  - **Output (first rapid travel of the job):**
    - after Open: bed `400x400`, notice `shown`;
    - after two edits: `G0 X50.000 Y350.000`;
    - after **Keep current machine**: bed `400x410`, notice `null`, undo depth still 2,
      `G0 X50.000 Y360.000`;
    - after one Undo (it removed only artwork `b`): bed `400x400`, notice `null`,
      `G0 X50.000 Y350.000`.
  - **Redo variant:** `{"label":"after edit, Undo, Keep","bed":"400x410","notice":null,"redo":1}`,
    then `{"label":"after Redo","bed":"400x400","notice":null,"firstTravel":"G0 X50.000 Y350.000 S0"}`.
  - **Persistence:** a temporary `src/ui/app/zz-h9-persist.test.tsx` (deleted). It mounted the
    real `useMachineProfilePersistence`. It needs
    `NODE_OPTIONS=--no-experimental-webstorage`, the Node 25 quirk.
    - Output: `{"rememberedBeforeOpen":410,"rememberedAfterKeep":410,"projectBedAfterKeep":410,"projectBedAfterUndo":400,"rememberedAfterUndo":400}`.
- **Why P1:** the output position changes by 10 mm, and the change is silent. No toast or banner
  appears, and the operator's explicit choice is reversed by an unrelated Ctrl+Z.
  - The canvas bed outline does shrink by 2.5%, and Frame would trace the shifted job. Neither is
    a warning of the mismatch (METHOD §3, 2026-10-27).
  - Reach needs an edit before Keep (or Undo, Keep, Redo). Under §3, reach cannot lower a P1.
- **Novelty:**
  - Not KNOWN.
  - H4-P1-1 is Open with the *same* identity, where no banner appears.
  - G6-P2-2 (fixed by #1463) is the banner's wording and button order.
  - Neither covers Undo or Redo across the banner's choice.
  - No open PR touches these files (`gh pr list --state open` returned none).
- **Refuter:** CONFIRMED (own REPRO, plus READ on `105d6374c`). Severity stays **P1**.
  - **What would make it false:**
    - history snapshots that leave out or re-apply the device;
    - a notice or banner on Undo;
    - Keep pushing its own step;
    - the persistence hook skipping history moves.

    None holds.
    - `undo`/`redo` install the whole snapshot (`project: prev`, `store-actions.ts:174-175`).
    - `pushUndo` stores the whole `Project` (`undo-stack.ts:61-68`).
    - `keepCurrentMachinePatch` returns no `undoStack`, `redoStack` or context (`project-actions.ts:215-220`).
    - The hook returns early only on a `projectDocumentEpoch` change (`use-machine-profile-persistence.ts:17`), and Undo does not bump it.
    - `store-actions.ts`, `project-actions.ts`, `undo-stack.ts` and the hook are byte-identical between `a59f74ff9` and `105d6374c`.
  - **Store repro.** A temporary `src/ui/state/zz-h9r-undo.test.ts` (deleted) used the real store, with rect `a` at (50, 40). The machine was 400 × 410 with homing on, and the opened file was 400 × 400 with the same id and name.
    - after two edits: `G0 X50.000 Y360.000`;
    - after Keep: bed `400x410`, notice `null`, undo 2, redo 0, `G0 X50.000 Y370.000`;
    - after one Undo (it removed only `b`): bed `400x400`, notice `null`, `G0 X50.000 Y360.000`;
    - Redo puts back 410 (`Y370`).
    - **Redo variant** (edit, Undo, Keep, Redo): `{"bed":"400x410","redo":1}`, then `{"bed":"400x400","notice":null,"g0":"G0 X50.000 Y360.000 S0"}`.
  - **Persistence repro.** A temporary `src/ui/app/zz-h9r-persist.test.tsx` (deleted) mounted the real `useMachineProfilePersistence` and ran with `NODE_OPTIONS=--no-experimental-webstorage`.
    - Output: `{"rememberedBeforeOpen":410,"rememberedAfterOpen":410,"rememberedAfterKeep":410,"projectAfterKeep":410,"rememberedAfterUndo":400,"projectAfterUndo":400,"toasts":[]}`.
  - **Notice.** None.
    - `projectBedReconciliation` stays `null` and no toast is pushed.
    - The Undo list names the step after the artwork edit.
    - The one exception is on `105d6374c` only. `followBedPictureFrame` (`bed-picture-frame.ts:59-87`) says a head-camera bed picture "moved" if one is stored. That is not a notice that the machine reverted.
  - **Anchors re-read in `docs/decisions` on `105d6374c`.**
    - ADR-440 Amendment 5 exists. Decision 4 (`:58-64`) reads "the safe choice ... **Keep current machine**, which keeps the current bed and calibration". Quoted correctly.
    - ADR-416 Decision 5 (`:59-66`) exists, and the quote is accurate. But its Undo sentence covers "Undo and Redo of a mode toggle". It binds only the variant where Keep switches Laser/CNC; the bed-only repro has no mode switch.
    - Refuter-added anchor, ADR-500 Amendment 1 Decision 2 (`ADR-500-amendment-1-machine-persistence-and-fresh-canvas.md:24-26`): Open uses the document's machine "without silently replacing the independently saved application machine preference". The persistence repro shows that preference replaced by the opened file's machine, through Undo.
  - **Not a duplicate of H4-P1-1.**
    - H4-P1-1 is an Open with the same profile id, name *and* bed, where no banner appears. Its fix is in `canonicalizeOpenedProjectBed` / `withCurrentMachine*`.
    - H9-P1-1 needs the banner: the bed or identity differs and the operator chose Keep. Its fix is in `keepCurrentMachinePatch` and history.
    - Neither fix closes the other. They share only the persistence tail (`use-machine-profile-persistence.ts`), so they belong in one fix card.
    - Also not G6-P2-2 (#1463, wording and button order). G6's own refuter recorded that Keep "does restore" the 410 bed (`G6-camera-calibration.md:103,116`). Undo was not tested there.
  - **Severity: P1 stands.**
    - The same artwork's first travel moves 10 mm (`Y370` → `Y360`) after an Undo the operator meant for a different object. Nothing tells the operator that the machine changed.
    - The canvas bed outline shrinks by 2.5%, but the artwork stays at the same scene position. That is not a warning of the specific mismatch (METHOD §3, 2026-10-27; same ruling as ledger H8-P1-2).
    - The remembered app machine is also overwritten (410 → 400). That independently meets P1's "loses or corrupts user data": the operator's corrected bed is gone from the next session.
- **Fix direction:** make **Keep current machine** (and Use project machine, if it ever changes
  the project) an ordinary Undo step, with `pushUndo`, a cleared redo stack and
  `captureSetupHistoryContext`. Alternatively, rewrite the pending undo and redo snapshots' device
  and machine to the kept machine, so history cannot bring back the rejected machine.

### H9-P2-1 (P1 after refuter) — Undoing a Place Board capture or registration leaves Start From at User Origin; Undo of "Add target to canvas" leaves Absolute
- **Where:**
  - `src/ui/state/board-capture-actions.ts:210-229` (`commitCapturedBoard`, used by
    `addCapturedBoard` and `registerCapturedBoardOutline`'s fallback) sets
    `jobPlacement: placement` (`:226`) in the same patch as the undo push from
    `applyAddRegistrationBox`. It never calls `captureSetupHistoryContext`.
  - `updateCapturedBoardMutation` (`:79-96`) does the same (`:90`, `:92`).
  - `src/ui/state/board-outline-register.ts:26-65` (ADR-654 registration): `jobPlacement:
    placement` (`:58`) with `undoStack: pushUndo(...)` (`:60`), and no context.
  - Undo (`store-actions.ts:167-191`) restores the live placement only from a captured context
    (`:172`, `:190`).
  - **A second site (READ):** `src/ui/camera/calibrate/calibration-actions.ts:156-166`.
    **Add target to canvas** replaces the scene (one Undo step), then calls
    `setJobPlacement({ startFrom: 'absolute' })` outside it (`:165`). Undo brings the operator's
    artwork back but leaves Absolute.
- **Anchor:**
  - **Contract:** ADR-654 Decision 5 (`docs/decisions/ADR-654-outline-board-from-photo.md:47`):
    "Placement switches to User Origin, front-left. One Undo step covers the whole change."
  - **Twin:** a device change that moves the live placement is restored with the project.
    - `store-actions.ts:88-99` captures the context.
    - So does `machine-actions.ts:194-197` ("The toggle swaps live placement … Undo/Redo must
      restore them together").
    - The repro below shows the twin restoring Absolute.
- **Scenario:**
  1. Artwork is laid out at Absolute Coordinates.
  2. The operator captures a board (ADR-124) or registers a drawn outline (ADR-654, desktop or
     MCP `finish_board`). This writes a `G92` at the board corner and switches Start From to
     User Origin, front-left.
  3. They press Undo, for example because they measured the wrong corner. The outline and the
     artwork's turn revert, but Start From stays at User Origin.
  4. The next Start burns the job with its front-left at the `G92` corner, not where the canvas
     shows it on the bed. With an outline registration, the art also loses the board's measured
     turn.
- **Evidence:** REPRO in the same temporary test. The output is `jobPlacement` and the first
  rapid travel.
  - **ADR-124 rectangle:**
    - before capture: Absolute, `G0 X50.000 Y350.000`;
    - after `addCapturedBoardBox(120, 80)`: User Origin;
    - after Undo: board gone, placement `{"startFrom":"user-origin","anchor":"front-left"}`,
      `G0 X0.000 Y20.000`.
  - **ADR-654 outline** (`drawCapturedBoardOutline`, artwork, `registerCapturedBoardOutline(...,
    5°)`, Undo):
    - before: Absolute, `G0 X160.000 Y230.000`;
    - after registration: User Origin, `G0 X12.767 Y63.372`;
    - after Undo: the outline and the artwork's turn are reverted, placement still
      `user-origin`, `G0 X10.000 Y60.000`.
  - **Twin in the same run:** homing on, Absolute, then homing off. Placement became
    `user-origin` (`G0 X0.000 Y20.000`). Undo restored `absolute` (`G0 X50.000 Y350.000`).
- **Why P2, not P1:**
  - After an Undo the burn still lands on the captured board (the work origin the operator just
    set).
  - The Laser panel's Start From names the mode.
  - Which position is "right" after undoing a registration is less clear-cut than in H9-P1-1.
  - The ADR-654 contract breach and the twin gap are clear. A refuter weighing §3 strictly may
    rule it P1, because nothing warns of the mismatch.
- **Novelty:**
  - Not KNOWN.
  - `pr-history/FINDINGS.md` BRP-01 (#1145) covered a stale correction after Undo, not
    placement.
  - H6-P3-2 covers Place Board plus Absolute advice, not Undo.
- **Refuter:** CONFIRMED (own REPRO of all three sites, plus READ on `105d6374c`). **Severity
  P2 → P1.**
  - **What would make it false:**
    - Undo restoring `jobPlacement`, through a captured context or a subscriber;
    - a Start or Job Review check on User Origin when no captured board is present;
    - ADR-654 Decision 5 not saying this.

    None holds.
    - `commitCapturedBoard` (`board-capture-actions.ts:210-229`), `updateCapturedBoardMutation` (`:79-96`) and `registerCapturedOutlineMutation` (`board-outline-register.ts:26-64`) never call `captureSetupHistoryContext`.
    - Undo restores placement only from a context (`store-actions.ts:172-173,190`).
    - The only `captured-board` check in Job Review excludes the board from the jig review (`job-review-registration-jig.ts:21`).
    - ADR-654 Decision 5 (`ADR-654-outline-board-from-photo.md:46-47`) is quoted verbatim.
    - All three files are byte-identical on `105d6374c`. `calibration-actions.ts` changed only a comment.
  - **Repro.** The same temporary `zz-h9r-undo.test.ts`, with art at (50, 40) on a 400 × 400 front-left bed with homing on.
    - **Rectangle (ADR-124):**
      - before: Absolute, `G0 X50.000 Y360.000`;
      - after `addCapturedBoardBox(120, 80)`: User Origin, `G0 X-90.000 Y200.000`;
      - after Undo: board gone, `jobPlacement` `{"startFrom":"user-origin","anchor":"front-left"}`, `G0 X0.000 Y10.000`.
      - The restored project's own `jobSetup.placement` is `{"startFrom":"absolute",...}`, so the store disagrees with itself. A Save writes the live User Origin (`projectWithCurrentJobSetup`).
    - **Outline (ADR-654)**, drawn at (140, 160), art at (150, 170), registered at 5°:
      - before: Absolute, `G0 X150.000 Y230.000`;
      - after registration: User Origin, `G0 X12.805 Y74.244`;
      - after Undo: art rotation 0, still `user-origin`, `G0 X10.000 Y70.000`.
    - **Twin:** turning homing off moved Absolute to User Origin, and Undo restored `absolute`.
    - **Add target to canvas.** A temporary `src/ui/camera/calibrate/zz-h9r-target.test.ts` (deleted) called the real `addCalibrationTargetToCanvas`.
      - Output: `{"objectsBefore":0,"objectsAfterAdd":35,"placementAfterAdd":{"startFrom":"absolute","anchor":"center"},"objectsAfterUndo":0,"placementAfterUndo":{"startFrom":"absolute","anchor":"center"}}`.
      - The operator's User Origin is lost. This site is now REPRO, not READ.
  - **Ruling: P1.** The deciding test is whether the burn is wrong relative to what the canvas shows after Undo. For the lead scenario it is.
    - After Undo of a rectangle or circle capture, the canvas holds the pre-capture Absolute layout. The art sits at bed (50, 40), and no board outline ties it to the work origin.
    - The burn goes to the `G92` board corner instead. That corner is wherever the board is, often 100 mm or more from the canvas position.
    - ADR-654 Decision 5 makes the pre-capture placement the contract state after Undo.
    - **Not a warning.** The Laser panel's Start From and Job Review's "User origin" tile (`job-review-format.ts:70-73`) name the mode. Neither tells the operator that Undo left the step's placement behind. Frame would trace the corner, and Frame is not a warning (METHOD §3, 2026-10-27).
    - **Contrast with H6-P3-2.** H6-P3-2 stayed below P1 because "the operator changes the mode". Here the operator did not.
    - **The auditor's "still lands on the captured board".** That holds for the board's corner, not for where the art was laid out. It does not show the output is right.
  - **Sub-sites, for the fix card.**
    - **Outline Undo.** The error is smaller: the lost 5° turn, and the anchor moves from the drawn outline's corner to the registered outline's bounding-box corner. A contract-correct Absolute would burn at the centred drawn outline, off the board (the H6-P3-2 effect). So the fix needs a word for the outline case too, for example a notice after Undo of a registration.
    - **Camera target Undo.** It burns where the canvas shows (Absolute), so on its own it would be P2.
- **Fix direction:**
  - Capture the setup context in `commitCapturedBoard`, `updateCapturedBoardMutation` and
    `registerCapturedOutlineMutation`, as the device setters do.
  - Make the camera target's Absolute switch part of the same step: one `set` that captures
    the context.

### H9-P3-1 — A phone or MCP Undo or Redo that the job lock stops returns an ordinary receipt
- **Where:** `src/ui/remote-control/arrange.ts:209-218` (`applyHistory`), reached from
  `writes.ts:111-113`.
  - It calls `state.undo()` or `state.redo()` and returns `authoringReceipt` with the changed ids.
  - When `refuseJobMachineChange` stops the step, the reply is a plain `ok` with no changed ids
    and `canUndo: true`. The reason appears only as a toast on the PC.
- **Anchor:**
  - **Twin:** the remote's other desktop refusals are faults. A refused `drawShape` throws
    `RemoteFault('failed')` (`writes.ts:135-137`), and ADR-584 returns `needs_pro` "immediately"
    (`ADR-584-full-remote-design-control.md:24`).
  - **Contract:** ADR-416 Amendment 2 Decision 4. Undo and Redo "show their own message"; the
    remote caller gets none.
- **Scenario:** a CNC job is held at a bit change and the last step changed safe Z. Phone or MCP
  **Undo** replies `ok` with nothing changed. An AI client may assume the undo landed and go on
  editing, or press Undo again and get the same silent no-op.
- **Evidence:** REPRO (same temporary test). `registerActiveJobProbe(() => true, () => 'cnc')`,
  then `applyHistory(state, useStore, 'undo')` →
  `{"receipt":{"changedArtworkIds":[],"selection":[],"history":{"canUndo":true,"canRedo":false}},"safeZBefore":9,"safeZAfter":9,"undoDepthBefore":2,"undoDepthAfter":2,"pcToasts":["Undo stops here while a job is running: …"]}`.
- **Why P3:** the refusal is fail-safe and nothing physical changes. Only the remote report is
  wrong.
- **Novelty:** H8 marked remote Undo "Clean (H9 owns Undo guards)". Not KNOWN.
- **Refuter:** CONFIRMED (own REPRO). P3 stands.
  - **What would make it false:** `applyHistory` or `commit` detecting a no-op. Neither does.
    `applyHistory` (`arrange.ts:209-218`, unchanged on `105d6374c`) calls `state[action]()` and
    builds the receipt from whatever is in the store afterwards.
  - **Repro.** The temporary `zz-h9r-persist.test.tsx` (deleted) made a device edit, then
    `registerActiveJobProbe(() => true)`, then `applyHistory(state, useStore, 'undo')`.
    - Output: `{"receipt":{"changedArtworkIds":[],"selection":[],"history":{"canUndo":true,"canRedo":false}},"thrown":null,"undoBefore":2,"undoAfter":2,"feed":1234}`.
    - The PC toast is queued in a microtask (`job-machine-lock.ts` `refuseJobMachineChange`).
  - **Severity:** fail-safe, and only the remote report is wrong, so P3.
- **Fix direction:** have `applyHistory` compare the project before and after. When the
  history did not move, throw a `RemoteFault` (or return a message) that carries the lock's
  wording.

### H9-P3-2 — Guarded machine writes whose callers assume success: detected-settings Apply says "Applied" and rotary setup says "enabled" while the job lock refused
- **Where:**
  - `src/ui/state/detected-settings-action.ts:95-121`: `applyDetectedSettingsPatch` calls
    `updateDeviceProfile` or `applyCncMachineSetup`, then returns `true` unconditionally.
  - `src/ui/state/laser-store.ts:510-516` then clears `detectedSettings` and logs
    `[lf2] Applied detected machine settings to device profile.`
  - `src/ui/laser/RotarySetupHost.tsx:20-41` (READ):
    - **Apply** calls `updateDeviceProfile({ rotary })`, closes the dialog and shows the success
      toast "Rotary enabled for this profile.";
    - **Generate** does the same, then replaces the scene with the rotary test pattern, a write
      the lock allows.
  - The lock refuses `rotary` and the bed/feed fields (`job-machine-lock.ts:41-56`).
- **Anchor:**
  - **Contract:** ADR-416 Amendment 2 Decision 3
    (`ADR-416-amendment-2-a-running-job-keeps-its-machine-in-the-store.md:38-39`): a refused change
    is dropped whole "and a warning says why". Here a success message follows the warning.
  - **Twin:** `proOperationMutationSetter` reads success from the store ("success is read from
    the store, not assumed", `pro-operation-mutation.ts:55-60`), and `setProject` returns
    `job-machine-locked`.
- **Scenario:**
  - **Detected settings:** the operator leaves the banner open, starts a job, and clicks Apply
    mid-job. The PC shows "Nothing was changed", but the banner disappears and the Console log
    says "Applied". After the job the profile still has the old bed and feed, and the detection is
    gone until the next connect.
  - **Rotary:** Generate during a job leaves the test pattern on the canvas with the rotary not
    enabled, plus a toast saying "Burned, it should measure … mm around the part". Started after
    the job, it burns without the rotary mapping. The lock's warning toast did appear first, so
    this is not raised above P3.
- **Evidence:**
  - **REPRO** for the detected-settings half (same temporary test). With the lock active,
    `applyDetectedSettingsPatch({bedWidth:300,bedHeight:300})` gave
    `{"returned":true,"bedWidthBefore":400,"bedWidthAfter":400,"pcToasts":["Finish or stop the running job before changing Laser/CNC or the machine setup. Nothing was changed."]}`.
    The banner clear and log line are at `laser-store.ts:512-516` (READ).
  - **READ** for the rotary half.
- **Novelty:** not KNOWN. H4's table rated the Machine panel and banner paths clean on the
  setter. It did not check the callers' success reporting.
- **Refuter:** CONFIRMED for the rotary half (store REPRO plus READ of the host). The
  detected-settings half is REFUTED as unreachable today, so latent (see Refuted). P3 stands.
  - **Detected settings.** `applyDetectedSettings` has no production caller on `a59f74ff9` or on
    `105d6374c`.
    - `git grep` finds only the action, its type and a test-support stub.
    - `DetectedSettingsBanner.tsx` now exports helpers only. The live notice is
      `DetectedSettingsToast`, which has no Apply.
    - So the "banner disappears and Console says Applied" scenario cannot be reached. The
      `return true` is still wrong code, at P3 as latent.
  - **Rotary.** The temporary `zz-h9r-undo.test.ts` (deleted) ran with the job probe active and
    made the host's two calls: `updateDeviceProfile({ rotary: enabled })`, then
    `replaceSceneWithGeneratedScene(pattern)`.
    - Output: `{"rotaryEnabled":null,"sceneObjects":1,"artGone":true}`. The rotary was refused
      and the scene was replaced.
    - `RotarySetupHost.tsx:20-41` pushes its success toast unconditionally.
    - Reach: Rotary **Setup…** is not disabled while busy (`RotaryModeSwitch.tsx:52-54`; only the
      toggle at `:43` is), and `RotarySetupDialog.tsx:70-75` has no job check.
  - **Severity:** P3. The lock's own warning ("Nothing was changed") still appears, and the
    Rotary switch reads Off. Opening Rotary Setup mid-job is not an ordinary path.
- **Fix direction:** return whether the device actually changed (compare
  `useStore.getState().project.device` before and after), and keep the banner or dialog open,
  without a success message, when it did not. Alternatively, disable these controls while
  `isActiveJob`.

## KNOWN (re-observed on 105d6374c, not re-raised)

- **H9-K-1 — rolling-v2 08 K-1 (class 02-P2-1).** Raw writers that skip `store-setters.ts`.
  - They now also skip the job lock. #1419 came after the 08 audit.
  - Re-observed: `src/ui/commands/use-joint-resize-review.ts:65` and `use-stamp-work.ts:162`.
  - Two call sites of the same class are not in 08's list:
    - `src/ui/camera/pieces/fixture-template-commit.ts:15`;
    - `src/ui/camera/pieces/use-fixture-review.ts:140`.
    Both pass `useStore.setState` to `proOperationMutationSetter`.
  - None of the four writes `project.device` or `machine`, so the job lock is moot. The numbering
    and relief-link half of K-1 still stands.
- **H9-K-2 — rolling-v2 06-P3-6.** `src/ui/laser/job-review/reveal-reviewed-artwork.ts:42` still
  writes `project` through `useStore.setState` (selection and output scope only).
- **H9-K-3 — rolling-v2 08-P3-1.** Undo during a live drag restores `pendingUndo`
  (`store-actions.ts:156-166`). The remote refuses while `pendingUndo` is set (`adapter.ts:291`).
  Not re-run.
- **H9-K-4 — H4-P1-1.** Open of a same-identity file reverts the machine with no banner. The logic
  is unchanged on 105d6374c (`project-bed-reconciliation.ts:117-132,165-167`). H9-P1-1 is its
  banner-path sibling.
- **H9-K-5 — H2-P3-2.** The laser Review's pre-start moves read the open project. ADR-416 Amd 3
  covers only a running job.

**Refuter (KNOWN items):** all five were re-observed on `105d6374c` with `git grep`/`git show`.
- K-1: the four `proOperationMutationSetter(useStore.setState, …)` sites are at
  `fixture-template-commit.ts:15`, `use-fixture-review.ts:140`, `use-joint-resize-review.ts:65` and
  `use-stamp-work.ts:162`. Their mutations write scene or fixture state, not `device` or `machine`.
- K-2: the raw write is at `reveal-reviewed-artwork.ts:42`.
- K-3: the drag cancel is at `store-actions.ts:156-166`.
- K-4: the H4-P1-1 ledger row is unchanged.
- K-5: H2-P3-2 is at `H2-recovery-journey.md:476`.

Each stays KNOWN against its prior report. K-4 is a separate path from H9-P1-1 (see that
finding's refuter note).

## Refuted

Refuted by the refuter (part of a raised finding):

- **H9-P3-2's detected-settings half.** Detected-settings Apply cannot run mid-job today:
  `laser-store.ts` `applyDetectedSettings` has no production caller on `a59f74ff9` or
  `105d6374c`. The banner with an Apply button was replaced by `DetectedSettingsToast`, which
  has none. The unconditional `return true` in `applyDetectedSettingsPatch`
  (`detected-settings-action.ts:95-122`) is therefore latent. The finding stands on its rotary
  half.

Candidates the auditor checked and dropped:

- **`startJob` defaults `activeJobMachineKind` to `'laser'`** (`laser-job-actions.ts:438`), so a
  CNC stream could be mislabelled and the lock would allow a switch to Laser. Every production
  caller passes `machineKind`:
  - `start-job-transmission.ts:201`;
  - `transient-camera-job.ts:175`;
  - `external-run.ts:250`;
  - `laser-recovery-flow.ts:314`;
  - `start-job-resume-stream.ts:73`;
  - the CNC recovery stream.
- **An Undo or MCP edit between Job Review and the stream runs a program for another machine.**
  `currentLaserForAuthorizedStartNow` compares `currentReplayExecutionSignature()` synchronously
  before the streamer is created (`start-job-authorization.ts:50-52`). The key covers scene,
  machine, `cncSetup`, the retained device fields, placement, scope and registration
  (`canvas-motion-plan.ts:268-303`).
- **Undo of the Active bit in a CNC hold lets Continue run on another bit's Work Z.** It fails
  closed: Continue needs the selected tool to equal `pendingToolId`, with evidence bound to that
  tool.
- **A setup-context restore moves `probeSetupEpoch` backwards** (`store-actions.ts:190`). It keys
  only the probe form's draft (`probe-form-store.ts:81-84`); nothing physical depends on it.
- **An Open or Undo that changes `positioningLight` while the Falcon laser dot is lit strands the
  beam.** The off uses the mapping captured at on (`positioning-light-actions.ts:243-246`). A
  failed off falls back to M5 through `setFireActive(false)` (`positioning-light-on.ts:148-156`).
- **Job placement and output scope are outside the lock.** By ADR-416 Amd 2 Decision 2,
  placement is not the job's machine, and no hold-time motion reads it. CNC Pause and lift
  plans from the streamed lines (`cnc-pause-lift.ts:107-131`).
- **During a laser recovery with a CNC project open, `switchesOntoJobKind` lets Open load
  another machine's laser project.** This is ADR-416 Amd 3 Decision 3 by design. The motion half
  is H2-P3-2.
- **An Undo between an interruption and Start from line changes the restart.** The manual
  restart says so: "Line numbers count this project's full program as it compiles now…" and
  "This project no longer reproduces the saved interrupted job's program…"
  (`manual-restart-source.ts:161-185`).

## Verified clean

- **Setter wiring** (`store-setters.ts:21-34`, `store.ts:432-492`).
  - `jobMachineGuardSetter` is innermost for `documentSet`, `interactionSet` and `set`.
  - Every action slice takes one of them.
  - History uses `numberingEditGuardSetter(documentSet)`.
- **Raw `useStore.setState` in `src/ui` production code.** There are 11 sites. None writes
  `project.device` or `project.machine`:
  - the fairing upgrade (scene);
  - reveal (selection and scope);
  - library sync (three sites);
  - two dirty-flag writes;
  - the four `proOperationMutationSetter(useStore.setState)` sites (artwork and fixtures).
- **`setProject` callers.** All 7 handle `job-machine-locked` on 105d6374c:
  - `file-actions.ts:383`;
  - `project-open-completion.ts:38,81`;
  - `project-template-actions.ts:71`;
  - `use-autosave.ts:155`;
  - `production-manifest-actions.ts:136`;
  - `project-sheet-actions.ts:100`.
- **The toolbar and the store agree after Amd 3.** Compare `MachineModeToggle.tsx:33-44` with
  `job-machine-lock.ts:83-91,114-121`.
- **Remote writes.**
  - `assertCurrent` refuses `busy` while a desktop gesture holds `pendingUndo`, and refuses on a
    stale revision (`adapter.ts:288-295`).
  - `inOneUndoStep` re-asserts ownership (`design-operations.ts:204-238`).
  - A deferred Pro commit refuses a changed project (`pro-operation-mutation.ts:79-89`).
  - The lock is synchronous in the setter, so a late commit is still checked.
- **One Undo step with setup context** holds for the device patch, the profile pick, Machine
  Setup Save, the mode toggle and the CNC setup patch. The twin repro restored Absolute after
  Undo of homing off.
- **A second window.**
  - Electron is single-instance (`electron/desktop-project-open.ts:59`).
  - Browser windows keep separate stores.
  - Recovery slots announce over a BroadcastChannel (`recovery-window-link.ts`).
  - Autosave slots carry window ownership (`use-autosave.ts:41`).
  - The material-library `storage` sync writes library state only, never the project.

## Not verified

- **No hardware was operated.**
- **MCP `finish_board`** was read only. It uses the same `registerCapturedBoardOutline` as the
  repro. The refuter reproduced H9-P2-1's camera-target site through the real
  `addCalibrationTargetToCanvas`.
- **The rotary dialog** was not rendered. The refuter ran the host's two store calls under the
  lock. The success toast is READ (`RotarySetupHost.tsx:20-41`).
- **The Undo list (history panel) jump** was not driven. ADR-416 Amd 2's test covers it.
- **Browser multi-tab interleavings** beyond reading the recovery and autosave ownership code
  (H7's area).
- **The repros ran on the `a59f74ff9` tree.** The exercised files are identical on
  `105d6374c`; only `job-machine-lock.ts` differs, by Amd 3. The H9-P3-1 repro keeps a CNC
  project open under a CNC job, where Amd 3's new branch does not apply.


```json
[
  {"id":"H9-P1-1","severity":"P1","area":"undo-guards","file":"src/ui/state/project-actions.ts","line":187,"anchor":"Contract: ADR-440 Amd 5 Decision 4 (Keep current machine is the safe choice that keeps the current bed and calibration); ADR-500 Amd 1 Decision 2 (Open must not silently replace the saved application machine preference; refuter-added); ADR-416 Decision 5 (keeping the current machine for an opened file is a mode switch; Undo/Redo of a mode toggle restore the live setup; binds the mode-switch variant only); Twin: updateDeviceProfile/replaceDeviceProfile/mode toggle/Machine Setup Save are one Undo step with captureSetupHistoryContext","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own store REPRO (rect at 50,40; 400x410 machine, 400x400 same-identity file): Keep -> G0 X50 Y370, one Undo of an unrelated edit -> bed 400x400, notice null, G0 X50 Y360; Redo variant (edit, Undo, Keep, Redo) -> 400x400. Own persistence REPRO with the real hook: remembered bed 410 -> 400 after Undo, no toast. Snapshots are whole Projects (undo-stack.ts:61-68, store-actions.ts:174-175); Keep returns no undo/redo/context (project-actions.ts:215-220). Not a duplicate of H4-P1-1 (banner path vs same-identity no-banner path; separate fixes, shared persistence tail). P1 kept: 10 mm silent move plus corrupted remembered machine; the canvas bed outline shrink is not a warning (METHOD 3, 2026-10-27; ledger H8-P1-2)","known":false,"summary":"Keep current machine is not an Undo step and keeps the redo stack: one Ctrl+Z of an edit made before it (or a Redo after Undo) silently reinstalls the opened file's machine with no banner (bed 410 -> 400, first travel G0 X50 Y360 -> Y350 on a front-left machine), and use-machine-profile-persistence then saves the rejected machine as the app's machine (remembered bed 410 -> 400)"},
  {"id":"H9-P2-1","severity":"P1","area":"undo-guards","file":"src/ui/state/board-capture-actions.ts","line":226,"anchor":"Contract: ADR-654 Decision 5 ('Placement switches to User Origin, front-left. One Undo step covers the whole change.'); Twin: store-actions.ts:88-99 and machine-actions.ts:194-197 capture the setup context so Undo restores live placement","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO of all three sites. Rectangle capture: Absolute G0 X50 Y360 -> capture -> Undo leaves user-origin, G0 X0 Y10 relative to the G92 corner, while the restored project's jobSetup.placement says absolute. Outline at 5 deg: Absolute G0 X150 Y230 -> register G0 X12.805 Y74.244 -> Undo user-origin G0 X10 Y70, turn lost. Twin (homing off) Undo restores absolute. Add target to canvas (real addCalibrationTargetToCanvas): Undo removes the 35 rings but leaves absolute (was user-origin). Severity P2 -> P1: after Undo of a capture, the canvas shows the pre-capture Absolute layout with no board, but the burn lands at the G92 board corner; Start From and the Job Review origin tile name the mode, they do not warn of the mismatch (METHOD 3, 2026-10-27); the operator did not choose the mode (contrast H6-P3-2). The camera-target sub-site burns where the canvas shows and would be P2 alone","known":false,"summary":"Undo of a Place Board capture (ADR-124) or outline registration (ADR-654, also MCP finish_board) reverts the outline and artwork turn but leaves Start From at User Origin (G0 X50 Y350 Absolute before; G0 X0 Y20 / X10 Y60 relative to the G92 corner after Undo); Add target to canvas likewise forces Absolute outside its Undo step (refuter REPRO)"},
  {"id":"H9-P3-1","severity":"P3","area":"undo-guards","file":"src/ui/remote-control/arrange.ts","line":209,"anchor":"Twin: writes.ts:135-137 drawShape refusal -> RemoteFault('failed'), ADR-584 needs_pro returned immediately; Contract: ADR-416 Amd 2 Decision 4 (Undo/Redo show their own message)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO: device edit, active job probe, applyHistory(state, useStore, 'undo') -> receipt {changedArtworkIds:[],history:{canUndo:true}}, nothing thrown, undo depth 2 -> 2, the edit kept; applyHistory never compares before/after (arrange.ts:209-218, unchanged on 105d6374c). P3 kept: fail-safe, only the remote report is wrong","known":false,"summary":"Phone/MCP undo or redo stopped by the job lock returns ok with no changed ids and canUndo true; the refusal reaches only a PC toast"},
  {"id":"H9-P3-2","severity":"P3","area":"undo-guards","file":"src/ui/laser/RotarySetupHost.tsx","line":20,"anchor":"Contract: ADR-416 Amd 2 Decision 3 (a refused change is dropped whole and a warning says why); Twin: proOperationMutationSetter reads success from the store (pro-operation-mutation.ts:55-60), setProject returns job-machine-locked","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Rotary half CONFIRMED: with the job probe active, the host's calls updateDeviceProfile({rotary enabled}) then replaceSceneWithGeneratedScene(pattern) gave rotary not applied, scene replaced by the 1-object pattern, art gone; RotarySetupHost.tsx:20-41 pushes its success toast unconditionally; Rotary Setup... is not disabled while busy and the dialog has no job check. Detected-settings half REFUTED as unreachable: laser-store applyDetectedSettings has no production caller on a59f74ff9 or 105d6374c (the Apply banner became DetectedSettingsToast), so detected-settings-action.ts:95-122 is latent. P3 kept","known":false,"summary":"During a job, Rotary setup Apply/Generate show success toasts (Generate also replaces the scene with the test pattern) while the lock refused the rotary change; the detected-settings Apply that returns true unconditionally is latent (no production caller)"},
  {"id":"H9-K-1","severity":"P3","area":"undo-guards","file":"src/ui/camera/pieces/use-fixture-review.ts","line":140,"anchor":"Contract ADR-592 decision 5; Twin store-setters.ts","evidence":"READ","verdict":"KNOWN","refuter":"Re-observed on 105d6374c: four proOperationMutationSetter(useStore.setState, ...) sites; none writes device or machine","known":"docs/audits/2026-10-21-rolling-v2/08-canvas-commands.md K-1 (class 02-P2-1); new call sites fixture-template-commit.ts:15, use-fixture-review.ts:140","summary":"proOperationMutationSetter(useStore.setState) writers skip the numbering, relief-link and (since #1419) job-lock setters; none writes machine fields"},
  {"id":"H9-K-2","severity":"P3","area":"undo-guards","file":"src/ui/laser/job-review/reveal-reviewed-artwork.ts","line":42,"anchor":"Contract store-owned project writes","evidence":"READ","verdict":"KNOWN","refuter":"Re-observed on 105d6374c at :42","known":"docs/audits/2026-10-21-rolling-v2/06-laser-ui-settings.md P3-6","summary":"Raw useStore.setState writes project (selection/scope) outside the store setters"},
  {"id":"H9-K-3","severity":"P3","area":"undo-guards","file":"src/ui/state/store-actions.ts","line":156,"anchor":"WORKFLOW F-A14","evidence":"READ","verdict":"KNOWN","refuter":"Re-observed on 105d6374c at :156-166","known":"docs/audits/2026-10-21-rolling-v2/08-canvas-commands.md P3-1","summary":"Edits and Undo during a live drag merge into or cancel the drag"},
  {"id":"H9-K-4","severity":"P1","area":"undo-guards","file":"src/ui/state/project-bed-reconciliation.ts","line":117,"anchor":"Contract ADR-500 Amd 1 Decision 2","evidence":"READ","verdict":"KNOWN","refuter":"Re-observed; separate path from H9-P1-1 (no banner vs banner + history)","known":"docs/audits/2026-10-27-rolling-v3/H4-machine-setup-connect.md H4-P1-1","summary":"Open of a same-identity file silently reverts origin, homing, no-go zones and scan offsets"},
  {"id":"H9-K-5","severity":"P3","area":"undo-guards","file":"src/ui/laser/laser-recovery-move.ts","line":26,"anchor":"Twin CheckpointResumeBanner isolation claim","evidence":"READ","verdict":"KNOWN","refuter":"Re-observed; H2-P3-2 at H2-recovery-journey.md:476","known":"docs/audits/2026-10-27-rolling-v3/H2-recovery-journey.md H2-P3-2","summary":"The laser Review's pre-start moves read the open project"}
]
```
