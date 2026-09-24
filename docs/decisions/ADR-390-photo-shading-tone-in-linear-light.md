## ADR-390 - Photo shading sets line coverage in linear light (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

Photo shading (ADR-349) draws one filled vertical ribbon per band and varies its width so that the
covered share of each cell carries the tone; since the tracer upgrades' Batch 5 the widths sit at
cell centres (`photo-ribbons.ts`), keeping the exact filled-area integral. The 2026-09-24 tracer
audit (Finding 8, and finding 14 of its settings audit) measured three problems:

- **Midtones engraved too light.** `photo-trace.ts` took darkness from the stored sRGB bytes
  (`1 − value/255`, with Rec. 709 weights on the encoded channels), so coverage was exactly
  `1 − grey/255`. Measured over whole ribbon columns on the audit's 11-step grey ramp at the
  default settings, sRGB 128 got 49.8% coverage (the audit's windows read 51%) where 78.4% is
  needed.
- **Invert was unreachable.** The backend applied `invert`, but no control or option merge set it.
  Gamma was unreachable too until Batch 5 exposed it as **Midtones**, with 1 keeping the bytes'
  tone.
- **Detail was dead on small sources.** Detail 0 to 100 mapped to a fixed 48 to 320 bands, capped
  by the image's pixels. On a 200 px source, Detail 56 to 100 gave byte-identical output: 57
  distinct results from 101 slider positions (20 on a 100 px source, 1 on a 48 px source).

The sources the fix rests on:

- By the Murray–Davies relation, the reflectance of a halftone is linear in its inked area:
  `R = (1 − A)·R_p + A·R_s`, with `A` the covered fraction, `R_p` the bare surface and `R_s` the
  solid mark (J. Seymour, "Revising our thinking on tone value increase", Advances in Printing and
  Media Technology 48, 2022, https://jpmtr.org/Advances_48_2022_18.pdf; original: A. Murray,
  J. Franklin Inst. 221(6):721–744, 1936, doi:10.1016/S0016-0032(36)90524-0).
- Image bytes are sRGB-encoded. The sRGB transfer function (IEC 61966-2-1, as published in CSS
  Color 4, https://www.w3.org/TR/css-color-4/#predefined-sRGB) decodes a channel `c` as `c/12.92`
  up to 0.04045 and `((c + 0.055)/1.055)^2.4` above. sRGB 128 is 21.6% of white in linear light.
  Luminance `Y` is a weighted sum of the linear channels: the Y row of the specification's
  `lin_sRGB_to_XYZ` matrix (87098/409605, 175762/245763, 12673/175545;
  https://github.com/w3c/csswg-drafts/blob/main/css-color-4/conversions.js) rounds to the Rec. 709
  weights 0.2126, 0.7152 and 0.0722 that the code already used.
- Derived here, not quoted (no primary statement of halftoning in linear light was verified): to
  make the engraving's reflectance run from the bare surface at image white to a full mark at
  image black, in proportion to the image's relative luminance `Y`, set
  `R_s + (R_p − R_s)·Y` equal to the Murray–Davies reflectance. Solving gives `A = 1 − Y`, whatever
  the two reflectances are. sRGB 128 needs 78.4% coverage; 49.8% reflects like sRGB 188.
- LightBurn corrects for beam width separately: "Dot Width Correction compensates for the thickness
  of the laser's beam by shortening the length of engraved scan lines"
  (https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/).

### Decision

1. **Coverage is one minus linear luminance.** A new `photo-tone.ts` builds the 256-entry tone
   table once per trace: Brightness, Contrast and gamma run in the existing byte maths
   (`raster-prep.ts`), then each value is decoded with the exact piecewise sRGB function. Sampling
   weights the three linear channel darknesses by Rec. 709 and area-averages them per cell, as
   before, and the cell-centred reconstruction keeps each run's exact area. Transparency composites
   onto white in linear light, where alpha is covered area: darkness is `alpha·(1 − Y)`. Black at
   50% alpha keeps 50.2% coverage.
2. **Midtones (the engine's gamma) is a correction on top of linear light, 1 neutral.** It keeps
   the engine's meaning and range (`out = in^(1/gamma)` on bytes, 0.1 to 5, above 1 lightens
   midtones), matching Adjust Image's Gamma. At 1 each shade already gets the coverage `1 − Y`, so
   the control is there for material response, which no model here predicts. The scale moves:
   Midtones 2.2 now stays within 1.13 percentage points of the previous byte-proportional
   coverage at every 8-bit value, and the new default is close to the previous Midtones 0.5
   (sRGB 128: 74.9% there, 78.4% now). Trace settings live only in the open dialog, so no saved
   project carries an old value.
3. **Invert swaps light and dark in linear light.** With Invert on, coverage is `Y`: the lines
   follow the photo's luminance, which is the coverage a material that marks lighter than its
   surface needs (the derivation above with the mark and the surface swapped), and it turns light
   artwork on a dark background into lines on the artwork. Inverting the bytes first would give a
   deep shadow (sRGB 64) 48% coverage instead of 5%. Brightness, Contrast and Midtones still act
   on the photo before the swap, so their hints describe the photo in both states.
4. **Controls.** Refine photo keeps Midtones, now hinted "At 1, line coverage matches the photo’s
   midtones…", and gains Invert, stored as `photoInvert`. Both merge only into Photo shading, so
   line presets never see them; they persist across preset switches like the other photo
   overrides, and Reset returns them to the preset (`gamma: 1`, `invert: false`, now explicit in
   the preset). A cleared Midtones field returns to 1 rather than clamping 0 to its darkest
   setting.
5. **Detail spans what the image can hold.** The band scale is multiplied by
   `min(320, longest side)/320`. Sources of 320 px or more keep 48 to 320 bands exactly, because the
   factor is then exactly 1. Smaller sources run from 15% of their pixels at Detail 0 to one band
   per pixel at 100, so the top of the slider is no longer dead: on a 200 px source every one of
   the 101 positions gives a different result.
6. **Straight-edge merging bounds the turn, not the raw cross product.** Linear-light darkness is
   irrational, so equal shades in differently aligned cells differ in their last bits, and along a
   long ribbon edge that alone exceeded the old absolute bound of 1e-12 (uniform grey gained stray
   vertices). The bound in `photo-ribbons.ts` is now a sine of 1e-12, relative to both segment
   lengths, for both the cell-centred and the fallback reconstruction.
7. **No laser spot allowance in the trace.** The trace works in image pixels and has no physical
   scale: `TraceOptions` carries none, and the ribbons are placed over the source's bounds at
   commit and can be resized afterwards, which would invalidate an allowance baked into their
   widths. The follow-up belongs where the scan lines are known:
   - Raster scan output already goes through its Image operation, whose Dot Width Correction
     shortens burn runs (`raster-output/raster-power-runs.ts`).
   - Vector Fill has no equivalent; `dotWidthCorrectionMm` is applied only to raster groups
     (`job/compile-job-raster.ts`). The follow-up there is to shorten fill scan segments the way
     that correction shortens burn runs.
   - Either value has to come from a material test card. None has been run, and nothing here
     claims a burn result.

### Consequences

Measured against the integration base 85ee406, which includes Batch 5's cell-centred ribbons and
Midtones.

- Grey ramp, default settings, percent coverage (measured on the audit ramp over whole ribbon
  columns inside each step):

  | sRGB grey | Before | Before looks like | After | Needed (`1 − Y`) |
  |---|---|---|---|---|
  | 0 | 100.0 | 0 | 100.0 | 100.0 |
  | 25 | 90.2 | 88 | 99.0 | 99.0 |
  | 51 | 80.0 | 124 | 96.7 | 96.7 |
  | 76 | 70.2 | 148 | 92.8 | 92.8 |
  | 102 | 60.0 | 170 | 86.7 | 86.7 |
  | 128 | 49.8 | 188 | 78.4 | 78.4 |
  | 153 | 40.0 | 203 | 68.1 | 68.1 |
  | 178 | 30.2 | 218 | 55.5 | 55.5 |
  | 204 | 20.0 | 231 | 39.6 | 39.6 |
  | 229 | 10.2 | 243 | 21.6 | 21.6 |
  | 255 | 0.0 | 255 | 0.0 | 0.0 |

  "Looks like" is the sRGB grey whose linear light equals the uncovered share. With Invert on, the
  same ramp gets coverage `Y` (sRGB 128: 21.6%); before, the dialog could not set Invert.
- Photos carry more ink. The 512 px astronaut portrait fixture goes from 55.8% to 73.0% mean
  coverage and the 1254 px dragon drawing from 18.1% to 23.6%, so vector Fill burns
  proportionally more scan length. Ribbon counts are unchanged at Detail 60 and 100 (dragon 233
  and 998, portrait 211 and 350); vertex counts move by at most 77 of 163,027. Trace time shows
  no consistent change (medians of 25 interleaved runs on a shared machine at load 6 to 7: dragon
  69.9 → 57.2 ms and 109.3 → 115.2 ms, portrait 23.9 → 24.6 ms and 29.6 → 27.6 ms).
- On the portrait's 81 face cells used by `e2e/photo-shading.e2e.ts` (16 × 16 px each, measured
  on the exact ribbon geometry), the mean gap between uncovered area and linear luminance drops
  from 0.205 to 0.014.
  The end-to-end test compared uncovered area with encoded luma instead, which the old output
  matched (0.012) and the new output does not (0.201); it now compares with linear luminance.
- The full-portrait Raster scan (640 × 640 px) now averages grey 68.8, within 0.007 of the
  source's linear-light luminance; it averaged 112.7, the byte-space luma, before.
  `photo-raster-full.integration.test.ts` compared with byte luma and now compares with linear
  luminance. The Raster scan end-to-end thresholds still hold when replayed in node: pixels with a
  partial value go from 52% to 49% (Detail 60) and 85% to 84% (Detail 100) on the full portrait,
  and 95% to 83% on `photo-shading.e2e.ts`'s crop, against a floor of 15%; all 256 values stay
  present.
- Detail on small sources: distinct outputs over the 101 slider positions go from 57 to 101
  (200 px), 20 to 92 (100 px) and 1 to 63 (48 px); adjacent positions can still coincide where the
  image holds fewer lines than the slider has steps. Sources of 320 px or more keep their line
  counts. What got coarser: the default on sources under 320 px now takes the same 66% of the
  image's capacity as on large ones, where it used to take 211 lines or every pixel column. A
  200 px source goes from 200 to 132 lines at Detail 60, and the end-to-end test's 230 × 256 px
  crop from 190 to 152. Detail 100 gives one line per pixel.
- The Raster scan output stores the ribbons' coverage as grey (`255 × (1 − coverage)`) for its
  Image operation to dither, so the committed image now looks darker than the source photo on the
  canvas (sRGB 128 becomes grey 55; the portrait crop's mean grey goes from 132 to 85). That grey
  is burn density, not the photo's appearance.
- Not checked: how the dialog's Trace preview shows tone where lines are narrower than a screen
  pixel. That depends on how the browser blends anti-aliased edges.
- Out of scope: Image mode's dither modes set dot coverage from the stored bytes directly
  (`core/raster/dither.ts`), which gives the same byte-proportional coverage this decision removes
  from Photo shading. By the same derivation its Gamma near 0.45 would approximate linear light;
  that is not measured and not changed here.
- The model assumes each line marks exactly its drawn width. A spot wider than the line adds the
  same width to every line, which matters most in highlights where lines are narrowest. No test
  card has measured it; Midtones is the operator's correction until one sets a spot allowance.
- `photo-tone.test.ts` pins the sRGB decode, the tone table and the ramp through the preset;
  `photo-trace.test.ts` pins linear-light coverage, alpha, colour weighting and both Detail
  mappings; `photo-local-detail.test.ts` and `photo-raster-full.integration.test.ts` now expect
  linear-light tone; the Photo control and merge tests pin Midtones, Invert, Reset and preset
  switching.
