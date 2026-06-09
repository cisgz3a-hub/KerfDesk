# LightBurn Parity Research - Advanced Cut Settings Editor

Date: 2026-06-05
Repo: `C:\Users\Asus\LaserForge-2.0`
Mode: research / audit only
Status: no production code changes

## Research Program Status

1. Material Test - researched and saved in `audit/reports/lightburn-material-test-research-2026-06-05.md`.
2. Interval Test - researched and saved in `audit/reports/lightburn-interval-test-research-2026-06-05.md`.
3. Material Library - researched and saved in `audit/reports/lightburn-material-library-research-2026-06-05.md`.
4. Advanced Cut Settings Editor - this report.
5. Optimization Settings - next.
6. Richer trace controls.
7. Vector editing tools.
8. Device / console workflow.

## Executive Decision

Build the first Advanced Cut Settings Editor as a LightBurn-style modal over LaserForge's current, backed layer fields. Do not use it as a place to fake unsupported advanced settings.

The correct first slice is:

1. Add a Cut Settings Editor dialog launched from a Cuts/Layers row.
2. Keep edits in a local draft until Apply / OK.
3. Commit a single `setLayerParam` patch per Apply / OK.
4. Expose only fields that already have compile / preview / output behavior.
5. Display physical unit adapters for line interval, lines/mm, and DPI.
6. Keep the dialog idle-only until Stop remains reachable through modal focus.
7. Add a golden test proving editor changes flow through Preview, Save, Start, and Estimate via the same prepared-output path.

Do not add Offset Fill, sub-layers, kerf, tabs, perforation, lead-in/out, Z motion, air assist, image scan angle, or Material Library Link inside this first slice. Those are not form fields; they require core geometry, output, schema, preflight, and hardware-verification work.

## Official Reference Baseline

Official LightBurn pages used:

- Cut Settings Editor: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/
- Shared Settings: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SharedSettings/
- Line Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/
- Fill Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/
- Offset Fill Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/OffsetFillMode/
- Image Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- Sub-Layers: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SubLayers/
- Cuts / Layers Window: https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/
- Material Library: https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/
- Adjust Image: https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/
- Shape Properties: https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/

Repo-local evidence:

- `LIGHTBURN-STUDY.md` section 4 records LightBurn's Cuts/Layers Window and Cut Settings Editor behavior.
- `LIGHTBURN-STUDY.md` section 8.2 records LaserForge's Cut Settings Editor gap.
- `DECISIONS.md` ADR-027 makes LightBurn the source of truth for workflow and layer / cut semantics.
- `audit/reports/lightburn-workflow-implementation-plan-2026-06-05.md` already recommends deferring the full Cut Settings Editor surface until the layer UI and field model are ready.

Important correction: older repo-local notes said LaserForge lacked Min Power and had only a small dither set. Current source is ahead of those notes. `Layer.minPower`, many dither modes, `LayerImageFields`, and raster min-power handling now exist. This report uses current source, not stale audit text.

## What LightBurn Does

LightBurn's Cut Settings Editor is the full per-layer settings surface.

Launch paths:

- double-click a Cuts/Layers entry;
- double-click a Material Library entry;
- Material Library entries reuse the same cut-settings surface.

Shared top settings:

- layer name;
- output;
- speed;
- max power;
- min power;
- mode;
- constant power mode for GRBL;
- air assist;
- device-specific fields.

Mode surfaces:

- Line, Fill, and Offset Fill have Common and Advanced tabs.
- Image Mode is presented in current official docs as an Image Settings tab, not the same Common / Advanced split.

Line mode:

- cuts or engraves vector outlines;
- common settings include passes, Z offset, Z step, kerf, perforation, and tabs / bridges;
- advanced settings include pause times, overcut, PWM / PPI, lead-in/out, dot mode, and controller-specific offsets.

Fill mode:

- engraves closed vector interiors using scan lines;
- common settings include line interval / LPI, scan angle, bidirectional fill, cross-hatch, overscanning, passes, Z, and fill grouping;
- advanced settings include ramp, ramp outer edge, and flood fill;
- LightBurn warns that flood fill is sensitive to tuning / backlash.

Offset Fill mode:

- engraves closed shapes with contour-following concentric paths;
- official docs warn it is computationally expensive and can hang on complex geometry or tiny intervals;
- it is not just a fill checkbox. It needs a different toolpath generator.

Image mode:

