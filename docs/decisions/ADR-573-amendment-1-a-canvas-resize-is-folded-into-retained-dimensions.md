## ADR-573 Amendment 1 - A canvas resize is folded into retained dimensions

**Status:** Accepted; unit- and store-tested against the burned outline, not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v7 L5-P1-1 and its generated-part sibling
(`docs/audits/2026-10-28-rolling-v7/L5-design-studio-sketch.md`). ADR-573 retains sketch
constraints and part-generator definitions beside their paths, but did not say what a canvas
resize means for them.

### Context

- A toolbar or handle resize sets the object's transform scale. Regenerating a constrained sketch
  or a generated part kept that scale, while its editor showed the sketch's own (unscaled) values
  and size. A bracket resized from W 60 to W 120 and then typed to width 80 and hole Ø6 read
  "Size 80.000 × 30.000 mm, fully-constrained" and burned 160 × 60 with Ø12 holes. A W-only
  resize burned the "Ø6" holes as 12 × 6 ellipses. A Panel stretched to H 80 burned the same way.
- **LightBurn** pushes a resize back into a shape's own size "where possible", so its Width and
  Height update and its corner radii stay correct (LightBurn developer, forum thread "Shape
  properties dimension does not match actual shape dimension", 2019-08-01, describing 0.9.03).
  Where the result is no longer that shape, there is no single right width or height. ADR-144
  Amendment 1 already follows this for rounded rectangles.
- **Parametric CAD** sketch scale tools take one factor. Users of Fusion and FreeCAD report that
  their sketch Scale deletes linear, radius and diameter dimensions, and contrast it with CAD
  systems that adjust the dimensions by the factor. No sketch tool keeps a non-uniform scale with
  its dimensions: a circle cannot stay a circle.

### Decision

1. **An editor opens on the sizes that burn.** When a constrained sketch or a generated part has
   an even scale (the same factor on both axes), Edit constrained sketch… and Edit generated part
   dimensions fold that factor into the values they show: every length scales (point positions,
   circle radii, x/y, distance and diameter values, mm parameters and the mm literals inside
   parameter expressions; every `…Mm` part field). Angles, ratios, bare numbers, rows and columns
   do not. The parameter subset refuses a product of two lengths, so this scales every length
   exactly. The editor says so: "This sketch was resized to 200% on the canvas. The sizes here
   include that resize, so they are the sizes that burn."
2. **Regeneration writes scale 1.** Applying a reviewed sketch or part resets the transform scale
   to 1 (a negative scale keeps its sign; mirror, rotation and position are kept). The transform
   scales about the object's own origin, so the folded dimensions burn exactly where the scaled
   ones did, and applying without a change leaves the outline as it was. The review's size is the
   burned size.
3. **A stretch is not folded.** With a different factor per axis the editor opens on the
   sketch's or part's own values and warns: applying returns it to those sizes and its holes stay
   round; Bake keeps the stretched outline as plain artwork instead.
4. **A resize while the editor is open asks for a reopen.** The editor passes the transform it
   opened on; if the scale has changed since, the review is refused ("The sketch was resized after
   this editor opened. Close and reopen it to edit its current size.") instead of applying values
   folded for another size.

### Consequences

- The value typed in either editor is the size that burns, whatever the canvas did before.
- A resize on the canvas is still a transform scale until the editor applies; the toolbar, the
  Inspector and the burn all show that size. Only the editors' own values were wrong, and those now
  match.
- Undo restores the scaled object exactly; Bake is unchanged.
