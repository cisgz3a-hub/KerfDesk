## ADR-454 - Line + fill trace: thin ink burns once down its centre, wide ink stays filled (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This adds a trace mode beside Centerline and the filled-contour presets. It reuses the Centerline
lane (see the decision on centerline strokes as compact cubics) and the filled-contour finisher
without changing either.

### Context

A drawing that mixes pen lines and solid shapes, such as handwriting next to a logo, has no good
trace today:

- **Line Art** traces every mark as a filled outline. A 2 px pen line becomes a thin ring whose
  burn length is about twice the line's length. Filled, it needs a scanline pass for a mark the
  spot could burn in one pass.
- **Centerline** burns every mark once down its skeleton. A solid logo comes back as a scribble of
  medial-axis branches, not a filled shape.

Potrace and LightBurn's Trace Image have no mode that does both. Illustrator's Image Trace has a
stroke-width gate, and AutoTrace has `-centerline` with `-preserve-width`. Our Centerline lane
already computes the exact distance from every ink pixel to the paper, which is the pen radius at
that point (`centerline/distance-field.ts`), but it drops that value on output. `ColoredPath`
already has an optional `strokeWidthMm`, which V-carve turns into a round-stroke outline
(`collect-cnc-contours.ts`). Until now only library strokes set it.

### Decision

**Line + fill** is a new trace preset (`traceMode: 'hybrid'`). Ink no wider than a **Max stroke
width** is traced as centre-line strokes. Wider ink is traced as filled outlines.
`src/core/trace/hybrid/` implements it.

1. **Wide versus thin: the medial axis (Blum 1967).** A shape is the union of its maximal inscribed
   discs. Take the ones whose radius exceeds the gate `(w + 1) / 2` working pixels, where `w` is
   the Max stroke width in pixels and a `w`-pixel line's centre pixel sits `(w + 1) / 2` from the
   paper. The union of those discs is the **wide region**. It is the ink a `w`-wide pen cannot
   have drawn. `disc-union.ts` computes the union exactly with a separable reverse Euclidean
   distance transform: two lower envelopes of parabolas, linear in the pixel count however large
   the discs are.
2. **Hysteresis seed.** A wide core must contain a disc at least 0.5 px beyond the gate. Its
   8-connected neighbours above the gate join the core. A single pixel of bulge on a pen line, such
   as a pen-down blot or a lucky antialiasing sample, therefore stays a stroke.
3. **Measured-width check.** The disc gate reads radii at pixel centres. A line one or two pixels
   wider than the gate can slip under it: a 6 px horizontal line's ridge sits exactly on radius 3,
   short of a 4 px gate's seed, and a slanted 5 px line's ridge wobbles about the gate in short
   patches. So each clipped stroke is also measured straight across (rule 7). A stroke whose median
   width exceeds the Max stroke width by more than one width quantum (0.25 px) joins the wide
   region as the union of its inscribed discs, placed every half pixel along it. The same test
   decides a line standing alone and one running into a shape, and no stroke carries a width that
   rounds above the Max stroke width. A **compact blob** joins the wide region the same way: a
   stroke shorter than two gate widths whose middle holds a disc wider than the gate, or that lies
   in a small ink island wider across the stroke than the gate plus 0.25 px (a round dot just over
   the gate, whose centreline is a short dash, would otherwise burn as a hairline). The strokes
   are then clipped again against that region, so a thin stroke running into it still meets the
   fill under rule 5.
4. **Strokes.** The Centerline lane traces the whole ink mask, unchanged. Each stroke curve is
   clipped where it enters the wide region (`clip-stroke-curves.ts`). The clip splits the cubics
   with de Casteljau, so clipped strokes stay compact cubics. It does not flatten them.
5. **Junction rule.** A clipped stroke is cut on the wide region's boundary, then its cut end
   reaches 1 px further along its end tangent, as long as that point is still ink. The reach
   exists because a pen line's own ink widens the inscribed discs where it meets a shape, so the
   wide region runs about a pixel up the line. The contour finisher smooths that one-pixel bump
   off the fill outline. Without the reach, a strip of paper about a pixel wide would stay between
   the stroke end and the fill. With it, a stroke that meets a fill touches or enters the outline,
   so there is no gap. It enters at most 1 px plus half its pen width, which is the only area
   burned twice. A clipped stub shorter than 2 x the gate radius with a cut end is dropped. That
   ink is only a spur of the fill's skeleton, and it goes back to the fill (rule 6).
