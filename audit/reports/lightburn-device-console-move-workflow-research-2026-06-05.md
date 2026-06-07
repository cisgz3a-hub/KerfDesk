# LightBurn Device / Console / Move Workflow Research

Date: 2026-06-05
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: audit and roadmap only. No production code was changed for this report.

## Executive Summary

LaserForge's current laser-control foundation is stronger than several older audit notes imply. The current checkout already has a single serial-owner model, Start From and 9-point Job Origin controls, start readiness gating, controller settings detection, explicit Electron serial-port choice, GRBL error terminal handling, disconnect safety notices, G92 Set Origin, jog cancel, and a receive-only laser log.

The remaining weakness is LightBurn workflow breadth, not a total absence of safety plumbing. LaserForge still does not have separate LightBurn-style Devices, Move, and Console workflows. Its current right-rail Laser panel is useful, but it combines several jobs into one compact surface and omits important operator workflows: multiple device profiles, Find/Create device setup, Get Position, move-to coordinates, saved positions, finish position, Console command entry, command macros, Save/Run machine file workflow, rubber-band/continuous framing, and test-fire/laser-on framing.

The next build should not start with arbitrary Console command input or a Fire button. Those are deceptively small controls with direct machine-safety consequences. The safest LightBurn-parity order is:

1. Devices manager and profile persistence.
2. Move window expansion using existing safe motion actions.
3. Console as read-only plus structured safe commands.
4. Strictly gated Console command input.
5. Save/Run machine file workflow routed through existing preflight/streamer.
6. Advanced hardware-gated controls: fire button, laser-on framing, continuous jog/frame.

## Official LightBurn Baseline

The baseline below is based on official LightBurn and GRBL/Web Serial references, plus the repo's existing LightBurn study documents.

### Laser Window

LightBurn's Laser Window is the job-control hub. It exposes machine/device selection, port selection, Start/Pause/Stop, Send/Save/Run machine-file workflows when supported, Frame, Home, Go to Origin, Start From, Job Origin, selected-graphics toggles, optimization access, rotary/galvo toggles where relevant, elapsed/remaining time, and status.

Reference: https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/
Reference: https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/

### Move Window

LightBurn's Move Window is not just a jog pad. It contains jog controls, jog speed/distance, Get Position, absolute move-to coordinates, saved positions, Set/Clear User Origin, Finish Position, Focus Z, Fire controls, and continuous jog support where the controller supports it.

Reference: https://docs.lightburnsoftware.com/latest/Reference/MoveWindow/

### Console Window

LightBurn's Console Window displays controller messages, status, errors, alarms, and sent commands. It can send direct G-code/GRBL commands and has controls such as Show All to include repeated motion/status chatter. For GRBL machines this includes common commands such as `$$`, `$I`, `$#`, `?`, `$X`, `$H`, and setting writes.

Reference: https://docs.lightburnsoftware.com/latest/Reference/ConsoleWindow/
Reference: https://docs.lightburnsoftware.com/latest/Troubleshooting/GRBLErrors/

### Devices

LightBurn's Devices workflow supports machine discovery, manual creation, imported device profiles, device selection, edit/remove/default/no-machine workflows, dimensions, origin behavior, homing behavior, and controller-family choices such as GRBL versus GRBL-M3 where applicable.

Reference: https://docs.lightburnsoftware.com/latest/Reference/Devices/
Reference: https://docs.lightburnsoftware.com/latest/GetStarted/CreateManually/
Reference: https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/BasicSettings/

### Coordinates And Job Origin

LightBurn separates coordinate behavior from job placement. Absolute Coordinates use the machine/workspace origin. Current Position starts the job from the current head position. User Origin starts from a stored user origin. The 9-dot Job Origin is meaningful for Current Position and User Origin, but not Absolute Coordinates.

Reference: https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/

### GRBL Safety And Streaming Constraints

GRBL has real-time commands (`?`, `!`, `~`, Ctrl-X soft reset, jog cancel) and normal line commands (`$H`, `$X`, `$$`, `$J=...`, `G92`, `G92.1`). Host software must not treat line commands and real-time bytes as interchangeable. GRBL also buffers received commands; host-side disconnect stops new host streaming, not necessarily already-buffered controller motion.

References:

- https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md
- https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands

Web Serial is permissioned and event-driven. A disconnect event tells the app that the port became unavailable; it does not prove the machine physically stopped.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event

## Current LaserForge Coverage

### Single Laser Panel

Evidence inspected:

- `src/ui/app/App.tsx`
- `src/ui/laser/LaserWindow.tsx`
- `src/ui/laser/ConnectionBar.tsx`
- `src/ui/laser/StatusDisplay.tsx`
- `src/ui/laser/JogPad.tsx`
- `src/ui/laser/JobControls.tsx`
- `src/ui/laser/LaserLog.tsx`

LaserForge currently exposes laser controls through one right-side panel. The panel contains connection controls, device settings, detected-settings banner, status, jog pad, job controls, safety notice area, and laser log. This is workable for the current app size, but it is not LightBurn parity because Move, Console, and Devices are distinct workflows in LightBurn.

### Start From And Job Origin

Evidence inspected:

- `src/ui/laser/JobPlacementControls.tsx`
- `src/ui/job-placement.ts`
- `src/core/job/job-origin.ts`
- `src/ui/laser/start-job-readiness.ts`
- `src/ui/laser/JobControls.test.tsx`

Older reports that say Start From and 9-dot Job Origin are missing are stale. Current code exposes Absolute Coordinates, Current Position, and User Origin, plus a 9-anchor Job Origin picker. The picker is disabled for Absolute Coordinates, which matches LightBurn's conceptual split.

Current gap: placement appears to be UI/session state, not durable project state. If LaserForge intends job placement to save in `.lf2`, this needs a persistence decision. If it is intentionally session-only like some machine-state controls, the UI copy should make that clear.

### Device Settings And Detected GRBL Settings

Evidence inspected:

- `src/ui/laser/DeviceSettings.tsx`
- `src/core/devices/device-profile.ts`
- `src/core/controllers/grbl/parse-settings.ts`
- `src/ui/laser/DetectedSettingsBanner.tsx`
- `src/core/preflight/controller-readiness.ts`

LaserForge has an inline active-device profile editor and a detected-settings flow for GRBL settings. It parses `$$` values including max power, min power, laser mode, max feed, acceleration, and bed dimensions. Controller readiness blocks unsafe or unknown settings such as missing/mismatched `$30` and disabled/unknown `$32`.

This is good safety groundwork, but it is not a Devices manager. There is no multi-device list, import/export profile file, duplicate/remove/default device workflow, Find My Laser wizard, No Machine mode, serial-port profile binding, or explicit GRBL/GRBL-M3 driver choice.

### Move / Jog

Evidence inspected:

- `src/ui/laser/JogPad.tsx`
- `src/ui/state/laser-store.ts`
- `src/core/controllers/grbl/commands.ts`
- `src/ui/state/laser-motion-operation.ts`

LaserForge supports step-based XY jogging with preset distances and `$J=` commands. It also has jog cancel support and machine-operation gating around frame/jog/autofocus.

Missing LightBurn parity:

- Get Position button.
- Absolute move-to coordinates.
- Saved positions.
- Finish Position.
- Continuous jog.
- Z/focus controls beyond the current autofocus path.
- Fire button and laser power for manual firing.

Fire and laser-on framing should remain deferred until they have hardware-gated UX, visible warning copy, tests, and a low-power hardware verification script.

### Frame

Evidence inspected:

- `src/ui/laser/JobControls.tsx`
- `src/ui/state/laser-motion-operation.ts`
- `src/core/job/job-placement.ts`
- `src/core/job/job-bounds.ts`

LaserForge currently frames a rectangle from computed job bounds. It preflights placement and physical bounds, then sends `$J=G90` rectangle moves.

Missing LightBurn parity:

- Rubber-band frame.
- Continuous frame.
- Laser-on frame.
- Separate frame-speed workflow tied to Move speed.

Safety note: custom-origin frame behavior needs hardware confirmation. The code preflights offset physical bounds, while the emitted frame path uses the resolved bounds sent as absolute jog coordinates. This may be correct if GRBL's jog command is interpreted in the intended coordinate system, but it deserves a specific hardware test because the consequence is a physical frame in the wrong area.

### Console

Evidence inspected:

- `src/ui/laser/LaserLog.tsx`
- `src/ui/state/laser-line-handler.ts`
- `src/core/controllers/grbl/response.ts`
- `src/core/controllers/grbl/status-parser.ts`
- `src/core/controllers/grbl/commands.ts`
- `src/core/controllers/grbl/streamer.ts`

LaserForge has a receive-only log, not a Console workflow. It displays lines and can hide status polling chatter, but there is no command input, command history, macros, Show All equivalent beyond the status toggle, or explicit command policy.

This is a deliberate safety opportunity. A Console command input must not become a second serial writer. It must route through the same store/controller path and respect the streamer's state. Normal line commands should be blocked while a job is active, paused, errored, or when frame/jog/autofocus is active. Realtime controls during an active job should be exposed as structured buttons through existing actions, not as arbitrary text.

