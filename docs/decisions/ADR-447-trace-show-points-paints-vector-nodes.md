## ADR-447 - Trace preview Show Points paints the vector's nodes, not its polyline samples (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This refines ADR-030's B4 Show Points action. The viewport-window repaint and density thinning are
unchanged.

### Context

Show Points in the Trace dialog painted every point of each path's compatibility polyline
(`ColoredPath.polylines`), and the status line counted those points. Since ADR-391 a trace path
carries canonical curves (`ColoredPath.curves`): the fitter's cubics where the contour finisher fits
them, straight segments over the polyline elsewhere. The polyline is a dense sampling of those
curves, so the painted count did not follow the controls that decide the vector. On an
antialiased five-lobed blob (160 px, Line Art), raising Optimize from 0 to 2 cut the curve nodes
from 21 to 11 while the polyline samples rose from 316 to 355. LightBurn's Show Points shows the
nodes the user will edit after the trace.

### Decision

- Show Points paints the curve nodes of a path that has `curves`: each subpath's start and every
  segment's end point. A closed subpath whose last segment returns to its start shows that point
  once. Control handles are not drawn.
- A curve node is drawn as a square when it is a corner and as a circle when it is a smooth (G1)
  joint. A joint is smooth when at least one neighbouring segment is a cubic or an arc and the
  incoming and outgoing tangents agree within 2 degrees. A line meeting a line, an open end and a
  tangent break are corners. Arc tangents come from the arc's centre parameterization. The implicit
  closing edge of a closed subpath that stops short of its start counts as a line neighbour.
- A path without `curves` still shows its polyline points, drawn as circles (their joint type is
  unknown). A repeated closing point of a closed polyline is shown once.
- Where nearby markers share a density cell, a corner square wins the cell over a round marker,
  whatever the path order, so a corner is not hidden behind a neighbouring smooth joint at fit zoom.
- The status line reports "nodes": the node set Show Points paints before density thinning merges
  markers that share a screen cell. It counts paths from `curves` when present.
- The marker canvas is named "Trace nodes", and its title (the accessible description) states the
  marker legend, so the corner/smooth meaning is not carried by shape alone.
- The node list is built once per preview result (cached by the paths array) as flat typed arrays,
  so a scroll, zoom or resize repaint walks those arrays with the existing 2 px density cells and
  bounded paint batches. The build allocates nothing per joint (tangents go into reused scratch
  vectors, the implicit closing edge is indexed rather than copied) and stores coordinates in
  single precision, which is ample for view-only markers.

### Consequences

- The Show Points count now falls as Optimize rises. It follows Smoothness only where Smoothness
  changes the fitted segments: the contour finisher turns its wobble flattening off for
  antialiased (sub-pixel-measured) loops, which are the ones fitted with cubics, so on those the
  count does not move with Smoothness; it can move on the legacy line tail of binary sources, where
  flattening removes vertices. Line-only traces (small or non-antialiased art on the legacy tail, whose
  curves are straight segments over the polyline) show the same positions as before, as corner
  squares.
- The preview never changes trace geometry; the markers stay view-only.
- Code: `src/ui/trace/trace-point-nodes.ts` (node list and joint type),
  `src/ui/trace/trace-points-canvas.ts` (markers), `src/ui/trace/TracePreview.tsx` (status line).
  `src/ui/trace/TracePointsOverlay.tsx` (canvas name and description). Tests:
  `src/ui/trace/trace-point-nodes.test.ts`.
