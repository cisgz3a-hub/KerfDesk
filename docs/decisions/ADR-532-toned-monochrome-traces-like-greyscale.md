## ADR-532 - Line Art traces sepia and duotone artwork like greyscale (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Refines ADR-401 (coherent colour trigger, item 2). The light-solid fill, the local-contrast mask,
the dense-colour working grid (ADR-128, ADR-438) and Colour Layers (ADR-461) are unchanged. The
clean-room rule (ADR-120, ADR-123) holds: the design uses only our own measurements and reasoning.

### Context

Line Art promotes an image to the automatic detail mask (brightness band OR local contrast, plus
the ADR-401 light-solid fill) when it has enough spatially coherent colour. The promotion also
switches on the dense-colour policy, which traces pictures above 1.5 M pixels on a reduced grid of
1.25 M pixels.

The user's hummingbird (1254², cream/sepia toned) has paper at (254, 252, 247) and every tone of the
bird carries the same faint warm tint: mean channel spread 2 in the blacks, 6 to 8 in the mid and
light tones, and 3.6% of its pixels reach the trigger's spread of 12. That is far above the
trigger's 0.2% count, so the image promoted. The 2026-09-25 tracer bake-off measured, against the
luma iso-contour reference (IoU):

| Hummingbird, Line Art | IoU | Area error |
|---|---|---|
| Potrace 1.16 defaults | 0.8901 | +1.27% |
| Line Art (base `a10013827`) | 0.8616 | +4.31% |
| Line Art on the same image's luma | 0.9051 | -1.10% |
| Base, promoted but kept on the native grid (experiment) | 0.8906 | +3.63% |
| Base, not promoted (experiment) | 0.9051 | -1.10% |

Most of the loss came from the reduced grid, the rest from the local-contrast halo. The colour holds
no information the luma lacks: it is one weak tint that follows the tones.

### Decision

After the coherent-colour count reaches its threshold, `isTonedMonochrome`
(`core/trace/toned-monochrome.ts`) can veto the promotion. It vetoes when all of these hold:

1. **Paper-light paper.** The paper is the most populated luma level (5-level window, ties to the
   brighter level). Its colour is the mean of the pixels within 2 levels of it, and that colour's
   luma must be at least 245, the trigger's own paper-light limit (the window's level alone leans up
   to two levels brighter than a uniform paper, so the gate reads the colour). Cream, kraft or
   shadowed sheets fail this and keep the promotion: there the local test is what separates pencil
   from paper (the ADR-401 shadow and sheet cases). The gate is a hard edge at 245 (grey paper 245
   is vetoed, 244 promoted; `toned-monochrome.test.ts`): off-white scans whose paper reads below 245
   are deliberately out of scope and keep the promoted route.
2. **Weak tint.** For each pixel the trigger counted, the tint is paper minus the pixel's 3 × 3 mean.
   It is strong when its channel spread exceeds 0.2 × its luma (how much darker than the paper it
   is) + 6. Fewer strong pixels than the trigger's count must remain. Measured ratios of spread to
   darkness: the hummingbird's tones about 0.15; the pale warm strokes (208, 200, 184) on white that
   promotion recovers 0.43; a sepia-brown ink (94, 60, 36) 0.32; the light ADR-401 solids (tan, light
   blue, pink) 1.0 to 1.5; saturated inks 1.1 to 2.6. Tests pin the limit between ratios 0.18
   (vetoed) and 0.24 (promoted) on white and keep the veto on a sepia ramp with up to 4 levels of
   noise per channel.
3. **One hue.** The weak tints share one hue: the dominant direction is the sum of their unit
   vectors in an opponent-chroma plane, and a tint counts against the veto when its distance from
   that half-axis exceeds 6 + 0.35 × its component along it. The opposite hue is a second hue, so
   warm and cool toning in one picture keeps the promotion. Strong plus off-hue pixels together must
   stay below the trigger's count.

