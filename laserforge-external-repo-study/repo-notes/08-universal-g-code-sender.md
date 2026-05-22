# Universal G-Code Sender Study

## Metadata

- Repo URL: `https://github.com/winder/Universal-G-Code-Sender.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/universal-g-code-sender`
- Pinned commit: `a3e0356a136f7be70fc8221df83ace8a897d83a4`
- Status: PARTIALLY VERIFIED
- Evidence level: official repo README plus static local source inspection

## Build and Test Status

Build/test execution was not run.

Reason:

- This pass is a static external-repo study.
- Java and Maven were not available locally.
- The repo includes `mvnw`, but running it would trigger Maven dependency resolution/build execution, which is outside this static external-study pass.

Recorded artifact:

- `audit-artifacts/universal-g-code-sender/build-test-status.txt`

Official README commands identified:

```bash
./mvnw install
./mvnw exec:java -Dexec.mainClass="com.willwinder.universalgcodesender.MainWindow" -pl ugs-core
./mvnw nbm:run-platform -pl ugs-platform/application
./mvnw test
./mvnw package -pl ugs-classic
./mvnw package -pl ugs-classic assembly:assembly
```

These commands are official but not locally executed in this pass.

## Purpose of This Repo in the LaserForge Study

Universal G-Code Sender is the strongest comparator so far for sender architecture and GRBL-style control rather than laser-specific CAM. Its README describes it as a Java cross-platform G-code sender compatible with GRBL, TinyG, g2core, and Smoothieware. The official docs also identify Java 17/Maven, serial libraries, OpenGL visualizer support, and the NetBeans Platform application structure.

LaserForge should study UGS for:

- Buffered GRBL streaming and active-command accounting.
- Pause, resume, cancel, soft reset, alarm unlock, homing, check mode, and jog behavior.
- Version/capability-gated realtime commands.
- Stream-file storage and large-job memory behavior.
- G-code parser/visualizer parity and fixture-based output tests.
- Run-from/resume state reconstruction.

LaserForge should not copy UGS code directly. The repository is GPLv3, and LaserForge should use it as a behavioral comparator and test-design source unless licensing is explicitly reviewed.

## Source Evidence

### Official Repository README

The README confirms:

- Cross-platform Java G-code sender.
- Controller support for GRBL, TinyG, g2core, and Smoothieware.
- Serial communication via JSSC/JSerialComm.
- OpenGL via JogAmp.
- NetBeans Platform application model.
- Maven/Java 17 build and test commands.
- Platform and Classic editions.

### Local Static Artifacts

- `audit-artifacts/universal-g-code-sender/file-list.txt`
- `audit-artifacts/universal-g-code-sender/readme.txt`
- `audit-artifacts/universal-g-code-sender/root-pom.txt`
- `audit-artifacts/universal-g-code-sender/controller-streaming-surface.txt`
- `audit-artifacts/universal-g-code-sender/state-origin-surface.txt`
- `audit-artifacts/universal-g-code-sender/laser-gcode-surface.txt`
- `audit-artifacts/universal-g-code-sender/preview-parser-surface.txt`
- `audit-artifacts/universal-g-code-sender/test-surface.txt`
- `audit-artifacts/universal-g-code-sender/release-surface.txt`

## Sender Architecture

UGS separates several concerns:

- `AbstractController` coordinates streams, active commands, parser state, communicator state, and listener events.
- `GrblController` implements firmware-specific behavior.
- `BufferedCommunicator` owns GRBL-style buffered sending.
- `GrblCommunicator` owns GRBL RX buffer size and EEPROM single-step behavior.
- `GcodeStreamReader` and `GcodeStreamWriter` provide file-backed stream metadata and command rows.
- `GcodeParser` owns parser state and preprocessors.
- `GcodeViewParse` derives visualizer line segments from parsed G-code stream/readers.

LaserForge lesson:

The most useful boundary is not Java-specific. It is the separation between controller lifecycle, communicator buffer accounting, stream reader/writer, parser state, and visualizer/parser consumption.

## GRBL Streaming and Buffering

`BufferedCommunicator` is explicit about the GRBL streaming model:

- It tracks `commandStream`, `commandBuffer`, `activeCommandList`, `nextCommand`, `sentBufferSize`, and pause state.
- It only sends while not paused and while `CommUtils.checkRoomInBuffer(...)` says the command fits in the controller RX buffer.
- It increments `sentBufferSize` by command length plus newline.
- It removes active commands and subtracts their length after command completion.
- It pauses sending on command error if more commands remain queued.
- It exposes `cancelSend()` that clears buffers, stream, pause state, and sent buffer size.

