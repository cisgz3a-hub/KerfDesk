# LASERFORGE CROSS-REFERENCE

## LaserForge Baseline

Before comparing external repos, inspect LaserForge itself.

### Required LaserForge Discovery

- Repo path: `C:/Users/Asus/LaserForge`
- Commit hash: `366d6bad9872b0a71ae2c13be256f6232233d458`
- Branch: `master`
- Working tree status at preflight: untracked `external-repo-study-and-audit.md`; this audit workspace was created after that status snapshot.
- Main stack: TypeScript, React, Vite, Electron.
- Package manager: npm.
- Build commands:
  - `npm run build`
  - `npm run electron:compile`
  - `npm run electron:build`
  - `npm run electron:build:mac`
- Test commands:
  - `npm test`
  - `npm run test:unit`
  - `npm run test:output`
  - `npm run test:sim`
  - `npm run test:perf`
  - `npx tsx tests/<file>.test.ts`
- Lint/typecheck commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npx tsc --noEmit --pretty false`
  - `npx eslint . --max-warnings 0`
- Electron usage: `electron/` shell with main/preload/storage/serial/Falcon WiFi surfaces per `CLAUDE.md`.
- Serial/USB/network usage: Web Serial through `MachineService` / `GrblController`; Falcon WiFi bridge under `electron/falcon-wifi/`; network and IPC require targeted study.
- Controller support: GRBL 1.1 focus; Falcon A1 Pro is the known hardware target; future broader firmware support must be evidence-backed.

### LaserForge Discovery Still Required

These are not yet audited in this external-repo study:

- Current module map for `src/app`, `src/core`, `src/controllers`, `electron`.
- Current exported-symbol inventory status.
- Current CI status.
- Current hardware validation status.
- Current feature behavior in Pro/Easy modes.

Those will be filled sector by sector after each external repo study, not in one full-repo pass.

## Cross-Reference Table

| Topic | External Repo Finding | LaserForge Current State | Gap | Action |
|---|---|---|---|---|
| Modern laser-app architecture | Rayforge uses a documented UI -> DocEditor -> process/services -> core/services layer model and a DAG artifact pipeline; VisiCut converts PLF parts/mappings/profiles into `LaserJob` before driver send/save. | Baseline says `Scene -> Job -> Plan -> Output -> Device`; captured artifacts under `audit-artifacts/laserforge/`. | Unknown until focused LaserForge pipeline sector review. | ADAPT PATTERN |
| GRBL streaming | Rayforge uses character-counting flow control; LaserGRBL adds practical byte-counted buffered streaming, pending `ok`/`error` accounting, retry-on-error mode, and buffer-size adaptation from GRBL status; LaserWeb4 is a caution because worker/progress CAM still joins full G-code strings before send; UGS models streaming as active commands, command stream, command buffer, sent byte count, controller RX capacity, and error-driven pause; bCNC uses `cline` command-length accounting against a 128-byte RX buffer plus status polling and wait barriers; Candle uses a 127-byte active-command budget, queued commands, and response-driven release; OpenBuilds CONTROL tracks `sentBuffer`, parsed `[OPT]` RX size, `BufferSpace()`, `ok` release, blocked/paused state, and realtime bypass, but still materializes full `runJob()` input before queueing. | GRBL controller and output spool paths exist; captured `search-controller-streaming.txt`. | Unknown until focused LaserForge streaming sector review. | ADAPT PATTERN / REJECT FAKE STREAMING |
| Pause/resume/stop safety | MeerK40t uses realtime `!`, `~`, and soft reset; LaserGRBL resume analyzes prior commands, safe-travels with `M5 G0`, restores settled modals, and then continues; UGS tests pause/resume/cancel by firmware capability and controller state including hold, door, jog, alarm, and soft reset; bCNC uses feed hold, resume, soft reset, queue/probe cleanup, modal/TLO restoration, and state refresh during purge; Candle ties sender states to pause/abort/error paths and sends feed hold on program error before operator Ignore/Abort; OpenBuilds CONTROL uses `!`, `~`, jog cancel `0x85`, delayed Ctrl-X, optional `0x9E`, and queue/sent-buffer clearing for stop. | Safety paths documented in `CLAUDE.md`; requires sector verification. | Unknown until focused job lifecycle/resume sector review. | ADAPT PATTERN |
| Laser-on/off safety | MeerK40t emits M3/M4 and finishes with `G1 S0`/`M5`; LaserGRBL exposes M3/M4 import options, warns when M4 is used without laser mode, models M4/G0 as non-burning, and queues `M5` on abort/end; VisiCut/LibLaserCut documents the compatibility split between `G1 S0` white travel and `G0`/moveto for machines that ignore power scaling; LibLaserCut's GRBL driver explicitly uses wait-for-ok, pre-job `M3`, post-job `M5`, spindle max 1000, and `G0 ... S0` rapid blanking; K40 Whisperer's EGV emitter tracks explicit ON/OFF modal state and flushes laser-off at operation/path boundaries; OpenBuilds CONTROL laser test uses `G1F1`, `M3S...`, optional dwell, and `M5S0`, with stop/pause special-casing for GRBL `1.1d`. | `M3`/`M4`/`M5` safety is a known high-scrutiny area; requires sector verification. | Unknown until focused output/device-control sector review. | ADAPT PATTERN |
| Device/controller abstraction | MeerK40t isolates controller-family behavior with service/provider/device/driver/controller packages; VisiCut delegates output and capability checks through LibLaserCut `LaserCutter` drivers; LibLaserCut exposes an explicit supported-driver list and per-driver capability/settings contract; K40 Whisperer demonstrates that K40/Lihuiyu boards need a separate USB packet/EGV protocol rather than GRBL settings; bCNC separates GRBL0, GRBL1, Smoothie, and G2Core controller behavior and error/alarm messages; OpenBuilds CONTROL detects Grbl, grblHAL, FluidNC, unsupported Smoothieware, USB vendor/product hints, `[OPT]` buffer features, and profile defaults. | GRBL-focused today; broader controller support requires evidence. | Unknown until focused device abstraction sector review. | ADAPT PATTERN |
| Raster/image engraving | LaserGRBL has line-to-line raster, dithering, vectorization, centerline, Potrace, segment optimization, and zero-power travel compaction; LaserWeb4 adds a broad raster settings surface; VisiCut/LibLaserCut exposes raster direction, first/last non-white pixels, padding, machine-compatible white-pixel behavior, and overscan clamping to transformed machine-space limits; K40 Whisperer adds a useful caution around color-based operation mapping and large-page raster slowdown; bCNC's `imageToGcode` shows scan converters, pixel step, split step, safety height, and full-list output as both a CAM reference and a materialization caution. | Raster pipeline exists; requires sector verification. | Unknown until focused raster/image sector review. | ADAPT PATTERN |
| Vector/CAM pipeline | MeerK40t's `CutPlan` and `OperationWorkflow` explicitly model staged planning, inner-first constraints, grouped pieces, travel optimization, and no-suppression tests; LaserWeb4 uses preflight and CAM workers; VisiCut/LibLaserCut has inner-first optimizer tests and profile-to-job conversion. | Scene/job/plan pipeline exists; requires sector verification. | Unknown until focused vector/fill/path-ordering sector review. | ADAPT PATTERN |
| Preview/simulation | LaserGRBL preview walks the same `GrblCommand` list with `StatePositionBuilder`; LaserWeb4 reparses emitted G-code and derives both G-code and laser preview from the same parsed array; UGS derives visualizer geometry from parser/stream readers and maintains fixtures for raw stream and parsed output; Candle builds visualizer/progress geometry from parser-produced line segments, bounds, modal state, S-values, and line indexes; OpenBuilds CONTROL uses G-code worker parsing, a Three.js viewer, queue progress events, and large-file editor warnings. | Preview and simulator surfaces exist; requires sector verification. | Unknown until focused preview/output sector review. | ADAPT PATTERN |
| WCS/origin/homing | Rayforge documents MACHINE, WORKAREA, WCS, and WORLD coordinate spaces; VisiCut/LibLaserCut applies a start point once, records transformed origin, and resets the start point to prevent double-application; LibLaserCut's bounds checks use transformed origin when evaluating raster padding and machine-space limits; UGS chooses homing, WCS reset, unlock, check-mode, parser-state, soft reset, and jog behavior by GRBL version/capability; bCNC documents `$10` MPos and `$13=0`, parses WCO/PRB, and routes coordinate setting through G10/G92/G28/G30; Candle parses `$G`/`$#`, refreshes offsets after G10/G92, and warns that WCS is not restored after reset/e-stop user commands; OpenBuilds CONTROL surfaces `$21`/`$22`/`$23`, travel settings, `[GC]` modal state, homing state, WCS reset confirmation, and reset-to-controller-baseline flows. | WCS consent and placement certainty are roadmap areas; captured `search-origin-wcs.txt`. | Unknown until focused WCS/origin sector review. | ADAPT PATTERN |
| Material presets/beginner workflow | Rayforge has material libraries, recipes, specificity matching, and material test grids; VisiCut maps graphics through material/profile/property managers before creating job parts; K40 Whisperer exposes a simple operator model with initialize, home, unlock, jog, raster engrave, vector engrave, vector cut, run G-code, and pause/stop; bCNC's LaserCut plugin exposes feed, power, M3/M4/Auto, repeated passes, Z policy, header/footer, and an explicit operator validation expectation; Candle documents machine setup and WCS zeroing as part of normal operator workflow. | Settings/user-mode surfaces exist; requires sector verification. | Unknown until focused material/beginner workflow sector review. | ADAPT PATTERN |
| Electron/Node desktop security | LaserWeb4's UI-to-comm-server Socket.IO boundary exposes connect/run/pause/resume/stop/jog/test-fire style payloads, which is useful only if trusted-side validation exists; LibLaserCut's generic G-code driver shows that host, HTTP upload URL, autoplay, API-key, and serial settings are device-control trust-boundary data; K40 Whisperer shows USB permissions and controller discovery are operational trust-boundary surfaces, not just setup details; Candle exposes command-capable script, serial, telnet, and websocket APIs, including direct realtime command sends; OpenBuilds CONTROL is the strongest anti-pattern comparator because it combines `0.0.0.0`, CORS `*`, private-network access, command-capable Socket.IO handlers, disabled Electron warnings, Node integration, and disabled context isolation. | Electron main/preload/Falcon WiFi surfaces exist; requires sector verification. | Unknown until focused IPC/Falcon/security sector review. | ADAPT VALIDATION PATTERN / REJECT BROAD LOCAL-SERVER MODEL |
| Release/package workflow | LaserGRBL uses Inno Setup packaging for Windows artifacts and bundled resources; LaserWeb4 points users to a separate binaries repo and the inspected clone has old dependencies and no visible modern Actions gate; UGS has official Maven build/test/package commands and visible GitHub Actions/nightly release posture; Candle has concrete CMake/vcpkg/system-Qt build docs and nightly Windows release signals, but test execution was not proven in this static pass; OpenBuilds CONTROL provides release anti-patterns: placeholder tests, release-on-push, printing signing certificate material, broad package globs, and SSL material in package includes. | Signed workflow and artifacts exist per handoff; requires sector verification. | Unknown until focused release/package sector review. | ADAPT PACKAGING LESSONS / REJECT LEGACY POSTURE |
| Observability/support diagnostics | K40 Whisperer documentation treats USB driver/permission/timeouts as operator-support issues; UGS has command logging, localized error messages that say streaming paused on error, and controller/visualizer state surfaces; bCNC documents serial-spy transcript capture and includes a fake-GRBL smoke harness; Candle logs console traffic, connection errors, parser state, offsets, and sender state into visible UI surfaces; OpenBuilds CONTROL exposes queue counts, firmware buffers, port state, alarm text, console logs, preview parsing, and diagnostic toggles, with privacy cautions around machine/system identifiers. | Support bundle and event ledger exist per handoff; requires sector verification. | Unknown until focused observability/support sector review. | ADAPT DIAGNOSTIC PATTERN |
