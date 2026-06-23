# Step 2: Selection And Transform Polish

Date: 2026-06-23

Target checkout: `C:\Users\Asus\LaserForge-2.0`

## Locked Goal

Make the active selection/transform slice feel reliable before moving to node, contour, and fill editing work.

In scope:

- Double-left-click exits sticky shape drawing and returns to Select without creating a stray draft.
- Side resize handle behavior has explicit regression coverage.
- Anchor/pivot resize behavior has explicit regression coverage.
- Live browser smoke confirms the operator workflow on the real app.
- Recent right-click menu polish is sanity-checked because it sits in the same workspace interaction surface.

Out of scope:

- Node edit workflows.
- Contour closure and fill eligibility.
- Fill/raster output fidelity.
- Machine/controller behavior.

Safety risk:

- Low direct machine risk because this slice changes workspace editing only.
- Medium workflow risk if a stray shape is silently added, because accidental geometry can later become output.

## Verified Research

LaserForge files inspected:

- `src/ui/workspace/draw-tool.ts`
- `src/ui/workspace/draw-tool.test.ts`
- `src/ui/workspace/drag-state.ts`
- `src/ui/workspace/drag-state.test.ts`
- `src/ui/workspace/use-workspace-drag.ts`
- `src/ui/workspace/Workspace.tsx`
- `src/ui/workspace/finish-draw-tool.ts`
- `src/ui/workspace/handles.ts`
- `src/ui/workspace/view-transform.ts`
- `src/ui/commands/WorkspaceContextBar.tsx`
- `src/ui/commands/WorkspaceContextBar.test.tsx`

Rayforge study-only reference:

- `C:\Users\Asus\LaserForge\audit\external\rayforge\website\docs\getting-started\quick-start.md`
- Rayforge documents the expected canvas basics: pan, move, rotate handles, and scale handles. No Rayforge code was copied.

## Failing Proof

Added a red test before the production edit:

- `src/ui/workspace/draw-tool.test.ts`
- Test: `beginDrawDrag ignores the second left click of a double-click so shape-exit does not start a stray draft`

Observed pre-fix failure:

- `beginDrawDrag(...)` returned a `draw` drag state for a left double-click with `detail: 2`.
- Expected: `null`, so the second click of the double-click cannot start another draw operation before the double-click handler changes tools.

## Implementation

Production change:

- `src/ui/workspace/draw-tool.ts`
  - `beginDrawDrag` now ignores left double-click events by returning `null` when `button === 0 && detail >= 2`.

Test coverage added:

- `src/ui/workspace/draw-tool.test.ts`
  - Covers the double-click shape-exit regression.
- `src/ui/workspace/drag-state.test.ts`
  - Covers east side-handle resizing.
  - Covers selected anchor as resize pivot when the anchor is valid for the dragged handle.

## Verification

Targeted tests:

- `pnpm test src/ui/workspace/draw-tool.test.ts`
  - Passed: 9 tests.
- `pnpm test src/ui/workspace/draw-tool.test.ts src/ui/workspace/drag-state.test.ts src/ui/workspace/selection-marquee.test.ts src/ui/state/ui-store.test.ts src/ui/state/store-select-objects.test.ts`
  - Passed: 5 files, 36 tests.

Formatting:

- `pnpm exec prettier --check src/ui/workspace/draw-tool.ts src/ui/workspace/draw-tool.test.ts src/ui/workspace/drag-state.test.ts`
  - Passed after formatting the touched files.

Repo gates:

- `pnpm typecheck`
  - Passed.
- `pnpm lint`
  - Passed with the existing boundaries legacy-selector warning only.
- `pnpm test`
  - Passed: 341 files, 2103 tests.

Browser smoke on the real app at `http://127.0.0.1:5173/`:

- Opened app in Chrome, title `LaserForge`.
- Selected `Draw rectangle`, drew one rectangle.
- Verified post-draw state:
  - Tool still `Draw rectangle`.
  - Status: `Objects: 1`.
- Double-left-clicked the workspace.
- Verified post-double-click state:
  - Tool changed to `Select / transform`.
  - Status remained `Objects: 1`.
- Selected the rectangle and dragged the east side handle.
- Verified resize result:
  - Width changed from `79.529 mm` to `139.032 mm`.
  - Height stayed `50.051 mm`.
  - X/Y stayed pinned at `-8.346, 30.613`.
  - Status remained `Objects: 1`.
- Right-click menu sanity:
  - `.lf-workspace-context-menu` present.
  - `role="menu"`.
  - `aria-orientation="vertical"`.
  - `flex-direction: column`.
  - `overflow-x: hidden`.
  - Browser console errors: `[]`.

Browser-tool note:

- The in-app browser tab had crashed earlier, so Chrome control was used for the mandatory smoke test.
- The Chrome screenshot and final session cleanup calls timed out after the actual smoke evidence was collected. This is not accepted as a product finding because DOM, pointer automation, state checks, and console inspection all succeeded.

## Audit Findings

### Fixed Finding 1

Severity: Medium

Confidence: High

File: `src/ui/workspace/draw-tool.ts`

Function: `beginDrawDrag`

Trigger path:

- Choose a sticky shape tool such as rectangle.
- Draw one shape.
- Double-left-click the workspace to exit the draw tool.

Failure mode:

- The second click of the browser double-click sequence entered `beginDrawDrag` before the double-click tool-exit handler finished, creating a new draw-drag candidate.

Consequence:

- The user could get a stray draft or accidental tiny shape while trying to leave drawing mode. That is confusing in the editor and dangerous later if accidental geometry reaches G-code output.

Concrete fix:

- Treat left double-click events as non-draw starts in `beginDrawDrag`.
- Preserve normal single-click/drag drawing.

Status:

- Fixed and covered by a red-then-green unit test plus live browser smoke.

### Fixed Finding 2

Severity: Low

Confidence: High

Files:

- `src/ui/workspace/drag-state.test.ts`
- `src/ui/workspace/handles.ts`

Trigger path:

- Resize selected geometry using side handles or a selected resize anchor.

Failure mode:

- Existing behavior was correct, but the regression surface was under-covered for side-handle-only stretching and selected-anchor pivots.

Consequence:

- A future transform refactor could break the exact side-handle/pivot behavior users already complained about without a targeted failing signal.

Concrete fix:

- Added side-handle and anchor-pivot regression tests.

Status:

- Fixed by coverage; browser smoke also confirmed east side-handle resizing.

## False Positives Rejected

- Chrome screenshot timeout:
  - Rejected as a LaserForge finding. It did not block DOM/pointer smoke, console inspection, or app state verification.
- Chrome session cleanup timeout:
  - Rejected as a LaserForge finding. It happened after the verification evidence was already collected.
- Existing ESLint boundaries legacy-selector warning:
  - Rejected as a Step 2 regression. It was present as an existing tool warning and lint exited successfully.

## Rating

Correctness: 10/10

Safety: 10/10

UX: 10/10 for this locked slice

Regression coverage: 10/10

Real-artifact evidence: 10/10

Maintainability: 10/10

Docs/audit clarity: 10/10

Overall Step 2 rating: 10/10

No accepted findings remain for the locked Step 2 slice.