`GrblCommunicator` adds GRBL-specific behavior:

- RX buffer size comes from `GrblUtils.GRBL_RX_BUFFER_SIZE` (`128`).
- EEPROM-affecting commands are detected and temporarily force single-step mode to avoid corruption.

LaserForge lesson:

Streaming safety is more than "send lines one by one." The sender needs bounded queued bytes, active-command accounting, ack/error-driven release, pause-on-error behavior, and special handling for commands that should not be buffered aggressively.

## Pause, Resume, Stop, Cancel, Alarm, and Jog

`GrblController` and `AbstractController` show several safety-relevant control paths:

- `pauseStreamingEvent()` sends GRBL realtime pause (`!`) only when capability supports realtime commands.
- `resumeStreamingEvent()` sends GRBL realtime resume (`~`) only when supported.
- `softReset()` sends realtime reset (`0x18`) and cancels send.
- `cancelSendBeforeEvent()` handles jogging, pause/hold behavior, and realtime soft-reset strategy.
- `cancelSendAfterEvent()` starts a cancel watcher when status updates are enabled.
- `killAlarmLock()` uses version-specific alarm unlock (`$X`) when supported.
- `performHomingCycle()`, `resetCoordinatesToZero()`, and `setWorkPosition(...)` choose commands based on GRBL version.
- `ControllerState` models `ALARM`, `HOLD`, `DOOR`, `RUN`, `JOG`, `CHECK`, `IDLE`, `HOME`, `SLEEP`, `DISCONNECTED`, `CONNECTING`, `TOOL`, and `UNKNOWN`.
- `ControllerUtils.getCommunicatorState(...)` maps firmware state plus streaming state into communicator state.

The tests cover many of these paths:

- Begin-stream failure when no commands exist or when already streaming.
- Pause/resume behavior for older and newer GRBL versions.
- Cancel before sending, during sending, during hold/door, and in version-specific scenarios.
- Error reporting that says streaming has been paused.

LaserForge lesson:

Pause/resume/stop/cancel should be tested as version/capability-specific state transitions, not as one generic button behavior.

## G-code Stream Storage and Large Jobs

UGS has a file-backed stream format:

- `GcodeStreamWriter` reserves metadata space, writes one row per processed command, and writes final line count into metadata on close.
- It rejects newlines inside row fields.
- `GcodeStreamReader` verifies metadata, exposes total and remaining row counts, and reads the next command on demand.

`GcodeStreamTest` writes and reads 1,000,000 rows, checking line counts, commands, comments, command numbers, and remaining rows.

LaserForge lesson:

This is a strong comparator for LF-004-style issues. Large-job support should be proven with a real bounded stream representation, not by building full G-code text and splitting it later.

## Parser, Preview, and Fixture Tests

UGS has an extensible parser:

- `GcodeParser` maintains `GcodeState`, applies command processors, returns metadata including points and state.
- `GcodeViewParse` derives visualizer line segments from either a stream reader or list of strings using parser state and preprocessors.
- `FixturesTest` runs fixture inputs through configured parsers and compares both stream output and parsed output fixtures.
- Fixture sets cover arcs, coarse arcs, mesh-leveler arcs, run-from, comments, and empty lines.

LaserForge lesson:

Preview/output consistency should be tested against the same emitted or stream-derived representation where possible. Parser tests should compare both raw stream representation and parsed/normalized command output.

## Run-From / Resume State Reconstruction

`RunFromProcessor` is a useful resume/run-from comparator:

- It skips prior commands while parsing them to reconstruct state.
- At the selected line, it emits machine state, moves to clearance height, moves XY, emits accessory state, plunges, and appends the normalized command.
- It tracks clearance height from skipped commands.

LaserForge lesson:

Resuming from the middle of a job is not just "start at line N." It requires reconstructed modal state, safe travel, accessory/laser state, and explicit handling of Z/clearance. For laser work, this should be treated as safety-adjacent.

## WCS, Origin, Homing, and Soft Limits

UGS has version-specific GRBL utilities for:

- Homing (`$H` or older G28 behavior).
- Resetting work coordinates (`G10 P0 L20` or `G92` depending on version).
- Setting individual work coordinates.
- Alarm unlock.
- Check mode.
- Parser state query.
- Controller soft-limit distance using firmware settings.

