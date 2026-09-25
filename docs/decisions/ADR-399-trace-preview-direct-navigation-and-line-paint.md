## ADR-399 - Trace preview gets direct zoom and pan, and draws Line traces as hairlines (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This changes how the trace dialog's preview is viewed and painted, and, because batch trace shares
the preview's SVG writer, how an Edge Detection batch-trace SVG export is painted (Decision 6).
Trace options, the traced geometry, what a commit creates, Frame and Start are unchanged. The Frame-first contract (PROJECT.md
non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

Tracer gap review against Potrace 1.16 and LightBurn's Trace Image (2026-09-25), preview area:

- **Navigation.** The preview zoomed only through − / + buttons in powers of two (1×, 2×, 4×, 8×,
  16× the fitted view) and **Fit**, and panned only by scrollbars, a trackpad's native scroll or
  arrow keys. There was no wheel zoom, no pinch zoom and no drag to pan; the mouse wheel scrolled
  the zoomed image. Primary drag draws the trace **Boundary** and must keep doing so. Every zoom
  step was about the viewport centre, so reaching a detail took a zoom and then a scroll.
- **Edge Detection paint.** `coloredPathsToSvg` filled every closed polyline with one even-odd path
  unless the mode was Centerline. An Edge Detection result is closed outlines, and the commit makes
  it a LINE layer (`scene-mutations.ts`: Centerline and Edge both return `'line'`), which burns the
  outlines. The preview showed filled silhouettes, indistinguishable from Line Art, so it did not
  show what burns. A zero-area Edge ring was also dropped from the preview (area test) although the
  LINE layer burns it (length test).
- **Stroke width.** Stroked paths used `stroke-width="1"` in source-pixel units. With the preview's
  stretched SVG that is one source pixel wide at every zoom: for the 1,254 × 1,254 px test art
  (`owl.png`, `hummingbird.png`) in a 600 × 280 px viewport, Fit draws 0.22 screen px per source
  pixel, so at 16× a Centerline stroke is 3.6 px wide and hides the detail being inspected. A laser
  line's width is its kerf, not a fraction of the source image.

### Decision

1. **Continuous zoom about the pointer.** Zoom stays relative to Fit (`trace-preview-zoom-math.ts`).
   Its range is from the smaller of Fit and 1:1 to the larger of 16× Fit and 4 screen pixels per
   source pixel, capped at 64× Fit. A step keeps the stage point under the pointer, including the
   centring margin of a stage smaller than the viewport (below Fit, for 1:1 on small sources).
   Consecutive steps chain from the last requested zoom and scroll, not from stale layout, so fast
   wheel or pinch bursts do not drift. The range follows the measured viewport, so when it moves
   (window resize, side-by-side to stacked layout) a zoom left outside it is pulled back to the
   nearest limit; a requested zoom is never clamped against its direction, so a zoom-out never
   jumps in. 1:1 is offered (button and **1** key) only while it lies inside the range: a source
   wider than about 64 viewports would need more than the 64× cap, and the button is then disabled
   with a title that says so.
   **Live gesture steps.** Re-laying the stage re-rasterises the whole trace (numbers below), so a
   wheel or pinch step only scales the already-painted artwork layer with a CSS transform that
   shows exactly the view the re-layout will produce, and the stage re-lays once, 150 ms after the
   last step (`trace-preview-zoom-engine.ts`). Buttons, keys and a pointer press (before a Boundary
   drag or pan) re-lay at once.
2. **Wheel policy** (`trace-preview-gestures.ts`). Browsers report three gestures as `wheel` events.
   Ctrl/Cmd+wheel always zooms; Chromium, and so Electron, reports a trackpad pinch that way. Shift+
   wheel pans. Otherwise the first event of a gesture is classified and the gesture keeps that
   intent until 200 ms of idle: line or page delta mode, or a vertical-only pixel delta that is at
   least 50 or a whole number of Windows scroll lines (Chromium reports 100/3 px per configured
   line: 100 per notch at the default 3 lines, 33.3 at 1 line), is a mouse wheel and zooms 1.2× per
   notch whatever the lines setting; anything else is a trackpad two-finger drag and is left to
   native, inertial scrolling. Latching stops a fast two-finger flick or its momentum from turning
   into a zoom halfway through. A plain wheel-out at the smallest zoom is not claimed, so it
   scrolls the dialog in the stacked narrow layout; Ctrl/Cmd+wheel is always claimed (no page
   zoom), and so is a wheel-in at the largest zoom (it must not pan instead).
3. **Drag to pan** (`trace-preview-navigation.ts`). Middle-drag, and primary drag while Space is
   held, pan with pointer capture; the Boundary tool asks `isPanGesture` before starting, so plain
   primary drag still draws the Boundary. Space is claimed when the preview has focus, or while the
   pointer is over it and focus is not on a control Space activates or types into (the shared
   `isKeyboardActivationTarget`: buttons, checkboxes, switches, text fields), so a focused Fade
   Image checkbox or Trace button keeps its Space. A pan ends when its button is found released on
   a move, on lost pointer capture and on window blur, so a lost button-up cannot leave hover
   panning or the Boundary tool blocked. On touch the preview sets `touch-action: none`:
   one finger pans, two fingers pinch-zoom about their midpoint and pan with it. Touch Boundary
   drawing remains unsupported, as before.
4. **Keyboard and labels.** The focusable viewport region keeps its native arrow-key scrolling and
   gains + / − (step, stopping at Fit when a step crosses it), 0 (Fit) and 1 (1:1); browser
   shortcuts with Ctrl, Cmd or Alt are not taken. A pointer press focuses the viewport so these keys
   and Space work after clicking it. A **1:1** button (accessible name "1:1 actual size", which contains its visible label for WCAG
   2.5.3; 1:1 means one image pixel per CSS pixel) joins Fit; the
   viewport is described by the on-screen help text, and shows a focus ring for keyboard focus.
5. **Navigation never re-traces.** Zoom and pan are local view state: no handler touches trace
   options, the Boundary or the worker. `ImportImageDialog.preview-navigation.test.tsx` drives every
   gesture over a ready preview and asserts no new trace request and no Boundary.
6. **Line traces paint as hairlines.** `coloredPathsToSvg` treats Edge Detection like Centerline:
   every polyline, closed or open, is stroked (`fill="none"`), and visibility is judged by length.
   Every stroked path carries `vector-effect="non-scaling-stroke"`, so it stays one screen pixel wide
   at any zoom. Filled contours are unchanged. The same function builds batch-trace SVG exports, so
   an exported Edge trace is now outlines too, and its path count includes zero-area rings (which
   the LINE layer burns); its geometry is unchanged, and viewers that ignore `vector-effect` still
   see `stroke-width="1"` as before.

### Consequences

- Before and after, from the tests and computed from the stated sizes (not hardware or material
  measurements):

  | Measure | Before | After |
  |---|---|---|
  | Zoom levels | 5 (1, 2, 4, 8, 16× Fit) | continuous; Fit (1×) to 17.9× Fit for the 1,254 px art in 600 × 280 px, with 1:1 at 4.5× Fit |
  | Zoom about the pointer | no (viewport centre) | yes: the source point under the pointer stays put |
  | Ways to pan | scrollbars, trackpad scroll, arrow keys | also middle-drag, Space+drag, touch |
  | Edge Detection preview | filled even-odd silhouettes | stroked outlines, like the LINE layer |
  | Zero-area Edge ring (test) | 0 visible | 1 visible, as it burns |
  | Stroke at 16× Fit, 1,254 px art | 3.6 px (one source pixel) | 1 px hairline |

- Zoom-step cost, measured in Edge (Chromium) with a headed window, a static page using the
  preview's layout (600 × 280 px viewport, 1,254 px viewBox, one stroked path of 28,000 8-point
  rings = 224k points, a synthetic stand-in for a dense Edge trace), 15 wheel steps of 1.2× from Fit,
  two-frame time per step, two runs: re-laying the stage every step took a median of 255–257 ms per
  step and 3.27–3.28 s per burst; the live lens took 16.7 ms (one frame) median and 0.60–0.62 s per
  burst, plus one re-layout after the gesture settles. At 20,000 rings: 219–221 ms vs 16.7 ms
  median. At 2,000 rings both are about one frame. The owl and hummingbird traces were not timed
  inside the running app.
