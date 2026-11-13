# T17 Crop Image — refuter report
Tree: origin/main @ 49ced452b. Command id: `tools.crop-image`. Scratch: `C:\Users\stolk\kd-t1\zz-t17r`.

## Verdicts

### T17-P2-1 (edge band after Crop): CONFIRMED at P2, with a narrower scope
The defect is real and breaks a written promise. My numbers are smaller than the auditor's headline numbers at realistic DPI, and the band appears only on upright scans. Corrections to the claim:

- **No tolerance is accepted anywhere.** ADR-480 Amd 1 D1 ends "So the baked image burns exactly what the masked one did, under every setting." Its Consequences test only "the same cells and ΣS" on the 40 px / 20 mm / 2 l/mm photo. That is an aligned grid (0.5 mm pixel = 0.5 mm line). Amendments 2-5 do not mention Crop or Flatten. ADR-480 D9 (Flatten "crops it exactly as Crop Image does") adds no tolerance either.
- **How common: almost always, on upright images.** Source and burn centres coincide only when dpi = 25.4 × lines/mm (254 dpi at 10 l/mm, 508 at 20). Every other photo has the band: 300 dpi, 600 dpi, 96 dpi and 72 dpi all do.
  - **New, it narrows the claim: rotated images and angled scans are unaffected** unless sharpening is on. The rotated sampler masks the live mask at source resolution too (ADR-671 "An unsharpened one keeps masking at source resolution"). At 30° rotation, B vs C differs in 0 cells at 300 dpi Negative, 96 dpi Negative and 96 dpi positive.
  - The auditor's rotated "same pattern" comes from the grid re-anchor (T17-P3-1), not from whitening.
- **Threshold is immune except near the threshold.** Under Threshold, a whitened pixel and the real pixel usually land on the same side: Negative luma 200 gives 0 cells differing at 300 dpi and at 96 dpi. Grayscale, Floyd, Jarvis and thin dark masks do show it.
- **Band width (measured).** "Width" is the deepest burn cell whose S changes because of the whitening. With the area kernel, a burn cell 0.1 mm wide picks up whitened pixels up to about half a pixel plus half a cell inside the edge.

| Source, 10 l/mm unless noted | Deepest changed cell inside edge | Outermost 0.05 mm, mean S live → baked | 0.05-0.1 mm | Equivalent full-power width per mm of edge |
|---|---|---|---|---|
| 300 dpi, Negative, Grayscale, luma 200 | 0.110 mm | 784 → 842 (+7%), 0% full power | 784 → 790 | +0.003 mm |
| 300 dpi, positive, Grayscale, luma 60 | 0.110 mm | 765 → 562 (−27%) | 765 → 745 | −0.011 mm |
| 300 dpi, 20 l/mm, Negative | 0.045 mm | 784 → 828, 20% full power | none | +0.002 mm |
| 600 dpi, Negative | 0.081 mm | 784 → 834 | 784 → 786 | +0.003 mm |
| 96 dpi, Negative, luma 200 | 0.154 mm | 784 → 883, **46% full power** (0% live) | 24% full power | +0.009 mm |
| 96 dpi, positive, luma 60 | 0.154 mm | 765 → 413 (**−46%**) | 765 → 580 (−24%) | −0.031 mm |
| 254 dpi, aligned (control) | 0 cells differ | identical | identical | 0 |

- **Visibility.**
  - **At 300 dpi or more:** only the outermost burn row changes, by 7-27%. The integrated energy equals 0.003-0.011 mm of full-power line, well below a ~0.1 mm spot. It is unlikely to be seen. Taken alone, this would not be P2.
  - **At 96 dpi:** web images, logos, screenshots and 72-150 dpi phone exports are common Crop inputs. The first two rows (about 0.15 mm) change by 24-46%. Under Negative, nearly half the outermost cells go to full power. That is a perceptible rim on a light-mark photo.
- **Thin masks (burned area; live / baked / no-whiten control; oracle is the ring area):**

