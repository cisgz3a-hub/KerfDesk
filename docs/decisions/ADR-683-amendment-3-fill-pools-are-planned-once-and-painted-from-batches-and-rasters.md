## ADR-683 Amendment 3 - Fill pools are planned once, painted in batches, and dense pools come from rasters that a drag previews and a pause repaints in bands (2026-11-03)

**Status:** Accepted on 2026-11-03; unit-tested through `drawScene` with count guards, and measured
in Chrome 156 (headless, GPU raster) on production builds against desktop 1.0.23 with the audit's
harness. Not checked by eye on screen, and not hardware-tested. |
**Amends:** ADR-683 Consequences ("a pooled cluster rebuilds its world contours when a member
changes"), Amendment 1 items 2 and 4 (where a split is made; "a still frame does not sweep again")
and Amendment 2 items 6 and 7 (the sweep of artwork between members; the clip budget per frame) |
**With:** ADR-346 (sprites), whose settle-then-repaint policy the pool raster follows

### Context

Performance audit S1, area S2 (`docs/audits/2026-11-02-performance-s1/S2-canvas-interaction.md`,
refuter-confirmed) measured two slowdowns that the pools brought since 1.0.23:

- **S2-P2-3 (P2).** In 5,000 Fill circles that all overlap (N6-P3-3's scene) each drag step took
  0.7-2.3 s (1.0.23: 0.13-0.30 s), and a 40-step drag gave no frame for 120-181 s, then took about
  ten minutes to settle, in 3 of 3 runs. Each step repainted the whole 240,000-segment even-odd
  pool into a new sprite. The freeze itself came from a split: as the dragged circle came back,
  its box lay in a corner of the cluster's box while meeting no member, so it counted as artwork
  drawn over the pool, the pool was split in two, and each part filled its thousands of member
  regions one by one under a clip of the whole pool, with no sprite, on every frame.
- **S2-P2-4 (P2).** Plates followed by their windows panned at p95 100 ms against 16.8 ms on 1.0.23
  at 5,000 objects (250-283 against 33 ms at 10,000). Every frame planned the pools again (29 ms at
  10,000) and painted each plate-and-window pair with its own fill and 1.5 px outline.

The audit's binding rule holds here: a speed fix may change neither the burn nor what the canvas
shows. Measured first (a page of the same plates, panned): fills cost the same whichever way they
are issued; the outline stroke is the cost, and one stroke over many contours costs a fifth of one
stroke per pool. Painting the dense pool at once costs 1.3 s of GPU raster at fit zoom and 3 s at
twice that, and the same paint clipped to bands of rows costs the same in total but is spread out.

### Decision

1. **The plan is kept between frames** (`fill-pool-plan-cache.ts`). A plan reads each object, its
   compile run, and per path the contours its Fill operations burn, their rule, its paint kind and
   those operations, plus the box of each photo or relief. A frame bringing the same of all of
   these, by identity, gets the same plan. Two slots, so two canvases drawn in turn keep theirs.
2. **The plan covers every visible vector, on the canvas or not** (`placed-objects.ts`). An object
   off the canvas brings the display it last resolved under the same operations and view mode, so a
   pan that moves objects across the canvas edge plans nothing; it paints nothing either, and its
   contours, lying outside the canvas, change the parity of no pixel on it. A photo counts as drawn
   when it is visible, not only when it is on the canvas, for the same reason. Pools wholly off the
   canvas are skipped. A zoom plans again only where a curve's flattening bucket changes.
3. **A drag joins only the moving members** (`fill-pool-clusters.ts` `regroupMoved`). While up to 32
   members of an operation keep changing, the overlap groups of all the others are kept, and each
   changing member joins every group its box meets: one pass over the boxes per moving member, the
   same groups as a full sweep. A member's world contours are placed once per object, so a step
   places only the member that moved (`fill-pool-geometry.ts`).
4. **Artwork splits a pool only where it meets a member's box**, not the cluster's box: artwork that
   meets no member's box cannot overlap anything the pool paints. This replaces Amendment 2 item 6's
   test against the cluster's box; the sweep is otherwise unchanged.
5. **Small whole pools of one operation, painted one after another with nothing drawn between, are
   painted as one even-odd fill and one outline** (`fill-pool-paint.ts`). Pools of one key are
   separate clusters of one operation, so their regions never overlap and one even-odd fill paints
   exactly their union. Anything else drawn at an index (an object's own paths, a photo, a selection
   box) paints the queue first, so the drawing order is kept. Dimmed (out-of-focus) pools paint alone.
   A batch as dense as an object ADR-346 sprites (4,000 segments) is painted into a sprite under that
   ADR's rules and blitted on later frames, so a pan repaints nothing. Queued pools are not dropped
   when they leave the canvas, so a pan keeps the batch, and its sprite, the same; pools painted
   alone are skipped when wholly off the canvas.
6. **A large split part is a sprite** painted without a clip: its members' regions, then kept inside
   the pool by one even-odd fill composited "destination-in", which is what the clip does.
7. **A large whole pool is painted from a raster** of two bitmaps, its fill and its outline
   (`fill-pool-raster.ts`):
   - unchanged since the raster was finished, it is two blits;
   - when it differs from a finished raster of its operation by a few members (at most 20,000
     changed segments: a drag), it is shown from that raster: the fill composited "xor" with the
     changed members' old and new contours, which is how even-odd parity changes, and the outline
     with the old contours erased and the new ones stroked. This preview is exact in the fill; in
     the outline, other outlines lose a strip about 2 px wide where an old contour crossed them;
   - once the pool has stayed put for 150 ms, its exact raster is painted in bands of whole pixel
     rows, cut to a budget of segment-row crossings a frame (60,000). A band paints the full even-odd
     fill and outline clipped to its rows, of only the contours that reach them, so the finished
     raster is pixel for pixel the one painted at once;
   - with no raster to start from, or more change than a preview carries, it is painted at once, as
     the sprite was. A zoom shows the raster scaled until the view is quiet, as a sprite does;
   - a raster's layer holds at most 4 million pixels and all rasters 12 million together; a pool
     that cannot have one falls back to the sprite.
8. **The clip budget is per plan**: with the plan kept, it is spent once per change, over every
   visible pool, rather than once per frame over the pools on the canvas.

### Consequences

- What burns is unchanged: no file under `src/core` changed, so compiled output is byte-identical.
  What the canvas shows once settled is unchanged up to antialiasing where two pools of one
  operation come within a pixel (one fill instead of two). During a drag of a large pool, the
  outline preview above is the only difference, until the pool has been still for 150 ms and its
  bands are painted.
- Measured (Chrome 156 headless with GPU raster, Iris Xe, production builds, p95 of the median of
  five kept runs; worst single frame in brackets), this change / main / 1.0.23:
  - plates then windows, 5,000 objects: pan **16.8** [33.5] / 133.4 [200] / 17.0 [66.7] ms; drag one
    **83.3** [233.3] / 233.3 [366.7] / 83.3 [183.4] ms;
  - the same, 10,000 objects: pan **33.4** [66.8] / 316.7 [650] / 50.1 [83.4] ms; drag one **133.3**
    [216.6] / 366.7 [633.4] / 100.1 [216.6] ms;
  - 5,000 overlapping circles, pan: **16.8** [33.4] / 16.8 [33.4] / 116.6 [316.6] ms;
  - the same, the audit's 40-step drag, each move timed to the second frame after it (four runs):
    median move **100-118 ms**, longest **395-520 ms**, worst frame over the drag and the 3 s after
    release **250 ms**, 40 moves in 9.1-9.3 s. 1.0.23: median 166-196 ms, longest 650-818 ms, worst
    frame 450 ms, 11.4-12.0 s. Main: a 10-move drag at 816-890 ms a move (longest 1.28-1.38 s); its
    40-step drag was not run again (the audit's: no frame for 120-181 s, 3 of 3).
  The release frames include the settle bands. The harness's CPU calibration drifted by up to 42%
  on this change's sets, 86% on main's 10,000 drag and 51-70% on two 1.0.23 sets, after GPU-heavy
  windows as the audit found; every comparison above is well outside that. The main-thread share at
  10,000 (30-35 ms a frame resolving every object's display, S2-P3-2's kind) is unchanged and shared
  with 1.0.23.
- After a fractional pan a batch sprite sits within half a pixel of a direct paint, as every sprite
  does (ADR-359 Amendment 2).
- **Not changed:**
  - The 1.5 px outline width (ADR-346 Decision 2) is S2-P2-1's to decide; a batch of small pools
    keeps it.
  - Dragging a whole dense pool (every member moving) still paints it at once each step, as before.
  - A pool zoomed so far in that its raster would pass the pixel cap uses the sprite, as before.

### Verification

`draw-scene-fill-pool-work.test.ts` counts, through `drawScene`: plans across 30 pans and two zooms
of 400 plates and windows (0), plans again after a move and an operation change, fills and strokes
for those plates (1 each), a pool kept apart by a Line square between, overlap sweeps across ten drag
steps in 300 overlapping circles (1), and clips when a circle sits in the corner of a pool's box
(0; the cluster-box test split it in two, each part under a clip). `fill-pool-raster.test.ts` checks the bands (every row once, at least one row, the
budget, the contours a band takes) and, with recording canvases, a ten-step drag of 1,000 overlapping
circles: ten previews, nothing painted at once or in bands until the pool settles, then several
budgeted frames of bands and a pan that paints nothing. `fill-pool-clusters.test.ts` compares
`regroupMoved` with a full sweep on random boxes. The pool, part, burn-parity and remaining workspace
suites pass unchanged.
