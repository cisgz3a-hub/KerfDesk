# Rayforge side-by-side audit - 2026-06-16

## Scope

This is a read-only side-by-side product and architecture audit of LaserForge
against the local Rayforge reference checkout.

- LaserForge target: `C:\Users\Asus\LaserForge-2.0`
- LaserForge branch: `codex/lane-6e-tabs-bridges`
- LaserForge committed HEAD: `5fadd09`
- LaserForge working tree included: yes. This includes the uncommitted
  Machine Setup dialog split currently in progress.
- Rayforge target: `references/rayforge-main`
- Rayforge version: tag `1.8.0`, commit `13f49ec3`
- Excluded: `C:\Users\Asus\LaserForge`, because that folder is not currently a
  git checkout on this machine.

This audit compares what is present in source, docs, bundled resources, and
tests. It does not run either laser on hardware and does not claim burn-quality
parity unless the repo evidence already says that has been verified.

## Rating scale

Ratings are 1 to 5.

- 5 = broad, mature, first-class, and durable in the model/workflow
- 4 = solid implementation with clear tests or production integration
- 3 = present but narrower, newer, or missing important UX/details
- 2 = partial or mostly diagnostic/planned
- 1 = absent

The "winner" is per category, not a total product verdict. Rayforge intentionally
has a wider machine/workflow surface. LaserForge intentionally has a narrower
GRBL + LightBurn-style target with stricter TypeScript/core/test discipline.

## Executive verdict

Rayforge is better today if the goal is broad machine compatibility, durable
machine setup, controller/device setting management, profile import/export,
rotary/camera/no-go-zone support, addons, and many import formats.

LaserForge is better today if the goal is a focused browser + Windows GRBL app
with a small proprietary codebase, strong pure-core boundaries, deterministic
G-code, property/snapshot tests, Cloudflare web deployment, and a workflow aimed
directly at LightBurn-style diode/GRBL operators.

The biggest LaserForge gap is not "the app cannot burn." The gap is that
machine configuration is still too narrow compared with Rayforge:

1. No real device profile catalog.
2. No Rayforge-style profile import/export or LightBurn `.lbdev` import.
3. No guarded firmware setting editor/write workflow.
4. No first-class rotary/camera/no-go-zone model.
5. No multi-driver/controller layer beyond GRBL.
6. No external/custom dialect editor.
7. Less mature materials/recipes and addon ecosystem.

The biggest LaserForge advantage is correctness discipline:

1. Pure TypeScript `core/` pipeline.
2. Strict module boundaries.
3. Heavy co-located Vitest coverage.
4. Snapshot/property tests for output invariants.
5. Local-only/no-telemetry posture.
6. Simpler, safer GRBL-only scope.

## Scorecard

