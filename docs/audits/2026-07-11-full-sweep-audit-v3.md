# KerfDesk full-sweep audit v3 — fresh start-to-finish pass

**Audit date:** 2026-07-11
**Audited repository:** `cisgz3a-hub/KerfDesk` (`LaserForge-2.0`)
**Audited worktree:** `.claude/worktrees/admiring-hamilton-666624`
**Audited branch:** `claude/multi-sector-audit-3447b9`
**Audited commit:** `34218fd15854ab7b9969ccd6b8619ffc36324dee`
**Remote state:** commit is the content parent of `origin/main` merge commit `3e4530748ad9b266f5a21904f033f68e2c0014bb`; `git diff HEAD..origin/main` is empty.
**Method:** fresh source review, previous-audit claim revalidation, rendered browser inspection, direct perceptual-trace measurement, complete local release gate, and live GitHub CI verification. No machine, spindle, laser, or camera was operated.

## Executive verdict

KerfDesk is an unusually broad and mechanically disciplined CAM application. Its pure-core pipeline, deterministic output, hostile-input handling, controller seam, preflight checks, simulator coverage, and release gate are real strengths. The newest R1–R6 corrections are also materially implemented.

It is **not yet responsible to call the complete product release-verified**. The largest remaining risks are not ordinary lint defects:

1. the CNC beginner default is a full-depth profile cut with holding tabs disabled;
2. controller kind and streaming mode can still be combined incompatibly;
3. the new tracer's strongest reference-pair acceptance harness compares different artwork and has no fidelity threshold;
4. machine-profile export silently drops baud rate plus project-level camera calibration/alignment;
5. the camera bridge deliberately retains a documented hosted-origin-to-private-network capability;
6. Windows installers and updates remain unsigned;
7. the fixed 320 px + 300 px side rails substantially collapse the canvas at common web viewport sizes.

**Overall grade: B+ mechanically, B- as a fully release-proven machine product.**

## What is genuinely excellent

- Output production is centralized through `prepareOutput()`, emitter selection, and preflight instead of being independently rebuilt by Preview, Save, Frame, and Start.
- G-code behavior has snapshot, property, invariant, and controller-simulator coverage.
- Safety state is modeled explicitly across alarms, reboot, stream errors, tool-change holds, framing, origin knowledge, and recovery.
- The R1 checkpoint fix now freezes the resolved Current Position origin and tests a changed post-crash head position.
- The R2 camera fix refuses an impossible live rectified overlay and rectifies captured stills before applying a rectified-basis homography.
- The R4 laser-limit advisory now uses the slower reported XY rate and includes object speed overrides.
- The tracer presets are live through the worker-backed in-house contour/centerline/edge pipeline; they are not dead test-only code.
- Direct measurement on the committed 1024² Arch House source completed quickly: roughly 0.34–2.20 seconds per preset in core execution.
- Contour input-fidelity on that source is strong: Line Art `0.953`, Smooth `0.965`, Sharp `0.981` IoU against each preset's own preprocessed mask.
- Current HEAD passes the complete release gate and the matching GitHub CI run is green.

## Feature and workflow map

| Surface | What lives there | Audit assessment |
|---|---|---|
| Top application menu | File, Edit, Tools, Arrange, Laser/CNC, Window, Help | Broad command coverage; Tools has 31 items in one scrolling menu and needs sub-grouping. |
| Primary toolbar | Project actions, imports, text, jig, camera, board placement, box generator, Trace, bitmap conversion, export, Preview | Strong discoverability for frequent actions, but it wraps to two rows at 1024 px and consumes scarce vertical space. |
| Numeric toolbar | Anchor matrix and X/Y/W/H/rotation edits | Correct placement for selection transforms; 22 px targets are dense. |
| Left tool strip | Select, node edit, measure, primitives, pen, move laser, design library | Coherent creation workflow; compact 28 px targets suit mouse use better than touch/accessibility use. |
| Center workspace | Bed, rulers, snapping, zoom, camera overlay, preview/simulation | Correct conceptual home, but fixed rails can reduce it to about 279 px wide at a 1024 px viewport. |
| Cuts / Layers rail | Machine-kind switch, layer creation/settings, material library, object overrides | Correct domain ownership; at 320 px fixed width it competes heavily with the canvas. |
| Laser/CNC rail | Setup, connection, jog, origin, Frame/Start, recovery, Console | Safety-critical controls are colocated, but the 300 px fixed rail plus internal scrolling hides lower controls. |
| Machine Setup | Controller, device, camera, safety zones, tools, firmware-facing configuration | Appropriate home, but export/import completeness and multi-machine lifecycle remain incomplete. |
| Trace dialog | Source decoding, presets, boundary enhancement, preview, commit | New tracer is live and worker-backed; perceptual acceptance evidence needs repair. |

