# LightBurn Vector Editing Tools Research

Date: 2026-06-05
Scope: audit/research only. No production code changes.
Repo: `C:\Users\Asus\LaserForge-2.0`

## Executive Summary

LaserForge has a useful early object-transform editor, but it does not yet have LightBurn-class vector editing. The current app supports object selection, primary-object move/scale/rotate, nudge, mirror, duplicate, delete, and basic multi-selection state. LightBurn's vector workflow is broader: selection modifiers, numeric transforms over the whole selection, align/distribute, arrays, retained primitives, group/ungroup, shape properties, path conversion, node editing, booleans/weld, offsets, and closed-path repair.

The correct Karpathy-rule conclusion is not "build all vector tools now." The correct first move is to keep this governance-gated and add a design ADR before any heavy geometry work. LaserForge's persisted vector model is flattened `Polyline` data plus object-level transforms. That is strong for deterministic CAM, but weak for editable curves, retained primitives, groups, booleans, and offsets. Rushing booleans or node editing into the existing polyline model would create correctness and safety risk.

Recommended next implementation slice, if approved: Numeric Edits and selection semantics first. These are high-value, LightBurn-core workflows and can be implemented without a new geometry kernel. Booleans, offsets, groups, and node editing should wait for an editable-path design and geometry-library evaluation.

## Official LightBurn Baseline

### 1. Selection

LightBurn's Select tool supports click selection, red left-to-right enclosing selection, green right-to-left crossing selection, and selection modifiers. Shift adds, Ctrl/Cmd toggles, Ctrl/Cmd+Shift removes. LightBurn also exposes extra selectors such as Select All, Invert Selection, Select Open Shapes, Select Open Shapes Set to Fill, Select Current Layer, Select Contained Shapes, Select Smaller Than Selected, and Select Circles.