| Category | LaserForge | Rayforge | Better | Why |
|---|---:|---:|---|---|
| Product fit to LaserForge's stated goal | 5.0 | 4.0 | LaserForge | LaserForge is deliberately focused on LightBurn-style GRBL web/Windows workflow; Rayforge is broader but less aligned to that exact target. |
| Device/controller support breadth | 2.5 | 5.0 | Rayforge | Rayforge ships 31 device profiles and driver families for GRBL, Marlin, OctoPrint, and Ruida. LaserForge is GRBL-only by ADR. |
| Device profile depth | 3.5 | 5.0 | Rayforge | LaserForge now has compatibility fields; Rayforge persists axes, heads, dialects, cameras, rotary, no-go zones, hooks/macros, driver args. |
| Controller probing/diagnostics | 3.8 | 4.5 | Rayforge | LaserForge probes `$I`, `$$`, `$#`, `$G`, status and suggests local profile patches. Rayforge has GRBL probing plus profile creation flow. |
| Controller settings management | 2.5 | 4.5 | Rayforge | LaserForge reads/exports settings only. Rayforge reads and writes device settings through guarded driver support. |
| G-code dialect configurability | 3.5 | 5.0 | Rayforge | LaserForge has structured profile fields. Rayforge has editable/custom dialect templates and device-bundled dialect YAML. |
| Streaming/transports | 4.0 | 4.5 | Rayforge | LaserForge has char-counted and ping-pong GRBL streaming. Rayforge adds serial/network/UDP/telnet/HTTP style transport breadth. |
| Power model | 3.8 | 5.0 | Rayforge | LaserForge has S scaling, min power, M3/M4, air assist, raster grayscale. Rayforge adds multi-laser heads, spot size, PWM, pulse-width, tool changes. |
| Layer/CAM operation settings | 4.3 | 4.7 | Rayforge | LaserForge has line/fill/image, kerf, tabs, air, fill/image controls. Rayforge has capability-driven cut/engrave/score/material/PWM/post processors. |
| Vector cut/line output | 4.5 | 4.5 | Tie | Both have mature line/cut concepts. LaserForge has stronger snapshot/property evidence; Rayforge has broader pipeline transforms. |
| Fill/raster/image workflow | 4.4 | 4.6 | Rayforge | LaserForge has true image-mode raster and fill, but hardware burn is still pending for some parts. Rayforge exposes more raster power/depth controls. |
| Trace/vectorization | 4.0 | 4.0 | Tie | LaserForge has trace, centerline work, perceptual fixtures. Rayforge has broader import normalization/tracing stack. |
| Drawing/design tools | 3.5 | 4.8 | Rayforge | LaserForge has rectangle/ellipse/polygon/polyline/pen in progress. Rayforge's sketcher addon has richer entity and constraint tooling. |
| Materials/recipes/calibration | 3.6 | 5.0 | Rayforge | LaserForge has `.lfml.json`, material/interval grids, recipes. Rayforge ships 68 material YAML files plus materials/recipes managers. |
| Live operation UI | 4.0 | 4.5 | Rayforge | LaserForge has Laser window, jog, status, console, job controls. Rayforge separates controls/console/laser widgets with richer machine model hooks. |
| Machine setup UX placement | 4.0 | 5.0 | Rayforge | LaserForge's new Machine Setup dialog is the right direction. Rayforge already has full settings hierarchy and machine-detail pages. |
| Safety/preflight | 4.7 | 4.2 | LaserForge | LaserForge's invariants and Start/Frame gates are explicit and test-heavy. Rayforge has sanity checks for workarea/extents/no-go zones. |
| Import/export breadth | 3.0 | 5.0 | Rayforge | LaserForge handles SVG/images/.lf2/.lfml/G-code. Rayforge has SVG, PNG/JPG/BMP, DXF, PDF, LightBurn, Ruida, profile zip, `.lbdev`, SVG export. |
| Architecture maintainability | 5.0 | 4.0 | LaserForge | LaserForge is stricter: pure core, boundaries, file caps, strict TS, discriminated unions. Rayforge is larger and more feature-rich but less narrow. |
| Extensibility/addons | 2.0 | 5.0 | Rayforge | Rayforge has builtin addons and registration hooks. LaserForge intentionally has no plugin/macro/addon surface. |
| Web deployment | 5.0 | 1.5 | LaserForge | LaserForge is Vite web + WebSerial + Cloudflare Pages. Rayforge is GTK/Python desktop-oriented. |
| Desktop/platform breadth | 3.0 | 4.0 | Rayforge | LaserForge targets Windows Electron plus web. Rayforge's GTK app and drivers are broader in desktop CNC/CAM style. |
| Documentation/spec discipline | 4.8 | 3.8 | LaserForge | LaserForge's PROJECT/DECISIONS/WORKFLOW/AUDIT docs are unusually explicit. Rayforge is discoverable from code/resources but less spec-driven here. |
| Hardware verification evidence in this audit | 3.0 | 3.0 | Tie | Neither side was hardware-run in this audit. LaserForge docs clearly mark pending burn verification. |

Rough weighted read: Rayforge is the better broad CAM/machine platform today.
LaserForge is the better focused, test-disciplined GRBL web/Windows product
foundation.

## Detailed comparison

### 1. Device and controller support

LaserForge has:

