# LightBurn Parity Research - Material Test

Date: 2026-06-05
Repo: LaserForge-2.0
Mode: research/audit only; no production code changed.

## Research Program

1. Material Test - researched in this report.
2. Interval Test - next.
3. Material Library.
4. Advanced Cut Settings Editor.
5. Optimization Settings.
6. Richer Trace Controls.
7. Vector Editing Tools.
8. Device / Console Workflow.

## Method

Five read-only agents were dispatched against the first item only:

- LightBurn workflow and official-doc behavior.
- LaserForge architecture fit.
- G-code/output correctness.
- UI/operator workflow.
- Verification and hardware proof.

Local cross-checks were run against the current LaserForge-2.0 tree. The most
important local files inspected were:

- `PROJECT.md`
- `LIGHTBURN-STUDY.md`
- `CLAUDE.md`
- `src/core/scene/layer.ts`
- `src/core/scene/scene-object.ts`
- `src/core/job/compile-job.ts`
- `src/core/job/job.ts`
- `src/io/gcode/prepare-output.ts`
- `src/io/gcode/emit-gcode.ts`
- `src/ui/common/Toolbar.tsx`
- `src/ui/laser/LaserWindow.tsx`
- `src/ui/laser/JobControls.tsx`
- `src/ui/laser/start-job-readiness.ts`
- `src/ui/state/store.ts`
- `src/ui/state/ui-store.ts`

Official LightBurn references used:

- LightBurn Material Test: https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/
- LightBurn First Material Test: https://docs.lightburnsoftware.com/latest/GetStarted/FirstMaterialTest/
- LightBurn Speed vs Power: https://docs.lightburnsoftware.com/latest/Explainers/SpeedVsPower/
- LightBurn Laser Tools menu: https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/
- LightBurn Shape Properties: https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/

## Current Truth In LaserForge

LaserForge does not currently implement a Material Test generator.

Evidence:

- `src/ui/laser/job-intent-warnings.ts` only warns that a user should run a
  material test on scrap.
- `LIGHTBURN-STUDY.md` records the gap: no Interval Test or Material Test
  generator.
- `PROJECT.md` still lists "Material library, cut tests, power/speed wizards"
  as out of scope without a project revision and ADR.

The current output architecture is layer-centered:

- `Layer` owns `mode`, `power`, `speed`, `passes`, fill settings, and image
  settings.
- `compileJob` iterates output layers and applies one layer's settings uniformly
  to all matching objects.
- `Job` groups carry one power/speed/passes tuple per group.

Conclusion: a true LightBurn-style 10x10 grid with different power/speed per
cell cannot be represented cleanly as one layer today. A fake single-layer grid
would look like Material Test but would not actually vary cell settings.

## What LightBurn Material Test Does

LightBurn Material Test is not just a drawing generator. It is an operator
calibration workflow.

Verified behavior:

- Opened from Laser Tools -> Material Test.
- Default pattern is a 10x10 grid, commonly Power by columns and Speed by rows.
- Each axis has Count, Param, Min, and Max.
- Parameters include Power, Speed, Interval, Passes, and controller-dependent
  Frequency/Q-Pulse where supported.
- It exposes cell Height/Width, X/Y Center for Absolute Coordinates, text and
  border settings, and presets.
- It has job workflow controls such as Preview, Frame, Start, Pause, Stop, Save
  GCode/RD, and Send.
- The generated grid has labels and a header for shared settings.
- Execution is ordered by lower burn/charring risk first: highest speed, lowest
  power, lowest interval, and fewest passes first.
- The operator burns scrap material, inspects the physical result, chooses a
  cell, and then applies or saves that setting.

Safety implication: LightBurn does not claim it can know the right material
setting from software alone. The burn on real material is the measurement.

## Development Recommendation

### Do Not Build A Direct G-code Shortcut

Rejected path: a Material Test dialog that emits its own G-code string.

Reason:

- It would bypass or duplicate `prepareOutput`, `emitGcode`, preflight, preview,
  job origin placement, frame bounds, live estimate, metadata, and Start
  readiness.
- LaserForge recently spent work making Preview, Save, Start, and Frame use the
  same prepared job path. Material Test must not create a second truth.

### Build A Generated Project/Scene

Recommended user-level model:

1. Operator chooses Start From and Job Origin in the Laser panel.
2. Operator opens Material Test.
3. Dialog validates ranges and generates a standalone Material Test project or
   clearly replaces the current scene after confirmation.
