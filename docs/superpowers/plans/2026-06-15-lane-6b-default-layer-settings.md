# Lane 6B Default Layer Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LightBurn-style default layer settings controls to the Cut Settings dialog without adding inactive cut features or changing emitted G-code semantics.

**Architecture:** Store app-level default layer settings separately from `.lf2` project data, keyed by device profile and layer color. The Cut Settings dialog gets three actions: Make Default, Reset to Default, and Make Default for All. New layers can use the saved default for their color; existing layers only change when the operator explicitly resets or applies defaults.

**Tech Stack:** React, Zustand, Vitest, localStorage-compatible persistence, existing `Layer` model and `cut-settings-draft` helpers.

---

## Research Baseline

- LightBurn's Cut Settings Editor exposes Default Layer Settings as Make Default, Reset to Default, and Make Default for All.
- LightBurn saves defaults separately for each device profile and palette color.
- LightBurn distinguishes layer defaults from Material Library presets; defaults are fast per-color starting points, while libraries are richer reusable material recipes.
- LaserForge already has `LAYER_DEFAULTS`, `createLayer`, Cut Settings OK/Cancel staging, Material Library persistence, and copy/paste layer settings. This lane should reuse those patterns and avoid `.lf2` schema changes.

## Scope

In scope:

- App-level persisted layer defaults.
- Device-profile-keyed default buckets using the current profile name as the stable first slice key.
- Per-color default: Make Default.
- Global default for all colors in the current device bucket: Make Default for All.
- Explicit Reset to Default from the dialog.
- New manually-created/import-created layers use saved defaults when available.
- Tests proving defaults do not mutate current layers until the operator chooses Reset.

Out of scope:

- Material Library `.clb` compatibility.
- Offset Fill, kerf, tabs, bridges, air assist, Z, lead-in/out, perforation, sub-layers.
- `.lf2` schema changes.
- Emitted G-code, planner, streamer, serial, bounds, or GRBL behavior changes.

## Files

- Create: `src/ui/layers/layer-default-settings.ts`
  - Pure capture/merge helpers and persistence envelope validation.
- Create: `src/ui/layers/layer-default-settings.test.ts`
  - Pure helper tests.
- Modify: `src/ui/state/store.ts`
  - Add `layerDefaults` state and actions.
- Modify: `src/ui/state/layer-actions.ts`
  - Apply defaults when creating a manual layer.
- Modify: `src/ui/state/scene-mutations.ts`
  - Add an optional layer factory/default patch hook for import-created layers, or keep this lane to manual layers only if import creation cannot be kept small.
- Modify: `src/ui/layers/CutSettingsDialog.tsx`
  - Add optional default actions props and render controls through a child component.
- Create: `src/ui/layers/CutSettingsDefaultActions.tsx`
  - Three buttons, tooltips, and conservative wording.
- Test: `src/ui/layers/CutSettingsDialog.fill-density.test.tsx`
  - Dialog shows default buttons and preserves OK/Cancel staging.
- Test: `src/ui/state/layer-actions.test.ts`
  - Defaults make/reset/new-layer behavior.

---

### Task 1: Pure Default Capture Helpers

**Files:**
- Create: `src/ui/layers/layer-default-settings.ts`
- Create: `src/ui/layers/layer-default-settings.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import {
  captureLayerDefaultSettings,
  applyLayerDefaultSettings,
  layerDefaultsStorageKey,
} from './layer-default-settings';

describe('layer default settings helpers', () => {
  it('captures backed settings without id or color', () => {
    const layer = { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), power: 44 };
    const captured = captureLayerDefaultSettings(layer);
    expect(captured).toMatchObject({ mode: 'fill', power: 44 });
    expect(captured).not.toHaveProperty('id');
    expect(captured).not.toHaveProperty('color');
  });

  it('applies defaults while preserving layer identity', () => {
    const layer = createLayer({ id: '#00ff00', color: '#00ff00' });
    const applied = applyLayerDefaultSettings(layer, { mode: 'image', power: 12, speed: 987 });
    expect(applied).toMatchObject({ id: '#00ff00', color: '#00ff00', mode: 'image', power: 12, speed: 987 });
  });

  it('keys defaults by device profile name', () => {
    expect(layerDefaultsStorageKey('GRBL4040')).toBe('laserforge.layer-defaults.v1.GRBL4040');
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm vitest run src/ui/layers/layer-default-settings.test.ts
```

Expected: fail because `layer-default-settings.ts` does not exist.

- [ ] **Step 3: Implement minimal helper**

Create `src/ui/layers/layer-default-settings.ts`:

