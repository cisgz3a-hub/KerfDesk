# Route Optimizer V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce laser-off travel for Island Fill and Follow Shape output without changing burn geometry or requiring new machine capabilities.

**Architecture:** Extend the existing pure `optimizePaths` step that already runs inside `prepareOutput`, so Save, Start, Preview, and Estimate all see the same route. Optimize only safe route units: whole Island Fill groups and offset-fill contour segments. Leave scanline fills and raster groups in source order.

**Tech Stack:** TypeScript, Vitest, existing `Job` / `Group` / `FillGroup` IR, existing `groupFillSweeps` and overscan helpers.

---

### Task 1: Pin Route Optimizer Behavior With Tests

**Files:**
- Modify: `src/core/job/optimize-paths.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests that prove:
- consecutive compatible `fillStyle: 'island'` groups are reordered to reduce travel;
- incompatible island groups are not reordered across layer/settings boundaries;
- scanline fill groups remain untouched;
- offset-fill segments are reordered using the existing cut-style route optimizer.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test --run src/core/job/optimize-paths.test.ts`

Expected: new Island Fill and offset-fill tests fail because `optimizePaths` currently skips every fill group.

### Task 2: Implement Safe Fill Optimization

**Files:**
- Modify: `src/core/job/optimize-paths.ts`

- [ ] **Step 1: Add route endpoint helpers**

Add helpers that compute a fill group's first route entry and final route exit by using `groupFillSweeps`, `effectiveOverscanMm`, and `expandFillHatchWithOverscan`.

- [ ] **Step 2: Reorder compatible island groups**

Walk `job.groups`, collect consecutive `fillStyle: 'island'` groups with identical layer/output settings, and nearest-neighbor order those whole groups from the current cursor. Do not merge groups or reorder individual hatch segments.

- [ ] **Step 3: Optimize offset-fill contour order**

For `fillStyle: 'offset'`, reuse the existing segment optimizer on the group's contour segments. Preserve segment metadata and do not apply this to scanline or island hatch segments.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm test --run src/core/job/optimize-paths.test.ts`

Expected: optimizer tests pass.

### Task 3: Focused Regression

**Files:**
- No extra files unless tests expose integration gaps.

- [ ] **Step 1: Run focused job/toolpath tests**

Run: `pnpm test --run src/core/job/optimize-paths.test.ts src/core/job/toolpath.test.ts src/io/gcode/prepare-output.test.ts src/ui/workspace/draw-preview.parity.test.ts`

Expected: all focused route and preview parity tests pass.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: TypeScript passes.

### Self-Review

- Spec coverage: V1 optimizes the highest-value safe units discovered in research: island groups and offset contours.
- Placeholder scan: no deferred code path is required to finish V1.
- Type consistency: all work stays inside existing `Job`, `Group`, `FillGroup`, and `CutSegment` types.
