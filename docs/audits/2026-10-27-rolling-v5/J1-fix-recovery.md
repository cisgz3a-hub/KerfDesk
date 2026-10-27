# Rolling audit v5 — Recovery fixes

- **When:** 2026-10-27 21:20–22:10 +0800   **Tree:** origin/main @ `ff63ebb4b`
  - The audit worktree's `src/` is `19a05d355`. Every `src` change between it and `ff63ebb4b` is
    #1472 (merged 13:32Z as `f257054f6` while this audit ran). #1472 was read from its head
    `47faca62f`, and `git diff --stat 47faca62f ff63ebb4b` is empty for every file cited below.
  - #1472 repros ran in a scratch extract of `47faca62f` (`git archive`, now deleted). The other
    repros ran in the audit worktree.
- **Scope:** three fix PRs and the recovery code they share.
  - **#1462** (ADR-416 Amd 3, G2-P1-1): CNC recovery needs a CNC project open; a running job's
    hold follows the job's machine.
    - Files: `cnc-recovery-open-project.ts`, `job-motion-machine.ts`, `job-machine-lock.ts`,
      `laser-jog-actions.ts`, `MachineModeToggle.tsx`, `JogPad`/`ProbePanel`/`ProbeControls`,
      `machine-execution.ts`.
  - **#1468** (ADR-443 Amd 2, ADR-398 Amd 5; H2-P1-1, H2-P2-1, H2-P2-2): Start from line and
    Choose restart point keep the registration and clock; resets, close and restart record the
    backlog.
    - Files: `time-bound-start-inputs.ts`, `manual-restart-source.ts`, `start-job-source.ts`,
      `laser-recovery-flow.ts`, `checkpoint-interruption.ts`, `job-stop-request.ts`,
      `recovery-slot-mutations.ts`, `run-planner-blocks.ts`.
  - **#1472** (ADR-215 Amd 2, ADR-392 Amd 4, ADR-399 Amd 1, ADR-103 Amd 3; H3-P1-1, H3-P2-1..3):
    the recovery first-bit check, per-bit files, the package warning and the surface-grid test
    touch.
    - Files: `cnc-recovery-start-bit.ts`, `kerfdesk-bit-file.ts`, `bit-file-sequence.ts`,
      `CncSetupDocumentExport.tsx`, `laser-surface-probe-actions.ts`.
- **Lenses run:**
  - L10 on each fix: original repro, siblings, regression, ADR text, test truth;
  - L9 entry-point parity: card, wizard, Start from line, Choose restart point, phone and MCP,
    package files against tile files;
  - L4 interleavings: a mode switch during the dialogs, Abort and alarm between per-bit files,
    a serial advance after a run.
  - L2 was not run: no firmware claim beyond the cited ADRs' own sources.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+2 KNOWN). Seven candidates were dropped by
  the auditor's own checks; see Refuted.
- **Refuter (2026-10-27, fresh context, on `ff63ebb4b`):** confirmed 5, plausible 0, refuted 0;
  KNOWN 2 confirmed unchanged. J1-P3-3 is narrowed: its ADR-228 half is refuted, and its
  single-bit half is confirmed and covers more than was raised. No severity changes. J1-P2-1 stays
  P2 with its parent H3-P2-2 (see its ruling). The refuter's repro was a temporary
  `zz-j1r-tile-bit-header.test.ts`, now deleted. It used main's `kerfdesk-bit-file.ts`, copied in.
  The worktree's `tile-emission.ts`, `tile-bit-files.ts`, `tiled-output-preparation.ts`,
  `cnc-tool-programs.ts` and `external-program-controller-state.ts` are identical to `ff63ebb4b`.

## Headline

All three fixes close their original repros on current main:

- **G2-P1-1:** a Laser project now refuses CNC recovery.
- **H2-P1-1:** the restart reproduces Start's registered bytes.
- **H2-P2-1 and H2-P2-2:** the heartbeat, write-failure, app-closing and app-restart records step
  back like Abort.
- **H3-P1-1:** recovery checks its own first bit.

Each regression test fails without its fix: 7/7, 1/3 and 4/4 under mutation or on the pre-fix
tree.

The one real gap is a sibling #1472 missed: Run G-code file reads the per-bit header only in a
file's first four lines, but every real tile bit file puts it at line 13. So tile bit files get
none of ADR-392 Amendment 4's bit-change handling: Work Z is not voided and the X/Y origin is not
held (P2).

## L10 summary

