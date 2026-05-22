# bCNC Study

## Metadata

- Repo URL: `https://github.com/vlachoudis/bCNC.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/bcnc`
- Pinned commit: `8bcaac0f0f7b2200353d28e64b0e8e62eb6ad0ba`
- Status: PARTIALLY VERIFIED
- Evidence level: official repo README plus static local source inspection

## Build and Test Status

Build/test execution was not run.

Reason:

- This pass is a static external-repo study.
- Python resolves to the WindowsApps launcher locally and did not provide a usable interpreter for this repo.
- `pip`, `pytest`, and `ruff` were not available locally.
- Dependency installation and external runtime execution were intentionally not started during this static study.

Recorded artifact:

- `audit-artifacts/bcnc/build-test-status.txt`

Commands identified from repo docs/manifests:

```bash
python -m bCNC
pip install -e .
python -tt -m compileall -f bCNC
python setup.py sdist
pytest --capture=no --verbose tests/
```

The historical Travis recipe installs the package, installs `gcode-receiver`, runs compileall and sdist, and has the pytest smoke path commented out. Treat the pytest command as a candidate local verification step until maintained status is confirmed.

## Purpose of This Repo in the LaserForge Study

bCNC is a mature GRBL/grblHAL-oriented CNC sender and CAM tool. It is less modern architecturally than Rayforge or UGS, but it is valuable because it exposes hard-won sender behavior around GRBL RX buffer limits, status polling, WCS/MPos configuration, probing, feed hold, resume, controller purge, and old-hardware workflows.

LaserForge should study bCNC for:

- Byte-budgeted GRBL streaming with `ok`/status-driven accounting.
- GRBL profile expectations, especially `$10` MPos reporting and `$13=0` millimeter mode.
- WCS/origin/probe handling through `G10`, `G92`, `G28`, `G30`, WCO, and PRB status parsing.
- Feed hold, resume, soft reset, and controller purge behavior.
- Controller-family separation for GRBL0, GRBL1, Smoothie, and G2Core.
- CAM/plugin patterns for laser setup, M3/M4/S/M5 injection, Z-step repeats, and operator validation.
- Diagnostic logging through serial spy URLs and fake-GRBL smoke tests.

LaserForge should not copy bCNC code directly. The repo is GPLv2, and this study uses it only as a behavioral comparator and audit prompt source.

## Source Evidence

### Official Repository README

The README confirms:

- bCNC is a GRBL/grblHAL command sender, autoleveler, G-code editor, digitizer, and CAM tool.
- It supports import/export of G-code, DXF, SVG, and common image formats.
- It supports workspaces `G54` through `G59`, probing/autoleveling, feed override, macros, rapid optimization, pendant/web pendant, and old/slow hardware.
- It recommends FluidNC or grblHAL when possible and warns original GRBL is end-of-life.
- It recommends `$10=3` for GRBL 1.1 MPos reporting, `$10=1` fallback, and `$13=0` millimeter reporting.
- It documents serial-spy diagnostic URLs such as `spy:///dev/ttyUSB0?file=serial_log.txt&raw`.

### Local Static Artifacts

- `audit-artifacts/bcnc/file-list.txt`
- `audit-artifacts/bcnc/readme.txt`
- `audit-artifacts/bcnc/setup-py.txt`
- `audit-artifacts/bcnc/controller-streaming-surface.txt`
- `audit-artifacts/bcnc/origin-wcs-probe-surface.txt`
- `audit-artifacts/bcnc/cam-laser-surface.txt`
- `audit-artifacts/bcnc/preview-parser-surface.txt`
- `audit-artifacts/bcnc/test-surface.txt`
- `audit-artifacts/bcnc/release-surface.txt`

## Sender Architecture and Streaming

`bCNC/Sender.py` implements the main serial sender. The sender maintains:

- `queue` for commands and meta-actions.
- `cline` for command byte lengths currently believed to occupy the controller RX buffer.
- `sline` for sent command text.
- `RX_BUFFER_SIZE = 128`.
- `_pause`, `_alarm`, `_runLines`, `_sumcline`, and feed override state.
- A `serialIO()` loop that polls status every `SERIAL_POLL = 0.125`, reads responses, drains queued commands, and only sends when `sum(cline) < RX_BUFFER_SIZE`.

The sender receives controller lines and delegates response parsing to the active controller module. It also has a `WAIT` tuple behavior that can wait for buffer empty/Idle before continuing.

LaserForge lesson:

GRBL streaming must be audited as a byte-budget, ack/status, and state-machine problem. A line queue is not enough. Compare LaserForge against bCNC's `cline`/RX budget, pause flag, status polling, wait barrier, and exception/serial close handling.

