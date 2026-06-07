# Implementation Start Audit And Workflow Decision

Date: 2026-06-06
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: audit and workflow decision only. No production code was changed.

## 1. Question

We previously researched the main LightBurn workflow gaps: Material Test, Interval Test, Material Library, Advanced Cut Settings Editor, Optimization Settings, Trace Image, Vector Editing Tools, Device/Console/Move workflow, and the application shell/menu/toolbar workflow.

Before starting code, the question is: **what should be implemented first, based on the live tree rather than stale audit notes?**

## 2. Live Tree Correction

The old implementation plan correctly said the workflow foundation should come before big features, but several specific "foundation" items are already shipped in the current tree.

Verified current code:

- `src/core/scene/layer.ts`
  - `Layer` already has `minPower`.
  - `LAYER_DEFAULTS` already sets `minPower: 0`.
  - `Layer` does not yet have `dotWidthCorrectionMm`, `negativeImage`, or `passThrough`.
- `src/core/scene/scene.ts`
  - `moveLayer(scene, layerId, direction)` already exists.
- `src/core/raster/dither.ts`
  - Raster dithering already supports eleven modes: `threshold`, `floyd-steinberg`, `jarvis`, `stucki`, `atkinson`, `burkes`, `sierra3`, `sierra2`, `sierra-lite`, `ordered`, and `grayscale`.
  - `DitherOptions` already has `sMin`.
  - Grayscale dithering already maps non-white pixels through `[sMin, sMax]`.
- `src/core/job/compile-job.ts`
  - Image raster compilation already reads `layer.minPower`, computes `sMin`, applies image luma adjustments, and sends dither options into the raster pipeline.
- `src/ui/layers/LayerImageFields.tsx`
  - The layer panel already exposes image dither mode, line density, and Min Power.
- `src/ui/layers/LayerOrderControls.tsx`
  - Layer up/down controls already exist.
- `src/ui/layers/SelectedImageAdjustments.tsx`
  - Selected raster images already expose brightness, contrast, and gamma controls.
- `src/ui/workspace/draw-raster-preview.ts`
  - Raster preview already uses luma adjustments, layer dither mode, min power, and line density.

## 3. Findings Retired

These findings should be removed from active planning because they are false against the live checkout:

- "LaserForge has only three raster dither modes."
- "There is no Min Power field."
- "There is no raster dither UI."
- "There is no line interval / raster resolution UI."
- "There is no layer reorder primitive."
- "There is no image adjustment path in compile or preview."
- "LayerRow must be split before layer image fields can be added."

They were valid at some earlier point or in a stale report, but they are not valid now.

## 4. Still Real

The following workflow gaps remain valid:

- No central command registry for menu, toolbar, shortcut, context menu, and Electron native menu surfaces.
- No LightBurn-style menu bar.
- Electron currently sets `autoHideMenuBar: true` in `electron/main.ts`.
- No `src/ui/commands` module and no `src/ui/menu` module.
- No Advanced Cut Settings Editor modal.
- No full Adjust Image modal with side-by-side preview, OK/Cancel staging, or LightBurn-style image tools.
- Image layer still lacks verified `negativeImage`, `dotWidthCorrectionMm`, and `passThrough` behavior.
- Material Test and Interval Test are still missing.
- Material Library is still missing.
- Optimization Settings are still missing as an operator-facing planner control.
- Device Manager / Console / Move windows are still missing.
- Vector editing tools remain mostly absent and should stay behind a governance gate because they expand geometry behavior and undo/selection complexity.

## 5. LightBurn Benchmark

Official LightBurn docs show that workflow is organized around command families, not one flat toolbar:

- File menu: project I/O, import/export, save, machine-file output.
- Edit menu: undo/redo, clipboard, duplicate, delete, convert operations, path operations.
- Tools menu: drawing, image tools, trace image, adjust image, masking/cropping, positioning tools.
- Arrange menu: grouping, aligning, distributing, mirroring, draw order, locking.
- Laser Tools menu: material/interval/focus tests, device settings, machine setup, laser setup workflows.
- Window menu: panel/window visibility and layout recovery.

Official LightBurn image-mode docs also confirm that advanced image engraving is not just "dither mode"; it includes negative image, line interval/DPI, dot width correction, pass-through, and per-image adjustment tooling.

Reference sources:

- https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/WindowMenu/
- https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/
- https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/
- https://docs.lightburnsoftware.com/Tools/IntervalTest.html
- https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/
- https://docs.lightburnsoftware.com/OptimizationSettings.html

## 6. Candidate First Tickets

### Candidate A: Add Missing Image Knobs First

Fields: `negativeImage`, `dotWidthCorrectionMm`, `passThrough`.

Pros:

- Directly improves engraving parity.
- Operator-facing value is obvious.

Cons:

- These touch emitted output and preview parity.
- `dotWidthCorrectionMm` belongs in raster span emission, not only layer UI.
- `passThrough` is subtle because LightBurn means "use the preprocessed image as-is," while LaserForge still has to map source pixels to physical dimensions and job bounds.
- Hardware verification is needed before calling the behavior proven.

Decision: **not first**. This is real work, but it needs a focused emitter audit before implementation.

### Candidate B: Build Material Test First

