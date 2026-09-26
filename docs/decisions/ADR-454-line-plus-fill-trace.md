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
3. **Strokes.** The Centerline lane traces the whole ink mask, unchanged. Each stroke curve is
   clipped where it enters the wide region (`clip-stroke-curves.ts`). The clip splits the cubics
   with de Casteljau, so clipped strokes stay compact cubics. It does not flatten them.
4. **Junction rule.** A clipped stroke ends exactly on the wide region's boundary, so a stroke
   that meets a fill leaves no gap. The fill outline sits no deeper than the wide discs, so the
   only area burned twice is the stroke's round cap: at most half a pen width, into the fill. A
   clipped stub shorter than 2 x the gate radius with a cut end is dropped. That ink is only a
   spur of the fill's skeleton, and it goes back to the fill (rule 5).
5. **Fill mask.** The fill is the wide region plus any thin ink that no kept stroke covers. "Covers"
   means inside a disc of the stroke's pen radius + 1 px around every stroke sample. The extra
   pixel absorbs an even-width line's second centre row. Only connected components that contain
   wide ink are kept. So a logo keeps square corners, and the short skeleton spurs pruned at those
   corners, and a thin speck the Centerline cleanup dropped does not come back as an outline. The
   fill mask then runs through the ordinary filled-contour finisher (`contourFinishOptionsFor`).
6. **Width metadata.** Each kept stroke's pen width is measured along its normal, averaged over a
   6 px window (`stroke-width.ts`). When the spread of those widths is under 25 % of their median,
   the stroke gets `strokeWidthMm`, quantised to 0.25 working px. Strokes are grouped by width into
   one path each. Dot marks (concentric rings) never get a width. The value is in the path's local
   units, the same units as its coordinates, so the object transform takes it to millimetres, and
   `scaleTracedPathsUniform` scales it with the points. On a V-carve layer the existing consumer
   turns these strokes into round-stroke outlines of the real pen width.
7. **Colours and commit binding.** Strokes are `#0000ff` (`HYBRID_STROKE_COLOR`) and fills are
   `#000000` (`HYBRID_FILL_COLOR`). On commit, both on a fresh import and on a trace over its
   source bitmap, `createArtworkOperations` takes a per-colour mode (`modeForColor`):
   - strokes bind to a **LINE** operation;
   - fills bind to a **FILL** operation.
8. **Preview and Break Apart.** The preview draws hybrid strokes as hairlines and fills as filled
   shapes, decided per path. Break Apart gives each stroke its own shape and groups each outline
   with its holes.
9. **Max stroke width control.** The dialog shows it in millimetres on the placed artwork. The
   default is 3 burn spots, with a 0.25 mm floor, where the spot comes from the machine profile.
   Three spots is about as wide as a single pass looks once dwell and char widen it. The dialog
   converts millimetres to preview-grid pixels through the source's placement
   (`ui/trace/hybrid-stroke-width.ts`). The commit grid then scales that value like the other size
   controls (see the decision on committed traces using the output resolution). The setting
   persists with the trace (see the decision on trace settings travelling with the trace). When the
   placement is unknown, the core default of 4 px applies.

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
| | **Line + fill (4 px)** | 27.4 s | 4,866 | 101,646 | **168,675** |
| | Line + fill (8 px) | 20.4 s | 4,563 | 58,095 | 154,057 |
| hummingbird, 1254 x 1254 | Line Art | 5.0 s | 1,466 | 126,855 | 157,418 |
| | Centerline | 7.6 s | 2,512 | 10,632 | 95,217 |
| | **Line + fill (4 px)** | 9.3 s | 2,997 | 63,442 | **116,977** |
| | Line + fill (8 px) | 11.3 s | 2,831 | 37,203 | 107,019 |

- **Synthetic image** (1 to 3 px pen lines plus a solid logo): the burn length drops to 57 % of
  Line Art's and the segment count to 14 %. Every pen line is a single stroke and the logo is one
  outline with its knock-out.
- **Owl and hummingbird**: their ink is mostly wider than 4 px, so more of it stays fill. The burn
  length is 74 to 75 % of Line Art's at 4 px and 68 % at 8 px.
- **Time**: Line + fill costs the Centerline lane plus a contour finish. On the owl that is about
  1.4 x Centerline and 4 x Line Art.

### Consequences

- Line Art, Centerline and Edge output is unchanged. The Centerline lane was refactored into
  `centerlineStrokesFromMaskSteps` with no change in behaviour. Its existing tests pass unchanged.
- Peak memory is above Centerline's because the lane allocates the disc-union and fill-mask arrays.
  Line + fill uses the Centerline working-pixel budget. That peak has not been measured separately.
- Strokes are grouped by width, so their order differs from Centerline's output order.
- Crossing loops, such as looped handwriting, often widen where they cross. They then fail the
  25 % spread test and carry no width. They still trace as single strokes.
- The dialog's scanline and offset fill-style choice does not apply to Line + fill yet. Its fill
  operation uses the operation defaults.
- A 2 px line's centre line sits half a pixel off the true centre. That is the existing Centerline
  lane's behaviour, which this decision does not change.
