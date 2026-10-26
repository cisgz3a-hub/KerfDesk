## ADR-670 - Per-material tone calibration corrects photo engraving tones

Date: 2026-10-20
Status: Accepted

### Context

Dithered photo engraving (ADR-581) places dots in proportion to each tone, but
the burn is darker than the dot count suggests. A laser dot is wider than its
burn-grid cell (the 4040's 0.16 x 0.18 mm spot over the 0.1 mm default
interval, `src/core/devices/device-profile.ts`), neighbouring dots overlap and
saturate, and every material darkens in its own way. Grayscale has the same
problem through the material: power darkens it non-linearly. Portraits
therefore come out too dark and muddy, and the only remedy so far was guessing
brightness, contrast and gamma, values that do not carry from one material or
DPI to the next.

LightBurn has no built-in remedy. Its [Perfect Image Engraving
guide](https://docs.lightburnsoftware.com/latest/Guides/PerfectImageEngraving/)
recommends material and interval tests and then manual image adjustments.
Print workflows solve the same problem (dot gain) by printing a step wedge,
measuring it and applying the inverse transfer curve before screening.

### Decision

1. **Tools → Calibrate → Tone Calibration...** opens a two-step dialog. It is
   not behind the dirty-project question: its first step asks before Generate
   replaces the project, and its second step keeps the project.
2. **Burn the wedge.** Generate replaces the project (after the usual
   save question, as Material Test and Interval Test do) with a grey step wedge
   (6-21 patches, default 11, evenly spaced from blank to solid) and a 7-segment
   percentage label under each patch. All patches are one raster image on one
   Image operation. That operation is the selected photo's effective operation
   (object overrides included), or the Photo engraving window's unapplied draft
   when it was opened from there, with the dialog's dither, DPI, power, speed
   and material marking over it, Pass-through off and **no tone curve**, so the
   burn measures the raw response to those exact settings. The patch source
   pixels hold the inverse for light-marking material, so the ditherer sees the
   same burn luma either way. Patch luma is whole bytes; the record uses the
   rounded value as the commanded tone.
3. **Record the result.** The user compares each patch with on-screen greys and
   slides it to the grey it looks like: 0 is untouched material, 100 the solid
   patch (the end patches are fixed at those values by definition). The
   swatches follow the material's polarity. A small chart shows the recorded
   response against the diagonal. Saving names the material; the label also
   states the measured dither, DPI, power, speed and marking.
4. **Fit.** `fitPhotoToneCurve` (pure core, `src/core/raster/photo-tone-curve.ts`)
   pins 0 → 0 and 100 → 100, makes the recorded response non-decreasing by
   isotonic regression (pool-adjacent-violators), blends in 2% of the identity
   so equal greys (first-visible and saturated runs) still invert to a
   continuous, strictly rising curve, and inverts it. The result is a
   **monotonic luma in → luma out curve on the burn side** (after Negative:
   255 blank, 0 solid), stored as at most 64 piecewise-linear points with
   inputs strictly rising from 0 to 255 and outputs non-decreasing from 0 to
   255. Blank material therefore stays blank and solid stays solid.
5. **Apply in the shared path.** `prepareImageLuma` applies the curve (a
   256-entry table) after brightness, contrast, gamma and Negative, before
   resampling and dithering. Because the canvas processed bitmap, the Photo
   engraving worker preview (`compileRasterGroupsForLayer`), the one-shot and
   streamed compile paths all start from `prepareImageLuma`, they burn the same
   corrected tones. It applies to every dither including Grayscale. Pass-through
   pixels are never changed. Applying at source resolution, before the
   burn-grid resample, follows the existing tone order (`processed-bitmap.ts`);
   for texture finer than the burn grid the correction is therefore averaged
   after the curve rather than before, a second-order difference.
6. **Store with the operation.** `photoToneCurve` is a new optional operation
   setting (operation, sub-operation and artwork override; captured by
   operation-settings copies and process recipes). Absent, or the identity
   curve, compiles byte-identically to the output before this ADR. Operations
   compare equal curves by value. A project carries its own copy of each curve,
   so it burns the same on any computer. Project load refuses a curve that is
   not monotonic or not pinned at both ends instead of repairing it, because a
   repaired curve could burn blank backgrounds. An older build either refuses a
   photo override that holds it (scoped overrides reject unknown keys) or burns
   an operation's photos uncorrected; no project schema bump.
7. **Choose it per photo.** The Photo engraving window gains **Material tone
   calibration**: None, the calibrations saved on this computer
   (`localStorage`, newest first, 50 at most, a same-named one replaced) and the
   photo's own curve when it is not among them. Apply writes the curve into the
   photo's scoped operation override in the same single Undo step as ADR-581.
   Choosing None over an operation that carries a curve writes the identity
   curve, because an absent override key would inherit it. When the chosen
   calibration was measured with another dither, DPI, marking, power or speed,
   the window says so. **Calibrate a material…** closes the window and opens
   Tone Calibration seeded from its current settings.

### Verification and limits

Unit tests cover fitting (identity, dot gain inversion, non-monotonic and
flat records, random records stay valid), validation, identity and absent
curves returning the same luma, Negative, Pass-through, byte-identical compile
without a curve, one-shot and streamed rows matching a source pre-mapped
through the curve, override application, and project round-trip and refusal.
A perceptual fixture follows the user's workflow in simulation: it burns the
generated wedge with a dot-gain model (1.7-cell spots that saturate on
overlap), records it, fits the curve and burns the NASA portrait. Mean 1 mm
block darkness error falls from 0.164 to 0.017 for Jarvis, 0.181 to 0.017 for
Stucki, and 0.213 to 0.006 for Grayscale on a fast-darkening material model.
An end-to-end test generates, records and applies a calibration in the browser.

These are code and simulation results. No wedge or portrait has been burned,
no controller was operated, and real materials may respond differently from
the model (char, colour shift, heat build-up across a large image). Frame,
Start, power, speed, output policy and licences are unchanged. A Material
Library recipe (`MaterialRecipe`) does not hold a tone curve yet; the saved
calibrations list is per computer. The older Adjust Image thumbnail (which
ADR-581 already describes as unrepresentative) does not show a calibration;
the canvas, Photo engraving preview, Preview and G-code do.
