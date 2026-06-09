# Fill Cross-Hatch Plan

## Research

- LightBurn Fill Mode lists Cross-Hatch under Fill Common Settings.
- Cross-Hatch runs a second engraving pass rotated 90 degrees from the first to
  improve fill coverage.
- LaserForge already generates hatch lines from `hatchAngleDeg` and
  `hatchSpacingMm`, so Cross-Hatch can be represented as one additive layer
  boolean that appends a second hatching set at `hatchAngleDeg + 90`.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/

## Current Code Audit

- `Layer` has `fillBidirectional`, `hatchAngleDeg`, `hatchSpacingMm`, and
  `fillOverscanMm`, but no Cross-Hatch field.
- `memoizedFillHatching` is the narrowest output point for Cross-Hatch because
  it already turns layer settings into hatch polylines and owns hatching cache
  keys.
- `compileJob` also has a per-layer fill cache key; it must include
  Cross-Hatch or the preview/output path can reuse stale hatch geometry.
- `.lf2` loading back-fills additive layer settings through
  `normalizeLayer`, so old projects can default Cross-Hatch to false without a
  schema bump.
- `LayerRow.tsx` is at the line-count limit; this slice should expose
  Cross-Hatch in Cut Settings, not the inline row.

## Implementation Scope

1. Add `fillCrossHatch: boolean` to `Layer`, defaults, deserialization, shape
   validation, and layer settings clipboard.
2. Include `fillCrossHatch` in fill hatching cache keys.
3. When enabled, append a second hatch set using `hatchAngleDeg + 90`.
4. Add a Cut Settings checkbox for Fill Cross-Hatch.

## Deliberate Deferrals

- Inline row Cross-Hatch control.
- Angle increment between passes.
- Fill grouping.
- Material Library presets.
- Hardware burn validation.

## TDD

1. Layer defaults include `fillCrossHatch: false`.
2. Old project layers are back-filled with `fillCrossHatch: false`.
3. Layer settings clipboard copies/pastes `fillCrossHatch`.
4. `compileJob` emits both horizontal and vertical fill segments when
   Cross-Hatch is enabled.
5. Fill hatching cache invalidates when `fillCrossHatch` changes.
6. Cut Settings saves the Cross-Hatch checkbox.

## Verification

```powershell
pnpm test --run src/core/scene/layer.test.ts src/io/project/project.test.ts src/ui/state/layer-actions.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job-fill-cache.test.ts src/ui/layers/CutSettingsDialog.fill-density.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Default remains false so old jobs do not silently double their fill burn.
- Both fill cache layers include the boolean.
- UI save path only changes Fill settings; Image mode is unaffected.
