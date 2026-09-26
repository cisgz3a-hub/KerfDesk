## ADR-403 - Filled traces resolve diagonal pixel contacts with one shared turn policy (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Clean-room constraint (ADR-120, ADR-123) unchanged: the rule below comes from published mathematics
and our own design. No tracer source was read; Potrace 1.16 was only run as a binary to measure the
same masks.

### Context

Where two ink pixels touch only at a corner (a 2x2 "saddle": ink on one diagonal, paper on the
other), a binary mask cannot say whether the ink or the paper passes through that corner. The
filled-contour lane (Line Art, Smooth, Sharp) answered it three different ways:

- the boundary walker (`contour-boundary.ts`) always took the right turn, so ink was 4-connected and
  paper 8-connected;
- `despeckle` (`preprocess.ts`) measured ink components 4-connected;
- `fillPinholes` (`fill-pinholes.ts`) flooded paper 4-connected, which disagreed with the walker.

So a 1-px diagonal hairline was a row of 1-pixel components. Probe on the base (`fa8939b`), 200x200,
an 80-px line alone or beside a 60x60 square: Line Art returned no outline at all (recall 0.000,
also at Ignore 0 because despeckle ran first), Smooth lost the line whenever the square was present,
and Sharp returned it as 40 to 57 separate sub-pixel islands. Potrace's documented default turn
policy keeps such lines connected.

### Decision

1. New option `TraceOptions.turnPolicy: 'auto' | 'connect-ink' | 'connect-paper'`, default `'auto'`
   (unknown values read as `'auto'`). No UI in this change. `'connect-paper'` is the rollback value:
   walker, despeckle and pinhole fill all behave exactly as before this decision (measured: owl and
   hummingbird reproduce the base numbers below to the last digit and outline). `'connect-ink'`
   makes ink 8-connected everywhere.
