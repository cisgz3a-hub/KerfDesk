# LibLaserCut Study

## Metadata

- Repo URL: `https://github.com/t-oster/LibLaserCut.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/liblasercut`
- Pinned commit: `ebe72ea3af3b2ab52d797d8100c635f68722100e`
- Status: COMPLETE
- Evidence level: PARTIALLY VERIFIED

## Purpose of This Repo in the LaserForge Study

This repo is being studied primarily for controller/driver abstraction, capability modeling, and how a laser application separates machine-independent jobs from controller-specific output.

## Build, Test, and Runtime Status

- Build/test execution: NOT RUN.
- Reason: static study only; Java/Maven were not available locally and dependency resolution/build scripts were not started.
- Evidence: `audit-artifacts/liblasercut/build-test-status.txt`.
- Commands identified from repo evidence:
  - `mvn -q -DskipTests=false clean test package`
  - `mvn -q -DskipTests=false clean package`
  - `./test.sh`

## Artifacts Captured

- `audit-artifacts/liblasercut/git-head.txt`
- `audit-artifacts/liblasercut/git-status.txt`
- `audit-artifacts/liblasercut/git-remote.txt`
- `audit-artifacts/liblasercut/file-list.txt`
- `audit-artifacts/liblasercut/readme.txt`
- `audit-artifacts/liblasercut/pom.txt`
- `audit-artifacts/liblasercut/test-sh.txt`
- `audit-artifacts/liblasercut/github-tree.txt`
- `audit-artifacts/liblasercut/github-workflows-tree.txt`
- `audit-artifacts/liblasercut/driver-abstraction-surface.txt`
- `audit-artifacts/liblasercut/laser-safety-streaming-surface.txt`
- `audit-artifacts/liblasercut/bounds-origin-capability-surface.txt`
- `audit-artifacts/liblasercut/raster-surface.txt`
- `audit-artifacts/liblasercut/test-surface.txt`
- `audit-artifacts/liblasercut/build-test-status.txt`

## Repo Summary

LibLaserCut is a Java/Maven hardware abstraction library used by VisiCut. Its README lists broad device support, including older Epilog machines, SmoothieBoard, generic G-code, LAOS, K40, generic GRBL boards, LTT iLaser, HPGL plotters, and more. `LibInfo.getSupportedDrivers()` registers concrete driver classes such as `GenericGcodeDriver`, `Grbl`, `SmoothieBoard`, `Marlin`, `K40NanoDriver`, and `Ruida`.

This is a high-value comparator for LaserForge because it shows a controller capability model that keeps a machine-independent `LaserJob` separate from controller-specific output and send behavior.

## Driver Abstraction and Capability Contract

Evidence:

- `src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `src/main/java/de/thomas_oster/liblasercut/LibInfo.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/GenericGcodeDriver.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/Grbl.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/K40NanoDriver.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/Ruida.java`

Key observations:

- `LaserCutter` is the central driver contract. It owns `sendJob(...)`, optional `saveJob(...)`, bed dimensions, supported resolutions, property support, rotary support, and the shared `checkJob(...)` sanity check.
- `checkJob(...)` rejects unsupported rotary use, invalid rotary diameter, unsupported DPI, negative X/Y part bounds, and max X/Y outside the cutter bed.
- `LibInfo.getSupportedDrivers()` is an explicit capability index. It makes controller-family support visible instead of treating every laser as the same GRBL-like device.
- `GenericGcodeDriver` exposes concrete machine/profile settings: host, COM port, baud, bed width/height, axis flips, pre/post G-code, supported DPI, wait-for-ok mode, serial timeout, blank-laser-during-rapids, spindle max, raster padding, decimal precision, upload mode, and API key.

LaserForge lesson:

LaserForge should keep machine profile capability checks hard at the trusted send/export/preflight boundary. Device differences should be explicit profile/capability data, not scattered conditional behavior or UI-only warnings.

## GRBL and G-code Dialect Behavior

Evidence:

- `src/main/java/de/thomas_oster/liblasercut/drivers/Grbl.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/GenericGcodeDriver.java`
- `test-output/de.thomas_oster.liblasercut.drivers.Grbl.out`
- `audit-artifacts/liblasercut/laser-safety-streaming-surface.txt`

Key observations:

- The GRBL driver specializes `GenericGcodeDriver`.
- It sets wait-for-ok after each line, adds `M3` to pre-job G-code, prepends `M5` to post-job G-code, uses spindle max `1000`, and enables "blank laser during rapids".
- Its rapid move override sends `G0 ... S0` when blanking rapids, because the code comments note that GRBL does not otherwise turn the laser off during G0 rapid moves.
- `sendLine(...)` waits for literal `ok` when wait-for-ok is enabled and throws on any other line.
- GRBL connection handling includes reset/homing/unlock behavior: it can send `$H`, wait for `ok`, and fail if the board remains locked.

LaserForge lesson:

LaserForge should continue treating M3/M4/M5, S-values, `$32`, G0, and wait-for-ok behavior as firmware-profile semantics. The important pattern is not the exact LibLaserCut GRBL output; it is that GRBL safety defaults are explicit, testable, and driver-owned.

## Bounds, Origin, and Idempotent Start-Point Handling

Evidence:

- `src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `src/main/java/de/thomas_oster/liblasercut/LaserJob.java`
- `src/test/java/de/thomas_oster/liblasercut/drivers/AllDriversTest.java`

