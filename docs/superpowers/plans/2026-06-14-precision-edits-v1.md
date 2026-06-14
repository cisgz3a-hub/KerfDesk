# Precision Edits V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LightBurn-style numeric edit row for precise selection position, size, and rotation without weakening rotated-shape transform behavior.

**Architecture:** Put selection transform math in pure `src/core/scene/selection-transform.ts`, expose one store action that applies a batch of object transforms as one undoable edit, then render a compact `NumericEditsBar` under the existing toolbar. Non-uniform resizing of rotated selections is rejected in v1 because LaserForge's current `Transform` type cannot represent arbitrary scene-axis affine shear safely.

**Tech Stack:** TypeScript, React, Zustand, Vitest, existing CSS token classes.

---

## Research Notes

- LightBurn's Numeric Edits Toolbar edits selection position, dimensions, and rotation, and treats all selected objects as one unit while preserving relative layout.
- LightBurn's 9-dot control chooses the coordinate reference point, the resize anchor, and the rotation center.
- LightBurn supports transform handles for imprecise mouse edits and points operators to Numeric Edits for exact values.
- LightBurn's selection boxes and snapping remain separate follow-up work; they should consume the same selection bounding box helpers rather than inventing their own geometry.

Sources:
- https://docs.lightburnsoftware.com/2.1/Reference/NumericEditsToolbar/
- https://docs.lightburnsoftware.com/2.1/Reference/TransformControls/
- https://docs.lightburnsoftware.com/2.1/GetStarted/SelectingMovingSizing/
- https://docs.lightburnsoftware.com/2.1/Reference/Snapping/

---

### Task 1: Pure Selection Transform Math

**Files:**
- Create: `src/core/scene/selection-transform.ts`
- Create: `src/core/scene/selection-transform.test.ts`
- Modify: `src/core/scene/index.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:
- moving all selected objects so a chosen anchor reaches an exact X/Y
- uniform resizing around the center while preserving selected layout
- rejecting non-uniform resize on a rotated selection
- rotating a single selected object around the selected anchor without center drift

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test src/core/scene/selection-transform.test.ts`

- [ ] **Step 3: Implement minimal pure helper**

Implement:
- `selectionMetrics(objects)`
- `buildSelectionTransformEdit(objects, edit)`
- `SelectionAnchor`
- result union `{ kind: 'ok'; transforms } | { kind: 'error'; reason }`

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test src/core/scene/selection-transform.test.ts`

### Task 2: Undoable Store Batch Transform

**Files:**
- Create: `src/ui/state/selection-transform-actions.ts`
- Create: `src/ui/state/selection-transform-actions.test.ts`
- Modify: `src/ui/state/store.ts`

- [ ] **Step 1: Write failing store test**

Assert applying two transform edits updates both objects, pushes one undo entry, marks dirty, and undo restores both.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test src/ui/state/selection-transform-actions.test.ts`

- [ ] **Step 3: Add store action**

Add `applySelectionTransforms(edits)` as a small slice.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test src/ui/state/selection-transform-actions.test.ts`

### Task 3: Numeric Edits UI

**Files:**
- Create: `src/ui/commands/NumericEditsBar.tsx`
- Create: `src/ui/commands/NumericEditsBar.test.tsx`
- Modify: `src/ui/commands/CommandShell.tsx`

- [ ] **Step 1: Write failing UI test**

Assert the bar renders disabled with no selection and commits an X-position edit through `applySelectionTransforms`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test src/ui/commands/NumericEditsBar.test.tsx`

- [ ] **Step 3: Render the numeric bar**

Add X/Y/W/H/rotation fields, a 9-dot anchor grid, and an aspect-lock toggle.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test src/ui/commands/NumericEditsBar.test.tsx`

### Task 4: Verification

**Files:**
- No new production files.

- [ ] **Step 1: Run focused tests**

Run:
`corepack pnpm test src/core/scene/selection-transform.test.ts src/ui/state/selection-transform-actions.test.ts src/ui/commands/NumericEditsBar.test.tsx`

- [ ] **Step 2: Run quality gates**

Run:
`corepack pnpm typecheck`
`corepack pnpm lint`

- [ ] **Step 3: Browser smoke**

Open the local app, verify the numeric row appears, select/draw a shape, edit X/Y, resize with aspect lock, and rotate a selected shape.
