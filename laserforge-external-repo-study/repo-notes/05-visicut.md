# VisiCut Study

## Metadata

- Repo URL: `https://github.com/t-oster/VisiCut.git`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/visicut`
- Pinned commit: `511a28e82d6b28e95754cd0441e53f134c5930e3`
- Submodule pinned:
  - `LibLaserCut`: `ebe72ea3af3b2ab52d797d8100c635f68722100e`
- Status: COMPLETE
- Evidence level: PARTIALLY VERIFIED

## Purpose of This Repo in the LaserForge Study

This repo is being studied primarily for job-preparation architecture, vector/CAM pipeline, application-to-driver boundaries, and integration with LibLaserCut.

## Build, Test, and Runtime Status

- Build/test execution: NOT RUN.
- Reason: static study only; Maven/Java build and dependency resolution were not executed.
- Evidence: `audit-artifacts/visicut/build-test-status.txt`.
- Commands identified from repo evidence:
  - `mvn -q -DskipTests=false clean package`
  - `./test.sh`
  - `java -jar target/visicut-*-full.jar`
- Local tool availability recorded no usable `java`, `mvn`, or `mvnw` path.

## Artifacts Captured

- `audit-artifacts/visicut/git-head.txt`
- `audit-artifacts/visicut/git-status.txt`
- `audit-artifacts/visicut/git-remote.txt`
- `audit-artifacts/visicut/submodule-status.txt`
- `audit-artifacts/visicut/file-list.txt`
- `audit-artifacts/visicut/readme.txt`
- `audit-artifacts/visicut/pom.txt`
- `audit-artifacts/visicut/travis.txt`
- `audit-artifacts/visicut/test-sh.txt`
- `audit-artifacts/visicut/github-tree.txt`
- `audit-artifacts/visicut/pipeline-driver-surface.txt`
- `audit-artifacts/visicut/laser-safety-surface.txt`
- `audit-artifacts/visicut/test-release-surface.txt`
- `audit-artifacts/visicut/build-test-status.txt`

## Repo Summary

VisiCut is a Java/Maven desktop application that delegates hardware output through the `LibLaserCut` submodule. The README states that VisiCut uses LibLaserCut for controlling laser cutters. The app model turns imported graphics and project files into `PlfPart`s, applies mappings and laser profiles, creates a `LaserJob`, then sends or saves that job through a selected `LaserCutter`.

This is a useful architecture benchmark for LaserForge because it keeps product-level project/mapping/profile logic separate from hardware-driver behavior.

## Application to Driver Boundary

Evidence:

- `src/main/java/de/thomas_oster/visicut/VisicutModel.java`
- `src/main/java/de/thomas_oster/visicut/model/LaserProfile.java`
- `src/main/java/de/thomas_oster/visicut/model/VectorProfile.java`
- `src/main/java/de/thomas_oster/visicut/model/RasterProfile.java`
- `src/main/java/de/thomas_oster/visicut/model/Raster3dProfile.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/LaserJob.java`

Key observations:

- `VisicutModel.prepareJob()` creates one `LaserJob`, applies the selected start point, autofocus, focus-offset, rotary-axis settings, and then walks every `PlfPart`.
- Each `PlfPart` has a mapping. Each mapping filters matching graphics and delegates to a `LaserProfile`.
- `LaserProfile.addToLaserJob(...)` is the application-to-CAM boundary. Vector, raster, and raster-3D profiles each convert matching graphics into `LaserJob` parts.
- `VisicutModel.sendJob()` and `VisicutModel.saveJob()` both prepare the same job, then delegate to `LaserCutter.sendJob()` or `LaserCutter.saveJob()`.
- This separation is a strong pattern for LaserForge's scene/job/plan/output/device boundaries: product intent should be converted to a validated job/plan before any device driver is allowed to emit or send.

## Bounds, Origin, and Capability Checks

Evidence:

- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/LaserJob.java`
- `LibLaserCut/src/test/java/de/thomas_oster/liblasercut/drivers/AllDriversTest.java`

Key observations:

- `LaserCutter.checkJob()` validates rotary support, rotary diameter, supported resolution, non-negative part bounds, and bed width/height before send/save paths.
- `LaserJob.setStartPoint()` stores a millimeter offset from the top-left laser-bed corner.
- `LaserJob.applyStartPoint()` subtracts the start point from vector and raster coordinates, records transformed origin, then resets the start point to `0,0`. The comment explicitly says multiple calls should not corrupt jobs.
- `AllDriversTest.checkErrorOnTooLargeJobs()` expects drivers to throw `IllegalJobException` for jobs larger than the bed and explicitly calls out missing `checkJob()` as the likely error.

LaserForge action:

- Compare LaserForge's WCS/origin reset and bounds pipeline against this "apply once and make reapplication harmless" invariant.
- Compare all LaserForge device-send/export paths against a single mandatory bounds/capability check, not UI-only checks.

## Raster and Power Handling

Evidence:

- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/LaserCutter.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/RasterizableJobPart.java`
- `LibLaserCut/src/test/java/de/thomas_oster/liblasercut/RasterizableJobPartTest.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/drivers/GenericGcodeDriver.java`
- `LibLaserCut/src/main/java/de/thomas_oster/liblasercut/drivers/Grbl.java`

Key observations:

- `LaserCutter.convertRasterizableToVectorPart()` documents a compatibility choice for white pixels: use `lineto()` with 0% power for smoother movement, or use `moveto()` for cutters that do not support scaling power to zero.
- The same function clips raster overscan/prestart positions to transformed machine-space limits unless raster padding is explicitly allowed outside machine space.
- `GenericGcodeDriver` exposes settings for line ending, wait-for-ok, serial timeout, blank-laser-during-rapids, S value for 100% power, raster padding, upload methods, and more.
- `Grbl` sets defaults including CRLF line endings, `waitForOKafterEachLine(true)`, pre-job `M3`, post-job `M5`, spindle max `1000`, and `blankLaserDuringRapids(true)`.
- `Grbl` sends `G0 ... S0` when blanking laser during rapids and forces `currentPower = -1` so the next cutting move emits a new S value.

LaserForge action:

- Compare LaserForge raster gap handling and white-pixel travel against the same compatibility problem: some devices are safe with `G1 S0`, others need rapid/non-cut moves.
- Keep tests for M3/M4/M5, S-value re-emission after blanking, and rapid non-burning semantics.

## Driver Output and Test Posture

Evidence:

- `LibLaserCut/src/test/java/de/thomas_oster/liblasercut/drivers/AllDriversTest.java`
- `LibLaserCut/test-output/*.out`
- `LibLaserCut/src/test/java/de/thomas_oster/liblasercut/vectoroptimizers/InnerFirstVectorOptimizerTest.java`
- `LibLaserCut/src/test/java/de/thomas_oster/liblasercut/RasterizableJobPartTest.java`
- `src/test/java/de/thomas_oster/visicut/model/graphicelements/SVGImportTest.java`

Key observations:

- `AllDriversTest.compareWithKnownOutput()` generates output for every driver that supports `saveJob()`, compares with committed known-good output files, and also reruns the same job to catch nondeterministic driver state leakage.
- `AllDriversTest.checkErrorOnTooLargeJobs()` tests that oversized jobs are rejected.
- `InnerFirstVectorOptimizerTest` covers nested/inner-first vector ordering.
- `RasterizableJobPartTest` covers raster line extraction, scan direction, first/last non-white pixels, and color-change calculations.
- `SVGImportTest` covers transformed stroke-width and visual bounding-box behavior.

LaserForge action:

- This is a strong pattern: driver/emitter correctness should be guarded with committed golden outputs plus repeated-generation determinism checks.
- Compare against LaserForge output tests for all supported output paths, including GRBL, preview/export, raster/fill/vector, and any compatibility modes.

## Import, PLF, and Project Lifecycle

Evidence:

- `VisicutModel.loadFile()`
- `VisicutModel.loadPlfFile()`
- `VisicutModel.savePlfToStream()`
- `PlfFile`, `PlfPart`, mapping/profile managers

Key observations:

- VisiCut treats project files (`.plf`) as ZIP containers with source graphics, transforms, mappings, and parametric parameter files.
- Non-PLF imports create or append `PlfPart`s and can apply a default mapping.
- Save writes source files, transform XML, mapping XML, and parametric parameters into the PLF container.

LaserForge action:

- Compare LaserForge project import/export/autosave against this explicit "project contains source, transforms, mapping/profile state" model.
- Do not invent a LaserForge issue until the persistence sector proves a concrete gap.

## Release and Supply-Chain Notes

Evidence:

- `pom.xml`
- `.travis.yml`
- `test.sh`
- `.github/`
- `legacy/*.jar`

Key observations:

- `pom.xml` builds a Java 11 jar and a shaded `full` jar with main class `de.thomas_oster.visicut.gui.VisicutApp`.
- `.travis.yml` runs `./test.sh` and references an external build-service Docker image.
- `pom.xml` installs legacy local jars such as `kabeja` artifacts.
- The public repo has a `.github` folder, but this pass did not validate modern GitHub Actions release gates.

LaserForge action:

- Use VisiCut's test/golden-output concepts, but do not copy legacy local-jar or release posture without a supply-chain review.

## Registered Lessons

### LF-EXT-VISI-001: Keep product job preparation separate from driver output

Risk: MEDIUM

VisiCut converts project parts, mappings, profiles, focus, rotary, and start point into a `LaserJob`, then delegates to `LaserCutter`. LaserForge should compare this against scene/job/plan/output/device separation.

### LF-EXT-VISI-002: Bounds and device capability checks belong at the driver/send boundary

Risk: HIGH

`LaserCutter.checkJob()` validates resolution, bed bounds, rotary support, and rotary diameter; driver tests catch missing oversized-job rejection.

### LF-EXT-VISI-003: Origin/start-point transforms must be idempotent

Risk: HIGH

`LaserJob.applyStartPoint()` subtracts start point once, records transformed origin, and resets start point so repeated calls do not corrupt jobs.

### LF-EXT-VISI-004: Raster white-pixel behavior must be machine-compatible

Risk: HIGH

LibLaserCut explicitly distinguishes smooth `lineto()` with 0% power from `moveto()` for devices that ignore power scaling. LaserForge should keep this as a raster safety compatibility audit target.

### LF-EXT-VISI-005: Driver output needs golden fixtures and repeated-run determinism checks

Risk: HIGH

`AllDriversTest` compares committed driver outputs and checks that repeated generation of the same job is identical.

### LF-EXT-VISI-006: Project import/export should preserve sources, transforms, and mapping/profile state

Risk: MEDIUM

VisiCut PLF files package source graphics, transforms, mappings, and parametric parameters. LaserForge should compare this against project save/load/autosave semantics.

## Rejected Copy Patterns

- Do not copy LGPL/GPL code into LaserForge.
- Do not copy legacy local JAR dependency practices.
- Do not infer GRBL production readiness from VisiCut/LibLaserCut without LaserForge-specific streaming and hardware validation.
- Do not copy top-left/start-point assumptions without matching LaserForge WCS/origin model.

## Unknowns

- Build/test/runtime behavior was not executed.
- Hardware behavior was not tested.
- LibLaserCut will be studied as its own repo next, so this note only records the LibLaserCut evidence needed to understand VisiCut's architecture boundary.
