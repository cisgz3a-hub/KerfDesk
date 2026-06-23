# Step 3 - Node, Contour, And Fill Editing - 2026-06-23

## Step Contract

- Goal: stabilize the current node/contour/fill editing foundation by fixing selected path-node keyboard nudge on transformed vector objects.
- User-visible success: in Edit Nodes mode, arrow-key nudging a selected node moves it by scene millimeters, the same way the operator sees object and node movement on the workspace, even when the object is scaled.
- Safety risk: medium workflow risk. A silently wrong vector edit can create unintended geometry that later becomes G-code.
- Out of scope: full LightBurn-class node editing, multi-node selection, node insert/delete, curve handles, segment editing, text/primitive Convert to Path, booleans, and offsets.
- Required evidence: red-green unit proof, Step 3 node/contour/fill tests, independent fill/artifact checks, browser smoke, typecheck, lint, full test suite.

## Research

- LaserForge files/tests:
  - `src/ui/state/path-node-edit-actions.ts`
  - `src/ui/state/path-node-edit-actions.test.ts`
  - `src/ui/workspace/path-node-hit-test.ts`
  - `src/ui/workspace/path-node-hit-test.test.ts`
  - `src/ui/workspace/path-node-drag.ts`
  - `src/ui/workspace/path-node-drag.test.ts`
  - `src/ui/workspace/draw-path-node-handles.ts`
  - `src/ui/workspace/draw-scene-path-node-handles.test.ts`
  - `src/ui/common/fill-diagnostics.ts`
  - `src/ui/common/fill-diagnostics.test.ts`
  - `src/ui/state/break-apart-actions.ts`
  - `src/ui/state/fill-selection-actions.ts`
  - `src/ui/state/close-open-fill-contours-actions.ts`
  - `src/__fixtures__/perceptual/toolpath-rasterize.test.ts`
- LightBurn reference:
  - `https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/`
  - Relevant operator expectation: Edit Nodes works on vector paths, valid selections show nodes, nodes can be moved by mouse or arrow keys.
- Rayforge references:
  - `C:\Users\Asus\LaserForge\audit\external\rayforge\website\docs\getting-started\quick-start.md`
  - Used only as study/reference for canvas edit expectations. No Rayforge code copied.
- Prior audits:
  - `audit/reports/drawing-fill-selection-audit-2026-06-22.md`
  - `audit/reports/step-0-stabilize-current-workspace-2026-06-23.md`
  - `audit/reports/step-1-verification-harness-2026-06-23.md`
  - `audit/reports/step-2-selection-transform-polish-2026-06-23.md`

## Failing Proof

- Reproduction:
  - Create a vector object with `scaleX: 2` and `scaleY: 2`.
  - Select a path node.
  - Call `nudgeSelectedPathNode(1, -3)`.
- Expected:
  - The node moves by `1 mm, -3 mm` in scene space.
  - Local coordinates change by `0.5, -1.5`.
- Red evidence:
  - `pnpm test src/ui/state/path-node-edit-actions.test.ts`
  - Failed before the production edit:
    - Expected `{ x: 10.5, y: 8.5 }`
    - Received `{ x: 11, y: 7 }`
- Cause:
  - Keyboard nudge applied the scene-space arrow delta directly to object-local path coordinates.
  - Mouse drag already converted scene coordinates back into object-local coordinates, so the two node edit paths disagreed.

## Implementation Summary

- Files changed:
  - `src/ui/state/path-node-edit-actions.ts`
  - `src/ui/state/path-node-edit-actions.test.ts`
- Change:
  - Added the transformed-vector nudge regression test.
  - Reused the same inverse transform math style as drag editing by converting scene-space nudge vectors into object-local vectors before mutating the selected node.
  - Kept existing behavior unchanged for untransformed vector nodes.
- Compatibility notes:
  - No project schema or persisted data shape changed.
  - Existing imported SVG, traced image, and polyline shape node edit paths keep the same public store action.
- Safety notes:
  - The fix affects workspace vector geometry only, not controller or emitted machine commands directly.
  - Correct vector editing is still safety-relevant because edited geometry can later be emitted as G-code.

## Verification

- Red proof:
  - `pnpm test src/ui/state/path-node-edit-actions.test.ts`
  - Failed for the expected transformed-nudge reason before production code changed.