- A mouse wheel over the preview now zooms rather than scrolls; Shift+wheel, the trackpad and the
  scrollbars still scroll. Wheels whose notches report small pixel deltas that are not whole
  Windows scroll lines (some high-resolution mice, and mice on macOS) are classified as trackpads
  and scroll; they zoom with Ctrl/Cmd+wheel, the buttons or the keys. A trackpad gesture whose first
  event lands within 0.01 px of a whole line count zooms for that one gesture.
- The preview traps the wheel only while it can zoom: at the smallest zoom a plain wheel-out
  scrolls the dialog. `touch-action: none` still keeps touch scrolling inside the preview (one
  finger pans it), so on a narrow touchscreen the dialog scrolls from outside the preview.
- The zoom range grows past 16× Fit only for sources larger than about four viewports, so points
  on large scans can be separated. The points overlay already paints only the visible window.
- Safari's non-standard `gesture*` pinch events are not handled; LaserForge ships as Electron
  (Chromium).
- Tests: `trace-preview-navigation.test.tsx` (wheel, pinch, live lens and settle, pan, lost
  button-up, Space beside focused controls, re-clamp on resize, 1:1 beyond the cap, keys, labels
  and focus), `trace-preview-zoom-math.test.ts` (range, anchored scroll, lens transform, wheel
  policy), `ImportImageDialog.preview-navigation.test.tsx` (no re-trace, including 1:1, then a
  plain drag sets exactly one Boundary), `paths-to-svg-edge.test.ts` (Edge strokes and hairlines)
  and `e2e/trace-presets-stress-worker.e2e.ts` (Edge preview paths are stroked hairlines).
