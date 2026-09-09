# Trace preset performance and detail upgrade

Baseline: `3324c95d39d7e5d6bf7afd120c275bc1f9891a1e` (after the Centerline upgrade).
Scope: Line Art, Smooth, Sharp and Edge Detection, with Centerline retained as a control.

## Reproduced failures and browser results

The actual PNG that exposed the timeout is checked in at
`src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png`.
It is 1254 by 1254 pixels, SHA-256
`e4b23a55c73c679b81889ac86a07efccd62039619b9758d63a96ca492032f846`.
All measurements below use the default presets and the normal PNG import, real Chrome
worker, preview, Trace and saved-project flow. These are development-browser measurements
from this change before commit; production and hosted gates are recorded with the PR.

| Preset | Baseline worker result | Upgraded worker time | Loops / paths | Vertices |
| --- | --- | --- | --- | --- |
| Line Art | Timed out at 30 seconds | 13.37 seconds | 1,804 closed | 197,421 |
| Smooth | 24.45 seconds | 16.13 seconds | 1,713 closed | 161,970 |
| Sharp | Timed out at 30 seconds | 17.37 seconds | 4,621 closed | 306,755 |
| Edge Detection | Timed out at 30 seconds | 18.38 seconds | 2,196 closed | 227,304 |
| Centerline control | Earlier qualified output | 5.01 seconds | 2,502, including 33 closed | 66,570 |

The watchdog remains 30 seconds. This image stays on the native raster grid. Preset
settings, refinement attempts and geometric contact tolerances are unchanged. Every
successful preview commits exactly the worker's geometry without tracing again. The
Centerline geometry hash remains
`831190a57060defe7d53a05e331c9d17669cc61a97b35d5886593e9da5a33f50`.
Line Art's last performance-only change reduced 24.28 seconds to 13.37 seconds with
identical output hash
`38263ab1ac3773d07e0e26f9a5d59f38bfc35fdacb9ee28a04c7736ec80b5bbf`.
No complete baseline geometry exists for the three timed-out presets.

## Changes

- Shared contour topology work now uses a two-dimensional box index, prepared winding
  queries and cached immutable loop contact work. It preserves inclusive contacts,
  exact binary64 orientation signs, original pair order and refinement order. Repeated
  attempts reuse unchanged boundaries. Cancellation does not publish partial cache entries.
- Local threshold crossings now interpolate the zero of `luma - threshold` at each
  endpoint. Averaging the two thresholds first moved a boundary when illumination varied.
  A +2/-1 residual pair crosses at two-thirds regardless of a shared brightness shift.
  Constant-threshold arithmetic and cleanup-created midpoint boundaries remain unchanged.
- Sharp retains the cap and mouth samples of a one-pixel tooth or paper notch attached
  directly to a wider body. These constraints survive sharpening and simplification
  without forcing corners into the final smooth curve or pinning every pixel staircase.
- Automatic median cleanup repairs isolated high-contrast impulses selectively. It
  preserves connected thin strokes and white counters that the previous full-frame
  median could erase. The shared Smooth preparation benefits from this correction too.
- Edge's quality profile now measures its actual local-contrast mask. Hidden filled-preset
  threshold controls no longer change Edge's scale. Native mask and threshold preparation
  is shared with tracing; an enlarged grid receives fresh measurements. Explicit forced
  median filtering retains its original working-grid order.
- Dense-colour contour downscaling restores each coordinate axis with its actual raster
  ratio. Rounded working heights previously used the width ratio, displacing one witness
  by 0.069 source pixels vertically. Canonical geometry is rebuilt on the restored grid.

## Focused qualification

- The permanent browser test now covers all five default presets on the actual dragon,
  finite coordinates, closed filled contours, even-odd preview paint, responsive UI ticks
  and exact saved geometry. The real active-worker cancellation/replacement case remains.
  All six development-browser cases passed.
- An actual Edge browser regression preserved all five one-pixel-wide, 904-pixel-long
  lines in a 1024-square image: five closed paths, 125 vertices, 346.5 ms. The baseline
  default erased every line. Preview point membership and saved geometry were checked.
- An actual Sharp browser regression retained all 27 teeth and all intervening paper
  samples across the 80-pixel feature row: one closed path, 341 vertices, 24.8 ms.
- Detail tests cover 64 rotated/reflected tooth and notch executions, thin bars, holes,
  local brightness ramps and antialiased annuli. Forty-seven unaffected geometry controls
  match the previous contour finisher exactly. The larger Sharp annulus has maximum
  radial boundary error 0.292 pixels and RMS error 0.103 pixels.
- Performance parity checks compare 5,000 box sets, 1,200 multi-loop intersection sets,
  50,748 winding queries and 300 complete repairs with 5,313 ordered refinement calls
  against the original algorithms. Another 3,600 persistent-cache comparisons cover
  repeated replacement, reordering and aliasing. Independent cache review also covers
  156 ordered contact cases and six cancellation/restart stages, including axis flips.
- Regression tests cover automatic cleanup, transparency, effective Edge controls,
  preparation reuse/invalidation, forced median order and both downscale axes.

## Limits

These timings describe one demanding image and one local browser, not a universal time
bound. Cooperative index preparation improves cancellation opportunities but does not
guarantee an eight-millisecond maximum individual step. Automatic cleanup can preserve
connected noise clusters and can remove isolated intentional dots. Sharp still smooths
tiny shapes: its unchanged 2-by-2 square area is about 2.905 pixels squared rather than 4.
The local-contrast Edge detector can still hollow broad pale regions and merge similarly
dark colours. No machine or material run was performed.

Detailed source, raw worker geometry, screenshots and parity evidence are retained locally
under `C:/Users/Asus/.codex/audits/tracing-presets-upgrade-20260909/`.
