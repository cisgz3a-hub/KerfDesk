# Rolling audit v10 — V6 Fix: text and CNC (#1589, #1590, #1591, #1602, #1603)

- **When:** 2026-11-08 about 05:00–06:20 (+0800)   **Tree:** origin/main @ `5f09e1110` (scratchpad export `j10-main`, every text, JSON, CNC, preview and Job Review file changed since `df2279e26` hash-checked equal to `5f09e1110`); 1.0.29 = `df2279e26` (scratchpad `zz-v2/old29`, read-only)
- **Scope:** the five fix PRs and their governing ADRs.
  - #1589 (S3-P3-1): `src/io/json/json-tokenizer.ts`. No ADR; recorded in `P3-SWEEP.md`.
  - #1590 (S7-P3-1): `src/core/text/shaped-run-width.ts`, `text-to-polylines.ts`. No ADR.
  - #1591 (S7-P3-2): `src/ui/text/text-frame-preview-path.ts`, `TextBoxFields.tsx`. No ADR.
  - #1602 (S7-P2-1, S7-P2-2): ADR-307 Amendment 4 and ADR-628 Amendment 2. Variable-copy slices, the batch font parse, and `src/core/util/base64-codec.ts` (used by embedded fonts and by `depth-map-base64.ts`, which carries relief heightfields, tone wedges and photo documents).
  - #1603 (S8-P2-1): ADR-154 Amendment 5. The `strategyFallbacks` sidecar, the Preview banner, the Job Review line and the advisory wording.
  - Original findings: S3-P3-1, S7-P2-1, S7-P2-2, S7-P3-1, S7-P3-2 and S8-P2-1. S8 lives on open PR #1596 (`claude/performance-audit-s8`) and was read from there.
- **Lenses run:**
  - **L10:** original repros re-run in Node with esbuild bundles of the real modules. ADRs read against the code. Test truth checked by mutation: each fix reverted in my own copy (`zz-v6/mut`), then its guard test run.
  - **Byte identity:** glyph outlines and variable-array output against 1.0.29, compiled from the same saved project. CNC G-code against 1.0.29.
  - **L4:** Cancel at every copy, 0 / 1 / 1,024 / 10,000 copies, empty and huge fields, a corrupted embedded font.
  - **L6:** the JSON reader on malformed large input; the base64 codec on malformed text.
  - **L9:** where the #1603 notice reaches.
  - **L12:** the related unit suites, plus 50 related e2e tests in Chrome. #1602 and #1603 merged without CI on main.
  - **Not run:** the desktop build (see Not verified). L1–L3 and L5 apply only through the above.
- **Memory gate:** 1.8–4.3 GB free over the session.
  - Vitest ran at 3.1–3.2 GB.
  - The browser waited until the gate read 3,005 MB, then ran at 3.0–3.2 GB.
  - A second browser attempt at 1,979 MB was held, not run.
- **Counts:** 3 raised → 0 refuted (refuter pending) → P1 0 / P2 0 / P3 3 (+ 1 KNOWN)

## Headline

All five fixes hold, and none changes the burn.
- **Text outlines.** 74 render cases are byte-identical to 1.0.29, across:
  - 8 bundled fonts in plain text, shrink frames, auto-height and the 2,000-character frame;
  - CJK through four system fonts: SimHei, STXihei, Noto Sans KR VF (9.93 MiB, just under the cap) and the CFF Source Han Sans;
  - Arabic, Hebrew, combining marks, emoji, tracking and alignment.
- **Variable arrays.** 19 cases are identical to 1.0.29 copy for copy, with the batch parse and the slices. They cover serial, CSV, date, bent, welded, frames, embedded TrueType and CFF fonts, RTL, empty fields, a 5,000-character field, 1 record and 0 records.
- **CNC G-code.** 11 jobs are byte-identical to 1.0.29: adaptive accepted, fallback and mixed, islands, stock-aware rest, both rest fallbacks, and V-carve with ramp.
- **Performance.**
  - Cancel works at every copy.
  - Serial numbers advance exactly once per copy across slices, up to 10,000 copies.
  - The 88 MB project reads in 0.45 s against 1.0.29's 7.0 s.
  - The shrink frame that took 470 ms takes 93 ms.
- **e2e.** All 50 related tests pass.

