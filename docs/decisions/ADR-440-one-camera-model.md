## ADR-440 - One camera model: a fisheye lens and a pose, from pixels to the bed at any height (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This supersedes the geometry of ADR-107 (four-corner homography), ADR-108 (checkerboard lens
calibration and de-fisheye render), ADR-109 (five-marker homography) and the warp of ADR-110.
ADR-110's trace-at-true-coordinates goal, ADR-116's single active source and ADR-121's bridge stay.

### Context

The camera feature was reported broken: calibration "useless", and nothing working in the hosted
browser. Reproduced on this base:

- The hosted https site cannot read a machine camera's pixels. The Falcon-style camera serves plain
  http stills on the local network without CORS; an https page may at most display it (Chrome's
  Local Network Access) and calibration, the corrected overlay and trace all need the pixels. Only
  the Desktop bridge (ADR-121) can read them. A USB webcam works everywhere.
- The Camera panel stopped the active source when it closed, so the overlay went blank as soon as
  the operator went back to the canvas.
- The saved geometry was a 3x3 homography per plane plus an optional lens. A homography maps one
  flat plane; the old code re-derived a pose from it to "compensate" other heights, and the lens and
  the homography were fitted separately, each absorbing the other's error. On a synthetic 1280 px
  fisheye bed the old pipeline left about 20 px of error at the corners while reporting a trusted
  calibration, and its solve ran 37 s on the main thread.
- The overlay drew the frame through CSS `matrix3d`, which is a homography: it cannot undo lens
  distortion, so the live overlay was refused as soon as a lens was calibrated.

### Decision

1. **One model.** `core/camera/model/camera-model.ts` holds a Kannala-Brandt fisheye lens
   (fx, fy, cx, cy, k1..k4, image size) and a rigid pose (Rodrigues rvec, tvec). World is bed mm,
   x right, y down, z into the bed, so a surface h mm above the bed is the plane z = -h. Pixel
   (x, y) is the pixel centre; texture coordinate is (x + 0.5) / width.
2. **Pixel to bed is a ray-plane hit** (`pixelToBed`), exact at any material height; bed to pixel
   is the forward projection. No homography, no rectified frame and no basis flag remain.
3. **Fitting** (`fit-camera-model.ts`) is one Levenberg-Marquardt over lens and pose together, with
   Marquardt scaling, several focal-length seeds, a Huber pass, then an outlier drop (residual above
   max(2 px, 5 x median)) and a refit. Weak priors keep the aspect ratio near 1 (sigma 0.01) and the
   principal point near the centre (8 % of the width). A camera looking almost straight down cannot
   tell focal length from distance in one view, so a tape-measured camera height enters as a prior
   (sigma 15 mm); the fit reports the camera height's own sigma so the wizard can ask for it.
4. **Saved record** (`camera-model-record.ts`): `DeviceProfile.cameraModel` =
   `{version: 1, lens, pose, capture?, accuracy {rmsErrorMm, maxErrorMm, foundMarks, expectedMarks,
   targetHeightMm}, calibratedAt}`. It replaces `cameraCalibration` and `cameraAlignment`.
   Normalisation is strict: a malformed record is dropped on load, never trusted. Projects and
   machine profiles that still carry the old fields load without them: they are not migrated,
   because they were the broken part.
5. **A frame of another size** uses the lens scaled to it (`lensForFrame`) when its aspect ratio is
   within 1 %. Another shape, a frame from another camera, a network camera whose saved resource
   cannot be verified, or a changed crop is reported and not drawn or traced
   (`ui/camera/camera-model-frame.ts`). The camera and crop checks are the retained
   `cameraBindingCompatibility` comparator (source kind and id, URL query fingerprint, capture
   geometry), so this keeps the existing binding check's meaning; it is not a new gate (ADR-228).
   A photo's result belongs to the document, profile, camera and settings that took it, and Save
   applies only while they are unchanged (handoff consistency, ADR-228).
6. **Overlay on the GPU.** `ui/camera/overlay/` draws the workspace with a WebGL2 fragment shader
   that runs the model per canvas pixel at the material height, samples the live element or the
   still, and writes premultiplied alpha. A CPU mirror of the shader is held to `projectWorldPoint`
   in tests; in headless Chromium the shader matched the mirror over 3.84 M pixels to 0.505 of an
   8-bit level with no drawn/discarded disagreement. Any source kind can be live now, not only USB.
   Without WebGL2 the overlay says so.
7. **Trace and Capture** flatten a frame onto the bed with the same model at the material height
   (`core/camera/model/bed-image.ts`, output-to-input bilinear, projecting every 4th pixel and
   interpolating between).
8. **Placement** keeps its snapshot fact: camera placement has a geometry issue only when there is
   no saved model.
9. **The source outlives the panel** while the overlay is on and a model exists.

### Consequences

- Material height is exact for the overlay and trace, not an approximation from a plane homography.
- The old checkerboard, marker, homography, rectify and matrix3d modules are deleted, with the
  Labs switch "Camera alignment v2". The core camera barrel shrinks to the image type and the
  camera profile.
- Operators must calibrate again once. The Camera panel says calibration is pending.
- The hosted web app still cannot read a machine camera; the panel now explains why and points to
  Desktop. A USB webcam is fully supported in the browser.