| Ring | live | baked | control | oracle | loss |
|---|---|---|---|---|---|
| 0.4 mm, 300 dpi, Threshold | 15.52 | 14.66 | 15.58 | 15.58 | −5.5% |
| 0.2 mm, 300 dpi | 7.63 | 6.87 | 7.65 | 7.67 | −10% |
| 0.4 mm, 96 dpi | 15.52 | 12.89 | 15.16 | 15.58 | **−17%** |
| 0.4 mm, 0.5 mm px | 15.52 | 12.19 | 15.52 | 15.58 | −21% |

  - The auditor's 35% loss needs a 0.5 mm pixel (51 dpi) and a different ring geometry. At a realistic 96 dpi the loss is about 17%. Thin script text cropped from a low-res image visibly thins.
- **Why P2 stays.** It is a wrong burn against an explicit ADR guarantee. It is likely to be noticed on low-res sources and on thin masks. Nothing burns outside the mask: 0 outside cells in every run, so it is not P1.
  - AREAS.md P3 is "no defect found behind it", so a measured burn change does not fit P3.
- **Suggested ledger wording.** "Upright images whose dpi ≠ 25.4 × l/mm; visible at ≤ ~150 dpi and on thin masks; sub-spot at ≥ 300 dpi."

### Flatten Image Mask (T18) shares the code: yes
`flattenImageMaskAction` and `cropImageAction` both call `bakeImageMaskAction` → `cropMaskedRasterImage` (`src/ui/commands/image-command-actions.ts:91,109,124-151`). The same band, and T17R-P2-1, apply to Flatten. Ledger it once with T18 as a co-site.

