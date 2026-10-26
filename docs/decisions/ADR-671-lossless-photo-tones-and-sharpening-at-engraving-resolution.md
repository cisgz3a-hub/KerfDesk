## ADR-671 - Photo tones round once, and a photo can sharpen at engraving resolution

**Status:** Accepted; code, unit, compile and perceptual evidence only. No material was engraved and no controller was operated. | **Date:** 2026-10-20

### Context

ADR-581 added the Photo engraving dialog over the shared raster pipeline. Two parts of that
pipeline cost portrait detail.

**Tones rounded three times.** `applyLumaAdjustments` applied brightness, contrast and gamma as
three separate 8-bit passes, each rounding to a byte before the next. Every rounding can merge
neighbouring grey levels, and a later stage with a gain (contrast above 0, or gamma near black)
spreads the merged levels into visible steps. Smooth skin gradients then band. With the
portrait curve brightness 10, contrast 25, gamma 1.2, only 196 of the 256 possible output
levels survived. Near black under strong gamma the error was large: brightness -50, contrast
25, gamma 5 turned level 153 into 84 instead of 0, because the contrast stage rounded -0.125
up to 1 before gamma amplified it.

**Area resampling softens the finest detail again.** Image Studio's Unsharp Mask (ADR-242)
works on source pixels. Raster output then reduces the source to the burn grid with the exact
area mean of each cell (ADR-359). That box filter keeps tone faithful but attenuates detail
near the grid's limit, the scale of eyes, lashes and hair. Sharpening the source cannot
pre-compensate reliably, because its effect depends on the later placement and DPI.

LightBurn's [Shape Properties](https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/)
offers per-image "Enhance" (also called unsharp masking) with an amount and a radius, next to
gamma, brightness and contrast. Its documentation does not state the radius unit or where the
filter runs. Its values are not copied numerically here.

### Decision

1. **One tone curve, one rounding.** `lumaAdjustmentLut` composes brightness, contrast and gamma
   into one 256-entry curve. The order (brightness, then contrast, then gamma), each stage's
   clamp to 0..255, the gamma clamp to 0.1..5 and the `1/gamma` convention are unchanged. The
   value stays a float until a single final rounding. `applyLumaAdjustments` keeps its
   fast path: neutral tones return the input buffer itself. Every consumer of the shared
   function moves together: compile (materialized, streamed, rotated), the Photo engraving
   preview, Save processed bitmap, the Adjust Image preview and the canvas's adjusted-tone
   display. Trace keeps its own staged tone maths (`core/trace/raster-prep.ts`); this decision
   does not change tracing.
2. **Sharpen at engraving resolution.** A photo gains two optional fields, `sharpenAmount`
   (percent of the difference added back, 0..500, 0 is off) and `sharpenRadius` (the Gaussian
   sigma in burn cells, 0.5..3, default 1). Absent or 0 is off and compiles byte-identically. A
   project that stores them validates them as finite numbers; compile clamps them into range.
   The filter is `out = v + amount * (v - gaussian(v))`, separable, with clamped edges and one
   rounding. These are the same amount and radius conventions as Image Studio's Unsharp Mask.
   It runs after resampling and before the mask, orientation and dithering, in the shared
   compile path:
   - **Upright images scanned along X:** on the burn grid itself. The streamed compile runs the
     same row function over a window of blurred rows, so it holds O(width) memory and is
     byte-identical to the materialized compile in either row direction.
   - **Rotated images and angled scans:** on the source-aligned sample grid, before the
     bilinear or centre sampler reads it. On a reduced grid one sample pixel is about one burn
     cell; on an unreduced source the radius is converted so it stays the same size in
     millimetres (capped at sigma 12 sample pixels, so the work stays bounded). A quarter turn of a reduced source
     therefore sharpens exactly the cells the upright path would.
   - **Masks:** sharpening comes first, so a mask edge never gains a dark rim. A sharpened
     rotated raster then masks its sample grid. An unsharpened one keeps masking at source
     resolution as before.
   - **Pass-through** burns source pixels untouched and is never sharpened.
   - **Order with tone calibration (ADR-670):** tones, Negative and the material tone curve
     run at source resolution in `prepareImageLuma`, then the burn-grid resample and this
     sharpen. Sharpening therefore acts on calibrated luma, as area resampling already does. For
     a smooth monotonic curve the difference from sharpening before it is second order. With
     sharpening off, ADR-670 output is unchanged.
3. **Every view agrees.** The canvas raster preview, the Photo engraving preview and G-code
   all come from the same compiled groups. The canvas preview's cache key includes both
   sharpening fields, so changing only sharpening rebuilds it. Save processed bitmap applies the same filter, scaling
   the radius when its preview is capped. The design canvas's adjusted-tone display remains a
   source-resolution tone view and does not show burn-grid sharpening. Image Studio's kerf
   Thicken repair no longer treats a sharpened photo as burning its pixels as they are.
