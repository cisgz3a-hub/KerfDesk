# LaserForge Current Work Tracker And Built-Status Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development for code changes and verification-before-completion before claiming any step is complete.

**Goal:** Keep one current source of truth for what is already built, what is dirty or only partially verified, and what should start next in the 10/10 loop.

**Architecture:** Treat this file as a checkpoint ledger over the current checkout. Each workstream starts from live source audit, focused tests, browser smoke where relevant, then the audit/fix/rate loop.

**Tech Stack:** TypeScript, React, Zustand-style UI state, Vitest, Vite, Web Serial, GRBL.

---

## Audit Scope

- Date: 2026-06-25.
- Target checkout: `C:\Users\Asus\LaserForge-2.0`.
- Shell warning: sessions may start in `C:\Users\Asus\LaserForge`, but current work belongs in `LaserForge-2.0`.
- Git branch at audit time: `main...origin/main`.
- Git state at audit time: dirty working tree with trace, selected-object operation, project validator, layer panel, and workspace changes.
- Reference boundary: Rayforge may be studied for architecture and workflow only. Do not copy Rayforge code.
- Commit/push boundary: do not commit or push from this tracker unless the user explicitly asks.

## Status Labels

- `Built`: implemented in source and covered by focused tests in this audit.
- `Built-dirty`: implemented in source and covered by focused tests, but still uncommitted or part of the dirty workspace.
- `Partial`: source exists, but product quality, browser smoke, or safety evidence is not at 10/10 yet.
- `Stale-doc`: older docs describe the feature as missing, but current source shows it has since been built.
- `Next-loop`: should be handled by the next audit/fix/rate loop before broader work resumes.

## Verification Run

Focused built-status bundle run:

```powershell
pnpm test --run src/ui/layers/CutsLayersPanel.test.tsx src/ui/workspace/draw-scene-object-overrides.test.ts src/core/job/compile-job-object-overrides.test.ts src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/laser/device-setup/device-setup-flow.test.ts src/ui/workspace/measure-tool.test.ts src/ui/workspace/RegistrationJigPanel.test.tsx src/core/output/grbl-strategy-air-assist.test.ts src/ui/layers/layer-default-settings.test.ts src/ui/layers/layer-default-settings.persistence.test.ts src/core/geometry/tabs-bridges.test.ts src/core/geometry/kerf-offset.test.ts src/core/output/grbl-strategy-offset-fill.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts
```

Result: `14` test files passed, `71` tests passed.

Important artifact result:

- Arch House/Langebaan Line Art real fixture passed.
- Current Line Art metrics: `83` closed polylines, `0` open polylines, `51` hole candidates, `13889` points.
- LANGEBAAN band ink pixels: `3215`.
- LANGEBAAN band also passed with explicit Sketch Trace off override.

Closeout verification run on 2026-06-26:

```powershell
pnpm test --run src/ui/layers/CutsLayersPanel.cut-settings.test.tsx
pnpm test --run src/__fixtures__/perceptual/trace-artifacts.test.ts src/__fixtures__/perceptual/arch-house-baseline.test.ts src/core/trace/trace-transparency.test.ts src/core/trace/trace-image-sketch.test.ts src/ui/trace/trace-options.test.ts
pnpm typecheck
pnpm lint
pnpm run format:check
pnpm test
```

Result:

- Layer cut-settings focused test: `1` file passed, `7` tests passed.
- Trace focused bundle: `5` files passed, `31` tests passed.
- Typecheck passed.
- Lint passed with the existing `boundaries/dependencies` legacy selector migration warning only.
- Format check passed.
- Full suite passed: `378` test files, `2324` tests.

Edge artifact metric slice on 2026-06-26:

```powershell
pnpm test --run src/__fixtures__/perceptual/trace-artifacts.test.ts src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts
pnpm typecheck
pnpm lint
pnpm run format:check
```

Result:

- Red proof first: `measureSquareEdgeQuality` did not exist, then the square-edge artifact test failed as expected.
- Added square-edge quality metrics for coverage, duplicate parallel edge responses, and stray edge pixels.
- Edge-focused bundle passed: `3` files, `18` tests.
- Typecheck passed.
- Lint passed with the existing `boundaries/dependencies` legacy selector migration warning only.
- Format check passed.