## Pause, Resume, Stop, and Recovery

`bCNC/controllers/_GenericController.py` provides generic controller operations:

- `feedHold()` sends realtime `!`, flushes serial, and sets `_pause = True`.
- `resume()` sends realtime `~`, clears pause/alarm messaging, and resumes.
- `softReset()` sends realtime reset `0x18`, stops probing, and clears alarm state.
- `unlock()` sends `$X`.
- `home()` sends `$H`.
- `viewStatusReport()`, `viewParameters()`, and `viewState()` query controller state.
- `purgeController()` sends feed hold, captures modal `$G` and tool length offset state, soft resets, clears internal run/probe state, restores modal G words and `G43.1Z<TLO>`, then views state and parameters.

`Sender.stopRun()` uses feed hold, stop flags, and controller purge unless still preparing.

LaserForge lesson:

Stop/recovery is not just "clear the queue." It must leave the controller in a safe and knowable state. For laser use, LaserForge should verify safe laser-off behavior first, then confirm whether any purge/recovery restores modal state only when that is explicitly safe for the machine/profile.

## GRBL Profile, WCS, Origin, and Probing

bCNC makes controller reporting assumptions explicit:

- README recommends MPos reporting through `$10=3` on GRBL 1.1 or `$10=1` fallback.
- README recommends `$13=0` so position/status values are in millimeters.
- `CNC.py` lists `WCS = ["G54", "G55", "G56", "G57", "G58", "G59"]`.
- `_wcsSet()` chooses `G10L20P#`, `G28.1`, `G30.1`, or `G92` based on requested coordinate behavior.
- `GRBL1.py` parses `<...|MPos:...|WCO:...|...>` and computes work position from machine position and WCO.
- Probe result parsing subtracts WCO from PRB results before updating probe variables.
- `CNC.py` tracks modal groups such as WCS, plane, distance, units, feed mode, tool length offset, spindle, and coolant.

LaserForge lesson:

Reset-WCS-to-baseline, bounds checking, and origin certainty must be profile-aware. They should not silently assume every GRBL-like machine reports WPos/MPos, WCO, `$10`, `$13`, homing, probing, or work-coordinate reset semantics the same way.

## Controller-Family Separation

bCNC keeps controller-specific behavior in separate modules:

- `_GenericController.py`
- `_GenericGRBL.py`
- `GRBL0.py`
- `GRBL1.py`
- `SMOOTHIE.py`
- `G2Core.py`

The GRBL controller modules include explicit error/alarm mappings. `_GenericGRBL.py` includes GRBL error and alarm descriptions such as soft-limit, homing, jog target exceeds machine travel, and laser mode requiring PWM output.

LaserForge lesson:

Controller profile metadata should drive messages, supported commands, and safety gates. Do not collapse firmware-specific limits into a generic "GRBL-ish" path where command support and status semantics are guessed.

## Laser CAM and G-code Transformation

`bCNC/plugins/LaserCut.py` is a laser-specific plugin that rewrites selected G-code blocks:

- It requires "Laser Cutter" mode in the CNC configuration before running.
- It exposes feed, power, laser mode `Auto/M3/M4`, block repeat count, Z start, Z-down step, and backup-copy options.
- It cleans existing Z/F/S/M3/M4 tokens from selected blocks.
- It updates tab-up sections to include `M5` and rapid travel.
- It updates tab-down sections to include `M3` or `M4`.
- It appends `M3/M4 S0` to the header and `M5` to the footer when needed.
- Its own docs say users should validate the generated block content after each modification.

`bCNC/lib/imageToGcode.py` provides scan conversion patterns:

- Alternating, increasing, decreasing, upmill, and downmill scan converters.
- Pixel size, pixel step, split step, safety height, and edge offset controls.
- `Gcode` state with last position/feed/modal G-code and explicit `safety()` moves.
- It returns a full output list, so it is not a streaming model by itself.

LaserForge lesson:

The useful pattern is explicit laser-mode/power/header/footer handling and visible operator validation, not the exact text-rewrite implementation. LaserForge should compare whether Pro/Easy laser settings, M3/M4/S, header/footer, Z policy, repeated passes, tab/gap travel, and generated output validation are all explicit and test-covered.

## Preview and Geometry

`CNC.py` parses G-code into motion paths, block margins, and modal state. `CNCCanvas.py` renders the work area, gantry, selected blocks, path direction, probe/orient markers, and camera overlay from `app.gcode` paths and coordinate transforms.

LaserForge lesson:

Preview should be tied to parsed job/output geometry and coordinate transforms. bCNC also shows the danger of tight UI/data coupling: LaserForge should prefer sector tests that prove preview/output parity rather than copying a canvas-driven architecture.

