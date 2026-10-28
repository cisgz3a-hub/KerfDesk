## ADR-649 Amendment 1 - Blue Noise keeps pure white blank and pure black solid; the photo list follows the measured order (2026-10-28)

**Status:** Accepted. Amends ADR-649 Decisions 1 and 2. Fixes quality audit Q3 findings Q3-P3-1
and Q3-P3-4 (P3). ADR-581's Jarvis fallback, Frame, Start, output policy and licences are
unchanged. | **Date:** 2026-10-28

### Context

**Dots outside a mask (Q3-P3-1).** Blue Noise spreads each pixel's error by weights chosen by that
pixel's own level (Decision 2). Inside one flat tone, the weights arriving at a pixel sum to 1. At
a tone edge they need not. For example, a white pixel can collect 7/13 from the pixel behind it,
5/18 from above and 3/13 from above-ahead: 1.047 of a neighbour's error in all. Error from light
grey can then take a white pixel below the threshold, and it burns.

Compile whitens the pixels outside a mask or an owned clip just before the dither
(`compile-job-raster.ts`, ADR-480). ADR-480 says that area never burns. The audit found:
- through `emitGcode`, with a circular owned clip on flat grey at luma 230–253, 1 to 7 lit cells
  just outside the clip;
- the mirror effect, 1 to 6 holes in solid black next to dark grey at luma 2–25.

The nine fixed kernels showed none of this, because their incoming weights always sum to exactly
1.

**Photo order (Q3-P3-4).** Decision 1 says `PHOTO_DITHERS` is ordered smoothest first. But the list
read Blue Noise, Jarvis, Stucki, Floyd–Steinberg. This ADR's own Verification table ranks them by
low-frequency share as Blue Noise 0.82, Floyd–Steinberg 0.93, Stucki 1.59 and Jarvis 2.15. The audit's
simulated burns put Floyd–Steinberg ahead of Jarvis and Stucki too. Nothing in the code depends on
the order: it only sets the order of the Photo engraving window's list and the tone wedge's.

### Decision

1. **Pure white never burns, and pure black always burns, under Blue Noise.** In
   `diffuseBlueNoiseRow`, a pixel whose input level is 255 is not burned and one at 0 is burned,
   whatever error it has gathered. Its error, its value minus its output, still spreads as every
   other kernel's does, so tone next to it is kept. Levels 1–254 quantise as before, so a flat grey
   dithers bit for bit as it did, and the texture measures above are unchanged. The streamed row
   ditherer calls the same function, so streamed output still equals full output.
2. **The photo list runs smoothest first by this ADR's measure:** Blue Noise, Floyd–Steinberg,
   Stucki, Jarvis. A layer whose mode is not a photo dither still opens the window on Jarvis
   (ADR-581 Decision 2): that follows LightBurn's own advice for photographs, and changing it stays
   with the maintainer.

### Consequences

- Blue Noise G-code changes wherever pure white or pure black meets another tone, including at the
  edge of every mask. So `EMITTER_REVISION` moves to v37: main has v35 (ADR-492 Amendment 1),
  and v36 belongs to open PRs #1490 and #1491.
- Tests:
  - `dither-blue-noise.test.ts` dithers a 40 px disc of luma 200–253 on white and of luma 2–25 on
    black, and finds no dot or hole outside the disc.
  - `image-mask-owned.test.ts` compiles flat grey at luma 230–250 through `compileJob` with a
    circular owned clip, and finds no lit cell outside it. The old code lit 3.
  - The perceptual fixture `dither-texture.test.ts` sums each photo dither's low-frequency share
    over its 15 greys and checks the list runs from least to most: Blue Noise 0.19, Floyd–Steinberg
    0.21, Stucki 0.40, Jarvis 0.56.
- These are code and test results. No image was burned and no controller was operated. A burned
  test card is still the step that qualifies these modes on material.