- One controller family by product decision: GRBL v1.1+.
- A default Creality/Falcon-compatible profile shape with machine compatibility
  metadata.
- Profile fields for controller kind, streaming mode, poll cadence, RX buffer,
  WCS support, homing-before-job, laser mode, min/max S, gcode dialect knobs,
  and air assist command.
- Source evidence:
  - `PROJECT.md` says LaserForge is focused on GRBL and explicitly excludes
    non-GRBL controllers.
  - `src/core/devices/device-profile.ts` defines controller/dialect/laser
    compatibility fields.
  - `src/io/project/deserialize-project.ts` back-fills compatibility fields
    for older `.lf2` files.

Rayforge has:

- 31 bundled device profile directories under
  `references/rayforge-main/rayforge/resources/devices`.
- Driver folders for `grbl`, `marlin`, `octoprint`, and `ruida`.
- Generic profiles for GRBL, Smoothieware, and Ruida.
- Real vendor profiles, including Creality Falcon, Ortur, Sculpfun, Atomstack,
  xTool, Longer, NEJE, TwoTrees, OMTech, Thunder Laser, Monport, and others.
- Source evidence:
  - `rayforge/resources/devices/*/device.yaml`
  - `rayforge/machine/driver/grbl`
  - `rayforge/machine/driver/marlin`
  - `rayforge/machine/driver/octoprint`
  - `rayforge/machine/driver/ruida`

Winner: Rayforge.

LaserForge should not chase every controller immediately. The sensible next
step is a Rayforge-style profile catalog for GRBL-class machines first, then
only add additional controller strategies when LaserForge's GRBL safety gates
are stable.

### 2. Machine profile model

LaserForge has:

- Bed size, max feed, accel, junction deviation, framing feed.
- GRBL max/min S, `$32` laser mode expectation, air assist command.
- Homing enabled/direction.
- Controller metadata: baud, RX buffer, streaming mode, poll cadence,
  status-buffer report support, WCS support, safe-mode default.
- G-code dialect metadata: dialect id, return-to-origin, S-on-travel,
  S-on-every-burn, modal feedrate, laser mode command.
- A diagnostic-to-local-profile suggestion path in the current working tree.

Rayforge has:

- Machine axes, axis extents, workarea, origin, WCS/workarea origin behavior.
- Driver and driver args.
- Multiple laser heads with max power, frame power, spot size, PWM/pulse width.
- Rotary modules.
- Cameras and camera calibration.
- No-go zones.
- Hooks and macros.
- Custom/frozen G-code dialects.
- Device profile import/export.

Source evidence:

- LaserForge: `src/core/devices/device-profile.ts`,
  `src/core/devices/infer-profile-from-diagnostic.ts`,
  `src/ui/laser/MachineProfileSuggestionPanel.tsx`.
- Rayforge: `rayforge/machine/models/machine.py`,
  `rayforge/machine/models/laser.py`,
  `rayforge/machine/models/rotary_module.py`,
  `rayforge/machine/device/profile.py`.

Winner: Rayforge.

Recommended LaserForge build:

1. Add a durable `MachineCapability`/`ControllerCapability` block rather than
   scattering booleans through UI.
2. Add a local profile catalog file format.
3. Add import/export of LaserForge machine profiles.
4. Add LightBurn `.lbdev` import as a review-and-normalize flow, not silent
   trust.

### 3. Machine settings and firmware settings

LaserForge has:

- Read-only GRBL settings read via `$$`.
- Diagnostic probes for `$I`, `$$`, `$#`, `$G`, and status.
- Export backup and export diagnostic bundle.
- UI copy explicitly says it does not write firmware settings.
- Blocking when disconnected, a job is active, a jog/frame operation is active,
  or auto-focus is active.

Rayforge has:

- A Device settings page for "Read or apply settings directly to the device."
- Driver-level `supports_settings`.
- `read_settings` and `write_setting` interfaces.
- GRBL serial drivers with `supports_settings = True`.
- UI state gates on connected/not running and handles `ResourceBusyError`.
- Explicit dangerous-edit warning.

Source evidence:

