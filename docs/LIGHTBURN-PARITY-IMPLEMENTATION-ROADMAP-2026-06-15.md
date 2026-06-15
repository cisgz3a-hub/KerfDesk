# LightBurn Parity Implementation Roadmap

Date: 2026-06-15
Repo: LaserForge-2.0
Status: planning document, no production code changes

## Goal

Plan how LaserForge should close the LightBurn feature gap without turning the
codebase into one large, fragile patch. The source feature inventory is
`audit/reports/lightburn-feature-gap-list-2026-06-15.md`, which lists 192
LightBurn-documented features and marks each as Built, Partial, Missing, or Not
current scope.

## Research Baseline

Official LightBurn docs used:

- Tools and Features index:
  <https://docs.lightburnsoftware.com/2.1/Reference/>
- Tools menu:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/ToolsMenu/>
- Laser Tools menu:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/LaserToolsMenu/>
- Cuts / Layers:
  <https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/>
- Cut Settings Editor:
  <https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/>
- Console:
  <https://docs.lightburnsoftware.com/2.1/Reference/ConsoleWindow/>
- Machine Settings:
  <https://docs.lightburnsoftware.com/2.1/Reference/MachineSettings/>
- Device Settings:
  <https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/>
- Optimization Settings:
  <https://docs.lightburnsoftware.com/2.1/Reference/OptimizationSettings/>
- Trace Image:
  <https://docs.lightburnsoftware.com/2.1/Reference/TraceImage/>
- Convert to Bitmap:
  <https://docs.lightburnsoftware.com/2.1/Reference/ConvertToBitmap/>
- Apply Mask to Image:
  <https://docs.lightburnsoftware.com/2.1/Reference/ApplyMaskToImage/>
- Material Test:
  <https://docs.lightburnsoftware.com/2.1/Reference/MaterialTest/>
- Interval Test:
  <https://docs.lightburnsoftware.com/2.1/Reference/IntervalTest/>
- Focus Test:
  <https://docs.lightburnsoftware.com/2.1/Reference/FocusTest/>
- Print and Cut:
  <https://docs.lightburnsoftware.com/2.1/Reference/PrintAndCut/>
- Rotary Mode for GCode:
  <https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/>
- Camera Lens Calibration:
  <https://docs.lightburnsoftware.com/2.1/Reference/Cameras/Calibration/>
- Tooltips and Topic-Aware Help:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/Tooltips/>

Local project documents used:

- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`
- `audit/reports/lightburn-feature-gap-list-2026-06-15.md`
- existing LightBurn parity reports and superpowers plans under `audit/` and
  `docs/superpowers/plans/`

## Product Boundary

LaserForge's own `PROJECT.md` says the product is a focused LightBurn-style app
for GRBL laser cutters and engravers. It also says LaserForge deliberately does
not copy LightBurn's full controller fan-out. Therefore this roadmap separates:

1. Core GRBL diode parity that should be built.
2. Useful LightBurn workflow parity that can be built after core safety and
   output quality are stable.
3. Advanced modes that require explicit product-scope approval.
4. LightBurn features that are not current scope.

## Implementation Rules

Every lane below must follow these rules before code is touched:

1. Write or update a focused workflow spec first.
2. Write failing tests before implementation.
3. Keep each slice small enough to review independently.
4. Keep preview, save G-code, frame, and start paths on the same preflight truth.
5. Add hardware verification checklists for anything that can move the machine
   or change laser output.
6. Avoid new runtime dependencies unless ADR-017 research is complete: license,
   maintenance, browser/Electron compatibility, bundle impact, and CVE status.
7. Commit after each tested slice, not after a giant lane.

## Full Feature Backlog by Implementation Lane

The numbers below refer to the 192-item feature list in
`audit/reports/lightburn-feature-gap-list-2026-06-15.md`.

### Lane 0 - Stabilize Current Work

Feature numbers: 13, 15, 16, 19, 56, 57, 73, 74, 113-120, 186-190.

Purpose: make sure today's working app stays stable before adding breadth.

Why first:

- The worktree already contains active align/distribute and bug-hunt changes.
- Output safety cannot regress while adding LightBurn parity.
- Preview, frame, save, and start must remain aligned.

Implementation plan:

1. Audit the dirty worktree and separate finished work from WIP.
2. Run focused tests for selection transform, align/distribute, shortcuts,
   previewable content, deletion, G-code preflight, and laser store.
3. Run full gates: typecheck, lint, format, tests, build.
4. Commit the current stable checkpoint before starting new features.

Verification:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm format:check`
- `corepack pnpm test`
- `corepack pnpm build:web`