Key observations:

- `LaserJob.setStartPoint(x, y)` treats the start point as millimeters from the top-left of the laser bed.
- `LaserJob.applyStartPoint()` mutates job part coordinates once, records `transformedOriginX/Y`, and resets `startX/startY` to zero so repeated calls do not double-apply the transform.
- `LaserJob` documents that transformed origin is the coordinate-space offset to use when checking whether a path is inside the laser bed.
- `AllDriversTest.checkErrorOnTooLargeJobs()` requires drivers with `saveJob` support to throw `IllegalJobException` for oversized jobs, catching missing `checkJob(...)` calls.

LaserForge lesson:

LaserForge's WCS reset-to-baseline, placement certainty, plan transforms, and repeated preflight/start paths need idempotency proof. If a user repeats compile, frame, start, export, or reset-WCS actions, coordinate transforms must not stack silently.

## Raster and White-Pixel Compatibility

Evidence:

- `src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `src/main/java/de/thomas_oster/liblasercut/RasterizableJobPart.java`
- `src/test/java/de/thomas_oster/liblasercut/RasterizableJobPartTest.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/GenericGcodeDriver.java`
- `src/main/java/de/thomas_oster/liblasercut/drivers/Grbl.java`

Key observations:

- `convertRasterizableToVectorPart(...)` explicitly models raster scanline conversion, bidirectional rastering, overscan/padding, first non-white pixel, color changes, and whether white pixels are emitted as 0%-power lines or travel moves.
- The code documents the compatibility split: using `lineto()` at 0% power is smoother on many machines, but some cutters do not properly scale laser power down to 0% and need `moveto()` for white pixels.
- Padding/overscan is clamped to transformed machine-space limits unless outside-machine-space padding is allowed.
- `RasterizableJobPartTest` covers blank lines, raster direction, first/last non-white pixels, next color changes, and scanline termination behavior.

LaserForge lesson:

The user's reported unintended cut lines match the kind of failure this pattern is designed to prevent. LaserForge should audit raster/vector/fill travel gaps by asking whether a white gap, overscan move, or separated island is represented as a rapid/travel move, an `S0` line, or a potentially burning modal continuation, and whether that behavior is safe for the selected firmware/profile.

## Golden Driver Output and Repeated-Run Determinism

Evidence:

- `src/test/java/de/thomas_oster/liblasercut/drivers/AllDriversTest.java`
- `test-output/*.out`
- `test-output/README`

Key observations:

- `AllDriversTest.compareWithKnownOutput()` iterates over supported drivers, saves a feature-rich dummy job, compares output to version-controlled `test-output/*.out`, and then generates the same job a second time.
- The repeated-run check is specifically meant to catch missing driver state reinitialization.
- The same test class checks too-large jobs and fails drivers that do not throw the expected exception type.

LaserForge lesson:

LaserForge already fixed shared G-code encoder state earlier, but this external pattern raises the bar: every output mode and profile-sensitive path should have golden output and repeat-generation tests, including raster gaps, G0/S0 behavior, M3/M4/M5, bounds, exported output, and spool-backed start output.

## Rejected Copy Patterns

- Do not copy LibLaserCut's Java architecture or dependency stack into LaserForge.
- Do not copy one-line wait-for-ok streaming as a replacement for LaserForge's GRBL spool/buffer logic; it is a useful safety reference but not a full performance model.
- Do not copy driver-specific behavior without confirming the target firmware profile and hardware behavior.
- Do not adopt local HTTP upload/API-key surfaces from `GenericGcodeDriver` without a fresh security review.

## Unknowns

- Build/test results are not verified locally because Java/Maven are unavailable.
- Hardware behavior is not verified; all observations are static source findings.
- Some driver classes may have device-specific assumptions that should not be generalized to GRBL or Falcon hardware.

## Registered Lessons for LaserForge

### LF-EXT-LLC-001: Make controller capability checks explicit at trusted boundaries

Use LibLaserCut's `LaserCutter.checkJob(...)` and driver capability model as the comparison lens for LaserForge preflight, device profiles, export, and start/send boundaries.

### LF-EXT-LLC-002: Keep GRBL modal safety defaults profile-owned and tested

Use the GRBL driver's explicit wait-for-ok, `M3`, `M5`, spindle max, and `G0 ... S0` rapid blanking choices as prompts for LaserForge's GRBL `$32`/`$30`, S-value, M3/M4/M5, and G0 safety tests.

### LF-EXT-LLC-003: Prove coordinate/start-point transforms are idempotent

Use `LaserJob.applyStartPoint()` as a test prompt for LaserForge repeated compile/preflight/start/export/WCS reset flows.

### LF-EXT-LLC-004: Audit raster white-gap behavior per machine profile

Use LibLaserCut's lineto-at-0%-power versus moveto compatibility distinction to audit LaserForge raster, fill, vector travel, and preview/output behavior.

### LF-EXT-LLC-005: Expand golden output and repeated-generation fixture coverage

Use `AllDriversTest` and `test-output/*.out` as the comparison pattern for LaserForge output determinism and state isolation.

### LF-EXT-LLC-006: Treat local/network upload surfaces as security-sensitive device-control paths

Use `GenericGcodeDriver`'s host, HTTP upload URL, autoplay, API-key, and serial settings as a prompt to keep LaserForge Falcon WiFi, Electron IPC, and any future network send path validated at the trusted boundary.
