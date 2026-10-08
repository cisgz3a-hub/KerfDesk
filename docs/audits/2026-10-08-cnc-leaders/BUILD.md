# CNC, relief and parametric build

Date: 8 October 2026. Local implementation branch: codex/cnc-leaders-build-20261008.
Integration base: 88433fec3d0e44e0b4793e086af34d6c4760bdfb.
Workspace: D:\LaserForge\cnc-leaders-audit-20261008.

The primary software increments in the [implementation ledger](IMPLEMENTATION.md) are built together on the existing sheet, artwork, tool and output models. The completed implementation is being prepared for review on this branch. Current main was integrated on 9 October 2026 without replacing any pending implementation file. The [PR verification record](pr-verification.json) distinguishes the original broad test snapshot from integrated-source checks. Controller, material and competitor qualification remain separate.

## Implementation status

“Implemented” below describes local software behaviour. It does not certify a physical machine, cutter, material or efficiency advantage over another product.

| Item | Local result | Operator benefit and boundary |
|---|---|---|
| C01 Production foundations | Integrated | Reuses the existing hierarchy, sheet book, production manifest, retained arrays and interrupted-row states. Generated nests create inactive sheet archives atomically; the active design remains available. |
| C02 Reproducible benchmarks | Implemented | Eight workflow fixtures record exact project/program hashes, software/source identity, settings, preparation samples and emitted geometry. Benchmark-specific competitor, controller and physical measurements remain explicitly unrun. |
| C03 Named machining setup | Implemented | One retained setup owns the name, notes, canonical stock-top G54 datum, physical fixtures and optional side intent. Setup edits commit together through the existing wizard; Job Review reads that canonical context. Old CNC projects migrate to an equivalent default setup. |
| C04 Contextual cutting presets | Implemented | Reusable cutting data records identify cutter, material and machine context. Named generic/manual records remain saveable as unverified presets. Qualification binds the exact context and all current cutting values; edits require reconfirmation. Conflicts, notes and overrides are reviewable; stage snapshots retain independently edited feeds. |
| C05 Preparation dependencies | Implemented | Operation readiness reports geometry, live relief links, tool, stage, setup and stock changes. Descriptive renames do not dirty geometry. Reopening starts with “not prepared” session evidence. Readiness is advisory evidence; output still prepares the exact current source. |
| C06 Exact setup packages | Implemented | The ordinary prebuilt Save G-code dialog can also export printable offline HTML containing exact G-code, a JSON manifest, preview, names, bytes and SHA-256. Tiled and file-only controller flows bypass that dialog. Combined M0 output is the default. Ordered separate-tool output preserves contiguous A → B → A sections, native modal/safe/spindle/coolant transitions and per-file touch-off instructions. |
| C07 Machining templates | Implemented | Revisioned recipes now select semantic part/path roles, show missing or ambiguous matches, retain sheet applications and reapply without duplicate stages. Accepted operator overrides and copied tool context survive reopening and library removal. |
| C08 Quantity production nesting | Implemented | Parts carry quantities, material, thickness, grain and permitted rotations; stock records distinguish sheets and remnants. Cancellable planning has an independent containment/collision/quantity check, explicit partial acceptance and one undo step. Copied holes, side assignments, relief links and projection layers remain local to their copies. |
| C09 Tapered V-bit inlay | Implemented | One retained operation generates pocket and plug from the same source and selected V-bit. Independent radial fit gap, axial engagement, glue gap, top clearance and start depths are explicit; the selected cutter supplies its angle and paired-piece output evidence. Straight inlay remains its existing mode. Actual material fit is not measured by analytical geometry. |
| C10 Adaptive islands and 2D rest | Implemented | Adaptive planning covers independently verified nested/island regions with explicit entry and radial-load evidence. Stock-aware rest predicts residual geometry from planned final-depth sweeps of the selected rough stage, retaining source, cutter, depth, tolerance and residual-area evidence. It does not represent a measured or previously executed job. Unsupported or uncertain combinations disclose a full finishing fallback. |
| C11 Assemblies, fixtures and reach | Implemented | Cutter, flute, stickout, shank and bounded holder envelopes are editable and inspectable. Exact-program reach checks flag known flute/holder/clamp cases, unknown approach geometry and finite analysis budgets. These are warnings, not a full machine/linkage collision certificate. |
| R01 Relief components and levels | Implemented | Retained components, transforms, heights, levels, visibility, masks and combine modes materialise into the canonical U16 relief source. Revision ownership, cancellation, save/reopen and explicit bake preserve intent and machining identity. |
| R02 Vector relief shapes | Implemented | Linked closed vectors generate editable planar, domed and sloped relief shapes. Physical dimensions, mask boundaries and height tolerances are explicit. Source changes update the field or leave a repairable link error. |
| R03 Masked sculpting | Implemented | Add, remove, smooth and flatten brushes retain physical diameter/strength and bounded U16 field patches. One completed stroke is one undo step; cancelled strokes do not publish changes. Display sampling is separate from CAM resolution. |
| R04 Clips and local components | Implemented | Live vector clips and local reusable component files retain size, height, units and provenance. Import previews and deliberate bake/detach are supported; original sources stay retained until a successful replacement. |
| R05 3D rest finishing | Implemented | A fine relief cutter targets conservatively predicted stock remaining after the actual previous passes. Threshold, resolution, predecessor and fallback evidence are retained. This is predicted stock, not a measured surface. |
| R06 Surface-following vectors | Implemented | Explicit engraving/profile-on-path operations reference an exact relief revision and vertical depth. Sampling, cutter contact, exclusions and lifts are disclosed. Review warns if the actual ordered job machines the target relief after its projected detail. |
| R07 Rail/profile relief | Implemented | One- and two-rail generators retain section positions, width scaling, directions and live source links. Crossing/folded/multi-valued surfaces are rejected. Materialised output uses existing relief CAM; a dedicated moulding strategy is a separate optional increment. |
| D01 Two-sided CNC | Implemented | Side A/B assignments, physical flip axis, stock origins and registration guides are retained. Source placement is reflected before CAM, including off-output relief dependencies. Each output names its side and top Z0; placement changes invalidate old Frame evidence. Registration guides do not automatically drill holes. |
| D02 Bounded constrained sketches | Implemented | Named parameters, small arithmetic expressions, dimensional/coincident/horizontal/vertical/equal constraints and diameter intent have visible under/fully/over-constrained results. Review precedes one atomic apply; authored dimensions, stable paths, overrides and exact circle arcs survive reopening. Bake is explicit. |
| D03 Parametric parts | Implemented | Panel, bracket, hole-grid and fixture generators expose named physical dimensions and geometry/operation review. Stable path identities retain machining bindings. Invalid or stale reviews cannot replace current artwork; bake/detach and undo are explicit. |
| D04 CNC wrap capabilities | Reference planner implemented; execution qualification pending | A separate offline cylinder study declares A-axis degrees, G54 surface datum, G93 block timing, allowed explicit linear profile-on-path end-mill contours and supported bounds. Independent fixtures cover radius, direction, seam, depth, closed contours and holds. It exports a JSON study containing the reference program. No rotary machine output, additional vendor post, ATC or firmware qualification is enabled by this study. |

