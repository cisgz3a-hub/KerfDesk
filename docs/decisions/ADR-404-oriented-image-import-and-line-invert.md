## ADR-404 - Images import turned by EXIF Orientation, and line traces can Invert (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This decision covers two gaps between Trace Image and Potrace 1.16, the tracer LightBurn licenses,
found in the same audit. The third fix from that audit, the Alt+T shortcut, is recorded in
WORKFLOW.md F-A15 and needs no decision.

### Context

**EXIF Orientation.** A phone stores a portrait photo as a landscape frame, for example 4032 x 3024,
and records the turn in the EXIF Orientation tag (0x0112; values 1 to 8, where 5 to 8 swap rows and
columns). Browsers display and decode the photo turned: CSS `image-orientation: from-image` is the
default, and `createImageBitmap` has an `imageOrientation` option. `loadImageAsRawData` read the size
from the JPEG frame header, which is the stored size. It capped that size to 2048 x 1536 and asked
`createImageBitmap` for exactly that size. The browser turned the photo to portrait and then stretched
it into the landscape request, so the photo traced squashed. `readImageNaturalSize` also returned
4032 x 3024, so the imported image's size in mm was landscape while the photo was portrait.

**Invert.** The Trace dialog offered Invert only for Photo shading. Core already honoured
`TraceOptions.invert` for Line Art, Smooth, Sharp and Centerline by inverting bytes before the
threshold. Edge Detection ignored it: a light disc on a dark ground traced as 2 outlines with a radial
RMS error of 16.5 px. On the user's owl and hummingbird art, an inverted negative did not reproduce
the Edge Detection trace of the original (3,221 against 3,078 outlines, and 2,409 against 2,375). The
policies that choose a trace's working grid (thin-stroke and small-source upscaling, and the detail
profile) read the raw image, where ink always means dark. So an inverted source could take a
different route from its dark-on-light twin: Centerline and Edge Detection gave different output on
light, thin strokes. Byte inversion also turned transparent pixels into ink. The loader stores RGB
composited onto white with alpha kept, so a white logo on a transparent PNG traced as one filled
rectangle.

### Decision

1. **Oriented size everywhere.** `ui/trace/jpeg-header.ts` reads the frame size and the Orientation
   of the first `Exif` APP1 segment, walking IFD0 in either byte order. Missing or invalid values
   mean 1; an Orientation entry must be exactly one SHORT (count 1), as browser decoders require,
   so a malformed entry the browser ignores is ignored here too. The loader uses the oriented size for every size it derives: the safety check, the decode
   cap, the `createImageBitmap` request (now with `imageOrientation: 'from-image'` stated explicitly),
   the returned raster and `readImageNaturalSize`. Import bounds and the multi-file trace's physical
   size therefore come out portrait. JFIF and EXIF densities describe the stored axes, so they swap
   when the Orientation swaps axes.
2. **Fallbacks agree.** A conforming `createImageBitmap` returns exactly the requested size. An
   engine that ignores the resize options returns its full frame: the loader keeps that bitmap when
   its aspect ratio is the oriented one (and scales it to the target), and closes it and uses the
   image-element route when it has the stored, swapped aspect, because that engine ignored the
   Orientation too and stretching its frame would squash the photo. The element route uses the element's
   reported size. The element is already turned in engines that implement `image-orientation`
   (Chromium 81+, Firefox 77+, Safari 13.1+). If the element reports the stored frame of a non-square
   image whose Orientation swaps axes, the engine ignored the tag, so the loader turns the image on
   the canvas with the matching transform. Either way the raster has the oriented aspect ratio that
   the bounds use.
3. **Invert is a line-preset control.** Line Art, Smooth, Sharp, Centerline and Edge Detection show
   an Invert checkbox, stored as its own override (`invert`), separate from Photo shading's
   `photoInvert`. Neither style inherits the other's choice, and Reset clears it. The checkbox is
   disabled while Trace alpha mask owns detection, because the alpha mask ignores brightness.
4. **Invert applies before any policy.** `traceImageToColoredPaths` inverts the source once, before
   the scale plan and lane dispatch, and clears the flag. A light-on-dark source therefore follows
   the same route, working grid and sub-pixel boundary field as its dark-on-light twin. For the luma
   lanes (Line Art, Smooth, Sharp, Centerline) it runs the whole documented chain there, brightness
   → contrast → gamma → invert (`applyImageAdjustments`), and clears the tone fields too, so tone
   still comes before Invert exactly as on the `preprocessForTrace` entry point; the scale policy
   then sees the adjusted image. Edge Detection never read the tone fields and only gets the
   inversion; its input also honours `invert` when called directly. While the alpha mask decides
   the ink, Invert is dropped, as the dialog already disables it then.