2. `'auto'` decides each saddle corner (`saddle-connectivity.ts`):
   - **Structure first: a minority window measured in source pixels.** Count ink and paper over the
     4x4 SOURCE pixels centred on the corner (the 2x2 block plus its one-pixel ring), which is
     4s x 4s mask pixels on a trace supersampled by s (`pixelScale`). The block is always half ink,
     so the ring decides. The colour that is the minority is the thin one and keeps its diagonal:
     a 1-px ink diagonal (4 of 16 ink) connects; a 1-px paper crack through solid ink (4 of 16
     paper) stays open and splits the ink. The window must be in source pixels: at 2x, a 4x4 mask
     window holds only the enlarged 2x2 block, where a hairline and a checkerboard are identical.
   - **Border.** Near the image border each axis of the window shrinks symmetrically to what still
     fits, so the window stays centred on the corner. Pixels beyond the border are never counted
     (the walker's out-of-image paper convention would make every shape near an edge look thin),
     and a pattern that is mirror-symmetric about the corner, such as a checkerboard of any cell
     size, ties at the border exactly as it does inside. One blind spot remains: a corner
     diagonally next to an image corner keeps only its own 2x2 block, so it is a tie.
   - **Ties use grey levels, with a margin.** An exact tie (two equal shapes kissing at a corner, a
     checkerboard) is structurally symmetric. Where the pre-threshold crack field shows a real
     anti-aliasing ramp in the 2x2 block (not the saturated 5/250 step the crack interpolation
     already ignores, and still agreeing with the mask), the asymptotic decider of Nielson and
     Hamann (1991, "The asymptotic decider: resolving the ambiguity in marching cubes", IEEE
     Visualization '91) is consulted: the bilinear interpolant of the four threshold residuals
     r = luma - threshold has saddle value (r00 r11 - r10 r01) / (r00 + r11 - r10 - r01), and ink
     joins only if that value is more than 2 luma levels on the ink side of the cut. Otherwise, and
     on binary input, paper joins (the historical answer). The margin is required: a symmetric
     saddle's bilinear value is the block mean, so a fine checkerboard, or the bilinear enlargement
     of a binary one that small sources trace at 2x, reads 127.5 against a cut of 128, and its sign
     is noise, not evidence. The margin is only 2 levels (the ±0.5 of that symmetric value plus 8-bit
     rounding), so real anti-aliased ties a few levels off the cut still decide. A pixel whose luma
     sits exactly on the cut agrees with either class (the brightness band's cut is inclusive, the
     global and sketch cuts are strict).
3. One decision everywhere. The walker, despeckle (ink BFS takes a diagonal step only where the
   corner resolves to ink) and pinhole fill (paper flood takes a diagonal step only where it
   resolves to paper) build the same resolver from the same policy, crack field and pixel scale,
   so a hairline the walker traces as one loop is one component for cleanup. Centerline keeps
   8-connected ink and 4-connected paper. The Edge Detection lane and non-trace callers of
   `traceBoundaryLoops` (barcode module contours) keep the historical rule, which is the function's
   default.
4. Topology is unchanged in kind. Both passes through a joined saddle ask the same resolver, so the
   in/out edge pairing is consistent: loops may touch at the corner point but never cross, and after
   the mid-crack step the two passes run 0.71 px apart. Holes keep opposite orientation (a closed
   diagonal ring becomes an outer loop plus a hole; signed areas still sum to the ink count). The
   finished outlines still go through `preserveContourTopologySteps`.

Why the window outranks the decider (the brief proposed the decider first): bilinear reconstruction
systematically under-reads ridges. On a 1-px anti-aliased 45 degree line (core luma 24, flanks 195)
the true area-sampled value at the shared corner equals the core, but the bilinear saddle value is
the midpoint, about 110. Beside a solid square, Otsu cut that image at 25, and the decider-first
design shattered Sharp's line into 56 islands and made Smooth drop it (measured). Letting grey
evidence decide only what the structure cannot keeps every thin feature and still uses the
continuous model where it is informative.

Considered and not adopted:

- A mirrored (reflect-101) border window. It keeps a 1-px checkerboard tied but breaks the parity of
  any wider cell (a 2x2-cell board, or any board on the 2x path), so the border would join ink again.
- Letting pinhole fill ignore ink-joined saddles when it decides what is enclosed. The margin removes
  the checkerboard weld at its cause, and a fill that disagrees with the walker about enclosure would
  reintroduce the inconsistency this decision removes.
- A saddle-density guard for dithers and noise (below). A dither is legitimately diagonal-connected
  texture, the same answer a minority turn policy gives, and a density guard would re-break a
  hairline wherever it crosses texture. Ignore/despeckle remains the noise control.

### Consequences

- Diagonal hairline matrix, 200x200, 80-px line, recall of the line's own pixels (anti-aliased truth
  = luma < 128), outlines covering the line, base to this change. Potrace 1.16 (default options) on
  the same binarized masks for reference.

  | Case | Line Art | Smooth | Sharp | Potrace 1.16 |
  |---|---|---|---|---|
  | binary 45°, alone | 0 outlines, 0.000 to 1 outline, 1.000 | 1, 1.000 to 1, 1.000 | 57 islands, 1.000 to 1, 1.000 | 1, 1.000 |
  | binary 45°, square | 0, 0.000 to 1, 1.000 | 0, 0.000 to 1, 1.000 | 57 islands to 1, 1.000 | 1, 1.000 |
  | binary 30°/60°, alone | 0, 0.000 to 1, 0.826/0.826 | 1, 1.000/0.913 to same | 40 islands to 1, 0.928/0.928 | 1, 0.870/0.870 |
  | binary 30°/60°, square | 0, 0.000 to 1, 0.826/0.826 | 0, 0.000 to 1, 0.899/0.899 | 40 islands to 1, 0.928/0.928 | 1, 0.870/0.870 |
  | AA 45°, alone | 0, 0.000 to 1, 1.000 | 1, 1.000 to 1, 1.000 | 57 islands to 1, 1.000 | 1, 1.000 |
  | AA 45°, square | 0, 0.000 to 1, 1.000 | 0, 0.000 to 1, 1.000 | 56 islands to 1, 1.000 | 1, 1.000 |
  | AA 30°/60°, alone | 2, 0.863/0.875 to 1, 0.963/0.975 | 1, 0.975/0.938 to same | 7 islands to 1, 1.000/1.000 | 1, 0.863/0.887 |
  | AA 30°/60°, square | 0, 0.000 to 1, 0.963/0.975 | 0, 0.000 to 1, 0.887/0.887 | 30 islands to 1, 0.988/0.988 | 1, 0.863/0.887 |

  Every cell is now exactly one outline with no self or cross intersections. The brief's 0.9
  recall target is met in 28 of the 36 cells; the eight below it are the two finishing limits under
  "Remaining gaps" (Line Art binary 30°/60°, 4 cells; Smooth 30°/60° beside the square, 4 cells).
- Hairlines attached to broad ink (45°, 80 px, into a 60-px block; recall of the hairline's own
  pixels), base to this change: T-junction into a side, Line Art 0.000 to 0.238, Smooth 0.000 to
  0.550, Sharp 80 islands to 1 outline at 1.000; touching a corner, Line Art 0.000 to 0.225, Smooth
  0.000 to 0.688, Sharp 81 islands to 1 outline at 0.900 (the same at 200 and 600 px). Connectivity
  is now right in every preset (one outline with the block); the width loss is finishing, below.
- The user's art (1254x1254), base to this change, IoU against the image's own luma < 128 mask:
  owl Line Art 0.8714 to 0.8837 (recall 0.9280 to 0.9392, precision 0.9345 to 0.9374), Smooth
  0.8382 to 0.8496, Sharp 0.9373 to 0.9370 with 14,389 to 10,870 outlines; hummingbird Line Art
  0.8065 to 0.8226, Smooth 0.8185 to 0.8364, Sharp 0.9321 to 0.9317 with 11,348 to 7,977 outlines.
  Line Art and Smooth keep thin diagonal detail they used to erase (owl Line Art 2,187 to 2,384
  outlines, points +9%); Sharp merges its diagonal islands. `'connect-paper'` on this code gives the
  base numbers exactly.
- Pinhole fill under `'auto'` is a default change of its own: a 1-px diagonal paper crack that
  reaches the open background diagonally is a notch, not an enclosed pinhole, and is no longer
  filled (the same crack enclosed in ink still is). Isolated by giving `'auto'` the old 4-connected
  flood and nothing else: owl Line Art 0.8771 to 0.8837 (precision 0.9296 to 0.9374), Smooth
  0.8433 to 0.8496; hummingbird Line Art 0.8119 to 0.8226, Smooth 0.8223 to 0.8364. The arch-house
  baseline, edge-quality, apex and reference-loop fixtures pass unchanged.
- Checkerboards: every saddle of a checkerboard ties, at any cell size and at the image border, and
  on binary input (and the 2x path's bilinear enlargement of it) the tie keeps the historical
  answer. Measured end to end, auto against base: full-frame 1-px boards at 150, 300 and 600 px and
  a full-frame 2x2-cell board at 300 px trace exactly as before: 0 outlines in Line Art and Smooth,
  and in Sharp one loop per ink cell (11,250 / 45,000 / 180,000 for the 1-px boards, 11,250 for
  the 2x2-cell board). A 1-px board as a 100x100 patch on a
  white page is not a tie along the patch rim, where ink is the local minority; Line Art keeps 2
  thin rim outlines (recall 0.05, base 0), Smooth 2 (base: the patch welded solid, precision 0.50),
  and Sharp joins rim cells (4,610 outlines instead of 5,000). Two squares touching at one corner
  stay two outlines in all three presets.
- Cost on dense-saddle inputs (auto against base, same machine, timings noisy): a Floyd-Steinberg
  dithered 400x400 horizontal gradient in Line Art goes from 115 to 335 outlines and 7,708 to 51,887
  points, IoU 0.562 to 0.634 (recall 0.641 to 0.761, precision 0.819 to 0.793), 1.4 to 3.1 s; in
  Smooth 60 to 193 outlines, 5,591 to 34,393 points, IoU 0.544 to 0.595, 1.2 to 2.4 s. A 200x200
  block with 20% salt noise on a 400x400 page: Line Art 65 to 220 outlines, 3,761 to 14,628 points,
  IoU 0.509 to 0.547; Smooth 51 to 60 outlines. At 3% noise nothing changes beyond the point count
  (one outline, IoU 0.886 both ways). A full-frame 600x600 1-px checkerboard in Line Art: 0.6-0.8
  to 1.0-1.6 s across runs (every pixel corner is a saddle, each judged over an 8x8 window at 2x).
  Dithers are kept as connected texture on purpose (see "Considered"); Ignore/despeckle stays the
  control for them.
- Behaviour a user can see: Ignore/despeckle now measures a diagonal hairline as one component, so
  `despeckleMinPixels` 4 no longer erases a 24-px 1-px diagonal (it removes the detached 1-3 px marks
  and keeps the line); a larger value still removes it.
- Tests changed with this decision: `sharp-fine-marks.test.ts` (the explicit-removal case pinned the
  per-pixel erasure; it now asserts the hatch marks go, the diagonal stays as one outline, and Ignore
  25 removes everything) and `centerline-preset-scale.test.ts` (it pinned Line Art erasing a 12-px
  diagonal that Centerline keeps; both now keep it, and `turnPolicy: 'connect-paper'` still erases
  it), and `trace-supersample-support.test.ts` (its cap on pixels the 2x support restore changes
  rises from 300 to 320: base 84 Line Art / 249 Smooth, now 120 / 305, because the enlarged mask
  resolves corners from source-pixel evidence and a few Smooth ties sit at the symmetric 127.5
  against a cut of 128, which is not evidence, so paper joins and native support restores them).
  The historical contour-boundary test now states that the function default is the historical
  rule. New: `saddle-connectivity.test.ts`, the saddle cases in `contour-boundary.test.ts` (loop
  areas of 1-px and 2x2-cell checkerboards pinned, border corners included),
  `preprocess.test.ts` and `fill-pinholes.test.ts`, and `trace-diagonal-hairline.test.ts` (the
  matrix above end to end, attached hairlines, end-to-end checkerboards, and the historical failure
  under `'connect-paper'`).
- Each stage decides on its own mask. Despeckle or pinhole fill can change pixels inside a later
  saddle's window, so the walker can occasionally judge a corner differently from the cleanup
  that preceded it; the worst case is a kept component traced as two pieces, which the contour
  Ignore area gate then filters.
- Merge note: `trace-image.ts` is shared; this decision only threads the crack field into
  `cleanBinaryMask` and routes its despeckle and pinhole fill through the shared policy.

Remaining gaps (not connectivity; each hairline above is one outline):

- A hairline attached to broad ink loses most of its width in Line Art (recall 0.225 to 0.238) and
  about half in Smooth (0.550 to 0.688), against 0.900 to 1.000 in Sharp. The walker's loop is
  right (block plus ribbon; at 2x a staircase area of 14,720 = 14,400 + 320 px), but the legacy
  finishing tail simplifies the block's large loop at a tolerance wider than the 1-px ribbon
  (Douglas-Peucker at 0.9 px drops the area to 14,561, the spline refine to 14,443), so the tail
  collapses to a zero-area spike. A free-standing hairline is its own small loop and keeps its
  width. Closing this needs a width-aware simplification tolerance in the contour finishing tail.
- Line Art, binary 30°/60° lines at small sizes: 0.826 against Potrace's 0.870. Sources under 260 px
  trace on a 2x bilinear enlargement, and crack interpolation on the enlarged binary staircase pinches
  the ribbon at every step (loop area 60 of 69 px). Owned by the supersampling path.
- Smooth, 30°/60° beside the square: 0.899 binary and 0.887 anti-aliased, against Potrace's 0.870
  and 0.863/0.887. Smooth's wider simplification finishes the ribbon as a coarse polygon (13
  points for 69 px) that cuts the staircase's outer pixels.
- Anti-aliased 30°/60° hairlines on larger canvases (400x400): Line Art 0.789. Linear crack
  interpolation assumes a ramp, so a sub-pixel-wide ridge whose core is not full ink comes out about
  16% thinner (area 134 of 160 px). A moment-preserving crossing for ridge pixels would close it.

Not part of this decision: UI for the policy; the Edge Detection lane; the finishing gaps above.