- LaserForge:
  - `src/ui/laser/MachineSettingsPanel.tsx`
  - `src/ui/state/grbl-settings-actions.ts`
  - `src/ui/state/laser-store-machine-settings.test.ts`
  - `src/ui/state/laser-store-machine-diagnostic.test.ts`
- Rayforge:
  - `rayforge/ui_gtk/machine/device_settings_page.py`
  - `rayforge/machine/driver/driver.py`
  - `rayforge/machine/driver/grbl/grbl_serial.py`
  - `rayforge/machine/driver/grbl/grbl_serial_simple.py`

Winner: Rayforge.

LaserForge's current safer read-only stance is good for this stage. The next
solid step is not a huge settings editor. Build:

1. Search/filter/grouped settings view.
2. "Apply to local profile" for safe profile facts.
3. Firmware write only behind backup + diff + danger confirmation.
4. One setting at a time, with typed validators and rollback instructions.

### 4. Machine setup UX and tab placement

LaserForge has:

- The current working tree replaces inline Laser panel clutter with a compact
  `Machine Setup` entry.
- Machine Setup tabs:
  - Profile
  - Diagnostics
  - Controller
  - Firmware
- Profile suggestion UI applies read-only diagnostic values to the local
  profile, not firmware.

Rayforge has:

- Global Settings window with pages for general settings, machines, materials,
  recipes, AI, addons, and licenses.
- A per-machine settings dialog with pages:
  - General
  - Hardware
  - Advanced
  - G-code
  - Hooks & Macros
  - Device
  - Laser
  - Rotary Module
  - No-Go Zones
  - Camera
  - Maintenance
- A bottom panel separating layers, G-code viewer, console, controls, and laser
  views.

Source evidence:

- LaserForge:
  - `src/ui/laser/LaserWindow.tsx`
  - `src/ui/laser/MachineSetupEntry.tsx`
  - `src/ui/laser/MachineSetupDialog.tsx`
- Rayforge:
  - `rayforge/ui_gtk/settings/settings_dialog.py`
  - `rayforge/ui_gtk/settings/machine_settings_page.py`
  - `rayforge/ui_gtk/machine/settings_dialog.py`

Winner: Rayforge, but LaserForge is now following the correct pattern.

Recommendation: keep only high-frequency live controls in the Laser panel
(connect/status/jog/frame/start/stop/console). Put durable machine/profile/
firmware concerns in Machine Setup. Rayforge validates that split.

### 5. G-code dialects

LaserForge has:

- A GRBL output strategy.
- Structured dialect flags for return-to-origin, S-on-travel, S-on-every-burn,
  modal feedrate, laser mode command, and air assist command.
- M3/M4 mode transitions by group type.
- Air assist M7/M8/M9 support.
- Power scaling against profile `$30`.
- Deterministic G-code output with snapshot/property coverage.

Rayforge has:

- A `GcodeDialect` dataclass with template strings for laser on/off, focus
  laser, tool change, travel/linear/arc moves, air assist, home, jog, alarm
  clear, WCS setting, probe cycle, dwell, preamble, and postscript.
- Built-in dialects for GRBL, GRBL dynamic, GRBL raster, Marlin, Smoothieware,
  LinuxCNC, and Mach4 M67.
- Device-bundled `dialect.yaml` files.
- UI pages for G-code and dialect editing.

Source evidence:

- LaserForge:
  - `src/core/output/grbl-strategy.ts`
  - `src/core/output/gcode-dialect.ts`
  - `src/core/output/grbl-strategy-air-assist.test.ts`
  - `src/core/output/grbl-strategy-machine-compatibility.test.ts`
- Rayforge:
  - `rayforge/machine/models/dialect/base.py`
  - `rayforge/machine/models/dialect/grbl.py`
  - `rayforge/machine/models/dialect/grbl_dynamic.py`
  - `rayforge/machine/models/dialect/grbl_raster.py`
  - `rayforge/machine/models/dialect/marlin.py`
  - `rayforge/machine/models/dialect/smoothieware.py`
  - `rayforge/resources/devices/*/dialect.yaml`

