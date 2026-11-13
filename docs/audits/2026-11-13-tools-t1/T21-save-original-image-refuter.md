# T21 Save Original Image — refuter report
Tree: origin/main @ 49ced452b (read-only export `C:\Users\stolk\kd-t1\t13-main`). Command id: `tools.save-original-image`.
Scratch: `C:\Users\stolk\kd-t1\zz-t21r` — `t21r.test.tsx` (8 tests, all pass), results in `t21r.out.txt`, run log `t21r.log`.
Run: `node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t21r/vitest.config.mts --maxWorkers=1 C:/Users/stolk/kd-t1/zz-t21r/t21r.test.tsx` with `NODE_OPTIONS=--no-experimental-webstorage`. Free memory was 2.0–2.6 GB at each run. No browser was used.

## Verdicts
| Claim | Verdict | Level |
|---|---|---|
| T21-P2-1: BMP written at 96 DPI whatever the image's density | **CONFIRMED** | P2 |
| T21-P2-2: after Crop, Flatten or Studio Apply, "Original" saves the baked pixels under the import's name | **CONFIRMED** | P2 |

## Method (how it differs from the auditor's)
The auditor used a stubbed `encode` with `densityFromBytes`, and called `cropMaskedRasterImage` directly. My method was different:
- **R-A (P2-1).** The real `saveOriginalImage` runs with its **default** `encodeInBrowser`. Only `createImageBitmap` and `toBlob` are stubbed, because jsdom has no codec. The bytes then go back through the **real `importImageFile`** (`readImageDensity` → `rasterImportGeometry` → success toast). Only the pixel decode (`loadImageSamples`) is mocked, and it returns the natural size. I also parsed the BMP header myself (biXPelsPerMeter at byte 38). Inputs: PNG with no pHYs, PNG at 300 DPI, JPEG JFIF at 72 DPI, and a JPEG at 96 DPI as the control.
- **R-B (P2-2).** The real store and the real **Flatten command** (`flattenImageMaskAction` → `cropMaskedRasterImage` → `lumaToBitmap` → store `flattenImageMask`) run end to end. The canvas PNG encode is modelled with zlib. I rendered the real `SaveOriginalImageDialog` with React, before and after the bake, to read its wording and default format. I decoded the saved PNG myself.
- **R-C (P2-2, Studio).** The real store runs `applyEditedImage`, then the real Save Original. I searched the whole object JSON for the original bytes.
- **R-D (extra).** The real `pageArtworkObject` (PDF/TIFF page as image, dialog default 300 DPI), then a default Save Original, then a re-import.
- **Harness note.** jsdom 25's `Blob` has no `arrayBuffer()`, so `readImageDensity` swallows the TypeError and every import falls back to 254 DPI. My first run showed exactly that. I polyfilled `arrayBuffer` with `FileReader`, as Chromium provides it natively. Anyone testing density in jsdom should be aware of this.

## Evidence

### T21-P2-1 — CONFIRMED at P2
Results from `t21r.out.txt`, lines starting `[R-A]`:

| source (1000×500 px) | first import | Save Original as BMP: header | BMP re-import | ratio | same-format pass-through re-import |
|---|---|---|---|---|---|
| PNG, no pHYs | 100.00 mm (default 254) | 96.01 × 96.01 DPI | 264.58 mm, toast "embedded density 96 DPI" | ×2.646 | 100.00 mm (×1.000) |
| PNG, pHYs 300 | 84.67 mm | 96.01 DPI | 264.58 mm | ×3.125 | 84.67 mm (×1.000) |
| JPEG, JFIF 72 | 352.78 mm | 96.01 DPI | 264.58 mm | ×0.750 (shrinks) | (JPEG pass-through, not re-run) |
| JPEG, JFIF 96 (control) | 264.58 mm | 96.01 DPI | 264.58 mm | ×1.000 | — |

