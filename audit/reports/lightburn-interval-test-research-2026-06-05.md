# LightBurn Parity Research - Interval Test

Date: 2026-06-05
Repo: LaserForge-2.0
Mode: research/audit only; no production code changed.

## Research Program Status

1. Material Test - researched in `audit/reports/lightburn-material-test-research-2026-06-05.md`.
2. Interval Test - researched in this report.
3. Material Library - next.
4. Advanced Cut Settings Editor.
5. Optimization Settings.
6. Richer Trace Controls.
7. Vector Editing Tools.
8. Device / Console Workflow.

## Method

Five read-only agents were dispatched against Interval Test:

- LightBurn workflow and official-doc behavior.
- LaserForge architecture fit.
- G-code/output correctness.
- UI/operator workflow.
- Verification and hardware proof.

Local cross-checks were run against:

- `LIGHTBURN-STUDY.md`
- `PROJECT.md`
- `CLAUDE.md`
- `src/core/scene/layer.ts`
- `src/core/job/fill-hatching.ts`
- `src/core/job/compile-job.ts`
- `src/core/raster/luma-resample.ts`
- `src/core/raster/raster-budget.ts`
- `src/core/raster/emit-raster.ts`
- `src/core/preflight/pre-emit.ts`
- `src/ui/layers/LayerRow.tsx`
- `src/ui/layers/LayerImageFields.tsx`
- `src/io/gcode/prepare-output.ts`
- `src/io/gcode/emit-gcode.ts`
- `src/ui/laser/JobControls.tsx`
- `src/ui/laser/start-job-readiness.ts`

Official LightBurn references used:

- LightBurn Interval Test: https://docs.lightburnsoftware.com/latest/Reference/IntervalTest/
- LightBurn Image Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- LightBurn Fill Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/
- LightBurn Laser Tools menu: https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/

## What LightBurn Interval Test Does

LightBurn Interval Test calibrates Line Interval for a specific machine,
material, focus, and speed/power recipe.

Verified behavior:

- Opened from Laser Tools -> Interval Test.
- Generates a row of sample squares.
- Each square uses a different Line Interval and is labeled with that interval.
- Controls include Speed, Power, Steps, Min Interval, Max Interval, Size, and
  fill type.
- Fill type is Simple Fill or Dithered Image.
- Workflow controls include Preview, Frame, Save, Start, OK, and Cancel.
- The user reads the burned samples and chooses the interval where scan lines
  just touch without overlapping or leaving gaps.
- The chosen value is entered back into the layer's Line Interval / DPI setting
  and eventually saved in the material workflow.

The local study records the same target behavior in `LIGHTBURN-STUDY.md` section
7.1 and marks Interval Test as a current LaserForge gap.

## Current Truth In LaserForge

LaserForge does not have an Interval Test generator.

Current spacing model:

- Fill mode uses `Layer.hatchSpacingMm`.
- Image/raster mode uses `Layer.linesPerMm`.
- DPI is not the stored model; it is derived from interval.

Important conversion:

```text
linesPerMm = 1 / lineIntervalMm
DPI = 25.4 / lineIntervalMm
lineIntervalMm = 1 / linesPerMm
```

This conversion should become a shared core helper, not UI-local math.

## Development Recommendation

### Do Not Emit Direct G-code

Interval Test must use the same pipeline as normal output:

- generated scene/job,
- `prepareOutput`,
- preview,
- Frame,
- Start readiness,
- `emitGcode`,
- preflight.

Direct G-code generation is rejected because it would bypass the exact safety and
preview parity work already in the app.

### Shared Calibration Foundation

Interval Test should share a foundation with Material Test:

- axis value generation,
- cell/grid layout,
- label generation,
- generated project/job metadata,
- low-risk ordering,
- Preview/Frame/Start integration,
- hardware verification checklist.

Do not couple Interval Test to Material Library yet. Persistence is a separate
workflow.

### Generated Job Shape

Recommended MVP:

- Generate one row of labeled samples.
- Generate one output layer per interval sample.
- Keep power, speed, passes, and material fixed.
- Vary only interval:
  - Simple Fill: `hatchSpacingMm = intervalMm`.
  - Dithered Image: `linesPerMm = 1 / intervalMm`.
- Use a dedicated low-power/high-speed label layer.
- Keep labels separate from test sample layers.

Because `compileJob` applies settings per layer/color, one layer per sample is
the honest current-architecture approach.

## UI Workflow

Best current placement:

- Add `Interval Test...` in the Laser panel under a small Calibration/Laser Tools
  row near Frame and Start.
- Future menu parity: Laser Tools -> Interval Test.

Dialog fields:

- Speed in mm/min.
- Power in percent.
- Steps.
- Min interval in mm.
- Max interval in mm.
- Sample size in mm.
- Pattern: Simple Fill or Dithered Image.
- Derived readouts:
  - interval step,
  - footprint,
  - lines/mm,
  - DPI.

