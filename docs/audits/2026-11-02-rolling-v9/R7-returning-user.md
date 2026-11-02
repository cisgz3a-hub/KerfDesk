# Rolling audit v9 — R7 Returning user

- **When:** 2026-11-02, morning +0800   **Tree:** origin/main @ `e617025eb` (repros in the scratchpad `j7-main` copy of that SHA).
  - Older code: `git archive <sha> src public` of 1.0.23 `87ecb4f24` (schema 18, emitter v25), 1.0.27 `adf300522` (schema 18, emitter v29), 1.0.28 `33bc394c6` (schema 19, emitter v40). Main is schema 20, emitter v40.
- **Scope:** a project saved by an older release, opened on main through `deserializeProject` and the real store's `setProject`, compiled with `prepareOutputSnapshot` and `emitPreparedGcode`, and diffed against what the saving release compiles from the same file. Also idempotence, the 1.0.27 → 1.0.28 → main chain, refusal on older builds, machine profiles, the material library and defaults.
- **Lenses run:** L11 (all of it), L9 (machines: GRBL Dynamic, GRBL Compatible, Marlin, Falcon A1 Pro, CNC; routes: plain, frame, bend, path, variable, sheets, production rows, resize, sketch editor).
  - Not run: L5, L2, L4. No hardware was operated.
- **Matrix size:** 75 scenes (66 laser × 4 machines, 9 CNC) = 273 `.lf2` files per release; every scene built on every release. Variable scenes compile 2–6 records each, giving 449 G-code pairs per release and 1,347 pairs in all. Every pair was classified by `zz-r7-diff.mjs`.
- **Method note, the machine.** Each file opens with the file's machine already current, which is what a returning user's last-machine restore gives. The other case is under Refuted.
- **Counts:** 5 raised → 0 refuted → P1 1 / P2 2 / P3 2 (+ 2 KNOWN re-observed; 4 candidates dropped by the auditor, listed under Refuted). Refuter: 5 CONFIRMED, no severity changes. Four of the five have corrected numbers or wording; see each Refuter line and "Refuter method".

## Headline

**The direct upgrade is sound.** A project saved by 1.0.27 or 1.0.28 and opened straight on main burns at the same size, power and order for all plain text, framed text, bent and path text, rounded rectangles with tabs, resized and rotated shapes, Fill, Line, Offset results, Lead-ins, dithered images, Power Scale, Design Studio sketches, jig and Place Board layouts, and CNC profile, pocket, engrave, V-carve and two-bit jobs. N4-P1-1 is fixed on the direct route: the 1.0.27 Relief tag's "ANNA" burns 39.588 × 10.000 mm on both builds.

| Saved by | G-code pairs | Identical | Comment only | Order only | Burn differs |
|---|---|---|---|---|---|
| 1.0.28 | 449 | 425 | 0 | 0 | 24 (one scene) |
| 1.0.27 | 449 | 256 | 36 | 0 | 157 (11 scenes) |
| 1.0.23 | 449 | 106 | 36 | 150 | 157 (the same 11 scenes) |

Every burn difference traces to an ADR. Three gaps remain:

- **R7-P1-1.** A 1.0.27 project that was opened and saved on 1.0.28 lost its frame rule for good. On main its Relief name tag burns "ANNA" at **29.612 × 7.480 mm instead of 39.588 × 10.000**, while the canvas draws the 11 mm template, and nothing warns. ADR-682 Amd 1 accepts this because "the file does not record" which text was converted. In fact the stored geometry does record it: a converted frame no longer equals its own re-render, and a frame made on 1.0.28 does.
- **R7-P2-1.** Variable records move with no notice: up to 38.6 mm in a bend, 1.7 mm on a path, 0.69 mm in a frame. The moves are intended, and they bring the burn closer to the canvas, but a batch placed on real blanks lands elsewhere.
- **R7-P2-2.** Two image dose changes reach old projects with words only in 1.0.28's update notes: Grayscale with Dot Width Correction burns +41 % energy and turned Pass-Through +38 %. A 1.0.27 user who skips to the next release never sees those notes.

## Matrix

"Same" means byte-identical G-code unless noted. Burn figures are read from the emitted moves. The dose is Σ(length × S).