## Evidence
- **Method (independent of the auditor's G-code decode).** `C:\Users\stolk\kd-t1\zz-t17r\r17.test.ts`, logs `r17.log` and `r17-main.log`. I compiled through the real `compileRasterGroupsForLayer` (origin rear-left, so rows are not flipped) and compared three burns:
  - **A:** the live mask.
  - **B:** the real `cropMaskedRasterImage` result.
  - **C:** a control made of B with its luma replaced by the **unwhitened** source crop (same crop box, same owned clip).
  - B and C share one burn grid, so every B−C difference is caused by the whitening alone. The grid re-anchor (T17-P3-1) is factored out: C−A energy is ≤0.001 mm-equivalent in every case.
- **Edge distance.** Measured to an analytic circle; the mask is a 2880-gon. Bands are 0-0.05, 0.05-0.1, 0.1-0.2, 0.2-0.3, 0.3-0.5 mm and the interior. The image is 30×30 mm with a 12 mm radius mask, centred off a whole pixel (65.0131, 64.9873).
- **Run commands.**
  - `node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t17r/vitest.config.mts --maxWorkers=1 C:/Users/stolk/kd-t1/zz-t17r/r17.test.ts`, run from the tree with `NODE_OPTIONS=--no-experimental-webstorage`.
  - `R17_ONLY=RECIPE` and `R17_ONLY=ROT` run the subsets. All runs passed; each took about 6 s. Free memory was 3.5-3.7 GB.
- **Aligned control.** 254 dpi at 10 l/mm: A, B and C are byte-identical. This agrees with the auditor's A11 and the ADR test.

## Extra findings

### T17R-P2-1: After Crop/Flatten, image sharpening (ADR-671) gives the mask edge a dark rim up to ~0.3 mm wide, even on the aligned grid the ADR test uses
- **Severity: P2.**
  - It breaks an explicit decision: ADR-671 D (Masks, line 57) says "sharpening comes first, so a mask edge never gains a dark rim", and ADR-480 Amd 1 D1 says "exactly … under every setting".
  - It appears on every grid, including dpi = 25.4 × l/mm, where T17-P2-1 is absent. The rim is several cells wide, so it is easier to see than the half-pixel band.
  - Photo recipes switch sharpening on (`PHOTO_RECIPE_SHARPEN = { sharpenAmount: 30, sharpenRadius: 0.7 }`, `src/ui/raster/photo-recipes.ts:90`).
  - The auditor's suggested fix for T17-P2-1, "whiten only pixels wholly outside the mask", **would not fix this**. Wholly-outside white pixels still sit inside the Gaussian window (up to 3σ = 9 cells at radius 3).
  - Same root as T17-P2-1, so it may be ledgered together. The fix must then cover it.
- **Where.**
  - `src/ui/raster/crop-image.ts:54` bakes white into the source pixels.
  - Compile sharpens the burn grid before it masks (`src/core/job/compile-job-raster.ts:375-387`). On the live mask the outside pixels keep their real tone while being sharpened. After Crop they are white, and the unsharp mask pushes the inside edge cells darker (positive) or lighter (Negative).
  - The rotated path does the same (ADR-671 "A sharpened rotated raster then masks its sample grid").
- **Repro.** `r17.test.ts`, cases "ALIGNED 254 dpi + sharpen…", "RECIPE…" and "ROT30 … sharpen" (`r17.log`). Flat luma, 30 mm image, 12 mm circle, Grayscale, 10 l/mm. Mean S of the live mask (A) against the baked image (B); the no-whiten control (C) equals A in every case:

| Setup | 0-0.05 mm | 0.05-0.1 mm | 0.1-0.2 mm | 0.2-0.3 mm | Changed cells reach |
|---|---|---|---|---|---|
| Aligned 254 dpi, sharpen 100% / r1, positive luma 128 | 498 → **657 (+32%)** | 498 → **612 (+23%)** | 498 → 531 (+7%) | 498 → 502 | 0.289 mm (1836 cells) |
| Same, Negative luma 200 | 784 → 715 (−9%) | 784 → 735 (−6%) | | | |
| Recipe default 30% / r0.7, aligned | +7.5% | +4.8% | | | 0.139 mm |
| 300 dpi, 60% / r1.5 | 403 | 561 | 543 | 513 | 0.392 mm |
| Rotated 30°, 300 dpi, 100% / r1 | | | | | 2367 cells differ, +0.0024 mm-equivalent |

  - In the 300 dpi 60% / r1.5 row, the outermost row is lighter (whitened pixels), with a dark ring behind it.
  - In the rotated row, the ordinary band is 0 without sharpening.
- **Oracle.** The live-mask burn (A), which both ADRs promise to keep, and the no-whiten control (C), which equals A cell for cell. That isolates the whitening as the only cause.
- **Suggested fix.**
  - Do not whiten in the bake at all. The owned clip already removes everything outside the mask at compile, Preview and Save Processed Bitmap (ADR-480 Amd 1 D1). Pick the crop box from the pixels the mask touches.
  - If other pixel consumers (Studio, Trace of the cropped bitmap) must not see outside content, keep a margin of at least 3σ of unwhitened pixels, or mask those consumers by the clip instead.
  - Add an aligned-grid test with `sharpenAmount > 0`.

## Not raised / limits
- Rotated images and angled scans without sharpening: no whitening effect (0 cells). The band in T17-P2-1 is upright-only.
- Floyd and Jarvis rows show B−C differences across the whole image, because the error-diffusion path changes after the edge. The energy differs by ≤0.004 mm-equivalent, so the dither is not shifted. This is the same as the auditor's dither-restart limit.
- No browser run, no hardware, no real photo content: flat tones bound the effect. Positive dark and Negative light tones are the worst cases.

## Totals
- T17-P2-1: CONFIRMED P2. Scope: upright images with dpi ≠ 25.4 × l/mm. Sub-spot at ≥300 dpi (≤0.011 mm-equivalent); visible at ≤~150 dpi (24-46% on the first 0.15 mm) and on thin masks (−17% at 96 dpi). Also hits Flatten.
- Extra: raised 1; P1 0; P2 1 (T17R-P2-1, sharpen dark rim after Crop/Flatten; same root, but the auditor's suggested fix misses it); P3 0. Known 0 new.
