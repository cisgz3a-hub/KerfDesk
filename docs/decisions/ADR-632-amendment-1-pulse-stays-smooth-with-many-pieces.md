## ADR-632 Amendment 1 - The pulse stays smooth with many pieces (2026-10-19)

**Status:** Accepted. Amends ADR-632 decision 3 and ADR-620 decision 8 (drawing cost). Decision 3 (scaled bitmaps while the view moves) superseded by ADR-620 Amendment 1. | **Date:** 2026-10-19

### Context

The maintainer reported that the canvas lags when a lot of artwork pulses together. A browser
benchmark with 150 same-settings pieces found three costs in the pulse painter:

1. Every frame blurred two canvas shadows per piece (the glow and the resting edge): 300 blurs a
   frame. The pulse ran at 59 frames in 2.8 s, with 167 ms frames at the 95th percentile.
2. The bitmap cache was keyed on the view, so every zoom or pan frame rebuilt every piece's
   bitmaps. Zooming while the edge showed managed 18 frames in 1.5 s, with 1.2 s of long tasks.
3. Pointing at a piece rendered all 150 pieces' bitmaps in its first frame.

### Decision

1. **Blur once, blit every frame.** Each piece renders its colour bitmap and, from its grown
   outline, two halos blurred once: a tight edge (8 px) and a wider bloom (`PULSE_BLOOM_BLUR_PX`,
   16 px). A frame draws three plain blits per piece at the bloom, edge and colour strengths, with
   no blur on the overlay.
2. **The bloom no longer widens.** ADR-632 decision 3 had the halo drift from a 6 px to a 22 px
   blur. It is now a fixed 16 px bloom whose strength breathes with the colour, peaking at 34% as
   before. Per-frame blur growth is what made the glow expensive.
3. **Zoom and pan reuse the bitmaps.** While the view moves, each bitmap is drawn scaled into its
   new place. Once the view has been still for 140 ms, the pieces re-render sharp.
4. **First renders share a budget.** Missing bitmaps render for up to 6 ms per frame (always at
   least one), the most visible piece first, so the hovered piece appears at once and the ripple
   fills in over the next frames. The animation loop keeps running while bitmaps or a settling
   view are pending.

What lights up, the colours, the timing, the tint and the edge strength are unchanged.

### Consequences

- Benchmark with 150 pieces in headless Chrome, which rasterises on the CPU: the pulse ran 151
  frames in 2.8 s (median 17 ms, p95 50 ms) and zooming while hovered 75 frames in 1.5 s (p95
  33 ms), with no long tasks. Zooming with nothing hovered ran 88 frames.
- Each piece keeps three bitmaps instead of two. The halos are a little larger than the piece,
  and the 64 MB budget for retained pieces still applies.
- During a zoom, a piece's pulse can look slightly soft or clipped at the canvas edge for up to
  140 ms after the view stops, until its bitmaps re-render.
- Display only: G-code, Preview, Frame, Start, saved projects and export are unchanged.

### Verification

`src/ui/workspace/draw-artwork-pulse.test.ts` checks three plain blits per piece per frame with no
blur on the overlay, scaled draws while the view moves and a re-render once it settles, and the
per-frame render budget with the most visible piece first. The look was compared in the browser
build.