| Project | Saved on | Machine | G-code diff class | Burn change? | Announced? | Verdict |
|---|---|---|---|---|---|---|
| Plain text: Roboto, Pacifico Weld, Relief, Nixish, Decorous, Casual Hand, letter spacing | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Same | 1.0.23 | all 4 | order only (ADR-669) | Order only; same extent, length and dose | No | Harmless |
| Framed text, plain: Roboto, Relief, Nixish two-line, Casual Hand; shrink, auto-height, fixed | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Framed plain text after a same-values rebuild | 1.0.27, 1.0.23 | Dynamic | n/a | No: every rebuilt size equals the stored size | n/a | Clean (ADR-682 D4 holds) |
| Bent text, Roboto and Relief | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Text on a path, Roboto and Relief | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Variable CSV and serial, unframed: Roboto, Relief, Casual Hand | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Variable CSV, bent, Roboto and Relief | 1.0.27 | all 4 | BURN (ADR-682 D5) | **Position:** X up to 25.06 mm (Roboto), 38.60 mm (Relief); Y up to 2.95 mm. Size and dose same. Now on the canvas anchor | **No** | R7-P2-1 |
| Same | 1.0.28 | all 4 | identical | No | n/a | Clean |
| Variable CSV, Relief 80 × 11 frame | 1.0.27 | all 4 | BURN (ADR-682 Amd 1 item 3) | **Position:** Y up to 0.57 mm on 4 of 6 records. Size same: ANNA 39.588 × 10.000 | **No** | R7-P2-1 |
| Same, Casual Hand 80 × 12 frame | 1.0.27 | all 4 | identical | No | n/a | Clean |
| Variable CSV, Roboto 80 × 20 frame | 1.0.27 | all 4 | BURN (ADR-682 D6) | **Position:** Y up to 0.69 mm. Size same | **No** | R7-P2-1 |
| Same | 1.0.28 | all 4 | identical | No | n/a | Clean |
| Variable CSV, Roboto 40 × 20 frame (the template shrinks) | 1.0.27, 1.0.28 | all 4 | BURN (ADR-682 Amd 1 item 3) | **Position:** Y 0.25–0.69 mm. Size same | **No** | R7-P2-1; the only burn change among these scenes for a 1.0.28 file (wider set: R7-P2-1 Refuter line) |
| Variable CSV on a path, Roboto and Relief | 1.0.27 | all 4 | BURN (ADR-682 D6) | **Position:** X up to 0.70 mm, Y up to 1.71 mm; width up to 0.168 mm | **No** | R7-P2-1 |
| Same | 1.0.28 | all 4 | identical | No | n/a | Clean |
| **1.0.27 → saved on 1.0.28 → main:** Relief 80 × 11 and Casual Hand 80 × 12 variable frames | 1.0.27 via 1.0.28 | Dynamic | BURN against 1.0.27; identical to 1.0.28 for Relief; Casual Hand also moves in Y (refuter) | **Size:** ANNA 39.588 × 10.000 → 29.612 × 7.480; Maximilian 69.292 × 11.000 → 54.394 × 8.635; Casual Hand Anna 27.148 × 12.000 → 22.222 × 9.823 | **No** | **R7-P1-1** |
| Rounded rectangle with placed tabs, resized with tabs, resized without, automatic tabs, rotated | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Same, resized once more on main | 1.0.27, 1.0.23 | Dynamic | n/a | Tabs land at (100, 320) and (160, 340), on the new edges; spec rebuilt to 120 × 40 r 8 | n/a | Clean |
| Kerf, Lead-ins, Power Scale, perforation with overcut, Offset result | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Fill with holes in one path, holes as separate objects, bidirectional cross-hatch, offset, island, automatic overscan, 45° scan, filled text | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Images: Grayscale, Floyd–Steinberg, threshold, Pass-Through, Dot Width on a dither, Power Scale, 45° scan, turned Grayscale, turned dither | 1.0.27 | all 4 | comment only: `; kerfdesk:laser-off-motion` (ADR-415 Amd 1) | No | n/a | Clean |
| Same | 1.0.28 | all 4 | identical | No | n/a | Clean |
| Grayscale with Dot Width Correction 0.1 | 1.0.27 | all 4 | BURN (ADR-458 Amd 1) | **Dose +41.2 %**, burn time +50 %, same extent, at 0.5 mm pixels | 1.0.28 notes only | R7-P2-2 |
| Turned Pass-Through | 1.0.27 | all 4 | BURN (ADR-492 Amd 1) | **Dose +37.9 %**, time +37.7 %; extent +0.37 × +0.56 mm | 1.0.28 notes only | R7-P2-2 |
| Blue Noise | 1.0.27 | all 4 | BURN (ADR-649 Amd 1) | White stays blank: 0.2 mm off the extent in the test image, dose −0.01 % | No | R7-P2-2 (minor) |
| Design Studio sketch: constrained, canvas-resized, stretched | 1.0.27, 1.0.28 | all 4 | identical | No. The editor opens on 120 / 60 / 8 and a no-change re-apply gives identical G-code | n/a | Clean |
| Jig set, Place Board box | 1.0.27, 1.0.28 | all 4 | identical | No | n/a | Clean |
| Sheet book: a Relief frame on an inactive sheet | 1.0.27, 1.0.23 | Default | Differs by the frame record's move only | Stays schema 18 until opened, then converts with `legacyLineEm` 0.68; plain text same | No | R7-P2-1 |
| Production run row, Relief frame | 1.0.27, 1.0.23 | Default | Same extent | ANNA 39.588 × 10.000 on both | n/a | Clean |
| CNC: profile with automatic tabs, placed tabs, resized tabs; pocket; engrave; V-carve; two bits; placed by centre | 1.0.27, 1.0.28 | CNC | identical | No | n/a | Clean |
| CNC profile on a near-closed outline | 1.0.27 | CNC | BURN (ADR-672) | **Size:** cuts Outside now, so the path grows by the bit (+4.76 × +3.18 mm) | **Yes:** preflight `cnc-profile-outline-closed` | Intended and announced |
| All of the above against 1.0.23 | 1.0.23 | all | as 1.0.27, plus 150 pairs order only (ADR-669) | Order only | No | Harmless |

## Findings

### R7-P1-1 — A 1.0.27 frame saved through 1.0.28 keeps the wrong line rule on main: records burn up to 25 % smaller than 1.0.27 and than the canvas, with no warning

- **Where:**
  - `src/io/project/migrations.ts:62-65`: step 19 adds nothing to a schema-19 file.
  - `src/core/text/stroke-font-text.ts:57`: `input.textBox.legacyLineEm ?? 1`, so a frame without the field counts a line as one em.
  - `src/ui/text/render-variable-text.ts:14-28`: every record re-renders at output.
  - `src/ui/app/project-open-completion.ts:47-52` and `src/ui/state/project-load-notices.ts`: the toast says "migrated from schema v19", and no load notice covers text.
- **Anchor:**
  - **Contract.** ADR-682 D4 (`docs/decisions/ADR-682-text-size-is-the-em-and-variable-records-keep-their-baseline.md:67`): "Project schema 19 keeps old single-line text exactly as drawn."
  - **Contract, concession.** ADR-682 Amd 1 D1 (`docs/decisions/ADR-682-amendment-1-old-single-line-frames-and-record-baselines.md:46-48`): "the file does not record which text step 18 converted", and "that cannot be undone". The repro below shows the file can tell them apart.
  - **Twin.** The same file opened directly on main, without the 1.0.28 save: 39.588 × 10.000.
