# Feature code quality audit: 22–27

Audited snapshot: `ccaa3064d9efe904821307f0603ce842d903b586`, extracted at `C:\Users\Asus\.codex\audits\kerfdesk-features-20260905-ccaa3064`. This matches the website inventory build. All implementation file/line references below refer to that snapshot, not the inherited working checkout.

The review traced the six feature groups individually through rendered callers, state, pure computation, transport and existing regression tests. It is a code-quality assessment and focused software reproduction, not exhaustive path coverage or hardware qualification. No application source, project configuration, provider or hardware state was changed. After the initial source-only pass, the integrating reviewer authorized audit-only tests in the extracted snapshot. They and their output are retained beside this report.

Six reproduction tests pass by asserting the **observed defective behavior**. They are not evidence that the application passes acceptance tests. Existing regression tests were inspected but were not rerun by this lane. This lane reports seven findings: two P1 (F24-1, F24-2), four P2 (F22-1, F22-2, F23-1, F25-1), and one P3 (F26-1).

## 22. CNC specialist workflows

**Verdict: mixed.** Relief import/editing and probe transaction ownership show careful engineering; standalone surfacing has a material scalability defect, and the full-page CNC viewer allows shortcuts to edit underlying artwork. Physical machining quality remains unqualified.

| Workflow | Inspected chain and quality assessment |
| --- | --- |
| Grayscale height maps | `use-app-commands.ts` → `app/height-map-import-action.ts` → import worker → canonical heightfield. Document ownership is captured before the picker and checked after worker completion; batches are sequential, cancellation is surfaced, and main-thread fallback is explicitly disclosed. |
| STL/relief size, depth and mapping | `layers/SelectedReliefProperties.tsx`, `ReliefGammaControl.tsx`, mapping controls → `state/relief-param-actions.ts` → `relief-heightfield-param-patch.ts`, width resolution/factorization. Canonical source values remain distinct from interpretation; positive finite Gamma and U16 endpoints are validated; no-op mapping edits avoid unnecessary undo. Legacy meshes and canonical fields are deliberately separated. The entire STL decoder was outside this lane's deep review. |
| Relief/cut 3D, section/image export | `Relief3DViewerDialog.tsx`, `Cut3DPreviewDialog.tsx` → `Viewer3DDialogShell.tsx`, worker surface preparation and scene creation. Display resolution is disclosed, worker failures stay visible, and AbortSignal/unmount ownership prevents stale scene installs. The workspace pane separately mounts `Cnc3DFullPage`, whose modal isolation differs; see F22-2. No WebGL/material-removal accuracy qualification here. |
| Tiling and registration | `device-setup/DeviceSetupCncTilingFields.tsx` → `CncTilingDisclosure.tsx` → `core/cnc/effective-cnc-tile-grid.ts`, `tile-plan.ts`, `tile-registration.ts`. UI stages setup changes. Grid coverage and effective overlap are centralized, total tile work is computed before allocation, and clipped ramp limitations are advisories. |
| Spoilboard surfacing | `LaserWindow` → `machine/CncUtilitiesPanel.tsx` → `SurfacingPanel.tsx` → `core/cnc/surfacing.ts` → standalone emission and file writer. Area defaults track document and stock changes; finite validation, safe-Z before spindle start, modal units/plane/feed initialization, exact shallow-depth disclosures, and advisory partitioning are strengths. See F22-1. |
| Probe | `ProbeControls.tsx`/`ProbePanel.tsx` → `laser-probe-actions.ts` → typed GRBL sequence and command arbiter. Probe transaction IDs and connection identity are rechecked before/after every await, including final settled Idle. Distinct alarm/no-contact/rejection/timeout results are preserved; plate-removal attestation updates only current probe evidence. Recovery is reviewed under feature 25. |

**F22-1 — P2, source-confirmed: surfacing bounds each loop but not their product, then materializes everything synchronously.**

