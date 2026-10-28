## ADR-144 Amendment 1 - A resized rectangle keeps round corners

**Status:** Accepted; UI-tested against emitted G-code, not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v7 L2-P2-1 (re-rated P1), L2-P3-4 and L2-P3-2
(`docs/audits/2026-10-28-rolling-v7/L2-shapes-dimensions.md`). ADR-144's Consequences said width
and radius stay object-local while "the existing selection transform controls continue to own
whole-object scale". This amendment changes that for rectangles.

### Context

- **L2-P2-1.** A toolbar or handle resize sets the object's transform scale. A rounded rectangle's
  outline is built in its own units (`rectangle.ts`), so a W/H resize that scales the axes
  differently stretched its corners into ellipses. A 100 × 50 r10 rectangle typed to W 200 burned
  20 × 10 mm corners while the Corner radius box showed 10 (the smaller axis scale). Typing 6
  burned 12 × 6, so a round corner could no longer be made. The everyday drag-drawn rectangle hit
  it too: drawn 40 × 20, typed to W 200 and H 50, given radius 5, it burned 10 × 5 corners.
- **L2-P3-4.** The spec clamp wrote the radius down to half the shorter side, so narrowing a
  rectangle and widening it again lost the radius (50 × 50 r20 → W 10 stored r5 → W 50 kept r5).
- **L2-P3-2.** The Inspector's size boxes clamped 0, −5 and 1e-400 to 0.01 mm, collapsing a 40 mm
  rectangle to a sliver with no message. The toolbar refuses the same entry.

LightBurn 1.7 Primary Shapes (https://docs.lightburnsoftware.com/1.7/Reference/PrimaryShapes/):
the corner radius "remains consistent even if the dimensions of the rectangle are later changed",
and Width and Height change "in the Shape Properties Window and the Numeric Edits Toolbar".
Design Studio already keeps its rectangle corners round (ADR-272 Amendment 4, item 3).

### Decision

1. **A rounded rectangle whose scale changes takes the new size into its spec**
   (`withObjectTransform` in `core/shapes/rectangle-resize.ts`). Its width and height become the
   bed size, its corner radius keeps the bed size it had, and its transform scale returns to 1
   (keeping the sign of a negative scale). A move or a turn leaves it untouched. Every
   writer of resize transforms applies it: the selection transforms (toolbar, Match size, the
   remote control and the other selection commands), the canvas drag frames and the registration
   jig editor. A sharp rectangle (radius 0) keeps taking a resize as transform scale: it has no
   corner to keep, the scale holds its stretch exactly, and registration boxes, captured-board
   outlines and jig outlines stay as they were.
2. **An even resize of a rectangle turned at an angle that is not a quarter turn stays a plain
   scale.** Its corners stay round and grow with it. Keeping the radius there would change the
   outline's smallest box (ADR-677) by something other than the typed factor, so the typed size
   would not burn. Only an aspect-locked resize is possible at those angles.
3. **The spec keeps the authored radius.** The outline clamps it to half the shorter side, and the
   Corner radius box shows the clamped radius, which is what burns.
4. **A stretched rectangle with a radius is made round by any Shape Properties edit**
   (`rematerializeShapeSpecEdit`): a sharp one stretched and then given a radius, or a rounded one
   an older build stretched. Its corner becomes the radius the box showed (the smaller axis
   scale) at its bed size. Until then a note under the box names the stretched corner, e.g. "The
   corners are stretched to 20 × 10 mm".
5. **A size of 0 or less is refused in the Shape Properties boxes**, as the toolbar refuses it
   ("Rectangle width must be greater than 0."), and a negative radius is refused. A positive size
   below the 0.01 mm minimum still clamps up to it; counts and percentages still clamp.

### Consequences

- The Corner radius box always names the round corner that burns. A rounded rectangle saved by
  this build holds its size in the spec, so its Width and Height boxes read the spec directly.
- A rounded rectangle resized at a quarter turn keeps its radius, as in LightBurn; one resized evenly while
  turned obliquely scales its radius with it.
- Ellipses, polygons and stars still take a resize as transform scale. A stretched ellipse is still
  an exact ellipse, and a polygon or star has no width and height in its spec to hold one.
