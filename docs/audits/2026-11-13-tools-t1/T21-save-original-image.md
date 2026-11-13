# T21 Save Original Image — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.save-original-image`.

## Map
- Menu: Tools → Image → "Save Original Image..." (`src/ui/commands/command-raster-family.ts:38-51`). It is enabled when `hasRasterSelection` is true; otherwise it says "Select an image first." Tooltip: "Save the selected image unprocessed, as PNG, JPEG or BMP". The help text (`src/ui/help/parity-tools-command-help.ts:5-9`) says "exactly as it is in the project, before any operation dithers, adjusts or masks it".
- Handler: `parity-tools-command-context.ts:19-21` opens `SaveOriginalImageDialog` with the **primary** selected raster (a snapshot of the object).
- Dialog: `src/ui/commands/SaveOriginalImageDialog.tsx`. It has a Format select (PNG (lossless) / JPEG / BMP) and a body that says "Saves <source> as it is in the project, before any operation's dithering, adjustments or mask. Use Save Processed Bitmap for what the laser engraves." `initialFormat` (`:73-78`) picks JPEG or BMP when the stored MIME is that format, and PNG otherwise. Submitting closes the dialog first, then saves.
- Core: `src/ui/app/save-original-image.ts:36-56`:
  1. `readRasterSourceFile` (`src/ui/import/paged-raster-source.ts`) reads the embedded `dataUrl`, or the page-backed `imageAsset.sourceAssetId` bytes with a length check.
  2. If `File.type === mime` of the chosen format, the bytes are written unchanged. Otherwise `encodeInBrowser` (`:58-91`) runs: `createImageBitmap`, then a canvas. JPEG is flattened on white and saved at quality 0.95. PNG goes through canvas `toBlob`. BMP goes through `getImageData` and `encodeBmp24` (`src/core/raster/encode-bmp.ts`), which composites alpha onto white and writes a **96 DPI default**.
  3. `pickPreparedSaveTarget` (ADR-656: the picker opens only after the bytes exist), then `target.write`, then a toast.
- What the object holds: import keeps the file's own bytes (`import-image-action.ts:122-125`, `readFileAsDataUrl(file)`). Large PNGs are page-backed. Several routes replace them, and keep `source`:
  - Image Studio Apply (`state/image-edit-actions.ts:41-50`, ADR-242);
  - Crop Image and Flatten Image Mask (`raster/crop-image.ts:70-80`, a luma-only grey PNG, ADR-480 Amd 1);
  - GIF (first frame frozen to PNG, `import/freeze-gif.ts`);
  - TIFF and PDF pages (rendered to PNG, `import/page-artwork-object.ts:72-83`);
  - PSD (composite PNG).
- Project files: a page-backed original is embedded with its MIME on a portable save (`app/portable-project-assets.ts:93-123`). Embedded `dataUrl`s are saved as they are. The original therefore survives Save and reopen.
- Governing: ADR-656 (+Amd 4) save pickers; ADR-242 Studio Apply; ADR-480 Amd 1 Crop bake; ADR-404 (+Amd 1) EXIF orientation; ADR-048 254 DPI import default. No WORKFLOW.md section names this tool. The closest is the image import/export flows.
- Changes since 2026-10-16 (git log on the files above): 995078503 (ADR-656 prepare before picker), ab3226fd1 (C2-P3-1 shared helpers). The dialog and `encode-bmp.ts` are unchanged since October.

## October register re-check
Row #28: "repaired exceptional bitmap cleanup; byte identity, codec/draw/context failure; maximum codec size unqualified".
- Bitmap cleanup on a failed re-encode: **still fixed**. `bitmap.close()` is in a `finally` (`save-original-image.ts:76-79`). The repo tests "releases the decoded bitmap when re-encoding fails (missing-context / draw-failure)" pass.
- Byte identity: **holds**. A real PNG with pHYs and a JPEG with JFIF 300 dpi + EXIF Orientation 6 went through the import's own `readFileAsDataUrl` and then the default `readRasterSourceFile`. Each came out with the same SHA-256 (t21a A). A page-backed PNG read in two chunks is identical too (t21a B).
- Codec, draw and context failure: **holds**. `toBlob` → null gives "Could not save the image: The image could not be encoded." and the picker is never opened (t21a E).
- Maximum codec size: **still unqualified**. This was not run (no browser, by the brief).

