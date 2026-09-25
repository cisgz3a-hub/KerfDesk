## ADR-395 - Filled traces resolve diagonal pixel contacts with one shared turn policy (2026-09-25)

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
   (unknown values read as `'auto'`). No UI in this change. `'connect-paper'` is the historical
   walker rule; `'connect-ink'` makes ink 8-connected everywhere.
2. `'auto'` decides each saddle corner (`saddle-connectivity.ts`):
   - **Structure first — a 4x4 minority window.** Count ink and paper over the 4x4 pixels centred
     on the corner (the 2x2 block plus its one-pixel ring; pixels beyond the image border are not
     counted, so the walker's out-of-image paper convention cannot make shapes near an edge look
     thin). The block is always 2 ink / 2 paper, so the ring decides. The colour that is the
     minority is the thin one and keeps its diagonal: a 1-px ink diagonal (4 of 16 ink) connects;
     a 1-px paper crack through solid ink (4 of 16 paper) stays open and splits the ink.
   - **Ties use grey levels.** An exact tie (two equal shapes kissing at a corner, a checkerboard)
     is structurally symmetric. Where the pre-threshold crack field shows a real anti-aliasing ramp
     in the 2x2 block (not the saturated 5/250 step the crack interpolation already ignores, and
     still agreeing with the mask), the asymptotic decider of Nielson and Hamann (1991, "The
     asymptotic decider: resolving the ambiguity in marching cubes", IEEE Visualization '91)
     settles it: the bilinear interpolant of the four threshold residuals r = luma - threshold has
     saddle value (r00 r11 - r10 r01) / (r00 + r11 - r10 - r01), and ink joins iff that value is on
     the ink side of the cut. Binary ties keep the historical answer: paper joins.
3. One decision everywhere. The walker, despeckle (ink BFS takes a diagonal step only where the
   corner resolves to ink) and pinhole fill (paper flood takes a diagonal step only where it
   resolves to paper) build the same resolver from the same policy and crack field, so a hairline the
   walker traces as one loop is one component for cleanup. Centerline keeps 8-connected ink and
   4-connected paper. The Edge Detection lane and non-trace callers of `traceBoundaryLoops` (barcode
   module contours) keep the historical rule, which is the function's default.
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

### Consequences

- Diagonal hairline matrix, 200x200, 80-px line, recall of the line's own pixels (anti-aliased truth
  = luma < 128), outlines covering the line, base to this change. Potrace 1.16 (default options) on
  the same binarized masks for reference.

  | Case | Line Art | Smooth | Sharp | Potrace 1.16 |
  |---|---|---|---|---|
  | binary 45°, alone | 0 outlines, 0.000 to 1 outline, 1.000 | 1, 1.000 to 1, 1.000 | 57 islands, 1.000 to 1, 1.000 | 1, 1.000 |
  | binary 45°, square | 0, 0.000 to 1, 1.000 | 0, 0.000 to 1, 1.000 | 57 islands to 1, 1.000 | 1, 1.000 |
  | binary 30°/60°, alone | 0, 0.000 to 1, 0.826/0.826 | 1, 1.000/0.913 to same | 40 islands to 1, 0.928/0.928 | 1, 0.870/0.870 |
  | binary 30°/60°, square | 0, 0.000 to 1, 0.826/0.826 | 0, 0.000 to 1, 1.000/0.913 | 40 islands to 1, 0.928/0.928 | 1, 0.870/0.870 |
  | AA 45°, alone | 0, 0.000 to 1, 1.000 | 1, 1.000 to 1, 1.000 | 57 islands to 1, 1.000 | 1, 1.000 |
  | AA 45°, square | 0, 0.000 to 1, 1.000 | 0, 0.000 to 1, 1.000 | 56 islands to 1, 1.000 | 1, 1.000 |
  | AA 30°/60°, alone | 2, 0.863/0.875 to 1, 0.963/0.975 | 1, 0.975/0.938 to same | 7 islands to 1, 1.000/1.000 | 1, 0.863/0.887 |
  | AA 30°/60°, square | 0, 0.000 to 1, 0.963/0.975 | 0, 0.000 to 1, 0.887/0.887 | 30 islands to 1, 0.988/0.988 | 1, 0.863/0.887 |

  Every cell is now exactly one outline with no self or cross intersections.