6. **Fill mask.** The fill is the wide region plus any thin ink that no kept stroke covers. "Covers"
   means inside a disc of the stroke's pen radius + 1 px, placed every half pixel along the
   stroke. The extra
   pixel absorbs an even-width line's second centre row. Only connected components that contain
   wide ink are kept. So a logo keeps square corners, and the short skeleton spurs pruned at those
   corners, and a thin speck the Centerline cleanup dropped does not come back as an outline. The
   fill mask then runs through the ordinary filled-contour finisher (`contourFinishOptionsFor`).
7. **Width metadata.** Each kept stroke's pen width is measured along its normal, averaged over a
   6 px window (`stroke-width.ts`). A cross-section whose march runs out (it is measuring the line
   that meets this one at a junction) is dropped with the samples within half a gate width of it,
   and windows average only unbroken runs of clean samples, so a steady line meeting another at a
   T keeps its width. When the spread of those widths is under 25 % of their median,
   the stroke gets `strokeWidthMm`, quantised to 0.25 working px. Strokes are grouped by width into
   one path each. Dot marks (concentric rings) never get a width. The value is in the path's local
   units, the same units as its coordinates, so the object transform takes it to millimetres, and
   `scaleTracedPathsUniform` scales it with the points. On a V-carve layer the existing consumer
   turns these strokes into round-stroke outlines of the real pen width. A stroke that carries a
   width is first recentred on its ink (`recentre-stroke.ts`): each vertex and control point moves
   along the local normal by the median centre offset the cross-sections measured, at most 1 px.
   The skeleton of an even-width line otherwise sits half a pixel off the true centre.
8. **Colours and commit binding.** Strokes are `#0000ff` (`HYBRID_STROKE_COLOR`) and fills are
   `#000000` (`HYBRID_FILL_COLOR`). On commit, both on a fresh import and on a trace over its
   source bitmap, `createArtworkOperations` takes a per-colour mode (`modeForColor`):
   - strokes bind to a **LINE** operation;
   - fills bind to a **FILL** operation.
9. **Preview and Break Apart.** The preview draws hybrid strokes as hairlines and fills as filled
   shapes, decided per path. Break Apart gives each stroke its own shape and groups each outline
   with its holes.
10. **Max stroke width control.** The dialog shows it in millimetres on the placed artwork. The
   default is 3 burn spots, with a 0.25 mm floor, where the spot comes from the machine profile.
   Three spots is about as wide as a single pass looks once dwell and char widen it. The dialog
   converts millimetres to preview-grid pixels through the source's placement
   (`ui/trace/hybrid-stroke-width.ts`). The commit grid then scales that value like the other size
   controls (see the decision on committed traces using the output resolution); the 1 px floor
   applies on the working grid, after that scaling. The slider runs 0.05 to 3 mm. The resolved
   value, default or not, is recorded with the trace (see the decision on trace settings
   travelling with the trace), so a Re-trace on another device profile splits the ink the same
   way. When the placement is unknown, the core default of 4 px applies.
11. **Vector only.** Line + fill offers no Raster scan output: the raster route renders every path
   in one style and would turn the fills into outline rings. Its operations are named
   "<file> lines" and "<file> fills". Enhance region keeps the per-width stroke groups, their
   widths and their curves. Border counterparts match by source colour, pen presence/transform,
   closedness and nearest bounds, one-to-one: a changed width measured on the finer grid must not
   delete or duplicate a stroke. An accepted replacement keeps its new measured width.
   `isBinaryContourPreset` excludes Line + fill, so the contour-only
   supersample and dense-colour downscale routes (which carry neither widths nor the gate) never
   take it.

### Measurements

The full `traceImageToColoredPaths` pipeline was run on the native-size files with one warm-up
run, on a shared, loaded workstation, so the times are indicative only. Burn length is the summed
length of every emitted path in working px, which is what a LINE-mode pass travels.