4. Preview shows the exact generated job.
5. Operator Frames.
6. Operator Starts through the normal Laser panel.
7. Existing Stop/Pause/Resume remain visible and usable.

This keeps Material Test inside the same pipeline as normal work.

### Foundation Choice

There are two honest implementation paths.

Path A - current architecture, one layer per cell:

- Generate one deterministic output layer/color per unique cell recipe.
- A 10x10 Power x Speed grid creates up to 100 cell layers plus label/border
  layers.
- This is correct with current `Layer` and `compileJob` semantics.
- It is noisy in Cuts/Layers and is not LightBurn-like internally.

Path B - proper LightBurn-parity foundation:

- Add an ADR-level per-object cut-setting override foundation.
- Layer remains the default recipe.
- A generated Material Test cell can override power, speed, passes, and
  interval-related settings.
- `compileJob` splits objects with different effective recipes into separate
  groups.
- This also unlocks LightBurn Shape Properties style power scaling later.

Recommendation:

- If speed matters more than clean architecture, Path A can ship a correct MVP.
- If the goal is LightBurn parity and less future cleanup, build Path B first,
  then build Material Test on top of it.
- Do not ship a single-layer grid that only changes labels.

## Proposed Architecture

### Governance First

Because `PROJECT.md` currently marks cut-test wizards out of scope:

1. Update `PROJECT.md` to scope Material Test.
2. Add a `DECISIONS.md` ADR for the selected foundation:
   - 100-layer generated-project MVP, or
   - per-object effective cut recipe overrides.

### Core Module

New module:

- `src/core/material-test/`

Responsibilities:

- Material Test config types.
- Axis value generation.
- Presets.
- Geometry generation.
- Deterministic risk ordering.
- Bounds calculation.
- Generated metadata mapping cell labels to real recipe values.

Suggested core types:

```ts
type MaterialTestAxisParam = 'power' | 'speed' | 'passes' | 'interval';

type MaterialTestAxis = {
  readonly param: MaterialTestAxisParam;
  readonly min: number;
  readonly max: number;
  readonly count: number;
};

type MaterialTestConfig = {
  readonly xAxis: MaterialTestAxis;
  readonly yAxis: MaterialTestAxis;
  readonly operation: 'fill-engrave' | 'line-cut';
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
  readonly gapMm: number;
  readonly includeText: boolean;
  readonly includeBorder: boolean;
};
```

If using the clean foundation, add an effective recipe model:

```ts
type CutRecipeOverride = {
  readonly power?: number;
  readonly speed?: number;
  readonly passes?: number;
  readonly hatchSpacingMm?: number;
};
```

The exact schema should be decided in an ADR because it touches `.lf2`
compatibility and `compileJob`.

### UI Module

New UI:

- `src/ui/material-test/MaterialTestDialog.tsx`
- `src/ui/material-test/material-test-fields.ts`
- optional `src/ui/material-test/material-test-copy.ts`

Launcher:

- Add `Material Test...` to the top toolbar as a calibration command for now.
- When LaserForge gains a LightBurn-style menu bar, mirror LightBurn as
  Laser Tools -> Material Test.

Do not place the primary command in Cuts/Layers. Cuts/Layers edits existing
recipes; Material Test generates a calibration job.

Do not start motion from the modal. The modal generates and previews. The Laser
panel owns Frame/Start/Stop.

### Dialog Fields

Minimum useful MVP:

- Preset: Custom, Diode engrave, Diode cut, CO2 engrave, CO2 cut.
- Operation: Fill engrave default; Line cut optional.
- X axis: Param, Min, Max, Count. Default Param = Power.
- Y axis: Param, Min, Max, Count. Default Param = Speed.
- Cell Width, Cell Height, Gap.
- Shared Passes.
- Shared hatch spacing/interval for fill.
- Enable Text.
- Enable Border.
- Placement readout: "Uses Laser panel Start From / Job Origin."

Unsupported for MVP:

- Frequency and Q-Pulse, unless DeviceProfile and output strategy gain those
  fields first.
- Imported/exported LightBurn preset format compatibility.
- Material Library linking.

### Labels

Labels must burn as geometry, not G-code comments.

Options:

- Use existing `TextObject` with pre-rendered paths.
- Use a small built-in single-line vector font for generated test labels.

Recommendation:

- Use a low-power, high-speed dedicated label layer.
- Keep labels separate from high-risk cell layers.
- Add a "no text" option for tiny material scraps.

## Output Rules

Required output behavior:

- Generate lowest-risk cells first.
- Speed units must be mm/min everywhere.
- Clamp power to 0..100 and convert to S using the device max S.
- Never allow unsupported axes to silently do nothing.
- Valid generated output must pass:
  - no laser-on travel,
  - no long blank G1 feed moves,
  - no out-of-bed coordinates,
  - no empty output,
  - no layer/mode mismatch.

Mode guidance:

- Fill engrave should be the first supported operation because it matches the
  common Material Test use case for engraving darkness.
- Line cut can come next, with stronger safety copy and lower-risk defaults.
- Raster/image Material Test is deferred; it can explode output size and has
  separate interval/dither concerns.

## Safety Copy

Dialog warning:

> This test intentionally burns scrap material. Focus the laser, enable
> ventilation/air assist, keep the test area clear of clamps, and keep the
> physical E-stop in reach.

Generate toast:

> Generated material test: 10 x 10 cells. Preview and Frame on scrap before
> Start.

Start confirmation for generated material tests:

> Start material test? This will burn a calibration grid on scrap using the
> shown speed and power range. Confirm the framed area is on scrap material and
> clear of clamps. Software Stop is not an emergency stop; use the physical
> E-stop if unsafe.

Do not use a toast for the Start confirmation. Toasts auto-dismiss and are
non-blocking.

## Verification Plan

### Software Tests

Generator tests:

- 2x3 and 3x3 grids are deterministic.
- Axis values are monotonic and match labels.
- Bounds match cell sizes and gaps.
- Generated IDs and layer order are stable.
- Invalid configs are rejected with explicit messages.

Compile tests:

- Each generated cell compiles with the intended power/speed/passes.
- Fill cells use the intended hatch spacing.
- Label layers compile with low-risk settings.
- Unsupported axes do not compile silently.

G-code tests:

- Expected S values match `round(power / 100 * device.maxPowerS)`.
- Feed rates match the intended speed in mm/min.
- Group comments or metadata map emitted cells to labels.
- Layer/group order follows burn-risk ordering.
- No laser-on travel.
- No long blank feed.
- No out-of-bed coordinates.
- Output is deterministic over repeated calls.

UI tests:

- Dialog has `role="dialog"` and focus trap behavior.
- Escape closes without mutation.
- Generate creates one undoable mutation.
- Existing project replacement requires confirmation.
- Preview and Frame consume the same prepared output as Start.

Readiness tests:

- Start remains blocked by controller `$30` mismatch, unknown status, alarm,
  active streamer, active autofocus, and unresolved custom origin.

### Hardware Verification

Hardware proof is mandatory before calling Material Test "working."

Checklist:

1. Use fresh scrap material, focused laser, ventilation, and air assist.
2. Export and inspect a 2x3 low-risk grid first.
3. Confirm Frame matches the physical scrap area.
4. Burn 2x3 first, then 10x10.
5. Confirm darker cells correlate with higher power or lower speed.
6. Confirm labels are legible and not overburned.
7. Inspect inter-cell travel for unintended marks.
8. Repeat one chosen cell as a standalone normal job to prove settings transfer.
9. Save the generated G-code and photos as audit evidence.

Software cannot prove material darkness, cut-through depth, smoke behavior,
focus, diode response, air assist effect, acceleration artifacts, backlash, or
belt/mechanical condition.

## Findings For The Roadmap

1. Material Test is a real missing workflow parity feature, not a bug in current
   code.
2. Scope is currently blocked by `PROJECT.md`; implementation needs a project
   revision and ADR.
3. A correct MVP can be built with one layer per cell, but it will be noisy.
4. The clean LightBurn-parity path is per-object/effective-recipe overrides.
5. Direct G-code generation should be rejected.
6. The first supported mode should be Fill engrave Power x Speed.
7. Frequency, Q-Pulse, Material Library linking, and raster/image Material Test
   should be deferred until the underlying model supports them.
8. Hardware verification is not optional.

## Next Research Item

Next item: Interval Test.

The Interval Test research should answer:

- What LightBurn's Interval Test generates.
- How Line Interval maps to LaserForge `hatchSpacingMm`, `linesPerMm`, and DPI.
- Whether it should share the Material Test generator foundation.
- How it should feed the future Material Library / Cut Settings Editor.
