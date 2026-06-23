# Drawing Tools Fill Selection Audit - 2026-06-22

## Scope

Audit the reported workflow where selecting an inner shape and making it Fill caused the whole black artwork to fill. The goal is to benchmark LaserForge drawing/design tools toward a 10/10 operator experience, using LightBurn as the behavioral reference and Rayforge as study-only architecture input.

No Rayforge code was copied.

## Research Anchors

- LightBurn Fill mode fills closed shapes with parallel scan lines and does not fill open shapes:
  <https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/FillMode/>
- LightBurn colors represent layers/operations, not final product colors:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/ColorPalette/>
- LightBurn Cuts / Layers is the layer operation surface:
  <https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/>
- LightBurn Break Apart separates selected vector graphics into independently editable pieces:
  <https://docs.lightburnsoftware.com/2.1/Reference/BreakApart/>
- LightBurn documents open vs closed shape rules and says Fill needs a closed inside/outside region:
  <https://docs.lightburnsoftware.com/2.1/Explainers/OpenClosedShapes/>
- LightBurn Close Path repairs only selected paths whose start/end nodes are already within 0.5 mm:
  <https://docs.lightburnsoftware.com/2.1/Reference/ClosePath/>
- LightBurn Close Selected Paths With Tolerance uses a dialog with distance threshold, connection mode, repair counts, OK, and Cancel:
  <https://docs.lightburnsoftware.com/2.1/Reference/CloseSelectedPathsWithTolerance/>
- LightBurn has node editing, Convert to Path, shape tools, and boolean tools:
  <https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/>
  <https://docs.lightburnsoftware.com/2.1/Reference/ConvertToPath/>
  <https://docs.lightburnsoftware.com/2.1/Reference/BooleanTools/>
  <https://docs.lightburnsoftware.com/2.1/Reference/PrimaryShapes/>
- SVG fill rules are the formal basis for inside/outside interpretation:
  <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/fill-rule>
- Rayforge study-only model separates `Layer`, `WorkPiece`, and `Workflow`, making object-level operations easier to reason about:
  `C:\Users\Asus\Rayforge\website\docs\developer\docmodel.md`
  `C:\Users\Asus\Rayforge\website\docs\developer\pipeline.md`

## Current LaserForge Evidence

- `src/core/job/compile-job.ts` collects all closed contours matching a Fill layer before hatching. Same-layer nested objects therefore behave like a compound fill set.
- `src/core/job/compile-job-fill.test.ts` pins that behavior with tests for nested same-layer objects, overlaps, different layers, cross-hatch, and reverse metadata.
- `src/core/job/fill-hatching.ts` supports `evenodd` and `nonzero` fill rules.
- `src/ui/workspace/draw-scene.ts` uses the same fill-rule model for visual fill preview.
- `src/core/scene/scene.ts` recolors whole vector objects when assigning an object to a layer.
- Before this slice, the UI had no single command that meant "make only the selected vector artwork Fill, isolating it from other same-color artwork if needed."

## Root Cause

The bad burn preview/output was not caused by a broken even-odd fill algorithm. It was caused by an ambiguous operator workflow:

1. The selected inner artwork and the unselected outer artwork shared the same black layer/color.
2. Changing that black layer to Fill correctly applied Fill to every black closed contour.
3. LaserForge had no object-scoped "Fill Selection" action to express the user's actual intent.

That means the core CAM rule is valid, but the design-tool UX was underpowered.

## Fix Implemented In This Slice

Added `Fill Selection` as an object-scoped command.

Behavior:

- If selected vector artwork uses a layer color that no unselected object uses, LaserForge switches that layer to Fill.
- If selected vector artwork shares a color with unselected artwork, LaserForge moves the selected vector object(s) onto a new fill layer first.
- Unselected same-color artwork stays on its original line layer.
- Raster selections are ignored.
- The command is available from the Tools command registry and selected-object right-click context dropdown.

Tests added:

- `src/ui/state/fill-selection-actions.test.ts`
- command-registry coverage for `tools.fill-selection`
- context-menu coverage for showing `Fill Selection` in selected-object context

## Additional Fix Implemented: Break Apart Imported SVG