### Lane 1 - App-Wide Help and Tooltip Layer

Feature numbers: 179, 180, plus tooltip coverage for all visible controls.

LightBurn basis:

- LightBurn documents tooltips as short explanations of tool actions.
- LightBurn also documents topic-aware help: F1 while hovering opens the
  relevant help topic.

Why early:

- The user explicitly requested hover explanation for every button/function.
- It is low machine-risk.
- It improves testing and support before deeper machine-management features.

Architecture:

- Add a central `HelpTopic` registry keyed by command/control id.
- Every command in `src/ui/commands/` gets a tooltip string and optional help URL.
- UI controls read from the registry rather than inventing local title strings.
- Add a lightweight tooltip component that works for buttons, inputs, menus, and
  disabled controls.
- Add optional F1 topic-aware help later; first slice is hover text only.

Likely files:

- `src/ui/help/help-topics.ts`
- `src/ui/help/HelpTooltip.tsx`
- `src/ui/help/help-topics.test.ts`
- `src/ui/commands/command-types.ts`
- `src/ui/commands/command-families.ts`
- toolbar, layer, laser, device, trace, raster, material library components

Tests:

- Command registry exposes non-empty tooltip text for every command.
- Disabled commands still expose useful tooltip text.
- Tooltip component renders on hover/focus.
- No visible control without a `title`, `aria-label`, or help registry entry in
  the audited UI surface.

### Lane 2 - GRBL Console and Controller Diagnostics

Feature numbers: 151-162, especially 153, 155, 161, 162.

LightBurn basis:

- LightBurn Console displays controller messages and commands sent to the
  controller.
- It allows direct GCode/GRBL command input for directly connected GCode lasers.
- LightBurn Machine Settings can read, write, save, and load controller
  firmware settings.

Why early:

- Recent GRBL4040 issues required manual `$X`, `$32=1`, `$22=0`, `$30=1000`,
  `$130=400`, `$131=400`, and `$$`.
- Without a console, every controller-specific issue becomes blind debugging.

Architecture:

- Introduce a serial transcript store: timestamp, direction, line, parsed kind.
- Capture every line sent and received by the GRBL adapter.
- Add a docked Console panel with filter, copy, clear, and command input.
- Restrict direct command input while a job is running.
- Add guarded quick actions for `$X`, `$$`, `$#`, `$I`, `$G`, and `?`.

Likely files:

- `src/core/controllers/grbl/console-command.ts`
- `src/ui/laser/ConsolePanel.tsx`
- `src/ui/laser/console-store.ts`
- `src/ui/laser/ConsolePanel.test.tsx`
- `src/ui/state/laser-store.ts`
- `src/platform/*/serial` adapter logging hooks

Tests:

- Sending `$X` from console routes through the same write path as unlock.
- Console refuses direct input during active streaming.
- Transcript records outbound and inbound lines in order.
- Error/alarm/status messages are classified without dropping raw text.

Hardware verification:

- Connect Falcon and GRBL4040.
- Verify startup banner appears.
- Run `$$`, `$#`, `$I`, `$G`, `?`.
- Verify direct commands are blocked during a running job.

### Lane 3 - Safe Machine Settings Editor

Feature numbers: 151-154, 159, 161-162.

LightBurn basis:

- LightBurn Machine Settings views and edits firmware settings.
- It recommends backing up settings before modifications.
- It warns that vendor/manufacturer settings should generally be left alone.

Why after Console:

- Console is the raw evidence stream.
- Machine Settings is a structured UI over the same GRBL settings.

Architecture:

- Parse `$$` output into typed GRBL settings rows.
- Add read-only first: code, name, value, unit, explanation, source.
- Add backup export as `.lfgrbl-settings.json`.
- Only after read-only and backup are proven, add write flow for common safe
  settings: `$30`, `$31`, `$32`, `$22`, `$130`, `$131`, `$110`, `$111`.
- Any write requires idle state, confirmation, and immediate re-read.

Likely files:

- `src/core/controllers/grbl/grbl-settings.ts`
- `src/core/controllers/grbl/grbl-settings.test.ts`
- `src/ui/laser/MachineSettingsDialog.tsx`
- `src/ui/laser/MachineSettingsDialog.test.tsx`
- `src/ui/state/grbl-settings-actions.ts`

