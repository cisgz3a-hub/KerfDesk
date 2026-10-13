## ADR-596 — Responsive trace-part and node editing

**Status:** Accepted. **Date:** 2026-10-13

## Context

The maintainer reported a slow, jittery canvas after tracing when using Edit nodes and Edit
trace parts, and requested workers and a clear way to stop editing. The image tracer already
runs off-thread. Post-trace interaction still performed contour grouping, geometry indexing,
repeated full-segment searches and unchanged-path rebuilding on the UI thread.

## Decision

- Prepare dense trace-part contour bounds and hole-preserving groups in a dedicated worker.
  Reuse one worker for sequential path requests, sending freshly packed transferable geometry buffers rather
  than a whole project or source raster. Small scenes retain a bounded synchronous path;
  both contour count and vertex count contribute to the work budget across paths.
- Bind preparation to immutable geometry, scene ownership and document epoch. Terminate
  superseded, cancelled, failed or timed-out worker requests. Never apply a late result to
  another path or replay a click against changed artwork. While preparation is pending,
  show progress and keep Done available. A failure offers Retry without synchronously
  regrouping dense artwork on the UI thread.
- Cache exact contour bounds and fill/stroke group results by immutable geometry. Carry
  complete groups and unchanged contour bounds through part extraction, so each remaining
  trace does not need another full grouping pass. Preserve ADR-587 picking, fill-rule,
  operation, dependency, history and saved-project semantics.
- Index node coordinates for repeated picking. Use exact line projection and conservative
  segment bounds before curve proximity searches; cubic bounds include the control hull and
  arcs retain their existing curve search. Cache immutable geometry, preserve source-order
  ties, and invalidate naturally when geometry or transforms change.
- Move only selected node geometry. Reuse untouched contours and their compatibility views
  and bounds, preserving canonical curves under ADR-159. Cull offscreen node markers and use
  indexed selection membership when drawing handles. No simplification or node reduction is
  introduced by entering these tools.
- Coalesce node/trace-part pointer moves to the latest event per animation frame. Flush the
  final queued move before pointer-up or a hover keyboard command. Escape, pointer
  cancellation, capture loss, document replacement, tool exit and unmount discard queued
  work. A second pointer cannot replace the owning pointer's position.
- Show a labelled editing hint and a visible Done button for both tools, even with no selected
  artwork. Clicking the active Edit nodes or Edit trace parts toolbar button also exits.
  Completed edits remain; exiting during a drag rolls back only that unfinished interaction.
  Escape during a drag cancels it, and Escape outside a drag returns to Select. Node-specific
  Arrow/Delete actions apply only while node mode is active.

## Verification and limits

Focused regression coverage includes exact node and segment picks, transformed geometry,
untouched contour identity, hole/group preservation, worker cancellation and stale responses,
pointer ownership, final-move flushing, undo, and mode exits. The browser workflow exercises
tracing, part movement, node editing, explicit Done, history and project save/reopen, including
a dense bitmap fixture with 4,096 rings and 8,192 contours.

A local warm microbenchmark against the original implementation used two warmups and seven
samples in the same process. Median node picking for 20,001 anchors was 3.766 ms before and
0.010 ms after; segment picking for 20,000 line segments was 176.243 ms before and 0.410 ms
after; one canonical-node edit with bounds over 2,000 contours/80,000 points was 4.257 ms
before and 0.466 ms after. Picks and edited geometry were compared for equivalence. These
are isolated algorithm measurements on the development machine, not displayed FPS or a
guarantee for every drawing.

The instrumented Chrome development-renderer run confirmed one preparation worker and equal
before/after contour fingerprints on the 8,192-contour fixture. Picking and dragging through six
pointer steps plus a count-only confirmation took 526 ms; separately transferring the complete
trace snapshot to the test driver took 2,659 ms. The browser test saves phase timings and a CPU
profile so test transport costs can be distinguished from application interaction. These wall
times include automation overhead and are not a displayed-frame-rate measurement.

Picking candidate curves at the current zoom, initial node-index construction, transferring/packing
geometry, extraction bookkeeping and drawing remain UI work; this is not an entirely off-thread canvas.
No schema, dependency, entitlement, Frame/Start, transport or machine-output policy changes.
Existing spatial invalidation still applies when the user edits geometry. Software and browser
evidence do not qualify packaged native performance or physical hardware.