- **Scenario:**
  1. On 1.0.27: `{{csv:name}}`, Relief, Size 10, centred, fixed 80 × 11 frame, Shrink to fit. Saved.
  2. The user updates to 1.0.28, which is the live desktop release, opens the project and saves it. It is now schema 19 with Size 14.706 and no `legacyLineEm`.
  3. The user updates to main. The open toast reads "migrated from schema v19". The canvas still draws the stored template, 77.276 × 11.000 mm. Start and Save report nothing.
- **Evidence:** REPRO. The file was saved by `adf300522`, opened and saved by `33bc394c6`, then opened on `e617025eb`.
  - The G-code on 1.0.28 and on main is byte-identical (`cmp`), so main carries the 1.0.28 regression forward instead of adding a new one.
  - Advisories and issues are `[]` for all six records (`var-csv-frame-relief-80x11__dyn.main.json`).

    | Record | 1.0.27 burn | Main burn of the 1.0.28-saved file | Linear size |
    |---|---|---|---|
    | ANNA | 39.588 × 10.000 | **29.612 × 7.480** | 74.8 % |
    | Anna | 33.280 × 9.926 | 24.892 × 7.425 | 74.8 % |
    | Peggy | 34.740 × 11.000 | 29.876 × 9.460 | 86 % |
    | Maximilian | 69.292 × 11.000 | 54.394 × 8.635 | 78.5 % |
    | Casual Hand "Anna", 80 × 12 | 27.148 × 12.000 | 22.222 × 9.823 | 81.9 % |

  - **Plain frames** keep their stored burn until edited; a same-values rebuild then gives Relief ANNA 39.588 × 10.000 → 26.920 × 6.800, Nixish two lines 59.412 × 25.000 → 47.163 × 19.846, Casual Hand 27.148 × 12.000 → 22.222 × 9.823.
  - **The file does tell them apart.** A same-values rebuild on main (`_rerender.txt`):
    - converted, saved by 1.0.28: stored 77.276 × 11.000, rebuilt 64.757 × 9.218;
    - unconverted Roboto frames in the same chain: equal;
    - frames *made* on 1.0.28 under the em rule (`r28/*`): every rebuild draws the stored paths exactly.
- **Severity:** P1, with one point for the refuter and coordinator to weigh.
  - The size is silently wrong against the design and the canvas, by up to 25 % linearly, and METHOD §3 has no reach clause. An ADR line is not an operator warning.
  - R7's own P1 wording compares with "the saving release". The last saving release here, 1.0.28, burns the same wrong size, so the harm dates from 1.0.28 and main does not repair it. The release that made the design, 1.0.27, burned 10.000 mm.
- **Novelty:** new as a finding. ADR-682 Amd 1 names the case as accepted, and `docs/audits/**` does not raise it. R4 (`fix-text-frames`) may also reach it.
- **Fix direction:** at load of a schema-19 file, for a single-line text in a fixed shrink frame without `legacyLineEm`, render it under the em rule and compare with the stored geometry.
  - If they differ, and the 0.68 or 0.5 rule reproduces the stored geometry, set `legacyLineEm` and say so in a load notice.
  - This needs only the bundled stroke fonts, which core already holds, so it could run at load without a worker.
  - At the least, warn at output when a record's frame rule cannot reproduce the stored template.
- **Refuter: CONFIRMED, P1 kept.** What would make it false: the output is not wrong, or a clear warning reaches the operator first. Neither holds.
  - **Reproduced with files saved by the real older code,** using a separate harness and G-code parser: 1.0.27 ANNA 39.588 × 10.000; 1.0.27 → 1.0.28 → `945aa837b` 29.612 × 7.480. Toast `migratedFrom` 19, advisories and issues `[]`.
  - **Not a new harm on main.** 1.0.28 burns the same 29.612 × 7.480, and it does so on a direct open of the 1.0.27 file, before any save. So this is the #1507 harm, live in the released 1.0.28 since 2026-10-29. Main fixes the direct route but cannot repair a file 1.0.28 has saved. That changes the label (a fix gap of N4-P1-1, not a regression on main), not the severity: METHOD §3 has no clause for "already shipped", and the defect is reachable today.
  - **ADR-682 Amd 1 accepts it and adds no warning.** D1 says "cannot be undone" and the Consequences name no notice. `project-load-notices.ts`, `inspectPreparedStart` and the Job Review warning list have no text check. The rows preview does show the size, but reads "Fits · 11.00 mm", which is not a warning, and it sits in the text dialog. Frame does not count (METHOD §3, G6).
  - **Corrections to the numbers.**
    - The harm is larger than "up to 25 %". Across a 24-frame matrix (4 single-line fonts × 6 frames, 7 records each) the worst uniform shrink is **66.1 %** of the 1.0.27 size (Nixish "Al" and "ANNA"), and 14 records also change line breaks (Nixish 40 × 20 ANNA: "AN/NA" 23.622 × 19.996 → one line 39.664 × 8.762).
    - "Than the canvas" needs care. The canvas draws only the literal template, so 25 % is against 1.0.27. Against the canvas the measurable gap is the template itself: stored 77.276 × 11.000, rebuilt 64.757 × 9.218 (83.8 %).
    - **"Byte-identical to 1.0.28" holds for Relief 80 × 11, not for all.** Short names are identical there. Casual Hand 80 × 12 is identical for only 2 of 7 records: main also moves the rest (Anna Y 350.177 → 347.451, a further 2.726 mm, under ADR-682 Amd 1 item 3), which puts the ink 0.549 mm below the frame bottom at Y 348. So on some chained files main adds a move to the 1.0.28 harm. Sizes match 1.0.28 throughout.
  - **The repair idea is sound against false fires, but incomplete.** Implemented as written, on `945aa837b`:
    - 0 fires on 360 schema-19 frames that should stay under the em rule: 288 made on 1.0.28 (Size 6, 10, 14.706 and 20) and 72 converted frames re-rendered by an edit on 1.0.28. Text a user deliberately saved at the new size is not touched.
    - 61 fires on 72 converted frames, 0 unknown. With `legacyLineEm` set, all 140 records of the 20 fired variable frames are byte-identical to main's direct open of the 1.0.27 file.
    - **It cannot see 11 frames**, because the em render also equals the stored geometry. For 7 plain frames that is harmless until edited, and Relief 80 × 15 is unchanged. Three variable frames stay wrong: Decorous 80 × 15 ANNA 13.686 → 10.257 mm (75 %), Nixish 40 × 20 ANNA as above, Relief 80 × 30 long name 98 %. For those, ADR-682 Amd 1's "the file does not record" is true; for the other 61 it is false. The fix needs an output warning or a limit stated for that remainder.
    - **One behaviour to decide.** A user who kept an unedited converted frame and accepted 7.48 mm burns on 1.0.28 would go back to 10.00 mm. The file cannot show that this was a choice, and the canvas never showed that size, so the load notice the auditor proposes is required, not optional.
  - **#1478 and #1528 change nothing here:** neither touches text, migration or load notices.

