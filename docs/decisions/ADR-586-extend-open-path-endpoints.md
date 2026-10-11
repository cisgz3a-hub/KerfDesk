## ADR-586 - Extend open path endpoints

**Status:** Accepted. **Date:** 2026-10-11.

The maintainer requested an investigation of LightBurn Extend, a short interaction
brief, an interactive KerfDesk preview, and implementation with geometry tests.
This adds a drawing operation to the workspace and Design Studio. No controller,
machine, executable-output, licence, project-schema or publication policy changes.

## Interaction brief

Choose **Tools → Vector → Extend Shapes** in the workspace, or **Extend / E** in
Design Studio. Hover within eight screen pixels of an open endpoint. A dashed
segment shows the proposed addition and a marker shows where it will stop. Click
to commit one edit. Undo restores the original endpoint; Redo reapplies it. Escape,
another tool, or the workspace hint's Done button exits the tool.

The endpoint must have a defined outward direction. Straight ends continue along
their terminal segment; workspace cubic and elliptical-arc ends use their outward
tangent. The ray stops at the nearest forward contact with another visible contour. Targets
are finite outlines: they are never extrapolated. A target endpoint or tangency is
a contact. Open and closed boundaries qualify; locked workspace artwork can serve
as a boundary, while hidden artwork and registration boxes do not. An outline's own
contour is excluded. Another contour of the same workspace object may qualify.
Design Studio excludes the source entity and also permits its construction guides
as boundaries. No implicit join, split, or target mutation occurs.

When no boundary lies ahead, the status says **No boundary ahead** and clicking
creates no document change or undo entry. An endpoint already touching a boundary
stays put instead of jumping past it. A collinear overlap at the nearest contact
has no unique extension endpoint and produces an explaining no-op. Closed contours,
interior nodes and locked or live-compound workspace sources are not picked.

Workspace curved source ends receive a new straight tangent segment, retaining
the original curve exactly. Collapsed cubic endpoint handles use the first
nonzero higher-order tangent direction. Fully degenerate ends remain unchanged.
Design Studio currently supports straight source ends only; curved sources receive
an explanation because its separate sketch model cannot yet represent the mixed
curve-and-line result. Curved boundaries are supported in both editors.

## Geometry and editing contract

The implementation is original KerfDesk code. Workspace lines use ray/segment
intersection, cubics use polynomial roots isolated by derivative extrema (including
tangencies), and elliptical arcs use analytic ellipse contacts filtered to the
arc's signed angular span. Calculations occur in world millimetres; object rotation,
reflection and nonuniform scale are respected. The chosen destination is converted
back into source-local coordinates. Compatibility polylines and canonical curves
are updated together, moving the straight terminal endpoint or adding a tangent
segment while preserving the existing curve.

Design Studio has a separate sketch model: straight lines and polygonal paths are
sources, and exact lines, circles, signed-sweep arcs, ellipses and rounded rectangles
are boundaries. It has no cubic-path or per-entity lock/visibility model. Its 2D and
3D surfaces share the query result and use raw pointer coordinates for endpoint
picking, so grid snapping cannot shift the hover away from an endpoint.

Preview is transient. A successful workspace edit preserves object identity,
transform, operation bindings, overrides and untouched geometry. Drawn polylines
keep their editable specification. Other parametric artwork becomes a plain path
with a notice if applicable. Stale placed tabs on the edited open contour are
removed with a notice; tabs on other contours survive, and Undo restores everything.
Studio edits remain in its local history until the existing Apply operation.

## Evidence and limits

[LightBurn's Edit Nodes guide](https://docs.lightburnsoftware.com/latest/Reference/EditNodes/)
documents hovering an open endpoint and pressing E to extend to the nearest
intersecting path. It does not specify the numerical method, source-curve
continuation, same-contour hits, overlap handling, visibility filtering or no-hit
feedback. Those behaviours above are explicit KerfDesk decisions, not parity claims.

Native investigation targets the installed LightBurn 2.1.02 executable, SHA-256
`a0836cc167ff4402e68d35ef3384a2042c4ddb7aa83a428fb754371f4290b0c6`,
through REA 6.4.0 and Ghidra 12.1.4. The accompanying investigation report records
the [static trace](../audits/2026-10-11-lightburn-extend-investigation.md), evidence
identifiers and unresolved questions. The trace strongly supports straight tangent
addition for LightBurn cubic source ends. Decompiler output
is analysis evidence, not original source or runtime observation.

Verification covers nearest contacts at either end, curve roots and tangencies,
finite boundary filtering, visibility and locked targets, transformations, metadata,
no-op history, Undo/Redo, raw pointer picking, both Studio surfaces, Apply, and real
workspace menu/canvas interaction. No physical-machine qualification is claimed.