Tests:

- Parser handles common `$N=value` output.
- Unknown settings remain visible as unknown rows.
- Write is blocked unless connected and idle.
- Backup file contains controller identity and timestamp.
- After a write, the UI re-reads and verifies the new value.

Hardware verification:

- Falcon: read settings, export backup, no write.
- GRBL4040: read settings, verify `$30/$32/$130/$131`.
- Low-risk write test only after backup: change a harmless value and restore.

### Lane 4 - Output Selection and Positioning Parity

Feature numbers: 121-125.

LightBurn basis:

- LightBurn documents Cut Selected Graphics and Use Selection Origin for
  preview, frame, start, send, and save.
- LightBurn documents Position Laser, Set Start Point, and Move Laser to
  Selection.

Why before bigger geometry work:

- It uses existing selection and output pipeline.
- It affects preview/frame/start/save, so it must be made before advanced
  object workflows multiply output cases.

Architecture:

- Add output filter options to project/session state.
- Compile selected-only jobs through the same job compiler using an explicit
  selection filter.
- Use Selection Origin changes origin calculation only; it must not move source
  geometry.
- Preview must show exactly what Save/Frame/Start will output.

Likely files:

- `src/core/job/compile-job.ts`
- `src/core/preflight/`
- `src/ui/laser/JobControls.tsx`
- `src/ui/preview/`
- `src/ui/state/store.ts`

Tests:

- Preview only includes selected objects when enabled.
- Save G-code emits selected objects only.
- Empty selection with selected-only enabled warns and blocks.
- Use Selection Origin changes emitted origin math without changing scene.

### Lane 5 - Preview Parity and Recovery Tools

Feature numbers: 113-114 and preview-related LightBurn controls.

LightBurn basis:

- LightBurn Preview is the accurate representation of what is sent to the laser.
- It shows cut moves, traversal moves, time slider, job statistics, preview
  settings, Start Here, Save Image, and playback.

Architecture:

- Keep preview data generated from the same plan/output representation used by
  save/start.
- Add traversal toggle, shade-by-power toggle, estimated distance/time panels.
- Defer Start Here until resume semantics are safety-audited.
- Add Save Preview Image only after preview render is deterministic.

Tests:

- Travel toggle hides only travel visualization, not output generation.
- Estimated cut/rapid distances match parsed emitted G-code.
- Preview stays aligned with output after selected-only, fill, image, and trace
  operations.

### Lane 6 - Full GRBL Cut Settings Editor

Feature numbers: 91-111, excluding galvo-only 112.

LightBurn basis:

- LightBurn Cut Settings Editor has shared settings, Line, Fill, Offset Fill,
  Image, Sub-Layers, and Default Layer Settings.
- LightBurn Cuts/Layers exposes abbreviated settings and opens the full editor
  for all settings.
- Offset Fill fills closed shapes using contour-following lines rather than
  parallel scanlines.

Architecture:

- Split current layer rows into brief row controls plus full CSE dialog.
- Keep `Layer` as the persistent model, but add a versioned settings object per
  mode.
- Add settings in safe batches:
  1. shared editor shell and row double-click behavior;
  2. line/fill/image parity fields;
  3. default layer settings;
  4. kerf compensation;
  5. tabs/bridges;
  6. air assist metadata and optional M-code mapping;
  7. Offset Fill mode;
  8. sub-layers.

Dependency research:

- Offset Fill and booleans may require a polygon offset/clipping library.
- Candidate libraries must pass ADR-017 and be tested against browser/Electron.
- GPL/LGPL geometry libraries are rejected.

Tests:

- Every layer setting round-trips through `.lf2`.
- Changing a setting affects preview and emitted output consistently.
- Offset Fill rejects open shapes and fills closed contours.
- Kerf compensation visibly offsets line geometry and preserves bounds checks.
- Tabs/bridges suppress laser-on segments exactly where configured.

Hardware verification:

- Small line cut with kerf off/on.
- Tabbed cut on scrap.
- Offset fill on a circle and rectangle.
- Air-assist command disabled by default; only test if hardware supports it.

### Lane 7 - Raster Quality and Calibration

Feature numbers: 81, 88-90, 127-134, 150, 191-192.

LightBurn basis:

- Adjust Image combines image settings, layer settings, and instant preview.
- Interval Test finds optimal line interval.
- Material Test varies speed/power/interval/passes.
- Focus Test identifies focal height when Z-axis control is available.
- LightBurn troubleshooting covers poor image quality, inconsistent engraving,
  low/no power, scanning artifacts, and dark edges.

