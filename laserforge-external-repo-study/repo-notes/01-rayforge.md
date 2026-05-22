# Rayforge Study

## Metadata

- Repo URL: `https://github.com/barebaric/rayforge.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/rayforge`
- Pinned commit: `3486764d188863c3e753f626e2661eebcc723572`
- Status: PARTIALLY VERIFIED
- Evidence level: PARTIALLY VERIFIED
- Build/test status: NOT RUN - REASON RECORDED

## Purpose of This Repo in the LaserForge Study

This repo is being studied primarily for:

- modern laser-app architecture
- document -> operation -> plan -> output separation
- pipeline/artifact scheduling and stale-generation handling
- GRBL streaming and flow control
- driver abstraction
- material presets and beginner workflow
- camera/alignment future architecture
- preview/simulation
- WCS/origin concepts
- observability and operator diagnostics

## 1. Executive Summary

Rayforge is a modern Python/Gtk laser application with a documented layered architecture, explicit processing pipeline, device-driver abstraction, material/recipe system, camera/alignment features, 3D simulation, and multi-controller support. It is the strongest modern product benchmark in this study, but its patterns must be adapted rather than copied: LaserForge is TypeScript/Electron/GRBL-first, while Rayforge is Python/Gtk and supports a wider controller model.

The local clone is pinned at `3486764d188863c3e753f626e2661eebcc723572`. Static inspection and docs review were completed. Build/test were not run because Pixi is not installed and Python did not report a usable local version. This is recorded in `audit-artifacts/rayforge/build-test-status.txt`.

## 2. Why This Repo Matters to LaserForge

Rayforge matters because it exposes several mature design choices that map directly to LaserForge risk areas:

- It documents a layered app structure: UI, `DocEditor`, process/services, and core/services.
- It documents a DAG-based pipeline with `WorkPieceArtifact`, `StepOpsArtifact`, `JobArtifact`, view artifacts, generation IDs, and stale-artifact rejection.
- It defines a driver interface where run/cancel/hold/jog/raw command/parser-state operations are explicit device-driver responsibilities.
- It uses GRBL character-counting buffer flow control, realtime-command bypass, `ok`/`error` parsing, and buffer-stall recovery.
- It treats WCS as a first-class user and machine concept.
- It publishes user-facing laser-safety guidance that clearly says control software cannot replace physical safety procedures.

## 3. Stack and Structure

| Area | Finding | Evidence |
|---|---|---|
| Language/runtime | Python app with Gtk4/Libadwaita, Pixi workspace, Pytest, Ruff/Pyright/Mypy-style tooling. | `README.md`; `pyproject.toml`; `pixi.toml`; `requirements.txt` |
| Core architecture | Layered application with UI, `DocEditor`, process/services, and core/services. | `website/docs/developer/architecture.md` |
| Pipeline | DAG-based artifact generation with workpiece, step, job, 2D view, and 3D/simulator artifacts. | `website/docs/developer/pipeline.md`; `rayforge/pipeline/` |
| Driver system | Driver abstraction defines connectivity, run, pause/hold, cancel, jog, raw G-code, WCS, parser state, settings. | `website/docs/developer/driver.md`; `rayforge/machine/driver/driver.py` |
| GRBL support | Serial, Telnet, and network GRBL drivers exist. | `rayforge/machine/driver/grbl/`; `rayforge/machine/transport/grbl.py` |
| Materials/presets | Material library, recipe/preset system, and material test grids are product features. | `README.md`; `rayforge/core/material.py`; `rayforge/core/recipe.py` |
| WCS | WCS docs distinguish machine, workarea, WCS, and internal WORLD space. | `website/docs/general-info/coordinate-systems.md` |
| Safety docs | User safety page includes unattended operation, fire, ventilation, prohibited material, and emergency procedure guidance. | `website/docs/general-info/laser-safety.md` |

## 4. Build/Test Results

| Step | Command | Result | Evidence |
|---|---|---|---|
| Clone | `git clone --depth 1 https://github.com/barebaric/rayforge.git ...` | PASS | Clone completed; pinned commit `3486764d188863c3e753f626e2661eebcc723572`. |
| Build/test | `pixi run test`, `pixi run lint`, `pixi run rayforge` | NOT RUN - REASON RECORDED | `audit-artifacts/rayforge/build-test-status.txt`: Pixi not found; Python version blank. |
| Static surface scan | `rg` controller/safety/WCS/test/observability searches | COMPLETE | `audit-artifacts/rayforge/*.txt` |

## 5. Architecture Map

Rayforge's documented architecture is:

```text
UI / 2D Canvas / 3D Canvas / Simulator
  -> DocEditor
  -> Camera / HistoryManager / Pipeline / Machine
  -> Core Models / Task Manager / Driver / Utilities
```

Its pipeline is documented as a DAG:

```text
Doc Model
  -> Pipeline / DagScheduler / PipelineGraph / ArtifactManager / GenerationContext
  -> WorkPieceArtifact
  -> StepOpsArtifact
  -> JobArtifact
  -> 2D View Artifact and 3D Compiled Scene Artifact
  -> G-code file / UI consumers
```

LaserForge comparison target:

- `src/core/scene`
- `src/core/job`
- `src/core/plan`
- `src/core/output`
- `src/app/PipelineService`
- preview/simulator modules

Do not infer a LaserForge defect yet. The next action is a focused LaserForge architecture sector that asks whether LaserForge has equivalent stale-output protection, preview/output source-of-truth separation, and generation invalidation.

## 6. Safety Audit

Rayforge safety-relevant surfaces reviewed:

