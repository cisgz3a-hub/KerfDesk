# LaserForge-2.0 Sector Audit Progress Memory

Date started: 2026-07-03
Target checkout: `C:\Users\Asus\LaserForge-2.0`
Git root verified: `C:/Users/Asus/LaserForge-2.0`
Branch at audit start: `main`

## Sector Status

| Sector | Status | Passes Completed | Major Areas Remaining |
|---|---|---:|---|
| S01 Governance, audit history, and product contracts | Complete | 3 | None at sector level |
| S02 Tooling, build, release, CI, and static shell | Complete | 3 | None at sector level |
| S03 Electron desktop runtime and local bridge | Complete | 3 | None at sector level |
| S04 Core domain models, controller/device/material primitives | Complete | 3 | None at sector level |
| S05 Core job compilation, preflight, raster/trace, and output | Complete | 3 | None at sector level |
| S06 IO formats and persistence | Complete | 3 | None at sector level |
| S07 Platform adapters | Complete | 3 | None at sector level |
| S08 UI application workflows | Complete | 5 | None at sector level |
| S09 Fixtures, perceptual harness, and test assets | Complete | 3 | None at sector level |

## Completed Passes

| Pass | Completed | Summary |
|---|---|---|
| S01 Pass 1 | 2026-07-03 | Contract/audit-corpus orientation. Found naming drift, stale ADR index, stale release metrics/scope, workflow stubs, and dirty-worktree audit-risk. |
| S01 Pass 2 | 2026-07-03 | Independent consistency and audit-process pass. Found broad hardware wording, Cloudflare deploy-status contradiction, and missing audit-corpus index. |
| S01 Pass 3 | 2026-07-03 | Coverage and remaining-gap pass. Found stale `PROJECT.md` architecture sections and stale ADR numbering note. Closed S01 after three passes. |
| S02 Pass 1 | 2026-07-03 | Release gate and static host orientation. Found production camera permission denial and raw-line backstop scope gap. |
| S02 Pass 2 | 2026-07-03 | Gate consistency and escape-path pass. Found Node/pnpm engine mismatch and duplicated release-gate definitions. |
| S02 Pass 3 | 2026-07-03 | Coverage pass. Ran `pnpm guard:repo` and `pnpm check:file-size`; no new findings. Closed S02 after three passes. |
| S03 Pass 1 | 2026-07-03 | Electron runtime and bridge orientation. Found RTSP bridge CORS missing canonical domain and Electron permission policy missing browser camera/media grant. |
| S03 Pass 2 | 2026-07-03 | Runtime failure-mode and test-coverage pass. Focused Electron tests passed; found RTSP probe timeout risk and FFmpeg stream error-handling gap. |
| S03 Pass 3 | 2026-07-03 | Coverage and remaining-gap pass. `pnpm lint:electron` and focused Electron tests passed; found malformed IPv4-like RTSP host validation and stale CSP rationale comments. Closed S03 after three passes. |
| S04 Pass 1 | 2026-07-03 | Core domain orientation and dirty-path sweep. Full S04 test slice passed; found camera RTSP validation split, camera alignment robustness gap, camera capability/profile consistency gap, non-finite jog command emission, lenient GRBL suffix parsing, weak layer color invariant, and duplicated polyline bounds helper. |
| S04 Pass 2 | 2026-07-03 | Independent controller/device contract pass. Focused 6-file test slice passed; found scan-offset validator/normalizer disagreement, silent dialect fallback, and non-canonical GRBL setting write values. |
| S04 Pass 3 | 2026-07-03 | Remaining primitive and coverage sweep. Focused 29-file test slice passed; found welded vector metadata loss and non-finite selection transform propagation. Closed S04 after three passes. |
| S05 Pass 1 | 2026-07-03 | Job/preflight/raster/trace/output orientation. Full S05 core slice passed; found active no-go-zone duplicate parser drift, narrow duplicated G-code numeric parsing, and non-finite speed propagation to feed words. |
| S05 Pass 2 | 2026-07-03 | Compile/output operation-layer pass. Focused 10-file test slice passed; found pre-emit raster budget first-match bypass, main-preflight sub-layer drift, and silent malformed raster-luma whitening. |
| S05 Pass 3 | 2026-07-03 | Remaining preview/estimate/optimizer/trace sweep. Focused 15-file test slice passed; found raster scan-offset preview drift and raster duration-estimate wide-gap drift. Closed S05 after three passes. |
| S06 Pass 1 | 2026-07-03 | Persistence/import boundary orientation. Focused 35-file IO test slice passed; found project capability validation drift and missing SVG geometry/finite-coordinate import budget. |
| S06 Pass 2 | 2026-07-03 | Project persistence/export cross-reference pass. Focused 12-file IO/UI-boundary test slice passed; found missing `.lf2` total-geometry budget and missing scene ID/group-reference integrity validation. |
| S06 Pass 3 | 2026-07-03 | Remaining SVG/LightBurn/G-code metadata sweep. Focused 8-file IO test slice passed; found SVG symbol-use import loss and newline-unsafe G-code metadata comments. Closed S06 after three passes. |
| S07 Pass 1 | 2026-07-03 | Platform adapter boundary orientation. Focused 7-file platform test slice passed; found failed-save stream cleanup, unvalidated camera bridge JSON, and newline-terminated oversized serial line gaps. |
| S07 Pass 2 | 2026-07-03 | Web Serial lifecycle and platform policy guard pass. Focused 4-file platform test slice passed; found incomplete deploy gate pinning and documented-but-absent web save fallback. |
| S07 Pass 3 | 2026-07-03 | Remaining-gap and coverage sweep. Focused 4-file platform test slice passed; found untested stale-open Web Serial recovery and production-unused camera bridge preview URL API. Closed S07 after three passes. |
| S08 Pass 1 | 2026-07-03 | App shell, file actions, commands, and global hooks. Focused 48-file UI slice passed; found Focus Test enabled/dead-end mismatch, image file-I/O boundary bypass, and PWA update active-job state drift. |
| S08 Pass 2 | 2026-07-03 | Workspace canvas, interaction, and preview pass. Focused 42-file workspace slice passed; found missing live drag-hook coverage, invalid viewport coordinate risks, synchronous preview preparation on the UI path, and hidden-layer path-node hit-test drift. |
| S08 Pass 3 | 2026-07-03 | Laser, machine setup, and live state workflows. Focused 95-file laser/state slice passed; found selected-output Frame fallback drift for over-budget rasters and a missing keyboard stop/cancel path for active frame/jog motion. |
| S08 Pass 4 | 2026-07-03 | Layers, materials, raster/trace/text, calibration panels, and related state actions. Focused 54-file slice passed; found trace worker synchronous-send cleanup gap, trace boundary non-finite crop risk, cut-settings max-feed inconsistency, and mixed-selection selected-artwork settings ambiguity. |
| S08 Pass 5 | 2026-07-03 | Shared UI kit, help, accessibility, root job placement, preview overlays, and remaining text numeric edges. Focused 15-file slice passed; found undefined preview button chrome, help-id registry coverage drift, and weak text numeric finite/range validation. Closed S08 after five passes. |
| S09 Pass 1 | 2026-07-03 | Fixture corpus and perceptual artifact orientation. Focused 8-file fixture/perceptual slice passed; found real-logo non-PNG fixture acceptance, ignored artifact provenance drift, and missing artifact-writer dimension checks. |
| S09 Pass 2 | 2026-07-03 | Trace benchmark loop and real-fixture gates. Focused 5-file benchmark slice passed; found audit-tree fixture ownership ambiguity and unignored opt-in Arch House evidence outputs. |
| S09 Pass 3 | 2026-07-03 | Remaining fixture helper coverage and closure. Broad 11-file fixture/perceptual run passed; found weak centerline performance budget, missing PNG decoder malformed-file tests, and missing direct G-code rasterizer parser tests. Closed S09 and completed the full repo audit. |

