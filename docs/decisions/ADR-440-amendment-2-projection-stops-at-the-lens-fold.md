## ADR-440 Amendment 2 - A bed point wider than the lens images is not drawn (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

The Kannala-Brandt polynomial `theta_d(theta)` can turn back at an angle `fisheyeAngleLimit`. The
inverse map (`undistortPixel`, `pixelToBed`) already refuses pixels past that turn, and
`fitDeterminedLens` refuses a lens that turns back inside its picture (ADR-441 Amendment 4). The
forward map (`projectCameraPoint`, and the overlay shader that mirrors it) did not check the angle.
Past the turn `theta_d` falls again, so a bed point far outside the picture could land on a pixel
inside it, one that really sees another part of the bed.

Reproduced in a test: a 1280 × 720 lens with `k4 = -0.05` turns back at 63.3°, beyond its picture
corners, so the fit accepts it. With the camera 300 mm straight above the bed, a point 1739 mm away
(80° off the axis) projected to pixel x 933, which sees the bed 115 mm away. The flattened bed picture
was fully opaque there, and the overlay drew it. Trace from camera, camera Print and Cut marks, Find
pieces and the job watch all read the same flattened picture.

### Decision

1. `projectCameraPoint` returns null for a ray whose angle from the axis exceeds
   `fisheyeAngleLimit(lens.distortion)`, as it does for a point behind the camera. Every forward
   projection, the fit's residuals included, goes through it.
2. The overlay shader gets the limit as the uniform `uAngleLimit` and leaves such a fragment
   transparent; its CPU mirror does the same, so the existing mirror-to-model tests still hold it to
   `projectWorldPoint`.
3. `fisheyeAngleLimit` caches its answer by the distortion tuple's identity, because every projected
   point now asks for it.

### Consequences

- Bed points the camera cannot image stay transparent rather than showing a folded copy of the
  picture. A lens that never turns back (limit pi/2) behaves exactly as before.
- Code and test evidence only (`camera-model.test.ts`, `bed-image.test.ts`,
  `bed-overlay-shader.test.ts`; each fails without the change). No camera was used.