## Checks run
| check | method | result |
|---|---|---|
| Same-format byte identity: PNG (pHYs 300), JPEG (JFIF 300 + EXIF Orientation 6), SVG-embedded PNG with XML whitespace in its base64 | script `zz-t21/t21a.test.ts` A → `t21a.log`, real import `readFileAsDataUrl` + real default reader | SHA-256 equal in all 3. EXIF and density survive. Suggested names `photo.png`, `photo.jpg`, `logo.png` |
| Page-backed (IndexedDB) source | t21a B, fake chunk repository through the real `readRasterSourceFile` | identical. A length mismatch gives "Page-backed raster source is 148 bytes; the manifest expects 149." with no picker. No dataUrl and no asset gives "photo.png has neither embedded pixels nor a page-backed source." with no picker |
| Cross-format BMP: density written, re-import size | t21a C, real `saveOriginalImage` + `encodeBmp24`. Codec stubbed (1000×500 px). Re-import through the real `densityFromBytes` + `rasterImportGeometry` | BMP always says 96 DPI. A default-254 import (100 mm) re-imports at 264.58 mm (×2.646). A 300 DPI import (84.67 mm) re-imports at 264.58 mm (×3.125). Only a 96 DPI source keeps its size → **T21-P2-1** |
| Alpha to BMP/JPEG | t21a C | transparent pixels become BMP white (255,255,255). JPEG fills white first (`fillRect`), then `drawImage`, then `toBlob(image/jpeg, 0.95)`. Not black |
| PNG/JPEG re-encode density | READ (`toBlob` on a bare canvas) | no pHYs or JFIF density is written, so a 300 DPI source re-imports at 254 DPI (×1.18). Same mechanism as **T20-P3-1** (KNOWN) |
| "Original" after Crop Image (Flatten uses the same bake) | script `t21b.test.ts` → `t21b.log`, real `cropMaskedRasterImage` with the production RGBA step (`lumaToRgba`) and a Node PNG encoder in place of canvas | colour 40×20 red (220,40,40) becomes a 20×10 grey (94,94,94) crop, white outside the mask. `source` stays `dog.png`, and the picker suggests `dog.png` → **T21-P2-2** |
| After Image Studio Apply | READ `image-edit-actions.ts:41-50` | `dataUrl` becomes the edited bake at the stored grid. "Original" saves the edit. The untouched Background is only in `editorDocument`, which this tool ignores (part of T21-P2-2) |
| After Adjust Image / dither / live mask | READ | these are object fields and are not applied, so the saved file is the untouched pixels, as the dialog says |
| MIME decides identity, not content | t21a D | a JPEG stored as `data:application/octet-stream` (what `readAsDataURL` gives for an empty `File.type`) or `image/jpg`, saved as JPEG, is re-encoded at q 0.95 (EXIF and density dropped). `initialFormat` would also default it to PNG → T21-P3-1 |
| Failure paths | t21a E | cancel (AbortError through the real `webAdapter`): no toast, nothing written. Write error: "Could not save the image: Disk full". Encoder null: error before the picker |
| File names | t21a E | `dog.jpeg`→`dog.png` (PNG chosen), `C:\pics\a:b?.png`→`a-b-.png`, `''`/`.png`→`image.png`, `scan.tif`→`scan.png`, `anim.gif`→`anim.png`, `photo.JPG`→`photo.png`, `pic.png?v=2`→`pic.png`, `archive.tar.gz`→`archive.tar.png`. The extension always matches the format |
| Repo tests | Vitest, 4 files (`save-original-image`, `encode-bmp`, `paged-raster-source`, `image-density`) | 24/24 pass. No test covers the dialog's `initialFormat` or the density of a re-encoded file (T21-P3-3) |
| Project round trip | READ `portable-project-assets.ts:93-123` | the page-backed original is embedded as `data:<sourceMimeType>;base64,<original bytes>`, so byte identity survives Save and reopen |
| LightBurn reference | web fetch of docs.lightburnsoftware.com | only `/Reference/SaveProcessedBitmap/` could be read. It documents no "save original" command, and no format, DPI, colour, alpha or orientation rules. The SaveOriginalImage, ImageMenu and AdjustImage pages were refused by the fetch proxy, so LightBurn's equivalent is **unconfirmed** |

## Findings

