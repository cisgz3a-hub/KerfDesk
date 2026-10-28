## ADR-677 - The selection box is the smallest box around the outline

**Status:** Accepted; unit- and UI-tested against emitted G-code, not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v2 08-P3-3, which rolling audit v7 area L2 re-observed and re-rated P1
(`docs/audits/2026-10-28-rolling-v7/L2-shapes-dimensions.md`). The Frame-first Start contract
(PROJECT.md non-negotiable 21, ADR-565) is unchanged: Frame and preflight already measured the
burned geometry, and nothing here adds or removes a Start guard.

### Context

Every object box (`transformedBBox`, and `combinedBBox` and `selectionMetrics` on top of it) was
the axis-aligned box around the four transformed corners of the object's own bounds. That box is
the smallest one only while the object is square to the bed. Turned at another angle, the corners
of a round or irregular shape's bounds stick out past its outline:

- A 50 mm circle at 45° read W 70.711 on the toolbar and "Rotated footprint on the bed: 70.711 ×
  70.711 mm" in the Shape Inspector. The G-code burned it 49.994 wide.
- With the aspect lock on, typing W 50 scaled it by 50 / 70.711: it burned at 35.32 mm while the
  toolbar and the note read 50. Typing X 100 burned from 107.34.
- A hexagon of radius 25 read 65.974 and burned 48.296; a 60 × 30 r15 rounded rectangle read 63.64
  and burned 51.208.

LightBurn 1.7's Numeric Edits Toolbar measures the selection as "the smallest possible rectangle
that can contain every object in your selection"
(https://docs.lightburnsoftware.com/1.7/Reference/NumericEditsToolbar/).

### Decision

1. **An object turned at an angle that is not a quarter turn is measured by its outline**
   (`core/scene/object-extent.ts`, used by `transformedBBox`). The extent reads the geometry the
   compiler flattens (canonical curves when present, otherwise the polylines) in world axes: every
   point, the extremes of each cubic (an affine map takes a cubic to the cubic of its mapped
   control points, so each axis is solved in closed form) and the extremes of each elliptical arc.
2. **Everything else keeps its own bounds' corners**, which are already the smallest box: an
   object square to the bed (0°, 90°, 180°, 270°), a raster image or relief (their footprint is the
   rectangle), a barcode (its box includes the quiet zone) and an object with no outline. An
   unturned project therefore measures exactly as before.
3. **Every consumer of the object box follows**, because they share `transformedBBox`: the
   toolbar's W/H/X/Y and typed resizes and positions, the selection handles and drag-resize, the
   Shape Inspector's footprint note, the out-of-bed outline and banner, Move to bed, align,
   distribute, dock, flip, the grid array's gaps, the Point Rotation pivot (ADR-307 Amendment 3),
   the Circular and Copy Along Path source centre, the board-array cell, snapping, marquee
   selection, the hover readout and the remote control's bounds. The registration jig's in-frame
   measure (`selectionMetricsInFrame`) turns the scene back by the frame angle and measures the
   same way. Rolling audit v7 L4 measured the old box in the arrange tools
   (`docs/audits/2026-10-28-rolling-v7/L4-transform-arrange.md`): a 45° Ø50 circle aligned Left
   landed 10.36 mm off the reference edge, a typed 2 mm grid gap burned 22.72 mm, and Flip
   Horizontal moved a 30° triangle 10 mm.
4. **A move does not re-measure.** The extent is cached per outline (the `paths` array) and per
   scale, mirror and rotation, and the translation is added afterwards.
5. **The typed rotation still pivots on the centre of the object's own bounds.** That point never
   moves as the object turns, so typing an angle and then the old one puts the artwork back. The
   centre of the smallest box around a lopsided outline moves as it turns, so pivoting there would
   walk the artwork across the bed over repeated angle edits. Rotation drags and Rotate by, which
   are relative, pivot on the centre of the drawn selection box, now the smallest box.

6. **Rotate 90° (ADR-410) pivots on the new box's centre, placed on a 2⁻³⁰ mm grid** (about a
   nanometre, far below any machine step). The box around a turned outline is measured with float
   noise, and a pivot that moved by it between turns would let four turns drift; on the grid the
   pivot is the same each turn, so four turns still return every transform exactly.

### Consequences

- A turned circle reads, resizes and places at the size and position it burns, through the
  toolbar, the canvas handles and the Inspector note. An aspect-locked resize scales every object
  evenly about the anchor, which scales the smallest box by exactly the typed factor.
- Convert to Bitmap still covers the turned own-bounds box, which holds every outline. Its
  packed photo path rasterises objects that carry no outline, and both paths must produce the
  same grid, so the converted image is unchanged.
- The fit-to-bed, fit-to-board and fit-to-region helpers still measure an object by its own
  bounds' corners and centre it by its own bounds' centre. That keeps them self-consistent and
  conservative (a turned round shape is fitted a little smaller than it could be). They are left
  for a later change.
- Measuring a turned object walks its outline once per scale or rotation change: a rotate or scale
  drag of a large turned trace re-measures it each frame.
