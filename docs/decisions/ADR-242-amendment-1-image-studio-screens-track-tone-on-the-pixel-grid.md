## ADR-242 Amendment 1 - Image Studio's screens track tone on the pixel grid (2026-10-28)

**Status:** Accepted. Amends ADR-242 Decision 7 (the IE-2 Halftone and Newsprint filters). Fixes
quality audit Q3 finding Q3-P2-1 (P2). Compile, Frame, Start, output policy and licences are
unchanged. | **Date:** 2026-10-28

### Context

Image Studio's Filter menu has Halftone (Dots) and Line Screen (Newsprint)
(`src/core/image-adjust/halftone.ts`). Each pixel is rotated into screen space and inked when it lies
inside a spot whose area matches the local ink, 1 − luma/255. In continuous space that area is
exact. Off the pixel axes the pixels sample every part of the cell, and coverage stays within about
1% of ink.

At 0° and 90° the pixels tie. Line Screen's default is 8 px at 0°: every pixel in a row shares one
distance from the line centre, and rows sit in mirrored pairs. So the line could only be 1, 3, 5 or
7 rows thick. Its strict `<` test never inked the row opposite the centre, so solid black kept a
white row every pitch. The dot screen tied in rings of four or eight pixels. Measured on 128 px flat
patches at every level 0–255 (error = coverage − ink):

| Screen | Before: tones, max error, black | After: tones, max error, black |
|---|---|---|
| Line 4 px, 0° | 3, 25%, 75% | 17, 3.1%, 100% |
| Line 8 px, 0° (default) | 5, 12.5%, 87.5% | 65, 0.78%, 100% |
| Line 8 px, 90° | 6, 12.4%, 92.4% | 65, 0.78%, 100% |
| Line 16 px, 0° | 9, 6.25%, 93.75% | 256, 0.19%, 100% |
| Dots 4 px, 0° and 90° | 8, 16.6%, 1 reversal | 17, 3.1%, monotone |
| Dots 8 px, 0° and 90° | 18, 8.4%, 1 reversal | 65, 0.78%, monotone |
| Dots 16 px, 0° and 90° | 44, 3.6%, 1 reversal | 256, 0.19%, monotone |

The refuter of Q3 measured that sampling at pixel centres alone still gives 5 tones, because the
rows still tie in pairs. LightBurn has no line screen to copy. Its 2.0 Image Mode page describes
Newsprint as a grid of spots that grow larger in darker areas, and names no tone limit.

### Decision

1. **A screen along the pixel grid is a ranked threshold array.** At 0° or 90° with a whole-pixel
   pitch s, every cell holds the same s × s pixels. The screen ranks them by the same spot geometry:
   - a line inks outward from its centre row;
   - a dot inks its 50% circle from the centre out, then the rest of the cell, farthest from a hole
     first, as the shadow holes shrink.

   Pixels that tie are taken in the order of the R2 low-discrepancy sequence. A partly filled row
   is then an evenly dotted edge, not a segment growing from one end. Pixel k of the ranking gets
   the threshold (k + ½)/s² and inks when that is below ink. Coverage is ink to the nearest 1/s²:
   s² + 1 tones, in order, with solid black solid and white blank.
2. **Every other screen keeps the per-pixel spot test.** This covers any angle off the axes, and
   a fractional pitch from code (the dialog offers whole pixels only). At 15° and 45° the output is
   unchanged.
3. **Line Screen keeps its 0° default.** At 0° it is now the most exact setting.

### Consequences

- Only Image Studio's baked pixels change. Compile, Preview and the emitter are untouched, so
  `EMITTER_REVISION` does not move for this amendment. A photo screened earlier keeps its pixels.
- At 0° and 90° the screen is a fixed tile, so building it costs s² spot evaluations and a sort
  (4,096 at the 64 px maximum) instead of a rotation per pixel.
- Tests, in `halftone.test.ts`:
  - Both shapes at 4, 8 and 16 px, at 0°, 15°, 45° and 90°, hold coverage within 1/(2s²) of ink on
    the axes (every level, whole cells) and within 1.2% off them (every fifth level, 128 px).
  - Solid black is solid and white stays white.
  - The axis screens draw s² + 1 tones in order.
  - A 0° line takes ink on a row only once every row nearer its centre is solid.
  - `editor-adjustments.test.ts` runs both filters at the dialog defaults.
  - On the old code, all twelve axis cases fail and the off-axis cases pass.
- These are code and test results. No image was burned and no controller was operated.