Added `Break Apart` as an Arrange command for selected imported SVG objects that contain more than one path or more than one contour/polyline inside one path.

Behavior:

- A selected multi-path `imported-svg` is replaced in-place by one `imported-svg` object per contour.
- A selected single-path `imported-svg` with multiple polylines is also split into one object per contour.
- Each new part preserves the original transform, source lineage, layer color, and path coordinates.
- Each new part gets bounds computed from its own path, so selection handles fit the piece instead of the original full SVG.
- The new parts become the active multi-selection in scene order.
- Single-contour SVGs, locked SVGs, raster images, text, traces, and shapes are no-ops in this v1 slice.

This is not a full node editor, but it directly improves the reported "inner shape" class when the outer and inner contours arrived either as separate SVG paths or as multiple contours inside one imported path.

Tests added:

- `src/ui/state/break-apart-actions.test.ts`
- `src/ui/commands/command-break-apart.test.ts`
- `src/ui/commands/selection-command-state.test.ts`
- context-menu coverage for showing `Break Apart` in selected-object More actions

## Additional Fix Implemented: Open Fill Contour Status Warning

Added the first design-time closed-shape diagnostics.

Behavior:

- When selected vector artwork is assigned to an output Fill layer, LaserForge counts contours that are not closed enough for the fill hatcher.
- The status bar shows `Fill warning: N open contour(s) will not fill`.
- The warning uses the same `isClosedEnough` predicate as the fill pipeline, so design-time feedback matches the CAM rule.
- The workspace redraws selected open Fill contours with a dashed orange warning stroke, so the operator can see exactly which contour is not fillable.
- Raster objects and non-Fill layers are ignored.

Tests added:

- `src/ui/common/fill-diagnostics.test.ts`
- `src/ui/common/StatusBar.test.tsx`
- `src/ui/workspace/draw-scene-open-fill-warning.test.ts`

## Additional Fix Implemented: Safe Close Open Fill Contours

Added `Close Open Fill Contours` as a conservative repair command for selected Fill-layer vectors.

Behavior:

- The command only closes selected vector contours assigned to an output Fill layer.
- It only closes contours whose start/end gap is within 0.5 mm, matching the LightBurn Close Path tolerance guardrail.
- It does not move points or guess geometry. It marks the near-closed contour as closed so preview, hatching, and status diagnostics agree.
- It skips unselected objects, locked objects, raster images, non-Fill layers, and wider endpoint gaps.
- It is available from the Tools command registry and selected-object right-click More dropdown.

Tests added:

- `src/ui/state/close-open-fill-contours-actions.test.ts`
- `src/ui/commands/command-close-open-fill-contours.test.ts`
- context-menu/help coverage for `Close Open Fill Contours`

## Additional Fix Implemented: Reviewed Close Tolerance Workflow

Added `Close Fill Contours With Tolerance...` as a review-first repair workflow for selected open Fill-layer contours whose endpoint gap is wider than the safe 0.5 mm quick close.

Behavior:

- The command opens a modal review surface instead of mutating geometry immediately.
- The dialog previews how many selected open Fill contours exist, how many qualify for the 0.5 mm quick close, how many additional contours will close at the chosen tolerance, and how many will remain open.
- The user must press `Apply Close` before geometry changes.
- The apply action closes selected, unlocked, output-Fill contours only when their start/end gap is within the reviewed tolerance.
- Wider gaps, locked objects, unselected objects, raster images, and non-Fill layers remain unchanged.
- The repair is one undoable scene mutation.
- V1 uses the existing closed-polyline model, equivalent to adding the implicit closing segment. It does not yet offer a Move Ends Together mode or node-level preview.

Tests added:

- `src/ui/commands/CloseOpenFillContoursDialog.test.tsx`
- `src/ui/common/fill-diagnostics.test.ts`
- expanded `src/ui/state/close-open-fill-contours-actions.test.ts`
- expanded command/context/help coverage for `Close Fill Contours With Tolerance...`

## Additional Fix Implemented: Node Edit Foundation And Node Drag

Added the first on-canvas vector node editing primitive without letting node handles interfere with normal Select/resize behavior, then extended it so selected nodes can be dragged with the mouse.

