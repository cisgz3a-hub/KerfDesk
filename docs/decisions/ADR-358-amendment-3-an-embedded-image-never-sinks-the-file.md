## ADR-358 Amendment 3 - An embedded image never sinks the file (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

Item 2 reports an error for any embedded image KerfDesk cannot place: shear, aspect fitting,
opacity, filters and masks. Amendment 2 kept that refusal for images. The error rejects the
whole file, so every vector path in it is lost with the image.

Aspect fitting caught ordinary exports. SVG's initial `preserveAspectRatio` is `xMidYMid meet`,
so every `<image>` that did not spell out `none` was refused, including the common case where the
bitmap already has its box's aspect ratio and the fit changes nothing (SVG 2 embedded.html: the
fitting "only has an effect if that size does not match the intrinsic aspect ratio of the
embedded image"). Illustrator writes images this way: the box is the pixel size and a transform
scales it. GIF or SVG image data, a missing or zero width or height, and a percentage position
rejected the file the same way. The 2026-09-29 audit found this (A-04).

### Decision

1. `preserveAspectRatio` is read as SVG 2 defines it (coords.html, the attribute). The bitmap's
   own pixel size comes from its PNG, JPEG, BMP or WebP header, sniffed from the bytes; a JPEG
   EXIF orientation that turns it a quarter turn swaps the axes, as browsers display it.
   - `none`, and `meet` or `slice` when the bitmap's aspect ratio matches the box within 0.1%,
     place the image in its whole box, as before.
   - `meet` with a different aspect ratio scales the image uniformly to fit the box and aligns
     it as the attribute says. The image's bounds are that fitted rectangle, which is exactly
     what SVG renders.
2. An image that is still unrepresentable is skipped, and the rest of the file imports. A warning
   toast counts the skipped images for each reason:
   - data that is not a PNG, JPEG, BMP or WebP bitmap, such as GIF or SVG;
   - opacity below 1, a filter or a mask on the image or its ancestors;
   - an x or y that is not an absolute length, or a width or height that is missing, not an
     absolute length, or not above zero (SVG 2's `auto` sizing from the bitmap is not read);
   - `slice` with a different aspect ratio, which crops the image, or a bitmap whose header
     cannot be read when the fit needs its size;
   - a transform that skews or collapses the image, which an image object cannot represent.
3. An image with no embedded data, such as a link the sanitizer removed, is still counted as an
   ignored image, as before.
4. Refusals that concern the whole file are unchanged: non-finite or out-of-range coordinates,
   and the image clip cases Amendment 2 item 4 lists, which refuse vectors too.

### What changes in ADR-358 item 2

"Unrepresentable shear, aspect fitting, opacity and SVG filters/masks report an error" now reads:
aspect fitting is applied where SVG's result is a placed rectangle; shear, slice cropping,
opacity, filters, masks, unsupported image data and unusable sizes skip that image with a
warning, and never reject the file. Amendment 2 item 5's "Masks, filters and opacity on embedded
images keep item 2's refusal" is replaced by the same rule.

### Consequences

- A file whose only problem is an image imports its vectors, and the operator is told which
  images were left out and why.
- Verified with unit tests through the main-thread and worker parsers, not against real
  design-tool exports, in a browser, or on a machine.
