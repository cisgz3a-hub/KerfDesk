# MeerK40t Study

## Metadata

- Repo URL: `https://github.com/meerk40t/meerk40t.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/meerk40t`
- Pinned commit: `44043b8016197ba7ca84ee3f03608998313978e3`
- Status: COMPLETE for static study; build/test NOT RUN - REASON RECORDED
- Evidence level: PARTIALLY VERIFIED
- Date: 2026-05-21

## Purpose of This Repo in the LaserForge Study

MeerK40t is the breadth benchmark: many controller families, device-service plugins, driver-specific configuration surfaces, core planning/cutcode layers, spooler/job execution, material/workflow tooling, and a substantial unit-test set. It is useful for LaserForge primarily as an abstraction and safety-boundary study, not as a design to copy wholesale.

## Commands and Evidence Captured

| Step | Command / Source | Result | Evidence |
|---|---|---|---|
| Clone | `git clone --depth 1 https://github.com/meerk40t/meerk40t.git laserforge-external-repo-study/cloned-repos/meerk40t` | COMPLETE | `audit-artifacts/meerk40t/git-remote.txt` |
| Pin commit | `git rev-parse HEAD` | `44043b8016197ba7ca84ee3f03608998313978e3` | `audit-artifacts/meerk40t/git-head.txt` |
| Static file list | `rg --files` | COMPLETE | `audit-artifacts/meerk40t/file-list.txt` |
| Controller/device search | `rg "(device|driver|controller|firmware|grbl|ruida|moshi|balor|lihuiyu|plugin|kernel|spool|queue|serial|usb)"` | COMPLETE | `audit-artifacts/meerk40t/controller-surface.txt` |
| Laser safety search | `rg "(M3|M4|M5|laser|spindle|pause|resume|stop|abort|emergency|shutdown|fire|test)"` | COMPLETE | `audit-artifacts/meerk40t/laser-safety-surface.txt` |
| Origin/WCS search | `rg "(G54|G55|G56|G57|G58|G59|G92|origin|home|work coordinate|machine coordinate|soft limit|bounds|bed)"` | COMPLETE | `audit-artifacts/meerk40t/origin-wcs-surface.txt` |
| Raster/vector search | `rg "(raster|image|svg|dxf|trace|dither|engrave|cut|path|geometry|planner|hatch|fill)"` | COMPLETE | `audit-artifacts/meerk40t/raster-vector-surface.txt` |
| Test surface search | `rg "(test|pytest|unittest|mock|fixture|assert)"` | COMPLETE | `audit-artifacts/meerk40t/test-surface.txt` |
| Build/test | Python unittest / pytest | NOT RUN - Python and pip unavailable locally | `audit-artifacts/meerk40t/build-test-status.txt`; `BLOCKERS.md` BLK-001 |

No install scripts were run. No production LaserForge files were changed.

## Files Inspected

- `README.md`
- `pyproject.toml`
- `.github/CONTRIBUTING.md`
- `.github/copilot-instructions.md`
- `.github/workflows/unittests.yml`
- `.github/workflows/python-code-quality.yml`
- `meerk40t/kernel/lifecycles.py`
- `meerk40t/kernel/service.py`
- `meerk40t/device/basedevice.py`
- `meerk40t/grbl/device.py`
- `meerk40t/grbl/driver.py`
- `meerk40t/grbl/controller.py`
- `meerk40t/core/spoolers.py`
- `meerk40t/core/laserjob.py`
- `meerk40t/core/cutplan.py`
- `meerk40t/core/elements/operation_workflow.py`
- `test/test_spooler.py`
- `test/test_drivers_grbl.py`
- `test/test_core_plotplanner.py`
- `test/test_cutplan_optimization.py`
- `test/test_operations_hatch.py`
- `test/test_undo_integration.py`

## Architecture Summary

MeerK40t has a plugin/service architecture. `kernel/lifecycles.py` defines kernel and service lifecycle constants; `kernel/service.py` describes services as active contexts with their own registrations, choices, console commands, and settings. `device/basedevice.py` registers device providers and active device operations, while controller families live in separate packages such as `grbl`, `ruida`, `lihuiyu`, `moshi`, `newly`, and `balormk`.

