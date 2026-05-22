# Candle Study

## Metadata

- Repo URL: `https://github.com/Denvi/Candle.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/candle`
- Pinned commit: `a4798f681c2ee5fc1ec5223c62649359ce5a3d47`
- Status: PARTIALLY VERIFIED
- Evidence level: official README plus static local source inspection

## Build and Test Status

Build/test execution was not run.

Reason:

- This pass is a static external-repo study.
- Candle's documented build path requires CMake, Qt, and either vcpkg or system Qt packages.
- Local tool discovery recorded only `git.exe`; `cmake`, `ctest`, `ninja`, and `msbuild` were not available in the captured tool check.
- Dependency installation and external build/runtime execution were intentionally not started during this static study.

Recorded artifact:

- `audit-artifacts/candle/build-test-status.txt`

Commands identified from repo docs/manifests:

```bash
git clone https://github.com/Denvi/Candle.git
mkdir build && cd build
cmake .. -DCMAKE_INSTALL_PREFIX="$HOME/programs/Candle"
cmake --build . --config=Release
cmake --install .
```

Windows docs also require CMake, vcpkg, `CMAKE_TOOLCHAIN_FILE`, `vcpkg install`, then the same CMake configure/build/install flow.

## Purpose of This Repo in the LaserForge Study

Candle is a Qt GRBL sender with a G-code visualizer. It is useful to LaserForge because it exposes a compact, native-desktop implementation of GRBL streaming, command buffering, pause/abort UI state, WCS/origin setup, parser-state handling, and preview derived from parsed G-code geometry.

LaserForge should study Candle for:

- GRBL 127-byte buffer budgeting with active-command accounting.
- Response-driven release of queued commands on `ok`/`error`.
- Sender state separation: transferring, pausing, paused, changing tool, stopping, stopped.
- Error handling during program send, including feed hold on controller error.
- Work-coordinate and parser-state handling around G10/G92, `$#`, `$G`, reset, and send-from-line.
- Visualizer/parser relationships: parsed line segments, bounds, draw modes, arc expansion, S-value rendering, and line highlighting.
- Machine setup docs that make `$10`, `$5/$6`, `$22/$23`, homing, probing, and WCS zeroing part of the product workflow.
- Script/network connection surfaces as reminders that command-sending APIs need trusted-boundary validation.

LaserForge should not copy Candle's structure wholesale. Candle concentrates much of the sender, UI, state, parser interaction, settings, script loading, and error handling in `frmMain.cpp`; this is useful as a behavior comparator, not as an architecture target.

## Source Evidence

### Official Repository README

The README confirms:

- Candle is a GRBL controller application with a G-code visualizer written in Qt.
- It controls GRBL machines through console commands, UI buttons, and numpad input.
- It monitors machine state, loads/edits/saves/sends G-code, and visualizes G-code files.
- It publishes separate older release lines for GRBL 1.1 and GRBL 0.9-or-below.
- It provides CMake/vcpkg/system-Qt build instructions.
- It tells users many problems are solved by using the correct GRBL version and configuration.

### Local Static Artifacts

- `audit-artifacts/candle/file-list.txt`
- `audit-artifacts/candle/readme.txt`
- `audit-artifacts/candle/cmakelists.txt`
- `audit-artifacts/candle/cmakepresets.txt`
- `audit-artifacts/candle/github-tree.txt`
- `audit-artifacts/candle/controller-streaming-surface.txt`
- `audit-artifacts/candle/laser-safety-surface.txt`
- `audit-artifacts/candle/origin-wcs-surface.txt`
- `audit-artifacts/candle/preview-parser-surface.txt`

## Sender Architecture and Streaming

Candle keeps a fixed GRBL sender buffer budget:

- `src/candle/frmmain.h` defines `BUFFERLENGTH = 127`.
- `src/candle/frmmain.cpp::bufferLength()` sums `CommandAttributes.length` for active commands in `m_commands`.
- `src/candle/frmmain.cpp::sendCommand()` queues a command if `bufferLength() + command.length() + 1 > BUFFERLENGTH`.
- `src/candle/frmmain.cpp::sendNextFileCommands()` sends program lines until the active buffer is full, the file ends, a queued command exists, or a pending `M2`/`M30`/`M6` stop/pause command is in flight.
- Controller responses remove active commands and allow queued commands or more file commands to proceed.

