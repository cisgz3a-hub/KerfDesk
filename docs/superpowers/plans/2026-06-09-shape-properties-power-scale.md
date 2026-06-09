# Shape Properties Power Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the new object-level `powerScale` through a LightBurn-style selected-object Shape Properties UI.

**Architecture:** Add a focused Zustand action file for object property mutations, then render a compact selected-object section in the existing Cuts / Layers panel. The UI writes the same `SceneObject.powerScale` field that `compileJob` already consumes.

**Tech Stack:** React 18, Zustand, TypeScript strict, Vitest DOM tests, existing `useDebouncedCommit` field behavior.

---

## Research Anchor

- LightBurn Shape Properties applies **Power Scale** to selected shapes, and changing the value with multiple shapes selected applies it to all selected shapes: <https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/>
- LightBurn Material Test remains a future generator. This slice only creates the operator-editable object property that a future generated grid can also use.

## Files

- Create: `src/ui/state/object-properties-actions.ts`
- Create: `src/ui/state/object-properties-actions.test.ts`
- Modify: `src/ui/state/store.ts`
- Create: `src/ui/layers/SelectedObjectProperties.tsx`
- Create: `src/ui/layers/SelectedObjectProperties.test.tsx`
- Modify: `src/ui/layers/CutsLayersPanel.tsx`

## Tasks

### Task 1: Red Store Tests

- [x] Add tests proving `setSelectedObjectsPowerScale(50)` updates the primary selection.
- [x] Add tests proving the same action updates primary plus additional selected objects.
- [x] Add tests proving values are clamped to 0..100 and create one undo frame.
- [x] Run the focused store tests and confirm the action is missing.

### Task 2: Red UI Tests

- [x] Add a render test proving no section appears when nothing is selected.
- [x] Add a render test proving a selected object shows Power Scale with default 100.
- [x] Add a change/blur test proving typing 50 commits `powerScale: 50`.
- [x] Run the focused UI test and confirm the component is missing.

### Task 3: Minimal Implementation

- [x] Implement `object-properties-actions.ts` with selected-id collection and immutable object replacement.
- [x] Add `setSelectedObjectsPowerScale` to `AppState` and compose it in `useStore`.
- [x] Implement `SelectedObjectProperties.tsx` using `useDebouncedCommit`.
- [x] Mount it below the layer list and above selected image adjustments.

### Task 4: Verify And Ship

- [x] Run focused tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push only after verification passes.

## Non-Goals

- No full Shape Properties dock with cut-order priority or lock controls yet.
- No Material Test grid yet.
- No hardware-proof claim; core output tests already verify emitted power behavior.