## Fix Phase Progress

| Fix Pass | Completed | Scope | Result |
|---|---|---|---|
| Fix Phase 1 | 2026-07-03 | High-severity findings S02-001, S03-001, S03-002, and S05-004 | Fixed and after-fix audited. Focused policy/preflight tests, TypeScript check, Electron lint, and UI/preflight regression tests passed. |
| Fix Phase 2 | 2026-07-03 | Camera/RTSP/profile validation findings S03-003, S03-004, S03-005, S04-001, S04-002, S04-003, and S07-002 | Fixed and after-fix audited. Focused camera/profile/platform tests, TypeScript check, Electron lint, and camera UI/device setup regression tests passed. Remaining open findings: 66 (44 medium, 22 low). |
| Fix Phase 3 | 2026-07-03 | Numeric/finite-value invariant findings S04-004, S04-005, S04-010, S04-012, and S05-003 | Fixed and after-fix audited. Focused controller/scene/preflight/output/raster tests, adjacent UI/state tests, TypeScript check, and full lint passed. Remaining open findings: 61 (40 medium, 21 low). |
| Fix Phase 4 | 2026-07-03 | Raster preview/ETA parity findings S05-007 and S05-008 | Fixed and after-fix audited. Focused raster preview, output parity, duration-estimate, TypeScript, and full lint checks passed. Remaining open findings: 59 (38 medium, 21 low). |
| Fix Phase 5 | 2026-07-03 | Main preflight operation-layer awareness finding S05-005 | Fixed and after-fix audited. Focused preflight/raster/frame/preview tests, TypeScript, and full lint passed. Remaining open findings: 58 (37 medium, 21 low). |
| Fix Phase 6 | 2026-07-03 | Malformed raster luma handling finding S05-006 | Fixed and after-fix audited. Focused raster compile/project validation tests, TypeScript, and full lint passed. Remaining open findings: 57 (36 medium, 21 low). |
| Fix Phase 7 | 2026-07-03 | Project loader findings S06-001, S06-003, and S06-004 | Fixed and after-fix audited. Focused project/device/machine-profile tests, TypeScript, and full lint passed. Remaining open findings: 54 (33 medium, 21 low). |
| Fix Phase 8 | 2026-07-03 | SVG import findings S06-002 and S06-005 | Fixed and after-fix audited. Focused SVG parser/sanitizer/malicious-corpus tests, TypeScript, and full lint passed. Remaining open findings: 52 (31 medium, 21 low). |
| Fix Phase 9 | 2026-07-03 | Platform findings S07-001, S07-003, S07-004, S07-005, and S07-006 | Fixed and after-fix audited. Focused platform adapter/serial/deploy-policy tests, TypeScript, and full lint passed. Remaining open findings: 47 (26 medium, 21 low). |
| Fix Phase 10 | 2026-07-03 | UI command/PWA/path-node findings S08-001, S08-003, and S08-007 | Fixed and after-fix audited. Focused UI command/update/path-node tests, TypeScript, and full lint passed. Remaining open findings: 44 (23 medium, 21 low). |
| Fix Phase 11 | 2026-07-03 | Workspace drag hook coverage finding S08-004 | Fixed and after-fix audited. Focused workspace drag/hook tests, TypeScript, and full lint passed. Remaining open findings: 43 (22 medium, 21 low). |
| Fix Phase 12 | 2026-07-03 | Workspace coordinate guard finding S08-005 | Fixed and after-fix audited. Focused view-transform/drag tests, TypeScript, and full lint passed. Remaining open findings: 42 (21 medium, 21 low). |
| Fix Phase 13 | 2026-07-03 | Laser UI control findings S08-008 and S08-009 | Fixed and after-fix audited. Focused frame fallback/job shortcut/laser UI tests, TypeScript, and full lint passed. Remaining open findings: 40 (19 medium, 21 low). |
| Fix Phase 14 | 2026-07-03 | Trace UI findings S08-010 and S08-011 | Fixed and after-fix audited. Focused trace worker/preview/boundary tests, TypeScript, and full lint passed. Remaining open findings: 38 (17 medium, 21 low). |
| Fix Phase 15 | 2026-07-03 | Selected artwork mixed settings finding S08-013 | Fixed and after-fix audited. Focused selected-object/layer tests, TypeScript, and full lint passed. Remaining open findings: 37 (16 medium, 21 low). |
| Fix Phase 16 | 2026-07-03 | Image import and batch trace file-boundary finding S08-002 | Fixed and after-fix audited. Focused command shell/platform file-boundary tests, TypeScript, and full lint passed. Remaining open findings: 36 (15 medium, 21 low). |
| Fix Phase 17 | 2026-07-03 | Workspace preview preparation finding S08-006 | Fixed and after-fix audited. Focused preview scheduling/draw/raster tests, TypeScript, and full lint passed. Remaining open findings: 35 (14 medium, 21 low). |
| Fix Phase 18 | 2026-07-03 | Welded vector metadata finding S04-011 | Fixed and after-fix audited. Focused vector-path core/state/command tests, TypeScript, and full lint passed. Remaining open findings: 34 (13 medium, 21 low). |
| Fix Phase 19 | 2026-07-03 | Active no-go-zone preflight finding S05-001 | Fixed and after-fix audited. Focused no-go-zone/preflight tests, TypeScript, and full lint passed. Remaining open findings: 33 (12 medium, 21 low). |
| Fix Phase 20 | 2026-07-03 | S09 fixture/performance findings S09-001 and S09-006 | Fixed and after-fix audited. Focused fixture/perceptual tests, TypeScript, and full lint passed. Remaining open findings: 31 (10 medium, 21 low). |
| Fix Phase 21 | 2026-07-03 | S02 tooling/release findings S02-002, S02-003, and S02-004 | Fixed and after-fix audited. Expanded file-size gate, workflow policy tests, Electron build, and full `pnpm release:check` passed. Remaining open findings: 28 (7 medium, 21 low). |
| Fix Phase 22 | 2026-07-03 | S01 governance/documentation findings S01-001, S01-002, S01-003, S01-004, S01-005, S01-006, S01-007, and S01-009 | Fixed and after-fix audited. Source-of-truth docs refreshed, stale-claim sweep passed, workflow policy tests passed, and full `pnpm release:check` passed. Remaining open findings: 20 (0 medium, 20 low). |
| Fix Phase 23 | 2026-07-03 | S01 low-severity documentation findings S01-008 and S01-010 | Fixed and after-fix audited. Added audit-corpus index, refreshed ADR numbering guidance, and doc formatting passed. Remaining open findings: 18 (0 medium, 18 low). |
| Fix Phase 24 | 2026-07-03 | S03 Electron CSP rationale finding S03-006 | Fixed and after-fix audited. Electron CSP/permission comments now match local RTSP bridge and video-only media policy; focused Electron policy tests and Electron main build passed. Remaining open findings: 17 (0 medium, 17 low). |
| Fix Phase 25 | 2026-07-04 | S04 layer-color contract finding S04-006 | Fixed and after-fix audited. Core layer construction and object assignment now share hex color validation; focused scene/UI tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 16 (0 medium, 16 low). |
| Fix Phase 26 | 2026-07-04 | S04 polyline bounds duplication finding S04-007 | Fixed and after-fix audited. Polyline creation now uses the shared shape bounds helper; focused shape tests, TypeScript, format, and file-size checks passed. Remaining open findings: 15 (0 medium, 15 low). |
| Fix Phase 27 | 2026-07-04 | S04 scan-offset duplicate-speed normalization finding S04-008 | Fixed and after-fix audited. Strict scan-offset normalization now rejects duplicate speeds, while UI edit flows use an explicit merge helper; focused core/IO/UI tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 14 (0 medium, 14 low). |
| Fix Phase 28 | 2026-07-04 | S04 G-code dialect fallback finding S04-009 | Fixed and after-fix audited. Unknown dialect ids now fail closed instead of silently resolving to `grbl-dynamic`; focused dialect/output/preflight/UI tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 13 (0 medium, 13 low). |
| Fix Phase 29 | 2026-07-04 | S05 G-code word parser finding S05-002 | Fixed and after-fix audited. Shared parser now handles signed, leading/trailing decimal, exponent, lowercase, and compact G-code words across invariant/preflight paths; focused tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 12 (0 medium, 12 low). |
| Fix Phase 30 | 2026-07-04 | S06 G-code metadata comment-safety finding S06-006 | Fixed and after-fix audited. Metadata header fields now replace newline/control line-breaking characters before comment emission; focused G-code IO tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 11 (0 medium, 11 low). |
| Fix Phase 31 | 2026-07-04 | S07 camera bridge preview API finding S07-007 | Fixed and after-fix audited. Removed unused `rtspPreviewUrl(...)` from the camera bridge contract, implementation, and tests so preview URLs flow only through probe results; focused platform/UI tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 10 (0 medium, 10 low). |
| Fix Phase 32 | 2026-07-04 | S08 Cut Settings max-feed finding S08-012 | Fixed and after-fix audited. Layer and sub-layer Cut Settings dialogs now use the active device max feed for speed input caps and parser clamping; focused UI/parser tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 9 (0 medium, 9 low). |
| Fix Phase 33 | 2026-07-04 | S08 preview route button chrome finding S08-014 | Fixed and after-fix audited. Preview route playback buttons now use the shared `lf-btn` chrome and tests pin the class contract; focused preview/UI kit/a11y tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 8 (0 medium, 8 low). |
| Fix Phase 34 | 2026-07-04 | S08 help-id registry finding S08-015 | Fixed and after-fix audited. Preview controls now use registered `control:preview.*` help IDs, control help IDs are closed over known keys, and the hover contract rejects unregistered literal help IDs; focused help/a11y/preview tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 7 (0 medium, 7 low). |
| Fix Phase 35 | 2026-07-04 | S08 text numeric bounds finding S08-016 | Fixed and after-fix audited. Text dialog numeric controls now clamp finite text size, line height, and letter spacing before render/save; focused text/project tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 6 (0 medium, 6 low). |
| Fix Phase 36 | 2026-07-04 | S09 perceptual artifact provenance finding S09-002 | Fixed and after-fix audited. Historical reports now describe `perceptual-artifacts/*.png` as ignored regenerable local outputs rather than durable audit evidence; report formatting and static wording checks passed. Remaining open findings: 5 (0 medium, 5 low). |
| Fix Phase 37 | 2026-07-04 | S09 perceptual artifact dimension finding S09-003 | Fixed and after-fix audited. Opt-in perceptual PNG writing now rejects mismatched mask dimensions before drawing comparisons while disabled artifact mode remains a no-op; focused/broad perceptual tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 4 (0 medium, 4 low). |
| Fix Phase 38 | 2026-07-04 | S09 real-logo fixture ownership finding S09-004 | Fixed and after-fix audited. The Arch House source PNG now lives under `src/__fixtures__/perceptual/assets`, the fixture helper defaults to that S09-owned location, and active path docs were refreshed; focused real-logo/benchmark tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 3 (0 medium, 3 low). |
| Fix Phase 39 | 2026-07-04 | S09 trace artifact evidence path finding S09-005 | Fixed and after-fix audited. Opt-in Arch House trace evidence now writes under ignored `perceptual-artifacts/trace-artifacts` instead of tracked audit evidence, with a regression test pinning the path and opt-in artifact generation verified. Remaining open findings: 2 (0 medium, 2 low). |
| Fix Phase 40 | 2026-07-04 | S09 PNG decoder malformed-file coverage finding S09-007 | Fixed and after-fix audited. PNG decoding now has direct malformed/unsupported fixture tests and clearer required-chunk, chunk-bound, dimension, and decoded-row guards; focused decoder/real-logo tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 1 (0 medium, 1 low). |
| Fix Phase 41 | 2026-07-04 | S09 G-code burn rasterizer parser coverage finding S09-008 | Fixed and after-fix audited. The emitted-G-code burn rasterizer now uses the shared G-code word/comment parser and has direct parser-semantics tests for compact words, signed/exponent values, comments, modal laser state, rapid moves, and malformed numeric suffixes; focused fixture/invariant/preflight tests, TypeScript, lint, format, and file-size checks passed. Remaining open findings: 0 (0 medium, 0 low). |
| Final Verification | 2026-07-04 | Full repo after-fix release gate | Passed. `pnpm release:check` completed after all 77 findings were fixed and after-fix audited: repo guard, TypeScript, app lint, Electron lint, formatting, license check, dependency audit, 428 test files / 2678 tests, web build, Electron main build, and file-size policy all passed. Remaining open findings: 0 (0 medium, 0 low). |