Flow:

1. Operator sets Start From and Job Origin in the Laser panel.
2. Operator opens Interval Test.
3. Dialog validates settings and shows footprint.
4. User generates/previews the temporary test.
5. User Frames on scrap.
6. User Starts through normal readiness and warning flow.
7. User reads the burned row and manually applies the chosen interval to the
   target layer.

Future optional mutation:

- `Apply to selected layer` can update Fill `hatchSpacingMm` or Image
  `linesPerMm` after the burn. That should be an explicit undoable project
  mutation, not automatic.

## Limits And Honest Clamps

The dialog must expose limits rather than silently clamping:

- Fill hatching clamps below `0.05mm`, so Simple Fill cannot honestly test
  intervals lower than `0.05mm`.
- Image mode is capped by raster budget and UI resolution limits. Current image
  resolution range is `5..25` lines/mm, equivalent to:
  - `0.2mm` interval at 5 lines/mm,
  - `0.04mm` interval at 25 lines/mm.
- Higher lines/mm increases target pixels and output size rapidly.

Example image interval mapping for a 20mm square:

| Interval | lines/mm | DPI | 20mm tile pixels |
|---:|---:|---:|---:|
| 0.200mm | 5 | 127 | 100 x 100 |
| 0.125mm | 8 | 203.2 | 160 x 160 |
| 0.100mm | 10 | 254 | 200 x 200 |
| 0.080mm | 12.5 | 317.5 | 250 x 250 |
| 0.067mm | 15 | 381 | 300 x 300 |
| 0.050mm | 20 | 508 | 400 x 400 |
| 0.040mm | 25 | 635 | 500 x 500 |

## Safety Copy

Dialog note:

> Use scrap material and focus the laser before running this test. The laser
> will engrave sample swatches at the selected speed and power. Use Frame before
> Start to verify the test fits the material.

Start confirm:

> Start Interval Test? The laser will fire. Keep the enclosure closed,
> ventilation on, and the physical E-stop reachable. Use Stop or the physical
> E-stop if anything is unsafe.

## Verification Plan

### Software Tests

Generator tests:

- Valid config generates deterministic sample count and labels.
- Invalid min/max, invalid steps, invalid size, invalid power, and invalid speed
  are rejected.
- Simple Fill maps interval to `hatchSpacingMm`.
- Dithered Image maps interval to `linesPerMm = 1 / interval`.
- DPI readout maps to `25.4 / interval`.
- Intervals below honest mode limits are rejected or visibly disabled.

Compile/output tests:

- Each Simple Fill sample compiles with the requested `hatchSpacingMm`.
- Each Dithered Image sample compiles with the requested `linesPerMm`.
- Fixed power/speed/passes remain unchanged across samples.
- G-code keeps every `G0` at `S0`.
- Fill output uses dynamic-power `M4` where required by current fill path.
- Raster output uses `M5` then `M4 S0`, active-span clipping, skipped blank rows,
  gap-rapid splitting, and final `M5`.
- Output is deterministic for a fixed config.

Preflight tests:

- Valid sample row passes preflight.
- Too-large image interval tests fail pre-emit raster budget.
- Overscan out-of-bed fails before Start/Save.
- Empty or disabled output fails explicitly.

UI tests:

- Dialog opens and closes via existing a11y patterns.
- Field validation blocks invalid intervals.
- Derived lines/mm and DPI update correctly.
- Generate/Preview does not mutate a user project without explicit action.
- Start uses the same readiness path as normal jobs.

### Hardware Verification

1. Use known safe speed/power from Material Test or prior material knowledge.
2. Use scrap, fixed focus, fixed air assist, and ventilation.
3. Frame the row before Start.
4. Burn a small row first.
5. Inspect under light or magnification.
6. Choose the interval where lines just touch without overlap/gap.
7. Apply that interval to Fill `hatchSpacingMm` and/or Image `linesPerMm`.
8. Save emitted G-code and photos as audit evidence.

Software cannot prove the optimal interval. It can only prove the generated
interval values, emitted spacing, safety invariants, and workflow state.

## Findings For The Roadmap

1. Interval Test is a missing LightBurn workflow parity feature.
2. It should share the calibration-test foundation with Material Test.
3. It is smaller than Material Test because only one variable changes.
4. It still needs scope approval because `PROJECT.md` lists cut-test wizards out
   of scope.
5. Simple Fill can ship first using `hatchSpacingMm`.
6. Dithered Image should ship only with raster budget/preview clarity.
7. The app needs a shared line interval conversion helper.
8. UI must explain interval, lines/mm, and DPI as the same physical setting.

## Next Research Item

Next item: Material Library.

Material Library research should answer:

- LightBurn `.clb` behavior and whether compatibility is worth pursuing.
- Assign vs Link workflow.
- How presets map to LaserForge layers and future Cut Settings Editor.
- Local storage format and migration strategy.
- How Material Test / Interval Test results become reusable recipes.
