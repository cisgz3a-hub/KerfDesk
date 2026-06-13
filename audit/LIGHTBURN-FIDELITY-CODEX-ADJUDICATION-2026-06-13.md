# LaserForge 2.0 LightBurn Fidelity Audit - Codex Adjudication

Date: 2026-06-13
Status: report-only audit
Repo: `C:\Users\Asus\LaserForge-2.0`
Branch audited: `fix/trace-transparency-opaque-fallback`
Claude audit reviewed: `audit/LIGHTBURN-FIDELITY-AUDIT-2026-06-13.md`

## Scope

This report saves the Codex deeper-audit findings and audits Claude's
LightBurn fidelity findings against the current tree. No production source was
patched as part of this pass.

The goal is to separate:

- confirmed defects or parity gaps,
- valid but lower-priority workflow gaps,
- stale or false-positive claims,
- items that require LightBurn render or Falcon hardware proof before they can
  be called proven.

## Step Log

1. Verified repo identity: `C:\Users\Asus\LaserForge-2.0`, not old
   `C:\Users\Asus\LaserForge`.
2. Verified current branch and source state: `fix/trace-transparency-opaque-fallback`
   at `45d7a0e`, with only audit artifacts untracked.
3. Read `CLAUDE.md` audit rules: LightBurn is the reference, green tests do not
   prove output fidelity, and audit phases must report findings rather than
   auto-fix.
4. Read Claude's `audit/LIGHTBURN-FIDELITY-AUDIT-2026-06-13.md`.
5. Cross-checked claims against current code and official LightBurn docs.
6. Created this consolidated adjudication report.
7. Re-audit status is recorded at the end of this file.

## LightBurn References Rechecked

Official LightBurn docs used for this adjudication:

- Cuts / Layers modes, Output, Show, Air:
  https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/
- Cut Settings Editor mode coverage:
  https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/
- Preview accuracy, time slider, job statistics:
  https://docs.lightburnsoftware.com/2.1/Reference/Preview/
- Trace Image controls:
  https://docs.lightburnsoftware.com/2.1/Reference/TraceImage/
- Material Test labels, parameters, controls, and order:
  https://docs.lightburnsoftware.com/2.1/Reference/MaterialTest/
- Interval Test labels and Simple Fill / Dithered Image modes:
  https://docs.lightburnsoftware.com/2.1/Reference/IntervalTest/
- Optimization Settings planner controls:
  https://docs.lightburnsoftware.com/2.1/Reference/OptimizationSettings/
- Laser Window framing modes:
  https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/
- Move Window Fire, saved positions, active-job speed/power adjust:
  https://docs.lightburnsoftware.com/2.1/Reference/MoveWindow/
- Console Window direct GRBL commands:
  https://docs.lightburnsoftware.com/2.1/Reference/ConsoleWindow/

## Score Reconciliation

Claude's rating and Codex's rating use different lenses, so they are not in
conflict.

| Lens | Codex adjudicated score | Notes |
| --- | ---: | --- |
| Mechanical branch health | 9 / 10 | Build/test/lint/dependency gates were green in the immediately preceding deep pass. |
| Output fidelity for implemented burn paths | 7 / 10 | Agrees with Claude's approximate fidelity score. Strong raster/fill; trace and vector M3/M4 divergence pull it down. |
| Full LightBurn workflow parity | 4.5 / 10 | Agrees with Claude's low broad-parity score. LaserForge is still import/configure/burn, not full design/production software. |
| Operator safety posture | 8.5 / 10 | Strong stop/preflight/invariant posture, but no Fire/Console/Saved Positions workflow yet. |
| Combined practical score | 7.8 / 10 | Good app health plus meaningful LightBurn workflow gaps. |

## Claude Finding Adjudication

### C-1 Raster image engrave - mostly confirmed

Status: confirmed with caveats.

Evidence:

- `DITHER_ALGORITHMS` contains 11 algorithms in
  `src/core/scene/scene-object.ts`.
- Default raster dither is `floyd-steinberg` in `src/core/scene/layer.ts`.
- `compileRasterGroup()` applies luma adjustments, negative mode, pass-through,
  dot width correction, min/max S scaling, and calls `dither()` in
  `src/core/job/compile-job.ts`.
- Raster emission arms M4 in `src/core/raster/emit-raster.ts`.

Adjudication:

- Claude is right that raster is one of the strongest implemented paths.
- Still not proven LightBurn-equivalent until a rendered side-by-side or Falcon
  hardware test compares tone, dither pattern, and grayscale response.