- **Cause.** `save-original-image.ts:82` calls `encodeBmp24(pixels.data, pixels.width, pixels.height)`, and `encode-bmp.ts:16` defaults to `dpi = 96`. Only a 96 DPI source keeps its size. The error runs both ways: ×2.6–3.1 larger, or ×0.75 smaller for a 72 DPI phone or web JPEG.
- **Disclosure: none.**
  - The option is labelled plain "BMP" (`SaveOriginalImageDialog.tsx:61`).
  - The tooltip (`parity-tools-command-help.ts:5-8`) says "exactly as it is in the project".
  - The desktop app has no separate native save picker. `pickFileForSave` exists only in `platform/web/web-adapter.ts:111`, and ADR-656 Amd 4 says Electron calls the same `showSaveFilePicker`.
  - The only mention of 96 DPI comes after the fact, in the re-import toast.
- **Does any import path ignore BMP density? No.** Every raster import honours it:
  - All six `importImageFile` callers go through `readImageDensity` → `densityFromBytes` → `bmpDensity`. They are import-dispatch, image-pick, SelectedImageReplaceControl, the registration jig, remote design-imports and page-artwork.
  - Multi-File Trace uses `readImageHeaderDensity`.
  - trace-cli uses `densityFromBytes`.
- **Severity: P2 stands.** "A wrong result the user is likely to notice" fits.
  - The file states a false density. This is not a missing one: a BMP with biXPelsPerMeter 0 would fall back to 254 DPI through `normalizeImageDensity`.
  - The resulting size jump is large and visible.
  - That PNG and JPEG keep the original bytes does not lower it. Whoever picks BMP gets no original bytes at all, and BMP from a non-BMP source is always a re-encode.
  - It is not P1: the re-import is a new object, the toast names 96 DPI, and no existing job changes.
  - Fix input: `bitmap.width / (local bounds width mm / 25.4)` per axis. `encodeBmp24` takes a single dpi, so a source with different X and Y densities needs a two-axis parameter.
