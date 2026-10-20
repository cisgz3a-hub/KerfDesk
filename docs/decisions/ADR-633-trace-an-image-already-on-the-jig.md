## ADR-633 - Trace an image already on the jig (2026-10-19)

**Status:** Accepted. | **Date:** 2026-10-19

This amends ADR-606 (the jig editor's Artwork tab). Output modes, the outline-then-artwork
sequence, Job Review, Frame (ADR-565) and Start do not change. No guard is added (ADR-228).

### Context

The jig editor's tracer only took a newly uploaded file. An image added with **Import artwork…**,
or already in the project, could not be traced: the operator had to delete it, upload the file
again in the tracer and place the trace by hand. The tracer also sat in a folded section, so the
operator had to open it before seeing any way to trace.

On the main canvas, Trace Image works on the selected image and lays the trace exactly over it
(ADR-026), deleting the image by default.

### Decision

1. **Trace selected image.** The tracer offers **Trace selected image** when exactly one unlocked,
   visible image is selected on the jig canvas. A trace backing (`role: 'trace-source'`), an
   outline or a multiple selection does not qualify, and the button explains why it is disabled.
   Uploading a file stays as **Or upload an image to trace**. The image is read the way Trace
   Image reads it, clipped by its crop or image mask.
2. **The trace replaces the image.** Committing lays the trace over the image at the image's
   position, size, rotation and mirroring, and removes the image, as Trace Image does with
   **Delete image after trace** on. The trace takes the image's stacking, run order, group and
   design-tree places and becomes the selection. The image's Image operation goes when nothing
   else uses it, so the trace takes the first free operation colour. The draft keeps one undo step
   for it, and the main project changes only on **Save to canvas**.
3. **Copies are traced together.** Centre + copy puts the same artwork in every outline, so
   tracing that image, or any of its copies, replaces the original and each copy. Each copy's
   trace lies over the bitmap it replaces and is recorded as a jig copy of the new trace, so a
   later Centre + copy refreshes those traces instead of adding more. The commit button says how
   many images it replaces.
4. **A gone image is refused.** If the image leaves the jig (deleted, or undone away) before the
   trace is committed, the commit is refused with a message; Undo brings it back.
5. **The tracer starts open.** The **Trace an image** section is open when the editor opens and
   can still be folded. Until an image is loaded it holds just the two source controls, so
   Centre + copy stays in view.

### Consequences

Tracing an image in the jig no longer means re-uploading and re-placing it, and a jig that was
already centred and copied stays consistent after tracing. The image cannot be kept as a
non-burning backing in the jig; the main canvas's Trace Image remains the place for that and for
Re-trace Original.

### Verification

State tests cover replacing an image and its two outline copies in place (positions over each
bitmap, shared operation, jig identity, stacking order, selection and undo), Centre + copy after
tracing refreshing rather than duplicating the traces, tracing from a selected copy, groups, run
order and design tree, and which selections qualify. Hook tests cover replacing instead of
importing and the refusal when the image has gone. The import test covers placement over a
rotated, placed image.
