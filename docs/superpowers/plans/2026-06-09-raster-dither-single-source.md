# Raster Dither Single-Source Plan

## Research

- LightBurn keeps raster dithering choices in Image Mode, not Trace Image.
- Official LightBurn Image Mode docs list threshold/ordered-style modes,
  Atkinson, Stucki, Jarvis, and Grayscale-style behavior as image engraving
  controls.
- LaserForge already exposes these under Image layer settings and Adjust Image.
  The risk in this slice is not a missing algorithm; it is catalog drift.

Sources:
- https://docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html
- https://docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/

## Current Code Audit

- `src/core/scene/scene-object.ts` defines `DITHER_ALGORITHMS`.
- `src/core/raster/dither.ts` separately defines the same `DitherAlgorithm`
  union.
- `src/ui/layers/LayerImageFields.tsx`,
  `src/ui/layers/CutSettingsImageFields.tsx`, and
  `src/ui/layers/CutSettingsDialog.tsx` still hard-code dither choices or
  validation lists.

## Plan

1. Make `src/core/raster/dither.ts` consume and re-export the scene
   `DitherAlgorithm` type instead of declaring its own list.
2. Render visible image-layer dither choices from `DITHER_ALGORITHMS`.
3. Validate Cut Settings dither values from `DITHER_ALGORITHMS`.
4. Keep labels exhaustive with a typed record so adding a future algorithm fails
   at compile time unless UI labels are added.

## Verification

```powershell
rg -n "export type DitherAlgorithm =" src/core
corepack pnpm test --run src/core/raster/dither.test.ts src/ui/layers/CutsLayersPanel.test.tsx src/ui/layers/CutSettingsDialog.fill-density.test.tsx src/ui/raster/AdjustImageDialog.test.tsx
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
git diff --check
```

## Deferrals

- No new dither algorithms.
- No default dither change.
- No Trace Image changes.
