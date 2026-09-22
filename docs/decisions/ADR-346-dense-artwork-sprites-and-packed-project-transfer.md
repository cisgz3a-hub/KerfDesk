## ADR-346 - Dense artwork is blitted from cached sprites, and projects cross worker boundaries as packed geometry (2026-09-22)

**Status:** Accepted; browser-measured on one laptop, hardware qualification not applicable. | **Date:** 2026-09-22

### Context

With a large trace on the canvas (hundreds of thousands to a million vertices), the
canvas and the rest of the interface stayed laggy after the 2026-09-09 responsiveness
work (see the amendment under ADR-288 Amendment 1). That work removed redundant
redraws; it did not change what one redraw costs, nor what one edit costs.

Measured on this laptop (Intel Iris Xe, GPU-accelerated Chrome 152) with a synthetic
1,020,000-vertex traced image (20,000 closed loops) and a 90,000-segment variant:

| What                                                                | Measured                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `structuredClone` of the project (what `postMessage` does)          | 1,226 ms isolated; 541 ms + 553 ms in the app after ONE edit  |
| Autosave clone of the same project                                  | the same clone, every 30 s while dirty                        |
| `stroke()` of the 120,000-segment display sample at 1.5 px          | 371–390 ms per repaint                                        |
| The same stroke at ≤ 1 device px (Skia's hairline path)             | 5.7–8.8 ms per repaint (~60x less, ~0.05 µs per segment)      |
| `fill()` of 120,000 segments                                        | 105 ms per repaint (~0.9 µs per segment)                      |
| Duration estimate of the 90k-segment (sub-budget) trace             | 301 ms on the UI thread, twice per edit (two hook mounts)     |
| Per-frame JS to rebuild the display path (`moveTo`/`lineTo`)        | 12 ms of the 17 ms `drawScene` JS time                        |
| Re-flattening a straight-only curve path on each zoom notch         | 7 ms                                                          |

Three facts drive the design. Canvas2D pays per segment on every `stroke()`/`fill()`, so
any repaint of a dense object is expensive no matter how little changed, and the
hairline cliff is exactly one device pixel (1.01 px already costs the full stroker).
Filled traces are never decimated (closed contours decide filled topology), so a
filled 1M-point trace costs ~1 s per repaint. And `postMessage` clones on the sending
thread, so shipping the project to the ETA worker, the idle-marker worker and the
autosave worker after every edit froze the UI for about a second per edit.

ADR-345 packs the Start preparation for the worker-to-main handoff. This decision is
the other direction of the same boundary: the request that carries a project INTO a
worker, which no amount of response packing can make cheaper.

### Decision

1. **Dense objects are painted once into a cached bitmap ("sprite") and blitted on
   later repaints** (`src/ui/workspace/artwork-sprite-cache.ts`, wired through
   `object-display.ts`). An object with at least `SPRITE_MIN_DISPLAY_SEGMENTS` (4,000)
   display segments is rendered into its own canvas keyed on its immutable `paths`
   identity, the linear part of its transform (scale/mirror/rotate), its resolved
   paint, the alpha it was painted with, and the view scale. Translation is applied at
   blit time, so pans, moves of the object, selection changes, snap guides, marquees
   and drags of other objects reuse the bitmap. A zoom shows the previous bitmap scaled
   as a placeholder and repaints the exact sprite once the scale has been quiet for
   `SPRITE_SETTLE_MS` (150 ms), the Preview route renderer's policy. Objects whose
   bitmap would exceed the pixel cap (zoomed far in) are rendered for the viewport
   plus a 25% margin and re-rendered when the view leaves that region. The cache is
   bounded (8 entries, 3x the per-sprite pixel cap) and LRU-evicted. Blit placement is
   rounded to whole device pixels: at most half a pixel from the fractional position a
   direct paint would use, display only. The same painter feeds a sprite and a direct
   paint, and the faint Preview underlay (`drawObjectsFaint`) uses it too.
2. **Very dense strokes draw as hairlines.** An object drawing at least
   `HAIRLINE_STROKE_SEGMENT_THRESHOLD` (20,000) display segments strokes its output
   layers at 1 device px instead of 1.5 px (`artworkStrokeWidthPx` in
   `draw-complexity.ts`). Non-output layers stay at 0.75 px. This is display policy of
   the same kind as the 120,000-segment display sample; emitted output never reads a
   display width.
3. **Straight-only curve paths have a zoom-invariant display.** `getPath` in
   `display-polylines.ts` uses the memoized polylines of an all-line curve array (every
   trace, every pen line) instead of re-flattening and re-decimating at each tolerance;
   bent curves keep the tolerance-keyed entry. Fills already did this.
4. **Projects cross worker boundaries as packed geometry**
   (`src/ui/packed-project-transfer.ts`). Above `PACK_MIN_POINTS` (5,000) vertices,
   every vector object's `paths` become typed arrays (`Float64Array` coordinates,
   `Uint32Array` offsets, `Uint8Array` flags) that are TRANSFERRED to the worker and
   rebuilt there; everything that is not vector geometry travels inside the ordinary
   clone. Every coordinate is a double in and a double out, and polyline/curve order,
   closed flags, colours, operation bindings, fill rules and stroke metadata are
   preserved field for field. Curves that are the canonical straight-line view of their
   own polylines are sent as a flag and rebuilt with `polylineToCurveSubpath`. The
   preparation (ETA/Preview), idle-marker and autosave workers all take a
   `ProjectMessage` and unpack it first; small projects are sent unchanged, so the
   existing client contracts and tests hold for them. Packing is memoized per `paths`
   identity, and each send transfers fresh copies so a detached buffer never breaks the
   next request.