Behavior:

- The left tool rail now has a dedicated `Edit nodes` tool.
- Node handles render only while the Node tool is active, so the Select tool keeps normal move/resize/rotate semantics.
- Left-clicking a vector node in Node mode selects that node, selects its owning object, and starts a node drag.
- Dragging a node moves the node to the cursor as one undoable interaction instead of creating one undo step per mousemove.
- Arrow keys nudge a selected node instead of the whole object.
- Node nudges update imported SVG, traced-image, and polyline-shape path geometry, recompute bounds, push undo, and mark the project dirty.
- Mouse dragging converts scene cursor coordinates back to object-local path coordinates, so scaled/transformed vector objects update the correct node coordinates.
- Polyline shape specs stay in sync with the edited path point.
- Locked objects, raster images, text objects, non-polyline primitive shapes, and missing node refs are ignored.

Tests added:

- `src/ui/state/path-node-edit-actions.test.ts`
- `src/ui/workspace/path-node-drag.test.ts`
- `src/ui/workspace/path-node-hit-test.test.ts`
- `src/ui/workspace/draw-scene-path-node-handles.test.ts`
- expanded `src/ui/workspace/ToolStrip.test.tsx`
- expanded `src/ui/state/ui-store.test.ts`
- expanded `src/ui/app/shortcuts.test.ts`

## Benchmark Toward 10/10 Drawing Tools

| Area | 10/10 Target | Current Status | Rating |
| --- | --- | --- | --- |
| Layer/color operation semantics | Match LightBurn: layer color carries operation settings; closed same-layer fills behave as compound regions | Strong, explicitly tested | 8/10 |
| Object-scoped fill intent | User can choose "fill only this selected artwork" without manually managing layers | First slice implemented via `Fill Selection` | 7/10 |
| Subpath/inner-contour selection | User can select one contour inside a single imported SVG/object and assign/edit it separately | Improved via Break Apart plus Node tool selection/drag; still missing segment/subpath selection and contour-level selection without exploding objects | 6.8/10 |
| Boolean / compound shape editing | Union, difference, intersection, weld, cut-shape workflows with golden fixtures | Missing or incomplete for true LightBurn-class editing | 2/10 |
| Node editing / Convert to Path | Edit path nodes/handles; convert primitives/text to path before node editing | Node select, keyboard nudge, mouse drag, transformed-coordinate updates, and undo-safe path edits implemented for editable vector paths; still missing insert/delete, curve handles, segment selection, Convert to Path, and text/primitive conversion | 5/10 |
| Closed-shape diagnostics | Clear visual warning/repair path when Fill is selected on open paths | Status warning, selected open-contour canvas highlight, safe 0.5 mm close, and reviewed tolerance repair implemented; still missing node navigation and move-ends preview | 8.5/10 |
| Preview parity | Design preview, job preview, and emitted G-code agree for fill/hole behavior | Core fill previews are aligned, but full perceptual side-by-side is not complete | 6/10 |
| Right-click/context workflows | Common object actions are available in a normal context dropdown | Improved in this slice; needs broader consistency pass | 7/10 |
| Import decomposition | Imported SVG can be exploded/broken apart into selectable pieces while preserving source fidelity | Implemented for imported SVG path and contour/polyline pieces | 7/10 |

Overall drawing/design benchmark today: **7.7/10**. The fill-selection bug class, imported path/contour decomposition path, first open-contour diagnostics, safe near-closed-contour repair, review-first tolerance repair, and node-select/nudge/drag primitive are improved, but the editor is not yet a 10/10 design tool because segment/subpath editing, node insert/delete, move-ends repair preview, booleans, Convert to Path, and curve/text editing are still missing.

## Accepted Findings

### DF-001 - Fixed: no object-scoped fill command

- Severity: high UX defect
- Confidence: high
- Trigger: select an inner object that shares a layer color with outer artwork, then make the shared color layer Fill.
- Failure mode: all same-color closed artwork is filled because layer mode applies to all objects on that color.
- Consequence: operator thinks the selected inner shape was filled, but the entire compound same-color design fills.
- Concrete fix: add `Fill Selection` command that isolates selected vector objects onto a fill layer when needed.
- Evidence: `src/ui/state/fill-selection-actions.test.ts`, `src/ui/commands/command-registry.test.ts`, `src/ui/commands/WorkspaceContextBar.test.tsx`.