Noisy/photo-like Edge Detection control slice on 2026-06-26:

```powershell
pnpm test --run src/__fixtures__/perceptual/trace-artifacts.test.ts src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts src/ui/trace/trace-options.test.ts
pnpm typecheck
pnpm lint
pnpm run format:check
```

Result:

- Red proof first: `NOISY_PHOTO_EDGE_FIXTURE` was missing and the new artifact test failed before harness work.
- Added a deterministic noisy/photo-like square-edge fixture.
- Added path-level square-edge quality metrics for boundary coverage and stray vector points.
- Proved restrained Edge Detection settings reduce texture/noise vector points while preserving the intended boundary.
- Focused edge/options bundle passed: `4` files, `36` tests.
- Typecheck passed.
- Lint passed with the existing `boundaries/dependencies` legacy selector migration warning only.
- Format check passed.

Trace benchmark loop slice on 2026-06-26:

```powershell
pnpm test --run src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts src/ui/trace/trace-options.test.ts
pnpm typecheck
pnpm run format:check
```

Result:

- Red proof first: `trace-benchmark-loop.test.ts` failed because `trace-benchmark-loop.ts` did not exist.
- Added a pure benchmark loop that runs current trace benchmarks, audits against a target rating, produces findings, and generates a concrete fix prompt when below goal.
- Added a repeat loop API: run benchmark -> audit -> generate prompt -> optional fix applicator -> rerun until pass or max iterations.
- Current benchmark cases:
  - `edge-square-canny-quality`
  - `edge-noisy-photo-controls`
- Current benchmark result: `10/10`; no fix prompt generated for the current checkout.
- Focused benchmark/artifact/options bundle passed: `5` files, `41` tests.
- Typecheck passed.
- Format check passed.
- Self-audit finding fixed: the noisy-photo stray-point target is documented as `<= target`, so the benchmark now treats the exact target as passing and has a boundary test for that contract.

## Browser Smoke Started

Smoke date: 2026-06-25.

Fresh reload result:

- Local app: `http://127.0.0.1:5173/`.
- App mounted successfully after reload.
- Old Vite HMR errors about `analyzeTextFontSupport` did not recur after reload and are treated as stale console history unless reproduced fresh.

Initial live UI checks:

| Path | Result | Notes |
|---|---:|---|
| `Set up device` | Pass | Button visible/enabled. Opens Device Setup step 1 of 6 with Connect, Cancel, Back, and Next controls. |
| `Machine Setup` | Pass | Button visible/enabled. Full Machine Setup flow still needs deeper tab audit. |
| `Registration Jig` | Pass | Button visible/enabled. Panel opens and exposes `aria-label="Move registration jig panel"`. |
| `Import Image...` | Pass | Button visible/enabled. Import dialog path still needs fixture smoke. |
| `Trace Image...` on empty project | Pass | Disabled, expected because no image/selection exists. |
| `Preview` on empty project | Pass | Disabled, expected because there is no output geometry. |

Smoke still pending:

- Trace Image fixture flow through the native file picker remains not automatable in the current in-app browser surface. Keep using the real Arch House artifact tests as trace proof unless a file-chooser-capable browser harness is added.

Additional smoke date: 2026-06-26.

| Path | Result | Notes |
|---|---:|---|
| Desktop workspace viewport | Pass | Temporary `1600 x 950` viewport used because the default in-app browser viewport collapsed the canvas to `0px` width. Viewport reset after smoke. |
| Two-object selected operation edit | Pass | Drew one rectangle, duplicated it to two objects, changed only the selected object to `Fill`, selected the other object, and confirmed it remained `Line`. |
| Measure tool drag/readout | Pass | Measure drag produced a live distance/angle readout, including `121.23 mm` and `33.7 deg`; `Esc` returned to selection mode. |
| Registration Jig drag | Pass | Panel exposes `Move registration jig panel`, moves vertically, moves left horizontally, and retains position after close/reopen. Dragging further right from the right clamp correctly does not change X. |
| Cut Settings advanced dialog | Pass | Advanced dialog opens from `Edit...`; Line mode shows Air, Kerf Offset, Tabs / Bridges, and default actions. Fill mode shows Offset Fill, scan angle, line interval/LPI, overscan, bidirectional, cross-hatch, and default actions. |
| Fresh console errors | Pass | No fresh browser console errors after reload and smoke. |