## Where to use the new work

- Open the CNC setup wizard to name the setup, edit stock/material, inspect the bit assembly, add fixture envelopes or configure side A/B.
- The artwork/operation panel exposes Create constrained sketch, Create parametric part and Create editable relief. Retained objects expose their corresponding editors and explicit bake controls.
- Artwork → Settings → Machining inputs exposes contextual presets. Artwork → Recipes → Process recipes exposes Save selected machining template and Review template matches. Inlay fit → Pair method → Tapered V-bit pair opens the distinct paired mode. Pocket Rough first → Previous-stock rest → Use planned rough-stage stock selects predicted 2D rest.
- Nest → Quantity production across sheets opens quantity nesting alongside the existing nesting workflow. Its review reports placed and unplaced quantities, stock use and verified copies before accepting new sheet archives.
- Relief properties expose components/levels, brushes, live clips/local component files and rail/profile sources. Relief machining exposes rest finishing and explicit vector projection.
- In the ordinary prebuilt Save G-code dialog, use Save setup sheet + program to choose combined M0 or ordered separate-tool files. Open the saved offline HTML to print the setup and download its embedded programs and manifest.
- The setup wizard's CNC wrap study is an offline planning artifact. Ordinary Save G-code, Frame and Start continue through the existing three-axis emitter.