## Priority findings

### V3-01 · P1 · CNC starts with a through-cut and no holding tabs

`DEFAULT_CNC_STOCK.thicknessMm` and `DEFAULT_CNC_LAYER_SETTINGS.depthMm` are both `6.35`, while `tabsEnabled` defaults to `false`. A newly created profile-outside CNC layer therefore cuts completely through the starter stock and releases the part/hole slugs on the final pass.

The app now presents a useful warning, but the preflight intentionally allows the job. That is not a safe beginner default for the product's Basic-mode promise.

**Required correction:** default profile cuts to a shallow engraving depth or enable holding tabs when the default reaches stock thickness. Keep the warning for later operator overrides.

### V3-02 · P1 · Controller kind and streaming mode are still independently selectable

`DeviceProfile` stores `controllerKind` and `streamingMode` independently. Validation checks only that the streaming mode is syntactically valid. `runStartJobFlow()` sends `project.device.streamingMode` directly to the streamer.

Catalog Marlin/Smoothieware profiles correctly use ping-pong, but an imported, edited, or partially applied profile can combine Marlin with char-counted streaming. The simulator tests prove supported combinations; they do not reject unsupported ones.

**Required correction:** define compatibility in the controller driver or one normalization function and enforce it during profile import, profile apply, setup review, and Start.

### V3-03 · Major · The new tracer reference-pair test cannot prove its stated acceptance goal

`arch-house-reference-loop.test.ts` says the trace should look identical to the committed outline/filled reference pair. The three committed images are not aligned variants of one drawing: the reference artwork changes geometry, font shape, proportions, roof/water detail, and black/white interpretation relative to the colored source.

The test itself measures the mismatch:

- source ink versus filled reference ceiling: IoU `0.145`;
- Line Art versus filled reference: `0.144`;
- Smooth versus filled reference: `0.144`;
- Sharp versus filled reference: `0.144`;
- Edge Detection versus filled reference: `0.163`.

It still passes because it is environment-gated and asserts only that paths exist and one distance mean is finite. No reference IoU, precision, recall, or chamfer limit is enforced.

This does **not** show that the new tracer is bad. Its input-mask fidelity is good. It shows that the new evidence cannot support “identical to the reference” or catch a future regression against that stated goal.

**Required correction:** create registered ground truth from the same source geometry, define preset-specific numeric thresholds, and run at least one real-source gate in normal CI. Preserve manual crops for subjective review.

### V3-04 · Major · Contour supersampling checks the source against the pixel cap, then quadruples it

`MAX_UPSCALE_SOURCE_PIXELS` is `1,500,000`. The adaptive small-source path budgets `sourcePixels × factor²`, but the new `supersampleContour` branch checks only `sourcePixels <= 1,500,000` and then applies a fixed 2× upscale.

A 1200×1200 source therefore passes the 1.5M check and becomes a 2400×2400, 5.76M-pixel working image. The worker has a hard 30-second timeout, and the contour pipeline allocates several image-sized buffers. This contradicts the code comment that the cap bounds the 4× cost.

**Required correction:** gate on the resulting pixel count (`sourcePixels × factor²`) or rename the constant and establish a separate measured working-pixel/memory budget. Add a complex near-limit worker test.

### V3-05 · P1 · Machine-profile export silently drops machine-critical fields

