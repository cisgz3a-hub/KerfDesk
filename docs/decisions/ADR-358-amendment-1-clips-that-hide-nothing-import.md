## ADR-358 Amendment 1 - A vector clip that hides nothing imports (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

Item 4 rejects the whole file for any vector clip, mask or filter. Importing the artwork unclipped
could cut what the design hides, so this is deliberate. Before #865 such clips were silently
ignored.

The rejection also caught clips that hide nothing, and design tools write these on ordinary
exports. The agent that audited #865 reports that Figma wraps an exported frame's content in a
clip to the frame rectangle, and that Illustrator clipping groups and Canva exports do the same;
real exports have not been checked here. Files like that imported on 2026-09-24 and imported
nothing after #865.

The image clip rule also read a missing `clipPathUnits` as unsupported, although the SVG default
is `userSpaceOnUse`. The 2026-09-25 audit of PRs #845-#904 found both (ART-2).

### Decision

1. A vector clip is accepted when KerfDesk can prove it hides none of the element it clips. All of
   the following must hold:
   - the clip is in user-space units;
   - it holds exactly one shape, with no nested clip;
   - the shape's outline, after the referencing element's transform and the clip's and shape's
     own transforms, is a single convex ring;
   - every document-space point of the clipped element lies inside it, within 10⁻⁶.
   Ignoring such a clip changes nothing that is cut.
2. Every other vector clip is still refused, including concave clips, several shapes,
   `objectBoundingBox` units, and a clip that cuts. Masks and filters are still refused.
3. An image clip without `clipPathUnits` is read as `userSpaceOnUse`. The rest of the image clip
   subset is unchanged (one compound even-odd path).

### Consequences

- Frame- and artboard-clipped exports whose content sits inside the frame import again, with
  exactly the geometry they have without the clip.
- Content that overflows its frame is still refused, since a real intersection is still not
  computed. Intersecting vector geometry with the clip, which item 4 leaves out, remains a
  follow-up.
