# Major historical PRs: current feature and code audit

Audited 20 October 2026, initially against `origin/main` at
`9c6e6a3d8f427d0af11e0eeebd67062b5ac3bd91`.
During verification, main advanced to
`3f3f529bfee89355500fef0708358e58f4decf7b` through PR #1317.
The isolated branch was fast-forwarded without discarding any repairs; the
licensing delta received separate review and fresh checks. Final integration
checks use this later base plus the local repairs.
Local repairs are on `codex/major-pr-current-audit-20261020`.

## Scope and result

The preceding history inventory covered 1,320 actual pull requests, from #1 through
#1327. This audit follows the major milestones selected from that inventory into
their current implementation, reachable UI, persistence and output boundaries.
It includes manual source review, independent counterexamples, focused regression
tests and current browser workflows. Historical passing checks are not counted as
current evidence.

The reviewed merged feature families remain present. Their implementation has
often evolved substantially since the original PR. Confirmed defects and local
repairs are listed below: seven repaired defect families, six remaining lead
defects with proposed fixes in open #1285, and stale paid-offline wording in two
privacy sources. An open PR is not automatically an absent feature:
stacked commits can already have reached main through another merged PR.

This is a broad, bounded audit of those milestones, not a claim that every line
of the repository or every possible user file has been exhaustively verified.
The domain reports distinguish manually inspected code from code exercised only
by tests. Native installations, real services and physical machines require
separate qualification.

## Confirmed defects

### 1. Conversion and tracing could leave a project unsaveable — P2, repaired

Convert two grouped vectors to a bitmap. The old mutation removed the vectors
but retained their IDs in the group. Save preparation then rejected the project
with `invalid scene.groups[0].objectIds[0]: dangling id`. Trace replacement and
Delete source had the same removal pattern. Surviving images and path text could
also retain references to deleted masks or guides.

The repair cleans missing group members, stale Design-tree rows and dependent
mask/guide references after the final mutation. It retains surviving geometry,
placement, operation ownership, unrelated groups, same-ID retraces and one Undo
snapshot. Existing dependency warnings explain detached relationships.

The normal Save path validates before writing, so the demonstrated consequence
was an unsaveable edited state. This audit does **not** claim that ordinary Save
wrote corrupt files. Added regressions explicitly cover repaired Save/reload,
raw invalid serialization rejection and four trace replacement/source variants.

A further reproduction followed the actual Re-trace Original dialog and commit:
changing vector output into a bitmap reused the vector's ID, leaving other
artwork's mask/text-guide references pointing at a raster. Save accepted those
references, but the mask consumer returned no mask and the text consumer rejected
the guide. Conversion/trace cleanup now admits only surviving vector dependencies
and reports the detachment. Same-kind retracing and normal deletion behavior
remain covered. This is part of the same dependency-repair defect family.

Production files:
`src/ui/state/{convert-to-bitmap,scene-mutations,rasterized-trace-mutation,import-actions,object-delete-actions,repair-object-dependencies}.ts`.

### 2. Inspector edge-cell comparison used the wrong physical positions — P2, repaired

A 2.5 mm wide relief sampled with 1 mm cells has a shorter final cell. The
Inspector treated its centre as uniformly spaced. Against the analytic plane
`z=x`, the expected target at X=1.75 was -0.75 mm; the baseline returned
-0.8125 mm. That 0.0625 mm error could falsely colour a correct carving as
remaining material.

Interpolation and nearest-mask selection now use actual cell centres. Independent
peer review also reproduced interpolation across a wall steeper than 85 degrees
because the wall test used nominal pitch. That test now accounts for the actual
distance between neighbouring cell centres.

This changes the Inspector comparison, not CAM or emitted G-code.

Production file: `src/ui/gcode-inspector/stock-design-target.ts`.

### 3. Accepted hyphenated parameter names could not be referenced — P2, repaired

The schema and editor accepted `stock-width`, but the expression parser read it
as `stock - width`. The repair adds explicit references such as
`[stock-width]/4 + 2mm`, with visible editor guidance. Existing `a-b` subtraction
keeps its meaning, including when a parameter named `a-b` also exists.

Regressions cover schema-valid names, units, prefix names, unknown references and
saved subtraction semantics.