## Built-Status Matrix

| Workstream | Current source truth | Status | Evidence | Next 10/10 action |
|---|---|---:|---|---|
| Selected-object operation settings | Same-layer objects can now carry selected-object operation overrides, so editing one selected image does not force all same-color images to change. | Built-dirty | `src/ui/layers/SelectedObjectOperationSettings.tsx`, `src/core/scene/scene-object.ts`, `src/core/job/compile-job-object-overrides.test.ts`, `src/ui/workspace/draw-scene-object-overrides.test.ts`, `src/ui/layers/CutsLayersPanel.test.tsx` | Browser smoke again after any layer-panel edits. Keep this as protected behavior. |
| Device Setup wizard | Device setup files and tests exist; old notes saying the wizard is pending are stale. | Built | `src/ui/laser/device-setup/`, `src/ui/laser/LaserWindow.tsx`, `DeviceSetupWizard.test.tsx`, `device-setup-flow.test.ts` | Audit the browser flow and detected-settings toast before declaring release-ready. |
| Measure tool V1 | Measure tool source, drawing overlay, command wiring, and tests exist. | Built | `src/ui/workspace/measure-tool.ts`, `src/ui/workspace/draw-measurement.ts`, `src/ui/workspace/measure-tool.test.ts` | Browser smoke ruler interaction on local app. |
| Registration Jig movable panel | Panel is now a movable non-modal workspace panel. | Built | `src/ui/workspace/RegistrationJigPanel.tsx`, `src/ui/state/ui-store.ts`, `src/ui/workspace/RegistrationJigPanel.test.tsx` | Browser smoke move handle and persistence. Hardware jig workflow remains separate. |
| Logo Line Art trace | The real Arch House/Langebaan source fixture now passes the Line Art acceptance gate. | Built-dirty | `src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png`, `src/__fixtures__/perceptual/arch-house-baseline.test.ts`, `audit/reports/trace-quality-loop-baseline-2026-06-25.md` | Preserve this baseline before changing trace modes again. |
| Trace alpha / Sketch Trace mode distinction | Line Art, Trace Alpha Mask, and Sketch Trace can intentionally look identical on opaque black-on-white logos, but now have artifact fixtures proving they diverge on sources where their semantics should differ. | Built-dirty | `src/__fixtures__/perceptual/trace-fixtures.ts`, `src/__fixtures__/perceptual/trace-artifacts.test.ts`, `src/ui/trace/TraceSettingsControls.tsx`, `src/ui/trace/trace-options.ts`, `src/ui/trace/use-trace-preview.ts` | Keep the fixtures as protected proof. UX label/help polish can continue separately, without changing the Line Art baseline. |
| Centerline and Edge Detection quality | Separate clean-room centerline and edge engines exist, but research says they are not 10/10 yet. | Next-loop | `docs/research/trace-quality-centerline-edge-detection-2026-06-25.md`, `src/core/trace/centerline-*`, `src/core/trace/edge-trace.ts` | Start with artifact harness expansion, then edge controls, then centerline pruning/gap repair. |
| Trace preview controls | Fade Image, Show Points, Clear Boundary, boundary selection, and trace preview plumbing exist in dirty source. | Partial | `src/ui/trace/TracePreview.tsx`, `src/ui/trace/TraceSettingsControls.tsx`, `src/ui/trace/use-trace-preview.ts` | Browser smoke preview vs committed geometry. |
| Air assist | Device profile, layer setting, compile-job propagation, GRBL M7/M8/M9 emission, UI, and tests exist. | Built | `src/core/devices/device-profile.ts`, `src/core/scene/layer.ts`, `src/core/output/grbl-strategy-air-assist.test.ts`, `src/ui/laser/DeviceProfilePowerFields.tsx` | Keep hardware claims separate until tested on a real controller. |
| Default layer settings | Make Default, Reset to Default, Make Default for All, and persistence exist. | Built | `src/ui/layers/layer-default-settings.ts`, `src/ui/layers/CutSettingsDefaultActions.tsx`, `src/ui/layers/layer-default-settings.persistence.test.ts` | Browser smoke the default actions if the layer UI changes. |
| Lane 6 advanced cut settings | Offset Fill, Sub-layers, Kerf, Tabs/Bridges, and related compile/output/preflight pieces exist. Older Lane 6 gap text is stale. | Built-dirty | `src/core/scene/layer.ts`, `src/core/job/compile-job.ts`, `src/core/geometry/tabs-bridges.ts`, `src/core/geometry/kerf-offset.ts`, `src/core/output/grbl-strategy-offset-fill.test.ts` | Audit the full cut-settings UX and emitted G-code artifacts before calling Lane 6 complete. |
| Raster calibration and scan offsets | Core ADR-052 scan-offset work exists from prior loops, but no default 4040 offsets should ship without calibration. | Partial | Device profile and scan-offset tests should be rechecked before new raster work. | Run targeted scan-offset/raster/fill output tests before modifying raster emission. |
| Machine/controller lifecycle | Post-job settle, Home/recovery, and command lifecycle work has been built in previous loops, but hardware smoke is intentionally skipped unless requested. | Partial | Controller/store tests and browser UI should be rechecked before live-machine claims. | Software smoke only unless user explicitly allows hardware smoke. |
| Release and Cloudflare | Prior deploys exist, but the current dirty checkout is not a release candidate. | Partial | Current local dirty state. | Do not push/deploy until the dirty tracker items are verified, committed, and user asks. |