## Finding Index

| ID | Sector | Severity | Short Name |
|---|---|---|---|
| S01-001 | S01 | Medium | LaserForge/KerfDesk naming split |
| S01-002 | S01 | Low | README ADR index stale |
| S01-003 | S01 | Medium | Release/test status stale |
| S01-004 | S01 | Medium | Shipped workflow stubs |
| S01-005 | S01 | Medium | Dirty worktree not covered by old release gate |
| S01-006 | S01 | Medium | Hardware verification wording too broad |
| S01-007 | S01 | Medium | Cloudflare deploy status contradiction |
| S01-008 | S01 | Low | Audit corpus lacks index |
| S01-009 | S01 | Medium | PROJECT.md architecture sections stale |
| S01-010 | S01 | Low | DECISIONS.md ADR numbering note stale |
| S02-001 | S02 | High | Web headers block browser camera |
| S02-002 | S02 | Medium | Raw-line backstop only scans src |
| S02-003 | S02 | Medium | Runtime engines looser than CI |
| S02-004 | S02 | Medium | Release gate duplicated across local/CI/deploy |
| S03-001 | S03 | High | RTSP bridge CORS omits kerfdesk.com |
| S03-002 | S03 | High | Electron permission policy omits camera/media |
| S03-003 | S03 | Medium | RTSP probe waits for socket end |
| S03-004 | S03 | Medium | FFmpeg stream lacks child error handling |
| S03-005 | S03 | Low | RTSP host validation allows malformed octets |
| S03-006 | S03 | Low | Electron CSP comments stale after camera bridge |
| S04-001 | S04 | Medium | Camera RTSP validation split from bridge policy |
| S04-002 | S04 | Medium | Camera alignment lacks conditioning/residual checks |
| S04-003 | S04 | Medium | Camera capability/profile consistency not enforced |
| S04-004 | S04 | Medium | Jog command can emit NaN/Infinity |
| S04-005 | S04 | Low | GRBL coded suffix parsing is lenient |
| S04-006 | S04 | Low | Layer color hex contract not enforced |
| S04-007 | S04 | Low | Polyline bounds helper duplicated |
| S04-008 | S04 | Low | Scan-offset duplicate handling is inconsistent |
| S04-009 | S04 | Low | G-code dialect resolver silently falls back |
| S04-010 | S04 | Medium | GRBL setting writer accepts non-canonical numeric strings |
| S04-011 | S04 | Medium | Welded vector objects lose output metadata |
| S04-012 | S04 | Medium | Selection transforms accept non-finite edits |
| S05-001 | S05 | Medium | Active no-go-zone parser is simpler than unused modal-aware helper |
| S05-002 | S05 | Low | G-code invariant parsers use narrow numeric grammar |
| S05-003 | S05 | Medium | Non-finite layer speed can emit feed words |
| S05-004 | S05 | High | Pre-emit raster budget checks only first image operation |
| S05-005 | S05 | Medium | Main preflight is not sub-layer aware |
| S05-006 | S05 | Medium | Malformed raster luma silently becomes all-white |
| S05-007 | S05 | Medium | Raster scan-offset missing from route preview |
| S05-008 | S05 | Medium | Raster duration estimate ignores wide-gap rapid splits |
| S06-001 | S06 | Medium | Project files accept unvalidated device capabilities |
| S06-002 | S06 | Medium | SVG import lacks total geometry and finite-coordinate budget |
| S06-003 | S06 | Medium | Project files lack total vector/object/point budget |
| S06-004 | S06 | Medium | Project files do not enforce scene ID/group integrity |
| S06-005 | S06 | Medium | SVG symbol-use imports can drop geometry |
| S06-006 | S06 | Low | G-code metadata comments are not newline-safe |
| S07-001 | S07 | Medium | Failed web save writes can leave streams open |
| S07-002 | S07 | Medium | Camera bridge client trusts unvalidated JSON |
| S07-003 | S07 | Medium | Web Serial line cap misses huge newline records |
| S07-004 | S07 | Medium | Deploy policy tests omit current pre-publish gates |
| S07-005 | S07 | Medium | Web save fallback documented but not implemented |
| S07-006 | S07 | Medium | Web Serial stale-open recovery lacks regression tests |
| S07-007 | S07 | Low | Camera bridge preview URL method is production-unused |
| S08-001 | S08 | Medium | Focus Test command enables a not-implemented real action |
| S08-002 | S08 | Medium | Image import and batch trace bypass PlatformAdapter file I/O |
| S08-003 | S08 | Medium | PWA update prompt ignores active done/errored job states |
| S08-004 | S08 | Medium | Workspace drag hook lacks direct event-pipeline coverage |
| S08-005 | S08 | Medium | View transform can produce invalid scene coordinates |
| S08-006 | S08 | Medium | Preview preparation still runs on the UI path |
| S08-007 | S08 | Medium | Path-node hit testing ignores hidden layers |
| S08-008 | S08 | Medium | Frame over-budget raster fallback ignores selected-output scope |
| S08-009 | S08 | Medium | Ctrl/Cmd+. does not stop active frame/jog motion |
| S08-010 | S08 | Medium | Trace worker postMessage failure leaves stale pending state |
| S08-011 | S08 | Medium | Trace boundary drag can persist non-finite crop rectangles |
| S08-012 | S08 | Low | Cut Settings speed can exceed active device max feed |
| S08-013 | S08 | Medium | Selected Artwork Settings hides mixed selection values |
| S08-014 | S08 | Low | Preview route buttons use undefined button class |
| S08-015 | S08 | Low | Help-id contract accepts unregistered IDs |
| S08-016 | S08 | Low | Add/Edit Text numeric parser lacks finite/range enforcement |
| S09-001 | S09 | Medium | Real-logo fixture detector accepts non-PNG paths |
| S09-002 | S09 | Low | Perceptual artifacts are ignored local evidence |
| S09-003 | S09 | Low | Perceptual artifact writer lacks dimension check |
| S09-004 | S09 | Low | Real-logo benchmark fixture lives under audit/fixtures |
| S09-005 | S09 | Low | Arch House evidence writer uses unignored audit/evidence path |
| S09-006 | S09 | Medium | Centerline perf test budget is too loose |
| S09-007 | S09 | Low | PNG decoder lacks malformed-file tests |
| S09-008 | S09 | Low | G-code burn rasterizer lacks direct parser tests |