- `website/docs/general-info/laser-safety.md`
- `website/docs/general-info/gcode-basics.md`
- `website/docs/general-info/coordinate-systems.md`
- `rayforge/machine/transport/grbl.py`
- `rayforge/machine/driver/grbl/grbl_serial.py`
- `rayforge/pipeline/encoder/gcode.py`
- `rayforge/machine/cmd.py`

Observed safety patterns:

- Job end goes through one cleanup point in `GcodeEncoder` and calls `_laser_off(...)` before postscript expansion.
- The GRBL transport uses character-counting flow control and keeps pending command accounting tied to `ok` / `error` acknowledgements.
- Realtime status/control commands bypass the GRBL RX buffer accounting.
- `cancel()` sends GRBL soft reset (`0x18`), clears queued commands, resets flow control state, and signals job finished if a job was running.
- `set_hold()` sends `!` or `~` as realtime hold/resume.
- Rayforge docs explain that `G0` is rapid/no cutting and `G1` is cutting/engraving, with `M4`, `M5`, `S`, and `G54` shown in a basic laser G-code example.

Safety caveat:

- This study did not prove Rayforge's behavior on real hardware. It records patterns to compare against LaserForge, not a claim that Rayforge is safer.

## 7. Testing and Verification Lessons

Evidence from `pyproject.toml` and test tree:

- Pytest is configured to exclude UI and stress tests by default.
- Tests exist for image importers, SVG parsing/world frame handling, WCS parsing, GRBL driver utilities, GRBL serial driver behavior, Marlin driver behavior, pipeline/view pieces, addon manager, and materials/recipes.
- Test fixtures include config, materials, recipes, machine profiles, project files, and image/import cases.

Lesson for LaserForge:

- Keep fake-controller and protocol parser tests separate from UI tests.
- Maintain fixtures for project files, machine config, materials, WCS parser output, and raster/vector import.
- Source-level tests are useful, but protocol and pipeline behavior should also be covered with executable fake device transcripts.

## 8. UX/Product Lessons

Rayforge product patterns worth comparing:

- Material library plus recipe/preset specificity.
- Material test grid.
- 3D simulation.
- WCS selector and offset education.
- Camera alignment and print-and-cut.
- Machine maintenance counters.
- Device profiles and setup wizard.
- G-code console with syntax highlighting/search.
- Clear safety documentation that warns users software does not replace hardware procedures.

These are product/workflow lessons, not immediate LaserForge defects.

## 9. What LaserForge Should Learn

### Copy Conceptually

- Use explicit pipeline artifact states and generation IDs as a model for any future preview/output cache hardening.
- Treat the driver as the owner of transport, state reporting, run/cancel/hold, raw command, settings, and parser-state behavior.
- Keep GRBL character-counting flow control pinned by focused parser/ack/buffer tests.
- Keep WCS concepts explicit in UI and docs: machine coordinates, work coordinates, internal normalized coordinates.

### Do Not Copy

- Do not copy Python/Gtk implementation choices into LaserForge's Electron/TypeScript codebase.
- Do not copy broad multi-controller support unless LaserForge has a product decision and test harness for each controller family.
- Do not use Rayforge's documented feature breadth as proof LaserForge needs every feature now.

### Improve LaserForge By

- Cross-check LaserForge's pipeline invalidation, preview/source-of-truth, and stale-output protections against Rayforge's DAG/generation model.
- Cross-check LaserForge's GRBL streaming and cancellation path against Rayforge's `GrblSerialTransport` and `GrblSerialDriver.cancel()`.
- Cross-check LaserForge's WCS/origin UX against Rayforge's explicit WCS documentation.
- Cross-check LaserForge's beginner mode and material presets against Rayforge's materials/recipes/test-grid flow.

## 10. LaserForge Cross-Reference

| Topic | External Repo Finding | LaserForge Current State | Gap | Action |
|---|---|---|---|---|
| Pipeline architecture | Rayforge uses DAG artifacts, generation IDs, stale artifact rejection, and separate job/view artifacts. | LaserForge baseline says `Scene -> Job -> Plan -> Output -> Device`; captured surfaces under `audit-artifacts/laserforge/`. | Needs focused sector review, not assumed gap. | ADAPT PATTERN |
| GRBL streaming | Rayforge uses character-counting buffer, pending queue, extracted `ok`/`error`, realtime bypass, and stall recovery. | LaserForge has GRBL controller/spool surfaces; captured `search-controller-streaming.txt`. | Needs focused streaming sector review. | ADAPT PATTERN |
| Laser-off cleanup | Rayforge job end routes through `_laser_off` and postscript; cancel uses soft reset. | LaserForge has safety-off and output emitters; captured `search-laser-control.txt`. | Needs focused laser-on/off sector review. | ADAPT PATTERN |
| WCS | Rayforge gives WCS a first-class product model and docs. | LaserForge has WCS consent/placement certainty history. | Needs focused WCS/origin sector review. | ADAPT PATTERN |
| Materials/presets | Rayforge has material library, recipes, specificity matching, and test grids. | LaserForge has material/preset surfaces per baseline but not reviewed here. | Needs focused material/beginner workflow sector review. | ADAPT PATTERN |

## 11. Findings to Register

The following are registered as external lessons, not as LaserForge defects:

- `LF-EXT-RAY-001`: Pipeline DAG/generation artifact model.
- `LF-EXT-RAY-002`: GRBL character-counting transport and realtime-command separation.
- `LF-EXT-RAY-003`: WCS/product education and explicit coordinate-space model.
- `LF-EXT-RAY-004`: Material recipe/test-grid workflow.

## 12. Completion Checklist

- [x] Repo cloned.
- [x] Commit pinned.
- [x] Build/test status honestly recorded.
- [x] Static audit artifacts captured.
- [x] Safety surfaces inspected.
- [x] LaserForge cross-reference attempted.
- [x] Findings registered as external lessons.

