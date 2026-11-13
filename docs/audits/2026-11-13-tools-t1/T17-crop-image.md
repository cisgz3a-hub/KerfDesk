# T17 Crop Image — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.crop-image`.

## Map
- **Menu.** Tools → Image → Crop Image (`app-menu-groups.ts`), also on the workspace context menu (`workspace-context-commands.ts`).
- **Command.** `imageMaskCropCommand` (`command-families.ts:214-230`). It is enabled when the primary selection is a `raster-image` with `imageMaskId` (`use-app-commands.ts:125-126`). Disabled reason: "Select an image that already has a mask." There is no dialog.
- **Handler.** `cropImageAction` → `bakeImageMaskAction` (`image-command-actions.ts:86-168`).
  - It finds the mask object and runs `cropMaskedRasterImage` asynchronously.
  - It drops the result if the project epoch, the image or the mask changed meanwhile (`cropOwnerIsCurrent`).
  - Then it calls store `cropImage` (`image-mask-actions.ts:55-75`): one Undo step, the image is replaced in place with `imageMaskId` removed, and only the image is selected. The toast reads "Cropped image: <name>". Errors show as "Could not crop image: <message>".
- **Core.** `cropMaskedRasterImage` (`src/ui/raster/crop-image.ts:32-79`):
  1. Probes the mask at every **source pixel centre** (`applyImageMaskToLuma` on a zero buffer, `:41-47`; `pixelCenterInScene`, `image-mask.ts:147-159`).
  2. Takes the bounding box of the probed pixels (`maskedPixelBounds`, `:93-109`).
  3. Hydrates paged pixels.
  4. **Whitens every source pixel whose centre is outside the mask** (`:54`).
  5. Cuts that box out (`cropLuma`), shrinks the local `bounds` proportionally, and keeps `transform`.
  6. Stores the mask shape as the owned even-odd clip `imageClip` (`bakedImageMaskClip`, `src/core/raster/image-mask-clip.ts:27-44`).
  7. Drops `imageMaskId` and `editorDocument`. It keeps `traceSourceId`, `traceSettings`, `dither`, `linesPerMm` and the adjustments.
