# Quality audit Q1 — Dither algorithms

- **When:** 2026-10-28 00:30 – 01:20 +0800   **Tree:** origin/main @ `ef910deb6` (after
  `git fetch origin main`; worktree `claude/rolling-audit-v5` at `31460b7d6`). `git diff origin/main`
  is empty for every cited source file and ADR file. `DECISIONS.md` differs only in an ADR-269
  paragraph (L14262-14266), not in the ADR-020 text cited here. The repros therefore ran on main's
  code.
- **Scope:** every image dither and screen mode, judged against its original definition.
  - Dithers: `src/core/raster/{dither,dither-rows,dither-blue-noise,dither-blue-noise-tables,image-mask,image-processing}.ts`.
  - Compile: `src/core/job/{compile-job-raster,compile-job-raster-stream}.ts`.
  - Screens: the Image Studio screens `src/core/image-adjust/halftone.ts` with
    `src/ui/image-editor/editor-adjustments.ts`.
  - Pickers: `src/ui/layers/{DitherSwatchPicker,dither-thumbnails,CutSettingsImageFields}.tsx/.ts`
    and `src/ui/raster/photo-engraving-settings.ts`.
  - Twins: `src/ui/workspace/compiled-raster-preview.ts`, `src/ui/raster/{photo-engraving-preview,processed-bitmap,AdjustImageDialog.preview}.ts`,
    and the remote prepare path (`src/ui/remote-access/job-review-preparation.ts`).
  - Governing: ADR-020 Q2, ADR-243, ADR-480 Decision 9 with Amd 1, ADR-581, ADR-649, ADR-670
    (limits) and ADR-242 (Image Studio).
- **Lenses run:**
  - L2: published kernels from a pinned DHALF.TXT; Ostromoukhov's table re-diffed; LightBurn 2.0
    Image Mode page fetched; DOIs checked against Crossref.
  - L3: the emitted G-code against an independent reference dither, the canvas Preview, the Photo
    engraving preview and Save Processed Bitmap.
  - L1: the ADR-649, ADR-480 and picker-copy claims.
  - L7 light: the four existing dither test files re-run.
  - L4 light: masks, white and black backgrounds, image edges.
  - L5 and L6 skipped: no untrusted input or failure path is specific to dithering.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+ 6 KNOWN re-observed). Refuter: 5
  CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity change.
