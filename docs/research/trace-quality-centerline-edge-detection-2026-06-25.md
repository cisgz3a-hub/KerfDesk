# Centerline And Edge Detection Trace Quality Research

**Date:** 2026-06-25
**Repo:** `C:\Users\Asus\LaserForge-2.0`
**Scope:** LaserForge Trace Image quality for `traceMode: "centerline"` and
`traceMode: "edge"`.
**Goal:** define the research-backed path to 10/10 tracing quality for laser use,
without copying GPL or third-party code.

## Executive Summary

LaserForge should treat centerline tracing and edge detection as two related but
different products:

- **Centerline** is for dark strokes that should engrave once down the middle.
  The hard problem is not just thinning to one pixel. The hard problem is stable
  stroke-center extraction, branch pruning, junction reasoning, gap repair, and
  curve fitting that preserves letters and corners.
- **Edge Detection** is for brightness/color transitions in full-color or shaded
  artwork. The hard problem is not just running Canny. The hard problem is
  parameter selection, multi-scale noise/detail tradeoffs, edge linking,
  subpixel localization, and vector fitting without creating doubled or broken
  burn paths.

Current LaserForge has a good foundation:

- `src/core/trace/trace-to-paths.ts` routes filled contours, centerline, and edge
  detection through separate engines.
- `src/core/trace/centerline-trace.ts` now preprocesses, thins, extracts, chains,
  and fits open paths.
- `src/core/trace/canny-edges.ts` and `src/core/trace/canny-gradient.ts` implement
  a clean-room Canny-style edge detector.
- `src/__fixtures__/perceptual/centerline-bar.test.ts` is the right kind of
  metric gate, because it measures traced output against ground-truth strokes.

But the present quality ceiling is not 10/10 yet:

- Centerline still depends on Zhang-Suen thinning, which is topology-preserving
  but not reliably centered at corners and can create gaps/spurs from noisy or
  anti-aliased input.
- Edge Detection currently has hardcoded Canny defaults and no user-facing
  sensitivity/detail controls.
- Edge paths are extracted by reusing the centerline skeleton extractor. That is
  a decent first slice, but a true edge tracer should link non-maximum-suppressed
  edge pixels using gradient direction, not generic stroke-skeleton logic.
- Tests prove basic correctness and regression safety, but not yet enough
  real-artifact quality across text, logos, scanned drawings, photos, and small
  laser-relevant marks.

The 10/10 path is therefore:

1. Build a stronger artifact harness first.
2. Make Canny parameters data-driven and user-tunable.
3. Replace centerline's thinning-only core with distance-transform-informed
   medial/skeleton logic plus deterministic branch pruning.
4. Add an edge-specific linker and curve fitter.
5. Add optional grayscale ridge/line detection for anti-aliased strokes, based on
   Steger-style line detection research, as a later centerline quality tier.
6. Keep GPL tools such as Inkscape/Potrace as references only. Do not copy code.

## Current LaserForge Architecture

### Trace entry points

Current code routes trace modes in `src/core/trace/trace-to-paths.ts`:

- `traceMode: "centerline"` -> `traceImageToCenterlinePaths`
- `traceMode: "edge"` -> `traceImageToEdgePaths`
- binary filled contours -> custom Potrace-style backend where possible
- other tracedata paths -> `imagetracerjs`

This separation is correct. We should not collapse the modes into one generic
tracer.

### Centerline pipeline today

Current centerline flow:

1. `preprocessForTrace(image, options)`
2. `centerlineMaskFromImage(prepared)`
3. `thinMask(sourceMask, width, height)`
4. `squaredDistanceToBackground(sourceMask, width, height)`
5. `extractCenterlinePolylines(...)`
6. `fitCenterlinePoints(...)`

Recent ADR-058 work improved the pipeline with:

- junction chaining in `centerline-chain.ts`
- divide-and-conquer skeleton extraction in `centerline-divide.ts`
- allocation-conscious thinning in `centerline-mask.ts`
- centerline regression fixtures under `src/__fixtures__/perceptual`