- Location: `src/core/cnc/surfacing.ts:78–85`, `105–114`, `148–151`; caller `src/ui/machine/SurfacingPanel.tsx:132–151`.
- Trigger: Save surfacing G-code with a small positive stepover and multiple depth passes. A 300 mm-high area, 10 mm bit, 0.1% stepover and 50 mm total depth produce roughly 30,001 rows × 100 passes: approximately six million G-code lines. Every value is accepted by the numeric UI, and both independent 100,000-iteration checks pass. Still larger accepted combinations approach billions of lines.
- Impact/evidence: the button handler executes `buildSurfacingProgram` before its first await; nested loops allocate all strings, then `.join` and standalone preparation allocate/process the full program again. The UI cannot handle cancellation or other interactions during that computation. The precise memory footprint and freeze duration were not measured; the multiplicative work and main-thread execution are source-confirmed. No huge allocation was attempted during audit.
- Surrounding protections: non-finite values and excessive individual row/pass counts are already rejected; they do not bound combined work. The existing tests independently check pathological row count and pathological depth count, not their product.
- Scoped improvement: calculate total output work first; prepare/output large programs through a cancellable worker and bounded streaming representation, preserving the entered geometry and exact final depth. Explain any actual representation failure. Do not change stepover/depth silently or introduce a machining policy gate.
- Acceptance: combined row/pass workloads remain responsive and cancellable, allocation scales with the streaming batch rather than total emitted lines, and small requests remain byte-identical. Exercise a workload where each individual dimension is below its existing limit but the product is large.

**F22-2 — P2, reproduced: the full-page CNC viewer leaves background editing shortcuts active.**

- Location: `src/ui/workspace/Cnc3DFullPage.tsx:78–89`, `122–129`; caller `Cnc3DPane.tsx:110–125`; global shortcut ownership `src/ui/app/use-shortcuts.ts:109–118`, `135–157`; `src/ui/state/ui-store.ts:360–363`.
- Trigger: select artwork, open the CNC 3D pane's **Open full page** view, focus one of its buttons and press Delete.
- Impact/evidence: the view is a portal with `role="dialog" aria-modal="true"`, but it never registers a modal owner, contains focus, or makes the background inert. Global editing shortcuts check the store's modal flags, which remain false. The audit renders the actual full-page component and actual `useShortcuts`, mocking only the WebGL scene hook; Delete from its focused Close button calls `removeSceneObjects(['selected-artwork'])`. The hidden selected artwork is therefore edited despite the modal presentation. No claim is made that this test operated machine controls.
- Surrounding protections: typing-target checks do not suppress a shortcut from a button. The component handles Escape but does not provide modal isolation. The shared `src/ui/kit/Dialog.tsx` already composes modal registration and the focus/Escape/restore hook; the full-page caller does not wrap itself in that component.
- Scoped improvement: use the shared modal ownership and accessibility hooks (or a fullscreen variant of the shared Dialog) so rendering, focus containment and application shortcut suppression agree. Preserve the viewer toolbar and scene lifetime.
- Acceptance: Delete and other background editing shortcuts cannot modify artwork while this view is open; Tab/Shift-Tab remain inside it; Escape closes it and restores focus; closing it releases modal ownership and restores ordinary shortcuts. Run against the real global shortcut hook, not only local key handlers.

Inspected tests: `core/cnc/surfacing.test.ts`, `ui/machine/SurfacingPanel.test.tsx`, `core/cnc/effective-cnc-tile-grid.test.ts`, `core/cnc/tile-plan.test.ts`, `ui/app/height-map-import-action.test.ts`, `ui/state/relief-param-actions.test.ts`, `ui/relief-viewer/Cut3DPreviewDialog.test.tsx`, `ui/state/laser-probe-lifecycle.test.ts`. Existing source includes shallow-depth precision, exact far edges, stock replacement, warn-only export, cancellation and physical-port-close probe cases. The full-page modal reproduction is in the audit-only fixture.

## 23. Preview and G-code inspection

**Verdict: generally strong architecture, with a reproducible presentation race.**