| Fix | Original repro on main | Siblings | Regression | ADR text vs code | Test truth |
|---|---|---|---|---|---|
| #1462 | Refused before any dialog, and again at the final assertion when Laser is chosen during the attestation (pass and supervised) | Wizard keeps Start off; card note; phone and MCP have no recovery entry | None found. A single-bit job is refused too, see J1-P3-3 | Matches. Decision 1's "factually cannot be worked" does not hold for a single-bit job (J1-P3-3) | All 7 tests fail with both fixes mocked off |
| #1468 | The PR test is the audit's square: restart = Start's `X65`; refused with retired marks and no run; refused with Labs off | Both manual entry points and the fingerprint card. Write failure: backlog `{40,10}`, line 31 = Abort's | Serial or CSV moved on since the run: note says only "date or time" (J1-P3-2) | Matches. The planner-size hint and WORKFLOW wording overclaim (J1-P3-4) | Heartbeat test fails with `currentStreamWasReset` mocked false; the others fail on the pre-fix code by reading |
| #1472 | Pass recovery at op 2 on the 1/8" zero is refused, and on the 1/4" zero it streams `[em-6350]` | Package files are detected. **Tile bit files are not** (J1-P2-1). Abort and alarm leave no X/Y hold (J1-P3-1) | New refusal beside a "Rule 7" comment (J1-P3-3) | Amd 4 claims tiles, and "stopped or failed" (J1-P2-1, J1-P3-1) | The start-bit test fails 4/4 on `19a05d355` and passes on the PR. The tile unit test feeds a bare header (J1-P2-1) |

**Interactions.**

- In both CNC flows, #1462's open-project check runs before #1472's bit check.
- #1468 moved `recordedPlannerBlocks` to `run-planner-blocks.ts` and kept a re-export, so the CNC
  pass default point is unchanged.
- #1462 and #1468 touch no common file.
- #1472's merges `d2190b48b` and `f257054f6` have no combined (`--cc`) hunks. `start-job-source.ts`
  keeps both #1468's time-bound recovery source and #1472's `withoutArchivedFirstBitAdvisory`.

## Findings

### J1-P2-1 — Run G-code file never recognises a tile bit file, so the bit change between a tile's bit files gets no Work-Z void and no X/Y hold (#1472 sibling miss)
- **Where:**
  - **The reader stops at line 4.** `src/core/external-program/kerfdesk-bit-file.ts:20,24` sets
    `HEADER_LINES_READ = 4` and loops over `text.split('\n', HEADER_LINES_READ)`.
  - **The tile writer puts the bit line far below that.** `src/ui/app/tile-emission.ts:107-109`
    writes `tileHeader(project, machine)` (`gcodeMetadataHeader`,
    `src/io/gcode/gcode-metadata.ts:191-212`, five or more lines) and `; tile: row …, column …`.
    Only then does `tileBitHeader(bitFile)` follow.
  - **The consumer.** `RunGcodeFileDialog.tsx` calls `kerfDeskBitFile(props.text)`. The result
    goes through `prepareExternalRun` and `startExternalProgram` (`externalBitFile`) into
    `bitFileRunStartPatch` and `bitFileRunEndPatch` (`src/ui/state/bit-file-sequence.ts:38-49`).
    A null result means no void and no hold.
- **Anchor:**
  - **Contract:** ADR-392 Amendment 4, Context: "Amendment 2 does the same for a tile that needs
    several bits (`; bit N of M for this tile: <bit>`)". Decision 1: "The header is read from the
    file as opened". Decisions 2 and 3: Work Z goes, and the X/Y origin holds.
  - **Twin:** setup package per-bit files carry the header on line 1 and are recognised.
