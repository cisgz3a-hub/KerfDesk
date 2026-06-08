# Copy Paste Layer Settings Plan

## Research

- LightBurn's Cuts / Layers window supports copying one layer's settings and
  pasting them onto another layer.
- LightBurn layers are color/process assignments, so copied settings must not
  change the destination layer's color or identity.
- Copy is a UI clipboard operation; Paste is the undoable project mutation.

Source:
- https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/

## Current Code Audit

- `Layer` is a flat settings object with identity fields `id` and `color`, then
  cut/image/fill settings.
- `setLayerParam(layerId, patch)` can patch settings but does not provide a
  LightBurn-style layer clipboard.
- `layer-actions.ts` already owns layer workflow operations and has access to
  `pushUndo`.
- Store state currently has no layer-settings clipboard.

## Implementation Scope

1. Add store state `copiedLayerSettings: Omit<Layer, 'id' | 'color'> | null`.
2. Add `copyLayerSettings(layerId)`.
3. Add `pasteLayerSettings(layerId)`.
4. Copy only settings; never copy `id` or `color`.
5. Copy must not mark dirty or push undo.
6. Paste must push one undo frame, mark dirty, and clear redo only when it
   changes the destination layer.
7. Add row buttons with aria labels `Copy settings from ${color}` and
   `Paste settings to ${color}`.

## Deliberate Deferrals

- Cross-project clipboard persistence.
- Material Library integration.
- Copy/Paste via context menu or keyboard shortcuts.
- Toasts for empty clipboard.

## TDD

1. Store: copy captures settings without dirty/undo mutation.
2. Store: paste applies settings to the target layer while preserving target id
   and color.
3. Store: paste with no clipboard is a no-op.
4. UI: clicking Copy on one layer and Paste on another updates the target layer.

## Verification

```powershell
pnpm test --run src/ui/state/layer-actions.test.ts src/ui/layers/CutsLayersPanel.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Destination artwork remains on its original layer color.
- Copy does not make the project dirty.
- Paste is undoable and does not run if the destination already has identical
  settings.
