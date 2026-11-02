# Rolling audit v9 — R4 Text and frame fixes (#1523, #1519)

- **When:** 2026-11-02, morning +0800   **Tree:** origin/main @ `f862d0d8d` (repros in the scratchpad `j7-main` copy of that SHA).
  - Merge commits: #1523 `5f4050679`, #1519 `a00e097e8`.
  - Older code: `git archive` of 1.0.27 `adf300522` (schema 18) and 1.0.28 `33bc394c6` (schema 19), `src` plus `public/*.{mjs,json,js}`. Main is schema 20.
- **Scope:** fix verification (L10), siblings (L9) and returning-user files (L11) of:
  - **#1523** (ADR-682 Amd 1, schema 20, `legacyLineEm`): N4-P1-1, N4-P2-1, N4-P3-3.
  - **#1519** (ADR-591 Amd 2): N4-P1-2, N4-P1-3.
- **Lenses run:** L10 (all five checks), L9 (frame modes, alignments, fonts, narrow frames, every route that makes or outputs text), L11 (projects saved by the real older code, opened through `deserializeProject` and the real store's `setProject`), L7 (each PR's tests on its parent code).
  - Not run: L2, L5. No hardware was operated.
- **Repros:** six temporary Vitest files, one at a time, from `j7-main`, with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-r4-vitest.config.ts --disableConsoleIntercept --silent=false`. All are listed under "Repro files". Burn extents are read from emitted G1 moves. Frame coordinates: a text placed at X 100, Y 50 has its frame's left edge at G-code X 100 and its top at G-code Y 350.
- **Counts:** 12 raised → 0 refuted → **P1 2 / P2 3 / P3 7 after the refuter** (auditor's ratings P1 2 / P2 5 / P3 5), + 5 KNOWN re-observed.
  - **Refuter:** 11 confirmed, 1 plausible, 0 refuted, 0 found KNOWN. Two severity changes: **R4-P2-2 and R4-P2-5 lowered to P3.** One anchor of R4-P1-1 is withdrawn, and one claim in R4-P2-3 is refuted (see Refuted). See "Refuter method".
  - **Re-checked on main `54e0e19b8`.** No file under `src/core/text`, `src/ui/text` or `src/io/gcode`, nor `file-actions.ts`, `start-job-source.ts`, `vector-path-actions.ts` or `production-manifest-preparation.ts`, differs from the audited `f862d0d8d`.

## Headline

**Both PRs fix what they name.** N4-P1-1 holds on a direct open: across 56 scenes (48 variable, 8 plain) saved by the real 1.0.27 and 1.0.28, no record changes size. Boxed records share one baseline in 40, 50 and 80 mm frames. Bake, Production run, the jig and every plain-text output now warn, and the warnings fire truly on old projects that always lacked the glyph. All new tests fail on the parents. Checking 2,000 texts costs 8–18 ms.

**#1523 does not fully hold.** Moving each record to the shared baseline can push a record that fitted out of its frame.

- **R4-P1-1 (regression from #1523).** In a Casual Hand 80 × 11 shrink-to-fit frame, "Gypsy" fits at full size, ink 10.68 mm tall. 1.0.28 burns it at Y 339.320..350.000, inside the frame. Main burns the same file at **Y 335.448..346.128, 3.552 mm below the frame bottom**, a third of the tag's height. Start and Save say nothing. This also settles the 1.883 mm case R7 left to weigh: that was one instance, not the worst.

**#1519 holds for text, but the warning has gaps.**

- **R4-P2-2 (lowered to P3 by the refuter).** Convert to Path and Weld turn the text into paths with no warning, and output stops warning for good. The burn does not change.
- **R4-P2-3.** Save G-code raises one toast per copy. Only the newest three render, so three or more copies push out earlier Save warnings, such as `out-of-bed`, before anyone sees them. Job Review, `.rd` and tiled saves already remove repeats.

**Older siblings, not caused by either PR:**

- **R4-P1-2.** Auto width frames ignore their alignment for variable records: a centred "Al" burns 23.63 mm left of the template's centre, a right-aligned one 47.26 mm left of its right edge. Fixed and Auto height frames are exact.
- **R4-P2-1.** A record that overflows its frame burns past it with no Start or Save warning: 33.3 mm below a 10 mm frame, or 24.8 mm past a 30 mm width at the minimum size.
- **R4-P2-4.** Right-to-left on a single-line font burns a `?` at each end of every line.

## Fix verification (L10)

| Original finding | Before (N4, `08b5c669b`) | After (main `f862d0d8d`) | Siblings (L9) | Verdict |
|---|---|---|---|---|
| **N4-P1-1** Migrated single-line frames shrink | Relief 80 × 11 ANNA 29.612 × 7.480 | From a real 1.0.27 file: ANNA **39.588 × 10.000**, advisories `[]`. Same-values rebuild 77.276 × 11.000 = stored. 488 rows in 56 scenes on 1.0.27: no size change. Fixture test 6/6 | `legacyLineEm` survives every route tested (see "Verified clean"). **The 1.0.27 → 1.0.28 → main chain stays shrunken (KNOWN R7-P1-1).** Two frames with the same fields can differ 25 % (R4-P3-1) | **Holds on the direct route** |
| **N4-P2-1** Baselines split when the template shrinks | 40 and 50 mm: Al 342.500, Anna 342.793, anna 344.521, Peggy 340.757 | Roboto 40, 50 and 80 mm: **Al 342.202, Anna 342.104, anna 342.104, Peggy 340.068**, the same in all three. Relief, Casual Hand and Pacifico share one baseline too | **The shared baseline can leave the frame: R4-P1-1.** Baked records jump when edited (R4-P3-2) | **Fixed; regression at the frame bottom** |
| **N4-P3-3** Ågot over the frame top | Roboto 351.660 with the bottom-only flag | Still 351.660 and Relief 352.020, by decision. `overflow` now tests both ends (`text-box-render.ts:114`), and the rows preview reads "Overflow" (test 3/3) | The flag reaches only the rows preview, never Start or Save (R4-P2-1) | **Settled as the ADR says** |
| **N4-P1-2** Bake and Production run lose the warning | Bake "success"; rows `[]` | **Bake** "Zoë 李": warning toast naming 李, 222 G1, Start and Save warn. "李": warning, 0 G1, both warn. **Production:** row 2 "Zoë 李" warning, 222 G1; row 3 "李" warning, 0 G1; row 1 quiet. Start warns on both | SVG, DXF, PDF and print warn (repo test 4/4). `.rd`, tiled and worker Start and Save warn (repo test 2/2 + READ) | **Fixed** |
| **N4-P1-3** Jig "Café 李" silent | 5 contours, `[]` | Burns 993 G1, W 18.84; Start and Save: "Text “Café 李”: Pacifico has no 李; …". Panel hint shows (repo test 2/2) | Convert to Path and Weld still lose it (R4-P2-2) | **Fixed** |
| **Plain text at Start, Save, exports, print** (L3 design: dialog hint only) | No output check | Warns with the exact character, on outline and single-line fonts, embedded fonts, CNC | Repeats flood Save (R4-P2-3); two false alarms (R4-P2-5) | **Fixed, with noise** |
| **N4-P3-1** Migrated values out of range | Clamp at next edit | Unchanged (`migrate-v18-single-line-text-em.ts`, READ) | — | **Not addressed (KNOWN)** |
| **N4-P3-2** Remote and jig frames on the UI thread | 11 s at 500 characters | Unchanged: `render-styled-text.ts:33` calls `renderTextGeometry` in process (READ) | — | **Not addressed (KNOWN)** |
| **N4-P3-4** MCP descriptions do not say em | No "em" | Unchanged: `tool-info.ts:103` | — | **Not addressed (KNOWN)** |
| **N4-P3-5** Test gaps | Migration never re-renders a frame | Fixed for frames, Bake, Production and the jig; new gaps in R4-P3-4 | — | **Mostly fixed** |
| **N4-P3-6** Old Max-width frames on the canvas | Canvas stays on the old squeeze | Unchanged, no load re-render (READ) | — | **Not addressed (KNOWN)** |

**Test truth (L7).** The PR's tests ran on main and with parent files served through a Vitest `load` plugin (`R4_PARENT`).

| PR | Test file | Main | Parent code | Swapped in |
|---|---|---|---|---|
| #1523 | `single-line-frame-migration.test.ts` | 6/6 | **5 fail** | `stroke-font-text.ts`, `text-box-render.ts`, `VariableRowsPreview.tsx` from `5f4050679^1` |
| #1523 | `variable-text-placement.test.ts` | 15/15 | **2 fail** (40, 50 mm) | Same |
| #1523 | `text-box-render.test.ts` | 3/3 | **2 fail** | Same |
| #1523 | `VariableRowsPreview.test.tsx` | 3/3 | **1 fails** | Same |
| #1523 | `migrate-v18-single-line-text-em.test.ts` | 6/6 | not swapped | — |
| #1519 | `plain-text-missing-glyphs-output.test.ts` | 4/4 | **3 fail** (quiet control passes) | `output-text-renderer.ts` shimmed to `renderVariableText`; `bake-variable-text.ts`, `JigTextControls.tsx`, `production-manifest-actions.ts` from `a00e097e8^1` |
| #1519 | `bake-variable-text-glyphs.test.ts` | 3/3 | **2 fail** | Same |
| #1519 | `production-run-missing-glyphs.test.ts` | 3/3 | **2 fail** | Same |
| #1519 | `JigTextControls.glyph-hint.test.tsx` | 2/2 | **1 fails** | Same |
| #1519 | `export-artwork-glyphs.test.ts` | 4/4 | **3 fail** | Same |
| #1519 | `output-preparation-text-glyphs.test.ts` | 2/2 | **2 fail** | Same |

**L11, real older saves.** 56 scenes (48 variable, 8 plain) built and saved by each release's own `buildTextObject` and `prepareProjectForPersistence`, with its own G-code as the baseline. Variable scenes compile 10 records each.

| Saved by | Rows compared | Same | Position only | Size changed | Notes |
|---|---|---|---|---|---|
| 1.0.27 (schema 18) | 488 | 304 | 183 | 0 | The one further row reported is "李" in Pacifico, empty on both builds |
| 1.0.28 (schema 19) | 488 | 329 | 158 | 0 | Same empty row. 1.0.28 files have no `legacyLineEm`, correctly |

The moves are KNOWN R7-P2-1, except the crossings of the frame bottom in R4-P1-1.

**Warnings on old projects.** Plain "Zoë 李" in Pacifico and "Café 李" in Relief, saved by 1.0.27 and 1.0.28, burn the same on main and now warn in Start and Save. "Café" in Pacifico stays quiet. These are true alarms, once per text.

**ADR amendments against the code:**
- **ADR-682 Amd 1 D1, D2, D4:** match the code. "Turning the frame off and on again drops it" (`:50`) holds: 39.588 × 10 → 29.612 × 7.48.
- **ADR-682 Amd 1 D3 (`:64`):** "A record whose ink fills the frame's height cannot move without leaving the frame." The code tests exactly that with a 1e-7 mm tolerance (`text-box-render.ts:94`). A record 0.32 mm short of filling moves 3.872 mm and leaves the frame. The reasoning is not carried through (R4-P1-1).
- **ADR-682 Amd 1 Consequences (`:81-82`):** sizes hold, on the direct route. `:83-87` describes rising over the top and says nothing about the bottom.
- **ADR-591 Amd 2 D1–D3, D5:** match the code.
- **ADR-591 Amd 2 D4 against D1:** D1 limits output to "an output layer inside the output's scope" (`:33`), D4 warns for "every text in the row" (`:51`). The code follows each, so a row warns about text that does not burn (R4-P2-5).
- **ADR-591 Amd 2 Consequences (`:62-63`):** "named before every burn of a text, whichever route made it … as long as they burn through output". True for text objects. Text converted to paths and Resume's direct compile are outside it (R4-P2-2, R4-P3-5).

## Findings

### R4-P1-1 — A record that fits its shrink-to-fit frame is moved out of it: Casual Hand "Gypsy" burns 3.552 mm below an 11 mm frame, with no warning

- **Where:**
  - `src/core/text/text-box-render.ts:94`: only a record whose ink fills the frame stays put.
  - `:95`: `dy` is applied without checking the bottom, and the layout is not fitted again.
  - `:114`: only `overflow` is set, which only `VariableRowsPreview.tsx:267` reads.
  - `src/ui/text/render-variable-text.ts:52`.
- **Anchor:**
  - **Contract.** ADR-682 Amd 1 D3 (`docs/decisions/ADR-682-amendment-1-old-single-line-frames-and-record-baselines.md:64`), quoted above, and its reason: a record must not leave the frame.
  - **Contract.** ADR-682 D6 (`docs/decisions/ADR-682-text-size-is-the-em-and-variable-records-keep-their-baseline.md:82`): the record "moves inside the same frame".
  - **Twin.** The same file on 1.0.28, whose burn stays inside.
- **Scenario:**
  1. `{{csv:name}}`, EMS Casual Hand, Size 10, centred, fixed 80 × 11 frame, Shrink to fit. The tag's frame is Y 339..350.
  2. The literal template shrinks, so on 1.0.28 no name moved. Casual Hand's braces stand very tall, so on main the shared baseline sits low.
  3. "Gypsy" fits at Size 10, so the frame does not shrink it. Its ink is 10.68 mm tall in an 11 mm frame.
  4. It moves down 3.872 mm, off the tag. The canvas draws only the template. Advisories, Start and Save are empty.
- **Evidence:** REPRO, `zz-r4-c.test.ts` on real saves, `zz-r4-e.test.ts` on fresh frames, `zz-r4-d.test.ts` and `zz-r4-f.test.ts` for the sweep.

  | Frame, Casual Hand | Record | 1.0.28 or 1.0.27 burn | Main burn | Below the frame bottom | Warnings |
  |---|---|---|---|---|---|
  | 80 × 11, saved by 1.0.28 | Gypsy | 339.320..350.000 | **335.448..346.128** | **3.552 mm** | none |
  | 80 × 11, saved by 1.0.28 | Maximilian | 339.610..350.000 | 338.098..348.488 | 0.902 mm | none |
  | 80 × 12, new on main | Gypsy, Jay | not measured | 335.448.. | 2.552 mm | none |
  | 80 × 15, new on main | Peggy | not measured | 334.817.. | 0.183 mm | none |
  | 30 × 10, saved by 1.0.28 | Anna | −1.815 inside | | 0.457 mm | none |
  | 30 × 10, saved by 1.0.27 (legacy) | Zoë 李 | −0.938 inside | | 2.301 mm | glyph only |
  | 80 × 20, saved by 1.0.27 (legacy) | Anna | −3.629 inside | | 0.915 mm | none |

  - **Which fonts:** of the 25 fonts swept in shrink frames (40 × 12 up to 80 × 30), only EMS Casual Hand crosses more than 0.05 mm. Decorous crosses 0.041 mm from one legacy frame. All others read 0.000. Separately, Relief in a very small legacy 20 × 4 frame at its minimum size crosses 0.2 mm.
  - **Sizes do not change;** every width and height equals the older build's.
- **Severity:** P1 for the auditor, with one point for the refuter and coordinator to weigh.
  - The burn lands outside the frame the user typed, by up to 32 % of its height. Nothing warns before output, and the rows preview's "Overflow" is seen only in the text dialog. METHOD §3 has no reach clause, and Frame is not a warning.
  - The brief lists "a silent overflow" as P2, and N4-P3-3's rise over the top stayed P3. The auditor holds this above both for two reasons. The record **fits** at its own size, so the overflow is created by the app. And it is a regression from a build that burned it inside.
- **Novelty:** new. R7-P2-1's refuter recorded one bottom crossing (1.883 mm) and left it to R4. ADR-682 Amd 1 covers only the top.
- **Fix direction:** when the moved ink would cross the frame bottom, limit `dy` so the bottom stays inside, or fit the record again at the moved baseline. A record that would then cross the top keeps the frame's rule. Add Casual Hand 80 × 11 "Gypsy" to `variable-text-placement.test.ts`.
- **Refuter: CONFIRMED, P1 kept. One anchor withdrawn. The fix needs a maintainer decision, because it trades against L3-P2-5.**
  - **What would make it false:** the ADR asks for this burn, so it is not wrong; or a clear warning reaches the operator first.
  - **Own repro.** `zz-r4r-save.test.ts` ran on a real export of 1.0.28 (`33bc394c6`), built and saved the tag with its own code, and recorded its own G-code. `zz-r4r-a.test.ts` opened that file on main (schema 19 → 20). Gypsy 339.320..350.000 → **335.448..346.128**; Maximilian 339.610..350.000 → 338.098..348.488. Advisories, Start and Save are `[]` for every record.
  - **#1523's parent.** `git diff 33bc394c6 5f4050679^1` over `src/core/text`, `render-variable-text.ts` and `build-text-object.ts` shows only 10 added lines in `cnc-stroke-font.ts`, so 1.0.28 stands for the parent.
  - **Reach.** My sweep on new frames (8 fonts × 6 frames, `zz-r4r-c.test.ts`) crosses only in EMS Casual Hand: 80 × 11 Gypsy 3.552, Maximilian 0.902; 80 × 12 and 40 × 12 Gypsy, Jay 2.552; 80 × 15 Peggy 0.183. The auditor's new-frame figures hold. Its legacy rows and the 25-font sweep were not re-run.
  - **Mechanism.** The template shrinks to Size 9.242, with its baseline 9.752 mm down. Scaled to Size 10 that is 10.552 mm down an 11 mm frame, which leaves 0.448 mm for Gypsy's 4.000 mm descender. Peggy, 11.000 mm tall after shrinking, hits the fill test and stays inside; Gypsy, 10.680 mm tall, moves out.
  - **Which is right.** The ADR does not settle it.
    - **Anchor withdrawn:** ADR-682 D6 "moves inside the same frame" (`:82`) no longer applies. Amd 1 D3 says it "replaces the first two bullets of Decision 6".
    - **The code follows D3's rule to the letter:** records the frame gives one size share a baseline, and Gypsy sits on it (Y 339.448, with Anna and Al).
    - **But D3's reason is a record must not leave the frame,** and D4 and the Consequences accept a crossing at the top only. No text accepts the bottom, and the amendment's tests never place a Casual Hand record. This is a gap, not a decision.
    - **L3-P2-5** asks that baselines stop jumping and says nothing about leaving a frame.
    - **LightBurn does not settle it.** Its text reference has no frame or shrink-to-fit, only an anchor: "Align Y determines the vertical anchor position of the text" ([docs 2.1](https://docs.lightburnsoftware.com/2.1/Reference/Text/), fetched 2026-11-02).
  - **Is a frame shown?** Not on the canvas: under `src/ui`, only the text dialog, the on-canvas editor's draft values, text rendering and `ui-store.ts` read `textBox`. It is typed in the dialog and drawn in the dialog's preview of the template (`TextBoxFields.tsx:135`), and the design rule covers what is "typed" as well as what is shown. Here the canvas also agrees: the template's stored ink is 0..11 mm, Y 339..350, so the burn leaves what the app draws by the same 3.552 mm.
  - **Warning.** None. After the move `overflow` is true for Gypsy and Maximilian, but only the rows preview reads it, inside the text dialog, and opening a file does not open that dialog.
  - **Why it is not lowered.** N4-P3-3's P3 rests on an ADR decision about the top edge. This record passed Shrink to fit, the app then moved it out, and 1.0.28 burned it inside. METHOD §3 has no reach clause, so one font does not lower it.
  - **Fix direction, for the maintainer.** The auditor's clamp puts Gypsy's baseline 3.552 mm above Anna's, which reopens N4-P2-1 for names with descenders. Fitting it again keeps the shared baseline but shrinks the name to about Size 7.56 (calculated, not run). A warning alone would leave the burn outside the frame.

### R4-P1-2 — Variable records in an Auto width frame ignore the alignment: a centred name burns 23.63 mm left of the template's centre, a right-aligned one 47.26 mm left of its right edge

- **Where:**
  - `src/ui/text/render-variable-text.ts:56`: every framed record returns `transform: text.transform`, so `anchoredVariableTextTransform` never runs.
  - `src/core/text/text-box-render.ts:27,47`: in Auto width the frame is each record's own width, so its alignment anchor differs per record.
  - The mode is on offer at `src/ui/text/TextBoxFields.tsx:176`.
- **Anchor:**
  - **Contract.** ADR-682 D6 (`…keep-their-baseline.md:80-81`): "A frame's anchor is its alignment point on the first baseline".
  - **Contract.** ADR-682 D5 and L3-P1-2, the same harm in bent text.
  - **Twin.** The same record with no frame, and in an Auto height frame.
- **Scenario:** a Roboto name tag placed centred, with Text box on and mode Auto width. The canvas draws the template centred at X 128.106. Every record starts at the template's left edge instead.
- **Evidence:** REPRO, `zz-r4-e.test.ts` E1. Roboto, Size 10, frame at X 100. Relief behaves the same (`zz-r4-d.test.ts` D2).

  | Alignment, frame | Template | Al | Anna | Maximilian |
  |---|---|---|---|---|
  | Centre, no frame | centre 127.785 | 127.481 | 127.588 | 127.867 |
  | Centre, Auto height | centre 140.000 | 140.000 | 140.000 | 140.000 |
  | **Centre, Auto width** | **centre 128.106** | **104.475** | **111.499** | **124.278** |
  | Right, no frame | right 155.57 | right 155.14 | right 155.35 | right 155.22 |
  | **Right, Auto width** | **right 156.21** | **right 108.95** | **right 123.00** | **right 148.56** |

  Advisories, Start and Save are `[]`. 1.0.27 and 1.0.28 burn the same X (`zz-r4-c.test.ts`: dx 0), so this predates both PRs.
- **Severity:** P1. Position differs from the canvas by the same harm and size as L3-P1-2 (17–23 mm), with no warning.
- **Novelty:** new. `docs/audits/**` and `docs/decisions/**` never mention auto width.
- **Fix direction:** for an Auto width frame, return no fixed transform, so the record takes the template's anchor as unframed text does.
- **Refuter: CONFIRMED, P1 kept, not KNOWN.**
  - **What would make it false:** the mode cannot be reached, it is already known at P3, or Auto width is meant to hold the left edge.
  - **Own repro** (`zz-r4r-a.test.ts`, Roboto, on main): centre template 128.106, Al 104.475, Anna 111.499, Maximilian 124.278. Right template edge 156.211, Al 108.950, Anna 122.998, Maximilian 148.555. Auto height centres every record on 140.000; no frame lands at 127.481..127.867. Left alignment is correct, and all warning lists are empty. The result is the same with Wrap and Shrink left on from the default box.
  - **Reachable:** the Sizing list offers it for any text (`TextBoxFields.tsx:176`), with nothing that excludes variable text. A new box starts as Fixed, so the user must choose it.
  - **Not KNOWN.** No earlier report mentions Auto width. The 12.8 mm short-record case is v8 N4-P3-6 (not R7), from L3-P3-1's Max width squeeze. It stayed P3 because it needs an old file and every record then burned at the frame's alignment point. Here a new project is affected, and each record lands somewhere different according to its length.
  - **Is the left edge intended?** No text says so. `finishTextBoxRender` computes the anchor at the frame's centre or right edge (`text-box-render.ts:47`), as D6 says, and `render-variable-text.ts:56` then discards it by returning a fixed transform. The tooltip, "Auto width grows naturally", gives no direction. Retyping plain text in place drifts in a similar way (ADR-682 Consequences), but that shows on the canvas at the edit; a record never does.
  - **Severity:** the same harm and size as L3-P1-2, position against the canvas with no warning. 1.0.28 has the same fixed transform (READ), so this is not a regression. That does not lower it.

### R4-P2-1 — A variable record that overflows its frame burns past it, and neither Start nor Save says so

- **Where:**
  - `src/core/text/text-box-render.ts:61,114` sets `overflow`.
  - `src/ui/text/VariableRowsPreview.tsx:267` is its only reader for records.
  - `src/io/gcode/prepare-output-snapshot.ts:244-250` passes only missing characters to output.
  - `src/ui/text/TextBoxFields.tsx:39`: the dialog says overflow "stays visible and remains in output", which is true for the plain text drawn on the canvas, not for records.
- **Anchor:**
  - **Contract.** ADR-682 Amd 1 D4 (`:69`): "the frame says so", and only the rows preview does.
  - **Twin.** A record's missing glyph is named at Start and Save (ADR-591 Amd 1 D4). A record's overflow is not.
- **Scenario:** a batch of name tags in a jig. One long name overflows. The canvas draws only the template. The operator gets no warning unless the rows preview was open at that row.
- **Evidence:** REPRO, `zz-r4-d.test.ts` D1, Size 10, frame top Y 350. Warnings count every advisory, Start and Save message: 0 in every row below.

  | Font, frame, mode | Record | Burn | Past the frame |
  |---|---|---|---|
  | Roboto, 30 × 10, no fit, wrap | Maximilian Alexander | 26.187 × 43.305 | **33.31 mm below** |
  | Roboto, 30 × 10, no fit, no wrap | Maximilian Alexander | 94.541 × 7.598 | **64.54 mm right** |
  | Roboto, 30 × 10, shrink at min 2 mm, no wrap | Maximilian Alexander von Hohenzollern-Sigmaringen the Third | 54.828 × 1.916 | **24.83 mm right** |
  | Roboto, 5 × 10, shrink, wrap | Same | 4.792 × 30.261 | 20.26 mm below |
  | Casual Hand, 30 × 10, no fit, wrap | Maximilian Alexander | 28.04 × 46.68 | 36.68 mm below |

- **Severity:** P2, the brief's "silent overflow". The frame is user-declared, and the policy of keeping the text in output is deliberate; the missing part is the notice.
- **Novelty:** new for records. L3 refuted "text box overflow is hidden" on the dialog preview (`L3-text-typography.md:483`), which does not reach a record at output.
- **Fix direction:** return the overflow from `renderVariableText` and add a `variable-text-overflow` advisory at Start and Save: "Variable text “…” (CSV record 7) overflows its frame by 33 mm."
- **Refuter: CONFIRMED, P2 kept.**
  - **Own repro** (`zz-r4r-a.test.ts`): 26.187 × 43.305 (33.305 below), 94.541 wide (64.541 right), 54.828 wide at the minimum size (24.828 right), Casual Hand 28.04 × 46.68 (36.68 below). Advisories, Start and Save are `[]`.
  - **Job Review: the flag cannot reach it.** `materializeVariableText` copies only `bounds`, `transform`, `paths` and the glyph advisory into the output object (`prepare-output-snapshot.ts:244-262`), so `textBoxLayout` is dropped there. Job Review builds its list from prepared warnings. Under `src`, only `VariableRowsPreview.tsx` reports a record's flag.
  - **Why not P1, unlike R4-P1-1:** here the record does not fit at any size the user allowed, and the dialog says in general terms that overflow "remains in output". That is not a warning about this record, so the gap stays a real P2.

### R4-P2-2 — Convert to Path and Weld drop the missing-glyph warning: nothing at the conversion, and output stops warning

- **Where:**
  - `src/ui/state/vector-path-actions.ts:173-197` (`convertSelectionToPathMutation`) and `:202` (`weldSelectionMutation`).
  - `src/io/gcode/prepare-output-snapshot.ts:135,226` (output checks `kind === 'text'` only).
  - Other routes that convert text, READ only: `optimize-shapes-plan.ts:178`, `warp-deform-plan.ts:166`, `trim-shapes-actions.ts:203`.
- **Anchor:** Contract. ADR-591 Amd 1 title, "a warning wherever text is made or burned", and Amd 2 D4, "Each route says so as it makes the text". Twin: Bake, which says so as it fixes a record's geometry.
- **Scenario:** Pacifico "Café 李" in a project. Start warns. The operator converts it to a path or welds it. Toasts: none. Start now warns nothing, and the content is gone from the file.
- **Evidence:** REPRO, `zz-r4-b.test.ts` B6, real store:
  - Before: 279 G1 with the advisory.
  - Convert: kinds `["imported-svg"]`, toasts `[]`, 279 G1, advisories `[]`.
  - Weld of two such texts: `["imported-svg"]`, toasts `[]`, 325 G1, advisories `[]`.
- **Severity:** P2. The burn lacks the character with no warning at that point. The main dialog did show a hint when it was typed, so a warning has usually been given once. A user who opens an older file and converts it has seen none.
- **Novelty:** new. The ADR's "as long as they burn through output" does not name it.
- **Fix direction:** in each route that replaces text with paths, run `plainTextGlyphIssue` and raise a warning toast naming the characters, as Bake does. The store action is synchronous, so check before the mutation in the command.
- **Refuter: CONFIRMED, lowered to P3.**
  - **Own repro through the store's real commands** (`zz-r4r-b.test.ts`): Convert gives `["imported-svg"]`, toasts `[]`, advisories `[]`, 279 G1 and X 100..118.84, the same as before. Weld gives the same empty lists. The command in `command-families.ts` calls the same action with no check of its own.
  - **Why P3:** the burn is unchanged by the conversion and matches what the canvas already draws, because the character was already absent from the geometry. Nothing new is lost at that step. Bake differs: a record's geometry was never on the canvas before it was baked, so Bake's warning is the operator's first sight of it.
  - **Earlier warnings do cover it in normal use.** The text dialog's `FontUsageHint` names the character while it is typed (`TextFormattingFields.tsx:38`), and Start warns until the conversion. The remaining gap is an older file converted before any Start.
  - **Contract:** Amd 2's D4 route list is closed and its Consequences speak of "a text". A path is not one, so this is a gap in coverage rather than a broken clause.

### R4-P2-3 — Repeated copies flood Save G-code with one toast each, and exports and production rows with one long toast

- **Where:**
  - `src/ui/app/file-actions.ts:328`: `for (const warning of machineWarnings) ctx.pushToast(warning, 'warning')`.
  - `src/io/gcode/prepare-output-snapshot.ts:144-160`: one advisory per object, with no repeat check.
  - `src/ui/app/export-artwork-svg.ts:98`, `src/ui/state/production-manifest-actions.ts:199`.
- **Anchor:** Twin. `src/io/rd/emit-rd.ts:73` (`withoutRepeats`), `src/ui/app/save-tiled-gcode.ts:127-129` (`dedupe` true), `src/ui/laser/job-review/job-review-model.ts:123,215` (`uniqueReviewWarnings`).
- **Scenario:** a 200-copy array of "Café 李" in Pacifico, saved as G-code. The store holds 200 identical warning toasts, each for 8 s, and three render (corrected by the refuter). An SVG export's done toast carries 200 sentences.
- **Evidence:** REPRO for the list, READ for the toast loop. `zz-r4-b.test.ts` B4: `{"adv":200,"uniq":1,"start":200,"save":200,"saveChars":14599}`. Job Review removes the repeats (READ). The copies are clones in the test, not made through the Array dialog.
- **Severity:** P2. A visible wrong behaviour, and the noise the brief warns about. Nothing burns wrong.
- **Fix direction:** remove repeats in `withTextAdvisories`, or in `textGlyphAdvisories`, and in `glyphWarnings`. Better, count them: "Text “Café 李” (200 copies): …".
- **Refuter: CONFIRMED, P2 kept, with the harm restated.**
  - **Own repro:** 1, 4 and 200 copies give 1, 4 and 200 advisories, all the same text, in Start and Save (`zz-r4r-b.test.ts`).
  - **Corrected:** 200 toasts do not stack up. `Toasts.tsx:22,25` renders only the newest three. Rendering the real component with 201 toasts in the store showed three identical lines (`zz-r4r-d.test.tsx`).
  - **The real harm is what those three push out.** Save pushes its preflight advisories and "Saved G-code" first, then the glyph lines. All the timers run for the same 8 s, so older toasts expire unseen. With five copies, one of them off the bed, Save prepares `out-of-bed` advisories and five glyph lines, and by that order the advisories are the ones hidden (order READ, list REPRO). Removing repeats fixes this for copies only: three different texts with missing characters still push them out. The order of the Save toasts needs fixing too.
  - **Exports:** one toast carrying every sentence, in a list limited to 180 px that scrolls (`Toasts.css:6-7`). That part is noise only.

### R4-P2-4 — Right-to-left on a single-line font burns a `?` at each end of every line, and the warning names two invisible characters

- **Where:**
  - `src/core/text/text-style.ts:30,40`: `styledTextContent` wraps each line in U+202B and U+202C.
  - `src/core/text/stroke-font-text.ts:179` (`glyphForCharacter` falls back to `?`).
  - The single-line route has no bidi handling, so the order is not reversed either.
- **Anchor:** Contract. ADR-591 Decision, unsupported glyphs are warnings, not added ink. Twin: the outline route consumes both characters (`glyph-coverage.ts:23`, `ignoreLayoutControls`).
- **Scenario:** Relief text "Straße" with Right-to-left on. Burns `?Straße?`, left to right. The warning reads "Relief SingleLine has no U+202B U+202C; each engraves as ?."
- **Evidence:** REPRO, `zz-r4-b.test.ts` B1 and `zz-r4-e.test.ts` E8:
  - Relief: 118 → 174 G1, width 28.83 → 38.69 mm.
  - Nixish: 136 → 188 G1, width 32.03 → 43.57 mm.
  - `AB⏎CD` in Relief: 70 → 182 G1, width 12.03 → 21.64.
  - A variable record does the same.
  - Pacifico stays 442 G1, with no warning.
- **Severity:** P2. The warning at Start is honest but unreadable, and the burn is plainly wrong. Before #1519 plain text had no output warning at all, so #1519 improves this.
- **Novelty:** new. `forceRtl` and "Right-to-left" appear nowhere in `docs/audits/**`.
- **Fix direction:** skip the wrappers for single-line fonts and either reverse the line or disable the option there with a tooltip. Never draw default-ignorable characters as `?`.
- **Refuter: CONFIRMED, P2 kept.**
  - **`?` really burns.** Right-to-left "Straße" gives the same G1 count and width as the literal text "?Straße?": Relief 174 G1, 38.69 mm; Nixish 188 G1, 43.565 mm (plain: 118 and 136 G1). The same match shows the order is not reversed. Pacifico is unchanged at 260 G1 with no warning.
  - **The warning is true but not clear:** "Relief SingleLine has no U+202B U+202C; each engraves as ?." It reaches Start and Save, but it does not mention Right-to-left, and the user typed neither character.
  - **Why not P1:** a warning that names the outcome arrives before output, and plain text's stored geometry already holds the `?`, so the canvas draws it (READ).

### R4-P2-5 — Two false alarms: a production row warns about text on a layer that does not burn, and a space an empty `.notdef` font lacks is reported as a missing character

- **Where:**
  - `src/ui/state/production-manifest-preparation.ts:65`: no layer check, unlike `withTextAdvisories` (`prepare-output-snapshot.ts:144-160`).
  - `src/ui/text/output-text-renderer.ts:34` and `src/core/text/glyph-coverage.ts:13`: a Zs space counts like any character.
- **Anchor:** Contract. ADR-591 Amd 2 D1 (`:33`), "on an output layer inside the output's scope"; and the sentence's claim that a character "engraves as a box". Brief: "whitespace and control characters (no false warnings)", "hidden or disabled text (must not warn)".
- **Evidence:** REPRO.
  - **Row.** `zz-r4-b.test.ts` B5, layer `output: false`: `["Text “Café 李” (production row 2): Pacifico has no 李; …"]`. Output of the same project gives 0 G1 and no advisory.
  - **Space.** `zz-r4-e.test.ts` E7:
    - Cinzel Decorative, A + U+00A0 + B (the only bundled font with no U+00A0): 127 G1, the same as "A B", yet warns "has no U+00A0; each engraves as a box, or not at all".
    - Pacifico with U+2009, U+2003 or U+3000: 188 G1, the same as "A B", and it warns (`zz-r4-a.test.ts` A2).
    - Fonts with a drawn `.notdef` are true alarms: Poppins U+2009 burns a box, 78 against 62 G1, and warns.
  - A non-breaking space is common in text pasted from a browser or a word processor.
- **Severity:** P2 by the brief's "false or misleading warning". Both are narrow. A refuter may reasonably hold them at P3.
- **Fix direction:** give production rows output's layer filter. For a Zs character, warn only when the font's `.notdef` has ink.
- **Refuter: CONFIRMED, lowered to P3.**
  - **Row, own repro:** on a layer with Output off, `productionRowGlyphWarnings` returns "Text “Café 李” (production row 2): …", while output gives 0 G1 and no advisory. This follows Amd 2 D4 ("every text in the row") against D1, so it is a conflict inside the ADR. It needs a production row that holds unburned text with a missing character.
  - **Space, own repro:** Cinzel Decorative with U+00A0 and Pacifico with U+2009 burn the same G1 and width as a plain space, and warn. Roboto, Pacifico and Great Vibes stay quiet on U+00A0, which supports the auditor's report that Cinzel is the only bundled font lacking it.
  - **Why P3:** nothing burns wrong, and neither case is one an ordinary user will often meet. The space message is also literally true: the font has no such glyph, and it engraves "not at all".

### R4-P3-1 — `legacyLineEm` is invisible: two frames with the same fields burn 25 % apart, and turning the frame off and on changes the size

- **Where:** `src/core/text/stroke-font-text.ts:57`; `src/ui/text/TextBoxFields.tsx:9-30` (the checkbox builds a new frame without it). No field or tooltip shows the rule.
- **Anchor:** Twin. A new frame with the values the dialog shows.
- **Evidence:** REPRO, `zz-r4-c.test.ts` C2, from a real 1.0.27 file:
  - Migrated Relief frame (Size 14.706, 80 × 11): record ANNA 39.588 × 10.000.
  - New frame with the same displayed values: **29.612 × 7.480**.
  - Frame off and on: 29.612 × 7.480, as ADR-682 Amd 1 `:50` says.
- **When it ends:** only there. Content, font and mode edits, remote `update_text`, the jig, paste, Duplicate, resize and a re-save all keep it. A change of font keeps the old value too (Relief's 0.68 on Nixish), which only affects the fit comparison.
- **Severity:** P3. Each change shows on the canvas at the edit, and the design is deliberate. A copied frame keeps the rule, so a surprise needs a frame rebuilt beside an old one.
- **Fix direction:** a small note in the frame section when the field is set, with a "Use the current line rule" action.
- **Refuter: CONFIRMED, P3 kept.** Own repro from the repo's parent-saved fixture: the migrated Relief 80 × 11 tag burns ANNA 39.588 × 10.000, and a new frame with the same displayed values burns 29.612 × 7.480. The checkbox builds a new frame with no `legacyLineEm` (`TextBoxFields.tsx:17-26`, READ), and ADR-682 Amd 1 states that outcome.

### R4-P3-2 — A baked framed record jumps when edited: the shared baseline is lost on any rebuild

- **Where:** `src/ui/app/bake-variable-text.ts:36-48` keeps the record's moved geometry. `src/ui/text/build-text-object.ts` then renders with no template.
- **Anchor:** Twin. The burn before and after a same-values edit.
- **Evidence:** REPRO, `zz-r4-e.test.ts` E3. Casual Hand 80 × 11 "Gypsy": record and baked text both burn 335.448..346.128; a same-values edit burns 339.32..350, a 3.87 mm jump. The same applies to Production rows that are edited (READ).
- **Severity:** P3. It shows on the canvas at the edit.
- **Fix direction:** keep the record's baseline offset on the baked text, or document it.
- **Refuter: CONFIRMED, P3 kept.** Own repro through `bakeSelectedVariableText`: Gypsy's record and baked text burn 335.448..346.128, and a same-values rebuild burns 339.320..350.000. Fixing R4-P1-1 changes these numbers but not the mechanism.

### R4-P3-3 — A font that maps a character to an empty glyph burns nothing and warns nothing: Italianno `_`

- **Where:** `src/core/text/text-to-polylines.ts:262` (`charToGlyphIndex > 0` counts it as covered).
- **Anchor:** Contract. ADR-591 Amd 2 D1. The character engraves as nothing.
- **Evidence:** REPRO, `zz-r4-a.test.ts` A3, sweep of U+0021..U+024F in the 21 outline fonts: one case. `zz-r4-e.test.ts` E7: "A_B" in Italianno burns the same 256 G1 as "A B", width 21.78, advisories `[]`.
- **Severity:** P3. One character in one bundled font.
- **Fix direction:** treat a mapped glyph with no contours as missing, except for space characters.
- **Refuter: CONFIRMED, P3 kept.** Own repro: Italianno "A_B" and "A B" both burn 256 G1 with no advisory. The width differs, 21.78 against 15.01 mm, because the underscore keeps its advance. The 21-font sweep was not re-run.

### R4-P3-4 — Test gaps behind this report

- **Where:**
  - `variable-text-placement.test.ts` uses Roboto for its 40, 50 and 80 mm frames, so no case crosses the bottom (R4-P1-1). `single-line-frame-migration.test.ts` checks placement on the Relief tag only, and only the sizes of the Casual Hand tag.
  - No test covers Auto width records (R4-P1-2), overflow at Start or Save (R4-P2-1), Convert or Weld of a text with a missing glyph (R4-P2-2), repeats (R4-P2-3), or a row on a non-output layer (R4-P2-5).
- **Evidence:** READ, plus every repro above passing on main's suite.
- **Severity:** P3.
- **Refuter: CONFIRMED, P3 kept.** `auto-width` appears in repo tests only in `text-box-layout.test.ts`, which checks layout and compiles no record. `variable-text-placement.test.ts` has no Casual Hand frame, and every R4 scenario above passes through main's code with no test objecting.

### R4-P3-5 — Resume compiles without the glyph check, and ADR-591 Amd 2's Consequences read wider than the code

- **Where:** `src/ui/laser/start-job-source.ts:376` calls `prepareStartJob`, whose `prepareOutput` at `start-job-readiness.ts:206` has no `withTextGlyphCheck`. Off-thread and timed recoveries do pass through the check. The CNC recovery flows reuse an earlier source or compile on their own (READ, not followed further).
- **Anchor:** Contract. ADR-591 Amd 2 Consequences (`:62-63`).
- **Scenario:** a Resume of a small job with a missing glyph, in a later session. The recovery review names nothing, though Start did the first time.
- **Evidence:** READ.
- **Severity:** P3. Start named it before the first burn of the same text.
- **Fix direction:** add the check there, or name Resume in the Consequences.
- **Refuter: PLAUSIBLE, P3 kept.** READ only, recovery not driven. `start-job-source.ts:376` is the path taken when a recovery has no time bound and the job is small enough for the browser thread, and `prepareStartJob` calls plain `prepareOutput` (`start-job-readiness.ts:206`). The only other callers of `prepareStartJob` under `src/ui` are test helpers.

## KNOWN re-observed

- **R7-P1-1.** A 1.0.27 file saved through 1.0.28 has no field to recover. Not re-run; the 56 scenes saved directly by 1.0.28 have no `legacyLineEm`, as ADR-682 Amd 1 `:46-48` says.
- **R7-P2-1.** Records move with no notice: 183 of 488 rows from 1.0.27 and 158 of 488 from 1.0.28, all Y only. Relief 80 × 11: ANNA −0.500, Anna −0.574, Hello +0.456.
- **N4-P3-3.** Roboto Ågot 351.660, Relief 352.020, Pacifico 352.620 against a top of 350, by decision. Great Vibes "Gypsy" rises 0.930 mm.
- **15-P3-1.** Jig route "Café 李" W 18.84 against the main route, as N4.
- **N4-P3-1, P3-2, P3-4, P3-6.** Unchanged (READ).

## Refuted

- **"Schema 19 misses Size-scaled Bold on single-line text."** `emboldened` returns open paths untouched (`text-style.ts:103-110`), and all stroke glyphs are open.
- **"Text under a parent layer with Output off and a sub-layer on burns unwarned."** `layerFromSubLayer` gives `output: layer.output && subLayer.enabled` (`layer.ts:434`), so it does not burn.
- **"NFD text warns falsely on U+0301 or U+0308."** Dialog text and CSV records in NFD burn exactly as their NFC forms with no warning, in Roboto, Pacifico, Poppins, Parisienne, Cinzel, Courier Prime, Relief and Nixish (`zz-r4-b.test.ts` B2). The jig and remote routes normalise too (`jig-text-object.ts`, `text.ts:30`, `text-edit.ts:36`, READ), and so do records (`evaluate-template.ts:51`).
- **"Unselected text warns under Cut Selected Graphics."** Only the selected text's advisory appears, on snapshot and non-snapshot routes (B3).
- **"The check slows large jobs."** See below.
- **"Job Review shows 200 lines."** `uniqueReviewWarnings` removes the repeats (READ). The flood is limited to Save G-code and the toasts in R4-P2-3.
- **"A cached render ignores `legacyLineEm`."** `render-variable-text.ts` caches on the whole `textBox`, and the text worker has no field list (`grep minSizeMm`).
- **"`get_text` schema rejects the new field."** No `textBox` field in `electron/mcp` (`grep`).
- **"200 identical toasts stack up" (refuter, part of R4-P2-3).** `Toasts.tsx` renders the newest three. The finding stands on what those three hide.
- **ADR-682 D6 "moves inside the same frame" as an anchor for R4-P1-1 (refuter).** Amd 1 D3 replaces that bullet. The finding stands on D3's reason, the typed frame, the canvas and the 1.0.28 twin.

## Verified clean

- **`legacyLineEm` routes,** from a real 1.0.27 Relief 80 × 11 file (`zz-r4-c.test.ts` C2). All keep 0.68:

  | Route | Result |
  |---|---|
  | Same-values dialog rebuild | 77.276 × 11 stored, ANNA 39.588 × 10 |
  | Content edit | field kept |
  | Font to Nixish, to Roboto, back to Relief | field kept; back gives 77.276 × 11 and 39.588 × 10 |
  | Mode to Auto height | ANNA 39.588 × 10 |
  | Copy and Paste, Duplicate | ANNA 39.588 × 10 |
  | Selection resize × 2 | field and frame kept, ANNA 79.176 × 20 |
  | Re-save and reload on main | schema 20, field kept, not migrated again |
  | Jig edit of a plain frame | 39.588 × 10 |
  | Remote `update_text` text, then font | field kept, 38.529 × 10, 44.389 × 9.81 |
  | SVG export | no `<text>`, 39.588 × 10 mm. Not re-imported |

- **New projects:** schema 20, no `legacyLineEm`, em rule (Relief 80 × 10 ANNA 26.92 × 6.8), and it stays absent after a reload.
- **Frame modes:** Fixed and Auto height are exact at left, centre and right (centre 140.000 for every record). `TextBoxSettings` has no vertical alignment, so there is none to test. Multi-line, line height and letter spacing on real older files have no size change.
- **Whitespace and controls on outline fonts:** TAB, CRLF, ZWSP, ZWJ, soft hyphen, VS16, RLM and BOM give no warning and no ink. VT, FF, U+2028 and U+0085 warn truly on Roboto (a box, 77 against 61 G1). Whitespace-only text is refused by the dialog.
- **Emoji and marks:** 😀, 👍🏽, flags, Arabic and Hebrew warn in fonts lacking them, naming each code point. "x" + U+0301 and keycap sequences behave truthfully.
- **Layers and fonts:** `output: false` gives 0 G1 and no warning. `visible: false` still burns (279 G1) and warns. Text with no matching layer stays quiet. An embedded font's warning names its file ("MyShop.ttf has no 李"). An embedded font that is gone: plain text burns and is not checked, as Amd 2 D1 says; a variable record refuses, naming the font. CNC text warns.
- **Output routes:** Start and Save on the browser thread, the worker's `start`, `save`, `tiles`, `rd` and `prepare` (`output-preparation.ts:216-219`), direct `.rd` (`save-rd-action.ts:66-68`) and tiled (`save-tiled-gcode.ts:169`). A `grep` of `prepareOutput`, `prepareStartJob` and `emitPreparedGcode` under `src/ui` finds only the Resume and recovery flows without the check (R4-P3-5). Estimates and canvas previews check nothing, as the ADR says.
- **Remote:** phone and MCP Start read the same Job Review warnings (`status-projections.ts:118`, READ). Remote `save_project` writes the `.lf2` only, so it has no output route (`design-save.ts`).
- **Cost.** `zz-r4-b.test.ts` B8, 2,000 plain texts: `prepareOutput` 138 ms, check 18 ms first and 8 ms after. Snapshot without the check 115 ms, with it 118 ms. Parsing any bundled font takes 1–9 ms (B9). `loadFont` caches the buffer, so the `parsedFonts` WeakMap hits. No off-thread route was moved onto the UI thread: `checkedPreparer` runs inside `prepareOutputRequest`, in the worker.
- **#1526:** its files share nothing with either PR, and `operation-binding.ts` is unchanged by it (READ). R5 owns its output.
- **Interaction of #1519 and #1523:** a baked framed record burns the record's Y exactly (E3), with its warning. They edit different files, and `render-variable-text.ts` is untouched by #1519.

## Not verified

- **The app's UI.** Toasts, the Job Review list and the panel hint were read or tested in jsdom, not seen in a window. How a stack of 200 toasts looks was not seen.
- **Workers.** jsdom has no Worker. `prepareOutputRequest` ran in process (repo test), so font fetch inside a real output worker and in the packaged app is READ only.
- **Array, Place Board, retained arrays.** Copies were cloned objects; the dialogs were not driven. `prepare-variable-array` materialises plain copies, which output checks (READ).
- **`.rd`, tiled, DXF, PDF, print:** by repo tests and READ, not this audit's own runs.
- **Chains and fills:** 1.0.27 → 1.0.28 → main not re-run (R7). No text on a Fill layer was compiled.
- **Italic, Bold and Max width in frames:** their ink can pass the frame edge by a few percent; not measured.
- **Hardware:** none, by instruction.

## Refuter method

A fresh refuter on main `54e0e19b8`. For each finding it stated what would make it false, then tested that through `buildTextObject`, `deserializeProject`, `prepareOutputSnapshot`, `inspectPreparedStart`, `emitSavePreparedOutput`, the real store commands and emitted G1 moves. Tests ran one at a time. No hardware was operated.

- **Older code.** A real `git archive` of 1.0.28 outside `j7-main`, with no links, saved four projects with its own code and recorded its own burn. Main opened those files.
- **Cost spot-check.** 2,000 plain texts with a cached font buffer: check 27 ms first and 4 ms after, against `prepareOutput` at 1,529 ms. This machine was under load, so the figures differ from the auditor's 18 and 8 ms but agree that the cost is negligible. The real `loadFont` caches the buffer, including for embedded fonts (`font-loader.ts:65-90`, READ).
  - **Trap for later runs.** A test mock that returns a new buffer on each call misses the `parsedFonts` WeakMap and costs 28 s for the same 2,000 texts. That is the mock, not the app.
- **#1519 holds, spot-check.** `withTextGlyphCheck` on a compile with no snapshot names Pacifico's 李. Bake of a record the font covers stays a success toast.
- **Not re-run:** the 56-scene L11 matrix, L7's parent swaps, the legacy rows of R4-P1-1's table, and the 21 and 25 font sweeps. No real recovery flow, app window, or exports were driven.
- **Citation.** The LightBurn docs were read through a fetch summary of the versioned 2.1 page, on 2026-11-02. They settle nothing here beyond having no frame feature on that page.
- **Open PRs.** None changes the text, toast or Save files named here (`gh pr list`, checked 2026-11-02).

| Refuter file (all deleted) | What it did |
|---|---|
| `scratchpad\zz-r4r-old\r28\` with `zz-r4r-save.test.ts` | 1.0.28 export; saves four tags and records their burn |
| `scratchpad\zz-r4r-out\` | The saved `.lf2` files, 1.0.28 burns and logs |
| `j7-main\zz-r4r-vitest.config.ts` | Repo config, `fflate` alias, one worker, optional root for the export |
| `j7-main\src\ui\text\zz-r4r-common.ts` | Builder, burn parser, warning capture |
| `j7-main\src\ui\text\zz-r4r-a.test.ts` | R4-P1-1 on 1.0.28 files, template geometry, R4-P1-2, R4-P2-1 |
| `j7-main\src\ui\text\zz-r4r-b.test.ts` | R4-P2-2 to P2-5, R4-P3-1 to P3-3, #1519 spot-check |
| `j7-main\src\ui\text\zz-r4r-c.test.ts` | Bottom-crossing sweep, 8 fonts × 6 frames |
| `j7-main\src\ui\text\zz-r4r-d.test.tsx` | Cost with a cached buffer, real `Toasts` render, Save advisory order |

## Repro files

All were deleted after the runs. Files in `j7-main` went one at a time by literal path. The two folders outside `j7-main` held no links and were removed whole.

| File | What it did |
|---|---|
| `j7-main\zz-r4-vitest.config.ts` | Repo config, `fflate` alias, one worker, `R4_PARENT` file swap |
| `j7-main\src\ui\text\zz-r4-font.ts`, `zz-r4-common.ts` | Font fixture, builder, G-code burn parser, output and warning capture |
| `j7-main\src\ui\text\zz-r4-a.test.ts` | Baselines, glyph classes × fonts, font coverage sweep |
| `j7-main\src\ui\text\zz-r4-b.test.ts` | Right-to-left, NFD records, layer flags and scope, 200 copies, non-output exports and rows, Convert and Weld, embedded and missing fonts, cost |
| `j7-main\src\ui\text\zz-r4-c.test.ts` | Older saves on main, `legacyLineEm` routes, new text |
| `j7-main\src\ui\text\zz-r4-d.test.ts` | Overflow matrix, frame modes × alignments, bottom crossings |
| `j7-main\src\ui\text\zz-r4-e.test.ts` | Auto width against no frame, Casual Hand records, Bake then edit, CNC, blank glyph, right-to-left |
| `j7-main\src\ui\text\zz-r4-f.test.ts` | Bake, Production and jig originals, outline bottom sweep |
| `scratchpad\zz-r4-old\` | `r27`, `r28` exports, their `zz-r4-save.test.ts`, the shared 56 scenes and config; `p1523`, `p1519` parent files |
| `scratchpad\zz-r4-out\` | 112 saved `.lf2` files and each release's burn metrics |

To reproduce R4-P1-1: on an export of `33bc394c6`, build `{{csv:name}}`, EMS Casual Hand, Size 10, centred, fixed 80 × 11 shrink frame, with "Gypsy" in the CSV, and save with `prepareProjectForPersistence`. Open on main and compile that record.

```json
{
  "area": "R4",
  "id": "fix-text-frames",
  "tree": "f862d0d8d",
  "raised": 12,
  "p1": 2,
  "p2": 3,
  "p3": 7,
  "known": 5,
  "prs": {
    "1519": "fixes its named findings; gaps R4-P2-2, R4-P2-3, R4-P2-5",
    "1523": "fixes its named findings on the direct route; regression R4-P1-1 at the frame bottom"
  },
  "refuterTree": "54e0e19b8",
  "refuter": {
    "confirmed": 11,
    "plausible": 1,
    "refuted": 0,
    "known": 0,
    "severityChanges": [
      "R4-P2-2 P2 to P3",
      "R4-P2-5 P2 to P3"
    ]
  },
  "findings": [
    {"id":"R4-P1-1","severity":"P1","area":"fix-text-frames","file":"src/core/text/text-box-render.ts","line":95,"anchor":"Contract: ADR-682 Amd 1 D3 (:64), ADR-682 D6 (:82); Twin: 1.0.28 burn of the same file","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1523: a record that fits its shrink frame moves to the shared baseline and leaves it. Casual Hand 80x11 Gypsy 339.320..350.000 on 1.0.28, 335.448..346.128 on main, 3.552 mm below the frame bottom, no warning; R7's 1.883 mm is one instance","refuter":"Real 1.0.28 save opened on main: Gypsy 339.320..350.000 to 335.448..346.128, no warning. Only EMS Casual Hand crosses in 8 fonts x 6 frames. D6 anchor withdrawn (Amd 1 D3 replaces it); code follows D3 to the letter but no text accepts the bottom. Frame is typed, not drawn; template ink on the canvas fills it. Fix needs a maintainer decision against L3-P2-5"},
    {"id":"R4-P1-2","severity":"P1","area":"fix-text-frames","file":"src/ui/text/render-variable-text.ts","line":56,"anchor":"Contract: ADR-682 D6 (:80-81), D5; Twin: no frame, Auto height","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Auto width frame records keep the template's left edge: centred Al centre 104.475 against template 128.106 (23.63 mm), right-aligned Al right edge 108.95 against 156.21 (47.26 mm), no warning. Predates both PRs","refuter":"Own repro matches: centred Al 104.475 against 128.106, right Al 108.950 against 156.211, no warning. Reachable from the Sizing list. Not KNOWN: the 12.8 mm case is N4-P3-6, Max width on old files"},
    {"id":"R4-P2-1","severity":"P2","area":"fix-text-frames","file":"src/io/gcode/prepare-output-snapshot.ts","line":269,"anchor":"Contract: ADR-682 Amd 1 D4 (:69); Twin: record glyph advisories","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A variable record overflowing its frame burns past it with no Start or Save warning: 33.31 mm below a 30x10 frame, 24.83 mm right at the minimum size; only the rows preview reads the flag","refuter":"Own repro matches. Materialisation drops textBoxLayout, so the flag cannot reach Job Review, Start or Save"},
    {"id":"R4-P2-2","severity":"P3","area":"fix-text-frames","file":"src/ui/state/vector-path-actions.ts","line":173,"anchor":"Contract: ADR-591 Amd 1 title, Amd 2 D4; Twin: Bake","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Convert to Path and Weld of Pacifico 'Café 李': no toast, advisories [] afterwards, the character is gone from the file","refuter":"Real commands: no toast, no advisory, burn unchanged (279 G1). Lowered: burn matches the canvas, the dialog hint and Start cover normal use, and Amd 2 D4 route list does not name conversion"},
    {"id":"R4-P2-3","severity":"P2","area":"fix-text-frames","file":"src/ui/app/file-actions.ts","line":328,"anchor":"Twin: emit-rd.ts:73, save-tiled-gcode.ts:127, job-review-model.ts:123","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"200 copies give 200 identical warnings; Save G-code pushes one toast each (14,599 characters), exports and rows one long toast; Job Review, .rd and tiled remove repeats","refuter":"200 advisories real, but Toasts renders the newest three. Kept because three or more lines push out earlier Save warnings such as out-of-bed; repeats removal alone does not fix distinct texts"},
    {"id":"R4-P2-4","severity":"P2","area":"fix-text-frames","file":"src/core/text/text-style.ts","line":40,"anchor":"Contract: ADR-591 Decision; Twin: outline route ignores the controls","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Right-to-left on a single-line font burns ? at each end of every line: Relief 118 to 174 G1, 28.83 to 38.69 mm; warning names U+202B U+202C. Predates #1519","refuter":"Same G1 and width as literal ?Strasse? in Relief (174, 38.69) and Nixish (188, 43.565). Warning reaches Start and Save, true but does not mention Right-to-left"},
    {"id":"R4-P2-5","severity":"P3","area":"fix-text-frames","file":"src/ui/state/production-manifest-preparation.ts","line":65,"anchor":"Contract: ADR-591 Amd 2 D1 (:33)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"False alarms: a production row warns for text on a non-output layer; Cinzel NBSP and Pacifico U+2009 warn though the burn equals a plain space","refuter":"Both reproduced. Lowered: narrow, nothing burns wrong, the row case follows Amd 2 D4, and the space message is literally true"},
    {"id":"R4-P3-1","severity":"P3","area":"fix-text-frames","file":"src/core/text/stroke-font-text.ts","line":57,"anchor":"Twin: a new frame with the same displayed values","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"legacyLineEm is invisible: same fields burn 39.588x10 against 29.612x7.48; frame off and on drops it","refuter":"Fixture: 39.588x10 against 29.612x7.48"},
    {"id":"R4-P3-2","severity":"P3","area":"fix-text-frames","file":"src/ui/app/bake-variable-text.ts","line":36,"anchor":"Twin: burn before and after a same-values edit","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A baked framed record jumps when edited: Casual Hand Gypsy 335.448..346.128 to 339.32..350","refuter":"Real bake: 335.448..346.128, then 339.320..350.000 after a rebuild"},
    {"id":"R4-P3-3","severity":"P3","area":"fix-text-frames","file":"src/core/text/text-to-polylines.ts","line":262,"anchor":"Contract: ADR-591 Amd 2 D1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Italianno maps _ to an empty glyph: burns nothing, no warning","refuter":"A_B and A B both 256 G1, no advisory; width 21.78 against 15.01"},
    {"id":"R4-P3-4","severity":"P3","area":"fix-text-frames","file":"src/ui/text/variable-text-placement.test.ts","line":1,"anchor":"L7 test truth","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No tests for the bottom crossing, Auto width records, overflow at output, conversion, repeats or non-output rows","refuter":"grep: auto-width only in text-box-layout.test.ts; no Casual Hand frame in variable-text-placement.test.ts"},
    {"id":"R4-P3-5","severity":"P3","area":"fix-text-frames","file":"src/ui/laser/start-job-source.ts","line":376,"anchor":"Contract: ADR-591 Amd 2 Consequences (:62-63)","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"A direct Resume compile has no glyph check; the ADR's Consequences read wider than the code","refuter":"READ only; recovery not driven"}
  ]
}
```
