## ADR-028 Amendment 1 - A reduced raster preview keeps the tone it burns (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

Item 1 reduces a compiled grid with an edge over 2048 px (`MAX_RASTER_PREVIEW_EDGE`) for display.
It kept the largest S-value of each block (max pooling), so that small burn marks stay visible.
That holds for a sparse mark on blank ground, but not for dithered images. Error diffusion and
ordered dithering spread burned dots through every mid-tone, so nearly every block holds one and
shows at that dot's full power. A 50% grey Floyd-Steinberg field, which burns half its dots,
previewed about 86% dark. The reduction starts above 204.8 mm at the default 0.1 mm interval, so
large photo engravings previewed far darker than they burn. ADR-028's own aim is a preview that
"shades according to power", as LightBurn's does.

An audit of the raster pipeline reported it (C-2).

### Decision

1. A reduced preview averages. Every compiled pixel counts once, with equal weight, toward the one
   display pixel it falls in, and that display pixel shows the mean S-value of its block. This is
   a box (area) filter as Pillow's `BOX` resampling defines it: "Each pixel of source image
   contributes to one pixel of the destination image with identical weights". The S-to-grey
   mapping is linear in S, so the display's mean darkness is the mean power the job emits, up to
   rounding.
2. The rest of item 1 stands. The reduction happens only after compilation, from the same
   `RasterGroup` rows that output reads, never by dithering again. The 2048 px edge cap stays, and
   the display keeps the device's absolute S scale.
3. The reduced-resolution banner also says that each displayed pixel shows the average power of
   the emitted pixels it covers, so a detail that previews lighter than it burns is explained where
   the reduction is disclosed.

### What this changes in ADR-028 item 1

"A grid above the display edge limit is max-pooled only after compilation" now reads "is
box-averaged only after compilation". A grid within the limit is still shown pixel for pixel.

### Rejected alternatives

- **Keep max pooling for thin lines.** It is right only for isolated marks. Most raster jobs are
  dithered photos, where it misstates the tone of the whole image, and a preview that is wrong
  everywhere to be right at a hairline is the worse trade. Under averaging, a one-pixel line in a
  two-pixel block still shows, at half its darkness.
- **Pick max or mean by dither mode.** Threshold and grayscale images also have blocks that mix
  burned and unburned pixels, at edges and in gradients. A second rule would make one image preview
  differently depending on a setting that does not change what the reduction approximates.
- **Raise the edge cap or draw the full grid.** A 2048 px edge already allows a display grid of
  4 M pixels per image. The cap bounds memory and draw time, and a larger one only moves the point
  where the reduction starts.
- **Let the browser smooth a full-resolution canvas.** It needs the full grid as a canvas first,
  the memory the cap avoids, and its filter differs between browsers.

### Consequences

- Dithered images above the display cap preview at the tone they burn.
- A detail narrower than a display block previews lighter than it burns, in proportion to the part
  of the block it fills. The banner says so.
- Emitted S-values and G-code are unchanged; only the display grid differs.
- Verified with unit tests (`compiled-raster-preview.test.ts`) and the audit's repro, not in a
  browser or on a machine.