`canonicalProfile()` omits:

- `baudRate`;
- `cameraCalibration`;
- `cameraAlignment`.

It retains `cameraProfile` and nested lens metadata, but the live workspace/Trace paths read the separate project-level calibration and alignment fields. Exporting and re-importing a configured machine can therefore lose serial behavior and bed registration without warning.

**Required correction:** round-trip every machine-critical `DeviceProfile` field or explicitly reject/export-with-warning when a field is unsupported. Bump the schema if the document contract changes.

### V3-06 · P1 accepted residual · Hosted pages can still drive the private-camera bridge

The latest bridge work correctly removes preview wildcards, matches exact origin tuples including ports, and blocks loopback proxy targets. However, exact `https://kerfdesk.com` and `https://laserforge-2fj.pages.dev` origins are intentionally trusted.

An XSS or compromise on either hosted application can still use the operator's loopback bridge to discover, probe, and fetch frames from RFC1918/ULA cameras. ADR-133 documents this residual and defers per-session capability authentication.

**Required correction:** use an unguessable per-session bridge token/capability, or drop hosted-origin bridge access. Until then, label this accepted risk—not closed security hardening.

### V3-07 · P1 release integrity · Windows builds and updates remain unsigned

The updater feed is pinned and the release workflow is well structured, but signing is optional and the documented v1 path is unsigned when secrets are absent. Operators cannot rely on publisher identity when installing or updating a machine-control application.

**Required correction:** provision and require a signing identity for production tags, verify the signed artifact before upload, and fail a production release when signing is absent.

### V3-08 · Major · FluidNC numeric setting writes remain reachable through Console

The FluidNC driver advertises `settings: 'readonly-dump'` but spreads GRBL's `prepareConsoleCommand`. `sendConsoleCommand()` does not compare a prepared numeric `$N=value` command with the driver's settings capability. The dedicated settings editor blocks writes, while the Console can still send the same persistent command after confirmation.

**Required correction:** capability-gate numeric setting commands inside the driver command preparation or the shared Console action, with a FluidNC console regression test.

### V3-09 · P2 · Fixed rails and dense targets damage normal web use

At a measured 1024×768 viewport:

- workspace width: about `279 px`;
- Cuts/Layers rail: about `345 px` including borders/layout allocation;
- Laser rail: about `325 px`;
- 76 of 81 visible buttons were under 32 px in at least one dimension;
- anchor targets are 22×22 px and drawing tools are approximately 28×28 px.

The toolbar wraps, the canvas becomes a narrow strip, and the Laser rail relies on internal scrolling. There is no responsive rail collapse, tabbing, or resizable splitter.

**Required correction:** add collapsible/resizable side panels and a compact single-rail mode below a defined breakpoint. Preserve the canvas as the primary work surface.

### V3-10 · P2 · The Tools menu is a flat 31-item feature warehouse

Creation, calibration, image editing, tracing, booleans, fill repair, bitmap conversion, and box testing share one scrolling menu. Disabled items remain mixed with unrelated available operations. This makes powerful features exist without being easy to find or understand.

**Required correction:** group into visible submenus/sections such as Create, Calibrate, Image, Vector, and Generators; mirror the same taxonomy in help and command search.

### V3-11 · P2 accessibility · Application menus do not implement menu keyboard navigation

Dropdown items use `role="menuitem"`, but family summaries handle only Enter/Space and the document handles Escape. There is no ArrowLeft/Right family movement, ArrowDown opening/focus, ArrowUp/Down item navigation, Home/End, or roving focus.

**Required correction:** implement the WAI-ARIA menubar keyboard pattern or use native menu semantics without applying partial `menu`/`menuitem` roles.

### V3-12 · P2 · Tiled CNC exports still omit provenance metadata

Single-file export passes `buildGcodeMetadata()` through `emitGcode()`. Tiled export calls `cncGrblStrategy.emit()` directly and writes the raw body. Each tile passes motion preflight, but the saved files lack build SHA, emitter revision, and machine assumption lines.

**Required correction:** prepend the same sanitized metadata header to each tile after preflight, adding tile row/column identity.