### R7-P2-1 — Variable records move on the bed after the upgrade and nothing says so

- **Where:**
  - `src/ui/text/render-variable-text.ts:14-28` and `:87`: records take the template's anchor or baseline.
  - `src/core/text/text-box-render.ts:95`: the shift.
  - `src/ui/app/project-open-completion.ts:47-52` and `src/ui/state/project-load-notices.ts`: no notice.
  - `docs/releases/desktop-update-notes.json` at `e617025eb` still holds 1.0.28's six highlights; none mentions text.
- **Anchor:** R7's own rule ("every difference must be intended, named by an ADR, and either harmless or announced", AREAS L11). The moves are named by ADR-682 D5, D6 and Amd 1 item 3, whose Consequences (`ADR-682-amendment-1…md:83-85`) describe them. Neither is an operator notice.
- **Scenario:** a tray of name tags in a jig, `{{csv:name}}`, saved on 1.0.27. The fixture and the file are unchanged. After the update, each record lands in a different place.
- **Evidence:** REPRO, largest movement across the records of the scene, Dynamic (other machines match). Advisories `[]`, no new preflight issue.

  | Scene | Saved on | Max ΔX | Max ΔY | Size change |
  |---|---|---|---|---|
  | Bent 60°, Roboto, centred | 1.0.27 | 25.06 mm | 2.06 mm | none |
  | Bent 60°, Relief, centred | 1.0.27 | 38.60 mm | 2.95 mm | none |
  | On a path, Roboto | 1.0.27 | 0.69 mm | 1.66 mm | width to 0.08 mm |
  | On a path, Relief | 1.0.27 | 0.70 mm | 1.71 mm | width to 0.17 mm |
  | Roboto 80 × 20 frame | 1.0.27 | 0 | 0.69 mm | none |
  | Roboto 40 × 20 frame | 1.0.27, **1.0.28** | 0 | 0.69 mm | none |
  | Relief 80 × 11 frame | 1.0.27 | 0 | 0.57 mm | none |

  **Why this is not P1.** Each move brings the burn closer to the canvas. Relief "ANNA" bent centred had its centre 25 mm off the template's centre on 1.0.27, and is on it now (82.5 mm). So it does not differ from "what the canvas shows", which R7's P1 requires.
- **Severity:** P2, an intended change not announced where it matters.
- **Novelty:** new. N4 and L3 verified the fix, not the announcement.
- **Fix direction:** a load notice when a file older than schema 19 (bend, path, frame) or schema 20 (shrink frame) has a variable text. For example: "Variable text now follows its template's baseline, so records in this project can burn in a slightly different place. Frame before you run a batch." Add a line to the next desktop notes.
- **Refuter: CONFIRMED, P2 kept, with larger numbers.** What would make it false: a notice at open or in Job Review, or moves too small to matter. Neither holds.
  - **Largest reproduced exactly.** Relief bent centred, "Al": 1.0.27 centre X 45.235 → `945aa837b` 83.837, a move of **38.602 mm**, against a template centre of 82.497. Roboto bent 25.061 mm. Size unchanged. Advisories `[]`, and no text branch in the load notices or Job Review.
  - **Why not P1.** The new position is the right one by the contract, since it sits on the canvas anchor. The old burn was the bug (L3-P1-2). METHOD's P1 needs wrong output, so P2 stands on L11's "harmless or announced", which fails here.
  - **Corrections.**
    - "0.69 mm in a frame" is too low. Casual Hand frames saved on 1.0.27 move **4.544 mm** (80 × 30 and 40 × 20, "Anna", size unchanged).
    - "Only burn change for a 1.0.28 file: Y 0.25–0.69" is too narrow. It held for the auditor's scenes, but Casual Hand 40 × 20 and 80 × 11 saved on 1.0.28 move **2.272 mm**. Any record that wraps to more lines also moves, in frames whose template does not shrink: Casual Hand 80 × 30 long name 1.478 mm, Roboto 80 × 20 0.236 mm.
    - "Each move brings the burn closer to the canvas" holds for the baseline, not always for the frame. A wrapped Casual Hand name in the 1.0.27 80 × 30 frame burned inside it (Y 330.264..360) and now reaches Y 328.117, 1.883 mm below the frame bottom. `onTextBoxBaseline` sets overflow, which only the rows preview reads. This is the bottom-edge twin of KNOWN N4-P3-3; R4 should weigh it.
    - Path figures re-measured with the auditor's scenes on `945aa837b`: Relief 0.704 / 1.743 mm, Roboto 0.690 / 1.679 mm; width to 0.168 mm. The Y values differ from the table by 0.02–0.03 mm.