- **Scenario:**
  1. A tiled CNC job uses two bits (registration holes on the 1/4", profiles on the 1/8"). The
     tiled save writes `job_tile-r1-c1_bit-1-of-2` and `…_bit-2-of-2`.
  2. The operator runs bit 1's file through Run G-code file, swaps bits and does not re-zero.
  3. They frame bit 2's file. Frame accepts bit 1's Work Z, exactly as before #1472 (H3-P2-2), and
     the file cuts at the old bit's Z zero, off by the stick-out difference.
  4. Set origin and the XYZ corner probe also stay open between the two files.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/app/zz-j1-tile-bit-header.test.ts` in the `47faca62f` extract.
    It ran the real `finalizeTiledOutput(prepareOutput(project))` on the
    `tiled-bit-files.test.ts` two-tile fixture with registration holes, and ran
    `kerfDeskBitFile` on each file's text.
  - **Output for all four files:**
    - `bitHeaderAtLine 13`;
    - first lines `"; KerfDesk","; version: 0.1.0","; commit: dev","; built: …"`;
    - `kerfDeskBitFile: null`.
  - **Control:** `buildCncToolPrograms(preparedCncToolSections())` package files have
    `bitHeaderAtLine 1` and parse as `{order 1|2|3, count 3}`.
  - **Test truth:**
    - `kerfdesk-bit-file.test.ts`, "reads a multi-bit tile header", feeds
      `tileBitHeader(...) + MOTION` with no metadata header. It passes while every real tile file
      fails.
    - `external-run-bit-files.simulator.test.ts` uses package-style headers only.
- **Novelty:** none. No audit mentions `kerfDeskBitFile`. Open PRs #1473, #1475 and #1476 do not
  touch these files.
- **Severity:** P2, on the same basis as H3-P2-2 (P2). The file's own second line says to re-zero,
  and Amendment 4 claims a guard that tiles do not get.
- **Refuter:** CONFIRMED by the refuter's own REPRO on main's reader. **P2 kept.**
  - **What would make it false:**
    - a reader that skips the metadata header;
    - a tile file whose bit line falls within four lines;
    - any other path that voids Work Z or holds X/Y between tile files.
  - **Own repro:** the real `finalizeTiledOutput(prepareOutput(project))` on the
    `tiled-bit-files.test.ts` two-tile registration fixture.
    - **All four tile files:** the bit line is at line 13. Twelve comment lines come first: five
      metadata lines, four profile lines, `; assumes`, `; safety` and `; tile:`. The re-zero line
      is line 14. `kerfDeskBitFile` returns null.
    - **Control:** `buildCncToolPrograms(preparedCncToolSections())` files have the bit line at
      line 1 and parse as `{order 1|2|3, count 3}`.
  - **Nothing else catches it:**
    - `externalProgramControllerEffects` gives `changesWorkZ false` for every tile file, so the
      external run keeps the old bit's Work Z.
    - `kerfDeskBitChangeLabels` needs an `M0`, and tile files have none.
    - The only callers of `bitFileRunEndPatch` are the post-job settle and the Idle release. With
      `bitFileRun` null, both do nothing.
    - The code comment `kerfdesk-bit-file.ts:4-6` says a multi-bit tile "starts each of its files
      with" the header. Real tile files do not.
  - **Severity ruling: P2, not P1.**
    - **The strict reading would give P1.** KerfDesk's bytes are right. The depth goes wrong only
      when the operator skips the re-zero that the file's line 14 and the save-time
      `TILE_BIT_FILES_ADVISORY` both ask for. Those are instructions, not a warning about this
      specific mismatch, so a strict reading of §3 (2026-10-27 clarification) could make this P1.
    - **Why P2 holds anyway.** This is the same defect class, on the same entry point, as
      H3-P2-2. The coordinator put H3-P2-2 in the ledger at P2 after its refuter raised exactly
      that strict reading. H3's own L9 table already had the tile column as "between files: same".
      J1-P2-1 is the tile half that #1472 left unfixed, so it cannot be rated apart from its
      parent. If the coordinator re-rules the class under the strict reading, both findings go to
      P1 together.
    - **P2 also fits on its own terms.** It is "a broken contract with a clear failure scenario":
      ADR-392 Amd 4 Context names the tile header.
    - **Tiles are slightly worse than packages in one way.** The instruction sits on line 14, below
      twelve metadata lines, not on line 2.
- **Fix direction:**
  - Drop the four-line cap. The loop already stops at the first non-comment line.
  - Pin the fix with a real tiled-save file rather than a bare header.

### J1-P3-1 — A per-bit file stopped by Abort or an alarm never runs the end patch: no X/Y hold for the later bits, and a stale `bitFileRun` (ADR-392 Amd 4 says "completed, stopped or failed")
- **Where:**
  - **Where the end patch runs.** `bitFileRunEndPatch` (`bit-file-sequence.ts:38-49`) is applied
    only at the post-job settle (`laser-post-job-settle.ts:156`, a `done` streamer) and at the
    Idle release (`laser-status-line.ts:89`).
  - **What the Idle release covers.** That release fires only for `errored` or `done`
    (`laser-terminal-stream-release.ts:14,18`).
  - **What Abort and an alarm leave.** Both leave the streamer `cancelled`
    (`laser-alarm-stream-end.ts:44`), and a `cancelled` streamer is never released.
- **Anchor:**
  - **Contract:** ADR-392 Amendment 4, Decision 2: "Where its streamer is released (completed,
    stopped or failed), Work Z goes …". Decision 3: "While later bits of the set remain, every X/Y
    origin writer the hold refuses is refused too".
- **Scenario:**
  1. Per-bit file 1 of 2 is aborted, or alarms, before it completes. For example, the operator
     stops it during the final park and moves on to bit 2.
  2. `bitFileSequence` is never set, so Set origin, Reset origin and the XYZ corner probe stay
     open before file 2.
  3. `bitFileRun` stays at file 1 until the next stream starts.
  - **The Work-Z half holds.** Abort's reset left Work Z not current, so file 2's Frame refuses.
- **Evidence:** REPRO.
  - **Test:** a temporary `zz-j1-bit-file-abort.test.ts` in the `47faca62f` extract. It used the
    GRBL simulator and the real external Frame and Start, then `stopJob()` with file 1 at
    `done 44/44`, before its settle.
  - **Output:** `{"streamer":"cancelled","status":"Idle","bitFileRun":{"order":1,"count":2,…},
    "bitFileSequence":null,"xyBlock":null,"workZ":{"current":false}}`.
  - **File-2 Frame:** refused.
  - **Control (file 1 completed):** `bitFileSequence {order 1,count 2}`, `xyBlock true`, Work Z
    not current.
  - **Alarm:** read only (`cancelActiveStreamerPatch` → `cancelled`).
- **Severity:** P3. The depth half holds through the reset. The X/Y half was the weaker half of
  H3-P2-2. What is left is ADR/code drift.
- **Refuter:** CONFIRMED by READ, independent of the auditor's REPRO. **P3 kept.**
  - **What would make it false:** an Abort or alarm path that applies `bitFileRunEndPatch`, or that
    releases a `cancelled` streamer.
  - **The end patch has two callers only:** `laser-post-job-settle.ts:156` and
    `laser-status-line.ts:89`.
  - **The Idle release skips `cancelled`.** `shouldReleaseStreamerAtIdle` is true only for
    `errored`, or for `done` with no operation.
  - **Abort applies no end patch.** `applyStopOutcome` (`laser-job-stop-outcome.ts:44-68`) applies
    `finishedJobStateReset()` and a cancelled streamer.
  - **An alarm also leaves `cancelled`,** through `cancelActiveStreamerPatch`.
  - **What clears the cancelled streamer.** Only the next `startJob`, which overwrites
    `bitFileRun`, or a disconnect.
  - **The depth half holds.** GRBL-family Abort runs `originUnknownAfterControllerReset`, which
    voids Work Z. Marlin's no-reset Abort would not, but Marlin has `cncJobs: false`.
- **Fix direction:** apply `bitFileRunEndPatch` where an external per-bit stream ends `cancelled`.
  Otherwise, narrow the ADR text to "completed or rejected".

### J1-P3-2 — A manual restart of a variable-text job whose serial or CSV record moved on since the run burns the current value, and the note says only that "a date or time" can differ
- **Where:**
  - **Inputs remembered.** `src/ui/laser/time-bound-start-inputs.ts` remembers only the
    registration and the clock (`TimeBoundStartInputs`).
  - **Inputs not remembered.** Serial and CSV values come from `project.variables`, which advance
    after a successful stream (`variable-data-actions.ts:89-112`) or with Next.
  - **The fallback and its note.** With no run reproduced, `manual-restart-source.ts:113`
    compiles the live project. `:173-174` adds only "Variable text: evaluated now, so a date or
    time in it can differ from the part already burned."
- **Anchor:**
  - **Contract:** ADR-443 Amendment 2, Decision 3: the variable-text clock stays the run's; with no
    run reproduced, "the confirmation says a date or time can differ".
  - **Twin:** the matched restart reproduces the run byte for byte. H2 left this variable-text
    sibling "Not verified".
- **Scenario:**
  1. A Data Matrix `SN {{serial:4}}` with advancement after-successful-stream completes as SN 0007,
     and the serial moves to 8.
  2. The operator uses Start from line to redo the end of that job.
  3. The completed run no longer reproduces, so the restart compiles SN 0008: the same 570 lines,
     different modules.
  4. The remaining modules of SN 0008 burn onto SN 0007's partial code. The note names only a date
     or time.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/laser/zz-j1-serial-restart.test.ts` on the audit worktree. It
    used the #1468 test's in-thread worker mock, a real `RecoveryRepository` and
    `stageArtifact` → `activateFreshRun` → `completeRun`.
  - **Output with the serial at 8:**
    - `restart gcode equals the completed run false`;
    - `programNote "Line numbers count this project's full program as it compiles now (570 lines)."`;
    - `timeBoundNote "Variable text: evaluated now, so a date or time in it can differ from the part already burned."`.
  - **Control with the serial at 7:** `equals the completed run true`, and the program note reads
    "…, the program the last completed job ran."