### DF-002 - Intentional: same-layer nested fill objects produce compound fill behavior

- Severity: none; expected CAM behavior.
- Confidence: high.
- Trigger: multiple closed objects on the same fill layer overlap or nest.
- Behavior: the fill hatcher treats matching contours as one layer fill set, so nesting and overlap affect the filled regions.
- Consequence: correct for LightBurn-style layer operations, but surprising without object-scoped commands.
- Concrete action: do not remove this behavior. Keep it tested and add better UX around selection/layer isolation.
- Evidence: `src/core/job/compile-job-fill.test.ts`.

### DF-003 - Partially fixed: imported SVG contours can now be broken apart

- Severity: high for imported SVG editing.
- Confidence: high.
- Trigger: an SVG imports as one `SceneObject` with multiple `paths` or multiple polylines; the user wants to fill only one internal contour.
- Fixed in this slice: one selected imported SVG can be broken apart into one object per contour, including multiple `paths` and one `ColoredPath` containing multiple polylines.
- Remaining failure mode: LaserForge still has no live node/subpath editor for editing points, curves, or path segments inside a contour.
- Consequence: `Fill Selection` plus `Break Apart` fixes the common separate-path and same-path multi-contour import cases, but not full LightBurn-class path editing.
- Concrete fix still needed: add true on-canvas subpath/node editing before claiming full parity.

### DF-004 - Remaining: no geometry-kernel-backed boolean editing

- Severity: high for 10/10 drawing tools.
- Confidence: high.
- Trigger: user needs union, difference, intersection, weld, or cut-shape workflows to create the exact filled region.
- Failure mode: workflow must be done externally or approximated by layer/color tricks.
- Consequence: LaserForge cannot yet replace LightBurn-class design editing.
- Concrete fix: stage boolean tools with pure-core fixtures and visual/perceptual golden checks before UI polish.

### DF-005 - Partially fixed: node editor foundation exists, full Convert to Path workflow still missing

- Severity: high for precise design tools.
- Confidence: high.
- Trigger: user needs to repair closure, adjust curves, edit a trace, or convert a primitive/text object into editable paths.
- Fixed in this slice: a dedicated Node tool can select vector nodes, render handles only in Node mode, keyboard-nudge imported SVG/traced/polyline nodes, and mouse-drag nodes with undo-safe bounds updates.
- Remaining failure mode: there is no segment/subpath selection, insert/delete node workflow, Bezier handle editing, Move Ends Together preview, or Convert to Path for text/primitive objects.
- Consequence: fill failures from open paths or bad imported contours are easier to inspect and make small corrections to, but LaserForge is still not a full LightBurn-class node editor.
- Concrete fix still needed: continue the node editor with segment selection, insert/delete operations, curve handles, and Convert to Path once path edits are fully persisted.

### DF-007 - Fixed first slice: selected Fill open-contour warning

- Severity: medium UX defect.
- Confidence: high.
- Trigger: selected vector artwork is on an output Fill layer but contains open contours.
- Failure mode: the fill hatcher correctly skips open contours, but the user receives no immediate design-time explanation.
- Consequence: Fill can look broken or empty until preflight/preview, especially after imports and traces.
- Concrete fix: status bar warns with the count of selected open contours that will not fill, using the same closure predicate as CAM.
- Evidence: `src/ui/common/StatusBar.test.tsx`, `src/ui/common/StatusBar.tsx`.

### DF-008 - Fixed first slice: selected open Fill contours are visually highlighted

- Severity: medium UX defect.
- Confidence: high.
- Trigger: selected vector artwork is on an output Fill layer and contains open contours.
- Failure mode: the status warning told the user there was an open contour but did not point to the failing geometry.
- Consequence: users still had to hunt for the bad contour by eye, especially in imported or traced artwork.
- Concrete fix: draw selected open Fill contours with a dashed orange warning stroke in design mode.
- Evidence: `src/ui/workspace/draw-scene-open-fill-warning.test.ts`, `src/ui/workspace/draw-open-fill-contours.ts`, `src/ui/common/fill-diagnostics.ts`.