- **Related (KNOWN T20-P3-1, larger numbers than the auditor gave).** A cross-format PNG or JPEG re-encode writes no density.
  - A 72 DPI JPEG saved as PNG re-imports at 100 mm instead of 352.78 mm (×0.283). A 96 DPI JPEG gives ×0.378 (R-A `save png` lines; Chromium's canvas encoder is modelled as writing no pHYs).
  - Under the P2-1 reasoning this is the same "wrong size" outcome. I suggest the P2-1 fix PR also stamps pHYs and JFIF density. I am not raising a new ID for it.

### T21-P2-2 — CONFIRMED at P2
Results from `t21r.out.txt`, lines starting `[R-B png]`, `[R-B jpg]` and `[R-C]`:
- **Dialog before Flatten:** format=png. Text: "Saves dog.png as it is in the project, before any operation's dithering, adjustments or mask. Use Save Processed Bitmap for what the laser engraves."
- **After the real Flatten:**
  - Toast: "Flattened the mask into dog.png and deleted the mask shape."
  - Object: `source=dog.png`, 20×10 px (was 40×20), `imageClip` set, `editorDocument` absent, `imageAsset` absent, undo depth 1.
- **Dialog after Flatten:** word-for-word the same text, format=png.
- **Save Original after Flatten:**
  - Suggested name "dog.png". Toast "Saved the original image to dog.png".
  - The file is 20×10 px with centre RGBA (94,94,94,255). Original: 40×20 px at (220,40,40,255). BT.601 luma of (220,40,40) = 94, so colour, size and the outside-mask area are all lost.
- **JPEG original (`dog.jpg`):**
  - The default format silently flips from **jpeg** (before) to **png** (after the bake), while the text still says "Saves dog.jpg".
  - The suggested name becomes `dog.png`, so a JPEG original is *not* overwritten by default.
  - The second `[R-B jpg]` line ("format jpeg: suggested undefined") is a harness failure: my minimal canvas context has no `fillRect`. It is not evidence.
- **Studio Apply (R-C):**
  - The saved bytes equal the edited bytes (true) and differ from the original (false). The suggested name is "dog.png".
  - **No field of the object still holds the original bytes** (JSON search: false).

Answers to the coordinator's questions:
- **Does wording change after a bake? No.**
  - `RasterImage` (`core/scene/scene-object.ts:358-411`) has no edited, cropped or baked flag.
  - The dialog body (`SaveOriginalImageDialog.tsx:46-49`) is static except `{source}`. The command label and tooltip are static too.
  - The rendered text before and after Flatten is identical, and the success toast still says "original".
- **Is the original stored anywhere? Not after a bake.**
  - Crop and Flatten drop `imageMaskId` and `editorDocument`, and their hydrated source has already lost `imageAsset` (`crop-image.ts:69`, `paged-raster-hydration.ts:96`).
  - Studio Apply drops `imageAsset` (`image-edit-actions.ts:42`). Its `editorDocument` holds the editable layer stack at the stored grid, after edits, as RGBA. That is not the import's bytes or metadata.
  - The only copy is the in-memory undo stack, which is not saved in `.lf2`.
  - So the fix cannot "save the true original" without new retention, such as keeping `imageAsset` or a source reference beside the bake. The cheap fix is:
    - a baked flag set by `cropImage`, `flattenImageMask` and `applyEditedImage`;
    - dialog text and toast for a baked image, e.g. "Saves the image as cropped/edited in this project; the imported file is no longer stored";
    - a suggested name `<stem>-edited.<ext>`.
- **Does the OS overwrite prompt make it P3? No.**
  - READ ONLY: Chromium's Windows save dialog asks before replacing a file. The save picker passes no `startIn` or `id` (`web-adapter.ts:118-121`), so it opens in Chromium's last-used folder, plausibly the photo's own folder after File → Import. I could not run a browser to confirm either point.
  - The prompt is a weak guard here. The user has just been told the file *is* the original, so "replace dog.png with the original of dog.png" looks harmless to confirm.
  - Overwrite risk is limited to PNG originals, or a user who picks the original's format.
  - The misleading result (a grey, cropped "original" with a success toast) happens in every case.
  - It stays P2 (misleading result plus missing warning). It is not P1: the project is intact, and loss needs a PNG source, the same folder and a Replace click.
  - Related: T19-P3-1 (Remove Image Mask does not say the bake is permanent) is a different surface. This finding is about the promise this tool makes.

## Extra findings

### T21R-P3-1: PDF/TIFF page images and PSD composites are stored as density-less PNGs, so even the default, byte-identical Save Original re-imports at a different size from the object
- **Severity:** P3. It is the same mechanism as T20-P3-1 (canvas PNG has no pHYs), but it shows up on this tool's **default pass-through** path and its root is in the importers. The re-import toast says "default 254 DPI", and nothing in the project changes.
- **Where:**
  - `src/ui/import/page-artwork-object.ts:72-83`: `canvasFile` uses `toBlob('image/png')`, then lines 51-56 override bounds to the page size.
  - `src/ui/import/psd-import-preparation.ts:40`: `convertToBlob({type:'image/png'})`, while `psd-import-action.ts:47-53` sizes the object from the PSD density (READ ONLY for PSD).
- **Repro:** `t21r.test.tsx` R-D.
  - Real `pageArtworkObject` at the dialog default of 300 DPI (`PagedImportDialog.tsx:21`), page 84.67 × 42.33 mm, which gives 1000×500 px.
  - Save Original as PNG (default, byte-identical) → `brochure.png` → re-import 100.00 × 50.00 mm (**×1.181**), toast "default 254 DPI — no usable embedded density".
  - As BMP: 264.58 mm (×3.125, T21-P2-1).
  - Expected: re-import at 84.67 mm.
  - Chromium's canvas encoder was modelled as writing no pHYs, as in T20-P3-1.
- **Oracle:** 1000 px / 254 DPI × 25.4 = 100 mm, against 1000 / 300 × 25.4 = 84.67 mm.
- **Suggested fix:** stamp a pHYs chunk at the render or composite DPI when the page or PSD PNG is created, or have the T21-P2-1 fix write the object's density on save (which would cover this case).

Also noticed, too small to raise: every page of a PDF suggests the same name (`brochure.png` for "brochure.pdf (page 1)", because `fileStem` strips from the last dot). The OS replace prompt guards it.

## Totals
- Claims: 2 CONFIRMED (T21-P2-1 P2, T21-P2-2 P2); 0 refuted; 0 severity changed.
- Extra: raised 1; P1 0; P2 0; P3 1 (T21R-P3-1).
- Known, re-measured: T20-P3-1. A cross-format PNG or JPEG re-encode loses density, measured at ×0.283 for a 72 DPI JPEG, which is larger than the auditor's ×1.18. I recommend folding it into the T21-P2-1 fix.
