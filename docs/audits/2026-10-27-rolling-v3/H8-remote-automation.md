# Rolling audit v4 — Remote and automation

- **When:** 2026-10-27   **Tree:** origin/main @ `a59f74ff9` (the audit worktree's source under `src`,
  `electron` and `services` is identical: `git diff a59f74ff9 HEAD -- src electron services` is empty).
  The local `origin/main` has since moved to `ce0548938` (#1459, #1460). #1460 fixes the KNOWN
  G7-P3-1 and is not part of this tree.
- **Scope:**
  - Remote machine actions: `src/ui/remote-control/machine-*.ts`, `src/ui/remote-access/**`,
    `electron/mcp/*-schemas.ts`, `electron/mcp/machine-tool-info.ts`, the phone and MCP App UI in
    `services/remote-control/app/src/**`.
  - Remote design actions: `src/ui/remote-control/{adapter,writes,design-*,arrange,transforms,board}.ts`.
  - AI: `src/ui/ai/**`, `src/core/ai/assistant.ts`, `electron/ai/**` (re-checked against 28-P2-1 and
    K-4 only). Artcraft legacy editors were not re-audited (report 28 covered them).
  - Desktop twins followed: `JogPad.tsx`, `jog-control-policy.ts`, `manual-motion-limits.ts`,
    `laser-jog-warnings.ts`, `laser-command-family.ts`, `JobSetupControls.tsx`,
    `CncOperationToolFields.tsx`, `cnc-startup-setup.ts`, `dxf-import-action.ts`,
    `svg-import-action.ts`, `import-toasts.ts`, `import-bed-fit-notice.ts`, `JobReviewDialog.tsx`,
    `JobReviewRegistrationJig.tsx`, `use-frame-action.ts`, `start-job-flow.ts`,
    `laser-job-pause-resume.ts`.
  - Governing: PROJECT.md non-negotiable 9, ADR-125 Amd 1,
    ADR-306 Amd 3, ADR-569, ADR-584, ADR-585, ADR-654, ADR-657.
- **Lenses run:** L9 entry-point parity (main pass: every phone, MCP and AI action against its desktop
  twin), L5 trust boundary (what remote input reaches), L3 twins, L7 for the pinned tests. L2 only for
  two GRBL facts (pinned source). L1 through the ADRs above. No hardware was operated, no production
  service (relay, licence server, AI provider) was contacted.
- **Counts:** 8 raised → 0 refuted → P1 2 / P2 3 / P3 3 (+6 KNOWN re-observed). Refuter: CONFIRMED 6
  (H8-P1-1, H8-P1-2, H8-P2-1, H8-P2-2, H8-P2-3, H8-P3-1), PLAUSIBLE 2 (H8-P3-2, H8-P3-3), REFUTED 0.
  No severity changes. One sub-claim of H8-P1-1 is refuted (held), and the unrecognized-`$INSUNITS` case of H8-P2-3 is moved into
  H8-P1-2 (same silent-scale route).
- **Refuter repro:** two temporary focused Vitest files, `src/ui/remote-control/zz-h8r-refute.test.ts` and
  `zz-h8r-mem.test.ts`, run one at a time with
  `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=1536" node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose`
  (7 passed), then deleted.
- **Repro:** one temporary focused Vitest file, `src/ui/remote-control/zz-h8-parity.test.tsx`, run with
  `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/remote-control/zz-h8-parity.test.tsx --silent=false --reporter=verbose`
  (5 passed), then deleted. It drove the real remote adapter (`testAdapter` from
  `authoring-test-support.ts`) and the real machine executor (`executeMachineOperation`), and computed
  each desktop twin with its own code (the real `JogPad` hold, `sceneWithCncStartupOperationDrafts`,
  `describeImportResult`, `describeImportBedFit`, `laserCommands`).

## Headline

The machine half of the remote surface holds: Frame, Review, Start, Abort, origin, Zero Z, pause and
resume run the PC's own flows with the PC's guards. What slipped is file import and two places where
the remote calls a lower-level helper than the desktop does. **One finding is held as a security issue (H8-P1-1).** Details are withheld until its fix merges (security hold, METHOD rule for remotely reachable holes); the full text is kept privately by the coordinator. Remote SVG/DXF import also scales oversize art to the bed with no warning anywhere
(H8-P1-2), and drops every other import notice (H8-P2-3). A remote CNC bit change keeps the old bit's
feeds where the Artwork card recalculates them (H8-P2-1), and the phone's hold-to-jog has no travel
clamp, so it runs up to 100 mm past the homing switch where the PC's hold stops at the edge
(H8-P2-2).

## Entry-point table (L9)

| Action | Remote path | Desktop twin | Guard diff | Result |
|---|---|---|---|---|
| Connect | `executeConnect` → store `connect(remembered-only)` (`machine-actions.ts:53-89`) | Connect command / rail → `connectMachine` | Same store refusals (file-only, network) | Receipt text wrong: **H8-P3-3** |
| Disconnect | `executeDisconnect` (`:103-126`) | command family (`machineBusy`) | Remote is stricter (active job, motion, pending write) | Clean |
| Home | `executeHome` → store `home()` (`:128-135`) | Home button, menu, alarm banner | PC hides/disables Home when Machine Setup has homing off | **H8-P3-1** |
| Set origin XY | `executeOrigin` + `placementAfterSetOrigin` | `OriginRow` | Same (ADR-657) | Clean (G7) |
| Zero Z | `executeOrigin`, `REMOTE_ZERO_Z_REFUSAL` | `use-zero-z-action` confirm | Same | Clean (G7); Laser-mode phone Zero Z dropped (Refuted) |
| Jog step | `executeJog` → store `jog` | JogPad step | Same store guards; the bounds/no-go warning is a PC toast only | Part of **H8-P2-2** |
| Hold-to-jog | `executeHold` → `holdVector` 100 mm (`machine-hold.ts:28-53`) | JogPad hold → `continuousJogVector` clamped to `resolveManualMotionLimits` | Remote has no travel clamp | **H8-P2-2** |
| Frame | `runFrameNow({interactiveSetup:false})` | Frame button | Skips repair offers only; CNC Work-Z confirm becomes a refusal | Clean |
| Review / Start | `runFramedPermitStart` + `machineReviewPresenter` | Start → Job Review | Same gate; presenter mirrors blocker, preparing and card edit; acknowledgement projected | Review omits the jig block: **H8-P3-2** |
| Pause / Resume | `executePauseResume` → store | Live Motion bar | Same store | Clean; resume in a tool-change hold cannot pass Continue (Refuted) |
| Abort | `executeAbort` → `stopJob`, reserved lane | Live Motion Abort, Ctrl+. | Same `stopJob` | Clean; KNOWN 01-P2-5 |
| Board capture / finish | `executeBoardAction` | Place Board panel | Capture gate missing | KNOWN G7-P3-1 (#1460 merged after this tree) |
| Board photo / place | `board.ts` | Place Board panel | Pro, editable checks | Clean (G7) |
| Camera still | `cameraSnapshot` | Camera panel | Control + sharing opt-in | Clean |
| Operation edit (laser) | `updateOperationFull` → `setLayerParam` | Cut Settings | Bounds differ | KNOWN 01-P3-11 / 01-P3-12 |
| Operation edit (CNC bit) | `withManualCncFeedPatch({toolId})` | Artwork card → `sceneWithCncStartupOperationDrafts` | Recalc and kept-feeds note missing; unknown id accepted | **H8-P2-1** |
| Create / assign / reorder / delete operation, recipe | store actions | Layers panel | Same actions; desktop delete has no confirm either | Clean |
| Text, shapes, transform, arrange | store actions, `editableArtwork` | canvas tools | Locked/hidden refused, Pro copy admission | Clean; KNOWN G7-K-2 (`update_text` receipt) |
| SVG / DXF / raster import | `design-imports.ts` | File > Import | Import notices, bed-fit warning and own Undo step | **H8-P1-1, H8-P1-2, H8-P2-3** |
| Save | `saveProjectRemotely` | Save | Invalid-project salvage confirm | KNOWN 01-P3-9 (latent) |
| Undo / Redo | `applyHistory` → store | Ctrl+Z | Same store action | Clean (H9 owns Undo guards) |
| AI Add reviewed design | `applyAiDraft` via `commitProjectEdit` | Import seeding | Seeding (#1369), Pro/numbering guard (#1346), scene budget | Clean |
| AI material suggestions | review only | — | No Apply exists | Clean |

## Findings

### H8-P1-1 — SECURITY — held until fixed

- **Severity:** P1. Refuter: CONFIRMED.
- Details are withheld until its fix merges (security hold, METHOD rule for remotely reachable holes); the full text is kept privately by the coordinator.

### H8-P1-2 — Remote SVG/DXF import silently scales oversize art to the bed; the desktop warns and keeps the scale as its own Undo step
- **Where:**
  - `src/ui/remote-control/design-imports.ts:76-92` (`insertAndPlace`): the store `importSvgObject` /
    `importSvgFragment` runs inside `inOneUndoStep`. Its `ImportOutcome` (with `bedFit`) is discarded,
    and the receipt is `{changedArtworkIds, history}` only (`:256-258`). No PC toast is pushed.
  - The fit itself is in the store (`src/ui/state/import-bed-fit.ts:17-55`, called from
    `object-insert-actions.ts:126-146`), so both paths scale; only the desktop says so
    (`src/ui/app/import-bed-fit-notice.ts:10-23`, pushed at `dxf-import-action.ts:124-125` and the SVG
    import action).
  - Reach: MCP `add_svg`, `import_file`, `apply_edits`/`add_svg` without `widthMm`; the phone Import
    sheet sends no width unless the user types one (`import-sheet.tsx:41-44`).
- **Anchor:** Contract: ADR-125 Amendment 1 item 3
  (`docs/decisions/ADR-125-amendment-1-imports-keep-file-size.md:23-25`): "That scale is its own undo
  step" and the SVG and DXF imports "report it with a warning". The desktop file's own comment says the
  operator must hear about it "because the burn no longer matches the file"
  (`import-bed-fit-notice.ts:1-5`). Twin: the desktop import actions.
- **Scenario:** An MCP agent imports a 1000 × 500 mm part drawing (or the phone imports a large DXF
  without a width) on a 400 × 400 mm bed. The receipt says `ok` with the artwork id. The part is now
  360 × 180 mm (36 %). Nothing on the phone, in the MCP reply or on the PC says it was scaled, and the
  one Undo step also removes the import. Frame traces the scaled outline (Frame is not a warning,
  METHOD §3), and the job burns at 36 % scale.
- **Evidence:** REPRO. `zz-h8-parity.test.tsx` "H8 B", real adapter `add_svg`:
  `H8-B-SVG {"bed":{"w":400,"h":400},"code":"ok","remoteReceipt":{"changedArtworkIds":["…-0"],"history":{"canUndo":true,"canRedo":false}},"remoteSizeMm":{"w":360,"h":180},"remoteToastsOnPc":[],"desktopNotices":[…,"warning: part.svg is larger than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% to fit. Undo restores the original size."]}`.
  The desktop notice is computed from the same input with `describeImportBedFit` and the store's own
  `importSvgObject` outcome.
- **Severity note:** P1 by effect under §3 (silent scale, no warning before output). A refuter may argue
  that art larger than the bed cannot be burned at file size anyway; the defect is that the remote
  operator is not told, which ADR-125 Amd 1 requires.
- **Refuter:** CONFIRMED, P1 kept. The finding is widened to cover the unrecognized-`$INSUNITS` case
  from H8-P2-3.
  - *What would make it false:* a fit notice anywhere on the remote route, a receipt field that
    carries the size, or output that is not wrong.
  - *REPRO "H8R-P1-2"* imported the same 1000 × 500 mm SVG on the 400 × 400 bed through both `add_svg`
    and `import_file`. Each gave `ok`, receipt keys `["changedArtworkIds","history"]` and size
    360 × 180. The PC toast list was `[]`, the undo depth was 1, and one Undo left 0 objects (the
    import is gone, not restored to file size).
  - The desktop store import of the same object gives undo depth 2 and the notice "big.svg is larger
    than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% to fit. Undo restores the
    original size." The phone shows its own "Imported." (`import-sheet.tsx:46`). The MCP tool text
    (`electron/mcp/tool-info.ts:155-164`) mentions no fit.
  - *ADR read in `docs/decisions`:* `ADR-125-amendment-1-imports-keep-file-size.md`.
    - Item 1 (:18-19): a fresh import "arrives at its file size".
    - Item 3 (:23-25): "That scale is its own undo step" and the SVG, DXF, image and STL imports
      "report it with a warning".
    - The Context (:10-14) names the defect the amendment fixed: the import "was quietly shrunk …
      and nothing said so".
    - The undo half conflicts with ADR-584's one-Undo-step-per-remote-call rule, so the warning half
      is the anchor that holds.
  - *Widening (H8-P2-3's DXF units case is this route).* REPRO "H8R-P2-3b": a DXF with
    `$INSUNITS 22` (US survey inch) and a 10-unit LINE imports through `import_file` as 10 mm, where
    the file says about 254 mm. The receipt keys are the same two, with no PC toast. `parseDxf`
    returned the note "Unrecognized $INSUNITS 22 — assuming millimeters.", which the remote drops
    (`design-imports.ts:204-211`) and the desktop toasts (`dxf-import-action.ts:122`). The table gap
    itself is KNOWN (14 K-6 / July DXF P3-4); the remote silence is new. `$INSUNITS 1` (inches)
    correctly gave 254 mm.
  - *READ:* a remote raster also loses its fit notice. `importRaster`'s callback returns `undefined`
    (`design-imports.ts:245`), so `importImageFile` calls `describeImportBedFit(name, undefined)`
    (`import-image-action.ts:63`). That closes the "Remote raster bed-fit notice" Not-verified item.
    The PC still gets its "Added image" toast.
  - *Severity ruling (§3):* P1.
    - **The output is wrong.** The burn is 36 % (or 1/25.4) of the size the file states. Item 1 makes
      file size the import size, and file size is the only size the operator expressed.
    - **Item 3 makes the shrink legitimate only with the warning.** No warning reaches the phone, the
      MCP reply or the PC.
    - **The canvas does not count as a warning.** The PC canvas draws, auto-zooms to
      (`object-insert-actions.ts:143`) and Frames the shrunk art. That shows the result, not the
      mismatch, the same as Frame (§3, 2026-10-27 clarification). The operator would have to notice
      unprompted that 360 ≠ 1000.
    - **The mismatch can be invisible.** For a mildly oversize file (410 mm on a 400 mm bed is cut to
      360 mm, 88 %) or a units mismatch, nothing on the canvas looks wrong.
    - **"The burn matches the canvas" is no defence.** Frame/canvas agreement is exactly what §3
      says is not a warning.
- **Fix direction:** Return the import outcome to the remote caller (a `notices` array with the bed-fit
  text) and keep the fit as its own Undo step; or refuse oversize remote imports without `widthMm`.

### H8-P2-1 — A remote CNC bit change keeps the old bit's feed, plunge and depth per pass on a material-recipe operation; the Artwork card recalculates them, and an unknown bit id is accepted
- **Where:**
  - `src/ui/remote-control/design-operations.ts:166-175` (`cncUpdate`) applies
    `withManualCncFeedPatch(layer.cnc, {toolId})`. `toolId` is a source-invalidating key
    (`src/ui/state/cnc-feed-provenance.ts:3-9`), so a bit change is treated as a hand edit: the recipe
    and the material label are dropped and the numbers stay.
  - Desktop twin: `src/ui/layers/CncOperationToolFields.tsx:52-76` →
    `sceneWithCncStartupOperationDrafts` → `settingsAfterPrimaryToolChange`
    (`src/ui/state/cnc-startup-setup.ts:78-108`), which recalculates a material-recipe operation for the
    new bit, and shows the kept-feeds note for a manual one (`cncKeptFeedsAfterBitChange`).
  - `toolId` is validated only as a string (`design-validation.ts:34`). An id that is not in
    `machine.tools` is stored and projected back (`projections.ts:155`), while compile falls back to the
    job default bit (`layerCncTool`, `src/core/scene/machine.ts:399-408`).
  - L7: `src/ui/remote-control/cnc-operation-audit.test.ts:69-93` pins `{toolId}` among the "manual"
    edits, so the divergence is tested in.
- **Anchor:** Contract: ADR-306 Amendment 3 item 2
  (`docs/decisions/ADR-306-amendment-3-artwork-bit-change-names-kept-values.md:38-39`): "A
  material-recipe operation is recalculated for the new bit." Item 1 lists feed, plunge, spindle and
  depth per pass, not the bit, as the edits that make an operation Manual, "on the Artwork card, or
  through Remote Control". Item 3: a bit change that keeps values names them. Twin: the Artwork card.
- **Scenario:**
  1. A CNC operation follows Hardwood with a 1/4" end mill: 2400 / 960 / 2.5 mm per pass.
  2. An MCP client sends `update_operation {cnc:{toolId:"em-1588"}}` (1/16").
  3. The operation keeps 2400 / 960 / 2.5 and becomes Manual. The card would have set 960 / 380 / 0.6
     (the case ADR-306 Amd 3 calls about 2.5× the chip load and 3.3× the depth per pass). The receipt
     is `changedFields:["cnc"]`; no note, toast or Job Review warning names the kept values.
  4. With a mistyped id (`"no-such-bit"`) the call succeeds, `get_workspace` reports the typed id, and
     the toolpath is compiled for the 1/8" job default, so profile offsets are wrong for the bit the
     client told the user to fit.
- **Evidence:** REPRO. `zz-h8-parity.test.tsx` "H8 A", real adapter:
  - `H8-A-BITCHANGE {"before":{"toolId":"em-6350","feed":2400,"plunge":960,"dpp":2.5,"rpm":12000,"materialKey":"hardwood","source":"material-recipe"},"desktopCard":{"toolId":"em-1588","feed":960,"plunge":380,"dpp":0.6,"rpm":12000,"materialKey":"hardwood","source":"material-recipe"},"remote":{"toolId":"em-1588","feed":2400,"plunge":960,"dpp":2.5,"rpm":12000},"remoteReceipt":{…,"changedFields":["cnc"],…},"cardWouldShowKeptNote":true,"toasts":[]}`
  - `H8-A-UNKNOWN {"code":"ok",…,"storedToolId":"no-such-bit","projectedToolId":"no-such-bit","compiledTool":"em-3175",…}`
- **Severity:** P2, matching CNC v1 F4-P2-1 (same physical effect on the card, rated P2). Novelty: F4-P2-1
  and #1423 fixed only the card; the remote sibling was not changed except for the label rule.
- **Refuter:** CONFIRMED, P2 kept.
  - *What would make it false:* a recalculation further down the remote path, or a contract that
    treats a bit change as a hand edit.
  - *REPRO "H8R-P2-1":* the operation was seeded with the card's own transform (Hardwood, `em-6350`:
    2400 / 960 / 2.5, `material-recipe`).
    - The card transform for `em-1588` gives 960 / 380 / 0.6, still Hardwood `material-recipe`.
    - The remote `update_operation {cnc:{toolId:"em-1588"}}` gives 2400 / 960 / 2.5 with the material
      and source removed. The receipt is `changedFields:["cnc"]` and nothing else.
    - `toolId:"no-such-bit"` returned `ok` and was stored.
  - *Second contract anchor (stronger than the auditor's):* ADR-233 decision 5 (`DECISIONS.md:11017-11022`)
    says "A material-recipe tool change instead recalculates for the new cutter and retains recipe
    provenance". `cnc-feed-provenance.ts:3-9` lists `toolId` as source-invalidating, and the pinned
    test `cnc-operation-audit.test.ts:69-93` asserts the opposite of that clause.
  - *Severity:* stays P2. Feed, plunge and depth per pass are process parameters, not the power,
    position, depth or scale of §3. The same physical effect was rated P2 in CNC v1 F4-P2-1.
  - *The unknown-id half is not silent before output:* the PC Job Review names the compiled bit per
    CNC operation (`JobReviewCncOperationCard.tsx:44-45`), which is the job default.
- **Fix direction:** Route a remote `toolId` through `sceneWithCncStartupOperationDrafts` (as the card
  does), refuse ids not in `machine.tools`, and return the kept-values text in the receipt.

### H8-P2-2 — Phone hold-to-jog has no travel clamp: it asks for 100 mm where the PC's hold stops at the travel edge, so it can run onto the homing switch; jog bounds and no-go warnings reach only the PC
- **Where:**
  - `src/ui/remote-control/machine-hold.ts:20-23,28-53`: `holdVector` always asks for
    `HOLD_MAX_TRAVEL_MM` (100 mm; Z 20 mm) and never reads the position or the firmware envelope.
  - Desktop twin: `src/ui/laser/JogPad.tsx:208-246` aims the hold with `continuousJogVector` against
    `resolveManualMotionLimits` (`src/ui/state/manual-motion-limits.ts:35-55`), which keeps the head a
    margin inside the homing switch. That file says why: "with `$20=0` nothing refuses a hold that runs
    onto its homing switch (ALARM:1, position lost)" (`:50-51`, code comment).
  - Warnings: the store `jog` publishes the bounds and no-go warnings as a PC toast plus log
    (`src/ui/state/laser-jog-warnings.ts:37-53,177-180`). `executeJog`/`executeHold` return a bare
    `completed` (`machine-execution.ts:113-129`, `machine-hold.ts:55-68`), so the phone operator who
    pressed the jog never sees them.
- **Anchor:**
  - Twin: the PC JogPad hold.
  - Contract (partial): ADR-585 (`docs/decisions/ADR-585-expanded-remote-machine-control.md:23-24`)
    offers the remote hold only "when the desktop's own hold is offered" and bounds it at "at most
    100 mm on X/Y". 100 mm is an upper bound, not a licence to pass the travel edge; ADR-585 does not
    mention the envelope either way, so the twin is the main anchor. The desktop clamp's own rationale
    is a code comment (`JogPad.tsx:208-230`, citing controller audit 2 / ADR-375), not ADR text.
  - Ground truth (pinned): GRBL jog refuses only when soft limits are on —
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L36
    "if (system_check_travel_limits(gc_block->values.xyz)) { return(STATUS_TRAVEL_EXCEEDED); }"; a
    tripped hard limit kills the system —
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L98-L124
    "mc_reset(); // Initiate system kill." (fetched 2026-10-27).
- **Scenario:** A homed GRBL laser with `$20=0`, `$21=1` sits 20 mm from its +X switch. On the PC a held
  +X jogs 18 mm and stops. From the phone the same hold asks for 100 mm. Release travels phone → relay
  → PC (dead-man 600 ms; 3000 mm/min is 50 mm/s), so even a prompt release overshoots by tens of mm:
  the switch trips, GRBL resets into ALARM and the homed position and the job's origin evidence are
  lost. With `$21=0` the carriage drives into the frame and skips steps. With `$20=1` the whole 100 mm
  line is refused (error:15), so near an edge the phone hold does nothing. In every case the phone
  receipt carries none of the PC's "outside configured machine bounds" / "crosses the no-go zone"
  text.
- **Evidence:** REPRO. `zz-h8-parity.test.tsx` "H8 D": the real `JogPad` hold and the real
  `executeMachineOperation` for `jog_hold_start`, on the same store state (the
  `JogPad.native-travel.test.tsx` evidence with `softLimitsEnabled:false`, MPos −20, −150):
  `H8-D-HOLD {"machinePos":{"x":-20,"y":-150},"switchAtMPosX":0,"pcHold":{"dx":18,"feed":3000},"remoteHold":{"dx":100,"feed":3000}}`.
  The warning half is READ.
- **Refuter:** CONFIRMED, P2 kept.
  - *What would make it false:* a clamp inside the store `jog`, or a contract that limits only the
    desktop hold.
  - *Two lines of evidence:*
    - READ: `holdVector` (`machine-hold.ts:28-53`) passes the constant `HOLD_MAX_TRAVEL_MM` to
      `stepJogVector` and never reads position, frame or `$$`.
    - READ: the store `jog` only warns. `laser-jog-warnings.ts:1-3` says the move "is still sent".
      `executeJog` returns a bare completion (`machine-execution.ts:113-129`).
    - The auditor's REPRO showed dx 18 against dx 100.
  - *Stronger anchor:* the clamp is ADR text, not only a code comment.
    - ADR-375 decision 3, "Manual motion inside the firmware's limits"
      (`docs/decisions/ADR-375-controller-audit-2-open-findings.md:103,108-110,135-136`): with soft
      limits on, "press-and-hold jog is clamped in machine coordinates to the envelope". With hard
      limits on, hold-to-jog stops "`$27` short of the homing switch".
    - Amendment 4 item 2 (`ADR-375-amendment-4-grblhal-envelope-and-console-values.md:66`): "A Home
      in this session bounds the hold with soft limits off".
    - ADR-585's remote hold is a press-and-hold jog and does not exempt itself.
  - *Severity ruling (§3):* not P1.
    - **The motion is not unexpected.** The operator commands the hold, in the direction they chose,
      and it stops on release or on the dead-man (ADR-585).
    - **With `$21=1` the stop is visible.** The switch gives `ALARM:1`, a latched and visible stop,
      and KerfDesk voids the position and origin evidence. No later output is silently wrong.
    - **With `$20=0` and `$21=0`, the crash is the same one the desktop already accepts.** The
      carriage can reach its mechanical end and lose steps, but the desktop gives the same result for
      a 100 mm step (`JogSettingsRow.tsx:5` offers 100 mm). That step is sent unchanged under ADR-232's
      warn-only bounds, and for a homed machine without a frame no bounds warning is computed at all
      (`laser-jog-warnings.ts` `nativePointsOnBed` returns null).
    - **The crash is not silent.** The lost-step event happens in front of the operator holding the
      button.
    - **What remains is P2.** The twin and the ADR-375 clamp are broken on the remote route, and the
      warnings never reach the phone.
- **Fix direction:** Compute the remote hold vector with the PC's `continuousJogVector` and
  `resolveManualMotionLimits` (capped at 100 mm), and copy the motion-policy warning into the
  operation's `message`.

### H8-P2-3 — Remote import drops every import notice: ignored SVG text, fills imported as strokes, masks and filters, DXF skipped entities and assumed units
- **Where:**
  - `src/ui/remote-control/design-imports.ts:28-60`: `prepareSvgImport` reads `result.fragment` /
    `result.object` and ignores `result.notes`, `ignoredTextElements`, `ignoredImageElements` and
    `stripped`.
  - `:203-212`: the DXF branch ignores `result.notes` and `result.skippedSummary`.
  - Desktop twins: `src/ui/app/import-toasts.ts:16-70` (text ignored, images ignored, "SVG presentation:"
    warnings) and `src/ui/app/dxf-import-action.ts:49-61,128-145` (skipped summary and note toasts, for
    example "Unrecognized $INSUNITS … — assuming millimeters").
- **Anchor:** Twin: the desktop import actions build these from the same parse result. Contract: ADR-569
  (receipts tell what happened); the July DXF audit P3-3 made the desktop surface DXF notes; the remote
  sibling never got it.
- **Scenario:** An MCP agent generates a sign as SVG with a `<text>` title and filled shapes and calls
  `add_svg`. The reply is `ok` with the artwork id. The title is missing and every filled shape is an
  outline only. The agent tells the user the sign is ready; the burn has no title and no fills. A DXF
  with `$INSUNITS 7` (km) or entities on paper space imports with assumed mm or missing parts, also
  with a bare `ok`. The desktop names each of these.
- **Evidence:** REPRO (SVG half) + READ (DXF half). "H8 B" above: `remoteToastsOnPc:[]` and a receipt with
  no notes, against the desktop's
  `"info: part.svg: 1 text element ignored — convert text to paths in your editor before exporting","warning: part.svg: SVG presentation: Imported 1 SVG element(s) as strokes only; their fills were omitted."`
- **Refuter:** CONFIRMED, P2 kept for missing and omitted content. The unrecognized-`$INSUNITS` case
  is moved into H8-P1-2.
  - *REPRO "H8R-P2-3":* an SVG with a `<text>` and a filled rect through `add_svg` returned `ok` with
    receipt `{changedArtworkIds, history}` and PC toasts `[]`. `describeImportResult` for the same
    parse gives "s.svg: 1 text element ignored — convert text to paths in your editor before
    exporting".
    - A plain black-filled rect produced no fill warning on either side, so the fill note needs a
      different input than this one.
  - *REPRO "H8R-P2-3b":* the DXF branch drops `result.notes`.
  - *Severity:* missing text or entities are visible on the PC canvas and are not one of §3's four
    physical quantities, so P2.
    - The `$INSUNITS` note is a scale change, so that case is P1 by the same rule as H8-P1-2 and now
      sits there.
- **Fix direction:** Return the same notice strings the desktop builds (`describeImportResult`, the DXF
  note list) in the remote receipt, and push them on the PC as the desktop import does.

### H8-P3-1 — Remote Home runs when Machine Setup has homing off; every PC Home control is disabled or replaced then
- **Where:** `src/ui/remote-control/machine-actions.ts:128-135` (`executeHome` → store `home()`);
  `machine-projections.ts:108,118` offers `home` when the controller has a homing command. The store's
  `assertHomeReady` (`src/ui/state/laser-home-action.ts:88-104`) does not read `device.homing.enabled`.
  The phone shows Home whenever `homing !== 'not_supported'`
  (`services/remote-control/app/src/ui/MachineScreen.tsx:139-146`).
- **Anchor:** Twin: the PC Home command (`src/ui/commands/laser-command-family.ts:38-41,63`, "Homing is
  disabled in Device settings."), the Home button that becomes "Set up homing"
  (`src/ui/laser/JobSetupControls.tsx:73-86`) and the alarm banner (`AlarmRecoveryActions.tsx:42,59`).
- **Scenario:** A machine without switches is set up with homing off. From the phone, Home is offered and
  sends `$H`. With firmware `$22=0` GRBL answers error:5 (harmless). With `$22=1` left on, the axes seek
  switches that are not there until the homing search fails, and KerfDesk has already voided the origin
  and Work-Z evidence (`laser-home-action.ts:138-155`).
- **Evidence:** REPRO. "H8 E": `H8-E-HOME {"deviceHomingEnabled":false,"pcHomeCommand":{"enabled":false,"title":"Homing is disabled in Device settings. …"},"remoteAvailabilityHome":{"available":true},"remoteHomeCalls":1,"receipt":{"state":"completed","message":"Homing finished."}}`.
- **Severity:** P3. It needs a profile/firmware mismatch for motion; the Super Console already flags a
  `$22` that disagrees with the profile.
- **Refuter:** CONFIRMED, P3 kept.
  - Read both sides:
    - `extendedAvailability` gates `home` only on `capabilities.homing`
      (`machine-projections.ts:108,118`).
    - `assertHomeReady` (`laser-home-action.ts:88-104`) has no `homing.enabled` check.
    - The PC command is disabled with "Homing is disabled in Device settings."
      (`laser-command-family.ts:38-41,63`).
  - Together with the auditor's REPRO, that is two lines of evidence.
  - Motion needs a firmware/profile mismatch (`$22=1` with homing off in the profile), and the
    operator pressed Home, so it is not unexpected motion.
- **Fix direction:** Refuse remote Home (and report `home` unavailable) when `device.homing.enabled` is
  false, with the PC's reason text.

### H8-P3-2 — The remote Job Review omits the registration-jig block ("This job burns BOTH the outline and artwork", the focus-height note)
- **Where:** `src/ui/remote-control/machine-projections.ts:262-280` (`reviewProjection`) projects stats,
  warnings, operations and the acknowledgement, not `registrationJigOutput`. The phone review
  (`services/remote-control/app/src/ui/machine-job.tsx:140-215`) therefore cannot show it.
- **Anchor:** Twin: `JobReviewDialog.tsx:75-79` → `JobReviewRegistrationJig.tsx:26-75`: "Choose one output
  to avoid burning the outline over the piece" and "Check artwork focus height", plus the Start button
  label ("Start outline" / "Start artwork"). These are not in `model.warnings`
  (`job-review-registration-jig.ts:12-28`).
- **Scenario:** A jig with both outline and artwork enabled is started from the phone after the pieces are
  placed. The PC review would say the job burns both; the phone review does not, so the outline burns
  over the placed pieces.
- **Evidence:** READ.
- **Severity:** P3: the workspace jig bar on the PC also shows the mode, and the jig workflow is set up on
  the PC.
- **Refuter:** PLAUSIBLE, P3 kept (READ only).
  - `reviewProjection` (`machine-projections.ts:262-280`) carries no `registrationJigOutput`, and
    `registrationJigReviewOutput` is a review fact, not a warning
    (`job-review-registration-jig.ts:12-28`).
  - The disclosure is at most partial. The phone review renders one card per compiled operation
    (`machine-job.tsx:183-194`), so the jig outline gets a card with `operationId` `registration`.
    That card shows only the group's settings summaries (`job-review-effective-operations.ts`), and
    the phone says "No warnings for this job." The PC's explicit "burns BOTH" block is missing.
- **Fix direction:** Project `registrationJigOutput` as a review fact (or a warning line) and show it on the
  phone.

### H8-P3-3 — Remote Connect says "No saved connection was found" for a file-only profile and for a machine connected over the network
- **Where:** `src/ui/remote-control/machine-actions.ts:80-88`. The store's `runConnectAction`
  (`src/ui/state/laser-connect-action.ts:68-86`) returns early for a file-only driver and for a last TCP
  connection with `portSelection: 'remembered-only'`, toasting the real reason on the PC. The remote then
  reports "No saved connection was found. Connect the machine once on the PC, then try again."
  `availability.connect` is offered in both cases (`machine-projections.ts:113-116`).
- **Anchor:** Twin: the PC's `FILE_ONLY_CONNECT_REFUSAL` and `NETWORK_RECONNECT_GUIDANCE`. Contract:
  ADR-569 truthful receipts.
- **Scenario:** A network-connected machine (connected once on the PC, as asked) is disconnected; the phone
  Connect fails forever with advice the user already followed.
- **Evidence:** READ.
- **Refuter:** PLAUSIBLE, P3 kept (READ only). The path is deterministic:
  - `runConnectAction` returns before any attempt for a file-only driver, and for
    `lastConnectionTransport === 'tcp'` with `remembered-only` (`laser-connect-action.ts:72-86`).
  - So `connection.kind` stays `disconnected`, not `failed`, and `executeConnect` falls through to
    "No saved connection was found…" (`machine-actions.ts:80-88` at `a59f74ff9`).
  - It was not run, and the code is a message only.
- **Fix direction:** Report the store's refusal text (both are fixed strings) and mark Connect unavailable
  for these profiles.

## KNOWN (cited, not re-raised)

- **G7-P3-1 (P1)** remote `capture_board_point` skips the PC Capture gate. Present on this tree; #1460
  merged after it.
- **G7-K-1 = 01-P2-5** `jog_hold_stop` on the Abort rate lane (`input-schemas.ts:170`), awaiting the
  maintainer.
- **G7-K-2 = 02-P3-4** `update_text` reports `changedFields` without checking the store accepted it.
- **01-P3-15** discrete remote Z jog accepts 100 mm (`machine-schemas.ts`); still present.
- **01-P3-11 / 01-P3-12** remote `update_operation` bounds and tool text; still present.
- One item about the held finding H8-P1-1 is withheld until its fix merges.
- **Refuter check of this list (2026-10-27):** each was spot-checked on this tree and is still present:
  - `MCP_PRIORITY_COMMANDS` still holds `jog_hold_stop` (`input-schemas.ts`);
  - `jog_machine.distanceMm` still allows 100 on every axis (`machine-schemas.ts:67`);
  - the `update_text` commit still reports `changedFields` from the prepared edit (`writes.ts:95-100`);
  - `dxf-expand.ts` still has per-grid and depth caps only.

  14 K-6 (July DXF P3-4, the `$INSUNITS` table gaps) is also re-observed. Its remote silence is now
  part of H8-P1-2.

## Refuted

Refuter (2026-10-27):

- **No whole finding was refuted.**
- One item about the held finding H8-P1-1 is withheld until its fix merges.

Candidates dropped by the auditor while checking:

- **Phone Zero Z in Laser mode.** The phone shows Zero Z when `jog.zSupported` (`MachineScreen.tsx:154`),
  which is true for a laser with confirmed Z travel, while the PC shows Zero Z only for CNC
  (`FocusJogControls.tsx:60`). Dropped: it writes `G92 Z0` only; laser Z output is relative
  (`focus-test-emission.ts` `G91` … `G90`), and a CNC hold refuses the laser-tagged evidence (G2).
- **Remote `resume_job` during a CNC tool-change hold skips Continue's Work-Z check.** The streamer never
  sends the M0 (`streamer.ts:41-48`) and the resume refill requires `status === 'paused'`
  (`laser-pause-resume-refill.ts:44,62-63`), so it throws; a CNC job gets a stalled notice and no reset.
  Continue keeps its own gate (`laser-store-helpers.ts:132-158`).
- **Remote Start skips the acknowledgement.** The prompt is projected (`machine-projections.ts:278`) and shown
  above Slide to start (`machine-job.tsx:207-209`); confirm waits for preparing, blocker and card edits
  (`machine-review-presenter.ts:94-121`).
- **Remote Frame skips the desktop's offset wait.** Only the repair offers are skipped
  (`use-frame-action.ts:110`); `prepareFrameContext` keeps both offset waits (`:261-268`).
- **Remote delete_operation lacks a confirm.** The PC's `DeleteLayerButton` deletes without one; both are
  one Undo step.
- **Remote create_operation skips fresh-operation seeding.** It calls the same `createManualLayer` as
  `AddLayerControls`.
- **A local MCP stdio server bypasses relay tiers.** `serveKerfDeskMcpStdio` has no caller in
  `electron/`, `src/` or `scripts/`.
- **Remote edits skip the Pro or numbering guards.** They call store actions, which are wrapped by the
  authoring setter and `numberingEditGuardSetter` (`store-setters.ts:32`).
- **Remote raster import is a separate decode route.** It uses the desktop's `importImageFile`
  (`design-imports.ts:218-250`); parity, not raised.

## Verified clean

- Remote Frame, Review and Start use `runFrameNow` and `runFramedPermitStart` with the PC's readiness,
  permit claim, rebind and authorization; the start-mark refusal and the "review already open" owner apply
  to both.
- Abort, Pause and Resume call the same store actions; Abort cancels the registry's own preparation and
  holds first.
- Disconnect is stricter remotely than on the PC.
- Remote Zero Z and Set origin keep the ADR-657 guards (re-read; G7 verified).
- Simultaneous phone and PC: a phone Frame during a PC Frame preparation is `busy`
  (`machine-control-registry.ts:187-191`); a phone review cannot open while the PC review owns the store
  (`createJobReviewPresentation`); a phone approval waits for a PC card edit; there is one BrowserWindow
  (G7). No race past a guard was found.
- AI: `applyAiDraft` now seeds the operation like an import (#1369) and commits through
  `commitProjectEdit` (#1346); AI output still cannot carry settings or G-code (28).
- Camera still: control approval plus the sharing opt-in, re-checked after capture.

## Not verified

- One item about the held finding H8-P1-1 is withheld until its fix merges.
- **Beam state when the stream starves.**
  - Refuter: partly answered.
    - Starvation happens only on the window transport (see Refuted).
    - On stock GRBL 1.1, an `M3` block keeps its PWM when the segment buffer empties (pinned
      `stepper.c#L393-L397`).
  - Still not checked for grblHAL, FluidNC, Marlin or Smoothieware, or on hardware.
- **Remote raster bed-fit notice.** Refuter: answered by READ. The remote callback returns
  `undefined`, so no fit notice is pushed (see H8-P1-2). It was not run.
- One item about the held finding H8-P1-1 is withheld until its fix merges.
- **#1462 sibling (open PR, not on this tree).** #1462 makes `executeJog`'s Z check follow the running job's
  machine (`motionMachineKind`), but `holdVector` (`machine-hold.ts:35-37`) still uses the open project's
  kind. For the PR reviewer.
- **Remote Pause in the `done` tail.** The phone shows Pause unavailable ("No running job to pause") while
  the PC offers Pause for `done` with the controller in Run; MCP `pause_job` still works. A missing
  control, not a skipped guard; not raised.
- **Production relay, real phone, packaged build, hardware.** None used.

```json
[
  {"id":"H8-P1-1","severity":"P1","area":"remote-automation","file":"held","line":0,"anchor":"held","evidence":"REPRO","verdict":"CONFIRMED","known":null,"summary":"Security hold: details withheld until the fix merges."},
  {"id":"H8-P1-2","severity":"P1","area":"remote-automation","file":"src/ui/remote-control/design-imports.ts","line":76,"anchor":"Contract: ADR-125 Amd 1 item 3 (scale is its own undo step; SVG and DXF imports report it with a warning); Twin: import-bed-fit-notice.ts:10-23","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-h8r-refute: add_svg and import_file both 1000x500 -> 360x180 on 400x400, receipt keys changedArtworkIds/history only, PC toasts [], undo depth 1 and one Undo removes the import; desktop store import gives depth 2 and the ADR-125 Amd 1 notice. Widened: $INSUNITS 22 DXF 10-unit LINE imports as 10 mm (file ~254 mm) with a bare ok while parseDxf notes \"Unrecognized $INSUNITS 22\"; remote raster also passes undefined outcome (READ). P1 ruled: output scale differs from the file size ADR-125 Amd 1 item 1 makes the import size, and item 3 warning never reaches phone, MCP or PC; the canvas/Frame showing the shrunk art is not a warning of the mismatch (METHOD §3 2026-10-27)","known":false,"summary":"Remote add_svg/import_file scales oversize art to the bed (1000x500 -> 360x180, 36%) with no PC toast, no receipt note and no separate Undo step; the desktop warns that the burn no longer matches the file. Refuter widened: an unrecognized $INSUNITS DXF (22 -> 10 mm for ~254 mm) is also silent remotely"},
  {"id":"H8-P2-1","severity":"P2","area":"remote-automation","file":"src/ui/remote-control/design-operations.ts","line":171,"anchor":"Contract: ADR-306 Amd 3 items 1-3 ('A material-recipe operation is recalculated for the new bit'); Twin: CncOperationToolFields.tsx:52-76 -> cnc-startup-setup.ts:78-108","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-h8r-refute: card transform em-6350 Hardwood 2400/960/2.5 -> em-1588 960/380/0.6 material-recipe; remote toolId gives 2400/960/2.5 with material and source dropped, receipt changedFields [cnc]; no-such-bit accepted and stored. Added anchor ADR-233 decision 5 (DECISIONS.md:11017-11022) \"A material-recipe tool change instead recalculates\". P2 kept: feeds/stepdown are not a §3 physical quantity (F4-P2-1 precedent); the unknown-id bit is named in PC Job Review (JobReviewCncOperationCard.tsx:44-45)","known":false,"summary":"Remote update_operation cnc.toolId keeps the previous bit's 2400/960/2.5 on a 1/16 in bit where the card sets 960/380/0.6, drops the material with no note; an unknown toolId is accepted and projected while compile uses the job default bit"},
  {"id":"H8-P2-2","severity":"P2","area":"remote-automation","file":"src/ui/remote-control/machine-hold.ts","line":28,"anchor":"Twin: JogPad.tsx:208-246 continuousJogVector + manual-motion-limits.ts:35-55; Contract (partial): ADR-585 lines 23-24 hold offered only when the desktop hold is, at most 100 mm; Ground truth: GRBL jog.c L35-36 (refusal only with soft limits), limits.c L98-124 (hard limit -> reset + alarm)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ holdVector passes constant HOLD_MAX_TRAVEL_MM, store jog is warn-only, executeJog/executeHold return bare completion, plus auditor REPRO (dx 18 vs 100). Added anchor ADR-375 decision 3 (hold clamped to the firmware envelope; $27 short of the switch) and Amd 4 item 2. Not P1: hold motion is operator-commanded with a dead-man; $21=1 gives a latched visible ALARM:1 and voids position; $20=0/$21=0 overrun equals the desktop 100 mm step under ADR-232 warn-only bounds and happens in front of the operator","known":false,"summary":"Phone hold-to-jog always asks for 100 mm; 20 mm from the +X switch the PC hold sends dx 18 and the remote dx 100, so with $20=0 it runs onto the switch (ALARM, position lost) or the frame; jog bounds/no-go warnings reach only the PC"},
  {"id":"H8-P2-3","severity":"P2","area":"remote-automation","file":"src/ui/remote-control/design-imports.ts","line":34,"anchor":"Twin: import-toasts.ts:16-70 and dxf-import-action.ts:49-61,128-145; Contract: ADR-569 truthful receipts","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO zz-h8r-refute: add_svg with <text> -> ok, receipt without notes, PC toasts [], desktop describeImportResult names the ignored text; DXF branch drops notes (REPRO $INSUNITS 22). P2 kept for missing content; the unrecognized-$INSUNITS scale case moved into H8-P1-2","known":false,"summary":"Remote import discards parse notes: ignored SVG text, fills imported as strokes, masks/filters, DXF skipped entities and unrecognized $INSUNITS; receipt is a bare ok while the desktop names each"},
  {"id":"H8-P3-1","severity":"P3","area":"remote-automation","file":"src/ui/remote-control/machine-actions.ts","line":128,"anchor":"Twin: laser-command-family.ts:38-41,63; JobSetupControls.tsx:73-86; AlarmRecoveryActions.tsx:42,59","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ extendedAvailability gates home on capabilities.homing only, assertHomeReady has no homing.enabled check, PC command disabled with the Device-settings reason; plus auditor REPRO. P3 kept","known":false,"summary":"Remote Home is offered and runs when Machine Setup has homing off; every PC Home control is disabled or replaced by Set up homing"},
  {"id":"H8-P3-2","severity":"P3","area":"remote-automation","file":"src/ui/remote-control/machine-projections.ts","line":262,"anchor":"Twin: JobReviewDialog.tsx:75-79 -> JobReviewRegistrationJig.tsx:26-75","evidence":"READ","verdict":"PLAUSIBLE","refuter":"READ reviewProjection has no registrationJigOutput (a review fact, not a warning); phone renders a per-operation card for the registration operation with settings summaries only and says No warnings. P3 kept","known":false,"summary":"Remote Job Review omits the registration-jig block (burns BOTH outline and artwork, focus-height note, Start outline/artwork label)"},
  {"id":"H8-P3-3","severity":"P3","area":"remote-automation","file":"src/ui/remote-control/machine-actions.ts","line":86,"anchor":"Twin: laser-connect-action.ts:68-86 FILE_ONLY_CONNECT_REFUSAL / NETWORK_RECONNECT_GUIDANCE; Contract: ADR-569 truthful receipts","evidence":"READ","verdict":"PLAUSIBLE","refuter":"READ runConnectAction returns early for file-only and tcp + remembered-only, leaving connection disconnected (not failed), so executeConnect reports No saved connection. Message only; P3 kept","known":false,"summary":"Remote Connect reports 'No saved connection was found' for a file-only profile and for a network-connected machine, and availability.connect offers it"},
  {"id":"H8-K-1","severity":"P1","area":"remote-automation","file":"src/ui/remote-control/machine-actions.ts","line":162,"anchor":"Twin: use-capture-gating.ts","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-27-rolling-v3/G7-app-shell-remote.md G7-P3-1 (fixed by #1460 after this tree)","summary":"Remote capture_board_point skips the PC Capture gate"},
  {"id":"H8-K-2","severity":"P2","area":"remote-automation","file":"services/remote-control/src/limits.ts","line":28,"anchor":"Twin: control-actions.ts usesAbortReserve","evidence":"READ","verdict":"KNOWN","known":"01-P2-5 / G7-K-1","summary":"jog_hold_stop spends the Abort rate lane"},
  {"id":"H8-K-3","severity":"P3","area":"remote-automation","file":"src/ui/remote-control/writes.ts","line":95,"anchor":"Twin: drawShape insert check","evidence":"READ","verdict":"KNOWN","known":"02-P3-4 / G7-K-2","summary":"update_text receipt not checked against the store"},
  {"id":"H8-K-4","severity":"P3","area":"remote-automation","file":"electron/mcp/machine-schemas.ts","line":67,"anchor":"Twin: PC Z step","evidence":"READ","verdict":"KNOWN","known":"01-P3-15","summary":"Discrete remote Z jog accepts 100 mm"},
  {"id":"H8-K-5","severity":"P3","area":"remote-automation","file":"electron/mcp/design-schemas.ts","line":64,"anchor":"Twin: cut-settings-draft.ts bounds","evidence":"READ","verdict":"KNOWN","known":"01-P3-11 / 01-P3-12","summary":"Remote update_operation bounds and tool description differ from the PC"}
]
```
