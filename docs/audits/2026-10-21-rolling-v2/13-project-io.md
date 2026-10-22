# Rolling audit v2 — Project I/O

- **When:** 2026-10-21 17:25 +0800   **Tree:** origin/main @ `2c8d988db` (worktree HEAD
  `e9b06331b`, audit docs only; no audited file changed up to `c708073a7`, the newest
  `origin/main` at the time of writing)
- **Scope:**
  - `src/io/project/**` (deserialize, validators, normalizers, migrations, serializer, seal tail,
    templates, persistence and autosave preparation) and `src/io/json/**` (streamed parser).
  - Autosave and recovery: `src/ui/state/autosave*.ts`, `src/ui/app/use-autosave*.ts`,
    `autosave-file-cleanup.ts`, `AutosaveRecoveryControl.tsx`.
  - Recent Projects and local snapshots: `src/ui/recent-projects/**`.
  - Templates: `src/io/project/project-template.ts`, `src/ui/app/project-template-actions.ts`.
  - Callers read where a finding depends on them: `project-open-parser.ts`,
    `project-open-completion.ts`, `file-actions.ts`, `project-save-action.ts`,
    `prepare-project-save.ts`, `large-project-save.ts`, `salvage-export.ts`,
    `document-import-source.ts`, `io/lightburn/lbrn-import.ts`, `ui/state/project-actions.ts`,
    `project-bed-reconciliation.ts`, `autofocus-action.ts`, `laser-autofocus-actions.ts`,
    `object-insert-actions.ts`, `use-text-dialog-fields.ts`, `guide-actions.ts`,
    `core/scene/selection-transform.ts`, `platform/web/web-adapter.ts` (save writer only).

  Governing documents:
  - ADR-292 and Amendments 1–5, ADR-305 (atomic IndexedDB autosave), ADR-317 (v5 overrides),
    ADR-318 (v6 tile registration), ADR-319 (v7), the schema comments for v8–v18 in
    `core/scene/project.ts`, ADR-204 (Save never silently rewrites), ADR-307 Amendment 1 (one
    project limit), ADR-378 (Recent Projects), ADR-550 (save back to the opened file), ADR-626,
    ADR-628 (system fonts), ADR-649 (no schema bump for a new dither).
  - PROJECT.md "Current project format" and "Data model".

  Prior audits read: `rolling/2026-07-17-0550-project-persistence.md` (its P2-1, P3-2 and P3-3
  are fixed on this tree), `2026-10-06-settings-sync/REPAIRS.md`, and reports 01–12 of this run.
- **Lenses run:** L4 (mutation fuzz, hostile-node sweep, parser differential), L3 (validator vs
  serializer vs creating actions), L5 (untrusted `.lf2` fields that reach the controller), L6
  (save refusal, autosave failure, crafted-file errors), L1 (ADR-305, ADR-307 Am. 1, ADR-628,
  PROJECT.md migration claim), L7 (which of these paths have tests). L2 was used only for the
  web save writer's atomicity (File System Access `createWritable`).