Source: [LightBurn Selection Tools](https://docs.lightburnsoftware.com/latest/Reference/Selection/)

Why it matters: selection behavior becomes the base contract for align, distribute, arrays, groups, shape properties, and node editing. LightBurn treats grouped objects specially during selection, so group support cannot be bolted on after selection without revisiting semantics.

### 2. Numeric Edits / Transform Controls

LightBurn's Numeric Edits Toolbar adjusts selection size, position, and orientation through precise values. It treats all selected objects as a single unit. The 9-dot anchor controls the displayed coordinate, scale anchor, and rotation center. X/Y move the selected unit, Width/Height resize it, Lock preserves aspect ratio, Rotate accepts explicit degrees, and fields support equations and units.

Source: [LightBurn Numeric Edits Toolbar](https://docs.lightburnsoftware.com/2.1/Reference/NumericEditsToolbar/)

Why it matters: this is core laser workflow, not a fancy editor feature. Users need exact placement before framing or burning. It is also safer than only drag handles because it makes intended dimensions explicit.

### 3. Align / Distribute

LightBurn Align moves selected objects to edges or centers, normally relative to the last object added to the selection. Distribute spaces selected objects evenly by centers or edges; Move Together places selected objects with abutting edges and anchors the last-selected object.

Sources:
- [LightBurn Align Tools](https://docs.lightburnsoftware.com/latest/Reference/Align/)
- [LightBurn Distribute and Move Together](https://docs.lightburnsoftware.com/latest/Reference/Distribute/)

Why it matters: alignment is still transform math over object bounding boxes. It can be implemented before deep geometry work, but the "last selected is anchor" rule must be designed into the selection store.

### 4. Arrays

LightBurn Grid Array creates row/column copies with spacing, padding, row/column shift, reverse direction, alternate mirroring, random orientation with seed, variable text increment, virtual arrays, grouping results, and selecting results. Circular Array creates radial copies around a coordinate or the last-selected object, with copy count, start/end angle, step, rotating copies, grouping, and selection options.

Sources:
- [LightBurn Grid Array](https://docs.lightburnsoftware.com/latest/Reference/GridArray/)
- [LightBurn Circular Array](https://docs.lightburnsoftware.com/latest/Reference/CircularArray/)

Why it matters: non-virtual arrays are mostly object duplication plus transform math. Virtual arrays require a new linked-clone model and should be deferred.

### 5. Booleans / Weld

LightBurn Boolean tools combine closed vector shapes. Boolean Union, Subtract, and Intersection require exactly two selected shapes or groups; Weld can combine more than two. The docs explicitly require closed vector shapes and disable the tools for images or open shapes.

Source: [LightBurn Boolean Tools](https://docs.lightburnsoftware.com/latest/Reference/BooleanTools/)

Why it matters: this is a geometry-kernel feature. It changes actual cut contours, hole behavior, burn order, duplicate lines, and fill interpretation. It should not be hand-rolled.

### 6. Offset Shapes

LightBurn Offset Shapes creates new shapes inward, outward, or both directions from the selected vectors. It supports offset distance, direction, corner styles, outer-shapes-only, select result, delete original, optimize/simplify, live preview, repeat last offset, and a useful zero-distance repair trick. Inward offsets require closed shapes.

Source: [LightBurn Offset Shapes](https://docs.lightburnsoftware.com/latest/Reference/OffsetShapes/)

Why it matters: offset is where laser CAM and vector editing meet: borders, kerf compensation, inverted engravings, and cut outlines around engravings all depend on robust offset semantics.

### 7. Node Editing / Convert To Path

LightBurn node editing works on vector paths only. Text, primary shapes, and barcodes must be converted to path first; grouped objects must be ungrouped. Node editing supports moving nodes/handles/curves, selecting multiple nodes, arrow nudges, dragging lines into curves, joining disconnected nodes, inserting/deleting nodes, smooth/corner conversion, break, trim, extend, and alignment.

Convert to Path turns built-in shapes into normal paths so their nodes can be edited. After conversion, shape-specific properties and text-specific properties are lost.

Sources:
- [LightBurn Edit Nodes](https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/)
- [LightBurn Convert to Path](https://docs.lightburnsoftware.com/latest/Reference/ConvertToPath/)

Why it matters: this requires retained path commands, node/handle metadata, path-local hit testing, path conversion, and undo granularity. LaserForge currently stores flattened polylines, not editable curves.

### 8. Shape Properties / Closed Paths

LightBurn Shape Properties includes CAM-significant values such as Cut Order Priority and Power Scale. LightBurn's Open vs Closed Shapes explainer says Fill, Offset Fill, Weld, Boolean Tools, Cut Shapes, Kerf Offset, and Cut Inner Shapes First depend on closed shapes. LightBurn warns when open shapes are assigned to Fill/Offset Fill and offers selection/repair workflows.

Sources:
- [LightBurn Shape Properties](https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/)
- [LightBurn Open vs. Closed Shapes](https://docs.lightburnsoftware.com/latest/Explainers/OpenClosedShapes/)

Why it matters: shape properties are not just UI metadata. They can alter emitted power, order, and whether geometry is eligible for fill/boolean/offset behavior.

## Current LaserForge Evidence

### What Exists

- `src/ui/workspace/Workspace.tsx`: canvas workspace, selected object id, additional selected ids, mouse drag routing, move/scale/rotate handles, pan/zoom.
- `src/ui/workspace/drag-state.ts`: primary-object move/scale/rotate/pan state machine.
- `src/ui/workspace/handles.ts`: 8 AABB scale handles; Shift locks aspect, Alt scales from center.
- `src/ui/workspace/rotate-handle.ts`: rotate around transformed bounding-box center, Shift snaps to 15 degrees.
- `src/ui/app/shortcuts.ts`: Ctrl/Cmd+A select all, duplicate, delete, Escape clear, arrow nudge, H/V mirror, view shortcuts.
- `src/ui/state/store.ts`: `selectedObjectId`, `additionalSelectedIds`, select/toggle/select-all, undo/redo snapshots, drag interaction undo grouping, duplicate selection.
- `src/core/scene/scene-object.ts`: vector geometry is `Vec2` -> `Polyline` -> `ColoredPath`; object union is `ImportedSvg | TextObject | TracedImage | RasterImage`.
- `src/core/scene/transform.ts`: transform order is scale -> mirror -> rotate -> translate.
- `src/core/scene/hit-test.ts`: topmost object AABB hit test using transformed natural bounds.
- `src/core/job/compile-job.ts`: compile walks layer/object colors, applies object transform and machine origin transform, then emits line/fill/raster groups.

### What Is Missing

- No marquee selection. Therefore no LightBurn window-vs-crossing selection.
- No path-accurate object hit testing.
- No multi-object move/scale/rotate/mirror despite secondary selection state.
- No Numeric Edits toolbar/panel for X/Y/W/H/rotate with 9-dot anchor.
- No align/distribute/move-together.
- No retained shape primitives created inside LaserForge.
- No group/ungroup.
- No array tools.
- No node editor.
- No editable curve/path command representation.
- No Convert to Path workflow.
- No boolean/weld.
- No offset-shape tool.
- No per-object Shape Properties panel for priority, power scale, lock, primitive fields, or image controls.

## Structural Blockers

### 1. Persisted Geometry Is Polyline-Only

Curves are flattened before storage. SVG path commands and OpenType curves become polylines at import/render time. This is fine for deterministic G-code, but not enough for LightBurn-style node editing because handles, curve commands, primitive parameters, and path identity are gone.

### 2. Groups Are Expanded Or Absent

SVG groups and `<use>` references are baked during import. There is no persistent `GroupObject`, no nested transform composition, and no rule for group selection or group-baked ungroup behavior.

### 3. Bounds Drive Many Features

Selection, handles, fit-to-bed, out-of-bounds hints, rasterization, and preflight depend on object bounds. Any geometry edit must refresh tight-enough bounds or the UI and output path will disagree.

### 4. Booleans And Offsets Need A Kernel

The current package set has no polygon boolean or offset dependency. Candidate directions:

- `polygon-clipping` for closed polygon boolean operations; MIT; pure JS; not an offset or curve editor.
- Clipper-family implementation for offset/kerf; strong algorithmically, but license and browser/worker packaging must be checked against the repo's `license-check`.
- `svg-pathdata` / `bezier-js` for path parsing and curve operations; useful but not a boolean/offset kernel.
- `Paper.js` as a prototyping/reference tool, not the first production kernel because it is a stateful scene graph and heavier than LaserForge's pure-core model.

No library should be added until it passes license check, browser/worker packaging, performance on traced art, and output parity tests.

## Safety / Output Implications

Every vector editing feature that changes geometry changes the emitted job. That means:

- Preview, Save G-code, Frame, and Start must continue to route through `prepareOutput`.
- Closedness must be explicit and preserved; fill/boolean/offset tools must not guess.
- Bounds must be recomputed after edits and checked before output.
- Geometry operations must be deterministic so the same project emits the same G-code.
- Output invariants must still catch laser-on travel, long blank feed moves, bounds violations, empty output, power scaling mistakes, and raster/vector layer mismatches.
- Any feature adding per-object CAM data, such as Power Scale or Cut Order Priority, must be tested through emitted G-code, not only UI state.

## Recommended Build Order

### Phase V0: Governance And ADR

Write an ADR before code. It should define:

- Whether native vector editing is now in scope.
- Editable path representation: commands, curves, fill rule, node ids, handles, closure, and transform interaction.
- Primitive representation: retained primitive fields vs immediate conversion to path.
- Group model and ungroup transform-baking rules.
- Selection model: primary, selection order, last-selected anchor, window/crossing, path hit tolerance.
- Geometry kernel requirements: license, worker support, cancellation, numeric precision, simplification policy.
- Output invariants and required physical verification.

### Phase V1: Precision Placement

Implement the safe, high-value LightBurn parity slice:

- Numeric Edits panel with X/Y/W/H/rotate.
- 9-dot anchor against combined selection bounds.
- Multi-selection transform as one unit.
- Undo as one entry per numeric apply.
- Bounds and output parity tests.

This phase does not require booleans or an editable curve model.

### Phase V2: Selection Semantics

Implement:

- Window selection vs crossing selection.
- Selection modifiers: Shift add, Ctrl/Cmd toggle, Ctrl/Cmd+Shift remove.
- Selection order tracking so "last selected" can be used by align/distribute.
- Path-accurate hit testing as a later sub-slice if AABB proves too coarse on traced art.

### Phase V3: Align / Distribute

Implement:

- Align left/right/top/bottom/centers.
- Distribute by centers and by edge spacing.
- Move Together H/V.
- Last-selected anchor behavior.
- One undo entry per action.

### Phase V4: Basic Primitives

Implement retained or generated primitives only after the ADR:

- Rectangle, line/polyline, circle/ellipse, polygon.
- Tight bounds and closure rules.
- Layer assignment.
- Compile behavior in line/fill modes.

If retained primitives are chosen, define Convert to Path before node editing.

### Phase V5: Arrays

Implement normal arrays first:

- Grid array with rows/columns, spacing, padding, shift.
- Circular array with center, copy count, start/end/step.
- Group/select results.

Defer virtual arrays until there is a linked-clone model.

### Phase V6: Groups

Implement group/ungroup only after selection and transform semantics are stable:

- Group selection as one object.
- Nested transform composition.
- Ungroup bakes world transforms into children.
- Equivalent G-code before/after grouping when geometry is unchanged.

### Phase V7: Shape Properties Foundation

Add per-object properties that directly support already-planned workflows:

- `powerScale` for Material Test and Shape Properties parity.
- `cutOrderPriority` only when Optimization Settings can consume it.
- `locked` for selection/edit blocking.

This overlaps with the Material Test roadmap and should be handled there, not hidden inside vector editing.

### Phase V8: Node Editing / Convert To Path

Only after editable path representation exists:

- Convert text/primitives/imported paths into editable paths.
- Node, handle, and segment selection.
- Insert/delete nodes.
- Smooth/corner conversion.
- Curve-to-line and line-to-curve.
- Open/close/join paths.
- Path-local hit testing and snapping.

### Phase V9: Boolean / Offset

Only after geometry-kernel evaluation:

- Boolean Union/Subtract/Intersection/Weld with closed-vector gating.
- Offset inward/outward/both with corner style and simplification.
- Torture tests for holes, overlaps, self-intersections, tiny details, repeated points, and traced images.
- Worker execution with cancellation and complexity budget.

## Verification Plan

### Software Tests

Extend existing test areas:

- `src/core/scene/transform.test.ts`: transform order, anchor math, finite coordinates.
- `src/core/scene/hit-test.test.ts`: AABB and future path hit tests.
- `src/ui/state/store.test.ts`: selection order, multi-selection, undo/redo, dirty state.
- `src/ui/workspace/handles.test.ts` and `rotate-handle.test.ts`: transform handles.
- New `src/ui/workspace/drag-state.test.ts`: pointer-to-transform behavior.
- `src/core/job/compile-job.test.ts`: edited geometry compiles as expected.
- `src/core/job/job-bounds.test.ts`, `src/core/job/frame-preflight.test.ts`, `src/core/preflight/preflight.test.ts`: bounds and Start/Frame safety.
- `src/io/gcode/prepare-output.test.ts`: preview/save/start parity path.
- `src/core/invariants/predicates.test.ts` and `blank-feed.test.ts`: emitted G-code safety invariants.

### Geometry Corpus

Create fixtures for:

- Rectangles, circles, ellipses, polygons, lines, open polylines.
- Text glyphs with holes.
- Traced logo contours.
- Nested holes and islands.
- Shared edges and touching corners.
- Tiny segments and repeated points.
- Rotated/mirrored/scaled objects.

### Hardware Proof

For any feature that changes emitted motion:

1. Generate from the live app.
2. Inspect the actual emitted G-code excerpt.
3. Frame on the Falcon.
4. Low-power burn on scrap.
5. Measure with calipers or photo overlay.
6. Save the photo, G-code excerpt, and expected measurement in `audit/evidence/`.

First physical coupons:

- 100 mm x 50 mm rectangle at exact numeric X/Y.
- Three aligned/distributed boxes with measured gaps.
- 3x3 array with measured pitch.
- Circle/ellipse primitive with measured bounding box.
- Boolean/offset coupon only after kernel approval.

## Findings / Decisions

1. **Build first:** Numeric Edits + combined selection transform. This is LightBurn-core, safety-useful, and does not require a geometry kernel.
2. **Build next:** window/crossing selection + selection order. This unlocks align/distribute behavior.
3. **Build after that:** align/distribute/move-together. Low geometry risk, high workflow value.
4. **Defer:** arrays until selection/duplicate/anchor semantics are stable.
5. **Governance-gate:** groups, retained primitives, Convert to Path, node editing, booleans, and offsets.
6. **Do not hand-roll:** booleans or offsets. Evaluate a geometry library and worker budget first.

Bottom line: LaserForge should not pretend it already has LightBurn's vector editor. It has an object-transform workspace. The right roadmap is to first make precision placement and selection solid, then add arrangement tools, and only then design the path/geometry kernel for real vector editing.
