# Sharp trace detail audit, 12 September 2026

The reported dragon traces lose fine marks and white channels. Smooth was the
first screenshot; Sharp was the better second trace and the requested upgrade.
The investigation separates the binary mask, finished vectors, and canvas display.

## Reproduction

The exact original is `src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png`,
1254 × 1254, SHA-256
`e4b23a55c73c679b81889ac86a07efccd62039619b9758d63a96ca492032f846`.
The screenshots are useful visual evidence but were not traced as replacement inputs.

Three independent detail losses were reproduced:

1. Sharp's four-connected despeckle threshold of four source pixels erased
   detached 1–3 pixel marks and fragments of diagonal hatching before tracing.
   On the dragon, disabling that removal retains 4,486 additional ink pixels.
2. The canvas's fixed vertex stride could collapse a closed square
   `[A, B, C, D, A]` into `[A, C, A]`, changing its area from nonzero to zero.
   Applying it to the saved original Sharp dragon vectors collapsed 431 loops.
   These were display losses; the saved source vectors still contained the detail.
3. Curve bend sharpening could distort a one-pixel-wide stem longer than the
   existing one-cell feature guard. A 1 × 6 pixel stem survived preprocessing
   but lost pixel coverage during finishing. The inverse white-channel fixture
   also failed. This is a separate binary-art defect: neither the old nor the
   extended guard finds anchors in the dragon's eligible loops, so it does not
   explain the dragon's improvement.

Smooth additionally fills eligible enclosed hairline gaps and removes more ink
specks. Its preparation is intentionally different from Sharp. The Sharp upgrade
keeps its native-resolution policy and automatic Otsu threshold; it does not
invent geometry for grey detail excluded by that binary threshold.

## Changes

- Sharp retains single-pixel features by default. The existing Remove ink specks
  control still lets the operator choose stronger cleanup for noisy sources.
- Straight one-pixel terminal stems and channels keep their cap and mouth during
  finishing. The regular curve fitting and smoothing stages remain active.
- Filled canvas geometry retains closed boundaries. A bounded native drawing
  cache reuses immutable geometry across object and viewport transformations;
  the existing sampling policy still handles very large collections of open lines.

## Verification

Focused regressions cover the default Sharp diagonal and detached marks, explicit
cleanup overrides, and binary stems/channels under rotation and reflection.
Existing antialiased-circle, ordinary-cap, subpixel, roundness and straightness
controls passed during the finishing change.

The complete tracing suite passes: 600 tests in 81 files.
The trace interface and batch export suite passes: 319 tests in 35 files.
Fallback disclosure fixtures explicitly request speck cleanup so they still
exercise actual recovery; Sharp's default now retains their tiny source marks
on the first attempt.

An isolated Chrome 153 worker comparison using the actual dragon measured:

| Sharp preparation | Closed contours | Vertices | Worker time |
| --- | ---: | ---: | ---: |
| Previous cleanup, area 4 | 4,621 | 306,755 | 23.76 s |
| Fine marks retained, area 1 | 7,711 | 348,018 | 24.23 s |

These are local observations, not universal timing guarantees. Both used the
unchanged 30-second compute budget and allowed the page timer to keep advancing.
The additional contours can include source noise; the explicit cleanup control
remains available. Machine operation and physical engraving were not tested.

Native rendering was also measured with a pixel readback after each draw, so
deferred raster work is included. Across 24 pan/zoom views at 900 × 780 pixels,
the complete upgraded Sharp geometry drew in a median 19.1 ms / P95 25.0 ms;
the previous sampled baseline was 16.9 ms / 21.6 ms. Uncached complete point
replay was 36.5 ms / 42.5 ms. Fresh canvases per case avoid Chrome migrating a
repeatedly read-back canvas to a different backing. Geometry is retained exactly; native cached and
direct drawing can use different edge antialiasing, so pixel identity is not
claimed. Unsafe native-coordinate precision uses the existing direct drawing
path, including large source offsets cancelled by object translation.
