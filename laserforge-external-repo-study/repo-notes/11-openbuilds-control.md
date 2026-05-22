# OpenBuilds CONTROL Study

## Metadata

- Repo URL: `https://github.com/OpenBuilds/OpenBuilds-CONTROL.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/openbuilds-control`
- Pinned commit: `1adcc121ba9e54713164363f25ea8eda1e122a41`
- Status: COMPLETE - STATIC STUDY ONLY
- Evidence level: PARTIALLY VERIFIED
- Build/test execution: NOT RUN - install/lifecycle scripts were intentionally not executed during this external static study.

## Purpose of This Repo in the LaserForge Study

OpenBuilds CONTROL is the most useful Electron/Node comparator in this repo set. It is a GRBL host with a local Express/Socket.IO control server, Electron UI, serial and TCP connection paths, firmware flashing, G-code upload/run routes, queue-based streaming, pause/resume/stop controls, and a multi-platform release workflow.

It is useful in two directions:

- Positive comparator: GRBL RX-buffer accounting, realtime command bypass, queue progress, firmware/profile discovery, and visible diagnostics.
- Negative comparator: broad local-server exposure, permissive CORS, Node-enabled renderer, placeholder tests, broad release file inclusion, and signing workflow secret-handling patterns that LaserForge should not copy.

## Sources and Artifacts

- `audit-artifacts/openbuilds-control/git-head.txt`
- `audit-artifacts/openbuilds-control/package-json.txt`
- `audit-artifacts/openbuilds-control/readme.txt`
- `audit-artifacts/openbuilds-control/file-list.txt`
- `audit-artifacts/openbuilds-control/top-level.txt`
- `audit-artifacts/openbuilds-control/control-surface.txt`
- `audit-artifacts/openbuilds-control/electron-security-surface.txt`
- `audit-artifacts/openbuilds-control/test-release-surface.txt`
- `audit-artifacts/openbuilds-control/build-test-status.txt`
- Source files inspected: `index.js`, `package.json`, `.github/workflows/build.yml`, `app/js/websocket.js`, `app/js/main.js`, `app/js/diagnostics.js`, `app/js/grbl-settings.js`, `app/js/grbl-settings-defaults.js`, `api.doc`

## Build, Test, and Runtime Status

Build/test commands were not run.

Reason:

- `package.json` contains a `postinstall` script: `electron-builder install-app-deps`.
- The audit rules forbid running external install scripts.
- `npm install` was therefore not executed.
- `npm test` is not meaningful here anyway: the script is `echo "Error: no test specified" && exit 0`.

The local tool availability artifact captured:

- Node: available
- npm: available
- Python: WindowsApps launcher only

## Architecture Summary

OpenBuilds CONTROL is a Node/Electron application with a large `index.js` process that combines:

- Express HTTP server.
- Socket.IO command surface.
- Electron `BrowserWindow`.
- Serial/TCP connection handling.
- GRBL parser/status handling.
- G-code queue and streaming logic.
- Firmware flashing.
- Upload and workspace routes.
- Release/update support.

The renderer is served from a local HTTP server. The main UI window loads `http://localhost:${config.webPort}/` and is created with `nodeIntegration: true` and `contextIsolation: false`. The server listens on `0.0.0.0` and applies permissive CORS/private-network headers.

LaserForge should treat this as a strong warning: an Electron app that controls hardware must keep command-capable surfaces behind a tight trusted boundary. Local HTTP/Socket.IO APIs, IPC handlers, Falcon WiFi bridges, manual console commands, and firmware/upload paths must all validate in trusted code, not only in UI controls.

## GRBL Streaming Model

Useful pattern:

- `GRBL_RX_BUFFER_SIZE = 127`.
- `GRBLHAL_RX_BUFFER_SIZE = 1023`.
- `sentBuffer` stores in-flight commands.
- `[OPT:...]` parsing populates `blockBufferSize` and `rxBufferSize`.
- `BufferSpace()` subtracts in-flight command lengths from the firmware RX capacity.
- `send1Q()` sends only when there is buffer space and the sender is not blocked or paused.
- `ok` responses shift `sentBuffer`, clear blocked state, and call `send1Q()` again.
- Realtime commands bypass the normal queue because they do not produce `ok`.

This is a practical byte-budgeted GRBL sender model. LaserForge should compare its `GrblController`, spool-backed send path, ACK/error release, line boundary handling, cancellation, and progress reporting against this behavior.

Important caution:

- `runJob()` accepts a full G-code string, splits it into an array, and enqueues all lines before streaming. This is not a bounded large-job architecture.
- The frontend also stores large G-code payloads globally and displays editor warnings for large files.

LaserForge already fixed fake streaming in LF-004. OpenBuilds reinforces why that fix matters: queue-level streaming is not enough if the job is still fully materialized before queuing.

## Pause, Resume, Stop, and Laser Test

OpenBuilds exposes direct Socket.IO controls:

- `pause` -> `pause()`
- `resume` -> `unpause()`
- `stop` -> `stop(data)`
- `laserTest` -> `laserTest(data)`

Observed semantics:

- Pause sends realtime `!`.
- Resume sends realtime `~` and restarts `send1Q()` after a short delay.
- Stop marks paused, optionally sends hold `!`, sends jog cancel `0x85` for jog stop, sends Ctrl-X after a delay for non-jog stop, clears queue and `sentBuffer`, sets `laserTestOn = false`, and marks run status stopped.
- For GRBL `1.1d`, pause/stop also sends realtime `0x9E` for spindle/laser stop.
- Laser test enqueues `G1F1`, `M3S...`, optional dwell, then `M5S0`.

LaserForge should not copy these sequences blindly. It should use them as a checklist for its own safety-operations sector:

- Does test fire always end in laser-off?
- Does stop force safe output state even if a queued refill or serial write fails?
- Does jog cancel differ from job stop?
- Are realtime commands separated from counted G-code lines?
- Are firmware-version differences explicit?

## Security and Trust Boundaries

Security-relevant evidence:

- `process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'`.
- HTTP server listens on `0.0.0.0`.
- Global headers include `Access-Control-Allow-Origin: *`.
- Global headers include `Access-Control-Allow-Private-Network: true`.
- Main `BrowserWindow` sets `nodeIntegration: true` and `contextIsolation: false`.
- Socket handlers accept command-capable payloads for connection, run job, run command, jog, laser test, pause, resume, stop, clear alarm, reset, firmware flashing, and SD upload.
- Upload routes accept G-code/workspace/firmware-style files.
- `shell.openExternal(...)` is present in the main process.

For LaserForge, this maps directly to:

- Electron main/preload IPC.
- Falcon WiFi target validation.
- Manual console dangerous command detection.
- Local file import and G-code upload surfaces.
- Firmware/device-control commands.
- External URL handling.

LaserForge should adapt the validation lesson and reject the broad local-server exposure model unless there is a specific product need and hard authentication/origin validation.

## Firmware, Profile, and Setup Behavior

OpenBuilds parses and surfaces:

- GRBL, grblHAL, FluidNC, and unsupported Smoothieware messaging.
- `[OPT:...]` for RX/block buffer sizes and feature flags.
- `[GC:...]` modal state.
- status report buffer fields like `Bf:`.
- USB vendor/product friendly-port labels.
- `$21`, `$22`, `$23`, `$30`, `$31`, `$32`, `$130`, `$131`, `$132` profile/default settings.

The settings UI also exposes limit-switch, homing, reset-settings, and reset-WCS operations. A reset-WCS confirmation warns that it erases coordinate-system offsets in controller EEPROM.