- **Severity:** P3. The confirmation does say the text was "evaluated now". The wrong output is text
  content, not power, position, depth or scale. The coordinator may weigh P2, since a corrupt
  code is burned.
- **Refuter:** CONFIRMED by READ, with the auditor's REPRO as the second line. **P3 kept.**
  - **What would make it false:** the restart remembering the serial or the record, the note naming
    them, or the serial not advancing.
  - **What the restart remembers.** `TimeBoundStartInputs` (`time-bound-start-inputs.ts:19-24`)
    holds only `registration` and `evaluatedAtIso`.
  - **The serial does advance.** `advanceVariablesAfter` writes `project.variables` on a matching
    trigger.
  - **With no matched run,** `prepareManualRestartSource` compiles the live project
    (`manual-restart-source.ts:111-119`). The only variable note is the date-or-time line
    (`:173-175`).
  - **The ADR matches the code.** ADR-443 Amd 2 Decision 3 promises only the clock.
  - **Severity: P3, not P2 or P1.**
    - **Not P1.** A mark's content is not power, position, depth or scale (the §3 2026-10-23
      definition).
    - **Not P2, for three reasons.**
      - The code does what ADR-443 Amd 2 Decision 3 says, so no contract is broken.
      - Reach needs a non-default advancement policy (`DEFAULT_PROJECT_VARIABLE_DATA.advancement`
        is `'manual'`) and Start from line on a completed job.
      - The confirmation already marks the program as different. Its program note changes from
        "the program the last completed job ran" to "as it compiles now", and it says the text
        was "evaluated now".
    - **What is wrong is the wording:** it names only a date or time.
- **Fix direction:**
  - Name every variable in the note ("a date, time, serial number or CSV record").
  - Or remember the run's serial and record index with its clock, and offer them.

### J1-P3-3 — Both fixes add recovery refusals that the code's own "Rule 7" comment and AGENTS.md's refusal rule forbid; #1462's also refuses a single-bit job, where its stated factual reason does not apply
- **Where:**
  - **The #1472 refusal.**
    - `src/ui/laser/cnc-pass-recovery-flow.ts:140`: `refuseCncRecoveryStartBit` refuses on a Work-Z
      bit mismatch.
    - Five lines below, `:145` says "Rule 7 / ADR-228: only a compile-integrity failure may
      refuse recovery."
    - The same pair is at `cnc-supervised-recovery-flow.ts:185,190`.
  - **The #1462 refusal.**
    - `src/ui/laser/cnc-recovery-open-project.ts:24-28` refuses any non-CNC open project.
    - The PR's test does so for a one-bit runway job too ("refuses supervised recovery before any
      dialog", `runwayProject()`).
