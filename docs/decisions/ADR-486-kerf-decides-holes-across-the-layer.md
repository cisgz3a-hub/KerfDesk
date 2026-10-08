## ADR-486 - Kerf decides holes across the whole layer, and kerf contours keep arcs (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Supersedes the sentence "Kerf offsets, tabs and fills never carry arcs" in ADR-432 decision 2 for
kerf offsets only (tabs and fills still never carry arcs), and removes "arcs for kerf-offset
contours" from ADR-432's list of what it left out. Laser only; CNC cutter compensation is unchanged.

### Context

The maintainer asked for a one-to-one audit of KerfDesk against Rayforge and then for the fixes it
found. Both apps exported G-code for the same jobs. With a 1 mm kerf offset, a 20 mm circle drawn as
its own object inside a 100 mm plate was cut 22 mm wide (38.995 to 61.005 mm); the same circle as a
hole of one compound path was cut 18 mm wide (41.002 to 58.997 mm). Rayforge grows it too.

The cause is in `appendPathSegments` (`compile-job.ts`): each path's closed contours were offset on
their own, so only rings of the same path could make a ring a hole. A circle drawn with the Ellipse
tool, a separate SVG element, a DXF entity or a separate text glyph inside a plate was always an
outline. Designs drawn on the canvas are made of exactly such separate objects, and the box
generator had to put its cut-outs inside the panel's path to get them compensated (ADR-106).

The inside-first travel order already decided "this contour is inside that one" across the whole
layer (`containment-depth.ts`), so the cut order treated the circle as a hole while the kerf grew it
like a part.

Separately, ADR-432 fitted native arcs to every line cut except kerf-offset ones, so every
kerf-compensated circle reached an arc-capable GRBL machine as dozens of short G1 moves.

### Decision

1. **The side of a contour is decided across the operation's layer.** A closed contour inside an
   odd number of other paths' closed contours on the same compiled layer is a hole, or an island
   inside one when the count is even, using the containment test of inside-first ordering with
   strict bounds so two coincident copies of a shape do not count each other. Each path's contours
   are still offset together in one call, so a compound path keeps its own hole and island rules
   and separate parts never merge into one outline:
   - when every contour of a path sits inside the same parity of other paths, the path's joint
     offset is kept and turned inward when that parity is odd;
   - when another path's contour runs between a path's own contours, each contour of that path is
     offset alone by its full depth.
2. **Nothing else moves.** A layer with no contour inside another path's contour compiles
   byte-identically to before. Each path's kerf contours keep their place among the layer's other
   segments, so "keep source order" cuts in the same order. A failed offset still drops only that
   path's contours and reports `kerf-offset-failed`. Tabs placed by hand (ADR-494) still follow each
   source contour to the offset contour closest to it.
3. **Kerf contours carry arcs.** On a machine `laserArcMovesEnabled` accepts, a kerf-offset contour
   is fitted with the ADR-432 fitter against its own chords. At the usual 0.025 mm flattening, an arc
   through a circle's chords misses their midpoints by about the whole tolerance, so the contours of
   curved paths that will be fitted are flattened at 0.005 mm before the offset, and the fit's
   tolerance gives up the extra 0.004 mm so the arcs stay within 0.025 mm of the offset curve. Layers
   with tabs or perforation keep the usual flattening and no arcs, because those stages cut the
   contour into pieces that drop arcs anyway.
4. The Kerf Offset hint says that a shape inside another shape of the operation counts as a hole.

### Limits

The first two limits below are superseded by [Amendment 2](ADR-486-amendment-2-topology-before-process-settings.md): topology now precedes settings/power buckets and crossing contours require complete-boundary containment. They remain here as the original decision record.

- Containment is decided among the objects compiled together. An object with its own settings
  override or power scale compiles apart from the rest of the layer, so a hole drawn that way is
  still decided alone.
- A contour that crosses another path's contour has no clear side; it takes the side the
  containment probe (its bounds centre) finds, as the travel order already does.
- Code and test evidence only. No material was cut.

### Consequences

- Holes drawn as their own objects, including text cut out of a plate, come out the drawn size
  instead of two kerfs too large, and islands inside them are compensated as parts.
- The travel order and the kerf now agree on which contours are holes.
- Kerf-compensated circles on arc-capable GRBL, grblHAL and FluidNC machines go out as a few G2/G3
  moves. The Falcon A1 Pro and other machines without arcs are unaffected by decision 3.

### Tests

`compile-job-layer-kerf.test.ts` (separate object, separate path of one object, island, compound
path inside another object, a path straddled by another object, separate parts stay apart,
coincident copies, unchanged layouts, source order, arcs on and off, tabs keep the usual chords,
hand-placed tabs re-keyed through the offset);
`cut-arc-moves.test.ts` (kerf contours now carry valid arc moves).
