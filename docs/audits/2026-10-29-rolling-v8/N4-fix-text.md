# Rolling audit v8 — N4 Text fixes (#1507, #1508)

- **When:** 2026-10-29, evening +0800   **Tree:** origin/main @ `08b5c669b` (#1514 merged; it touches only constant-power advice).
  - Merge commits: #1508 `59a1ac49e` (parent `7fb3adc05`), #1507 `3bf24619f` (parent `0fcbe8e99`). #1508 merged first; #1505 (`a486c9192`) and #1509 sit between them. After #1507, only #1511 touched a file in scope (`remote-control/preview-projection.ts`, no text code).
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\`.** All 1,010 tracked files under `src/core/text`, `src/ui/text`, `src/io/project`, `src/ui/remote-control`, `src/ui/workspace/registration-jig`, `src/io/gcode`, `src/core/variables`, `src/io/lightburn`, `src/io/svg`, `src/io/dxf`, `src/core/scene`, `electron/mcp` and the font generator hash-match `08b5c669b`.
  - **Test truth.** Each PR's parent version of a file was swapped in through a Vitest alias, in the same copy.
- **Scope:** fix verification (L10) and sibling routes (L9) of:
  - **#1507** (ADR-682, new): Size is the em for every font; schema 19 migrates old single-line text; bent, boxed and path variable records keep the template's anchor or baseline; Max width in a frame. Findings fixed: L3-P1-1, L3-P1-2, L3-P2-1, L3-P2-5, L3-P3-1.
  - **#1508** (ADR-591 Amd 1, ADR-321 Amd 1, ADR-564 Amd 1): missing-glyph warnings for remote text and variable output; remote and jig edits keep the text style; one text range. Findings fixed: L3-P1-3, L3-P1-4, L3-P2-2, L3-P2-3, L3-P2-4, L3-P3-3.
- **Lenses run:**
  - L10: every L3 repro, re-measured from emitted G-code.
  - L9 by font kind: outline TTF, the four bundled single-line fonts, a user-imported font, a missing font. KerfDesk has no Hershey font.
  - L9 by text mode: plain, bent, rigid bend, on path, text box, variable (CSV, serial).
  - L9 by route: desktop dialog, remote `add_text` / `apply_edits` / `update_text` / `get_text`, the jig editor, Bake, Production run, array copies, exports, paste, `.lf2` reload, sheets, autosave, templates, library, LightBurn `.lbrn` import.
  - L8: each PR against the other, and against #1505, #1504 and #1502; conflict survival of every added line.
  - L7: each PR's regression tests run against the parent code.
  - Performance: a 2,000-character text box, and 500 variable records.
  - Not run: L5 (rolling v5 J3 owns remote input), L2 (LightBurn itself).
- **Repros:** 7 temporary Vitest files, 14 parent-version stubs and one config, plus 9 existing test files. Each ran alone with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n4-vitest.config.ts --silent=false --disableConsoleIntercept`. They are listed under "Repro files" and were all deleted afterwards.
- **Counts:** 10 raised → 0 refuted → P1 3 / P2 1 / P3 6 (+ 3 KNOWN re-observed). Refuter: 9 CONFIRMED, 1 CONFIRMED on READ (N4-P3-4); no severity changes.

## Headline

**Every path the L3 findings named is fixed on main**:
- At Size 10 an H now burns 6.585–8.754 mm in every single-line font, with Roboto still at 7.109 mm.
- Bent records land on the template's anchor to 0.000 mm at every alignment, for the rigid bend, at ±60° and after a 90° rotation.
- Path records share one capital line.
- Remote `add_text`, `apply_edits` and `update_text` warn in the receipt and on the PC.
- Variable output warns in Start and Save.
- Remote and jig re-renders match the desktop editor to 0.01 mm.
- A remote 500 mm / 10 / 5 sign survives a desktop edit.

The regression tests fail on the parent code. None of the 903 lines the two PRs added was lost in the merges.

**Neither PR holds in full.** Four gaps carry the original harm:

- **N4-P1-1 (regression from #1507).** Schema 19 converts Size, line height, spacing and the frame minimum, but not the frame rule #1507 also changed. A single-line frame now counts each line as a full em instead of the old cap-height unit, so a migrated text in a fixed shrink-to-fit frame lays out smaller on any re-render.
  - **Variable records** re-render at every output. In a Relief SingleLine 80 × 11 mm name-tag frame saved by 1.0.27, "ANNA" now burns with **7.48 mm capitals instead of 10.00 mm**, while the canvas still draws the stored 11 mm template. Advisories are `[]`.
  - The worst case measured is 68 % of the old size.
- **N4-P1-2 (fix gap of #1508).** Output checks only *variable* text for missing glyphs. **Bake** and **Production run** turn records into plain text first, and both drop the advisory that the materialiser returns.
  - A baked "Zoë 李" record in Pacifico burns without 李; a production-run row "李" burns nothing.
  - Start and Save show no warning, and Bake reports success.
  - ADR-591 Amd 1 names the production-run gap as a limit; Bake is not named.
- **N4-P1-3 (fix gap of #1508).** The jig text editor shows no missing-character hint, and output never checks plain text. "Café 李" typed there in Pacifico burns "Café" with no warning. ADR-591 Amd 1 names this as a limit too.
- **N4-P2-1 (partial fix of L3-P2-5).** Boxed records share the template's baseline only when the literal template `{{csv:name}}` fits its frame unshrunk. In a 40 or 50 mm frame, which is what a name tag sized for names gives, the template shrinks. Every record then falls back to ink-top placement, and the baselines jump by exactly L3's 0.29–2.02 mm again.

## Fix verification (L10)

| Original finding | Before (L3, `6e388bb56`) | After (main `08b5c669b`) | Siblings (L9) | Verdict |
|---|---|---|---|---|
| **L3-P1-1** EMS Size 10 capitals 13.2–17.5 mm | H: Nixish 13.170, Decorous 13.555, Casual Hand 17.508 mm. `H⏎H` Casual Hand 31.508 mm, lines collide | **Size 10 G-code H / X / I / E:**<br>• Relief 6.800 / 6.800 / 6.800 / 6.600<br>• Nixish 6.585 / 6.588 / 6.615 / 6.524<br>• Decorous 6.763 / 7.146 / 6.660 / 6.780<br>• Casual Hand 8.754 / 6.391 / 6.365 / 7.999<br>• Roboto 7.109 throughout<br>**Two lines:** `H⏎H` Casual Hand is 22.754 mm tall, and line 2's H top sits 5.246 mm below line 1's baseline | Old projects: schema 19 rescales Size, line height, spacing and `minSizeMm`. Plain, bent and path text re-render identically. **Fixed shrink frames do not (N4-P1-1).** Sheets, autosave, templates, the library and production designs all load through `deserializeProject` (an inactive sheet keeps schema 18 and migrates when opened: REPRO). Groups are flat, so nested text is covered | **Fixed; regression in the migration (N4-P1-1)** |
| **L3-P2-1** Size is the em for outline fonts, the cap height for Relief | Roboto 7.109, Relief 10.000 mm | Both fonts now use the em. The dialog field is "Font size", with an em tooltip (`TextDialogNumericFields.tsx:72-81`); the jig field is "Font size (mm)" with the same tooltip (`JigTextControls.tsx:162-164`) | Phone: "Size mm" (neutral). **MCP descriptions do not say em (N4-P3-4)** | **Fixed by decision** (ADR-682 D1–D2) |
| **L3-P1-2** Bent variable records 17–23 mm off centre | Centred bend 60: Al −23.341, Maximilian +19.209; right −46.677 / +38.424 | Ink centres (Roboto `{{csv:name}}`, bend 60, centred): Al +1.720, anna −0.032, Anna +0.424, Maximilian −0.119; rows of H within 0.006. **World-space anchor offsets 0.000 / 0.000** for left, centre and right, distorting and rigid, at 0° and 90° rotation | Bend −60, rigid bend, Bold + Max width, Pacifico + Weld, Relief, and a two-line template all within 1.7 mm of ink (0.02 mm on H rows). #1504 rotation: anchors exact | **Fixed** |
| **L3-P1-3** Remote text drops missing glyphs silently | `{"ok":true,…}`, 8 contours, no notice | Pacifico, Roboto, Inconsolata and Relief `add_text`, `apply_edits` and `update_text` return `notices:[{level:'warning',message:'Pacifico has no 李; each engraves as a box, or not at all.'}]`. The single-line wording is "each engraves as ?". The PC toast names the character. A PC-made text whose font a remote update changes gets the counting notice | **Jig editor: no warning (N4-P1-3)** | **Fixed for remote** |
| **L3-P1-4** Variable records with missing glyphs, advisories `[]` | Pacifico 190 / 222 / 0 moves, advisories `[]` | Same moves. Advisory `Variable text “Zoë 李” (CSV record 2): Pacifico has no 李; …` in `prepared.advisories` and in `inspectPreparedStart().advisoryWarnings`. Holds for Inconsolata, Roboto, Relief (`?`), a user font ("MyShopFont.ttf has no 李") and a serial template ("李 001") | **Bake and Production run: no warning (N4-P1-2).** Exports and print drop it too (READ). Array copies keep `variableTemplate` (`object-variable-template.ts:38-58`), so output checks them. A missing user font refuses output with "could not render" | **Fixed at output; open on sibling routes** |
| **L3-P2-2** Remote `update_text` unwraps a text box | 38.92 × 21.12 → 87.55 × 5.84 | 36.08 × 55.21 → **35.44 × 55.21 = desktop**. Shrink frame 37.79 × 35.14 = desktop. New wording re-wraps (35.54 × 67.21 = desktop) | Upper case, Max width, bend 60 and Pacifico Weld under `update_text` all equal the desktop. **A 500-character shrink frame takes 11 s on the UI thread (N4-P3-2)** | **Fixed** |
| **L3-P2-3** Desktop edit clamps remote values | 500 / 10 / 5 → 300 / 5 / 2 | 500 / 10 / 5, 0.5 / 0.1 / −1 and 1000 / 20 / 20 all survive a desktop edit | **Migrated single-line values can leave the range and are then clamped (N4-P3-1)** | **Fixed** |
| **L3-P2-4** Jig editor drops style | Max width 30 → 48.58; Upper case 9 → 11 contours; Weld 7 → 10 | Max width 30.00 × 7.60 (14 contours); Bold 49.18 × 8.20; Upper case 47.70 × 7.30 (9); Pacifico Weld 26.49 × 9.47 (7); box 23.74 × 33.58 (23); italic centred two lines 25.25 × 19.60. Each equals the main editor | Missing glyph in the jig: N4-P1-3 | **Fixed** |
| **L3-P2-5** Boxed and path records placed by ink | Box: Al 342.500, Anna 342.793, anna 344.521. Path: Peggy 2.04 mm high | 80 × 20 box: Al 342.202, Anna and anna 342.104 (the a-bowl 0.1 mm). Path: Anna and Peggy capitals both reach 308.896; Peggy's descender at 299.653. Relief: box 342.860 for all three; path tops 307.990 / 307.940 | **40 × 20 and 50 × 20 boxes: Al 342.500, Anna 342.793, anna 344.521, unchanged from L3 (N4-P2-1).** Ågot rises 1.66 mm above the frame (N4-P3-3) | **Partly fixed** |
| **L3-P3-1** Max width in a frame squeezes about the ink's left edge | Centre 14.126 in a frame centred at 30 | 60 mm frame at X 100..160, Max width 20: centre 130.000, right edge 160.000, left edge 100.000 | **Frames saved before 1.0.28 keep the old squeeze on the canvas (N4-P3-6)** | **Fixed** |
| **L3-P3-3** Remote text unwelded | `weldOverlaps:false` | `true` for remote and jig text | — | **Fixed** |
| **L3-P3-2** In-place edits drift | — | Not done; ADR-682 Consequences says so | — | **Not fixed (by design)** |
| **L3-P3-4** Test gaps | — | New tests for each finding; they fail on the parents (below) | **The gaps behind N4-P1-1 and N4-P2-1 (N4-P3-5)** | **Mostly fixed** |

**Test truth (L7).** Each test file ran on main and then with the parent versions swapped in:

| Test file | Main | Parent code | Swapped files |
|---|---|---|---|
| `variable-text-placement.test.ts` (#1507) | 12/12 | **10 fail**:<br>• the 4 single-line H tests: Relief 10, Nixish 13.17, Decorous 13.609, Casual Hand 17.508;<br>• Casual Hand line spacing: 31.508;<br>• 3 bend tests: 22.80–24.44 mm off;<br>• boxed: 1.728;<br>• path: 2.036 | `text-bend`, `text-style`, `text-box-render`, `text-on-path`, `render-variable-text` from `0fcbe8e99`; `svg-stroke-font` scaled by the legacy 680 / 500 |
| `text-missing-glyphs.test.ts` (#1508) | 6/6 | **5 fail** (1 negative control passes) | `text`, `text-edit`, `writes`, `design-batch` from `7fb3adc05` |
| `variable-missing-glyphs-output.test.ts` | 3/3 | **1 fails** (the 2 quiet-case controls pass) | `missingGlyphAdvisory` disabled. The parent `render-variable-text` already passed `missingCharacters` through its spread, so swapping it alone changes nothing |
| `jig-text-styles.test.ts` | 6/6 | **6 fail** | `jig-text-object` from `7fb3adc05` |
| `text-limits-parity.test.ts` | 4/4 | **2 fail** | `TextDialogNumericFields` from `7fb3adc05` |
| `migrate-v18-single-line-text-em.test.ts`, `cnc-stroke-font.test.ts`, `VariableRowsPreview.test.tsx` | 6/6, 6/6, 2/2 | not swapped (new code) | — |

**Conflict survival (L8).** For each PR, every added non-comment line under `src`, `electron`, `scripts` and the phone app's `src` was looked for in main's version of its file:
- #1508: 609 lines added, 0 missing.
- #1507: 294 lines added, 0 missing.

In `render-variable-text.ts`, the file both PRs edited, all three return branches (path, frame, plain) carry `missingReport(rendered)`.

**ADR amendments against the code:**
- **ADR-682 D1–D3, D5, D7 and D8:** match the code. The measured Decorous Script H is 6.763 mm against the ADR's 6.80; the difference is the fairing, and the test tolerance is 0.05.
- **ADR-682 D4** ("a re-render draws the same paths (tested to 1e-9 mm)", `ADR-682…md:72`): false for fixed shrink frames (N4-P1-1). The test never re-renders a frame.
- **ADR-682 D6** ("moves inside the same frame", `:82`): holds only when the template fits unshrunk (N4-P2-1). Records also rise above the frame top (N4-P3-3).
- **ADR-591 Amd 1 D3–D5:** match the code. Its Limits (`:66-68`) concede the production run and the jig editor, which are N4-P1-2 and N4-P1-3. Bake is not mentioned.
- **ADR-321 Amd 1:** matches the code.
- **ADR-564 Amd 1** ("A value one entry point accepts is never changed by an unrelated edit in another", `:32`): holds for remote values. Schema 19, merged 45 minutes later, can create values outside the range (N4-P3-1).

**Performance.** Measured in-process on main, then with the #1507 parent stubs:
- **2,000-character text box (Roboto 5 mm):**
  - plain line: 1.5 s (parent 1.5 s);
  - auto-height box: 2.5 s (parent 2.2 s);
  - **fixed shrink 150 × 60: 81 s (parent 70 s)**;
  - fixed shrink with Max width: 91 s (parent 69 s);
  - Relief fixed shrink: 0.23 s (parent 0.18 s).
- **500 variable records (`materializeVariableObject`):**
  - plain or bent: 64 ms per record (parent 50);
  - 80 × 20 shrink frame: 99 ms per record (parent 89).
- **Reading.** The shrink-frame cost is the layout's binary search. That code is the same in both builds, so the cost predates these PRs. The per-record differences are within run-to-run noise, because the plain path's code is identical in both. The one new exposure is N4-P3-2.

## Findings

### N4-P1-1 — Schema 19 converts Size but not the frame rule: migrated single-line text in a fixed shrink-to-fit frame re-renders up to 32 % smaller, and its variable records burn that way with no warning

- **Where:**
  - `src/core/text/stroke-font-text.ts:48-61`: the single-line frame layout passes `heightPerEm` 1 (`:57`). It now multiplies an em-based Size (`:61`, `size / font.unitsPerEm`), where before #1507 it multiplied the cap-height Size.
  - `src/core/text/text-box-layout.ts:80`: `naturalHeight = ((lines − 1) × lineHeight + heightPerEm) × sizeMm`. It drives shrinking (`:34-49`) and `overflow` (`:91`).
  - `src/io/project/migrate-v18-single-line-text-em.ts:28-43` scales `sizeMm`, `lineHeight`, `letterSpacing` and `textBox.minSizeMm` only. It does not touch the frame.
  - `src/ui/text/render-variable-text.ts:49-57` re-renders every boxed record at output.
- **Anchor:**
  - **Contract.** ADR-682 D4 (`docs/decisions/ADR-682-text-size-is-the-em-and-variable-records-keep-their-baseline.md:67,72`): "Project schema 19 keeps old single-line text exactly as drawn", and "a re-render draws the same paths (tested to 1e-9 mm)".
  - **Contract.** ADR-682 Consequences (`:102-104`) concedes that a frame "can therefore choose a slightly smaller size", without limiting that to new text.
  - **Twin.** The schema-18 build's own render: the same `renderStrokeFontText` with the legacy units, the method `migrate-v18-single-line-text-em.test.ts` itself uses.
- **Scenario:**
  1. In 1.0.27, a Relief SingleLine name tag is set up: `{{csv:name}}` at Size 10, centred, in a fixed 80 × 11 mm frame with Shrink to fit.
  2. The template fits and is stored 77.28 × 11.00 mm. Records such as "ANNA" burn with 10.00 mm capitals.
  3. The project is opened in 1.0.28. Schema 19 makes the Size 14.706 (em). The frame now counts the line as 14.706 mm against its 11 mm height and shrinks every record to an 11 mm em.
  4. **The burn:**
     - "ANNA" 29.61 × 7.48 mm (was 39.59 × 10.00);
     - "Anna" 24.89 × 7.43 (was 33.28 × 9.93);
     - "Hello" 24.67 × 8.20 (was 32.99 × 10.96).
  5. The canvas still draws the stored 11 mm template. `prepared.advisories` is `[]`.
- **Evidence:** REPRO, `zz-n4-migrate.test.ts`.
  - **Method.**
    1. Schema-18 geometry is drawn with the legacy units.
    2. The project is saved as schema 18 and loaded through `deserializeProject`.
    3. The template is then re-rendered, and the records go through `prepareOutputSnapshot` → `emitPreparedGcode`.
  - **Record burns:**

    | Font, frame | Record | Old burn | New burn |
    |---|---|---|---|
    | Relief, 80 × 11 | ANNA | 39.588 × 10.000 | **29.612 × 7.480** |
    | Relief, 80 × 11 | Anna | 33.279 × 9.926 | 24.892 × 7.425 |
    | Casual Hand, 80 × 12 | Anna | 27.148 × 12.000 | 22.222 × 9.823 |
    | Casual Hand, 80 × 12 | Bob | 18.215 × 12.000 | 15.432 × 10.166 |

    Advisories are `[]` in every case.
  - **Template re-render, stored → now:**

    | Font, frame, text | Stored | Re-rendered |
    |---|---|---|
    | Relief, 80 × 10, ANNA | 39.588 × 10.000 | **26.920 × 6.800** (68 %) |
    | Nixish, 80 × 13.2, ANNA | 59.731 × 13.200 | **39.843 × 8.805** (67 %) |
    | Nixish, two lines in 80 × 25 | 77.792 × 25.000 | 65.992 × 21.208 |
    | Casual Hand, 80 × 12 | 27.148 × 12.000 | 22.222 × 9.823 |

  - **Desktop edit.** Changing only the alignment of the migrated Casual Hand text shrinks it from 27.148 × 12.000 to 22.222 × 9.823.
  - **Unaffected:** a fixed frame without shrink (overflow is flagged in both builds), an auto-height frame, and plain, bent and path text. All re-render identically.
- **Severity:** P1. The burned size differs from the stored design and from what the same file burned before the upgrade, by up to 32 %. Nothing warns. Reach (legacy file, single-line font, fixed shrink frame) cannot lower a P1 (METHOD §3).
- **Novelty:** new. #1507 caused it. The migration test checks `minSizeMm` and that geometry is unchanged, but never re-renders a frame (`migrate-v18-single-line-text-em.test.ts:100-117`).
- **Fix direction:**
  - Keep the legacy rule for migrated frames. One way: scale the frame's height test by the same factor. Another: store a per-text `frameHeightPerEm` of 1/factor that schema 19 sets.
  - Or re-render migrated framed text at load and say so in a load notice.
  - Add a migration test that re-renders a shrink frame that only just fitted.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **The test file is not genuine.** The refuter built its own 1.0.27 file. Every text-core file #1507 changed was swapped for its `0fcbe8e99` version through a Vitest alias: `stroke-font-text`, `svg-stroke-font`, `cnc-stroke-font-data` (`capHeight` 680 / 500), `fair-stroke-font`, `text-box-render`, `text-bend`, `text-style`, `text-on-path` and `render-variable-text`. Between 1.0.27 (`adf300522`) and `0fcbe8e99`, the text core differs only by #1508's missing-glyph words. The parent core is shown to be active: a Relief Size 10 H measures 10.000 mm. The project went through the real `buildTextObject` and `serializeProject`, and was written as schema 18. The writer is otherwise byte-identical, because `migrations.ts` and `project.ts` are #1507's only `src/io/project` and `src/core/scene` changes.
    - **The file re-renders at load, so the canvas and the burn agree.** It does not. After `deserializeProject` and the real store's `setProject`, the canvas keeps the stored template, 77.276 × 11.000 mm (Size now 14.706, minimum 2.941, line height 0.816).
    - **The burn is not wrong.** It is wrong. Records go through `prepareOutputSnapshot` and then `emitPreparedGcode`:

      | Relief 80 × 11 record | 1.0.27 (parent) | Main |
      |---|---|---|
      | ANNA | 39.588 × 10.000 | **29.612 × 7.480** |
      | Anna | 33.280 × 9.926 | 24.892 × 7.425 |
      | Hello | 32.986 × 10.956 | 24.672 × 8.195 |
      | Maximilian | 69.292 × 11.000 | 54.394 × 8.635 |

      Casual Hand in an 80 × 12 frame: Anna 27.148 × 12.000 → 22.222 × 9.823, and Bob 18.216 → 15.432 × 10.166. Maximilian keeps 12.000, because it is limited by width.
    - **A warning reaches the operator.** None does:
      - `prepared.advisories` is `[]`, `inspectPreparedStart().advisoryWarnings` is `[]` and Save's `machineWarnings` is `[]` for every record.
      - The open toast says only "Opened … migrated from schema v18" (`project-open-completion.ts:47-52`). `pushProjectLoadNotices` has no text notice.
      - The rows preview, when it is open, shows "Fits · 11.00 mm", which is a readout, not a warning.
    - **ADR-682 accepts it.** The Consequences (`:102-104`) concede "a slightly smaller size" for frames that only just fitted. D4 (`:67,72`) promises that old single-line text keeps exactly what it drew. The measured loss is 25 % with 10 % headroom; an ADR line is not an operator warning (METHOD §3).
  - **When it re-renders:** not at load.
    - **Every output of a variable record.** That covers Start, Save, Preview, Bake, Production run open and capture, exports and print; they all call `renderVariableText`.
    - **Any edit that rebuilds the text.** An unchanged dialog rebuild turns the template's 77.276 × 11.000 into 64.757 × 9.218, and plain framed "ANNA" from 39.588 × 10.000 into 26.920 × 6.800.
    - **Plain framed text** keeps burning its stored 39.588 × 10.000 until it is edited, and the edit then shows on the canvas. The silent P1 path is therefore variable records, and Bake and Production rows made from them.
  - **Regression:** yes. The parent burns ANNA at 10.000 mm from the same file.
  - **Novelty:** not in `docs/audits/` (searched "frame rule", "heightPerEm" and "shrink-to-fit frame"). The only open PR, #1478, touches no text file.
  - **Own repro:** `zz-n4r-migrate.test.ts`, run in two phases: `N4R_STUB=1507` builds and saves, then main loads and burns.

### N4-P1-2 — Bake and Production run turn variable records into plain text and drop the missing-glyph advisory; output never checks plain text, so the glyph vanishes from the burn with no warning

- **Where:**
  - `src/io/gcode/prepare-output-snapshot.ts:215`: only text with a `variableTemplate` is rendered and checked. `:231` builds the advisory, and `:136-152` attaches it only to the output being prepared.
  - **Bake:** `src/ui/app/bake-variable-text.ts:36-47` reads `result.object` and ignores `result.advisory`, then toasts success.
  - **Production run:** opening a row runs `materializeVariableText` (`src/ui/state/production-manifest-preparation.ts:26-35`) and returns plain text. Capture does the same (`production-manifest-actions.ts:159-184`). Neither reads `result.advisories`.
  - **Also (P2-level, READ):** SVG, DXF, PDF/format export and print call `materializeVariableText` and ignore its advisories (`export-artwork-svg.ts:41`, `export-artwork-dxf.ts:43`, `export-artwork-format.ts:169`, `print-artwork.ts:50`).
- **Anchor:**
  - **Contract.** ADR-591 Amd 1, title: "A character the font has no glyph for is a warning wherever text is made or burned". D4: "Output says so for every record it burns".
  - **Contract.** ADR-591 Amd 1 Limits (`:66-67`) concedes the production run; Bake is not listed.
  - **Twin.** The same record as live variable text warns in Start and Save.
- **Scenario:**
  1. A Pacifico name tag `{{csv:name}}` uses a guest list with "Zoë 李" and "李".
  2. **Bake:** the operator bakes record 2. The toast says "Baked 1 object: the value is now fixed and no longer advances". The content is "Zoë 李", the geometry has no 李, and Start and Save show nothing.
  3. **Production run:** with 3 rows, each opened row is plain text. Row "Zoë 李" burns without 李, and row "李" burns nothing. Start's warnings are empty.
- **Evidence:** REPRO, `zz-n4-siblings.test.ts` (real store, `bakeSelectedVariableText`, `createProductionManifest` → `prepareProductionRow`, then `prepareOutputSnapshot` → `inspectPreparedStart` and `emitPreparedGcode`):

  | Route | Record | G1 moves | `advisories` | Start warnings |
  |---|---|---|---|---|
  | Variable text (control) | "Zoë 李" | 222 | the advisory | the advisory |
  | Variable text (control) | "李" | 0 | the advisory | the advisory |
  | Bake | "Zoë 李" | 222 | `[]` | `[]` |
  | Bake | "李" | 0 | `[]` | `[]` |
  | Production run | row 1 "Zoë 李" | 222 | `[]` | `[]` |
  | Production run | row 2 "李" | 0 | `[]` | `[]` |

- **Severity:** P1. Glyphs are missing from the burn and nothing warns: the same harm as L3-P1-4, through the two record routes #1508 left out. Writing the limit into an ADR is not a warning to the operator (METHOD §3).
- **Novelty:** new as an audit finding. ADR-591 Amd 1 Limits and #1508's body name the production run; Bake is named nowhere.
- **Fix direction:** check every text object at output, plain text included, against its font (content versus `missingCharacters` of one cached render). Alternatively, have Bake, Production run open and capture, and the exports surface the advisory that `materializeVariableObject` already returns, and keep it on the row.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **Output checks plain text somewhere.** It does not.
      - `variable-text-missing-glyphs` is the only glyph code in preflight (`preflight.ts:79`).
      - Outside the remote adapter and tests, `missingCharacters` is read only by `prepare-output-snapshot.ts` (variable objects), `FontUsageHint` (the dialog and the canvas text panel), the rows preview, `render-styled-text.ts` and the text worker.
    - **Bake or Production run surfaces the advisory.** Neither does.
      - Bake: `bake-variable-text.ts:36-47` keeps `result.object` and drops `result.advisory`.
      - Production run: `production-manifest-preparation.ts:26-35` and `production-manifest-actions.ts:159-184` drop `result.advisories`.
      - `createProductionRun`, `openProductionRow` and `captureProductionVariant` raise no toast and no error.
    - **ADR-591 Amd 1 accepts it.** Limits (`:64-68`) name the production run, not Bake. Neither limit puts a warning in front of the operator, so the acceptance cannot lower the severity (METHOD §3).
    - **The canvas shows it.** After Bake or a row open, the canvas draws the geometry that will burn: "Zoë" with no 李, or nothing for "李". The content field still says "Zoë 李". That is not a warning. L3-P1-3 (remote text, where the canvas also showed the dropped glyph) was confirmed P1 on the same reasoning.
  - **Own repro:** `zz-n4r-siblings.test.ts`. It used the real store (`setProject`, `selectObject`), `bakeSelectedVariableText`, `createProductionRun` → `openProductionRow` → `captureProductionVariant`, and then `prepareOutputSnapshot` → `emitPreparedGcode`, `inspectPreparedStart` and `emitSavePreparedOutput`. Pacifico, with CSV rows "Zoe", "Zoë 李" and "李".

    | Route | Record | Contours / G1 | advisories / Start / Save | Toast |
    |---|---|---|---|---|
    | Variable (control) | Zoë 李 | 5 / 814 | the advisory in all three | — |
    | Variable (control) | 李 | 0 / 0 | the advisory in all three | — |
    | Bake | Zoë 李 | 5 / 814 | `[]` / `[]` / `[]` | "success: Baked 1 object…" |
    | Bake | 李 | 0 / 0 | `[]` / `[]` / `[]` | "success: Baked 1 object…" |
    | Production row 1 | Zoë 李 | 5 / 814 | `[]` / `[]` / `[]` | none; capture returns `null` |
    | Production row 2 | 李 | 0 / 0 | `[]` / `[]` / `[]` | none; capture returns `null` |

  - **Exports and print (READ):** `export-artwork-svg.ts:41`, `export-artwork-dxf.ts:43`, `export-artwork-format.ts:169` and `print-artwork.ts:50` take `materializeVariableText(...).project` and never read `advisories`.
  - **Novelty:** not in `docs/audits/`, and no open PR touches these files.

### N4-P1-3 — The registration-jig text editor drops a glyph the font lacks with no hint, and no later check exists

- **Where:**
  - `src/ui/workspace/registration-jig/jig-text-object.ts:57-75`: `renderStyledText` returns `missingCharacters`; `renderJigText` keeps only bounds and paths.
  - `JigTextControls.tsx:140-187` has no glyph hint (its only notice is the missing *font* one at `:185`).
  - Output checks only variable text (`prepare-output-snapshot.ts:215`).
- **Anchor:**
  - **Contract.** ADR-591 Decision bullet 1, "unsupported font glyphs remain visible warnings", and Amd 1's title ("wherever text is made").
  - **Contract.** ADR-591 Amd 1 Limits (`:68`): "The registration-jig text editor shows no missing-character hint."
  - **Twin.** The text dialog's `FontUsageHint`, and remote `add_text`'s notice, for the same text and font.
- **Scenario:**
  1. In the jig editor, the operator types "Café 李" in Pacifico and clicks Add text.
  2. The text has 5 contours, the same as "Café", and is 18.84 mm wide. (The route difference against "Café" alone, 19.55 mm, is 15-P3-1.)
  3. Nothing on the jig panel, in Start or in Save names 李.
- **Evidence:**
  - REPRO, `zz-n4-remote.test.ts`: `jig missing glyph: 'Café 李' contours 5 W 18.84 H 12.56 vs 'Café' 5 W 19.55`. The returned object's keys carry no missing list.
  - READ: the jig panel and the output path, as cited above.
- **Severity:** P1, the L3-P1-3 harm through the one text editor #1508 left out.
- **Novelty:** new as an audit finding; ADR-591 Amd 1 Limits names it.
- **Fix direction:** return the missing characters from `renderJigText` and show the shared sentence (`missingCharactersSentence`) under the jig form. The output-wide check suggested for N4-P1-2 would also cover this.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **A check at Start or Save covers plain text from any route.** None does (see N4-P1-2).
      - Own repro: jig "Café 李" in Pacifico through `renderJigText`, put in a project and output. It has 5 contours and 993 G1 moves; advisories, Start and Save are all `[]`.
      - The same plain text from the main dialog's builder also outputs `[]` / `[]` / `[]`.
    - **Main-editor plain text burns silently too, so this is KNOWN.** It is not silent. The add-text dialog and the canvas text panel both render `FontUsageHint` (`TextFormattingFields.tsx:38`, used by `AddTextDialog.tsx:99` and `CanvasTextPanel.tsx:35`), which names the character while the text is typed. v7 L3 recorded that this hint was the only check, and #1508 kept that design. So output does not check plain text, as L3 established (KNOWN). What is new is that the jig editor, Bake and Production run make plain text without passing through any hint.
    - **ADR-591 Amd 1 Limits (`:68`) accept it.** They do, but the operator gets no warning, so the severity stands (METHOD §3).
    - **The jig canvas shows it.** It does: the jig view draws "Café", while the form field still reads "Café 李". L3-P2-4 used the same reasoning to keep the jig's style loss at P2. A dropped glyph, however, is exactly what ADR-591 says must be a visible warning, and L3-P1-3 (the remote, where the canvas also shows the result) was confirmed P1. The coordinator may weigh the in-view canvas.
  - **Own repro:** `zz-n4r-siblings.test.ts`. `renderJigText` returns no missing-character key (keys `kind,id,weldOverlaps,…,bounds,paths,transform`). It has 5 contours, the same as "Café" alone. `JigTextControls.tsx:68-92` passes the object straight to `onUpsert`.

### N4-P2-1 — Boxed variable records still jump baselines whenever the template string itself shrinks in its frame

- **Where:**
  - `src/core/text/text-box-render.ts:90`: `if (Math.abs(own.sizeMm - template.sizeMm) > 1e-9) return record;`. A record moves to the template's baseline only when both laid out at the same size.
  - `render-variable-text.ts:25-28,87-116`: the baseline comes from rendering the literal template `{{csv:name}}`.
- **Anchor:**
  - **Contract.** ADR-682 D6 (`:80-85`) and its Context: names "burned on baselines 1.7–2.4 mm apart". That is the defect being fixed.
  - **Twin.** The same records in an 80 mm frame, where the template fits, share one baseline.
- **Scenario:**
  1. A name tag frame of 40 or 50 × 20 mm, centred, shrink-to-fit, Roboto 10, `{{csv:name}}`.
  2. The 55.6 mm template shrinks to fit (template width 39.54 / 49.43 mm). The names fit at full size, so none matches the template's size, and each keeps the ink-top rule.
  3. Baselines: Al 342.500, Anna 342.793, anna 344.521, Peggy 340.757. These are L3-P2-5's numbers to the micrometre.
- **Evidence:** REPRO, `zz-n4-output.test.ts`: `narrow box 40x20: template … W 39.544 | Al: Y 342.500..350.000 | Anna: Y 342.793..350.000 | anna: Y 344.521..350.000`, and the same for 50 × 20. The control, 80 × 20: Al 342.202, Anna 342.104, anna 342.104.
- **Severity:** P2, as L3-P2-5. Each record still follows the frame's own rule. The defect is the inconsistency across a batch.
- **Novelty:** new: a partial fix. The #1507 test uses only an 80 mm frame (`variable-text-placement.test.ts:106-133`).
- **Fix direction:** for each record, compute the baseline at the record's own laid-out size from the frame top (the ascender at that size), instead of copying it from the literal template. Add 40 mm frame cases.
- **Refuter: CONFIRMED, P2 kept.**
  - **What would refute it:** the narrow frames are already fixed, or they differ from the parent. Neither holds.
  - **Own repro:** `zz-n4r-boxed.test.ts`, Roboto 10, centred, shrink, `{{csv:name}}`, run on main and with the `0fcbe8e99` stubs.

    | Frame | Build | Al | Anna | anna | Peggy | Baseline spread |
    |---|---|---|---|---|---|---|
    | 40 × 20 | main | 342.500 | 342.793 | 344.521 | 340.757 | **2.02 mm** |
    | 40 × 20 | parent | 342.500 | 342.793 | 344.521 | 340.757 | 2.02 mm |
    | 50 × 20 | main | 342.500 | 342.793 | 344.521 | 340.757 | **2.02 mm** |
    | 50 × 20 | parent | 342.500 | 342.793 | 344.521 | 340.757 | 2.02 mm |
    | 80 × 20 | main (control) | 342.202 | 342.104 | 342.104 | 340.068 | 0.10 mm (a-bowl) |
    | 80 × 20 | parent | 342.500 | 342.793 | 344.521 | 340.757 | 2.02 mm |

    - The values are G-code minimum Y.
    - Main equals the parent to the micrometre in both narrow frames, and both match L3-P2-5.
    - The stored template is 38.724 mm wide in the 40 mm frame and 49.431 mm in the 50 mm frame; the auditor's 39.544 is a different width measure. Every name fits at full size, so none matches the template's size, and `text-box-render.ts:90` returns each record unmoved.
  - **Why P2:** as L3-P2-5. Each record stays inside its frame, under the frame's own rule. The defect is the inconsistency across a batch, which the canvas does not show because it draws only the template.

### N4-P3-1 — Schema 19 can push single-line values outside the shared text range; the next desktop edit clamps them

- **Where:**
  - `migrate-v18-single-line-text-em.ts:37-38`: Size ×2 (EMS) or ×1.47 (Relief), and line height ÷ the same factor, with no range check.
  - `use-text-dialog-fields.ts:188-197` and `build-text-object.ts:40` clamp to 0.1–1000 mm and 0.1–20.
  - The `get_text` output schema keeps `max(1000)` and `lineHeight min(0.1)` (`electron/mcp/authoring-schemas.ts:39-47,111`).
- **Anchor:** Contract. ADR-564 Amd 1 (`:32`): "A value one entry point accepts is never changed by an unrelated edit in another."
- **Scenario:**
  1. A remote client made EMS text at 600 mm with line height 0.15 before 1.0.28, which the remote allowed.
  2. Schema 19 makes it 1200 mm / 0.075.
  3. A one-letter desktop edit writes 1000 mm / 0.1: the letters shrink 17 % and the line pitch drops 17 %.
  4. Relief 800 mm / 0.12 becomes 1176 mm / 0.082, then 1000 mm / 0.1.
- **Evidence:**
  - REPRO: `zz-n4-migrate.test.ts` shows loads of 1200 / 0.075 / −0.5 and 1176.47 / 0.0816; `zz-n4-extra.test.ts` shows `desktop edit -> size 1000 lh 0.1`.
  - The `get_text` schema rejection is READ: the adapter call returned `unavailable` in the test harness.
- **Severity:** P3. It needs pre-1.0.28 remote values beyond the desktop's old limits, and the change is visible on the canvas.
- **Fix direction:** have schema 19 let the shared range carry migrated values, or let the desktop keep an unchanged out-of-range value (as L3-P2-3's fix direction offered).
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro:** `zz-n4r-p3.test.ts`. A schema-18 EMS Nixish text at 600 / 0.15 / −0.6 loads as **1200 / 0.075 / −0.3**. `sanitizeTextDialogNumericValues`, which every desktop build runs (`build-text-object.ts:40`), writes **1000 / 0.1 / −0.3**. The limits are 0.1–1000 and 0.1–20 (`text-limits.ts`).
  - **Why P3, though the same harm was P2 in L3-P2-3:** only remote-made text can carry such values. Before 1.0.28 the desktop capped Size at 300 mm and line height at 0.5. It would take EMS text above 500 mm, Relief above 680 mm, or a line height below 0.2 (EMS) or 0.147 (Relief). The change shows on the canvas at the edit, and nothing burns differently from what the fields then show.

### N4-P3-2 — Remote `update_text` and jig edits now lay text frames out on the UI thread: a 500-character shrink frame blocks it for 11 s

- **Where:** `render-styled-text.ts:32-41` calls `renderTextGeometry` in process. It is reached from `remote-control/text-edit.ts:54` and `jig-text-object.ts:57`.
  - Before #1508, both rendered a single line (about 0.4 s at 500 characters).
  - The desktop editor lays out the same frame in the text worker (ADR-643 D1).
- **Anchor:** Twin. The desktop editor's off-thread layout.
- **Evidence:** REPRO.
  - `zz-n4-extra.test.ts`: `update_text` with `alignment: center` takes 361 ms at 200 characters and **10,985 ms at 500** (150 × 30 mm shrink frame, Roboto 5).
  - `zz-n4-perf.test.ts`: a 2,000-character shrink frame takes 81 s (69.6 s with the #1507 parent code). The layout cost predates both PRs.
- **Severity:** P3. Only large shrink frames are affected. Nothing burns wrong, but the PC freezes during a phone edit.
- **Fix direction:** route `renderStyledText` through the text worker (`renderTextGeometryOffThread`). Separately, cap or speed up the shrink search (each of its 18+ steps re-wraps the whole text).
- **Refuter: CONFIRMED, P3 kept.**
  - **Read:** `renderStyledText` calls the in-process `renderTextGeometry` (`render-styled-text.ts:33`). Its callers are `remote-control/text-edit.ts:54` and `jig-text-object.ts:57`, both renderer code under `src/ui`. Only `buildTextObject` uses `renderTextGeometryOffThread` (`build-text-object.ts:33`).
  - **Own repro:** `zz-n4r-p3.test.ts` calls `renderStyledText` directly: Roboto 5 in a 150 × 30 shrink frame.
    - 200 characters take 449 ms.
    - **500 characters take 17,005 ms.** A 10 ms interval timer fired 0 times during the call, so the event loop is blocked for the whole call. This PC is slower than the auditor's 10,985 ms.
  - **Why P3:** nothing burns wrong; the PC freezes during the edit.

### N4-P3-3 — A boxed record with an accent above its capitals now rises above the frame top; the overflow flag checks only the bottom

- **Where:** `text-box-render.ts:91-110` moves the record by `dy` to the template's baseline. `:110` sets `overflow` only for `maxY + dy > heightMm`.
- **Anchor:** Contract. ADR-682 D6 (`:82`): the record "moves inside the same frame".
- **Evidence:** REPRO, `zz-n4-output.test.ts`. In an 80 × 20 frame with its top at Y 350.000:
  - Roboto "Ågot" burns Y 340.122..**351.660**, 1.66 mm above the frame top.
  - Relief "Ågot" burns 340.960..**352.020**.
- **Severity:** P3. It is the same behaviour as unframed variable text. The frame is not drawn on the canvas, and the flag feeds only the editor.
- **Fix direction:** flag top overflow too, or shrink a record that would cross the top.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro:** `zz-n4r-boxed.test.ts`, an 80 × 20 frame whose top, the template's burn top, is at 350.000.
    - Main: "Ågot" burns 340.122..**351.660**.
    - Parent: 338.462..350.000, inside the frame.
    - So #1507 introduced it.
  - **Read:** the overflow flag tests only `record.bounds.maxY + dy > layout.heightMm` (`text-box-render.ts:110`), which is the bottom in that frame's y-down layout.
  - **Why P3:** the frame is not drawn on the canvas, so a 1.66 mm rise matches what unframed records do.

### N4-P3-4 — MCP tool descriptions do not say `fontSizeMm` is the em, though #1507 changed its meaning for single-line fonts

- **Where:** `electron/mcp/tool-info.ts:70-74` (`add_text`) and `:101-104` (`update_text`). ADR-682 D2 relabelled only the desktop and jig fields.
- **Anchor:** Contract. ADR-682 Consequences (`:104-105`): "MCP and remote `fontSizeMm` keep their name. For single-line fonts it now means the em too."
- **Scenario:** an agent asked for "10 mm tall letters" in Relief sends `fontSizeMm: 10`. It got 10.00 mm capitals in 1.0.27 and gets 6.80 mm now. Nothing in the tool text says capitals are about 0.6–0.9 of the size.
- **Evidence:** READ.
- **Severity:** P3 (doc).
- **Fix direction:** add the dialog tooltip's sentence to both descriptions.
- **Refuter: CONFIRMED (READ), P3 kept.**
  - `tool-info.ts:70-74` and `:101-104` say "in millimetres" and name `fontSizeMm`, without "em".
  - `mcpFontSizeMm` (`authoring-schemas.ts:40-43`) has no `.describe()`.
  - `grep` for "em height" or "font's em" under `electron/mcp` finds nothing.
  - The Relief 10.00 → 6.80 mm change is the one measured in N4-P1-1's parent run: a Relief Size 10 H is 10.000 mm in the parent and 6.800 mm on main.

### N4-P3-5 — Test truth: the PR tests fail on the parents, but three of the gaps above are untested

- **Where:**
  - `migrate-v18-single-line-text-em.test.ts:100-117`: the frame case checks fields and stored geometry and never re-renders, which missed N4-P1-1.
  - `variable-text-placement.test.ts:106-133`: an 80 mm frame only, which missed N4-P2-1.
  - `:90-104`: the rigid-bend "middle glyph" test passes on the parent code too, so it guards nothing.
  - No test for Bake, Production run or the jig with a missing glyph (N4-P1-2, N4-P1-3).
- **Evidence:** REPRO (the stub runs above) + READ.
- **Severity:** P3.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own stub run:** `variable-text-placement.test.ts` against the refuter's `0fcbe8e99` stubs: **10 fail, 2 pass**. The two that pass are Roboto's H (unchanged by design) and "keeps every record's middle glyph on the template's arc in a rigid bend". So that test guards nothing.
  - **Read:** the migration test's frame case (`:100-117`) compares fields, `bounds` and `paths` but never renders. The boxed test (`:106-133`) uses only an 80 mm frame.

### N4-P3-6 — Frames with Max width saved before 1.0.28 keep the old squeeze on the canvas, while their records now squeeze about the frame centre

- **Where:** `text-style.ts:61-64` (the frame's anchor is now the pivot). Neither the migration nor a load step re-renders stored framed text.
- **Anchor:**
  - **Twin.** The stored template on the canvas and the records at output.
  - **Contract.** ADR-682 D8 (`:91-93`).
- **Scenario:**
  1. The text, built with the parent code: Roboto `{{csv:name}}`, centred, an 80 mm frame at X 100..180, Max width 30.
  2. The canvas template sits at X 112.2..142.2 (centre 127.2).
  3. On main, "Christopher" and "Maximilian Alexander" burn at 125.0..155.0 (centre 140.0), 12.8 mm right of the drawn template.
  4. In 1.0.27 they burned at centres 129.5 and 107.7. Both were wrong before; the error now differs from what is drawn by a constant 12.8 mm.
- **Evidence:** REPRO, `zz-n4-maxwidth.test.ts`. Phase 1 builds and saves the text with `N4_STUB=1507`; phase 2 loads it on main.
- **Severity:** P3. It needs a pre-1.0.28 framed + Max width + centred/right variable text. The burn is now where the frame says, and any edit redraws the template.
- **Fix direction:** re-render framed text with Max width once on load, or with N4-P1-1's migration step.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro:** `zz-n4r-p3.test.ts`, in two phases. Phase 1 builds and saves with the `0fcbe8e99` stubs (Roboto `{{csv:name}}`, centred, fixed 80 × 20 frame at X 100, wrap on, fit none, Max width 30). Phase 2 loads it on main.

    | | Parent burn centre | Main burn centre |
    |---|---|---|
    | Canvas template (X 112.214..142.214) | 127.214 | 127.214 |
    | Christopher | 129.536 | **140.000** |
    | Maximilian Alexander | 131.475 | **140.000** |
    | Al (narrower than Max width) | **140.000** | 140.000 |

    The auditor's 107.729 for Maximilian Alexander comes from a different frame setup. The per-record spread in the parent holds.
  - **Why the severity stays P3:** a 12.8 mm gap between the canvas and the burn looks like a position P1 at first.
    - It is not new. In 1.0.27, any record narrower than Max width ("Al") already burned at 140.000, 12.8 mm from the drawn template. That is L3-P3-1's mechanism, which v7 rated P3 and which covered variable records by READ.
    - Main now puts every record where the frame's alignment says, consistently. The only stale thing is the stored template drawing, and any edit redraws it.

## KNOWN re-observed

- **15-P3-1** (opentype.js route against HarfBuzz route): Pacifico "Café 李" lays out 18.84 mm wide against 19.55 mm for "Café" in the jig repro, the same numbers as L3.
- **L3-P3-2** (in-place edits keep the ink top-left): not fixed, by design (ADR-682 Consequences `:106-107`). Not re-run.
- **15-P2-1 / 15-P3-3** (styled variable anchor, #1359): still holds. Plain centred records: Al −0.305, Anna −0.198, Maximilian +0.347 mm; the H rows are within 0.001 mm.

## Refuted

- **The refuter refuted none of the ten findings.** It checked and rejected these ways of making them false:
  - a load-time re-render (N4-P1-1);
  - a glyph check on plain text at Start or Save (N4-P1-2 and N4-P1-3);
  - an ADR limit that carries an operator warning;
  - a narrow-frame fix (N4-P2-1).

The auditor's own refuted candidates follow.

- **Left- and right-aligned bent records are 1–2 mm off.** The G-code ink extents differ by up to 1.95 mm, but the world-space anchors are exactly 0.000 at every alignment. The difference is each record's own glyph distortion on its own arc radius.
- **A typed rotation (#1504) breaks the bent anchor.** At 90° the anchors are 0.000; the along-text ink offsets move into world Y, as expected.
- **Schema 19 misses text in other containers.** Inactive sheets keep their own schema-18 JSON and migrate when opened (REPRO: size 10 → 20). Autosave (`autosave-record.ts:91`), templates (`project-template.ts:46`), the library (`personal-artwork-model.ts:77`), production designs (`production-manifest-preparation.ts:25`) and retained arrays all go through `deserializeProject`. Groups are flat (`scene.groups`). The scene clipboard is in memory.
- **A missing user font burns silently.** Output is refused with "Variable text … could not render: Font "user-font-1" is not available." Plain text burns its stored geometry.
- **#1507 and #1508 lost each other's lines.** None of the 903 added lines is missing.
- **LightBurn `.lbrn` text changes size.** KerfDesk imports only a Text shape's BackupPath outline and never lays out LightBurn text (`lbrn-geometry.ts:81,126`).
- **A performance regression in variable records.** The plain-record path is the same code in both builds. The 50 → 64 ms difference is run-to-run noise, and the frame path adds 10 ms per record (one cached template render per batch).
- **#1505 (paste, SVG/DXF export) and #1502 (tight bounds) interact with text.** Paste copies every text field (`scene-clipboard-actions.ts`). Exports write the stored or materialised geometry. #1502 changes the selection extent, not `TextObject.bounds`, which `variable-text-anchor.ts:57,103-108` compares.

## Verified clean

- **Size meaning.** Every font scales by its em, as measured above. The generator records `unitsPerEm` 1000 and the measured H tops (690, 639, 910, 680). It refuses a contradicted `cap-height` unless the entry names it as a placeholder (`generate-cnc-stroke-fonts.mjs:192-207`). `cnc-stroke-font.test.ts` passes 6/6.
- **EMS fairing.** The tolerance constants halve against an em that doubled: 500 × 0.006 = 1000 × 0.003, and 500 × 0.02 = 1000 × 0.01.
- **Migration exactness for plain text.** Casual Hand `Hello⏎World` at 10 / 1.2 / 0.1 re-renders as 41.418 × 33.480 both before and after. A fixed frame without shrink and an auto-height frame re-render identically too. `migrate-v18-single-line-text-em.test.ts` passes 6/6.
- **Output glyph warnings reach every emitting route of variable text.** Start (`start-job-readiness.ts:376` via `inspectPreparedStart`), Save (`save-output-emission.ts:95`) and the shared request (`output-preparation.ts:133`). Remote `start_job` uses the same Job Review store.
- **Rows preview.** `VariableRowsPreview.test.tsx` passes 2/2, including the missing-glyph row.
- **Remote receipts.** Notices parse through `mcpOutputSchemas` (the PR test). A PC-made text whose font a remote edit changes gets the counting notice, and the PC toast names 李.
- **Max width in a frame.** Centre, right and left alignment land exactly on 130.000, 160.000 and 100.000.

## Not verified

- **LightBurn itself was not run.** ADR-682's argument that KerfDesk's Size matches LightBurn's Height rests on forum posts, which were not re-fetched.
- **Browser.** The Job Review list and the Save toasts were read through code, not seen in a browser. The phone app's notice toast test (`services/remote-control/test/text-notice-ui.test.mjs`) was not run.
- **The relay Worker** redeploy that carries `notices` (ADR-591 Amd 1 Consequences).
- **`get_text` on migrated out-of-range text.** Only the schema bound was read (N4-P3-1); the call returned `unavailable` in the test harness.
- **Hardware:** none was used.

## Refuter method

- **Who and when.** A fresh-context refuter, 2026-10-29. It used `origin/main` `4f71f1f41`. The commits after `08b5c669b` (#1515–#1517) touch only constant-power advice, the Marlin worker and the tracer. `git diff 3bf24619f 4f71f1f41 -- src/core/text src/ui/text src/io/project` is empty.
- **Where the repros ran.** On the scratchpad `j7-main` copy (main `4f71f1f41`), with the refuter's own config `zz-n4r-vitest.config.ts`. That config is the repo config plus an `fflate` alias and one worker.
  - `N4R_STUB=1507` aliases the `0fcbe8e99` versions of every text-core file #1507 changed. The font data's `capHeight` key is included, so the parent's legacy units come from the real parent data.
  - It also aliases the parent `render-variable-text`.
  - Proof the swap is active: a Relief Size 10 H measures 10.000 mm.
- **How each test ran.** One file at a time, with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n4r-vitest.config.ts --silent=false --disableConsoleIntercept`.
- **What each finding was checked for.** For each finding the refuter stated what would make it false (an upstream guard, an unreachable path, an ADR acceptance that comes with an operator warning, a load-time re-render, or a modelling artefact) and checked exactly that.
- **How N4-P1-1 was checked.** On a 1.0.27-equivalent file the refuter saved itself, through the real `buildTextObject` and `serializeProject` and then `deserializeProject` and the real store's `setProject`. Records were measured from emitted G-code. Warnings were read from `prepared.advisories`, `inspectPreparedStart` and `emitSavePreparedOutput`.
- **How N4-P1-2 and N4-P1-3 were checked.** Through the real store actions: Bake, production run create / open / capture, and `renderJigText`.
- **Novelty.** `docs/audits/` was searched for the frame rule, Bake and glyph, and jig and glyph. The one open PR, #1478, touches no text file.
- **Verdicts.** No finding was refuted, and no severity changed.

## Repro files

**Refuter files** were all in `…\scratchpad\j7-main\` unless named otherwise. They were deleted one at a time by literal path after the runs.

| File | Purpose |
|---|---|
| `zz-n4r-vitest.config.ts` | Repo config + `fflate` alias + one worker. `N4R_STUB=1507` aliases the parent text core |
| `src\core\text\zz-n4r-p-{stroke-font-text,svg-stroke-font,cnc-stroke-font-data,fair-stroke-font,text-box-render,text-bend,text-style,text-on-path}.ts`, `src\ui\text\zz-n4r-p-render-variable-text.ts` | `git show 0fcbe8e99:` copies |
| `src\ui\text\zz-n4r-migrate.test.ts` + `scratchpad\zz-n4r-1027-project.json` | N4-P1-1, two phases: parent build, save and burn, then main load, store, canvas, burn, warnings and re-render on edit |
| `src\ui\state\zz-n4r-siblings.test.ts` | N4-P1-2 and N4-P1-3: variable control, Bake, production run, jig and main-editor plain text, with Start and Save warnings |
| `src\ui\text\zz-n4r-boxed.test.ts` | N4-P2-1 and N4-P3-3: 40 / 50 / 80 × 20 frames on main and parent |
| `src\ui\text\zz-n4r-p3.test.ts` + `scratchpad\zz-n4r-1027-maxwidth.json` | N4-P3-6 in two phases, N4-P3-1 clamp, N4-P3-2 timing |

**Auditor files.** All were in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\`. They were deleted one at a time by literal path after the runs. Nothing under the `node_modules` junction and no `zz-n3*` file was touched.

| File | Purpose |
|---|---|
| `zz-n4-vitest.config.ts` | Repo config plus the `fflate` alias and one worker. `N4_STUB=1507 / 1508 / 1508b` aliases the parent-version stubs |
| `zz-n4-maxwidth-saved.json` | The text that the `N4_STUB=1507` phase of `zz-n4-maxwidth.test.ts` saved |
| `src\ui\text\zz-n4-output.test.ts` | G-code capital heights per font, and Casual Hand two-line spacing (L3-P1-1, P2-1). Bent records: ink offsets and world-space anchors at 3 alignments × rigid × rotation (L3-P1-2, #1504). Missing glyphs at output for 4 fonts plus a serial template (L3-P1-4). Boxed records, including narrow frames, and path records (L3-P2-5, N4-P2-1, N4-P3-3). Max width in a frame (L3-P3-1) |
| `src\ui\remote-control\zz-n4-remote.test.ts` | Real adapter: `add_text` / `apply_edits` / `update_text` with "Café 李" in 4 fonts, and a remote font change (L3-P1-3). `update_text` on fixed and shrink frames and on styled text (L3-P2-2). Remote values against a desktop edit (L3-P2-3). Jig re-render of 6 styles and a jig missing glyph (L3-P2-4, N4-P1-3) |
| `src\ui\remote-control\zz-n4-extra.test.ts` | User font advisory and missing user font. Migrated out-of-range value through `get_text` and a desktop edit (N4-P3-1). `update_text` timing on 200 / 500-character shrink frames (N4-P3-2) |
| `src\io\project\zz-n4-migrate.test.ts` | Schema-18 → 19 load of single-line text in 8 frame configurations with legacy-unit renders. Variable records at output (N4-P1-1). Desktop edit, out-of-range values, inactive sheet |
| `src\ui\state\zz-n4-siblings.test.ts` | Variable control, Bake and Production run with missing glyphs, through output and `inspectPreparedStart` (N4-P1-2) |
| `src\ui\text\zz-n4-perf.test.ts` | 2,000-character text box in 5 layouts and 500 variable records in 3 modes, on main and with the #1507 stubs |
| `src\ui\text\zz-n4-maxwidth.test.ts` | Framed Max-width text built with the parent code and then output on main (N4-P3-6) |
| `src\core\text\zz-n4-stub7-text-bend.ts`, `-text-style.ts`, `-text-box-render.ts`, `-text-on-path.ts` | Parent versions from `0fcbe8e99` (#1507 test truth) |
| `src\core\text\zz-n4-stub7-svg-stroke-font.ts` | Main's `svgStrokeFont`, scaled by the legacy 680 / 500 units |
| `src\ui\text\zz-n4-stub7-render-variable-text.ts` | Parent from `0fcbe8e99` |
| `src\ui\text\zz-n4-stub8-render-variable-text.ts`, `zz-n4-stub8-TextDialogNumericFields.tsx` | Parents from `7fb3adc05` (#1508 test truth) |
| `src\ui\workspace\registration-jig\zz-n4-stub8-jig-text-object.ts` | Parent from `7fb3adc05` |
| `src\ui\remote-control\zz-n4-stub8-text.ts`, `-text-edit.ts`, `-writes.ts`, `-design-batch.ts` | Parents from `7fb3adc05` |
| `src\io\gcode\zz-n4-stub8-prepare-output-snapshot.ts` | Main's file with `missingGlyphAdvisory` disabled |

```json
[
  {"id":"N4-P1-1","severity":"P1","area":"fix-text","file":"src/core/text/stroke-font-text.ts","line":57,"anchor":"Contract: ADR-682 D4 'keeps old single-line text exactly as drawn … a re-render draws the same paths (tested to 1e-9 mm)' (ADR-682…md:67,72); Twin: the schema-18 render with legacy units","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO on a refuter-saved 1.0.27-equivalent file (0fcbe8e99 text core incl. capHeight font data; Relief Size 10 H = 10.000 proves the swap): after deserializeProject + store setProject the canvas keeps 77.276 x 11.000; Relief 80x11 ANNA 39.588x10.000 -> 29.612x7.480, Anna 33.280x9.926 -> 24.892x7.425, Maximilian 69.292x11.000 -> 54.394x8.635; Casual Hand Anna 27.148x12.000 -> 22.222x9.823; advisories/Start/Save []; open toast only says migrated; no load-time re-render (records re-render at every output, text on any edit); regression vs parent. ADR-682 Consequences line is not an operator warning. P1 kept","known":false,"pr":"#1507 (regression)","summary":"Schema 19 scales Size/line height/spacing/minSizeMm but not the frame rule: single-line frames now count a full em per line (heightPerEm 1 × em Size), so migrated text in a fixed shrink-to-fit frame lays out smaller on any re-render. Relief 80x11 name tag saved by 1.0.27: record ANNA burns 29.612 x 7.480 mm (was 39.588 x 10.000), Anna 24.892 x 7.425 (was 33.279 x 9.926); canvas still shows the 11 mm template; advisories []. Worst re-render 68% (Relief ANNA 80x10: 10.000 -> 6.800 mm), Nixish 67%; an alignment-only desktop edit shrinks Casual Hand 27.148x12.000 -> 22.222x9.823"},
  {"id":"N4-P1-2","severity":"P1","area":"fix-text","file":"src/ui/app/bake-variable-text.ts","line":36,"anchor":"Contract: ADR-591 Amd 1 title 'a warning wherever text is made or burned' and D4; Limits concede production run (:66-67), not Bake; Twin: the same record as variable text warns in Start/Save","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO with real store: bakeSelectedVariableText toasts success, baked Zoë 李 5 contours/814 G1, 李 0/0; createProductionRun/openProductionRow/captureProductionVariant raise nothing; rows output advisories/Start/Save [] (control variable text warns in all three). Only glyph preflight code is variable-text-missing-glyphs. ADR-591 Amd 1 Limits name production run (not Bake) and give no operator warning. Canvas showing the dropped glyph is not a warning (L3-P1-3 precedent). P1 kept","known":false,"pr":"#1508 (fix gap)","summary":"Output checks only variable text (prepare-output-snapshot.ts:215); Bake (bake-variable-text.ts:36-47) and Production run open/capture (production-manifest-preparation.ts:26-35, production-manifest-actions.ts:159-184) materialise records and drop the advisory. Pacifico 'Zoë 李' baked or as a production row: 222 G1 moves without 李, advisories [] and Start warnings []; '李' burns 0 moves; Bake toasts success. Exports and print also drop it (READ)"},
  {"id":"N4-P1-3","severity":"P1","area":"fix-text","file":"src/ui/workspace/registration-jig/jig-text-object.ts","line":57,"anchor":"Contract: ADR-591 Decision bullet 1 and Amd 1 title; Amd 1 Limits (:68) concedes no jig hint; Twin: dialog FontUsageHint and remote add_text notice","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO: renderJigText returns no missing list; Café 李 5 contours = Café; output advisories/Start/Save []. Plain text is never checked at output from any route (main-editor plain text also outputs []), but the dialog and canvas text panel show FontUsageHint while typing (KNOWN design from v7 L3), so the jig is a new hint-less route. ADR Limits (:68) carry no operator warning. P1 kept; coordinator may weigh the in-view jig canvas (cf. L3-P2-4)","known":false,"pr":"#1508 (fix gap)","summary":"renderJigText drops renderStyledText's missingCharacters and JigTextControls has no glyph hint; output never checks plain text. 'Café 李' in Pacifico from the jig editor: 5 contours, W 18.84 (same contours as 'Café'), no warning anywhere"},
  {"id":"N4-P2-1","severity":"P2","area":"fix-text","file":"src/core/text/text-box-render.ts","line":90,"anchor":"Contract: ADR-682 D6 and Context (baselines 1.7-2.4 mm apart is the defect); Twin: same records in an 80 mm frame share one baseline","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO on main and 0fcbe8e99 stubs: 40x20 and 50x20 frames give Al 342.500, Anna 342.793, anna 344.521, Peggy 340.757 in both builds (2.02 mm spread); 80x20 main control 342.202/342.104/342.104. P2 kept as L3-P2-5","known":false,"pr":"#1507 (partial fix of L3-P2-5)","summary":"Records move to the template baseline only when laid out at the template's size; the literal {{csv:name}} (55.6 mm at Size 10) shrinks in a 40 or 50 mm frame, so every name keeps the ink-top rule: Al 342.500, Anna 342.793, anna 344.521, Peggy 340.757 (L3-P2-5's numbers exactly); 80 mm control 342.202/342.104/342.104"},
  {"id":"N4-P3-1","severity":"P3","area":"fix-text","file":"src/io/project/migrate-v18-single-line-text-em.ts","line":37,"anchor":"Contract: ADR-564 Amd 1 (:32) 'never changed by an unrelated edit in another'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO: schema-18 EMS 600/0.15/-0.6 loads 1200/0.075/-0.3; sanitizeTextDialogNumericValues writes 1000/0.1/-0.3. Needs pre-1.0.28 remote values beyond the old desktop caps; visible at the edit. P3 kept","known":false,"pr":"#1507 x #1508","summary":"Migration multiplies Size and divides line height without the shared range: a pre-1.0.28 remote EMS 600/0.15 becomes 1200/0.075, which a desktop edit clamps to 1000/0.1 (-17% size, -17% pitch); get_text output schema max 1000 / lineHeight min 0.1 (READ)"},
  {"id":"N4-P3-2","severity":"P3","area":"fix-text","file":"src/ui/text/render-styled-text.ts","line":32,"anchor":"Twin: the desktop editor lays out frames in the text worker (ADR-643 D1)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO: renderStyledText (in-process renderTextGeometry, called by text-edit.ts:54 and jig-text-object.ts:57) on a 150x30 Roboto 5 shrink frame: 200 chars 449 ms, 500 chars 17,005 ms with 0 ticks of a 10 ms timer (event loop blocked). P3 kept","known":false,"pr":"#1508","summary":"Remote update_text and jig edits now lay text frames out on the UI thread: 500-character 150x30 shrink frame 10,985 ms (200 chars 361 ms); 2,000 characters about 70-81 s (layout cost predates both PRs)"},
  {"id":"N4-P3-3","severity":"P3","area":"fix-text","file":"src/core/text/text-box-render.ts","line":110,"anchor":"Contract: ADR-682 D6 'moves inside the same frame' (:82)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO: 80x20 frame top 350.000; main Ågot 340.122..351.660, parent 338.462..350.000 (introduced by #1507); overflow tests only the bottom (text-box-render.ts:110). P3 kept","known":false,"pr":"#1507","summary":"A boxed record with an accented capital is moved to the template baseline and rises above the frame top: Roboto Ågot top 351.660 vs frame top 350.000 (Relief 352.020); overflow flag checks only the bottom"},
  {"id":"N4-P3-4","severity":"P3","area":"fix-text","file":"electron/mcp/tool-info.ts","line":70,"anchor":"Contract: ADR-682 Consequences (:104-105) fontSizeMm now means the em for single-line fonts","evidence":"READ","verdict":"CONFIRMED","refuter":"READ: tool-info.ts add_text/update_text and mcpFontSizeMm carry no em wording; Relief Size 10 H 10.000 (parent) vs 6.800 (main) measured. P3 kept","known":false,"pr":"#1507","summary":"MCP add_text/update_text descriptions do not say fontSizeMm is the em (capitals about 0.6-0.9 of it); Relief fontSizeMm 10 went from 10.00 mm to 6.80 mm capitals"},
  {"id":"N4-P3-5","severity":"P3","area":"fix-text","file":"src/io/project/migrate-v18-single-line-text-em.test.ts","line":100,"anchor":"L7 test truth","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO: variable-text-placement.test.ts on the refuter 0fcbe8e99 stubs: 10 fail, 2 pass (Roboto H and the rigid-bend middle-glyph test); READ of the migration frame case and the 80 mm-only boxed test. P3 kept","known":false,"pr":"#1507, #1508","summary":"PR tests fail on parents (10/12, 5/6, 1/3, 6/6, 2/4) but the migration test never re-renders a frame (N4-P1-1), the boxed-record test uses only an 80 mm frame (N4-P2-1), the rigid-bend middle-glyph test passes on the parent, and Bake / Production run / jig missing glyphs are untested"},
  {"id":"N4-P3-6","severity":"P3","area":"fix-text","file":"src/core/text/text-style.ts","line":61,"anchor":"Twin: stored canvas template against output records; Contract: ADR-682 D8 (:91-93)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO two-phase: canvas template centre 127.214; parent Christopher 129.536, Maximilian Alexander 131.475, Al 140.000; main all 140.000. The 12.8 mm canvas/burn gap already existed in 1.0.27 for any record narrower than Max width (L3-P3-1 mechanism, P3); main burns where the frame alignment says. P3 kept","known":false,"pr":"#1507","summary":"Framed centred Max-width variable text saved by the parent code: canvas template centre 127.214, main burns Christopher and Maximilian Alexander at centre 140.000 (12.8 mm right); pre-fix they burned at 129.536 and 107.729; stored geometry is never re-rendered"}
]
```
