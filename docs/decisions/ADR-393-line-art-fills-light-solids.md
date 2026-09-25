## ADR-393 - Line Art fills light solids and promotes only coherent colour (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This refines the automatic detail recovery of the Line Art preset (`autoSketchTrace`,
`prepareAutomaticDetailMask`, audit item TR-004). Deliberately selected Sketch keeps its plain
local-contrast mask; the manual brightness band and Faint Line Recovery are unchanged. The
clean-room rule (ADR-120, ADR-123) holds: the design below uses only the published adaptive-threshold
literature and our own reasoning.

### Context

When an image has enough colour, Line Art promotes to the automatic detail mask:
ink = (cutoff ≤ luma ≤ threshold) OR (luma < localMean − 8), with the local mean taken over a
17 × 17 px box (radius 8, scaled with supersampling). Solids whose luma is inside the 0..128 band
(red, blue, black) stay filled. A flat solid lighter than the band is only darker than its local
mean where the box reaches brighter paper, so it traced as a band about 7 px wide around a hollow
interior. Measured on main (`fa8939b8d`), a 200 px square on a 280 px white canvas, traced with Line
Art and rasterised back (even-odd):

| Colour | Luma | Contours | Ink px (truth 40,000) |
|---|---|---|---|
| gold `#d4a017` | 160 | 2 | 5,404 (−86.5%) |
| orange `#ff8c00` | 158 | 2 | 5,404 (−86.5%) |
| tan `#d2b48c` | 185 | 2 | 5,371 (−86.6%) |
| light blue `#add8e6` | 205 | 2 | 4,664 (−88.3%) |
| tan, ±8 per-channel noise | 185 | 2 | 5,042 (−87.4%) |