A vetoed image takes the greyscale route: fixed brightness band, native grid (or the ordinary
quality supersample). Both follow from `shouldUseSketchTrace`, so `automatic-detail-mask.ts` and the
dense-colour policy in `trace-upscale-policy.ts` (ADR-438's thresholds included) are unchanged. The
check runs only on images that already promoted and stops once `required` counted pixels are strong.

**The verdict is read once, on the source.** The weak-tint test reads a 3 × 3 mean, so it depends on
stroke width in pixels: a 2 px stroke shows two thirds of its tint there, the same stroke on a 2x or
3x working grid its full tint. Before the veto the trigger gave one verdict at every scale; with it,
thin strokes near the tint limit (for example 2 px of (140, 124, 100) on warm paper) are vetoed at
1x and promoted on the 2x thin-stroke grid. `traceImageToColoredPaths` therefore computes the
verdict on the polarised source before the scale plan and carries it in `sourceAutoSketch`
(`withSourceAutoSketch`), exactly as Region Enhance crops carry theirs (ADR-435). The scale plan, the
upscale input and the working-grid lanes all read that one verdict.

Rejected: removing a fitted luma-to-tint ramp and re-counting the remainder. A single ramp also
explains a tan square on white, which must stay a light solid, and cannot tell a cream sheet from
cream-toned art.

### Consequences

Bake-off (P-default = Potrace 1.16, O-default = Line Art, O-default-luma = Line Art on the luma),
base `a10013827` and this change, one timing run:

IoU against each fixture's reference (area error in brackets):

| Fixture | Base Line Art | This decision | Luma control |
|---|---|---|---|
| hummingbird | 0.8616 (+4.31%) | 0.9051 (-1.10%) | 0.9051 |
| owl | 0.9050 | 0.9050 | 0.9050 |
| owl 2x | 0.9154 | 0.9154 | - |
| solid red / blue / gold / dark noise (clean and scan) | identical | identical | - |

Boundary deviation on the hummingbird (px; Potrace in the last column):

| Metric | Base Line Art | This decision | Luma control | Potrace |
|---|---|---|---|---|
| mean deviation | 0.378 | 0.247 | 0.247 | 0.249 |
| p95 deviation | 1.618 | 0.545 | 0.545 | 0.591 |
| Hausdorff | 13.68 | 20.21 | 20.21 | 12.23 |

The worst case gets worse: Hausdorff grows by about 6.5 px, further from Potrace on that one metric,
while IoU, area, mean and p95 deviation all improve. The larger maximum is the luma route's own
(the luma control scores the same 20.21 px), not new behaviour of the veto. The owl is unchanged
(23.06 px in both runs).

Re-run after the verdict was fixed at source scale (owl, hummingbird and the solid-colour fixtures):
every IoU, area, deviation and Hausdorff figure above is unchanged.

Synthetic sepia line drawings on white (bake-off hairlines and small-text fixtures, geometric
truth), base -> this decision:

| Fixture (ink) | Base Line Art | This decision | Luma control | Potrace |
|---|---|---|---|---|
| hairlines, toned ink (58, 50, 42), clean / scan / binary | 0.8270 / 0.7936 / 0.8515 | 0.9267 / 0.9058 / 0.9317 | 0.9272 / 0.9058 / 0.9316 | 0.9497 / 0.8914 / 0.9623 |
| small text, toned ink (58, 50, 42), clean / scan | 0.6433 / 0.5617 | 0.6594 / 0.4225 | 0.6615 / 0.4227 | 0.6404 / 0.4367 |
| hairlines and small text, sepia-brown ink (94, 60, 36) and (112, 66, 20) | promoted | unchanged (still promoted) | - | - |

The toned drawings now trace exactly like their luma. The scanned small text loses what the
local-contrast mask had recovered on it (0.5617 -> 0.4225): that is the greyscale result, which
Potrace shares (0.4367). The saturated sepia-brown inks stay above the weak-tint limit, as the pale
warm strokes must, and keep the promotion.

- Still promoted, as before: every ADR-401 light-solid, noise, shadow, sheet and plate case, the pale
  warm strokes of the auto-detail tests, coloured logos, colour patches, strokes and thin lines, a
  saturated tint of a tone ramp, a ramp toned warm on one side and cool on the other, a tone ramp on
  cream paper, and sepia art carrying a light-blue accent (`toned-monochrome.test.ts`).
- Not promoted any more: sepia, cool-grey and other single weak-hue toned art on paper-light paper.
  Measured on white (a 60 × 60 square on a 240² page, and 300² pages of 1 to 4 px strokes every
  10 px), base -> this decision:
  - dark, low-chroma navies are vetoed at every width: (25, 25, 70) and (20, 20, 60), squares and
    1-4 px strokes. They lie inside the brightness band and still fill; they lose only the
    local-contrast halo. A lighter navy (40, 40, 90) keeps the promotion as a square and at 3-4 px
    and is vetoed at 1-2 px. Standard navy (0, 0, 128) keeps the promotion everywhere;
  - pale greige (200, 190, 175) keeps the promotion as a square and as 2-4 px strokes on white, but
    1 px strokes on white and 2 px strokes on warm paper (253, 251, 246) are vetoed. Such strokes
    (luma about 191) lie outside the brightness band, so they may trace to nothing, as under a
    global threshold. This is the veto's real content loss: thin pale toned strokes, not solids.
- Cost: the trigger's count, then one luma histogram, one pass for the paper colour and at most two
  streamed passes over the counted pixels (the first finds the hue, the second counts off-hue
  tints), for images that promoted. Nothing is stored per pixel; the trigger hands the check the
  3 × 3 mean it already computed. The verdict is computed once per trace (above), where before it
  ran again at each reader (the dense-colour test, the median stage, the working-grid lane).
  Measured on a synthetic sepia disc (one verdict, this machine, three runs): 1254² about 250 ms,
  3000² about 1.4 s, 5000² about 3.9 s, heap growth 11-13 MB at every size. The first version of
  the check kept every weak tint in a growing array: 3000² +115 MB, 5000² +265 MB, 3.4 s (a
  review probe measured 268 ms without the check against 1083 ms with it at 3000², and 621 ms
  against 3195 ms at 5000²). On such images the trace itself takes far longer. Saturated colour art
  stops at the first `required` strong pixels. Uniform RGB noise has no paper-light paper level and
  keeps the ADR-401 behaviour.