- The user's art (1254x1254), base to this change, IoU against the image's own luma < 128 mask:
  owl Line Art 0.8714 to 0.8837 (recall 0.9280 to 0.9393), Smooth 0.8382 to 0.8497, Sharp 0.9373 to
  0.9372 with 14,389 to 10,879 outlines; hummingbird Line Art 0.8065 to 0.8226, Smooth 0.8185 to
  0.8361, Sharp 0.9321 to 0.9317 with 11,348 to 7,983 outlines. Line Art and Smooth keep thin
  diagonal detail they used to erase (owl Line Art 2,187 to 2,384 outlines, points +9%); Sharp
  merges its diagonal islands. Trace time moved within the run-to-run noise of the shared test
  machine, with Line Art up to about 20% slower (owl 4.0 to 4.5-4.9 s) where it now keeps more outlines.
- Tie-break and checkerboards are deterministic: every saddle of a 1-px or 2-px checkerboard is an
  exact tie, so on binary input each ink cell stays its own loop, as before. Two squares touching at
  one corner stay two outlines in all three presets.
- Behaviour a user can see: Ignore/despeckle now measures a diagonal hairline as one component, so
  `despeckleMinPixels` 4 no longer erases a 24-px 1-px diagonal (it removes the detached 1-3 px marks
  and keeps the line); a larger value still removes it. A 1-px diagonal paper crack that reaches the
  open background diagonally is a notch, not an enclosed pinhole, and is no longer filled.
- Tests changed with this decision: `sharp-fine-marks.test.ts` (the explicit-removal case pinned the
  per-pixel erasure; it now asserts the hatch marks go, the diagonal stays as one outline, and Ignore
  25 removes everything) and `centerline-preset-scale.test.ts` (it pinned Line Art erasing a 12-px
  diagonal that Centerline keeps; both now keep it, and `turnPolicy: 'connect-paper'` still erases
  it). The historical contour-boundary test now states that the function default is the historical
  rule. New: `saddle-connectivity.test.ts`, the saddle cases in `contour-boundary.test.ts`,
  `preprocess.test.ts` and `fill-pinholes.test.ts`, and `trace-diagonal-hairline.test.ts` (the matrix
  above end to end, plus the historical failure under `'connect-paper'`).
- `'connect-paper'` reproduces the historical walker and despeckle; its pinhole fill now joins paper
  diagonally, as its walker always did.
- Each stage decides on its own mask. Despeckle or pinhole fill can change pixels inside a later
  saddle's 4x4 window, so the walker can occasionally judge a corner differently from the cleanup
  that preceded it; the worst case is a kept component traced as two pieces, which the contour
  Ignore area gate then filters.

Remaining gaps (not connectivity; each cell above is one outline):

- Line Art, binary 30°/60° lines at small sizes: 0.826 against Potrace's 0.870. Sources under 260 px
  trace on a 2x bilinear enlargement, and crack interpolation on the enlarged binary staircase pinches
  the ribbon at every step (loop area 60 of 69 px). Owned by the supersampling path.
- Anti-aliased 30°/60° hairlines on larger canvases (400x400): Line Art 0.789. Linear crack
  interpolation assumes a ramp, so a sub-pixel-wide ridge whose core is not full ink comes out about
  16% thinner (area 134 of 160 px). A moment-preserving crossing for ridge pixels would close it.
- Smooth's wider simplification leaves 0.887 on AA 30°/60° beside the square, level with Potrace.

Not part of this decision: UI for the policy; the Edge Detection lane; the two geometry gaps above.