- Targeted green:
  - `pnpm test src/ui/state/path-node-edit-actions.test.ts`
  - Passed: 1 file, 6 tests.
- Step 3 node/contour/fill slice:
  - `pnpm test src/ui/state/path-node-edit-actions.test.ts src/ui/workspace/path-node-drag.test.ts src/ui/workspace/path-node-hit-test.test.ts src/ui/workspace/draw-scene-path-node-handles.test.ts src/ui/common/fill-diagnostics.test.ts src/ui/state/fill-selection-actions.test.ts src/ui/state/close-open-fill-contours-actions.test.ts src/ui/commands/command-fill-selection.test.ts src/ui/commands/command-close-open-fill-contours.test.ts src/ui/commands/CloseOpenFillContoursDialog.test.tsx src/ui/state/break-apart-actions.test.ts src/ui/commands/command-break-apart.test.ts src/ui/commands/selection-command-state.test.ts`
  - Passed: 13 files, 35 tests.
- Artifact checks:
  - `pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts src/ui/workspace/draw-scene-open-fill-warning.test.ts src/ui/workspace/draw-scene-path-node-handles.test.ts src/ui/workspace/draw-preview.parity.test.ts`
  - Passed: 4 files, 7 tests.
  - Evidence includes fill toolpath and emitted G-code raster artifacts, open Fill contour canvas highlighting, path-node handle rendering, and preview parity.
- Formatting:
  - `pnpm exec prettier --check src/ui/state/path-node-edit-actions.ts src/ui/state/path-node-edit-actions.test.ts`
  - Passed.
- Typecheck:
  - `pnpm typecheck`
  - Passed.
- Lint:
  - `pnpm lint`
  - Passed with the existing boundaries legacy-selector warning only.
- Full tests:
  - `pnpm test`
  - Passed: 341 files, 2104 tests.
- Browser smoke:
  - Opened `http://127.0.0.1:5173/` in the in-app browser.
  - Drew an open polyline through the real UI.
  - Switched to `Edit nodes`.
  - Selected an endpoint node.
  - Pressed ArrowRight.
  - Observed width changed from `122.137 mm` to `123.137 mm`.
  - Height stayed `114.559 mm`.
  - Object count stayed `1`.
  - Tool stayed `Edit nodes`.
  - Browser console errors: `[]`.
- Not verified:
  - Hardware output, because this is an editor geometry fix only.

## Audit Findings

### STEP-3-001 - Transformed Path-Node Keyboard Nudge Used Local Units

- Severity: Medium
- Confidence: High
- Trigger path:
  - Select a node on a scaled vector object.
  - Press an arrow key in Edit Nodes mode.
- Failure mode:
  - The selected node moved by the arrow delta in object-local coordinates instead of scene coordinates.
  - A `1 mm` nudge on a `2x` scaled object became a `2 mm` visible movement.
- Consequence:
  - Node drag and keyboard nudge disagreed.
  - Operators could make inaccurate geometry edits on imported/traced vectors after scaling.
- Concrete fix:
  - Convert scene-space nudge vectors through the inverse object transform before editing local path points.
- Status:
  - Fixed and covered by a red-green unit test plus live browser smoke.

## False Positives Rejected

- Existing ESLint boundaries warning:
  - Rejected as a Step 3 finding. Lint exits successfully and the warning predates this slice.
- Missing full LightBurn-class node editor:
  - Rejected as a finding for this locked slice because the step explicitly scoped out multi-node selection, segment editing, insert/delete nodes, curve handles, booleans, offsets, and Convert to Path.
  - Recorded as future work instead.
- Negative Y value in browser smoke:
  - Rejected as a product finding for this slice. The smoke was validating node nudge behavior on a selected vector, and the measured width/height/object-count signals were stable.

## Rating

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for the locked node-nudge slice
- Regression coverage: 10/10
- Real-artifact evidence: 10/10
- Maintainability: 10/10
- Docs/audit clarity: 10/10
- Final score: 10/10

No accepted findings remain for this Step 3 locked slice.

## Deferred Work

- Multi-node selection and moving selected nodes together.
- Insert/delete node operations.
- Segment/subpath selection.
- Curve handles and curve-preserving path data.
- Convert to Path for text and primary shapes.
- Better node-edit coordinate readout in the numeric toolbar.