```ts
import type { Layer } from '../../core/scene';

export type LayerDefaultSettings = Partial<Omit<Layer, 'id' | 'color'>>;

export function captureLayerDefaultSettings(layer: Layer): LayerDefaultSettings {
  const { id: _id, color: _color, ...settings } = layer;
  return settings;
}

export function applyLayerDefaultSettings(layer: Layer, settings: LayerDefaultSettings): Layer {
  return { ...layer, ...settings, id: layer.id, color: layer.color };
}

export function layerDefaultsStorageKey(deviceProfileName: string): string {
  return `laserforge.layer-defaults.v1.${deviceProfileName.trim() || 'default'}`;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm vitest run src/ui/layers/layer-default-settings.test.ts
```

Expected: pass.

---

### Task 2: Store Actions for Defaults

**Files:**
- Modify: `src/ui/state/store.ts`
- Modify: `src/ui/state/layer-actions.ts`
- Test: `src/ui/state/layer-actions.test.ts`

- [ ] **Step 1: Write failing store tests**

Append tests:

```ts
it('makeLayerDefault remembers current settings without mutating the layer', () => {
  useStore.getState().createManualLayer('#ff0000');
  useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22, speed: 3333 });
  useStore.setState({ dirty: false, undoStack: [] });

  useStore.getState().makeLayerDefault('#ff0000');

  expect(useStore.getState().layerDefaults.byColor['#ff0000']).toMatchObject({
    mode: 'fill',
    power: 22,
    speed: 3333,
  });
  expect(useStore.getState().dirty).toBe(false);
  expect(useStore.getState().undoStack).toHaveLength(0);
});

it('resetLayerToDefault applies the saved color default through one undoable patch', () => {
  useStore.getState().createManualLayer('#ff0000');
  useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 22 });
  useStore.getState().makeLayerDefault('#ff0000');
  useStore.getState().setLayerParam('#ff0000', { mode: 'line', power: 80 });
  useStore.setState({ dirty: false, undoStack: [] });

  useStore.getState().resetLayerToDefault('#ff0000');

  expect(useStore.getState().project.scene.layers[0]).toMatchObject({ mode: 'fill', power: 22 });
  expect(useStore.getState().dirty).toBe(true);
  expect(useStore.getState().undoStack).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm vitest run src/ui/state/layer-actions.test.ts
```

Expected: fail because `layerDefaults`, `makeLayerDefault`, and `resetLayerToDefault` are missing.

- [ ] **Step 3: Implement minimal state**

Add state shape:

```ts
export type LayerDefaultsState = {
  readonly byColor: Record<string, LayerDefaultSettings>;
  readonly allColors: LayerDefaultSettings | null;
};

export const DEFAULT_LAYER_DEFAULTS_STATE: LayerDefaultsState = {
  byColor: {},
  allColors: null,
};
```

Add actions:

```ts
readonly layerDefaults: LayerDefaultsState;
readonly makeLayerDefault: (layerId: string) => void;
readonly makeLayerDefaultForAll: (layerId: string) => void;
readonly resetLayerToDefault: (layerId: string) => void;
```

