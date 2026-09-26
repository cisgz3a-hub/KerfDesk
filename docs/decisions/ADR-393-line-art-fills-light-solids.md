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
luma, and drops them entirely at 0.5.

The promotion trigger counted pixels with RGB spread ≥ 12 and luma < 245 anywhere in the image
(≥ max(32, 0.2% of pixels)). Independent per-channel noise on grey art passes that test in many
pixels, so noise alone promoted grey art: a grey (185) noisy square traced as a hollow ring.

Adaptive thresholds are known to hollow large flat regions. Sauvola and Pietikäinen (2000) and Wolf
and Jolion (2004) damp the local test where the local standard deviation is low, and Bradley and
Roth (2007) accept the hollowing. Damping the test would also weaken it on the faint, low-contrast
strokes it exists to find, so this decision keeps the test unchanged and finds solids separately.

A first version of this decision (commit `e4be13823`) filled a background component of the local
mask when at least half of the ink bordering it had its own tone. Review showed that rule to be
fragile: it failed at realistic noise (luma sd 6), filled cast shadows on photographed paper and
light pages carrying a drawing, stayed hollow when a dark line reached a pale solid's edge, leaked a
2 px shell into neighbouring flat colour, and took paper from the outermost pixel ring. This
revision replaces it.

### Decision

1. **Light solids** (`core/trace/light-solid-fill.ts`, called by `prepareAutomaticDetailMask`). Solids
   are found on a smoothed luma plane (5 × 5 box mean, scaled with supersampling), independent of the
   local-contrast mask, so pixel noise does not decide the outcome:
   - A pixel is **flat** when the smoothed luma changes by at most 4 to each 4-neighbour and the
     luma standard deviation inside its window is at most 20. A step edge of contrast c moves the
     5 × 5 mean by c/5 per pixel, so flat colours more than about 20 apart stay separate, while luma
     noise of sd 8 moves it by about 1. The window deviation keeps the core of a thin line, which a
     wider window averages to a flat value, out of the flat areas.
   - **Paper** is the brightest smoothed-luma level (5-level window) that holds at least 5% of the
     flat pixels, with the mean chromaticity of the flat pixels at that tone. A solid bigger than its
     margin, a frame line at the image edge or art reaching the border no longer becomes "paper".
   - A **candidate** is a 4-connected run of flat pixels whose smoothed luma lies above the band and at
     least 12 below paper, which does not touch the image border, whose smoothed luma standard
     deviation is at most 6 (a near-uniform tone), and whose chromaticity (channel ÷ mean channel)
     differs from paper's by at least 0.05 in some channel. Shadows, vignettes and greys sit near 0;
     on white, light blue is 0.16, pink 0.18, tan 0.21, gold 0.93.
   - A candidate is rejected as a **cut-out** when more than half of its edge lies within about 10 px
     of dark material that reaches more than 8 px from every light pixel (paper-toned pixels and
     candidates). Outlines and dividers up to about 10 px thick do not count; a dark ground or a wide
     dark shape does. A gold star in a black badge or pale letters on a dark plate stay open, as a
     brightness threshold leaves them.
   - A candidate that **encloses darker artwork** is a drawn-on surface, not a solid: an 8-connected
     component of non-candidate pixels that reaches neither the image border nor a paper-toned pixel
     and holds at least 16 pixels whose smoothed luma is 6 or more below the darkest candidate around
     it. Every candidate around it is a surface, and so is any candidate within 10 luma and 0.03
     chromaticity of a surface (the inside of a circle drawn on the page). Lines that run out to paper
     (an outline, a cross, a divider) only outline or split a solid.
   - The remaining candidates are **accepted**. Their flat pixels are ink (iso 255). Transition
     pixels (non-flat pixels reached through other non-flat pixels, up to 6 px, and nearer to this
     solid than to any other flat mid-tone area) use the midpoint between the solid's tone and paper.
     The mask is ink where luma ≤ that iso, and the crack field's `thresholdAt` returns the same
     per-pixel maximum of band, local and solid iso, so mask and field agree pixel for pixel. Outlines
     land at half coverage, and a neighbouring flat colour that was not accepted keeps its own side of
     the edge.
   - Outlined colour fills are now filled: a gold area inside a black outline traces as one solid,
     as it would at a threshold above gold. This replaces the first version's rule, which left them
     hollow.
2. **Coherent colour trigger** (`core/trace/auto-sketch-trace.ts`). A pixel counts towards promotion
   only when it is chromatic (spread ≥ 12, luma < 245) and the mean colour of its 3 × 3
   neighbourhood keeps a spread of at least max(8, 2σ). σ is the artwork's per-channel chroma noise.
   It is estimated from the neighbour differences of r − g and g − b over horizontal pixel pairs that
   are not both paper-light (luma ≥ 245): the median magnitude ÷ (0.6745 · 2). Grey hatching and
   texture move all channels together, so they do not raise σ. Clean art reads 0, and clean margins
   around a noisy picture do not hide its noise. The three channel means of a 3 × 3 window carry
   noise σ/3 each, and their spread exceeds six of those deviations in fewer than 1 in 10,000 pixels,
   well below the promotion count. Coloured patches and strokes keep their spread; a 1 px coloured
   line on paper keeps a third of it. The count threshold is unchanged.
3. **Near-paper rule.** Tones within 12 luma of paper are not solids. On white paper the trigger
   ignores luma ≥ 245 anyway, and a 200 px square of `#faf8f4` (luma 248) traces to nothing, as under
   a global threshold. A chromatic tint 12 or more below paper is filled.

### Consequences