Pros:

- High operator value.
- Directly addresses calibration.

Cons:

- Requires a reliable generated-test-job model with per-cell parameter overrides.
- It should not mutate normal layer settings.
- It should plug into the same Start/Frame/preflight pipeline.
- It needs menu/command placement anyway.

Decision: **not first**. Material Test should follow command registry and cut-setting override design.

### Candidate C: Build Material Library First

Pros:

- Strong LightBurn parity.
- Helps repeatability.

Cons:

- Needs a stable Cut Settings Editor shape.
- Needs persistence/import/export/linking decisions.
- If built before the editor, it will likely store the wrong shape.

Decision: **not first**. Material Library should follow Advanced Cut Settings Editor.

### Candidate D: Add Command Registry And Shell Structure First

Pros:

- No G-code or burn-output behavior changes.
- Creates one source of truth for command label, group, shortcut, enabled state, handler, safety gate, and future Electron menu bridge.
- Prevents future LightBurn parity work from bloating `Toolbar.tsx`.
- Lets Material Test, Interval Test, Adjust Image, Trace Image, Convert to Bitmap, Device Settings, Console, and Window toggles land into a coherent workflow instead of scattered buttons.
- Easy to test with unit tests and browser smoke tests.

Cons:

- The first commit is mostly architecture and workflow surface, not a new laser feature.

Decision: **recommended first ticket**.

## 7. Recommended Workflow

Start with a **command registry for shipped commands only**, then render the first menu/shell surface from it.

The first implementation should not add new LightBurn features yet. It should organize current shipped behavior into LightBurn-compatible command families.

Target command families:

- `file`: New, Open, Save, Save As, Import SVG, Import Image, Save G-code.
- `edit`: Undo, Redo, Select All, Duplicate, Delete, Convert to Bitmap.
- `tools`: Text, Trace Image.
- `arrange`: existing transform / nudge / layer movement commands only where already shipped.
- `laser`: Connect/Disconnect, Home, Frame, Start, Pause, Stop, Device Settings where already shipped.
- `window`: show/hide existing side panels if current UI state can support it; otherwise define the family but do not expose unsupported toggles yet.
- `help`: version/about/build information only if already available.

Rules:

- Commands must not bypass existing safety gates.
- Disabled commands must explain why they are disabled.
- The toolbar should become a consumer of commands, not the owner of command behavior.
- The first pass should not change generated G-code, raster preview, trace output, serial streaming, project file format, or saved `.lf2` shape.
- Future commands such as Material Test, Interval Test, Material Library, Console, Move, Adjust Image modal, and Optimization Settings should have reserved IDs only when the UI clearly marks them unavailable; otherwise keep them out until implemented.

## 8. Test Plan For First Ticket

Required automated checks:

- Command registry test:
  - every command has stable `id`, `label`, `family`, and `handler`.
  - no duplicate command IDs.
  - safety-sensitive laser commands are gated by existing store/controller state.
- Toolbar/menu wiring test:
  - clicking the toolbar command calls the same command handler used by the menu.
  - disabled commands do not execute.
- Regression tests:
  - focused UI tests for `Toolbar` and app shell.
  - focused store tests for undo/redo/delete/duplicate commands if handlers move.
- Non-output invariant:
  - no generated G-code snapshot or raster compile behavior should change.

Suggested command bundle:

```powershell
pnpm test src/ui/commands src/ui/common src/ui/app -- --run
pnpm test src/core/job/compile-job.test.ts src/ui/workspace/draw-raster-preview.test.ts -- --run
pnpm typecheck
pnpm format:check
```

## 9. Decision

**First implementation ticket: Command Registry + LightBurn-style shell foundation for already shipped commands.**

Reason: it is the smallest workflow foundation that is broadly useful, backed by official LightBurn UI organization, and does not risk burn output. It also prevents the next features from landing as random toolbar buttons.

After that lands, the next workflow tickets should be:

1. Advanced Cut Settings Editor skeleton for existing fields.
2. Image Mode parity mini-ticket: `negativeImage` first, then `dotWidthCorrectionMm`, then `passThrough`.
3. Adjust Image modal.
4. Material Test.
5. Interval Test.
6. Material Library.
7. Optimization Settings.
8. Device Manager / Console / Move windows.
9. Vector editing tools, only after a separate geometry/undo audit.

## 10. Verification Performed

Focused tests passed:

```text
pnpm test src/core/raster/dither.test.ts src/core/job/compile-job.test.ts src/core/scene/scene.test.ts src/ui/layers/CutsLayersPanel.test.tsx src/ui/state/store.test.ts src/core/preflight/preflight.test.ts src/ui/workspace/draw-raster-preview.test.ts -- --run

7 test files passed
132 tests passed
```

Formatting check passed for the newest workflow research reports:

```text
pnpm exec prettier --check audit\reports\lightburn-application-shell-menu-toolbar-research-2026-06-06.md audit\reports\lightburn-device-console-move-workflow-research-2026-06-05.md

All matched files use Prettier code style.
```

Current branch state at audit time:

```text
wip/checkpoint-2026-06-03...origin/wip/checkpoint-2026-06-03 [ahead 2]
```

No production files were patched during this audit.