## Contracts retained

Project schema 15 migrates schema 14 and older supported projects while retaining inactive sheets and editable intent. Imported relief geometry, straight inlay and unconstrained artwork remain supported through their existing paths.

MachineConfig retains machine limits, canonical stock and default cutter/material. CncMachiningSetup retains identity, notes, datum, fixture envelopes and side/wrap intent; the setup wizard commits both together. Artwork operations own cutting intent and per-stage values. Job Review shows generated facts and warnings. Existing public-export caps are respected through deep imports and bounded helpers.

A completed Frame for the current footprint/placement remains the sole ordinary Start policy gate. Every Start prepares the exact current program. The new readiness, fixture, assembly and stock findings do not add account, licence, collision or qualification refusals. Existing commercial tier assignments remain unchanged.

All generators, component formats and geometry code here are original implementation. No proprietary vendor source, clipart, tool database or unsupported vendor file decoder was incorporated.

## Reproducible software evidence

The runner is scripts/benchmark-cnc-leaders.mjs. Run it from this checkout with Node and --output docs/audits/2026-10-08-cnc-leaders/benchmark-results.json. The generated machine-readable output includes source projects and emitted program geometry, not a product leaderboard. It is retained locally and can be reproduced with the runner; generated programs and raw benchmark output are excluded from the PR.

The eight workflows are a sign with lettering/holes/tabs, straight and tapered inlay coupons, clipped relief with projected detail and rest finishing, short/long reach over a clamp, asymmetric side A/B, a 60-to-75 mm constrained bracket, twelve grained panels on two stock sizes, and imported/interrupted-program accountability. There are eleven top-level variant/evidence records plus two generated nesting-sheet program records.

Calculation time samples and geometric fed-motion estimates exclude physical cutting. Fed-motion minutes exclude rapids, acceleration, machine execution, M0 waits and operator handling. Nesting layout estimates are separate from emitted program metrics. A synthetic acknowledgment receipt cannot establish which rows physically executed.

Measured competition, dedicated controller trials, air cutting and material trials require separate benchmark evidence records. The current dataset leaves those lanes empty. The broad Chrome suite separately exercises simulated controller, Frame and Start flows. The software does not yet establish a winner over VCarve, Aspire or Fusion.

## Completed verification snapshot and PR preparation

| Verification | Result |
|---|---|
| Final full unit suite | 28,559 tests passed, 29 existing skips; 3,696 files passed, 18 skipped (3,714 total). Complete run after both G94 and C04 repairs; no new skips. |
| G94 regression run | 65 tests passed across seven files, including 15 new regressions. Native geometry and output bytes remain unchanged; unsupported and physical-qualification disclosures remain. |
| C04 preset regressions | 67 tests passed across eight files. Generic/manual saving, exact-value qualification invalidation and missing-context import/restore compatibility are covered. |
| Types | Main and e2e TypeScript passed after the final C04 repair. Earlier Electron main compilation passed; its source did not change in this repair. |
| Lint and formatting | Whole-worktree ESLint and Prettier passed before the final repair; all eight final C04 source/regression files passed scoped checks. Compact audit JSON is formatted separately. |
| Source contracts | File-size backstop, public-export ratchet, ADR numbering, dependency licence policy and Git whitespace checks passed. Fourteen legacy over-cap barrels did not grow. |
| Production builds | Browser-Free at dist/web and desktop renderer at dist/desktop-renderer rebuilt successfully after both repairs. Exact served capability stamps and HTML hashes match those builds. |
| Complete standard Chrome | 312 passed, 11 skipped, zero failures or flakes (323 cases). Skips: one opt-in performance measurement and ten external document-corpus cases. A fresh server shared the exact UI/fixture store identity. |
| Production Chrome | Three desktop CNC workflows passed in 9.44 seconds; two Browser-Free cases passed in 13.29 seconds. Original config/assertions are unchanged; Browser-Free used a shell-only pnpm dependency-warning override to preserve shared modules. |
| Software fixtures | Eight benchmark workflows passed; 11 top-level evidence records and two generated nesting-sheet programs. All 12 requested panels were placed across two sheets. |