- **Anchor:**
  - **Contract: AGENTS.md** (Machine and output policy): "Keep policy findings in Job Review as
    warnings. Refuse only when transport factually cannot accept work, …". It also says "Do not
    relabel a policy judgment as one of those factual failures."
  - **Contract: DECISIONS.md ADR-228.**
    - Its "Hard rule" says "warnings promoted to blocks are all prohibited".
    - It demoted "missing Work-Z and tool/Z identity" to warnings.
    - Its "Kept" list includes "the supervised-recovery flows".
  - **Against them, the new ADRs:**
    - ADR-215 Amd 2, Decision 2: "This is a recovery refusal, not an ordinary Start policy gate".
    - ADR-416 Amd 3, Decision 1: "With the other kind open, the hold factually cannot be worked".
- **Scenario:**
  - **(a) The in-code contract now contradicts the code.** The first-bit advisory, which ADR-228
    demoted, is promoted to a block in recovery, beside a comment saying only compile integrity
    may refuse.
  - **(b) A single-bit job is refused with no reason left.**
    - A single-bit CNC recovery with a Laser project open has no bit-change hold.
    - Amd 3 Decision 2 already makes pause-time motion follow the job.
    - The "factually cannot be worked" reason therefore does not apply, but the recovery is
      refused anyway. Switching the toolbar to CNC clears it.
- **Evidence:** READ. Both refusals are pinned by the PRs' own tests
  (`cnc-recovery-start-bit.test.ts`, `cnc-recovery-open-project.test.ts`).
- **Severity:** P3. Both refusals fail safe, and neither strands work. This is a contract question
  for the maintainer: whether ADR-228's Kept "supervised-recovery flows" covers these refusals. At
  minimum, the two comments are stale.
- **Refuter:** CONFIRMED, narrowed. **P3 kept.**
  - **What would make it false:**
    - ADR-228 itself allowing recovery refusals;
    - the comment being scoped to something narrower;
    - a factual reason for refusing a single-bit job.
  - **(a) The ADR-228 conflict is REFUTED.**
    - **Recovery flows are on ADR-228's Kept list.** Under handoff consistency, "Kept - these are
      not guards" (DECISIONS.md) lists "checkpoint/receipt/fingerprint resume integrity, and the
      supervised-recovery flows". Its Deleted list also keeps "Supervised recovery keeps strict
      qualification".
    - **The demoted Work-Z item covers ordinary Start only.** "missing Work-Z and tool/Z identity"
      sits under "CNC Start policy gates".
    - **The new refusal twins one ADR-228 kept.** The recovery first-bit refusal matches the
      bit-change hold's Continue refusal ("Work Z belongs to a different bit",
      `laser-store-helpers.ts:158`), which ADR-228 never demoted. Recovery streams a later bit with
      no `M0` before it.
    - **The comment was already too broad before #1472.** The "Rule 7" comment is about the emit
      preflight split. It already sat below refusals that are not compile-integrity failures: the
      supervised runway refusals, such as `cleared-path-unproved`
      (`cnc-supervised-recovery-flow.ts:375-386`). It overclaims, but #1472 did not make it stale.
  - **(b) The single-bit half is CONFIRMED, and covers more than was raised.**
    - **The check reads only the kind.** `cncRecoveryOpenProjectIssue` checks the Laser/CNC kind
      and nothing else.
    - **Every supervised recovery is single-bit.** Supervised recovery is single-tool only
      (`jobAllowsSingleToolRunway`, `cnc-recovery-manifest.ts:168-177`; ADR-215 Amd 2 Context).
      So for every supervised recovery, the refusal's own reason ("A CNC recovery stops at bit
      changes…") is not true, not only for some.
    - **It fails closed.** Switching the toolbar to CNC clears it. That keeps it at P3.
- **Fix direction:**
  - Record the maintainer's ruling in ADR-228's Kept list, or keep the bit mismatch as a recovery
    warning.
  - Limit the open-project refusal to jobs whose tool plan has a bit change.
  - Update the two "Rule 7" comments either way.

### J1-P3-4 — After an app restart the Review says "the controller does not report how many moves it had buffered", and WORKFLOW says every planner-discarding stop steps back, though Marlin's stall `M410` does not
- **Where:**
  - **The hint.** `src/ui/state/recovery/recovery-slot-mutations.ts:371-377` gives every promoted
    run a `planner-size` backlog. `src/ui/laser/laser-recovery-automatic-restart.ts:56` renders
    every `planner-size` basis as "the controller does not report how many moves it had
    buffered".
  - **The workflow text.** `WORKFLOW.md:3143` says: "Every stop that throws the controller's
    planner away steps the automatic restart back … the reset KerfDesk sends when the stream
    stalls". But the Marlin acknowledgement stall sends `M410` with no reset record
    (`laser-stream-heartbeat-containment.ts:59,79`).
