# Rolling audit v5 — Adversarial parsers

- **When:** 2026-10-27   **Tree:** origin/main @ `09f7c0087` (#1476).
  - The repros ran from the audit worktree's `src`. `git diff --name-only HEAD origin/main` over `src/io/svg`, `src/io/tiff`, `src/io/pnm`, `src/io/xml`, `src/ui/trace`, `src/ui/common`, `src/ui/import`, `src/ui/commands`, `src/io/lightburn` and `src/ui/remote-control` lists only `lbrn-geometry.ts` and `lbrn-power-scale*.ts` (#1476, Power Scale) and `gcode-command-actions.ts`. None of them is on a repro path: the XForm and VertList readers are `lbrn-frame.ts` and `lbrn-vertex-list.ts`.
- **Scope:** every file reader, with the lens on hostile and broken files.
  - Images: `src/ui/trace/image-loader.ts`, `jpeg-header.ts`, `src/ui/common/image-density.ts`, `image-import.ts`, `src/ui/commands/import-image-action.ts`, `src/ui/import/{prepare-image-samples,qualified-png-raster,png-*,freeze-gif,svg-image-hydration}.ts`, `src/io/tiff/**`, `src/io/psd/**`, `src/io/pnm/**`, `src/ui/commands/batch-raster-decode.ts`, `src/ui/import/tiff-*.ts`.
  - Vector and document readers: `src/io/svg/**` (units, presentation, embedded images), `src/io/xml/**`, `src/io/dxf/**` (blocks, splines), `src/io/hpgl/**`, `src/io/pdf/**` with `src/ui/import/pdf-artwork-source.ts` and `page-artwork-object.ts`, `src/io/stl/**` with `stl-import-preparation.ts` and `src/ui/app/stl-import-size.ts`, `src/io/gcode/gcode-program-line-parser.ts`.
  - LightBurn: `lbrn-frame.ts`, `lbrn-vertex-list.ts`, `lbrn-geometry.ts`. `.clb`, `.lbdev`, the material library, the machine profile and `.lf2` were re-read only where earlier audits (13, 21, H7) left a gap.
  - Routing: `src/ui/app/import-dispatch.ts`, `project-open-parser.ts`, `src/ui/import/document-import-*.ts`, `import-worker.ts`, `src/ui/remote-control/design-imports.ts`.
  - Governing: ADR-357 (document import, TIFF worker), ADR-404 (EXIF orientation), ADR-046 (SVG units), ADR-268/269 (budgets, workers), ADR-388 (LightBurn), PROJECT.md NN9.
- **Lenses run:** L4 and L5 on every reader; L2 for browser decoding (Chromium and Skia source, plus a real Chromium run); L3 where two readers model the same thing. L1 only for the clauses cited. L6 and L7 only as they touch a finding.
- **Novelty:** `docs/audits/` was searched for each file and symptom. `gh pr list --state open` returns no open PR. Remote SVG/DXF expansion and the SVG `<use>` point budget (J3-P1-1, J3-P2-1) are held and are not re-raised or described here.
- **Repro:** three temporary files, run one at a time with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=1536" node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose`, then deleted. All inputs stayed under 70 KB on disk and 32 MiB inflated.
  - `src/io/zz-j6-parsers.test.ts`: the real `decodeTiffPage`, `parseSvg`, `parseSvgInWorker`, `parseLbrnVertexList` and `importLightBurnProject`.
  - `src/ui/trace/zz-j6-png-exif.test.ts`: the real `importImageFile`, with the browser image element mocked to report what Chromium reported in the next item (the harness of `image-loader-orientation.test.ts`).
  - A 131-byte PNG with an `eXIf` chunk, decoded in the Claude browser pane (Chrome/152.0.7977.167) with `javascript_tool` on a neutral page.
- **Counts:** 7 raised → 0 refuted → P1 2 / P2 3 / P3 2 (+5 KNOWN). The refuter confirmed all 7 and raised J6-P3-2 to P1 (§3: a silent scale error that is reachable today). Two findings are **SECURITY — hold details until fixed** (J6-P2-1, J6-P2-2).
- **Refuter:** fresh context, 2026-10-27, on origin/main `09f7c0087`. Repros ran one at a time and were then deleted:
  - `src/ui/trace/zz-j6r-png.test.ts`: the real `importImageFile` with a real 40 × 20 PNG that has an `eXIf` chunk.
  - `src/io/zz-j6r-parsers.test.ts`: the real `parseSvg`, `parseLbrnVertexList`, `importLightBurnProject`, `decodeTiffPage` and `decodePnm`.
  - In-page scripts in the Claude browser pane (Chrome/152.0.7977.167) on `https://example.com`.
  - Chromium and Skia sources fetched at the Chromium version the installed Electron ships.

## Headline

**A PNG that carries an EXIF orientation imports squashed (J6-P1-1).** Chromium, which KerfDesk runs in, turns a PNG by its `eXIf` Orientation. KerfDesk sizes the PNG from its header, which it reads as never turned, but takes the pixels from Chromium already turned. A 40 × 20 px PNG with Orientation 6 comes in as a 4 × 2 mm box holding a 20 × 40 pixel grid, so the engraving is distorted with no warning. ADR-404 left PNG orientation out on the belief that the result would stay self-consistent, and it does not.

**Two findings are SECURITY — hold details until fixed.**

Their details are withheld until the fix merges (J6-P2-1, J6-P2-2).

**An SVG whose root size is in `Q` imports at the wrong scale (J6-P3-2, raised to P1 by the refuter).** CSS Values 3 defines Q, and Chromium 152 draws `width="200Q"` at 50 mm. KerfDesk imports it at 100 mm and gives no note.

Also:

- Multi-File Trace decodes TIFF and Netpbm on the UI thread, which freezes the window (and the software Abort) for seconds to minutes during a job (J6-P2-3).
- A corrupt TIFF fails with a raw DataView message (J6-P3-1).
- An unreadable LightBurn `XForm` silently puts the shape at the origin (J6-P3-3).

The rest of the readers hold: see Verified clean.

## Findings

### J6-P1-1 — A PNG with an EXIF Orientation of 5–8 imports squashed: the bounds come from the stored header size, the pixels from Chromium's turned decode

- **Where:**
  - `src/ui/trace/image-loader.ts:330-331`: `readHeaderImageInfo` returns a PNG as `{ stored: png, oriented: png, orientation: 1 }`, so `readImageNaturalSize` (`:275`) gives the stored size.
  - `src/ui/trace/image-loader.ts:204-213`: the element route keeps the engine's turned `img.width`/`img.height`, because `engineIgnoredOrientation` only fires when the header says the image is turned.
  - `src/ui/import/prepare-image-samples.ts:59-60`: `natural` comes from the header and `sampled` from the decode.
  - `src/ui/common/image-import.ts:48-53`: the bounds come from `naturalWidth`/`naturalHeight`, and `pixelWidth`/`pixelHeight` come from `sampled`.
- **Anchor:**
  - **Ground truth.** Chromium applies a PNG's `eXIf` Orientation:
    - `png_image_decoder.cc` at tag `130.0.6723.0`, L493-L501 (https://github.com/chromium/chromium/blob/130.0.6723.0/third_party/blink/renderer/platform/image-decoders/png/png_image_decoder.cc#L493-L501): "`if (png_get_eXIf_1(png, info, &exif_size, &exif_buffer) != 0) {`" then `ApplyExifMetadata(...)`, which sets `orientation_` (`image_decoder.cc` L986-L995 at the same tag).
    - The Rust PNG codec used from Chromium 146 does the same. `SkPngRustCodec.cpp` at Skia `81021b53e74ca2e8d2345908d91b6291d7c697c9` (the `skia_revision` in Chromium `146.0.7680.0` DEPS), L356-L365, reads "`if (reader.has_exif_chunk()) {`" and returns the parsed origin. `skia_image_decoder_base.cc` L109 at tag `146.0.7680.0` reads "`orientation_ = static_cast<ImageOrientationEnum>(codec_->getOrigin());`".
  - **Contract.** ADR-404 Consequences (`docs/decisions/ADR-404-oriented-image-import-and-line-invert.md:84-86`): "If an engine applies one of those, the image-element route still decodes self-consistently, but the header-derived size would be the stored one." Chromium is such an engine, and the import is not self-consistent: it combines the header size and the decoded grid.
  - **Twin.** A JPEG with the same Orientation is turned consistently (ADR-404 decisions; `image-loader-orientation.test.ts`). A PNG of 25 MB or more, or one past the canvas edge, goes to KerfDesk's own decoder (`qualified-png-raster.ts`), which ignores `eXIf` and stays unturned. So the same picture imports two different ways depending on its file size.
- **Scenario:**
  1. Import a 40 × 20 px PNG whose `eXIf` IFD0 Orientation is 6, with no density, so 254 DPI applies.
  2. Every browser and Chromium show it as 20 × 40, portrait.
  3. KerfDesk creates a raster with bounds 4 × 2 mm (landscape) and a 20 × 40 pixel grid (portrait). Each pixel is stretched 4:1 and the engraving is distorted.
  4. The toast says "Added image: turned.png (40x20 px, processed at 20x40 · default 254 DPI — no usable embedded density)". That is not a warning.
  5. Above the burn cap, `createImageBitmap` is asked for the stored aspect and returns the turned picture squeezed into it. Chromium measured: a resize to 40 × 20 returns 40 × 20.
  6. Siblings on the same loader: SVG-embedded PNGs (`svg-image-hydration.ts`, with `svg-embedded-bitmap-size.ts:7` "PNG eXIf orientation is not read"), the remote `import_file` PNG (`design-imports.ts:247` → `importImageFile`), Trace and Multi-File Trace (ADR-409 takes the native size from `readImageNaturalSize`).
- **Evidence:** REPRO, two parts.
  - **Chromium 152** (Claude browser pane, `Chrome/152.0.7977.167`), with a 131-byte 40 × 20 PNG whose left half is red, Orientation 6:
    - `imgNatural "20x40"`;
    - `bitmapFromImage "20x40"`;
    - `bitmapResize40x20 "40x20"`;
    - drawn into a 40 × 20 canvas, `topLeft 255,0,0 | bottomLeft 0,0,0`. The turned image is squeezed: the stored layout would be red at both points.
  - **KerfDesk** (`zz-j6-png-exif.test.ts`, the real `importImageFile` with the element reporting 20 × 40):
    - `png-exif6 object {"bounds":{"minX":0,"minY":0,"maxX":3.9999999999999996,"maxY":1.9999999999999998},"pixelWidth":20,"pixelHeight":40}`;
    - `drawn [[20,40]]`.
- **Severity:** P1 under §3: it silently produces the wrong physical output (aspect and size), and no warning names the mismatch. The canvas shows the squashed picture, but under the 2026-10-27 clarification a visible result is not a warning. Reach is narrow: only PNGs whose `eXIf` says 5–8, for example ones converted from phone JPEGs by tools that copy EXIF without turning the pixels. §3 has no reach clause.
- **Refuter:** CONFIRMED, P1 kept.
  - *What would make it false:*
    - the Chromium that ships in Electron does not apply PNG `eXIf`;
    - the PNG header read is turned;
    - the import builds its bounds from the decoded size;
    - an aspect check or a warning comes before output.
  - *Ground truth, pinned to the shipped Chromium.*
    - The installed Electron 44.5.1 reports `process.versions.chrome` 152.0.7977.130. `package.json` pins 44.9.1, which is on the same 152 line.
    - At tag `152.0.7977.130`, `third_party/blink/renderer/platform/image-decoders/png/png_image_decoder.cc` (L24-L30) has only the Rust codec: `SkPngRustDecoder::Decode`.
    - In the same tag, `skia_image_decoder_base.cc` L109 sets `orientation_` from `codec_->getOrigin()`.
    - The DEPS `skia_revision` is `e8efd15f214a4d59b427f55f7769b6dbbb09bbcc`. There, `src/codec/SkPngRustCodec.cpp` L358-L367 reads "`if (reader.has_exif_chunk()) {`" and returns the parsed origin (https://github.com/google/skia/blob/e8efd15f214a4d59b427f55f7769b6dbbb09bbcc/src/codec/SkPngRustCodec.cpp#L358-L367).
    - The auditor cited tags 130 and 146; these are the lines that ship.
  - *Own browser run.*
    - Setup: Chrome/152.0.7977.167. A 30 × 10 PNG built in the page, red, green and blue in thirds, with no `eXIf` or with Orientation 6, 8, 5 or 3.
    - No `eXIf`: 30x10.
    - Orientation 6, 8 and 5:
      - `img`: 10x30.
      - `createImageBitmap`, default and `from-image`: 10x30.
      - A resize to 30x10: returns 30x10, squeezed.
    - Orientation 3: 30x10, with blue at the top left, so turned 180°.
  - *Own KerfDesk repro* (`zz-j6r-png.test.ts`: the real `importImageFile`, a real 40 × 20 PNG with an `eXIf` IFD0 Orientation of 6, and the element stubbed at the measured 20 × 40):
    - Orientation 6: `bounds 4.000 x 2.000 mm, grid 20x40, draws [[20,40]]`.
    - The control without `eXIf`: `bounds 4.000 x 2.000 mm, grid 40x20`.
  - *Guards read.*
    - `image-loader.ts:331` returns a PNG as Orientation 1, while `parseJpegHeader` handles a JPEG. So JPEG is handled and PNG is missed.
    - `engineIgnoredOrientation` (`:217`) cannot fire for Orientation 1.
    - The bounds come from the header and the grid from the decode (`prepare-image-samples.ts:59-60`, `image-import.ts:48-53`).
    - Nothing in `import-actions.ts` compares the bounds with the grid.
  - *ADR-404.* The Consequences (`:84-86`) leave PNG out and predict that the import stays self-consistent. The repro contradicts that.
  - *Severity.* The toast's "processed at 20x40" is a size line in a success toast. It does not say that the image is distorted. Above the burn cap (step 5), even that line shows the stored aspect. No app message names the mismatch, so §3 (2026-10-27) keeps the finding at P1.
  - *Novelty.* No audit mentions PNG `eXIf`. Open PRs #1477 and #1478 touch none of these files.
- **Fix direction:** Read the PNG `eXIf` Orientation in `readHeaderImageInfo` (the IFD0 walk `jpeg-header.ts` already has), so the header size is the turned one. Or build the import geometry from the decoded size, as ADR-404 does for engines that ignore orientation. Decide whether the qualified PNG decoder should turn too, so both size routes agree. Correct ADR-404's consequence.

### J6-P2-1 — SECURITY — held until fixed

- Details are withheld until its fix merges (security hold); the full text is kept privately by the coordinator.

### J6-P2-2 — SECURITY — held until fixed

- Details are withheld until its fix merges (security hold); the full text is kept privately by the coordinator.

### J6-P2-3 — Multi-File Trace decodes TIFF and Netpbm synchronously on the UI thread; a large scan freezes the window, and the software Abort, for seconds to minutes during a job

- **Where:** `src/ui/commands/batch-raster-decode.ts:34-36`: `decodePnm(bytes)` and `decodeTiffPage(bytes, 1)` are called directly from `multi-file-trace-action.ts:206`. No worker is involved, and nothing stops the tool while a job runs: `MultiFileTraceDialog.tsx:297-305` only blocks a second trace.
- **Anchor:**
  - Contract: ADR-357 item 6 (`ADR-357-…md:49`): "TIFF decoding is a lazy worker". PROJECT.md:465 NN9: Abort is "reachable from any window state during a job".
  - Twin: File > Import decodes the same TIFF in `tiff-import.worker.ts`.
- **Scenario:**
  1. During a long engraving, the operator starts Multi-File Trace (Pro) on scanned TIFFs.
  2. The decoder takes about 0.6 µs per pixel (2000 × 2000 grey: 2,469 ms). A 24 MP scan freezes the window for about 15 s per file, and a 16384 × 16384 page for about 165 s.
  3. Streaming runs in a worker and continues. The Abort button and Ctrl+. are on the frozen thread.
- **Evidence:** REPRO (`zz-j6-parsers.test.ts`, the real `decodeTiffPage`, uncompressed grey): `tiff-time 1000x1000: 748 ms`, `tiff-time 2000x2000: 2469 ms`. The UI-thread placement is READ (`batch-raster-decode.ts:31-46`).
- **Severity:** P2. NN9 is broken with a clear failure scenario, using an ordinary file. It is not P1: the program itself keeps streaming, and the physical E-stop is unaffected.
- **Refuter:** CONFIRMED, P2 kept.
  - *What would make it false:*
    - the decode runs in a worker;
    - a job gate stops the tool during a job;
    - the cost is trivial.
  - *Read:*
    - `decodeBatchRasterFile` (`batch-raster-decode.ts:31-46`) calls `decodePnm` and `decodeTiffPage` synchronously. `batchRasterAtMaxEdge` then resamples on the same thread.
    - The command is gated only by edition (`edition-command-gate.ts:19`, `advanced-trace`). No command reads `jobActive` from the command context.
    - `runChosenMultiFileTrace` (`MultiFileTraceDialog.tsx:297-305`) only blocks a second batch.
    - So it can run during a job.
  - *Real size* (my repro, the real decoders, uncompressed 8-bit grey):

    | Format | 500² | 1000² | 24 MP scan | 16384² page |
    |---|---|---|---|---|
    | TIFF | 156 ms (0.62 µs/px) | 1,005 ms (1.0 µs/px) | about 15-24 s per file | about 3-4.5 min |
    | Netpbm P5 | 13 ms (0.05 µs/px) | 30 ms (0.03 µs/px) | about 1 s | about 8-13 s |

    - The minutes come from TIFF. Netpbm stalls for seconds, and only at extreme sizes.
    - Each file blocks once, and the UI runs between files.
  - *Anchors:*
    - NN9 (`PROJECT.md:465`, "No modal can block it") verified.
    - ADR-357 item 6, "TIFF decoding is a lazy worker" (`ADR-357-…md:49`), verified.
  - *Novelty:* none in `docs/audits/` or in the open PRs.
- **Fix direction:** Decode batch TIFF and Netpbm in the existing TIFF worker (or a batch worker) and transfer the RGBA back, as File > Import does.

### J6-P3-1 — A TIFF whose strip inflates short fails with the raw message "Offset is outside the bounds of the DataView"

- **Where:** `src/io/tiff/tiff-page.ts:28-31` passes the strip to `tiff`'s `readStripData`. Its sample reader (`tiff_decoder.js:229-230`, `data.getUint8(index)`) reads past the inflated data. `tiff-import.worker.ts:21` posts `error.message` as the import error.
- **Anchor:** Contract: ADR-357 item 6 ("fail visibly", with named variants in `tiff-page.ts:44-67`). METHOD L6: a true message.
- **Scenario:** a 100 × 100 Deflate TIFF whose strip inflates to 10 bytes (a truncated download or a damaged file). The import fails with "Offset is outside the bounds of the DataView" instead of saying the TIFF pixel data is incomplete. `pixelsForPage` has that message (`:133-135`), but it is never reached.
- **Evidence:** REPRO: `tiff-short-strip message: "Offset is outside the bounds of the DataView"`.
- **Refuter:** CONFIRMED, P3 kept.
  - *Repro:* a 100 × 100 Deflate TIFF whose strip inflates to 10 bytes. `decodeTiffPage` threw "Offset is outside the bounds of the DataView".
  - *Why the named message is never reached:* the library's sample reader throws first (`tiff_decoder.js:230`, `getUint8`), so `pixelsForPage`'s "Incomplete TIFF pixel data." (`tiff-page.ts:134`) never runs.
- **Fix direction:** Give a short strip a named error ("Incomplete TIFF pixel data").

### J6-P3-2 (refuter: P1) — An SVG whose root `width`/`height` is in `Q` (quarter-millimetres) imports at the wrong size with no note; the same unit is read correctly everywhere else in the file

- **Where:** `src/io/svg/svg-units.ts:25-31`: the root's `SVG_LENGTH_UNITS_TO_MM` has no `q`, so `parseSvgLengthMmOrNull` (`:98`) returns null and the root counts as undeclared. The element and nested table, `CSS_LENGTH_UNITS_TO_USER_UNITS` (`:17-24`), includes `q`.
- **Anchor:**
  - Twin: the two tables in the same file.
  - Ground truth: CSS Values and Units Level 3 lists `Q` (quarter-millimetres) among the absolute lengths, and SVG 2 takes `width`/`height` as CSS lengths. UNVERIFIED: the source was not re-fetched in this audit, and the finding rests on the twin and the repro.
  - Contract: ADR-046 treats only `%` and unparseable lengths as undeclared.
- **Scenario:** `<svg width="200Q" height="200Q" viewBox="0 0 100 100">` with a 100-unit rectangle. 200Q is 50 mm. KerfDesk takes the viewBox-only rule (1 unit = 1 mm) and imports it at 100 × 100 mm, twice the size, with `notes: []`. Without a viewBox, the page falls back to the 100 px default. Reach: no common exporter writes `Q`.
- **Evidence:** REPRO: `root-Q {"bounds":{"minX":0,"minY":0,"maxX":100,"maxY":100},"notes":[]}` against `root-mm` (`width="50mm"`) `{"maxX":50,"maxY":50}`.
- **Refuter:** CONFIRMED. **Raised to P1.**
  - *What would make it false:*
    - Q is not a valid unit for the root `width`;
    - the browser also ignores Q;
    - a note discloses the fallback.
  - *Ground truth, now fetched (the anchor is no longer UNVERIFIED):*
    - CSS Values and Units 3, W3C CRD 2024-03-22, §5.2 (https://www.w3.org/TR/2024/CRD-css-values-3-20240322/#absolute-lengths): "1Q = 1/40th of 1cm".
    - SVG 2 CR 2018-10-04, `geometry.html` §7.8 (https://www.w3.org/TR/2018/CR-SVG2-20181004/geometry.html): the `width` and `height` properties size `svg`.
    - Chromium 152 (browser pane): `<svg width="200Q" height="200Q" viewBox="0 0 100 100">` renders at 188.97 px (`img` natural 189). That is the same as `50mm` and `5cm`. Lower-case `200q` gives the same result.
  - *KerfDesk repro* (`zz-j6r-parsers.test.ts`, the real `parseSvg`):
    - `200Q` and `200q` give bounds 100 × 100 with `notes: []`. `50mm` gives 50 × 50.
    - Without a viewBox, `200Q` gives 26.46 mm (the 100 px fallback) instead of 50 mm.
  - *Severity, P3 → P1 under §3:*
    - The physical scale is silently wrong: 2× here, and any ratio in general.
    - It is reachable today with any SVG that declares Q, and no app message names it.
    - "No common exporter writes Q" is a reach argument. Reach cannot lower a reachable P1 (2026-10-23 clarification).
    - The size readout on the canvas is not a warning (2026-10-27 clarification).
    - 14-P2-1 is different: its files are ambiguous (72 or 96 DPI). This file states its size unambiguously, and the browser honours it.
- **Fix direction:** Add `q: 0.25` to `SVG_LENGTH_UNITS_TO_MM`, or derive both tables from one.

### J6-P3-3 — An unreadable LightBurn `XForm` is silently replaced by the identity, so the shape lands at the origin; the same file's unreadable coordinates are reported as damage

- **Where:** `src/io/lightburn/lbrn-frame.ts:48-50` (`parseXFormText`): when `values.length !== 6` or a value is not finite, it returns `IDENTITY_MATRIX`.
- **Anchor:**
  - Twin: `lbrn-geometry.ts:88-91`, where shapes whose coordinates "are not numbers or lie beyond ±1,000,000 mm" are left out with "The file may be damaged."
  - Contract: ADR-388 (`docs/decisions/ADR-388-lightburn-project-import-fidelity.md:60`): "Nothing is dropped without a line in the report."
- **Scenario:**
  - A 10 mm `Rect` with `XForm` `1 0 0 1 100 50` imports at x 95..105.
  - With a damaged `XForm` (`1 0 0 1 100`, `… NaN`, or comma-separated) it imports at x −5..5, the bed corner, half off the bed. The report has `warnings: []`.
  - Only damaged or hand-edited files reach this; LightBurn writes six space-separated numbers.
- **Evidence:** REPRO (`importLightBurnProject`):
  - `xform "1 0 0 1 100 50" {"bounds":{"minX":95,…}}`;
  - `xform "1 0 0 1 100" {"bounds":{"minX":-5,"minY":395,"maxX":5,"maxY":405},…,"warnings":[]}`;
  - the same result for `NaN` and the comma form.
- **Refuter:** CONFIRMED, P3 kept.
  - *Repro* (`importLightBurnProject`, a 10 mm `Rect`):
    - `1 0 0 1 100 50` gives x 95..105.
    - `1 0 0 1 100`, `1 0 0 1 NaN 50` and `1,0,0,1,100,50` each give x −5..5, with `warnings: []`.
  - *Why P3 is kept:*
    - A five-value or `NaN` XForm has no readable position. There is no correct output to compare with, so "wrong physical output" cannot be established. The defect is the missing report line.
    - Not verified: whether LightBurn reads a comma-separated XForm. If it does, the comma case is a silent position error on a file LightBurn opens correctly, and that case would be P1.
  - *Anchor note:* the ADR-388 sentence (`:60`) closes item 6, which covers Kerf offset. It is a general statement, but its clause is about cut settings. The twin (`lbrn-geometry.ts:88-91`) carries the finding.
- **Fix direction:** Treat a present but unreadable `XForm` like unreadable coordinates: leave the shape out and count it in the damaged-shapes line. A missing `XForm` stays the identity.

### KNOWN (not re-raised)

- **14-P2-1** (Illustrator SVG units) and **14-P3-4** (DXF without units): re-read; unchanged.
- **21-P3-7** (`.lbdev` quadratic regex on the main thread): unchanged.
- **J3-P1-1 and J3-P2-1** (held): referenced by ID only.
- **Refuter check:** all five are still present on `09f7c0087`.
  - `svg-units.ts` still fixes 96 px/in.
  - `INSUNITS_TO_MM` still maps 0 to 1 mm (`dxf-document-stream.ts:28`).
  - `extractFirst` in `lbdev-import.ts:279-281` still builds the lazy `[\s\S]*?` tag regex.
  - Open PRs #1477 and #1478 touch none of them.

## Refuted

The refuter refuted none of the seven raised findings.

(The auditor's own candidates, rejected before raising.)

- **PDF Image import drops filled form fields.** pdf.js `render()` defaults to `annotationMode = AnnotationMode.ENABLE` (`pdfjs-dist/build/pdf.mjs:15856` in the shared `node_modules`, 6.3.289; main pins 6.4.299, which was not re-read), so form appearances are painted. The vector route sends annotation operators to the image route (`pdf-vector-page.ts:124-125`).
- **A TIFF without ResolutionUnit falls back to 254 DPI.** The `tiff` library defaults the unit to inches (`tiff_ifd.js:108-110`, `|| 2`), as TIFF 6.0 says, so `pageDensity` uses the stored X/YResolution.
- **G-code Inspector arcs explode on a huge radius.** `arcStepRad` clamps to between 1° and 15° per segment (`arc-sampling.ts:9-19`), and the parser has no `P` turn count. A full circle is at most 361 points.
- **A crafted `.lf2` or machine profile hangs the Auto-focus regex** (`autofocus-command.ts:42`, the same ambiguous pattern). The length is checked first (`:81`).
- **A `.lf2` raster `dataUrl` with a remote URL leaks a request on open.** The validator checks only that it is a string, but the CSP `img-src 'self' data: blob:` plus the camera bridge (`electron/main.ts:203`) blocks remote fetches. This was not runtime-tested.
- One item about a held security finding is withheld until its fix merges.

## Verified clean

- One item about a held security finding is withheld until its fix merges.
- **DXF:** INSERT of an unknown block, nesting past 8, and unreadable coordinates are all skipped with a note (`dxf-expand.ts:81,185,233-236`). Arc sampling is bounded.
- **HPGL:** arc chord and sweep ranges plus the `reservePoints` budget (`hpgl-arcs.ts:55-63`). Whole-file refusal for unknown commands and polygon-mode violations.
- **PDF:** the page size comes from the viewport, with rotation and UserUnit, at 72 pt per inch (`pdf-artwork-source.ts:94-95`). The image route uses the page's millimetre bounds (`page-artwork-object.ts:53-57`). Passwords are refused with a message. pdf.js runs in an owned worker with WASM and scripting off, and a dead worker is reported.
- **STL:** the binary length signature is authoritative. NaN and Infinity are refused. A mesh flat in X or Y is refused (`mesh-to-heightmap.ts:94-99`). The tiny-model and bed-fit rescales are disclosed (`stl-import-size.ts:100-114`).
- **PSD:** 8-bit RGB and grey only, with named refusals for CMYK, 16-bit, PSB and ZIP. RLE rows are validated before allocation. There is a 512 MiB working budget. The ResolutionInfo DPI is used as pixels per inch.
- **Netpbm** (`src/io/pnm/decode-pnm.ts`): the edge is capped at 16384, and the file must be able to hold the raster before the RGBA is allocated (`:46-50`).
- **TIFF structure** (`tiff-structure.ts`): IFD cycles and EXIF/GPS pointer graphs are refused, all metadata stays inside the file, and orientation and density are handled for all eight orientations.
- **Image density** (`image-density.ts`): PNG `pHYs` unit 0, JFIF units 0, EXIF ResolutionUnit 1 and DPI outside 10–10,000 all fall back to the 254 default. JFIF and EXIF densities swap with an axis-swapping JPEG orientation.
- One item about a held security finding is withheld until its fix merges.
- **Animated GIF:** imported as its first frame, with a notice (`import-image-action.ts:62`).
- **LightBurn VertList and XForm:** coordinates out of range are reported (`lbrn-geometry.ts:88-91`). Project open runs in a worker that can be cancelled (`project-open-parser.ts:55`).
- **Command strings from files:** only `autofocusCommand` and the positioning-light commands are free-form controller text in a machine profile or `.lf2` (`device-profile.ts:330`, `positioning-light.ts:7-8`). Both are vetted on load (13-P1-1 fix).

## Not verified

- One item about a held security finding is withheld until its fix merges.
- One item about a held security finding is withheld until its fix merges.
- **PDF FlateDecode bombs inside pdf.js**, and an image-route page larger than Chromium's canvas: whether `getContext('2d')` returns null, as `pageCanvas` assumes, or the page silently renders blank.
- **APNG:** the browser takes the default (IDAT) image, which can be a fallback frame that animation-aware viewers never show. No notice is given, unlike GIF. Not reproduced.
- One item about a held security finding is withheld until its fix merges.
- **Fonts:** hostile TTF/OTF in `.lf2` `embeddedFonts` or Font Import, parsed by opentype.js and HarfBuzz in the text worker. Read only up to the worker boundary.
- **The trace dialog's own geometry for a turned PNG** (J6-P1-1 sibling via ADR-409): identified by reading only.
- **Refuter: an Electron renderer run.** Not run, because this PC had about 700 MB free. The decode evidence is the pinned Chromium 152.0.7977.130 source, which is what the installed Electron reports, plus a Chrome 152.0.7977.167 run.
- One item about a held security finding is withheld until its fix merges.
- **Refuter: whether LightBurn reads a comma-separated XForm** (J6-P3-3). LightBurn is closed source, and this was not tested.
- **Refuter: PNG `eXIf` in the qualified decoder.** A PNG of 25 MB or more, or one past the canvas edge, imports unturned but self-consistent. Whether that counts as wrong output (an orientation of 2–4 or 5–8 that the user sees turned elsewhere) was not ruled. It belongs to J6-P1-1's fix.

```json
[
  {"id":"J6-P1-1","severity":"P1","area":"parsers-adversarial","file":"src/ui/trace/image-loader.ts","line":331,"anchor":"Ground truth: shipped Chromium 152.0.7977.130 png_image_decoder.cc (Rust codec only) and Skia e8efd15f SkPngRustCodec.cpp L358-L367 apply PNG eXIf orientation (also 130.0.6723.0 L493-L501, Skia 81021b53 L356-L365); Contract: ADR-404 Consequences (element route 'still decodes self-consistently'); Twin: JPEG orientation path and qualified PNG decoder","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A PNG with eXIf Orientation 5-8 imports with stored-size bounds (header) and Chromium-turned pixels: 40x20 px Orientation 6 gives a 4x2 mm box holding a 20x40 grid, so the engraving is distorted with no warning; same for SVG-embedded and remote PNG imports"},
  {"id":"J6-P2-1","severity":"held","area":"held","file":"held","line":0,"anchor":"held","evidence":"REPRO","verdict":"CONFIRMED","known":null,"summary":"Security hold: details withheld until the fix merges."},
  {"id":"J6-P2-2","severity":"held","area":"held","file":"held","line":0,"anchor":"held","evidence":"REPRO","verdict":"CONFIRMED","known":null,"summary":"Security hold: details withheld until the fix merges."},
  {"id":"J6-P2-3","severity":"P2","area":"parsers-adversarial","file":"src/ui/commands/batch-raster-decode.ts","line":36,"anchor":"Contract: ADR-357 item 6 'TIFF decoding is a lazy worker', PROJECT.md:465 NN9; Twin: tiff-import.worker.ts","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Multi-File Trace decodes TIFF and Netpbm synchronously on the UI thread (~0.6 us/px: 2000x2000 in 2.5 s, a 24 MP scan ~15 s, 16384^2 ~165 s), freezing the window and the software Abort during a job"},
  {"id":"J6-P3-1","severity":"P3","area":"parsers-adversarial","file":"src/io/tiff/tiff-page.ts","line":28,"anchor":"Contract: ADR-357 item 6 fail visibly; METHOD L6 true message","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A TIFF whose compressed strip inflates short fails with the raw 'Offset is outside the bounds of the DataView' instead of the existing 'Incomplete TIFF pixel data'"},
  {"id":"J6-P3-2","severity":"P1","area":"parsers-adversarial","file":"src/io/svg/svg-units.ts","line":25,"anchor":"Twin: CSS_LENGTH_UNITS_TO_USER_UNITS includes q (svg-units.ts:21); Ground truth: CSS Values 3 CRD 2024-03-22 §5.2 '1Q = 1/40th of 1cm', SVG 2 CR 2018-10-04 §7.8, Chromium 152 renders width=200Q at 50 mm; Contract: ADR-046 only % and unparseable lengths are undeclared","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Root width/height in Q counts as undeclared: width=200Q (50 mm) with viewBox 0 0 100 100 imports at 100 mm, with no note (no viewBox: 26.46 mm). Refuter raised P3 to P1 under §3: silent wrong scale, reachable today; reach cannot lower it"},
  {"id":"J6-P3-3","severity":"P3","area":"parsers-adversarial","file":"src/io/lightburn/lbrn-frame.ts","line":50,"anchor":"Twin: lbrn-geometry.ts:88-91 reports unreadable coordinates as damage; Contract: ADR-388 nothing dropped without a report line","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A present but unreadable LightBurn XForm (5 values, NaN, commas) silently becomes the identity: a shape at x 95..105 lands at -5..5 with warnings []"},
  {"id":"14-P2-1","severity":"P2","area":"vector-importers","file":"src/io/svg/svg-units.ts","line":16,"anchor":"see 14-P2-1","evidence":"READ","verdict":"KNOWN","known":true,"summary":"Illustrator SVG units (75% / 283%), unchanged"},
  {"id":"14-P3-4","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-document-stream.ts","line":28,"anchor":"see 14-P3-4","evidence":"READ","verdict":"KNOWN","known":true,"summary":"DXF without units assumed mm with no note, unchanged"},
  {"id":"21-P3-7","severity":"P3","area":"lb-material-importers","file":"src/io/lightburn/lbdev-import.ts","line":281,"anchor":"see 21-P3-7","evidence":"READ","verdict":"KNOWN","known":true,"summary":".lbdev quadratic regex on the main thread, unchanged; precedent for J6-P2-1"},
  {"id":"J3-P1-1","severity":"P1","area":"fix-remote","file":"(held)","line":0,"anchor":"held","evidence":"READ","verdict":"KNOWN","known":true,"summary":"Held security finding; referenced by ID only"},
  {"id":"J3-P2-1","severity":"P2","area":"fix-remote","file":"(held)","line":0,"anchor":"held","evidence":"READ","verdict":"KNOWN","known":true,"summary":"Held security finding; referenced by ID only"}
]
```