### T21-P2-1: Saving the original as BMP writes 96 DPI whatever the image's density, so the file re-imports 2.6–3.1× too large
- **Severity:** P2. The result is wrong and the user is likely to notice it. KerfDesk's own importer reads BMP density (`image-density.ts` `bmpDensity`), so it re-imports at the wrong size. Unlike T20-P3-1 (density missing → documented 254 default), this writes an explicit wrong value.
- **Where:** `src/ui/app/save-original-image.ts:82-84` calls `encodeBmp24(pixels.data, pixels.width, pixels.height)` with no `dpi`. `src/core/raster/encode-bmp.ts:16` defaults to `dpi = 96`. Tone calibration already passes a real dpi (`core/job/tone-calibration-wedge.ts`).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t21\t21a.test.ts` case C → `t21a.log`. 1000×500 px source:
  - imported at the default 254 DPI = 100.00 mm wide; the saved BMP has 96×96 DPI, and re-import gives 264.58 mm (×2.646);
  - imported at 300 DPI = 84.67 mm; re-import gives 264.58 mm (×3.125);
  - expected: re-import at the imported width (100.00 / 84.67 mm).
- **Oracle:** BMP BITMAPINFOHEADER biXPelsPerMeter = DPI/0.0254. The import size is width_px / DPI × 25.4 (ADR-048), so 1000 / 96 × 25.4 = 264.58 mm.
- **Suggested fix:** pass the image's own density to `encodeBmp24`: natural pixels ÷ (bounds mm / 25.4) per axis, or the imported density. Write the same density into re-encoded PNG and JPEG with the T20-P3-1 fix.

### T21-P2-2: After Crop Image, Flatten Image Mask or an Image Studio Apply, "Save Original Image" saves the baked (grey, cropped, mask-whitened) pixels under the imported file's own name
- **Severity:** P2, for a misleading result and a missing warning:
  - The menu tooltip says "unprocessed". The dialog says it saves `dog.png` "before any operation's dithering, adjustments or mask".
  - After Crop or Flatten, the file is a grey crop with the mask baked in. The colour is gone.
  - The picker suggests the original's exact name (`dog.png`). Saved into the photo's own folder, it would replace the user's colour original after the OS "replace?" prompt.
  - Crop's permanence itself is by design (ADR-480 Amd 1 D3, T19). The defect here is the name and promise of this tool.
- **Where:**
  - `src/ui/raster/crop-image.ts:70-80` (`dataUrl` = `lumaToBitmap` grey PNG, `source` kept);
  - `src/ui/raster/luma-bitmap.ts:47-60` (R=G=B=luma);
  - `src/ui/state/image-edit-actions.ts:41-50` (Studio bake replaces `dataUrl`; the untouched layers stay only in `editorDocument`);
  - `src/ui/commands/SaveOriginalImageDialog.tsx:47-50` (wording);
  - `src/ui/app/save-original-image.ts:46-48` (suggested name from `source`).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t21\t21b.test.ts` → `t21b.log`. Original 40×20, first pixel RGBA (220,40,40,255), `source` `dog.png`. Crop to a 20×10 mm rectangle mask, then Save Original as PNG: 20×10 px, first pixel (94,94,94,255), suggested name `dog.png`. Expected: either the untouched colour 40×20 import, or a dialog that says it saves the cropped and edited image and suggests a different name.
- **Oracle:** BT.601 luma of (220,40,40) = 0.299·220 + 0.587·40 + 0.114·40 = 94.3, so 94 shows the colour was dropped. The pixel count (20×10) shows the crop.
- **Suggested fix:**
  - When the object has been baked (Crop, Flatten, Studio, Convert to Bitmap), say so in the dialog ("Saves the image as cropped/edited in this project; the imported file is no longer stored").
  - Suggest `<stem>-edited.<ext>`.
  - Or keep the import's bytes as a separate original reference.

### T21-P3-1: Whether the bytes are kept is decided by the stored MIME string, not the file's content
- **Severity:** P3. The run showed the re-encode. How often `File.type` is empty or non-standard in practice is READ ONLY: Chromium usually fills it in.
- **Where:**
  - `save-original-image.ts:45` (`source.type === mime`);
  - `SaveOriginalImageDialog.tsx:73-78` (`initialFormat` on the MIME string);
  - `trace/image-loader.ts` `readFileAsDataUrl` (an empty type gives `application/octet-stream`).
