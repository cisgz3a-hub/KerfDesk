## ADR-441 Amendment 2 - Height areas for objects that stand above the material (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-440 undoes parallax exactly, but only for one surface: the overlay and the trace picture the
whole bed at the single material height. A box standing on a 3 mm sheet has its top 40 mm up,
so with an overhead camera its edges land several millimetres from where the laser would put
them. Setting the material height to 40 mm fixes the box and breaks the sheet. LightBurn has
the same single "material thickness" for its overlay.

### Decision

1. **Height areas.** `core/camera/model/height-areas.ts` defines a `SurfaceHeightArea`: a bed
   rectangle in mm with its own top height. `surfaceHeightAt` gives the height the camera sees
   at a bed point: the highest area that contains it, or the material height outside every
   area. An area lower than the material height still wins inside itself, so an opening cut
   through the sheet can show the bed below. Edges count as inside.
2. **Overlay passes.** The shader's bed-size uniform becomes a clip rectangle (`uClip`). A draw
   is one pass for the whole bed at the material height, then one pass per area, lowest first,
   clipped to the area and cut to the bed. Blending is off, so the last pass over a pixel owns
   it and the highest area ends on top, which is exactly `surfaceHeightAt`. Inside its clip, a
   pass writes transparent where the camera cannot see the point, so the material picture never
   shows through at the wrong height. The CPU mirror (`bedOverlayCompositeCoord`) runs the same
   passes, and the tests hold it to the camera model at `surfaceHeightAt` for every sampled
   fragment. Passes keep the number of areas unlimited; a fixed-size uniform array would have
   capped it.
3. **Trace.** `warpFrameToBedImage` takes the region of the bed it pictures and the areas. It
   builds one interpolation grid per area over only the output pixels whose centres lie in it,
   highest first, so each pixel is read at the height `surfaceHeightAt` picks. **Trace area**
   in an area's row traces only that area. It uses 8 px/mm instead of the whole-bed 4 px/mm,
   lowered for a very large area to keep the picture near 12 megapixels, but never below
   4 px/mm. The traced vectors land inside the area.
4. **Panel and canvas.** **Add height area** in the Camera panel starts an area around the
   selected objects with a 10 mm margin, because an object's top is almost always larger than
   the artwork on it. With nothing selected, it starts as a 100 mm square in the middle of the
   bed. The new area takes the material height, and its height field gets the focus. Each row
   edits the height, X, Y, width and depth, and offers **Trace area** and **Remove**. The canvas
   draws each area as a dashed outline labelled "Area n: h mm".
5. **Not saved.** Areas live in the camera store next to the material height. They describe
   what is on the bed now, so they are not written to the project or the machine profile.
   Changing them cancels a trace capture that is still in flight, as a material height change
   already does.

Measuring on the camera picture needs nothing new: the canvas measure tool works in bed
millimetres, and the overlay under it is now correct at each object's own height.

No new guards. **Trace area** is disabled without a live camera, like **Trace from camera**,
because there is no frame to capture (a transport precondition).

### Consequences

- An overlay draw costs one full-canvas pass per area. Discarded fragments are cheap, and a
  handful of areas does not change the frame rate.
- The job's own focus and Z offset are unchanged. Areas only correct what the camera shows.
- A height map from a probe or autofocus could later feed the same passes as many small areas.