### R7-P2-2 — Old image projects burn up to 41 % more energy; the words are only in the notes of a release a returning user can skip

- **Where:**
  - `src/core/raster/emit-raster-sweep.ts:83,159` (ADR-458 Amd 1) and the turned Pass-Through route (ADR-492 Amd 1).
  - `electron/manual-update-notes.ts:28`: one notes sidecar per update target, read per release (READ).
  - `docs/releases/desktop-update-notes.json`: the 1.0.28 highlight "Burns match the preview more closely". Its `sinceSourceSha` is `adf300522`.
- **Anchor:** ADR-458 Amd 1 Consequences (`docs/decisions/ADR-458-amendment-1-dot-width-trims-burned-line-ends.md:60`): "A Grayscale project burned with an earlier build at a non-zero Dot Width will burn darker".
- **Scenario:** a slate photo, Grayscale, Dot Width Correction 0.1, tuned on 1.0.27 to look right. The user updates from 1.0.27 straight to the next release, whose notes will cover only what changed since 1.0.28. Open says "migrated from schema v18", and Job Review says nothing. The burn is darker than the tuned result.
- **Evidence:** REPRO, all four machines, 48 × 48 pixels over 24 mm (0.5 mm pixels), 5 lines/mm.

  | Scene | Length | Dose | Burn time | Extent |
  |---|---|---|---|---|
  | Grayscale + Dot Width 0.1 | 1792.4 → 2690.4 mm | **+41.2 %** | +50.1 % | same |
  | Turned 30° Pass-Through | 789.6 → 1087.9 mm | **+37.9 %** | +37.7 % | +0.37 × +0.56 mm |
  | Blue Noise | 1613.8 → 1613.6 mm | −0.01 % | −0.2 % | −0.2 mm in Y |

  The Dot Width figure depends on pixel pitch; at finer pitch the old build trimmed a larger share of each pixel. `img-dwc-floyd` (a dither with Dot Width) is unchanged, as ADR-458 Amd 1 says. A 1.0.28 file is byte-identical on main.
- **Severity:** P2.
  - These are deliberate corrections towards the Preview, so the output is not wrong by the contract.
  - The change is announced, but only in one release's notes, not where a returning user meets it. Blue Noise is not named in any notes, but its effect in this test image is negligible.
- **Novelty:** new. ADR-458 Amd 1 and the notes record the change, and no audit asks whether a skipped release loses the words.
- **Fix direction:** a load notice when a file saved before schema 19 has a Grayscale image with Dot Width above 0, or a turned Pass-Through image. Alternatively, keep a "changes older projects" list in the notes that always spans at least the last few releases.
- **Refuter: CONFIRMED, P2 kept, with two corrections.** What would make it false: a skipping user still gets the 1.0.28 words, or a notice appears at open or in Job Review.
  - **The notes cannot span releases.** REPRO: `updateNotesUrl('1.0.29')` is one per-version file, and `fetchManualUpdateNotes` fetches only the candidate's, on 1.0.27 (`adf300522`, `electron/manual-update.ts:135`) as on main. `requireNotesBaseline` rejected a next-release file whose `sinceSourceSha` was 1.0.27: "Reviewed notes must name the authenticated previous release source." The file is 6 lines at most, 240 characters each, and a search of `src/ui` and `electron` found no in-app history or changelog view (`public/download.html` links release notes only for the preview suffix).
  - **Dose reproduced, and 41 % is not a ceiling.** The auditor's scenes re-run on `945aa837b` give +41.2 % and +37.9 %. My own plain-gradient image, same pitch, gives **+65.7 %** Dot Width (1680 → 2784 mm) and +37.7 % Pass-Through. The figure depends on the image as well as the pitch. Advisories and issues `[]`. A 1.0.28 file is unchanged.
  - **Why not P1.** ADR-458 Amd 1: the burn "will burn darker with this one, closer to its Preview", so the new output is correct by the contract.
  - **Reach, stated exactly.** The skip does not exist yet, because no release follows 1.0.28. Today a 1.0.27 or 1.0.23 user updates to 1.0.28 and is offered these notes, though they say "Burns match the preview more closely", not that an old project burns darker, and they are not shown when the project is opened. The next release's notes could carry a line, but nothing requires one. P2 is rated on main as the next release, like the rest of this report.

### R7-P3-1 — The open toast says "migrated from schema v18" and nothing about what the user will see

- **Where:** `src/ui/app/project-open-completion.ts:47-52`; `src/ui/state/project-load-notices.ts` has no text branch.
- **Anchor:** ADR-682 D4 (`…md:73-74`): "Size now reads what they are: Size 10 becomes 20."
- **Scenario:** a user who typed Size 10 opens the project and finds Font size 14.706 (Relief) or 20 (EMS), with line height 0.816 instead of 1.2. The burn is right, but the numbers look corrupted. The only clue is the field's tooltip.
- **Evidence:** REPRO for the stored values (`.lf2` → `.lf2x`: `sizeMm` 10 → 14.705882352941178, `lineHeight` 1.2 → 0.816, `letterSpacing` 0.3 → 0.204). READ for the toast. The field's display rounding was not checked.
- **Severity:** P3. Nothing burns wrong.
- **Fix direction:** one line in the load notices when step 18 converted any text: "Single-line text now shows Size as the font's em. It burns the same."
- **Refuter: CONFIRMED, P3 kept.** Own file from `adf300522`, opened on `945aa837b`: `sizeMm` 10 → 14.705882352941178, `lineHeight` 1.2 → 0.816, `minSizeMm` 2 → 2.941. ADR-682 D4 intends the values. The auditor left the field's rounding unchecked: READ, `NumberField` passes no `format` to `useDebouncedCommit`, and the default is `String(value)`, so the field shows the full number unless the dialog rounds its value first. Not rendered.