Architecture:

- Add scanning offset calibration before more raster polish.
- Add image-quality diagnostics panel: material, lens focus, speed/power,
  line interval, bidirectional offset, `$30/$32`, and overscan.
- Polish Material Test and Interval Test to save/read presets.
- Add Focus Test only for devices with controllable Z support.
- Keep photo tuning in Adjust Image, not Trace Image.

Tests:

- Scanning offset shifts alternating rows only in preview/output.
- Interval Test generated scene labels match emitted settings.
- Material Test generated scene labels match row/column settings.
- Presets apply deterministic layer settings.
- Focus Test is hidden/blocked when Z is not supported.

Hardware verification:

- Falcon photo test with scanning offset.
- GRBL4040 material grid at known `$30/$32` settings.
- Interval test on the same material at fixed speed/power.

### Lane 8 - Image Tool Completion

Feature numbers: 82-87.

LightBurn basis:

- Apply Mask to Image hides image regions using closed vector masks.
- Crop Image bakes the mask.
- Convert to Bitmap deletes the source vector and creates an Image Mode bitmap.
- Trace Image exposes vector-trace controls; Multi-File Trace writes traced SVGs.
- Save Processed Bitmap exports adjusted/dithered image output.

Architecture:

- Implement non-destructive image masks before destructive crop.
- Masks should be scene objects, not direct pixel edits, until Crop/Flatten.
- Save Processed Bitmap must export the exact adjusted/dithered output.
- Multi-File Trace should run outside the active scene first: batch image to SVG
  files, no workspace mutation.

Tests:

- Masked image preview and emitted raster omit masked pixels.
- Remove mask restores full image.
- Crop bakes pixel data and cannot be unmasked except undo.
- Save Processed Bitmap matches the raster processor output.
- Multi-File Trace produces one SVG per source and does not block UI.

### Lane 9 - Core Workspace Productivity

Feature numbers: 8-14, 17-27, 32-43, 75-80, 171-178.

LightBurn basis:

- LightBurn has clipboard tools, grouping, locking, snapping, automatic
  guidelines, status bar, hotkeys, preferences, and project notes.

Architecture:

- Add clipboard copy/cut/paste before grouping.
- Add group/ungroup as a `group` SceneObject or a selection container; choose
  only after a separate design doc because it affects serialization and compile.
- Add lock state at object/layer level before complex selection workflows.
- Add snapping/guides after transform math is stable.
- Add Show Notes as project metadata.
- Add hotkey editor only after command registry coverage is complete.

Tests:

- Clipboard round-trips all current SceneObject variants.
- Group transform compiles the same geometry as ungrouped transform.
- Locked object cannot be selected or transformed by normal tools.
- Snapping does not move objects unless enabled.
- Project notes round-trip through `.lf2`.

### Lane 10 - Vector Geometry Kernel

Feature numbers: 44-72.

LightBurn basis:

- LightBurn has node editing, path repair, offset, booleans, arrays, fillets,
  resize slots, copy along path, and text-on-path.

Why late:

- This is the highest algorithmic risk.
- It likely needs new geometry dependencies.
- It touches import, drawing, text, selection, preview, compile, and output.

Architecture:

- First build a path object representation that can be edited without losing
  source semantics.
- Add node editing before booleans/offsets.
- Add repair tools: close path, auto-join, delete duplicates, break apart.
- Evaluate a polygon clipping/offset library under ADR-017.
- Add offset and boolean operations only after the geometry kernel is stable.
- Add arrays and copy-along-path after object duplication and grouping are
  reliable.

Tests:

- Geometry operations are pure and deterministic.
- Every operation preserves valid bounds and layer assignment.
- Boolean operations have golden SVG/path fixtures.
- Offset operations handle holes and self-intersections predictably.
- Node editor commits one undo step per edit.

### Lane 11 - Advanced GRBL Modes if Approved

Feature numbers: 135, 138, 143, 149.

LightBurn basis:

- Print and Cut aligns output to physical registration marks.
- GCode Rotary maps one axis to rotational motion.
- Center Finder and red-dot offset workflows help physical alignment.

Scope note:

- These are useful for diode users, but each affects real machine positioning.
- They need explicit approval and hardware availability.

Implementation order:

1. Red-dot pointer offset setup.
2. Center Finder.
3. Print and Cut wizard.
4. GCode rotary setup.