- engraves raster images with scan settings and image-processing modes;
- line interval and DPI are inverses: `DPI = 25.4 / lineIntervalMm`;
- image settings include bidirectional scanning, negative image, overscanning, line interval, DPI, dot width correction, scan angle, angle increment, Z offset, halftone settings, passes, threshold ramp, pass-through, processing mode, and fill grouping;
- image processing modes include Threshold, Ordered, Atkinson, Dither, Stucki, Jarvis, Newsprint, Halftone, Sketch, and Grayscale;
- Grayscale varies output between Min and Max Power.

Sub-layers:

- multiple independent recipes can be assigned to the same layer / geometry;
- output runs left-to-right through sub-layer tabs;
- a layer with sub-layers shows Multi.

## Current LaserForge Truth

### Backed Layer Fields Already Exist

`src/core/scene/layer.ts` stores:

- `mode`;
- `minPower`;
- `power`;
- `speed`;
- `passes`;
- `visible`;
- `output`;
- `hatchAngleDeg`;
- `hatchSpacingMm`;
- `fillOverscanMm`;
- `fillBidirectional`;
- `ditherAlgorithm`;
- `linesPerMm`.

These are safe for the first editor slice because `compileJob`, preview, and output already consume them.

### Current UI Is Inline, Not LightBurn-Style

`src/ui/layers/LayerRow.tsx` renders the layer editor inline as a card. It currently has common fields and fill fields. `src/ui/layers/LayerImageFields.tsx` renders dither, Min Power for grayscale, and resolution.

This works, but it is not LightBurn's workflow. The modal editor should be added as a new surface rather than making `LayerRow.tsx` larger.

Current rough file sizes from this pass:

- `LayerRow.tsx`: 343 physical lines.
- `LayerImageFields.tsx`: 132 physical lines.
- `store.ts`: 418 physical lines.
- `layer.ts`: 73 physical lines.

Do not add a large modal, tabs, validation, and field mapping into `LayerRow.tsx` or `store.ts`.

### Current Output Semantics

Current behavior:

- Line groups emit M3 constant-power cutting.
- Fill groups emit M4 dynamic-power fill.
- Raster groups manage M4 internally and end in M5.
- Image grayscale uses `Layer.minPower` to compute `sMin`.
- Image resolution uses `Layer.linesPerMm`.
- Fill spacing uses `Layer.hatchSpacingMm`.
- Fill overscan is stored as absolute mm, not LightBurn's percent-of-speed style.

This is enough for a useful editor, but not full LightBurn parity.

### Current Modal Safety Problem

Existing modal dialogs use a full-screen backdrop. Stop controls are currently inside `JobControls`, and current `shortcuts.ts` does not implement the documented Ctrl/Cmd + `.` Stop shortcut.

Therefore the first Cut Settings Editor should be idle-only:

- do not open while a job is streaming / paused / errored;
- do not open during frame / jog / autofocus operations;
- if a motion operation starts while the editor is open, block Apply or close the editor.

This is not a theoretical concern. LaserForge controls real hardware, and PROJECT non-negotiable #9 requires Stop reachability during a job.

## Field Mapping