The three P3s are edges:
- **V6-P3-1.** A design change during **Edit Array**'s now-sliced regeneration stops it with no message. The Array dialog says "The design changed…".
- **V6-P3-2.** For the stock-aware rest fallback, ADR-154 Amendment 5's "same words" does not hold. The Save/Start advisory and Preview say it differently, and the advisory's advice contradicts the reason it gives.
- **V6-P3-3.** Two parts of #1603 have no test that fails without them: recovery's filtering of `strategyFallbacks`, and the compile recording `rest-full-pocket`.

## Findings

### V6-P3-1 — Edit Array's regeneration, now sliced, stops with no message when the design changes mid-batch; the Array dialog says why in the same case

- **Where:**
  - `src/ui/commands/RetainedArraysButton.tsx:139-140`: `isCurrent` is `owner.current === token && useStore.getState().project === captured`.
  - `:154`: `if (!isCurrent()) return;` runs after `prepareRetainedValues` returns `{ ok: false, cancelled: true, message: 'The design changed…' }` (`src/ui/state/prepare-variable-array.ts:136`).
  - `:171-172`: `finally` clears `preparing`.
  - The twin is `src/ui/commands/ArrayDialogHost.tsx:131-136`. When the request is still its own, it shows `result.message`.
- **Anchor:** Twin (Array dialog against Edit Array, both on `prepareVariableArray`). ADR-307 Amendment 4, Decision 3: "A Cancel click, a closed dialog or a changed design is seen at the next turn … so the batch stops and adds no copies."
- **Scenario:**
  1. Open **Edit Array** on a retained variable array of a few hundred copies, and press **Regenerate array**.
  2. While the status reads "Preparing variable copies… n of N", change the project. #1602's yield makes this possible: Ctrl+Z with focus off an input (`use-shortcuts.ts` skips only editable targets), or a phone or remote edit.
  3. The batch stops correctly and nothing is placed. But the status returns to the array summary with no error.
  - The user sees regeneration end and nothing happen.
  - The same change during the Array dialog's batch shows "The design changed while its variable copies were being prepared."
- **Why P3:** nothing is placed and nothing is lost; pressing Regenerate again works. It is a missing message in a narrow interleaving.
  - Before #1602 the batch ran in one task, so this branch was almost unreachable. The same silent `return` is in 1.0.29 (`RetainedArraysButton.tsx:143`).
- **Evidence:** READ. In Node, the cancellation itself is REPRO: `a4-slices.mjs cancel` runs `isCurrent` false at every copy index and gives `cancelled` with no render after the flip. The message path is reading only; Edit Array's dialog was not driven in a browser.
- **Novelty:** new. No open PR touches `RetainedArraysButton.tsx`.
- **Fix direction:** when `prepareRetainedValues` returns `cancelled` while the token is still current but the project changed, show its message, as the Array dialog does.
- **Refuter:** PENDING.

### V6-P3-2 — ADR-154 Amendment 5's "same words" does not hold for the stock-aware rest fallback: Preview and the Save/Start advisory word it differently, and the advisory's "Adjust Rough first or disable it" contradicts the reason it carries

- **Where:**
  - Preview: `src/core/cnc/cnc-strategy-fallback-notice.ts:17-21` gives "Rest machining will clear the whole pocket with the finishing bit instead: <reason> No previous-stock subtraction is used."
  - Advisory: `src/core/cnc/cnc-rest-stock-operation.ts:156` gives "Full offset-pocket fallback: <reason> No previous-stock subtraction is used.", and `src/core/preflight/cnc-preflight.ts:145` appends " Adjust Rough first or disable it."
- **Anchor:**
  - Contract: ADR-154 Amendment 5, Decision 2 ("Preview, Job Review and the advisory say it in the same words (`cnc-strategy-fallback-notice.ts`)"). Its bullets then scope the advisory change to `cnc-adaptive-clearing-invalid` only.
  - Twin: Preview against the Save/Start advisory.
- **Scenario (REPRO, `zz-v6/c1-cnc.mjs` case G):** a 30 × 20 mm pocket with stock-aware rest. The finish bit is end2 and the rough bit end6, and the stock source records a 5 mm previous cutter, so the fallback reason is "cutter changed". On main:
  - The sidecar records `rest-full-pocket`, and Job Review names "whole pocket (rest machining fell back)".
  - Preview: "rest: Rest machining will clear the whole pocket with the finishing bit instead: The previous-stock cutter changed. Review and rebind the stock source to regenerate residuals. No previous-stock subtraction is used."
  - Save/Start: "Layer rest: Full offset-pocket fallback: The previous-stock cutter changed. Review and rebind the stock source to regenerate residuals. No previous-stock subtraction is used. **Adjust Rough first or disable it.**"
  - The advisory tells the operator to adjust Rough first; the reason it quotes tells them to rebind the stock source.
  - G-code is `fa482baae9528f37` on both main and 1.0.29.