- **Anchor:**
  - **Twin:** the record's own cause, "The application restarted while this job was active."
  - **Contract:** ADR-398 Amendment 5, "Not covered": "Marlin's acknowledgement-stall stop sends
    `M410`, which drops its planner, without a reset record".
- **Scenario:**
  - **GRBL after a crash.** KerfDesk crashes during a GRBL or grblHAL job, both of which report
    `Bf`. The Review blames the controller for not reporting its buffer. The cause is that
    KerfDesk restarted.
  - **Marlin.** The WORKFLOW text promises a step back on Marlin that the code does not take.
- **Evidence:** READ.
- **Severity:** P3, doc and wording drift. The step back itself is right.
- **Refuter:** CONFIRMED by READ (code, plus the ADR's own text). **P3 kept.**
  - **What would make it false:** the promoted record carrying another bound or hint, or WORKFLOW
    listing the Marlin exception.
  - **The bound is always `planner-size`.** `promoteStaleActiveRunMutation`
    (`recovery-slot-mutations.ts:355-379`) always writes it.
  - **The basis follows the bound.** `plannerBacklogBasis` (`automatic-restart-line.ts:125-129`)
    maps that bound to `planner-size`.
  - **The hint ignores the controller.** `plannerBacklogHint`
    (`laser-recovery-automatic-restart.ts:55-57`) renders "the controller does not report how many
    moves it had buffered" for every controller.
  - **The WORKFLOW text overclaims.** `WORKFLOW.md:3143-3147` says every planner-discarding stop
    steps back.
  - **The Marlin stall records nothing.** `containStalledStreamAcknowledgements` sends Marlin's
    stop lines with no `streamReset` record (`laser-stream-heartbeat-containment.ts:59-79`).
    ADR-398 Amd 5 "Not covered" says the same.
- **Fix direction:**
  - Give the promoted record its own hint clause ("KerfDesk restarted, so the moves still
    buffered are unknown").
  - Add Marlin's stall stop to WORKFLOW's exceptions, as the ADR does.

## KNOWN (cited, not re-raised)

- **H2-P3-2** (`docs/audits/2026-10-27-rolling-v3/H2-recovery-journey.md`): the laser Review's Home
  button and its "Go to origin / restart point" still read the open project.
  - `CheckpointResumeBanner.tsx:135` reads `state.project.device.homing.enabled`.
  - `laser-recovery-move.ts:26` takes the feed from the open project.
  - With no running job, `retractToCncSafeZ` uses `pointMoveSafeZMm(get(), project)`, the open
    project's safe Z (`job-motion-machine.ts:37-47`).
  - #1462 covers running jobs only, so this is unchanged on `ff63ebb4b`.
- **G2-K-1 / M3-P3-4:** `bannerMayGreet` still ignores `grblHalEvidence`
  (`link-loss-restart-tracking.ts:68-74`). Unchanged.
- **Refuter:** both items confirmed unchanged on `ff63ebb4b`.
  - `CheckpointResumeBanner.tsx:135` and `laser-recovery-move.ts:26-30` still read
    `useStore…project`.
  - `bannerMayGreet` still tests only the link and the controller kinds.
  - The citations resolve: H2-P3-2 is at `H2-recovery-journey.md:476`, M3-P3-4 at
    `M3-meta-controller-v2-v3.md:324`, and G2-K-1 at `G2-job-state.md`.

## Refuted

Candidates the auditor dropped after checking:

- **A contained write failure records no backlog (the second half of H2-P2-1).** Refuted by REPRO,
  with a temporary `zz-j1-write-failure.test.ts` on the #1468 test harness.
  - Setup: 40 lines acknowledged, `Bf:5` (10 blocks queued), then a rejected `G1` write.
  - Output: `{"kind":"write-failed","backlog":{"ackedAtStatus":40,"queuedBlocks":10},
    "restart":31,"basis":"status-backlog","abortLine":31}`.
- **An aborted per-bit file leaves bit 1's Work Z for file 2.** Refuted by REPRO (J1-P3-1's run):
  Work Z was not current after the Abort, and file 2's Frame refused.
- **#1462's lock lets Open swap in any CNC project during a CNC hold.** `switchesOntoJobKind` allows
  it only while the open project is off the job's kind. Both ends of #1462 make that state
  unreachable, so this is latent and dropped.
- **The phone's `zSupported` follows the project mode while its Z jog follows the job's kind.** The
  projection is `machine-projections.ts:45` and the executor is `machine-execution.ts:122-123`. It
  differs only in the same unreachable Laser-open CNC hold, so it is latent and dropped.
- **The restart compile's `ownCurrentStartPreparation` could cancel itself on the archived
  placement.** The execution signature is taken from the same app snapshot it is compared with, and
  the placement only feeds a coordinate key that is computed identically both times
  (`start-preparation-owner.ts:33-61`).
- **The #1472 merges dropped one side in `start-job-source.ts` or WORKFLOW.** There are no `--cc`
  hunks in `d2190b48b` or `f257054f6`, and both changes are present.
- **CNC Pause and lift lifts to the open project's safe Z during a recovery.** Its height comes
  from the program's own rapids (`cnc-pause-reentry.ts:138`), not from either project.

## Verified clean

- **#1462.**
  - `cnc-recovery-open-project.test.ts` passes 7/7 on main. With both fixes mocked off (refusal
    stubs, plus `job-motion-machine` reverting to the open project), all 7 fail, so the ADR's
    verification claim holds.
  - `CncPassRecoveryWizard.test.tsx` passes 11/11: refusal shown and Start off with Laser open.
  - The check runs before any dialog and again in `assertFinalStartAuthorized`, and a
    final-assertion refusal keeps the offer with no claim.
  - The hold lifts to `activeJobSafeZMm`, which the recovery sets from the saved project's machine.
  - The toggle locks only the other kind; the lock is unchanged for ordinary Start.
  - No phone or MCP path starts CNC or laser recovery: the flow callers are desktop UI only.
- **#1468, H2-P1-1.**
  - `manual-restart-print-cut.test.ts` passes 7/7. It covers the audit's square (restart = Start,
    `X65`), retired marks with a run, marks recaptured 1 mm off, retired marks with no run
    (refused), Labs off (refused), and a dated Data Matrix 90 minutes later.
  - Both manual entry points (`runStartFromLineFlow`, `StartFromLineControl`) and the
    fingerprint-only laser card use the recorded inputs. Both confirmations carry
    `timeBoundNote`.
  - A time-bound Start always compiles in the background path, which records its inputs.
  - The archived fingerprint is of `prepared.gcode`.
