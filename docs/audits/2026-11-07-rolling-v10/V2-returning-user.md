# Rolling audit v10 — V2 Returning user

- **When:** 2026-11-08, 01:30–02:40 +0800   **Tree:** origin/main @ `5f09e1110` (repros in the scratchpad tree `j10-main`, checked identical to `5f09e1110` for all of `src` with `diff -rq` against a fresh `git archive`).
  - Older code: my own `git archive df2279e26 src public` (1.0.29, schema 21) in `scratchpad\zz-v2\old29`, with a `node_modules` junction. 1.0.28 (`33bc394c6`) and 1.0.27 were covered through the golden files they saved (#1550 and earlier), opened on both 1.0.29 and main. No fresh 1.0.28 save was made.
- **Scope:** a project, autosave, recovery archive or machine document written by 1.0.29 (or 1.0.28/1.0.27), read on main through the real loader and store (`deserializeProject`, `completeNativeProjectOpen`, `setProject`), compiled with `prepareOutputSnapshot` + `emitPreparedGcode` on both builds and diffed byte for byte. Also: re-save field diffs, downgrade, autosave recovery, the recovery archive, machine documents, the large-file reader and the base64 codecs. Governing ADRs: ADR-686, ADR-480 Amd 2, ADR-637 Amd 7, ADR-154 Amd 5, ADR-255 Amd 3, ADR-688, ADR-244 Amd 3, ADR-643, ADR-628 Amd 1.
- **Lenses run:** L11 (all six steps), L9 (routes: File > Open, autosave restore, File > Recover unsaved work's reader, recovery archive; machines: Default laser, CNC). L1 for the ADRs above.
  - Not run: L2, L5, L12 (V1 and the fix areas own them). No hardware. No Vitest and no browser: available memory was 1.06–1.83 GB all session, under the browser gate, so every repro is a Node run of esbuild bundles of each tree's real modules (the V1 refuter's method), jsdom only where SVG parsing needs a DOM.
- **Counts:** 3 raised → refuter pending → P1 0 / P2 2 / P3 1 (+ 0 KNOWN). 4 candidates dropped by the auditor (under Refuted).

## Headline

**The upgrade from 1.0.29 to main changes no burn, no layout and no stored field.** Schema is 21 on both, and `src/io/project`, `src/core/scene`, `src/core/devices` and the emitter (`src/io/gcode`, non-test) are byte-identical between `df2279e26` and `5f09e1110`. Across 38 project files (22 golden files from 1.0.27–1.0.29 and 16 scenes I saved with 1.0.29's own code) and 520 G-code pairs (every object alone, every CSV record, every whole job), main's G-code is byte-identical to 1.0.29's, headers included. Re-saving on main writes the same bytes as re-saving on 1.0.29, every main save opens and burns the same on 1.0.29, 1.0.29 autosaves and recovery archives read back intact, and the large-file reader and both base64 codecs agree with 1.0.29 on real files and 26,000 fuzzed inputs.

What a returning user does not get are two fixes that stop at new work, with nothing on main that tells them:
- **V2-P2-1.** A logo imported on 1.0.29 keeps burning its white shapes. ADR-686 knocks them out only on import, so the U3 logo's white diamond still burns a second time over the solid badge (+960 mm of lit travel, +19.9 % dose; the white-letter plate +1,140 mm). The same SVG imported on main burns 1,920 mm less. Open, Preview and Job Review say nothing.
- **V2-P2-2.** A laser that 1.0.29's first Connect turned into a CNC (stock GRBL, `$32=0`, U8-P2-1) stays a CNC. Its saved machine loads as CNC on main, and Start still sends `M3 S12000` and `G4 P3.000`. ADR-637 Amd 7 changes the Connect fill only.

The update notes on main are still 1.0.29's (`docs/releases/desktop-update-notes.json`, `sinceSourceSha` = 1.0.28), so nothing since 1.0.29 is announced yet. The 1.0.30 notes need a line for each of the two P2s, plus the intended new notices listed in the matrix.

## Matrix

"Same" means byte-identical G-code including headers. Pairs = jobs compiled on both builds (whole job, each object alone, each CSV record).

| Project (saved by) | Pairs | G-code | Re-save on main = re-save on 1.0.29 | Opens and burns the same on 1.0.29 after a main save | Open toasts | Verdict |
|---|---|---|---|---|---|---|
| 1.0.27-text-frames, -via-1.0.28, -edited-on-1.0.28; 1.0.28-fresh-frames; 1.0.29-repaired-frames, -line-rule-frames (golden) | 291 | same | yes | yes | same (1.0.29's frame repair and baseline notices carry over word for word) | Clean |
| 1.0.27/1.0.28/1.0.29-unaffected, 1.0.27-whole-job (+via 1.0.28) (golden) | 76 | same | yes | yes | same | Clean |
| 1.0.27-cnc, 1.0.28-cnc-bowtie-pocket/-absolute/-flat-drill, 1.0.29-cnc-bowtie-pocket/-flat-drill (golden) | 17 | same | yes | yes | same (1.0.29's Job Origin move notice carries over) | Clean |
| 1.0.29-fill-pool, -photo-recipe, -placed-tabs; 1.0.28-studio-older/-newer (golden) | 16 | same | yes | yes | same | Clean |
| b1: plain Roboto, Pacifico, bent 60°, text on a circle, CSV unframed, CSV in a Pacifico shrink frame, CSV bent 45°, CSV on a path (6 records incl. "Ågot", "ffi Office") | 35 | same | yes | yes | same | Clean (6 pairs refused on both: harness artefact, see Refuted) |
| b2: embedded Tinos (TTF) and Source Han Sans JP (4.6 MB CFF/OTF): plain, CSV shrink frames, a wrapping paragraph; a Roboto paragraph that shrinks | 22 | same | yes | yes | same | Clean |
| b2m: the same texts with their fonts missing from the file | 22 | 4 same; 18 refused on both with different wording | yes | yes | **main adds a warning** | V2-P3-1 |
| b3: U3's logo (black badge, white diamond) and a black plate with white letters, imported on 1.0.29 | 5 | same | yes | yes | same (none) | **V2-P2-1** |
| b4: coaster cut (100 %, 2 passes) drawn before a Fill name inside it | 3 | same | yes | yes | same | Clean; main's Job Review adds the cut-last warning (ADR-480 Amd 2, intended, not yet in notes) |
| b5: CNC adaptive pocket; adaptive with a ball nose and with a 9.525 mm bit (both fall back); raster pocket; outside profile with tabs; V-carve | 18 | same | yes | yes | same | Clean; main's Preview adds the fallback notice on the two fallbacks (ADR-154 Amd 5, intended, not yet in notes) |
| b6: 1.0.29 photo recipes as Grayscale + Image Studio adjustments, rotated 30° ×2 Stucki negative, Pass-Through + Dot Width; a 2400 × 1800 px (4.32 MP, streamed rows) Grayscale at 20 lines/mm | 11 | same | yes | yes | same | Clean |
| b7: the fill pool with cross-hatch at 30°, unidirectional, 2 mm overscan | 4 | same | yes | yes | same | Clean |
| **Total** | **520** | **0 burn differences** | 38/38 | 38/38 | 37/38 | |

## Findings

### V2-P2-1 — A logo imported on 1.0.29 keeps burning its white shapes after the update; ADR-686 reaches new imports only, and nothing tells the returning user

- **Where (5f09e1110):**
  - `src/ui/state/object-insert-actions.ts:325-341` and `:346-360`: the knock-out runs only inside `importSvgFragment` and `reimportSvgFragment`.
  - `src/ui/state/import-white-knockout.ts:18-24`: `applyImportWhiteKnockout` reads only the objects just imported.
  - `src/ui/app/project-open-completion.ts:37-66` with `src/ui/state/project-load-notices.ts:13` (unchanged since 1.0.29): no white-fill branch at open. Nothing in `src/ui/laser/job-review/` or `src/core/preflight/` checks white fills (grep).
- **Anchor:**
  - **Contract, ADR-686 Decision 1** (`docs/decisions/ADR-686-white-fills-in-an-imported-design-are-paper.md:35`): "White fills are paper." Its scope is "In an SVG import", and its Consequences (`:59-75`) list what is "Not covered" without mentioning projects already saved.
  - **L11 rule** (v9 AREAS, "Lens L11"): every difference must be intended, named by an ADR, and either harmless or announced. Here the absence of a difference is the gap: the fix the ADR promises ("The beginner's logo burns as it looks", `:61`) does not reach the logo the beginner already has.
  - **Twin:** the same SVG imported fresh on main.
- **Scenario:** on 1.0.29 a beginner imports a logo, a black badge with a white diamond, and saves it. U3 rated the resulting burn P1: the badge burns solid and the diamond a second time. They update to main and open the project. The toast reads "Opened logo.lf2". The canvas paints the white diamond in plain ink (ADR-620), so it shows a solid badge. Job Review has nothing to say. The burn is 1.0.29's, with the diamond burned twice.
- **Evidence:** REPRO (`zz-v2\gen-b.mjs` built `b3-white-logos.lf2` with 1.0.29's `parseSvg` and `importSvgFragment`; `white.mjs` and `white2.mjs` measure on main).

  | Burn on main | Logo (U3's SVG) | Plate with white letters |
  |---|---|---|
  | The 1.0.29 project | 5,792.984 mm, dose 1,737,895 | 13,140 mm, dose 3,942,000 |
  | The same without its white shapes | 4,832.984 mm | 12,000 mm |
  | White burned a second time | **+960 mm, +19.9 % dose** | **+1,140 mm, +9.5 % dose** |
  | The same SVG imported fresh on main | 3,872.984 mm (`whiteShapes: 1`) | 10,860 mm (`whiteShapes: 2`) |

  - So main burns 1,920 mm (logo) and 2,280 mm (plate) more lit travel on the old project than on a fresh import of the same file. All of the extra is inside the white shapes. G-code is byte-identical to 1.0.29's (5/5 pairs). Open toasts: `["Opened b3.lf2"]` only.
- **Severity:** P2, with one point for the refuter and coordinator to weigh.
  - **For P2.** Main burns what 1.0.29 burned and what its canvas shows (solid ink), so nothing changes for the worse on update. R7-P2-1's reasoning applies: a burn that matches the canvas is not "different from what the canvas shows". The defect is the 1.0.29 one, unrepaired.
  - **Against.** By effect this is U3-P2-2, which U3's refuter raised to P1 (wrong physical output against the design). R7-P1-1 kept a fix gap at P1 because METHOD §3 has no "already shipped" clause and the file could tell. This file can tell too: a `#ffffff` fill path beside a darker fill in the same import is exactly what `knockOutWhiteFills` (`src/core/geometry/white-fill-knockout.ts:59`) looks for.
- **Announced?** No. The update notes on main are still 1.0.29's. ADR-686 does not mention saved projects.
- **Novelty:** new. U3 and ADR-686 consider imports only. No open PR touches the import or open path (#1592, #1596, #1597, #1601, #1605–#1613 checked by title and file list).
- **Fix direction:** at open, run `knockOutWhiteFills` per import (objects sharing a `source`) without changing anything, and when it finds white shapes over darker fills, say so. For example: "This project has 1 white shape that burns over the fill under it, as KerfDesk 1.0.29 imported it. Re-import the SVG to leave the white unburned." The open could offer the knock-out as one undoable step. Add a line to the 1.0.30 notes.
- **Refuter:** PENDING.

### V2-P2-2 — A laser that 1.0.29's first Connect turned into a CNC (`$32=0`) stays a CNC after the update; Start still sends `M3 S12000` and a 3 s dwell, and nothing on main tells the owner

- **Where:**
  - The cause, fixed on main: `df2279e26:src/ui/laser/device-setup/device-setup-auto-fill.ts:139-142` and `:185-196` (`machineKindFromLaserMode`: `$32=0` → `'cnc'`), removed by #1567 (`5f09e1110:…/device-setup-auto-fill.ts:143-147`).
  - What carries it over: `src/ui/state/last-machine-persistence.ts:51-74` (`loadLastMachineSelection` returns the stored `machineKind`), identical in both trees. `src/core/devices` is also unchanged.
  - Nothing re-asks: `src/ui/laser/device-setup/DeviceSetupLaserModeOff.tsx:39,53` shows the new laser-mode question only for a laser-only draft. A CNC draft gets no card, and ADR-637 Amd 7 (`docs/decisions/ADR-637-amendment-7-laser-mode-off-asks-instead-of-making-a-cnc.md`) adds no load-time or Start check (`grep "637 Amendment 7"` in `src` finds five UI sites, none at load).
- **Anchor:**
  - **Contract, ADR-637 Amd 7 Consequences** (`…amendment-7….md:84-86`): a stock-GRBL diode "stays a laser from its first Connect". That holds for a fresh Connect, but nothing covers the machines 1.0.29 already converted.
  - **Context the ADR itself gives** (`:19-21`): "Saved as a CNC, Start sent `M3 S12000`, a 3 s `G4 P3` dwell and rapids without `S0`."
  - **L11:** a fix whose harm persists for existing users must be announced.
- **Scenario:** on 1.0.29 a beginner connects a stock-GRBL diode laser (`$32=0`). The fill turns the generic laser starter into a CNC, and they press Save, as U8 walked through. They update to main. The window reopens on the same CNC machine, and the first Start fires the diode at the spindle command, held still for 3 s.
- **Evidence:** REPRO plus READ.
  - `zz-v2\prof.mjs` runs each tree's real `initDeviceSetup(DEFAULT_DEVICE_PROFILE)`, `planControllerAutoFill` and `deviceSetupReducer` on the same `$32=0` report:
    - 1.0.29: `machineKinds ["cnc"]`, summary `machineKind: "cnc"`.
    - main: `["laser"]`.
  - 1.0.29's `rememberLastMachine` writes that draft. Main's `loadLastMachineSelection` reads it as `machineKind cnc`, name "Default 400×400" (the laser starter's name), `laserModeEnabled true`, the same object 1.0.29 reads back.
  - `zz-v2\cncg.mjs`: a CNC job on that default device compiled on main emits `M3 S12000 | G4 P3.000 | M5`, the same bytes as 1.0.29 (all 18 b5 pairs and 17 golden CNC pairs are identical).
  - READ: no code on main inspects a stored CNC selection for this case.
- **Severity:** P2, with a point for the coordinator.
  - **For P2.** The output is what the saved machine type asks for. Main changes nothing for this user. A real router owner who answered CNC has the same document, apart from perhaps the name, so the app cannot know which answer was wrong. ADR-637 Amd 7 says `$32` "cannot tell a stock-GRBL laser from a router".
  - **Against.** By effect this is U8-P2-1, which the coordinator ledgered **P1** ("can fire the laser … unexpectedly"). It persists unrepaired for exactly the users it hit, and METHOD §3 has no "already shipped" clause (R7-P1-1). The document does carry a hint: main now renames a filled unlisted machine to `CUSTOM_MACHINE_NAME` (`device-setup-auto-fill.ts:159-160`). A CNC selection that still carries the laser starter's name "Default 400×400" was either never filled, or was filled by 1.0.29.
- **Announced?** No. The notes on main are 1.0.29's, and the 1.0.29 notes do not mention it.
- **Novelty:** new. U8 and ADR-637 Amd 7 consider the first Connect only. No open PR touches device setup or last-machine persistence.
- **Fix direction:** say it in the 1.0.30 notes: "If KerfDesk 1.0.29 made your laser a CNC when you first connected it, open Machine Setup and choose Laser." In the app, ask once when a GRBL machine reports `$32=0` and a CNC job starts on the generic starter profile: "Is this machine a laser? KerfDesk 1.0.29 could set a laser up as a CNC." Use the U8 wording that the beam fires.
- **Refuter:** PENDING.

### V2-P3-1 — The new missing-font notice on open says "Its text will burn as saved", but variable text in a missing font is refused at output

- **Where:**
  - `src/ui/text/missing-font-notice.ts:34-42`, shown by `src/ui/app/project-open-completion.ts:59-62` (new on main, #1595 / U5-P3-9).
  - The refusal: `src/io/gcode/prepare-output-snapshot.ts:430` (`variable-evaluation-failed`).
- **Anchor:** Twin. The open notice and the output preparation disagree on what burns.
- **Scenario:** a file whose text names a font that is neither bundled nor embedded, opened on main. The toast reads: "This project uses fonts that aren't on this computer (imported:tinos-v2, imported:han-v2). Its text will burn as saved…". Then every job that includes the CSV texts is refused: "Variable text … could not render: The font imported:tinos-v2 isn't on this computer…". Static text does burn as saved. On 1.0.29 the same jobs are refused, with "Relink it to edit." and no open notice.
- **Evidence:** REPRO (`b2m-text-missing-font.lf2`, 1.0.29-saved, `phase-a.mjs` with `V2_DIR=out/b-saved/`). 18 of 22 pairs are refused on both builds and differ only in this wording. 4 static pairs are identical. The key is shown raw, because `fontDisplayName` strips only `system:`.
- **Reach:** low. No KerfDesk save route found that writes such a key: no `system:` key writer in `src` on either tree, and `withReferencedEmbeddedFonts` keeps every font a text names. So it needs a hand-edited or third-party file. That is why it is P3.
- **Severity:** P3. The wording is misleading, and nothing burns wrongly: output is refused.
- **Novelty:** new. U5-P3-9 introduced the notice.
- **Fix direction:** when a variable text uses a missing font, say "Variable text in this font cannot be output until you choose a font". Show the font's file name instead of its key when one exists.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"Text on a path refuses records alone."** Six b1 pairs refuse with "The linked text guide is missing" on both builds. My per-object compile filtered the guide out. The whole-job compiles of the same records are identical and burn.
- **"A 1.0.29 recovery archive unpacks differently on main."** A JSON compare of the 52,313 blocks differed. Every difference was key order (`programLineNumber` moved). `isDeepStrictEqual` finds 0 differing blocks.
- **"Main builds the embedded-font scene differently."** The b2 file built by main differs from the 1.0.29 one only in object and operation IDs: separate runs of my counter. Geometry, fonts and base64 are byte-identical.
- **"#1583's nesting painter changes old projects' fill."** `paintNestedUnits` (`src/core/geometry/vector-path-nesting-paint.ts:43`) is reached only from Offset and Boolean (`offset-shapes.ts:202`, `vector-path-booleans.ts:158`), which are edits. No open, compile or migration path calls it. V4 owns its equivalence.

## Verified clean

**Per fixture:** see the Matrix. All 22 golden files and 16 own scenes: G-code byte-identical (520 pairs). Re-save on main is byte-identical to re-save on 1.0.29 (38/38). A main save opens on 1.0.29 and compiles identically (38/38). 1.0.29-era load notices are word for word the same (frame repair, record baseline, Dot Width, Job Origin move).

**Per PR:**
- **Schema and format.** `PROJECT_SCHEMA_VERSION` is 21 on both. `git diff --stat df2279e26 5f09e1110` over `src/io/project`, `src/core/scene`, `src/core/devices`, `src/ui/state/last-machine-persistence.ts`, `src/io/material-library` and the non-test files of `src/io/gcode` is empty. So no migration step, no new stored field and no device-profile change exist to check. Only new browser-storage keys were added (`kerfdesk-autosave-start-fresh-v1`, Before-you-start fold state); none renamed or dropped.
- **Downgrade.** Besides the 38 re-saves, 15 scenes were built with main's own code (`gen-b.mjs main`):
  - 13 are byte-identical files to 1.0.29's, and b2 differs only in IDs.
  - b3, the knocked-out logo, opens on 1.0.29 and compiles identically on both.
  - Refusal of a newer schema was not exercised: there is none.
- **#1556 (ADR-686).** Applies at import and Re-import only (READ above). A 1.0.29 logo is untouched: V2-P2-1.
- **#1561 (ADR-480 Amd 2, ADR-687).** The coaster's G-code is unchanged. `cutOrderWarnings` on main gives "Cut runs before the engraving inside it: "coaster" runs before "Sarah"…" for the 1.0.29 file. Advisory only, as the ADR says.
- **#1567 (ADR-637 Amd 7).** G-code is unchanged for every machine in the set. Last-machine documents load identically. The CNC conversion persists: V2-P2-2.
- **#1572, #1575, #1576 and #1574 (archive).** A real 1.0.29 execution artifact (the golden photo job, 52,363 lines, staged by 1.0.29's `stageFreshExecutionArtifact`) passes main's `isExecutionArtifact` and `isCurrentExecutionArtifact`. Its `packed-motion-manifest-v1` passes `isArchivedPackedMotionManifest` and unpacks to 52,313 blocks deep-equal to 1.0.29's manifest (`artifact.mjs`).
- **#1585 (ADR-255 Amd 3).** ETA only. V1 verified the estimate exactly unchanged except GRBL 1.1/grblHAL with laser mode on. Not re-run here.
- **#1551, #1552, #1593.** Fill-pool golden and b7 cross-hatch are identical. The canvas geometry is the stored geometry, which is identical after re-save. Display caching is not compared (V4).
- **#1555, #1557, #1578, #1587, #1594 (stored images).**
  - Old photos compile identically, including the 4.32 MP streamed-rows case and Image Studio adjustments.
  - `decodeRasterLuma` 1.0.29 vs main: 3,000 fuzzed inputs (whitespace, missing or extra padding, `*`, non-ASCII, data after padding) give identical bytes or identical errors.
- **#1589 (project reader).** `readJsonValueFromBlob` on all 16 saved scenes (up to 8.8 MB) equals `JSON.parse` and 1.0.29's reader. 2,000 fuzzed documents with random chunking (escapes, surrogate pairs, control characters, `-0`, `1e-7`, 5,000-character and base64 strings) give 0 mismatches. Main is faster on large files (8.8 MB: 199 ms vs 673 ms).
- **#1590, #1591, #1602 (text, variable copies, embedded fonts).**
  - The 291 golden frame pairs, the 76 mixed golden pairs and the 57 b1/b2 pairs are identical. That includes a 4.6 MB CFF font in shrink frames and a wrapping paragraph, the shaping cache's hardest case.
  - `batchVariableTextRenderer` equals `renderVariableText` equals 1.0.29's on 137 record renders (`batch.mjs`).
  - The base64 codec matches 1.0.29's on 3,000 encodes and 18,000 decodes for embedded fonts and depth maps, valid and malformed.
- **#1603 (ADR-154 Amd 5).** Adaptive and both fallbacks are byte-identical. Main's Preview names the fallback ("Adaptive will cut offset rings instead: Adaptive clearing requires an end mill…"), as intended. #1606 is not on main.
- **#1564 (ADR-688).** Three 1.0.29 autosave sessions, written by 1.0.29's `AutosaveDurableService` into a shared fake IndexedDB, are read by main's `readLatest` (newest, no warnings) and `readRecent` (all 3, newest first). Each project's serialization is byte-identical to 1.0.29's (`autosave.mjs`). Restore uses the same `setProject` as Open.
- **#1558.** Stores nothing new: last-machine persistence and devices are unchanged. Not exercised (V3).

## Not verified

- **The rendered UI.** Toasts, Job Review rows and Preview notices were read from the functions that build them, not rendered. The memory gate for a browser (3 GB) was never met.
- **Vitest.** Not run (gate 1.5 GB was met only briefly). Bundled Node runs replaced it. Images used the golden files' stub `dataUrl`. Text used the in-process renderer, with real bundled and embedded font files.
- **Weld.** Welded text was left out: 1.0.29's weld refuses to run in-process outside test mode. A welded text is stored as paths, so its burn is the stored geometry.
- **Fresh 1.0.28 saves.** 1.0.28 and 1.0.27 coverage is the golden set only.
- **Not tried:** re-trace of an old traced photo (V5), retained-array regeneration on an old project (the renderer it uses is verified equal), relief, rotary, tiles, two-sided CNC, print-and-cut, sheets and production rows, phone or MCP edits, the desktop file association, Linux or Mac paths.
- **ETA.** Not re-measured (V1).
- **Hardware:** none, by instruction.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v2\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `old29\` | `git archive df2279e26 src public package.json tsconfig.json`, with a `node_modules` junction (remove the junction with `cmd /c rmdir` before deleting) |
| `build.mjs`, `entry*.ts`, `bundles\` | esbuild bundles of each tree's real modules (fonts resolved to files, workers stubbed) |
| `h.mjs`, `dom.mjs` | Open (store + `completeNativeProjectOpen`), compile, save (`prepareProjectForPersistence`), JSON diff; jsdom globals for SVG parsing |
| `phase-a.mjs` | Opens every file on both builds, compiles per object, record and job, re-saves, checks downgrade. Golden set: `out\phase-a.json`. Own scenes: `V2_DIR=out/b-saved/ V2_TAG=phase-b`, giving `out\phase-b.json` |
| `gen-b.mjs` | Builds and saves the b1–b7 scenes with a given tree (`old29` → `out\b-saved`, `main` → `out\b-main`) |
| `white.mjs`, `white2.mjs` | V2-P2-1 measurements |
| `prof.mjs` | V2-P2-2 profile fill and last-machine round trip; `cncg.mjs` gives the CNC spindle lines on main |
| `notes.mjs` | Cut-last and CNC fallback notices on main for old files |
| `batch.mjs`, `fuzz-codec.mjs`, `blob.mjs`, `autosave.mjs`, `artifact.mjs` | Batch renderer, codec and tokenizer fuzz, large reader, autosave and recovery-archive compatibility |

```json
{
  "area": "V2",
  "id": "returning-user",
  "tree": "5f09e1110",
  "older": ["df2279e26 (own export)", "golden files from 1.0.27, 1.0.28, 1.0.29"],
  "raised": 3,
  "pairs": { "golden": 400, "own_1_0_29_scenes": 120, "burn_differences": 0 },
  "findings": [
    {"id": "V2-P2-1", "severity": "P2", "area": "V2", "file": "src/ui/state/object-insert-actions.ts", "line": 339, "anchor": "Contract ADR-686 D1 + L11; twin: fresh import on main", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "A logo imported on 1.0.29 keeps burning its white shapes on main (+960 mm / +19.9 % dose on U3's logo, +1,140 mm on a plate); ADR-686 runs on import only; no open, Preview or Job Review notice; not in update notes. Coordinator may weigh P1 (U3-P2-2 was P1; the file can tell)"},
    {"id": "V2-P2-2", "severity": "P2", "area": "V2", "file": "src/ui/state/last-machine-persistence.ts", "line": 51, "anchor": "Contract ADR-637 Amd 7 Consequences + L11", "evidence": "REPRO+READ", "verdict": "PENDING", "known": false, "summary": "A laser that 1.0.29's $32=0 fill made a CNC loads as CNC on main; Start still sends M3 S12000 and G4 P3.000; nothing re-asks or announces. Coordinator may weigh P1 (U8-P2-1 was P1)"},
    {"id": "V2-P3-1", "severity": "P3", "area": "V2", "file": "src/ui/text/missing-font-notice.ts", "line": 42, "anchor": "Twin: open notice vs prepare-output-snapshot.ts:430", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "New missing-font open notice says text will burn as saved; variable text in that font is refused at output; raw key shown. Reachable only via a hand-edited or third-party file"}
  ]
}
```

## Refuter (2026-11-08)

Fresh refuter, separate context. Tree `j10-main` (= `5f09e1110` for `src`). Older code: the auditor's `old29` export (read only), plus my own `git archive 33bc394c6` (1.0.28, schema 19) in `scratchpad\zz-v2r\old28` with a `node_modules` junction. I built my own esbuild bundles of all three trees (`zz-v2r\bundles\`, with `import.meta.env.SSR` set so the text-weld worker runs in-process) and my own harness (`zz-v2r\h.mjs`). Available memory was 1.33–1.73 GB throughout, so there was no Vitest and no browser. Every run was a Node repro, and the "simulated controller" is the repo's own GRBL oracle, `src/__fixtures__/controllers/grbl-laser-power-model.ts`, a port of gnea/grbl `gc_execute_line`. No hardware was used.

### Verdicts

**V2-P2-1: SEVERITY CHANGE → P1.** The finding holds and reproduces on my own files. The defect matches the P1 test by effect, and nothing on main lowers it.

- **REPRO** (`zz-v2r\p21.mjs`, `p21b.mjs`). I made two new logos, each imported through 1.0.29's own `parseSvg` + store `importSvgFragment` and saved by 1.0.29's `prepareProjectForPersistence`. The white is written two ways the auditor did not use:
  - `star`: a white star written as `style="fill:white"` on a black square.
  - `ring`: a white ring set by a CSS class on a dark-grey disc, with a black dot painted over the white.

  I opened each on main with `completeNativeProjectOpen` and compiled the whole job:

  | Logo | 1.0.29 file on main | Its white operation switched off | Same SVG imported on main | Extra |
  |---|---|---|---|---|
  | star | 31,174 mm lit | 25,000 | 18,826 | **+12,348 mm (+65.6 %)** |
  | ring | 13,795 mm lit | 10,662 | 7,529 | **+6,266 mm (+83.2 %)** |

  - G-code on main is byte-identical to 1.0.29's.
  - Open toasts: `["[success] Opened star.lf2"]` only.
  - The fresh import on main keeps no white path and drops the white operation. The old file keeps the `#ffffff` path on its own Fill operation (`star 2`, `ring 2`).
- **What would make it false, and why that fails.**
  - (a) The output might not be wrong. ADR-686 calls the old result "the wrong burn" (`docs/decisions/ADR-686-…-paper.md:30`) and promises "The beginner's logo burns as it looks" (`:61`). U3-P2-2, the same output, is ledgered **P1** (`docs/audits/2026-11-03-ux-u1/LEDGER.md:28`): "a display is not a warning (METHOD G6)".
  - (b) A clear warning might reach the operator before output. None does on main:
    - Open: `src/ui/app/project-open-completion.ts:43-62` has no white-fill branch.
    - Canvas: artwork rests in plain ink (`src/ui/workspace/draw-scene.ts:122`, ADR-620), so the white star paints black on black.
    - Job Review and preflight: `grep -i "white|#ffffff|knockOut"` over `src/ui/laser/job-review` and `src/core/preflight` finds nothing.
    - The knock-out runs only inside `importSvgFragment` and `reimportSvgFragment` (`src/ui/state/object-insert-actions.ts:325-343`, `:346-362`). `knockOutWhiteFills` has no other caller in `src`.
- **The auditor's case for P2.** It argues that main burns what 1.0.29 burned and what the canvas shows. That is the argument U3's refuter rejected. The solid-ink canvas is what hides the defect, and METHOD §3 has no "already shipped" or reach clause. R7-P1-1 (`docs/audits/2026-11-02-rolling-v9/LEDGER.md:21`) kept a fix gap for files already in the field at P1 for the same reason.
- **Should the knock-out apply to old files automatically?** No. A returning user would not expect a saved project's burn to change silently: L11 requires differences to be announced. ADR-686 Decision 3 (`:44`) also makes "burn the white" a choice the operator can make with Undo. The fix should be the auditor's notice plus a one-step, undoable offer at open. The severity follows the harm that remains, not the form of the fix.
- **Correction to the fix direction.** The notice should skip a white shape whose operation already has output off. A 1.0.29 user who found U3's workaround (unticking **Include in output**) has a correct burn already.

**V2-P2-2: SEVERITY CHANGE → P1.** I reproduced the whole chain, from 1.0.29's fill to beam state on a simulated controller (`zz-v2r\p22.mjs`).

- **Steps.**
  - **1.0.29's fill.** I ran 1.0.29's `initDeviceSetup(DEFAULT_DEVICE_PROFILE)`, `planControllerAutoFill` and `deviceSetupReducer` on a stock-GRBL diode `$$` report (`$30=1000`, `$31=0`, `$32=0`, max rate 5000, 400 × 400). The result is `machineKinds ["cnc"]`. Main's own fill on the same report gives `["laser"]`.
  - **What main restores.** 1.0.29's `rememberLastMachine` wrote the document. Main's `loadLastMachineSelection` (`src/ui/state/last-machine-persistence.ts:51-74`) reads `kind cnc`, name "Default 400×400", `maxPowerS 1000`. Main's `createStartupProject` (`src/ui/state/startup-project.ts:8-13`) then starts the app with `machine.kind = 'cnc'`, `spindleMaxRpm 12000`.
  - **A first job.** A 40 mm square imported through main's store gets the default operation. It compiles on main to `G0 Z3.810 | M3 S12000 | G4 P3.000 | G0 X0.000 Y40.000 | G1 Z-1.000 F300 | …`. The rapid carries no `S0`.
  - **Simulated GRBL with `$32=0`.** In `grbl-laser-power-model.ts` (`executeGrblLine`), the first lit line is `M3 S12000`. The spindle is `cw` at S12000 through the `G4` dwell, and 40.0 mm of XY rapid runs with it on.
  - **Firmware.** gnea/grbl `spindle_compute_pwm_value` sets `pwm_value = SPINDLE_PWM_MAX_VALUE` when `rpm >= settings.rpm_max`, so S12000 against `$30=1000` is full power. I read this in a local copy (`scratchpad\e1r-src\grbl\spindle_control.c:197-200`), whose tag I did not re-fetch, so this anchor is UNVERIFIED as a pinned citation. The U8 refuter already cited `laser_mode.md` @ `v1.1h.20190825` for the beam staying on through rapids.
- **Guards on main: none that names the laser.**
  - **The `$32` check at connect and in Job Review.** For a CNC machine, `cncReadiness` (`src/core/preflight/controller-readiness.ts:156-196`) treats `$32=0` as correct and raises nothing. The only controller line for this `$$` is `spindle-scale-mismatch`: "Controller $30 is 1000 but this machine's spindle max RPM is 12000. Set $30=12000 (or update the machine profile) so S values map to real RPM." That is an advisory and never refuses Start (`src/ui/laser/start-job-controller-policy.ts:33-37`). It says nothing about a laser or a beam, and its advice (raise `$30`) points the wrong way for a diode.
  - **The new laser-mode card.** It renders only for a laser-only draft (`src/ui/laser/device-setup/DeviceSetupLaserModeOff.tsx:40,52-54`), only inside Machine Setup, and not for a restored CNC.
  - **No machine-type check at startup.** `startup-project.ts` and `last-machine-persistence.ts` are byte-identical to 1.0.29's.
  - **What remains** is the 1.0.29 CNC path: Router workspace, Zero work Z, and the CNC attestation "Before starting the CNC spindle" (`src/ui/state/cnc-setup-attestation.ts:4`). The coordinator ruled exactly these insufficient for U8-P2-1 (`LEDGER.md:40`, P1): "a wrong, unsafe burn led into without a warning a laser beginner would understand".
- **Contract.** ADR-637 Amendment 7, Consequences (`:85`), says: "The CNC output path cannot be reached from `$32` alone." That is false for every profile 1.0.29 saved this way, and Start still runs on main.
- **Why the auditor's case for P2 fails.** The app's inability to tell this profile from a real router's limits the fix, not the severity. The output on a diode is wrong (power, dwell, travel) and unwarned, and P1 has no reach clause. The fix must ask, not convert. Also, by READ, a CNC set up from the laser starter on 1.0.29 by a real router owner also keeps "Default 400×400", because 1.0.29's fill did not rename it. So the name hint narrows who is asked, but it does not prove the machine is a laser.

**V2-P3-1: CONFIRMED P3.**

- **REPRO** (`zz-v2r\p31.mjs`). My own file was built on 1.0.29 with Tinos embedded as `embedded:liberation-x`: a static text, a CSV text and a `{{date}}` text. I then removed `embeddedFonts`.
  - Main toasts: "This project uses a font that isn't on this computer (embedded:liberation-x). Its text will burn as saved; …"
  - The static text burns.
  - **Both** variable texts are refused with `variable-evaluation-failed`: "Variable text 213289e3-… could not render: The font embedded:liberation-x isn't on this computer…". That covers the date stamp too, not only CSV.
  - On 1.0.29 there is no open notice, and the same texts are refused.
- **Reach.** No KerfDesk save route writes such a file:
  - The bundled font registry keys are identical in 1.0.28, 1.0.29 and main (hash of `key:` lines).
  - The only key writer is `embedded:${uuid}` (`src/ui/text/use-text-dialog-fields.ts:234`), whose font is embedded.
- **Severity.** It stays P3: nothing burns wrongly, because output is refused. Minor addition: the refusal names the text by its UUID, not its content.

### New findings

None. The misleading `$30=12000` advice on the stale-CNC path is folded into V2-P2-2 as evidence. It is not a separate finding.

### Challenges to "Verified clean"

- **Byte identity on fixtures the auditor did not use: holds.** All results are from `zz-v2r\c1.mjs`: whole job, each operation alone, and each CSV record, compiled on 1.0.28, 1.0.29 and main, plus a re-save on main compared with a re-save on 1.0.29.

  | Set | Files | Pairs | main = 1.0.29 | Re-save same | Open toasts same |
  |---|---|---|---|---|---|
  | Schema-1 fixtures: `docs/audits/fixtures/vector/*.lf2` (8), `e2e/fixtures/project-basic.lf2` | 9 | 18 | 18/18 (and = 1.0.28) | 9/9 | yes |
  | Real older saves from the performance audit, saved by 1.0.28 and 1.0.23: `zz-s4\projects\1028-{cnc,fill,line,mix}-200`, `1023-{cnc,fill,line,mix}-200`, `zz-s3\…\old-33bc394c6-mix-200`, `zz-s1\…\old-33bc394c6-20k` (CNC included) | 10 | 25 | 25/25 (and = 1.0.28) | 10/10 | yes |

  - **Harness note.** The auditor's `h.mjs:15` sets the store's device to the file's **raw, pre-migration** `device` before `deserializeProject`. With that preset, every schema-1 file throws in compile on all three builds (`Cannot read properties of undefined (reading 'filter')`). So files older than the golden set's schema 18 could not have been covered that way. Presetting the migrated `result.project.device` instead fixes it. Files of schema 18 and later are unaffected.
- **Welded text, traced photos, Image Studio, CNC tabs and jig layouts: hold, with one gap.** I built 9 scenes with each release's own store and code (`zz-v2r\gen.mjs`), giving 18 files and 54 pairs. **main = 1.0.29: 54/54**, re-saves are identical, and open toasts are identical.
  - **Welded text:** Pacifico with Weld overlaps, in five forms: static, bent 50°, tracking −0.08, a CSV record and a CSV in a shrink frame, with 4 records each. This exercises `applyTextWeld` inside `renderVariableText` at output on both builds.
  - **Traced photo:** traced with the release's own `traceImageToColoredPaths` and committed with `traceExistingImage`, keeping the picture.
  - **Image Studio:**
    - brightness, contrast, gamma and sharpen, with Jarvis dithering;
    - negative Atkinson;
    - rotated 17° and mirrored, in Grayscale.
  - **CNC:**
    - an outside profile with 4 automatic tabs plus 2 placed `cncTabAnchors`;
    - an inside profile with tabs and a 5° ramp;
    - a drill.
  - **Jig:** a 2 × 3 registration jig with artwork. **Gap:** in Node the set created the six boxes but laid no per-box artwork copies, so `separatelyCompiledJigInstances` was not exercised. The user dropped jig mode on 2026-10-21 (memory), so I did not pursue it.
- **Fresh 1.0.28 saves (`33bc394c6`) opened on main: hold.** The 9 scenes above, as saved by my own 1.0.28 export, compile byte-identically on main and 1.0.29. Two differ from 1.0.28 itself, both by 1.0.29's own intended changes, and main shows the same open notice as 1.0.29 (`toastsEqual=true`):
  - `c1-cnc-drill`: cuts 60.00 mm further in X. This is the Job Origin move; the open notice names the distance, and 1.0.29's notes cover it in highlight 1.
  - `w1-welded-text`: 5 of 9 pairs differ. These are the variable-text baseline change, and the open notice says "Variable text now follows its template's baseline…".
- **Update notes for 1.0.30.**
  - Missing notes are not a defect yet. The release gate (`scripts/reviewed-desktop-update-notes.mjs`) refuses a release without committed reviewed notes for the exact source SHA, and `sinceSourceSha` must then become `df2279e26`.
  - No change on main alters the G-code of an existing project in any of the 520 + 97 pairs.
  - These behaviour changes for existing projects and machines are unannounced and belong in the notes or in-app notices:
    - V2-P2-1 and V2-P2-2. These must be in-app, not only in the notes: a notes line cannot reach a user who skips them, and both are P1.
    - New Job Review and Preview rows on old projects: cut-last (ADR-480 Amd 2), the adaptive fallback (ADR-154 Amd 5), and the `$32=0` row that now opens at once with **Send $32=1** (ADR-637 Amd 7 item 4).
    - The new missing-font open notice.
    - **Re-import** of a 1.0.29 logo now removes its white shapes (ADR-686 Decision 1 lists Re-import). The import toast says so (Decision 4), but the change to an existing project's burn deserves a notes line.
    - Job time estimates change for GRBL and grblHAL in laser mode (ADR-255 Amd 3), so old projects show different times.
    - After **Abort**, the origin the reset cleared is put back (ADR-341 Amd 11). This changes where a re-run frames compared with 1.0.29. It is V3's area, but it is the change with the most physical effect.

### Not verified

- **Rendered UI.** The memory gate for a browser was never met. Canvas painting of the white shapes was read (`draw-scene.ts:122`), not rendered.
- **Vitest.** Not run.
- **Files I skipped:** the 20k, 5,000 and 2,000-object files (memory).
- **Jig per-box copies.** Not exercised; see above.
- **Other font routes:** missing fonts reached through the LightBurn import, and an embedded font dropped by the load validator.
- **GRBL `$30` clamp.** The local source copy's tag was not re-fetched, so that anchor is UNVERIFIED.
- **Hardware:** none, by instruction.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v2r\`:
- `old28\`: 1.0.28 export. Its `node_modules` is a junction: remove it with `cmd /c rmdir` first.
- `build.mjs`, `entry-*.ts`, `bundles\`: the bundles.
- `h.mjs`: open, compile and save harness.
- `p21.mjs`, `p21b.mjs`: V2-P2-1.
- `p22.mjs`: V2-P2-2.
- `p31.mjs`: V2-P3-1.
- `c1.mjs`: the three-build comparison.
- `gen.mjs`, `out\g28\`, `out\g29\`: the feature scenes.

Refuter counts: raised 3, refuted 0, P1 2, P2 0, P3 1, known 0