| Image | Preset | Time | Subpaths | Segments | Burn length |
|---|---|---|---|---|---|
| synthetic handwriting + logo, 900 x 420 | Line Art | 1.97 s | 51 | 3,852 | 10,600 |
| | Centerline | 0.38 s | 17 | 303 | 5,388 |
| | **Line + fill (4 px)** | 0.54 s | 18 | 524 | **6,034** (strokes 4,872, fill 1,162) |
| owl, 1254 x 1254 | Line Art | 6.3 s | 2,384 | 114,746 | 226,305 |
| | Centerline | 19.1 s | 4,147 | 16,818 | 139,255 |
| | **Line + fill (4 px)** | 22.2 s | 4,612 | 128,850 | **176,792** (strokes 64,922, fill 111,869) |
| | Line + fill (8 px) | 20.1 s | 4,505 | 74,970 | 159,055 |
| hummingbird, 1254 x 1254 | Line Art | 5.0 s | 1,466 | 126,855 | 157,418 |
| | Centerline | 7.6 s | 2,512 | 10,632 | 95,217 |
| | **Line + fill (4 px)** | 10.4 s | 2,849 | 62,366 | **119,056** (strokes 47,675, fill 71,381) |
| | Line + fill (8 px) | 9.4 s | 2,728 | 43,560 | 109,316 |

- **Synthetic image** (1 to 3 px pen lines plus a solid logo): the burn length drops to 57 % of
  Line Art's and the segment count to 14 %. Every pen line is a single stroke and the logo is one
  outline with its knock-out.
- **Owl and hummingbird**: their ink is mostly wider than 4 px, so more of it stays fill. The burn
  length is 76 to 78 % of Line Art's at 4 px and 69 to 70 % at 8 px. Rule 3 moved the lines just
  over the gate from strokes to fill. Before it, the owl at 4 px burned 168,675 px with 101,646
  segments, but some of those strokes were up to 1.5 x the Max stroke width.
- **Time**: Line + fill costs the Centerline lane plus a contour finish. On the owl that is about
  1.2 x Centerline and 3.5 x Line Art. These are single runs on one machine, taken before the
  review fixes (junction-clean widths, compact blobs, 0.25 px tolerance, recentring); the operator
  saw about 27 s for the owl in the app, so treat them as +/- 25 %.

### Consequences

- Line Art, Centerline and Edge output is unchanged. The Centerline lane was refactored into
  `centerlineStrokesFromMaskSteps` with no change in behaviour. Its existing tests pass unchanged.
- Peak memory is above Centerline's because the lane allocates the disc-union and fill-mask arrays
  and then runs the contour finisher. Line + fill plans with its own 230 B/px figure (the contour
  lane's 190 plus its retained grids and headroom) and the Centerline run-time ceiling. That figure
  is an estimate; the peak has not been measured as ADR-409 measured the other lanes.
- Strokes are grouped by width, so their order differs from Centerline's output order.
- Crossing loops, such as looped handwriting, often widen where they cross. They then fail the
  25 % spread test and carry no width. They still trace as single strokes.
- The dialog's scanline and offset fill-style choice does not apply to Line + fill yet. Its fill
  operation uses the operation defaults.
- A stroke without a width (a hairline) keeps the Centerline lane's centre line, which for an
  even-width line sits half a pixel off the true centre. Only width-carrying strokes are recentred.
- Where lines at the gate width cross, the crossing's inscribed disc can exceed the gate and seed a
  small fill blob; each stroke ending there reaches 1 px into it plus its round cap, so a large
  share of that small blob burns twice. This is rule 5 as designed: dropping the reach for small
  blobs would reopen the pixel-wide seam the reach exists to close.
- A diagonal line's digitised width quantises in steps of about 0.7 px (pixel diagonals), so a pen
  line drawn at exactly the Max stroke width can measure up to half a pixel over it at 45 degrees
  and fill. The measurement is right about the pixels; set the Max stroke width a little above the
  pen width. On the commit grid (2 samples per spot) that is a small fraction of the gate.