- The missing scan angle / image rotation path remains a real gap.

### C-2 Layer / cut settings - partially confirmed, one stale subclaim

Status: confirmed except Cross-Hatch UI subclaim.

Evidence:

- Current `LayerMode` is only `'line' | 'fill' | 'image'` in
  `src/core/scene/layer.ts`.
- `CutSettingsDialog.tsx` exposes Line, Fill, and Image.
- `CutSettingsDialog.tsx` does expose a `Cross-Hatch` checkbox.
- LightBurn docs list Line, Fill, Offset Fill, Image, and Multi/Sub-Layers, plus
  layer names and Air Assist.

Adjudication:

- Correct: Offset Fill, sub-layers, layer names, Air Assist, and broader
  Advanced/Common tab semantics are missing.
- Correct: Min Power is mostly an image/grayscale concept in this app; vector
  cut/fill groups carry `power` only.
- Stale/false positive: "cross-hatch field exists but UI checkbox was not
  located" is no longer true. It is present in `CutSettingsDialog.tsx`.

### C-3 Fill / scan hatch - confirmed with overlap nuance

Status: mostly confirmed.

Evidence:

- Fill hatching uses even-odd scanline fill and supports bidirectional and
  cross-hatch.
- Same-layer fill overlap is explicitly tested as not double engraved in
  `src/core/job/compile-job-fill.test.ts`.
- Normal same-layer fill objects with shared power scale compile into a layer
  fill group in `src/core/job/compile-job.ts`.

Adjudication:

- Correct: fill is strong but not LightBurn-complete.
- Correct: per-shape/per-region grouping is missing for large spread-out jobs;
  this can create dead-air scanning and weaker production control.
- Correct: overscan is fixed mm-style, not LightBurn's full overscan workflow.
- Adjustment: do not claim same-layer Fill overlap is double-burned; the current
  test suite covers that case. Keep duplicate-overlap criticism scoped to
  Line/Cut geometry.

### C-4 Cut order / path planning - confirmed with scope correction

Status: confirmed.

Evidence:

- `optimizePaths()` supports inside-first nearest-neighbor ordering for cut
  groups.
- `ProjectOptimizationSettings` only has `reduceTravelMoves`.
- `optimizePaths.test.ts` asserts optimization preserves the same set of
  polylines; it does not remove duplicated cut lines.
- LightBurn Optimization Settings include enable/disable, order-by layer/group/
  priority, inner-shapes-first, best start/direction/corners, hide backlash,
  reduce direction changes, and Remove Overlapping Lines.

Adjudication:

- Correct: inside-first is implemented and should not be reported as missing.
- Correct: Remove Overlapping Lines is still missing for vector line/cut output.
- Correct: Optimization Settings UI is much thinner than LightBurn.
- Scope correction: same-layer Fill overlap is handled; Line/Cut duplicate
  shared edges remain the real gap.

### C-5 Vector line/cut M3 vs M4 - confirmed

Status: confirmed design divergence.

Evidence:

- `grbl-strategy.ts` prearms `M3 S0` and restores M3 for `cut` groups.
- Fill groups use M4; raster groups manage M4 internally.
- Claude cites local LightBurn study for LightBurn's default M4 behavior on
  GRBL when Constant Power is disabled. This still needs a direct LightBurn
  export comparison before calling the exact emitted modal sequence identical or
  different by output bytes.

Adjudication:

- Real fidelity divergence: LaserForge vector Line/Cut uses constant power by
  design, which can char corners more than M4 dynamic power.
- This is not automatically wrong for cutting; it is a product choice that
  should become a per-layer "Constant Power" setting if LightBurn fidelity is
  the target.

### C-6 Trace / vectorize - confirmed

Status: confirmed.

Evidence:

- `ImportImageDialog.tsx` defaults the preset to `Line Art`.
- `TRACE_PRESETS` includes `Line Art`, `Centerline`, and `Smooth`.
- `Line Art` uses filled contours, while `Centerline` sets
  `traceMode: 'centerline'`.
- `trace-perceptual.test.ts` explicitly says IoU cannot detect the
  outline-vs-centerline gap.
- The trace transparency black-page fix is present in
  `preprocessForTrace()` by checking `imageHasTransparency()` before using the
  alpha path.

Adjudication:

- Correct: default trace can still produce outline contours around strokes
  where a centerline trace would be visually closer for single-stroke artwork.
