# LaserWeb4 Study

## Metadata

- Repo URL: `https://github.com/LaserWeb/LaserWeb4.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/laserweb4`
- Pinned commit: `9403a659a89d70dc0f18cff6194ce1820c9843c9`
- Submodules pinned:
  - `src/data/lw.machines`: `685d9de193400a7bcf35d921eda21e4bedfbdc7b`
  - `src/data/lw.materials`: `dce9f9ae104030e192a9716f095988dc33c0c0cd`
- Branch inspected: `dev-es6`
- Status: COMPLETE
- Evidence level: PARTIALLY VERIFIED

## Purpose of This Repo in the LaserForge Study

This repo is being studied primarily for web-style CAM/control architecture, vector/CAM pipeline, raster settings, Electron/Node-like trust boundaries, and legacy design mistakes to avoid.

## Build, Test, and Runtime Status

- Build/test execution: NOT RUN.
- Reason: static study only; no dependency install scripts or npm lifecycle scripts were run.
- Evidence: `audit-artifacts/laserweb4/build-test-status.txt`.
- Commands identified from repo scripts and README:
  - `npm install`
  - `npm run installdev`
  - `npm run bundle-dev`
  - `npm start`
  - `npm run bundle-live`
  - Docker build/run commands from README
- Tool availability captured: Node, npm, and Docker were present locally.

## Artifacts Captured

- `audit-artifacts/laserweb4/git-head.txt`
- `audit-artifacts/laserweb4/git-status.txt`
- `audit-artifacts/laserweb4/git-remote.txt`
- `audit-artifacts/laserweb4/submodule-status.txt`
- `audit-artifacts/laserweb4/file-list.txt`
- `audit-artifacts/laserweb4/readme.txt`
- `audit-artifacts/laserweb4/package-json.txt`
- `audit-artifacts/laserweb4/travis.txt`
- `audit-artifacts/laserweb4/github-tree.txt`
- `audit-artifacts/laserweb4/controller-comm-surface.txt`
- `audit-artifacts/laserweb4/cam-preview-surface.txt`
- `audit-artifacts/laserweb4/performance-large-job-surface.txt`
- `audit-artifacts/laserweb4/test-release-surface.txt`
- `audit-artifacts/laserweb4/build-test-status.txt`

## Repo Summary

LaserWeb4 is a web-oriented laser/CNC CAM and machine-control application. The README states that this repository is a development environment and points regular users to a separate binaries repo. It supports a broad firmware list including Grbl variants, Smoothieware, TinyG, Marlin, Repetier, and RepRapFirmware. The stack is an older React/Redux/Webpack application paired with a communication server dependency (`lw.comm-server`) and a collection of CAM/raster worker modules.

The useful lesson for LaserForge is not to copy LaserWeb4's old dependency or release posture. The useful comparison points are:

- web UI to local comm-server boundary,
- CAM preflight and operation workers,
- rich raster parameter surface,
- preview generated from parsed emitted G-code,
- explicit but warning-heavy bounds UX,
- and the large-job anti-pattern where worker output is still joined into full strings.

## Architecture and Runtime Signals

- `package.json` scripts show separate frontend and communication server startup:
  - `start-server`: `node node_modules/lw.comm-server/server.js`
  - `start-app`: `webpack-dev-server --progress --colors --open`
  - `start`: parallel frontend and server launch with `npm-run-all`
- The app communicates with the local/server side over Socket.IO style events in `src/components/com.js` and legacy `src/lib/lw.comm-client.js`.
- `src/components/com.js` emits machine actions such as `connectTo`, `runJob`, `pause`, `resume`, `stop`, `laserTest`, `jog`, `jogTo`, `clearAlarm`, and `resetMachine`.
- The README's firmware table is broad, but the local study did not verify firmware-specific behavior at runtime.
- License: AGPL-3.0. Treat this as a concept study only; do not copy code into LaserForge.

## CAM and Raster Pipeline

Evidence:

- `src/lib/cam-gcode.js`
- `src/lib/workers/cam-preflight.js`
- `src/lib/cam-gcode-laser-cut.js`
- `src/lib/cam-gcode-raster.js`
- `src/lib/lw.raster2gcode/raster-to-gcode.js`
- `src/reducers/operation.js`

Key observations:

- `getGcode()` in `src/lib/cam-gcode.js` builds a queue of per-operation jobs, uses a preflight worker, uses laser-cut/mill/lathe workers, and calls raster generation directly.
- `src/lib/workers/cam-preflight.js` filters document geometry by selected documents, tab documents, fill/stroke colors, closed/open geometry, and image docs.
- Laser cut generation validates operation fields such as laser diameter, line distance, laser power, passes, cut rate, A-axis diameter, and Z start height before output.
- Raster generation exposes explicit controls for smoothing, brightness, contrast, gamma, grayscale mode, shades of gray, invert color, dithering, overscan, trim-line, join-pixel, burn-white behavior, diagonal scanning, and verbosity.
- `RasterToGcode` supports `abort()`, non-blocking line scans, overscan, line reduction, and per-line progress callbacks.

Important anti-pattern:

- Despite worker/progress structure, `src/lib/cam-gcode.js` stores per-operation G-code strings in `gcode[]` and finishes with `done(settings.gcodeStart + gcode.join('\r\n') + settings.gcodeEnd)`.
- `src/lib/cam-gcode-raster.js` also accumulates raster job strings and calls `done(gcode.join("\r\n"))`.
- `RasterToGcode` maintains `this.gcode` and `this.gcodes` arrays and calls `_onDone({ gcode: this.gcode })`.
- This is not true streaming. It is useful evidence that worker boundaries do not automatically solve large-job memory pressure.

