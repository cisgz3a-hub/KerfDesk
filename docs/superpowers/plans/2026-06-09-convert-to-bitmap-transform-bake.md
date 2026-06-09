# Convert to Bitmap Transform Bake Plan

## Research

- LightBurn documents Convert to Bitmap as converting selected vector graphics into bitmap images.
- The converted object is set to Image Mode and engraved as a dithered bitmap.
- The Convert to Bitmap dialog previews the bitmap that will be created, and OK creates that bitmap while deleting the vector graphic.

Source:
- https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/

## Current Code Audit

- `assembleBitmap` rasterizes source-local polylines with `rasterizeVectorToLuma`.
- It then copies `o.transform` directly onto the returned `RasterImage`.
- `runPreflight` rejects non-trace-source raster images with rotation or mirror because raster output is axis-aligned.
- Result: a rotated/mirrored vector can convert into a bitmap that previews on the workspace but cannot start or save because output rejects the raster transform.

## Implementation

1. Add red tests proving converted bitmaps must bake the source transform into the bitmap target:
   - `assembleBitmap` returns `IDENTITY_TRANSFORM`.
   - `assembleBitmap` uses the source transformed AABB as raster bounds.
   - the converted raster no longer triggers `unsupported-raster-transform` in preflight.
2. Add a helper in bitmap assembly that:
   - transforms vector polylines through `applyTransform`.
   - computes the transformed AABB using `transformedBBox`.
   - estimates conversion size from that transformed target.
3. Rasterize the transformed polylines into the transformed AABB.
4. Return a `RasterImage` with baked bounds and identity transform.

## Verification

```powershell
pnpm test --run src/ui/raster/vector-to-bitmap.test.ts src/core/preflight/preflight.test.ts src/ui/state/convert-to-bitmap.test.ts src/ui/raster/vector-to-bitmap-worker.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Do not merely clear rotation/mirror; the visual geometry must be baked into pixels/bounds.
- Main-thread and worker paths must share the same assembly helper.
- Budget checks must estimate the baked transformed bounds, not the old local bounds.
- Converted raster output must be legal for the existing axis-aligned image engrave path.
