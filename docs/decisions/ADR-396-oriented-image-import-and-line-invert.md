## ADR-396 - Images import turned by EXIF Orientation, and line traces can Invert (2026-09-25)

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
   mean 1. The loader uses the oriented size for every size it derives: the safety check, the decode
   cap, the `createImageBitmap` request (now with `imageOrientation: 'from-image'` stated explicitly),
   the returned raster and `readImageNaturalSize`. Import bounds and the multi-file trace's physical
   size therefore come out portrait. JFIF and EXIF densities describe the stored axes, so they swap
   when the Orientation swaps axes.
2. **Fallbacks agree.** If `createImageBitmap` returns a bitmap that is not the requested oriented
   size, the loader closes it and uses the image-element route. That route uses the element's
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
   the same route, working grid and sub-pixel boundary field as its dark-on-light twin. The Edge
   Detection input also honours `invert` when called directly. The enlarged-grid route does not
   invert its reused, already-inverted source a second time.
5. **Transparent stays material.** For decoder images (`rgbCompositedOnWhite`), `invertImage` inverts
   the artwork, not the stored bytes. It composites 255 − s over white, which is 255(2 − a) − c for a
   stored byte c and coverage a. Opaque pixels give the usual 255 − c, fully transparent pixels stay
   paper, and the mapping is its own inverse. Straight RGBA input keeps plain byte inversion.

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
- Projects saved before this change keep what they stored: a turned JPEG imported earlier keeps its
  landscape bounds and its already-squashed luma. Tracing that image again decodes it upright, and
  trace placement maps the trace grid across the stored bounds, so the new trace lines up with the
  bitmap as the canvas already draws it. Re-importing the file gives the upright size.

### Measured before and after

| Case | Before | After |
|---|---|---|
| 4032 x 3024, Orientation 6: decode request | 2048 x 1536 (squashed) | 1536 x 2048 |
| Same file: natural size for import bounds | 4032 x 3024 | 3024 x 4032 |
| Edge Detection, light anti-aliased disc, Invert | 2 outlines, RMS 16.5 px | 1 outline, RMS 0.051 px, identical to dark twin |
| Line Art / Smooth / Sharp, same disc, Invert | 1 outline, RMS 0.033 / 0.045 / 0.029 px | unchanged, identical to dark twin |
| Centerline and Edge Detection, light thin strokes, Invert | output differed from dark twin | identical to dark twin |
| White disc on transparent 128 x 128 PNG, Invert | Line Art / Smooth / Sharp: 1 outline, the full frame (0,0)-(128,128); Edge Detection: no outline | every lane: 1 outline, bbox (33.9,33.3)-(94.7,94.1), true disc (33.95,33.35)-(94.65,94.05), RMS < 0.107 px |
| Owl / hummingbird negatives, Edge Detection, Invert | 3,221 / 2,409 outlines (originals 3,078 / 2,375) | identical to originals |

Regression tests: `ui/trace/jpeg-header.test.ts`, `ui/trace/image-loader-orientation.test.ts`,
`core/trace/trace-invert.test.ts`, `core/trace/raster-prep.test.ts` and
`ui/trace/TraceSettingsControls.semantic.test.tsx`.