- Measured after, same fixtures (a 200 px square, 280 px canvas, Line Art, traced and rasterised):

  | Case | Main (`fa8939b8d`) | This decision |
  |---|---|---|
  | red, blue, black | 1 contour, ≤ 0.23% | unchanged |
  | gold / orange / tan / light blue | 2 contours, −86% to −88% | 1 contour, 0.00% |
  | pink `#ffc0cb` | ring (10% of the square in the mask) | 1 contour, 0.00% |
  | gold, orange, tan, light blue with luma noise sd 8 over the whole image | ring | 1 contour, ≥ −0.01% |
  | the same with ±16 per-channel noise | ring | 1 contour, 0.00% |
  | chromatic tint (250, 238, 215), luma 240 | not measured | 1 contour, −1.77% |
  | dark grey (60), ±8 noise | 1 contour (promoted) | 1 contour (brightness band) |
  | grey (185), ±8 noise | ring (promoted by noise) | 0 contours (brightness band, like clean grey) |
  | near paper `#faf8f4` | 0 | 0 |

- Share of the square filled in the prepared mask as noise rises, first version → this decision (main
  is 9–14% throughout): gold, tan, light blue and pink at luma sd 6 and 8 went from 15–18% to 100%.
  At ±16 per-channel noise, gold, tan and light blue went from 16–18% to 100%.
- Pale solids split by dark lines (200 px square, 3 px black cross, edge to edge): light blue and pink
  went from 12–14% filled (first version and main alike) to 100%. With six more 2 px lines, all of gold,
  tan, light blue, pink and orange went from 16–36% to 100%. A gold square split by a 1 px paper
  hairline now fills both halves (39,800 px, the hairline open; main and the first version 5,426).
- Nested flat colours: gold with a light-blue inset now fills completely (40,000; first version
  30,784). A grey inset in gold keeps its full 100 px hole (30,018 ink; no 2 px shell).
- A black 3 px frame at the image edge no longer disables the fill (gold square 40,000; before 5,408).
- Paper and surfaces are never filled, matching main to the pixel: cream paper with a hard shadow
  40–80 luma deep at noise ±0 to ±12, and a round shadow crossed by pencil lines (first version up to
  25,496 px filled); four cream/kraft sheets inside a white margin with a pencil drawing (464 px, the
  strokes that four-connected despeckle kept; first version 43,067; with ADR-395's saddle policy all
  680 stroke pixels survive and the sheet is still never filled); grey, yellow and blue plates carrying dark text (2,048 px, the text;
  first version 33,600).
- Cut-outs stay open: a gold square inside a wide black badge (0 of 3,600 interior pixels), pale
  letters on a dark plate, and a light-blue shape on a dark ground that reaches the image border.
- Anti-aliased discs (radius 80 px, 4 × 4 supersampled coverage): the outer contour's area error is
  −0.05% (gold), −0.07% (tan) and −0.22% (light blue); main was −0.35%, −0.42% and −0.50%, with each
  disc hollow. Every pixel of the mask agrees with the crack field.
- Real art: the Arch House logo (1024², promoted) gains 4,604 ink pixels, all in its tan sand
  swooshes and the orange band below the sun. The swooshes were hollow outlines before and are now
  solids; no pixel is removed. Its native-versus-2× mask disagreement is 3,793 pixels (main 3,807).
  The user's hummingbird (1254², black ink on cream, promoted) is identical to main, pixel for pixel.
  The first version changed 50 pixels. The owl is not promoted and is unchanged.
- Cost: on the hummingbird, mask preparation took about 365 ms against 200 ms on main (best of 5,
  on a machine shared with other agents; the first version measured about 330 ms). The fill returns
  early when no flat pixel lies between the band and paper, or when no candidate survives the paper,
  border, flatness and chroma tests. The hummingbird exits at the second check. Region statistics are
  parallel arrays, not one object per component. Peak extra memory is about 18 bytes per pixel,
  about 110 MB at the 6 MP contour budget, and is released after the mask step.
- Behaviour change: grey art with per-pixel chroma noise no longer promotes, so it follows the
  brightness band like clean grey art. Pale grey strokes in such images are no longer recovered
  by accident; Faint Line Recovery and Sketch still recover them on request.
- Known limits. The first four are unchanged from main:
  - Neutral (grey) light solids are not filled, because they cannot be told from a shadow.
  - Gradient fills with more than about 20 luma of range keep their rim: a solid must be
    near-uniform, so that a sky or glass reflection is not filled in patches.
  - Light solids cut by the image border keep their rim.
  - A light solid carrying darker artwork inside it (a yellow face with black eyes) keeps its
    outline and inner details open.
  - A light shape inside dark material no more than about 10 px thick counts as outlined and
    fills. This covers a thick outline, and pale letters on a dark plate spaced less than about
    10 px apart.
  - A shadow with a strong colour cast (more than 0.05 chromaticity from paper) could fill.
- Tests: `automatic-detail-light-solids.test.ts` (per-colour squares, anti-aliased disc and field
  agreement, near-paper square, counters and outlined fills, vignetted sketch, trigger noise at ±8 to
  ±16 and coherent colour). `automatic-detail-light-solid-guards.test.ts` covers noise at sd 6 and 8
  and ±16, pale crosses and dividers, the hairline, the edge frame, cut-outs, gradients, nested
  insets, shadows, drawn-on sheets and plates, and border-cut solids. Scenes are in
  `src/__fixtures__/light-solid-scenes.ts`. Existing `trace-image-auto-detail.test.ts`,
  `trace-image-sketch.test.ts`, the faint-line suites and the Arch House supersampling suites pass
  unchanged.

Not part of this decision: filling light grey solids in images that do not promote (they follow the
brightness band, as in LightBurn and Potrace); moving band-dark solid edges (red, blue) to their own
tone/paper midpoint.
