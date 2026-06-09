# Material Library File Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native LaserForge Material Library load and save actions to the Material Library panel.

**Architecture:** Keep material libraries separate from `.lf2` project save state, matching LightBurn's separate Manage Library workflow. Add a focused UI/app handler module for platform picker integration, a store action to clear library dirty state after successful save, then wire panel buttons through `usePlatform()` and `useToastStore()`.

**Tech Stack:** React, Zustand, Vitest, File System Access API through `PlatformAdapter`, LaserForge `.lfml.json` serializer/deserializer.

---

## Research Basis

- Official LightBurn Material Library docs describe `Create New`, `Load Library`, `Save Library`, `Save Library As`, `Merge Library With`, `Select Library`, `Rename`, and `Unload` as library management actions.
- LightBurn stores material presets independently from the current design file and applies presets through Assign/Link workflows. LaserForge should therefore keep `.lfml.json` dirty state separate from `.lf2` dirty state.
- Current LaserForge IO already has a validated native material-library document format in `src/io/material-library/material-library-io.ts`; this slice wires that format into the UI rather than inventing a second format or importing `.clb`.

## File Structure

- Create `src/ui/app/material-library-file-actions.ts`: pure app handlers for opening and saving material libraries through `PlatformAdapter`.
- Create `src/ui/app/material-library-file-actions.test.ts`: red/green tests for picker cancellation, invalid files, schema-too-new, successful open, successful save, and write failure.
- Modify `src/ui/state/material-library-actions.ts`: add `markMaterialLibrarySaved()`.
- Modify `src/ui/state/material-library-actions.test.ts`: prove `markMaterialLibrarySaved()` clears library dirty without dirtying the project or undo stack.
- Modify `src/ui/state/store.ts`: add the new action to `AppState`.
- Modify `src/ui/layers/MaterialLibraryPanel.tsx`: add Load and Save buttons; call the new handlers.
- Modify `src/ui/layers/MaterialLibraryPanel.test.tsx`: wrap in `PlatformProvider`, assert Load/Save buttons render, and smoke click mocked open/save paths.

## Tasks

### Task 1: Store Dirty Reset

**Files:**
- Modify: `src/ui/state/material-library-actions.ts`
- Modify: `src/ui/state/material-library-actions.test.ts`
- Modify: `src/ui/state/store.ts`

- [ ] **Step 1: Write the failing test**

Add a test named `markMaterialLibrarySaved clears only the library dirty flag`.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test src/ui/state/material-library-actions.test.ts`

Expected: FAIL because `markMaterialLibrarySaved` does not exist.

- [ ] **Step 3: Write minimal implementation**

Add `markMaterialLibrarySaved` to `MaterialLibraryActions` and `materialLibraryActions(set)`, returning `{ materialLibraryDirty: false }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test src/ui/state/material-library-actions.test.ts`

Expected: PASS.

### Task 2: Pure File Action Handlers

**Files:**
- Create: `src/ui/app/material-library-file-actions.ts`
- Create: `src/ui/app/material-library-file-actions.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- successful open parses `.lfml.json`, calls `setMaterialLibrary`, and shows success toast;
- cancelled open is silent;
- invalid open shows an error toast and does not load;
- too-new schema uses an alert;
- successful save writes serialized `.lfml.json`, calls `markMaterialLibrarySaved`, and shows success toast;
- cancelled save is silent;
- save write failure shows an error toast and does not mark saved.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm test src/ui/app/material-library-file-actions.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement `handleOpenMaterialLibrary(ctx)` and `handleSaveMaterialLibrary(ctx)` with `PlatformAdapter`, `deserializeMaterialLibrary`, `serializeMaterialLibrary`, and existing toast conventions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm test src/ui/app/material-library-file-actions.test.ts`

Expected: PASS.

### Task 3: Panel Integration

**Files:**
- Modify: `src/ui/layers/MaterialLibraryPanel.tsx`
- Modify: `src/ui/layers/MaterialLibraryPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests for:
- empty state renders `New Library` and `Load Library`;
- loaded state renders `Load Library`, `Save Library`, and `Unload`;
- clicking `Load Library` with a mocked valid file loads the library into store;
- clicking `Save Library` writes through mocked save target and clears `materialLibraryDirty`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm test src/ui/layers/MaterialLibraryPanel.test.tsx`

Expected: FAIL because Load/Save buttons do not exist.

- [ ] **Step 3: Wire panel to handlers**

Use `usePlatform()` and `useToastStore()` in the panel and pass store actions to the handler functions. Keep the loaded-state controls compact and do not add Merge/Link/Rename in this slice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm test src/ui/layers/MaterialLibraryPanel.test.tsx`

Expected: PASS.

### Task 4: Audit, Gates, Browser Smoke, Commit

**Files:**
- All changed files from Tasks 1-3.

- [ ] **Step 1: Run focused test bundle**

Run:
- `corepack pnpm test src/ui/state/material-library-actions.test.ts src/ui/app/material-library-file-actions.test.ts src/ui/layers/MaterialLibraryPanel.test.tsx`

- [ ] **Step 2: Run quality gates**

Run:
- `corepack pnpm run typecheck`
- `corepack pnpm run lint`
- `corepack pnpm exec prettier --check .`
- `corepack pnpm run check:file-size`
- `corepack pnpm test`
- `corepack pnpm run build:web`

- [ ] **Step 3: Browser smoke**

Open `http://127.0.0.1:5176/?material-library-file-smoke=<timestamp>` and verify the app shell renders with `Material Library`, `New Library`, and `Load Library`.

- [ ] **Step 4: Commit and push**

Commit message: `feat(ui): add material library file actions`

Push to `origin/wip/checkpoint-2026-06-03`.
