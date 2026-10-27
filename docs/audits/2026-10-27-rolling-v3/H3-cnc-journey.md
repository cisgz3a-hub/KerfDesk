# Rolling audit v4 — CNC journey

- **When:** 2026-10-27 15:20–16:00 +0800   **Tree:** origin/main @ `a59f74ff9` (the audit worktree's `src/` is identical to it).
  - After `git fetch`, `origin/main` is `105d6374c`. The CNC merges after the tree are #1459 (G5-P1-1, On path copy walls, emitter v34), #1461 (Console units; moves the job safe-Z field) and #1462 (CNC recovery needs a CNC project open, ADR-416 Amd 3). #1460, #1463 and #1464 are camera, Place Board and tone fixes.
  - Every file cited in the findings below is unchanged on `105d6374c`, except `cnc-pass-recovery-flow.ts`. #1462 adds an open-project refusal there, which H3-P1-1's repro satisfies (the open project is the CNC job).
- **Scope:** every way a CNC job reaches the router, diffed per METHOD L9.
  - **Entry points:**
    - in-app Start, Run again and phone/MCP `start_job` (`start-job-flow.ts`, `start-job-readiness*.ts`, `start-job-prepared-inspection.ts`, `start-job-readiness-policy.ts`);
    - CNC pass and supervised recovery (`cnc-pass-recovery-flow.ts`, `cnc-supervised-recovery-*.ts`, `start-job-source.ts` `prepareArchivedRecoverySource`); Start from line refuses CNC (`start-job-flow.ts:307-310`);
    - Save G-code: the plain **Save as…** (`GcodeSaveDialog.tsx`, `file-actions.ts`, `save-gcode-emission.ts`, `save-output-emission.ts`);
    - the setup package, single file and one file per bit (`CncSetupDocumentExport.tsx`, `src/io/cnc/cnc-setup-package.ts`, `cnc-tool-programs.ts`, `cnc-setup-document.ts`);
    - tile files (`save-tiled-gcode.ts`, `tiled-output-preparation.ts`, `tile-emission.ts`, `src/core/cnc/tile-*.ts`);
    - Run G-code file of a saved KerfDesk file (`src/ui/gcode-inspector/external-run*.ts`, `src/core/external-program/*`).
  - **Shared motion:** `src/core/output/cnc-grbl-strategy.ts`, `cnc-grbl-transitions.ts`, `src/core/cnc/cnc-park.ts`, `src/io/gcode/emit-gcode.ts`.
  - **Touch-off and probe:** `laser-probe-policy.ts`, `probe-test-touch.ts`, `laser-surface-probe-actions.ts`, `frame-cnc-preparation.ts`.
  - **Governing:** WORKFLOW F-CNC14, F-CNC15; ADR-103 Amd 2; ADR-327 Amd 1; ADR-392 Amds 2–3; ADR-399; ADR-491 Amd 2; ADR-572 Amd 2; ADR-656 and Amd 1.
- **Lenses run:**
  - **L9** entry-point parity (main lens). The parity table is below.
  - **L3** twins: the recovery bit check against Start's; the setup package against Save as….
  - **L1** for the clauses cited.
  - **L7** for one test that pins a behaviour an ADR replaced (H3-P3-2).
  - L2, L4, L5 and L6 were not run as separate passes. No firmware claim here goes beyond the sources the cited ADRs already pin.
  - Repros were three temporary Vitest files (`zz-h3-*`, now deleted; copies in the session scratchpad `h3-repros\`). They used an independent line reader on the emitted text and the real recovery flow, setup dialog and Save action. The recovery and setup suites need `NODE_OPTIONS=--no-experimental-webstorage` on this PC (Node 25).
- **Counts:** 6 raised → 0 refuted → P1 1 / P2 3 / P3 2 (+ 6 KNOWN). One sub-claim refuted: H3-P1-1's supervised (runway) half, which a multi-bit job cannot reach.
- **Refuter (2026-10-27, fresh context):** 6 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity changes.
  - Own repros, written independently of the auditor's: `zz-h3r-recovery-bit.test.ts` (pass and supervised recovery, bits in the reverse order), `zz-h3r-setup-export.test.tsx` (setup package on the Smoothieware profile in both modes; per-bit files through the Run review) and `zz-h3r-surface.test.ts` (surface and touch-off gates). All three are deleted. Copies are in the session scratchpad under `h3r-repros\`.
  - Run with `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>` on `a59f74ff9`. Each cited file was checked against `105d6374c` with `git diff`.

## Headline

The router's motion is the same on every path: the per-bit files, tile files and recovery programs all come from the same emitter, with the same lift-before-spindle, dwell, modal restate and park.

The paths differ in the checks around that motion:

- **CNC pass recovery checks Work Z against the wrong bit (H3-P1-1).** It checks the zero against the interrupted job's first bit, not against the bit its recovery program starts with. A recovery in the second bit's section therefore tells the operator to load the first bit. Once that bit is loaded and zeroed, KerfDesk cuts the second bit's passes with it, with no warning.
- **One file per bit drops the bit-change checks (H3-P2-2).** Since #1453 the setup package defaults to one file per bit. That moves the bit change from Start's hold, which voids Work Z and waits for the new bit's zero, to Run G-code file, which accepts the previous bit's zero.
- **The setup package skips ADR-399's warning (H3-P2-1).** It never shows the "this file is for GRBL" warning that Save as… and tiles show.

## Entry-point parity (L9)

| Check | Start, Run again, phone/MCP Start | CNC pass / supervised recovery | Save as… (one file) | Setup package, one file per bit (default) | Tile files | Run G-code file of a KerfDesk file |
|---|---|---|---|---|---|---|
| Program | `prepareOutput` with placement, `emitPreparedGcode` | archived placed job, resumed slice, `emitPreparedGcode` | as Start, export placement | the Save job sliced at each bit, `emitPreparedGcode` per section | `prepareOutput` without placement, clipped per tile, `cncGrblStrategy.emit` | bytes as saved |
| Job Origin anchor (#1457) | design bounds | archived job's | design bounds | design bounds | tile frame (ADR-327 Amd 1 item 4) | as saved |
| Work Z is current | Job Review warning; CNC Frame prompts | recovery warnings (`demotedPolicyWarnings`) | n/a | n/a in the file; Frame requires it | n/a | Frame requires it (`frame-cnc-preparation.ts:14-22`) |
| Work Z is for the first bit | Job Review warning against the program's first bit | pass recovery: against the **archived job's** first bit (**H3-P1-1**); supervised: single-bit jobs only, so the two agree | n/a | header comment only; **no check at run** (**H3-P2-2**) | header comment only | none |
| Bit change | host hold: voids Work Z, Continue needs the new bit's zero, X/Y frozen | hold inside the recovery program only | `M0` in the file; the Run review warns; no Save note (**H3-P3-1**) | between files: **no check, X/Y not frozen** (**H3-P2-2**) | between files: same | `M0` sent; review warns (ADR-392 Amd 2 D3) |
| Park lift vs Z top (#1457) | Start warning, Job Review row | recovery warnings | n/a | n/a | park set aside, warned | n/a |
| Spindle: lift, `M3`, dwell | emitter | emitter preamble | emitter | emitter, each file | emitter | as saved |
| Reach / clamp (#1444) | Job Review | none (KNOWN, ADR-572 Amd 2) | Save toasts | each file + sheet | none (KNOWN F7-P3-2) | none (KNOWN) |
| Stacked copy, kept part, lead (#1450, #1451, #1459) | preflight | preflight of the resume job | preflight | each section + combined | each tile (positions KNOWN G5-P3-2) | none |
| ADR-399 controller warning | Start refuses non-GRBL | n/a | toast | **none** (**H3-P2-1**) | toast | n/a |
| `EMITTER_REVISION` header | omitted by design (P0-A) | omitted | yes | yes, every file | yes | as saved |
| Probe circuit test (#1450) | Z and XYZ touch-off, hold included | — | — | between files: touch-off has it | — | surface grid: **none** (**H3-P2-3**) |

## Findings

### H3-P1-1 — CNC recovery checks Work Z against the interrupted job's first bit, not the bit its recovery program starts with, and tells the operator to load the wrong bit

- **Where:**
  - **The check runs on the archived whole job.** `src/ui/laser/start-job-source.ts:272-281`: `prepareArchivedRecoverySource` qualifies the archived prepared job through `prepareStartJobFromPrepared`.
  - **Only that job's first bit is read.** `start-job-readiness-prepared.ts:34` → `inspectPreparedStart(prepared, machine)` → `start-job-prepared-inspection.ts:26-31`: `cncWorkZeroToolStartIssue(…, toolPlan[0])`, where `toolPlan = cncToolPlan(prepared.job)` is the archived whole job's plan.
  - **The program streamed is a different one.** `cnc-pass-recovery-flow.ts:118,125`: the recovery program is `buildCncPassResumeJob(source.prepared.job, groupIndex, passIndex)`. `cnc-supervised-recovery-flow.ts:279` takes the same source.
  - **The stream knows the right bit.** `cnc-supervised-recovery-stream.ts:224-227` streams with `cncToolPlan(recovery.job)`, the recovery program's own plan, so the streamer knows the right first bit while the check uses the other one.
- **Anchor:**
  - **Contract:** WORKFLOW F-CNC15, "Work-Z evidence at Start", item 2: "Start compares it with the first bit in the exact compiled tool-section plan". The recovery program is the plan that is streamed.
  - **Twin:** ordinary Start runs the same check on the program it streams. The tool-change Continue refuses a zero made for another bit (`laser-store-helpers.ts:150-156`).
- **Scenario:**
  1. A two-bit job runs: profile A on a 1/4" end mill, then profile B on a 1/8" end mill.
  2. At the bit change the operator selects the 1/8" bit as Active and zeroes it, as Continue requires, and the job is interrupted in B's section.
  3. Pass recovery at B's first pass emits a single-bit program: tool plan `[em-3175]`, no `M0`.
  4. **Case A (correct bit zeroed).** The recovery's warning dialog says "This job starts with 6.35 mm (1/4") end mill, but work Z was established for 3.175 mm (1/8") end mill. Load 6.35 mm (1/4") end mill, …".
  5. **Case B (the operator follows that advice).** They load and zero the 1/4" bit. The check now passes with no bit warning, and the recovery cuts B's 1/8" passes with the 1/4" bit. The kerf is 3.175 mm wider, and an Outside or Inside profile is 1.59 mm off per side.
  6. **Start's twin disagrees.** The same check against the recovery program's first bit gives the opposite result in both cases: null in A, a warning in B.
  7. **Nothing else names the mismatch.** The wizard's checklist says only "The required tool is installed, intact, and Z-zeroed for this job" (`CncPassRecoveryChecklist.tsx:38`). The bit appears only inside the pass dropdown's labels, and `passRecoveryConfirmation` names no bit.
  8. **Case B without case A.** It also arises when the Active bit is stale, for example after reopening an autosave from before the bit change.
- **Evidence:** REPRO with `zz-h3-recovery-bit.test.ts`. It uses a two-layer project, the real `saveInterruptedRun` → `runCncPassRecoveryFlow`, and a resume at the 1/8" group. Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-h3-recovery-bit.test.ts`.
  - **Both cases share:** `wholeJobToolPlan ["em-6350","em-3175"]`, `recoveryToolPlan ["em-3175"]`, `recoveryHasM0 false`.
  - **Case A** (evidence `em-3175`):
    - `recoveryBitWarnings`: "This job starts with 6.35 mm (1/4") end mill, but work Z was established for 3.175 mm (1/8") end mill. Load 6.35 mm (1/4") end mill, select it as the Active bit, …";
    - `startTwinIssueForRecoveryProgram: null`.
  - **Case B** (evidence `em-6350`):
    - `recoveryBitWarnings []`;
    - `startTwinIssueForRecoveryProgram`: "This job starts with 3.175 mm (1/8") end mill, but work Z was established for 6.35 mm (1/4") end mill. …".
  - Novelty: no audit names this check on the recovery path. G2-P1-1 and #1462 cover the open project, not the bit.
- **Severity note for the refuter:**
  - **Why P1:** the cut is the wrong size, and the only bit-specific message points to the wrong bit, so §3 offers no lowering.
  - **The case for P2:** the pass dropdown's label names the right bit.
- **Refuter:** CONFIRMED, P1 kept, for **pass recovery**. The supervised (runway) half is refuted.
  - **What would make it false:** another check on the recovery program's first bit; a refusal before streaming; a dialog that names the mismatch; #1462 changing the source; or the path being unreachable.
  - **Own repro** (`zz-h3r-recovery-bit.test.ts`, bits in the reverse order to the auditor's): op 1 on em-3175 (1/8"), op 2 on em-6350 (1/4"), the real `saveInterruptedRun` → `runCncPassRecoveryFlow`, resuming at op 2 pass 1.
    - **1/4" zeroed (the right bit):** streamed plan `["em-6350"]`, no `M0`. The only bit message says "This job starts with 3.175 mm (1/8") end mill, but work Z was established for 6.35 mm (1/4") end mill. Load 3.175 mm (1/8") end mill, …", which is the wrong advice.
    - **1/8" zeroed (the wrong bit):** the same `["em-6350"]` program streams. No confirm text names either bit (`confirmsMention3175 false`, `confirmsMention6350 false`).
    - **Control, resuming at op 1:** plan `["em-3175","em-6350"]` with `M0`, and the warning is right.
  - **No other guard.** `cncWorkZeroToolStartIssue` has one caller, `inspectPreparedStart` (`start-job-prepared-inspection.ts:27`). `startJob` uses `cncToolPlan` only for the bit-change manifest (`laser-job-actions.ts:281`). `assertCncLiveStartReady` checks connection, alarm and Idle only.
  - **What the operator sees.** The dropdown label is the only place the bit appears ("Operation 2 (profile-on-path · 6.35 mm (1/4") end mill) · pass 1 of 2 · Z -1.000 mm", `cnc-pass-recovery-model.ts:152-155`). The checklist and `passRecoveryConfirmation` name no bit. A label is not a mismatch warning under §3 (2026-10-27): it never says "the program starts with X, but Work Z is for Y". In the first case the app's only bit-specific message points to the wrong bit.
  - **#1462** (`105d6374c`) adds only the open-project refusal. `start-job-source.ts`, `start-job-readiness-prepared.ts`, `start-job-prepared-inspection.ts`, `cnc-start-advisories.ts` and `src/core/recovery/` are unchanged. No open PR touches them (`gh pr list` returned none).
  - **Supervised (runway) recovery is refuted.**
    - `buildCncRecoveryEventManifest` makes a cut event runway-eligible only when `jobAllowsSingleToolRunway` holds (`src/core/recovery/cnc-recovery-manifest.ts:59,168-177`): every group CNC, one physical tool key.
    - A multi-bit job's events are all `manual-only`. Repro: two-bit job, event `cnc-op-2/pass-1/cut-2` → "Cannot start CNC recovery: This operation is not supported by supervised contour recovery.", and nothing was streamed.
    - In a single-bit job, the archived first bit is the recovery program's bit.
  - **Severity: P1 kept.** The recovery cuts the later section's passes with the earlier bit. That gives the wrong kerf and, for Outside or Inside profiles, an offset that is wrong by the radius difference: wrong physical size. No warning names the mismatch, and in one case the app's own warning causes it.
- **Fix direction:** In pass recovery, run `cncWorkZeroToolStartIssue` on `cncToolPlan(resume.job)[0]` after the resume job is built, instead of on the archived job's plan. Supervised recovery can share the helper for defence in depth, but it cannot reach a multi-bit job today. Pin it with a two-bit resume test like the repro.

### H3-P2-1 — The CNC setup package never gives ADR-399's GRBL-only warning or note, which Save as… and tile export give for the same programs

- **Where:**
  - **The save writes with no controller message.** `src/ui/app/CncSetupDocumentExport.tsx:37-72`: `save()` writes the package and toasts only "Saved CNC setup sheet and exact program package …". It never calls `cncProjectExportAdvisories`, `cncExportOtherControllersNote` or `pushCncExportControllerMessages`.
  - **The sheet lists none either.** Its findings (`:173-176`) are only `prepared.advisories` + `prepared.machineWarnings`, which hold no controller message.
  - **Twins:**
    - `file-actions.ts:265-275` (the warning) and `:336-338` (the note), for Save as… in the same dialog;
    - `save-tiled-gcode.ts:106`, for tiles;
    - `save-surfacing-program.ts:76`, for surfacing.
- **Anchor:**
  - **Contract:** ADR-399 Decision 1: "Save G-code of a CNC project, tile export and surfacing export each push one warning". Decision 5 adds the info note for an unconfirmed GRBL-family profile.
  - **Twin:** Save as… in the same Save G-code dialog.
- **Scenario:**
  1. A CNC project on a Marlin profile, such as an MPCNC or LowRider.
  2. Save G-code → **Save setup sheet + program…** writes one file per bit (the default). Each file has `M3 S12000` and `G4 P3.000`.
  3. Marlin reads `G4 P3.000` as 3 ms, so the bit plunges before the spindle is at speed (ADR-399 Context).
  4. No toast and no line on the sheet says the files are GRBL-only.
  5. Save as… from the same dialog, with the same prepared job, shows the warning.
- **Evidence:** REPRO with `zz-h3-setup-export.test.tsx`: the real `prebuildGcodeSave`, the mounted `CncSetupDocumentExport` clicked, then `handleSaveGcode` with the same prebuilt artifact, on `generic-marlin-laser` with the A-B-A fixture.
  - Output: `setupPackageMode "separate-tools"`. Three programs each have `G4 P3.000` and `M3 S12000`. `setupPackageToasts` is only `["Saved CNC setup sheet and exact program package to part.setup.html"]`, `setupPackageGrblAdvisoryInSheet false`.
  - Save as… gave `plainSaveGrblAdvisoryInToasts`: "This CNC file is written for a GRBL-family controller … (Marlin) cannot run KerfDesk CNC jobs … a spin-up G4 P taken as milliseconds lets the bit plunge before the spindle is at speed …".
  - Novelty: none found. ADR-399 (2026-09-25) predates the package's separate-tool export (ADR-572, ADR-392 Amd 3).
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:**
    - the Save G-code dialog showing the advisory before either button;
    - the advisory already sitting in `prepared.advisories` or `machineWarnings`;
    - the sheet naming GRBL anywhere;
    - ADR-399 not covering the package.
  - **ADR-399** (`docs/decisions/ADR-399-cnc-output-says-it-is-grbl-only.md`), Decision 1: "Save G-code of a CNC project, tile export and surfacing export each push one warning". The package is a button inside the Save G-code dialog (`GcodeSaveDialog.tsx:61-67`).
  - **Code.**
    - `cncProjectExportAdvisories` and `cncExportOtherControllersNote` have exactly two non-test callers, both in `file-actions.ts` (`:272`, `:337`). Both run only on the **Save as…** path.
    - `pushCncExportControllerMessages` is called only by tiles and surfacing.
    - `GcodeSaveDialog` shows only `preparationMessage`, not advisories.
    - `detectMachineJobWarnings` has no controller message.
  - **Own repro** (`zz-h3r-setup-export.test.tsx`), on the **Smoothieware** profile (the auditor used Marlin) with a two-bit project, for both package modes:
    - the only toast is "Saved CNC setup sheet and exact program package to out";
    - `grblInToasts`, `grblInDialog` and `grblInSheet` are all `false`;
    - the manifest records `"dialect": {"dialectId": "grbl-dynamic"}`;
    - Save as… on the same project pushes the Smoothieware warning, "… This profile's controller (Smoothieware) cannot run KerfDesk CNC jobs …".
    - In single-file mode on Smoothieware the skipped `M0` also cuts the next section with the previous bit (ADR-399 Context), and nothing warns.
  - **Severity: P2 kept.** ADR-399 Decision 2's Laser/CNC toggle toast names the same controller mismatch ("this profile's controller (Smoothieware) cannot run KerfDesk CNC jobs") when the project is switched to CNC on that profile (`MachineModeToggle.tsx:66-70`). The operator has therefore usually been told before output.
    - The missing per-export warning is a broken contract with a clear failure scenario.
    - A coordinator reading §3 strictly may note that the toggle toast is one-off and absent for a reopened CNC project.
- **Fix direction:** Push the same `cncProjectExportAdvisories` and `cncExportOtherControllersNote` on the package save, and print them in the sheet's Review findings. The package is the export most likely to leave KerfDesk.

### H3-P2-2 — One file per bit (the setup package default since #1453) moves the bit change to Run G-code file, which accepts the previous bit's Work Z and leaves X/Y unfrozen; Start's hold enforces both

- **Where:**
  - **The new path.**
    - `src/io/cnc/cnc-tool-programs.ts:84-95` writes only a comment for file 2 onwards: "keep the same X/Y zero; change to this bit and re-zero Z …". The sheet says the same (`cnc-setup-package.ts:127`).
    - `src/ui/gcode-inspector/external-run.ts:214-275` (`startExternalProgram`) checks the Frame record, the controller and the head position, then the `$30`/`$32` acknowledgement and the CNC attestation. None of these looks at Work Z or the bit.
    - The Frame's Work-Z gate needs only *current* evidence (`src/ui/laser/frame-cnc-preparation.ts:14-22`).
    - A KerfDesk file carries no Z or tool words, so a finished run keeps the evidence (`src/ui/state/external-program-controller-state.ts:15-24`).
    - `ExternalProgramContext` has no Work-Z input (`src/core/external-program/external-program-review.ts:41-52`).
  - **The twin.**
    - Hold entry voids Work Z (`src/ui/state/tool-change-hold-entry.ts:37`).
    - Continue requires fresh evidence for the pending bit (`laser-store-helpers.ts:132-157`).
    - X/Y origin writers are refused only while `streamer.status === 'tool-change'` (`laser-store-helpers.ts:108-110`).
- **Anchor:**
  - **Contract:** WORKFLOW F-CNC15:
    - "Error — resumed without re-zeroing": Continue stays blocked until fresh evidence "for the replacement bit";
    - "Error — X/Y origin change during the hold": the hold re-zeroes Z only.
  - ADR-392 Amd 3's Consequences make the default multi-bit package several Run G-code file runs. The operator re-zeroes "between them", and nothing checks it.
  - **Twin:** Start's bit-change hold for the same two sections.
- **Scenario:**
  1. A two-bit job, saved as the default setup package.
  2. The operator zeroes the 1/4" bit and runs file 1 with Run G-code file.
  3. They swap to the 1/8" bit and do not re-zero, or zero with the Active bit still the 1/4".
  4. They open file 2, Frame it (it passes, because the 1/4" evidence is current) and Start.
  5. File 2 cuts at the 1/4" bit's zero, off by the difference in stick-out.
  6. Project Start's hold refuses the same Continue: "Work Z belongs to a different bit …".
  7. **Second effect.** Between files the XYZ corner probe and Set origin are allowed. An XYZ touch-off with the Active bit left at the 1/4" moves X/Y by the radius difference (1.59 mm) for every later file. Start's hold offers only the Z probe.
- **Evidence:** REPRO (guards) + READ (the external path).
  - `zz-h3-recovery-bit.test.ts`, test "compares the guards on one state". The state is Idle and connected, with evidence `em-6350` current at epoch 7. As inside Start's hold (pending `em-3175`):
    - `toolChangeContinueBlockMessage` gives "Work Z belongs to a different bit. Load 3.175 mm (1/8") end mill, …";
    - `toolChangeXyOriginBlockMessage` gives "A tool change re-zeroes Z only. …".
  - As between per-bit files (no stream): `toolChangeXyOriginBlockMessage` gives `null`, and the external path has no Work-Z or bit check at all (READ above).
  - `zz-h3-save-paths.test.ts`: file 2's first lines are `; bit 2 of 2: 3.175 mm (1/8") end mill` and `; keep the same X/Y zero; change to this bit and re-zero Z on the stock top before running this file`. It has no `M0`.
  - Novelty: the E4-P2-1 refuter's READ note covers an external `M0` leaving evidence for the *next project Start*. ADR-392 Amds 2 and 3 rely on "the ordinary jog, probe and Zero Z tools", not on a check. No audit raises the per-bit gap.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:**
    - the Run review reading the `; bit N of M` header;
    - a finished KerfDesk file voiding Work Z;
    - the CNC attestation naming the re-zero;
    - the Frame checking the bit.
  - **Own repro** (`zz-h3r-setup-export.test.tsx`, test "per-bit files"), on the GRBL profile with a two-bit project, through the real `prebuildGcodeSave`. Each per-bit file was then put through `normalizeExternalProgram` → `buildGcodeRenderModel` → `reviewExternalProgram` with `kerfDeskBitChanges`, as `RunGcodeFileDialog.tsx:74-109` does.
    - Two files. File 2 opens with `; bit 2 of 2: 6.35 mm (1/4") end mill` and `; keep the same X/Y zero; change to this bit and re-zero Z on the stock top before running this file`.
    - Both files have no `M0` and no `T` word, and `changesWorkZ false`.
    - `reviewWarnings []` for both files.
    - `isWorkZEvidenceCurrentForStart` with the bit-1 evidence is `true`, so file 2's Frame takes no prompt (`frame-cnc-preparation.ts:15-23`). `toolChangeXyOriginBlockMessage` with no stream is `null`.
  - **Code.**
    - `kerfDeskBitChangeWarnings` fires only when the file stops at `M0` (`kerfdesk-bit-changes.ts:26-35`). Nothing reads the per-bit header.
    - `CNC_SETUP_ATTESTATION_PROMPT` (`cnc-setup-attestation.ts:4-14`) names workholding, clearance, removed probe hardware and exclusive access, not Z.
    - No Work-Z void runs on job completion: `workZZeroEvidence: null` writers on `105d6374c` are WCS, Console, probe, home, origin, connection and status paths.
  - **Severity: P2 kept.** KerfDesk's bytes are right. The wrong depth needs the operator to skip a step that file 2's own second line names, and the Inspector's source pane shows that line. The sheet's per-file table and "Before each file: … re-zero Z on stock top" repeat it. ADR-392 Amd 3 Consequences put that step on the operator.
    - What is missing is the twin guard that Start's hold has (F-CNC15 "resumed without re-zeroing").
    - KerfDesk could detect the mismatch: the header names bit 2, and the evidence records bit 1. It does not.
    - **For the coordinator:** under a strict reading of §3 (2026-10-27), a printed instruction is not a mismatch warning, and the result is depth. The case for P2 is that the program is correct and the operator has to omit a step that the file itself states.
    - The X/Y side-effect needs the XYZ probe with a stale Active bit. The header says "keep the same X/Y zero", and the corner probe form shows the bit diameter (`CornerProbeGeometryFields.tsx`), so it is the weaker half.
- **Fix direction:**
  - When Run G-code file opens a file whose header reads `; bit N of M` (N > 1), or one that names another bit, warn in the Run review unless Work Z was re-established after the previous run completed.
  - Alternatively, void Work-Z evidence when a KerfDesk per-bit file finishes, as the hold does on entry.
  - Say "keep X/Y: use the Z probe or Zero Z only" in the review too.

### H3-P2-3 — The surface-grid probe seeks without the probe-circuit test that the touch-off now requires

- **Where:**
  - `src/ui/state/laser-surface-probe-actions.ts:27-44`: `surfaceProbeBlockReason` checks the protocol, the Z axis and probe, settings reads, Idle, the units and the spindle. It does not check `probeCircuitBlockReason`.
  - `:140-143`: each point sends `G91 G38.2 Z-<maxTravelMm> F<seekFeed>`, with defaults of 10 mm at 150 mm/min (`SurfaceProbeDialog.tsx:19-22`).
  - **Twin:** `laser-probe-policy.ts:164-165`, the touch-off preflight's last check.
- **Anchor:**
  - **Twin:** ADR-103 Amd 2 Decisions 1 and 5 make every Z and XYZ touch-off wait for a test touch, because "a lead that is not clipped on drives the bit into the plate".
  - Decision 7 leaves the surface probe "unchanged" without giving a reason. METHOD (meta audit M6) does not accept a documented exclusion as a reason to lower severity.
- **Scenario:**
  1. The operator opens Super console → Surface probe with the clip off or a broken lead.
  2. At the first grid point the bit or probe seeks 10 mm (or the entered travel) down into the stock until ALARM:5.
  3. This is the M7-P2-1 hazard that #1450 fixed for touch-off.
- **Evidence:** REPRO with the same guard test, on one state: Idle, GRBL, probing capable, spindle off, units read, no test touch.
  - `touchOffCircuit`: "Test the probe first: hold the plate against the bit until the probe input shows closed, …".
  - `surfaceGridBlock`: `null`.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:**
    - a circuit test elsewhere on the surface path;
    - ADR-103 Amd 2 giving a reason for the exclusion;
    - the dialog proving the lead.
  - **ADR-103 Amd 2** (`docs/decisions/ADR-103-amendment-2-touch-off-tests-the-probe-circuit-first.md`), Decision 7: "The surface (height-map) probe, ALARM handling and the probe cycle's G-code are unchanged." It gives no reason. Decision 1 scopes the test to "The Z and XYZ corner cycles".
  - **Code (`105d6374c`).** `probeCircuitBlockReason` has two non-test callers, the touch-off preflight (`laser-probe-policy.ts:165`) and `ProbeControls.tsx:169`. `laser-surface-probe-actions.ts` is unchanged since `a59f74ff9`. It sends `G91 G38.2 Z-<maxTravelMm> F<seekFeed>` at every point (`:140-143`), with defaults of 10 mm at 150 mm/min (`SurfaceProbeDialog.tsx:12-23`).
  - **Own repro** (`zz-h3r-surface.test.ts`, state built from `initialLaserState()`):
    - **Untested lead:** touch-off gives "Test the probe first: …", and the surface gate gives `null`.
    - **Closed input:** touch-off gives "The probe input is closed. …", and the surface gate gives `null`. GRBL then raises ALARM:4 itself, so this half is benign.
  - **Mitigation the report did not mention.** **Measure** needs a ticked box, "Current Z clears the entire region, the probe is connected, and the spindle is off." (`SurfaceProbeDialog.tsx:127-136`). That is an attestation, not a test.
    - A broken lead passes it honestly.
    - Pre-#1450 touch-off had only a hint and was rated P2 (M7-P2-1).
  - **Severity: P2 kept.** It is the same hazard, with a narrower trigger: a broken lead, or a lead wrongly attested as connected.
- **Fix direction:** Add `probeCircuitBlockReason` to `surfaceProbeBlockReason`, after its other checks, as the touch-off preflight does. One test touch would cover the grid; the closed-input refusal belongs there too.

### H3-P3-1 — Save as… of a multi-bit job writes the `M0` program with "re-zero Z …, then cycle-start" and no note, while the setup package beside it explains the `M0` trap only when single-file is chosen

- **Where:**
  - `GcodeSaveDialog.tsx:51-57,72-77`: the primary **Save as…** writes the combined program (`file-actions.ts:296`).
  - Its advisories are the controller ones only (`file-actions.ts:265-275`, `:315-344`).
  - The program carries `; re-zero Z on the stock top, then cycle-start to resume` and `M0` (`cnc-grbl-transitions.ts:80-82`).
  - The package's note shows only when its mode is single-file (`CncSetupDocumentExport.tsx:138-147`), and the package opens on one file per bit.
- **Anchor:**
  - **Twin:** ADR-392 Amd 3 Decision 2 gives the single-file package a true instruction and a note.
  - Save as… writes the same bytes with neither. Its in-file comment is the instruction F8-P2-1 found false outside project Start and gSender.
- **Scenario:**
  1. A two-bit job → Save G-code → **Save as…** → the file is run in UGS.
  2. UGS passes `M0` through, as ADR-392 Amd 3 Context records from its source.
  3. The file says to re-zero at the stop, but GRBL takes no jog or Zero Z while held.
- **Evidence:** REPRO with `zz-h3-save-paths.test.ts` (`emitSavePreparedOutput` on a two-bit project).
  - `M0` is at line 48, after the two comment lines.
  - `G21 … G0 Z3.810`, `M3 S12000`, `G4 P3.000` and the plunge `G1 Z-1.000 F300` all follow within 19 lines.
  - `advisoriesMentioningM0 []`, `machineWarningsMentioningM0 []`, `setupDefaultMode "separate-tools"`.
- **Severity:** P3, not P2.
  - ADR-392 Amd 2's Context keeps option (c), warn only, for "a single-file save of a multi-bit job run through Run G-code file", and that review does warn.
  - M4 judged the E3-P2-1 fix defensible on that basis.
  - The gap left is a note at Save time and the in-file wording for other senders.
- **Refuter:** CONFIRMED (READ, plus the auditor's REPRO), P3 kept.
  - **The `M0` block.** `cnc-grbl-transitions.ts:80-82` writes the `; re-zero Z on the stock top, then cycle-start to resume` comment and `M0`.
  - **What Save as… pushes** (`file-actions.ts:256-344`): controller readiness, the ADR-399 advisory, "Saved G-code", preflight advisories, `machineWarnings`, V-carve depth and the other-controllers note.
    - None of these mentions `M0`.
    - `detectMachineJobWarnings` (`machine-job-warnings.ts:41-71`) has no bit-change or `M0` entry.
  - **Novelty.** F8-P2-1 cited the same program comment, but only for the setup package's single-file mode. The plain Save as… is not raised there.
  - **Severity.** ADR-392 Amd 2 Context keeps fix (c), warn only, for this file, and the Run review does warn, so P3 holds.
- **Fix direction:** For a multi-bit job, have Save as… push the package's single-file note, or offer the per-bit files. Reword the emitted comment to the package's true instruction.

### H3-P3-2 — The setup package refuses after the picker has returned when the project changed, leaving the chosen file empty, and a test pins that

- **Where:**
  - `CncSetupDocumentExport.tsx:44-48`: after `pickSetupDestination` resolves, `if (!currentDocumentArtifact(props)) return;` skips the write.
  - `CncSetupDocumentExport.test.tsx:182-200` pins `write` not being called after the picker resolves.
- **Anchor:**
  - **Contract:** ADR-656 Decision 3: "The pick is the commit". The picker "has already emptied the file".
  - ADR-656 Amd 1 Decision 2 applied the same rule to the four saves that still refused after the pick: "After the pick, write the bytes from the click". The setup package was not in its list.
- **Scenario:**
  1. The operator re-saves over `part.setup.html`.
  2. While the native picker is open, a phone or MCP edit changes the project.
  3. The file is left at 0 bytes, with the toast "The project changed. Reopen Save G-code …", which does not say the file was emptied.
- **Evidence:** REPRO of the pinned behaviour: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/CncSetupDocumentExport.test.tsx -t "rechecks source identity after the destination picker resolves"` → 1 passed (write not called after the picker resolved). The truncation itself is ADR-656's sourced Context (WICG/Chromium), not re-run.
- **Refuter:** CONFIRMED (READ, plus the auditor's run of the pinned test), P3 kept.
  - **Code.** `CncSetupDocumentExport.tsx:40` checks before the pick and `:47` after it. The test at `CncSetupDocumentExport.test.tsx:182-200` resolves the picker after `changeProject()`. It then expects `write` not called and a "project changed" warning.
  - **History.** `git blame` dates both checks to `08afe91ca` (2026-10-09), before ADR-656.
  - **ADR-656** (`docs/decisions/ADR-656-save-pickers-open-once-the-file-is-ready.md`):
    - its Context says the picker empties the chosen file in Chromium and in Electron (`webAdapter.pickFileForSave`);
    - its Consequences list the stale-check saves left out: stamp, CNC wrap study, relief component and personal artwork. The setup package is missing from that list;
    - Amd 1 fixed exactly those four.
  - **Twin.** Save as… in the same dialog writes the prepared artifact after the pick with no project check (`file-actions.ts:280-296`).
  - **Severity.** P3 holds: it needs a document change while the native picker blocks the page.
- **Fix direction:** Keep the pre-pick check. After the pick, write the prepared package and say it is from before the change, as the wrap study does (ADR-656 Amd 1 Decision 3). Update the pinned test.

## KNOWN (not raised again)

Refuter check: the two json KNOWN entries hold on `105d6374c`.
- **H3-K-1.** `cncProgramReachWarnings` has three non-test callers: `cnc-tool-programs.ts`, `save-output-emission.ts` and `job-review-cnc-reach.ts`. None of them is a tile path.
- **H3-K-2.** `tile-emission.ts` calls `runCncPreflight(project, machine, body, { compiledJob, compiledPositionsHold: false })` per bit file. F7-P3-2 and G5-P3-2 are the cited records.

- **F7-P3-2 / ADR-572 Amd 2 Consequences.** No reach or clamp review runs for tile files, recovery or Start-from-line programs, or Run G-code file. Still true: `tile-emission.ts` has no `cncProgramReachWarnings` call.
- **G5-P3-2.** Tile files run CNC preflight without a coordinate mode, so kept-part positions print whole-job coordinates.
  - **Extension (READ, not measured):** the same `machine` default (`tile-emission.ts:90`) also measures the bed and no-go checks in tile-local numbers.
- **G2-P1-1.** CNC recovery against the open project. Fixed by #1462 after the tree.
- **H8-P2-1.** A remote bit change keeps the old bit's feeds.
- **M7-P3-2.** The Marlin CNC export warning omits the spindle `S` wrap. H3-P2-1's missing warning would carry the same gap.
- **E4-P2-1 refuter note.** An external `M0` bit change leaves the old bit's Work Z for the next project Start. H3-P2-2 is the per-bit-file path, which has no `M0`.

## Refuted

- **H3-P1-1, supervised (runway) half (refuter).** Supervised recovery cannot run a multi-bit job. `jobAllowsSingleToolRunway` (`src/core/recovery/cnc-recovery-manifest.ts:168-177`) leaves every cut event of a multi-bit job `manual-only`. The flow refuses with "This operation is not supported by supervised contour recovery." (refuter repro, event `cnc-op-2/pass-1/cut-2`). In a single-bit job the archived first bit is the recovery program's bit. The finding stands for pass recovery.
- **Recovery skips the "no work zero" check.** It does not: `finalizeStartPreparation` adds `demotedPolicyWarnings` (Work Z currency and the park Z-top check) to the recovery's warning dialog.
- **Run G-code file runs a CNC file with no Work Z at all.** It does not: its Frame goes through `prepareTransientFrameController` → `prepareFrameLaser`, which prompts or refuses without current evidence. Only the bit identity is unchecked (H3-P2-2).
- **A per-bit file starts differently from the combined program after its `M0`.** It does not. Both restate `G21 G90 G54 G94 G17`, lift before `M3`, dwell, then rapid to the pass. Safe Z is machine-wide (`compile-cnc-pass-group.ts:43`), so the combined program's `maxSafeZ` lift equals the file's `safeZMm`. The finish and park options are the same, because both go through `emitPreparedGcode` with the Save options.
- **Plate removal between per-bit files is unchecked.** It is covered: the CNC attestation that Run G-code file requires lists "probe hardware, leads … removed" (`cnc-setup-attestation.ts:4-13`).
- **Save as… writes a stale program after a project edit.** Dropped: it writes the artifact the dialog prepared and that the operator clicked. That is ADR-656 Amd 1 Decision 2's rule.
- **Tiles reorder bits differently from Start.** By design: `tileLocalJob` re-runs `orderGroupsIntoToolSections` after adding the registration bores (ADR-392 Amd 2 D1, ADR-310 order).

## Verified clean

- **One emitter for every path.**
  - Start, recovery, Save, the setup package (both modes) and tiles all emit through `cnc-grbl-strategy.ts`.
  - Tiles call `cncGrblStrategy.emit` directly, with no finish options. That is correct, because tiles set the park aside (`placeCncParks(…, null)`).
  - The lift before `M3`, the spin-up `G4 P`, the post-`M0` modal restate and the park height (`cnc-park.ts`) are shared.
- **Per-bit sections match the emitter's bit changes.**
  - `contiguousSections` (`cnc-tool-programs.ts:68-80`), `splitTileJobByBit` and `cncToolPlan` all key on `toolId`, as `cncSpindleTransition` does.
  - Each file is single-bit with no `M0` (REPRO). `validateToolPrograms` ties the files to the job's tool plan and digests.
- **`EMITTER_REVISION`.** It is in the Save, setup-package (every per-bit file) and tile headers, and omitted on Start by design. #1459 moved it to v34 on `origin/main`.
- **Job Origin anchor (#1457).** Start, Save, the setup package and Run again all prepare through `prepareOutput` with the placement. Tiles keep their own frame (ADR-327 Amd 1 item 4), and recovery uses the archived placed job.
- **Park lift against the Z top (#1457).** It is a Start warning and a Job Review row, and it reaches recovery through `finalizeStartPreparation`.
- **Run again and phone/MCP Start.** Both take the same Frame permit → `reviewFramedRunForStart` → Job Review path as Start (H8 confirmed the remote half). The first-bit Work-Z warning therefore follows the program Run again streams.
- **Probe test touch (#1450).** It is enforced in the store's touch-off preflight for the Z and XYZ cycles, inside and outside the tool-change hold.
- **Start from line** refuses CNC (`start-job-flow.ts:307-310`).

## Not verified

- No hardware, air cut or sender (UGS, Candle, cncjs) was run.
  - The UGS `M0` behaviour in H3-P3-1 rests on ADR-392 Amd 3's read of UGS `67d626525`.
  - Marlin's millisecond `G4 P` in H3-P2-1 rests on ADR-399's sources.
- **Supervised (runway) recovery** in H3-P1-1 was by READ in the audit. The refuter ran it: it refuses every multi-bit job (see Refuted).
- **The inlay pair's two pieces** in the setup package: whether the pocket and the plug, which share one V-bit section, need different Z zeros within one file.
- **FluidNC's 127-byte line check** (`appendFluidncLineIssues`) is not run on tile files. Emitted CNC lines look far below it, but this was not measured.
- **Two-sided jobs with tiling:** the tile file names carry no side name and no side header.

```json
[
  {"id":"H3-P1-1","severity":"P1","area":"cnc-journey","file":"src/ui/laser/start-job-prepared-inspection.ts","line":27,"anchor":"Contract: WORKFLOW F-CNC15 Work-Z evidence at Start item 2 (compare with the first bit of the exact compiled plan); Twin: ordinary Start's check on the streamed program, tool-change Continue (laser-store-helpers.ts:150-156)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO (bits reversed: op1 em-3175, op2 em-6350) via real saveInterruptedRun -> runCncPassRecoveryFlow at op 2: streamed plan [em-6350], no M0; with em-6350 zeroed the only bit warning says Load 3.175 mm (1/8\"); with em-3175 zeroed no dialog names any bit; cncWorkZeroToolStartIssue has one caller (inspectPreparedStart); #1462 leaves the check unchanged. Supervised half REFUTED: jobAllowsSingleToolRunway (cnc-recovery-manifest.ts:168-177) makes multi-bit events manual-only, repro refused. P1 kept for pass recovery: wrong bit cuts wrong kerf/size, the dropdown label is not a mismatch warning and the app warning names the wrong bit","known":false,"summary":"CNC pass recovery (supervised recovery is single-bit only) runs cncWorkZeroToolStartIssue on the archived whole job's first bit (prepareArchivedRecoverySource -> inspectPreparedStart), not on the recovery program's; resuming in a later bit's section warns 'Load <first bit>' when the right bit is zeroed, and with the first bit zeroed cuts the later bit's passes with it and no warning (repro: recovery plan [em-3175], no M0; warning names em-6350)"},
  {"id":"H3-P2-1","severity":"P2","area":"cnc-journey","file":"src/ui/app/CncSetupDocumentExport.tsx","line":37,"anchor":"Contract: ADR-399 Decisions 1 and 5 (Save G-code of a CNC project ... each push one warning); Twin: Save as… in the same dialog (file-actions.ts:265-275), tiles (save-tiled-gcode.ts:106)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO on Smoothieware (not Marlin), both package modes: only the Saved toast, no GRBL text in toasts, dialog or sheet; Save as… on the same project pushes the Smoothieware advisory; cncProjectExportAdvisories/cncExportOtherControllersNote called only from file-actions Save as…. ADR-399 D1 read in docs/decisions. P2 kept: the ADR-399 D2 Laser/CNC toggle toast names the controller mismatch at mode switch","known":false,"summary":"Save setup sheet + program never pushes or prints the GRBL-only controller warning or note: on a Marlin profile the three per-bit files carry G4 P3.000 and M3 S12000 with only a 'Saved' toast, while Save as… from the same prepared artifact warns that Marlin reads G4 P as milliseconds"},
  {"id":"H3-P2-2","severity":"P2","area":"cnc-journey","file":"src/ui/gcode-inspector/external-run.ts","line":214,"anchor":"Contract: WORKFLOW F-CNC15 'Error — resumed without re-zeroing' and 'X/Y origin change during the hold'; ADR-392 Amd 3 Consequences; Twin: Start's hold (tool-change-hold-entry.ts:37, laser-store-helpers.ts:108-110,132-157)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO via real prebuildGcodeSave per-bit files -> normalizeExternalProgram -> reviewExternalProgram with kerfDeskBitChanges: reviewWarnings [] for both files, no M0/T, changesWorkZ false, bit-1 evidence current for file 2 Frame, X/Y origin unblocked; kerfDeskBitChangeWarnings needs M0; attestation names no Z. P2 kept: bytes are right and file 2 line 2 plus the sheet instruct the re-zero (ADR-392 Amd 3 Consequences); coordinator may weigh strict §3 (instruction is not a mismatch warning)","known":false,"summary":"The default one-file-per-bit package (#1453) moves the bit change to Run G-code file, whose Frame needs only current Work Z evidence and which checks no bit; the previous bit's zero passes, so file 2 can cut at bit 1's Z zero, and the XYZ probe and Set origin stay open between files; Start's hold voids Work Z, requires the pending bit's zero and freezes X/Y"},
  {"id":"H3-P2-3","severity":"P2","area":"cnc-journey","file":"src/ui/state/laser-surface-probe-actions.ts","line":27,"anchor":"Twin: touch-off preflight probeCircuitBlockReason (laser-probe-policy.ts:164-165, ADR-103 Amd 2 D1/D5); ADR-103 Amd 2 D7 leaves the surface probe unchanged with no reason","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO: untested lead -> touch-off refuses, surfaceProbeBlockReason null; probeCircuitBlockReason callers only touch-off preflight and ProbeControls on 105d6374c; ADR-103 Amd 2 D7 leaves surface probe unchanged with no reason. P2 kept: the dialog requires ticking \"the probe is connected\", an attestation that a broken lead passes (M7-P2-1 precedent P2)","known":false,"summary":"The surface-grid probe sends G91 G38.2 Z-<max travel> (10 mm default) with no probe-circuit test touch; on the same untested state the touch-off is refused and the grid is not, so a missing lead drives the bit into the stock (the M7-P2-1 hazard #1450 fixed for touch-off)"},
  {"id":"H3-P3-1","severity":"P3","area":"cnc-journey","file":"src/ui/app/GcodeSaveDialog.tsx","line":55,"anchor":"Twin: ADR-392 Amd 3 Decision 2 single-file note and true instruction (CncSetupDocumentExport.tsx:138-147); F8-P2-1 mechanism; ADR-392 Amd 2 Context (c) keeps warn-only for Run G-code file","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ + auditor REPRO: cnc-grbl-transitions.ts:80-82 comment and M0; Save as… toasts (file-actions.ts:256-344) and detectMachineJobWarnings have no M0 note; F8-P2-1 covered only the package single-file mode. P3 kept (ADR-392 Amd 2 option c, Run review warns)","known":false,"summary":"Save as… of a multi-bit job writes the M0 program whose comment says re-zero Z then cycle-start (M3 and plunge within 19 lines after M0), with no Save-time note, while the package beside it opens on per-bit files and shows its M0 note only when single-file is chosen"},
  {"id":"H3-P3-2","severity":"P3","area":"cnc-journey","file":"src/ui/app/CncSetupDocumentExport.tsx","line":47,"anchor":"Contract: ADR-656 Decision 3 and Amendment 1 Decision 2 (after the pick, write the clicked bytes); L7: CncSetupDocumentExport.test.tsx:182-200 pins the refusal","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ + pinned test text: post-pick currentDocumentArtifact at CncSetupDocumentExport.tsx:47 (blame 08afe91ca, before ADR-656); ADR-656 Consequences list four stale-check saves and omit the package, Amd 1 fixed only those; Save as… writes after pick. P3 kept","known":false,"summary":"The setup package re-checks the project after the picker returns and skips the write, leaving the chosen (already emptied) file at 0 bytes with a toast that does not say so; the four saves ADR-656 Amd 1 fixed do the opposite"},
  {"id":"H3-K-1","severity":"P3","area":"cnc-journey","file":"src/ui/app/tile-emission.ts","line":90,"anchor":"Contract: ADR-572 Amd 2 Consequences; F7-P3-2","evidence":"READ","verdict":"KNOWN","refuter":"Holds on 105d6374c: cncProgramReachWarnings callers are cnc-tool-programs, save-output-emission, job-review-cnc-reach only","known":"docs/audits/2026-10-23-cnc-v1/F7-cnc-preflight-reach.md F7-P3-2","summary":"No reach or clamp review for tile files, recovery programs or Run G-code file; unchanged"},
  {"id":"H3-K-2","severity":"P3","area":"cnc-journey","file":"src/ui/app/tile-emission.ts","line":90,"anchor":"Contract: ADR-433 Amd 3 Decision 2","evidence":"READ","verdict":"KNOWN","refuter":"Holds on 105d6374c: tile-emission runCncPreflight per bit file with compiledPositionsHold false","known":"docs/audits/2026-10-27-rolling-v3/G5-cnc-delta.md G5-P3-2","summary":"Tile preflight runs in machine coordinates; kept-part positions (and, by reading, bed and no-go checks) use whole-job numbers for tile-origin programs"}
]
```
