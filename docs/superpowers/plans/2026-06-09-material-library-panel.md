# Material Library Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the native Material Library store actions through a docked Cuts/Layers panel section.

**Architecture:** Add a focused `MaterialLibraryPanel` component under `src/ui/layers`. The panel creates an empty native `.lfml.json` document for the active device, captures presets from a selected layer, and assigns selected presets back to a selected layer; file Load/Save/Merge remains a separate IO workflow slice.

**Tech Stack:** React, Zustand store actions, Vitest DOM tests, LaserForge layer and Material Library modules.

---

## Research Grounding

Official LightBurn Material Library docs define the workflow this panel mirrors:

- The Material Library window is a laser-control quality tool.
- `Create new from layer` saves the active layer settings into a preset.
- Preset identity uses Material Name, either Thickness or a No Thickness Title, and Description.
- `Assign` applies a preset to the active layer, without linking future edits.
- `Link`, Modify Presets, Load/Save/Merge libraries, and multi-device auto-load are separate behaviors and remain deferred.

Reference: https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/

## File Structure

- Create `src/ui/layers/MaterialLibraryPanel.tsx`
  - Renders a compact docked panel inside Cuts/Layers.
  - Creates a blank library using native IO constants and the current device hint.
  - Provides layer and preset selectors.
  - Provides a Create-from-Layer form with Material, Thickness or Title, and Description.
  - Calls store actions; does not do hidden persistence.
- Create `src/ui/layers/MaterialLibraryPanel.test.tsx`
  - Tests empty state, create library, create preset, assign preset, disabled states, and no-link behavior.
- Modify `src/ui/layers/CutsLayersPanel.tsx`
  - Adds `<MaterialLibraryPanel />` after manual layer controls and before the layer list.

## Task 1: Red Tests

- [ ] **Step 1: Write failing tests**

Add `src/ui/layers/MaterialLibraryPanel.test.tsx` with:

```ts
it('creates a blank device-scoped material library from the panel', async () => {});
it('captures a preset from the selected layer form fields', async () => {});
it('assigns a selected preset to the selected target layer', async () => {});
it('does not link assigned presets to later layer edits', async () => {});
it('disables create and assign controls when required inputs are missing', async () => {});
```

- [ ] **Step 2: Verify red**

Run:

```powershell
corepack pnpm exec vitest run src/ui/layers/MaterialLibraryPanel.test.tsx
```

Expected: fail because `MaterialLibraryPanel.tsx` does not exist.

## Task 2: Panel Implementation

- [ ] **Step 1: Create the component**

Implement:

```tsx
export function MaterialLibraryPanel(): JSX.Element
```

Minimum behavior:

- When no library is loaded, render a `New Library` button.
- Clicking `New Library` calls `setMaterialLibrary` with format `laserforge-material-library`, schema version `1`, a device hint, and an empty `entries` array.
- When a library is loaded, show a layer selector, preset selector, Create form, Assign button, and Unload button.
- Create form accepts Material Name, Thickness mm, No Thickness Title, and Description.
- Create only succeeds when exactly one of Thickness or Title is provided.
- Assign button is disabled unless a layer and preset are selected.
- Assign calls `assignMaterialPresetToLayer`.

- [ ] **Step 2: Wire the panel**

Modify `src/ui/layers/CutsLayersPanel.tsx`:

```tsx
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
...
<MaterialLibraryPanel />
```

## Task 3: Green and Audit

- [ ] **Step 1: Run focused tests**

```powershell
corepack pnpm exec vitest run src/ui/layers/MaterialLibraryPanel.test.tsx src/ui/state/material-library-actions.test.ts
```

- [ ] **Step 2: Run full gates**

```powershell
corepack pnpm test
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm exec prettier --check .
corepack pnpm run check:file-size
corepack pnpm run build:web
```

- [ ] **Step 3: Browser smoke**

Use the in-app Browser first, then headless Chrome fallback if the connector fails in the Windows sandbox.

- [ ] **Step 4: Commit and push**

```powershell
git add docs/superpowers/plans/2026-06-09-material-library-panel.md src/ui/layers/MaterialLibraryPanel.tsx src/ui/layers/MaterialLibraryPanel.test.tsx src/ui/layers/CutsLayersPanel.tsx
git commit -m "feat(ui): add material library panel"
git push
```

## Explicit Deferrals

- No file picker Load/Save/Save As/Merge yet.
- No `.clb` compatibility.
- No preset Edit/Update/Duplicate/Delete yet.
- No Link behavior.
- No automatic per-device library reload.