For GRBL, `grbl/device.py` owns device settings, transport choices, axis transforms, GRBL-specific options, red-dot/pulse commands, raw G-code commands, and export. `grbl/driver.py` converts spoolable job commands into GRBL motion/laser output and owns modal state such as absolute/relative mode, units, feed mode, speed/power dirty flags, and M3/M4/M5 behavior. `grbl/controller.py` owns validation stages, send/receive threads, queue buffers, realtime queue, forward-buffer accounting, error/alarm decoding, status parsing, and settings parsing.

Core planning is separated from device drivers. `core/cutplan.py` documents staged processing: copy, preprocess, validate, blob, preopt, optimize. `core/laserjob.py` wraps driver-like commands as executable items. `core/spoolers.py` runs jobs through a threaded queue with priority, hold checks, job start/finish hooks, stop handling, clear-queue logging, and queue signals.

## Patterns Worth Studying for LaserForge

### 1. Device services isolate controller-family semantics

Evidence:

- `kernel/service.py` defines service-local registrations and lifecycle hooks.
- `device/basedevice.py` registers and activates device providers.
- `grbl/device.py` gives GRBL its own choices for bed dimensions, axis flips/swaps, home corner, Z-axis support, serial/TCP/WebSocket interfaces, M3/M4 preference, G1-for-power, endstops, red-dot behavior, pulse behavior, and raw G-code commands.

Lesson:

LaserForge should not add non-GRBL support by sprinkling conditionals through generic code. If future controller families are added, each family needs its own capability profile, command semantics, safety-off behavior, status parser, and tests. This is a comparison target for LaserForge's `DeviceProfile`, `FirmwareAdapter`, `ControllerInterface`, and controller package boundaries.

### 2. Spooler/job lifecycle is an explicit execution contract

Evidence:

- `core/spoolers.py:429` defines `Spooler`.
- `core/spoolers.py:519` runs a spooler thread that respects driver hold state and job priority.
- `core/spoolers.py:603` wraps plan commands in a `LaserJob`.
- `core/spoolers.py:684` clears the queue and logs stopped/completed status.
- `core/laserjob.py:83` executes items in order and supports stop/loop/status/estimate behavior.

Lesson:

MeerK40t models queued execution as a first-class subsystem, not just "send these lines." LaserForge already has `MachineService`, `ExecutionCoordinator`, `GrblController`, and spool-backed output, but the next LaserForge sector review should verify the execution contract as a state machine: queued, active, paused/held, stopped, completed, faulted, and recovery-required. This is especially relevant for stop/pause/resume, refill failure, progress, and logging.

### 3. GRBL driver/controller split keeps modal output and transport accounting separate

Evidence:

- `grbl/driver.py:28` defines `GRBLDriver`.
- `grbl/driver.py:262` emits laser-off with S0 and M5.
- `grbl/driver.py:277` emits M3 laser-on.
- `grbl/driver.py:423` starts plotted output with M3/M4, moves through queued cut objects, finishes with `G1 S0` and `M5`.
- `grbl/driver.py:768` / `:782` use realtime `!` and `~` for pause/resume.
- `grbl/controller.py:444` defines `GrblController`.
- `grbl/controller.py:810` sends realtime queue first, blocks normal sends when paused or not validated, and gates on buffer size.
- `grbl/controller.py:870` processes `ok`, `error`, status, settings, alarms, and feedback messages.

Lesson:

LaserForge should keep G-code modal semantics separate from transport buffering and acknowledgements. This reinforces the earlier LaserForge sectors around LF-001 and LF-004: generation state belongs to output encoding; streaming state belongs to device transport. Do not collapse these back together while adding new features.

### 4. Cut planning has explicit inner-first and no-suppression tests

Evidence:

- `core/cutplan.py` documents travel optimization, merge passes, inner-first constraints, grouped pieces, raster splitting, and optimization stages.
- `core/elements/operation_workflow.py` models containment-aware operation priorities: inner engrave, middle engrave, outer engrave, inner cut, outer cut.
- `test/test_cutplan_optimization.py` asserts inner-first optimization does not suppress cutcode and preserves all cuts across nested and grouped scenarios.
- `test/test_hatched_geometry_fix.py` covers hatch/fill candidate generation and mixed skip/non-skip cases.

Lesson:

LaserForge's vector/fill/path-ordering sector should check not only whether output "looks right," but whether the planner proves that no cut objects disappear, inner cuts occur before outer boundaries, grouped pieces remain coherent, and hatch/fill modes preserve intended geometry.

### 5. Tests include golden driver outputs and algorithm regressions

Evidence:

- `test/test_drivers_grbl.py` compares exported GRBL output against exact expected G-code text, including rotary output.
- `test/test_core_plotplanner.py` checks plot planner end positions and raster/vector setting transitions.
- `test/test_cutplan_optimization.py` checks no-suppression and containment behavior.
- `test/test_undo_integration.py` exercises console-level undo/redo flows, not just isolated helpers.
- `.github/workflows/unittests.yml` runs `python -m unittest discover test -v` across Ubuntu, Windows, and macOS.

Lesson:

LaserForge already has many source-pin and behavior tests. The concrete lesson is to keep adding small golden output fixtures for specific controller/device behaviors and sector-specific regression tests for path ordering, streaming, and recovery invariants.

## Safety-Relevant Observations

- MeerK40t's GRBL device has raw `gcode` / `grbl` console commands, but this is an external design choice and not a LaserForge finding.
- The GRBL `pulse` command limits standing laser fire to one second unless the operator uses an explicit override option named `idonotlovemyhouse`. The copy is deliberately alarming. This is a product-safety pattern: dangerous overrides should be explicit, logged, and hard to hit by accident.
- The red-dot command refuses to interfere with a running job unless forced.
- `GRBLDriver.reset()` clears the spooler queue, driver queue, plot planner, sends soft reset, resets modal dirty flags, and clears paused state.
- `GrblController` maps GRBL settings `$20`, `$22`, `$30`, `$31`, `$32`, `$130`, `$131`, `$132` and decodes GRBL error/alarm messages into user-facing text.

These are study observations only. They are not findings against LaserForge until the matching LaserForge sector is inspected.

## LaserForge Cross-Reference Targets

| MeerK40t pattern | LaserForge target | What to verify later |
|---|---|---|
| Device service/provider boundary | `src/core/devices/DeviceProfile.ts`, `src/controllers/FirmwareAdapter.ts`, `src/controllers/ControllerInterface.ts`, GRBL/Falcon modules | Whether future controller support has per-family safety semantics instead of generic conditionals. |
| Spooler + LaserJob lifecycle | `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, `src/controllers/grbl/GrblController.ts`, spool/output ticket types | Whether job states, stop/pause/resume, queue clearing, progress, recovery, and logs are a single coherent contract. |
| GRBL driver vs controller split | `src/core/output/GrblStrategy.ts`, `src/core/output/Output.ts`, `src/controllers/grbl/GrblController.ts` | Whether modal output generation remains separate from transport buffering/ack accounting. |
| Inner-first / grouped cut planning | `src/app/OperationOrder.ts`, `src/core/plan/PlanOptimizer.ts`, fill/vector planners and tests | Whether nested cut/fill paths cannot be suppressed, reordered unsafely, or burned outer-before-inner. |
| Exact golden driver tests | `tests/*gcode*`, `tests/*output*`, `tests/*plan*` | Whether high-risk output modes have small golden fixtures, including negative-path safety tests. |

## Findings Extracted

- `LF-EXT-MK-001`: Device-family service boundaries are a safer model than generic controller conditionals.
- `LF-EXT-MK-002`: Job/spooler lifecycle should be audited as its own state machine.
- `LF-EXT-MK-003`: Inner-first/path-ordering tests must prove no geometry is suppressed.
- `LF-EXT-MK-004`: GRBL settings/status/error metadata should feed profile and preflight gates.

## What Was Intentionally Ignored

- GUI layout details from wxPython panels.
- Platform packaging implementation details beyond noting that workflows exist.
- Non-GRBL controller byte protocols such as Lihuiyu, Ruida, Moshi, Newly, and Balor. They matter for future controller support, but LaserForge currently needs GRBL/Falcon correctness first.
- Claude/copilot repo instructions as operational guidance for LaserForge. They were useful as evidence for commands and test posture only.

## Remaining Gaps

- Build/test verification is blocked until Python and pip are available.
- No runtime smoke test was run.
- No local hardware behavior is inferred from MeerK40t.
- LaserForge cross-reference is still sector-level only; no LaserForge finding is accepted from this repo study alone.