Winner: Rayforge.

LaserForge should copy the idea, not the breadth: make the current dialect
fields data-driven per profile, but keep the actual output path strongly typed.

### 6. Power settings

LaserForge has:

- Layer min power and max power percent.
- Device max power S and min power S.
- M3/M4 laser mode decisions.
- Fill dynamic mode.
- Image grayscale/threshold/Floyd-Steinberg.
- Image line interval/DPI controls.
- Dot-width correction, negative image, pass-through.
- Air assist per layer.
- Kerf offset.
- Automatic hard-skip tabs.
- Material recipes capture these settings.

Rayforge has:

- Capability-driven cut, engrave, score, kerf, material test, and PWM settings.
- Multiple laser heads.
- Per-head max power, frame power, spot size.
- PWM frequency and pulse-width model.
- Raster min/max power, depth modes, power levels, sample interval, line
  interval, scan angle.
- Air assist in operation capabilities and dialects.
- Tool change support.

Source evidence:

- LaserForge:
  - `src/core/scene/layer.ts`
  - `src/ui/layers/CutSettingsCommonFields.tsx`
  - `src/ui/layers/CutSettingsImageFields.tsx`
  - `src/core/material-library/material-library.ts`
- Rayforge:
  - `rayforge/core/capability.py`
  - `rayforge/machine/models/laser.py`
  - `rayforge/ui_gtk/machine/laser_preferences_page.py`
  - `rayforge/builtin_addons/rayforge-addon-laser/laser_essentials/widgets/raster_widget.py`

Winner: Rayforge.

LaserForge's immediate high-value gap is multi-head/PWM metadata, not fancy
UI. Add the model fields only when a real target machine needs them.

### 7. CAM operations and workflow

LaserForge has:

- Line, Fill, and Image layer modes.
- Fill hatch angle/spacing/overscan/bidirectional/cross-hatch.
- Raster image mode with dither/grayscale.
- Convert to Bitmap.
- Trace Image with LightBurn-style control realignment in progress.
- Kerf offset and automatic tabs.
- Material test and interval test generators.
- Cut selected graphics and selection origin support.

Rayforge has:

- Step/capability pipeline: contour, raster, frame, shrinkwrap, material test.
- Post processors: tabs, smooth, overscan, optimize, multipass, merge lines,
  lead-in/out, crop.
- Layer rotary flags and per-layer rotary diameter/module.
- Material and recipe managers.
- G-code viewer/editor integration.

Source evidence:

- LaserForge:
  - `src/core/job/compile-job.ts`
  - `src/core/raster/emit-raster.ts`
  - `src/core/geometry/kerf-offset.ts`
  - `src/core/geometry/tabs-bridges.ts`
  - `src/core/job/material-test-grid.ts`
  - `src/core/job/interval-test-grid.ts`
- Rayforge:
  - `rayforge/core/capability.py`
  - `rayforge/core/layer.py`
  - `rayforge/builtin_addons/rayforge-addon-laser/laser_essentials`
  - `rayforge/builtin_addons/rayforge-addon-post/post_processors`

Winner: slight Rayforge.

LaserForge is not weak here; it is narrower but increasingly complete. The
missing production CAM pieces compared with Rayforge are lead-in/out, crop,
merge-overlap tooling, multipass Z step-down, rotary mapping, and a richer
step/post-processor architecture.

### 8. Drawing and editing

LaserForge has:

- SVG import.
- Text objects.
- Raster images.
- Trace output.
- Shape objects: rectangle, ellipse, polygon, polyline/pen.
- Selection, transform, align/distribute, preview, rulers/grid.
- It still excludes node editing, boolean operations, and a full geometry
  kernel.

Rayforge has:

- Sketcher addon with entities for arc, bezier, circle, ellipse, line, point,
  text box, and constraints.
- Commands for dimensions, constraints, fillet, chamfer, grid, fill,
  construction, rounded rect, straightening, waypoint, etc.
- Tests for sketcher tools.

Source evidence:

- LaserForge:
  - `src/core/shapes`
  - `src/core/scene/scene-object.ts`
  - `src/ui/workspace/ToolStrip.tsx`
  - `PROJECT.md` Phase G and out-of-scope geometry kernel notes
- Rayforge:
  - `rayforge/builtin_addons/rayforge-addon-sketcher/sketcher/core/entities`
  - `rayforge/builtin_addons/rayforge-addon-sketcher/sketcher/core/commands`
  - `rayforge/builtin_addons/rayforge-addon-sketcher/tests`

Winner: Rayforge.

LaserForge should finish the current drawing slice before adding a kernel:
shape selection/edit polish, copy/array/alignment workflows, then evaluate a
geometry library for offsets/booleans/node editing.

### 9. Rotary, camera, no-go zones, macros, hooks

LaserForge has:

- No rotary model.
- No camera model.
- No no-go zones.
- No macros/hooks.
- No plugins/addons.
- These are currently out of scope or deferred in `PROJECT.md`.

Rayforge has:

- Rotary modules in machine model and per-layer rotary flags.
- Camera model, manager, calibration, alignment UI, display widgets.
- No-go zones in machine model and sanity checks.
- Hooks/macros page and macro model.
- Addon/plugin registration hooks and builtin addons.

Source evidence:

- LaserForge:
  - `PROJECT.md` out-of-scope list.
- Rayforge:
  - `rayforge/machine/models/rotary_module.py`
  - `rayforge/core/layer.py`
  - `rayforge/camera`
  - `rayforge/ui_gtk/camera`
  - `rayforge/machine/models/zone.py`
  - `rayforge/machine/models/macro.py`
  - `rayforge/ui_gtk/machine/hooks_macros_page.py`
  - `rayforge/context.py`

Winner: Rayforge.

These are real product gaps if LaserForge is meant to become a broad laser CAM.
They are not urgent if the target remains a focused Falcon/GRBL learning
platform.

### 10. Safety and preflight

LaserForge has:

- Project-level pre-emit preflight.
- Bounds checks.
- Laser-off travel invariants.
- Power-scale invariants.
- Start readiness checks for alarm state, laser mode, custom origin/WCO unknown,
  required homing, controller settings, and selected job origin physical bounds.
- Frame preflight with overscan handling.
- Job intent warnings for uncalibrated defaults.
- Property/snapshot test culture around G-code.

Rayforge has:

- A sanity checker with workarea, machine extent, and no-go-zone checks.
- A UI dialog that distinguishes errors and warnings.
- Machine model support for no-go zones and extents.
- Device settings warnings.

Source evidence:

- LaserForge:
  - `src/core/preflight`
  - `src/ui/laser/start-job-readiness.ts`
  - `src/ui/laser/JobControls.tsx`
  - `src/io/gcode/emit-gcode.snapshot.test.ts`
- Rayforge:
  - `rayforge/machine/sanity`
  - `rayforge/ui_gtk/shared/sanity_check_dialog.py`

Winner: LaserForge.

Rayforge has broader safety concepts through no-go zones and machine extents.
LaserForge is stronger on explicit invariant tests and narrow GRBL preflight
honesty. The ideal is both: Rayforge's no-go-zone model plus LaserForge's
property-tested output guarantees.

### 11. Imports and exports

LaserForge has:

- SVG import.
- PNG/JPG bitmap import.
- Trace Image.
- Convert to Bitmap.
- `.lf2` project save/open.
- `.lfml.json` material library save/load.
- G-code export.
- No DXF/PDF/AI, no LightBurn profile import, no `.clb` compatibility.

Rayforge has:

- Image import folders for BMP, DXF, JPG, LightBurn, PDF, PNG, procedural,
  Ruida, SVG.
- SVG export.
- LightBurn `.lbdev` device profile importer.
- Rayforge profile zip import/export.
- Reimport workflows.

Source evidence:

- LaserForge:
  - `src/io/svg`
  - `src/io/project`
  - `src/io/material-library`
  - `src/ui/app/file-actions.ts`
  - `src/ui/app/material-library-file-actions.ts`