- **Compile.** For an upright image, the live mask and the owned clip are both tested at **burn-cell centres** after resampling (`compile-job-raster.ts:363-388`). The burn grid is anchored to the image's own bounds, with `round(size × lines/mm)` cells (`:184-190`).
- **ADRs.** ADR-480 D9 (Flatten/Crop), ADR-480 Amendment 1 (owned clip; D1 says "the baked image burns exactly what the masked one did, under every setting"; D3 says "The image looks like what it burns"), ADR-358 (owned clips), ADR-633 Amd 2/3 (mask preflight), DECISIONS streamed-mask note.
- **Changes since 2026-10-16.** One commit: 19a05d355 (#1471, rolling v4 H5-P2-1). It added the owned clip.

## October register re-check
Row #24 ("pixels, bounds, ownership and undo; new 2048×1024 source, every output row checked; max synchronous latency open"). **Still fixed.**
- `crop-image.test.ts` (2048×1024 source, every row byte-checked, missing or corrupt source refused), `crop-image-mask-clip.test.ts`, `image-mask-actions.test.ts`, `image-command-actions.test.ts` and `image-pixel-authority.test.ts`: 5 files, 34 tests, all pass.
- My own store run (`t17c.test.ts` C1): Undo restores the project byte-exactly (JSON-equal) and the G-code is equal. Redo is exact. X/Y are retained.
- **Max synchronous latency: still open** (known, see Checks): 24 MP blocks for about 4.5 s.

## Checks run
**Method.** Each burn is compiled through the real `prepareOutput` → `emitPreparedGcode`. Every G1 move with S>0 is decoded to scene coordinates and painted as a ±pitch/2 ribbon into an S map (0.05 mm or 0.02 mm grid). I compared the S map of the **masked image before Crop** with the S map of the **cropped image after Crop**, cell by cell, and split the differences by distance from the mask edge (my own point-in-polygon and distance code, `t17-common.ts`). Image = 40×40 px or 200×200 px over 20×20 mm, with a pattern where every pixel has a distinct value. Logs: `C:\Users\stolk\kd-t1\zz-t17\t17a.log`, `t17b.log`, `t17c.log`, `t17c-latency.log`.

| Check | Method | Result |
|---|---|---|
| Source pixel = line interval (200 px/20 mm, 10 l/mm), circle; sub-pixel rect | t17a A01/A02 | **Identical**: same 145/154 rows, ΣS equal, 0 mm² differs |
| Same aligned grid: pass-through; image mirrorY + rotated 90° | A23, A15 | Identical |
| Negative, aligned grid | A11 | Identical (this is the existing ADR test's setup, lines/mm = source px) |
| Coarse source (0.5 mm px), 5 l/mm, Grayscale / Threshold / Floyd | A03-A06 | Rows re-anchored: 73→72 rows, 0 shared, offset 0.098 mm (half an interval), interval 0.2→0.1986 mm; tone far from the edge rearranged (ΣS ±3%) → T17-P3-1. **Edge band lost or lightened: 5.8 mm² lost within 2 lines of the edge** → T17-P2-1 |
| No half-pixel shift of content | t17b B3, Threshold oracle: every burned sample mapped back to its source pixel | 10 l/mm: 0 wrong samples before and after. 5 and 7 l/mm: after-crop is no worse than before (578 vs 778; 338 vs 671, cell-straddle noise). Content is not displaced |
| Negative edge band, realistic sources (flat luma 200, ellipse, 10 l/mm) | t17b B1 | 96 dpi: within 0.05 mm of the edge **23% of cells at full power (S800) vs 0% before**; 0.05-0.1 mm 19%; 0.1-0.2 mm 4%. 72 dpi similar. 300 dpi: max S 775 vs 627, mean +30 in the first 0.05 mm → T17-P2-1 |
| Positive edge band (flat luma 60) | B1 | 96 dpi: mean S 0.05-0.1 mm from the edge **491 vs 611 before**; ≤0.05 mm 318 vs 465. 300 dpi: 569 vs 611 → T17-P2-1 |
| Thin mask (0.4 mm wide ring, 0.5 mm source px, Threshold 10 l/mm) | B2 | **Burned line length 151.2 mm before → 98.2 mm after (35% lost)**; oracle 150.8 mm → T17-P2-1 |
| Burn outside the mask | B1 | No: after-crop outside ribbon ≤0.066 mm against 0.056 mm before (ribbon half-width plus 0.02 mm grid) |
| Rotated 30°, mirrorX, scale 1.5×0.8 image; rotated-rect and 1.6×0.7 masks; mask partly outside; bidirectional + overscan; 45° scan | A12-A18, A21, A22 | Same pattern as A03: grid re-anchor plus edge band; nothing far from the edge lost (lostFar ≤1.3 mm² on rotated, the rest ≤0.11) |
| Non-axis-aligned mask keeps a non-rectangular clip | A16, C2 | Yes: owned clip; canvas makes 1 `clip()` + 1 `drawImage` |
| Mask that crops to zero pixels (0.3 mm square between pixel centres) | A19 | **Refused: "Image mask does not overlap the selected image."** The live mask burned 4 segments → T17-P3-2 |
| Mask entirely outside | A20 | Refused, same message (correct here) |
| Mask object afterwards | C1 | Stays on the canvas, deselected. Moving it no longer changes the G-code. Moving the image moves the clip with it |
| Undo / Redo / Save → reopen | C1 | Exact. `imageClip` kept after reopen; G-code identical |
| Retention | C1 + read | `traceSourceId` kept (Re-trace Original uses the full original). `editorDocument` (Image Studio layers) dropped, so Studio reopens on the flattened crop. Undo restores it |
| DPI / lines per mm | read + A03 | `linesPerMm` and `dither` are kept; the effective interval changes by up to half a cell over the cropped height (T17-P3-1) |
| Dither phase | A06/A07 | Error diffusion restarts at the new image edge: Floyd 15 mm² rearranged at the aligned grid, same ΣS. Inherent, see limits |
| Huge images (latency, memory) | C3 (`t17c-latency.log`, stub encoder) | 2 MP 0.37 s; **24 MP 4.5 s; 48 MP 8.6 s** of main-thread work, plus the PNG encode. The probe alone took 1.2/2.5 s and the base64 decode 2.1/3.7 s. RSS rose to about 1.9 GB at 48 MP. Known open (October row #24) |
| LightBurn | docs.lightburnsoftware.com/2.0/Reference/ApplyMaskToImage | Crop flattens the mask at once ("you will be unable to remove or edit the mask"). Flatten also removes the shape. The page says nothing about resampling, DPI or edge treatment |

## Findings

### T17-P2-1: Crop bakes the mask on the source pixel grid, so a band up to half a source pixel wide inside the mask edge burns white (lighter) or, under Negative, at full power, and thin masks lose a third of their burn
- **Severity P2.** The burn changes inside the art at the edge after Crop, which contradicts ADR-480 Amendment 1 D1 ("the baked image burns exactly what the masked one did, under every setting"). Nothing burns outside the mask (≤0.066 mm ribbon, same as before), and Preview shows it, so it is not P1.
  - At 96 dpi, Negative turns about 20% of the cells in the outer 0.1 mm to full power: a dark rim on a light-mark photo.
  - The positive case lightens the same rim by about 20%.
  - A mask thinner than about a source pixel (thin script text, a ring) loses up to 35% of its burn.
  - The existing ADR test does not catch it because it uses lines/mm = source pixel pitch (40 px/20 mm at 2 l/mm). That is the only setup where source and burn centres coincide (my A11 confirms it is exact there).
- **Where.**
  - `src/ui/raster/crop-image.ts:41-48`: the probe and crop box come from source pixel *centres*.
  - `:54`: `applyImageMaskToLuma` whitens every source pixel whose centre is outside the mask.
  - Compile tests the live mask and the owned clip at *burn-cell* centres (`src/core/job/compile-job-raster.ts:363-388`; `image-mask.ts:147-159`). A burn cell inside the mask then samples a whitened source pixel (Negative turns it into S max), or a pixel the crop box left out.
- **Repro.** `C:\Users\stolk\kd-t1\zz-t17\t17b.test.ts` (log `t17b.log`) and `t17a.test.ts` A03/A08/A10.
  - 96 dpi photo, 40×30 mm, flat luma 200, ellipse mask, Negative, Grayscale, 10 l/mm. Cells ≤0.05 mm inside the edge at S800: **23% after vs 0% before**. 0.05-0.1 mm: **19% vs 0%**. Max S 800 vs 627.
  - Positive, luma 60: mean S at 0.05-0.1 mm is **491 after vs 611 before**.
  - 0.4 mm ring mask on a black 0.5 mm-pixel image, Threshold, 10 l/mm: **151.2 mm of burn before, 98.2 mm after** (oracle 150.8).
  - 40 px/20 mm, circle, 5 l/mm: 5.8 mm² of burn lost at the edge.
- **Oracle.** My own point-in-polygon and edge-distance code on the decoded G-code. The live mask's burn is the reference that ADR-480 Amendment 1 promises to keep. The ring's expected area is 2π·6·0.4 = 15.08 mm², which is 150.8 mm of line at 10 l/mm.
- **Suggested fix.** Since the owned clip already hides everything outside the mask at compile:
  - stop whitening in the bake (or whiten only pixels that lie *wholly* outside the mask);
  - take the crop box from the pixels the mask *touches* (the mask's local bounds rounded outward to whole pixels), not from pixel centres.
  - Add a test at lines/mm ≠ source pitch, with Negative and a thin mask.

### T17-P3-1: After Crop the burn grid is re-anchored to the new image edge: rows move by up to half a line interval and the interval changes slightly
- **Severity P3.** The content stays in place: the Threshold oracle (B3) finds no displaced source pixel, and nothing burns outside the art. But the burn is not the same cells:
  - A03: 0 of 72 rows shared, offset 0.098 mm, interval 0.2 → 0.1986 mm. The tone is resampled (ΣS −3.5% at 0.5 mm source pixels), and error-diffusion and ordered dither patterns restart.
  - It is exact only when the source pitch equals the line interval (A01/A02).
- **Where.** `compile-job-raster.ts:184-190` (`pixelExtentForMm(bounds…)`, interval = height/round(height·lpm)) with the new bounds from `crop-image.ts:125-139`.
- **Repro.** `t17a.test.ts` A03-A07, A12-A18 (`t17a.log`): rows before 73, after 72, shared 0, first-row offset 0.098 mm.
- **Suggested fix.** Either document it (Crop re-grids like any resize), or when the crop offset can be expressed in burn cells, snap the cropped bounds outward to the original burn grid.

### T17-P3-2: A mask that covers no source pixel centre is refused as "does not overlap the selected image", although it overlaps and the live mask burns there
- **Severity P3 (wrong message, rare refusal).** It has the same root as T17-P2-1 (the centre-only probe).
- **Where.** `crop-image.ts:48-51`.
- **Repro.** `t17a.test.ts` A19: a 0.3×0.3 mm mask between 0.5 mm pixel centres. The live burn is 4 segments; Crop throws "Image mask does not overlap the selected image."
- **Suggested fix.** It is fixed by the touch-based crop box in T17-P2-1. Otherwise say "The mask is smaller than one image pixel".

## Not a defect / limits
- **Inherited and KNOWN, not re-raised.**
  - The baked clip ignores each path's fill rule (T16-P2-1).
  - The baked clip XORs separate paths instead of unioning them (T16R-P2-1). `bakedImageMaskClip` uses `closedMaskContours` + even-odd (`image-mask-clip.ts:33,50`).
  - Max synchronous latency (October register row #24, "open"): 24 MP 4.5 s, 48 MP 8.6 s main-thread work before the PNG encode (`t17c-latency.log`). Contributors are the full-image centre probe, `atob` + `Uint8Array.from(binary, fn)`, and a second full mask pass.
- **Mask object stays after Crop.** By design: Flatten deletes it (ADR-480 D9). LightBurn's page implies the same split.
- **`editorDocument` dropped.** Image Studio layers no longer match the cropped grid. Undo restores them. No notice; listed for the maintainer, not raised.
- **Dither pattern restarts at the new edge.** Inherent to any re-grid. ΣS is unchanged on the aligned grid (A07).
- **Canvas after Crop** clips to the mask shape (C2, 1 `clip()`), as ADR-480 Amendment 1 D3 requires.
- **Not checked.**
  - Browser UI and keyboard use (no browser run, by the task).
  - The real PNG encoder (`lumaToBitmap`) time on huge crops; a stub was used.
  - Paged (>25 MiB) images beyond the existing `image-pixel-authority` tests.
  - Hardware.
  - LightBurn's own edge treatment (not documented).
- **Process note.** A stopped first B run left a stray Vitest process for a few minutes, which overlapped one run. It was killed. `t17b.log` holds only the clean second run; the 72 dpi lines come from the first run's identical code, in `t17b-partial.log`.

## Totals
Raised 3; P1 0; P2 1; P3 2; known 3 (T16-P2-1 and T16R-P2-1 inherited through `bakedImageMaskClip`; October register row #24 "max synchronous latency open").