The completed 8 October benchmark identifies version 0.1.3053, integration base 88433fec3d0e44e0b4793e086af34d6c4760bdfb and 8,055 source/build-input files. Its sorted path/content-digest SHA-256 is 6d46757eac36630db0a4eb93ee345d77ab3b58bea4a630fd9b5383b31e3bcc79. This source stayed unchanged throughout the final builds, benchmark, complete unit suite and Chrome runs. The modified worktree, rather than the base commit alone, identifies that tested build. Current-main integration changes the source identity; these earlier counts are historical verification rather than an exact-head claim for the PR.

The [compact PR verification record](pr-verification.json) retains the completed suite counts, source identity, build hashes and qualification boundaries. Detailed historical metadata, command logs and raw reports remain local under the test-rerun-20261008-211016 directory and D:\LaserForge\cnc-leaders-chrome-artifacts-20261008-211016. They are excluded from the PR alongside generated screenshots and programs. Successful empty compiler/lint output is recorded as a command result; it is not described as an existing log. Earlier failures, repairs and interrupted test-launcher attempts remain preserved in those local records.

The final reach adapter acknowledges exact G94 as feed per minute without changing tool-centre geometry. Its independent native-program regression covers both manual-tool sections and verifies that removing this non-geometric word produces the same geometry. The shared import parser and canonical emitter remain unchanged. Unknown initial and post-tool-change approaches still leave path coverage explicitly incomplete.

Both renderer builds report the existing circular manual-chunk dependency io → core → io and chunks above the 750 KiB warning threshold. Production startup, all five production workflows and the complete standard Chrome suite passed; controlled performance qualification remains open. Benchmark timing samples were collected on this Windows workstation alongside some other verification and are exploratory, not controlled speed comparisons.

Local software completion is separate from hosted CI, a pull request, packaged Windows installer, publication and physical-machine qualification. No installer was packaged, launched or installed; no physical controller or machine Frame, Start, air cut or material cut was operated. Simulated Frame/Start/controller workflows were exercised in Chrome. Rotary remains a reference JSON study. Measured competitor comparisons and physical qualification are the next evidence work before making efficiency or machine-support claims.

Completed source, tests, scripts and authored records are being committed for a ready-for-review PR on codex/cnc-leaders-build-20261008. Generated bundles and raw artifacts remain local. The primary checkout and its unrelated changes were preserved, and the previous test servers were stopped. The coordinating release chat owns merge and publication.


## PR integration review repairs

The 9 October review corrected four retained-state defects before final PR checks:

- Saved cutting-preset metadata and feed/plunge/RPM edits now preserve a completed Frame when coordinates are unchanged. Active-side transforms and linked relief sources still qualify placement; inactive-side datum, flip and artwork no longer expire the current side’s Frame. Execution preparation retains exact current process values.
- Sketch entity changes remap tabs and recipe baselines by named path identity instead of array position.
- Manually reordered generated-part and sketch paths retain their machining assignments through a unique match against the old retained geometry. Missing, changed or ambiguous identities require Undo or Bake before regeneration; ordinary artwork/output remains available.
- Project loading rejects multiple retained geometry authorities on one vector, matching the design editors’ contract.

These defects were reproduced with focused failing regressions, then repaired. Final integrated-source results and its digest are recorded separately in pr-verification.json. The earlier complete 8 October suite remains identified by its own source digest.