LaserForge action:

- Keep LaserForge's spool-backed start path as the better target model.
- Use LaserWeb4 as a regression warning: any future "streaming" path must prove it does not rebuild a full G-code string before device send.

## Device Control and Safety Surface

Evidence:

- `src/components/com.js`
- `src/components/jog.js`
- `src/lib/lw.comm-client.js`
- `src/reducers/settings.js`

Key observations:

- Connection input is serialized as comma-delimited strings for USB, Telnet, and ESP8266 connect paths.
- `runJob(job)` requires only server/machine connection and non-empty job text before emitting `runJob`.
- `pauseJob()`, `resumeJob()`, and `abortJob()` are UI-side Socket.IO events. The visible UI component does not prove controller-side safety-off behavior.
- `laserTest(power, duration, maxS)` emits a comma-delimited payload based on settings.
- `checkGcodeBounds()` warns when generated G-code exceeds machine width/height but the run button remains enabled with warning styling and a title.
- `checkSize()` creates a bounding-box trace from parsed G-code bounds and configured check-size power.

LaserForge action:

- Treat warning-only bounds/start behavior as an anti-pattern for LaserForge.
- LaserForge should keep service-level start gates and tests for bounds, frame, safety-off, recovery, and explicit override behavior.
- Any LaserForge local-server, Falcon WiFi, or IPC action should validate command payloads at the trusted boundary, not only in the UI.

## Preview and Simulation Surface

Evidence:

- `src/lib/tmpParseGcode.js`
- `src/draw-commands/GcodePreview.js`
- `src/draw-commands/LaserPreview.js`
- `src/components/workspace.js`

Key observations:

- Workspace render reparses current G-code text with `parseGcode(gcode)`.
- Both G-code preview and laser preview are built from the same parsed output array.
- `GcodePreview` computes path bounds and timing from parsed points.
- `LaserPreview` renders burn intensity from parsed `S` values and configured `gcodeSMaxValue`.

LaserForge action:

- This supports the audit rule that preview should come from plan/output truth, not guessed UI state.
- LaserForge should continue proving preview/output parity with emitted-output fixtures, especially for M3/M4/G0/S-value behavior and raster gaps.

## Release, Test, and Supply-Chain Posture

Evidence:

- `package.json`
- `.travis.yml`
- `.github/`
- `audit-artifacts/laserweb4/github-tree.txt`

Key observations:

- `.github` contains templates only in the shallow clone; no GitHub Actions workflow was found.
- `.travis.yml` exists, but this study did not run or validate historical CI.
- `package.json` has many old dependencies and git-based dependencies, including the comm server and raster/vector packages.
- No usable test script was identified from the inspected package metadata.
- README points users to a separate `LaserWeb4-Binaries` repo for releases.

LaserForge action:

- Do not copy the release/test posture.
- Use LaserWeb4 as a negative benchmark for supply-chain freshness, test gates, and split binary/source release validation.

## Registered Lessons

### LF-EXT-LW4-001: Web UI to comm-server boundary needs trusted-side validation

Risk: HIGH

LaserWeb4 sends connect, job, pause/resume/stop, jog, laser test, and reset actions as Socket.IO events. This is a useful architecture boundary, but it is also a reminder that all machine-control payloads must be validated at the trusted server/main-process boundary.

### LF-EXT-LW4-002: Worker/progress CAM is not enough if final output is joined

Risk: HIGH

LaserWeb4 uses workers and queues, but still materializes final output with `gcode.join(...)`. This is the exact fake-streaming trap LaserForge should continue avoiding.

### LF-EXT-LW4-003: Raster settings surface is useful, but needs golden output coverage

Risk: MEDIUM

LaserWeb4 exposes rich raster options: overscan, dithering, trim-line, join-pixel, burn-white, diagonal scan, image filters, power range, and line reduction. LaserForge should compare feature parity only through fixtures that prove emitted output and preview behavior.

### LF-EXT-LW4-004: Warning-only bounds/start UX is an anti-pattern for LaserForge

Risk: HIGH

LaserWeb4's bounds check warns and styles the run button but does not prove a hard service-level start block. LaserForge should keep hard device-control gates for unsafe starts and require explicit tested overrides where compatibility demands it.

### LF-EXT-LW4-005: Preview-from-parsed-output is a useful parity model

Risk: MEDIUM

LaserWeb4 builds both G-code and laser preview from parsed emitted G-code. LaserForge should keep or strengthen plan/output-derived preview tests, especially for modal laser state and S-values.

### LF-EXT-LW4-006: Old dependency and release posture should be rejected

Risk: LOW

LaserWeb4 is historically useful but has old dependencies, git dependencies, no visible modern Actions gate in the inspected clone, and no confirmed test command. LaserForge should not copy that release posture.

## Rejected Copy Patterns

- Do not copy AGPL code into LaserForge.
- Do not copy comma-delimited machine-control payloads without strong validation and schema tests.
- Do not copy warning-only run gating for out-of-bounds jobs.
- Do not copy final `gcode.join(...)` materialization for device-send paths.
- Do not copy old dependency/test/release posture.

## Unknowns

- Runtime behavior of `lw.comm-server` was not inspected because dependencies were not installed.
- CI status and binary release process were not verified beyond static files.
- Controller-specific behavior for each README-supported firmware was not validated.
- Hardware behavior was not tested.