5. **The synchronous estimate is memoized per project identity and exact inputs**
   (`use-job-estimate.ts`), so the second mounted consumer reads the first one's result
   instead of re-running the duration planner.

### Consequences

- In the running app with the 1M-vertex trace: the worker `postMessage` calls after an
  edit went from 541 ms + 553 ms to 1.4 ms + 0.2 ms; forcing the raster after a pan or
  a move of the trace went from ~380 ms to 9.5–11.5 ms; one sprite canvas is created.
  These are this laptop's numbers, not guarantees for every GPU.
- A dense filled trace, which the display sample never thinned, is now also a blit
  after its first paint; the first paint and each exact repaint after a zoom still cost
  the full fill.
- Rotating or resizing a dense object re-renders its sprite every frame (the linear
  transform is part of the key), no slower than before; moving it does not.
- Sprite placement can differ from a direct paint by up to half a device pixel
  (measured at 6x zoom: 2.1% of pixels differ by antialiasing, ink pixel counts within
  ~1%). Hit-testing, selection frames, bounds and output read geometry, never sprites.
- Dense artwork (≥ 20,000 display segments) reads one pixel thinner than before.
  Ordinary artwork keeps its 1.5 px weight. The threshold is a constant.
- `ProjectMessage` is a distinct type from `Project`, so a worker that forgot to unpack
  would fail to type-check rather than compile an empty scene.
- Still open: the sub-budget estimate itself (~300 ms for 90k segments) now runs once
  per edit instead of twice but still on the UI thread; routing it through the worker
  above a lower budget is a separate policy decision. Node-edit handles still draw one
  handle per vertex in node mode. The Start/Save output preparation worker still
  receives a plain clone (once per Frame, not per edit).

### Alternatives rejected

- **A `Path2D` cache alone:** removes the ~12 ms per-frame JS but not the raster cost;
  measured 391 ms versus 381 ms for the same 120k-segment stroke at 1.5 px.
- **Hairlines for all artwork:** would change the weight of every design; the policy
  applies only where the stroker cost is measurable, mirroring the display sample.
- **One bitmap of the whole artwork layer:** covers pans and zooms but not moving the
  dense object itself, which is the placement workflow. Per-object sprites cover both.
- **A long-lived worker holding the last project:** avoids the clone but doubles the
  resident geometry and fights the shared V8 cage budget (memory lane, ADR-288
  amendment); packing keeps the workers short-lived as designed.

### Verification

- `artwork-sprite-cache.test.ts`: render-once/blit-later placement, reuse across pans
  and moves, repaint on rotation, style and alpha changes, scaled placeholder and
  settle-timer repaint under fake timers, viewport clipping with margin and
  re-render, and refusal on non-canvas contexts.
- `object-display.test.ts`: design versus faint resolution, hidden operations,
  measured extent under scale/rotation, direct widths (1.5 px, hairline at the
  threshold), and a dense object painted once into a sprite with no main-context
  strokes.
- `display-polylines-linear.test.ts`: one display entry per line-only curve path at
  every tolerance; bent curves still re-flatten.
- `packed-project-transfer.test.ts`: fast-check round trips through
  `structuredClone(message, { transfer })` for random polylines/curves (line, cubic,
  arc), untouched small projects, the derived-curve flag, absent fields staying
  absent, non-vector objects preserved by identity, and repeated sends after a
  detached transfer.
- `use-job-estimate.memo.test.tsx`: two mounted consumers, one estimate per edit.
- The existing 98 workspace, worker-client, autosave, estimate and preview suites pass
  (608 tests).
- Live in the development server with the synthetic 1M-vertex trace: the timings in
  Consequences, plus a pixel comparison of the sprite path against a direct paint.
- **NOT verified:** a real traced image from the operator, the packaged Electron
  runtime, other GPUs, and the appearance of the hairline policy on real line art;
  hardware is not involved in this change.
