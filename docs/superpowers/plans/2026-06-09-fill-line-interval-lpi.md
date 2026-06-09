# Fill Line Interval / LPI Cut Settings Plan

## Research

- LightBurn Fill Mode uses Line Interval as the spacing between engraved rows,
  and exposes Lines Per Inch as the same density in another unit.
- LaserForge already stores this value as `Layer.hatchSpacingMm`, so this slice
  is a workflow/terminology improvement, not a planner rewrite.
- LightBurn Fill Mode also has Common and Advanced groups. This slice only
  adds the density controls that map directly to existing LaserForge output
  behavior.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/
- https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/

## Current Code Audit

- `CutSettingsDialog` shows Fill fields when `mode === 'fill'`.
- The dialog currently labels row spacing as `Hatch spacing`, which is accurate
  internally but not how LightBurn presents the operator workflow.
- `Layer.hatchSpacingMm` already feeds fill planning, so saving a Line Interval
  edit should write the same field.
- There is no Fill Lines Per Inch control today.

## Implementation Scope

1. In `CutSettingsDialog`, replace the fill dialog's `Hatch spacing` control
   with synchronized `Line Interval` and `Lines / Inch` controls.
2. Keep saving through `hatchSpacingMm`.
3. Keep `Scan angle`, `Overscan`, and `Bidirectional` behavior unchanged.

## Deliberate Deferrals

- Full Common / Advanced tab architecture.
- Cross-hatch.
- Z Offset / Z Step.
- Fill grouping.
- Material presets or Material Library integration.

## TDD

1. Fill Cut Settings shows Line Interval and Lines / Inch controls.
2. Submitting a changed Line Interval writes `hatchSpacingMm`.
3. Submitting a changed Lines / Inch value writes the reciprocal
   `hatchSpacingMm`.

## Verification

```powershell
pnpm test --run src/ui/layers/CutSettingsDialog.fill-density.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Existing Fill output field remains the same model field: `hatchSpacingMm`.
- Invalid density values clamp to the existing 0.05..10 mm interval range.
- Image mode DPI/line interval controls are not changed by this slice.