The main Preview chain (`workspace/use-preview-toolpath.ts` → preview building/background preparation → scene-frame mapping; `use-preview-playback.ts` → timeline) separates display from emitted output, keys rebuilds on resolved placement instead of every status object, and suppresses stale work. G-code inspection (`GcodeInspectorDialog.tsx`/`CanvasGcodeView.tsx` → `use-gcode-inspection.ts` → worker → `InspectorView.tsx`) shares the same parsed model between views. Blob source lines are windowed; the renderer belongs to the canvas rather than every new model; cleanup disposes a scene even when its asynchronous creation resolves after unmount. Live machine coordinates use the millimetre-normalized reported-work-position selector. Program statistics are memoized per program rather than rescanned per playback frame.

Playback, source line jump, views, travel/direction overlays, color lenses, health/readout presentation and PNG export callers were inspected. The audit did not establish parser equivalence for every controller dialect or render a million-line program.

**F23-1 — P2, reproduced: turning traversal off while the 3D scene is loading is forgotten.**

- Location: `src/ui/gcode-inspector/InspectorView.tsx:123–127`; asynchronous install `use-viewer3d-scene.ts:40–58`; omitted synchronization in `use-scene-sync.ts:25–54`; scene default `src/ui/viewer3d/viewer3d-scene.ts:168`, `176–184`.
- Trigger: open the full Inspector and untick **Show traversal moves** before its lazy Three.js scene resolves, such as on first load or a slow device.
- Impact/evidence: checkbox state becomes false, but the handler calls a null `handleRef`. The created scene defaults travel visibility to true. Unlike playhead, lens, arrows and live marker, travel visibility is never replayed when the scene becomes ready. The audit test renders the actual Inspector, delays scene creation, clicks the checkbox and confirms the final ready scene received zero `setTravelVisible` calls while the checkbox remains unchecked. This affects the view, not emitted machine commands.
- Scoped improvement: include `travelVisible` in the existing readiness-aware scene synchronization, using the latest React state when the scene becomes ready.
- Acceptance: untick before delayed scene creation, resolve it, assert `setTravelVisible(false)` and hidden travel; retain normal toggles and model replacement behavior.

Inspected tests: `GcodeInspectorDialog.test.tsx` (focus/modal isolation, error/fallback, simulator handoff), `use-viewer3d-scene.test.tsx` (single scene/model installation and cleanup), `InspectorSidebar.test.tsx`, playback/source helpers, `workspace/use-preview-playback.test.tsx`, `use-preview-toolpath.test.tsx`. None of the existing inspected tests covers a travel change before scene readiness.

Optional maintainability improvement: `use-inspector-playback.ts` still names seconds `routeMm`/`setRouteMm`, and `InspectorTimeline` calls total seconds `totalRouteMm`. Rename these to time units in a scoped change so future consumers do not treat them as distance. This naming issue is not itself a proven timing defect.

## 24. Positioning and origin

**Verdict: needs correction before calling this implementation high quality.** Two reproduced defects cross controller coordinate/ownership boundaries. They do not demonstrate a physical incident, but their software behavior is concrete.

The eight jog directions, step/feed preferences, focus controls, pointer-hold cancellation, origin buttons, persistent-origin transaction, go-to-work-zero, job-origin anchors and output-scope controls were followed. Positive qualities include common physical direction mapping, millimetre conversion at position consumers, one owned motion/settlement chain, pointer release/blur/unmount cancellation, explicit persistent-origin confirmation, and invalidation of exact Frame permits when relevant state changes.

**F24-1 — P1, reproduced: Move laser here sends machine coordinates as work coordinates.**