- **Repro:** t21a D. A JPEG stored as `data:application/octet-stream;base64,…` or `data:image/jpg;…`, saved as JPEG, runs `toBlob(image/jpeg, 0.95)`: it is re-encoded with EXIF and density dropped. The dialog would also default it to PNG. Expected: the bytes written unchanged.
- **Oracle:** the file's magic bytes (`FF D8`) say JPEG.
- **Suggested fix:** sniff PNG, JPEG and BMP signatures (`89 50 4E 47`, `FF D8 FF`, `42 4D`) for both `initialFormat` and the pass-through test.

### T21-P3-2: The dialog does not say which format keeps the file unchanged, or what a different format loses
- **Severity:** P3 wording. READ ONLY.
- **Where:** `SaveOriginalImageDialog.tsx:51-64`.
- **Repro:** read. PNG is labelled "(lossless)" even for a JPEG source, where choosing it re-encodes, makes a larger file and drops EXIF, ICC and density. JPEG from a PNG is quality 0.95 with transparency flattened on white. Nothing says the source's own format is a byte-for-byte copy.
- **Oracle:** the code paths in t21a A/C.
- **Suggested fix:** label the source format's option "<Format> (unchanged original)". Say that other formats re-encode, and that JPEG and BMP put transparency on white.

### T21-P3-3: No test covers the dialog's default format or the density of a re-encoded file
- **Severity:** P3 test gap.
- **Where:** there is no `SaveOriginalImageDialog` test (`initialFormat` is untested). `save-original-image.test.ts` stubs `encode`, so the BMP density and alpha path through `encodeInBrowser` is untested.
- **Repro:** `rg` finds no test that imports `SaveOriginalImageDialog`. The repo run covers 24 tests in 4 files.
- **Suggested fix:** add a test for the default format per stored MIME, and a test of the BMP header density (with T21-P2-1).

## Not a defect / limits
- **KNOWN, repeated, not re-raised:**
  - **T20-P3-1**: PNG and JPEG re-encodes carry no density (canvas `toBlob`), so a 300 DPI JPEG saved as PNG re-imports at 254 DPI (×1.18). READ ONLY on real Chromium bytes.
  - **T20-P3-2**: only the primary selection is saved (`parity-tools-command-context.ts:19-21`), with no word about the others.
  - T20-P3-3 does not repeat: the empty-source fallback here is `image.png`.
- Adjust Image, dithering and a live mask are object settings, not pixels, so they are correctly left out, as the dialog says.
- The scene is not changed (no store mutation), so Undo, Redo and the dirty flag are unaffected.
- The original survives Save and reopen: embedded `dataUrl`s are saved as they are, and page-backed originals are embedded with their MIME on a portable save. A page-backed source missing from IndexedDB fails with a clear error before the picker (t21a B).
- **By design, not byte-identical:**
  - GIF (frozen to the first frame as PNG at import, with a toast);
  - TIFF and PDF pages (rendered to PNG at the chosen DPI; there is no TIFF writer);
  - PSD (composite PNG);
  - Convert to Bitmap results;
  - rasterized trace results. Their own pixels are saved. The traced photo is a separate object (`traceSourceId`, ADR-673) and can be saved by selecting it.
- EXIF orientation (READ ONLY):
  - same-format JPEG keeps its EXIF bytes (t21a A), so viewers show it upright;
  - a re-encode uses `createImageBitmap` with the default `imageOrientation` ('from-image' in Chromium), which bakes the turn into upright pixels. That matches the import (ADR-404) but was not run in a browser.
- 16-bit PNG saved as PNG is byte-identical. JPEG and BMP are 8-bit by nature.
- ICC: a re-encode is sRGB-converted and untagged (Chromium default `colorSpaceConversion`). READ ONLY.
- **Not checked:**
  - the real Chromium/Electron codec bytes and the native picker (no browser, by the brief);
  - the October open item "maximum codec size". Images above the canvas boundary that import embedded (`shouldDecodeDimensionQualifiedPng`) will most likely fail a JPEG or BMP re-encode with an error toast, and a BMP of an 8192² image builds about 470 MB on the main thread. Both are READ ONLY;
  - LightBurn's own equivalent (fetch refused).

## Totals
Raised 5; P1 0; P2 2; P3 3; known 2 (T20-P3-1 missing density on canvas re-encode; T20-P3-2 primary-only selection).
