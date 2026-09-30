## ADR-558 - Centerline centres strokes on the sub-pixel ridge and keeps drawn curves round (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29
**Refines:** ADR-405 (Centerline stroke assembly: tip extension and bend rebuilding). Line + fill
(ADR-454) shares that assembly and keeps its own strokes; the contour presets never reach it.

### Context

The 2026-09-24 tracer audit (finding 7) measured Centerline on 21 synthetic strokes with known
centrelines: 2, 4 and 8 px lines, circles, spirals, waves, crosses, tees and corners (the audit
kit's `cl-corpus`). On main `6e4b8e60f` the mean distance from the true centre is 0.235 px, with
two errors.

- **Rounded bends in thick strokes become sharp corners.** `centerline/sharpen-bends.ts` rebuilds a
  bend as the corner its two straight legs point at, and keeps only roundings of about two stroke
  radii or more. Thinning cuts inside a drawn corner and follows a rounded bend, and in a thick
  stroke both leave a short, concentrated turn between straight legs, so the shape gates cannot
  tell them apart. On main the 8 px wave's three lower bends are cut: of 810 points sampled every
  pixel along its true centreline, 42 lie more than 0.6 px from the trace (up to 2.14 px), all at
  those bends, and its 95th percentile error is 0.98 px.
- **Strokes an even number of pixels wide sit 0.5 px off centre.** The ridge of the exact distance
  transform (Felzenszwalb and Huttenlocher) lies between two pixel centres there. Distance-ordered
  homotopic thinning (Pudney) keeps whole pixels, so the skeleton takes one of the two. On main the
  4 and 8 px corners and tees average 0.50 to 0.62 px from their centres, and the in-repo regression
  bar (`centerline-bar.test.ts`) reads 0.69 px on its straight stroke, L corner and cross.

Three more things came up while fixing these:

- **The tip walk turned off the axis of round caps.** `extendTip` walks from the skeleton's end to
  the ink tip and breaks ties by the radius of the nearest pixel. That radius jumps a whole lattice
  step between neighbouring candidates and turned the walk 22.5° off a round cap's axis. Centring
  changed the chain ends and pushed the regression bar's 9 px arc over its 1 px limit.
- **A rebuilt corner could be built again.** After a rebuild the sharpener's scan moves to the next
  point along the chain. That point's window can take in the new corner, whose own leg is straight,
  so the candidate passes every gate and builds a second corner beside the first from a tangent read
  further down the other leg. Centring straightens the legs, so it happened more: on a 12 px
  stroke's 45° corner the traced line strays 1.46 px off the pen's path.
- **The separate-end gap bridge at zero.** WORKFLOW says "Zero disables that gap bridge".
  `bridgeNearbyEnds` returns before pairing any ends when the gap is zero or less, so the
  statement holds; nothing pinned it.

This work was written on 2026-09-25 against an older tracer and saved while tracer batch 4 (ADR-530
to 536) was merged. It is ported here onto today's compact-curve tracer.

### Decision

1. **Centre chains on the sub-pixel ridge** (`centerline/ridge-centering.ts`, run after junction
   condensation and before assembly). For each chain point that sits on a pixel centre, read the
   distance field one pixel to either side along the chain's normal (taken from the points two
   either side), with bilinear reads (`interpolatedRadius`). Fit a tent through the three values:
   two lines of equal and opposite slope, which is the shape of the distance to the nearer edge
   across a straight band. Move the point to the tent's apex, at most half a pixel. Junction nodes
   and former junctions (`seamJunctions`) stay where they are, because pairing, seam repair and the
   attachment pins find them by position. An open chain's own end moves with its endpoint node.
   Round dots are still judged on the skeleton's own pixels, before centring.
2. **Keep a rounded bend round** (`centerline/round-bend-guard.ts`, the sharpener's
   `keepRoundedBends` option). Before accepting a rebuilt corner, compare the ink radius at the
   rebuilt vertex with the legs' radius: the smaller of the two medians read over 12 px of each leg
   just outside the bend. The ink the vertex lost says how far it stands off the pen's path; the
   rest of its offset from the chain is how far the chain stands off. Rebuild only when the loss is
   at most max(0.6 px, half the offset), which is when the vertex is the nearer of the two. A bend
   turning more than 120° is left to the sharpener's own gates, as before: at a letter's apex the
   ink thins toward the tip whatever the pen did. On the Arch House logo the bends the guard kept
   round turned 40 to 94°; without the cap it also rounded the foot of the N, whose candidates
   turned 138 to 147°.
3. **Build one corner per bend** (`oneCornerPerBend`). A candidate is skipped when the points its
   vertex would be built from, the window it replaces and the 3 px tangent chords either side,
   include a corner already rebuilt on the chain.
4. **Read the ridge between pixel centres in the tip walk**: its tie-break uses
   `interpolatedRadius` instead of the nearest pixel's radius.