| LightBurn field | Current LaserForge support | First editor action |
|---|---|---|
| Layer color / identity | `Layer.id`, `Layer.color` | Show as read-only identity |
| Layer name | no field | Hide |
| Mode | `line`, `fill`, `image` | Expose these three |
| Offset Fill | no mode or offset engine | Defer |
| Multi / sub-layers | no layer stack model | Defer |
| Output | `Layer.output` | Expose |
| Show | `Layer.visible` | Expose |
| Execution order | `scene.layers` order, `moveLayer` exists | Keep in Cuts/Layers row, not modal core |
| Speed | `Layer.speed`, capped by device max feed | Expose |
| Max Power | `Layer.power` | Expose |
| Min Power | `Layer.minPower`; used for grayscale image | Expose only where meaningful, or clearly show partial |
| Constant Power Mode | no layer toggle | Hide or fixed read-only by mode |
| Air Assist | no layer field or M7/M8 config | Defer |
| Pass count | `Layer.passes` | Expose |
| Line kerf | no offset geometry | Defer |
| Perforation | no cut/skip segmenting | Defer |
| Tabs / bridges | no tab-aware cutting | Defer |
| Lead-in / lead-out | no lead planner | Defer |
| Overcut | no closed-path extension | Defer |
| Start/end pause | no per-layer dwell emission | Defer |
| Z offset / Z step | no Z capability model | Defer |
| Fill line interval | `Layer.hatchSpacingMm` | Expose as line interval |
| Fill LPI / DPI views | derivable | Show as derived display if useful |
| Fill scan angle | `Layer.hatchAngleDeg`, UI currently clamps 0..180 | Expose; widen to 0..360 later with tests |
| Fill bidirectional | `Layer.fillBidirectional` | Expose |
| Fill overscan | `Layer.fillOverscanMm`, absolute mm | Expose as LaserForge mm value |
| Fill grouping | effectively layer-wide hatching, no options | Defer |
| Cross-hatch / angle increment | no second rotated pass | Defer |
| Flood fill | no planner mode | Defer |
| Fill ramp | no power-ramped fill | Defer |
| Image dither | `Layer.ditherAlgorithm`, 11 current modes | Expose current modes |
| Image interval / DPI | `Layer.linesPerMm`; `DPI = linesPerMm * 25.4` | Expose as lines/mm plus derived DPI / interval |
| Image Min / Max Power | `minPower` + `power`, grayscale only | Expose with grayscale caveat |
| Image bidirectional | hardcoded raster scanning behavior | Defer toggle |
| Image overscan | hardcoded 5 mm in raster compile | Defer editable field |
| Image scan angle | no rotated raster sweeps | Defer |
| Dot Width Correction | no field / emitter correction | Defer until raster emitter support |
| Negative Image | no layer field | Defer |
| Pass-Through | compile always resamples | Defer |
| Brightness / contrast / gamma | `RasterImage` fields, selected-image workflow | Keep object-level, not layer recipe |
| Convert to Bitmap render type | current dialog and core support it | Do not duplicate in Cut Settings Editor |
| Convert to Bitmap DPI | current dialog support | Do not duplicate in Cut Settings Editor |

## Recommended UI Architecture

Create a new folder:

`src/ui/layers/cut-settings/`

Recommended files:

- `CutSettingsEditor.tsx` - modal shell, resolves the layer, owns draft state.
- `cut-settings-draft.ts` - pure draft conversion, normalization, patch creation.
- `CutSettingsCommonTab.tsx` - existing shared fields.
- `CutSettingsLineTab.tsx` - line mode backed fields, currently small.
- `CutSettingsFillTab.tsx` - fill backed fields.
- `CutSettingsImageTab.tsx` - image backed fields.
- `cut-settings-fields.tsx` - small field primitives.
- `CutSettingsOpenButton.tsx` - optional opener component.

Existing files should stay small:

- `LayerRow.tsx`: add only an Edit button and guarded double-click open behavior.
- `CutsLayersPanel.tsx`: keep as panel shell / list / empty state.
- `App.tsx`: mount one editor dialog near existing app-level dialogs.
- `ui-store.ts`: add open / close state for the editor.

Open behavior:

- click Edit on a layer row;
- double-click row background/header, not inputs/select/buttons/labels;
- future Material Library entries should call the same editor with a different source kind.

Draft behavior:

- opening copies the current layer into a local draft;
- typing updates the draft only;
- Cancel / Escape closes without changing the project;
- Apply normalizes and commits once via `setLayerParam`;
- OK commits once and closes;
- if Apply was already clicked, Cancel only closes and does not undo prior Apply;
- if the layer disappears while the editor is open, close or show a read-only missing-layer state.

Accessibility:

- use `useDialogA11y`;
- `role="dialog"`;
- `aria-modal="true"`;
- tablist/tab semantics for tabs;
- Escape closes;
- focus returns to opener.

## Schema Impact

### No Schema Change

First editor slice can use existing fields:

- mode;
- output;
- visible;
- speed;
- power;
- minPower;
- passes;
- hatchAngleDeg;
- hatchSpacingMm;
- fillOverscanMm;
- fillBidirectional;
- ditherAlgorithm;
- linesPerMm.

### Additive Fields

These can be added later with defaults, validator updates, normalizer updates, round-trip tests, and default-output golden tests:

- image negative;
- image pass-through;
- image overscan;
- image bidirectional toggle;
- dot width correction;
- vector constant-power override;
- air assist, if device command support exists.

### Structural Changes

These need ADR / schema migration / compile and output architecture:

- Offset Fill;
- sub-layers / Multi;
- Material Library Link;
- kerf;
- tabs / bridges;
- perforation;
- lead-in/out;
- overcut;
- Z offset / Z step;
- image scan angle;
- cross-hatch / angle increment;
- flood fill;
- ramp fill.

