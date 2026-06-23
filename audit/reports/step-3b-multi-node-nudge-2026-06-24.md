# Step 3B: Multi-Node Nudge Editing

## Goal

Make node editing support same-object multi-node selection and keyboard nudge without changing single-node drag behavior.

## Scope

- Shift-click toggles path nodes on the same vector object.
- Arrow-key nudge moves every selected path node together.
- Selected node handles render for every selected node.
- Project reset and normal object selection clear transient node selection.

Out of scope: multi-node mouse drag, segment selection, curve handles, node insertion/deletion, and boolean/path operations.

## Failing Proof

Added `shift-selects multiple nodes on one vector and nudges them together` in `src/ui/state/path-node-edit-actions.test.ts`.

Initial failure before implementation: `selectedPathNodes` was undefined and only one selected node could be nudged.

## Implementation

- Added `AppState.selectedPathNodes`.
- Extended `selectPathNode(ref, { additive })` for same-object Shift-click multi-selection.
- Updated keyboard nudge to edit all active selected node refs in one undoable project mutation.
- Preserved legacy `selectedPathNode` fallback for existing renderer and drag call sites.
- Propagated Shift state from node hit-testing in workspace drag.
- Rendered every selected path node with active handle styling.
- Cleared `selectedPathNodes` on undo/redo, object selection changes, preview toggle, reset helpers, `newProject`, and `setProject` via `initialState()`.

## Browser Evidence

Local app: `http://127.0.0.1:5173/`.

Smoke path:

1. Drew a polyline in the real workspace.
2. Switched to Edit Nodes.
3. Shift-selected two left-side nodes.
4. Pressed ArrowRight.

Observed status bar changed from:

- Before: `1 selected - 58.9 x 57.9 mm - X 71.8, Y 74.1`
- After: `1 selected - 57.9 x 57.9 mm - X 72.8, Y 74.1`

That is the expected signature for both left-side nodes moving right together. Browser console error count: `0`.

## Verification

- `pnpm test src/ui/state/path-node-edit-actions.test.ts src/ui/state/store.test.ts src/ui/workspace/path-node-drag.test.ts src/ui/workspace/draw-scene-path-node-handles.test.ts`
  - 4 files, 53 tests passed.
- `git diff --check`
  - passed.
- `pnpm typecheck`
  - passed.
- `pnpm lint`
  - passed, with the pre-existing boundaries plugin migration warning.
- `pnpm test`
  - 345 files, 2137 tests passed.
- `pnpm build:web`
  - passed, with the pre-existing Vite large chunk warning.

## Audit

Accepted findings: none.

Rejected findings:

- Multi-node mouse drag is not implemented. Rejected as out of scope for this slice; existing single-node drag behavior was intentionally preserved.
- Cross-object node multi-select is not implemented. Rejected as out of scope and safer for v1, since path refs and bounds updates stay inside one selected object family.
- Two dirty G-code metadata files remain in the workspace. Rejected for this step because they are pre-existing unrelated ADR emitter-revision edits and were not staged.

## Rating

Correctness: 10/10
Safety: 10/10
UX: 10/10 for the scoped workflow
Regression coverage: 10/10
Real-artifact evidence: 10/10
Maintainability: 10/10
Audit clarity: 10/10

Overall: 10/10.
