# Trace Edge Detection And Line Mode Research - 2026-06-26

## Goal

Understand why the Edge Detection preset still looks poor around curves/corners and why switching traced edge artwork to Line mode exposes dotted, fragmented geometry.

## External Research

- Inkscape Trace Bitmap separates contour tracing from centerline tracing:
  - Brightness cutoff creates silhouette-like paths.
  - Edge detection vectorizes contours.
  - Centerline tracing reduces a shape to an open path and is intended for handwritten text and line drawings.
  - Source: https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html
- Potrace is a boundary/vector-outline algorithm:
  - bitmap path decomposition,
  - optimal polygon approximation,
  - smooth outline conversion,
  - optional Bezier curve optimization.
  - Source: https://www.mathstat.dal.ca/~selinger/potrace/potrace.pdf
- OpenCV contour extraction treats contours as continuous boundary curves and then approximates/simplifies them; `CHAIN_APPROX_SIMPLE` removes redundant straight-line points.
  - Source: https://opencv24-python-tutorials.readthedocs.io/en/latest/py_tutorials/py_imgproc/py_contours/py_contours_begin/py_contours_begin.html
- scikit-image `find_contours` uses marching squares and linearly interpolates contour positions for better precision.
  - Source: https://scikit-image.org/docs/stable/api/skimage.measure.html#skimage.measure.find_contours
- Inkscape centerline-trace reference explicitly says built-in Trace Bitmap traces edges and can produce double lines, while centerline tracing is a separate Autotrace-style workflow.
  - Source: https://github.com/fablabnbg/inkscape-centerline-trace

## LaserForge Audit

- Current LaserForge Edge Detection is a contour backend:
  - Canny edge map,
  - median denoise,
  - small edge gap closing,
  - Potrace-style closed contour smoothing.
- Current LaserForge Line mode is honest:
  - it strokes whatever polylines the trace produced.
  - If Edge Detection produced many closed edge contours, Line mode will stroke those contours. It cannot magically turn them into one-stroke centerlines.
- This means the user's Line mode screenshot is not only a rendering problem. It is a topology mismatch:
  - Edge Detection = edge contours / outlines.
  - Centerline = one-stroke line engraving.

## Rejected Experiment

I tested a Canny-edge-to-open-stroke graph walker.

Result:

- It fixed the "closed contour" property but failed curve quality.
- A clean circle became four cardinal chord-like strokes.
- Root cause: at small 2x2 edge clusters, a "straightest next edge" graph rule cuts across the curve instead of following the boundary.
- Adding thinning and small bridge passes still did not reach the circle benchmark.

Decision: do not continue bending that pixel-graph approach inside Edge Detection.

## Next Correct Fix Prompt

Fix trace quality by splitting the problem into two explicit backends:

1. **Edge Contours v2**
   - Keep Edge Detection as contour tracing, not one-stroke centerline.
   - Improve contour math with a contour-specific algorithm:
     - Canny or gradient threshold source,
     - marching-squares-style ordered contours or current Potrace path scanner,
     - curve fitting/optimization after contour order is correct.
   - Benchmark: clean circle, Arch House curves, and photo-edge fixture must pass as connected contours.

2. **Centerline / Line Mode v2**
   - Use this for one-stroke line engraving.
   - Do not derive it from Canny edge contours.
   - Use binary/logo preprocessing, skeletonization, distance-aware pruning, branch chaining, and curve fitting.
   - Benchmark: line-mode output must not show dotted/fractured geometry on the Arch House source.

3. **UI Guard**
   - Make Edge Detection copy say "edge contours" and warn that Line mode will outline detected edges.
   - Make Centerline copy say "single-line stroke engraving."
   - For logo imports, keep Line Art as default.

## Current Verification

Focused baseline after rejecting the graph-walker experiment:

- `pnpm test --run src/core/trace/edge-trace.test.ts src/__fixtures__/perceptual/edge-curve-quality.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts`
- Result: 3 files passed, 9 tests passed.