## Stale Or Drift-Prone Docs

These documents are still useful for strategy, but their missing-feature lists must be checked against source before acting:

- `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`
  - Lane 6 still describes many features as upcoming, but Offset Fill, Sub-layers, Default Layer Settings, Kerf, Tabs, and Air Assist now exist in source.
  - Lane 9 still helps with workspace-productivity strategy, but Measure Tool and movable Registration Jig are already built.
- `DECISIONS.md`
  - Some ADR implementation notes may lag current source, especially Device Setup wizard status.
- `docs/research/trace-quality-centerline-edge-detection-2026-06-25.md`
  - Treat this as current for Centerline and Edge quality gaps, not as evidence that Logo Line Art is still failing.

## Immediate Start Queue

### Step A - Freeze The Current Built-State Checkpoint

Goal: preserve the current dirty work without losing which pieces are already built.

Required checks:

- Keep this tracker updated if later audits change a status.
- Re-run the focused built-status test bundle after any edits touching trace, layers, machine setup, or workspace tools.
- Do not start a broad refactor before the dirty source is either committed or intentionally split into smaller work.

Rating gate:

- `10/10` only when the focused bundle passes, browser smoke confirms the active UI slices, and the diff audit has no accepted findings.

### Step B - Browser Smoke Current UI

Goal: prove the active built UI behaves like the source/tests say it should.

Smoke paths:

1. Select two same-layer traced logos, edit only one selected object's operation, confirm the other does not change.
2. Open Device Setup and confirm the setup wizard/toast flow is reachable without blocking normal Laser controls.
3. Use Measure tool, verify readout and exit behavior.
4. Move the Registration Jig panel, close/reopen if available, verify it no longer blocks canvas work.
5. Import/trace Arch House source with Line Art, then compare Edge Detection and Centerline mode behavior without regressing Line Art.
6. Open Cut Settings and verify Offset Fill, Sub-layers, Kerf, Tabs, Air Assist, and Default actions remain usable.

Rating gate:

- Any broken smoke path caps the checkpoint at `8/10` until fixed.

### Step C - Next Real Work: Trace Mode Clarity And Artifact Harness

Goal: continue the trace-quality loop without damaging the now-good Logo Line Art baseline.

Start order:

1. Protect Line Art baseline with the existing real fixture.
2. Add transparent alpha fixture and sketch-specific fixture so Alpha Mask and Sketch Trace are tested on images where they should differ from normal Line Art.
3. Expand artifact output for Centerline and Edge Detection.
4. Add Edge Detection sensitivity/detail plumbing only after the harness can prove better vs merely different.

Rating gate:

- Missing artifact proof caps at `9/10`.
- Any Line Art regression caps at `6/10`.

Progress on 2026-06-26:

- Added a transparent-alpha fixture where normal Line Art sees the full black RGB canvas but Trace Alpha Mask isolates the opaque rectangle.
- Added a sketch-contrast fixture where normal Line Art traces a dark background but Sketch Trace isolates darker local-contrast strokes.
- Added artifact tests proving both modes differ from normal Line Art on the right kind of source.
- Added square-edge quality metrics that catch duplicate parallel edge responses while ignoring legitimate corner intersections.
- Added a noisy/photo-like edge fixture proving Edge Detection Sensitivity, Detail, and Minimum line can reduce texture paths without losing the intended boundary.
- Added a repeatable trace benchmark loop: if future trace changes fail the benchmark, the harness emits a fix prompt and reruns after a fix until the goal rating is reached.
- Preserved the real Arch House/Langebaan Line Art baseline: `83` closed polylines, `0` open polylines, `3215` LANGEBAAN band ink pixels.
- Browser file import through the native picker is still not automatable in the current in-app browser surface, so the real fixture artifact tests remain the acceptance evidence for trace imports.
- Added Trace Image UI guardrails that label Edge Detection as `Edge Detection (edge contours)`, warn that Line mode will outline detected edges, and point one-stroke users to Centerline.

Rating: `10/10` for the automated trace-mode artifact harness slice. The broader Centerline/Edge Detection quality loop is still next.

### Step D - Edge Detection Metric Gate

Goal: make Edge Detection harder to fool before changing the edge algorithm again.

Completed on 2026-06-26:

- `src/__fixtures__/perceptual/edge-truth.ts` now measures edge coverage, duplicate parallel responses, and stray edge pixels against a square truth fixture.
- `src/__fixtures__/perceptual/trace-artifacts.test.ts` now proves the harness catches a deliberately doubled edge response.
- The production edge tracer was not changed in this slice.

Rating: `10/10` for the edge metric-gate slice.

Next likely slice:

1. Add a browser smoke for Edge Detection controls in the Trace Image dialog if a file-picker-capable harness is available.
2. Start the larger edge-specific linker work only with this artifact harness active.
3. Keep Line Art and Centerline artifact gates in the focused bundle whenever edge tracing changes.

### Step E - Trace Benchmark Loop

Goal: make every trace-quality step compete against explicit benchmark thresholds and produce a fix prompt when it misses.

Completed on 2026-06-26:

- `src/__fixtures__/perceptual/trace-benchmark-loop.ts` defines benchmark results, audit findings, rating caps, fix-prompt generation, and a repeat loop.
- `src/__fixtures__/perceptual/trace-benchmark-regression-cases.ts` now carries the Centerline landed regression gate and the real Arch House/Langebaan Line Art baseline gate.
- `src/__fixtures__/perceptual/trace-benchmark-loop.test.ts` proves:
  - current Edge Detection, Centerline, and Arch House Line Art benchmarks reach `10/10`;
  - Centerline and real-logo Line Art cannot silently fall out of the loop;
  - failed benchmarks generate a concrete fix prompt;
  - inclusive benchmark targets pass at the exact advertised boundary;
  - the loop reruns audit/fix iterations until the benchmark passes;
  - without a fix applicator, the loop stops with the next prompt instead of pretending completion.

Use this command as the trace benchmark loop gate:

```powershell
pnpm test --run src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts src/ui/trace/trace-options.test.ts src/ui/trace/ImportImageDialog.test.ts
```

Rating: `10/10` for the trace benchmark-loop harness slice.

Next likely slice:

1. Continue edge-specific linker work under this loop with real-logo/browser evidence where available.
2. Add Centerline v2 distance-aware pruning/gap-repair benchmarks before changing the centerline algorithm.
3. Keep Line Art and Arch House acceptance gates in the focused bundle whenever trace modes change.

### Step F - Edge Detection Curve Linking

Goal: repair the broken/dotted curved-stroke failure mode in Edge Detection without making Line Art, Centerline, or noisy-photo edge controls regress.

Completed on 2026-06-27:

