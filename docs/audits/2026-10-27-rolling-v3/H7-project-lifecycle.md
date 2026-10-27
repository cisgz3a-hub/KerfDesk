# Rolling audit v4 — Project lifecycle

- **When:** 2026-10-27   **Tree:** the audit worktree's `src/` is `origin/main` @ `a59f74ff9`. After
  `git fetch`, `origin/main` is `105d6374c` (#1460–#1464). Every file the findings cite is
  byte-identical on `105d6374c` (`git diff a59f74ff9 origin/main` is empty for `src/io/lightburn`,
  `src/io/project`, `project-open-completion.ts`, `project-template-actions.ts`,
  `autosave-record.ts`, `use-autosave.ts`, `compile-job-raster.ts` and
  `reference-image-output.ts`). Line numbers are the same on both trees.
- **Scope:** the project journey end to end:
  - **Writes:** Save, Save As, Ctrl+S, crash-screen Save (#1364, `crash-recovery.tsx`), Save
    before New/Open/close (`confirm-discard.ts`, `desktop-close-controller.ts`), autosave
    (`use-autosave.ts`, `autosave-record.ts`, `prepare-project-autosave.ts`), the raw recovery
    copy (`salvage-export.ts`, `large-project-recovery.ts`), templates
    (`project-template-actions.ts`), local snapshots (`local-project-snapshot.ts`), remote
    `save_project` (`remote-control/design-save.ts`), and the large-project worker path
    (`large-project-save.ts`, `portable-project-assets.ts`). Artwork exports were read for ADR-656
    ordering only.
  - **Reads:** File > Open, Recent Projects, drop, operating-system hand-over and the pending-open
    banner (`open-project-command.ts`, `external-project-open.ts`, `dropped-project-open.ts`),
    autosave recovery, New from template, local snapshot restore, LightBurn `.lbrn`/`.lbrn2`
    (`lbrn-import.ts`, `lbrn-geometry.ts`, `lbrn-layers.ts`), `.clb` and `.lfml.json` library
    import (`material-library-file-actions.ts`, `material-library-import.ts`), and the migration
    chain (`migrations.ts`, `migrate-v17-focus-intent.ts`, `legacy-trace-source.ts`).
  - Governing documents: WORKFLOW F-A12 (Open, migration toast), ADR-388 and Amendment 1
    (LightBurn import), ADR-673 item 8 (older trace photos), ADR-400 Amendment 1 item 2 (Auto-focus
    load clearing), ADR-550, ADR-656 and Amendment 1, ADR-204, ADR-283, ADR-378 and Amendment 2,
    ADR-093 Amendment 1, ADR-628 Amendment 1, and the schema notes in `core/scene/project.ts:20-34`.
  - Prior work read and treated as KNOWN: this folder's LEDGER and reports (H4-P1-1, H9-P1-1,
    G6-P2-2 in particular), rolling-v2 13, 19, 21, 27 and 04 with their LEDGER rows, and meta v1
    M7's corrections. `gh pr list --state open` returned no open PRs.
- **Lenses run:**
  - L9 (entry-point parity), the main lens: every write route and every read route above.
  - L1 (WORKFLOW F-A12, ADR-388 decisions 6 and 11, ADR-673 item 8, ADR-400 Amd 1 item 2,
    ADR-656).
  - L2 (LightBurn's per-shape Power Scale, checked against two real `.lbrn2` files pinned to
    commits).
  - L3 (Open vs template vs autosave recovery; Save vs autosave preparation).
  - L4 (lifecycle: reopening files written by 1.0.27 on this tree).
  - L6 (failed-save truth, dirty flag) and L7 (which paths have tests) as part of L9.
  - L5 was not run as its own pass. The trust boundary of project files is rolling-v2 13's, and
    every untrusted value found here reaches output through the importer, not a crafted field.
- **Counts:** 3 raised → 0 refuted → P1 2 / P2 0 / P3 1 (+6 KNOWN re-observed). Refuter: 3
  CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity changes. H7-P1-2's anchors are corrected: it is
  P1 by effect although ADR-673 sanctions the behaviour.

## Headline

The `.lf2` save and open paths are consistent: every Save route reaches the same preparation,
checkpoint and dirty-flag rule, and every Open route reaches the same parser and machine
reconciliation. The two defects are at the edges of the journey, where a file from somewhere else
is read.

1. **LightBurn per-shape Power Scale is dropped.** The `.lbrn2` importer ignores `PowerScale` on
   `<Shape>`, although KerfDesk's own `powerScale` field models exactly that setting. A real
   LightBurn power test grid (10 %…90 % cells) opens with every cell at the layer's 100 %, with no
   report line. One rectangle at Power Scale 20 on an 80 % layer burns S800 instead of S160
   (H7-P1-1).
2. **Older projects silently gain a photo engrave.** A project saved by 1.0.27 or earlier with a
   picture kept behind its trace opens on this tree with that picture engraving: a 40 × 40 mm photo
   goes from 0 to 37,881 lit raster lines. Open says only "Opened sign.lf2". ADR-673 chose the new
   meaning, but no app surface tells the operator. WORKFLOW F-A12's migration toast never fires
   because the schema did not change (H7-P1-2).

Smaller: autosave recovery and New from template drop both load notices that Open gives, the
migration toast and the "Auto-focus command was removed" warning (H7-P3-1).

## Entry-point parity (L9)

| Route | Bytes written / read through | Same content as Save? | Atomic / truthful failure | Dirty flag | Result |
|---|---|---|---|---|---|
| Save, Save As, Ctrl+S, toolbar (`file-command-context.ts:187-209`, `shortcuts.ts:222-235`) | `handleSaveProject` → studio checkpoint → `prepareProjectForPersistence` (small) or worker + `portableProjectAssets` (large) → seal → write coordinator | reference | validated before the picker (small) or before Choose file (large), ADR-656; seal falls back to sync HMAC, cannot throw | `markSaved` clears only if `state.project === expectedProject`; otherwise "saved with newer edits", recovery kept | Clean |
| Crash-screen Save (#1364) | `saveProjectNow` (same) | same | `error` → "Save failed. Try again"; stale → idle | same | Clean |
| Save before New/Open/close, desktop close | `confirmDiscardAsync` → `saveProjectNow` | same | proceeds only on `'saved'` with the same document epoch | same | Clean (27-P3-2 KNOWN) |
| Remote `save_project` (phone, MCP) | `handleSaveProject` with the existing target only | same | refuses a never-saved project; non-saved outcomes say so | same | Clean |
| Autosave tick / unload | `prepareProjectForAutosave` (no drift check, by design) + seal | same values, compact; recovery re-normalises | IndexedDB transaction (rolling-v2 13) | runs only while dirty, skips while streaming | Clean (13-P3-2 guides KNOWN) |
| Raw recovery copy | `salvage-export.ts` / `large-project-recovery.ts` | raw, page-backed images stay local (deliberate) | prompt quotes the refusal (#1352) | unchanged | Clean |
| Template, local snapshot | `prepareProjectForPersistence` → `portableProjectAssets` → seal; template picker after preparation | same | IndexedDB transaction / `pickPreparedSaveTarget` | n/a | Clean |
| File > Open, Recent, drop, OS hand-over, pending banner | `openProjectCommand` → `handleOpenProject` → `parseOpenedProjectFile` (`currentDevice` passed on every route) → `completeNativeProjectOpen` / `completeLightBurnProjectOpen` | — | newer schema refused; LightBurn never gets a save target | clean, or dirty when the bed was reconciled | Clean (H4-P1-1 KNOWN) |
| Autosave recovery | `readAutosaveRecord` → `setProject` | — | — | dirty | **H7-P3-1** (no load notices) |
| New from template | `parseProjectTemplateDocument` → `setProject` | — | — | dirty | **H7-P3-1** |
| Local snapshot restore | `parseOpenedProjectFile` → `completeNativeProjectOpen`, then dirty | — | refused during a job | dirty, no target | Clean |
| LightBurn `.lbrn2` open (all routes) | `importLightBurnProjectDocument` | — | report in toasts and notes (ADR-388 d12) | dirty | **H7-P1-1** (Power Scale) |
| `.clb` and `.lfml.json` library import | `importMaterialLibrary` → `resolveImportedLibrary` | — | never replaces a saved library | n/a | Clean (single entry point) |
| Any read of a 1.0.27 file with a kept trace photo (Open, Recent, drop, recovery, template, sheet switch) | `deserializeProject` → `settleLegacyTraceSources` | — | — | clean on Open | **H7-P1-2** |

## Findings

### H7-P1-1 — A LightBurn shape's Power Scale is dropped on import: a power test grid burns every cell at the layer's full power, with no report line
- **Where:**
  - `src/io/lightburn/lbrn-geometry.ts:163-172` — `visitVectorShape` builds each object from the
    shape's geometry and `CutIndex` only. `PowerScale` is read nowhere in `src/io/lightburn`
    (`grep -i powerscale` finds 0 hits on both trees).
  - `src/core/scene/scene-object.ts:179-180` — KerfDesk's own field for it:
    `// LightBurn Shape Properties: per-shape scale applied to layer power.`
    `readonly powerScale?: number;` (a percent, `project-shape-validator.ts:265`).
  - Reached from File > Open, Ctrl+O, Recent, drop and the operating system
    (`project-open-parser.ts:35-39`), all of which import through `importLightBurnProjectDocument`.
- **Anchor:**
  - **Contract.** ADR-388 decision 6 (`docs/decisions/ADR-388-lightburn-project-import-fidelity.md:60`):
    "Nothing is dropped without a line in the report." Decision 11 (`:91`): "Every shape left out
    is named." The shape is kept but its power is changed, and no line names it.
  - **Ground truth.** Real LightBurn files store it as a `<Shape>` attribute, percent:
    - `qnexo/yumi-laser` @ `521bd5ac270fdee5d1c7ac226a5b7490692c46f9`,
      `test gravure/Gravure-Power10-100-Speed-500-10000-1Passe.lbrn2` (LightBurn 1.4.02), L139:
      `<Shape Type="Rect" CutIndex="2" PowerScale="10" W="43" H="27" Cr="0">`. The file has 63
      `PowerScale` attributes, 10 to 90 in steps of 10, on Scan layers with `<maxPower Value="100"/>` (L31).
    - `davidribyrne/laser` @ `53ba244a3e1dc5076b18e46456071895d470340c`,
      `scripts/auto-test-pattern.lbrn2` (LightBurn 1.1.04), L195:
      `<Shape Type="Ellipse" CutIndex="4" PowerScale="20" Rx="3" Ry="3">` (30 attributes).
    - LightBurn's developer (Oz), forum, 2020-05-03,
      https://forum.lightburnsoftware.com/t/using-power-scale-and-knowing-its-being-used/15531
      (fetched 2026-10-27; the Wayback lookup returned HTTP 429, so no archive link):
      "If you open the LBRN file in NotePad and search for PowerScale, if it's there, it's used."
  - **Twin.** The same project's `powerScale` set by hand compiles correctly (S160 below), so the
    gap is only in the importer.
- **Scenario:**
  1. An operator opens a LightBurn power test grid (the yumi-laser file: nine columns at Power
     Scale 10 %…90 % of a 100 % Scan layer) to run it on their KerfDesk machine.
  2. KerfDesk imports 90 objects, all with no power scale, and reports 0 warnings.
  3. Start burns every cell at 100 %. The grid the operator reads afterwards maps nothing, and on a
     thin or heat-sensitive material the low cells are burned through at full power.
  - The same happens to any LightBurn design that uses Shape Properties > Power Scale for shading
    or lighter marks.
- **Evidence:** REPRO — `src/io/lightburn/zz-h7-powerscale.test.ts` (copy at
  `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\h7-repros\h7-powerscale.test.ts.txt`;
  the two real files are in `...\scratchpad\h7-lbrn-dl\`). Command:
  `node ../../../node_modules/vitest/vitest.mjs run src/io/lightburn/zz-h7-powerscale.test.ts --silent=false`.
  - `PowerScale=null -> object.powerScale=undefined S words: S800 warnings: []`
  - `PowerScale=20 -> object.powerScale=undefined S words: S800 warnings: [] mentionsPowerScale=false`
  - `same project with object powerScale=20 set by hand -> S words: S160`
  - `gravure.lbrn2: objects 90 powerScales [null] compiled group powers [100,40] warnings 0 anyPowerScaleMention=false`
  - `auto-test-pattern.lbrn2: objects 32 powerScales [null] compiled group powers [10,50,15] warnings 11 anyPowerScaleMention=false`
- **Novelty:** no report under `docs/audits/` mentions the LightBurn importer and Power Scale
  (rolling-v2 21 covered cut settings, sub-layers and `.clb`; its K-5 is bitmaps and text). No
  open PR.
- **Refuter:** **CONFIRMED at P1** (own REPRO, the pinned files re-fetched, and LightBurn's docs
  and developer posts fetched independently). No severity change.
  - **What would make it false:**
    - something in the import reads `PowerScale` or reports it;
    - LightBurn's Power Scale does not set output power, or does not apply to Scan shapes;
    - the finding is KNOWN.
  - **Code.** `git grep -i powerscale` over `src/io/lightburn` is empty on `a59f74ff9` and on
    `origin/main` `105d6374c`. Every route reaches `importLightBurnProjectDocument` →
    `importLbrnGeometry`: File > Open, Recent, drop, the OS, and the worker
    (`document-import-parse.ts:36-50`).
    - The only shape-level report lines are for left-out shapes (ADR-388 decision 11).
    - Decision 10's rule for unknown fields covers `<CutSetting>` fields only.
    - So a shape attribute can never reach the report.
  - **Own REPRO** (`src/io/lightburn/zz-h7r-powerscale.test.ts`, now deleted). Input:
    - a Scan layer at 80 % with a plain Rect and a Rect at `PowerScale="25"`;
    - a Cut layer at 60 % with an Ellipse at `PowerScale="50"`, inside a Group.

    Output:
    - `objects [{"id":"lbrn-h7r-1"},{"id":"lbrn-h7r-2"},{"id":"lbrn-h7r-3"}]` (no `powerScale`);
    - `groups [["fill","lbrn-h7r-1",80],["cut","lbrn-h7r-3",60]]`;
    - `S words S600 S800`;
    - `warnings [] notes ""`.

    The scaled Rect should burn at S200 and the Ellipse at S300.
  - **Real files.** Both were re-downloaded from the pinned commits and are byte-identical to the
    auditor's copies.
    - yumi-laser L139 is as quoted. The file holds 63 `PowerScale` values, seven each of 10…90.
    - KerfDesk opens it as `objects 90 distinct powerScale [null] group power histogram
      {"40":1,"100":8} S words S1000 S400 warnings 0`.
    - davidribyrne L195 is as quoted.
  - **Ground truth.**
    - LightBurn docs 2.0, Shape Properties (a versioned path,
      https://docs.lightburnsoftware.com/2.0/Reference/ShapeProperties/, fetched 2026-10-27): Power
      Scale "rescales the power used to cut this shape by this percentage". It is one of the
      options available for all object types.
    - Oz, forum thread 12712 post 6 (2020-03-02,
      https://forum.lightburnsoftware.com/t/under-shape-properties-what-is-the-power-scale-used-for/12712/6):
      power scaling gives "four rectangles, scanned in one continuous sweep" different powers. So
      it applies to Scan layers.
    - Oz, thread 15531 (2020-05-03): a value of 100 % is not saved. A missing attribute therefore
      means 100 %, so the importer's default is right only for shapes that carry none.
    - No archive link was made (the auditor got HTTP 429). The docs URL is a versioned path,
      which §4 accepts.
  - **Novelty.**
    - No audit mentions it: `git grep` of `docs/audits` and of every v3/v4 report, H5 included.
    - ADR-388 and its Amendment 1 say nothing about shape attributes.
    - `gh pr list --state open` is empty.
  - **Severity: P1 stands.** Every scaled shape burns at the wrong power: S800 instead of S200 here,
    and a 10–90 % grid burns entirely at 100 %. Every open route reaches it. No report line, note or
    toast mentions it. There is no §3 ground for lowering it.
- **Fix direction:** Read `PowerScale` (a percent) from each `<Shape>`, and from a Text shape for its
  `BackupPath`, into the object's `powerScale`, clamped to the validator's range. Name a value that
  cannot be read, as decision 6 does for kerf. *(Refuter:)* LightBurn scales "between Min Power and
  Max Power". `effectiveObjectPowerPercent` / `effectiveObjectMinPowerPercent` instead multiply both
  Max and Min by the scale. The two agree when Min Power is 0, so check a layer with a Min Power
  when the fix lands.

### H7-P1-2 — Opening a project saved by 1.0.27 or earlier silently turns its kept trace photo into a raster engrave; no migration notice reaches the operator
- **Where:**
  - `src/io/project/legacy-trace-source.ts:11-21` (`settleLegacyTraceSources`) drops
    `role: 'trace-source'`, so the kept photo becomes an ordinary image on its Image operation. Only
    a `camera capture` source is switched to Output off.
  - `src/io/project/deserialize-project.ts:108` runs it on every load at the same schema version
    (18), so `migratedFrom` stays undefined (`project-load-metadata.ts:4-9` has no flag for it).
  - `src/ui/app/project-open-completion.ts:46-51` then shows only `Opened <file>` as a success
    toast. Every other reader (autosave recovery, template, Recent, drop, a sheet switch) goes through
    the same `deserializeProject` with no notice at all.
  - Old behaviour, 1.0.27 (`adf300522`): `src/core/job/compile-job-raster.ts:82`
    `if (obj.role === 'trace-source') continue;`, also `frame-bounds.ts:70` and
    `raster-preparation-complexity.ts:32`. The marker was set by Trace Image when the picture was
    kept (`scene-mutations.ts:338`, and `rasterized-trace-mutation.ts:61`). Re-trace keeps the picture
    by default (`use-trace-dialog-settings.ts:81`, `useState(!retrace)`), so such files are common.
- **Anchor:**
  - **Contract.** WORKFLOW F-A12 "Success — schema older" (`WORKFLOW.md:1630-1633`): "Toast (info)
    identifies the migration". This load changes what the file burns, but it is not a schema
    migration, so the toast never fires.
  - **Contract.** `core/scene/project.ts:20-34`: each output change since v9 got a schema bump so
    "older readers must not silently replace their output semantics". The same principle runs the
    other way for a newer reader of an older file.
  - **Contract (conflict for the refuter to weigh).** ADR-673 item 8
    (`docs/decisions/ADR-673-picture-kept-after-trace-engraves.md:96-104`) chose the new meaning:
    "A kept photo now engraves. Preview, the Frame footprint, the hover card and Start review show
    it; delete it or turn its operation's Output off for the trace-only job saved before." Only the
    ADR gives that instruction; no app surface does. Under METHOD §3 (2026-10-27), Preview, the canvas
    and Frame are not warnings, and Start review lists an Image operation without saying it is new.
- **Scenario:**
  1. On 1.0.27, an operator traces a portrait, keeps the picture behind the trace (unticked
     "delete", or used Re-trace Original), and saves `sign.lf2`. Start burns the traced outline only.
  2. After updating, they reopen `sign.lf2` (or the app recovers its autosave) and press Start. The
     whole photo raster-engraves at its Image operation's power before the trace is cut.
  3. The only feedback is `Opened sign.lf2`, a success toast. The canvas looks almost the same: the
     photo was already visible, and only its old tint is gone.
  4. Where a rasterized trace result shared the photo's Image operation (ADR-673 item 8: "keeps
     sharing it"), the photo and the processed result both engrave over the same area, so the work
     takes a double exposure. Turning that operation's Output off, as the ADR advises, would also
     drop the result.
- **Evidence:** REPRO — `src/io/project/zz-h7-legacy-trace.test.ts` (copy at
  `...\scratchpad\h7-repros\h7-legacy-trace.test.ts.txt`). The test serialises a project with a
  40 × 40 mm photo (Image op 40 %) tagged `trace-source` plus its trace (Line op), as 1.0.27 wrote
  it, then runs `deserializeProject`, the real `completeNativeProjectOpen` and `emitGcode`. The
  1.0.27 semantics are modelled by omitting the tagged photo, as `compile-job-raster.ts:82` did.
  - `migratedFrom undefined toasts [["Opened sign.lf2","success"]]`
  - `groups now ["raster","cut"]`
  - `burn G1 lines: 1.0.27 semantics lines 15 G1 4 S>0 1 this tree lines 76584 G1 4 S>0 37882`
  - `sample … G0X45Y310.05S0 | G1X50F1500 ; kerfdesk:laser-off-motion | X90S300 | …`
  - Shared operation: `raster groups now 2`,
    `shared-op burn lines: 1.0.27 lines 76575 … S>0 37881 this tree lines 153143 … S>0 75762`
- **Novelty:** G10 says #1455 "is after the tree and is not audited here"
  (`G10-image-raster-trace.md:3-6`). No other report or PR covers the legacy reopen.
- **Refuter:** **CONFIRMED at P1** (own REPRO, plus the 1.0.27 code at `adf300522`). ADR-673
  sanctions the behaviour, but it is still silently wrong output, not a P2 contract gap.
  - **What would make it false:**
    - 1.0.27 already engraved the photo, or the tag never reached saved files;
    - the load raises a notice (a toast, a Job Review or preflight warning, hover text);
    - the photo's operation opens with Output off;
    - ADR-673 promised a notice and the code gives it.
  - **1.0.27 (`adf300522`, schema 18).**
    - Trace wrote the tag: `scene-mutations.ts:338` and `rasterized-trace-mutation.ts:61`.
    - `compile-job-raster.ts` skipped `obj.role === 'trace-source'`.
    - The hover card read "Trace source, not output" (the case the test at
      `hover-output-settings.test.ts:214` replaced).
    - So the saved job was trace-only, and the app told the operator so.
  - **Own REPRO** (`src/io/project/zz-h7r-legacy-photo.test.ts`, now deleted). Input: a 20 × 30 mm
    grayscale photo kept behind a Fill trace, serialised by this tree, then tagged `role:
    'trace-source'` in the JSON as 1.0.27 wrote it. Output:
    - `schemaVersion in file 18`;
    - `open result keys kind,project toasts [["Opened dog.lf2","success"]]`;
    - `role after load undefined`;
    - `groups [["raster",30],["fill",30]]`;
    - the hover now shows the photo's power and speed (`"power":"30%","speed":"1500 mm/min"`);
    - both operations are `output: true`;
    - New from template of the same bytes gives `groups ["raster","fill"]`, and the result has no
      notice fields (`project,projectJson`);
    - `lit lines: trace-only (1.0.27) 260 this tree 7528`.
  - **Nothing names the change.**
    - `git grep` of `src/ui/laser/job-review` and `src/core/preflight` finds no check for a kept
      photo or a trace source.
    - `LoadedProject` has no flag for it.
    - The photo's operation already had Output on in 1.0.27, because the tag excluded the photo,
      not the operation. So the Layers panel shows nothing new either.
  - **ADR-673 item 8** (`ADR-673-picture-kept-after-trace-engraves.md:96-102`, read at the
    audited SHA).
    - It chose the new meaning on purpose, with no schema bump.
    - The remedy for "the trace-only job saved before" appears only in the ADR text.
    - It promises no notice. It names Preview, the Frame footprint, the hover card and Start review
      as the places that show the photo.
  - **Ruling: P1, not P2.**
    - **§3 (2026-10-23):** to lower a P1, the output must be shown not wrong, or a clear warning
      must reach the operator. Preview, Frame, the hover card and Job Review display the job, but
      none names the change (§3, 2026-10-27).
    - **The output is wrong for the saved job.** The loader adds a raster engrave that the file
      never ran and that 1.0.27 labelled "not output". This fails the test meta-v1 M6-P2-3 used for
      "not wrong": there, each cut ran where it was drawn and KerfDesk added nothing.
    - **ADR acceptance does not lower it.** In meta-v1 `LEDGER.md:60`, M2-P3-3 is "P1 by effect".
      ADR-440 Amd 1 had accepted an older-data gap "without telling anyone" (`LEDGER.md:30`). This
      case has the same shape.
    - **It is reachable today.** #1455 (`d96943476`) is not in desktop 1.0.27 (`adf300522`). It is
      on the web build: Deploy of `105d6374c` succeeded at 2026-10-27T07:25Z
      (`gh run list --workflow deploy.yml`). The likeliest route is a browser autosave recovered
      from a session before #1455.
  - **Anchor corrections.**
    - WORKFLOW F-A12 "Success — schema older" does not literally apply: the schema goes from 18 to
      18, and "schema version matches" has no toast.
    - `core/scene/project.ts:20-34` is a code comment about older readers. Cite it as its own
      file:line, not as a contract.
    - The anchors that hold:
      - the §3 effect;
      - Twin: the same item 8 keeps a legacy camera capture's old output by setting Output off;
      - Twin: the loader names its other silent change (`autofocusCommandRemoved`).
    - Side note, not raised: WORKFLOW F-A2 (`WORKFLOW.md:123`) still lists `Trace source, not
      output` as a hover reason. This is doc drift after ADR-673 (P3).
  - **Shared operation.** The double exposure matches ADR-673 item 8 ("keeps sharing it"). The
    refuter did not re-run it.
  - **Fix timing.** Fix it on main now, not only "before the next desktop release", because the web
    build already ships it.
- **Fix direction:** Have the loader report how many kept trace photos it settled (as
  `autofocusCommandRemoved` does), and have every reader show a warning that names them and offers
  to set them to Output off. Do this before the next desktop release, which is the first to ship
  #1455. A shared operation needs the photo moved to an output-off copy, as camera captures already
  are.

### H7-P3-1 — Autosave recovery and New from template drop the load notices that File > Open gives (migration, Auto-focus command removed)
- **Where:**
  - `src/io/project/project-template.ts:26-55`: `parseProjectTemplateDocument` returns
    `{ project, projectJson }` and discards `migratedFrom` and `autofocusCommandRemoved`.
    `src/ui/app/project-template-actions.ts:77-81` toasts only "Started a new project from …".
  - `src/ui/state/autosave-record.ts:81-101`: `readAutosaveRecord` keeps only `project`, `savedAt`
    and `storageKey`. `src/ui/app/use-autosave.ts:153-166` restores with no notice.
  - Twin: `src/ui/app/project-open-completion.ts:46-57` shows both notices.
- **Anchor:**
  - Contract: WORKFLOW F-A12 step 2 (a migration is identified by a toast).
  - Contract: ADR-400 Amendment 1 item 2
    (`ADR-400-amendment-1-auto-focus-sends-only-a-focus-command.md:47-51`): the loader clears a
    refused command, and "a restored last machine clears it with a review note".
  - Twin: File > Open of the same bytes.
- **Scenario:** A template or autosave written before #1352 holds an Auto-focus line such as
  `G38.2 Z-10`. New from template, or Restore, silently empties it. The operator then finds Auto-focus
  unset with no reason given, while Open of the same file explains it. A v16 template also opens
  with no "migrated" toast. The removal is safe; the problem is that no notice explains it.
- **Evidence:** REPRO — `src/ui/app/zz-h7-notice-parity.test.ts` (copy at
  `...\scratchpad\h7-repros\h7-notice-parity.test.ts.txt`), the same v16 file through each reader:
  - `OPEN toasts [["Opened sign.lf2 — migrated from schema v16","info"],["The saved Auto-focus command was removed because it is not supported. Review Auto-focus in Machine Settings before using it.","warning"]]`
  - `TEMPLATE toasts [["Started a new project from sign.lf2template. Save will ask for a destination.","success"]] autofocus after ""`
  - `AUTOSAVE record keys ["project","savedAt","storageKey"] autofocus after ""`
- **Refuter:** **CONFIRMED at P3** (own REPRO for the template, plus a READ of autosave). No
  severity change.
  - **What was checked:**
    - `parseProjectTemplateDocument` returns only `project` and `projectJson`. The H7-P1-2
      refuter repro printed `template keys project,projectJson`.
    - `readAutosaveRecord` (`autosave-record.ts:81-101`) keeps the project, `savedAt`,
      `storageKey` and `sessionId`.
    - `use-autosave.ts:153-166` shows only a capability warning.
  - **Anchor correction.**
    - ADR-400 Amd 1 item 2 (`:47-52`) promises a review note only for "a machine profile file or a
      restored last machine". That means the app's remembered machine, not autosave recovery. For a
      project, it says only that the loader clears the command.
    - F-A12 governs File > Open.
    - So the contract anchors are weak. The Twin anchor holds: Open of the same bytes shows both
      notices.
  - **Severity.** P3 stands, because the removal is safe. These two readers also matter for
    H7-P1-2: a notice for a kept photo would be lost there too.
- **Fix direction:** Carry the loader's notice flags through `parseProjectTemplateDocument` and
  `readAutosaveRecord`, and show them from one shared helper. H7-P1-2's new notice belongs in the
  same helper so it reaches every reader.

## KNOWN (re-observed, not re-raised)
- **H4-P1-1.** Open of a same-identity file restores its machine copy. The same `setProject` path
  is reached by autosave recovery, New from template, local snapshot restore and sheet switches.
- **H9-P1-1.** "Keep current machine" is not an Undo step.
- **G6-P2-2.** The bed-reconciliation notice wording and camera swap (#1463 on `105d6374c`).
- **13-P3-2.** Guides past 200 are dropped on reload. Autosave has the same limit, since recovery
  re-normalises.
- **27-P3-2.** Desktop close "Don't Save" leaves the autosave.
- **21 K-5.** `.lbrn` bitmaps, outline-less text and `CutSetting_Img` are not imported (named in
  the report). H7-P1-1 is a different, unreported field.
- *(Refuter.)* Each of the six exists at its cited heading:
  - H4-P1-1 at `H4-machine-setup-connect.md:70`;
  - H9-P1-1 at `H9-undo-guards.md:89`;
  - G6-P2-2 at `G6-camera-calibration.md:90`;
  - 13 P3-2 at `13-project-io.md:169`;
  - 27 P3-2 at `27-app-shell.md:218`;
  - 21 K-5 at `21-lb-material-importers.md:429`.

  None of them covers H7-P1-1 or H7-P1-2.

## Refuted
The refuter refuted none of the three raised findings (H7-P1-1, H7-P1-2 and H7-P3-1 are all
CONFIRMED). None raised was refuted at audit time either. These candidates were dropped before
raising:
- **The seal after the picker could throw and leave the picked file empty.** No:
  `sealProjectTextAsync` catches WebCrypto failures and falls back to the synchronous HMAC
  (`project-seal.ts:48-70`).
- **File > Open and Recent replace the project under a running job, while drop and OS hand-over
  wait.** This is by design. ADR-378 (`ADR-378-recent-projects-and-operating-system-opens.md:52`)
  keeps in-app Open and Recent available during a job, and `setProject` still applies the job
  machine lock.
- **Remote `save_project` captures state before `commit()`.** `commit` only asserts the write is
  current (`adapter.ts:257-261`), so nothing changes in between.
- **Variable advance after an export is lost.** No: `advanceVariablesAfter` pushes Undo and sets
  dirty (`variable-data-actions.ts:89-112`).
- **v17→v18 leaves `focusTest` on artwork overrides.** No: an override with `focusTest` is refused
  on load (`project-layer-validator.ts:22`).
- **A fitted tone curve can be one the loader refuses.** No: the wedge has at most 21 patches, so
  the fit has at most 23 points (cap 64), and the fitter enforces pinned ends and monotone output
  (`photo-tone-curve.ts:46-67`).
- **The CNC two-sided setup or wrap study is dropped silently by Save.** No: the normaliser and the
  validator use the same schema, so an invalid value refuses Save instead
  (`project-cnc-two-sided-validator.ts:31-39`).
- **Autosave skips ticks while a job streams.** This is a design choice documented at
  `use-autosave.ts:86-90`, and no contract was found that it breaks. It is not raised.

## Verified clean
- **Save routes.** Every route listed in the L9 table reaches `handleSaveProject` with
  `projectWithCurrentJobSetup` and the studio checkpoint: Save, Save As, Ctrl+S, crash Save, Save
  before close, and remote save.
  - Validation happens before the picker on the small path. On the large path it happens before
    Choose file. This holds ADR-656 for project Save.
  - Templates and artwork exports use `pickPreparedSaveTarget`.
  - The dirty flag clears only when the captured project is still current. "Saved with newer edits"
    keeps the autosave slot.
- **Portable files.** Save, templates and local snapshots embed page-backed image pixels and luma
  through `portableProjectAssets`, recursing into sheets, manifests and arrays. Only the raw
  recovery copy keeps local asset IDs, which is deliberate.
- **Fonts.** `withReferencedEmbeddedFonts` walks every project value. Archived sheets and arrays
  carry their own font copies inside their JSON.
- **Open routes.** Every route passes `currentDevice` to the LightBurn importer:
  `openProjectCommand` from the menu, Ctrl+O, Recent, drop, OS hand-over and the pending banner. A
  LightBurn file never receives a save target, so Save cannot write JSON over a `.lbrn`.
- **Selection and placement.** Saved selection, Cut Selected Graphics and Start From are restored
  by `initialProjectWorkspaceState`.
- **Material library.** The only `.lfml.json` and `.clb` import route uses `resolveImportedLibrary`,
  which never replaces a saved library. Linked-preset refresh is explicit, and recipe auto-apply
  touches only fresh operations, so reopening a project does not change its operations from this
  computer's library.

## Not verified
- **LightBurn `<VariableText>`** and Text shapes holding variable fields. They import as static
  outlines from `BackupPath`, but there is no real file with a variable field to show what LightBurn
  writes.
- **The older `.lbrn` format's Power Scale.** One forum user reports `.lbrn` loses it in LightBurn
  itself. Not checked.
- **The `MaterialHeight` root attribute**, which ADR-388 does not mention.
- **Real browser and Electron behaviour:** File System Access permission and quota, the native
  picker, and two windows saving the same file. No browser or desktop build was run.
- **Older shipped builds reading files written by this tree** (forward compatibility, accepted by
  ADR-649/670/673).
- **Whether autosave should still skip during streaming,** now that large-project preparation
  runs in a worker.

Repro files were removed from the tree. Copies are kept in this session's scratchpad under
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\h7-repros\`.
The real LightBurn files are in `...\scratchpad\h7-lbrn-dl\`. To run a repro, copy it back to the
path named in its finding (dropping `.txt`), then run
`node ../../../node_modules/vitest/vitest.mjs run <path> --silent=false` from the worktree. Prefix
`NODE_OPTIONS=--no-experimental-webstorage` for the `src/ui/app` one.

The refuter's own repros (`src/io/lightburn/zz-h7r-powerscale.test.ts` and
`src/io/project/zz-h7r-legacy-photo.test.ts`) were run once each and deleted. Their inputs and
outputs are quoted under each finding's Refuter line.

```json
[
  {"id":"H7-P1-1","severity":"P1","area":"project-lifecycle","file":"src/io/lightburn/lbrn-geometry.ts","line":165,"anchor":"Contract: ADR-388 decision 6 ('Nothing is dropped without a line in the report') and 11; Ground truth: real .lbrn2 files qnexo/yumi-laser@521bd5ac L139 and davidribyrne/laser@53ba244a L195 carry <Shape ... PowerScale=\"10\"|\"20\">, LightBurn developer forum 2020-05-03; Ground truth (refuter): docs.lightburnsoftware.com/2.0/Reference/ShapeProperties (Power Scale, all object types), Oz forum 12712/6 (applies to scanned shapes); Twin: scene-object.ts:179 powerScale 'LightBurn Shape Properties'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The .lbrn2 importer ignores <Shape PowerScale>; a real LightBurn 10-90% power test grid opens with all 90 cells at the layer's 100% and 0 warnings; one rect at PowerScale 20 on an 80% layer burns S800 instead of S160"},
  {"id":"H7-P1-2","severity":"P1","area":"project-lifecycle","file":"src/io/project/legacy-trace-source.ts","line":11,"anchor":"METHOD §3 effect (a raster engrave the saved file never ran, 1.0.27 labelled it 'not output'; no app warning names it; ADR acceptance does not lower severity, cf. meta-v1 M2-P3-3 -> P1 by effect); Twin: ADR-673 item 8 keeps legacy camera captures output-off, and the loader names autofocusCommandRemoved; ADR-673 item 8 sanctions the new meaning but its notice exists only in the ADR. Refuter: WORKFLOW F-A12 does not literally apply (schema 18 -> 18) and core/scene/project.ts:20-34 is a code comment, not a contract","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A 1.0.27 project with a picture kept behind its trace reopens with the picture engraving (0 -> 37,881 lit raster lines for a 40x40 mm photo; double exposure where the raster result shares its operation); Open shows only 'Opened <file>' and recovery, templates and sheets show nothing"},
  {"id":"H7-P3-1","severity":"P3","area":"project-lifecycle","file":"src/io/project/project-template.ts","line":55,"anchor":"Twin: project-open-completion.ts:46-57 (File > Open of the same bytes shows both notices); Refuter: WORKFLOW F-A12 governs File > Open only, and ADR-400 Amd 1 item 2's review note covers a machine profile file or a restored last machine, not project recovery or templates","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"New from template and autosave recovery discard migratedFrom and autofocusCommandRemoved, so a v16 file with a refused Auto-focus line loses it silently while File > Open of the same bytes shows both notices"},
  {"id":"H7-K-1","severity":"P1","area":"project-lifecycle","file":"src/ui/state/project-bed-reconciliation.ts","line":86,"anchor":"see H4-P1-1","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-27-rolling-v3/H4-machine-setup-connect.md H4-P1-1","summary":"Same-identity file restores its machine copy; also reached by autosave recovery, templates, local snapshots and sheet switches"},
  {"id":"H7-K-2","severity":"P1","area":"project-lifecycle","file":"src/ui/state/project-actions.ts","line":151,"anchor":"see H9-P1-1","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-27-rolling-v3/H9-undo-guards.md H9-P1-1","summary":"Keep current machine is not an Undo step"},
  {"id":"H7-K-3","severity":"P2","area":"project-lifecycle","file":"src/ui/state/project-bed-reconciliation.ts","line":91,"anchor":"see G6-P2-2","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-27-rolling-v3/G6-camera-calibration.md G6-P2-2 (#1463)","summary":"Bed-reconciliation notice wording and camera swap on Open"},
  {"id":"H7-K-4","severity":"P3","area":"project-lifecycle","file":"src/core/scene/guides.ts","line":22,"anchor":"see 13-P3-2","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-21-rolling-v2/13-project-io.md P3-2","summary":"Guides past 200 dropped on reload; autosave recovery shares it"},
  {"id":"H7-K-5","severity":"P3","area":"project-lifecycle","file":"src/ui/app/use-autosave.ts","line":91,"anchor":"see 27-P3-2","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-21-rolling-v2/27-app-shell.md P3-2","summary":"Desktop close Don't Save leaves the autosave"},
  {"id":"H7-K-6","severity":"P3","area":"project-lifecycle","file":"src/io/lightburn/lbrn-geometry.ts","line":124,"anchor":"see 21 K-5","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-21-rolling-v2/21-lb-material-importers.md K-5","summary":".lbrn bitmaps, outline-less text and CutSetting_Img not imported (named in the report)"}
]
```