- Correct: Centerline is a workaround but not default.
- Correct: current tests are useful but do not prove LightBurn-equivalent trace
  aesthetics.
- Updated context: Photo/Detailed presets are no longer surfaced vector-trace
  presets; that old issue should not be re-raised as current UI behavior.

### C-7 "Where LaserForge beats LightBurn" - observations, not fix findings

Status: partially accepted as observations.

Adjudication:

- Some claims are valid code-level wins, such as disabled command reasons,
  explicit preflight blockers, and strong invariants.
- Hardware-facing superiority claims need caution. Without a LightBurn export
  and Falcon burn side-by-side, do not present them as proven product wins.

## Codex Additional Findings To Preserve

### F-1 Start tooltip gives wrong advice for over-budget jobs

Severity: P2
Confidence: high

File:

- `src/ui/laser/JobControls.tsx`

Trigger:

- Import or convert a raster/image job that crosses the raster budget.
- `estimateLiveJob()` returns `too-large`.
- Hover Start Job.

Failure mode:

- Tooltip says: "Large trace: live estimate paused for performance. Start still
  generates full G-code."
- Current `prepareOutput()` returns `ok: false` for over-budget raster jobs and
  Start is blocked by the same preflight path.

Consequence:

- The operator is told Start can still generate the job when it cannot. This is
  a trust and workflow correctness bug, not a burn-safety defect.

Fix:

- Change copy to say Start will block until the job is reduced or raster
  settings are lowered.
- Add a small `JobControls`/`startJobTitle` test.

### F-2 Frame can still prepare a full complex vector job

Severity: P1
Confidence: high

File:

- `src/ui/laser/JobControls.tsx`

Trigger:

- Use Frame on a complex traced vector or fill-heavy design.

Failure mode:

- `useFrameAction()` calls `prepareOutput()` to compute bounds. That path can
  compile fill hatches and optimize paths even though Frame only needs a safe
  burn-area boundary.

Consequence:

- The prior raster freeze class is guarded, but complex vector/fill jobs can
  still pin the main thread on a cheap operator action.

Fix:

- Add a bounds-only frame-preparation path that reuses scene/object bounds plus
  job-origin placement and bed preflight, without compiling hatches or full
  G-code.
- Keep the current full `prepareOutput()` path for Start/Save.

### F-3 Preview path can still do expensive synchronous preparation

Severity: P1
Confidence: medium-high

Files:

- `src/ui/workspace/use-preview-toolpath.ts`
- `src/ui/workspace/draw-preview.ts`

Trigger:

- Toggle Preview on a complex traced vector or fill-heavy design.

Failure mode:

- `buildPreviewToolpath()` calls `prepareOutput()`. The Preview path is now
  output-order-correct, but it can still perform expensive synchronous compile/
  optimize work.

Consequence:

- Preview can freeze the UI on complex vector/fill scenes. LightBurn Preview is
  expected to be the pre-burn verification surface, so it must not become a
  denial-of-interaction point.

Fix:

- Add vector/fill complexity guards similar to live estimate.
- Consider worker-backed preview preparation for heavy jobs.
- Show a non-blocking "preview too complex; use Start preflight/export" state
  instead of compiling forever.

### F-4 Raster groups are skipped by the Preview scrubber

Severity: P2
Confidence: high

File:

- `src/core/job/toolpath.ts`

Trigger:

- Preview an image/raster job.

Failure mode:

- `buildToolpath()` skips raster groups, so the scrubber does not represent
  raster scan rows.

Consequence:

- The canvas may show raster artwork, but the toolpath scrubber/time traversal
  is incomplete for image engraving. LightBurn documents Preview as an accurate
  representation of what is sent, including cut/travel distinction and job
  statistics.

Fix:

- Synthesize one raster sweep step per active raster row or use a raster-aware
  toolpath step type.
- Include off-travel and active burn distance in preview statistics.

### F-5 Material Test is not self-describing after burn

Severity: P1
Confidence: high

Files:

- `src/core/job/material-test-grid.ts`
- `src/ui/calibration/MaterialTestDialog.tsx`

Trigger:

- Generate and burn a Material Test.

Failure mode:

- LaserForge creates square swatches/layers but no engraved row/column labels,
  no top universal settings labels, no border controls, and no in-dialog
  Preview/Frame/Start/Pause/Stop/Save/Send loop.

Consequence:

- A burned test strip is hard to interpret after removal from the machine.
  LightBurn explicitly labels speed/power axes and universal settings.

Fix:

- Add text-object label generation for row speed and column power.
- Add top labels for invariant settings.
- Add optional border.
- Add an in-dialog operator loop or a generated test scene with clear
  provenance metadata.

### F-6 Interval Test lacks labels and Dithered Image mode

Severity: P1
Confidence: high

Files:

- `src/core/job/interval-test-grid.ts`
- `src/ui/calibration/IntervalTestDialog.tsx`

Trigger:

- Generate and burn an Interval Test.

Failure mode:

- Generated swatches do not include text labels next to each interval.
- No Simple Fill vs Dithered Image test mode exists.

Consequence:

- The physical result is less useful for choosing image/fill line interval.
  LightBurn documents labels and a Dithered Image gradient mode.

Fix:

- Add text labels per interval swatch.
- Add `simple-fill` and `dithered-image` variants.
- Preserve Start From / Job Origin behavior.

### F-7 Optimization Settings are one checkbox

Severity: P1
Confidence: high

Files:

- `src/core/scene/project.ts`
- `src/ui/laser/OptimizationSettingsDialog.tsx`
- `src/core/job/optimize-paths.ts`

Trigger:

- Try to reproduce LightBurn planner behavior for nested shapes, shared
  outlines, priorities, backlash hiding, or best start-point/direction.

Failure mode:

- LaserForge exposes only `reduceTravelMoves`.

Consequence:

- Operators cannot tune the planner for delicate jobs. This is a major
  LightBurn workflow parity gap, even though the current inside-first default is
  good.

Fix:

- Expand `ProjectOptimizationSettings` intentionally:
  `enabled`, `orderBy`, `cutInnerShapesFirst`, `reduceTravelMoves`,
  `chooseBestStartPoint`, `chooseBestDirection`, `removeOverlappingLines`,
  and later `hideBacklash`/`reduceDirectionChanges`.

### F-8 Cut Settings model is still missing Offset Fill, Sub-Layers, Air, and names

Severity: P1
Confidence: high

Files:

- `src/core/scene/layer.ts`
- `src/ui/layers/CutSettingsDialog.tsx`

Trigger:

- Try to set up a LightBurn-style layer with Offset Fill, multiple operations
  on the same color, named layers, or Air Assist.

Failure mode:

- The model cannot express those settings.

Consequence:

- Important LightBurn workflows cannot be represented or serialized.

Fix:

- Add layer names first.
- Add air-assist as a no-op-capable setting with device support flags.
- Treat Offset Fill and Sub-Layers as larger schema changes that need separate
  ADRs and migration tests.

### F-9 Console and Fire workflows are missing

Severity: P1
Confidence: high

Files:

- `src/ui/state/laser-store.ts`
- `src/ui/laser/LaserWindow.tsx`
- `src/ui/laser/LaserLog.tsx`

Trigger:

- Need to query `$I`, `$$`, `$#`, send `$X`, adjust GRBL settings, run macros,
  or test low-power focus/framing.

Failure mode:

- LaserLog is read-only. The store exposes specific commands but no direct
  command input. No Fire/Test Fire UI exists.

Consequence:

- Operators still need LightBurn/LaserGRBL for common setup and focusing tasks.

Fix:

- Design a guarded Console with allowlisted safe quick commands and explicit
  raw-command warnings.
- Design Fire as an opt-in device setting with low default power, hold-to-fire
  behavior, and active-job lockout.

### F-10 Hotkey parity conflict: Ctrl+E

Severity: P2
Confidence: high

Files:

- `src/ui/commands/command-families.ts`
- `src/ui/common/Toolbar.tsx`

Trigger:

- A LightBurn-trained user presses `Ctrl+E`.

Failure mode:

- LaserForge maps `Ctrl+E` to Save G-code. LightBurn uses `Ctrl+E` for Ellipse
  and `Alt+Shift+L` for Save As GCode.

Consequence:

- This will become more painful once drawing tools are added.

Fix:

- Before adding shape tools, remap Save G-code to a LightBurn-compatible
  shortcut or make it configurable.

### F-11 Shape/design workflow is still far below LightBurn

Severity: P1 broad parity
Confidence: high

Files:

- `src/ui/commands/command-types.ts`
- `src/core/scene/scene-object.ts`
- `src/ui/state/store.ts`
- `src/ui/workspace/drag-state.ts`

