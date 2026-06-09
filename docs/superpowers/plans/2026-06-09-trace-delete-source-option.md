# Trace Delete Image After Trace Plan

## Research

- LightBurn Trace Image includes `Delete Image After trace`. When enabled, pressing OK removes the original image after creating the trace vectors.
- LaserForge currently always keeps the source bitmap and tags it `trace-source`, matching the default LightBurn workflow where the original image remains behind the vector trace.
- Karpathy rule for this slice: add the missing workflow branch at the scene mutation seam, keep it one undoable action, and do not change trace geometry or output.

Primary reference:

- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/

## Current Code Audit

- `src/ui/state/scene-mutations.ts` owns `applyTraceToExisting`, which overlays the trace onto the source raster, tags the source as `trace-source`, adds the trace, and selects the trace.
- `src/ui/state/import-actions.ts` exposes `traceExistingImage(sourceId, traced)` as the store action.
- `src/ui/trace/ImportImageDialog.tsx` calls that action after source revalidation and currently always says `source kept`.
- `pruneOrphanLayers` already exists and can remove an orphaned image layer if the source raster is deleted.

## Implementation

1. Add a typed trace-commit option object with `deleteSourceAfterTrace`.
2. Update `applyTraceToExisting` so the default keeps/tag the source exactly as today, while `deleteSourceAfterTrace: true` removes the source raster before adding the trace.
3. Prune orphan layers after the delete-source branch so a now-empty image layer does not linger.
4. Thread the option through `imageImportActions`, `useStore`, and `ImportImageDialog.commit`.
5. Add a checkbox labeled `Delete Image After trace`, default off.
6. Update toast copy to distinguish `source kept` vs `source deleted`.

## TDD

1. Add failing scene mutation tests for default keep behavior and delete-source behavior.
2. Add failing dialog commit tests proving the checkbox option is passed and toast copy changes.
3. Add failing workflow test proving the dialog exposes the checkbox.

## Verification

Focused:

```powershell
pnpm test --run src/ui/state/scene-mutations.test.ts src/ui/trace/ImportImageDialog.test.ts src/ui/trace/trace-pipeline.integration.test.ts
```

Gate:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Confirm trace geometry and `traceImageWithFallback` are unchanged.
- Confirm the default branch keeps source behavior byte-for-byte at the scene level except for typed option plumbing.
- Confirm delete-source removes only the selected source raster, not unrelated rasters.
- Confirm undo stack gets exactly one previous-project entry.
- Confirm remaining LightBurn trace gaps stay visible: Boundary, Trace Transparency, and Sketch Trace.