5. **Transparency follows the artwork's polarity.** Decoder images (`rgbCompositedOnWhite`) store
   c = 255 − a(255 − s) for straight colour s and coverage a, so transparency is already paper-white.
   `invertImage` decides once per image from the coverage-weighted mean straight luma of the
   artwork, 255 − 255·Σ(255 − c)/Σα:
   - **Dark or mixed artwork** (mean ≤ mid-grey): the negative of the image as displayed on white,
     255 − c, returned opaque. It is byte-identical to inverting the same art on an opaque white
     background, so a dark logo on a transparent PNG gives the same negative in every lane.
   - **Light artwork** (mean > mid-grey): that negative would be a solid slab, so the artwork itself
     is inverted over the same white, 255(2 − a) − c. The transparent surround stays paper and the
     light logo becomes the ink.

   Opaque pixels give 255 − c either way, so opaque images are unaffected by the choice; an image
   with no artwork stays blank. Straight RGBA input keeps plain byte inversion. Because the choice
   is per image, inverting twice need not restore the input.

### Consequences

- A turned JPEG traces, previews and imports upright at its real size. The trace dialog and the
  burn bitmap use the same pixels.
- Orientation is read from JPEG only. The eXIf chunk of a PNG and the EXIF of WebP and TIFF are not
  read. If an engine applies one of those, the image-element route still decodes self-consistently,
  but the header-derived size would be the stored one.
- For Orientations 2 to 4, which keep the aspect ratio, an engine that ignores EXIF cannot be
  detected from the image size. Such an engine would produce an upright-sized but mirrored or
  upside-down raster. No supported engine behaves this way.
- The dense-picture downscale route resamples without the composited-on-white tag. Invert is now
  applied before that route, so the route does not change the inversion.
- Invert has no effect while the alpha mask is on, and the dialog shows this by disabling the control.
  A light logo on a transparent PNG can also be traced without Invert through Trace alpha mask.
- Invert on a transparent source depends on the artwork's polarity (decision 5). A dark logo on
  transparency with Invert traces the negative it has on white: the full frame with the logo as a
  hole. A light logo traces as the logo. Artwork near mid-grey can land on either side; both
  outcomes are a valid negative, and the rule is deterministic for a given image.
- Programmatic callers that combine Invert with brightness, contrast or gamma on the luma lanes get
  the same order as before (tone, then Invert). Edge Detection still ignores tone, as it always did.
- If this parser and the browser's EXIF reader disagree about an axis-swapping Orientation (the
  parser accepts it, the browser ignores it), a conforming `createImageBitmap` still returns the
  requested turned size and the photo is stretched. Requiring count 1 removes the known malformed
  case; checking the unresized frame first would cost a second full decode and is not done.
- Projects saved before this change keep what they stored: a turned JPEG imported earlier keeps its
  landscape bounds, pixel size and already-squashed luma, and re-importing the file gives the upright
  size. The two fallbacks that re-decode the embedded source against the stored pixel size (crop of
  an image without stored luma, and the Image Studio decode) resample the turned decode back onto
  the stored grid (`fitDecodeToStoredGrid`), reproducing the pixels the project holds instead of
  failing with a size mismatch. Retracing such an image was not re-measured: trace placement maps
  the trace grid across the stored bounds, so by design the trace lands where the canvas draws the
  bitmap.
- `ui/trace/jpeg-header.ts` and `ui/common/image-density.ts` each walk the JPEG segments and IFD0;
  merging them is a follow-up.

### Measured before and after

| Case | Before | After |
|---|---|---|
| 4032 x 3024, Orientation 6: decode request | 2048 x 1536 (squashed) | 1536 x 2048 |
| Same file: natural size for import bounds | 4032 x 3024 | 3024 x 4032 |
| Edge Detection, light anti-aliased disc, Invert | 2 outlines, RMS 16.5 px | 1 outline, RMS 0.051 px, identical to dark twin |
| Line Art / Smooth / Sharp, same disc, Invert | 1 outline, RMS 0.033 / 0.045 / 0.029 px | unchanged, identical to dark twin |
| Centerline and Edge Detection, light thin strokes, Invert | output differed from dark twin | identical to dark twin |
| White disc on transparent 128 x 128 PNG, Invert | Line Art / Smooth / Sharp: 1 outline, the full frame (0,0)-(128,128); Edge Detection: no outline | every lane: 1 outline, bbox (33.9,33.3)-(94.7,94.1), true disc (33.95,33.35)-(94.65,94.05), RMS < 0.107 px |
| Black disc on transparent 128 x 128 PNG, Invert | first revision of this change (transparent always paper): 0 outlines in every lane | Line Art / Smooth / Sharp / Edge Detection: 2 outlines, the frame (0,0)-(128,128) plus the disc as a hole (33.9,33.3)-(94.7,94.1); Centerline: 1 stroke; each identical to the same disc on opaque white with Invert |
| Line Art, soft disc, gamma 2 + Invert | first revision: invert, then gamma | gamma, then invert: identical to tracing `invertImage(adjustGamma(x, 2))` |
| Owl / hummingbird negatives, Edge Detection, Invert | 3,221 / 2,409 outlines (originals 3,078 / 2,375) | identical to originals |

Regression tests: `ui/trace/jpeg-header.test.ts`, `ui/trace/image-loader-orientation.test.ts`,
`ui/raster/crop-image.test.ts`, `ui/image-editor/image-editor-decode.test.ts`,
`core/trace/trace-invert.test.ts`, `core/trace/raster-prep.test.ts`,
`ui/app/shortcuts-tools.test.ts` and `ui/trace/TraceSettingsControls.semantic.test.tsx`.