Implement actions in the layer slice, using `captureLayerDefaultSettings`, `applyLayerDefaultSettings`, `updateLayer`, and `pushUndo`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm vitest run src/ui/state/layer-actions.test.ts
```

Expected: pass.

---

### Task 3: Cut Settings Dialog Default Buttons

**Files:**
- Create: `src/ui/layers/CutSettingsDefaultActions.tsx`
- Modify: `src/ui/layers/CutSettingsDialog.tsx`
- Modify: `src/ui/layers/CutSettingsDialog.fill-density.test.tsx`

- [ ] **Step 1: Write failing dialog test**

Add:

```tsx
it('exposes default layer settings actions without applying them through Cancel', async () => {
  const layer = fillLayer({ power: 44 });
  const onCancel = vi.fn();
  const onApply = vi.fn();
  const onMakeDefault = vi.fn();
  const onMakeDefaultForAll = vi.fn();
  const onResetToDefault = vi.fn();
  render(
    <CutSettingsDialog
      layer={layer}
      onCancel={onCancel}
      onApply={onApply}
      onMakeDefault={onMakeDefault}
      onMakeDefaultForAll={onMakeDefaultForAll}
      onResetToDefault={onResetToDefault}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Make Default' }));
  expect(onMakeDefault).toHaveBeenCalledTimes(1);
  expect(onApply).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm vitest run src/ui/layers/CutSettingsDialog.fill-density.test.tsx
```

Expected: fail because the props/buttons are missing.

- [ ] **Step 3: Implement default action component**

Create `CutSettingsDefaultActions.tsx` with buttons:

```tsx
import { Button } from '../kit';

export function CutSettingsDefaultActions(props: {
  readonly onMakeDefault: () => void;
  readonly onMakeDefaultForAll: () => void;
  readonly onResetToDefault: () => void;
}): JSX.Element {
  return (
    <section className="lf-dialog-section" aria-label="Default layer settings">
      <Button type="button" onClick={props.onMakeDefault} title="Remember this layer's settings as the default for this color.">
        Make Default
      </Button>
      <Button type="button" onClick={props.onResetToDefault} title="Reset this layer to the saved default settings.">
        Reset to Default
      </Button>
      <Button type="button" onClick={props.onMakeDefaultForAll} title="Use this layer's settings as the default for all layer colors.">
        Make Default for All
      </Button>
    </section>
  );
}
```

Wire optional props in `CutSettingsDialog`; render the section only when all handlers are provided.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm vitest run src/ui/layers/CutSettingsDialog.fill-density.test.tsx
```

Expected: pass.

---

### Task 4: Panel Wiring and New Layer Defaults

**Files:**
- Modify: `src/ui/layers/CutsLayersPanel.tsx`
- Modify: `src/ui/state/layer-actions.ts`
- Test: `src/ui/layers/CutsLayersPanel.test.tsx`
- Test: `src/ui/state/layer-actions.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add a panel test that opens Cut Settings and clicks Make Default. Add a store test that a later manual layer of the same color receives the saved default.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm vitest run src/ui/layers/CutsLayersPanel.test.tsx src/ui/state/layer-actions.test.ts
```

Expected: fail until the panel passes handlers into the dialog and manual-layer creation applies defaults.

- [ ] **Step 3: Implement minimal wiring**

In `CutsLayersPanel`, pass:

```tsx
onMakeDefault={() => makeLayerDefault(layer.id)}
onMakeDefaultForAll={() => makeLayerDefaultForAll(layer.id)}
onResetToDefault={() => resetLayerToDefault(layer.id)}
```

In `createManualLayer`, apply `layerDefaults.byColor[color] ?? layerDefaults.allColors` before adding the layer.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm vitest run src/ui/layers/CutsLayersPanel.test.tsx src/ui/state/layer-actions.test.ts
```

Expected: pass.

---

### Task 5: Persistence

**Files:**
- Modify: `src/ui/layers/layer-default-settings.ts`
- Create: `src/ui/layers/layer-default-settings.persistence.test.ts`
- Modify: app bootstrap/load path only after locating the current localStorage restoration pattern.

- [ ] **Step 1: Write failing persistence tests**

Use a storage-like object and validate that invalid JSON clears or ignores the slot. The helper must return `null` instead of throwing.

- [ ] **Step 2: Verify RED**

Run:

```bash
corepack pnpm vitest run src/ui/layers/layer-default-settings.persistence.test.ts
```

Expected: fail because persistence helpers are missing.

- [ ] **Step 3: Implement minimal persistence**

Mirror `material-library-persistence.ts`: `persistLayerDefaults(storage, deviceProfileName, state)` and `restoreLayerDefaults(storage, deviceProfileName)`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
corepack pnpm vitest run src/ui/layers/layer-default-settings.persistence.test.ts
```

Expected: pass.

---

## Audit and Gates

- [ ] Run focused tests:

```bash
corepack pnpm vitest run src/ui/layers/layer-default-settings.test.ts src/ui/layers/layer-default-settings.persistence.test.ts src/ui/state/layer-actions.test.ts src/ui/layers/CutSettingsDialog.fill-density.test.tsx src/ui/layers/CutsLayersPanel.test.tsx
```

- [ ] Run full gates:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
corepack pnpm check:file-size
```

- [ ] Browser smoke:
  - Open local app.
  - Create a layer.
  - Open Cut Settings.
  - Change power/speed.
  - Click Make Default.
  - Cancel and confirm current layer is not unexpectedly changed by default storage.
  - Create/reset a layer and verify defaults apply only through the intended workflow.

## Plan Audit

This lane matches LightBurn's default-layer workflow without pretending LaserForge has full LightBurn cut settings parity. It keeps defaults as app-level operator preference, not project data, which avoids `.lf2` churn. It does not touch output, planner, serial, or machine safety behavior. The main risk is unclear device identity because `DeviceProfile` currently has a `name` but no stable id; this plan uses profile name for the first slice and should upgrade to a stable id only if the Device Profile system grows one.