- **Why P3:** doc/code drift and wording. Everything the operator needs is disclosed before Save, and the cut is unchanged. The adaptive case, which S8-P2-1 was about, does use one wording (case A).
- **Related KNOWN:** both advisories name the layer by its internal id ("Layer operation-<uuid>"), while Preview names it. That is CNC full audit JR-7 (`2026-09-24-cnc-full-audit.md`), not counted again.
- **Novelty:** new. The open PRs #1606 and #1607 touch the verifier and `cnc-rest-operation.ts`, not this wording.
- **Fix direction:** route `cnc-rest-machining-invalid`'s full-pocket finding through `cncStrategyFallbackNotice`, and drop "Adjust Rough first" for fallbacks, as #1603 did for the Radial-engagement advice. Or narrow the ADR's sentence to the adaptive advisory.
- **Refuter:** PENDING.

### V6-P3-3 — Two parts of #1603 have no test that fails without them: recovery's filtering of `strategyFallbacks`, and the compile recording `rest-full-pocket`

- **Where:**
  - `src/core/recovery/cnc-retained-compilation-sidecar.ts:75-81`, where entries are kept only for retained layers: ADR-154 Amendment 5, Decision 1, "Recovery keeps the entries for the layers a derived job still cuts".
  - `src/core/cnc/cnc-rest-stock-operation.ts:155` and `compile-cnc-layer-passes.ts` `rawToolpathsForLayer`, which record `rest-full-pocket`.
- **Anchor:** METHOD L7 (test truth) and L10 step 5.
- **Evidence (REPRO, `zz-v6/mutate.mjs` M10):**
  - With the filter removed (all entries kept), `src/core/recovery` passes 170 of 170.
  - `rest-full-pocket` appears in tests only as a hand-built sidecar in `preview-cnc-fallbacks.test.ts:35`. No test compiles a rest layer and checks the record.
  - My case G shows the code works today.
- **Why P3:** missing guards only; the behaviour is correct now.
- **Novelty:** new.
- **Fix direction:** a recovery test with a fallback on a dropped layer, and a compile test of a stock-aware rest fallback, beside `adaptive-fallback-disclosure.test.ts`.
- **Refuter:** PENDING.

## Refuted

Candidates I raised and dropped myself:
1. **"The 10,000-copy batch has a 1.4 s block."** That block was garbage collection under 4.1 GB RSS in one run. Re-measured with per-record timing (`a5-tail.mjs`):
   - every record after the first takes under 104 ms of slice;
   - the longest block, 433–495 ms, is the first record (module warm-up, font load and parse);
   - the end after the last copy takes 2–18 ms.

   ADR-307 Amendment 4 already states the first-copy block and owes a quiet-PC browser figure.
2. **"Archived recovery's Start loses the fallback advisory."** `prepareStartJobFromPrepared` uses `compiled-evidence-only`, which skips `appendSourceGeometryIssues`' adaptive check (`cnc-preflight.ts:113-116`). But that route serves only archived recovery (`start-job-source.ts:281`). The operator met the notice at the job's first Start, and the retained sidecar still names the cut in Job Review. Every normal Start uses `full` (`start-job-readiness.ts:231, :305`; `start-job-readiness-async.ts:68`).
3. **"Preview's notice is lost on the worker route."** The packed transfer sends the toolpath header minus `steps` and `executablePlanPreview` (`preparation-transfer-sender.ts:94-104`), so `cncFallbackNotices` crosses. The structured-clone route keeps the property.
4. **"The preflight and the compile could disagree on which layer fell back."** `artworkOperationRuns` makes one run per layer. In cases A, C, D, G, I and K the sidecar layers equal the advisory layers, including the off-output layer (case I, no notice) and adaptive with stock-aware rest (case K: the sidecar keeps `adaptive-offset`, and both advisories show).

## Verified clean

**#1589 — JSON reader (S3-P3-1)**
- **Same tokens and errors.** 60,000 fuzzed texts in random 1–7-character chunks give the same token stream and the same error text as 1.0.29's tokenizer: 0 mismatches. The fuzz covers escapes, `\u` split across chunks, lone surrogates, control characters, DEL and non-ASCII (`j1-tokenizer.mjs`).
- **Original repro.** An 88 MB project-shaped file (four 22 MB base64 strings) is deep-equal to `JSON.parse`. It reads in 450 ms on main against 7,024 ms on 1.0.29, in the same process.
- **L6.** These large files fail with the same `StreamedJsonSyntaxError` message on both builds, 6–18 × sooner on main:
  - truncated inside a string;
  - a raw control character at 30 MB;
  - a bad escape near the end.
