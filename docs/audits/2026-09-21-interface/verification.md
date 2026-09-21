# Integration verification

Date: 2026-09-21. Isolated worktree: `D:\LaserForge\ui-audit-20260921`.
Branch: `codex/ui-audit-20260921`, based on `377e692baf26a9f66ba3877f157213095c54b92f`.

The primary checkout and its unrelated edits were preserved. Publication status is tracked by the
associated PR; the software evidence below does not qualify a physical machine or packaged desktop.

## Latest upstream remediation integration

Main `39eebb6fcb723a2e51f9866a7c0c7dedf396b981` was subsequently merged at
`9d05cc626cee59187370b16d31095f257de8cb2e`. The one conflict was the tracing browser fixture;
the resolution retains main's documented heartbeat/silence contract and its cancellation and
geometry assertions. The prior strict-compute local failure is retained in
[the browser-gate history](pr-ci-followup.md), not relabelled as a pass.

[The compact source supplement](pr-remediation-controls.md) records the unchanged 817-definition /
94-command count with changed parent visibility conditions. [Machine integration evidence](pr-remediation-machine.md)
records the current completion, origin, setup, dwell and recovery checks. The earlier reports
below remain evidence for their dated source states.

The production build, including application TypeScript, passed on this merged source. The narrow
machine integration passes 140 distinct cases: 132 in the initial report and eight additional
cases in the focused follow-up. Those eight include a real-store GRBL simulator run whose live
dwell estimate is unavailable; settled completion still exposes Done and clicking it leaves the
project and outbound command history unchanged. These are software and simulator results.

## Final tutorial integration and browser-gate follow-up

Main's tutorial update at `af1a1b83f7ece14a46e3386b1845bb35daf971ac` was subsequently merged
at `35b873829c9eb6681d52cc966dc7e15564be4360`. The final production build, including application
TypeScript, passed. The compiled routine-controls case passed with lesson → library → workspace
Escape navigation and focus restoration. Historical screenshots were preserved byte-for-byte.

[The final tutorial supplement](pr-final-tutorial-integration.md) records the 817-definition /
94-command snapshot and 132 passing tutorial cases. [The browser-gate follow-up](pr-ci-followup.md)
records the initial hosted failures, passing toolbar rerun and unsuccessful local Sharp benchmark.
Hosted release and browser checks on the final PR commit remain separate merge gates; these local
results do not pre-empt their outcome.

## PR integration, 2026-09-22

The branch integrated main through `9d72ba798faf3342efe0f808e1656924e3632b65`, including
Appearance preferences, Import Image placement, Frame preparation fixes and the three-stage
machine-setup redesign. The interface ADR was renumbered to 340 to retain main's ADR-339.
[The integration supplement](pr-integration.md) separates the new controls from the historical
805-record audit and records the current source inventory and targeted integration evidence.

The first integration batch passed 160 cases across 11 files, including all 94 commands, toolbar
placement, setup dispatch, completed-run acknowledgement and upstream single-flight Frame
preparation (`pr-integration-menu-vitest.json`). This batch preceded the final machine-setup merge;
its additional verification is recorded in the supplement. The older counts below retain their
original source scope and must not be presented as newly executed checks of every inherited control.

After the final main integration, the production build, browser-test typecheck, ADR uniqueness
and file-size backstop passed. `pr-integration-browser.json` records 10/10 development-browser
passes for the repaired workflows, Done, keyboard access and responsive shell. The rebuilt
production preview passed 5/5 cases in `pr-integration-production-browser.json`: material wizard,
Image Studio layers, routine machine controls, Light/Dark menu choices and stored Match System
responding to live OS changes. The Match System menu dispatch itself is verified by the separate
menu test. Repository-wide hosted release and browser gates are tracked on the PR.

The final machine/setup integration aggregate passed 68/68 cases across nine suites, retaining
links to each raw run. The fallback tests mount the actual setup host and verify homing and
autofocus destinations without running hardware. The initial failures were fixture assumptions
about Review-card order and a jsdom radio selector; named destinations and native input lookup
retain the intended assertions. No production change was needed for that setup integration.
Repository-wide ESLint passed on the integrated tree; the final new setup test files also passed
their scoped lint check.
The final full TypeScript check, including the three new/strengthened setup audit files, passed.
Repository-wide formatting and `git diff --check` passed after evidence packaging. The primary
checkout's complete tracked/untracked status matched its publication-start snapshot.

## Button-by-button follow-up, 2026-09-22

The [complete control audit](control-audit.md) now validates all **805 baseline records** and
**91 command IDs**. It records 421 verified local behaviours, 362 explicit boundaries, nine
records with fixed defects, six unmounted legacy controls and seven non-action inventory entries.
These are source records, not a count of distinct visible buttons. No record is unmapped.

