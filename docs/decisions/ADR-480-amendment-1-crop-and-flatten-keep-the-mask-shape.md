## ADR-480 Amendment 1 - Crop Image and Flatten Image Mask keep the mask's shape (2026-10-27)

**Status:** Accepted. Amends ADR-480 Decision 9 and the Crop Image it repeats. Fixes rolling audit
v4 finding H5-P2-1 (P2). Frame, Start, output policy and licences are unchanged. | **Date:**
2026-10-27

### Context

Crop Image and Flatten Image Mask baked the pixels outside the mask as white and dropped the mask.
Compile runs brightness, contrast, gamma, Negative and the tone curve (`prepareImageLuma`) and only
then hides the pixels outside a live mask, so those pixels never burn. After the bake they went
through Negative like the rest of the photo, and white became full power. In the audit's repro, a
40 × 40 px photo with a 20 × 16 mm oval mask and Negative on, Threshold burned 1004 of 1600 cells
through the live mask and 1280 of 1280 after the crop (ΣS 502 000 → 640 000). Grayscale burned 276
more cells at full power, and brightness −50 did the same at partial power. A plain photo burned the
same either way. On a round slate under a light-mark preset, the corners burned off the slate. The
canvas and the notice did not say so.

LightBurn's Apply Mask to Image pages (1.7 and 2.0) say a mask "doesn't output those parts to the
machine", that Crop removes the part outside the shape, and that Flatten leaves "an image in the
shape it had been masked" (ADR-480 Context). They do not say how Negative treats the removed part.
That stays unverified, so this follows the live mask.

### Decision

1. **The mask's shape stays with the image as its own clip.** The bake still crops to the masked
   pixels and whitens the ones outside. It now also stores the mask's closed shape as the image's
   owned clip (`imageClip`, the even-odd clip that SVG import gives an image, ADR-358). The clip is
   in the image's local frame, mapped through the inverse of the image's transform, so it moves,
   scales, turns and mirrors with the image. Compile, Preview, the Photo engraving preview and Save
   Processed Bitmap apply an owned clip at the same point as a live mask, after the tone
   adjustments. So the baked image burns exactly what the masked one did, under every setting.
2. **An image that already owns a clip keeps the overlap.** A live mask burned only where it and
   the image's own clip overlap, so the new clip is their intersection (even-odd, on the shared
   1 µm grid). If the two cannot be combined, the command reports it and changes nothing.
3. **The image looks like what it burns.** The canvas draws the cropped image clipped to the shape,
   as LightBurn shows a flattened image in the shape of its mask, rather than as a rectangle with
   white corners. SVG export writes the shape as the image's clip path. Remove Image Mask does not
   remove it: like LightBurn's Crop, the bake is permanent, and Undo restores the masked image.

### Consequences

- Compile is unchanged for every existing project, so `EMITTER_REVISION` does not move. Images
  cropped or flattened before this change keep their white corners and still burn them under
  Negative. Nothing migrates them.
- Tests: `crop-image-mask-clip.test.ts` bakes through the real `cropMaskedRasterImage` and compiles
  through the real `compileRasterGroupsForLayer`. Under Negative Threshold, Negative Grayscale,
  brightness −50 Grayscale and plain Threshold, the baked image burns the same cells and ΣS as the
  live mask. Before this change it burned the audit's numbers. The clip maps back onto the mask for
  a turned, stretched and mirrored image, and an image with its own clip keeps the overlap.
- These are code and test results. No image was burned and no controller was operated.
