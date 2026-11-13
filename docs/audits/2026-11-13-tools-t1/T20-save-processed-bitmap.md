# T20 Save Processed Bitmap — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.save-processed-bitmap`.

## Map
- Menu: Tools → Image → "Save Processed Bitmap..." (`src/ui/commands/command-raster-family.ts:30-36`, enabled only when the primary selection is a `raster-image`, else "Select an image first."). Also in the workspace right-click menu (`workspace-context-commands.ts:73`), laser-only (`machine-command-gate.ts:42`, ADR-101).
- Handler: `tool-command-context.ts:132-144` → `handleSaveProcessedBitmap` (`src/ui/app/save-processed-bitmap.ts:38-82`): primary raster + its primary operation → refuse unless effective mode is Image and the layer outputs → size gate (`processedBitmapSizeLimit`) → hydrate paged pixels → validate luma (October repair) → `buildProcessedRasterBitmap` → encode PNG (`rgbaToPngBlob`, canvas `toBlob`, `luma-bitmap.ts:87-104`) → `pickPreparedSaveTarget` (ADR-656: picker only after the bytes exist; save-ready dialog when the click activation has lapsed) → `target.write`.
- Core twin: `src/ui/raster/processed-bitmap.ts:51-111`, a re-implementation of `compile-job-raster.ts` `materializedRasterValues` (prepare tones at source resolution → resample with the burn kernel → ADR-671 grid sharpen → mask/owned clip → dither with the effective power range) but without the machine-orientation step and in image space (no rotation sampling).
- Picker: `src/platform/web/web-adapter.ts:111-127` (`showSaveFilePicker` with `.png` type; AbortError → null; no File System Access → download fallback). The Electron renderer uses the same adapter call (ADR-656 Amd 4).
- Governing: ADR-350 §1 (pass-through contract), ADR-480 Amd 1 (owned clip at the mask's point), ADR-581 Amd 1 §6 (source read ceiling + 64 MB grid budget, plain words), ADR-656 (+Amd 4), ADR-670/671 (tone curve, grid sharpening), ADR-699 (3D Sliced stack preview).
- Changes since 2026-10-16 (git log on the three files): 2254138ea (ADR-648/671 tones + sharpen), 995078503 (ADR-656 prepare before picker), 19faee6f1 (U3-P2-3, ADR-581 read ceiling), ab3226fd1 (C2-P3-1 helpers), 91f9406b6 (ADR-699 3D Sliced), 407aaa49a (ADR-656 Amd 4 picker at once).

## October register re-check
Row #27: "repaired successful blank/corrupt-pixel exports; pixel/output parity, 4001² budget and malformed-data guards; max accepted export latency open".
- Blank/corrupt pixels: still fixed. `assertProcessedBitmapPixels` (`save-processed-bitmap.ts:84-97`) runs before encode; repo tests for missing / invalid base64 / `AA==` / `AB==` / missing pixels pass (`save-processed-bitmap.test.ts`, 30 tests across 3 files green).
- Budget guard: still holds, now in ADR-581 Amd 1 form. A 400×400 mm image at 10 l/mm (4000², Floyd) is refused before any picker with "the bitmap is too big at this size and resolution. Lower the resolution or make the photo smaller."; a 56 MP source is refused with the crop/smaller-copy advice (script t20b).
- Pixel/output parity: holds for every setting except the known dither-orientation twin gap (20-K-1, below), measured cell by cell against decoded G-code.
- Latency (was open): `buildProcessedRasterBitmap` at the largest accepted Floyd grid (2660², 7.1 MP) took 469 ms in Node on the main thread; Threshold 2840² 91 ms. Canvas PNG encode not measured (browser only).
- Direct save picker (unverified in October): read only. Cancel → null → no toast; picker/permission errors and write errors → "Could not save processed bitmap: <reason>" (both run with a stub platform).

## Checks run
| check | method | result |
|---|---|---|
| Export pixels vs burned cells decoded from G-code (`prepareOutput` → `emitPreparedGcode`, own decoder of powered G1 runs to a cell grid), 40×20 gradient+disc, 8×4 mm, 5 l/mm, default front-left device | script `zz-t20/t20a.test.ts` → `t20a.log` | Threshold, Grayscale+min 20, pass-through, resample 2.5 l/mm: 0 cells differ, grey = 255 − round(255·S/Smax) exactly. Floyd 293/800 cells differ, Jarvis+negative 247, Ordered 437, Blue Noise 251, Atkinson 213, Floyd+sharpen 275 (KNOWN 20-K-1) |
| Same matrix on a rear-left device (no machine flip) | `t20c.test.ts` → `t20c.log` | 0 differing cells for Floyd, Floyd+sharpen (ADR-671), brightness/contrast/gamma, tone curve (ADR-670) with Floyd and Grayscale+min 15, Stucki+negative resampled, Jarvis at 7.3 l/mm (58×29), object power scale |
| Mirror X / mirror Y (threshold) | t20a | export is image space; equals the burn flipped back, 0 differ |
| Rotation 90/180/270 (threshold) | t20b, burn cells mapped back to image space through the transform | 0 differ; export stays 40×20 (image space), burn grid 20×40 |
| Live mask, mask + Negative, owned clip (ADR-480 Amd 1) + Negative, Grayscale min 30 masked | t20b | 0 differ; outside the mask white (255) and opaque (alpha 255), not transparent |
| 3D Sliced, 4 passes | t20c, passes covering each cell counted from G-code | export level = number of slices burning, all 800 cells (5 levels 0/64/127/191/255) |
| Cross-hatch, scan angle 45/90 | t20c | export is the single image-space grid; burn uses angled grids. Saved without remark (see limits) |
| Failure paths | t20b | cancel: silent; write error "Disk full" → "Could not save processed bitmap: Disk full"; picker SecurityError → same prefix + reason; no selection; layer output off / Fill mode → "needs an enabled Image layer"; over budget; 56 MP source |
| Odd numbers | t20b | linesPerMm 0/−5/NaN/∞ → 8×4 export, compile also 8 cells/row (consistent); scaleX 0 / 1e-9 → 1×20 export, no crash; 1000 l/mm refused by budget |
| Suggested names | t20b | `dog-processed.png`, Windows-forbidden chars → `-`, URL query stripped, `.png` only; empty source → `processed-image-processed.png` |
| Repo tests | Vitest, 3 files | 30/30 pass |
| PNG density chunk | READ (`luma-bitmap.ts:87-104` canvas `toBlob`; `image-import.ts:10,45` default 254 DPI) | no pHYs written by the app (see T20-P3-1) |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/SaveProcessedBitmap/ | saves the image "including any changes made using Adjust Image, or any dithering mode"; format, DPI, orientation, masks and multi-select not documented |

## Findings

### T20-P3-1: The saved PNG carries no density, so re-importing it is sized at 254 DPI whatever grid it was made on (READ ONLY)
- Severity: P3, READ ONLY (the Chromium canvas encoder could not be run here). Correct by coincidence at the default 10 l/mm; at 5 l/mm a re-import is twice the size, and a pass-through export (source pixel count) re-imports at an unrelated size. The import toast does say "default 254 DPI", so the user is told.
- Where: `src/ui/raster/luma-bitmap.ts:87-104` (canvas `toBlob('image/png')`, no pHYs); `src/ui/common/image-import.ts:10,45-46` (missing density → 254 DPI); `src/ui/raster/processed-bitmap.ts:142-162` (grid = layer l/mm, or source pixels for pass-through).
- Repro: an 8×4 mm image on a 5 l/mm layer saves 40×20 px (t20a case 01); a PNG without pHYs imports at `DEFAULT_DPI` 254 = 10 px/mm, so it comes back 4×2 mm (half size). At 2.5 l/mm (t20a case 14, 20×10 px) it comes back 2×1 mm (quarter).
- Oracle: PNG spec pHYs chunk (pixels per metre); the burn grid is `linesPerMm`·1000 px/m.
- Suggested fix: insert a pHYs chunk (round(linesPerMm·1000) px/m both axes; for pass-through the image's own px/mm on each axis) after IHDR before writing; the repo already parses pHYs (`image-density.ts:104-125`).

### T20-P3-2: With several images selected, only the primary one is saved, with no word about the others (READ ONLY)
- Severity: P3, READ ONLY; nothing is lost, but the user can think all were saved.
- Where: `src/ui/commands/tool-command-context.ts:132-144` passes only `app.selectedObjectId`; `use-app-commands.ts:151` enables on the primary alone.
- Repro: read only; the handler has no access to `additionalSelectedIds`.
- Oracle: LightBurn's page does not document multi-select; consistent with the sibling Save Original Image behaviour is unknown.
- Suggested fix: when more than one raster is selected, say "Saved <name>; select one image at a time to save the others", or save each in turn.

### T20-P3-3: The empty-source fallback name doubles the word: `processed-image-processed.png`
- Severity: P3 wording.
- Where: `src/ui/app/save-processed-bitmap.ts:115-120`.
- Repro: t20b, `source: ''` and `source: '.png'` → `processed-image-processed.png`.
- Oracle: the fallback stem plus the fixed suffix.
- Suggested fix: fallback stem `image` (→ `image-processed.png`).

## Not a defect / limits
- KNOWN, re-measured, not re-raised: **20-K-1 / Q1-P3-K4 / Q3-K2** (rolling v2 `20-raster.md` K-1; quality Q1/Q3): Save Processed Bitmap dithers the image-oriented grid, while compile flips to machine orientation first (`compile-job-raster.ts:356-368`) and the export has no such step (`processed-bitmap.ts:106-110`). On the default front-left device, error diffusion and Ordered differ in 27–55% of cells with equal tone (burned counts within 13 of 800); rear-left devices and Threshold/Grayscale/pass-through are exact. The existing parity test (`save-processed-bitmap.test.ts` "exports the image's own settings as the job burns them") uses Threshold, which cannot see this.
- Image space, not as placed: the export ignores rotation, mirroring and scan angle and is the image-space grid; mapped back through the transform it matches the burn exactly (threshold). LightBurn does not document either way. Angled scans and cross-hatch burn rotated grids that the export does not show; ADR-492 groups are a burn-time concern.
- Grey levels are relative to the image's effective maximum power (`rasterPreviewRgba(sValues, sMax)`), so black = "full power for this image"; an object power scale of 50% still saves black. That is a picture of the pattern, not of absolute S, and matches the existing pass-through test.
- Outside a mask or owned clip the PNG is opaque white, not transparent; this is what burns (S 0) under Negative too.
- 3D Sliced exports the ADR-699 stack preview (darker where more slices burn), verified exact per cell.
- Mask region rule (T16-P2-1 / T16R-P2-1, PR #1867): the export uses the same `applyImageMaskToLuma`, so it inherits whatever rule compile uses; only rectangles were tested here (no rule difference).
- Not checked: the real Chromium/Electron picker and `toBlob` output bytes (no browser run by brief; memory), canvas encode latency, paged (IndexedDB) rasters, an image assigned to two Image operations (export uses the primary operation only, read), hidden-image behaviour.

## Totals
Raised 3; P1 0; P2 0; P3 3; known 1 (20-K-1 / Q1-P3-K4 / Q3-K2, dither orientation, re-measured).
