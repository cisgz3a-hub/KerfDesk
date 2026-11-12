# O6 `image-maths-truth` — Oracle audit O1, batch 2

**Area:** `src/core/raster/` image maths (dither kernels, streamed rows, blue noise, luma adjust, resample, sharpen, Photo tone curve, Auto tones, slice-3d, stamp distance, fill ramp, power mapping), `src/core/image-adjust/` (levels, curves, tone LUTs, histogram, box/Gaussian/median blur, unsharp mask, high pass, halftone, remove white background) and `src/core/image-edit/` (brush, stroke, transform blit, history, tiles). Raster emission (rows, overscan, scan offset) was left out, as the brief asked.
**Read at:** `origin/main` 5c9441ba8 (2026-11-12). Method, severity and rules: [AREAS.md](AREAS.md).
**Fix PRs:**
- [#1785](https://github.com/cisgz3a-hub/KerfDesk/pull/1785): O6-P2-1, ADR-671 Amendment 1.
- [#1787](https://github.com/cisgz3a-hub/KerfDesk/pull/1787): O6-P3-1, O6-P3-2 and O6-P3-3; ADR-242 Amendment 2 and ADR-685 Amendment 2.

## Headline

The image maths match their published definitions. For the eight error-diffusion kernels, the auditor wrote reference code from the published weight tables, with a serpentine scan and a 128 threshold:

- Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra-3, Sierra-2, Sierra Lite and Atkinson all matched it **pixel for pixel**.
- The refuter repeated the check on its own inputs (widths 1 to 5,000, values that put the buffer exactly at 128) and also found no mismatch.
- The streamed row ditherer equals the full-image one in every mode, including blue noise and replayed access.
- Bayer equals its recursion, the stamp distance transform equals brute force to 1e-14, and area resampling keeps the mean.

The one real gap is a convention. KerfDesk's image **Gamma lightens the midtones as it rises**, as in Photoshop and GIMP. **LightBurn documents the opposite**, and ADR-242 promises LightBurn's Adjust Image semantics. Two of the three Gamma fields gave no hint, so a value copied from a LightBurn guide burned the wrong way without warning. That is **O6-P2-1**. #1785 states the direction on every Gamma field and leaves the convention, and every burned output, unchanged. Reversing the convention is listed for the maintainer.

| Raised | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 6 (1 auditor, 1 research, 4 refuter) | 1 | 1 (an oracle-plan claim, not code) | 0 | 1 | 3 |

## Oracle plan

This plan was written before the code was read closely, from the file list only. It is kept as written.

| # | Claim | Oracle |
|---|---|---|
| D1–D7 | Kernel weights: FS 7/3/5/1 over 16; JJN over 48; Stucki over 42; Burkes over 32; Sierra-3/-2/Lite; Atkinson 1/8 to six neighbours. Serpentine scan mirrors the kernel. | Floyd & Steinberg 1976; JJN 1976; Stucki 1981; Burkes 1988; Sierra 1989/90; Atkinson; Ulichney 1987 |
| D8 | Ordered = Bayer index matrix, threshold (I + ½)/n² | Bayer 1973 |
| D9 | Blue noise: void-and-cluster ranks used once; low low-frequency power | Ulichney 1993 |
| D10–D12 | Mean tone kept by error diffusion; no error wraps from a row end; identity inputs stay identity | properties |
| T1–T2 | Luma is Rec.601 or Rec.709, on encoded or linear values as stated; any linearisation uses IEC 61966-2-1 | ITU-R BT.601-7, BT.709-6, IEC 61966-2-1 |
| T3–T6 | Gamma, brightness, contrast, levels and curves: identity at defaults, monotone, direction as labelled | LightBurn docs, GIMP Levels/Curves docs |
| T7–T12 | Histogram sums; blur kernels sum to 1 with a stated sigma; unsharp mask and high pass formulas; halftone coverage equals tone; white removal only moves alpha | properties, GIMP and Photoshop docs |
| R1–R5 | Resampling keeps mean and physical size; pixel-centre convention; edges clamp | properties; Keys 1981 |
| P1–P5 | Grey to power is monotone, black is exactly max, white exactly min or off; the S scale is exact at 0 and 100%; stamp and fill ramps are monotone | properties; LightBurn Grayscale docs; GRBL |
| E1–E4 | Brush and blit composite with Porter–Duff over; identity and quarter-turn blits are exact; undo/redo restores bytes; tile edges lose nothing | Porter & Duff 1984; properties |

## Method as run

- **Auditor (this session).** A scratch Vitest probe ran on the real modules, about 450 lines. Its references were written from the published definitions, not from KerfDesk's code: eight kernel tables, the Bayer recursion, a brute-force exact Euclidean distance transform (EDT), an interval-overlap resampler, a Gwosdek variance check, a radial power spectrum and halftone coverage counts.
- **Refuter (fresh subagent).** It used a different generator (xorshift), its own references and adversarial inputs, and ran in 3 rounds. It deleted its probe afterwards.
- **Research verifier (fresh subagent, web).** It checked 18 outside facts against primary sources: ITU PDFs, ICC/W3C sRGB, GIMP/GEGL docs and source, the LightBurn 2.1 docs, Porter–Duff, Keys, Ulichney 1993, and Ostromoukhov's paper and C code. The owner fetched LightBurn's Shape Properties page again for the P2.
- **Owner re-check.** The session read O6-P2-1 in `src/core/raster/luma-adjust.ts`, `src/ui/raster/AdjustImageDialog.fields.tsx`, `src/ui/layers/SelectedImageAdjustments.tsx` and `src/ui/raster/PhotoEngravingFields.tsx` at 5c9441ba8.

## Findings

### O6-P2-1 — Image Gamma runs opposite to LightBurn, and two of three fields did not say so

**Where:**
- `src/core/raster/luma-adjust.ts` applies `level^(1/gamma)`, so a higher gamma gives a lighter image.
- `src/ui/raster/AdjustImageDialog.fields.tsx` (Adjust Image) and `src/ui/layers/SelectedImageAdjustments.tsx` (Shape properties) had no direction text; the tooltip read "Adjust image gamma."
- Only `src/ui/raster/PhotoEngravingFields.tsx` said "Higher gamma lightens midtones."

**Reproduction:** `lumaAdjustmentLut({ gamma: 2 })[128]` = 181 (lighter); `lumaAdjustmentLut({ gamma: 0.5 })[128]` < 128 (darker).

**Oracles:**
- LightBurn 2.1 [Shape Properties](https://docs.lightburnsoftware.com/2.1/Reference/ShapeProperties/), Image section: "Lower values lighten the mid-tones, and higher values darken them." **VERIFIED**, fetched twice.
- GIMP Levels computes `pow(value, 1.0/gamma)` (`app/operations/gimpoperationlevels.c`), the same direction as KerfDesk. **VERIFIED**.
- ADR-242 Consequences: "we keep LightBurn's UX shape (Adjust Image semantics …)".

**Severity: P2.** A vendor convention that the project's own ADR adopts is broken in a way an ordinary user hits. A user who copies a gamma from a LightBurn guide (for example 1.5, to darken the midtones) gets lighter midtones, and nothing in Adjust Image or Shape properties warns them. It is not P1: the in-app value does what the Photo engraving dialog says, and the preview shows the result before burning.

**Refuter:** CONFIRMED-CLEAN on the maths (3,000 random settings, all monotone, gamma > 1 never darkens). The direction is a convention, and the refuter did not dispute it.

**Fix (#1785, ADR-671 Amendment 1):**
- One shared sentence states the direction and says LightBurn's Gamma runs the other way. It appears in Adjust Image (a visible line and the tooltip), on the Shape properties tooltip and in the Photo engraving hint.
- The convention and every burned output are unchanged. Reversing the convention is listed for the maintainer.
- Two UI tests fail on `origin/main`; a core test pins the direction.

### O6-P3-1 — A fractional halftone pitch breaks Amendment 1's coverage promise

**Where:** `src/core/image-adjust/halftone.ts`. The pitch fields step by 1 px, but `DraftNumberInput` only clamps (`src/ui/image-editor/AdjustDialog.tsx`), so a typed decimal reaches the screen. The threshold array (ADR-242 Amendment 1) needs a whole-pixel pitch and is skipped otherwise.

**Reproduction:** flat patches holding whole screen periods, error = coverage − ink.

| Pitch | Line | Dots |
|---|---|---|
| 4.5 px, 0° | 11.0% | 8.7% |
| 8.5 px, 0° | 5.5–5.9% | 1.4–3.2% |
| 7.07 px, 45° | 7.7% | 7.6% |
| 8 px, 0° (integer) | 0.77% | 0.77% |

A 6.4 px line screen at 0° left solid black only 96.9% black.

**Oracle:** an AM screen's dot area or line width equals the ink fraction (a mathematical property). ADR-242 Amendment 1 also promises that coverage tracks tone to 1/s² and that solid black stays solid.

**Severity: P3.** Only a typed decimal in a field that steps by whole pixels reaches it. Q3-P2-1 was the same symptom at the default setting.

**Refuter:** CONFIRMED, and worse than the auditor's first numbers: the 45° case and the "black is not solid" case are the refuter's.

**Fix (#1787, ADR-242 Amendment 2):** the pitch rounds to whole pixels. A typed 4.5 now screens byte-identically to 5, and integer pitches are unchanged. Six tests fail on `origin/main`.

### O6-P3-2 — Auto tones could leave the darkest 0.5% grey

**Where:** `src/core/raster/portrait-auto-tones.ts`. Brightness and contrast were rounded to the nearest tenth. That could leave the 0.5% level up to about 0.26 levels above 0, and the midtone gamma (up to 5) then lifted it.

**Reproduction (refuter):**
- A two-blob portrait with lo 111 and median 147 gave tones (−18.4, 100, 2.29), so `lut[111]` = 10. Of 2,000 random two-blob histograms, 345 had a non-zero darkest level, and 109 of those were above 5.
- A backdrop of 6,000 px at level 113, plus 40 px at each level 114–212, gave tones (−19.2, 100, 5), so `lut[113]` = 51. The backdrop burned grey instead of solid.

**Oracle:** ADR-685 Decision 1, "the darkest and lightest 0.5% … become solid and blank". This is the code's own contract, tested as a property.

**Severity: P3.** It affects a suggestion button whose result the preview shows. Saved tones are unaffected.

**Fix (#1787, ADR-685 Amendment 2):** brightness rounds down and contrast rounds up, capped at 100, so the 0.5% level clamps solid. A sweep test over 393 two-tone histograms and the backdrop case both fail on `origin/main`.

**Not fixed, listed:** two cases the refuter found are limits of the design, not of rounding:
- When half or more of the pixels sit at the darkest level, the median is that level and goes solid with it.
- With a very narrow backdrop, the gamma clamp at 5 leaves the median up to 3 levels off.

### O6-P3-3 — NaN or contrast below −100 from a hand-edited project broke the tone curve

**Where:** `src/core/raster/luma-adjust.ts` `lumaAdjustmentLut`.

**Reproduction (refuter):**
- A NaN brightness, contrast or gamma produced an all-0 curve, so the whole image burned solid.
- `contrast: -150` produced a falling curve, which inverts the image.

The project validator only checks for a number, and JSON cannot carry NaN, so only a hand-edited file reaches either case.

**Oracle:** a tone curve must be monotone, and identity settings must give the identity (property).

**Severity: P3** (latent).

**Fix (#1787):** NaN means the default, and contrast stops at −100. Every value a control produces gives the same curve as before. The two tests are in a new file and fail on `origin/main`.

## Refuted

- **Quarter-turn blit of an odd × even region blurs** (refuter). It is real but correct geometry. `blitTransformedInPlace` rotates about the region's centre, which lies on a half pixel when width − height is odd, so a 90° turn cannot land on the pixel grid without a half-pixel shift. Even × even and odd × odd regions, and 180°, move pixels exactly. Image Studio's rotate is a free drag (`editor-transform.ts`) with no exact-90° command. Not a defect.

## Verified clean

Every row has a reproduction from both the auditor's probe and the refuter's.

| Claim | Evidence | Research |
|---|---|---|
| FS, JJN, Stucki, Burkes, Sierra-3, Sierra-2, Sierra Lite and Atkinson kernels; serpentine scan, mirrored on odd rows; quantize at 128; error dropped at image edges, never wrapped | 0 pixel mismatches against the paper references: 10 auditor images, 9 sizes from 1 × 1 to 5,000 × 3, and a 3 × 2 wrap check | FS weights corroborated by Ostromoukhov 2001 §1 and DHALF.TXT; JJN, Stucki, Burkes and Sierra match DHALF.TXT; Atkinson's ¾ error is relayed from Atkinson by Balestrieri 2003. The original papers are not online, so all are **UNSOURCED-primary** (values corroborated, not refuted) |
| Streamed rows (ADR-243) equal `dither()` in all 9 modes, in forward, reverse and random order | 2,448 row checks, 0 mismatches | — |
| Mean tone: a flat field burns (255 − g)/255 | Worst full kernel 0.27–0.6% (Jarvis); blue noise 0.13–0.3%. Atkinson 9.9–12.5%, which is expected because it passes on only ¾ of the error | — |
| Ordered = 4 × 4 Bayer, thresholds 16·I + 8, 17 levels; worst tone error 1/32, the least possible with 16 thresholds | 0 mismatches against the [[0,2],[3,1]] recursion at all 256 levels | Bayer 1973 not online (**UNSOURCED-primary**); Ulichney 1993 confirms recursive tessellation |
| Blue noise: weights sum to 1 at every level; serpentine; coefficients chosen by the **original** level; levels 128–255 mirror 255 − g; levels 0–48 equal Ostromoukhov's Appendix I | Weight sum error ≤ 2e-16; low-frequency power share on flat fields 0.3–3.6%, at or below Floyd–Steinberg's | **VERIFIED** against the paper (Appendix I, §2, assumption A4). Note: the author's own C code differs from the paper for levels 23–71. KerfDesk follows the paper it cites |
| Grayscale: black → exactly sMax, white → 0, monotone; with sMin, level 254 → about sMin; `sMax = round(power% × maxS)`; `rescaleRasterValues*` never exceeds the target and maps source max exactly | sMax 1, 20, 255, 1,000 and 65,535; targets 0.1–24,000; scale versions 1–3 | LightBurn: "using Min Power for the lightest shades and Max Power for the darkest". **VERIFIED**; see Not verified on pure white |
| Photo luma = BT.601 (0.299/0.587/0.114) on encoded sRGB bytes, the same in Image Studio and in compile; no other weights reach the engrave path | White 255, red 76, green 150, blue 29; `git grep` finds no Rec.709 weights in the engrave path | BT.601-7 §2.5.1 defines the weights on gamma pre-corrected signals: **VERIFIED** |
| Brightness, contrast and gamma curve; Levels; Curves (Fritsch–Carlson); legacy brightness/contrast: identity at defaults, monotone, pass through their control points | 3,000 random settings, 4,000 curve point sets (up to 64 points, duplicate x, jumps) | Levels γ > 1 lightens: **VERIFIED** (GIMP docs and source) |
| Extended-box Gaussian (Gwosdek 2011): variance of 3 passes = σ² | Error ≤ 3e-16 for σ 2–100; at most 2.4 levels from the exact kernel for σ 2–5 | GIMP Gaussian Size = σ: **VERIFIED** (GEGL) |
| Median is a true median with clamped edges | Radius 0–7 against a brute-force sort, 0 mismatches | — |
| Unsharp mask, Image Studio and burn grid: amount 0 = identity, flat stays flat; the burn-grid row source is byte-identical in any row order | σ 0.5–12, amount up to 500% | Radius = Gaussian σ (GEGL), Amount %, Threshold in levels (Adobe): **VERIFIED** |
| Area resample keeps the mean; nearest picks the pixel centre; burn grid keeps physical size (line interval = height mm / rows) | 10 shapes against an interval-overlap reference, 0 mismatches; mean drift ≤ 0.05 | — |
| 3D slices: darkness d burns on exactly round(N·d/255) of N passes | N = 1–600, every d | — |
| Stamp and Fill-ramp distance = exact distance from a pixel centre to the face cells, at anisotropic pitch | 200 random faces against brute force; relative error ≤ 7e-15 | — |
| Halftone, integer pitch: within 1/(2s²) on the axes and ≤ 0.55% at 45° | 600 px patches | — |
| Remove white background at threshold 0 composites back to the original | Error ≤ 0.49 levels (byte rounding) | — |
| Porter–Duff "over", straight alpha | `sourceOverPixelInPlace` follows the premultiplied form | Porter & Duff 1984 §4: **VERIFIED** |
| Undo/redo restores exact bytes across tile edges | 40 random edits, undo/redo sequences | — |
| Identity and 180° blits; quarter turns of even × even and odd × odd regions are exact | 4 × 4, 5 × 5, 3 × 3, 4 × 6 | — |

## Contradicted (research)

- **Oracle plan T10, "high pass = image − blur + 50% grey, as in GIMP".** GEGL's `high-pass` computes 0.5 + 0.5·(in − blur): half that amplitude, plus a contrast stage. KerfDesk's `high-pass.ts` makes no GIMP claim, and Adobe's filter reference gives no formula. The claim is dropped. The amplitude difference is listed for the maintainer.

## Not verified

- The original Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra, Atkinson and Bayer publications are not online. The kernel values rest on secondary sources that agree with each other (DHALF.TXT; Ostromoukhov 2001 for FS) and on the refuter's and auditor's matching references.
- Serpentine scanning credited to Ulichney's 1987 book: the book is not online. Ulichney 1993 cites his 1988 Proc. IEEE paper for it.
- LightBurn Grayscale and **pure white**: the 2.1 docs say lightest shades get Min Power, but not whether 255 is skipped. KerfDesk turns 255 off and burns 254 at about Min. Not compared with LightBurn's output.
- LightBurn Ordered matrix size: not documented.
- LightBurn 2.1 lists no "3D Sliced" image mode. ADR-699 and `slice-3d.ts` say "after LightBurn's 3D Sliced mode", which existed in earlier LightBurn releases. That was not checked against an old manual.
- Photoshop High Pass formula: Adobe documents none.

## For the maintainer (would change burned output; not made)

1. **Gamma direction.** Adopt LightBurn's (higher darkens) by migrating stored values `gamma → 1/gamma`. That needs a range decision, because 0.1 becomes 10, beyond the 0.1–5 control. Auto tones (ADR-685) would invert with it. #1785 keeps the current direction and says so in the UI.
2. **Dither in linear light.** Every mode dithers BT.601 luma of gamma-encoded bytes, so a 50% grey byte (128) burns about 50% of dots. That matches BT.601's definition and is the common practice. A linear-light option (IEC 61966-2-1 decode first) would burn midtones much lighter, and would change every photo.
3. **Ordered 8 × 8.** The 4 × 4 Bayer matrix gives 17 tone levels (worst error 1/32). An 8 × 8 matrix gives 65 levels. LightBurn's size is unknown.
4. **High-pass amplitude.** `128 + (in − blur)` has twice GIMP's amplitude. That is visible only in Image Studio before a threshold.
5. **Auto tones on degenerate histograms.** When at least half of the photo sits at its darkest level, that level goes solid; a very narrow backdrop hits the gamma clamp at 5 (median up to 3 levels off). See O6-P3-2.

## Scratch artefacts

The auditor's probe, `src/core/raster/zz-oracle-o6-probe.test.ts`, was never committed, and its JSON output stays in the session's scratch directory. The refuter's probe was deleted. The research verifier's downloaded sources are in the session scratch directory, outside the repo.