Production files: `src/core/sketch-constraints/sketch-parameters.ts` and
`src/ui/layers/SketchParameterEditor.tsx`.

### 4. Camera burn-check could compare a later job with an earlier route — P2, repaired

Finish a watched job, turn watching off, then start another job during the
three-second smoke-clear wait. Previously only watched starts advanced the
camera generation. The earlier check could capture the later work and compare
it with the earlier route. A completed check also retained its Retake action
after a later unwatched run.

Every new run now retires the earlier capture authority. Pending checks become
unavailable with a reason; an already completed historical verdict may remain
visible, but its Retake authority expires. Regression tests reproduce both
paths. No camera-related motion or output policy was added.

Production file: `src/ui/camera/job-watch/job-watch-runner.ts`.

### 5. Print & Cut reused confirmation after changed captures — P2, repaired

The unusual-registration checkbox was keyed by rounded spacing/scale/angle text.
After confirming a 3% scale change, moving both captured marks by 100 mm left
that text unchanged. The old acknowledgement therefore remained valid for a
different output translation. Sub-rounding edits could also evade invalidation.
ADR-443 Amendment 1 requires a new capture or target edit to ask again.

Confirmation now belongs to the exact immutable targets and captured points.
Regressions cover translated recaptures, tiny changes, identical-coordinate new
captures and unchanged-render retention. This repairs the existing registration
dialog policy; it adds no Frame or Start gate.

Production file: `src/ui/laser/PrintAndCutDialog.tsx`.

### 6. Curve editing moved an unselected corner and lost loop controls — P2, repaired

On a closed curve whose final edge is implicit, moving the first node by (3, 4)
also moved the unselected last node. In the rectangular reproduction, the last
corner incorrectly changed from (0, 20) to (3, 24). The incoming-segment helper
assumed the final stored segment ended at the start, even when the closing edge
was implicit. The actual trace-to-curve editor action reproduced the defect.

Incoming control ownership now requires an actual stored closing segment.
Related single-segment closed-cubic cases also retain both translated handles
when moving the shared anchor, and both updated handles when smoothing it.
Previously smoothing wrote one handle and then overwrote it while updating the
other. Focused core and real-store regressions cover these cases, persistence,
Undo/Redo and unchanged input geometry.

Production file: `src/core/scene/curve-edit.ts`.

### 7. A pre-epoch computer clock prevented durable licence changes — P2, repaired

PR #1317 made paid grants independent of the computer clock. However, accepting
a grant still wrote the local time into `lastSeenAt` and `refreshedAt`, while the
real record parser requires nonnegative timestamps. With the computer set to
31 December 1969, paid activation failed to persist. More seriously, a received
refund revocation locked the current process but failed to replace its saved
credential; a fresh runtime reopened with paid rights.

Only the persisted local timestamp fields now clamp at zero. Signed entitlement
claims, the background scheduler and trial clock rules are unchanged. Five
regression cases use the real parser and disk store, with encryption replaced
by a test adapter: paid activation and offline relaunch with a 1990, epoch-zero
or pre-epoch clock; refund persistence and relaunch; and continued refusal of
new/rolled-back trials. The separate original probe changed from two failures
out of three to three passes.

Production file: `electron/licensing-grant.ts`.

## Confirmed outstanding defects already covered by PR #1285

These were independently reproduced against the frozen main baseline. The
existing PR already contains their proposed repairs, so this audit does not
create a duplicate patch or claim those repairs have landed.

| Current-main defect | Reproduced consequence |
| --- | --- |
| Line lead-out can retrace lead-in | A 10 mm square with 2 mm, 45-degree line leads traverses the same 2 mm segment in both directions. |
| Contour start editing targets the free lead endpoint | Clicking the outline midpoint (5, 0) selects approximately (-1.414, -1.414), while the unled outline correctly selects (5, 0). |
| Artwork-level “leads off” is not represented in group settings | Geometry correctly omits the lead, but the group has no override settings to distinguish it from its lead-enabled operation. |
| Warnings merge distinct holders | Two holders named Score and Border produce one count-two warning naming only Score. |
| Inactive lead fields prevent recipe reseeding on a mode change | Switching a Birch cut operation to Fill retains 90% power, 400 mm/min and the cut preset. The otherwise identical control adopts the engraving preset: 35%, 3,000 mm/min. |
| Canonical curves omit lead work from routing estimates | For 6,000 triangles with 20 mm leads, equivalent polylines choose the background worker, while canonical curve-backed paths choose direct preparation. This proves a routing discrepancy, not a measured browser freeze. |