A global threshold (LightBurn's default, Potrace's `-k`) fills these whenever it is set above their
luma, and drops them entirely at 0.5. Neither is what the preset promises ("preserve pale
details").

The promotion trigger counted pixels with RGB spread ≥ 12 and luma < 245 anywhere in the image
(≥ max(32, 0.2% of pixels)). Independent ±8 noise per channel on grey art gives spread ≥ 12 in about
16% of pixels, so noise alone promoted grey art: a grey (185) noisy square traced as a hollow ring
(2 contours, 5,055 px) instead of following the brightness band.

Adaptive thresholds are known to hollow large flat regions. Sauvola and Pietikäinen (2000) and Wolf
and Jolion (2004) damp the local test where the local standard deviation is low, and Bradley and
Roth (2007) accept the hollowing. Damping the test would also weaken it on the faint, low-contrast
strokes it exists to find, so this decision keeps the test unchanged and repairs the hollow instead.

### Decision

1. **Light solids** (`core/trace/light-solid-fill.ts`, called by `prepareAutomaticDetailMask`). After
   the band ∪ local-contrast mask is formed, each 4-connected background component is a candidate
   hollow interior. It is filled when all of these hold:
   - Its mean luma is above the band's upper threshold. Darker tones are already ink, and a user's
     lower cutoff keeps excluding the darkest tones.
   - Its mean luma is at least 12 below the paper tone. Paper is the dominant luma along the image
     border (5-level histogram window, brighter on ties).
   - It is flat: luma standard deviation ≤ 16. This rejects illumination ramps and texture.
   - At least half of the ink pixels bordering it are its own tone (within 10 luma). This is the
     evidence of a hollow: the local test rims a solid with its own colour, while a real counter,
     a gap between strokes, or paper enclosed by a drawing is bordered by different, darker ink.

   An accepted interior is grown over the connected same-tone ink of its rim. On that solid and a
   2 px shell around its edge, the iso value is raised to the midpoint between the solid's tone and
   paper. The mask is ink where luma ≤ the iso there, and the crack field's `thresholdAt` returns the
   same per-pixel maximum of band, local and solid iso. Mask and field therefore agree pixel for
   pixel, and outlines land at half coverage instead of being pulled inward by the −8 local bias.
2. **Coherent colour trigger** (`core/trace/auto-sketch-trace.ts`). A pixel counts towards promotion
   only when it is chromatic (spread ≥ 12, luma < 245) and the mean colour of its 3 × 3
   neighbourhood is still chromatic (spread ≥ 8, luma < 245). Averaging nine samples divides
   independent noise by three, so ±8 noise cannot pass. Colour patches and strokes still count,
   and a 1 px coloured line on paper keeps a third of its spread. The count threshold is unchanged.
3. **Near-paper rule.** Tones within 8 luma of paper produce no ink: neither the local test nor the
   fill marks them, and on white paper the trigger ignores luma ≥ 245 anyway. A 200 px square of
   `#faf8f4` (luma 248) traces to nothing, as under a global threshold. Solids 12 or more below paper
   are filled once the local test has closed a rim around them.

### Consequences

- Measured after, same fixtures (a 200 px square, 280 px canvas, Line Art):

  | Colour | Before: contours, ink error | After: contours, ink error |
  |---|---|---|
  | red, blue, black | 1, ≤ 0.23% | 1, ≤ 0.23% (unchanged) |
  | gold | 2, −86.5% | 1, 0.00% |
  | orange | 2, −86.5% | 1, 0.00% |
  | tan | 2, −86.6% | 1, 0.00% |
  | light blue | 2, −88.3% | 1, 0.00% |
  | tan, ±8 noise | 2, −87.4% | 1, 0.00% |
  | gold, ±8 noise | 2, −86.4% | 1, 0.00% |
  | dark grey (60), ±8 noise | 1, 0.00% (promoted) | 1, 0.00% (brightness band) |
  | grey (185), ±8 noise | 2, −87.4% (promoted by noise) | 0 (brightness band, as for clean grey) |
  | near paper `#faf8f4` | 0 | 0 |

- Anti-aliased discs (radius 80 px, 4 × 4 supersampled coverage): the outer contour's area error
  moves from −0.35% (gold), −0.42% (tan) and −0.50% (light blue) to −0.05%, −0.09% and +0.04%. Every
  pixel of the mask agrees with the crack field.
- Guards held in tests: a thick gold ring keeps its paper counter open; a gold fill inside a black
  outline stays a hole, as under a global threshold; vignetted paper (40 luma deep, ±12 noise)
  enclosed by a pencil circle is not filled.
- The user's art: the hummingbird (1254², promoted) changes by 50 mask pixels out of 409,004 ink.
  The owl is not promoted, before or after, and is unchanged. On the hummingbird, preparation takes
  about 46 ms more (best of 7: 271 to 317 ms in a Node harness). Extra memory is at most about 18 bytes
  per pixel during the mask step.
- Behaviour change: grey art with per-pixel chroma noise no longer promotes, so it follows the
  brightness band like clean grey art. Pale grey strokes in such images are no longer recovered
  by accident; Faint Line Recovery and Sketch still recover them on request.
- Known limit: tints 12 to 17 luma below paper (about 238 to 243 on white) are too faint for the
  local test to close a rim along a straight edge. The local test still marks the corners of a large
  tint square, and those marks are not filled. This is unchanged from before. Light solids with
  strong internal gradients (standard deviation above 16) keep their rim.
- Tests: `automatic-detail-light-solids.test.ts` (per-colour squares, noisy squares, anti-aliased
  disc and field agreement, near-paper square, counters and outlined fills, vignetted sketch,
  trigger noise and coherent colour). Existing `trace-image-auto-detail.test.ts`,
  `trace-image-sketch.test.ts` and the faint-line suites pass unchanged.

Not part of this decision: filling light grey solids in images that do not promote (they follow
the brightness band, as in LightBurn and Potrace); moving band-dark solid edges (red, blue) to their
own tone/paper midpoint; removing the corner marks of near-paper tints.
