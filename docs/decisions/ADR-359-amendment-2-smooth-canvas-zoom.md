## ADR-359 Amendment 2 - Smooth canvas zoom: curves kept per zoom bucket, proportional wheel and pinch (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

Display only. Everything here changes what the design canvas and the Preview show while zooming.
Compile (`compilationPolylines`), G-code, Frame, Job Review, hit-testing and `src/core` are
untouched and never read the display tolerance, the wheel step, a sprite or a preview copy, so
no output can change.

### Context

A read-only review of the zoom path after Amendment 1 found these display defects:

- **Every wheel notch flattened every cubic of traced artwork again.** `displayPathFor`
  (`src/ui/workspace/object-display.ts`) set the display tolerance to 0.25 px over the pixels per
  millimetre (view scale times the object's largest axis scale), a new value at every notch. The
  stroke and fill display caches (`display-polylines.ts`) kept one flattening per curve array and
  reused it only at the identical tolerance, so each notch in, and each notch back out, flattened
  every curve again. At the flattener's current cost a 5,000-cubic path takes about 74 ms
  (ADR-453). The cache's comment said traces were straight lines and so zoom-invariant, but traces
  keep their fitted cubics (`src/core/trace/trace-curves.ts`, `trace-to-paths.ts`) and took the
  per-notch route.
- **A trackpad zoomed a full 1.1x step per event.** Amendment 1 counted the notches a wheel event
  carries but kept at least one step per event, and never read `ctrlKey`. A two-finger scroll or a
  pinch sends a stream of small deltas, dozens a second, and each zoomed 1.1x, far faster than the
  fingers moved. Amendment 1 recorded trackpads and high-resolution wheels as unchanged; this
  amendment supersedes that point.
- **Zooming out of a clipped sprite left artwork missing.** A dense object whose sprite would be
  too large at the current zoom is rendered for the view plus a 25% margin (ADR-346). While the
  zoom changes, the previous sprite stands in, scaled, until the zoom has held for 150 ms. Only the
  unscaled blit checked that a clipped sprite covered the view, so after about a 1.5x zoom out
  (less when zooming about a point near the edge) parts of the artwork were blank until the settle
  repaint.
- **The settle repaint moved the artwork by up to half a pixel.** The scaled placeholder was drawn
  at its fractional position and the repainted sprite at the nearest whole pixel.
- **The Preview's burn simulation shimmered when shrunk.** It was always drawn with nearest
  sampling. Below about two screen pixels per cell, some cells landed on two screen pixels, some on
  one and some on none, and the pattern changed at every zoom step.
- Every wheel event also closed the right-click quick bar with a store write when it was already
  closed, then set zoom and pan in two more writes: three notifications of every store subscriber
  per event.

### Decision

1. **Display curves are flattened per power-of-two zoom bucket.** `displayCurveToleranceMm`
   (`display-polylines.ts`) rounds the pixels per millimetre down to a power of two and divides
   0.125 px by it. Each curve is drawn within 0.125 to 0.25 px of its true shape, no coarser than
   the 0.25 px before, and the tolerance changes only when a zoom crosses a power of two, about
   every seven 1.1x notches. The stroke and fill display caches keep the three most recently drawn
   flattenings of each curve array, so zooming back into one of the last three buckets flattens
   nothing. Paths whose curves are all straight stay zoom-invariant, as before.
2. **Wheel zoom follows the size of the delta.** A notch is 100 px, 3 lines or one page, as in
   Amendment 1, and an event zooms 1.1 to the power of the notches it carries, fractions included,
   with no minimum and at most ten steps either way (`wheelZoomSteps`,
   `src/ui/workspace/use-workspace-wheel.ts`). A mouse notch still zooms exactly one step, and
   notches merged into one event still each count. Chromium sends a trackpad pinch as a ctrl+wheel
   event in pixel mode whose `deltaY` is 100 times the natural logarithm of the pinch's scale
   change, negative when the fingers spread (Blink's synthetic wheel event for a touchpad pinch). A
   ctrl+wheel event in pixel mode smaller than 50 px is taken as a pinch and zooms by
   `e^(-deltaY/100)`, the scale the trackpad measured: the same threshold and rate as the trace
   preview (ADR-407). A Ctrl+mouse notch of 100 px zooms one step like a plain notch. The handler
   sets zoom and pan in one store update (`setView`, `src/ui/state/ui-store.ts`), and closing an
   already-closed quick bar no longer writes the store, so a wheel event notifies subscribers once.
3. **A scaled placeholder must cover the view.** When the scale has changed, a clipped sprite
   stands in only while its region still covers the view; otherwise it is rendered at the new scale
   at once (`artwork-sprite-cache.ts`).
4. **Sprites carry their sub-pixel offset.** A sprite is painted offset by the fraction of a pixel
   between its corner's exact screen position and the whole pixel it is blitted at, and the scaled
   placeholder is placed using the same offset. The placeholder, the settle repaint and a direct
   paint therefore put the artwork in the same place. After a pan by a fraction of a pixel, the
   whole-pixel blit stays within half a pixel of it, as before.
5. **The Preview samples nearest only when a cell is large enough.** The burn simulation
   (`src/ui/workspace/draw-raster-preview-bitmap.ts`, moved out of `draw-raster-preview.ts`) is
   drawn with nearest sampling when each bitmap pixel spans at least two screen pixels each way,
   and smoothed below that. Drawn below half its size, it is read from its halved copies
   (`raster-display-levels.ts`, Amendment 1), which average the dots into the tone they burn. The
   Preview cache frees those copies with the canvas it drops (`raster-preview-cache.ts`).

### Consequences

- A wheel zoom over traced artwork flattens its curves once per power of two instead of once per
  notch, and not at all when it returns to one of the last three buckets. See Verification for the
  measured cost.
- Curves are drawn with more chords at the bottom of each bucket: up to 1.41 times as many as
  before, about 1.2 times on average over a bucket, because the chord count of a flattening grows
  with the inverse square root of the tolerance. Stroking them costs that much more per frame, and
  the display thresholds that count segments see those counts: the hairline width, the cut-over to
  a sprite, and the 120,000-segment budget past which the canvas decimates and shows its
  large-scene notice. Up to three flattenings per curve array are held instead of one, each bounded
  by that budget.
- Wheel input:
  - A mouse notch of 100 px, 3 lines or one page zooms one step as before, with or without Ctrl.
  - A two-finger trackpad scroll zooms 1.1x per 100 px of scroll instead of 1.1x per event, and a
    pinch follows the fingers.
  - A wheel whose notch reports less than 100 px now zooms that fraction of a step per notch, where
    Amendment 1 zoomed at least one step. Chromium on Windows reports 100/3 px per configured line,
    so a mouse set to 1 or 2 lines per notch zooms a third or two thirds of a step. Other
    platforms' notch sizes were not checked here: one that reports a slow notch as 40 px would
    zoom 0.4 of a step per notch.
  - A ctrl+wheel event smaller than 50 px from a mouse, such as a 1-line Windows notch with Ctrl
    held, is taken for a pinch and zooms `e^(1/3)`, about 1.4x, as it does in the trace preview.
- A clipped sprite zoomed out past its margin is rendered during the gesture rather than after it
  settles. That is one paint of the object's display segments, the cost the settle repaint paid
  anyway, in exchange for showing all of the artwork.
- A shrunk Preview shows the burn's average tone instead of a pattern of dropped and doubled dots;
  at two screen pixels per cell and above it looks as before. A shrunk preview keeps halved copies
  of up to a third of its canvas's pixels while it is on screen.

### Alternatives rejected

- **More cache entries at the exact tolerance.** Every notch produces a new tolerance, so only
  returning to the very same zoom would hit.
- **Powers of two at 0.25 px.** Fewer chords, but at the bottom of each bucket the outline would be
  drawn up to 0.5 px off, coarser than before.
- **A pinch gain for every ctrl+wheel event, as d3-zoom applies.** A Ctrl+mouse notch would zoom
  about 2.7x.
- **Counting a Windows whole-line delta as a full notch, as the trace preview does.** It would keep
  a 1- or 2-line-per-notch mouse at one step per notch. But a touchpad that emulates the wheel in
  thirds of a notch reports the same 33.3 px and would zoom a full step per event again, the defect
  this amendment removes.
- **Skipping display resolution while a sprite placeholder stands in.** With item 1 the flattening
  happens once per bucket. Skipping it would have the sprite trust a style key and segment count
  from the previous zoom, and would split paint resolution from geometry in `object-display.ts`.
  That is not simple enough to be safe, so it is left out.
- **Building adjusted-tone copies (ADR-359 item 6) outside the frame.** It would need the decoded
  copy of an adjusted picture kept alive, which Amendment 1 prunes once a picture is adjusted. The
  previous adjusted copy would have to be kept while a new one builds, since today it is pruned in
  the frame its adjustment changes and the canvas would flash the colour source. Pending builds
  would need pixel-budget accounting and cancellation, and the per-pixel pass would still run on
  the main thread unless it moved to a worker. It is left for its own change.

### Verification

- `display-polylines-linear.test.ts` checks that one flattening serves all seven notches from 4 to
  7.8 px/mm and the eighth notch flattens finer, that zooming back into the last three buckets
  returns the very same flattening for strokes and fills while a fourth bucket evicts the least
  recently drawn one, that the screen error stays within 0.125 to 0.25 px over a sweep from 0.001
  to 10,000 px/mm and at every power of two from 2^-20 to 2^20 and the floating-point values either
  side of it, and that each of 4,001 points sampled along a cubic lies within 0.25 px of its drawn
  polyline at six zooms.
- `object-display.test.ts` checks the same reuse through `resolveObjectDisplay` for an object
  scaled by 2. It fails with the old per-notch tolerance.
- `use-workspace-wheel.test.tsx` checks a 4 px delta zooming 0.04 of a step and 26 more the other
  way netting exactly one step, a pinch of `-100 ln 1.25` zooming 1.25x and ten opposite pinch
  events undoing it, a Ctrl+mouse notch zooming one step, one store notification per wheel event,
  one step per 100 px, 3 lines or one page, merged notches, proportional sub-notch deltas in pixel
  and line mode, the pinch gain across scales, and the ten-step bound. `ui-store.test.ts` checks
  that closing a closed quick bar notifies no subscriber and that `setView` clamps the zoom in one
  update.
- `artwork-sprite-cache.test.ts` checks that a clipped sprite stands in at a 1.25x zoom out and is
  rendered at once at 2x, and that the placeholder and the settle repaint put the object's corner
  exactly where a direct paint does. Both fail without the change: the first without the coverage
  check, the second without the sub-pixel offset. The existing placement cases now expect the
  offset.
- `draw-raster-preview-bitmap.test.ts` checks the two-pixel threshold on each axis; nearest
  sampling at 4 px per cell, smoothing at 1.5 px and a 100 x 50 halved copy of a 400 x 200 bitmap
  at 0.2 px, for scans along X and at 30 degrees; `drawRasterPreview` drawing smoothed at 0.5 px
  per cell and nearest at 4 px and leaving the context's smoothing as it found it; and the cache
  freeing halved copies when a raster is edited or leaves the scene.
- Measured cost, with a benchmark run once in Node and not kept: 500 closed traced blobs of 10
  cubics each (5,000 cubics), zoomed 20 notches in from 4 px/mm and 20 back out, 41 wheel events.
  Before, every event flattened the path (73 to 170 ms each), 4.6 s in all. After, only the three
  events that entered a new bucket did (116 to 152 ms each), 0.38 s in all, and the other 38
  reused a kept flattening. Totals are medians of five runs and per-event times come from one run,
  on a shared machine under load. Over the sweep the display drew 1.19 times as many segments.
- Not verified here: frame timings in a browser or the packaged app, real trackpads and mice, and
  wheel notch sizes on macOS and Linux.