- **Test truth.** Reverting the run path fails the guard: 1,080,047 steps against fewer than 100.

**#1590 — shaping cache (S7-P3-1)**
- **Bitwise identity by reading.** The cached width replays opentype.js 2.0.0's `forEachGlyph` sum in the same order: `fontScale`, the `advanceWidth` truthiness test, the kerning lookup and letter spacing.
- **By measurement.** All 74 A1 cases are SAME, including CFF Latin frames (Source Han) and variable-font frames (Noto Sans KR VF, Dancing Script).
- **Original repro.** Roboto 200 characters in the 60 × 30 frame: 470 → 93 ms. The 500-character 150 × 30 frame: 2,827 → 312 ms. The 2,000-character frame: 762 → 220 ms.
- **Test truth.** Removing the cache fails the guard: 4,092 `stringToGlyphs` calls against fewer than 800.

**#1591 — frame preview path (S7-P3-2)**
- **Display only.** The empty-polyline output is unchanged.
- **Test truth.** With the memo dependency broken, the build count is 8 against 3 and the test fails.

**#1602 — variable-copy slices (S7-P2-1)**
- **Byte identity.** 19 cases are identical to 1.0.29 (`a3-array.mjs`).
  - The held parse is used only where `reusableOutlineFont` allows it. Dancing Script, Noto Sans KR VF and Source Han are parsed per record.
  - The font loader returns one `ArrayBuffer` per embedded key, so the held map keys stay stable.
- **Cancel at every point.** For 30-, 100- and 8-copy batches, a Cancel after copy k gives `cancelled`, for k = 0, 1, 2, 3, the middle, n−2 and n−1. After the flip:
  - no render runs;
  - nothing is placed;
  - a later batch is identical to an uncancelled one, so no cache is poisoned.

  `prepareVariableArray` never touches the store, and the host places only through `arraySelection`, so the undo stack is untouched until success.
- **Scale.**
  - 1,024 serial copies: total 458 ms, longest block 64 ms, `SN-00001`…`SN-01024` exactly once.
  - 1,024 CSV copies drawn from 10,000 records, with empty and 300-character fields: correct.
  - 10,000 copies: 10,000 unique values in order.
- **Zero records:** "Copy 1: CSV record 1 is missing", as on 1.0.29.
- **A second Array:** blocked. Create is disabled while preparing (`ArrayDialog.tsx:105`).
- **Closing the dialog:** moves the request counter on (`useRequestCounter`).
- **L6.** A corrupted embedded font (TrueType signature, truncated) fails as copy 1 with the same raw parser text as 1.0.29. `heldFontParser` drops a rejected parse.
- **ADR-307 Amendment 4:** Decisions 1–3 match the code. Output still parses per render (`renderVariableText` → `renderRecord(input, undefined)`).
- **Test truth.** Each of these mutations fails a guard:
  - removing the yield (variable-copy-slices Cancel test);
  - parsing per record (6 / 7 parses against 1);
  - dropping "n of N" (dialog test).

**#1602 — base64 codec (S7-P2-2)**
- **Embedded fonts.** Encode and decode equal 1.0.29 on both the native (`toBase64` / `setFromBase64`) and the table path, at:
  - 4 bytes to 10,485,760 bytes exactly (the cap);
  - sizes on both sides of the 24,576-byte chunk;
  - six real system fonts, among them SimHei, STXihei and Noto Sans KR VF at 9.93 MiB.

  The main text decodes on 1.0.29 and the reverse.
- **Over the cap:** 10,485,761 bytes is refused before encoding.
- **Malformed input.** 4,011 malformed strings give the same bytes or error on both builds, for `embeddedFontBuffer` and `decodeCanonicalBase64`. They cover '=', whitespace, newlines, '-', '_', 'é', CJK, NUL and wrong lengths.
- **Depth-map codec.** It is identical on 18 lengths, up to 8 MB, and on 13 non-canonical inputs, on both paths (`a2-codec.mjs`, `a6-depth.mjs`). Relief heightfields feed G-code, so this matters.
- **ADR-628 Amendment 2:** matches. Electron is 44.9.1 (`package.json:122`).
- **Test truth.** A mutated stray-character table fails the malformed-text test.