- **Refuter (2026-10-28 01:10 – 01:40 +0800):** fresh context. `git fetch origin main` moved main to
  `93334429e`; `git diff origin/main` is still empty for every cited source file, so the repros
  below ran on main's code. The refuter's own dumps came from temporary Vitest files that called
  `dither()` and Image Studio's `runAdjustment` / `commitAdjustment`. Its analysis used plain
  `.mjs` scripts that import nothing from KerfDesk: reference kernels written from DHALF.TXT
  (fetched by the refuter at
  https://github.com/cyotek/Dithering/blob/dcb4070708fa78cb75c601af6416ef8c5b9641ad/resources/DHALF.TXT),
  a recursive Bayer matrix, and its own Gaussian-spot burn model. All of those files are deleted.
  The auditor's DHALF line numbers check out against that file.

## Headline

All eleven binary modes are implemented exactly as published.
- An independent re-implementation, written from the published filters, reproduces KerfDesk's
  output bit for bit:
  - 0 differing pixels out of 4.19 M per mode, on flat patches at every grey level 0–255, a ramp
    and six discs;
  - also through the real Save path (`emitGcode`), at default and non-default tone settings.
- Every diffusion mode holds tone to within 0.3% of `1 − L/255` per grey level on a 12.8 mm
  patch.
- The canvas Preview and the Photo engraving preview match the emitted dots exactly, in all 12
  modes.

What the eye sees ranks the modes clearly. In a burn simulated from the emitted G-code (Gaussian
spot, eye filter):
- Blue Noise is best: mean SSIM 0.966, the lowest graininess, and no patterns.
- Sierra Lite (0.965) and the default Floyd–Steinberg (0.955) come next. Floyd–Steinberg is a good
  default.
- Jarvis, Stucki, Sierra-3 and Burkes score 0.916–0.925. They show worms, period-3 locks at
  one-third tones, and the widest blank bands at light edges.
- Jarvis is still the Photo engraving dialog's fallback, and the code calls the photo list
  "smoothest first".

The one visible defect is outside the dither list. Image Studio's **Line Screen (Newsprint)**
filter, at its default 0° angle, can draw only 5 tones:
- the tones are 0, 12.5, 37.5, 62.5 and 87.5%, an error of up to 12.5%, or 25% at a 4 px pitch;
- solid black keeps a white line every pitch.

At 15° or 45° the same code tracks tone within 1%.

## Scorecard

FS = Floyd–Steinberg. "L" = luma 0–255; intended coverage = `1 − L/255`. "Whole" = a 128 × 128
flat patch, start-up edges included. "Inner" = rows 32–127 and columns 16–111 of that patch.
"Compile" = a 64 × 64 patch at 37 levels through `emitGcode`, parsed back by an independent reader.
Refuter column: CONFIRMED = re-run by the refuter, PLAUSIBLE = read only or not re-checked.

| Metric | KerfDesk | Reference | Verdict (auditor) | Refuter |
|---|---|---|---|---|
| **Kernel match**, all modes | Threshold, FS, Jarvis, Stucki, Atkinson, Burkes, Sierra-3, Sierra-2, Sierra Lite and Ordered each differ from the independent reference in **0 of 4,194,304** flat-patch pixels, 0 of 16,384 ramp pixels and 0 of 98,304 disc pixels | DHALF.TXT (pinned below) for FS, Jarvis–Judice–Ninke, Stucki, Burkes and the three Sierra filters; tannerhelland for Atkinson; Bayer M4 built recursively | meets | CONFIRMED for FS, Jarvis, Stucki, Atkinson and Ordered: 0 of 1,048,576 pixels on 64 × 64 flat patches at all 256 levels, 0 of 16,384 on a 256 × 64 ramp and 0 of 4,096 on a 64 × 64 noise image. Caveat: this holds against a reference with a Float32 accumulator, as KerfDesk uses. A Float64 reference of the same filters differs in 3,079 (FS), 3,396 (Jarvis) and 1,791 (Atkinson) flat-patch pixels: these are ties at 128, so the difference is accumulator precision, not the weights. Burkes and the Sierras were not re-run (PLAUSIBLE) |
| Kernel: Threshold | `L < 128` → burn | — | meets | PLAUSIBLE (read `dither.ts:188-197`) |
| Kernel: FS | 7 / 3 5 1, ÷16, serpentine | DHALF L639-647; serpentine is a documented option (L689-693) | meets (serpentine is deliberate: ADR-020 Q2) | CONFIRMED (DHALF L645-646 and L689 re-read; serpentine with even rows left to right) |
| Kernel: Jarvis | 7 5 / 3 5 7 5 3 / 1 3 5 3 1, ÷48 | DHALF L699-709; Jarvis, Judice & Ninke 1976 (doi:10.1016/S0146-664X(76)80003-2) | meets | CONFIRMED (DHALF L707-709) |
| Kernel: Stucki | 8 4 / 2 4 8 4 2 / 1 2 4 2 1, ÷42 | DHALF L723-731 | meets | CONFIRMED (DHALF L729-731; 0 px even with a Float64 accumulator) |
| Kernel: Atkinson | 1/8 to six neighbours, so 2/8 of the error is dropped | tannerhelland diagram `X 1 1 / 1 1 1 / 1`, (1/8) | meets | CONFIRMED |
| Kernel: Burkes | 8 4 / 2 4 8 4 2, ÷32 | DHALF L742-749 | meets | PLAUSIBLE (DHALF L748-749 re-read; not re-run) |
| Kernel: Sierra-3 / Sierra-2 / Sierra Lite | ÷32 / ÷16 / ÷4 with the published weights | DHALF L762-783 | meets | PLAUSIBLE (DHALF L767-783 re-read; not re-run) |
| Kernel: Blue Noise | Ostromoukhov 2001 rows 0–48 verbatim (128 of 128 rows re-diffed, 0 differences). Key levels 49–206 are KerfDesk's own, with threshold `128 + m·n(x, y)`, where n is a position hash. **No dither mask**, so no void-and-cluster and nothing to tile | Ostromoukhov, doi:10.1145/383259.383326; Zhou & Fang, doi:10.1145/882262.882289 (closed; ADR-649 uses none of its numbers) | meets ADR-649 | PLAUSIBLE (read: no mask; threshold `128 + m·n(x, y)` with a position hash, `dither-blue-noise.ts:64-81`; m = 0 at L ≤ 48 and L ≥ 207). The table was not re-diffed |
| Kernel: Ordered | Bayer 4 × 4, thresholds `(M + ½)·16` | DHALF L534-543 | meets; **17 levels** (Q3-P3-3) | CONFIRMED: KerfDesk equals a recursive M4 `[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]` with thresholds `(M + ½)·16`, 0 px differing |
| Kernel: Grayscale | S exact against the formula in every cell, at both tone settings | Q1 | meets | PLAUSIBLE |
| **Tone**: FS | whole MAE 0.0014, max 0.0029 (L8); inner MAE 0.0003; compile MAE 0.0030 / max 0.0063; monotone; 256 distinct coverages | `1 − L/255` | meets | CONFIRMED (whole and inner, 128 × 128, all 256 levels: whole MAE 0.0014, max 0.0029 at L8; inner 0.0003; monotone; 256 distinct). At 8 levels (16, 48 … 240) the whole-patch error is ≤ 0.0028 and the inner error ≤ 0.0007. Compile not re-run |
| Tone: Jarvis | whole 0.0035, max −0.0059 (L211); inner 0.0004; compile 0.0066 / 0.0107; no dot at L254 within 128 px | same | meets (Q3-P3-2 for the edges) | CONFIRMED (whole 0.0035, max −0.0059 at L211; inner 0.0004; 254 distinct). Compile not re-run |
| Tone: Stucki | whole 0.0030 / 0.0051; inner 0.0003; compile 0.0057 / 0.0100 | same | meets | CONFIRMED (whole 0.0030, max 0.0051 at L28; inner 0.0003) |
| Tone: Atkinson | whole 0.0517, max 0.1255 (L32); solid at L ≤ 32, blank at L ≥ 224; 3 reversals of +0.0002 | its definition drops 1/4 of the error; the picker says "The darkest and lightest tones turn solid" | as designed | CONFIRMED on 64 × 64: solid at L ≤ 32, blank at L ≥ 224, max 0.1255 at L32 (MAE 0.0534 at this patch size) |
| Tone: Burkes | 0.0024 / 0.0049; inner 0.0004; compile 0.0047 / −0.0083 | same | meets | PLAUSIBLE |
| Tone: Sierra-3 / Sierra-2 / Sierra Lite | 0.0033 / 0.0026 / 0.0014 (max 0.0052 / 0.0051 / 0.0028); compile 0.0061 / 0.0050 / 0.0029 | same | meets | CONFIRMED for Sierra-3 (whole 0.0033, max 0.0052 at L42); PLAUSIBLE for Sierra-2 and Sierra Lite |
| Tone: Blue Noise | whole 0.0014, max −0.0029 (L232); inner 0.0003; compile 0.0028 / 0.0056 | same | meets (best) | CONFIRMED (whole 0.0014, max −0.0029 at L232; inner 0.0003; monotone). At 8 levels the whole-patch error is ≤ 0.0025 and the inner error ≤ 0.0004 |
| Tone: Ordered | MAE 0.0156, max −0.0311 (L8, L247); 17 distinct coverages | 8 × 8 needed for 256 levels (DHALF L547-548) | Q3-P3-3 | CONFIRMED (17 coverages, MAE 0.0156, −0.0311 at L8, +0.0311 at L247) |
| Tone, non-default (image gamma 2, Negative, Power 60, Min 10) | the same per-mode errors as the default (FS 0.0030, Blue Noise 0.0028, Jarvis 0.0067); G-code = reference, 0 px, at S600; Grayscale S exact | ADR-671 gamma, Negative | meets | PLAUSIBLE (not re-run) |
| **Artifacts**: FS | low-frequency share 0.009; anisotropy mean 3.18, max 37.5 at L85; spectral peak 591 at L85 (period 3); worm cluster 1.12 / 1.10 px (L64 / L191); eye graininess 9.6 | blue noise: low share → 0, anisotropy ≈ 0 (Ulichney) | as the FS reference does | PLAUSIBLE (spectra not re-run). The refuter's own graininess (eye σ 0.15 mm, no spot, same 10 levels) is 10.9 and keeps the order Blue Noise < FS < Jarvis < Stucki |
| Artifacts: Jarvis | 0.025; 3.95, max 28.4 (L85 and L170); peak 295 (L85 and L170); clusters 2.79 / 2.79; graininess 11.0; first-row band at L239 is 63% lighter | same | worms and period-3 lock, as the reference does; Q3-P3-2, Q3-P3-4 | PLAUSIBLE (graininess 12.8 in the refuter's model, same order) |
| Artifacts: Stucki | 0.017; 2.18, max 16.4 (L85); peak 321 (L85); 2.75 / 2.72; 11.2 | same | as the reference | PLAUSIBLE (graininess 13.1 in the refuter's model) |
| Artifacts: Atkinson | anisotropy 1.66, max 16.6 (L128); peak 455 (L128); graininess 6.3 (flat clipped levels) | — | as designed | PLAUSIBLE |
| Artifacts: Burkes | 0.021; 2.60, max 18.5 (L85); peak 243 (L170); 2.02 / 1.53; 13.3 | same | as the reference | PLAUSIBLE |
| Artifacts: Sierra-3 / Sierra-2 / Sierra Lite | low share 0.021 / 0.033 / 0.007; anisotropy max 12.6 / 19.4 / 37.5; peak 217 / 555 / 591; graininess 11.2 / 14.7 / 9.3 | same | as the reference | PLAUSIBLE |
| Artifacts: Blue Noise | 0.008; anisotropy mean **0.46**, max 1.44; peak ≤ 49 except a 50% checkerboard at L128 (493); clusters 1.25 / 1.24; graininess **8.2** (lowest); **dots outside a mask** (Q3-P3-1) | ADR-649 claims | meets ADR-649; Q3-P3-1 | PLAUSIBLE for the spectra; graininess 9.5, the lowest, in the refuter's model. CONFIRMED for the dots outside a mask (Q3-P3-1) |
| Artifacts: Ordered | period-4 grid by design (peak 1820 at L128); graininess 1.9 (period below the eye filter) | Bayer 1973 | as designed | PLAUSIBLE |
| Error buffer | fresh per image and per scan angle; flows through masked and white areas; no clamp (fixed kernels cannot burn a 255 pixel: 0 dots outside every disc and clip) | — | meets | CONFIRMED for the fixed kernels: 0 dots outside a disc of r = 40 px on white at L200–253, and 0 holes outside dark discs on black at L2–25, in all eight fixed kernels. The fresh buffer per call was read at `dither.ts:238-241` |
| **Simulated burn ranking**, mean SSIM of face, astronaut, gradient and grey chart (Falcon spot 0.08 × 0.10 mm, eye σ 0.15 mm, linear darkness) | Blue Noise 0.966 > Sierra Lite 0.965 > FS 0.955 > Stucki 0.925 > Sierra-3 0.922 > Ordered 0.920 > Jarvis 0.919 > Burkes 0.916 > Sierra-2 0.911 > Atkinson 0.872 ≫ Threshold 0.503. Grayscale 0.998 (0.835 under the saturating model, uncalibrated) | the source | Blue Noise best for photos; the default FS is 3rd of 11 | CONFIRMED for the top three and the default. In the refuter's own model (Gaussian spot of FWHM 0.10 mm, linear darkness clipped at 1, eye σ 0.15 mm, SSIM with σ 1.5 cells; a 256 × 48 ramp and the astronaut box-reduced to 192 × 192), the means are Blue Noise 0.962 > Sierra Lite 0.959 > FS 0.948 > Jarvis 0.933 > Ordered 0.929 ≈ Stucki 0.929. Absolute values depend on the model. The order of the middle of the field, which lies within 0.006 here (Stucki, Sierra-3, Ordered, Jarvis), is not robust: Jarvis is ahead of Stucki and Ordered in this model |
| Same, LT-4LDS spot 0.16 × 0.18 / eye 0.30 mm / eye 0.08 mm | the order holds: BN 0.971 / 0.996 / 0.730; FS 0.962 / 0.995 / 0.725; Jarvis 0.939 / 0.985 / 0.605 | — | robust | CONFIRMED (order): with a 0.18 mm spot, and with eye σ 0.30 mm, the order Blue Noise > Sierra Lite > FS > Jarvis/Stucki holds in all four combinations (for example 0.972 / 0.969 / 0.960 / 0.951 / 0.946 at 0.18 mm and 0.15 mm) |
| Edge (64 \| 192 step), 10–90% rise, eye 0.08 mm | Jarvis 0.133, Burkes 0.137, Sierra-3 0.147, Stucki 0.150 (overshoot), FS 0.231, Blue Noise 0.253; plain blur 0.257 | — | wide kernels enhance edges | PLAUSIBLE |
| **Twins**: emitted G-code vs the compiled S (canvas Preview source) | 0 px differ, 12 modes × 7 images | exact | meets | PLAUSIBLE (not re-run) |
| Photo engraving preview vs compiled S (face, 160 × 160) | 0 of 25,600 px, all 12 modes | exact | meets | PLAUSIBLE (not re-run) |
| Save Processed Bitmap vs burn (face) | 29–37% of pixels differ in diffusion modes, Ordered 56%; mean tone within 0.001; Threshold and Grayscale 0 after the flip | — | KNOWN 20-K-1 / Q1-P3-K4 | PLAUSIBLE (KNOWN; not re-run) |
| Remote and phone | the same `prepareCurrentStartJob` path, no separate dither | — | meets (READ) | PLAUSIBLE |
| **Screens**: Halftone (Dots), 8 px, 45° (default) / 15° / 0° | MAE 0.0009 / 0.0003 / **0.026**; max 0.0025 / 0.0010 / **0.084**, non-monotone at 0° | `halftone.ts:63-65`: area "tracks it exactly" | default meets; 0°/90° Q3-P2-1 | CONFIRMED through `runAdjustment` with the dialog defaults (spacing 8, angle 45): MAE 0.0009 / 0.0003 / 0.0260; max 0.0025 / 0.0010 / −0.084 (L126); 18 coverages and 1 reversal at 0° and 90° |
| Line Screen (Newsprint), 8 px, 0° (default) / 45° / 15° | MAE **0.062** / 0.0031 / 0.0003; max **0.125** / 0.0091 / 0.0008; 0° gives 5 tones and black = 87.5% | same | **fails** (Q3-P2-1) | CONFIRMED through `runAdjustment` and `commitAdjustment` with the dialog defaults (spacing 8, angle 0): coverage takes only 0, 0.125, 0.375, 0.625 and 0.875; MAE 0.0623, max −0.125; L0 → 0.875 and L128 → 0.375 on the commit path; 45° 0.0031 / 0.0091; 15° 0.0003 / 0.0008 |
| Mode list against LightBurn 2.0 | LightBurn's Newsprint, Halftone and Sketch are absent as image modes (Image Studio filters exist); KerfDesk adds Burkes, three Sierras and Blue Noise | LightBurn 2.0 Image Mode (10 modes) | KNOWN (LIGHTBURN-STUDY G-01/G-02) | CONFIRMED (LightBurn 2.0 page re-fetched 2026-10-28: Threshold, Ordered, Atkinson, Dither, Stucki, Jarvis, Newsprint, Halftone, Sketch, Grayscale) |

### Measurement method

**Dumps (KerfDesk code).** Temporary Vitest files wrote KerfDesk's own outputs to the scratchpad,
one file run at a time.
- `dither()`: flat patches of 128 × 128 at every level 0–255, 256 × 256 patches at 21 levels, a
  256 × 64 ramp, and discs of radius 40 px on white.
- `emitGcode(project)`: the Save path (`prepareOutput` → `emitPreparedGcode`).
  - Images at 1:1 on the default 400 × 400 GRBL profile (front-left origin, bidirectional,
    10 lines/mm).
  - A 37-level wedge at default settings, and again with image gamma 2, Negative, Power 60 and
    Min 10.
  - Seven images:
    - the astronaut face crop, 160 × 160 at (150, 20), as in Q1;
    - the astronaut box-reduced 3:1;
    - `arch-house-langebaan-source.png` box-reduced 6:1;
    - a 256-step gradient and a 16-step wedge;
    - a black/white bar chart and a grey chart of 64/192 bars at 1–4 px with a 96/160 star.
- `compileJob`'s `sValues`, `computePhotoEngravingPreview` and `buildProcessedRasterBitmap`.
- An owned circular `imageClip`.
- `halftoneScreenInPlace` on flat patches.

**Analysis (independent).** Plain `.mjs` files that import nothing from KerfDesk:
- **Reference dithers.** Written from the published filters: Float32 accumulator, threshold 128,
  serpentine with mirrored offsets, and error that leaves the image dropped. Bayer from the
  recursive M2 → M4 construction.
- **G-code reader.** It reads the modal G0/G1, M3/M4/M5, S, F, X and Y words, and turns each lit
  G1 into the cells whose centres it covers.
- **Spectra.** Four Hann-windowed 64 × 64 blocks (Bartlett mean) from the interior of
  256 × 256 patches.
  - Low-frequency share: power below fg/2, with fg = √min(g, 1−g) (Ulichney's principal
    frequency).
  - Anisotropy: var/mean² per annulus.
  - Peak ratio: the largest bin over the mean bin.
  - Worm cluster: mean 8-connected minority-pixel component.
- **Burn simulator.**
  - The lit cells, at S/S_max, are deposited along each row's centre line on a 0.02 mm grid.
  - They are blurred by a Gaussian spot with the profile's spot size as FWHM: the Falcon A1 Pro
    blue module, 0.08 × 0.10 mm (`laser-modules.ts:16`), and the LT-4LDS-V2, 0.16 × 0.18
    (`device-profile.ts:470`).
  - Solid full power is normalised to D = 1, at ideal M4 motion.
  - Darkness is `min(1, D)` (linear) or `1 − exp(−D ln 20)` (Q1's saturating model).
  - Burn and source are then filtered by the same Gaussian "eye", σ 0.08 / 0.15 / 0.30 mm, and
    compared on the cell grid: SSIM (Wang 2004, window σ 1.5 cells, edges trimmed), MAE and
    signed bias.
  - Graininess is the RMS of the eye-filtered (σ 0.15 mm) darkness over the interior of a flat
    patch, × 1000, averaged over L16, 32, 64, 96, 128, 160, 191, 223, 239 and 247.

The ranking is a model result. The bit-exactness, tone and twin numbers do not depend on the model.

**Temporary files** (repo copies deleted; rebuild them from this list):
- **`src/io/gcode/zz-q3-dither.test.ts`:** the dumps above.
  - Tests A–C/D: `dither()` patches, ramp and discs.
  - Test E: the wedge through `emitGcode`.
  - Test F: the seven images through `emitGcode`, plus `compileJob` `sValues` and meta.
- **`src/ui/raster/zz-q3-twins.test.ts`:**
  - the circular `imageClip` at 6 levels (`emitGcode`, lit cells outside the circle);
  - the Photo engraving preview and Save Processed Bitmap against the compiled `sValues`;
  - clips on the face and the astronaut;
  - dark discs on black.
- **`src/core/image-adjust/zz-q3-halftone.test.ts`:** `halftoneScreenInPlace` coverage at every
  level, for dot and line shapes, at 8 px (0°, 15°, 45°, 90°), and for lines also at 4 px and
  16 px.
- **Scratchpad `zz-q3/`:**
  - `zz-q3-lib.mjs`: reference kernels, Bayer, G-code reader, FFT, blur, SSIM;
  - `zz-q3-a-tone.mjs`: exactness, tone, transients, discs;
  - `zz-q3-b-spectra.mjs`, `zz-q3-c-compile.mjs` and `zz-q3-d-sim.mjs`;
  - `zz-q3-e-grain.mjs`: graininess and the start-up band;
  - `zz-q3-f-detail.mjs`: edges and bars;
  - their `out-*.txt` outputs.

## Findings

### Q3-P2-1 — Image Studio's Line Screen (Newsprint), at its default 0°, renders only 5 tones (error up to 12.5%, 25% at a 4 px pitch) and stripes solid black; the dot Halftone at 0° or 90° is off by up to 8.4%

- **Where:**
  - `src/core/image-adjust/halftone.ts:66-72`: the spot test runs at integer pixel coordinates.
    For lines it uses `offset < (ink * s) / 2`.
  - `halftone.ts:86-88`: `fractionalCell` with `Math.round` puts the half-pitch tie at −s/2.
  - Defaults: `src/ui/image-editor/editor-adjustments.ts:196-206`. "Line Screen (Newsprint)" has
    pitch 8 and **angle 0**. Halftone (Dots) has angle 45, adjustable 0–90 (`:185-194`).
- **Anchor:**
  - **Twin.** The same function tracks tone within 0.9% at 15° and 45° for lines, and within
    0.25% at its 45° default for dots.
  - **Contract (code comment, cited as its own `file:line`).** `halftone.ts:63-65`: "Covered area
    is proportional to ink — dot area (or line thickness) tracks it exactly".
  - **Ground truth.** An amplitude-modulated line screen sets line width in proportion to ink.
    LightBurn 2.0 describes Newsprint as "a grid of spots that are larger in darker areas" (Image
    Mode page, below).
- **Scenario:** In Image Studio, the user applies Filter → Line Screen (Newsprint) at its defaults
  to a photo.
  - At 0°, `v = y` is an integer, so `|fractionalCell(v, 8)|` takes the values 0, 1, 2, 3, 4, 3, 2
    and 1.
  - The `<` test therefore admits only 1, 3, 5 or 7 rows of each 8.
  - Every grey becomes one of 0, 12.5, 37.5, 62.5 or 87.5% coverage.
  - Pure black (ink 1) still fails `4 < 4`, so it keeps a white row every 8 px.
  - The photo burns posterised into 5 bands. A 50% grey burns as 37.5% (L ≤ 127.5) or 62.5%, and
    solid blacks are striped.
  - The editor shows the striped result. The defect is visible quality, not a hidden tone change.
- **Evidence:** REPRO (`zz-q3-halftone.test.ts`, 128 × 128 flat patches at every level 0–255,
  coverage = pixels < 128).

  | Screen | MAE | Max \|error\| | Black (L0) | Monotone |
  |---|---|---|---|---|
  | Line 8 px, 0° (default) | 0.062 | 0.125 | 0.875 | yes, 5 levels |
  | Line 8 px, 90° | 0.062 | 0.124 | 0.924 | yes |
  | Line 4 px, 0° | 0.125 | 0.250 | 0.750 | yes |
  | Line 16 px, 0° | 0.031 | 0.0625 | 0.9375 | yes |
  | Line 8 px, 45° / 15° | 0.0031 / 0.0003 | 0.0091 / 0.0008 | 1.000 | yes |
  | Dots 8 px, 0° and 90° | 0.026 | 0.084 (L126–129) | 1.000 | 1 reversal |
  | Dots 8 px, 45° (default) / 15° | 0.0009 / 0.0003 | 0.0025 / 0.0010 | 1.000 | yes |

  Rolling v2 area 20 verified this module's formulas by reading only ("line width = ink · s"). It
  did not measure the pixel grid.
- **Refuter:** **CONFIRMED** (P2 kept).
  - **What would make it false:**
    - the 5 levels coming only from a helper that the dialog does not use;
    - a patch-phase artefact;
    - an ADR that accepts a quantised line screen;
    - a UI promise that would make it P1.
  - **Real path.** The refuter re-ran the screen through Image Studio's own dispatcher,
    `runAdjustment('line-screen', defaultParams(…))`, with the defaults spacing 8 and angle 0. It
    also re-ran it through the session commit `commitAdjustment(createSession(…))`, on 128 × 128
    flat docs at every level.
    - Coverage takes exactly 0, 0.125, 0.375, 0.625 and 0.875. MAE is 0.0623 and the maximum
      error −0.125.
    - On the commit path, L0 gives 0.875 and L128 gives 0.375.
    - At 0°, coverage is per row and the patch is 16 whole periods, so this is not a phase
      artefact.
    - The 90°, 4 px, 16 px, 45° and 15° figures, and the dot screen's 0°/90° figures (−0.084 at
      L126, 18 coverages, 1 reversal), all reproduce.
    - The Filter menu lists every `menu: 'filter'` entry (`EditorAdjustMenus.tsx:56-60`), so the
      screen is reachable today.
  - **What a correct line screen gives.** A binary row screen at 0° and pitch s can draw s + 1
    widths. At 8 px that is 9 levels, with a minimum maximum error of 1/(2s) = 6.25% and solid
    black solid. The refuter's alternative, which grows the line one row at a time, gives 9
    levels, MAE 0.031 and max 0.062. The code admits only odd widths: 5 levels, max 12.5%.
  - **Why not P1.**
    - The dialog previews with the same `runOp`: `computeAdjustPreview` in
      `editor-adjust-session.ts:59-71`. Its code comment at `:57` says "what the dialog shows is
      what OK produces"; that is a code comment, not ADR text.
    - No UI copy promises tone. The label and the "Line pitch (px)" and "Angle (°)" fields say
      nothing about it.
    - The only tone promise is a code comment (`halftone.ts:63-65`), not ADR text. ADR-242 does
      not cover screen tone.
  - **Why not P3.** It is the filter's default setting, and a photo visibly posterises into 5
    bands with white lines through solid black.
  - **LightBurn.** The 2.0 Image Mode page, a versioned path re-fetched 2026-10-28, describes
    Newsprint as a dot grid that "has good tonal range, but is visibly patterned". It states no
    tone-level limit for Newsprint or Halftone. LightBurn therefore does not share the
    limitation, but its Newsprint is dots, not lines. The quoted "grid of spots" text anchors the
    dot screen, not line width. The line-width ground truth rests on the twin (same function at
    15°/45°) and the code comment. The AM line-screen definition is UNVERIFIED as a fetched
    source.
  - **Correction to the fix direction.** Sampling at pixel centres (v + ½) alone does *not* make
    widths step by one pixel. The refuter measured it: widths become 0, 2, 4, 6 and 8 rows, still
    5 levels (0, 25, 50, 75, 100%) and still max 12.5%. It fixes only solid black. Pitch + 1
    levels need a tie-broken (ranked) spot function that adds one row, or one pixel, at a time.
- **Fix direction:**
  - Sample the spot function at pixel centres, offset by half a pixel, or use area coverage, so
    that widths step by one pixel. (Refuter: half-pixel sampling alone steps by 2 px. Use a ranked
    spot function, as above.)
  - Use `≤` at full ink so that solid black stays solid.
  - Alternatively, default Line Screen to a non-axis angle.
  - Pin each screen's coverage with a test at 0°, 45° and 90°.

### Q3-P3-1 — Blue Noise burns dots outside a mask (and holes in pure black) next to light (dark) tones

- **Where:**
  - `src/core/raster/dither-blue-noise.ts:111-124`. Each pixel spreads its error with weights
    chosen by **its own** source level (`AHEAD[level]` etc.). At a tone boundary, a pixel can
    therefore receive more than 1 in total. For example, a 255 pixel next to 245 pixels receives
    up to 0.538 (ahead, row 10 = [7, 3, 3]) + 0.278 (below, row 0 = [13, 0, 5]) + 0.231
    (behind-below) = 1.05 of neighbouring errors.
  - Masked pixels are whitened before dithering (`image-mask.ts:33`; order in
    `compile-job-raster.ts:337-354`).
- **Anchor:**
  - **Contract.** ADR-480 Decision 9, as amended by Amendment 1 (L127): Crop and Flatten keep the
    mask's shape as the image's own clip, "so the area outside it never burns".
  - ADR-480 Amd 1 Context (L10-11): a live mask hides the outside pixels, "so those pixels never
    burn".
  - **Twin.** All nine fixed-kernel modes leave every masked pixel unburned. Their incoming
    weights sum to exactly 1, and an unburned pixel's error is ≥ −127, so a 255 pixel stays
    ≥ 128.
- **Scenario:** A light photo (sky or skin, luma 230–253) with an owned clip or Apply Mask, burned
  with Blue Noise.
  - A few dots land in the first cell outside the clip.
  - Symmetrically, a few holes appear in solid black next to a dark grey.
  - The Preview shows them, since it is the same compile.
- **Evidence:** REPRO.
  - Through `emitGcode`: a 128 × 128 flat image with a circular owned clip of r = 4 mm. Lit cells
    outside the circle, Blue Noise (all other modes 0):

    | Luma | Dots outside / inside | Furthest cell centre outside the clip |
    |---|---|---|
    | 200 | 0 / 1080 | — |
    | 230 | 1 / 485 | 0.053 mm |
    | 240 | 4 / 285 | 0.119 mm |
    | 245 | 7 / 185 | 0.114 mm |
    | 250 | 3 / 88 | 0.087 mm |
    | 253 | 1 / 28 | 0.003 mm |

  - Astronaut, 170 × 170, with a circular clip: 1 dot outside (face: 0).
  - `dither()` discs on white: 1 dot outside at L230 and 7 at L245, all ≤ 1.14 px from the edge.
  - Dark discs on black: 1–6 holes outside at L2–25 (other modes 0).
- **Why P3:**
  - The cells are adjacent to the boundary. One is 0.07 mm past the mask's own half-cell
    quantization.
  - There are 1–7 per 25 mm of edge, and the Preview shows them.
  - It is a contract drift, not a visible defect.
- **Refuter:** **CONFIRMED** (P3 kept).
  - **What would make it false:**
    - a mask applied after the dither;
    - fixed kernels behaving the same way;
    - a modulated threshold at L255.
  - **Code.** `compile-job-raster.ts:337-354` whitens masked pixels, then orients, then dithers,
    and returns the dither unchanged. The streamed path tests the mask per row before the dither
    (`compile-job-raster-stream.ts:106-130`). No gate runs after the dither. m = 0 at L255
    (`BLUE_NOISE_KEY_LEVELS[0]`), so a white pixel burns only from incoming error below −127.
    The incoming weights can sum above 1: row 10 ahead 7/13, plus row 0 below 5/18, plus row 10
    behind-below 3/13, gives 1.047.
  - **Repro.** The refuter's own geometry was `dither()` on a 96 × 96 field with a disc of
    r = 40 px, pixel-centre inclusion.
    - Blue Noise put 3, 3, 6, 2 and 2 dots outside the disc at L230, 240, 245, 250 and 253 (0 at
      L200). The furthest pixel centre is 1.19 px past the edge.
    - Dark discs on black gave 1, 7, 3, 1 and 3 holes outside at L5–25.
    - All eight fixed kernels gave 0.
    - The counts differ from the auditor's because the geometry differs; the effect and its
      reach (≤ 1.2 cells) match.
  - **Why P3 and not P1.**
    - The canvas Preview reads the same compile, so the burn does not differ from what the app
      shows.
    - The excursion is at most one burn cell beyond the mask's own cell-centre quantisation, at
      1–7 dots along a light edge.
    - The ADR-480 Amd 1 text "the area outside it never burns" is broken, so it stays as contract
      drift, not a visible defect.
- **Fix direction:**
  - Run masked (and 255 / 0) pixels without quantizing them. That is, force a masked pixel to
    "no burn" and drop or pass its error.
  - Or normalise the incoming weights at tone boundaries.
  - Pin it with a masked Blue Noise test.

### Q3-P3-2 — Error diffusion leaves a blank band, up to 2.5 mm deep, along the first-scanned image edges and along every white→light boundary; Jarvis, Stucki and Sierra-3 are worst

- **Where:**
  - `src/core/raster/dither.ts:238-241, 248-255`: the buffer starts as raw luma, so error starts
    at zero.
  - `dither-rows.ts:99-104`: the streamed path behaves the same.
  - The dither runs on the machine-oriented grid (`compile-job-raster.ts:344-354`). On a
    front-left machine the band therefore lies along the image's **bottom** edge (machine row 0)
    and its sides.
- **Anchor:** Ground truth: intended coverage `1 − L/255` per area. The published filters also
  start from zero error (DHALF gives them no start-up treatment), so this is an improvement over
  the reference, not a deviation from it.
- **Scenario:**
  - A photo whose light background (luma 239–250, 2–6% dots) reaches the image edge burns with a
    whiter strip along that edge.
  - So does a light-grey shape on a white or masked background, at its leading edges.
  - Dark areas get the mirror effect: holes missing along the edge.
- **Evidence:** REPRO (`dither()` patches and discs; simulator for the eye band).
  - First row with a dot, on a 128 × 128 patch:

    | Mode | L239 | L247 | L250 | L253 |
    |---|---|---|---|---|
    | Jarvis | row 7 | 15 | 25 | 64 |
    | Stucki | 7 | 14 | 23 | 60 |
    | Sierra-3 | 7 | 15 | 24 | 61 |
    | FS | 4 | 8 | 14 | 35 |
    | Blue Noise | 3 | 6 | 10 | 20 |

    Dark levels mirror this: Jarvis's first hole is at row 16 for L8 and row 65 for L2.
  - Eye-filtered (σ 0.15 mm) darkness of rows 2–7 against the interior, at L239 (interior 0.063):
    - Jarvis −0.040 (63% lighter);
    - Stucki −0.033;
    - Sierra-3 −0.032;
    - FS −0.008;
    - Blue Noise −0.005.
  - At L16, Jarvis's band is +0.028 darker.
  - Disc of r = 40 px on white: coverage in the boundary ring (36 < r ≤ 40), as a share of the
    interior:
    - at L230: Jarvis 0.68, Stucki 0.70, Sierra-3 0.68, FS 0.89, Blue Noise 0.90;
    - at L245: 0.44–0.57.
  - On a 64 × 64 patch this edge loss is why Jarvis's whole-patch tone error doubles (max 0.0107
    against 0.0059 at 128 × 128).
- **Prior:** Rolling v2 area 20, Verified clean, called the L254 case "the ordinary error-diffusion
  start-up transient". This audit measures the visible part, at 230–250 and at white→light
  boundaries, and the mode-to-mode spread.
- **Refuter:** **CONFIRMED** (P3 kept; partly KNOWN, as stated).
  - **What would make it false:** a measurement artefact of patch size or of where the
    warm-up rows sit, or a band that the eye cannot see.
  - **First row with a dot.** On the refuter's own 128 × 128 `dither()` dumps, the first rows with
    a dot match the table exactly:
    - Jarvis 7, 15, 25 and 64;
    - Stucki 7, 14, 23 and 60;
    - Sierra-3 7, 15, 24 and 61;
    - FS 4, 8, 14 and 35;
    - Blue Noise 3, 6, 10 and 20.
    - The first hole is at row 16 for Jarvis at L8 and row 65 at L2.
  - **Eye band at L239** (σ 1.5 cells, rows 2–7 against rows 32–119): Jarvis −0.040 (−64%),
    Stucki −0.032, Sierra-3 −0.032, FS −0.008 (−13%), Blue Noise −0.005 (−8%).
  - **Correction.** The json summary said "8% FS". The FS band is 13% lighter; 8% is Blue Noise.
  - **Orientation.** `originFlipsRasterY` is true for front-left (`raster-orientation.ts:9-13`),
    so machine row 0 is the image's bottom edge. Confirmed by reading.
  - **Severity.** It matches the published filters' own start-up behaviour, so it remains a P3
    improvement.
- **Fix direction:**
  - Seed the first row's (and each white→light entry's) error, or dither a few warm-up rows that
    are not emitted.
  - Or say in the picker copy that Blue Noise and Floyd–Steinberg keep light edges best.

### Q3-P3-3 — Ordered is a 4 × 4 Bayer matrix: 17 tone levels, up to 3.1% tone error and 16 visible bands across a gradient

- **Where:**
  - `src/core/raster/dither.ts:411-416` (`BAYER_4X4`);
  - `:116-119` and `:219-230`.
- **Anchor:** Ground truth. DHALF.TXT L545-548: "To fully reproduce our 256-level image, we would
  need to use an 8x8 pattern."
- **Scenario:** Ordered on a photo or a sky gradient.
  - 256 input levels collapse to 17 coverages, in steps of 6.25%.
  - A smooth 25.6 mm ramp shows 16 flat bands, each 1.6 mm wide.
- **Evidence:** REPRO.
  - 17 distinct coverages over L0–255.
  - Max error −0.0311 at L8 and +0.0311 at L247; MAE 0.0156; the compile path gives the same.
  - Gradient SSIM (σ 0.15 mm): 0.911, against FS 0.923 and Blue Noise 0.944.
  - The tile phase is the machine-grid origin of each image (`x % 4`, `y % 4`). That is invisible
    and consistent between Preview and burn.
- **Refuter:** **CONFIRMED** (P3 kept; partly KNOWN).
  - **What would make it false:** an ADR choosing 4 × 4, or a misread of DHALF.
  - **ADRs.** No ADR in `DECISIONS.md` or `docs/decisions` decides the Bayer size.
  - **Source.** DHALF L547-548 at the pinned SHA reads, verbatim, "we would need to use an 8x8
    pattern".
  - **Repro.** KerfDesk equals a recursive M4 with thresholds `(M + ½)·16` (0 px differing on
    64 × 64 patches at all levels). It gives 17 coverages, MAE 0.0156, −0.0311 at L8 and +0.0311
    at L247.
  - **Gradient SSIM** in the refuter's model (0.10 mm spot, eye σ 0.15 mm): Ordered 0.921, FS
    0.926, Blue Noise 0.946. Ordered's deficit against FS is smaller than the auditor's 0.911 vs
    0.923. At eye σ 0.30 mm it is 0.974 vs 0.990.
  - **LightBurn.** The 2.0 page does not state its Ordered matrix size.
  - **Prior.** Rolling v2 area 20 recorded "Ordered has 17 levels" under Verified clean. This
    finding adds the published 8 × 8 anchor and grades the gap as P3.
- **Fix direction:** Use an 8 × 8 (65-level) or 16 × 16 Bayer matrix, built recursively. Or say "17
  levels" in the picker copy.

### Q3-P3-4 — The photo-dither order ("smoothest first") and the Jarvis fallback contradict ADR-649's own measurements and this audit's eye-weighted ranking

- **Where:**
  - `src/ui/raster/photo-engraving-settings.ts:7-13`: the comment reads "The dithers that suit
    photographs, smoothest first (ADR-649 measures it)", over `['blue-noise', 'jarvis', 'stucki',
    'floyd-steinberg']`.
  - `:54-56`: a non-photo mode falls back to `'jarvis'`.
  - `src/ui/layers/DitherSwatchPicker.tsx:22`: Jarvis is described as "Spreads dots widely for
    smooth, soft photo tones."
- **Anchor:**
  - **Contract.** ADR-649 Decision 1 (L50-52): "`PHOTO_DITHERS` is ordered smoothest first and
    this ADR measures it as smoothest".
  - ADR-649's own Verification table (L125-130) gives the low-frequency share totals:
    - Blue Noise 0.82;
    - FS 0.93;
    - Stucki 1.59;
    - Jarvis 2.15.

    By the ADR's own metric, FS is smoother than Stucki and Jarvis.
  - ADR-581 Decision 2 sets the Jarvis fallback.
- **Scenario:** A user opens Photo engraving on an image whose operation uses Threshold, Ordered,
  Atkinson, Burkes or a Sierra.
  - The window starts on Jarvis, and lists Jarvis and Stucki ahead of FS as smoother.
  - Measured on every photo here, Jarvis burns grainier and less like the source than FS or Blue
    Noise.
- **Evidence:** REPRO.
  - Low-frequency share, mean over 21 levels: FS 0.009, Stucki 0.017, Jarvis 0.025, Blue Noise
    0.008.
  - Eye graininess: FS 9.6, Jarvis 11.0, Stucki 11.2, Blue Noise 8.2.
  - Simulated-burn SSIM:

    | Mode | Face | Astronaut | Gradient |
    |---|---|---|---|
    | FS | 0.959 | 0.972 | 0.923 |
    | Jarvis | 0.924 | 0.944 | 0.906 |
    | Stucki | 0.927 | 0.950 | 0.907 |
    | Blue Noise | 0.971 | 0.978 | 0.944 |

  - **Limit.** The model leaves out the thermal threshold of isolated dots. On wood, Jarvis's 2–3
    px clusters may mark more reliably than FS's single dots. ADR-649 itself names a burned test
    card as "the qualifying step".
- **Refuter:** **CONFIRMED** for the "smoothest first" order. The Jarvis-fallback half is as
  designed. P3 kept.
  - **What would make it false:** "smooth" meaning something other than what ADR-649
    measures, or the fallback being a deliberate design.
  - **ADR-649.** Decision 1 (L50-52) and the Verification table (L125-130) read as quoted. By
    that table, FS (0.93) is smoother than Stucki (1.59) and Jarvis (2.15), yet `PHOTO_DITHERS`
    lists Jarvis and Stucki before FS under the comment "smoothest first (ADR-649 measures it)".
  - **Refuter's burn model.** FS beats Jarvis and Stucki on both images, at both spot sizes and
    both eye widths: astronaut 0.970 vs 0.945 / 0.949, ramp 0.926 vs 0.921 / 0.908. Its
    graininess is also lower: 10.9 vs 12.8 / 13.1.
  - **The fallback.** The Jarvis fallback is ADR-581 Decision 2 ("Unsupported photo modes start
    with Jarvis"). It follows LightBurn's own advice: the 2.0 Image Mode page calls Jarvis
    "Generally the best choice for smooth-shaded or photo images". That is a recorded,
    LightBurn-parity design, not a defect. Changing it is a maintainer choice, which ADR-649
    already leaves open.
  - **Remaining defect.** The order and its comment contradict the ADR's own numbers.
- **Fix direction:**
  - Reorder to Blue Noise, FS, Stucki, Jarvis, or drop the "smoothest first" claim.
  - Consider Blue Noise or FS as the fallback. ADR-649 leaves the Blue Noise default to the
    maintainer.
  - Qualify the choice with a burned card.

## KNOWN re-observed

**Refuter verdicts:**
- K1 is PLAUSIBLE. No test file references `errorDiffusionKernel`, and `dither.test.ts` has no
  weight or divisor assertion.
- K2 and K4 are PLAUSIBLE: not re-run.
- K3 is CONFIRMED: coverage tracks `1 − L/255` to within 0.003 on every re-run diffusion mode.
- K5 is CONFIRMED: the LightBurn 2.0 page was re-fetched and lists 10 modes.
- K6 is CONFIRMED: Atkinson is solid at L ≤ 32 and blank at L ≥ 224, with a maximum error of
  0.1255, re-run on 64 × 64 patches.

- **20-P3-3: no test pins the eight kernels or the Bayer matrix.**
  - Still true: `dither.test.ts` (47 tests) asserts structure only.
  - `dither-blue-noise.test.ts:28` pins only the join row 48.
  - This audit's reference dither (0 differences on 4.19 M px per mode) could become that test.
- **20-K-1 / Q1-P3-K4: Save Processed Bitmap dithers the image-oriented grid.**
  - Re-measured on the face: 9,436 of 25,600 px differ for FS, 8,971 for Jarvis, 9,526 for Blue
    Noise, and 14,331 for Ordered (Bayer phase).
  - Mean tone is within 0.001.
  - Threshold and Grayscale are identical after the Y flip.
- **20-K-4 / Q1-P3-K2: coverage is linear in sRGB bytes.** Observed: coverage = `1 − L/255` ±
  0.003 in every diffusion mode. Not re-raised.
- **20-K-5: the Adjust Image "Processed" pane dithers a thumbnail of at most 420 px.**
  - It also omits machine orientation, mask and sharpening (`AdjustImageDialog.preview.ts:65-93`).
  - ADR-670 records that it shows no calibration (limits, L111-112).
- **LIGHTBURN-STUDY G-01 / G-02: mode list.**
  - LightBurn 2.0 lists ten image modes, including Newsprint, Halftone and Sketch
    (https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/ImageMode/, fetched
    2026-10-28). It calls Jarvis "Generally the best choice for smooth-shaded or photo images".
    It does not name the algorithm behind "Dither".
  - KerfDesk offers halftone and line screen only as Image Studio filters. They work on source
    pixels, not on the burn grid, with no cells per inch.
  - KerfDesk adds Burkes, three Sierras and Blue Noise.
- **Atkinson clipping** (rolling v2 area 20, Verified clean): solid at L ≤ 32, blank at L ≥ 224.
  It is the definition, and the picker discloses it.

## Refuted

- **"Blue Noise uses a tiled mask that can show a repeat."** It has no mask. Threshold modulation
  is a per-pixel position hash (`dither-blue-noise.ts:64-72`). Spectral peaks are ≤ 49 at every
  level except the 50% checkerboard.
- **"The error buffer leaks between images."** `dither()` allocates a fresh Float32 buffer per call
  (`dither.ts:238-241`), and each image and each scan angle compiles separately
  (`compile-job-raster.ts:96-128`).
- **"Serpentine dithering interacts with bidirectional scanning."** The dot grid is fixed before
  emission. The default bidirectional G-code reproduces the reference dither with 0 px differing in
  every mode.
- **"Fixed kernels bleed into masked white."** 0 dots outside every disc and clip, in all nine
  modes, at L200–253.
- **"The Halftone dot screen misstates tone."** At its 45° default it is within 0.25%. Only the
  0°/90° settings are off (Q3-P2-1).
- **"The 1/3-tone period-3 lock and worms in FS, Jarvis, Stucki and the Sierras are defects."**
  They are properties of the published filters, which KerfDesk reproduces bit for bit. Blue Noise
  is the documented alternative (ADR-649).
- **"The Jarvis fallback is a defect"** (the second half of Q3-P3-4; refuter). ADR-581 Decision 2
  records it deliberately. LightBurn 2.0's Image Mode page recommends Jarvis for photos, and
  ADR-649 Decision 1 leaves a Blue Noise default to the maintainer. Only the "smoothest first"
  order and its comment remain in Q3-P3-4.
- **"The swatch thumbnails misrepresent the modes."** They run the real `dither()` on a 22 × 11
  ramp (`dither-thumbnails.ts:26-29`).

## Verified clean

- **Kernels.** Ten tables reproduce bit for bit against an independent implementation written from
  the published filters, on 4,194,304 + 16,384 + 98,304 pixels each:
  - Threshold;
  - FS, Jarvis, Stucki, Atkinson, Burkes, Sierra-3, Sierra-2 and Sierra Lite;
  - Ordered.

  Ostromoukhov's 128 rows show 0 differences against rolling v2's extraction of the paper's
  Appendix I.

  Refuter: "bit for bit" holds against a reference that, like KerfDesk, accumulates error in
  Float32 and rounds once per add. A Float64 reference of the same published filters differs in
  0.17–0.32% of flat-patch pixels for FS, Jarvis and Atkinson, where values tie at the 128
  threshold. That is a precision choice, not a kernel error. Pinning tests should therefore use
  Float32 or avoid exact-tie levels.
- **Save path.**
  - 37 levels × 12 modes × 2 tone settings through `emitGcode`: G-code = reference (0 px);
    every dot at exactly S_max (300 or 600); no off-row lit segments.
  - Grayscale S equals the formula in every cell.
- **Tone.**
  - Every diffusion mode is monotone over 256 levels, with 254–256 distinct coverages.
  - Interior MAE ≤ 0.0005.
- **Twins.**
  - G-code against the compiled `sValues` (which the canvas Preview reads): 0 px, on 7 images × 12
    modes.
  - Photo engraving preview: 0 of 25,600 px in all 12 modes.
  - The remote path compiles through the same `prepareCurrentStartJob`.
- **Streaming and tests.** `dither.test.ts` 47/47, `dither-rows.test.ts` 15/15 (streamed =
  full), `dither-blue-noise.test.ts` 7/7 and `dither-texture.test.ts` 2/2 pass at this tree.
- **ADR-649 claims.**
  - Blue Noise has the lowest anisotropy at all 21 levels: ≤ 1.44, against 9–37 for the fixed
    kernels at one-third tones.
  - Its mean tone error is ≤ 0.0029.
  - Its graininess is the lowest of the diffusion modes.

## Not verified

- **No burn.**
  - Ranking and darkness come from a stated Gaussian-spot model with ideal M4 motion.
  - The thermal threshold of isolated dots, char and heat build-up are not modelled. They could
    favour clustered patterns such as Jarvis on some materials.
- **Original papers.**
  - Floyd & Steinberg 1976, Stucki 1981 and Bayer 1973 were not fetched. The pinned DHALF.TXT is
    the source used.
  - Jarvis–Judice–Ninke and Ostromoukhov were checked by DOI metadata (Crossref); the table was
    checked against the paper extraction.
  - Zhou & Fang is closed access.
- **Archives.** web.archive.org could not be reached from this environment. The tannerhelland
  (https://tannerhelland.com/2012/12/28/dithering-eleven-algorithms-source-code.html) and
  LightBurn 2.0 pages are live URLs fetched 2026-10-28, with no archive link.
- **Not measured here.**
  - Rotated images, angled scans, and multi-angle passes laid over each other (Q2).
  - The streamed path above 4 M px (memory). It is covered only by the existing streamed = full
    test.
  - Halftone or line-screen output passed through a later area resample and re-dither, when the
    source is denser than the burn grid.
  - LightBurn's own kernels and its edge and mask behaviour.

```json
[
  {"id":"Q3-P2-1","severity":"P2","area":"dither-algorithms","file":"src/core/image-adjust/halftone.ts","line":70,"anchor":"Twin: same screen at 15/45 deg tracks tone within 0.9%, dot screen default 45 deg within 0.25%; code comment halftone.ts:63-65 'tracks it exactly'; Ground truth: AM line screen width proportional to ink, LightBurn 2.0 Newsprint 'spots that are larger in darker areas'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Image Studio Line Screen (Newsprint) at its default 0 deg (8 px) admits only 1/3/5/7 rows per pitch: 5 tones (0, 12.5, 37.5, 62.5, 87.5%), MAE 0.062, max 0.125 (0.25 at 4 px), solid black 87.5% with a white row each pitch; dot Halftone at 0/90 deg max 0.084, non-monotone; refuter: reproduced through runAdjustment and commitAdjustment with dialog defaults; half-pixel sampling alone still gives 5 levels (even widths), pitch+1 levels need a ranked spot function"},
  {"id":"Q3-P3-1","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither-blue-noise.ts","line":120,"anchor":"Contract: ADR-480 Decision 9 as amended by Amd 1 'the area outside it never burns'; Amd 1 Context 'those pixels never burn'; Twin: all nine fixed-kernel modes burn 0 masked pixels","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Blue Noise's level-dependent weights can sum to >1 at tone boundaries (0.538+0.278+0.231 at a 245/255 edge), so 1-7 dots land in the first cell outside an owned circular clip at luma 230-253 (max 0.119 mm), and 1-6 holes appear in pure black next to dark grey; other modes 0"},
  {"id":"Q3-P3-2","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither.ts","line":238,"anchor":"Ground truth: intended coverage 1-L/255; the published filters also start from zero error (improvement over reference)","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: rolling-v2 20 Verified clean noted the L254 start-up transient as ordinary","summary":"Error diffusion starts from zero error, so light (dark) areas lose dots (holes) along the first-scanned edges (image bottom/sides on front-left machines) and at white->light boundaries: first dot at row 15/25 for Jarvis at L247/L250 (Blue Noise 6/10); eye-band at L239 63% lighter for Jarvis, 13% FS, 8% Blue Noise; disc boundary ring 0.68 of interior at L230 for Jarvis/Sierra-3"},
  {"id":"Q3-P3-3","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither.ts","line":411,"anchor":"Ground truth: DHALF.TXT L547-548 '8x8 pattern' needed for 256 levels (cyotek/Dithering@dcb40707)","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: rolling-v2 20 Verified clean 'Ordered has 17 levels'","summary":"Ordered uses a 4x4 Bayer matrix: 17 coverages for 256 levels, max tone error 0.031 (L8, L247), MAE 0.016, 16 visible 1.6 mm bands on a 25.6 mm ramp; gradient SSIM 0.911 vs FS 0.923"},
  {"id":"Q3-P3-4","severity":"P3","area":"dither-algorithms","file":"src/ui/raster/photo-engraving-settings.ts","line":7,"anchor":"Contract: ADR-649 Decision 1 'ordered smoothest first' vs ADR-649 Verification table (low-frequency totals BN 0.82, FS 0.93, Stucki 1.59, Jarvis 2.15); ADR-581 Decision 2 Jarvis fallback","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"PHOTO_DITHERS lists blue-noise, jarvis, stucki, floyd-steinberg as 'smoothest first' and falls back to Jarvis, but FS is smoother than Stucki and Jarvis by ADR-649's own metric and this audit's (low share 0.009 vs 0.017/0.025, graininess 9.6 vs 11.2/11.0, face SSIM 0.959 vs 0.927/0.924); refuter: the Jarvis fallback itself is ADR-581 Decision 2 LightBurn-parity design, only the smoothest-first order/comment is the defect"},
  {"id":"Q3-K1","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither.ts","line":302,"anchor":"ADR-649 Verification 'Unit tests cover the published table'","evidence":"READ","verdict":"PLAUSIBLE","known":"rolling-v2 20-P3-3","summary":"Still no test pins the eight kernels or the Bayer matrix; this audit's bit-exact reference could be that test"},
  {"id":"Q3-K2","severity":"P3","area":"dither-algorithms","file":"src/ui/raster/processed-bitmap.ts","line":106,"anchor":"Twin: compile orients then dithers","evidence":"REPRO","verdict":"PLAUSIBLE","known":"rolling-v2 20-K-1 / Q1-P3-K4","summary":"Save Processed Bitmap dithers the image-oriented grid: 29-37% of face pixels differ (Ordered 56%), tone within 0.001"},
  {"id":"Q3-K3","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither.ts","line":251,"anchor":"ADR-390 Consequences","evidence":"REPRO","verdict":"CONFIRMED","known":"rolling-v2 20-K-4 / Q1-P3-K2","summary":"Coverage linear in sRGB bytes (1-L/255 within 0.003); not re-raised"},
  {"id":"Q3-K4","severity":"P3","area":"dither-algorithms","file":"src/ui/raster/AdjustImageDialog.preview.ts","line":65,"anchor":"ADR-581 Context; ADR-670 limits","evidence":"READ","verdict":"PLAUSIBLE","known":"rolling-v2 20-K-5","summary":"Adjust Image Processed pane dithers a <=420 px thumbnail without orientation, mask, sharpening or calibration"},
  {"id":"Q3-K5","severity":"P3","area":"dither-algorithms","file":"src/core/scene/scene-object.ts","line":336,"anchor":"LightBurn 2.0 Image Mode (10 modes)","evidence":"SOURCE","verdict":"CONFIRMED","known":"LIGHTBURN-STUDY G-01/G-02","summary":"No Newsprint, Halftone or Sketch image modes (only Image Studio filters on source pixels); KerfDesk adds Burkes, three Sierras and Blue Noise"},
  {"id":"Q3-K6","severity":"P3","area":"dither-algorithms","file":"src/core/raster/dither.ts","line":348,"anchor":"Atkinson definition; picker copy 'The darkest and lightest tones turn solid'","evidence":"REPRO","verdict":"CONFIRMED","known":"rolling-v2 20 Verified clean","summary":"Atkinson solid at L<=32 and blank at L>=224 (max tone error 0.1255), as designed and disclosed"}
]
```