- Location: `src/ui/workspace/position-laser-click.ts:32–33`, `51–59`; `src/ui/state/laser-jog-actions.ts:132–165`; `src/core/controllers/grbl/commands.ts:121–132`.
- Reachability: `ToolStrip.tsx:30`, `39–53` exposes the tool without a machine-kind restriction; `use-workspace-drag.ts:247–250` dispatches a canvas point. `positionLaserTarget` maps it into the bed's machine frame, then calls `laser.jog` with `relative:false`. The store forwards it to the driver unchanged.
- Trigger/evidence: in the audit's real store/driver path, an Idle GRBL reports MPos `(50,70)` and WCO `(40,50)`. A rear-left-origin canvas click at `(100,100)` emits `$J=G90 G21 X100.000 Y100.000 F3000`, without `G53` or offset conversion. GRBL interprets that as work `(100,100)`, so its machine destination is `(140,150)`, offset from the requested point. This interpretation is independently confirmed by the upstream [GRBL 1.1 jogging documentation](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging), whose G90 example uses WPos and whose G53 example uses MPos.
- Impact: incorrect physical destination whenever a nonzero work offset is active; configured-bound/path warnings also evaluate the wrong destination because this call labels machine coordinates as an absolute jog. Actual machine motion was not run.
- Surrounding protection: ordinary connection/Idle/command-ownership checks do not convert the coordinate frame. Existing click tests mock `jog` and assert the wrong absolute payload, so they do not exercise WCO. `jogToMachinePosition` already calculates a relative delta from the live machine position and provides the CNC safe-Z point-move sequence; this canvas path bypasses it. The absence of the CNC point-move retract is also source-confirmed, but no physical cutter collision is claimed.
- Scoped improvement: route this machine-space target through the existing `jogToMachinePosition` action, retaining physical origin mapping, machine-coordinate identity and existing CNC retract semantics. This needs no additional policy gate.
- Acceptance: nonzero G54/G92 offset, inch reporting and each supported bed origin all reach the same requested machine point. Assert actual driver wire output and computed destination, rather than mocking only the action. CNC canvas point moves should use the same settled safe-Z sequence as Go to work zero.

**F24-2 — P1, reproduced: an acknowledged Set Origin completion can overwrite a replacement controller session.**

- Location: `src/ui/state/laser-origin-transaction.ts:60–71`, `75–88`; `src/ui/state/laser-origin-actions.ts:306–317`, `320–338`.
- Trigger: G92 receives `ok`, but its WCO is still unknown. Set Origin then polls for WCO for up to three seconds. The physical port closes during that wait; optionally connect a replacement session before the old poll finishes.
- Evidence: the first audit test calls the fake physical port's real `onClose` listener after G92 ACK. The store increments its session epoch and clears origin. After 3.1 seconds the old action resolves successfully and restores `workOriginSource:'g92'`, `workOriginActive:true`, `positionEvidenceSuppressed:false` while still disconnected. A second test reconnects before completion: the replacement reports WCO `(40,50,0)` and MPos `(50,70,0)`; the old action overwrites WCO to `(50,70,0)` and labels it G92, although no G92 was sent in the replacement session.
- Impact: stale success and origin proof belong to another controller session; subsequent coordinate consumers can use an offset the replacement controller never reported. Frame remains required for ordinary Start; this finding is about state/coordinate integrity, not bypassing that gate.
- Surrounding protections: teardown cancels command/status wait objects, but this post-ACK wait is a private `setTimeout` loop outside those refs. `runOriginTransaction` checks MPG around the command; after awaiting `successPatch`, only clearing the `controllerOperation` marker is conditional on ownership. The success patch itself is unconditional. Its failure patch similarly lacks a session owner check.
- Scoped improvement: bind the whole transaction, post-ACK WCO wait and success/failure publication to an operation identity plus controller session/connection. Cancellation must end obsolete waits and prevent stale state/log/toast/placement publication. Reuse existing owned-wait patterns rather than adding a Start policy gate.
- Acceptance: disconnect, reset, physical close and replacement after ACK must never republish old origin/WCO into the new state. Verify both successful and failed old completion. Preserve ordinary fresh-WCO success and zero-offset intentional origins.

Inspected tests: `ui/state/laser-store-origin.test.ts`, `ui/laser/OriginRow.test.tsx`, `ui/workspace/position-laser-click.test.ts`, `ui/state/laser-store-motion-operation.test.ts`, relevant freshness and probe ownership tests. The existing origin suite tests write rejection, delayed/no WCO, G54/G92 handling and zero-offset intentional origins, but lacks the post-ACK session replacement case.