### Serial And Port Permission

Evidence inspected:

- `src/platform/web/web-serial.ts`
- `electron/main.ts`
- `electron/serial-port-choice.ts`
- `electron/trusted-renderer-policy.ts`
- `src/platform/types.ts`

Older concern about Electron silently auto-picking a serial port appears stale in this checkout. The current Electron path asks the user to choose from available ports and validates trusted renderer origins. The Web Serial adapter uses `requestPort`, has stale-port cleanup, reads line-oriented input, handles disconnect events, and routes close events back to application state.

### Disconnect And Error Handling

Evidence inspected:

- `src/ui/state/laser-store-helpers.ts`
- `src/ui/state/laser-store.ts`
- `src/ui/state/laser-line-handler.ts`
- `src/core/controllers/grbl/streamer.ts`

LaserForge now treats disconnect during active work as unsafe. Explicit disconnect sends a soft reset for active jobs or jog cancel for motion operations before teardown where possible. Cable-yank-style closure raises a disconnect safety notice that states buffered GRBL commands may still be executing.

Controller `error:N` is terminal for the host streamer and raises a notice. One unresolved safety policy question remains: on controller error during a running stream, should LaserForge also send feed hold or soft reset after classifying the error? Because GRBL may still have queued motion, this needs careful controller-specific testing, not a casual patch.

## Retired Or Stale Findings

These findings should not be repeated unless new evidence proves regression:

- "Start From / Job Origin is missing" - current code has both.
- "Start does not gate on non-idle/alarm state" - current readiness logic checks active stream, autofocus, alarm, unknown status, non-idle status, controller readiness, project preflight, placement bounds, and emitted G-code preflight.
- "Electron auto-selects the first serial port" - current code presents a serial-port selection dialog.
- "GRBL `error:N` is ignored" - current line handler and streamer treat errors as terminal and surface a safety notice.
- "Disconnect during a job is treated as normal idle" - current helper raises a disconnect-during-job safety notice and explicit disconnect attempts a reset/cancel first.

## Remaining Gaps And Findings

### DCM-1: No Devices Manager

Severity: P2 workflow gap
Confidence: high
Trigger path: operator uses more than one machine, changes bed/controller settings, or needs to recreate a device profile after browser storage loss.

LaserForge has only one active inline profile. LightBurn has a Devices workflow for selection, discovery/manual creation, edit/remove, and profile import/export. LaserForge should add a Devices manager before adding riskier console controls because profile selection and detected settings are foundational to every output and movement decision.

Concrete fix:

- Add a persisted device-profile list.
- Keep one active profile ID.
- Add create manually, duplicate, rename, remove, set default, import, export.
- Keep current inline editor as the active-profile editor.
- Add a No Machine / simulation state for design-only work if useful.
- Keep explicit Web Serial port selection; do not auto-bind silently.

### DCM-2: Move Workflow Is Too Small

Severity: P2 workflow gap
Confidence: high
Trigger path: operator needs to position material accurately, return to a known point, or verify coordinates before Start/Frame.

LaserForge's JogPad is step-only XY movement. LightBurn's Move Window also supports Get Position, move-to coordinates, saved positions, user origin controls, finish position, focus/Z workflow, and optional fire controls.

Concrete fix:

- Split a Move panel/window from the current JogPad.
- Reuse existing `jog`, `home`, `setOrigin`, `resetOrigin`, `cancelMotionOperation`, and status state.
- Add Get Position using the current cached status report.
- Add move-to coordinates via a new safe motion action that uses `$J=G90`.
- Add saved positions as local app state first.
- Add Finish Position as an output/job postamble decision only after explicit design review.
- Defer Fire until a hardware-gated plan exists.

### DCM-3: Console Is Log-Only

Severity: P2 workflow gap, P1 if implemented unsafely
Confidence: high
Trigger path: operator needs to inspect `$$`, `$I`, `$#`, alarms, or send recovery commands like `$X` after troubleshooting.

LaserForge's log is useful, but it is not a Console. However, a raw Console input is one of the highest-risk parity features because it can bypass preflight, streamer accounting, and motion gates.

Concrete fix:

- First rename/split the current log as "Console Log" or equivalent.
- Add structured safe buttons for common read-only commands: `?`, `$I`, `$$`, `$#`.
- Route all commands through `laser-store.ts`, not direct serial writes.
- Block line commands while streaming, paused, errored, framing, jogging, homing, or autofocus is active.
- Add a denylist/confirmation policy for `$` setting writes, startup lines, motion commands, origin commands, laser power commands, `M3/M4/M5`, `S` words, and `G92/G10`.
- Keep realtime emergency controls as existing explicit buttons: pause, resume, stop/soft reset, jog cancel.

