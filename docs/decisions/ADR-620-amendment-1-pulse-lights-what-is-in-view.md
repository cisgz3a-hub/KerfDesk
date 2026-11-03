## ADR-620 Amendment 1 - The hover pulse lights what is in view and rests while the view moves (2026-11-03)

**Status:** Accepted; browser-measured on one laptop, hardware qualification not applicable. Amends ADR-620 decision 8 (drawing cost) and supersedes ADR-632 Amendment 1 decision 3 (scaled bitmaps while the view moves). | **Date:** 2026-11-03

### Context

The pulse lights every same-settings piece (ADR-620 decision 2, the grouping the maintainer
chose). Each piece keeps three bitmaps (colour, edge, bloom) and every frame blits all three, for
every piece in the group, with no limit. The 2026-11-02 performance audit (S2-P2-2) measured
`mix-5000` on main: hover p95 100 ms (16.8 ms with the pulse turned off), pan over artwork
183 ms (83), zoom 217 ms (50) and click-select 151 ms (64). The cost is GPU rasterisation:
thousands of blits a frame, and every pan or zoom frame drew all of them scaled and then rendered
all of them again once the view settled, including pieces far outside the canvas. The 6 ms render
budget bounds JavaScript time, not the GPU blur work each render queues.

### Decision

1. **Only pieces in view.** The painter skips every same-settings piece whose box does not meet
   the overlay canvas (`pieceInView` in `pulse-piece-bitmap.ts`), for both drawing and rendering.
   Every same-settings piece in view still lights; the grouping, ripple order, colours, timing
   and edge are unchanged.
2. **The pulse rests while the view or dragged artwork moves.** While the view pans or zooms, or
   a drag that owns the pointer moves artwork, and for 140 ms after (`VIEW_SETTLE_MS`), the overlay
   is cleared and draws nothing; the animation keeps running so the glow returns on its own. An
   edit without a drag (a typed width) keeps the glow on. This replaces ADR-632 Amendment 1
   decision 3, which drew every bitmap scaled during the move.
3. **A pan moves whole bitmaps.** A bitmap that was not cut at the overlay's edge and was rendered
   at the same scale and canvas size is reused after a pan, blitted at its new place. A zoom, a
   resize or a bitmap cut at the edge renders again.
4. **Renders share a pixel budget too.** Missing bitmaps render for up to 6 ms and up to
   `RENDER_BUDGET_PIXELS` (1,500,000) bitmap pixels a frame, always at least one piece, the most
   visible first.

### Consequences

- Measured with ADR-346 Amendment 1 in the same builds (see there; p95 ms, main → this change):
  `mix-5000` pan over artwork 184 → 33, zoom 183 → 33, drag one 117 → 67; `line-5000` drag one
  233 → 150. Click-select responds in 102–175 ms on main and 112–115 ms here, within the spread
  between two sittings. Hovering in the fitted view, where all 2,500 to 5,000 same-settings pieces are in
  view, stays at 83–100 ms as on main: every piece still lights and blits three bitmaps a frame.
  Fewer blits would need pieces to share a bitmap and so a shared ripple time, which changes how
  the pulse looks; a bare-page check found one shared atlas no faster than separate canvases.
- Panning, zooming or dragging artwork hides the glow for the length of the move plus 140 ms,
  where it used to follow the view soft or clipped. Hovering again is not needed: the pulse
  continues.
- With very many same-settings pieces in view at once the ripple fills in over a few frames.
- Display only: G-code, Preview, Frame, Start, saved projects and export are unchanged.

### Verification

`src/ui/workspace/draw-artwork-pulse.test.ts` checks that 60 same-settings pieces of which 41 meet
the canvas light exactly those 41 (one blit set each) and render no others; that the overlay draws
and renders nothing while the view zooms and renders again once it settles; that a held drag
moving artwork rests it while an edit without a drag does not; that a pan blits whole
bitmaps at their new place without rendering again; and that a frame renders under the pixel
budget while every piece still renders within a few frames (counts, not timings).