Current measured fixture results from
`pnpm vitest run src/__fixtures__/perceptual/centerline-bar.test.ts
src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts`:

| Fixture | Max deviation | Max gap | Fragments |
| --- | ---: | ---: | ---: |
| h-stroke | 0.5 px | 1.58 px | 1 |
| diagonal-stroke | ~0 px | 0.71 px | 1 |
| l-corner | 1.48 px | 1.58 px | 1 |
| cross | 0.5 px | 1.58 px | 2 |
| arc | 0.59 px | 1.58 px | 1 |

This is a good regression bar. It is not yet a complete quality bar because it
does not cover thin real text, noisy scans, threshold failure modes, edge mode
parameter sensitivity, or reference-output comparisons.

### Edge pipeline today

Current edge flow:

1. `cannyEdges(image)`
2. `computeGradient(image, sigma)`
3. Gaussian blur
4. Sobel gradient magnitude/direction
5. non-maximum suppression
6. double-threshold hysteresis
7. reuse `extractCenterlinePolylines` to turn the 1px edge map into open paths

The implementation is clean-room and deterministic. The biggest missing product
piece is control: `DEFAULT_BLUR_SIGMA`, `DEFAULT_LOW_RATIO`, and
`DEFAULT_HIGH_RATIO` are hardcoded. Inkscape, OpenCV, and real operator workflows
all show that Canny thresholds must be tunable because "good" depends on source
noise, scale, contrast, and desired detail density.

## Research Findings

### 1. Canny's original quality criteria are still the right edge bar

John Canny's 1986 paper defines edge quality by three criteria:

- detect real edges and avoid false edges
- localize edges accurately
- avoid multiple responses to one edge

The paper also makes the scale tradeoff explicit: smoothing improves detection
under noise but reduces localization/detail. Its practical detector marks local
maxima in the gradient magnitude of a Gaussian-smoothed image and uses hysteresis
thresholding.

LaserForge implication:

- Edge Detection cannot be one fixed preset. It needs at least:
  - blur/detail scale
  - low/high hysteresis thresholds or a single sensitivity control that maps to
    both
  - minimum edge length/noise pruning
  - artifact preview before commit
- The quality metrics must directly measure Canny's criteria:
  - false positive edge pixels or paths
  - missed edge coverage
  - localization error against expected boundaries
  - duplicate parallel responses

Sources:

- Canny, "A Computational Approach to Edge Detection", IEEE TPAMI 1986:
  https://cecas.clemson.edu/~ahoover/ece431/refs/Canny.pdf
- Canny MIT AI Lab thesis/report, "Finding Edges and Lines in Images":
  https://dspace.mit.edu/handle/1721.1/6939
- MIT Press / MIT CSAIL vision book landing page:
  https://visionbook.mit.edu/

### 2. Inkscape's architecture lesson is more important than its code

Inkscape's trace subsystem is GPL, so LaserForge must not copy source. The useful
lesson is architectural:

- Inkscape has a generic trace engine boundary.
- It treats preprocessing, tracing, and post-processing as separable concerns.
- Its trace directory README explicitly calls out the ideal separation:
  preprocessing -> tracing engine -> post-processing.
- Its Trace Bitmap UI exposes distinct operator-facing modes:
  brightness cutoff, edge detection, color quantization, autotrace, and
  centerline tracing.

The official Inkscape manual describes:

- **Brightness cutoff** as silhouette tracing.
- **Edge detection** as tracing contours of a shape.
- **Centerline tracing** as reducing a shape to an open path, best for
  handwritten text and line drawings.

LaserForge implication:

- Keep centerline and edge detection as separate trace modes and controls.
- Do not expose one vague "trace quality" knob that drives all modes.
- Keep preprocessing explicit and visible in the preview, because edge, outline,
  and centerline need different preprocessing.