### R7-P3-2 — Golden old-project coverage is one fixture for one feature, and no test compares a whole job with what its saving release emitted

- **What exists:**
  - `src/__fixtures__/parent-saved-single-line-text-frames.lf2.gz`: schema 18, 5 objects, used by `src/ui/text/single-line-frame-migration.test.ts`. Saved by the parent of #1507, not by a release. It covers text frames only.
  - `e2e/fixtures/project-basic.lf2` and `docs/audits/fixtures/vector/*.lf2`: **schema 1**, written for other purposes.
  - `src/io/project/migrations.test.ts`, `migrate-v18-single-line-text-em.test.ts`: hand-shaped JSON (a current project with `schemaVersion` rewritten).
  - Only the first fixture is checked against an older build's burn, and only for text sizes. No test compares a whole job's G-code with what its saving release emitted.
- **Why it matters:** N4-P1-1 needed a frame saved by an old build and re-rendered. Hand-shaped JSON cannot catch a rule that changes in the layout code rather than in the file.
- **Smallest set that would have caught N4-P1-1:** one file, `src/__fixtures__/returning-user/1.0.27.lf2.gz`, saved by `adf300522`, with a sidecar of burn metrics (extent, length, dose per record) measured on that build.
  - Objects: Relief `{{csv:name}}` in a fixed 80 × 11 shrink frame, with records ANNA and Maximilian. That alone catches N4-P1-1 (39.588 → 29.612 mm).
  - To also cover this report's other changes, add: a Roboto bent record, a Grayscale image with Dot Width, a turned Pass-Through image, a resized rounded rectangle with placed tabs, a stretched sketch, and a CNC near-closed profile.
  - The test opens it through `deserializeProject` and `setProject`, compiles, and compares with the sidecar. A deliberate change updates the sidecar with an ADR number.
  - Add one such file per release at release time, and add a schema-19 file carrying a converted frame (R7-P1-1).
  - The harness of this audit produces them: `scratchpad\zz-r7-h\zz-r7-scenes.ts` and `zz-r7-matrix.test.ts`.
- **Evidence:** READ (fixture schema versions read with `node`).
- **Severity:** P3, test gap.
- **Refuter: CONFIRMED, P3 kept, with the count corrected.** "One fixture" is wrong: `src/__fixtures__/` has **6** `parent-saved-*.lf2.gz` files. The five others are schema 15, one relief object each, used by `src/io/project/project-relief-authoring-compatibility.test.ts` and `ReliefAuthoringDialog.test.tsx`, which compare objects and a field digest, not G-code. They too were saved by a parent commit, not a release. The conclusion holds: no test compares a whole job's G-code with what its saving release emitted. The emitter snapshots under `src/io/gcode/__snapshots__` are made by the current code and are not saved by a release.

## KNOWN re-observed

- **N4-P3-3 / ADR-682 Amd 1 Consequences.** A boxed record taller than the template rises above the frame top: "Hello" in the Relief 80 × 11 frame burns Y 349.500..360.456 against a top of 360 (0.456 mm), as the ADR states.
- **N4-P3-1.** A migrated Size can leave the shared range. Only the conversion was re-observed (14.706, 20); values near the range limit were not re-run.

## Refuted

The refuter refuted none of the 5 findings. The four items below were dropped by the auditor.

- **"GRBL Compatible files burn M4 on main" (raised, then dropped by the auditor).** The first run showed `M3 S0` → `M4 S0` on every Compatible file from 1.0.27. The store's current machine was then the default Dynamic profile, whose identity (`profileId|name|bed`, `project-bed-reconciliation.ts:318-320`) matches the file's. ADR-500 Amd 2 keeps the current machine there and says so in a toast naming "controller" (`project-actions.ts:113,186-196`). With the machine the file was made on already current, Compatible output is the same as 1.0.27's. Intended and announced. This is what a user with two dialects under one profile name meets; the toast's wording "controller" does not say the burn mode changed, which is not raised here because the label list is ADR-500 Amd 2's own.
- **"Marlin bed changes on open."** `workspace` 400 × 400 → 300 × 200 in the re-save comes from this harness giving the Marlin preset a default 400 mm workspace. The reconciliation is correct, and the G-code is unchanged.
- **"CNC feeds invented on open."** `machine.params.maxFeedMmPerMin` and `framingFeedMmPerMin` appear in main's re-save (undefined → 6000) on all three releases. The G-code is byte-identical, including across a re-save.
- **"Moving an old scaled shape rebuilds it and changes the burn."** A 1 mm move of a rounded rectangle saved at scale 2 × 1.5 keeps its spec, scale and length (336.386 mm). Only a resize rebuilds it, and tabs follow (see the matrix).

## Verified clean