This is a useful comparator for LaserForge's spool-backed GRBL sender. Candle does not prove that LaserForge is correct; it provides concrete audit prompts:

- Does LaserForge account for controller RX capacity by bytes/characters, not just line count?
- Does an `ok` or `error` release exactly one active command?
- Are realtime commands such as hold/resume/reset separated from buffered file commands?
- Can stop/cancel/pause drain or clear active and queued state safely?
- Can the send path avoid accidental full materialization of large jobs?

## Pause, Abort, Stop, and Error Handling

Candle models sender lifecycle with `SenderState` values for transferring, pausing, paused, changing tool, stopping, and stopped.

Relevant behavior:

- `on_cmdFilePause_clicked()` switches to `SenderPausing`; resume restores the prior sender state or exits tool-change state.
- `on_cmdFileAbort_clicked()` sends `M2`, queued or immediate depending on whether the sender is paused/changing tool.
- `grblReset()` sends `CTRL-X`, marks the device unknown, clears command/queue state, and waits for a reset response.
- During program send, an `ERROR` response with `ignoreErrors` disabled causes Candle to send realtime feed hold `!`, show an Ignore/Abort dialog, then either send `~` or call `grblReset()`.
- `onConnectionErrorOccurred()` logs the connection error and disconnects.

For LaserForge, the useful lesson is not Candle's exact UI behavior. The lesson is that sender state, active command state, controller error responses, and operator decisions must be bound together. A laser app should be stricter than Candle when laser emission is possible: continuing after a controller error must be explicitly justified and tested.

## WCS, Origin, Homing, and Parser State

Candle makes machine setup and coordinate assumptions visible in product help and code:

- Help documents say GRBL should report machine coordinates, feed/speed, pin state, WCO, overrides, and other status data through `$10`; examples include `$10=1` and grblHAL `$10=511`.
- Help describes `$5`, `$6`, `$22`, `$23`, homing, probing, and WCS zeroing workflow.
- Help warns that user commands do not restore work coordinates after controller reset or emergency stop.
- `sendCommand()` queues `$#` after `G92` or `G10` so offset state can be refreshed.
- Response handling parses `$G` parser state and `$#` offset data for `G54`-`G59`, `G28`, `G30`, `G92`, `PRB`, and `TLO`.
- `getLineInitCommands()` builds a preamble for send-from-line behavior, including spindle `M3 S...`, `G21/G20`, `G90/G91`, motion mode, and optional arc plane.
- `processSettingsResponse()` captures machine settings such as units, soft limits, homing, rapid speed, acceleration, and machine bounds.

This is directly relevant to LaserForge's WCS reset-to-baseline, placement certainty, beginner-machine compatibility, and "not all machines pass every check" UX. The audit lesson is to separate:

- hard safety requirements,
- profile-specific machine assumptions,
- optional capability checks,
- user consent/override flows,
- and diagnostics that tell the operator why a machine cannot prove a condition.

## Preview and Parser Model

Candle's visualizer is based on parsed G-code geometry:

- `src/candle/parser/gcodeparser.h` tracks metric/absolute mode, IJK mode, current point/axes, plane, last G-code command, last feed, and last spindle speed.
- `GcodeParser` is explicitly ported from UGS' `GcodeParser.java`.
- `updateParser()` feeds program commands into `GcodeParser`, updates model line metadata, and drives visualizer state.
- `GcodeViewParse` stores line segments, bounds, line-to-segment indexes, draw state, and arc-expanded geometry.
- `GcodeDrawer` supports vector/raster drawing modes, highlighted paths, grayscale/S-value visualization, and fast-traverse styling.
- Runtime shadowing links sent lines/status to drawn line segments.

LaserForge should use this as a preview/output parity prompt: if the preview is not derived from the same plan/output semantics that the sender uses, then it needs explicit tests proving parity. Candle also shows the value of line-indexed segments for progress and diagnostics.

