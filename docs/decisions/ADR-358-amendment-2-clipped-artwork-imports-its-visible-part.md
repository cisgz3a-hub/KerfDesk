## ADR-358 Amendment 2 - Clipped SVG artwork imports the part its clip keeps (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

Item 4 rejects the whole file for any vector clip, mask or filter. Amendment 1 accepted a clip
that provably hides nothing, but a clip that hides part of the artwork still rejected the file, as
did every vector mask and filter. Before #865 all three were ignored and the artwork imported
unclipped.

Design tools clip ordinary exports. Figma wraps a frame's content in `<g clip-path>` to the frame
rectangle, Illustrator writes a clipping mask as a `<clipPath>` holding a `<use>` of the mask
shape, and Canva clips in the same way. Content that overflows its frame is common, and each such
file imported nothing. These structures come from the audit and the SVG specification; real
exports have not been checked here.

The image clip rule also refused SVG's default `clip-rule` (nonzero). It accepted only one
`<path>` child with an explicit even-odd rule and no nested clip. The 2026-09-25 audit of PRs
#845-#904 reported both (ART-2).

### Decision

1. A clipped vector element imports as its intersection with the clip region:
   - Filled artwork is intersected as polygons under its own fill rule (nonzero unless
     `fill-rule` says even-odd). Its subpaths close implicitly, as SVG fills do.
   - Stroked artwork is cut as lines, so each line keeps the stretches inside the region, in path
     order and direction. A closed outline cut open at its start stays one piece. The region is a
     closed set: a line on its edge, within its 1 µm grid, is kept. Clipper2's open-path clipping
     is not used, because it reorders the pieces and keeps a line on the edge on some sides but
     not others.
   - Artwork wholly outside its clip imports nothing.
2. The region follows SVG 1.1 §14.3 and CSS Masking 1 §6:
   - `clipPathUnits` is `userSpaceOnUse` by default and may be `objectBoundingBox`. The bounding
     box is the referencing element's geometry and its rendered descendants' geometry, in its user
     space, without stroke. Native curves count by their exact extrema; text is not measured.
   - `clip-rule` applies per clip child and inherits through the clip definition, not from the
     artwork. Its initial value is nonzero.
   - The clipPath's `transform` applies outside the bounding-box mapping, as Chromium and Firefox
     apply it. Each child's transform and the referencing element's user space also apply.
   - Children are united. A child hidden by `display:none`, or by a `visibility` other than
     visible inherited through the clip's own ancestors, contributes nothing. A clip with no
     visible content hides everything, as SVG renders it. Children other than shapes, text and
     `<use>` are ignored, as browsers ignore them.
   - A `<use>` child contributes the shape it references directly, with its `x`, `y` and
     transforms.
   - A `clip-path` on the `<clipPath>` intersects the whole clip, in the referencing element's
     user space. One on a clip child, or on a `<use>` or its shape, clips that child. Nested
     clipped groups intersect.
3. Curves in clip outlines and in the artwork a clip cuts are flattened at
   `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` (0.025 mm), the tolerance at which job compilation cuts
   native curves. Clipper2 works on the 1 µm grid the in-app Boolean tools use. Artwork the clip
   keeps whole imports unchanged with its native curves. The Amendment 1 convex proof decides this
   first, now also for `<use>` and `objectBoundingBox` clips. Otherwise the intersection itself
   shows that nothing is cut: a whole filled element, or each whole line of a stroked element.
   Only cut geometry is flattened.
4. These cases still refuse the file, each with its reason:
   - A clip made of text. KerfDesk cannot outline it; ignoring the clip would cut what the design
     hides, and dropping it would drop visible artwork. Convert the text to paths first.
   - A `<use>` in a clip that refers to anything but a shape, which SVG 1.1 §14.3.5 forbids.
   - A clip-path that names no `<clipPath>` in the file.
   - Clip geometry or transforms set through CSS, or a transform attribute that cannot be read in
     full, as in Amendment 1.
   - Clip coordinates beyond the importer's coordinate limit, a clip nested inside itself or more
     than 32 levels deep, and nested references that reach more than 1,000 clips from one
     reference.
5. Vector masks and filters no longer refuse the file. The artwork imports without the effect,
   and an `SVG presentation` note, shown as a warning toast, counts the elements imported without
   their masks (areas the masks hide are included) or filter effects. The geometry is exact; what a
   mask hides or softens is not geometry KerfDesk can derive, and a filter changes rendering, not
   geometry. The operator sees the warning and can delete what should not be cut. Masks, filters
   and opacity on embedded images keep item 2's refusal.
6. Image clips use the same reader and region. A missing `clip-rule` is nonzero and a missing
   `clipPathUnits` is `userSpaceOnUse`. Basic shapes, several shapes, `<use>`, `objectBoundingBox`
   units and nested clips are accepted. KerfDesk's exported form, one compound even-odd path, still
   keeps native curves. Any other clip is stored as the flattened even-odd outline of its region,
   in image-local coordinates.

### Consequences

- Frame- and artboard-clipped exports whose content overflows the frame import the visible part.
- Cut curves become 0.025 mm polylines and can no longer be edited as curves. Artwork a clip leaves
  whole is unchanged.
- Each element meets only the part of the region around it. In jsdom, 3,000 curved elements took
  about 1.0 s unclipped and 1.6 to 1.9 s under a frame clip or a 1,000-vertex concave clip.
- Mask groups, such as Figma alpha masks of opaque shapes, import unmasked rather than as clips.
  Converting opaque-shape masks to clips remains a possible follow-up.
- Verified with unit tests through the main-thread and worker parsers only, not against real
  design-tool exports, in a browser, or on a machine.
