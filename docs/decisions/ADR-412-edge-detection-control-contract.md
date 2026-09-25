## ADR-412 - Edge Detection's controls match its detector (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This refines the Edge Detection lane of ADR-115 (local-contrast detection) and its dialog mapping.
The detector itself is unchanged: a pixel is ink when its luma is below the box mean of its
neighbourhood minus a contrast delta, or below 128, and the closed outlines of that mask are
committed as a line layer. Output is unchanged for the preset and for every stored option set
without Trace alpha mask; with the mask on a transparent source, Edge now traces coverage
(Decision 3).

### Context

The Edge controls still carried the Canny engine's option names (ADR-059) and mappings, which no
longer described what the engine does:

1. **Sensitivity had 101 values but 9 outputs.** The dialog mapped Sensitivity 0..100 to a Canny
   high/low threshold pair; the engine rounds the low ratio to an integer delta (x 6/0.074) and
   clamps it to 2..12. The mapping only reached deltas 10..2, so 101 slider values gave 9 distinct
   masks and the deltas 11 and 12 were unreachable. Detail had the same fault: 101 values over the
   blur sigma gave 20 distinct neighbourhood radii (25..6 px). Measured on the owl and hummingbird
   test images (1254 x 1254): 9 distinct masks for Sensitivity and 20 for Detail on each.
2. **The displayed Sensitivity read a value the engine ignores.** It was derived from
   `edgeHighThresholdRatio`, which only the dialog read. `edgeJoinGapPx` was written by the Detail
   control and read by nothing (closed-mask contours do not bridge gaps). The preset also carried
   `fixedPalette`, `useOtsuThreshold` and `despeckleMinPixels`, which the local-contrast detector
   never reads.
3. **Dead fallbacks.** `DEFAULT_EDGE_SENSITIVITY` and `DEFAULT_EDGE_DETAIL` sat behind `??` after
   functions that always return a number.
4. **The alpha mask was missing from Edge.** Line Art, Smooth, Sharp and Centerline trace the
   alpha channel when **Trace alpha mask** is on; Edge Detection hid the control and read colour
   only. A white logo on a transparent PNG (the loader composites colour onto white) traced to
   nothing. The only workaround was Invert, which gave 1 outline with a radial RMS error of
   0.91 px (48 px disc) and 0.65 px (400 px disc).

The other shared controls were checked. Remove ink specks and Ignore Less Than are covered by
Edge's own **Minimum line**, which drops every closed outline shorter than its length, so a speck
or a small hole is removed either way. Fill tiny holes fills cracks in a binary mask before the
contour walk; the Edge mask is built from local contrast, and the option was already excluded.
The brightness band and detection modes select a luma band, which the local-contrast test
replaces. Edge keeps its own automatic median (`edgeMedianFilter`). None of these were wired in.

### Decision

1. **One detector setting per stop.** Sensitivity moves in steps of 10 over the 11 contrast deltas
   (0 = 12 luma levels, 100 = 2). Detail moves in steps of 5 over 21 neighbourhood radii
   (0 = 24 source px, 100 = 4). A typed value between stops takes the nearest one, and the
   number box shows that stop once it loses focus. The engine still reads `edgeLowThresholdRatio`
   and `edgeBlurSigma`; `edge-input.ts` now exports the
   conversions both ways (`edgeContrastDelta`, `edgeLowThresholdRatioForDelta`,
   `edgeSourceRadiusPx`, `edgeBlurSigmaForRadius`), and the dialog uses them, so the displayed
   value is derived from the field the detector reads. The preset shows Sensitivity 60 and
   Detail 60 (delta 6, radius 12), the same detector setting as before (it was shown as 44
   and 68).
2. **Unread knobs leave the preset and the dialog.** The preset drops `fixedPalette`,
   `useOtsuThreshold`, `despeckleMinPixels`, `edgeHighThresholdRatio` and `edgeJoinGapPx`. The
   dialog no longer writes the last two. The two Canny-era fields stay in `TraceOptions`, marked
   deprecated, so older saved options type-check and load. Every stored ratio keeps the delta and
   radius it produced before, because the engine's conversion did not change.
3. **Edge honours Trace alpha mask.** When it is on and the source has transparency, the detector
   reads coverage (luma = 255 - alpha, opaque) instead of colour, so the alpha ramp gives the
   sub-pixel boundary. No median runs on coverage. Invert stands down, as in the other lanes: the
   alpha check now comes before Edge's inversion in `invertBeforePolicy`, and the dialog disables
   Invert. The upscale route enlarges the coverage image and traces it as luma
   (`traceTransparency: false` on the enlarged grid). Without that, the enlarged grid converted
   the already-opaque coverage a second time and traced the whole frame (radial error 14.9 px on a
   48 px disc). The dialog shows the **Transparency** section for Edge Detection.
   Coverage goes through the same local-contrast test as luma, not the 50% alpha cut of the
   other lanes, so semi-transparent regions (drop shadows, glows, soft halos) are outlined like
   grey tones: an opaque disc (r 60 px) with a 16%-opacity shadow out to r 80 px gives 3
   outlines, at Sensitivity 0 as well as at the preset, where Line Art's alpha mask gives 1.
   Such a shadow needs the 50% cut of a filled style's alpha mask, or removing it from the
   source. Whether Edge should cut coverage at 50% before detection is a product call left open.
   Dialog overrides survive a preset switch, so an alpha mask ticked under another style now
   applies when switching to Edge Detection.

### Consequences

Measured with the scratch harness from the reviewed commits (not committed), owl and hummingbird
1254 x 1254:

| | before | after |
| --- | --- | --- |
| Sensitivity values offered / distinct masks | 101 / 9 | 11 / 11 |
| Detail values offered / distinct masks | 101 / 20 | 21 / 21 |
| Edge preset, owl | 3078 outlines, 225 330 points | identical |
| Edge preset, hummingbird | 2375 outlines, 171 257 points | identical |
| White disc on transparency + alpha mask, 48 / 400 px | 0 outlines | 1 outline, RMS 0.103 / 0.109 px |

- The preset traces are identical because the removed entries were never read.
- Sensitivity has fewer positions, but each one is a distinct detector setting (it changes the
  mask wherever local contrast is in the mid-tones; hard black-on-white art, decided by the
  luma < 128 floor, may trace the same at every stop), and it now reaches deltas 11 and 12 (less
  sensitive than before). Detail now reaches radius 4 and stops at 24 instead of 25.
  A stored radius above 24 still traces as stored and shows as Detail 0.
- The scale policy still reads luma, so white art on transparency is traced at native size even
  when it is small. Dark art on transparency takes the small-source supersample as before and now
  keeps coverage on that grid. The scale policy belongs to the upscale work and is not changed
  here.
- The preview is unchanged. It already strokes Edge outlines.

Tests: `src/ui/trace/edge-detector-stops.test.ts` (every Sensitivity and Detail stop gives a
distinct mask on a curvature gradient, stops round-trip, older stored values keep their detector
setting, legacy options trace identically), `src/core/trace/edge-input.test.ts` (alpha mask on the
native and upscale routes, Invert standing down, opaque fallback, prepared-input matching) and
`src/ui/trace/TraceSettingsControls.semantic.test.tsx` (the Edge dialog sends the alpha mask and
disables Invert).