## Next Steps

1. Continue the 2026-07-04 current-state delta audit opened after `main` advanced beyond the original audited tree.
2. Run S06 delta Pass 3 over direct diff review, project import/export edge contracts, and audit-doc consistency.
3. Preserve the audit/fix trace; do not start new fixes unless a new audit finding is opened.

## Current-State Delta Audit - 2026-07-04

Reason for reopening: current `origin/main` is at `c0f0252`, eighteen commits after the previously completed audit/fix baseline `d603c01`. At S01 delta Pass 1 the head was `e31a3b8`; later fast-forwards added the audit-doc checkpoint, three S08 box/input commits, PWA update dismissal persistence, and deterministic build-time configuration. The new commits touch S01 docs, S02 build configuration, S04 core CNC/material primitives, S05 trace algorithms, S06 project persistence, S08 UI state/machine workflows, and S09 perceptual fixtures. The prior completed audit remains evidence for the baseline tree, but it does not by itself prove the newer tree has been sector-audited.

| Delta Sector | Status | Passes Completed | Major Areas Remaining |
|---|---|---:|---|
| S01 Governance, audit history, and product contracts | Complete | 3 | None for current delta |
| S02 Tooling, build, release, CI, and static shell | Covered by previous audit; no delta files detected | 0 | None for current delta |
| S03 Electron desktop runtime and local bridge | Covered by previous audit; no delta files detected | 0 | None for current delta |
| S04 Core domain models, controller/device/material primitives | Complete | 3 | None for current delta |
| S05 Core job compilation, preflight, raster/trace, and output | Complete | 3 | None for current delta |
| S06 IO formats and persistence | Active | 2 | Direct diff review, project import/export edge contracts, audit-doc consistency |
| S07 Platform adapters | Covered by previous audit; no delta files detected | 0 | None for current delta |
| S08 UI application workflows | Pending delta audit | 0 | CNC material UI/state changes plus box numeric-input/dogbone toggle changes |
| S09 Fixtures, perceptual harness, and test assets | Pending delta audit | 0 | New perceptual fixtures and underscore-prefixed audit tests |