**#1603 — adaptive fallback notice (S8-P2-1)**
- **G-code.** 11 jobs are byte-identical to 1.0.29: 40 × 20 = `141a145c18dda7c8`, and 40 × 40 = `cc06816c27214137`, as the S8 refuter measured.
- **What changed.** Only the advisory text, the sidecar, the Preview banner and the Job Review line.
- **Notice on every route:**
  - Preview: `buildPreviewToolpathFromPrepared`, both window and worker routes;
  - Job Review: the operation line;
  - Save G-code: the advisory after write, which rule 7 keeps;
  - Start's warning list (`emitSplit.warnings`);
  - the phone's read-only review: `prepared-job-review.ts` passes Job Review's `model.warnings`, which carry the Start warnings.

  No remote or MCP route exports G-code (`src/ui/remote-control` has no emit). The separate-tool Save also emits the combined program with full checks.
- **Test truth.** Removing Preview's notice or Job Review's line fails `adaptive-fallback-disclosure.test.ts`.

**L12**
- **Unit tests:** 37 focused files, 323 tests, pass on main (`out/vitest-text.txt`, `out/vitest-cnc.txt`).
- **e2e:** run against a Vite dev server on port 4816, Chrome headless.
  - Text and arrays, **34 / 34 passed**: text-render-worker, canvas-text-editing, canvas-text-worker, canvas-text-weld, calligraphy-fonts, cold-start-variable-text, font-picker, multilingual-text-shaping, small-text-focus-audit, variable-array-acceptance, array-grid-tenths, native-project-large-worker, barcode-acceptance.
  - CNC and relief, **16 / 16 passed**: cnc-3d-viewer-ab, cnc-leaders-build, cnc-spindle-review, cnc-stage-recipes, vcarve-conversion, gcode-viewer-stock, omission-review-repairs, depth-map-relief-worker. These are the specs #1603's own body listed as still owed.
  - The server ran from my copy `zz-v6/mut`. Its `src` is `diff -rq`-equal to `j10-main`. Its only difference is a `vite.zz.config.ts` alias of `fflate` to the copy already in the main checkout's pnpm store (`.pnpm/fflate@0.8.3`). This works around the known local gap; nothing was installed.
- **Interactions.** Since 1.0.29, no other merged PR touches the five PRs' files, except #1575's `draw-preview.ts` and `preview-overlays.tsx`. Its worker route carries #1603's notice (Refuted 3).

## Not verified

- **The desktop build (L12) and timing in a production browser bundle.** The perf numbers above are Node bundles in one process, main against 1.0.29, on a shared PC. The quiet-PC browser figures that ADR-307 Amendment 4 owes, including the first-copy block, are still owed.
- **Driving Edit Array and the Array dialog with real fonts while editing mid-batch in the browser.** V6-P3-1 is reading for the message path.
- **Text on a path in variable arrays,** and the 75-character Special Elite path or bend limit. Both are S7-P2-3, fixed on open PR #1601: KNOWN, not re-run.
- **Remote and jig text edits** (N4-P3-2): open PR #1592, KNOWN.
- **The verifier's early exit and the second adaptive or rest resolve per output** (S8-P3-1, S8-P3-2): open PRs #1606 and #1607.
- **The CNC 3D viewer and Design Studio's simulate view.** Neither shows any preflight advisory, this one included. That is outside #1603's stated routes and not raised.
- **IME typing, and the SimHei embed in the real System fonts dialog.** No `queryLocalFonts` in headless Chrome. The codec was measured in Node only.

## Files