- **Migration idempotence.** Every one of the 819 files re-saved on main, re-opened and re-saved gives byte-identical JSON, and its G-code equals main's first compile.
- **What the migration touches.** Across all files the only changed fields are `schemaVersion`; `sizeMm`, `lineHeight`, `letterSpacing`, `textBox.minSizeMm` and `textBox.legacyLineEm` on single-line text; plus the two harness and feed items under Refuted. No device, layer or object field is lost.
- **Text rebuilds.** Same-values rebuilds of plain, framed, bent and path text from 1.0.23 and 1.0.27 give the stored size in every case. Relief paths differ only numerically (rounding); the EMS fonts and outline text are identical.
- **Canvas against burn after opening.** For plain text, shapes and sketches, stored geometry extent equals burn extent within 0.2 mm on every file. Board-box files differ only because the board outline does not burn.
- **`.lf2` saved on main, opened on older builds.** `schema-too-new` / `sawVersion: 20` on 1.0.28, 1.0.27 and 1.0.23. The alert on `33bc394c6` and `adf300522` reads "This project was saved with a newer KerfDesk (schemaVersion 20). Update the app to open it." No data is touched.
- **Archived projects.** Inactive sheets and production designs stay at schema 18 inside the file and convert with `legacyLineEm` when opened. `retained-array-regeneration.ts:26` and `retained-array-capture.ts:112` deserialize their archives (READ). `fontKey` lives only on `TextObject`, and compound operands are `ImportedSvg`, so no unconverted text hides in other fields (READ).
- **Machine profiles.** A `kerfdesk.last-machine.v1` document written by each older build's `rememberLastMachine` loads on main with no field changed: A1 Pro preset, A1 Pro at 363 × 273, a custom GRBL (rear-right, homing, 7000 mm/min, S 255, Compatible, 57600 baud, M7), Marlin.
- **A1 Pro repair and notice.**
  - A 1.0.27 or 1.0.23 copy: `homing.enabled` false and no `kinematics` are **kept**, not silently repaired. `stalePresetCorrections` returns both corrections, and `detectPresetCorrectionWarnings` gives 2 warnings for Job Review; `PresetCorrectionOffer` offers them in Machine Setup. There is no notice at open. Output on the kept profile is byte-identical to 1.0.27, including automatic overscan at 45°.
  - A 1.0.28 copy at 358 × 268 with homing and CoreXY has no warnings.
  - A 1.0.28 copy widened to 363 × 273 has no stale-preset warning. ADR-637 Amd 4 gives the offer back at the next connect, the Job Review warning and the jog limit (READ; R6 owns the repro).
- **Material library.** A library written by each older build's `serializeMaterialLibrary` loads on main with both entries unchanged (`[]` diff), including power 77, speed 321, kerf 0.08, Dot Width 0.1.
- **Defaults.** `createLayer` for line, fill and image, `DEFAULT_CNC_LAYER_SETTINGS`, `DEFAULT_CNC_MACHINE_CONFIG`, `DEFAULT_DEVICE_PROFILE`, the machine catalog and the starter catalog are identical from 1.0.23 to main, except the A1 Pro catalog entry (homing, CoreXY, `catalogVersion`), which is the announced ADR-322 Amd 3. No default for existing operations changed.
- **1.0.23 order.** The 150 order-only pairs have the same extent, length and dose, and travel is shorter (for example 793.995 → 772.730 mm). ADR-669.

## Not verified

- **The app's UI.** Toasts and Job Review were read, not rendered. Stores ran headless, without a window.
- **Text worker.** jsdom has no Worker, so text used the in-process fallback, as the repo's own tests do. Font bytes came from each tree's own `fonts` folder.
- **Real images.** Images used a stub `dataUrl` and real `lumaBase64`, because compile reads the luma. A file from a real PNG import was not used.
- **Project construction.** Scenes were built with each older tree's real builders (`buildTextObject`, `createRectangle`, store actions) and saved through its `prepareProjectForPersistence`, but object fields were set in code rather than through dialogs.
- **CNC setup package.** Compared at G-code level (two-bit job identical), not by package bytes. `cncSetupPackage` wraps the same G-code; its default mode is READ only.
- **Not in the matrix:** relief, tiles, two-sided CNC, rotary, print-and-cut, camera-placed jobs, retained-array regeneration, 1.0.23 → 1.0.27 → main chains, a Linux or Mac file path, phone or MCP edits of migrated text, the A1 Pro's automatic overscan after accepting the correction (ADR-675 owns it), autosave slots written by older builds (READ: same `deserializeProject`, `autosave-record.ts:143`).
- **Hardware:** none, by instruction.

## Refuter method

