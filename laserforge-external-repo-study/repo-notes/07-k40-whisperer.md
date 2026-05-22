# K40 Whisperer Study

## Metadata

- Repo URL: `https://github.com/stephenhouser/k40-whisperer.git`
- Official upstream docs:
  - `https://www.scorchworks.com/K40whisperer/k40whisperer.html`
  - `https://www.scorchworks.com/K40whisperer/k40w_manual.html`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/k40-whisperer`
- Pinned commit: `745c6ae2fa4b72fe53b966fb1a286ba472239485`
- Status: PARTIALLY VERIFIED
- Evidence level: official docs plus static local source inspection

## Build and Test Status

Build/test execution was not run.

Reason:

- This pass is a static external-repo study.
- No dependency install/build scripts were run for external repos.
- Local Python resolves to the WindowsApps launcher and did not prove a usable Python environment.
- `pip`, `pytest`, and `pyinstaller` were not found.

Recorded artifact:

- `audit-artifacts/k40-whisperer/build-test-status.txt`

Identified commands only:

```powershell
python k40_whisperer.py
pip install -r requirements.txt
python py2exe_setup.py py2exe
./build-macOS.sh
```

These commands are not marked verified locally.

## Purpose of This Repo in the LaserForge Study

K40 Whisperer is useful for LaserForge as a legacy K40/Lihuiyu controller comparator, not as a modern architecture model. The official Scorchworks page describes it as software for stock K40 laser controllers that reads SVG/DXF, interprets the data, and sends commands to the K40 controller to move the head and control the laser.

It contributes four high-value comparison areas:

- Non-GRBL controller behavior through direct USB/Nano packet control.
- Explicit EGV laser modal state instead of GRBL `M3`/`M4`/`M5`.
- Operator workflow: initialize, home, unlock rail, jog, raster engrave, vector engrave, vector cut, run G-code, pause/stop.
- Import semantics: red cut, blue vector engrave, black/other raster, with DXF layer/color rules.

It is also an anti-pattern in several ways:

- Monolithic GUI/control structure.
- Weak visible automated-test posture.
- Legacy dependency/runtime assumptions.
- Import color conventions that can surprise users if not explained and validated.

## Source Evidence

### Official Documentation

The official Scorchworks page states that K40 Whisperer:

- Reads SVG and DXF files.
- Splits input by color formatting.
- Treats red and blue SVG paths as vector cut/vector engrave and other content as raster.
- Supports Lihuiyu controller boards that work with LaserDRW.
- Documents software test pulse support for some M3 Nano boards.

The official manual documents:

- General input preparation in Inkscape.
- Red paths for cutting, blue paths for vector engraving, black for raster engraving.
- The advice to use the smallest practical Inkscape page size because large pages slow the program.
- Initialize Laser, Home, Unlock Rail, jog, corner/center movement, Raster Engrave, Vector Engrave, Vector Cut, and Pause/Stop operation.
- Linux/USB permission issues as a common cause of device-not-found failures.

### Local Static Artifacts

- `audit-artifacts/k40-whisperer/file-list.txt`
- `audit-artifacts/k40-whisperer/README.md.txt`
- `audit-artifacts/k40-whisperer/README_Linux.txt.txt`
- `audit-artifacts/k40-whisperer/control-import-surface.txt`
- `audit-artifacts/k40-whisperer/laser-safety-surface.txt`
- `audit-artifacts/k40-whisperer/pipeline-surface.txt`
- `audit-artifacts/k40-whisperer/test-release-surface.txt`

## Controller and Protocol Model

K40 Whisperer does not speak GRBL for its stock K40 path. The local source shows a Lihuiyu/Nano USB packet layer in `nano_library.py`:

- `K40_CLASS` defines USB response codes such as `BUFFER_FULL`, `CRC_ERROR`, `TASK_COMPLETE`, and `TASK_COMPLETE_M3`.
- The class defines fixed packets for `hello`, `unlock`, `home`, and `estop`.
- Operations include `unlock_rail`, `e_stop`, `home_position`, `reset_usb`, `release_usb`, `pause_un_pause`, `send_data`, and `send_packet_w_error_checking`.
- `send_data(...)` chunks data into packets, uses progress callbacks, handles a stop callback, can wait for laser completion, and routes through packet-level error checking.

LaserForge lesson:

Future non-GRBL support must be a separate controller-family adapter with its own packet semantics, response parsing, safety-off behavior, and profile constraints. It should not be folded into GRBL or Falcon paths through stringly command assumptions.

## Laser-On / Laser-Off Semantics

The EGV emitter in `egv.py` has explicit modal state:

- `self.ON` and `self.OFF` command bytes are defined.
- `move(...)` compares requested `laser_on` state against `self.Modal_on`.
- It writes ON/OFF only when modal state changes.
- `flush(laser_on=False)` is used repeatedly to force safe/off transitions.
- `make_cut_line(...)` receives `Spindle`.
- `make_egv_data(...)` calculates `Spindle = True and use_laser`, turns it off when `use_laser` is false, toggles laser state by loop/path membership, and flushes off at several boundaries.

LaserForge lesson:

The important transferable concept is not the EGV byte format. It is the invariant that emission state is explicit, local to the generation run, and flushed safe/off at path and operation boundaries. This is directly relevant to the user's earlier report that the laser cut an unintended connecting smile/travel line.

## Import and Operation Mapping

K40 Whisperer uses user-visible color/layer conventions:

- `svg_reader.py` disables PIL's pixel-limit guard with `Image.MAX_IMAGE_PIXELS = None`, which is a caution for large-image import memory behavior.
- `SVG_READER.colmod(...)` classifies red as cut, blue as vector engrave, and other colors as raster.
- The parser records `Cut_Type` and separates `cut_lines` and `eng_lines`.
- It throws when SVG size/viewbox/units are missing or X/Y scale differs too much.
- `dxf.py` routes blue or engrave-named layers to engraving and default/red paths to cutting.

LaserForge lesson:

Operation-type classification must be explicit, previewed, testable, and user-visible. LaserForge should not silently infer dangerous cut/engrave/raster behavior from color/layer conventions unless the import UI clearly surfaces and allows correction before output.

## Operator Workflow and Beginner UX

The main GUI file exposes a simple operator flow:

- `Initialize Laser Cutter`
- `Home`
- `Unlock Rail`
- `Pause/Stop`
- Jog buttons
- `Raster Engrave`
- `Vector Engrave`
- `Vector Cut`
- `Run G-Code`
- Combined raster/vector/cut buttons
- `Cut Inside First`
- `Group Engrave Tasks`
- `Group Vector Tasks`

The official manual describes the Pause/Stop button as a red button used to pause a running job and then choose resume or kill the rest of the job.

LaserForge lesson:

The useful pattern is clear operation separation for beginner users. The risk is that simple UI labels are not enough; LaserForge still needs service-level safety gates, explicit framing/origin certainty, and clear stop/recovery state.

## Device Permissions and Setup

`README_Linux.txt` documents a Linux operational setup:

- Create a `lasercutter` group.
- Add users to that group.
- Install a udev rule for vendor/product `1a86:5512`.
- Avoid running as root/sudo except as a diagnostic to prove a permissions problem.

LaserForge lesson:

Device permissions are product behavior, not just installation trivia. For Electron/Web Serial, Falcon WiFi, and any future native bridge, permission failures should be diagnosable and should not train users into unsafe broad-privilege workarounds.

## Tests, CI, and Release Posture

The mirror exposes packaging scripts and dependencies, but no strong automated test suite was found in this static pass.

Observed:

- `requirements.txt`
- `README.md`
- `README_Linux.txt`
- `py2exe_setup.py`
- macOS build/update scripts in repo file list

Not observed:

- A modern CI gate.
- A meaningful automated unit/integration test suite.
- A fake-controller transcript suite.

LaserForge lesson:

Use K40 Whisperer for protocol and workflow comparison, not for quality-process imitation. LaserForge should keep stronger TypeScript tests, output fixtures, fake-controller coverage, lint/typecheck/build gates, and release QA evidence.

## LaserForge Comparison Prompts

Use these as sector prompts later. Do not treat them as current LaserForge findings until LaserForge files are inspected.

1. K40/non-GRBL protocol readiness:
   - Does LaserForge clearly prevent non-GRBL machines from entering GRBL-only start/send paths?
   - Is future K40 support modeled as a separate driver/profile with protocol-specific safe-off behavior?

2. Travel gap safety:
   - Do LaserForge raster/fill/vector planners explicitly separate burning moves from travel moves?
   - Are non-burning travel moves represented consistently in preview and emitted output?
   - Are path-boundary safe-off or S0 semantics profile-aware?

3. Import classification:
   - Does LaserForge show the user what operations an imported SVG/DXF/image became?
   - Can hidden colors/layers or converted text accidentally become cut operations?
   - Are import failures and unsupported scale/viewbox cases rejected safely?

4. Beginner workflow:
   - Are start, frame, jog, test fire, and reset-WCS flows clear without hiding safety state?
   - Can a beginner bypass critical origin/framing/bounds checks too easily?

5. Permissions and recovery:
   - Does LaserForge distinguish device-not-found, permission denied, wrong firmware, disconnected, alarm, and frozen states?
   - Does it avoid broad privilege workarounds?

## Registered Lessons

### LF-EXT-K40-001: Keep K40/Lihuiyu protocol support separate from GRBL

Risk: HIGH

K40 Whisperer speaks Nano/Lihuiyu USB packet control, not GRBL, for stock K40 hardware. Its protocol has packet response codes, unlock/home/estop packets, packet-level retry/error behavior, and a separate EGV command stream. LaserForge should not generalize GRBL assumptions to K40-class machines.

### LF-EXT-K40-002: Model stop/home/unlock/test-fire as protocol-specific safety operations

Risk: HIGH

K40 Whisperer exposes `e_stop`, `unlock_rail`, `home_position`, `pause_un_pause`, and packet error handling as controller operations. LaserForge should audit whether every device-control operation is authorized and executed at the trusted service/controller boundary, not only from UI state.

### LF-EXT-K40-003: Treat laser modal state as an explicit output invariant

Risk: HIGH

The EGV emitter tracks ON/OFF modal state and flushes off at boundaries. LaserForge should verify that raster, fill, vector, and imported G-code paths cannot emit unintended burning travel moves, including separated islands and white corridors.

### LF-EXT-K40-004: Make import-derived operation types visible and correctable

Risk: MEDIUM

K40 Whisperer's red/blue/raster conventions are documented but fragile. LaserForge should audit whether import-derived operation mapping is visible, testable, and safe before sending.

### LF-EXT-K40-005: Treat device permissions as part of the product support surface

Risk: MEDIUM

K40 Whisperer documents Linux group/udev setup because USB access failures are common. LaserForge should audit connection diagnostics for serial, Web Serial, Electron native bridges, and Falcon WiFi so users are not left guessing or reaching for unsafe privilege workarounds.

### LF-EXT-K40-006: Copy the simple workflow, not the monolith or weak test posture

Risk: LOW

K40 Whisperer has a simple, understandable beginner workflow, but its monolithic code and weak visible tests are anti-patterns for LaserForge.

## Unknowns / Do Not Guess

- This study did not run K40 Whisperer.
- This study did not verify communication with real K40 hardware.
- This study did not inspect every EGV packet or decode all controller status semantics.
- The GitHub mirror is not necessarily the authoritative latest Scorchworks release source.
- No LaserForge production finding is created by this note alone.

## Completion Status

K40 Whisperer sector complete for static external-repo study. Next repo: Universal G-Code Sender.
