# Major historical PRs: current feature and code audit

Audited 20 October 2026, initially against `origin/main` at
`9c6e6a3d8f427d0af11e0eeebd67062b5ac3bd91`.
During verification, main advanced to
`3f3f529bfee89355500fef0708358e58f4decf7b` through PR #1317.
The isolated branch was fast-forwarded without discarding any repairs; the
licensing delta received separate review and fresh checks. Before PR creation,
main advanced again to `3d9ef34d74322bdb086cf6bf207a32af0ba5fb01` through #1293's
safety-notice UI change. That update was merged without conflicts, with fresh
controller/safety-notice, browser and renderer verification.
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
repairs are listed below. The initial audit repaired seven defect families and
identified six further lead defects plus stale paid-offline privacy wording.
The requested follow-up integrates the lead corrections from #1285 into this
branch, corrects the privacy sources, repairs two additional native-arc and
Cut Settings integration defects, and adds independent verification of the
combined changes. An open PR is not automatically an absent feature:
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

## Lead defects repaired in the combined audit branch

These were independently reproduced against the frozen main baseline. The
initial audit left them with their proposed repairs in open #1285. At the user's
request, the combined branch now incorporates commits `6b28e3237` and
`bc5bfc8b3` with their original authorship and cherry-pick provenance. This does
not merge or close #1285 on GitHub.

| Defect | Reproduction and repair |
| --- | --- |
| Line lead-out retraced lead-in | A 10 mm square with 2 mm, 45-degree line leads traversed the same 2 mm segment in both directions. A retracing pair now triggers the existing edge-restart search; the independent square probe has distinct endpoints 2.828427 mm apart. |
| Contour start editing targeted the free lead endpoint | Clicking an outline midpoint selected the free lead endpoint. Prepared segments now retain their contour range, and the editor reconstructs the closed outline. Independent midpoint selection matches the requested outline point. |
| Artwork-level “leads off” was absent from group settings | Geometry correctly omitted the lead, but the group lost the explicit override in review/output provenance. Explicit lead switches now count as overrides while inactive shape-only fields remain ignored. |
| Warnings merged distinct holders | Score and Border produced one count-two warning naming Score. Each holder now receives its own warning and count. |
| Inactive lead fields prevented recipe reseeding | A Birch cut switched to Fill retained 90% power at 400 mm/min. Inactive lead fields are now excluded from recipe-equivalence comparisons; the independent probe adopts the engraving recipe at 35% and 3,000 mm/min, while an actual manual speed edit remains preserved. |
| Canonical curves omitted lead work from routing estimates | For 6,000 triangles with 20 mm leads, equivalent polylines used the worker but canonical curves used direct preparation. Counting canonical contours now routes both representations to the worker. This verifies routing, not a worst-case performance guarantee. |

The base lead commits `625f300db` and `d2250f502` are already ancestors of this
baseline through #1318. The first five additional fixes belong to `6b28e3237`;
the curve-work estimate fix belongs to `bc5bfc8b3`. Original failing-behaviour
probes and source locations remain in `leads-report.md` and
`leads-reproduction.log`; all six corrected independent probes pass in
`leads-integrated-probe.log`.

### Additional start-editor mismatch found during integration — P2, repaired

The proposed contour reconstruction discarded native arc metadata. For an
arc-capable GRBL disc centred at (40, 40), radius 10 mm, targeting 15 degrees
offered the sampled-chord point (49.656678, 42.587476). Saving that preference
and preparing again actually joined the contour at (50, 40), a 2.610154 mm
disagreement. ADR-594 already restricts native-arc starts to existing move
boundaries; the editor was incorrectly presenting a broader choice.

Prepared leads now retain the original validated contour arc fingerprint.
Reconstruction validates that same fingerprint before using it, translation
carries its coordinates, and rotary Y mapping discards it with ordinary native
arcs. No arc refitting or new output policy is introduced. The independent
preparation/emission probe now reports zero disagreement and retains G2/G3.
Eleven regression cases cover one/three passes, zero/one-mm overcut, mirrored
and rotated geometry, machine origins, program offsets, Save/reopen, translated
metadata, rotary mapping and rejection after an untracked contour rewrite.
Two independent source reviews found no additional actionable defect in this
bounded repair.

Production files:
`src/core/job/{job,cut-segment-geometry,apply-laser-leads,led-contours,cut-arc-moves,rotary-transform}.ts`.

### Full Cut Settings Apply still prevented recipe switching — P2, repaired