Hardware verification:

- Cannot be called complete without physical tests on the exact hardware class.

### Lane 12 - Cameras if Approved

Feature numbers: 163-170.

LightBurn basis:

- LightBurn 2.1 camera workflow includes camera selection, lens calibration,
  alignment, overlays, head-mounted cameras, and background capture.

Scope note:

- This is a major subsystem, not a quick feature.
- It needs camera permissions, calibration math, image capture, overlay
  rendering, and machine motion integration.

Implementation order:

1. Research camera APIs and permissions for browser/Electron.
2. Add a static background image overlay first.
3. Add manual camera capture.
4. Add lens calibration.
5. Add bed alignment.
6. Add head-mounted capture only after safe motion planning.

### Lane 13 - Explicitly Defer or Reject for Current Product

Feature numbers: 9, 112, 126, 136-137, 139-142, 144-148, 156-158, 181-185.

Examples:

- New Window / multiple instances.
- Galvo cut settings and Galvo Framing.
- DSP rotary and Galvo rotary.
- Repeat Marking, Split Marking, Feeder Setup.
- Cylinder Correction, Taper Warp, Galvo Lens Calibration.
- Dual Laser Control.
- File List Window for controller-side storage.
- LightBurn Bridge.
- License management, CorelDRAW macro, UDP automation.

Rule:

- Do not build these opportunistically. If the user wants one, create a new
  product-scope ADR first.

## Recommended First Three Implementation Slices

### Slice 1 - Tooltips and help registry

Why:

- Low machine risk.
- Directly requested.
- Improves every following workflow.

Definition of done:

- Every command and visible toolbar/menu button has a tooltip.
- Disabled controls explain why they are disabled.
- At least command/menu/toolbar coverage is test-enforced.

### Slice 2 - GRBL Console

Why:

- Directly supports GRBL4040 debugging.
- Matches LightBurn's direct connected GCode workflow.
- Gives evidence for every future machine-setting and controller issue.

Definition of done:

- Console shows sent/received lines.
- User can send safe direct commands while idle.
- Commands are blocked during jobs.
- `$X`, `$$`, `$#`, `$I`, `$G`, `?` are easy actions.

### Slice 3 - Read-only Machine Settings and backup

Why:

- The GT/GRBL4040 setup issue shows this is needed.
- Read-only plus backup is safer than immediately adding write controls.

Implementation status:

- Implemented in Lane 3 as a read-only Machine Settings panel.
- Firmware writes remain deferred until read/export is hardware-verified.

Definition of done:

- `$$` parses into settings rows.
- Settings can be exported as a backup file.
- Unknown settings remain visible.
- No write controls until the read-only UI is verified on hardware.

## Long-Term Build Order

1. Lane 0: stabilize current work and commit a green checkpoint.
2. Lane 1: app-wide tooltips and help registry.
3. Lane 2: GRBL Console.
4. Lane 3: read-only Machine Settings plus backup.
5. Lane 4: selected-output and positioning parity.
6. Lane 5: preview parity and estimates.
7. Lane 6: full GRBL Cut Settings Editor.
8. Lane 7: raster calibration and burn-quality diagnostics.
9. Lane 8: image tool completion.
10. Lane 9: workspace productivity.
11. Lane 10: vector geometry kernel.
12. Lane 11: advanced GRBL modes, only if approved.
13. Lane 12: cameras, only if approved.
14. Lane 13: explicit defer/reject list stays out until product scope changes.

## Audit Gates for Every Slice

Each implementation slice must end with:

1. Focused unit tests for the exact behavior.
2. Any required UI tests.
3. Any required G-code snapshot or invariant tests.
4. `corepack pnpm typecheck`
5. `corepack pnpm lint`
6. `corepack pnpm format:check`
7. Focused test command.
8. Broader `corepack pnpm test` when output, scene, or state boundaries change.
9. Browser smoke test when UI changed.
10. Hardware checklist when motion, serial, GRBL settings, or laser output
    changed.

## Open Scope Decision Needed

Before implementation beyond the first three slices, decide this product target:

1. Focused GRBL diode replacement for the most-used LightBurn workflows.
2. Broad LightBurn clone for GRBL diode users.
3. Full LightBurn-style competitor across GRBL, rotary, camera, galvo, and
   advanced hardware workflows.

Recommendation: choose option 1 until the core GRBL diode workflow is excellent.
Then selectively approve option-2 features that real users ask for.