Trigger:

- Try to draw a sign, align objects, create arrays, group/ungroup, edit nodes,
  use clipboard, or batch keychains from scratch.

Failure mode:

- LaserForge has text/import/trace/bitmap/flip/duplicate/delete, but lacks most
  design and production-layout tools.

Consequence:

- The app is strong for import/configure/burn but not yet a LightBurn-class
  design environment.

Fix:

- Follow the roadmap order:
  shape primitives, selection/marquee/clipboard, align/distribute, arrays,
  grouping, node editing, booleans/offsets.

## Rejected Or Adjusted Findings

These should not be handed to Claude as-is:

1. "Cross-Hatch UI missing" - false/stale. It exists in
   `CutSettingsDialog.tsx`.
2. "Same-layer Fill overlap double-burns" - false as stated. Same-layer fill
   partial overlap is covered by `compile-job-fill.test.ts`. The remaining
   overlap issue is Line/Cut duplicate shared edges.
3. "S-value scaling is a blocker" - rejected. Existing scaling uses device
   `maxPowerS` and is tested.
4. "Default power/speed are fidelity blockers" - rejected. LightBurn defaults
   are device/material/library dependent.
5. "Native alert/confirm blocks active jobs" - rejected. Current
   `job-aware-dialogs.ts` blocks native dialogs while a job is active and has
   tests.
6. "Photo/Detailed trace presets still create bitmap-like trace output" -
   stale. Those presets are no longer surfaced as vector trace presets.

## Priority Fix Plan

### Batch 1 - Small correctness fixes

1. Fix the `too-large` Start tooltip.
2. Add a test for the tooltip copy.
3. Decide the Save G-code hotkey before drawing tools make `Ctrl+E` valuable.

### Batch 2 - Freeze prevention

1. Add bounds-only Frame preparation.
2. Add Preview complexity guard.
3. Add worker-backed or cancellable preview preparation for complex vector/fill
   jobs.

### Batch 3 - Calibration workflow

1. Add Material Test labels and universal-setting header labels.
2. Add Interval Test labels.
3. Add Interval Test Dithered Image mode.
4. Add generated-test provenance metadata.

### Batch 4 - LightBurn cut/planner parity

1. Expand Optimization Settings schema and UI.
2. Add Remove Overlapping Lines for Line/Cut duplicate geometry.
3. Add per-layer Constant Power / dynamic power choice.
4. Add layer names and Air Assist fields.

### Batch 5 - Operator loop

1. Add guarded Console.
2. Add macros later, after Console safety policy is stable.
3. Add opt-in hold-to-fire Fire/Test Fire.
4. Add saved positions and finish position.

### Batch 6 - Design tool breadth

1. Shape primitives.
2. Marquee selection and clipboard.
3. Align/distribute.
4. Array tools.
5. Group/ungroup.
6. Node editing and path operations.

## Current Best Rating

LaserForge 2.0 is mechanically healthy and good at its current target workflow:
import, configure, preview, preflight, and burn on GRBL. It is not yet
LightBurn-level for full design, planner control, calibration tooling, and
machine-management workflow.

Current adjudicated rating:

- Code/build/test health: 9 / 10
- Implemented output-path fidelity: 7 / 10
- Full LightBurn workflow parity: 4.5 / 10
- Practical current product score: 7.8 / 10

The next real climb is not more generic code cleanup. It is closing the P1
workflow gaps above with hardware-safe, separately verified changes.

## Re-audit Checklist

After writing this file, run:

1. `corepack pnpm exec prettier --write audit/LIGHTBURN-FIDELITY-CODEX-ADJUDICATION-2026-06-13.md`
2. Re-read this file to ensure the report did not inherit stale Claude claims.
3. `corepack pnpm format:check`
4. `git status --short --branch`

## Re-audit Result

Completed after writing this report:

1. `corepack pnpm exec prettier --write audit/LIGHTBURN-FIDELITY-CODEX-ADJUDICATION-2026-06-13.md`
   exited 0.
2. Re-read the report headings, finding statuses, rejected findings, priority
   plan, and final rating.
3. `corepack pnpm exec prettier --check audit/LIGHTBURN-FIDELITY-CODEX-ADJUDICATION-2026-06-13.md`
   exited 0.
4. `corepack pnpm format:check` exited 0.
5. `git status --short --branch` showed this report and Claude's source audit
   as untracked audit artifacts. No production source files were changed by this
   adjudication pass.