### Delta Completed Passes

| Pass | Completed | Summary |
|---|---|---|
| S01 Delta Pass 1 | 2026-07-04 | Current-state audit map and baseline-drift pass. Found stale sector-map coverage/counts and prior completion wording that did not cover ten newer commits. Updated the architecture map to classify all 1,679 then-current files. S01 still needs two more delta passes. |
| S01 Delta Pass 2 | 2026-07-04 | Governance/docs delta pass over ADR-112, Phase H status docs, and current handoff/build notes. Found stale Phase H summary wording after H.14 landed. S01 still needs one remaining-gap pass. |
| S01 Delta Pass 3 | 2026-07-04 | Remaining-gap pass over current S01 delta docs, pending/claimed wording, and audit-doc formatting. No additional S01 findings; S01 delta closed after three passes. Move to S04. |
| S04 Delta Pass 1 | 2026-07-04 | Newly classified core CNC/box/relief/sim orientation. Focused valid-path S04 slice passed (28 files, 170 tests). Found missing finite-value guards in exported surfacing and grid/heightmap sizing primitives. S04 still needs two more passes. |
| S04 Delta Pass 2 | 2026-07-04 | CNC semantics and project-material boundary review. Focused compile/tiling/relief/material/persistence slice passed (6 files, 40 tests). Found that material feed seeding can persist non-finite feed values if invalid numeric inputs reach the calculator. S04 still needs one remaining-gap pass. |
| S04 Delta Pass 3 | 2026-07-04 | Remaining box/relief/simulation gap sweep. Focused box/relief/sim slice passed (15 files, 93 tests). No additional S04 findings; S04 delta closed after three passes. Move to S05. |
| S05 Delta Pass 1 | 2026-07-04 | Trace pipeline and auto-upscale orientation. Focused trace slice passed (5 files, 78 tests). Found exported auto-upscale scale-factor contract gap and malformed RawImageData guard gap. S05 still needs two more passes. |
| S05 Delta Pass 2 | 2026-07-04 | Edge, centerline, potrace, and smoothing internals. Backend trace slice passed (12 files, 69 tests). Found exported Canny option-bound gap. S05 still needs one remaining-gap pass. |
| S05 Delta Pass 3 | 2026-07-04 | Preprocess, batch trace, boundary, and closure sweep. Support trace slice passed (8 files, 67 tests). Found non-finite trace image-adjustment option gap; S05 delta closed after three passes. Move to S06. |
| S06 Delta Pass 1 | 2026-07-04 | Project material persistence orientation. Focused project IO/state slice passed (8 files, 61 tests). No new findings; material keys are filtered to known chipload keys at stock and layer load boundaries. |
| S06 Delta Pass 2 | 2026-07-04 | Migration, backfill, and adjacent persistence sweep. Broader IO persistence slice passed (25 files, 159 tests). No new findings; migration/backfill and adjacent material/CNC library persistence remained consistent. |

### Delta Finding Index

| ID | Sector | Severity | Status | Short Name |
|---|---|---|---|---|
| D-S01-001 | S01 | Medium | Open | Sector map omitted current core/root paths |
| D-S01-002 | S01 | Medium | Open | Completion ledger did not cover post-baseline commits |
| D-S01-003 | S01 | Low | Open | Phase H summary header stale after H.14 |
| D-S04-001 | S04 | Medium | Open | Surfacing generator lacks core finite-value guards |
| D-S04-002 | S04 | Medium | Open | Grid/heightmap sizing helpers can return malformed grids for non-finite dimensions |
| D-S04-003 | S04 | Medium | Open | Material feed seeding can persist non-finite feed values |
| D-S05-001 | S05 | Low | Open | Auto-upscale exported helpers do not validate scale factors |
| D-S05-002 | S05 | Low | Open | Trace core accepts malformed RawImageData shape without explicit guard |
| D-S05-003 | S05 | Low | Open | Canny edge core does not bound threshold ratios or blur sigma |
| D-S05-004 | S05 | Low | Open | Trace image-adjustment options do not fail closed on non-finite values |
