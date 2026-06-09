# Material Library Store Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add state-level Material Library Create-from-Layer and Assign actions so the future UI can match LightBurn's library workflow without hidden preset sync.

**Architecture:** Keep the native recipe and `.lfml.json` document code pure, then add one focused Zustand action slice. Library edits dirty the library only; Assign applies a copied recipe to a project layer with normal project undo/redo.

**Tech Stack:** TypeScript, Zustand, Vitest, LaserForge scene/layer model, native Material Library recipe and IO modules.

---

## Research Grounding

Official LightBurn docs say Material Library stores and reapplies cut settings. The docs also define the split this slice must preserve:

- `Create new from layer` saves the active layer settings into a new library preset.
- A preset is described by Material Name, either Thickness or a No Thickness Title, and Description.
- `Assign` applies preset settings to the active layer.
- After `Assign`, later Cut Settings edits do not affect the Library entry and Library edits do not affect the layer.
- `Link` is separate sync behavior and is intentionally deferred.

Reference: https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/

## File Structure

- Create `src/ui/state/material-library-actions.ts`
  - Owns Material Library state fields and store actions.
  - Depends on `src/core/material-library` for capture/apply recipe behavior.
  - Depends on `src/io/material-library` for document/preset types and format constants.
- Create `src/ui/state/material-library-actions.test.ts`
  - Covers create-from-layer, assign-to-layer, no-op paths, dirty flags, undo/redo, and preset validation.
- Modify `src/ui/state/store.ts`
  - Adds Material Library fields/actions to `AppState`.
  - Composes the new slice into `useStore`.
  - Adds defaults to `initialState()`.
- Modify `src/ui/state/test-helpers.ts`
  - Resets Material Library state in tests.

## Task 1: Red Tests

- [ ] **Step 1: Write failing tests**

Add `src/ui/state/material-library-actions.test.ts` with tests for:

```ts
it('setMaterialLibrary loads a library without dirtying the project', () => {});
it('createMaterialPresetFromLayer appends a captured preset and dirties only the library', () => {});
it('createMaterialPresetFromLayer rejects invalid metadata and missing inputs', () => {});
it('assignMaterialPresetToLayer applies a preset without linking the layer', () => {});
it('assignMaterialPresetToLayer is project-undoable and keeps the library clean', () => {});
it('assignMaterialPresetToLayer preserves id, color, visible, and output', () => {});
it('assignMaterialPresetToLayer no-ops for missing or identical recipes', () => {});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
corepack pnpm exec vitest run src/ui/state/material-library-actions.test.ts
```

Expected: failure because `materialLibrary`, `setMaterialLibrary`, `createMaterialPresetFromLayer`, and `assignMaterialPresetToLayer` are not on `AppState`.

## Task 2: Store Slice

- [ ] **Step 1: Implement `material-library-actions.ts`**

Add:

```ts
export const MATERIAL_LIBRARY_STATE_DEFAULTS = {
  materialLibrary: null,
  materialLibraryDirty: false,
} as const;
```

Add actions:

```ts
setMaterialLibrary(library)
createMaterialPresetFromLayer(layerId, input)
assignMaterialPresetToLayer(layerId, presetId)
```

Rules:

- `setMaterialLibrary` is a library load/unload operation, not a project mutation.
- `createMaterialPresetFromLayer` captures `MaterialRecipe` from the target layer, appends a preset, and sets `materialLibraryDirty: true`.
- `createMaterialPresetFromLayer` returns `null` for missing library, missing layer, duplicate id, or invalid metadata.
- Valid preset metadata means non-empty id/materialName/description/revision and exactly one of positive `thicknessMm` or non-empty `title`.
- `assignMaterialPresetToLayer` applies only recipe fields to the target layer.
- `assignMaterialPresetToLayer` preserves layer `id`, `color`, `visible`, and `output`.
- `assignMaterialPresetToLayer` pushes project undo, clears redo, sets project `dirty: true`, and does not set `materialLibraryDirty`.
- `assignMaterialPresetToLayer` returns `false` for missing library, missing preset, missing layer, or identical recipe.

- [ ] **Step 2: Wire store**

Modify `src/ui/state/store.ts`:

```ts
import {
  MATERIAL_LIBRARY_STATE_DEFAULTS,
  materialLibraryActions,
  type MaterialLibraryActions,
  type MaterialLibraryState,
} from './material-library-actions';
```

Extend `AppState` with `MaterialLibraryActions & MaterialLibraryState`.

Add the defaults to `initialState()` and spread `...materialLibraryActions(set)` into `useStore`.

- [ ] **Step 3: Reset tests**

Modify `src/ui/state/test-helpers.ts` to reset:

```ts
materialLibrary: null,
materialLibraryDirty: false,
```

## Task 3: Green and Audit

- [ ] **Step 1: Run focused tests**

```powershell
corepack pnpm exec vitest run src/ui/state/material-library-actions.test.ts src/core/material-library/material-library.test.ts src/io/material-library/material-library-io.test.ts
```

- [ ] **Step 2: Run full verification gates**

```powershell
corepack pnpm test
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm exec prettier --check .
corepack pnpm run build:web
```

- [ ] **Step 3: Browser smoke**

Use the in-app Browser first. If the Browser connector is unavailable in this Windows sandbox, run headless Chrome against the local dev server and verify the LaserForge shell renders.

- [ ] **Step 4: Commit and push**

```powershell
git add docs/superpowers/plans/2026-06-09-material-library-store-actions.md src/ui/state/material-library-actions.ts src/ui/state/material-library-actions.test.ts src/ui/state/store.ts src/ui/state/test-helpers.ts
git commit -m "feat(ui): add material library store actions"
git push
```

## Explicit Deferrals

- No visible Material Library panel yet.
- No hidden browser persistence or localStorage.
- No `.clb` compatibility layer yet.
- No manufacturer profile ingestion.
- No `Link` behavior or automatic cross-library relinking.
