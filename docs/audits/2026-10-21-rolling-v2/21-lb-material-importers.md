# Rolling audit v2 — LightBurn, material-library and device importers (21 `lb-material-importers`)

- **When:** 2026-10-21 23:45 – 2026-10-22 00:40 (+08)   **Tree:** origin/main @ `902f1d0c0` (audit
  worktree HEAD `886f95246`, audit docs only; `git fetch` at the end still showed origin/main
  `902f1d0c0`, so every audited line is current).
- **Scope:**
  - `src/io/lightburn/**`: `.lbrn`/`.lbrn2` projects (`lbrn-import.ts`, `lbrn-geometry.ts`,
    `lbrn-frame.ts`, `lbrn-vertex-list.ts`, `lbrn-setting-report.ts`, `lbrn-overscan.ts`,
    `lbrn-notes.ts`), `.clb` libraries (`clb-import.ts`), `.lbdev` devices (`lbdev-import.ts`,
    `lbdev-json.ts`, `lbdev-device.ts`).
  - `src/io/rd/**` (`emit-rd.ts`, `rd-preflight.ts`), with the encoder it calls in
    `src/core/controllers/ruida/` (`swizzle.ts`, `rd-numbers.ts`, `rd-job-writer.ts`,
    `rd-motion-plan.ts`) read for question 4 only.
  - `src/io/material-library/**`, `src/core/material-library/**`, `src/ui/material-library/**`.
  - `src/io/machine-profile/**`.
  - Callers read where a finding depends on them: `src/ui/app/material-library-file-actions.ts`,
    `src/ui/app/use-material-library-persistence.ts`, `src/ui/state/material-library-actions.ts`,
    `saved-libraries-actions.ts`, `material-library-import.ts`, `material-library-collection.ts`,
    `src/ui/layers/MaterialLibraryPanel.tsx`, `material-library-builders.ts` (both area 06 paths,
    read for question 2), `src/ui/laser/MachineSetupImportExport.tsx`,
    `src/ui/import/document-import-source.ts`, `document-import-parse.ts`,
    `src/core/job/fill-hatching.ts`, `src/core/devices/gcode-dialects.ts`,
    `src/ui/layers/CutSettingsFillDensityFields.tsx`.
  - Governing: ADR-388 (LightBurn project fidelity, decisions 1–13), ADR-398 decision 5 (JSON
    `.lbdev`), ADR-394 (Ruida `.rd` follows meerk40t), ADR-045, ADR-093, ADR-164 (bounded `.clb`
    import), ADR-257 (GRBL dialects). Prior audits: `docs/audits/rolling/2026-07-17-1231-lightburn-importers.md`,
    `docs/audits/2026-07-17-burn-quality-findings-register.md` (F18), `2026-07-17-laser-burn-quality-audit.md`
    (BQ-7), `2026-09-26-lightburn-gap-audit.md` (LBG-*), reports 01–19 of this run.
- **Lenses run:** L2, L3, L4, L5, L7 as separate passes (the ones this area was asked to stress),
  plus L1 (ADR-388, ADR-398 d5, ADR-093/045 clauses checked where their code runs) and L6 only for
  what the importers tell the user. L2 sources: LightBurn docs (Sub-Layers, Fill Mode, GRBL
  configuration), the LightBurn forum on overscan, meerk40t `rdjob.py` @ `7e82652f`, Rayforge's
  `.lbdev` importer, and real LightBurn files from public GitHub repositories (4 `.lbrn2` projects
  saved by LightBurn 1.6.03 and 1.7.08, 6 `.lbdev` device files). The LightBurn file formats are not
  published; where a claim rests on the files themselves or on an open parser, the finding says so.