The base lead commits `625f300db` and `d2250f502` are already ancestors of this
baseline through #1318. Follow-up `6b28e3237` and latest #1285 head `bc5bfc8b3`
are not. The first five fixes belong to the former; the curve-work estimate fix
belongs to the latter. Pure reproductions and source locations are recorded in
`leads-report.md` and `leads-reproduction.log`.

## Remaining documentation inconsistency

After #1317, paid licences work indefinitely offline, with quiet weekly online
confirmation attempts. The source privacy notice still says paid Pro pauses
after 30 days without confirmation:
`docs/legal/kerfdesk-privacy-notice.md:84` and
`website/pages/privacy.mjs:236–238`. This conflicts with the current
implementation and ADR-623 Amendment 2, which explicitly leaves the owner
privacy wording update as a before-release follow-up. These legal/website
sources were not rewritten during the code audit. This is a source-content
finding; the live hosted privacy page was not checked.

## Feature retention matrix

PR links use the repository's historical numbers. “Retained” means the current
entry point and implementation were traced; the evidence column states what
was exercised and does not imply physical qualification.

| Major PRs | Current feature | Current evidence and disposition |
| --- | --- | --- |
| [#58](https://github.com/cisgz3a-hub/KerfDesk/pull/58) | Production foundations: canonical curves, variables, arrays, Print & Cut, LightBurn import | Retained. Source, ownership, persistence and transform paths reviewed; registration confirmation defect repaired. Focused tests and browser coverage recorded below. |
| [#35](https://github.com/cisgz3a-hub/KerfDesk/pull/35), [#51](https://github.com/cisgz3a-hub/KerfDesk/pull/51), [#943](https://github.com/cisgz3a-hub/KerfDesk/pull/943) | Own-engine tracing, measured boundaries, colour layers and native curves | Retained. Trace topology, commit ownership, operation allocation and mutation paths inspected/tested. Conversion/trace reference defect repaired. Not every fitting mode independently rederived. |
| [#193](https://github.com/cisgz3a-hub/KerfDesk/pull/193) | Artwork-specific operation settings | Retained. Import, paste and library remapping tested against operation collisions and settings ownership. |
| [#286](https://github.com/cisgz3a-hub/KerfDesk/pull/286), [#1059](https://github.com/cisgz3a-hub/KerfDesk/pull/1059) | Frame-first workflow | Retained under current ADR-565. Unchanged spatial evidence survives settings edits; Start reviews the current executable. Current state and browser tests exercise this contract. |
| [#328](https://github.com/cisgz3a-hub/KerfDesk/pull/328), [#1157](https://github.com/cisgz3a-hub/KerfDesk/pull/1157) | Image editing and unified Design Studio | Retained. Current Apply, session ownership, retained documents and save/reload tested. |
| [#17](https://github.com/cisgz3a-hub/KerfDesk/pull/17), [#360](https://github.com/cisgz3a-hub/KerfDesk/pull/360), [#1243](https://github.com/cisgz3a-hub/KerfDesk/pull/1243) | Desktop runtime, hardening and platform integration | Retained in source/configuration. Startup, route isolation and package contracts tested. No installed Windows/macOS/Linux executable qualified. |
| [#542](https://github.com/cisgz3a-hub/KerfDesk/pull/542), [#543](https://github.com/cisgz3a-hub/KerfDesk/pull/543) | Layered CNC design and 3D workspace | Retained. Shared design state, per-bit Apply/simulation and viewport projection inspected. |
| [#622](https://github.com/cisgz3a-hub/KerfDesk/pull/622) | Vector-medial V-carve | Retained. Current degeneracy/depth-law tests plus a new independent rectangle/cutter-envelope oracle at 30/60/90/120 degrees. Checks use rounded emitted chords. Older reverted V-carve approaches are not counted as missing current features. |
| [#660](https://github.com/cisgz3a-hub/KerfDesk/pull/660), [#939](https://github.com/cisgz3a-hub/KerfDesk/pull/939) | Canonical heightfields, relief roughing/finishing | Retained and extended by exact mesh contact and waterline finishing. Metadata, scale, partial cells, contact and projection paths inspected/tested. |
| [#409](https://github.com/cisgz3a-hub/KerfDesk/pull/409), [#995](https://github.com/cisgz3a-hub/KerfDesk/pull/995) | Inspector, stock/burn simulation and STL | Retained. Parser, stock/STL, design target and comparison tested. Edge-cell defect repaired. Simulation remains a bounded visual model. |
| [#329](https://github.com/cisgz3a-hub/KerfDesk/pull/329), [#851](https://github.com/cisgz3a-hub/KerfDesk/pull/851) | Large raster planning and streamed compilation | Retained. Raster row/dither/emission, streaming and rotary-raster cohorts passed. No claim about every image size or worst-case allocation. |
| [#829](https://github.com/cisgz3a-hub/KerfDesk/pull/829) | Recovery and painted second pass | Retained. Current archived-program, recovery ownership and second-pass writer paths reviewed/tested. Intentionally retired early checkpoint code is not a regression. |
| [#865](https://github.com/cisgz3a-hub/KerfDesk/pull/865) | Libraries, templates, recipes and imports | Retained. IDs, operation remapping, owned raster/clip data and persistence checked. |
| [#944](https://github.com/cisgz3a-hub/KerfDesk/pull/944) | Camera redesign and work placement | Retained. Camera models, capture ownership, calibration, fixture placement and job-watch paths inspected/tested. Burn-check generation defect repaired. |
| [#923](https://github.com/cisgz3a-hub/KerfDesk/pull/923), [#1025](https://github.com/cisgz3a-hub/KerfDesk/pull/1025), [#1212](https://github.com/cisgz3a-hub/KerfDesk/pull/1212) | Controller and reconnect reliability | Retained. GRBL/grblHAL/FluidNC, Marlin and Smoothieware paths reviewed with transport, acknowledgement and completion ownership kept distinct. Ruida is file export. Software evidence does not establish physical stop timing. |
| [#1021](https://github.com/cisgz3a-hub/KerfDesk/pull/1021), [#1022](https://github.com/cisgz3a-hub/KerfDesk/pull/1022), [#1277](https://github.com/cisgz3a-hub/KerfDesk/pull/1277) | Commercial licensing, proprietary distribution and startup window | Retained. Signed grants, nonce/clock handling, revocation, running-session admission and package identity tested. Final base includes #1317 paid indefinite-offline behavior; pre-epoch disk-persistence defect repaired. The earlier two fixture failures were superseded by #1317 and are not current failures. |
| [#1084](https://github.com/cisgz3a-hub/KerfDesk/pull/1084), [#1103](https://github.com/cisgz3a-hub/KerfDesk/pull/1103) | Retained production, constrained sketches and parametric parts | Retained. Solver, regeneration, arrays, sheets, nesting, recipe/manifest ownership and side-B transforms inspected/tested. Explicit hyphenated parameter references added. |
| [#1155](https://github.com/cisgz3a-hub/KerfDesk/pull/1155) | Multilingual shaping, flattened PSD and advanced nesting | Retained. Decoder bounds, bidi/shaping, worker ownership and independent placement certificates reviewed. Real browser workflows included. |
| [#1051](https://github.com/cisgz3a-hub/KerfDesk/pull/1051), [#1073](https://github.com/cisgz3a-hub/KerfDesk/pull/1073), [#1156](https://github.com/cisgz3a-hub/KerfDesk/pull/1156) | Remote access, approved machine control and phone/MCP app | Retained. Permission/revision/lease fences, action ledger, abort reserve, redaction and cancellation reviewed. Local workerd and renderer/native fixtures tested; no live service or actual machine used. |
| [#904](https://github.com/cisgz3a-hub/KerfDesk/pull/904) | Roller rotary, QR/barcodes and Recent Projects | Retained. Rotary transforms/output, independent QR decoding, materialisation, async ownership and storage/reopen tested. |

## Open proposals and historical replacements

- **#1317 merged during this audit:** indefinite paid offline operation is now
  present in the final base `3f3f529bf`. The original 30-day-paid baseline result
  is retained only as historical evidence in the commercial report. Fresh
  licensing-delta verification replaces it for the final conclusion.
- **#1287:** Free Inspector, system-font selection, inch display and external
  G-code execution are pending. The existing Inspector is present but remains
  Pro; external files currently have a diagnostic preview path.
- **#1297:** the proposed three-step Jig workflow is pending. #1298/#1307 merged
  into its branch, not main. Current registration-jig/editor functionality exists.
- **#1321/#1323:** proposed in-app terms/notices and AppImage filtering changes
  are pending. This audit did not inspect newly packaged AppImage bytes.
- **#1285:** its open status is not evidence that laser leads are missing.
  Stacked history reached main through #1318; the lead-specific report records
  the precise current implementation and any remaining difference.
- The old #27 checkpoint and reverted #572/#581/#589 V-carve paths were
  intentionally replaced. The current recovery and #622 V-carve paths were
  audited instead.

## Verification ledger

The completed runs below cover different layers and contain overlapping tests.
Cohorts must not be summed into a unique test count.

| Area | Fresh result |
| --- | --- |
| Design/import/production retention | 24 files / 216 tests passed; separate final persistence assertions 2 files / 17 passed. Earlier 18-file and 8-file cohorts overlap. |
| Same-ID vector-to-raster retracing | Final 5 files / 24 tests passed, including actual dialog commit, masks/guides, persistence, group identity and normal deletion warning behavior. |
| Curve/node editing | Existing 13 files / 116 tests passed before the missing cases were added. Repaired anchor/store cohort: 14 files / 120 passed. Final smoothing/store/command cohort: 3 files / 19 passed. |
| Print & Cut | 14 files / 113 tests and 8 files / 66 calibration tests passed. Independent complex-ratio/composition oracle passed 2,000 registrations / 8,000 point comparisons; maximum error 7.10e-12 mm. |
| LightBurn/DXF/PDF follow-up | 120 tests passed with two CLB streaming cases exceeding the default five-second test budget. Isolated 30-second-budget run passed all 18 streaming tests; this does not erase the default-budget timing failures. |
| CNC/sketch/relief/Inspector | 12 files / 73, 11 files / 83, and 7 files / 61 passed in focused cohorts; post-peer-review wall/parameter checks 4 files / 18 and final lexer 1 file / 3 passed. Cohorts overlap. |
| Camera/rotary/jig | Initial 98-file / 616-test run had 615 passes and the newly reproduced camera defect. After repair, the affected camera/component/browser-adapter cohort passed 3 files / 12 tests. |
| Raster and second pass | 25 files / 252 tests passed. |
| Desktop/licensing/Remote renderer | Historical initial base: 161/163 passed, with two nonce-fixture failures. #1317 superseded those test cases. Final base plus the persistence repair: 15 files / 206 tests passed. Original independent disk-store probe also passed 3/3 after repair. |
| Licence authority/service | 63 Node tests passed using local cryptographic/storage fixtures. |
| Desktop package contracts | 32 Node tests passed; these do not install or launch the app. |
| Remote workerd | 81 distinct selected cases have passing evidence across corrected-environment runs. Not claimed as one clean all-81 run. |
| Remote generated app and bundle | Generated app matches source; Wrangler dry-run bundle succeeded. No deployment. |
| Lead/CNC follow-up | 18 focused files / 146 existing tests passed across two cohorts, while independent probes reproduced the six missing cases above. Passing existing tests did not establish correctness. |
| Controller, serial, Frame and recovery | 374 files / 3,472 tests passed, including GRBL/grblHAL/FluidNC, Marlin, Smoothieware, cancellation, acknowledgement, settlement, recovery and current Start/Frame state paths. No hardware was connected. |
| Browser workflows | 30 selected workflows passed: nesting, cameras, CNC/parametric design, relief, Design Studio, Frame/Start, burn/stock simulation, text, PSD, production reuse, placement/Print & Cut and second pass. A further 2 trace/part/node editing workflows passed on the final main base and node repair, including Undo/Redo and Save/reopen. |
| Integrated TypeScript | `pnpm typecheck` passed on final main plus all renderer/core repairs. The subsequent Electron-only repair passed `pnpm exec tsc --noEmit --project electron/tsconfig.json`. Initial errors in new test fixtures were corrected before final checks. |
| Desktop renderer build | `pnpm build:bundle:desktop` passed on final main plus the renderer/core repairs. Rollup reported dependency annotation and chunk-size warnings. This built the renderer, not a native installer. The later Electron-only timestamp repair does not alter renderer inputs. |
| Changed-file hygiene | Scoped source ESLint, applicable test lint, Prettier and `git diff --check` passed. The Electron ESLint configuration intentionally ignores Electron test files; those tests were executed and formatted. |

The broad controller cohort began on the initial base; #1317 and the final
Electron timestamp repair do not modify its controller inputs. Final renderer
typecheck/build and the two node browser workflows use `3f3f529bf` plus the
local repairs. The 30-workflow browser run preceded the final node/licensing
delta; those changes received the separate node and licensing checks above.

### Test-environment findings

Sandbox temporary-cache renames and loopback socket access initially prevented
some tools from executing. Process-local absolute TEMP/TMP paths and approved
local-only execution resolved them. A workerd fixture failure was isolated to a
TMP path containing `../../`; corrected normal-TMP runs passed.

Initial browser batches encountered Vite source/artifact invalidations. Trace
evidence showed the application importing `laser-store.ts?t=...`, while the
fixture imported plain `laser-store.ts`. These were separate state instances:
the fixture never saw or acknowledged the real Start fence. Production correctly
timed out waiting for that held acknowledgement. A second temporary audit config
used `mergeConfig` with `watch: null`, but that helper skipped the null override;
generated Playwright HTML then caused page reloads. The corrected config assigns
the option directly, and `resolveConfig` explicitly reports `watch: null`.
The final browser run uses that fresh, warmed server and unchanged test timeouts.

Neither issue was classified as a customer defect or “fixed” by weakening
production safeguards.

## Evidence and manual coverage

Detailed current-path, inspected-file, test-command and limitation records:

- `build/major-pr-audit-20261020/design-report.md`
- `build/major-pr-audit-20261020/cnc-report.md`
- `build/major-pr-audit-20261020/commercial-remote-report.md`
- `build/major-pr-audit-20261020/import-gap-report.md`
- `build/major-pr-audit-20261020/print-cut-report.md`
- `build/major-pr-audit-20261020/leads-report.md`
- `build/major-pr-audit-20261020/node-edit-report.md`

Coordinator source review additionally covered the controller command/stream
and serial-worker paths; cancellation, Start and completed Frame ownership;
retained recovery/resume programs; second-pass construction; raster streaming;
rotary transformations; camera model/capture/placement/job-watch; and jig
session/rebase/output. These were targeted implementation slices, not a claim
of line-by-line review of every imported dependency.

New analytic/regression coverage is in:

- `src/core/cnc/vcarve-rectangle-oracle.audit.test.ts`
- `src/core/sketch-constraints/sketch-parameters.audit.test.ts`
- `src/ui/gcode-inspector/stock-design-partial-cells.audit.test.ts`
- `src/ui/state/trace-removal-references.test.ts`
- `src/ui/trace/retrace-kind-dependencies.test.ts`
- additions to `convert-to-bitmap.test.ts` and `job-watch-runner.test.ts`.
- additions to `PrintAndCutDialog.test.tsx`.
- additions to `src/core/scene/curve-edit.test.ts` and the new real-store
  `src/ui/state/path-node-implicit-closure.audit.test.ts`.
- `electron/licensing-runtime-persistence-clock.audit.test.ts`.

Logs, JSON reports, failing reproductions and browser traces/screenshots are
retained under the ignored `build/major-pr-audit-20261020/` directory. The
historical inventory is `build/pr-history-20261020/inventory.json`.

## Delivery boundary

Repairs are local working-tree changes. No audit commit was created, no branch
was pushed, and no GitHub PR was merged, released or deployed by this audit.
The local fast-forward adopted the already-merged #1317 from GitHub.
No hardware, real payment/provider state or installed application was operated.

Passing source/tests/browser checks establish the recorded software paths only.
Outstanding qualification includes real controller timing and material results,
installed commercial builds on supported operating systems, live licensing and
Remote providers, arbitrary imported-document corpora, and exhaustive
performance/fuzz testing.