- Do not copy Inkscape. Inkscape's own `COPYING` says most source is GPL-2.0-or-
  later and binaries are GPL-3.0-or-later. Its trace files also carry GPL SPDX
  headers.

Sources:

- Inkscape Trace Bitmap manual:
  https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html
- Inkscape trace README:
  https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_4_3/src/trace/README
- Inkscape trace interface:
  https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_4_3/src/trace/trace.h
- Inkscape Canny/Potrace glue references:
  https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_4_3/src/trace/filterset.cpp
  https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_4_3/src/trace/potrace/inkscape-potrace.cpp
- Inkscape license:
  https://gitlab.com/inkscape/inkscape/-/raw/master/COPYING

### 3. Potrace is the filled-outline gold standard, not a centerline answer

Potrace's algorithm is designed for smooth vector outlines of binary bitmaps:

1. decompose bitmap into boundary paths
2. approximate each path with an optimal polygon
3. transform polygons into smooth curves
4. optionally optimize Bezier curves

That is excellent for filled contours. It is not the same as centerline tracing.
For laser work, using filled outlines on text/strokes often creates doubled
letters or burns both sides of a stroke, which is exactly what centerline mode is
supposed to avoid.

LaserForge implication:

- Keep the custom Potrace-style filled contour backend for `Line Art`.
- Do not use Potrace-style boundary tracing for centerline output.
- Do borrow the quality lesson: path scanning -> polygon simplification -> curve
  smoothing is a clean pipeline, and every stage needs a metric.

Sources:

- Potrace home:
  https://potrace.sourceforge.net/
- Potrace paper:
  https://www.mathstat.dal.ca/~selinger/potrace/potrace.pdf

### 4. VTracer is MIT-licensed and worth evaluating, but it is not a direct
centerline replacement

VTracer is MIT-licensed and designed for raster-to-vector conversion with color
clustering, path walking, simplification, smoothing, and curve fitting. Its docs
emphasize:

- clustering before tracing
- path walking from pixel clusters
- staircase removal
- penalty-based simplification
- corner-preserving smoothing
- curve splicing by inflection/angle displacement

VTracer itself notes possible future "pencil tracing" by skeletonizing shapes as
open paths. That means it is not currently a complete centerline answer, but it
contains valuable MIT-compatible ideas for:

- better filled/colored vectorization later
- corner-preserving smoothing
- curve fitting and splice point controls
- source-image-size performance strategy

LaserForge implication:

- We can evaluate VTracer as a future optional filled-contour/color backend,
  especially because the license is compatible.
- For the current goal, learn the path pipeline and controls, but do not replace
  centerline/edge with a broad VTracer integration until the artifact harness can
  compare outputs.

Sources:

- VTracer GitHub:
  https://github.com/visioncortex/vtracer
- VTracer docs:
  https://www.visioncortex.org/vtracer-docs/
- VTracer MIT license:
  https://raw.githubusercontent.com/visioncortex/vtracer/master/LICENSE

### 5. Skeletonization alone is not enough for 10/10 centerline quality

Skeletonization reduces a binary foreground shape to a one-pixel topology-
preserving representation. scikit-image documents this as repeated border-pixel
removal that preserves connectivity. Its API also exposes `medial_axis`, which
computes skeleton ridges from a distance transform and can return the distance
map.

Research on medial axes shows why this is hard: the medial axis captures shape
connectivity and local thickness, but it is unstable. Small boundary
perturbations can create spurious medial branches. That exactly matches our
practical problem: dust, JPEG noise, anti-aliasing, and threshold wobble become
tiny spurs and broken branches.

LaserForge implication:

- Keep topology preservation, but add distance-aware pruning.
- A branch should survive only if its length and support radius are meaningful.
- The squared distance transform already computed by LaserForge should become
  part of branch scoring, not just a carried-along option.
- Deterministic tie-breaking matters. scikit-image notes that medial-axis
  processing order uses distance transform, cornerness, and tie-breaking; we need
  deterministic output for tests, exports, and repeatability.

