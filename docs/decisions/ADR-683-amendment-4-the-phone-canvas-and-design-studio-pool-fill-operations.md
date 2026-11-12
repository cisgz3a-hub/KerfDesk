## ADR-683 Amendment 4 - The phone's vector canvas and Design Studio's underlay paint a Fill operation as it burns (2026-11-11)

**Status:** Accepted on 2026-11-11; unit-tested against the compiler's hatch through `buildScene`
decoded by the phone's own `decodeScene` and `hitTest`, and through `paintDesignProjectVectors` /
`paintDesignProjectArtwork`. Not checked by eye on a phone or in Design Studio, and not
hardware-tested. |
**Amends:** ADR-683 Consequences ("Not changed: the phone's vector projection ... and Design
Studio's underlay of project artwork still fill object by object") |
**With:** ADR-582 (the phone's bounded vector projection), ADR-196 (click rules)

### Context

ADR-683 made the workspace canvas and the phone's PNG preview paint a Fill operation as the one
even-odd region the compiler burns (`fill-pools.ts`). Two surfaces still filled each object on its
own, so a circle drawn inside a plate on one Fill operation showed solid there but burned as a
ring, and two stacked copies showed solid but burned nothing:

- **The phone's vector canvas.** `remote-control/scene-projection.ts` sends each path with a
  `fill` flag. The phone (`services/remote-control/app`) draws every path as one SVG path, with
  even-odd only inside that path, in a group per object that it moves on its own during a gesture,
  and picks the topmost object whose filled path or outline is under the finger.
- **Design Studio's underlay** (`design-studio/design-project-vectors.ts`, also used by
  `design-project-photos.ts`) drew each project object with `drawObjectDisplay`.

### Decision

1. **The phone receives each pool already resolved, as every member's share**
   (`remote-control/scene-projection-pools.ts`). The projection plans the pools with
   `planPools` (no artwork splits them: the phone draws photos only as frames, under all vectors)
   and gives each member the part of its pool's region where it is the topmost member covering
   the point: its own region, less every member above it, less the points the members below it
   cover an odd number of times (Clipper2, through `polygon-difference.ts`). Shares never overlap
   and together are exactly the burn, so the phone's translucent fill paints each burned point
   once. Each share is sent as a filled path on its member, in the pool's colour and output, ahead
   of the member's own paths, and each member keeps its id, unit and bounds.
2. **What a pool paints is not sent again.** A pooled path drops its closed contours when its
   paint is a fill, and keeps its open contours, unfilled. A path drawn as a stroke keeps its
   stroke, unfilled. A member that a pool leaves nothing to fill (a hole, a cancelled copy) keeps
   its pooled paths as outlines, unfilled, as the canvas outlines cancelled copies (LightBurn).
   Objects alone in their cluster are sent as before. If the geometry engine fails on a pool, its
   lowest member carries the whole pool and the others send outlines, so the burn is still shown.
3. **Taps follow the desktop's direct hits.** Because a share is where its member is the topmost
   one covering the point, the phone's existing pick (topmost filled path or outline) gives the
   object the desktop hits directly (`core/scene/hit-test.ts`, `fillPoolParityAt`). The phone has
   no line-interior pick (ADR-196): as it already did for an unfilled Line shape, it picks a hole
   or a cancelled copy by its outline, not by its empty inside. A member's share boundary can run
   along another member's edge; where the share's member is drawn above, a tap on that edge picks
   it, as its solid fill did before this amendment.
4. **The contract and the phone are unchanged.** Paths keep `{ color, fill, output, polylines }`,
   points are simplified and encoded as before, and the response stays inside the same
   `fitsRemoteResponse` loop, which coarsens the tolerance (up to 32 times) before it gives up.
   Shares add contour where a hole's edge is sent both as its own outline and as the edge of the
   share around it; the loop absorbs that. No phone bundle or Worker redeploy is needed: the fix
   reaches every paired phone when the desktop updates.
5. **Design Studio's underlay pools as the workspace canvas does.** `createDesignVectorPainter`
   now takes the canvas, resolves every visible saved vector up front, plans the pools with
   `planFillPools` and paints them with `createFillPoolPainter` (`drawFillPool`, so dense pools
   come from sprites and rasters as in Amendment 3) before the member they belong to, then draws
   each object less the fills its pool paints. `paintDesignProjectArtwork` passes each visible
   photo's box, so a photo stacked between two members splits the pool there and keeps its place
   (Amendment 1); queued pools are painted before each photo. The live draft's objects stay out of
   the plan: the draft draws them itself. The underlay plans each frame without the workspace's
   plan cache, so it does not take the workspace canvas's two slots.

### Consequences

- Every surface that fills project artwork now shows a Fill operation as it burns: the workspace
  canvas, the phone's PNG preview, the phone's vector canvas and Design Studio's underlay.
  Wireframe and the Preview underlay still draw outlines.
- On the phone a tap inside a hole or a cancelled copy picks nothing (it picked the object when the
  object was drawn solid); its outline picks it, and marquee selection is unchanged.
- During a phone drag a member's share moves with it until the next projection arrives, so a hole
  dragged out of a plate shows its old hole in the plate until then.
- Compiled output, the desktop's hit test and the projection's size limits are unchanged.

### Tests

- `src/ui/remote-control/scene-projection-fill-pools.test.ts`: decodes `buildScene` with the
  phone's `decodeScene`, counts the filled paths over each point against `compileJob`'s hatch
  (an inner circle in either drawing order, two and three copies, crossing plates, separate
  operations, objects that overlap nothing), compares the phone's `hitTest` with the desktop's
  direct hit, and checks every path's shape.
- `src/ui/design-studio/design-project-fill-pools.test.ts`: records the underlay's fills (by rule,
  inside every clip) and strokes against the hatch, the photo-between order, and the live draft.
