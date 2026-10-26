## ADR-673 - A picture kept after Trace engraves like any image; a kept camera capture does not (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26 (written 2026-10-20 as ADR-648; renumbered twice: ADR-648 went to owned-reset settings and ADR-672 to CNC side profiles)

Amends ADR-026 (the tint and its "deletable backing"), ADR-235 decision 2 for a kept source and
decision 4 ("excluded trace-source backing"), ADR-408 decision 4 (the fresh-trace default of
Delete Image After trace), ADR-101's CNC advisory note, and the trace-source checks in ADR-670's
tone calibration seed and ADR-633's jig tracer. It restores ADR-026 decision 5 ("The
retained source is output-eligible ... matching LightBurn"). The Frame-first contract (PROJECT.md
non-negotiable 21, ADR-565) is unchanged: a kept photo is ordinary output, framed like any other.

### Context

A customer engraved a photo and then cut its outline with a deeper cut. That is LightBurn's
standard workflow, as Oz (LightBurn staff) describes it in
[How do I cut out around the outline of an image?](https://forum.lightburnsoftware.com/t/how-do-i-cut-out-around-the-outline-of-an-image/15234):
Trace Image with Delete image after trace left off, "since you want to keep the image for
engraving", then Offset Shapes outward with Delete original objects, and cut that outline.

In KerfDesk the photo silently stopped engraving. Tracing with the box unticked tagged the photo
`role: 'trace-source'`; the 2026-05-29 marker comment said it "affects display only; never the
compiled G-code", but commit 43382f96c (2026-06-02) made compile skip it, and later code taught
Frame, preflight, Sort cuts last, previews, Photo engraving and the hover card to skip it too (the
hover read "Trace source, not output"). Reproduced on 330462b91 with the store actions: import the
photo, and the job is `[raster]`; trace keeping it, `[fill]`; Offset Shapes outward with outer
shapes only and Delete original objects, still `[fill]`. ADR-235 decision 4 calls the kept photo
an "excluded trace-source backing", against ADR-026 decision 5. The tag also outlived the trace:
delete the trace and the photo still never engraved.

Three more defects sat on the same path:

- Delete Image After trace was ticked by default. Commit f522575df (#786, 2026-09-13) flipped it
  from off to on without a decision; ADR-030 recorded LightBurn's default as off.
- Duplicate, Copy, Array and the other copy commands treated a trace's photo as a dependency
  (#865), so copying the outline copied the photo with it. While the photo was dead that went
  unnoticed; once it engraves, each copy would stack another engraving of it.
- Trace from Camera stores the capture the same way as a kept photo. Making every kept picture
  engrave would burn the camera's picture of the bed onto the material.

### What LightBurn does

- Trace Image ([docs](https://docs.lightburnsoftware.com/latest/Reference/TraceImage/)): Delete
  Image After trace is an option the operator turns on to remove the image when OK is pressed;
  otherwise the image stays in the project as an ordinary object (the docs warn the new vectors
  "may be hidden by the original image" and suggest engraving the original instead of tracing
  it). Rick (LightBurn Technical Evangelist) in
  [Trace not working](https://forum.lightburnsoftware.com/t/trace-not-working/96970) describes the
  option as On (green) or Off (red). Fade Image only dims the image in the Trace window's preview.
- Cuts / Layers ([docs](https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/)):
  Output decides what is sent to the laser, layers not set to output are drawn faded in the
  Workspace, and Show only hides or shows a layer.
- Camera Control ([docs](https://docs.lightburnsoftware.com/1.7/Reference/CameraControlWindow/)):
  Trace captures an image and opens the Trace Image window; the capture updates the overlay (Rick,
  [Camera update overlay](https://forum.lightburnsoftware.com/t/camera-update-overlay-no-longer-active-since-1-4-03/116767)),
  a placement reference in the Workspace, not artwork that is output.
- After a trace the image and the group of traced vectors are separate objects (Trace Image docs:
  OK presents "a Group containing the resulting vectors"), so copying the vectors leaves the image
  alone.

### Decision

1. **A kept picture is an ordinary image.** Trace no longer tags it. It engraves on its Image
   operation and counts everywhere an image counts: compile, Frame, preflight, overscan, Sort cuts
   last, raster preparation, Preview, the hover card (its power and speed), Photo engraving, the
   photo tone calibration seed (ADR-670), the jig tracer (ADR-633), the stacked-copy, upsample
   and CNC raster advisories. The trace keeps `traceSourceId` as a
   provenance link for Re-trace Original; it excludes nothing.
2. **Delete Image After trace is off by default**, for a fresh trace and a re-trace, as in
   LightBurn. Ticking it removes the picture on OK, as before.
3. **No tint.** LightBurn draws a kept image like any image, and in LightBurn a faded layer means
   "not set to output", which the kept photo no longer is. It now draws as an ordinary picture,
   including the adjusted tone it burns (ADR-359). The `traceSourceTint` theme colour is removed.
4. **No palette recolour.** `trace-source-palette.ts` moved a kept photo's operation to the image
   grey so the trace could take the first colour; its premise was that the photo emits no G-code.
   It is deleted. The photo keeps its operation and colour, as a LightBurn image keeps its layer,
   and the trace takes the next free colour like any second artwork. A deleted picture's
   operation is still pruned before the trace allocates, so a trace with the box ticked still
   takes the first colour.
5. **Raster scan output gets its own operations when the picture is kept.** With the picture
   deleted, the result reuses its Image operations (ADR-235, unchanged). With it kept, the result
   burns on copies of them (same settings, sub-operations and per-artwork settings; new id and
   colour, after the picture's), so either can be turned off on its own, as LightBurn's per-layer
   Output allows. Re-trace in place keeps the result's own operations.
6. **Copying a trace copies only the trace** (Duplicate, Copy and Paste, Array, Copy along path,
   nesting, variable arrays), as copying LightBurn's traced vectors leaves the image alone. The
   copy keeps its Re-trace link to the original picture; pasted where that picture does not exist,
   the link is dropped instead of dangling. Copying the picture and the trace together still
   remaps the link to the copied picture. The jig editor (ADR-652) still keeps a trace and its picture in the
   same jig, since Re-trace Original reads and can delete the picture.
7. **A camera capture never engraves on its own.** A capture kept after Trace from Camera stays in
   the scene, visible like the LightBurn overlay, on its own Image operation with Output off
   (`core/scene/reference-image-output.ts`). The trace never shares that operation. The operator
   can still turn Output on deliberately. Re-trace Original with Raster scan output sizes the
   bitmap from that output-off operation when the picture has no output-on one.
8. **Older projects.** `role: 'trace-source'` is still accepted and is dropped on load
   (`io/project/legacy-trace-source.ts`); any other role value is still refused, and there is no
   schema bump (new files simply lack the field, and an older build reading one treats the photo as
   output, as this build does).
   - A kept photo now engraves. Preview, the Frame footprint, the hover card and Start review show
     it; delete it or turn its operation's Output off for the trace-only job saved before. A
     legacy raster result that shared the photo's operation keeps sharing it.
   - A kept camera capture (source `camera capture`) loads with its own Image operations set to
     Output off; an operation it shares with other artwork stays on and the capture moves to an
     output-off copy of it.
   - The next save writes no marker, without validation drift (ADR-204).

### Consequences

- The customer workflow now produces `[raster, cut]`: the photo engraves, then the outline cuts.
- With the new default, every trace keeps its picture, which engraves until it is deleted or its
  operation's Output is turned off: the LightBurn behaviour, and visible in Preview and Frame.
- On CNC, a kept photo is an ordinary image, so the "raster will be skipped" advisory now counts it.
- Tests: `kept-trace-photo-output.test.ts` (photo, trace keeping it, Offset Shapes, compile order,
  Frame, preflight, hover, Sort cuts last, delete, duplicate, copy and paste),
  `project-legacy-trace-source.test.ts` (older photos and camera captures, save without drift),
  `camera-trace-import.test.ts` and the camera dialog test, `rasterized-trace-mutation.test.ts`
  (operation copies, re-trace in place) and `scene-mutations-operation-color.test.ts` (colours).
  Tests that pinned the exclusion, the tint and the recolour were changed or removed, each with
  the reason above.