Sources:

- scikit-image skeletonize example:
  https://scikit-image.org/docs/stable/auto_examples/edges/plot_skeleton.html
- scikit-image morphology API:
  https://scikit-image.org/docs/stable/api/skimage.morphology.html
- Attali, Boissonnat, Edelsbrunner, "Stability and Computation of Medial Axes":
  https://pub.ista.ac.at/~edels/Papers/2009-01-MedialAxis.pdf
- Felzenszwalb and Huttenlocher, "Distance Transforms of Sampled Functions":
  https://cs.brown.edu/people/pfelzens/papers/dt-final.pdf

### 6. Grayscale line/ridge detection is the real high-end centerline path

Binary thinning throws away grayscale profile information before centerline
extraction. Steger's work on curvilinear structures attacks a harder and more
useful problem: detect line centers and widths directly from image derivatives
and scale-space, with subpixel localization and bias correction for asymmetric
line profiles.

LaserForge implication:

- Binary centerline should remain the fast, predictable default for clean logos
  and text.
- A future "High quality centerline" engine should evaluate grayscale
  ridge/line detection before binarization for anti-aliased handwriting, scans,
  and uneven stroke widths.
- This should be added only behind the artifact harness, because ridge detectors
  have more parameters and can hallucinate lines in texture/noise.

Source:

- Steger, "An Unbiased Detector of Curvilinear Structures":
  https://mv.in.tum.de/_media/members/steger/publications/1996/fgbv-96-03-steger.pdf

## Current Quality Rating

These ratings are engineering ratings from the inspected code, current tests, and
the focused trace test run on 2026-06-25. They are not user-hardware burn ratings.

| Area | Current | Why |
| --- | ---: | --- |
| Centerline correctness | 7/10 | Good architecture and metrics; straight/diagonal/cross/arc fixtures pass. Still limited by binary thinning, corner centering, and thin-text/noisy-art gaps. |
| Centerline UX | 6/10 | Preset exists, but users do not get enough feedback about source suitability, threshold effect, gaps, or spur cleanup. |
| Centerline regression coverage | 7/10 | Strong synthetic fixture start; needs real-image artifacts and edge cases. |
| Edge correctness | 5.5/10 | Clean-room Canny works on simple square/flat tests, but parameters are fixed and linking is borrowed from centerline. |
| Edge UX | 4/10 | No sensitivity/detail controls yet. |
| Edge regression coverage | 4/10 | Basic tests only; no real-artifact precision/recall/localization bar. |
| License safety | 8/10 | Current clean-room direction is good. Needs a written no-copy boundary in the trace roadmap. |

Overall current state: **6/10** for the combined tracing goal. The foundation is
right, but 10/10 requires artifact-driven quality gates and mode-specific
engines.

## 10/10 Definition

### Centerline is 10/10 when

- Clean black-on-white text, logos, handwriting, and line drawings produce one
  burn path per intended stroke, not double outlines.
- Centerlines stay within 1 px or a documented subpixel/mm-equivalent tolerance
  of ground truth on synthetic fixtures.
- Corners stay visually centered without cutting the inside corner too deeply.
- Junctions chain in the human-expected direction.
- Spurs shorter than the local stroke radius/noise scale are removed.
- Thin text remains connected where the source is visibly connected.
- Output remains deterministic across runs.
- Large images are bounded by explicit budgets and do not freeze the UI.
- The preview, committed object, and saved G-code all use the same geometry.

### Edge Detection is 10/10 when

- Users can tune sensitivity/detail and immediately see the preview effect.
- The engine keeps long meaningful edges and rejects isolated texture/noise.
- Edge paths are single-stroke vectors, not filled outlines and not doubled
  contours.
- Edge localization is close to the visible transition.
- Internal detail in color logos survives without collapsing to a silhouette.
- The mode handles both sharp vector-like art and scanned/photo-like art by
  changing parameters, not by guessing a universal default.