## 25. Job execution and recovery

**Verdict: strong explicit authorization/transaction structure, with a reproduced completion-side-effect race.** This is not a full transport or recovery certification.

Inspected chains include `JobControls`/`JobRunControls` → `use-frame-action`/`start-job-flow` → exact `framed-run` claim → review → `start-job-transmission` → `laser-job-actions`; confirmed pause/resume → transport confirmation/ownership → refill/settlement; and archived recovery → hydrated prepared output plus exact bytes → capsule claim → supervised stream.

Strengths: Frame's permit is identity-bound and one-use; model/placement/controller drift expires it irreversibly; Start atomically claims it and repeats a synchronous authorization check after the final asynchronous preparation, before stream creation. Recovery hydration re-emits prepared semantics and compares exact sealed bytes as well as a fingerprint. Capsule claims include revisions, run IDs and attempt IDs. Probe and pause/resume have explicit operation owners. Recovery persistence is designed to keep forensic limitations distinct from ability to stream. Ordinary CNC and laser policy remains Frame-first with warnings in Job Review.

**F25-1 — P2, reproduced; cross-reference feature 6: successful-stream variable advancement is armed after asynchronous archive activation and can miss completion.**

- Location: `src/ui/laser/start-job-transmission.ts:58–66`; `start-job-execution-tracking.ts:145–154`; `variable-stream-advancement.ts:8–24`.
- Trigger: variable text is set to advance after successful stream, and a short job completes/settles before asynchronous recovery activation returns.
- Evidence: `transmitPreparedStart` starts the real advancement logic only after awaiting `activateAcceptedFreshRun`. That observer reads the current streamer and listens solely for future `done → null`. The audit uses actual `transmitPreparedStart` and the actual advancement observer, with a delayed activation dependency and simulated successful terminal transition before resolving activation. The observer is armed at `streamer:null`; the advancement action is never called.
- Impact: a completed variable-text job can leave the serial/record unchanged, causing the next run to repeat it. The observer also has no run identity; the demonstrated defect is missed advancement, not a separately reproduced cross-run advancement.
- Surrounding protections: the repository already tests terminals arriving before activation, but variable advancement is an independent late subscription. `variable-stream-advancement.test.ts` tests only the pure transition classifier, not arming order.
- Scoped improvement: attach the variable side effect to an owned run before its terminal event can occur, or consume a run-specific terminal receipt after activation. Ensure exactly-once success and no advance on aborted/errored/replaced runs or unrelated project state.
- Acceptance: delayed/failed recovery persistence with a short successful job advances exactly once; cancel/error never advances; replacement runs and document changes cannot transfer this side effect. No new machine policy gate is required.

Inspected tests: `framed-run-start-claim.test.ts`, `use-frame-action.framed-run.test.ts`, `state/recovery/recovery-staging-races.test.ts`, `laser-probe-lifecycle.test.ts`, pause/resume confirmation/transition tests, `cnc-supervised-recovery-flow.test.ts`, `variable-stream-advancement.test.ts`. These contain strong ownership and terminal-race coverage, but cannot establish physical completion, tool fit or actual hardware recovery safety.

## 26. Air assist, console and controller tools

**Verdict: generally good separation and validation; one smaller error-handling defect.**

Manual air (`JogPadAirAssist` → `laser-store.ts:336–398`) uses configured M7/M8 only, keeps M9 as the explicit off path, tracks uncertain-on state before a pending write, and compensates if MPG takes ownership. Project air normalization is separately disclosed. The console and Super Console share `ConsoleCommandDeck` → `run-console-command` → `laser-console-actions` → transport; persistent writes use driver classification and confirmation. State-changing commands invalidate applicable coordinate/accessory/Frame evidence. Macros are one command, reject newline/control characters and malformed placeholders, accept only finite ordinary decimal variables, preserve command provenance, validate stored records, and synchronize both mounted console surfaces. Readouts and macro editing use labelled native controls.