- **#1468, H2-P2-1 and H2-P2-2.**
  - `laser-stream-reset-backlog.test.ts` passes 3/3. With `currentStreamWasReset` mocked false, the
    heartbeat test fails.
  - The promotion tests in `recovery-repository.test.ts` pass 2/2. They do a real reopen over the
    same backend.
  - All three `checkpointInterruption` call sites pass `streamReset`.
  - `DEFAULT_PLANNER_BLOCKS` matches ADR-398 Amd 5's family list (GRBL 15, grblHAL 100, FluidNC
    15, Smoothieware 32, Marlin 15).
  - The heartbeat containment is GRBL-family only. A Marlin write failure records no backlog, as
    the ADR says.
- **#1472, H3-P1-1.**
  - The PR's `cnc-recovery-start-bit.test.ts` fails 4/4 on `19a05d355` (pre-fix) and passes 5/5 on
    the PR.
  - ADR-215 Amd 2's claim holds: the final recovery assertion compares `workZZeroEvidence`
    (`start-job-authorization.ts:134`).
  - `withoutArchivedFirstBitAdvisory` is a no-op for laser capsules.
- **#1472, H3-P2-1, H3-P2-2 (package) and H3-P2-3.**
  - The package warning is pushed on each click and printed on the sheet, and the
    other-controllers note follows the save.
  - Package per-bit files are recognised (header on line 1). Their completion voids Work Z and
    holds X/Y (PR simulator test, 4/4).
  - The surface grid ends with `probeCircuitBlockReason`, and reserving the grid clears the test
    touch.

## Not verified

- **No hardware was operated.**
- **The desktop app-closing record.** Whether it lands before Electron exits was not tested. If it
  does not, the promotion path, now with a backlog, takes over.
- **Marlin's acknowledgement-stall `M410` path:** read only (J1-P3-4), as in H2 and ADR-398 Amd 5.
- **Custom bits after "switch the toolbar to CNC".** #1462's refusal advises switching the toolbar,
  but #1472's check and the hold's Continue need the archived job's tool id in the open project.
  Custom bits get `crypto.randomUUID()` ids (`cnc-library-actions.ts:95`). Whether another project
  shares those ids (a per-device library) was not traced. If it does not, the advice cannot be
  followed for such a job. That outcome is fail-closed.
- **The ALARM path of J1-P3-1** was read, not run.
- **#1472's P3 fixes** (H3-P3-1, the Save as note; H3-P3-2, the package picker) and its WORKFLOW
  text were not audited.
- **The CNC fingerprint-only supervised path** compiles with Start's inputs now, not a run's
  recorded inputs, unlike the laser card. It fails closed. It was not pursued.