- Output remains deterministic and bounded.

## Proposed Architecture

### Shared trace quality harness

Create a shared artifact harness before deeper algorithm work:

- synthetic fixtures with known ground truth:
  - horizontal, vertical, diagonal strokes
  - L corner
  - T and X junctions
  - arcs and circles
  - thin text-like strokes
  - anti-aliased strokes
  - noisy scans
  - low-contrast strokes
- real fixtures:
  - Arch House / Langebaan logo
  - small serif text
  - script font sample
  - full-color logo with internal detail
  - photo-like image that should warn "raster engrave instead"
- metrics:
  - centerline deviation and coverage gaps
  - fragment count and short-spur count
  - edge precision/recall against expected boundary masks
  - duplicate-response count
  - node/path count
  - runtime and memory guard
- artifacts:
  - source image
  - mask / edge map
  - traced vector overlay
  - diff image
  - metric JSON

### Centerline v2 engine

Keep the current fast centerline pipeline, then upgrade it in small gates:

1. **Input classification**
   - Detect clean binary art vs anti-aliased/grayscale art.
   - If grayscale confidence is high, allow the future ridge detector path.
   - If source looks photo-like, warn that raster engraving is better.

2. **Binary mask stabilization**
   - Manual cutoff/threshold remains authoritative.
   - Otsu remains automatic default only before user override.
   - Add optional morphological close/open only as explicit preset behavior.
   - Record exact preprocessing parameters in trace metadata.

3. **Distance-aware skeleton**
   - Compute exact squared EDT once.
   - Use EDT radius to score branches and junctions.
   - Prefer medial pixels with local distance ridges.
   - Keep deterministic tie-breaking by `(distance desc, cornerness asc,
     y asc, x asc)` or another documented stable rule.

4. **Iterative branch pruning**
   - Convert extracted segments into a graph.
   - For each leaf branch, compute:
     - branch length
     - max/mean local radius
     - support from source mask
     - angle continuity into parent branch
   - Remove branches when `length < k * localRadius` and source support is weak.
   - Recompute until stable. Never re-admit all branches as a fallback.

5. **Gap repair**
   - Find endpoints with matching tangent, distance, and source-mask bridge
     support.
   - Bridge only when the gap is shorter than local radius-scaled tolerance.
   - Add a metric so gap repair cannot silently connect separate letters.

6. **Junction reasoning**
   - Keep current straightest-through pairing.
   - Add local radius and angle confidence.
   - For ambiguous 3+ junctions, preserve branches instead of guessing a single
     chain.

7. **Curve fitting**
   - Preserve corners by explicit corner candidates.
   - Split curves at inflections and high angle displacement.
   - Use sampled cubic output only after fitting passes a distance-to-source
     metric.
   - Keep source pixel center convention stable.

8. **Optional grayscale ridge engine**
   - Implement only after binary centerline v2 has artifacts.
   - Use Steger-style line center/width detection from Gaussian derivatives.
   - Link line points by orientation and scale.
   - Use it for anti-aliased handwriting and scanned strokes where thresholding
     causes breaks.

### Edge v2 engine

Do not replace the clean-room Canny. Make it controllable and link edges as
edges:

1. **Canny controls**
   - `edgeBlurSigma`
   - `edgeLowThresholdRatio`
   - `edgeHighThresholdRatio`
   - `edgeMinLengthPx`
   - `edgeJoinGapPx`
   - optional single UI "Sensitivity" maps to high/low threshold pairs

2. **Auto threshold mode**
   - Keep default auto mode for beginners.
   - Compute thresholds from gradient distribution, not only max gradient.
   - Store resolved thresholds in trace preview metadata.

3. **Subpixel non-maximum suppression**
   - Current implementation uses direction buckets and neighbor pixels.
   - Improve to interpolate gradient magnitudes along the gradient direction.
   - Store subpixel offset along the gradient normal where useful.