## Connection and Script Surfaces

Candle has multiple command-delivery surfaces:

- `SerialPortConnection` writes commands over `QSerialPort` with no hardware flow control.
- `TelnetConnection` sends commands over `QTcpSocket`.
- `WebSocketConnection` sends text or binary messages to a configured URL and buffers incoming line-delimited responses.
- `ScriptDevice` exposes `sendCommand`, `sendCommands`, realtime command send, parser state store/restore, machine/work/probe coordinates, buffer length, command length, queue length, and device state to scripts.
- `evaluateCommand()` evaluates script expressions embedded in commands.

For LaserForge, this maps to Electron IPC, Falcon WiFi, local network, manual console, and any scripting or macro surface. The comparator lesson is simple: command-capable APIs are safety and security boundaries. Validation cannot live only in the UI.

## Release, Packaging, and Test Posture

Candle's build posture is clear, but the test posture was not proven in this pass:

- The README provides concrete CMake instructions for Windows and Linux.
- The repo contains `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`, `vcpkg-configuration.json`, and a `.github` tree.
- The README links nightly Windows build status and release downloads.
- No local build/test was run because required tools/dependencies were not available and install scripts were intentionally not executed.
- A maintained automated test command was not confirmed during static inspection.

For LaserForge, Candle is a useful native packaging comparator but not a model for release confidence by itself. LaserForge should keep stronger automated output, safety, security, and release workflow tests.

## Useful Patterns for LaserForge

1. Byte-budget active-command tracking for GRBL streaming.
2. Explicit sender state transitions for transferring, pausing, paused, changing tool, stopping, and stopped.
3. Error-response handling that holds the controller before asking the operator how to proceed.
4. Product documentation that makes GRBL status-report and homing/WCS settings part of setup.
5. Preview geometry derived from parsed command semantics, with line indexes for progress.
6. Capability-specific release builds or settings for different GRBL generations.
7. Script/network command paths treated as command-capable boundaries.

## Anti-Patterns / Do Not Copy Blindly

1. Do not copy Candle's large central `frmMain.cpp` shape into LaserForge.
2. Do not treat an operator "Ignore errors" choice as automatically safe for laser output.
3. Do not expose script/network/manual-command surfaces without trusted-boundary validation.
4. Do not infer test quality from build instructions or release downloads.
5. Do not assume GRBL 0.9, GRBL 1.1, grblHAL, Falcon WiFi, and generic network devices can share one behavior path.

## LaserForge Audit Prompts Generated

- Does LaserForge's GRBL sender maintain bounded active-command accounting with exact release on `ok`/`error`?
- Are pause, resume, abort, disconnect, and error paths modeled as state transitions with safe laser-off behavior?
- Can LaserForge reset WCS to baseline and explain what could not be proven on machines with limited reporting?
- Are beginner-mode start gates hard safety checks, capability checks, or operator-consent checks, and are those labels clear?
- Is preview/progress derived from plan/output semantics rather than UI state guesses?
- Are manual console, Falcon WiFi, IPC, and any macro/script surfaces validated in trusted code?
- Are network command targets allowlisted or profile-bound?
- Does LaserForge have profile-specific behavior for firmware settings, homing, bounds, unlock, alarm, and parser state?

## Registered Findings / Lessons

- `LF-EXT-CANDLE-001`: Audit GRBL streaming as a bounded active-command budget.
- `LF-EXT-CANDLE-002`: Bind controller errors to hold/reset decisions, not silent continuation.
- `LF-EXT-CANDLE-003`: Treat WCS/parser-state recovery as explicit capability-gated behavior.
- `LF-EXT-CANDLE-004`: Use parser-derived geometry as preview/progress parity evidence.
- `LF-EXT-CANDLE-005`: Make machine setup requirements and compatibility limits visible.
- `LF-EXT-CANDLE-006`: Treat script/network/manual command surfaces as trusted-boundary risks.
- `LF-EXT-CANDLE-007`: Reject monolithic sender/UI structure and unproven test posture.