- Rayforge:
  - `rayforge/image/*`
  - `rayforge/machine/device/lightburn_importer.py`
  - `rayforge/ui_gtk/machine/profile_importer.py`
  - `rayforge/ui_gtk/doceditor/import_handler.py`

Winner: Rayforge.

LaserForge's best next imports are not every format. Prioritize:

1. `.lbdev` machine profile import.
2. DXF.
3. LightBurn material `.clb` read-only importer.
4. PDF only after a licensing/renderer review.

### 12. Architecture and maintainability

LaserForge has:

- TypeScript strict mode.
- React/Vite/Zustand.
- Pure `src/core`.
- Enforced module boundaries.
- File-size limits.
- Discriminated unions.
- Co-located tests.
- 259 test files among 614 TS/TSX source/test files in the current tree.
- Prior full-suite verification in this branch passed 1757 tests before this
  audit request.

Rayforge has:

- Python/GTK architecture.
- Larger feature modules.
- Plugin/addon framework.
- Central context managers for machines, dialects, materials, recipes, cameras,
  addons.
- 369 Python test files in the local reference's tests/addon test areas.

Source evidence:

- LaserForge:
  - `CLAUDE.md`
  - `PROJECT.md`
  - `DECISIONS.md`
  - `package.json`
  - `src/core`
- Rayforge:
  - `rayforge/context.py`
  - `rayforge/core/hooks.py`
  - `rayforge/builtin_addons`
  - `pyproject.toml`
  - `tests`

Winner: LaserForge for maintainability under the stated solo-dev/safety
constraints. Rayforge for extensibility and breadth.

### 13. Platform/deployment

LaserForge has:

- Web app via Vite.
- WebSerial support.
- Cloudflare Pages deployment.
- Windows desktop via Electron target.
- One shared codebase and UI/core split.

Rayforge has:

- GTK/Python desktop architecture.
- Native-style desktop settings, dialogs, and hardware drivers.
- No evidence in this audit of a comparable browser/WebSerial deployment.

Winner: LaserForge for web/deployment. Rayforge for richer native desktop
hardware platform.

## What LaserForge has that Rayforge does not clearly beat

- Browser-first deployment and WebSerial.
- Cloudflare Pages production/preview path.
- A stricter pure-core architecture.
- Stronger documented audit/spec discipline.
- Stronger output invariant culture for G-code determinism, bounds, laser-off
  travel, and power scale.
- Simpler operator model: one focused LightBurn-like workspace instead of a
  broader machine/addon ecosystem.
- Explicit local-only/no telemetry product rule.

## What Rayforge has that LaserForge lacks

- 31 built-in device profiles.
- Multiple controller/driver families.
- Device profile import/export.
- LightBurn `.lbdev` import.
- Editable/custom G-code dialects.
- Firmware/device settings write workflow.
- Multiple laser heads.
- PWM and pulse-width modeling.
- Rotary modules.
- Camera model, calibration, and alignment.
- No-go zones.
- Hooks/macros.
- Addons/plugins.
- 68 material YAML files plus material/recipe managers.
- More file import formats: DXF, PDF, BMP, Ruida, LightBurn.
- Post processors for lead-in/out, crop, smooth, optimize, multipass, merge
  lines, overscan, tabs.
- Richer sketching/constraint addon.
- G-code viewer/editor separation.

## Prioritized build recommendations for LaserForge

### P0 - Finish the current Machine Setup split

The new Machine Setup dialog is the right direction. It should remain a durable
settings/configuration surface, while the Laser panel stays live-operation only.

Acceptance:

- Machine Setup opens from one compact Laser-panel entry.
- Profile/Diagnostics/Controller/Firmware tabs remain separated.
- Profile suggestions never write firmware.
- The diagnostic tab explains which values came from controller probes.
- The controller tab has search/filter/grouping for settings rows.

### P1 - Add a real GRBL profile catalog

Build a small first-party catalog before chasing non-GRBL controllers.

Start with:

- Generic GRBL 400x400.
- Creality Falcon A1/Falcon 2 style profiles.
- MKS DLC32 generic.
- xTool D1 Pro generic GRBL-like profile only if the G-code dialect is verified.
- Sculpfun/Ortur/Atomstack generic profiles if the exact `$30`, workarea,
  homing, and laser-mode assumptions are documented.

Acceptance:

- Profiles are data files, not hard-coded UI.
- Each profile declares controller facts, bed, origin, `$30`, `$32`
  expectation, homing support, RX buffer, air assist command, dialect flags, and
  confidence/source.
- A diagnostic mismatch produces warnings and a safe local patch suggestion.

### P1 - Add machine profile import/export

Rayforge's profile flow is worth copying.

Acceptance:

- Export active LaserForge profile as a standalone file.
- Import LaserForge profile file with validation and preview.
- Keep imported profile out of firmware until explicitly selected/applied.
- Show a summary of changed fields before replacing the active profile.

### P1 - Add LightBurn `.lbdev` import

This directly helps users migrating from LightBurn.

Acceptance:

- Read `.lbdev`.
- Extract only fields LaserForge understands.
- Warn that LightBurn profiles may be incomplete.
- Present a review screen before install.
- Never treat unsupported fields as silently handled.

### P2 - Upgrade controller settings from read-only table to guarded editor

Do this after backups and diffs are solid.

Acceptance:

- Backup required before any firmware write.
- One-setting write, not bulk apply.
- Typed validation per known setting.
- Clear "this writes firmware" confirmation.
- Block writes during jobs, jogs, frame, autofocus, alarm recovery, and active
  diagnostics.
- Keep settings write logs in the diagnostic bundle.

### P2 - Make G-code dialects data-driven

Do not jump straight to arbitrary user-editable templates. Start with a typed,
reviewable internal format.

Acceptance:

- Profile declares a named dialect.
- Dialect controls preamble, postscript, M3/M4 policy, travel S policy,
  modal feed, return-to-origin, jog/home/unlock commands, and air assist.
- Save/Start/Frame/preflight all use the same resolved dialect.
- Snapshot tests cover each built-in dialect.

### P2 - Add no-go zones before rotary/camera

No-go zones are the highest safety value from Rayforge's machine model.

Acceptance:

- Machine profile can store disabled/enabled rectangular zones.
- Preview draws zones.
- Frame/Start/Save preflight rejects burn/travel through zones.
- Diagnostic/export includes zones.

### P3 - Mature materials and recipes

LaserForge has the foundation. Rayforge is ahead in breadth.

Acceptance:

- Expand built-in starter recipes, but mark them as "starting points," not
  certified settings.
- Add material-test result capture into a recipe.
- Add read-only `.clb` importer after format research.
- Keep recipes local and deterministic.

### P3 - Decide rotary/camera strategy

Do not add rotary and camera as loose tabs. They need machine model support.

Rotary minimum:

- Rotary module model.
- Axis mapping.
- Diameter/circumference math.
- Per-layer rotary enable.
- Preview and preflight with rotary transforms.

Camera minimum:

- Camera model.
- Calibration file.
- Alignment workflow.
- Overlay transforms.
- No network/cloud dependency.

### P4 - Non-GRBL controllers

Rayforge is far ahead here. LaserForge should only expand after the GRBL
profile/catalog/dialect system is solid.

Order:

1. FluidNC/grblHAL as GRBL-compatible variants.
2. Marlin if a real user machine needs it.
3. Ruida only if the app is ready for a very different controller model.

## Bottom line

Rayforge is ahead as a broad machine platform. LaserForge is ahead as a
controlled, test-heavy, web-first GRBL app foundation. The best path is not to
copy every Rayforge feature. The best path is to adopt Rayforge's machine
configuration architecture in LaserForge's stricter style:

1. Durable machine profile catalog.
2. Profile import/export.
3. Diagnostic-driven local profile suggestions.
4. Guarded controller settings editor.
5. Data-driven dialects.
6. No-go zones.
7. Materials/recipe maturity.
8. Rotary/camera only after the model can carry them safely.

