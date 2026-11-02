## ADR-683 Amendment 1 - Fill pools cover every Fill operation a path burns under, keep each member's place in the drawing order, and decide clicks (2026-10-30)

**Status:** Accepted on 2026-10-30; unit-tested through the real store, `drawScene`, the compiler
and `hitTest`. Not checked on screen in a browser, and not hardware-tested. |
**Amends:** ADR-683 decision 1 (which paths a pool holds, and where it is painted), decision 2
(how solid a filled path is to a click) and its Consequences (drawing order, rebuild cost)

### Context

Rolling audit v8 area N6 (`docs/audits/2026-10-29-rolling-v8/N6-fix-canvas-keys.md`,
refuter-confirmed) verified ADR-683 on main `4f71f1f41`. The reported plate-and-circle path
holds, but the pools added two places where the canvas and the burn disagree, and left one
click gap:

- **N6-P1-1 (P1, regression).** A pool keyed each filled path by the one operation that styles
  it, the first visible binding (`object-display.ts`, `visibility.ts`). The Operation
  inspector's **Add operation** binds the selection to a copied Fill "Operation 2". On a plate's
  circle the canvas then showed a hole, while "Operation 2" hatches the circle solid
  (`outputOperationLayers` compiles every output operation apart). Preflight said nothing.
- **N6-P1-2 (P1, regression).** A pool was painted once, at its lowest member. A frame (outer and
  window rectangles), a photo in the window, and a caption over the photo on the frame's Fill
  operation: the caption was painted before the opaque photo, so it vanished from the canvas
  and still burned. Before ADR-683 it was painted after the photo.
- **N6-P2-1 (P2).** The hit test decided solidity per object. A window cut by a separate Fill
  object, or a pair of stacked copies that cancel, is drawn empty, but a click on the Line
  square shown inside picked the window object or the upper copy. Only Alt+click reached it.
- **N6-P3-3 (P3, context).** 5,000 mutually overlapping Fill circles redrew in 413-681 ms a frame
  against 50-111 ms before ADR-683, mostly the overlap sweep, which is quadratic there.

### Decision

1. **A filled path joins the pool of every visible Fill operation it is bound to.**
   - `pathFillOperations` (`core/scene/fill-operations.ts`) lists them in binding order, each
     with the operation's output switch after the object's own settings. A path whose first
     visible operation is not Fill for its object has none: the canvas strokes it, as before.
   - Each operation's pool is built and painted on its own; ink at a point any of them fills is
     shown. A pool is keyed by operation, paint colour and output, as before.
   - A lone object on one operation still paints itself. A cluster with one member is painted
     as a pool when that member also burns under another Fill operation.
2. **A pool keeps each member's place in the drawing order.**
   - A cluster is still painted whole, once, at its lowest member when nothing else is drawn
     between its members over it.
   - When something drawn between two members overlaps the cluster's box (a photo, a relief, or
     another vector), the pool is split there. Each part is painted where its lowest member
     sits: its members' own regions, clipped to the whole pool's even-odd region, and outlined.
     So a point is painted at each member whose region covers it, exactly as per-object paint
     was, but only where the pool burns.
   - `draw-scene.ts` passes each photo's and relief's box (`drawnBitmapBox`); the phone's
     artwork picture draws image frames first, so only its vectors split a pool.
   - **Clip budget.** A split costs one clip of the whole pool per part. Past 1,000,000 clipped
     segments a frame the pool is painted whole at its highest member instead, over the artwork
     between, so nothing it burns is hidden.
   - **Not adopted: painting at the highest member always.** It would paint a frame's ring over
     a photo drawn above the ring's own place, which per-object paint never did.
3. **A filled path is solid to a click only where its pool's parity is odd.**
   - `fillPoolParityAt` (`hit-test.ts`) counts, once per pool and only when a filled path under
     the point asks, the pool's objects that cover the point (each object's paths unioned, each
     by its own rule). A filled path is solid where it covers the point by its rule and some
     Fill operation it burns under has odd parity there. Otherwise it is an interior hit, as
     inside a Line shape (ADR-196): the artwork the canvas shows there is picked first, and an
     empty window still selects the smallest shape around it.
   - `hitTest` and `hitTestCandidates` (Alt+click) both use it. A jig box is not pooled, on the
     canvas or here. Callers outside the workspace (Design Studio, trace parts) keep the
     per-object test.
4. **Overlap groups are faster and kept between frames** (N6-P3-3).
   - The sweep compares group labels in its inner loop and merges smaller groups into larger
     (`fill-pool-clusters.ts`), about a quarter of the union-find's time on dense clusters.
   - Each operation's groups are kept while its members are the same objects, and a pool's
     segment count is kept with its contours, so a still frame does not sweep again.

### Consequences

- The canvas inks every point a Fill operation burns, whichever binding is first, and the
  artwork drawn between pooled members keeps its place. A caption over a photo shows over it.
- Clicks follow the pooled picture: a window cut by another object, or cancelled copies, no
  longer hide the artwork shown through them.
- A cluster split around other artwork is painted directly each frame (no sprite).
- Measured in jsdom with a no-op context, 5,000 overlapping Ø50 circles: a still frame 57-106 ms
  (main 365-476 ms), one member moved 128-193 ms (main 383 ms). Hovering the cluster costs about
  10-13 ms a move after the first, which flattens every member once.
- **Not changed:**
  - A path whose first visible operation is Line and a later one Fill is still stroked only
    (the KNOWN canvas styling of multi-bound artwork, 2026-07-17 layers-panel parity line 13).
    Amendment 2 retires this: the burn differed from it, on the path and on other objects.
  - N6-P3-2 (the stacked-copy advisory wording with a Line sub-layer) and the other N6 P3s.

### Verification

- `draw-scene-fill-pool-parts.test.ts` replays `drawScene`'s ink fills under their clips with the
  photo opaque over them, and compares the picture with the compiled hatch: Add operation on a
  plate's circle and on the upper of two overlapping parts (N6-P1-1); frame, photo, caption
  (N6-P1-2), an unsplit control, a photo above the whole plaque, and the clip budget. Four of
  its six cases fail on the previous main (all but the two controls).
- `hit-test-fill-pools.test.ts`: a separate window in three drawing orders, a scaled, mirrored
  and turned window, cancelled copies (and a third copy), a window a second Fill operation still
  burns (and with it hidden), and a window on another operation (N6-P2-1). Six of its seven
  cases fail on the previous main (all but the other-operation control).