The real browser workflow exposed an integration gap beyond the direct-state
lead regression. Applying the full Cut Settings form wrote six untouched
optional defaults into a sparse linked operation: zero overcut, disabled
perforation with 3/1 mm distances, count-based tabs and zero tab cutting power.
The recipe snapshot had those values absent. After enabling and disabling
leads through the dialog, changing to Fill therefore retained the cutting
recipe at 90% / 400 mm/min. Even a no-op Apply caused this mismatch.

Ordinary operation submission now omits those defaults only when the original
value was absent and its control was untouched. Existing values, nondefault
changes and explicitly entered defaults remain edits. Selected-artwork
submission retains its existing changed-control path, so explicit zero/false
overrides still apply across mixed artwork. Recipe equality, material bindings
and output policy are unchanged.

Real-dialog/store regressions reproduce the failed no-op and two-Apply flows,
exercise independently sparse settings, preserve deliberate edits and check
explicit zero/false on mixed artwork. The browser regression additionally checks
Undo/Redo, Save/reopen and subsequent manual power edits.

Production files: `src/ui/layers/CutSettingsDialog.tsx` and
`src/ui/layers/cut-settings-field-edits.ts`.

## Privacy wording corrected

After #1317, paid licences work indefinitely offline, with quiet weekly online
confirmation attempts. The initial audit found that the privacy sources still
described a 30-day paid deadline. The user explicitly authorised the correction:
`docs/legal/kerfdesk-privacy-notice.md` and `website/pages/privacy.mjs` now describe
paid offline continuity, while preserving trial confirmation/expiry and the
effect of a received revocation. The generated app privacy page is regenerated
from its source. This changes repository content; it does not publish the
hosted website.

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
  the initial current-main findings. Its two pending corrective commits are now
  included in this combined audit branch and receive fresh verification here.
- The old #27 checkpoint and reverted #572/#581/#589 V-carve paths were
  intentionally replaced. The current recovery and #622 V-carve paths were
  audited instead.

## Initial audit verification ledger

The completed runs below cover different layers and contain overlapping tests.
Cohorts must not be summed into a unique test count.

| Area | Fresh result |
| --- | --- |
| Design/import/production retention | 24 files / 216 tests passed; separate final persistence assertions 2 files / 17 passed. Earlier 18-file and 8-file cohorts overlap. |
| Same-ID vector-to-raster retracing | Final 5 files / 24 tests passed, including actual dialog commit, masks/guides, persistence, group identity and normal deletion warning behavior. |
| Curve/node editing | Existing 13 files / 116 tests passed before the missing cases were added. Repaired anchor/store cohort: 14 files / 120 passed. Final smoothing/store/command cohort: 3 files / 19 passed. |
| Print & Cut | 14 files / 113 tests and 8 files / 66 calibration tests passed. Independent complex-ratio/composition oracle passed 2,000 registrations / 8,000 point comparisons; maximum error 7.10e-12 mm. |
| LightBurn/DXF/PDF follow-up | Initial audit: 120 tests passed with two CLB streaming cases exceeding the default five-second budget; all 18 passed with a larger budget. The requested follow-up resolved the harness cause: cold dependency transforms now occur during collection, while all 18 original functional tests pass at the unchanged five-second timeout. Historical failures remain recorded. |
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

## Combined-PR follow-up verification

The follow-up starts from GitHub main `3f3f529bf` and includes the earlier
repairs, both lead correction commits, the additional native-arc repair
and the privacy/test-harness updates. Final integration also includes the
subsequent `3d9ef34d7` main update through #1293, as recorded above.