- **Counts:** 8 raised → 8 confirmed, 0 plausible, 0 refuted → P1 1 / P2 2 / P3 5 (+ 3 KNOWN
  re-encountered, not re-raised). No severity changes. The refuter reproduced every finding with
  its own code (repros kept in the scratchpad under `area13-refuter\`). P1-1 was reproduced end to end
  through File > Open, the Auto-focus button and the GRBL simulator.

## Headline

Round-trip fidelity and parser robustness are strong: every real and constructed project in the
corpus reopens byte-identically after Save, 20,000 random mutations and 21,723 hostile node
replacements produced no silent drift, and the streamed JSON parser matches `JSON.parse`
exactly. The weak spot is the opposite edge: **limits that only the loader knows.**

1. **A project file's `device.autofocusCommand` is trusted.** It loads with only a string check
   and the Auto-focus button sends it verbatim. A shared `.lf2` can therefore make Auto-focus
   burn a line, move the head, or rewrite `$32`. The same file's positioning-light commands are
   refused on load when they could fire the laser (P1-1).
2. **Two ordinary paths build a project that Save and autosave both refuse.** A LightBurn project
   with more than 10,000 shapes opens but can never be saved (P2-1). Every font import or System
   fonts choice embeds a new copy that is never pruned, so the 33rd makes the project
   unsaveable (P2-2). In both cases the salvage prompt blames "machine or output settings".

## Findings

### P1-1 — A `.lf2` carries an Auto-focus command that is sent verbatim; the file's positioning-light commands are vetted, this one is not
- **Where:**
  - `src/io/project/project-shape-validator.ts:124` — `requireString(device, 'device.autofocusCommand')` is the only check.
  - `src/io/project/deserialize-project.ts:315-317` — `normalizeDevice` keeps every other device field (`...current`).
  - `src/ui/state/project-actions.ts:64-80` and `src/ui/app/use-machine-profile-persistence.ts:15-17` — Open installs the document's device ("Opening/recovering a file applies that document's hardware").
  - `src/ui/laser/JobSetupControls.tsx:147-156` — Auto-focus reads `s.project.device.autofocusCommand`.
  - `src/ui/state/laser-autofocus-actions.ts:77-78` — applies the Console policy, but only refuses when it says `!ok`; a `requiresConfirmation` setting write passes unconfirmed.
  - `src/ui/state/autofocus-action.ts:60` — sends `${command}\n`; the preflight (`:75-100`) checks only one line, printable ASCII and `!~?`.
- **Anchor:**
  - Twin: on the same load path, `deserialize-project.ts:357-361` runs `normalizePositioningLight`, which drops a light whose on/off command fires the laser or changes machine state (`core/devices/positioning-light.ts:202-208, 232-242`; commit `c5f194b32` "refuse laser-firing and state-changing LED commands").
  - Twin: the Console asks before a `$n=` write (`core/controllers/grbl/console-command.ts`, `setting-write` → `requiresConfirmation: true`). The Auto-focus path skips that question.
  - Contract: PROJECT.md non-negotiable 21 / ADR-565 — burns happen after Frame and Start review. An Auto-focus line burns with neither.
  - Same trust model as KNOWN 03-P1-1 (a crafted `.lf2` yields an executable line).
- **Scenario:**
  1. Someone shares `sign.lf2` whose device has `"autofocusCommand": "G1 X300 Y10 F100 S1000 M3"`.
  2. The operator opens it. The device is installed; any machine-change notice is non-blocking.
  3. The operator presses **Auto-focus**, as Falcon owners do before every job. KerfDesk writes `G1 X300 Y10 F100 S1000 M3` and reports success. On GRBL this burns a full-power line to X300.
  - Other payloads that pass every check:
    - `G0 X400 Y400` moves the head with no limit check.
    - `$32=0` turns laser mode off for good, with no confirmation.
    - `M3 S1000` fires a stationary beam where `$32=0`.
  - The installed device becomes the remembered last machine after the next machine edit, so the command outlives the file.
- **Evidence:** REPRO — `src/ui/state/zz-13-autofocus-from-file.test.ts` (copy in the scratchpad, see the end). The test serialises a project with the payload, runs `deserializeProject`, then runs `runAutofocus` with a capture writer.
  - `loaded autofocusCommand = "G1 X300 Y10 F100 S1000 M3"`
  - `positioning light with M3 S1000 on load = undefined` (the twin refuses)
  - `written to controller = ["G1 X300 Y10 F100 S1000 M3\n"] result = ok`
  - `prepareConsoleCommand`: `$32=0 => ok kind=setting-write requiresConfirmation=true`; `G0 X400 Y400 => ok kind=gcode`
- **Refuter:** CONFIRMED, stays P1. Reproduced end to end with no auditor code: real File > Open (`openProjectCommand`), the real `JobSetupControls` Auto-focus button, the real laser store and `safeWrite`, and the GRBL simulator.
  - The file reused the victim's profile identity (`profileId|name|bed`, `project-bed-reconciliation.ts:55-57`), so no machine banner showed. The button changed from "Set up auto-focus" to "Auto-focus", and its tooltip does not show the command.
  - One press wrote `G1 X300 Y10 F100 S1000 M3\n`; the simulator ended at X300 Y10 with S1000 in laser mode (`$32=1`), with no error. `$32=0` was written and the simulator's `$32` became 0 with no confirmation. `G0 X400 Y400` moved the head.
  - Guards checked, none applies: ADR-500 Amendment 1 §2 has Open use the document's machine by design (and send no command itself); `safeWrite` blocks `$` lines only during a job; Auto-focus applies `prepareConsoleCommand` but not the Console's `consoleSettingWriteBlockReason` or `requiresConfirmation` (`laser-console-actions.ts:100-107`), so a Falcon's ADR-370 allowlist ($150–$152 only) is bypassed too.
  - Twin holds with one caveat: positioning-light commands are vetted everywhere, while Auto-focus is free text by design (`AutofocusEditor.tsx`), so the fix must keep operator-typed macros working.
  - Distinct from 03-P1-1, not a duplicate: different field (`device.autofocusCommand`, not layer id/colour), sink (interactive command, not streamed comment lines) and fix (vet on load or confirm at dispatch, not comment sanitising). Same trust model.
  - P1, not P2: the press is routine for Falcon owners, and an XY move plus a full-power burn is not what Auto-focus does, so the burn is unexpected. 03-P1-1 also needs one press (Start).
- **Fix direction:**
  - Validate `autofocusCommand` on load the way positioning-light commands are. Keep documented focus macros (`$HZ1`, `$H`-family, probe or macro words). Drop lines with motion words, `S>0`, `M3/M4/M106`, or `$n=` writes, and add a recovery note.
  - Also honour `requiresConfirmation` on the Auto-focus path.

### P2-1 — A LightBurn project with more than 10,000 shapes opens, but can never be saved or autosaved
- **Where:**
  - `src/io/lightburn/lbrn-import.ts:102-121` — every `<Shape>`, groups flattened, becomes one object, with no budget check.
  - `src/ui/app/project-open-completion.ts:65-79` → `setProject`; marked dirty as `<name>.lf2`.
  - `src/io/project/project-scene-integrity-validator.ts:47-52` — Save and autosave run `deserializeProject` and refuse more than 10,000 objects.
  - `src/ui/app/project-save-action.ts:158-161` — the salvage prompt.
- **Anchor:**
  - Twin and contract: ADR-307 Amendment 1 holds "every other command that adds objects in one step" to the loader's limits. It calls a project the loader refuses "lost work" (`scene-copy-room.ts:1-9`, `refuseSceneLimitOverrun`). The same holds for imports (`object-insert-actions.ts:244`), AI artwork (`ai-artwork.ts:59`) and My artwork (`personal-artwork-model.ts:138`). The whole-project LightBurn open is the one path without the check.
  - Contract: ADR-305 decision 7 (autosave failure must be truthful).
- **Scenario:** Open a LightBurn file with 10,001 or more shapes (a sheet of tags, a halftone, nested parts).
  - The toast says `Imported … 10001 objects … Save as .lf2 to keep changes.`
  - The 30 s autosave fails with "image-heavy projects can exceed browser storage", which names the wrong cause.
  - Save fails with ``invalid `scene.objects`: count 10001 exceeds 10000``.
  - The salvage confirm says the project "cannot be saved as-is without changing its machine or output settings". The raw copy it writes is then refused on reopen for the same count.
  - All edits made after the import are unsaveable until the operator deletes objects.
- **Evidence:** REPRO — `src/io/project/zz-13-lbrn-limit.test.ts`, which imports a 10,001-Rect `.lbrn2` through `importLightBurnProject`.
  - `objects 10001 layers 1`
  - ``save invalid invalid `scene.objects`: count 10001 exceeds 10000``
  - ``autosave invalid invalid `scene.objects`: count 10001 exceeds 10000``
- **Refuter:** CONFIRMED, P2. Reproduced through the real File > Open (`openProjectCommand` → `completeLightBurnProjectOpen` → store) with Ellipse shapes, flat and inside one Group:
  - 10,000 shapes: toast "Imported tags.lbrn2: 10000 objects", Save and autosave preparation both `ok`.
  - 10,001 shapes, flat or grouped (the group is flattened, `groups=0`): toast "… 10001 objects … Save as .lf2 to keep changes."; Save and autosave both ``invalid `scene.objects`: count 10001 exceeds 10000``.
  - Neither `importLightBurnProjectDocument` nor the open completion checks the budget. `validateSceneBudgets` has one non-loader caller (`ai-artwork.ts:59`); the other one-step adders use `refuseSceneLimitOverrun`. ADR-307 Amendment 1 calls a project the loader refuses "lost work".
  - The salvage prompt does admit its raw copy "may need repair before it reopens cleanly", but it still names the wrong cause.
- **Fix direction:**
  - Check `validateSceneBudgets` on the imported project before `setProject`. Refuse with a reason that names the count, or offer to import the groups as grouped objects.
  - Make the salvage prompt quote the actual refusal instead of "machine or output settings".

### P2-2 — Each font Import or System fonts choice embeds a new copy that is never pruned; the 33rd makes the project unsaveable
- **Where:**
  - `src/ui/text/use-text-dialog-fields.ts:229` — every import gets a fresh `embedded:${crypto.randomUUID()}` key, even for a font already embedded.
  - `src/ui/state/object-insert-actions.ts:270-281` (`applyTextAndEmbeddedFont`) — appends the font with no count check. No code removes an embedded font that no text uses.
  - `src/core/text/embedded-font.ts:17` — checks only the 10 MB size.
  - `src/io/project/project-embedded-font-validator.ts:9-11` — refuses more than 32 fonts on load, so Save and autosave refuse too.
- **Anchor:**
  - Contract: ADR-628 item 2 — a chosen face "goes through … the 10 MB per font and 32 fonts per project limits".
  - Twin: Studio documents run their validator at insert (`studio-document-actions.ts:48`), so their cap can never strand a project. Fonts do not.
- **Scenario:** An operator tries faces for one sign: edit the text, choose a System font, OK, and repeat.
  - Every try leaves its font in the project.
  - On the 33rd, Save fails with "invalid embeddedFonts: expected at most 32 fonts" and autosave fails silently after one warning.
  - Undo can remove only the latest font. Fonts from texts since deleted stay too, and no UI removes them.
  - Each copy can be up to 10 MB, so every save also carries the unused fonts.
- **Evidence:** REPRO — `src/ui/state/zz-13-font-limit.test.ts` runs the real store, calling `upsertTextObject` 33 times on the same text, each with a new font.
  - `objects 1 embedded fonts 33`
  - `save invalid invalid embeddedFonts: expected at most 32 fonts`
  - The autosave result is the same.
- **Refuter:** CONFIRMED, P2 (a broken ADR-628 contract with a clear failure). ADR-628 item 2 says a chosen face "goes through … the 32 fonts per project limits", but nothing on the insert path counts fonts. `applyTextAndEmbeddedFont` deduplicates by key only, and `useImportedFont` makes a fresh UUID key each time. No code prunes unused fonts.
  - Independent repro: one real font (`LiberationSans-Regular.ttf`) was encoded exactly as `useImportedFont` does and applied to one text 33 times with `upsertTextObject`.
  - After 32 imports: 32 fonts, 1 distinct byte string, Save `ok`. After 33: Save fails with `invalid embeddedFonts: expected at most 32 fonts`.
  - After `removeSceneObject` deleted the only text: 0 objects, still 33 fonts, autosave invalid.
  - Re-choosing the same face therefore counts again. Choosing several faces inside one dialog keeps only the last one, so a project needs 33 confirmed choices to fail.
- **Fix direction:**
  - Reuse an existing embedded font when the bytes match (hash), and prune embedded fonts that no text or archive references when the text is committed (and at Save).
  - Refuse a 33rd distinct font in the dialog, before it is embedded.

### P3-1 — Numeric X/Y and W/H edits have no ceiling, but the loader refuses |x| > 1,000,000 mm and |scale| > 100,000
- **Where:**
  - `src/core/scene/selection-transform.ts:143-190` (`positionSelection`, `resizeSelection`) and `src/ui/state/selection-transform-actions.ts:328-356` accept any finite value.
  - `src/io/project/project-shape-primitives.ts:2,4` sets the limits that Save and autosave enforce.
- **Anchor:** Twin — validator against the editing actions. ADR-307 Amendment 1's principle is to refuse at the command, not at Save.
- **Scenario:**
  - Typing X = 2,000,000 (a slip of zeros), or giving a 0.002 mm import a width of 300 mm (scale 150,000), leaves a project whose Save fails.
  - The message, ``missing or invalid `scene.objects[0].transform.x``` (or `.scaleX`), is followed by the "machine or output settings" salvage prompt. Undo recovers.
- **Evidence:** REPRO — `src/ui/state/zz-13-transform-limit.test.ts`:
  - `transform {"x":2000000,…}` → ``save invalid missing or invalid `scene.objects[0].transform.x` ``
  - `scaleX":150000` → ``…transform.scaleX` ``
- **Refuter:** CONFIRMED, P3. Independent repro: `buildSelectionTransformEdit` on a 10 mm box (whose Save is `ok`).
  - Position X = 2,000,000 → ``invalid `scene.objects[0].transform.x` ``.
  - Width 1,500,000 → scaleX 150,000 → ``… .transform.scaleX` ``.
  - `positionSelection` and `resizeSelection` check finiteness only. Undo recovers, so it stays P3.
- **Fix direction:** Have `buildSelectionTransformEdit` return an error (with a message) when the result would leave the persisted coordinate or scale range.

### P3-2 — Save reports success but drops every ruler guide after the 200th
- **Where:**
  - `src/core/scene/guides.ts:14-22` — `normalizeGuides` stops at `MAX_GUIDES` (200).
  - `src/ui/workspace/guide-drag.ts:60` — creating guides has no cap.
  - `src/io/project/persistence-semantic-integrity.ts:16-38` — `guides` is not among the fields the ADR-204 drift check compares.
- **Anchor:** Contract — ADR-204 and `prepare-project-persistence.ts:11-13`: Save must not silently rewrite the document. Twin — the limit applies only on load.
- **Scenario:**
  - A layout with 250 guides saves "successfully". The live session still shows 250; the reopened file has 200.
  - KNOWN 08-P2-1 (a plain ruler click leaves a hidden stray guide) makes counts above 200 easier to reach.
  - Guides never affect output.
- **Evidence:** REPRO — `src/io/project/zz-13-guides.test.ts`: `save ok`, `live guides 250 reopened guides 200`.
- **Refuter:** CONFIRMED, P3. Independent repro: 250 guides gave `prepareProjectForPersistence` `ok`, and the reopened file had 200 guides.
  - `MAX_GUIDES` is used only in `normalizeGuides`. `setGuidesDuringInteraction` has no cap.
  - `guides` is absent from `persistedSemantics`.
- **Fix direction:** Cap guide creation at `MAX_GUIDES` with a notice, or add `guides` to the drift check so Save says why.

### P3-3 — Legacy v1/v2 files with 256 or more artworks carrying their own settings can no longer be opened
- **Where:** `src/io/project/migrate-v2-operation-bindings.ts:94-135` (`migrateObjectOverrides`) clones one new operation per artwork that has an `operationOverride`, even when the overrides are identical. `project-scene-integrity-validator.ts:47` then refuses more than 256 operations.
- **Anchor:** Contract — PROJECT.md "Current project format": the migrations "preserve existing operation identities, settings and geometry", and older files open through the migration chain.
- **Scenario:** A v1 or v2 project in which 256 or more artworks have a per-artwork override opens on the build that wrote it. On this build it fails with ``invalid `scene.layers`: count 257 exceeds 256``.
- **Evidence:** REPRO — `src/io/project/zz-13-v2-overrides.test.ts`, using `e2e/fixtures/project-basic.lf2` (v1) with N copies of its artwork, each with `operationOverride: {power: 50}`:
  - `255 ok layers 256`
  - ``256 invalid … count 257 exceeds 256``
  - ``300 invalid … count 301 exceeds 256``
- **Refuter:** CONFIRMED, P3 (rare; legacy files only). Independent repro on `e2e/fixtures/project-basic.lf2` (v1): 255 artworks with `operationOverride: {power: 50}` → `ok`, 256 layers; 256 artworks → ``invalid `scene.layers`: count 257 exceeds 256``. `migrateObjectOverrides` clones one operation per artwork and never shares identical clones.
- **Fix direction:** In the migration, share one cloned operation between artworks whose source operation and override are equal. If the result still exceeds 256, say so as a migration message.

### P3-4 — Every autosave commit and clear JSON-parses both stored snapshots in full on the window thread, only to read `schemaVersion`
- **Where:**
  - `src/ui/state/autosave-indexeddb-mutations.ts:18-29` (`requireSupportedAutosaveSnapshots`), called from `replaceAutosaveSnapshot` (`:37`) and `clearAutosaveManifest` (`:67`).
  - It calls `src/ui/state/autosave-record.ts:121-138`, whose `JSON.parse(json)` parses the whole project.
- **Anchor:**
  - Twin: the autosave design moves whole-string work off the 30 s tick (`prepare-project-autosave.ts:1-20`: "Paying for a second full serialization … on a 30-second timer therefore buys nothing"; `autosave-loop.ts` memo; off-thread preparation).
  - `hasUnsupportedAutosaveEnvelope` already reads only the envelope.
  - ADR-305 decision 2.
- **Scenario:** While a large image project is edited, each 30 s commit reads both stored snapshots out of IndexedDB and parses them on the UI thread. Open and Save handoff clears do the same. With two 200 MB snapshots that is about 400 MB of JSON parsed per tick.
- **Evidence:** REPRO — `src/ui/state/zz-13-autosave-parse-cost.test.ts`, fake IndexedDB, 40 MiB snapshots: `third commit: JSON.parse calls 2, chars parsed 80.0 MiB, 1090 ms` (the time includes fake-IDB cloning).
- **Refuter:** CONFIRMED, P3 (performance; no data effect). Independent repro: `requireSupportedAutosaveVersion` on a current-version snapshot of a 5,002,142-character project made 1 `JSON.parse` call over all 5,002,142 characters. The early return for `PROJECT_SCHEMA_VERSION` comes only after that parse (`autosave-record.ts:127-133`). Both mutators call it for `current` and `previous` (`autosave-indexeddb-mutations.ts:22-28`).
- **Fix direction:** Store the project `schemaVersion` beside `projectJson` in the snapshot record, or scan only the leading characters for it. Run the full migration probe only when the stored version differs.

### P3-5 — A deeply nested crafted `.lf2` throws out of `deserializeProjectValue`, or opens and then cannot be saved
- **Where:** `src/io/project/deserialize-project.ts:101` — `validateProjectShape` runs outside the `try` that guards `normalizeProject` (`:105-112`), and some validators recurse into file-shaped values. Unvalidated device fields are kept as-is (`:315-317`), and `JSON.stringify` overflows on them.
- **Anchor:** Contract — `DeserializeResult` promises "a typed Project, or a structured error" (`:4-5`, `:56-60`).
- **Scenario:**
  - Replacing `scene.objects[0].reliefAuthoring.components[0].source.sections[1].id` with a 20,000-deep array makes Open throw `RangeError: Maximum call stack size exceeded`. The UI catches this as "Could not open …".
  - The same depth under `device.evidence[0].note` opens, but Save fails with "Maximum call stack size exceeded". Crafted files only.
- **Evidence:** REPRO — `src/io/project/zz-13-sweep.test.ts`, 21,723 hostile replacements over the corpus. These are the only two problems:
  - `THROW open: RangeError: Maximum call stack size exceeded`
  - `SAVE-REFUSED Maximum call stack size exceeded`
- **Refuter:** CONFIRMED, P3. Independent repro: a 20,000-deep array at an unvalidated device key opened `ok` (it survives through `...current`), then Save preparation returned `invalid Maximum call stack size exceeded`.
  - The open-time throw was confirmed from source only: `validateProjectShape` runs at `deserialize-project.ts:101`, before the `try` at `:104`.
  - Crafted files only, and the UI's catch turns the throw into "Could not open".
- **Fix direction:** Wrap validation in the same `try` and return `invalid`. Optionally bound nesting depth in the streamed and native parse paths.

## Known (re-encountered, not re-raised)
- **03-P1-1:** layer `id`/`color` pass with `requireString` only (`project-layer-shape-validator.ts:37-39`).
  Note also that the colour-uniqueness check is case-sensitive (`project-scene-integrity-validator.ts:106-114`) while `nextOperationColor` compares lower-case.
- **10-P3-4:** cut extras have no minimum on load (`project-cut-extras-validator.ts:21-22`).
- **12-P2-1 (now P3):** Open installs the document's device wholesale. P1-1 is a different field with a different consequence, on the same mechanism.

## Refuted
None. The refuter confirmed all eight findings.

Refuter-side checks that did not refute:
- **P1-1 duplicates 03-P1-1 or 12-P2-1.** No. It shares their trust model (03) and mechanism (12), but has its own field, sink and fix.
- **ADR-500 Amendment 1 §2 makes P1-1 by design.** No. The ADR makes installing the document's machine by design, but it says restoration sends no controller command. The finding is the unvetted command a later press sends.
- **The machine banner warns the operator.** Not when the file copies the operator's `profileId`, name and bed size: no banner was shown in the repro.

Auditor-side candidates dropped before raising:
- **Streamed and native parsers disagree.** They do not (see Verified clean).
- **Pollution through file keys.** None: no `Object.assign` or file-keyed assignment in `io/project`, and the assembler uses `defineProperty`.
- **Recovery offers only the newest slot, so older crashes are lost.** No: the older slot stays and is offered after the newer one is restored or discarded.
- **The web Save is non-atomic.** No: `createWritable` writes a swap file; see below.
- **The `useSelectionOrigin` normalisation drops a live value.** No: the store applies the same rule (`project-job-setup.ts:59-66`).

## Verified clean
- **Round trip.** For 5 parent-saved v15 fixtures (`src/__fixtures__/*.lf2.gz`, including the 1.7 MB clipped import), 9 v1 fixtures (`e2e/fixtures`, `docs/audits/fixtures/vector`), and 5 constructed projects (mixed canvas, rotary raster, CNC flowing V-carve, Boolean-compound archives in sheets/manifests/arrays, dense geometry):
  - open → `prepareProjectForPersistence` is accepted;
  - serialize → reopen → serialize is byte-identical.
  - This covers migration v1→v18 and v15→v18, and resaved older files reopen stable.
- **Mutation fuzz.** 20,000 rounds of two random leaf or structure mutations (numbers to 0, −1, −0, 1e308, ±Infinity, 2^53+2, 1e-9; strings to `__proto__`, `constructor`, CR/LF, Unicode; arrays duplicated, dropped or emptied; keys deleted; own `__proto__` objects added). 5,834 opened.
  - None threw, none failed to reopen, and none was unstable after Save.
  - Autosave and Save preparation agreed on every case.
  - One crafted case was refused at Save: a compound operand moved 1e6 mm.
- **Streamed JSON vs `JSON.parse`.** 4,000 differential cases, chunked 1–7 bytes: BOM, U+2028, lone surrogates, `\u0000`, duplicate keys, `__proto__` and `constructor` keys, ±1e999, −0, and invalid noise.
  - Acceptance and values are identical, and no object's prototype changed.
  - Both the ≥25 MiB worker path and the small path end in the same `deserializeProjectValue`.
- **Validators against types.** Every key in `objectOperationSettingKeys` is validated, including ADR-626 leads and ADR-494 tabs. `CncLayerSettings`, `CncMachineConfig`, the tile registration and the optimization fields are rebuilt field by field with finite guards.
- **The 2026-07-17 findings are fixed.** CNC tool `diameterMm`, `tipAngleDeg` and `kind` (`normalize-cnc-tools.ts`), `numberOrDefault` finiteness, and the v1 empty-polyline phantom point (`migrations.ts:106-111`).
- **Version refusal.**
  - A newer `.lf2` gets "saved with a newer KerfDesk … Update the app" (`project-open-completion.ts:54-58`).
  - A newer autosave is retained with a message, and mutators refuse to overwrite it.
  - Non-integer and ≤0 versions are refused as legacy.
  - ADR-649's "older build refuses an unknown dither" holds for the operation, the image and the artwork overrides.
- **Atomic autosave (ADR-305 decisions 2, 3 and 5).**
  - One read/write transaction covers the manifest and snapshots, with a compare-and-swap epoch and tombstones on clear.
  - Each snapshot's key, session, epoch and save time are checked against the manifest.
  - It falls back to the previous snapshot with a warning.
  - Recovery re-homes the snapshot before clearing its source, and checks that the document is untouched after every await.
  - The tick memo latches only `ok` and `quota`, and the generation releases it after a clear.
- **Web Save atomicity.** `createWritable` → `close()` (`web-adapter.ts:131-169`, `write-save-chunks.ts` aborts on error). Per the WHATWG File System spec, changes are not visible until close. Desktop atomicity was verified by report 04.
- **Recent Projects.**
  - Updates run in one transaction, with replay after transient refusals.
  - Malformed entries are dropped, and a missing or denied file goes to the manager with Choose again or Remove.
  - A desktop path is preferred over a handle.
- **Local snapshots.** Header and project are added atomically, capacity is checked inside the transaction, and snapshots are restored through normal admission.
- **Templates.** Embedded pixels are required, and the same persistence preparation runs as for Save.

## Not verified
- Real browser IndexedDB quota exhaustion, eviction and abrupt process kill. No browser was run here, and ADR-305 itself leaves abrupt-process qualification open.
- Whether abandoned autosave slots accumulate across many unsaved closes until quota is hit. Each slot holds up to two full snapshots; this was not measured.
- Cross-build forward compatibility. Normalizers rebuild `optimization`, `layer.cnc`, `jobSetup` and `machine`, so an older shipped build drops newer optional fields on resave. ADRs 626 and 649 accept "no schema bump"; this was not tested against shipped builds.
- Seal admission and the seal tail (area 02); `.lfart`, sheets and manifest Pro admission.
- Image and font payload decoding (`dataUrl`, `nativeBase64`, `dataBase64` parsed by browser decoders and the font parser); only the size and shape validators were checked.
- Recent Projects and File System Access permission prompts in a real browser; desktop path tokens (04-P3-16 KNOWN).
- `io/machine-profile` also accepts any string `autofocusCommand` (`machine-profile-shape.ts:222`), so P1-1's fix should cover it. That file belongs to area 21 and was not audited here.

Repro files (removed from the tree) are kept in this session's scratchpad:
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\area13-repros\`.
To run one, copy it back to the path named in its finding, then run
`node ../../../node_modules/vitest/vitest.mjs run <path> --silent=false --reporter=verbose` from the worktree. Prefix `NODE_OPTIONS=--no-experimental-webstorage` for the `src/ui/state` tests if `localStorage` fails.

```json
[
  {"id":"P1-1","severity":"P1","area":"project-io","file":"src/io/project/project-shape-validator.ts","line":124,"anchor":"Twin: deserialize-project.ts:357 normalizePositioningLight refuses laser-firing commands; Console setting-write confirmation; Contract: ADR-565 frame-first","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A .lf2 device.autofocusCommand loads with only a string check and Auto-focus sends it verbatim (e.g. G1 X300 Y10 F100 S1000 M3, G0 moves, $32=0 unconfirmed), while the same file's positioning-light commands are vetted"},
  {"id":"P2-1","severity":"P2","area":"project-io","file":"src/io/lightburn/lbrn-import.ts","line":102,"anchor":"Twin/Contract: ADR-307 Amendment 1 and scene-copy-room refuse one-step additions past the loader limits; validateSceneBudgets refuses >10,000 objects","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A LightBurn project with more than 10,000 shapes opens but Save and autosave both refuse it (count 10001 exceeds 10000); the salvage prompt blames machine/output settings and its raw copy will not reopen"},
  {"id":"P2-2","severity":"P2","area":"project-io","file":"src/ui/state/object-insert-actions.ts","line":279,"anchor":"Contract: ADR-628 item 2 (32 fonts per project limit at embedding); Twin: project-embedded-font-validator.ts:9 and studio-document-actions.ts:48 validating at insert","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Every font Import/System fonts choice embeds a fresh uuid copy that is never pruned; the 33rd makes Save and autosave refuse the project (invalid embeddedFonts: expected at most 32)"},
  {"id":"P3-1","severity":"P3","area":"project-io","file":"src/core/scene/selection-transform.ts","line":163,"anchor":"Twin: project-shape-primitives.ts:2,4 loader limits vs unbounded numeric edits","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Numeric X/Y and W/H edits accept |x|>1,000,000 mm or scale>100,000, after which Save refuses the project"},
  {"id":"P3-2","severity":"P3","area":"project-io","file":"src/core/scene/guides.ts","line":22,"anchor":"Contract: ADR-204 Save never silently rewrites; Twin: guide creation uncapped, drift check omits guides","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Save reports success but drops ruler guides past 200 (250 live, 200 after reopen)"},
  {"id":"P3-3","severity":"P3","area":"project-io","file":"src/io/project/migrate-v2-operation-bindings.ts","line":94,"anchor":"Contract: PROJECT.md migrations preserve existing operations; validator caps 256 operations","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Legacy v1/v2 files with >=256 artworks carrying overrides migrate into >256 operations and are refused on open"},
  {"id":"P3-4","severity":"P3","area":"project-io","file":"src/ui/state/autosave-indexeddb-mutations.ts","line":18,"anchor":"Twin: autosave design avoids per-tick whole-string work (prepare-project-autosave.ts, autosave-loop.ts); ADR-305 d2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Each autosave commit/clear JSON.parses both stored snapshots in full on the UI thread only to read schemaVersion (80 MiB parsed for two 40 MiB snapshots)"},
  {"id":"P3-5","severity":"P3","area":"project-io","file":"src/io/project/deserialize-project.ts","line":101,"anchor":"Contract: DeserializeResult structured error; Twin: normalizeProject is inside try, validateProjectShape is not","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A deeply nested crafted .lf2 makes deserializeProjectValue throw RangeError, or opens and then Save fails with Maximum call stack size exceeded"}
]
```