### V3-13 · P2 · PWA update reload can surface during disconnected incomplete recovery

The update prompt hides while `isActiveJob(streamer)` is true. After a disconnect/crash-like transition, the streamer may no longer be active while a checkpoint or unresolved safety notice still represents incomplete machine work. Reload can then be offered before recovery state is resolved.

**Required correction:** gate Reload on the broader machine-busy/recovery contract: checkpoint presence, unresolved terminal safety state, controller operation, and active motion—not only an active streamer.

### V3-14 · Major architecture governance · Published hard boundaries are not actually enforced

`CLAUDE.md` says public exports above 20 are a hard limit and enforced. The current checker reports 15 barrels over that hard cap, including:

- `core/scene/index.ts`: 158 exports;
- `core/controllers/grbl/index.ts`: 102;
- `core/camera/index.ts`: 90;
- `core/job/index.ts`: 85;
- `core/devices/index.ts`: 76.

`check:index-exports` is report-only and is not part of `release:check`. The soft-size report likewise lists 80 files over 250 counted lines; several sit at 399–400 lines near the hard cliff.

**Required correction:** either make the documented caps truthful and staged, or enforce them for new growth with a ratchet/baseline. Do not describe report-only diagnostics as current hard CI policy.

### V3-15 · P2 test quality · No browser E2E suite covers the assembled application

The repository has excellent Vitest/jsdom and simulator coverage, but no Playwright/Cypress/E2E files or gate. The full suite emits numerous React `act(...)` and jsdom “not implemented” diagnostics while still passing. Static/rendered inspection found no browser-console errors on the empty workspace, but core workflows are not exercised end-to-end in a real browser.

**Required correction:** add a side-effect-free browser suite using synthetic project fixtures for open/import, layer edits, Trace preview/commit, Preview, Save, machine-mode switching, and recovery banners. Hardware actions must remain mocked/blocked.

## Previous R1–R6 closure ledger at this fresh HEAD

| Prior item | Fresh verdict |
|---|---|
| R1 Current-Position checkpoint recovery | **Fixed.** Schema 3 stores resolved `JobOriginPlacement`; flow test changes head position before resume. |
| R2 rectified camera overlay | **Fixed in code.** Captured stills rectify; impossible live rectified overlays show a visible mismatch notice. Perceptual/hardware alignment remains unverified. |
| R3 exact bridge origin | **Port-exactness fixed; hosted-origin residual accepted and open.** |
| R4 asymmetric/object speed warning | **Fixed conservatively.** Uses slower axis and object overrides; output-scope precision is still advisory polish. |
| R5 tool identity at M0 hold | **Fixed.** Shared label prefix and ordered extraction reach the UI. |
| R6 final Clipper exception boundaries | **Fixed.** Kerf and panel-fit calls now use the Result boundary with regressions. |

## Sector scorecard

| Sector | Grade | Fresh assessment |
|---|---:|---|
| Import and file I/O | B+ | Strong hostile-input validation; machine-profile field loss and synthetic `.lbdev` evidence remain. |
| Canvas and creation | B+ | Broad creation/edit surface; fixed rails reduce usable canvas. |
| Layers and operations | B | Powerful model; CNC default policy and dense disclosure remain concerns. |
| Preview and simulation | B+ | Strong shared pipeline; assembled browser workflow lacks E2E proof. |
| G-code and motion safety | A- | Excellent invariants/preflight; tiled provenance remains inconsistent. |
| Machine control | B+ | Strong driver seam/simulators; streaming compatibility and FluidNC Console gap remain. |
| CNC/router | B | Very broad and well tested; through-cut/no-tab default is not beginner-safe; hardware evidence remains limited. |
| Camera and registration | B | Basis/resolution bugs fixed in code; security residual and perceptual/hardware verification remain. |
| Trace and raster | B+ | New tracer is live, fast on the reference source, and high-fidelity to its own mask; stated reference-pair gate is invalid and near-limit budgeting is wrong. |
| Recovery and persistence | B+ | Current-position/scope recovery fixed; single checkpoint slot, destructive dismissal, and PWA reload boundary remain. |
| Controller coverage | B | GRBL/grblHAL strongest; FluidNC/Marlin/Smoothieware/Ruida evidence remains asymmetric. |
| Security | B | CSP/import/bridge destination defenses are strong; hosted bridge access and unsigned distribution remain material. |
| Architecture | B+ | Clear pure-core boundaries and decomposition; documented API caps are substantially exceeded and not enforced. |
| UI information architecture | B- | Feature-rich and understandable at wide desktop sizes; fixed rails and flat Tools warehouse hurt discovery/workspace priority. |
| Accessibility | B- | Accessible names are generally good; target density and partial menu semantics need work. |
| Performance and robustness | B | Worker isolation and budgets exist; contour supersampling violates its own working-pixel budget. |
| Tests and CI | A- mechanical / B product | 4,345 passing tests and green CI; real-browser, hardware, and valid tracer-reference acceptance are missing. |
| Release readiness | B- | Local/remote gates green; unsigned Windows distribution and hardware/perceptual gaps prevent full sign-off. |