| Check | Result |
| --- | --- |
| Combined regressions | 68 files / 638 tests passed, covering every original audit regression plus lead, output, contour-start, recipe, review and rotary paths. |
| Latest-main integration | 6 files / 30 tests passed after merging #1293, covering reconnect, recovery, warning acknowledgement, LaserWindow and the workspace safety notice. |
| Native-arc follow-up | 8 files / 54 tests passed after the arc repair, including all 11 new cases. This closes the metadata change made while the broader cohort was running. |
| Full-dialog recipe regression | All 7 mounted dialog/store cases passed after the final filter change and fixture corrections. The earlier broader run's single invalid fixture is recorded separately, not counted as a passing cohort. |
| Final browser integration | 8/8 passed on a fresh post-freeze renderer: line and native-arc pointer editing, both recipe workflows with history/persistence/manual edits, and safety-notice layout at 1920/1280/640/360 px. No skipped or flaky cases; source/test fingerprints stayed unchanged throughout. |
| Independent lead reproductions | All six corrected original probes pass; the additional actual-preparation/native-output start mismatch is zero. |
| CLB streaming | All 18 existing functional assertions pass at the unchanged five-second timeout after test collection setup is corrected. |
| Privacy | 40 website tests passed; four generated assets match the generator; app/website pages rendered and inspected at desktop/mobile sizes. |
| TypeScript | Renderer/core and E2E checks passed on the final integrated source. Electron production typecheck passed on its final unchanged source. |
| Renderer build | Desktop renderer bundle passed after final production changes. Existing Rollup dependency-annotation and large-chunk warnings remain. |
| Source checks | Scoped ESLint and Prettier passed for changed supported source/tests. ADR-number, source-file-size and public-export-ratchet checks passed; no new dependencies were added. Markdown follows the repository's existing manual formatting policy. |

The added browser workflow and its final receipts are recorded with the
follow-up evidence below. These cohorts overlap and are not a unique aggregate
test count. The final behavioural source change was 20 October 2026, 16:02:05 UTC,
after incorporating the latest main and the dialog correction.
A type-only extraction moved `CutArcMoves` and `LeadContour` into
`cut-segment-geometry.ts` to keep `job.ts` within the repository's 600-line limit,
preserving the existing public type import. Its generated, minified JavaScript
is byte-identical before and after extraction. The final renderer build,
typecheck and browser cohort run after both changes. Subsequent changes are
tests, documentation and commits.

The final browser run took 108.511 seconds and used source recorded by
`f0f953342`, with the new E2E test and this report pending their final commit.
The owned test renderer was stopped after completion. The final desktop renderer
build completed in 1m 59s; its PWA generation succeeded with 425 entries.

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

The CLB follow-up reproduced the default-budget failure and isolated the cold
Vitest transformation of `clb-import` and its material-library graph inside
the first functional test. A test-only static import now loads that dependency
during collection. No parser is pre-run, no assertions or mocks change, and no
timeout is raised. The same cold transformation still takes 18.84 seconds,
recorded as setup; all 18 functional cases together take 1.000 second and pass.
This is a test-harness correction, not a claimed production import speedup.

## Evidence and manual coverage

Detailed current-path, inspected-file, test-command and limitation records:

- `build/major-pr-audit-20261020/design-report.md`
- `build/major-pr-audit-20261020/cnc-report.md`
- `build/major-pr-audit-20261020/commercial-remote-report.md`
- `build/major-pr-audit-20261020/import-gap-report.md`
- `build/major-pr-audit-20261020/print-cut-report.md`
- `build/major-pr-audit-20261020/leads-report.md`
- `build/major-pr-audit-20261020/node-edit-report.md`
- `build/major-pr-audit-20261020/leads-integration-peer-report.md`
- `build/major-pr-audit-20261020/privacy-update-report.md`
- `build/major-pr-audit-20261020/lead-browser-report.md`
- `build/major-pr-audit-20261020/cut-settings-recipe-report.md`
- `build/major-pr-audit-20261020/job-type-extraction-proof.log`

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
- `src/ui/state/canvas-start-editing-leads-arcs.audit.test.ts`.
- `src/ui/layers/CutSettingsDialog.recipe-reseed.audit.test.tsx`.
- `e2e/laser-lead-start-reseed.e2e.ts`.
- Follow-up setup correction in `src/ui/import/document-import-lightburn-stream.test.ts`.

Logs, JSON reports, failing reproductions and browser traces/screenshots are
retained under the ignored `build/major-pr-audit-20261020/` directory. The
historical inventory is `build/pr-history-20261020/inventory.json`.

## Delivery boundary

The user requested one PR containing the audit repairs, remaining lead
corrections and privacy wording update. The changes are committed on
`codex/major-pr-current-audit-20261020`; the two incorporated lead commits retain
their original authorship. Creating that PR does not merge #1285 or publish a
release. The earlier local fast-forward adopted the already-merged #1317;
the final integration merge adopts the already-merged #1293.
No hardware, real payment/provider state or installed application was operated.

Passing source/tests/browser checks establish the recorded software paths only.
Outstanding qualification includes real controller timing and material results,
installed commercial builds on supported operating systems, live licensing and
Remote providers, arbitrary imported-document corpora, and exhaustive
performance/fuzz testing.