The 91-command DOM menu test independently specifies each callback, argument, dirty guard or URL.
All 93 shipped lesson cards/contextual buttons open their exact named lesson while preserving the
project. Further targeted cases click drawing/node, preview, panel, calibration, recovery, origin,
override, studio, material and camera controls and assert their stated effects. Mocked machine
callbacks are expressly classified as boundaries, including Frame/Start, Home, Abort, Fire and
origin dispatch; they do not establish physical effects or exact-artifact policy by themselves.

The deeper pass fixed three additional defects: Image Studio stack-edge no-op actions, material
wizard Back discarding drafts, and a camera save label promising an unperformed display action.
New Chrome regressions cover material Back/Next/Save/reopen and image add/move/merge. Both passed
against the compiled production bundle, along with the compact routine-controls smoke check
(**3/3**). Serial/platform APIs were replaced by disposable repository fixtures; no machine was
connected. The two earlier browser fixture failures were missing the Panels disclosure and then
using its wrong label, History. Correcting the locator left the actual state assertions intact.

Additional evidence batches are recorded separately rather than summed across shared tests:

| Follow-up scope | Latest executed evidence |
| --- | --- |
| Shell, workspace, tutorials and 91-command menu | 450 distinct current cases passed. |
| Machine and calibration | 697 distinct current cases passed. |
| Artwork, materials, design library and box/kit controls | 558 existing plus 47 additional current cases passed. |
| Studio/camera additions and focused reruns | 144 distinct current cases passed across the retained studio reports, including 77 new audit cases. |

Original failures remain in the raw JSON. The obsolete artwork case titled “relieves CNC square
corners into new geometry without removing the original” incorrectly assumed a duplicate-object
workflow. It was renamed to “relieves CNC square corners in place and restores the original with
Undo”; that passing case asserts changed geometry, retained object identity and full Undo recovery.
It is one corrected case, not an unresolved product failure or two independent passing tests.
Other initial fixture failures involved expected labels, node selections deliberately cleared by
geometry edits, and incomplete mocked adapter/return values. Their corrected cases pass; no passing
suite is used as a substitute for an individual control outcome.

Current source inventory: 2,626 scanned source/helper files, with SHA-256
`e886c12cb5eb8f9163de8d49a247ddd79a4d1a1e73233285647458595776e5d3`.
The retained baseline IDs are reconciled to current source lines in `control-audit.json`.

Production-browser command:

```powershell
$env:PLAYWRIGHT_PORT='57283'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='docs/audits/2026-09-21-interface/control-audit-browser-production.json'
pnpm exec playwright test e2e/button-audit-regressions.spec.ts e2e/interface-simplification.spec.ts --grep 'material wizard Back|Image Studio stack-edge|routine controls' '--reporter=list,json' --output test-results-built-audit
```

### Final integrated checks, 2026-09-22

| Check | Result on the completed audit worktree |
| --- | --- |
| `pnpm build:web` | Passed TypeScript and the final production build, including all audit test files. Existing bundle-size advisories remain. |
| `pnpm lint` | Passed across the repository. |
| `pnpm typecheck:e2e` | Passed. |
| `pnpm format:check` | Passed across the repository after formatting the two new machine test files and browser-result JSON. |
| File-size backstop and `git diff --check` | Passed. |
| Combined evidence validator | All 805 baseline records and 91 commands accounted for; every cited passing assertion resolves to its retained report. |
| Compiled browser workflows | Material Back/Next/Save/reopen, Image Studio add/move/merge and routine-controls checks passed, 3/3. |
| Final compiled-preview smoke | Routine controls passed again after the final build, 1/1; retained in `control-audit-final-preview.json`. |

The last production edit only shortened the camera alignment guidance to meet the function-size
limit. Its focused DOM regression passed before the final build. The final preview smoke confirms
the rebuilt bundle is served on port 57283; it does not extend the camera or hardware evidence.
Formatting-only edits after these checks do not change application behaviour.

The following sections retain the earlier 2026-09-21 UI-pass evidence and failure dispositions.
Its test counts overlap the control-specific follow-up and must not be added to it.

## Initial source and functional audit, 2026-09-21

The final catalogue contains **805 control definitions/component calls**, **91 command IDs**, and
**22 UI areas**. The 2,623-file scan excludes named test/spec files and fixture directories but
includes helper modules; it is not a production reachability count. Its source SHA-256 is
`8f5e258f3e7949843c05b7660e08060bb5a479e70615177c15a40d757c11d217`.

[Per-area evidence](button-test-evidence.md) accounts for duplicate runs: 1,413 distinct assertions
have passing evidence after the separately documented CommandShell fixture correction. The raw
JSON intentionally retains its original failures. The 39 added command cases verify dispatch,
exact arguments and availability reasons for 22 command IDs without explicit named references.
The final command/menu/run-order regression batch passed 46 assertions in three files.

Additional machine, toolbar and completion batches overlap these tests and are therefore reported
separately in [the main audit](README.md), [workspace report](workspace.md) and
[completion report](completion.md). Completion checks include a real-store GRBL simulator cycle,
settlement, stale-click rejection, retained project/history/Frame state, and no controller writes
from Done. This is software and simulator evidence.