## Validation record

### Local release gate

`pnpm release:check` completed successfully:

- repository guard: passed;
- TypeScript: passed;
- ESLint and Electron ESLint: passed;
- Prettier: passed;
- production-license check: 33 packages / 7 allowed licenses;
- dependency audit: passed;
- Vitest: **698 files passed / 13 skipped; 4,345 tests passed / 18 skipped**;
- web build: passed, 978 modules transformed;
- Electron main build: passed;
- 600-raw-line hard backstop: passed;
- soft-size report: completed, 80 files above the soft threshold.

### Direct tracer reference loop

The opt-in Arch House reference loop passed mechanically in 13.03 seconds, but only because its assertions do not enforce the printed fidelity values. The printed values are recorded under V3-03.

### Rendered web inspection

- local app loaded at commit badge `34218fd1`;
- empty workspace produced no captured console warnings/errors;
- 1024×768 layout and target measurements recorded under V3-09;
- Tools-menu contents and feature placement inspected without importing, committing, or operating hardware.

### GitHub

- Current branch and remote commit matched after a fresh fetch.
- GitHub Actions CI run `29151674577` succeeded for exact SHA `34218fd15854ab7b9969ccd6b8619ffc36324dee`.
- The audited content is merged to `origin/main`; the only difference is the merge commit itself.

## Not verified and not safe to infer from green tests

- real laser burn, spindle cut, tool change, probing, or crash recovery;
- physical camera calibration/overlay alignment;
- raster engraving quality on material;
- FluidNC, Marlin, Smoothieware, or Ruida real hardware behavior;
- Ruida `.rd` acceptance by an independent decoder/controller;
- box fit or CNC through-cut behavior on real stock;
- Windows installer/update signature identity, because production signing is not required;
- LightBurn side-by-side perceptual parity for the new tracer.

## Recommended implementation order

1. Change the CNC beginner default or make tabs mandatory for the starter through-cut.
2. Enforce controller-kind/streaming-mode compatibility at every profile boundary and Start.
3. Repair the tracer ground-truth/reference harness and enforce real thresholds.
4. Correct supersample working-pixel budgeting and add a near-limit worker regression.
5. Round-trip baud, camera calibration, and camera alignment in machine profiles.
6. Capability-gate FluidNC Console settings writes.
7. Decide and implement bridge token authentication plus mandatory Windows signing.
8. Add collapsible/resizable rails and reorganize Tools.
9. Add real-browser, side-effect-free E2E coverage.
10. Ratchet module export/file-size governance and close tiled/PWA consistency gaps.

## Bottom line

This HEAD is substantially better than the earlier audit target, and the R1–R6 fix set largely survives a fresh review. The application has a strong safety and architecture spine. Its next gains should come from closing the gap between **mechanically green** and **operationally proven**: safer CNC defaults, compatible controller configuration, valid perceptual truth, complete machine-profile portability, authenticated/signed distribution, and a workspace-first responsive UI.