LaserForge should compare this against its current machine-profile, WCS reset-to-baseline, machine compatibility, and "not all machines pass every check" behavior. The right lesson is not "disable safety gates"; it is "separate hard laser/motion safety gates from machine capability diagnostics and explicit operator consent."

## Preview, Progress, and Diagnostics

OpenBuilds has:

- A G-code worker/parser/Three.js viewer path.
- Large-file editor warnings.
- Queue count events.
- Serial console logging.
- Diagnostic toggles stored in localStorage.
- System/machine status surfaces including firmware version, buffers, interfaces, alarm text, and power-setting checks.

Useful LaserForge lesson:

- Queue/progress diagnostics should be tied to actual send state, not only UI progress.
- Support evidence should include controller firmware, RX buffer settings, connection method, emitted commands, alarms/errors, and whether preview was generated from the same output being sent.

Privacy caution:

- Diagnostics that include motherboard serials, network MAC addresses, IPs, or interface details need redaction rules before being shared outside the user's machine.

## Release and Packaging Posture

Release evidence:

- GitHub Actions workflow runs on every push across macOS, Windows, and Ubuntu.
- Electron Builder action has `release: true`.
- Windows signing setup decodes a certificate secret and then runs `cat /d/Certificate_pkcs12.p12`.
- `package.json` build config includes broad `"files": ["**/*", "ssl/**/*", "firmware/**/*", ""]`.
- `extraFiles` includes `ssl`.
- The repo contains SSL certificate/key material under the shipped tree.
- `npm test` is a placeholder that exits 0.

LaserForge should treat this section mostly as anti-pattern input:

- Never publish signed artifacts from a workflow with fake test gates.
- Never print decoded signing material.
- Never include private keys or broad repo globs in release artifacts without explicit allowlist review.
- Keep release QA/hardware-gate checks machine-checkable.

## Findings Registered

- `LF-EXT-OBC-001`: Treat Electron/local-server/Falcon IPC surfaces as hardware-control APIs.
- `LF-EXT-OBC-002`: Audit GRBL streaming against RX-byte accounting and ACK/error release.
- `LF-EXT-OBC-003`: Audit pause/resume/stop/test-fire as firmware-specific safety sequences.
- `LF-EXT-OBC-004`: Preserve the no-full-materialization invariant for large jobs.
- `LF-EXT-OBC-005`: Separate machine capability diagnostics from hard safety gates.
- `LF-EXT-OBC-006`: Tie preview/progress/support evidence to actual controller and send state.
- `LF-EXT-OBC-007`: Reject release/signing/test anti-patterns.
- `LF-EXT-OBC-008`: Reject monolithic Node/Electron control structure.

## LaserForge Comparison Prompts

Use these in sector audits, not as current findings:

1. Does every LaserForge command-capable IPC/network/manual-console path validate in the trusted layer?
2. Does the GRBL send path bound in-flight bytes, release on `ok`/`error`, preserve line boundaries, and keep realtime commands separate?
3. Do pause/resume/stop/test-fire/fault paths force a known safe laser state and preserve operator-visible recovery?
4. Does the large-job start path avoid full string/array materialization all the way to device send?
5. Are machine-profile requirements explained as compatibility/setup diagnostics without turning unsupported optional features into universal start blockers?
6. Are release workflows protected by real tests, signing safety, explicit file allowlists, and hardware QA evidence?

## What Not To Copy

- Local control server bound to `0.0.0.0` with broad CORS.
- `nodeIntegration: true` and `contextIsolation: false` for a hardware-control renderer.
- Placeholder test script that exits success.
- Broad release file globs.
- Shipping SSL/private key material.
- Printing signing certificate material in CI logs.
- Monolithic main-process file coupling UI, server, streamer, firmware flashing, and release/support concerns.

## Study Limitations

- No dependency installation or runtime launch was performed.
- No hardware behavior was verified.
- No claims here prove LaserForge is correct or incorrect.
- All LaserForge implications must be validated sector by sector against local evidence.