5. **These four rules are Centerline's.** `centerlineStrokesFromMaskSteps` takes the lane's
   `penPath`: the Centerline lane passes true, Line + fill false. Line + fill already recentres its
   width-carrying strokes on their measured cross-sections (ADR-454), and its width groups and
   Enhance-region border matching were tuned on the plain skeleton. With the rules on, its astronaut
   trace went from 183 to 178 paths and two of its region-border tests traced the other branch.
   Adopting them there needs its own measurement.
6. **The gap bridge's zero stays as it is.** A unit test now pins that a gap of zero or less
   bridges no ends, even touching, aligned ones.

### Consequences

- The 21-stroke corpus, main against this change: mean distance from the true centre 0.235 to
  0.089 px, mean 95th percentile 0.388 to 0.151 px, share of the true centreline covered 99.84% to
  100%, fragment counts unchanged. The 8 px wave's 95th percentile falls from 0.98 to 0.25 px, the
  4 and 8 px corners' means from 0.50 and 0.58 px to 0.01 and 0.08 px. Every stroke holds or
  improves its mean except two 8 px strokes. The diagonal (0.129 to 0.175 px) ends up about 0.1 px
  to one side of its true centre along its whole length, where main's trace had no bias; its 95th
  percentile still improves (0.26 to 0.18 px). The cross goes from 0.089 to 0.103 px.
- The largest deviation of every open stroke in that corpus sits at a stroke end. The true
  centreline stops where the pen stopped; the traced line runs on to the end of the ink, half a
  stroke width further, and the bench counts that reach, so the 8 px strokes read about 4 px. The
  tips now reach further and sit nearer their axes. The 8 px wave's tips end 4.30 px past the true
  end and 0.05 px off its axis (3.84 and 0.32 px on main), which is the wave's 4.30 px maximum
  (3.86 px on main). One tip of the 8 px X ends 4.21 px out and 1.41 px off its axis (3.70 and
  1.86 px on main), which gives the cross's 4.44 px maximum (4.21 px on main).
- The in-repo regression bar: maximum deviation 0.69 px to 0 for the straight stroke (with and
  without its noisy spur), the L corner and the cross, and 0.79 to 0.37 px for the arc; the
  diagonal stays at 0.19 px. The largest gap falls from 0.88 to 0.50 px (0.96 to 0.51 px on the
  arc).
- Real images, Centerline, main against this change (share of traced length on ink pixels, luma
  below 128):
  - Stress-test drawing (`centerline-stress-test-20260909.png`, 1254 px): 2,593 paths either way,
    82,980 to 83,064 vertices, on ink 82.8% to 84.4%.
  - Arch House logo (`arch-house-langebaan-source.png`): 74 paths either way, 5,981 to 6,110
    vertices, on ink 88.4% to 88.3%.
  - Astronaut: 168 paths either way, 5,716 to 5,729 vertices, on ink 99.35% to 99.49%.
  - Time: the stress-test drawing traces in 3.65 s instead of 3.37 s (medians of 3 cold runs); the
    logo and the astronaut stay within run-to-run noise.
- Line Art, Smooth, Sharp, Edge Detection and Line + fill trace to the same bytes as main on 75
  traces: the audit corpus's 12 images and the three real images above, each with all five
  presets.
- The guard's half is the break-even point, not a tuned value. On the 290-bend corpus the saved
  work was measured on (3 to 12 px strokes, 45 to 150° turns, 2026-09-25), where rebuilding helped
  the vertex lost at most 0.21 of its offset, and where it did not help it lost a median 0.54 to
  0.86. A lower cut of 0.35 caught more curves there but rounded the pointed tops of the logo's
  capital A and N, so it was rejected.
- Known limits: the tip walk still steps in 16 compass directions, and one tip of the 8 px X ends
  1.41 px off its axis; a rounded bend turning more than 120° gets no guard, as on main; the 8 px
  diagonal's 0.1 px bias; Line + fill does not use these rules yet (item 5).
- Tests: `ridge-centering.test.ts` (tent apex, even and odd widths, fixed junctions, a 4 px ring
  within 0.2 px of its centre circle), `round-bend-guard.test.ts` (a 12 px stroke's 9 px fillet
  stays round, the same stroke's drawn corner is rebuilt, the guard on a ring whatever the ring's
  start, the 120° cap, the option is off unless asked for), `corner-rebuilt-once.test.ts` (a 12 px
  stroke's 45° corner is rebuilt once, within 1 px of the pen's path), `tip-extension.test.ts` (the
  arc's round caps end within 0.5 px of their axes) and `gap-distance.test.ts` (zero gap).

### References

- P. F. Felzenszwalb and D. P. Huttenlocher, "Distance Transforms of Sampled Functions", Theory of
  Computing 8:415-428, 2012. doi:10.4086/toc.2012.v008a019,
  <https://theoryofcomputing.org/articles/v008a019/>
- C. Pudney, "Distance-Ordered Homotopic Thinning: A Skeletonization Algorithm for 3D Digital
  Images", Computer Vision and Image Understanding 72(3):404-413, 1998.
  <https://doi.org/10.1006/cviu.1998.0680>
