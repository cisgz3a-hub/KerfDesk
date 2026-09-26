## ADR-446 - Line Art traces sepia and duotone artwork like greyscale (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Refines ADR-401 (coherent colour trigger, item 2). The light-solid fill, the local-contrast mask,
the dense-colour working grid (ADR-128, ADR-438) and Colour Layers (ADR-430) are unchanged. The
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
   brighter level) and its level is at least 245, the trigger's own paper-light limit. Its colour is
   the mean of the pixels within 2 levels of it. Cream, kraft or shadowed sheets fail this and keep
   the promotion: there the local test is what separates pencil from paper (the ADR-401 shadow and
   sheet cases).
2. **Weak tint.** For each pixel the trigger counted, the tint is paper minus the pixel's 3 × 3 mean.
   It is strong when its channel spread exceeds 0.2 × its luma (how much darker than the paper it
   is) + 6. Fewer strong pixels than the trigger's count must remain. Measured ratios of spread to
   darkness: the hummingbird's tones about 0.15; the pale warm strokes (208, 200, 184) on white that
   promotion recovers 0.43; a sepia-brown ink (94, 60, 36) 0.32; the light ADR-401 solids (tan, light
   blue, pink) 1.0 to 1.5; saturated inks 1.1 to 2.6.
3. **One hue.** The weak tints share one hue: the dominant direction is the sum of their unit
   vectors in an opponent-chroma plane, and a tint counts against the veto when its distance from
   that half-axis exceeds 6 + 0.35 × its component along it. The opposite hue is a second hue, so
   warm and cool toning in one picture keeps the promotion. Strong plus off-hue pixels together must
   stay below the trigger's count.

A vetoed image takes the greyscale route: fixed brightness band, native grid (or the ordinary
quality supersample). Both follow from `shouldUseSketchTrace`, so `automatic-detail-mask.ts` and the
dense-colour policy in `trace-upscale-policy.ts` (ADR-438's thresholds included) are unchanged. The
verdict is carried to Region Enhance crops like any other auto-sketch verdict (ADR-435). The check
runs only on images that already promoted and stops once `required` counted pixels are strong.

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
- Not promoted any more: sepia, cool-grey and other single weak-hue toned art on paper-light paper,
  and a dark saturated solid whose tint is weak for its darkness (e.g. navy on white, 0.27). Those
  solids lie inside the brightness band and still fill; they lose only the local-contrast halo.
- A pale greige solid (200, 190, 175) on white (0.39) is also vetoed and traces like grey 191: to
  nothing, as under a global threshold.
- Cost: one luma histogram, one pass for the paper colour and at most two passes over the counted
  pixels, for images that promoted. On the hummingbird the trigger took about 70 ms before and
  about 170 ms with the check (a loaded machine), against a trace of several seconds that now also
  skips the reduced grid. Saturated colour art stops at the first `required` strong pixels. Uniform
  RGB noise has no paper-light paper level and keeps the ADR-401 behaviour.