4. **Edge-specific linking**
   - Link NMS pixels by gradient-tangent continuity.
   - Split at corners, junctions, and low-confidence gaps.
   - Remove isolated chains below minimum length.
   - Bridge small gaps only when orientation and gradient support agree.
   - Avoid centerline branch pairing rules that can mis-handle edge contours.

5. **Vector fitting**
   - Use the same corner-preserving fitting primitives as centerline.
   - Tune fit tolerance separately from centerline because edge maps are often
     noisier.

6. **Preview UX**
   - Show edge map overlay before commit.
   - Show "too many edges/noisy" warning if path count or edge density exceeds a
     threshold.
   - Let users compare before/after sensitivity changes.

## Implementation Roadmap

### Phase 0 - Freeze current evidence

Files:

- `src/__fixtures__/perceptual/*`
- `src/core/trace/*`
- `docs/research/trace-quality-centerline-edge-detection-2026-06-25.md`

Tasks:

- Save this research doc.
- Preserve current ADR-058 threshold slice until it is committed or deliberately
  folded into the next trace branch.
- Run the focused trace tests and record current fixture metrics.

Done when:

- The repo has a readable research source of truth.
- Current local dirty work is not lost.

### Phase 1 - Trace artifact harness

Files to add or extend:

- `src/__fixtures__/perceptual/trace-artifact-runner.ts`
- `src/__fixtures__/perceptual/trace-artifacts.test.ts`
- `src/__fixtures__/perceptual/edge-truth.ts`
- `src/__fixtures__/perceptual/trace-fixtures.ts`
- `audit/evidence/trace-quality-YYYY-MM-DD/`

Tests first:

- A synthetic centerline fixture fails if traced output has a gap above the
  configured limit.
- A synthetic edge fixture fails if Canny produces duplicate parallel responses.
- A real-logo fixture emits a metric JSON and overlay artifact.

Why first:

- Without artifact checks, every algorithm change can look green while producing
  ugly traced output.

### Phase 2 - Edge controls and parameter plumbing

Files:

- `src/core/trace/trace-image.ts`
- `src/core/trace/canny-edges.ts`
- `src/core/trace/canny-gradient.ts`
- `src/ui/trace/TraceSettingsControls.tsx`
- `src/ui/trace/trace-options.ts`
- `src/ui/trace/trace-options.test.ts`

Changes:

- Add edge-only options:
  - `edgeBlurSigma`
  - `edgeLowThresholdRatio`
  - `edgeHighThresholdRatio`
  - `edgeMinLengthPx`
  - `edgeJoinGapPx`
- Keep default preset simple:
  - "Sensitivity"
  - "Detail"
  - "Minimum line"
- Resolve those to Canny options in core.

Tests:

- Changing sensitivity changes edge count on a known low-contrast fixture.
- Higher blur reduces texture/noise edges but preserves a large boundary.
- Existing filled-contour and centerline presets remain byte/shape stable where
  options are untouched.

### Phase 3 - Centerline distance-aware pruning

Files:

- `src/core/trace/centerline-graph.ts`
- `src/core/trace/centerline-prune.ts`
- `src/core/trace/centerline-polylines.ts`
- `src/core/trace/centerline-distance.ts`
- `src/core/trace/centerline-prune.test.ts`

Changes:

- Preserve `extractCenterlinePolylines` public contract.
- Build graph metadata after segment extraction.
- Prune leaf branches iteratively using branch length and local EDT radius.
- Add deterministic debug metadata for tests.

Tests:

- Dust spur attached to a stroke is pruned.
- A real letter branch is preserved.
- Thin text connection is not removed.
- Pruning is deterministic.

### Phase 4 - Centerline gap repair and corner quality

Files:

- `src/core/trace/centerline-gap-repair.ts`
- `src/core/trace/centerline-fit.ts`
- `src/__fixtures__/perceptual/centerline-bar.test.ts`

Changes:

- Endpoint bridge candidates require:
  - tangent agreement
  - local radius-scaled distance
  - source mask support along the bridge
  - no conflict with nearby separate strokes
