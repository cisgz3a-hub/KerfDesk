## ADR-586 — Pick and edit individual trace parts

**Status:** Accepted. **Date:** 2026-10-11

## Context

A traced image can contain thousands of separate marks. Ordinary selection moves the whole image.
Break Apart (ADR-406) separates every shape at once, making the document unnecessarily large when
the user only wants to move or remove one mark. Node editing already supports traced paths, but
selecting individual anchors is a different task from moving a whole stroke or shape.

The [competitor research](../audits/2026-10-11-trace-part-editing-research.md) finds shape ungrouping,
direct selection, isolation, node editing, and hole-preserving splitting in established vector apps.

## Decision

- Add **Edit trace parts** beside Select and Edit nodes. A selected trace also offers the action
  on the canvas; double-clicking a trace with Select opens this mode. Entering the mode clears
  the whole-object selection so its handles cannot intercept the first part pick.
- Clicking a traced edge or filled shape separates only the selected part from the remainder.
  A filled outer keeps its holes using the ADR-406 shape grouping. Centerline strokes, including
  the stroke paths in hybrid traces, separate individually unless a bound effective Fill
  operation needs their holes preserved. This is geometric selection, not recognition of semantic
  subjects inside a connected drawing.
- Keep the remainder under its original ID and create at most one additional scene object per
  pick. Both remain traced images with their original transforms, paint, operations, canonical
  curves, committed compatibility chords, pixel dimensions and applicable tab anchors. Preserve
  subpath nesting, group membership, artwork order, design tree order, CNC side assignments and
  registration-jig instance membership. The source raster stays in the project; partial traces
  drop their re-trace link because re-tracing would recreate the
  entire original picture.
- Test edges with a six-screen-pixel tolerance and nearest-edge selection within a trace. Cache
  immutable path bounds and shape groups; reject bounding-box misses before examining segments.
  Pick canonical curves at the canvas zoom precision, flattening only candidate contours and
  caching their recent scale buckets so edited curves stay selectable at high zoom.
  Filled interiors respect holes and the path fill rule. Interior picking follows the effective
  canvas paint: line operations, orphan paths and wireframe view require an edge hit. Locked and
  hidden paths cannot be picked. A topmost fill occludes hidden edges in lower paths.
  Respect the current group-editing scope, but select a picked part directly rather than expanding
  its parent group.
- Drag immediately to move the part; Shift-click toggles multiple parts. Reuse ordinary transform
  handles, snapping, nudging, deletion, duplication, and node editing on the selected parts.
  Right-click also picks an individual part for its context menu. Done or Escape returns to Select.
  A portion of one connected contour is reshaped with Edit nodes.
- Snapshot before extraction so separation and movement commit as one undo step. Escape,
  pointer cancellation and lost capture restore the original unsplit project. A selection-only
  click can itself separate a part and is undoable. Selecting an already separated part creates
  no history entry, including with Selected artwork output enabled. Respect existing project
  object limits.
- Refuse a split while the trace is a live image mask, text-path guide, or retained relief vector
  link, with guidance to release the dependency first. Retaining its ID only on the remainder
  would silently narrow the mask or guide or rematerialize the relief. Keep the complete project
  and history unchanged in that case, including for hidden or locked dependents. Selecting an
  already separate single part requires no split.

## Consequences and verification

Large traces stay compact until individual parts are picked. This introduces no persisted schema
or dependencies. Existing Break Apart remains available for intentionally separating all shapes.
The original source raster is retained for starting a fresh trace.

Verify hole/island and hybrid grouping, operation and tab metadata, exact curves and compatibility
chords, transformed picking, hidden/locked geometry, dense inputs, direct group selection, drag
undo/cancellation, and project round-trips. Browser verification covers import, trace, picking and
moving, node editing, undo/redo, and saving. This is software evidence; hardware is not operated.

Splitting multi-colour paths keeps their existing per-object composition semantics, as Break Apart
does (ADR-406). Overlapping paths can compile differently once placed in separate objects; no new
cross-object boolean union is introduced. Moving artwork naturally changes its output placement
and is governed by the existing Frame contract (ADR-565).