- **Repros:** temporary Vitest files `zz-21-*.test.ts(x)` beside the code, run one at a time with
  `node ../../../node_modules/vitest/vitest.mjs run <file>`, output written to a scratch log. All were
  deleted from the tree; copies and the last output are in the session scratchpad under
  `a21-repros\` (`zz-21-sublayer.test.ts`, `zz-21-clb.test.ts`, `zz-21-lbdev.test.ts`,
  `zz-21-starter-overwrite.test.tsx`, `last-run-output.txt`). The downloaded LightBurn files are
  under `a21-lbrn\` and `a21-lbdev\`.
- **Counts:** 12 raised → P1 1 / P2 3 / P3 8 (+ 7 KNOWN). Refuter (2026-10-22): 12 CONFIRMED,
  0 PLAUSIBLE, 0 REFUTED; no severity changes. The refuter's repros (`zz-21r-*.test.ts(x)`) were
  its own, run on HEAD `60d5fcd5b` (source identical to origin/main `902f1d0c0`), and deleted.

## Headline

The `.lbrn` geometry, placement and unit work of ADR-388 holds against real LightBurn files, and the
Ruida encoder matches meerk40t byte for byte. The weak spots are LightBurn features the importers
were never shown:
1. **Sub-layers.** Real LightBurn 1.6/1.7 projects nest `<SubLayer>` blocks inside a cut setting.
   The importer's field lookup searches the whole subtree, so a sub-layer's passes or kerf become
   the main layer's (P2-1). A main tab switched off (`suboutput 0`) still burns, while the sub-layer
   LightBurn would run is dropped (P2-2). The report says only "SubLayer settings were not imported".
2. **Library data loss.** On the Neotronics profile, pressing **Starter Presets** when no library
   is open silently overwrites an existing, edited starter library with the stock one, deleting the
   operator's own presets (P1-1, reproduced through the real button and persistence hook).
3. **`.clb` and `.lbdev` mapping gaps.** A `.clb` `Scan+Cut` entry becomes a Fill-only preset with no
   word (P2-3). A LightBurn `GRBL-M3` device becomes an M4-dynamic profile, labelled
   "Mapped as GRBL-compatible" (P3-1).

## Findings

### P1-1 — Starter Presets silently overwrites an edited starter library, deleting the operator's own presets
- **Where:**
  - `src/ui/layers/MaterialLibraryPanel.tsx:85`: the button calls `setMaterialLibrary(buildStarterLibrary(...))`
    with no check and no confirmation.
  - `src/ui/layers/material-library-builders.ts:37`: the starter library always gets the same id,
    `laserforge-<profile>-starter`.
  - `src/ui/state/material-library-actions.ts:69-70`: `setMaterialLibrary` installs the document as is.
  - `src/ui/app/use-material-library-persistence.ts:52-60` → `material-library-collection.ts:110-117`:
    `reconcileActiveDocument` → `setLibraryPayload` writes the active document over the saved library
    with that id, and the collection is persisted to `localStorage`.
- **Anchor:**
  - Twin: every other way of adding a library refuses to replace a saved one.
    `createLibrary` uses `uniqueLibraryId` (`saved-libraries-actions.ts:109`, `:198`).
    Import goes through `resolveImportedLibrary`, which says "Import adds a document; it never
    replaces a saved library" (`material-library-import.ts:8`).
  - Contract: ADR-093 decision 1. Libraries are auto-saved with no manual Save, so nothing else
    keeps the operator's edits.
- **Scenario:**
  1. On the Neotronics 4040 profile (the only profile with a starter catalogue,
     `starter-catalog.ts:19-24`), the operator presses **Starter Presets**.
  2. They tune presets and add their own, for example "My walnut".
  3. Later no library is open. This happens after deleting the open library, for example a scratch
     library, and after any restart that follows. The panel again shows **Starter Presets** beside
     "Create a library below, or open one from Saved Libraries".
  4. Pressing it, perhaps to get "the starter library" back, replaces the saved starter library in
     place. The operator's presets are gone from the app and from `localStorage`, with no prompt
     and no undo (library state is not on the project undo stack).
- **Evidence:** REPRO with `zz-21-starter-overwrite.test.tsx`. It renders the real
  `MaterialLibraryPanel` and the real `useMaterialLibraryPersistence` hook, with an in-memory
  `localStorage` (Node 25 shadows jsdom's). It adds a preset with the real `upsertMaterialPreset`,
  then runs the real `createLibrary` and `deleteLibrary`. Output:
  - `STARTER after edit: entries 7 has mine true`
  - `STARTER active after delete null saved ids ["laserforge-neotronics-4040-max-lt-4lds-v2-20w-starter"]`
  - `STARTER after second click: entries 6 has mine false`
  - `STARTER localStorage has mine false`
- **Severity note:** this is P1 because it loses user data. The reach is narrow: one catalogued
  profile, and only after a library is deleted or none is open. The coordinator may grade it P2 on
  reach.
- **Refuter:** CONFIRMED, P1 kept. My own repro rendered the real panel, the real Saved Libraries
  dialog and the persistence hook on the Neotronics profile. The only prompt on the path was
  `Delete library "Scratch"?`, which names the other library. The second Starter Presets click
  raised no prompt, and "My walnut" was gone from the store and from
  `laserforge.material-libraries.v1`, the only storage key. Nothing else holds a copy: no backup
  slot, no IndexedDB, no library undo, and export happens only by hand. Reach is narrow. Neotronics
  is the only catalogued profile, and the default is `generic-grbl-400x400`. "No library open"
  happens only after deleting the open library. Deleting an imported `.clb` the operator doesn't
  want is a common way to get there. P1's "loses user data" has no reach condition, and the loss
  is silent and unrecoverable, so P1 stands.
- **Fix direction:** Route Starter Presets through the same no-replace rule as Import. Open the
  existing starter library if one is saved, or give a fresh copy a unique id. Never write a fixed
  id over a saved payload without asking.

### P2-1 — A LightBurn sub-layer's settings leak into the main layer when the main tab leaves a field at its default
- **Where:** `src/io/lightburn/lbrn-import.ts:369-379`. `textField` falls back to
  `element.querySelectorAll('*')`, which also searches nested `<SubLayer>` blocks. Every layer field
  is read this way: passes, kerf, interval, angle, cross-hatch, bidirectional, air, output and
  overscan (`:292-356`). The `.clb` twin reads direct children only (`clb-import.ts:215-226`).
- **Anchor:**
  - Ground truth: real LightBurn files nest sub-layers as `<SubLayer type="Cut" index="1">` children
    of `<CutSetting>`, after the main fields, and omit main fields left at their default. Examples:
    - `rispeed/CL650-DCPCCP` `LASER FILES/DCP_BUTTONS.lbrn2` (AppVersion 1.6.03)
    - `davidribyrne/laser` `signature/love.lbrn2` (1.7.08)
    - `marcoreps/commarker_uv_mods` `uv70_pcb_in 6x10_passes.lbrn2`
    - `WouterVandeWiele/robox2024` `rear-plate_20240804-1set.lbrn2`
    - LightBurn docs say sub-layers are "output in sequence, starting from left to right"
      (https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SubLayers/).
  - Contract: ADR-388 decision 10 says nested blocks are "named as a whole", which presumes the
    main layer's own values are untouched.
- **Scenario:** A Cut layer at 30 %, 10 mm/s, with numPasses left at its default (so omitted). Its
  sub-layer is a 3-pass, 0.3 mm-kerf finishing cut. KerfDesk opens one operation with 4 passes and
  a 0.3 mm kerf offset at the main layer's 30 % and 600 mm/min. LightBurn would run one pass with no
  offset, then the sub-layer. The part is cut four times at the wrong settings and grows by 0.3 mm
  per side. The report says only "C00: LightBurn “SubLayer” settings were not imported." Toasts
  show the first three report lines.
- **Evidence:** REPRO with `zz-21-sublayer.test.ts`, test "leaks". The main Cut layer omits
  numPasses and kerf; its SubLayer has `numPasses 4` and `kerf 0.3`. Output:
  - `LEAK layer {"power":30,"speed":600,"passes":4,"kerf":0.3,"output":true}`
  - `LEAK warnings ["C00: LightBurn “SubLayer” settings were not imported."]`
  - `LEAK job groups [{"kind":"cut","power":30,"speed":600,"passes":4}]`
  - L7: the only sub-layer test (`lbrn-setting-report.test.ts:142`) uses `<SubLayer><index Value="1"/></SubLayer>`,
    which is not LightBurn's shape (index is an attribute), and asserts only the report line.
- **Refuter:** CONFIRMED (P2).
  - Crafted files:
    - Cut main + Cut sub-layer (`numPasses 4`, `kerf 0.3`) opens with `passes 4, kerf 0.3`. The
      control without the sub-layer opens with `passes 1, kerf 0`.
    - Scan main + Cut sub-layer (`numPasses 3`) opens as a 3-pass Fill.
  - The only report line is the SubLayer line. All three routes (`project-open-parser`,
    `document-import-parse`, `document-import-source`) call the same importer.
  - LightBurn docs: sub-layer settings are "independently editable", and each new sub-layer starts
    from defaults.
  - None of the 5 real sub-layer blocks I fetched (DCP, love, rear-plate, two Commarker UV files)
    leaks a mapped field today. But 4 of the 5 are a Scan layer with a Cut sub-layer, which is how
    LightBurn ≥1.2 replaces Fill+Line (1.7 Sub-Layers page). A multi-pass Cut sub-layer there leaks
    its passes into the Fill.
- **Fix direction:** Read cut-setting fields from direct children only, as `.clb` does. Then
  either map sub-layers to extra operations or keep naming them, saying which settings were not run.

### P2-2 — A main tab LightBurn does not output (`suboutput 0`) is burned, and the report never says so
- **Where:**
  - `src/io/lightburn/lbrn-import.ts:331`: Output comes only from `doOutput` and `hide`.
  - `src/io/lightburn/lbrn-setting-report.ts:190-203`: an unknown field is named only when its value
    is not 0/off. `suboutput 0` means "off" and is therefore skipped, although its default is on.
- **Anchor:**
  - Ground truth: LightBurn docs, Sub-Layers page: "Toggle the Output switch on or off to
    determine whether a given Sub-Layer is included". The layer-wide switch is separate; it is
    `doOutput`, which ADR-388 decision 9 maps.
  - The main `<CutSetting>` carries `suboutput`/`subname` exactly as each `<SubLayer>` does, so the
    first tab is a sub-layer with its own switch. Real file, `DCP_BUTTONS.lbrn2` layer C00:
    - main tab "One": `suboutput 0`;
    - sub-layer "Two": `suboutput 0`;
    - sub-layer index 2: `suboutput 0`;
    - sub-layer "GOOD FINAL": no `suboutput` (on).
  - The reading of `suboutput` is inferred from the format and the docs; it was not run in LightBurn.
- **Scenario:** In that file LightBurn engraves only "GOOD FINAL" (Scan 10 %, 800 mm/min, individual
  grouping). KerfDesk fills C00 with the switched-off main tab's settings (15 %, 800 mm/min, by group)
  and never runs "GOOD FINAL". The report lists "subname (One)" and "SubLayer settings were not
  imported", and nothing about the main tab being off.
- **Evidence:** REPRO with `zz-21-sublayer.test.ts`, tests "suboutput" and "real LightBurn 1.6.03
  project". Output:
  - `SUBOUT layer {"mode":"fill","power":15,"output":true}`
  - `SUBOUT job groups [{"kind":"fill","power":15,...}]`
  - `DCP layers [{"name":"C00","mode":"fill","power":15,"speed":799.99…,"output":true},…]`
  - The DCP warnings contain no line about `suboutput`.
- **Refuter:** CONFIRMED (P2).
  - I fetched `DCP_BUTTONS.lbrn2` myself and imported it. C00 opens as Fill at 15 %, Output on.
    The report has `subname (One)` and the SubLayer line, and nothing about `suboutput`
    (`setValue('0')` is false, `lbrn-setting-report.ts:197`).
  - LightBurn 2.1 Sub-Layers page:
    - each sub-layer's Output switch decides whether it "is included in the output";
    - the layer-wide switch is separate;
    - you cannot delete the last sub-layer, so the first tab is itself a sub-layer.
  - In the file, `suboutput` is written only on tabs that are off, and "GOOD FINAL" omits it, as
    with every other default. Not run in LightBurn.
- **Fix direction:** Treat `suboutput 0` on the main tab like Output off for that tab, and name it
  in the report. Together with P2-1, decide whether enabled sub-layers become operations.

### P2-3 — A `.clb` `Scan+Cut` entry becomes a Fill-only preset with no warning at all
- **Where:**
  - `src/io/lightburn/clb-import.ts:271-276`: `operationMode` searches the type for "scan"/"fill", so
    `Scan+Cut` becomes `fill`. Any other unknown type (anything without image/scan/fill) silently
    becomes `line`.
  - `clb-import.ts:178`: `type` is a known field, so the loss does not even enter the unsupported
    count.
- **Anchor:**
  - Twin: the `.lbrn` importer reads the same `type` "as a whole name". It opens `Scan+Cut` as a Fill
    plus a Line operation, and names any other type in the report (ADR-388 decision 7,
    `lbrn-import.ts:276-286`).
  - Ground truth: `Scan+Cut` is LightBurn's Fill+Line mode, as ADR-388 decision 7 records.
- **Scenario:** A LightBurn library entry "Plywood 3 mm / Engrave and outline" (`Scan+Cut`) imports
  as a Fill preset. Applying it engraves the shapes but never cuts their outline. The import
  reports nothing about it.
- **Evidence:** REPRO with `zz-21-clb.test.ts`:
  - `CLB entry Fill and line … {"mode":"fill",…}`.
  - The report's `unknownFields` is `["SubLayer","index","kerf","name","tabSize","tabsEnabled"]`
    and `warnings` is `[]`; `type` is absent.
  - The `.lbrn` twin of the same setting gives
    `[{"name":"LightBurn C00","mode":"fill"},{"name":"LightBurn C00 (Line)","mode":"line"}]`.
- **Refuter:** CONFIRMED (P2).
  - `Scan+Cut` does occur in real libraries. Binary-Kitchen/thunderlaser_nova35
    `material_library.clb` has 3 such entries.
  - Imported, "Füllen + Cut" and "Füllen + Linie" become `mode fill`, `operation engrave`. The
    report has `warnings []`, and `type` is not among the 58 unknown fields.
  - LightBurn 1.7 Sub-Layers page: Fill+Line drew "an outline around an engraved shape". LightBurn
    converts it to a Fill sub-layer and a Line sub-layer, so the outline cut is lost.
- **Fix direction:** Read the type as a whole name, as `.lbrn` does. Either refuse to make a
  one-operation preset from `Scan+Cut` or import it with a named warning, and name unknown types.

### P3-1 — A LightBurn `GRBL-M3` device becomes an M4-dynamic profile, labelled "Mapped as GRBL-compatible"
- **Where:**
  - `src/io/lightburn/lbdev-json.ts:64` and `lbdev-import.ts:91`: any driver name containing "grbl"
    counts as GRBL.
  - `lbdev-import.ts:100-103`: the profile spreads `DEFAULT_DEVICE_PROFILE`, so its dialect is
    `grbl-dynamic`.
  - `lbdev-import.ts:145`: the review note says "Mapped as GRBL-compatible."
- **Anchor:**
  - Ground truth: LightBurn GRBL configuration guide: "GRBL 1.1e or older (GRBL 1.0, GRBL 0.9, etc)
    must use the GRBL-M3 device" (https://docs.lightburnsoftware.com/2.1/Guides/GRBLConfiguration/).
  - Twin: KerfDesk's constant-power dialect is literally labelled "GRBL Compatible", and its comment
    says it mirrors LightBurn's GRBL-M3 device (`gcode-dialects.ts:109-114`).
- **Scenario:** A user of GRBL 1.1e or older imports their `GRBL-M3` `.lbdev`. The review says
  "Controller: GRBL-M3 — Mapped as GRBL-compatible", but every cut, fill and raster is emitted with
  M4 dynamic power. That is the mode LightBurn deliberately avoids on that firmware.
- **Evidence:** REPRO with `zz-21-lbdev.test.ts`:
  `M3 applied [... {"label":"Controller","value":"GRBL-M3","note":"Mapped as GRBL-compatible."} ...] dialect {"dialectId":"grbl-dynamic"} cutPowerMode dynamic`.
- **Refuter:** CONFIRMED (P3).
  - Own repro: a JSON `.lbdev` with `Name "GRBL-M3"` gives the "Mapped as GRBL-compatible" note,
    `grbl-dynamic`, and `canCreateProfile true`.
  - I fetched LightBurn's GRBL configuration page myself. It says 1.1e or older "must use the
    GRBL-M3 device".
- **Fix direction:** Map `GRBL-M3` to the `grbl-compatible` dialect, or list it under Needs Review.
  Make the note name the dialect actually chosen.

### P3-2 — `.lbdev` import does not list "anything else" for review as ADR-398 decision 5 says: homing on startup, network connection and rotary mode are dropped unmentioned
- **Where:** `src/io/lightburn/lbdev-import.ts:170-178` (`reviewLightBurnFields`) and `:230-243`.
  The ignored list has only start and end scripts. `lbdev-import.test.ts:132` asserts that the
  official xTool D1 Pro file yields `needsReview` = `['Jogging']`, although that file has
  `"Type": "TCP"` and `HomeOnStartup`.
- **Anchor:** Contract: ADR-398 decision 5 ("The first `DeviceList` entry maps width and height …
  Anything else is listed for review."). L7: the test asserts the opposite.
- **Scenario:** Three real device files, all imported with nothing said about the dropped fields:
  - `H3mul/laser-cutting` `CR-Laser-device.lbdev` (Creality Falcon, `"HomeOnStartup": true`,
    `"Type": "TCP"`) imports with `homing: {enabled: false}`. Jobs therefore default to User Origin
    placement rather than Absolute (`job-placement.ts:37`), and Print and Cut and the native bed
    frame are off.
  - `1RandomDev/xTool-Connect` `xTool-D1-Pro.lbdev` is a TCP device but imports as a 230400-baud
    serial profile.
  - `kkolodziejczak/Sculpfun-S9-Settings` has `"rotaryMode": true`.
- **Evidence:** REPRO with `zz-21-lbdev.test.ts` over the four downloaded files:
  - `LBDEV cr needsReview ["Jogging=EnableGrblJCommand: false"] … profile {"origin":"front-left","homing":{"enabled":false,…}`
  - `LBDEV sculpfun ignored []`
  - `LBDEV d1pro needsReview ["Jogging=EnableGrblJCommand: false"]`
- **Refuter:** CONFIRMED (P3).
  - Own repro: `HomeOnStartup true`, `Type "TCP"`, `rotaryMode true` and `TransferMode 1` give
    `needsReview []` and `ignored []`, and `homing.enabled false`.
  - Correction to the citation: the D1 Pro fixture in `lbdev-import.test.ts` has `Type "Serial"`
    and `HomeOnStartup false`, not TCP. Those keys are still unlisted, so the test still contradicts
    ADR-398 d5.
- **Fix direction:** Add review lines for HomeOnStartup, Type (Serial/TCP), rotaryMode and the
  other unmapped keys, or narrow ADR-398 decision 5. Consider mapping HomeOnStartup to homing, as
  Rayforge's importer does (`lightburn_importer.py:286-289`).

### P3-3 — The `.clb` import toast gives only a count; the unsupported field names and entry warnings are never shown, and the count is mostly noise
- **Where:** `src/ui/app/material-library-file-actions.ts:113-120`. It shows
  "`${n}` unsupported CLB field or entry warning(s) were reported.", but `report.unknownFields` and
  `report.warnings` are not displayed anywhere. `material-library-file-actions.test.ts:134` pins the
  count-only text.
- **Anchor:**
  - Twin: the `.lbrn` report names every setting and shape left behind, per layer, and keeps the
    full report in Project Notes (ADR-388 decisions 10–12).
  - The toast says "were reported", but nothing shows the report.
- **Scenario:** Every real library raises the toast, because `index`, `name`, `LinkPath`, `PPI`,
  `dotTime` and so on count as "unsupported". Meanwhile settings that change the cut (kerf, tabs,
  perforation, sub-layers, dither mode) are folded into the same bare number. The operator cannot
  tell which presets lost what. (The kerf loss itself is KNOWN, see K-4.)
- **Evidence:** REPRO with `zz-21-clb.test.ts`. The report for four entries is
  `unknownFields ["SubLayer","index","kerf","name","tabSize","tabsEnabled"], warnings []`. The toast
  would read "6 unsupported CLB field or entry warning(s) were reported.", and 2 of those 6 are noise.
- **Refuter:** CONFIRMED (P3).
  - Under `src/ui`, only `material-library-file-actions.ts:114` reads `unknownFields`, and it uses
    only the count.
  - The real Nova35 library gives 58 unknown fields with `warnings []`, so the toast would say
    "58 …", while the Scan+Cut loss (P2-3) is not among them.
- **Fix direction:** Show the report: per entry, the fields that change the cut. Drop
  bookkeeping fields (`index`, `name`, `LinkPath`) from the count.

### P3-4 — A LightBurn Fill interval below 0.05 mm is imported as is, but burned at 0.05 mm with no note
- **Where:**
  - `src/io/lightburn/lbrn-import.ts:351` accepts any interval `> 0`; `clb-import.ts:153` accepts any
    interval.
  - The laser fill clamps the spacing to `MIN_HATCH_SPACING_MM = 0.05` (`src/core/job/fill-hatching.ts:45,88-90`).
  - The Line Interval field's range is 0.05–10 mm (`CutSettingsFillDensityFields.tsx:19-20`).
- **Anchor:** Twin: a kerf "the field cannot hold" is not applied and is named in the report
  (ADR-388 decision 6, `lbrn-import.ts:292-307`). The interval has the same field limit and no check.
- **Scenario:** The real `uv70_pcb_in 6x10_passes.lbrn2` (Scan, `interval 0.04`, 10 passes) opens
  with a 0.04 mm interval shown. A 10 mm fill burns 200 rows at 0.05 mm, not 250, which is 20 %
  less dense than LightBurn. The only trace is the G-code provenance comment.
- **Evidence:** REPRO with `zz-21-sublayer.test.ts`, test "interval":
  `INTERVAL layer 0.04 warnings []`, `INTERVAL rows 200 gap sample [0.05]`. The real file gives
  `"interval":0.04`, and its report has no interval line.
- **Refuter:** CONFIRMED (P3).
  - The real Commarker `uv70_pcb_in 6x10_passes` file, which I fetched myself, opens with
    `hatch 0.04` and no interval warning.
  - `fillHatching` over a 10 mm square at 0.04 gives 200 rows. It goes through
    `effectiveHatchSpacingMm`, the 0.05 floor.
- **Fix direction:** Name an interval outside 0.05–10 mm in the import report (and the `.clb`
  report), or store the clamped value with a note.

### P3-5 — Unreadable or impossible speed, power, passes and interval are silently defaulted or clamped (speed 0 becomes 1 mm/min)
- **Where:**
  - `src/io/lightburn/lbrn-import.ts:333-335`: `Math.max(1, speed*60)`, a clamp on power and
    passes, and an unreadable value leaves the KerfDesk default (30 %, 1500 mm/min).
  - `:100-116` of `lbrn-setting-report.ts`: speed, power and passes are in `NOT_REPORTED`, so an
    unreadable value is never named.
  - `clb-import.ts:153,161,170`: interval `0` becomes 0.001 mm and 1000 lines/mm, and speed `0`
    becomes 1 mm/min.
- **Anchor:**
  - Twin: an unreadable kerf is named ("is not a number", ADR-388 decision 6).
  - Contract: ADR-388 decision 6, "Nothing is dropped without a line in the report."
- **Scenario:** A damaged or hand-edited file with `<speed Value="0"/>` (or `"-5"`) opens as a
  1 mm/min burn. A `<maxPower Value="40,5"/>` opens at the default 30 %. Neither gets a report line.
- **Evidence:** REPRO with `zz-21-clb.test.ts`:
  `CLB entry Bad numbers … {"speed":1,"hatch":0.001,"lpm":1000}`, with no warning. For `.lbrn` the
  code path is the same (READ).
- **Refuter:** CONFIRMED (P3). Own repro:
  - `.clb` with `speed 0` and `interval 0` gives `speed 1`, `hatch 0.001` and `lpm 1000`, with
    `warnings []`.
  - `.lbrn` with `speed 0` gives `speed 1` and `warnings []`. This path is now reproduced too, not
    READ only.
- **Fix direction:** Name any speed, power, passes or interval that was unreadable, zero or clamped,
  as the kerf path does.

### P3-6 — Legacy XML `.lbdev` numbers are misread: `1e3` becomes a 1 mm bed, `4,000` becomes 4 mm, `1.5e3` becomes max S 1.5
- **Where:** `src/io/lightburn/lbdev-device.ts:143-149`. `parsePositiveNumber` takes the first
  `-?\d+(\.\d+)?` match. The JSON path uses it too, for string-valued fields (`lbdev-json.ts:102`).
- **Anchor:** Twin: the `.lbrn`/`.clb` importers use `Number()`, which reads exponents and rejects
  junk (`lbrn-import.ts:395-399`).
- **Scenario:** `<Width>1e3</Width><Height>4,000</Height><SMax>1.5e3</SMax>` gives a 1 × 4 mm bed and
  max S 1.5. These values are listed under "Applied", so they are visible before Apply.
- **Evidence:** REPRO with `zz-21-lbdev.test.ts`: `XML numbers {"w":1,"h":4,"s":1.5}`.
- **Refuter:** CONFIRMED (P3).
  - Own repro: `{"w":1,"h":4,"s":1.5}`, listed under Applied as "Bed width=1 mm". The regex at
    `lbdev-device.ts:32` explains it.
  - It is close to latent: LightBurn now writes JSON `.lbdev`, and nothing showed a real file
    writing exponents or thousands separators.
- **Fix direction:** Parse the whole trimmed value with `Number()` and refuse anything else, naming
  the field.

### P3-7 — Legacy XML `.lbdev` field lookup is quadratic in the file size and runs on the main thread
- **Where:**
  - `src/io/lightburn/lbdev-import.ts:263-271`: `extractFirst` runs a lazy
    `<Tag…>([\s\S]*?)</Tag>` regex once per tag name over the raw text. With many opening tags and no
    close, each attempt scans to the end of the file.
  - The caller `MachineSetupImportExport.tsx:75` runs it synchronously.
- **Anchor:** Contract: METHOD L5 (resource exhaustion). Related to KNOWN July P3-3 (lbdev "no size
  cap and no XML hardening"), whose note judged the risk low "because regex-on-text avoids DOM
  entity expansion". This measures the regex itself.
- **Scenario:** A crafted `.lbdev` freezes the app while it is imported. Measured: 14 KiB in 17 ms,
  27 KiB in 59 ms, 55 KiB in 246 ms, which is ×4 per doubling. Extrapolated (not run): about a
  minute at 1 MB.
- **Evidence:** REPRO with `zz-21-lbdev.test.ts`, test "regex cost":
  `XML regex 2000 opens 14 KiB 17 ms / 4000 27 KiB 59 ms / 8000 55 KiB 246 ms`.
- **Refuter:** CONFIRMED (P3).
  - Own timing, on a loaded PC: 14 KiB 36 ms, 27 KiB 110 ms, 55 KiB 522 ms. That is about ×3–5
    per doubling, so quadratic.
  - The caller (`MachineSetupImportExport.tsx:75`) is synchronous.
  - Only a file the operator picks can trigger it, so P3.
- **Fix direction:** Parse the legacy form with the XML parser (with the DOCTYPE/ENTITY refusal the
  siblings use), or find each tag once with an indexed scan.

### P3-8 — A `.clb` Fill entry with no overscan fields gets a 0 mm runway; the same layer in a `.lbrn` gets 5 mm
- **Where:**
  - `src/io/lightburn/clb-import.ts:14,143`: `DEFAULT_CLB_FILL_OVERSCAN_MM = 0` when both `overscan`
    and `overscanPercent` are absent.
  - `lbrn-import.ts:319` keeps the layer default (`fillOverscanMm 5`, `layer.ts:153`).
- **Anchor:**
  - Twin: the two importers read the same LightBurn fields through the same `resolveLightBurnOverscan`.
  - Ground truth (partial): the LightBurn forum says the overscan percentage "default setting is
    2.5%" (https://forum.lightburnsoftware.com/t/when-to-use-the-overscanning-option/3392/2).
    Whether the switch is on by default was not confirmed.
- **Scenario:** Two Scan entries in `h3mul-main-material-library.clb` and all three in
  `jayson-big-blue-laser.clb` (bundled fixtures) have no overscan fields. Applying one sets
  `fillOverscanMm 0`, while the same setting opened from a project keeps 5 mm.
- **Evidence:** READ (`clb-import.ts:135-143` against `lbrn-overscan.ts:19`). Fixture counts were
  made with a node scan of the five `.clb` fixtures.
- **Refuter:** CONFIRMED (P3).
  - Own repro: the same Scan setting gives `fillOverscanMm 0` from `.clb` and 5 from `.lbrn`.
  - The 0 dates from #894 (`6e89fd6d9`), which kept the earlier `?? 0`. No ADR chose it.
  - Extra evidence on LightBurn's default, from real 1.6/1.7 files (love, rear-plate, Commarker
    f7/f12). They write `overscan 0` explicitly and never `overscan 1`, while omitting other
    defaults. That suggests Overscanning is on by default, so both importers may under-read an
    absent switch.
- **Fix direction:** Use one default for an absent LightBurn overscan in both importers, after
  checking LightBurn's default switch state.

### KNOWN (re-encountered, not counted as new)
- **K-1 (13-P2-1).** A `.lbrn` with more than 10,000 shapes opens but cannot be saved. PR #1352
  (open) adds a refusal. Not re-checked.
- **K-2 (06-P2-4).** LightBurn speeds become fractional mm/min (`13.3333` mm/s → `799.998` mm/min
  in the DCP repro), which Cut Settings' native `step` validation refuses to Apply. Seen again here.
- **K-3 (13-P1-1 sibling).** `.lfmachine.json` accepts any string `autofocusCommand`
  (`machine-profile-shape.ts:222`), reaching the same Auto-focus sink. Report 13 flagged it for this
  area. PR #1352 (open) adds `src/io/machine-profile/machine-profile-autofocus.ts`.
- **K-4 (2026-07-17 F18, BQ-7, LBG-I05).** `.clb` drops kerf, tabs, dither mode and dot width.
  Imported presets default to `confidence 'starter'` (`material-matching.ts:64`) and display at the
  vetted-starter tier. Still open: the repro shows `kerf 0.15` becoming `0`.
- **K-5 (LBG-F17).** `.lbrn` Bitmaps, Text without BackupPath and `CutSetting_Img` are not imported.
  They are named in the report (real `rear-plate` file: "2 Bitmap shapes were not imported…").
  Embedded images therefore have no DPI to keep.
- **K-6 (LBG-C06).** LightBurn `anglePerPass` is not mapped to `passAngleStepDeg`; it is named in the
  report (`uv70` file).
- **K-7 (July P3-4).** `transformCurve` still treats any non-cubic segment as a line
  (`lbrn-frame.ts:88`), with no `assertNever`. It is unreachable because the importer builds lines
  and cubics only.

## Refuted
None. The refuter (2026-10-22) refuted none of the 12 raised findings. Candidates the auditor
dropped before raising:
- **A handle written as `c0x1` is ambiguous with a real handle at (1, 0)** (`lbrn-vertex-list.ts:47`).
  This is theoretically true, but every real file seen writes the bare `x1` marker on vertices with
  no handle, and an exact (1, 0) handle never appeared. ADR-388 decision 1 settled the form from the
  fixtures.
- **Absurd `.lbdev` `S_Scale` (for example 1e12) makes every power full PWM.** When connected, the
  output uses the controller's own `$30` (`connected-laser-power-scale.ts:33-76`), and readiness
  warns on a mismatch (`controller-readiness.ts:220`). Offline Save says the scale is unverified.
- **A process recipe in a shared `.lfml.json` injects G-code through a layer colour or id (03-P1-1
  class).** Step colours are checked with `isLayerColor` (`process-recipe-io.ts:197`), operation ids
  come from `createArtworkOperation`, and layer names never reach G-code comments
  (`grbl-strategy.ts:284` prints id and colour only).
- **The material wizard cannot turn Air off** (area 06 deferred this here). The settings step uses
  `data.has('airAssist')` (`wizard-recipe.ts:51`), and the details step applies only rendered
  controls (`:56-59`).
- **A `.clb` import overwrites a saved library with the same file name.** `resolveImportedLibrary`
  reuses an identical payload or takes a suffixed id. It never replaces.

## Verified clean
- **Ruida `.rd` encoding** (question 4) matches meerk40t `rdjob.py` @ `7e82652f` exactly:
  - `swizzle_byte`/`unswizzle_byte` with magic 0x88 (`:434-451` against `swizzle.ts:10-27`);
  - power `encode14(power * 16383 / 100)`, where KerfDesk rounds and meerk40t truncates, as ADR-394
    records;
  - speed in µm/s (`encode32(speed * 1000)` against `mmPerMinToUmPerSec`);
  - 35-bit µm coordinates with two's complement.
  Passes repeat per pass (`rd-motion-plan.ts:41-44`), and Fill/Image layers are refused with a
  message. KerfDesk only writes `.rd`; it never reads one.
- **`.lbrn` units** against real files: speed is mm/s in the file (`13.3333` = 800 mm/min,
  `116.667` = 7000 mm/min, UV `1000` mm/s), opened ×60. Power is percent (0–100), passes are
  integers, and the interval is mm.
- **Placement and size:** the ADR-388 frame (MirrorX/MirrorY corners, group and Text BackupPath
  XForms, rounded `Rect`, `LineClosed`) is covered by coordinate-asserting tests
  (`lbrn-frame.test.ts:13-84`). The four real 1.6/1.7 projects opened with correct object counts and
  their Bitmaps named.
- **Output switches:** `doOutput 0` and `hide 1` give Output off (real `rear-plate` "Letters
  uitensijden", DCP C02). Tool layers T1/T2 also open with Output off.
- **Other mappings:** `Scan+Cut` gives a Fill then a Line in `.lbrn`. Kerf range is checked.
  Overscan % × mm/s is converted with the cap. Tabs, Min Power, Constant Power, Fill Grouping and
  unknown fields are named.
- **XML hardening:** `<!DOCTYPE`/`<!ENTITY` are refused on all three `.lbrn`/`.clb` routes:
  - main thread (`lbrn-import.ts:59`, `clb-import.ts:35`);
  - worker text (`document-import-parse.ts`, plus `isWellFormedXml`);
  - streamed worker (`forbidActiveDeclarations: true`, `document-import-source.ts:131`).
  Depth is bounded at 64.
- **`.lbdev` JSON keys** (`S_Scale`, `MirrorX`/`MirrorY`, `AirAssistM7`, `BaudRate`,
  `EnableGrblJCommand`, `Width`/`Height`, `DeviceList[0]`) match six public device files.
  - xTool D1 Pro has `MirrorY true` and maps to rear-left.
  - A Marlin file (`fablab-nea/LaserKutter`) and other non-GRBL drivers stay review-only.
  - Width, height or S of 0 or below are refused or reported as "Not detected".
- **`.clb` mapping:** thickness in mm; `Thickness -1` or `0` with `NoThickTitle` becomes a titled
  entry; mm/s ×60; `runBlower` maps to air.
- **`.lfmachine.json`:** positivity checks for bed, feeds, max S, acceleration and framing feed
  (`machine-profile-shape.ts:193-205`, `profile-catalog.ts:246-280`). Positioning-light commands
  are vetted on import; scan offsets are imported as pending.
- **`.lfml.json`:** duplicate-id rejection, recipe validation (power 0–100, positive speed and
  passes), deterministic merge, and import never replacing a saved library.

## Not verified
- **LightBurn behaviour itself.** Nothing was run in LightBurn. The meanings of `suboutput`
  (P2-2) and of `overscan` absent with `overscanPercent` present (the importer's "could not be
  converted" warning, and P3-8) are inferred from real files and the docs. The default state of
  LightBurn's Overscanning switch was not found in a primary source.
- **Scan angle sign and 180°.** LightBurn's docs give 0/90/180 behaviour but no rotation sense.
  KerfDesk rotates in its Y-down scene, and `normalizedHatchAngleDeg` folds 180° onto 0°, which
  LightBurn describes as top-to-bottom. Whether imported 45° fills run "/" or "\" relative to
  LightBurn is unconfirmed.
- **The worker's streamed XML DOM** (`readXmlDocumentFromBlob`) and `linkedom` were not run for
  P2-1/P2-2. The repros used the main-thread jsdom `DOMParser`. The descendant search is the same
  code on every route.
- **Out of depth:** process-recipe templates (CNC tool remapping, path steps) beyond the injection
  check, and `material-experiment-io.ts`.
- **Rendering and hardware.** No rendered comparison against LightBurn thumbnails beyond the
  existing tests. No Ruida controller. No hardware.

```json
[
  {"id":"P1-1","severity":"P1","area":"lb-material-importers","file":"src/ui/layers/MaterialLibraryPanel.tsx","line":85,"anchor":"Twin: createLibrary uniqueLibraryId (saved-libraries-actions.ts:198) and resolveImportedLibrary 'never replaces a saved library' (material-library-import.ts:8); Contract ADR-093 auto-save","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Starter Presets writes the fixed id laserforge-<profile>-starter over an existing, edited starter library via setMaterialLibrary + persistence reconcile; the operator's own presets vanish from the app and localStorage with no prompt (Neotronics profile, after the open library is deleted)"},
  {"id":"P2-1","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":374,"anchor":"Ground truth: real LightBurn 1.6.03/1.7.08 .lbrn2 files nest <SubLayer> inside <CutSetting> and omit default main fields; LightBurn docs Sub-Layers; Twin: clb-import reads direct children only","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"textField searches descendants, so a sub-layer's numPasses/kerf/interval/angle become the main layer's when the main omits them: main 1 pass becomes 4 passes with a 0.3 mm kerf; report says only 'SubLayer settings were not imported'"},
  {"id":"P2-2","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":331,"anchor":"Ground truth: LightBurn docs Sub-Layers 'Toggle the Output switch … whether a given Sub-Layer is included'; real DCP_BUTTONS.lbrn2 main CutSetting suboutput 0; ADR-388 d9/d10","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A main tab switched off in LightBurn (suboutput 0) is burned at its settings while the enabled sub-layer is dropped; suboutput 0 counts as 'off' so the report never names it (real file: 15% main burned instead of 10% GOOD FINAL)"},
  {"id":"P2-3","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/clb-import.ts","line":271,"anchor":"Twin: ADR-388 d7 / lbrn-import.ts:276 reads type as a whole name, Scan+Cut = Fill then Line, unknown types named","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":".clb Scan+Cut entry imports as a Fill-only preset (outline never cut) with no warning and no unsupported count; other unknown types silently become line"},
  {"id":"P3-1","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbdev-import.ts","line":145,"anchor":"Ground truth: LightBurn GRBL configuration 'GRBL 1.1e or older … must use the GRBL-M3 device'; Twin: gcode-dialects.ts:109-114 grbl-compatible mirrors GRBL-M3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A GRBL-M3 .lbdev becomes a grbl-dynamic (M4) profile while the review says 'Mapped as GRBL-compatible'"},
  {"id":"P3-2","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbdev-import.ts","line":170,"anchor":"Contract: ADR-398 decision 5 'Anything else is listed for review'; L7 lbdev-import.test.ts:132 asserts needsReview ['Jogging'] only","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"HomeOnStartup, Type TCP, rotaryMode and other keys are dropped unmentioned; real Creality Falcon file (HomeOnStartup true) imports with homing disabled so jobs default to User Origin"},
  {"id":"P3-3","severity":"P3","area":"lb-material-importers","file":"src/ui/app/material-library-file-actions.ts","line":116,"anchor":"Twin: ADR-388 d10-d12 name every setting left behind and keep the report; toast says 'were reported' but nothing shows them","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":".clb import shows only a count of unsupported fields/warnings; names never displayed, and bookkeeping fields (index, name, LinkPath) inflate the count on every real library"},
  {"id":"P3-4","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":351,"anchor":"Twin: ADR-388 d6 kerf outside the field range is named; interval field range 0.05-10 mm (CutSettingsFillDensityFields.tsx:19); fill-hatching.ts:45 clamps to 0.05","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"LightBurn interval 0.04 mm (real uv70 file) imports as 0.04 but fills at 0.05 mm (200 rows instead of 250 over 10 mm) with no import note"},
  {"id":"P3-5","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":333,"anchor":"Twin: unreadable kerf is named (ADR-388 d6 'Nothing is dropped without a line in the report')","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Speed 0/negative becomes 1 mm/min, unreadable power/speed fall back to 30%/1500 mm/min, .clb interval 0 becomes 0.001 mm / 1000 lines/mm, all without a report line"},
  {"id":"P3-6","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbdev-device.ts","line":145,"anchor":"Twin: lbrn/clb finiteNumber uses Number()","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Legacy XML .lbdev Width '1e3' gives a 1 mm bed, '4,000' gives 4 mm, SMax '1.5e3' gives max S 1.5 (shown under Applied)"},
  {"id":"P3-7","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbdev-import.ts","line":265,"anchor":"METHOD L5 resource exhaustion; extends July 2026-07-17 lightburn-importers P3-3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"extractFirst lazy regex is quadratic on unclosed tags (14 KiB 17 ms, 55 KiB 246 ms; about a minute at 1 MB extrapolated) and runs on the main thread"},
  {"id":"P3-8","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/clb-import.ts","line":14,"anchor":"Twin: lbrn-import.ts:319 keeps 5 mm default for the same absent fields; forum: LightBurn overscan default 2.5%","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":".clb Scan entry with no overscan fields gets a 0 mm runway while the same setting from a .lbrn keeps 5 mm"},
  {"id":"K-1","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":102,"anchor":"see 13-P2-1; PR #1352","evidence":"READ","verdict":"KNOWN","known":true,"summary":".lbrn over 10,000 shapes opens but cannot be saved"},
  {"id":"K-2","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/lbrn-import.ts","line":333,"anchor":"see 06-P2-4","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"LightBurn mm/s speeds become fractional mm/min (799.998) that Cut Settings step validation refuses"},
  {"id":"K-3","severity":"P1","area":"lb-material-importers","file":"src/io/machine-profile/machine-profile-shape.ts","line":222,"anchor":"see 13-P1-1; PR #1352","evidence":"READ","verdict":"KNOWN","known":true,"summary":".lfmachine.json autofocusCommand accepted as any string, same Auto-focus sink as 13-P1-1"},
  {"id":"K-4","severity":"P2","area":"lb-material-importers","file":"src/io/lightburn/clb-import.ts","line":97,"anchor":"see 2026-07-17 F18 / BQ-7 / LBG-I05","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":".clb drops kerf, tabs, dither mode; imported presets default to 'starter' confidence"},
  {"id":"K-5","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbrn-geometry.ts","line":124,"anchor":"see LBG-F17","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":".lbrn Bitmaps, outline-less Text and CutSetting_Img not imported (named in report)"},
  {"id":"K-6","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbrn-setting-report.ts","line":152,"anchor":"see LBG-C06","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"LightBurn anglePerPass not mapped to passAngleStepDeg (named in report)"},
  {"id":"K-7","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbrn-frame.ts","line":88,"anchor":"see July 2026-07-17 lightburn-importers P3-4","evidence":"READ","verdict":"KNOWN","known":true,"summary":"transformCurve treats non-cubic segments as lines without assertNever (unreachable)"}
]
```