### DF-009 - Fixed first slice: selected near-closed Fill contours can now be repaired safely

- Severity: medium UX defect.
- Confidence: high.
- Trigger: selected vector artwork is on an output Fill layer, contains an open contour, and the contour's start/end gap is within 0.5 mm.
- Failure mode: the warning/highlight could identify the open contour but did not provide an in-app repair path.
- Consequence: users had to leave LaserForge or manually redraw/trace otherwise fillable artwork.
- Concrete fix: add `Close Open Fill Contours`, which marks only selected, unlocked, output-Fill contours within the safe endpoint tolerance as closed.
- Evidence: `src/ui/state/close-open-fill-contours-actions.test.ts`, `src/ui/commands/command-close-open-fill-contours.test.ts`, `src/ui/common/fill-diagnostics.ts`.

### DF-010 - Fixed first slice: selected wider open Fill contours now have a reviewed repair workflow

- Severity: medium UX defect.
- Confidence: high.
- Trigger: selected vector artwork is on an output Fill layer, contains an open contour, and the contour's start/end gap is wider than 0.5 mm but still intended to close.
- Failure mode before this slice: LaserForge warned/highlighted the open contour and offered only the 0.5 mm quick close, leaving larger but intentional gaps without an in-app reviewed repair path.
- Consequence: users had to leave LaserForge or redraw otherwise recoverable Fill geometry.
- Concrete fix: add `Close Fill Contours With Tolerance...`, which previews open/safe/reviewed/remaining counts and applies only after confirmation with undo.
- Evidence: `src/ui/commands/CloseOpenFillContoursDialog.test.tsx`, `src/ui/common/fill-diagnostics.test.ts`, `src/ui/state/close-open-fill-contours-actions.test.ts`.

## Next Implementation Lanes

1. Continue node editing: select segments/subpaths, insert/delete nodes, and expose selected-node coordinates.
2. Add Move Ends Together preview for the reviewed tolerance repair workflow.
3. Add booleans with pure geometry fixtures before any UI.
4. Add Convert to Path for primitives/text after the node editor can safely persist path edits.
5. Add perceptual tests comparing design fill preview, job preview, and emitted fill geometry on nested/overlap/import fixtures.

## Verification Status

Verified so far:

- Targeted store/command/context tests for `Fill Selection`.
- Targeted store/command/context tests for `Close Open Fill Contours`.
- `pnpm format:check` passed.
- `pnpm lint` passed, with only the existing `boundaries/dependencies` legacy selector warning from the ESLint plugin.
- `pnpm typecheck` passed.
- `pnpm test` passed: 334 test files, 2075 tests.
- Browser smoke confirmed the right-click context menu is now a vertical dropdown, not a horizontal scrolling bar.
- Targeted diagnostic tests confirmed selected Fill-layer open contours warn in the status bar and are highlighted on canvas before CAM silently skips them.
- Targeted repair tests confirmed only selected, unlocked, output-Fill contours within the 0.5 mm close tolerance are marked closed.
- Targeted tolerance-review tests confirmed the dialog previews open/safe/reviewed/remaining counts and only applies the chosen tolerance after confirmation.
- Targeted node-edit tests confirmed Node tool activation, node-hit testing, Node-mode-only handles, selected-node nudging, selected-node mouse dragging, transformed-coordinate conversion, bounds updates, undo, and keyboard nudge routing.
- Browser smoke on a clean reload confirmed the workspace right-click menu renders as a vertical dropdown (`flex-direction: column`, 240x193 px), the Node tool toggles on while Select toggles off, and no post-reload/action console errors were emitted.
- Browser smoke also found a separate ultra-narrow viewport layout issue: at 319 px wide, side panels can consume all width and collapse the canvas to 0 px. The functional smoke used a temporary 1280x720 viewport and then reset the viewport override.

Still required before a clean checkpoint:

- Side-effect-free browser/perceptual proof for an isolated selected-object fill workflow, open-contour status warning/highlight, and near-closed contour repair, or maintainer-assisted live-scene verification.