## Tests and Coverage Posture

bCNC has a visible but older test posture:

- `tests/test_smoke.py` launches the GUI, loads a sample G-code file, starts with F10, stops with F12, and checks tool position changed.
- `tests/fake-grbl.sh` uses `socat` to expose a fake GRBL console that emits GRBL 1.1 and answers status `?` with an Idle MPos/FS/WCO report.
- `.travis.yml` runs `compileall` and `sdist`; the pytest smoke command is present but commented out.

LaserForge lesson:

The fake-controller idea is useful; the old CI posture is not. LaserForge should keep stronger deterministic fake-controller tests for streaming, status, stop, bounds, WCS, and safety-off, rather than relying on GUI smoke only.

## LaserForge Comparison Prompts

Use these as sector prompts later. Do not treat them as current LaserForge findings until LaserForge files are inspected.

1. Streaming:
   - Does LaserForge enforce controller RX buffer limits by bytes, not only command count?
   - Does it release buffer capacity only from real `ok`/`error`/completion evidence?
   - Does it have a wait-for-empty/Idle barrier for commands that require synchronization?

2. Stop/recovery:
   - On stop, communication error, or purge, is laser output forced off before state restoration?
   - Are modal restore operations profile-safe and tested, or intentionally avoided for laser safety?
   - Are pause/resume/soft-reset/unlock actions blocked when the controller/profile does not support them?

3. WCS/origin/settings:
   - Does LaserForge know whether the machine reports MPos, WPos, and WCO?
   - Does reset-WCS-to-baseline account for `$10`, `$13`, G10/G92/G28/G30, homing, and unsupported machines?
   - Do bounds checks use the same coordinate space the controller will execute?

4. Laser CAM:
   - Are M3/M4/S/M5/header/footer/Z-pass choices visible and tested?
   - Are tab/gap travels and repeated passes tested for laser-off behavior?
   - Does Easy mode hide complexity without hiding safety-critical state?

5. Diagnostics:
   - Does the support bundle capture enough serial/status transcript evidence to debug failed streams, wrong origins, and machine profile mismatches?
   - Can a tester provide a controller transcript without being told to run privileged workarounds?

## Registered Lessons

### LF-EXT-BCNC-001: Audit GRBL streaming as byte-budgeted controller state

Risk: HIGH

bCNC's `serialIO()` gates sending on `sum(cline) < RX_BUFFER_SIZE`, polls status, tracks sent command lengths, and handles queue/meta commands. LaserForge should compare its sender/spool code against byte-budget, ack/status, wait barrier, pause, and serial-error invariants.

### LF-EXT-BCNC-002: Treat stop and purge as safe-state recovery, not only queue cleanup

Risk: HIGH

bCNC uses feed hold, soft reset, modal capture/restore, TLO restore, state queries, and queue/probe cleanup. LaserForge should verify that its laser-specific recovery path first guarantees laser-off and then only restores controller state when profile-safe.

### LF-EXT-BCNC-003: Make WCS and controller reporting assumptions explicit

Risk: HIGH

bCNC documents `$10` MPos and `$13=0` requirements, parses MPos/WCO, subtracts WCO from probe results, and uses G10/G92/G28/G30 for coordinate operations. LaserForge should audit reset-WCS-to-baseline and bounds with machine-profile evidence.

### LF-EXT-BCNC-004: Keep controller-family commands and errors profile-specific

Risk: MEDIUM

bCNC separates GRBL0, GRBL1, Smoothie, and G2Core modules and keeps explicit GRBL error/alarm messages. LaserForge should compare profile capability gates and user-facing error messaging.

### LF-EXT-BCNC-005: Make laser-mode, power, pass, and Z policy visible before output

Risk: MEDIUM

The LaserCut plugin exposes M3/M4, S power, feed, repeated passes, Z step, header/footer, and M5 behavior. LaserForge should audit whether Pro/Easy settings expose these choices safely and whether output tests prove the generated behavior.

### LF-EXT-BCNC-006: Use fake-controller and serial transcript diagnostics, not GUI smoke alone

Risk: MEDIUM

bCNC's fake-GRBL smoke approach and serial-spy docs are useful, but its old test posture is too weak. LaserForge should keep stronger fake-controller transcripts and support bundles for failure diagnosis.

### LF-EXT-BCNC-007: Reject monolithic UI/sender and legacy CI posture

Risk: LOW

bCNC is useful behaviorally, but its Tk UI, sender, parser, and CAM are tightly coupled and its maintained CI signal is weak. LaserForge should learn from its sender/WCS behavior without copying its architecture.