- **Tree.** Judged on `945aa837b` (#1531, #1478). Main reached `f862d0d8d` (#1528, ADR-684) during the check; that diff touches Resume warnings only, with no output, migration or load-notice file.
- **Effect of #1478 on this report: none measured.** The auditor's matrix, re-run from fresh saves on real exports of `33bc394c6` and `adf300522` and opened on `945aa837b`, gives the same counts: 1.0.28 425 identical / 24 burn; 1.0.27 256 identical / 36 comment / 157 burn. Emitter v41 does not appear in the G-code. The 1.0.23 row was not re-run through that matrix.
  - **Not exercised:** neither set of scenes has what #1478 changed: a bowtie pocket at User Origin (ADR-327 Amd 1 correction, which can move an old CNC job's output) or Nearest point / Nearest corner refined routes (ADR-669 correction, order only). READ only; the coordinator may want L11 applied to the first.
- **Independent repro.** A separate harness with its own scenes and its own G-code parser, not the auditor's `zz-r7-diff.mjs` metric. 78 scenes saved by real exports of 1.0.23, 1.0.27 and 1.0.28, 1.0.27 → 1.0.28 chains, and 288 frames made on 1.0.28, opened through `deserializeProject` and `setProject`, compiled with `prepareOutputSnapshot` and `emitPreparedGcode`. It shared the font-loader stub and the bare-import resolver with the auditor's harness. Text used the in-process fallback and images a stub `dataUrl`, as in "Not verified". Dynamic machine only in this harness; the matrix re-run covers all 4.
- **Clean claims attacked.**

  | Claim | Result |
  |---|---|
  | 425 of 449 pairs byte-identical | Holds as a count on `945aa837b`. **Its wording does not generalise:** see R7-P2-1. In my wider frame set, 167 of 240 1.0.28 pairs are identical and every other pair is a Y move of a variable record in a frame; no size or dose change |
  | Direct route keeps every size | Holds: no variable record's width changed by more than 0.01 mm for 1.0.27 or 1.0.28 files, at any of 24 frames. Only images change dose |
  | 1.0.23 files show the same burn changes as 1.0.27 | Holds: the same 106 of my pairs on each |
  | Migration idempotence | Holds: 312 of my files (including chains) and 546 of the auditor's re-saved twice, byte-identical JSON |
  | Refusal on older builds | Holds: both files saved on main give `schema-too-new`, `sawVersion` 20 on 1.0.28, 1.0.27 and 1.0.23. The alert text is in the source of `adf300522` and `87ecb4f24` |
  | Device profiles unchanged after #1520 | Holds: last-machine documents for the A1 Pro preset, the default and a custom machine load with no field changed from all three releases. A 1.0.23 or 1.0.27 A1 Pro copy gives 2 corrections and 2 Job Review warnings; 1.0.28 gives none |
  | A1 Pro file output | Holds on a line job: the 1.0.27 and 1.0.28 files are byte-identical on their own machine, and also with main's A1 Pro preset current. The 1.0.23 file differs, not examined further (ADR-669 is the expected cause) |

- **KNOWN re-observed.** "Hello" in the Relief 80 × 11 frame burns to Y 360.456, as N4-P3-3 states.
- **Not checked by the refuter:** the auditor's sheets, production rows, material library, defaults diff, CNC scenes other than through the matrix re-run, and the rendered UI.
- **Clean-up.** The refuter's scratch folders and the auditor's `zz-r7-h` were checked for links and deleted.

## Repro files

All in `…\scratchpad\`, outside `j7-main` because the older trees also need them. Nothing in the repo was touched except this report. Commands ran one at a time as `node <j7-main>/node_modules/vitest/vitest.mjs run <file> --config zz-r7-vitest.config.ts`, with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048"` and `R7_SP`, `R7_TREE`, `R7_REL`, `R7_PHASE`, `R7_FROM`, `R7_ONLY`.

| File | What it did |
|---|---|
| `zz-r7-h\zz-r7-vitest.config.ts` | Points `@r7/` at one tree, resolves bare imports through `j7-main`'s `node_modules` without links |
| `zz-r7-h\zz-r7-scenes.ts` | The 75 scenes and 4 laser machines, built by the tree under test |
| `zz-r7-h\zz-r7-common.ts` | Save (`prepareProjectForPersistence`), open (`deserializeProject`, `setProject`), compile |
| `zz-r7-h\zz-r7-matrix.test.ts` | `save` and `open` phases; re-save check on main |
| `zz-r7-h\zz-r7-extras.test.ts` | Profiles, material library, defaults dump, the 1.0.28 chain, refusal, rebuilds, sheets, moves |
| `zz-r7-h\zz-r7-more.test.ts` | Production rows, further resize of tabbed rectangles |
| `zz-r7-h\zz-r7-diff.mjs`, `zz-r7-show.mjs`, `zz-r7-fields.mjs`, `zz-r7-def.mjs` | Classify G-code pairs, print deltas, field diffs of the re-save, defaults diff |
| `zz-r7-old\<sha>\` | Exports of the three releases; deleted at the end |
| `zz-r7-out\` | Saved files and G-code, 819 `.lf2` plus re-saves; deleted at the end |

`zz-r7-h\` has been deleted, along with the refuter's files. To reproduce R7-P1-1: on an export of `adf300522`, build `{{csv:name}}` in Relief, Size 10, centred, fixed 80 × 11 shrink frame, and save with `prepareProjectForPersistence`; on `33bc394c6`, open and save; on main, open and compile record 0.

```json
{
  "area": "R7",
  "id": "returning-user",
  "tree": "e617025eb",
  "refuter_tree": "945aa837b",
  "raised": 5,
  "confirmed": 5,
  "plausible": 0,
  "refuted": 0,
  "severity_changes": [],
  "p1": 1,
  "p2": 2,
  "p3": 2,
  "known": 2,
  "pairs": { "1.0.28": { "identical": 425, "burn": 24 }, "1.0.27": { "identical": 256, "comment": 36, "burn": 157 }, "1.0.23": { "identical": 106, "comment": 36, "order": 150, "burn": 157 } },
  "findings": [
    { "id": "R7-P1-1", "severity": "P1", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "1.0.27 frame saved through 1.0.28 keeps the em rule on main: ANNA 29.612 x 7.480 instead of 39.588 x 10.000, no warning; worst record shrinks to 66.1 % of its size. The #1507 harm, live on 1.0.28, unrepaired on main" },
    { "id": "R7-P2-1", "severity": "P2", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "Variable records move after the upgrade with no notice: bend to 38.6 mm, frame to 4.54 mm (2.27 mm from a 1.0.28 file), path 1.7 mm" },
    { "id": "R7-P2-2", "severity": "P2", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "Grayscale Dot Width +41 to +66 % and turned Pass-Through +38 % dose are announced only in 1.0.28's notes, which a skip to the next release never shows" },
    { "id": "R7-P3-1", "severity": "P3", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "The open toast does not explain Size 10 becoming 14.706 or 20" },
    { "id": "R7-P3-2", "severity": "P3", "evidence": "READ", "refuter": "CONFIRMED", "title": "Six parent-saved fixtures (five relief, one text), none from a release and none compared by whole-job G-code; smallest set proposed" }
  ],
  "same_burn": { "1.0.28": "same size; variable records in a frame move in Y to 2.27 mm when the template shrinks or the record wraps to more lines", "1.0.27": "yes at every size on a direct open, except the listed record moves and image dose fixes; no if saved through 1.0.28 (R7-P1-1)" }
}
```
