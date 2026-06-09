# Delete Layer Objects Plan

## Research

- LightBurn's Cuts / Layers window has a Delete button that deletes a layer and
  all objects assigned to it in the workspace.
- LightBurn treats layer membership as color/process assignment, so deletion is
  destructive artwork removal, not just removal of a settings row.
- This is a Cuts / Layers workflow operation only. It must not mutate output
  settings for unrelated layers or change the job emitter.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- https://docs.lightburnsoftware.com/UI/CutsAndLayers.html

## Current Code Audit

- `removeLayer(scene, layerId)` only removes the layer row. It does not remove
  assigned objects and therefore is not LightBurn's Delete Layer behavior.
- Layer membership in LaserForge is color-based:
  - vector-like objects use `ColoredPath.color`.
  - raster images use `RasterImage.color`.
- `removeSceneObject(id)` already clears stale selection, pushes undo, marks
  dirty, and prunes orphan layers for one object.
- `layer-actions.ts` already owns layer workflow actions. Delete Layer belongs
  there, not in generic scene actions.

## Implementation Scope

1. Add a store action `deleteLayerAndObjects(layerId)`.
2. Resolve the layer color from the stable layer id.
3. Remove content assigned to that color:
   - vector-like objects lose only paths using that color.
   - vector-like objects with no paths left are removed.
   - text objects are removed when their text color is deleted.
   - raster images whose `color` matches that color are removed.
4. Remove the deleted layer row and prune now-orphaned layers.
5. Clear primary/additional selection entries for removed object ids.
6. Push one undo frame and mark dirty only when something changed.
7. Add a row button with aria label `Delete layer ${color}`.

## Deliberate Deferrals

- Confirmation modal.
- Context menu placement.
- Shift-click delete shortcut.
- Delete only layer settings while preserving artwork by reassignment.

## TDD

1. Store: deleting a vector layer removes matching paths, removes emptied
   objects, and keeps unrelated paths/artwork.
2. Store: deleting an image layer removes raster objects by layer color.
3. Store: deleting a layer clears stale multi-selection, pushes one undo frame,
   and undo restores the layer plus artwork.
4. UI: clicking the layer-row Delete button performs the real store action.

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

- Delete Layer is intentionally destructive and must be undoable.
- It must not alter unrelated layers, unrelated paths/artwork, or emitted-output
  code.
- It must clear deleted object ids from selection so ghost selection cannot
  affect later operations.