**F26-1 — P3, source-confirmed: docked Copy visible loses clipboard errors without a fallback.**

- Location: `src/ui/laser/ConsolePanel.tsx:17–19`; compare `src/ui/laser/super-console/SuperConsoleDialog.tsx` `copyVisible` and `ManualCopyFallback`.
- Trigger: click Copy visible with retained rows while clipboard access is unavailable or `writeText` rejects (for example denied permission).
- Impact/evidence: optional chaining silently does nothing if the API is missing; a rejected promise is not handled. The user receives neither copied content nor a failure/fallback. Super Console already provides a selectable-text fallback for both cases. This is a source-confirmed omission; no clipboard permission state was changed during the audit.
- Scoped improvement: share the successful/error/manual-copy behavior with the Super Console and catch all clipboard promise failures.
- Acceptance: successful write shows success; unavailable/rejected clipboard presents selectable visible transcript without unhandled rejection; filters remain respected.

Inspected tests: `ConsolePanel.test.tsx`, `console/ConsoleCommandDeck.test.tsx`, `console/user-macros` template/collection/storage tests, `super-console/SuperConsoleDialog.test.tsx`, `state/laser-store-air-assist-safety.test.ts`. They cover typed macros, persisted-library failures, confirmation, preservation of newly typed drafts, MPG compensation and uncertain air-on latches.

## 27. Workspace layout, support and PWA

**Verdict: acceptable in the inspected paths; no new confirmed functional defect.**

Window commands route through `use-app-commands` → `workspace-panel-actions` → `ui-rail-panel`. Responsive defaults use matchMedia listeners with cleanup and still allow explicitly reopening rails. Icon controls have labels/pressed states. Reset layout restores both rail visibility flags; it does not reset project content. Public support links use a detached anchor with `noopener noreferrer`.

PWA update ownership is separated into `PwaUpdateWatcherGate` (web-only mount), `PwaUpdateWatcher` (readiness), `pwa-update-store`, `PwaUpdateButton`, `pwa-update-apply-owner` and `pwa-prompted-reload`. Positive details include a persistent screen-reader status region, user-click-only application, shared promise ownership against repeated clicks, retry after failure, handling of no-waiting/uncontrolled pages, statechange/fallback-timer cleanup, and web/Electron separation. Offline shell/fonts are included by configuration and checked by the precache source test. Actual offline reload/install/update continuity were not exercised by this lane.

About, Safety and connection help deliberately call `jobAwareAlert`; idle calls reach `window.alert`, while active streamer states use toasts. This source fact makes a native-dialog Browser integration issue plausible, but the earlier Browser stall does not prove a broken application button. A scoped future improvement is to render informational help in the existing nonblocking accessible Dialog component. That is a UX/automation consistency suggestion, not a confirmed diagnosis of the stall.

Inspected tests: `ui/app/use-compact-rail-defaults.test.tsx`, `ui/app/PwaUpdateWatcher.test.tsx`, `PwaUpdateWatcherGate.test.tsx`, `pwa-prompted-reload.test.ts`, `pwa-update-apply-owner.test.ts`, `ui/common/PwaUpdateButton.test.tsx`, `platform/web/pwa-precache.test.ts`, relevant command/help tests. The precache test is a configuration assertion, not an offline browser acceptance test.

## Evidence files and limits

- `audit-feature22-27.test.tsx`: audit-only reproduction source copied from the extracted snapshot.
- `audit-feature22-27-vitest.txt`: final six-case run, exit 0, 6/6 assertions of the observed defects. The extracted snapshot emits three Git metadata diagnostics before Vitest because it has no `.git` directory; these do not fail the run.
- Source-confirmed findings without dynamic reproduction: surfacing combined work and docked clipboard failure handling.
- Software-reproduced findings: shifted canvas jog wire, stale origin after physical close/reconnect (two cases), lost traversal toggle, missed variable advancement, and background Delete through the full-page CNC viewer.
- All machine-facing reproduction uses fake serial connections and simulated status/ACKs. No hardware, air-cut, material, browser layout or physical performance claims follow from those tests.