### DCM-4: Save/Run Machine File Workflow Is Incomplete

Severity: P2 workflow gap
Confidence: medium-high
Trigger path: operator wants to save emitted G-code, rerun a known machine file, or separate design export from live streaming.

LightBurn distinguishes starting from the current design versus sending/saving/running machine files where supported. LaserForge has output generation and live streaming, but does not yet expose a mature machine-file workflow comparable to LightBurn's Laser Window/File List paths.

Concrete fix:

- Keep "Export G-code" as design-derived output.
- Add "Run G-code file" only if it routes through the same connection, streamer, stop/pause, disconnect, and preflight safety model.
- Add an explicit warning that externally supplied G-code cannot be fully validated against LaserForge object/layer intent.
- Run emitted-file invariant scans before streaming external files where possible: bounds, laser-on travel, long blank feed, modal S/power sanity, unsupported commands.

### DCM-5: GRBL-M3 / Old Controller Workflow Is Undefined

Severity: P2 compatibility gap
Confidence: medium
Trigger path: operator connects an older GRBL controller or one with `$32=0`.

LightBurn documents GRBL versus GRBL-M3 behavior for controller generations. LaserForge currently gates heavily on `$32` laser mode and does not expose a full controller-driver choice. This is probably correct for a Falcon-focused app, but the decision should be explicit.

Concrete fix:

- Decide whether LaserForge supports only GRBL 1.1+ laser-mode controllers.
- If yes, document and keep blocking `$32=0`.
- If no, add a profile-level driver mode with separate output semantics and tests.

### DCM-6: Autofocus Command Contract Is Inconsistent

Severity: P1/P2 depending on hardware usage
Confidence: high
Trigger path: operator chooses the UI's multi-line GRBL probe preset and runs autofocus.

The device profile allows a multi-line autofocus command and the Autofocus editor offers a multi-line probe preset, but the runner rejects multi-line commands. This is not directly a LightBurn parity issue, but it sits in the same Move/Device workflow and will confuse hardware users.

Concrete fix:

- Either change the UI to store one command only, or update the runner to execute a validated command sequence with the same acknowledgement and timeout model as other motion operations.
- Add persistent safety notice if autofocus times out while the controller is still moving or status is unknown.

### DCM-7: Coordinate Label Can Mislead Operators

Severity: P2 safety/usability
Confidence: medium-high
Trigger path: controller reports WPos but no MPos; UI falls back to WPos while labeling it MPos.

The status display fallback should not label work coordinates as machine coordinates. LightBurn's coordinate workflows rely on operators understanding machine coordinates, current position, and user origin.

Concrete fix:

- Show separate `MPos` and `WPos` rows when available.
- If using fallback, label it as `WPos`, not `MPos`.
- Add tests for status reports that include only one coordinate type.

## Recommended Build Order

### Phase DCM-0: Safety Policy ADR

Write a short policy document before code changes:

- One serial owner: all writes through the laser store/controller path.
- Realtime bytes versus normal line commands are separate APIs.
- Normal command lines are blocked while any job/motion/autofocus operation is active.
- `$X` unlock does not mean safe-to-start.
- Disconnect detection does not prove physical halt.
- Fire and laser-on frame are hardware-gated features.

Verification:

- Review policy against GRBL command/interface docs.
- Add it to the roadmap so Claude/Codex do not build Console as a direct serial text box.

### Phase DCM-1: Devices Manager

Build first because it improves workflow without adding dangerous machine commands.

Files likely involved:

- `src/core/devices/device-profile.ts`
- `src/ui/state/store.ts`
- `src/ui/laser/DeviceSettings.tsx`
- New `src/ui/laser/DevicesManager.tsx`
- New tests near current store/device tests.

Core behavior:

- Store multiple device profiles.
- Set active profile.
- Create, duplicate, rename, remove, export, import.
- Keep detected settings apply flow pointed at the active profile.
- Do not auto-pick serial ports silently.

### Phase DCM-2: Move Window

Build second using existing safe actions.

Files likely involved:

- `src/ui/laser/JogPad.tsx`
- New `src/ui/laser/MoveWindow.tsx` or `MovePanel.tsx`
- `src/ui/state/laser-store.ts`
- `src/core/controllers/grbl/commands.ts`
- `src/ui/state/laser-motion-operation.ts`

Core behavior:

- Jog speed and distance controls.
- Get Position from cached status.
- Move-to coordinates using safe `$J=G90` action.
- Set/Clear Origin using existing origin actions.
- Saved positions.
- Motion cancel.