`scratchpad/zz-v6/`:
- **Bundles:** `build.mjs`, `entry-*.ts`, `bundles/`.
- **Text:** `a1-render.mjs` (outlines), `a2-codec.mjs` and `a6-depth.mjs` (codecs), `a3-array.mjs` (variable arrays), `a4-slices.mjs` (Cancel, scale, corrupt font), `a5-tail.mjs` (blocks).
- **JSON and CNC:** `j1-tokenizer.mjs` (JSON), `c1-cnc.mjs` (CNC).
- **Test truth:** `mutate.mjs` (mutations), and `mut/` (my copy, with a `node_modules` junction to the main checkout's; never delete it recursively).
- **Outputs:** `out/`.

```json
[
  {"id":"V6-P3-1","severity":"P3","area":"V6","file":"src/ui/commands/RetainedArraysButton.tsx","line":154,"anchor":"Twin (ArrayDialogHost.tsx:131-136) + ADR-307 Amd 4 D3","evidence":"READ (+ Node REPRO of the cancellation)","verdict":"PENDING","known":false,"summary":"Edit Array's sliced regeneration stops silently when the design changes mid-batch; the Array dialog shows 'The design changed…' in the same case"},
  {"id":"V6-P3-2","severity":"P3","area":"V6","file":"src/core/preflight/cnc-preflight.ts","line":145,"anchor":"Contract ADR-154 Amd 5 D2 ('same words') + Twin (cnc-strategy-fallback-notice.ts:17-21)","evidence":"REPRO (c1-cnc.mjs case G)","verdict":"PENDING","known":false,"summary":"Stock-aware rest fallback: Preview says 'Rest machining will clear the whole pocket…', Save/Start says 'Full offset-pocket fallback: … Adjust Rough first or disable it', contradicting the reason's 'rebind the stock source'; layer-id naming is KNOWN JR-7"},
  {"id":"V6-P3-3","severity":"P3","area":"V6","file":"src/core/recovery/cnc-retained-compilation-sidecar.ts","line":75,"anchor":"METHOD L7 / L10 step 5; ADR-154 Amd 5 D1","evidence":"REPRO (mutation M10 survives: 170/170 pass)","verdict":"PENDING","known":false,"summary":"No test fails without recovery's strategyFallbacks filter, and none compiles a rest-full-pocket record (only a hand-built sidecar in preview-cnc-fallbacks.test.ts)"}
]
```

## Refuter (2026-11-08)

- **Tree:** `j10-main` (main `5f09e1110`); 1.0.29 = `zz-v2/old29`, read only. My own copy is `scratchpad\zz-v6r\mut`: `src`, `scripts` and the config files copied from `j10-main`, plus a `node_modules` junction to the main checkout's. I did not reuse the auditor's copy or scripts.
- **Gates:** free memory was 2,340–2,800 MB all session.
  - Vitest (1.5 GB) ran, one worker.
  - The 3 GB browser gate was never met, so Edit Array was **not driven in a browser**. In its place I mounted the real `RetainedArraysButton` and `ArrayDialogHost` in jsdom (Vitest), with the real store, the real `prepareVariableArray` and slices. Only the text renderer was replaced, by the repo's `renderFixture`, gated so the batch can be held at a chosen copy.
- **Counts:** 3 auditor findings → 0 refuted → P1 0 / P2 0 / P3 3. No new findings. One correction to V6-P3-1's scenario (below).

### Verdicts

**V6-P3-1: CONFIRMED at P3.** The old array stays whole and undo is clean. The scenario's reachability is narrower than written.
- **Mechanism (READ at `5f09e1110`).**
  - `RetainedArraysButton.tsx:139-140`: `isCurrent` compares the project captured at the click.
  - `prepare-variable-array.ts:96,100,115`: a changed project gives `cancelled()` (`:132-138`, "The design changed…").
  - `RetainedArraysButton.tsx:154`: `if (!isCurrent()) return;` drops it unseen, and `:171-173` clears `preparing`.
  - The twin `ArrayDialogHost.tsx:132-137` shows `result.message`. 1.0.29 has the same silent `return` (`old29 RetainedArraysButton.tsx:143`).
- **REPRO** (`zz-v6r\mut\src\ui\commands\zz-v6r-retained-midbatch.test.tsx`, output `zz-v6r\out\vitest-midbatch.txt`, 3 / 3 pass).
  - Setup: a retained 4-copy variable array (serial + CSV), Edit Array to 8 columns, Regenerate. The batch is held at the third copy while the status reads "Preparing variable copies… 2 of 8". Then an object outside the array is moved with `applyObjectTransform`, the write a phone or MCP move makes.
  - After the batch is released:
    - There is no `role="alert"`. The status returns to "1 row of 8: the original and 7 copies, …" and Regenerate is enabled again.
    - The project is exactly the one after the move (`===`). The array's objects are JSON-equal to before and the layout object is the same.
    - The undo stack holds only the move's entry: 1 → 2 → 2.
  - Undo gives back the pre-move project **by identity**, with the old text values. Redo, then Regenerate again from the still-open dialog, places 8 copies, closes the dialog, and one Undo returns to the pre-regeneration project.
  - Twin: the same hold and move in the Array dialog shows "The design changed while its variable copies were being prepared."
- **Half-regenerated array: impossible.**
  - Copies are only computed during the batch.
  - The array is replaced in one `set` (`retained-array-actions.ts:56-71`), with one undo entry, "Regenerate array" (`:46`).
  - That `set` runs only after the batch is complete and current (`RetainedArraysButton.tsx:154-167`). It re-checks `isCurrent` and the expected project inside the write (`retained-array-actions.ts:60-61`).
  - So the user always has the old array, intact. Nothing burns differently. Not P1 or P2.
- **Reachability correction.** "Ctrl+Z with focus off an input" does **not** reach it.
  - `Dialog` registers a modal (`Dialog.tsx:44`, `ui-store.ts:405`).
  - Both workspace key handlers return first on `keyboardOwnedElsewhere()` (`use-shortcuts.ts:45,53`, `keyboard-owner.ts:6-8`).
  - The backdrop is `position: fixed; inset: 0` (`theme/tokens.css:632-634`), so the canvas and the menus cannot be clicked either.
  - What remains are writes from outside the window's UI: phone and MCP authoring (`src/ui/remote-control` has no modal check), or another client. That makes it narrower than the auditor wrote. P3 stands.
- **First-slice Cancel** (same test file). Edit Array was held inside copy 1's first render, Cancel was clicked, then the batch was released. Copy 1's second text finished, then the batch stopped. Nothing was placed, the undo stack was unchanged, and the project was `===` before. Clean.

**V6-P3-2: CONFIRMED at P3.**
- **READ.**
  - Preview: `cnc-strategy-fallback-notice.ts:17-21`.
  - Advisory: `cnc-rest-stock-operation.ts:156` → `cnc-rest-issues.ts:37-40` → `cnc-preflight.ts:143-146`.
  - The advisory therefore reads "Layer <id>: Full offset-pocket fallback: <reason> No previous-stock subtraction is used. Adjust Rough first or disable it." Preview words the same fallback differently.
  - ADR-154 Amendment 5 Decision 1 names `rest-full-pocket`, and Decision 2's heading promises "the same words". Its advisory bullet changes only `cnc-adaptive-clearing-invalid`. So this is doc/code drift, as rated.
- **One addition, same finding.** "Rough first" is not a label the operator can find.
  - Nothing in `src/ui` says it. The layer panel calls the control "Pocket roughing bit" (`CncLayerToolFields.tsx:178,184-185`).
  - The phrase appears only in preflight text (`cnc-preflight.ts:145`, `cnc-tool-geometry.ts:79`) and in ADR-153 Amendment 1.
  - The advice line is unchanged since 1.0.29 (`old29 cnc-preflight.ts:145`). What is new is #1603's claim of one wording.
- **Severity.** It stays P3: the cut is unchanged, the fallback is disclosed before Save in Preview and Job Review, and the advisory still names it.

**V6-P3-3: CONFIRMED at P3.** These are my own mutations, in my copy, each restored and `diff`-checked against `j10-main` afterwards.
- **M-F.** `cnc-retained-compilation-sidecar.ts:78-80` was changed to keep every `strategyFallbacks` entry. `src/core/recovery` still passed 18 files and 170 / 170 tests (`zz-v6r\out\mut-filter.txt`).
- **M-R.** `cnc-rest-stock-operation.ts:155` was changed to drop the `rest-full-pocket` record. I ran every suite that names `pocketRestStock`, `strategyFallback` or `rest-full-pocket`, plus `src/ui/laser/job-review`: 65 files, 408 pass (`zz-v6r\out\mut-rest.txt`).
  - The only 14 failures were Node 25's `localStorage.clear is not a function`, in `job-review-gate.test.ts` and `JobReviewBeforeYouStart.test.tsx`. That is the known local quirk, and they fail at `beforeEach`, before any CNC code runs.
  - `cnc-pocket-stock.test.ts:135` checks only the findings text.
- **Note for the fix.** An unfiltered entry for a dropped layer would not show in Job Review: `job-review-effective-operations.ts:68-72` labels only layers the derived job still cuts. It would show in the Preview banner, which lists every entry (`preview-cnc-fallbacks.ts:21-23`). A guard test should assert on the sidecar itself or on the banner, not on Job Review.

### Challenges to "Verified clean"

**#1589, JSON reader. Held.**
- **REPRO** (`zz-v6r\scripts\j1-surrogates.ts`, `zz-v6r\out\j1-surrogates.txt`). Ten project-shaped texts, each with a 3 M-character string and a 1 M-character string. The strings mix:
  - raw surrogate pairs and raw lone high and low surrogates;
  - escaped pairs, escaped lone `\ud800`, `\n`, `é` and `\"`;
  - strings that end or start with a lone surrogate, and an empty string.
- **Chunking.** Either 1–7 characters for the first 200 k, then one giant chunk; or random chunks of up to 64 k, so surrogate pairs and escapes are cut at chunk edges.
- **Result.** All 50 strings equal `JSON.parse`'s.
- **Reading.**
  - `plainStringRunEnd` (`json-tokenizer.ts:201-209`) stops only on a quote, a backslash or a code unit ≤ 0x1F, so surrogates pass as code units, exactly as the per-character path did.
  - A pair split across two `write` calls is rejoined by `finishString`'s `join` (`:187-192`).

**#1590, shaping cache. Held for mixed fonts and sizes.**
- The cache is created per frame layout call (`text-to-polylines.ts:160`), for one object's one font.
- It is keyed by line text only (`shaped-run-width.ts:72`) and stores font units, so every shrink-to-fit size reuses the same run correctly (`:53-61`). Shaping options are a module constant (`text-to-polylines.ts:318`).
- KerfDesk has no per-run font or size inside one text object. A layout with "mixed fonts and sizes" is several objects, each with its own cache.

**#1591, frame preview. Held.**
- Geometry is memoised on the worker's result object (`TextBoxFields.tsx:120-126`). New text gives a new result, and with it a new geometry.
- While the next result is in flight, the last result's outline stays on screen, as before #1591. It is display only.

**#1602, variable-copy slices. Held on every input asked.**
- **Cancel in the very first slice.** See V6-P3-1 above: clean, nothing placed.
- **Two Array dialogs.**
  - The modal registration and the full-screen backdrop prevent opening a second Array or Edit Array dialog from the keyboard or the mouse while one prepares.
  - A second request from the same dialog supersedes the first through the request counter or token (`ArrayDialogHost.tsx:45,132`, `RetainedArraysButton.tsx:138`).
  - A phone or MCP edit meanwhile cancels the batch: with the message in the Array dialog, without one in Edit Array (V6-P3-1).
- **Selection with non-text objects, and CSV values with line breaks** (`zz-v6r\mut\src\ui\state\zz-v6r-mixed-slices.test.ts`, `zz-v6r\out\vitest-mixed.txt`). A grouped badge (two variable texts, a fixed text and an imported SVG logo) in a 2 × 4 grid. CSV values: `A\r\nB`, `line1\nline2\n`, `"q"\n`, empty, then plain.
  - With a fake clock forcing a yield at all 8 copies, the result is deep-equal to the unsliced batch.
  - 8 logo copies are placed.
  - The line breaks reach the copies' content unchanged.
  - Parsing of quoted newlines is `parse-csv.ts`, untouched by #1602 and covered by `parse-csv.test.ts:5,123`.
- **Date variables across midnight.** Not possible within one batch.
  - `prepare-variable-array.ts:66` reads the clock once per batch, and every copy renders with that `now` (`:99`).
  - Edit Array's clock is the saved `evaluationTime` (`RetainedArraysButton.tsx:198`).
  - Slicing cannot split a batch across two dates.

**#1603, fallback notice on every route. Held, with two observations, neither raised.**
- **Preview, Job Review, Save and Start:** as the auditor traced.
- **The layer panel note** that Decision 2 promises exists (`AdaptivePocketFields.tsx:38-39`).
- **Recovery.** The derived job's Job Review line comes from the retained sidecar (`job-review-effective-operations.ts:68-72`, `job-review-detail-facts.ts:304-305`). The archived-recovery Start advisory gap is the auditor's Refuted 2, and I agree.
- **Phone and MCP.**
  - `review_machine_job` pages Job Review's `model.warnings` (`machine-review-pages.ts:65-66`), so the Start advisory reaches the phone.
  - Its operation entries carry `summaries` only (`:152-158`), not the "(adaptive fell back)" label.
  - When artwork sharing is off, the warning text is replaced by "Review this artwork-specific warning on the PC." (`machine-projections.ts:269-271`, `machine-review-pages.ts:115-119`). That is by design, and the count still shows.
  - Neither route exports G-code; `electron/mcp/machine-schemas.ts:56` says so.

### Not verified (refuter)

- Edit Array driven in a real browser with real fonts: the memory gate was never met, so jsdom with real components stood in.
- The CNC wording was confirmed by reading. I did not re-run the auditor's case G (`c1-cnc.mjs`).
- Timing in a production build.

Refuter counts: raised 3, refuted 0, P1 0, P2 0, P3 3, known 1