4. **Photo engraving dialog.** A "Sharpen at engraving resolution" section offers Sharpen amount
   (%) and Sharpen radius (lines), showing the radius in millimetres at the chosen DPI. Apply
   writes both fields to the selected photo in the same single Undo step as its tones. An amount
   of 0 removes both fields. A patch without sharpening keeps the photo's existing values.

### Measured change for existing projects (tones)

Only projects with **two or more** tone controls off their defaults change. With a single
control there was only one rounding before as well, and the bytes are identical (tested for
every grid setting).

Over a grid of 1,858 tone settings: 20.5% of curve entries move. 92.6% of moved entries move by
1 level and 98.2% by at most 2. The largest moves (up to 84 levels) occur only with strong gamma
near black, where the old result was the rounding artefact described above. The new curve is
within half a level of the exact float curve everywhere. The former one strayed by more than 20
levels.

On the 512 x 512 astronaut portrait (`src/__fixtures__/perceptual`), burned 1:1 at 4 lines/mm
with Jarvis and scored on 4 mm cells of the emitted G-code:

| Tones (brightness, contrast, gamma) | Pixels changed | Mean / max change (levels) | Distinct levels, before -> after | Dots changed | Engraved density change, mean / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10, 25, 1.2 | 65% | 0.90 / 3 | 196 -> 205 | 20% | 0.48% / 3.5% |
| 5, 10, 1.1 | 28% | 0.28 / 1 | 223 -> 232 | 25% | 0.40% / 2.3% |
| -10, 25, 0.8 | 53% | 0.56 / 2 | 192 -> 198 | 24% | 0.37% / 3.1% |
| 0, 40, 1.5 | 17% | 0.17 / 1 | 165 -> 183 | 19% | 0.33% / 2.7% |
| 10, 0, 1.2 | 53% | 0.53 / 1 | 213 -> 213 | 29% | 0.48% / 2.7% |
| -30, 60, 2.5 | 35% | 0.51 / 12 | 116 -> 123 | 18% | 0.32% / 2.7% |

Error diffusion re-routes every later dot once any input moves, which is why many dots change
while the engraved density barely does. The only fixture this deliberately updates is
`luma-adjust.test.ts`. Its brightness 10, contrast 50, gamma 2 sample moves level 64 from
135 to 134 (exact value 133.84).

### Measured effect of sharpening (astronaut face)

The face crop (hair, eyes, smile; 160 x 160 source px) was compiled with Grayscale output so
the burn-grid tone can be read back from S. It was compared with an independent Lanczos-3
reduction of the same face, a sharper resampling filter, on the mid-band detail (Gaussian sigma
0.8 minus sigma 2 cells):

| Reduction | Area resampling, detail vs reference | 30% at 0.7 lines | 50% at 1 line | 80% at 1 line |
| --- | ---: | ---: | ---: | ---: |
| 2:1 | 97.5% | 102% | 111% | 119% |
| 4:1 | 96.8% | 102% | 112% | 120% |
| 8:1 | 95.7% | 101% | 111% | 119% |

Area resampling gives up only a few percent of the reference's detail. A light sharpen restores
it and lowers the cell-by-cell detail error against the reference (2:1: 0.43 -> 0.38; 4:1:
0.73 -> 0.55; 8:1: 1.12 -> 0.79 levels). Stronger settings go beyond the reference. That is
deliberate output sharpening, as in print workflows, and it also amplifies grain in skin. The
dialog therefore suggests about 30% at 0.7 lines and leaves sharpening off by default. At 30% the mean
tone moves by under 0.1 level. With Jarvis the coarse engraved density error stays
within half a percent of full density of the unsharpened burn.

### Verification and limits

- `luma-adjust.test.ts`: single-rounding precision against the exact curve, byte-identity for
  single-control tones, kept grey levels, monotonic curves, the identity fast path.
- `luma-sharpen.test.ts`: off cases, ranges, flat fields, edge overshoot and clamping, and
  streamed rows equal to the materialized pass in forward, reverse and shuffled order.
- `compile-job-raster-sharpen.test.ts`: through `compileRasterGroupsForLayer`, the streamed
  compile equals the materialized one with sharpening on for upright, flipped-origin, mirrored,
  masked, ordered, rotated 30 degrees, quarter-turn, rotated-and-masked, 45-degree-scan and
  upscaled photos. Off is byte-identical whatever radius is stored, Pass-through is untouched,
  and masking follows sharpening.
- `raster-photo-sharpen.test.ts`: the perceptual checks above on the astronaut fixture.
- `photo-engraving-sharpen.test.ts` and `e2e/photo-engraving-numbers.e2e.ts`: dialog draft,
  Apply, Undo, validation, project round trip.

Raster budgets are unchanged. The materialized compile holds one more burn-grid luma buffer
(1 byte per cell) while sharpening, and the streamed one a window of up to 20 blurred rows.
Sharpening is a per-photo engrave adjustment like its tones. It is not a Frame, Start, power,
speed, licence or output-policy change. Physical qualification on material is separate.
