# Layer Create And Assign Plan

## Research

- LightBurn's Cuts / Layers window is the workflow surface for layer operations, order, settings, output/show toggles, and layer assignment.
- LightBurn documents that the Color Palette changes the layer assigned to selected objects.
- LaserForge already has layer order, modes, and settings, but no manual layer creation or selected-object reassignment workflow.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- https://docs.lightburnsoftware.com/latest/Explainers/LayerModes/

## Current Code Audit

- `scene.ts` has `addLayer`, `updateLayer`, `removeLayer`, and `moveLayer`.
- `store.ts` exposes `setLayerParam` and `moveLayer`, but `setLayerParam` explicitly excludes `id` and `color`.
- `LayerRow` has settings/order controls, but no Assign button.
- `CutsLayersPanel` has no Add Layer control and shows only an import hint when empty.
- Scene objects are layer-bound by color:
  - vectors: `ColoredPath.color`
  - text: `TextObject.color` plus path colors
  - raster: `RasterImage.color`

## Implementation Scope

1. Add pure scene helper `assignObjectToLayer(scene, objectId, color)`.
2. Add store actions:
   - `createManualLayer(color)`
   - `assignSelectionToLayer(layerId)`
3. Add Cuts / Layers UI:
   - color input plus Add Layer button in the panel header.
   - Assign button on each row, disabled when no object is selected.
4. Defer full recolor/merge:
   - changing an existing layer's color rewrites every object using that color and needs collision rules.
   - that is the next slice, not this one.

## TDD

1. Core: assigning a vector object rewrites all path colors.
2. Core: assigning a raster object rewrites `RasterImage.color`.
3. Store: creating a manual layer is undoable and normalizes color.
4. Store: assigning the current selection to a layer rewrites object colors and prunes orphan old layers.
5. UI: the panel can add a layer and assign the selected object to it.

## Verification

```powershell
pnpm test --run src/core/scene/scene.test.ts src/ui/state/store.test.ts src/ui/layers/CutsLayersPanel.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Reassignment must update emitted-output truth, not only UI state.
- No assignment should create a layer-mode mismatch by itself; the user still controls the target layer mode.
- Empty manual layers may exist after creation; orphan auto-layers can be pruned after assignment.
- Full layer recolor/merge is intentionally deferred and must not be half-implemented here.