## Build and repository checks

| Check | Final result |
| --- | --- |
| `pnpm install --frozen-lockfile --store-dir D:\LaserForge\.pnpm-store` | Passed. |
| `pnpm typecheck` | Passed. |
| `pnpm typecheck:e2e` | Passed, including the final disclosure fixture updates. |
| `pnpm lint` | Passed. Later fixture and audit-script changes also passed scoped ESLint. |
| `pnpm format:check` | Passed across the repository; final report-only edits were formatted and checked separately. |
| `pnpm build:web` | Passed, including TypeScript and the production Vite build. Existing chunk-size warnings remain. |
| `pnpm check:adr-numbers` | Passed; ADR-339 is unique. |
| `pnpm check:file-size` | Passed. |
| `pnpm check:soft-size` | Completed with 209 existing report-only findings. |
| `pnpm check:index-exports` | Passed the existing export ratchet. |
| `git diff --check` | Passed. |

The initial production build caught an incomplete mock LaserState fixture in the new setup test;
adding the required empty `pendingLines` array resolved it. Initial formatting failures were the
generated catalogue JSON and a temporary browser reporter file. The generator now honours the
repository Prettier configuration; the temporary file was removed, then the full check passed.
No release-readiness claim is made: `pnpm release:check` and physical/native-desktop qualification
were not run for this local interface change.

## Browser checks

All browser runs used repository platform/serial fixtures in Chromium. They did not connect to a
physical controller. Simulated completion screenshots are explicitly labelled in the main audit.

**44 distinct development-browser scenarios passed**, plus one repeated routine-controls scenario
against the compiled production bundle:

| Batch | Evidence |
| --- | --- |
| Interface simplification, shell, Preview parity and responsive workspace | 19 distinct scenarios. Initial 18 passed, one short-window completion overflow failed. After compacting the completion card and adding dock-local scrolling, the failed case and three affected cases passed. |
| Text editing and production workflows | 24 distinct scenarios. Initial 18 passed, six Home locators timed out behind the new setup disclosure. All six passed after the shared fixture opened the disclosure first. |
| Unconfigured autofocus | One additional scenario passed: its setup button opens the correct setup section. |
| Compiled production bundle | Routine-controls/disclosure/keyboard/help/compact-layout smoke test passed. |

The production workflow rerun retained the existing assertions for print-and-cut trust,
Frame/Pause/Resume/Alarm/Stop/Home, controller position versus acknowledgement progress, settled
completion, interrupted checkpoint recovery, jog speed, work zero and canvas keyboard ownership.
The only fixture change in those paths was how to reach Home through the named disclosure.

Commands (the development server was already running on port 5186):

```powershell
$env:PLAYWRIGHT_PORT='5186'
pnpm exec playwright test e2e/interface-simplification.spec.ts e2e/ux-shell.spec.ts e2e/preview-entry-parity.spec.ts e2e/workspace-responsive.e2e.ts
pnpm exec playwright test e2e/interface-simplification.spec.ts e2e/ux-shell.spec.ts --grep 'Done clears|routine controls|usable overflow-free|disclosure controls'
pnpm exec playwright test e2e/canvas-text-editing.spec.ts e2e/production-workflows.spec.ts
pnpm exec playwright test e2e/production-workflows.spec.ts e2e/workbench.e2e.ts --grep 'uses one print-and-cut|frames, pauses|shows controller-reported|keeps the finished route|preserves an interrupted|uses jog speed|unconfigured auto-focus'
```

Compiled-bundle smoke (the Vite preview server was already running on port 57283):

```powershell
$env:PLAYWRIGHT_PORT='57283'
pnpm exec playwright test e2e/interface-simplification.spec.ts --grep 'routine controls' --output test-results-built
```

The five delivered screenshots were inspected, including the unchanged user reference. In the
640 × 450 banner-heavy completion case, the job dock scrolls independently; Done and Frame/Start
are each reachable but do not all fit in the available height simultaneously.

## Independent integration review

A second agent reviewed completion state ownership, setup/history disclosures, jog/fire layout,
Frame/Start controls, Image Studio menus and Run Order selection. It found no actionable regression
or new controller effects, changed Start gate, hidden active recovery/Abort route, or unintended
project mutation. A separate simulated Chromium check confirmed keyboard navigation continues
inside the job dock after Done removes its own button.

## Remaining boundaries

- An inventory record or nearby test does not certify every dynamic instance and device state.
- Focus Test remains intentionally disabled because its dedicated qualified Z-motion generator
  is absent; it was not enabled by this change.
- Real homing, probing, firing, camera acquisition, material cutting, OS file dialogs, desktop
  installation/update and deployed behaviour remain unverified.
- The next action is to review this local build, then explicitly request any PR/merge/deployment
  or a separately scoped physical acceptance run.