Important deserialization risk: `deserializeProject` validates shape and normalizes defaults, then casts `normalized as unknown as Project`. Any new persisted field must be added to:

- `Layer`;
- `LAYER_DEFAULTS`;
- `createLayer` tests;
- `validateLayer`;
- `normalizeLayer`;
- old-shape deserialize tests;
- compile / output tests if it affects G-code.

## Implementation Order

1. Documentation / scope check:
   - confirm whether this is a Phase F polish item or needs a `PROJECT.md` / `DECISIONS.md` update;
   - refresh stale `WORKFLOW.md` notes around Convert to Bitmap and current image-layer controls.
2. Cut Settings Editor shell:
   - app-level modal;
   - idle-only gate;
   - row Edit button;
   - guarded row double-click;
   - draft helper.
3. Backed fields only:
   - common tab;
   - line tab;
   - fill tab;
   - image tab;
   - no unsupported editable controls.
4. Unit adapters:
   - fill interval mm;
   - image lines/mm;
   - image line interval;
   - image DPI.
5. Editor-to-output verification:
   - one canonical Line / Fill / Image project;
   - editor-style patches;
   - Preview / Save / Start / Estimate all agree.
6. Low-risk additive image fields:
   - negative image;
   - image overscan;
   - image bidirectional toggle;
   - pass-through only after resampling behavior is designed.
7. Dot Width Correction:
   - add field;
   - shorten raster spans in `emit-raster`;
   - verify output and burn.
8. Larger LightBurn features:
   - Offset Fill;
   - sub-layers;
   - kerf/tabs/perforation/lead-in/out;
   - air assist;
   - Z.

## Tests

### P0 Tests

- `cut-settings-draft.test.ts`:
  - draft round-trip from `Layer`;
  - clamp speed to device max;
  - clamp power `0..100`;
  - clamp `minPower <= power`;
  - pass count integer and at least 1;
  - line interval / DPI conversion.

- `CutSettingsEditor.test.tsx`:
  - open correct layer;
  - Cancel does not mutate;
  - Escape does not mutate;
  - Apply commits one patch;
  - OK commits one patch and closes;
  - missing layer state;
  - tab accessibility basics.

- `CutsLayersPanel.test.tsx` or `LayerRow.test.tsx`:
  - Edit button opens editor;
  - guarded double-click opens editor;
  - double-clicking input/select/button does not open duplicate editor.

- Editor-to-output golden:
  - change line power/speed/passes;
  - change fill interval/angle/overscan/bidirectional;
  - change image dither/minPower/linesPerMm;
  - assert Preview / Save / Start / Estimate use the same effective settings.

### P1 Tests

- `.lf2` round-trip with non-default layer settings.
- Old `.lf2` default backfill for layer fields.
- G-code snapshots for line, fill, image, and mixed jobs.
- Raster preview parity for changed image settings.

### Hardware Proof

Software can prove dataflow and emitted G-code. It cannot prove material quality.

Hardware verification should use:

- one saved `.lf2`;
- same device profile;
- recorded `$30`, `$31`, `$32`;
- same focus;
- same material;
- same air assist;
- same origin;
- exported G-code;
- streamed Start body;
- preview screenshot;
- burn photo;
- elapsed time;
- visible artifacts.

Burn cases:

- line power/speed/passes;
- fill spacing/angle/overscan/bidirectional;
- image dither/minPower/linesPerMm/brightness;
- mixed mode transitions.

## Cross-Agent Findings

Five read-only agents inspected independent lanes:

- LightBurn behavior: confirmed official mode surfaces, shared settings, Material Library reuse, and the Image Settings tab correction.
- Layer model: confirmed the first editor can use current `Layer` fields; many older audit gaps are stale.
- UI workflow: recommended a new modal folder, local draft state, guarded double-click, and idle-only safety.
- Schema / persistence: separated no-schema first slice from additive fields and structural migrations.
- Verification: proposed editor-to-output golden tests and hardware proof.

No agent edited files.

## Final Verdict

Advanced Cut Settings Editor should be built, but only in honest slices.

Best next implementation slice:

1. modal shell;
2. idle-only safety gate;
3. draft Apply / OK behavior;
4. current backed fields only;
5. unit adapters for interval / DPI;
6. editor-to-output golden test.

That gives LaserForge the LightBurn-style workflow without creating fake advanced controls that do not affect the burn.

Next research item: Optimization Settings.