Defer:

- Fire button.
- Laser-on framing.
- Continuous jog.
- Z/focus workflows beyond current autofocus.

### Phase DCM-3: Console Read Commands

Build third as a safe structured Console.

Files likely involved:

- `src/ui/laser/LaserLog.tsx`
- New `src/ui/laser/ConsolePanel.tsx`
- `src/ui/state/laser-store.ts`
- `src/core/controllers/grbl/commands.ts`
- `src/ui/state/laser-line-handler.ts`

Core behavior:

- Show log.
- Toggle status chatter.
- Buttons for `?`, `$I`, `$$`, `$#`.
- Route through the store.
- Block if disconnected or if active motion/job/autofocus makes the command unsafe.

### Phase DCM-4: Strict Console Input

Only after Phase DCM-3 has tests.

Core behavior:

- Input history.
- Idle-only line commands.
- Denylist and confirmation policy.
- No direct serial writer.
- No commands during active stream except dedicated realtime controls.

### Phase DCM-5: Machine File Workflow

Core behavior:

- Export current design's emitted G-code.
- Optional Run G-code file through the same streamer and safety controls.
- External G-code warnings and invariant scan.

### Phase DCM-6: Advanced Controls

Treat these as hardware-verified features, not ordinary UI polish:

- Fire button.
- Laser-on frame.
- Continuous frame.
- Continuous jog.
- Finish position.
- Z/focus workflow expansion.
- GRBL-M3 support if explicitly chosen.

## Verification Plan

Existing tests to extend:

- `src/ui/laser/start-job-readiness.test.ts`
- `src/ui/laser/start-job-placement.test.ts`
- `src/ui/laser/JobControls.test.tsx`
- `src/ui/laser/LaserWindow.test.tsx`
- `src/ui/state/laser-store.test.ts`
- `src/ui/state/laser-store-motion-operation.test.ts`
- `src/ui/state/laser-line-handler.test.ts`
- `src/core/controllers/grbl/commands.test.ts`
- `src/core/controllers/grbl/streamer.test.ts`
- `src/core/preflight/controller-readiness.test.ts`
- `src/platform/web/web-serial.test.ts`
- `electron/serial-port-choice.test.ts`

New tests needed:

- Devices manager creates/duplicates/removes/selects active profile without corrupting current project.
- Detected settings apply only to active profile.
- Move-to is blocked unless connected, idle, known status, no active job, no active motion, no autofocus.
- Move-to emits safe `$J=G90` commands and supports cancel.
- Console read commands route through store and are blocked when disconnected.
- Console line input is blocked during streaming/paused/errored/frame/jog/autofocus.
- Console denylist catches `$` writes, startup lines, motion commands, origin commands, `M3/M4/M5`, and standalone `S` power commands.
- Status display labels `MPos` and `WPos` honestly.
- Autofocus UI and runner agree on single-line versus sequence semantics.

Hardware verification before claiming full parity:

1. Connect to Falcon over Web Serial.
2. Confirm explicit port selection.
3. Home and verify status.
4. Get Position and compare with controller report.
5. Jog X/Y small steps, cancel a jog, and verify no queued motion continues unexpectedly.
6. Set Origin, Frame, Clear Origin, Frame again.
7. Test Current Position and User Origin with low-power scrap framing.
8. Disconnect during idle, jog, and supervised low-risk streaming; verify notices.
9. Confirm Console read-only commands do not disrupt streaming.
10. Do not test Fire or laser-on frame until those features have separate hardware-gated acceptance criteria.

## Sources

- LightBurn Laser Window: https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/
- LightBurn Move Window: https://docs.lightburnsoftware.com/latest/Reference/MoveWindow/
- LightBurn Console Window: https://docs.lightburnsoftware.com/latest/Reference/ConsoleWindow/
- LightBurn Devices: https://docs.lightburnsoftware.com/latest/Reference/Devices/
- LightBurn Create Manually: https://docs.lightburnsoftware.com/latest/GetStarted/CreateManually/
- LightBurn Coordinates and Origin: https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/
- LightBurn Job Control: https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/
- LightBurn Device Basic Settings: https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/BasicSettings/
- LightBurn GRBL Configuration: https://docs.lightburnsoftware.com/latest/Guides/GRBLConfiguration/
- LightBurn GRBL Errors: https://docs.lightburnsoftware.com/latest/Troubleshooting/GRBLErrors/
- GRBL commands: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- GRBL interface/streaming: https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md
- GRBL v1.1 commands reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
- MDN Web Serial disconnect event: https://developer.mozilla.org/en-US/docs/Web/API/SerialPort/disconnect_event
