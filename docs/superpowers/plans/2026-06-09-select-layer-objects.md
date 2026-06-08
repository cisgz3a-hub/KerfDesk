# Select Layer Objects Plan

## Research

- LightBurn's Cuts / Layers window is the layer operation surface.
- LightBurn documents "Select All Objects on a Layer" from the layer context menu and also by Shift-clicking a layer.
- LightBurn layers are color/process assignments. Selecting layer contents should not mutate geometry, settings, output, undo history, or dirty state.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ColorPalette/

## Current Code Audit

- `useStore` already models one primary selection plus `additionalSelectedIds`.
- `selectAllObjects()` selects every scene object, but no action selects by layer.
- Scene objects bind to layers by color:
  - vector-like objects use `ColoredPath.color`.
  - raster images use `RasterImage.color`.
- `LayerRow` now has Assign and Edit controls, but no Select Layer control.

## Implementation Scope

1. Add store action `selectObjectsOnLayer(layerId)`.
2. Match by target layer color, not row index.
3. Select all objects that use that color:
   - any vector path with the color.
   - raster object with the color.
4. Add a layer-row button with aria label `Select all objects on #rrggbb`.

## Deliberate Deferrals

- Layer context menus.
- Shift-click row gesture.
- Delete layer and copy/paste settings.
- Flash/highlight layer contents.

## TDD

1. Store: selects every object that uses the layer color and clears stale selection.
2. Store: selects raster-image objects by raster color.
3. Store: missing/empty layer selection clears selection and does not dirty/undo.
4. UI: clicking the layer-row Select button updates the real store selection.

## Verification

```powershell
pnpm test --run src/ui/state/store.test.ts src/ui/layers/CutsLayersPanel.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Selection must be a UI state transition only.
- It must not push undo or mark the project dirty.
- It must use the layer color and current scene object data, so emitted output truth remains unchanged.