LaserForge lesson:

WCS reset-to-baseline, origin changes, homing, and soft-limit behavior should be version/profile-aware and should not be treated as universal across firmware or machine configurations.

## Tests and Coverage Posture

UGS has a visibly broad test surface:

- `GrblControllerTest`
- `GcodeStreamTest`
- `GcodeStreamReaderTest`
- `ControllerUtilsTest`
- `GcodeCommandTest`
- `GrblCommandLoggerTest`
- `FixturesTest`
- `VisualizerUtilsTest`
- Designer SVG/DXF/toolpath tests
- Probe and jog plugin tests

This study did not run those tests locally, but the source tree shows a much stronger verification posture than many older sender projects.

LaserForge lesson:

Use UGS as a test-design comparator for state transitions, fake communicators, stream invariants, parser fixtures, visualizer parity, and user-visible error messages.

## LaserForge Comparison Prompts

Use these as sector prompts later. Do not treat them as current LaserForge findings until LaserForge files are inspected.

1. Streaming:
   - Does LaserForge track active commands and queued bytes against controller buffer capacity?
   - Does it release buffer capacity only on `ok`/`error` or equivalent completion?
   - Does command error pause the stream safely?

2. Pause/resume/stop/cancel:
   - Are behaviors capability/version/profile-specific?
   - Are hold, door, alarm, jog, and idle states tested separately?
   - Does cancel wait for safe stopped/idle evidence where required?

3. Large jobs:
   - Is LaserForge's spool-backed path equivalent to a bounded stream reader/writer?
   - Do tests prove large jobs are not materialized for device-send?

4. Preview/output:
   - Does preview parse the same output/stream representation, or can it drift from emitted G-code?
   - Are arc, comments, whitespace, run-from/resume, and normalized-output fixtures present?

5. WCS/origin:
   - Are work-coordinate reset commands profile/version-aware?
   - Are G10/G92, `$H`, `$X`, `$C`, and parser-state queries gated correctly?

6. Run-from/resume:
   - Does any LaserForge resume or restart feature reconstruct modal/laser/accessory state safely?
   - Is Z/clearance treated correctly or explicitly unsupported for laser devices?

## Registered Lessons

### LF-EXT-UGS-001: Treat buffered streaming as byte/accounting state, not only line sending

Risk: HIGH

UGS `BufferedCommunicator` tracks sent bytes, active commands, queued stream, pause state, and controller buffer capacity. LaserForge should compare its GRBL/Falcon streaming logic against these invariants.

### LF-EXT-UGS-002: Test pause/resume/cancel per firmware capability and state

Risk: HIGH

UGS tests pause/resume/cancel across GRBL versions and states. LaserForge should verify start, pause, resume, stop, alarm, door, jog, and cancel paths with firmware/profile-specific expectations.

### LF-EXT-UGS-003: Prove large-job streaming with file-backed or bounded stream invariants

Risk: HIGH

UGS `GcodeStreamTest` writes and reads 1,000,000 stream rows. LaserForge should keep LF-004-style tests strong enough to catch hidden full materialization.

### LF-EXT-UGS-004: Use parser/visualizer fixtures for output parity

Risk: MEDIUM

UGS fixture tests compare both stream output and parsed output. LaserForge should audit whether preview/output consistency is covered for arcs, comments, whitespace, modal state, raster/fill, and stream-backed send/export paths.

### LF-EXT-UGS-005: Treat run-from/resume as modal-state reconstruction

Risk: HIGH

UGS `RunFromProcessor` reconstructs state before restarting at a line. LaserForge should not add or expose resume-from-middle behavior unless modal state, laser/accessory state, and safe travel are proven.

### LF-EXT-UGS-006: Gate WCS, homing, unlock, check-mode, and reset commands by firmware/profile capability

Risk: HIGH

UGS `GrblUtils` chooses commands by GRBL version and capability. LaserForge should audit reset-WCS-to-baseline, alarm unlock, homing, check-mode, parser-state, and coordinate commands for profile-safe behavior.

## Unknowns / Do Not Guess

- This study did not run UGS tests or builds.
- This study did not inspect every module in UGS Platform.
- UGS is a CNC/G-code sender, not laser-specific CAM software.
- UGS is GPLv3; code reuse would require license review.
- No LaserForge production finding is created by this note alone.

## Completion Status

Universal G-Code Sender sector complete for static external-repo study. Next repo: bCNC.