- Corner fitting uses explicit corner candidates and inflection splits.

Tests:

- Broken arc reconnects without connecting adjacent letters.
- L-corner max deviation target tightens.
- Thin script text improves without exploding node count.

### Phase 5 - Edge-specific linking

Files:

- `src/core/trace/edge-link.ts`
- `src/core/trace/edge-trace.ts`
- `src/core/trace/edge-link.test.ts`
- `src/__fixtures__/perceptual/edge-artifact.test.ts`

Changes:

- Replace centerline extractor reuse for edge maps with edge-specific linking.
- Link by gradient tangent continuity.
- Split and bridge by confidence.
- Filter by minimum chain length.

Tests:

- Square boundary produces four stable chains or one expected contour, depending
  on selected policy.
- Color logo internal edges survive.
- Noisy texture is pruned under lower detail setting.
- Edge path count and localization metrics improve.

### Phase 6 - Optional grayscale ridge centerline

Files:

- `src/core/trace/ridge-line.ts`
- `src/core/trace/ridge-link.ts`
- `src/core/trace/centerline-trace.ts`
- `src/ui/trace/trace-options.ts`

Changes:

- Add hidden/experimental engine path first.
- Use Gaussian derivative scale-space to detect line centers and widths.
- Link ridge points by orientation.
- Compare against binary skeleton output in artifact harness.

Tests:

- Anti-aliased stroke traces smoother than binary thinning.
- Uneven handwritten stroke remains centered.
- Photo-like texture does not hallucinate excessive lines.

## UX Plan

### Trace preset model

Keep these visible presets:

- Line Art
- Centerline
- Edge Detection
- Smooth
- Sharp

For **Centerline**, expose:

- Threshold / cutoff
- Despeckle
- Smoothness
- Optimize
- Minimum spur
- Repair small gaps

For **Edge Detection**, expose:

- Sensitivity
- Detail
- Minimum line
- Join small gaps

Show controls conditionally per preset. Do not show Canny ratios directly unless
an "Advanced" disclosure exists.

### Warnings

Add warnings:

- "This looks like a photo. Raster engraving will usually be better than vector
  trace."
- "Edge trace found very dense texture. Lower sensitivity or increase minimum
  line length."
- "Centerline trace found disconnected thin strokes. Try lower threshold or gap
  repair."

## Verification Plan

Every phase must pass:

- targeted trace tests
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- relevant artifact generation

Before claiming 10/10:

- Browser smoke on Trace Image:
  - import image
  - Line Art preview
  - Centerline preview
  - Edge Detection preview
  - commit output
  - inspect canvas geometry
- Compare generated artifacts for:
  - synthetic fixtures
  - Arch House / Langebaan logo
  - small script text
  - full-color logo
- Save metrics and overlays under `audit/evidence/trace-quality-YYYY-MM-DD/`.

## No-Copy And License Rules

- Inkscape source is GPL-family. Study only. Do not copy code, comments,
  structure that is expressive, or constants lifted from implementation.
- Potrace code is GPL. Study the paper and algorithmic concepts only. Do not
  copy code.
- Canny, Zhang-Suen, EDT, medial-axis, and Steger-style ridge detection are
  published algorithms/maths. Implement from papers and tests, not from
  GPL/unknown-license code.
- VTracer is MIT. It is legally more flexible, but still do not vendor or port it
  until we intentionally evaluate bundle size, WASM shape, UI fit, and whether it
  solves a LaserForge problem better than the current backends.

## Recommended Next Step

Start with **Phase 1: Trace artifact harness**.

Reason:

- Centerline and Edge Detection both need quality work.
- Without a stronger artifact harness, we cannot tell whether a change is truly
  better or merely different.
- The harness gives us the 10/10 loop: fail on artifact, implement minimal slice,
  render/measure, audit, repeat.

The first implementation slice should add edge and centerline artifact fixtures
without changing production tracing behavior.