```json
[
  {"id":"J1-P2-1","severity":"P2","area":"fix-recovery","file":"src/core/external-program/kerfdesk-bit-file.ts","line":20,"anchor":"Contract: ADR-392 Amendment 4 Context (tile header '; bit N of M for this tile') and Decisions 1-3; Twin: setup package per-bit files (header on line 1) are recognised","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO on main reader (zz-j1r, deleted): real finalizeTiledOutput two-tile registration fixture, all 4 tile files have the bit header at line 13 after 12 comment lines, kerfDeskBitFile null; package files line 1 parse; tile files changesWorkZ false, no M0, end patch callers no-op with bitFileRun null. P2 kept: same defect class and entry point as H3-P2-2 (ledgered P2 with the strict reading raised); its unfixed tile half moves with it; a strict re-rule makes both P1","known":false,"summary":"kerfDeskBitFile reads only the first 4 lines, but every real tile bit file (tile-emission.ts:107-109) puts its bit header at line 13 after the metadata header, so tile bit files get no Work-Z void and no X/Y hold between bits; the unit test feeds a bare header"},
  {"id":"J1-P3-1","severity":"P3","area":"fix-recovery","file":"src/ui/state/laser-terminal-stream-release.ts","line":14,"anchor":"Contract: ADR-392 Amendment 4 Decision 2 ('completed, stopped or failed') and Decision 3","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ on ff63ebb4b: bitFileRunEndPatch only at post-job settle and Idle release; shouldReleaseStreamerAtIdle true only for errored/done; applyStopOutcome and cancelActiveStreamerPatch leave cancelled with no end patch; GRBL Abort voids Work Z via originUnknownAfterControllerReset. P3 kept","known":false,"summary":"A per-bit file stopped by Abort (or an alarm) ends 'cancelled', is never released, and never runs bitFileRunEndPatch: no X/Y hold for the later bits and a stale bitFileRun; Work Z is voided by the reset, so the depth half holds"},
  {"id":"J1-P3-2","severity":"P3","area":"fix-recovery","file":"src/ui/laser/manual-restart-source.ts","line":174,"anchor":"Contract: ADR-443 Amendment 2 Decision 3; Twin: matched restart reproduces the run byte for byte","evidence":"REPRO","verdict":"CONFIRMED","refuter":"READ: TimeBoundStartInputs holds only registration and evaluatedAtIso; fallback compiles the live project (manual-restart-source.ts:111-119); note names only date or time (:173-175); matches ADR-443 Amd 2 D3. P3 kept: content is not power/position/depth/scale, contract met, advancement default manual, program note already says as it compiles now","known":false,"summary":"A manual restart of a completed serial-number job after the serial advanced compiles the next serial (SN 0008 over SN 0007's partial code) and the note says only that 'a date or time' can differ"},
  {"id":"J1-P3-3","severity":"P3","area":"fix-recovery","file":"src/ui/laser/cnc-pass-recovery-flow.ts","line":140,"anchor":"Contract: AGENTS.md 'Refuse only when transport factually cannot accept work…'; DECISIONS.md ADR-228 Hard rule (warnings promoted to blocks prohibited); vs ADR-215 Amd 2 D2 and ADR-416 Amd 3 D1","evidence":"READ","verdict":"CONFIRMED","refuter":"Narrowed. ADR-228 half REFUTED: Kept list has the supervised-recovery flows and strict qualification; demoted Work-Z/tool identity is under CNC Start policy gates; the refusal twins the hold Continue refusal (laser-store-helpers.ts:158); the Rule 7 comment already sat below runway refusals before #1472. Single-bit half CONFIRMED and wider: supervised recovery is single-tool only (cnc-recovery-manifest.ts:168-177), so the bit-change reason never applies there; fail-closed. P3 kept","known":false,"summary":"#1472 promotes the demoted first-bit advisory to a recovery refusal right above a 'Rule 7: only compile integrity may refuse recovery' comment (both CNC flows), and #1462's open-project refusal also fires on single-bit jobs that have no bit-change hold; needs a maintainer ruling, comments are stale"},
  {"id":"J1-P3-4","severity":"P3","area":"fix-recovery","file":"src/ui/laser/laser-recovery-automatic-restart.ts","line":56,"anchor":"Twin: promoted record cause 'The application restarted while this job was active'; Contract: ADR-398 Amendment 5 Not covered (Marlin M410 stall) vs WORKFLOW.md:3143","evidence":"READ","verdict":"CONFIRMED","refuter":"READ: promoteStaleActiveRunMutation always writes planner-size; plannerBacklogBasis maps it; plannerBacklogHint blames the controller for every kind; WORKFLOW.md:3143-3147 overclaims vs heartbeat containment Marlin M410 path with no streamReset and ADR-398 Amd 5 Not covered. P3 kept","known":false,"summary":"Every app-restart promotion is a planner-size backlog whose hint says 'the controller does not report how many moves it had buffered' (false on Bf-reporting GRBL/grblHAL); WORKFLOW says every planner-discarding stop steps back, though Marlin's stall M410 records none"},
  {"id":"J1-K-1","severity":"P3","area":"fix-recovery","file":"src/ui/laser/laser-recovery-move.ts","line":26,"anchor":"Twin: Review isolation claim; G2-P1-1","evidence":"READ","verdict":"CONFIRMED","refuter":"Unchanged on ff63ebb4b: CheckpointResumeBanner.tsx:135 and laser-recovery-move.ts:26-30 read the open project; citation resolves (H2 report :476)","known":"docs/audits/2026-10-27-rolling-v3/H2-recovery-journey.md H2-P3-2","summary":"Laser Review's Home and Go to origin/restart point still read the open project; #1462 covers running jobs only"},
  {"id":"J1-K-2","severity":"P3","area":"fix-recovery","file":"src/ui/app/link-loss-restart-tracking.ts","line":68,"anchor":"Twin: grblhal-evidence.ts","evidence":"READ","verdict":"CONFIRMED","refuter":"Unchanged on ff63ebb4b: bannerMayGreet tests only link and controller kinds; citations resolve (M3 report :324, G2-K-1)","known":"docs/audits/2026-10-23-meta-v1/M3-meta-controller-v2-v3.md M3-P3-4 (G2-K-1)","summary":"bannerMayGreet still ignores grblHalEvidence"}
]
```
