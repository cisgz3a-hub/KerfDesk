## ADR-683 - The canvas paints a Fill operation as it burns, and stacked Fill copies are named

**Status:** Accepted; unit-tested through the real store, `drawScene`, the compiler, preflight and
the Job Review dialog. Not checked on screen against LightBurn, and not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v7 area L8 findings L8-P1-1 (with the refuter's Duplicate / Paste in Place
extension) and L8-P2-5 (`docs/audits/2026-10-28-rolling-v7/L8-canvas-interaction-history.md`).
Extends ADR-410's Filled view, ADR-196's click rules and ADR-480's Delete Duplicates. The
compiled output of every project is unchanged: only the canvas, the phone's artwork picture,
click selection and the advisories change.

### Context

- **The burn pools a Fill operation even-odd.** The compiler resolves each object by its own
  paths' rules (non-zero for text), unions that object's paths, and hatches all of the operation's
  objects together with even-odd parity (`layer-fill.ts`, `fill-rule.ts`, ADR-486 Amendment 2).
  With per-object settings the ownership route burns the same cells: those an odd number of the
  operation's shapes cover (`fill-material-ownership.ts`). A shape drawn inside another on the
  operation is a hole, as in LightBurn ("the area between the two outlines will be filled",
  LightBurn 1.7 Fill Mode, https://docs.lightburnsoftware.com/1.7/Reference/CutSettingsEditor/FillMode/),
  and ADR-681 writes exports that way.
- **The canvas filled each object by itself** (`object-display.ts`, `draw-vector-strokes.ts`).
  A 40 × 30 plate with a separate Ø16 circle on its Fill operation showed a solid plate and
  burned a 999.7 mm² ring. Duplicate (Ctrl+D) or Paste in Place on a Fill plate took its hatch
  from 12,000 mm to 0, because the copies cancel, while the canvas still showed it solid and
  neither preflight nor Job Review said anything.
- **LightBurn warns.** Stacked duplicates "can cause closed shapes set to Fill Mode to appear
  unfilled" (LightBurn 2.0, Vector Artwork Imports With Extra Lines,
  https://docs.lightburnsoftware.com/2.0/Troubleshooting/ImportedExtraLines/). Identical shapes
  on one Fill layer "negate each other, and neither will output", and LightBurn shows a warning
  before Preview or engraving whose **Show Me** selects one copy of each so it can be deleted;
  **Edit → Delete Duplicates** (Alt+D) removes shapes "identical in size, shape, and position"
  (Missing Shapes, https://docs.lightburnsoftware.com/2.0/Troubleshooting/PreviewWindow/MissingShapes/,
  and https://docs.lightburnsoftware.com/2.0/Reference/DeleteDuplicates/, read 2026-10-28).
  How LightBurn's Filled view draws a non-identical nested shape is not documented.
- **A filled shape's hole was a solid click target.** `hit-test.ts` tested each contour alone, so
  a point inside a hole's own ring counted as filled. Artwork the canvas showed through the hole
  could be reached only with Alt+click, against ADR-196's "preserving access to nested artwork".

### Decision

1. **The canvas paints each Fill operation as the one region it burns** (`ui/workspace/fill-pools.ts`).
   - The objects whose filled paths use one operation (with the same paint) are pooled. Each
     object's contribution is what the compiler burns for it: its single even-odd path as drawn,
     or else each path resolved by its own rule and the object's paths unioned (falling back to
     the raw contours, as the compiler does, if that fails). The pool is filled once, even-odd.
     A path bound to several Fill operations is pooled under each of them (Amendment 1). Who is in
     a pool is taken from what output does: Output on, the compile run, and every operation a path
     burns under, wherever it comes in the path's bindings (Amendment 2).
   - Only objects whose boxes overlap can change one another's parity, so an operation's objects
     are split into overlapping clusters. A lone object paints itself exactly as before, sprite
     included; a cluster is painted once, where its lowest member sits in the drawing order, and
     is cached as a sprite when it is as dense as a sprited object. When other artwork drawn
     between its members overlaps it, it is painted in parts instead, each clipped to the pool
     where its lowest member sits (Amendment 1).
   - The pool is also outlined in its own colour at the artwork stroke width. Every contour of an
     even-odd region is one of its edges, so the outline changes nothing except where copies
     cancel: there the shapes show unfilled, as in LightBurn, rather than vanish.
   - Each member still paints its open contours and other operations' paths itself, and keeps
     its own selection outline and hover pulse. Different operations are never pooled
     together. Wireframe view and the Preview underlay draw outlines, so they are unchanged.
   - The phone's artwork picture (`remote-control/preview-projection.ts`) uses the same pools.
2. **A filled shape is solid only inside its filled region.** The hit test winds the point
   against all of a path's closed contours with that path's rule (non-zero for text). A point in
   a hole is an interior hit, as inside a Line shape (ADR-196): artwork shown through the hole is
   picked first, and an empty hole still selects the shape. The pool's parity counts too, so a
   hole cut by another object, or cancelled copies, pass clicks through as well (Amendment 1).
3. **Stacked Fill copies that cancel are named** (`core/job/cancelled-fill-copies.ts`).
   - On a laser machine, objects whose closed contours on one output Fill operation are the same
     rings to 0.001 mm (any start point, either direction; non-zero paths keep their winding), as
     Delete Duplicates compares them, form a set. A set with an even count burns nothing there and
     gives the advisory `fill-stacked-copies-cancel`: "N stacked copies on Fill operation "…"
     burn nothing", pointing to Edit → Delete Duplicates. An odd count still burns once and is
     not reported. A cheap box-and-count key keeps ordinary scenes from building exact keys.
   - It is a preflight advisory, so Start's Job Review and Save show it and neither is blocked
     (AGENTS.md: policy findings stay warnings; an intended gap made this way is legitimate).
   - Job Review adds **Show stacked copies**, LightBurn's Show Me: it cancels the review and
     selects every copy but the lowest of each set, so one Delete leaves one copy to burn.
   - CNC keeps ADR-359 Amendment 3: its compile cuts exact copies once and reports that.

### Consequences

- The canvas now shows the holes and cancellations the burn has had all along (ADR-486
  Amendment 2). A design that relied on the canvas showing a solid plate now shows its hole.
- A lone object, and every scene without overlapping objects on one Fill operation, paints
  exactly as before. A pooled cluster rebuilds its world contours when a member changes, and a
  text or multi-path member is resolved once per display zoom bucket.
- Copies that are close but not exact (nudged, or the same shape redrawn with other nodes) are
  not advised; the canvas now shows what they burn.
- Not changed: the phone's vector projection (it sends per-path fill flags to the phone's own
  renderer) and Design Studio's underlay of project artwork still fill object by object.