- Added a segmented curved-stroke fixture that reproduces the small-gap curve/linker failure as a measurable artifact.
- Proved the failure first: Edge Detection emitted `6` stroke fragments where the target was `<= 4`.
- Added a bounded directional gap bridge before the contour pass in `src/core/trace/edge-trace.ts`.
- Added `edge-segmented-curve-linking` to the trace benchmark loop, so the curve-linking case cannot silently drop out of future 10/10 trace audits.
- Self-audit fix: removed an initial endpoint-pairing attempt because it was O(n^2) in endpoint count and unnecessary after the directional bridge passed the proof.

Verification:

```powershell
pnpm test --run src/__fixtures__/perceptual/edge-curve-quality.test.ts src/core/trace/edge-trace.test.ts src/__fixtures__/perceptual/trace-benchmark-loop.test.ts
pnpm test --run src/__fixtures__/perceptual src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts
pnpm run typecheck
pnpm run format:check
pnpm lint
pnpm test
```

Result:

- Focused curve/benchmark bundle passed: `3` files, `16` tests.
- Broad perceptual trace bundle passed: `13` files, `76` tests.
- Typecheck passed.
- Format check passed.
- Lint passed with the existing `boundaries/dependencies` legacy selector migration warning only.
- Full suite passed: `386` test files, `2369` tests.

Rating: `10/10` for the synthetic curved-stroke Edge Detection linker slice.

Next likely slice:

1. Continue real-logo Edge Detection artifact metrics for other curve/corner regions if stable thresholds can be defined.
2. Add browser smoke for Edge Detection controls if a file-picker-capable harness is available.
3. Start Centerline v2 distance-aware pruning/gap-repair only after the edge benchmark remains green.

### Step G - Real Logo Edge Detection Cleanup

Goal: make the Arch House Edge Detection proof measure the actual top-arch dotted-curve failure, not just synthetic circles or total point counts.

Completed on 2026-06-27:

- Added a real-logo top-arch continuity metric over the Arch House fixture.
- Proved the failure first:
  - Before cleanup, Edge Detection emitted `23` arch-region polylines, `7` short arch fragments, and `12` tiny closed polylines.
  - The aggregate arch coverage was already complete, which showed the issue was dotted debris/over-fragmentation, not missing source edge data.
- Raised the Edge Detection preset minimum edge length from `3 px` to `8 px`.
- After cleanup, Arch House Edge Detection emitted `16` arch-region polylines, `2` short arch fragments, `0` tiny closed polylines, and full aggregate arch coverage.
- Added `arch-house-edge-curve-cleanup` to the trace benchmark loop beside square Canny, noisy-photo controls, segmented curve linking, Centerline, and Line Art.

Verification:

```powershell
pnpm test --run src/__fixtures__/perceptual/trace-benchmark-loop.test.ts src/__fixtures__/perceptual/arch-house-edge-quality.test.ts src/__fixtures__/perceptual/edge-curve-quality.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts src/core/trace/edge-trace.test.ts src/ui/trace/ImportImageDialog.test.ts
pnpm test --run src/__fixtures__/perceptual src/core/trace/edge-trace.test.ts src/core/trace/canny-edges.test.ts src/ui/trace/ImportImageDialog.test.ts
pnpm run typecheck
pnpm run format:check
pnpm lint
pnpm test
```

Result:

- Focused edge/benchmark bundle passed: `6` files, `45` tests.
- Broad perceptual trace bundle passed: `14` files, `94` tests.
- Typecheck passed.
- Format check passed.
- Lint passed with the existing `boundaries/dependencies` legacy selector migration warning only.
- Full suite passed: `386` test files, `2370` tests.

Rating: `10/10` for the real-logo Edge Detection top-arch cleanup slice.

Next likely slice:

1. Add browser smoke for Edge Detection controls if a file-picker-capable harness is available.
2. Add real-logo region metrics for the roof/window corners only if stable, non-false-positive thresholds can be defined.
3. Start Centerline v2 distance-aware pruning/gap-repair benchmarks before changing Centerline again.

## Do Not Forget

- `Line Art` is the correct mode for filled logo geometry.
- `Edge Detection` should remain a different look from Line Art; it is for edges/transitions and still needs quality work.
- `Centerline` is a separate later quality target for true single-stroke paths.
- Rayforge is a reference for architecture and workflow only.
- No hardware smoke unless the user explicitly approves it.
- No commit or push from this checkpoint unless the user explicitly asks.
