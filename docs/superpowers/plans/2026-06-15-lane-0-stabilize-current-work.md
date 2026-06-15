# Lane 0 Stabilize Current Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current dirty LaserForge-2.0 worktree into a verified green checkpoint before starting new LightBurn parity features.

**Architecture:** Lane 0 does not add a new product feature. It audits and stabilizes the current WIP around multi-object transforms, align/distribute commands, shortcut routing, preview gating, and deletion cleanup, then commits only after code, docs, tests, build, and browser smoke checks agree.

**Tech Stack:** TypeScript, React 18, Zustand, Vite, Vitest, ESLint, Prettier, LightBurn workflow research, WebSerial-safe GRBL pipeline.

---

## Research Summary

### LightBurn Workflow References

1. LightBurn Preview is the operator's pre-run truth: the Preview window is an
   accurate representation of what LightBurn sends to the laser, and users are
   expected to check it before starting jobs:
   <https://docs.lightburnsoftware.com/2.1/Reference/Preview/>
2. LightBurn Laser Window is the job-control hub for setup, framing, starting,
   job positioning, and related controls:
   <https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/>
3. LightBurn Coordinates and Job Origin explains that output placement is based
   on the bounding box of graphics being sent, especially for Current Position
   and User Origin:
   <https://docs.lightburnsoftware.com/2.1/Reference/CoordinatesOrigin/>
4. LightBurn Cut Selected Graphics and Use Selection Origin change the output
   set and job-origin calculation, so selection behavior must be reliable before
   LaserForge adds selected-output features:
   <https://docs.lightburnsoftware.com/2.1/Reference/CutSelectedGraphics/>
5. LightBurn Optimization Settings says users verify path-order changes through
   Preview, so preview gating must be conservative and honest:
   <https://docs.lightburnsoftware.com/2.1/Reference/OptimizationSettings/>
6. LightBurn Console and Machine Settings show why later lanes need a controller
   evidence surface, but Lane 0 only protects existing GRBL safety paths:
   <https://docs.lightburnsoftware.com/2.1/Reference/ConsoleWindow/>
   <https://docs.lightburnsoftware.com/2.1/Reference/MachineSettings/>

### Local LaserForge Research

1. `PROJECT.md` says LaserForge is a focused LightBurn-style CAM app for GRBL
   machines and explicitly does not clone all LightBurn feature breadth.
2. `PROJECT.md` non-negotiables still apply: bounds checks, origin honesty,
   laser-off travel, deterministic G-code, pure core, module boundaries, and
   file-size discipline.
3. `WORKFLOW.md` defines existing user flows for selection, transform, preview,
   save G-code, shortcuts, job control, and raster/bitmap workflows.
4. `DECISIONS.md` ADR-051 scopes drawing tools and keeps the larger geometry
   kernel out of scope until a later phase.
5. Current dirty worktree scope is:
   - align/distribute core helpers;
   - multi-object nudge and flip helpers;
   - batch deletion action extraction;
   - command registry additions;
   - shortcut routing changes;
   - previewable-content helper extraction;
   - bug-hunt audit artifacts;
   - LightBurn feature gap and roadmap docs.

### Baseline Already Observed During Planning

These commands were run before writing this plan:

```powershell
corepack pnpm test --run src/core/scene/selection-align.test.ts src/core/scene/selection-distribute.test.ts src/ui/state/selection-transform-actions.test.ts src/ui/state/store.test.ts src/ui/app/shortcuts.test.ts src/ui/app/shortcuts-docs.test.ts src/ui/commands/command-registry.test.ts src/ui/commands/previewable-content.test.ts
corepack pnpm typecheck
corepack pnpm format:check
corepack pnpm lint
corepack pnpm test
corepack pnpm build:web
```

Observed result:

- Focused WIP tests passed: 8 files, 91 tests.
- Typecheck passed.
- Prettier check passed.
- ESLint passed with the existing boundaries-plugin legacy selector warning.
- Full Vitest suite passed: 222 files, 1559 tests.
- Web build passed with the existing chunk-size warning.

Lane 0 still requires browser smoke and final commit discipline before it is
called complete.

## Lane 0 Workflow Contract

Lane 0 is complete only when all of these are true:

1. The active repo is confirmed as `C:\Users\Asus\LaserForge-2.0`.
2. No artifact exists only in the old `C:\Users\Asus\LaserForge` tree.
3. Dirty files are understood and intentionally grouped.
4. All focused WIP tests pass.
5. Full typecheck, lint, format, test, and build pass.
6. Browser smoke confirms the visible app still opens.
7. Browser smoke confirms basic selection/shape/transform/preview behavior.
8. No production code change is made merely to satisfy Lane 0 unless a verified
   bug is found during the audit.
9. Commit boundaries are clean: docs/audit artifacts can be committed separately
   from source changes if needed.
10. The final checkpoint can be pushed only after the user approves execution.

## Current Dirty Worktree Map

### Source WIP

- `src/core/scene/index.ts` - exports align/distribute and selection transform
  helpers.
- `src/core/scene/selection-transform.ts` - adds multi-selection nudge and
  center-preserving flip behavior.
- `src/core/scene/selection-align.ts` - new pure align helper.
- `src/core/scene/selection-distribute.ts` - new pure distribute helper.
- `src/ui/state/selection-transform-actions.ts` - routes align, distribute,
  nudge, and flip through store actions.
- `src/ui/state/object-delete-actions.ts` - extracts single and batch delete.
- `src/ui/state/store.ts` - composes new store slices.
- `src/ui/commands/command-types.ts` - adds align/distribute command ids and
  context callbacks.
- `src/ui/commands/command-families.ts` - exposes Arrange menu align/distribute
  commands.
- `src/ui/commands/use-app-commands.ts` - wires command context to store actions
  and previewable-content helper.
- `src/ui/commands/previewable-content.ts` - makes Preview gating depend on
  actual output geometry.
- `src/ui/app/shortcuts.ts` - routes delete, arrow nudge, and flip through batch
  selection-aware store actions.
- `src/ui/app/use-shortcuts.ts` - injects the new shortcut dependencies.
- `WORKFLOW.md` - documents `Ctrl+Shift+E` as Save G-code and `Ctrl+E` as
  Ellipse.
- `vite.config.ts` - keeps dev dependency pre-bundling aligned with the
  production `es2022` target after Lane 0 browser smoke exposed a Vite optimizer
  target mismatch.

### Test WIP

- `src/core/scene/selection-align.test.ts`
- `src/core/scene/selection-distribute.test.ts`
- `src/ui/state/selection-transform-actions.test.ts`
- `src/ui/state/store.test.ts`
- `src/ui/app/shortcuts.test.ts`
- `src/ui/app/shortcuts-docs.test.ts`
- `src/ui/commands/command-registry.test.ts`
- `src/ui/commands/previewable-content.test.ts`

### Audit and Planning Artifacts

- `audit/prompts/karpathy-laser-bug-hunt-audit-2026-06-15.md`
- `audit/findings/karpathy-laser-bug-hunt-findings-2026-06-15.json`
- `audit/reports/karpathy-laser-bug-hunt-audit-2026-06-15.md`
- `audit/reports/lightburn-feature-gap-list-2026-06-15.md`
- `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`
- `docs/superpowers/plans/2026-06-15-lane-0-stabilize-current-work.md`

## Risks to Audit Before Commit

1. Multi-object flip must preserve the group center. The user explicitly found
   resize/rotation/flip issues earlier, so this is high-risk UX math.
2. Multi-object nudge must move all selected objects, not only the primary.
3. Batch delete must create one undo step, not one undo entry per object.
4. Preview button must not enable for trace-source backing images or
   output-disabled layers.
5. Arrange menu commands must be disabled honestly when fewer than the required
   number of objects are selected.
6. Shortcut changes must not reintroduce browser reload/address-bar collisions
   in the app workflow.
7. Documentation must match actual shortcuts.
8. Full output invariants must remain green even though current WIP is mostly UI
   and scene-state code.
9. Local dev smoke must use the same effective JavaScript target as production
   builds; otherwise browser-only verification can fail even when
   `build:web` succeeds.

## Implementation Tasks

### Task 1: Confirm Repo Boundary and Worktree Scope

**Files:**

- Read: `C:\Users\Asus\LaserForge-2.0\git status`
- Read: `C:\Users\Asus\LaserForge-2.0\docs\LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`
- Read: `C:\Users\Asus\LaserForge-2.0\audit\reports\lightburn-feature-gap-list-2026-06-15.md`

- [ ] **Step 1: Confirm current checkout**

Run:

```powershell
Get-Location
git status --short --branch
```

Expected:

```text
C:\Users\Asus\LaserForge-2.0
## main...origin/main
```

- [ ] **Step 2: Check that Lane 0 planning artifacts are not stranded in old repo**

Run:

```powershell
Test-Path C:\Users\Asus\LaserForge-2.0\docs\LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md
Test-Path C:\Users\Asus\LaserForge-2.0\audit\reports\lightburn-feature-gap-list-2026-06-15.md
Test-Path C:\Users\Asus\LaserForge\docs\LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md
Test-Path C:\Users\Asus\LaserForge\audit\reports\lightburn-feature-gap-list-2026-06-15.md
```

Expected:

```text
True
True
False
False
```

- [ ] **Step 3: Capture current dirty scope**

Run:

```powershell
git diff --stat
git diff --name-only
git status --short
```

Expected:

- Source WIP matches the files listed in "Current Dirty Worktree Map".
- No unrelated generated `dist/`, `node_modules`, or Cloudflare output appears.

### Task 2: Audit Multi-Selection Transform Semantics

**Files:**

- Read: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-transform.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-align.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-distribute.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-transform.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-align.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\core\scene\selection-distribute.test.ts`

- [ ] **Step 1: Run pure scene transform tests**

Run:

```powershell
corepack pnpm test --run src/core/scene/selection-transform.test.ts src/core/scene/selection-align.test.ts src/core/scene/selection-distribute.test.ts
```

Expected:

```text
Test Files 3 passed
```

- [ ] **Step 2: Review group flip math**

Inspect:

```powershell
git diff -- src/core/scene/selection-transform.ts
```

Accept only if:

- `buildSelectionFlipEdit` uses combined selected bounding box center.
- Each selected object's visual center is mirrored around that group center.
- The function toggles `mirrorX` or `mirrorY`.
- The transform translation is adjusted so the object stays in the mirrored
  visual location.

- [ ] **Step 3: Review align and distribute policy**

Inspect:

```powershell
Get-Content src/core/scene/selection-align.ts
Get-Content src/core/scene/selection-distribute.ts
```

Accept only if:

- Align requires at least two objects.
- Align uses the last selected object as reference at the store layer.
- Align leaves the reference object fixed.
- Distribute requires at least three objects.
- Distribute uses transformed bounding boxes.
- Distribute keeps the first and last sorted objects fixed.

### Task 3: Audit Store Actions and Undo Semantics

**Files:**

- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\state\selection-transform-actions.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\state\object-delete-actions.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\state\store.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\state\selection-transform-actions.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\state\store.test.ts`

- [ ] **Step 1: Run store-focused tests**

Run:

```powershell
corepack pnpm test --run src/ui/state/selection-transform-actions.test.ts src/ui/state/store.test.ts
```

Expected:

```text
Test Files 2 passed
```

- [ ] **Step 2: Verify batch delete creates a single undo entry**

Inspect:

```powershell
Get-Content src/ui/state/object-delete-actions.ts
Select-String -Path src/ui/state/store.test.ts -Pattern "removeSceneObjects|undo"
```

Accept only if:

- `removeSceneObjects` deduplicates ids.
- It removes all requested objects in one state mutation.
- It calls `pushUndo` once with the pre-delete project.
- It clears deleted ids from primary and additional selection.
- It prunes orphan layers once after deletion.

- [ ] **Step 3: Verify multi-selection action routing**

Inspect:

```powershell
Get-Content src/ui/state/selection-transform-actions.ts
```

Accept only if:

- `alignSelection` builds selected ids from primary plus extras.
- `alignSelection` uses the last selected id as reference.
- `distributeSelection`, `nudgeSelection`, and `flipSelection` all apply to all
  selected objects.
- Empty or invalid selections are no-ops, not crashes.

### Task 4: Audit Commands, Menus, and Shortcuts

**Files:**

- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\command-types.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\command-families.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\use-app-commands.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\app\shortcuts.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\app\use-shortcuts.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\WORKFLOW.md`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\command-registry.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\app\shortcuts.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\app\shortcuts-docs.test.ts`

- [ ] **Step 1: Run command and shortcut tests**

Run:

```powershell
corepack pnpm test --run src/ui/commands/command-registry.test.ts src/ui/app/shortcuts.test.ts src/ui/app/shortcuts-docs.test.ts
```

Expected:

```text
Test Files 3 passed
```

- [ ] **Step 2: Verify command enablement rules**

Inspect:

```powershell
Get-Content src/ui/commands/command-families.ts
```

Accept only if:

- Align commands require at least two selected objects.
- Distribute commands require at least three selected objects.
- Flip commands require a transformable selection.
- Disabled commands have useful disabled reasons.

- [ ] **Step 3: Verify shortcut docs match code**

Inspect:

```powershell
Select-String -Path WORKFLOW.md -Pattern "Ctrl\\+Shift\\+E|Ctrl\\+E|Ellipse|Save G-code"
Get-Content src/ui/app/shortcuts.ts
```

Accept only if:

- Save G-code is `Ctrl/Cmd+Shift+E`.
- Ellipse is `Ctrl/Cmd+E`.
- Delete/Backspace routes to `removeSceneObjects`.
- Arrow keys route to `nudgeSelection`.
- `H` and `V` route to `flipSelection`.
- Modal gates still block global shortcuts while a modal is open.

### Task 5: Audit Preview Gating Against LightBurn Preview Truth

**Files:**

- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\previewable-content.ts`
- Read: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\use-app-commands.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\previewable-content.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src\ui\commands\command-registry.test.ts`

- [ ] **Step 1: Run preview gating tests**

Run:

```powershell
corepack pnpm test --run src/ui/commands/previewable-content.test.ts src/ui/commands/command-registry.test.ts
```

Expected:

```text
Test Files 2 passed
```

- [ ] **Step 2: Verify previewable-content semantics**

Inspect:

```powershell
Get-Content src/ui/commands/previewable-content.ts
```

Accept only if:

- Preview is false for output layers with no matching output geometry.
- Preview is true for vector geometry on output-enabled line/fill layers.
- Preview is true for raster geometry on output-enabled image layers.
- Trace-source backing images do not make Preview available.
- Vector geometry on an image-mode layer does not make Preview available.

Reason:

- LightBurn Preview is expected to represent actual sent output. Enabling preview
  when no output would be sent teaches the user the wrong mental model.

### Task 6: Audit Machine-Safety Invariants

**Files:**

- Test: `C:\Users\Asus\LaserForge-2.0\src/core/output/grbl-strategy.property.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src/io/gcode/emit-gcode.snapshot.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src/core/preflight/preflight.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src/core/preflight/pre-emit.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src/ui/laser/start-job-readiness.test.ts`
- Test: `C:\Users\Asus\LaserForge-2.0\src/ui/laser/JobControls.test.tsx`

- [ ] **Step 1: Run output and safety-focused tests**

Run:

```powershell
corepack pnpm test --run src/core/output/grbl-strategy.property.test.ts src/io/gcode/emit-gcode.snapshot.test.ts src/core/preflight/preflight.test.ts src/core/preflight/pre-emit.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx
```

Expected:

```text
Test Files 6 passed
```

- [ ] **Step 2: Reject any safety drift**

Accept only if:

- G-code snapshots are unchanged unless intentionally reviewed.
- Laser-off travel properties pass.
- Bounds preflight still blocks out-of-bed output.
- Start readiness still blocks unsafe start states.
- Job controls remain available/recoverable as previously designed.

### Task 7: Run Full Repository Gates

**Files:**

- All source, tests, and docs.

- [ ] **Step 1: Typecheck**

Run:

```powershell
corepack pnpm typecheck
```

Expected:

```text
$ tsc --noEmit
```

- [ ] **Step 2: Lint**

Run:

```powershell
corepack pnpm lint
```

Expected:

```text
$ eslint .
```

The existing boundaries-plugin legacy selector warning is acceptable. New lint
errors are not acceptable.

- [ ] **Step 3: Format check**

Run:

```powershell
corepack pnpm format:check
```

Expected:

```text
All matched files use Prettier code style!
```

- [ ] **Step 4: Full tests**

Run:

```powershell
corepack pnpm test
```

Expected:

```text
Test Files 222 passed
Tests 1559 passed
```

If the exact counts change because new tests are added during execution, the
acceptable result is all test files and tests passing.

- [ ] **Step 5: Web build**

Run:

```powershell
corepack pnpm build:web
```

Expected:

```text
vite build
built
```

The existing chunk-size warning is acceptable. Build failure is not acceptable.

### Task 8: Browser Smoke the Checkpoint

**Files:**

- Run app from `C:\Users\Asus\LaserForge-2.0`.
- Use the in-app browser at a local Vite URL.
- Patch if needed: `C:\Users\Asus\LaserForge-2.0\vite.config.ts`

- [ ] **Step 1: Start the local dev server**

Run:

```powershell
corepack pnpm dev:web -- --host 127.0.0.1
```

Expected:

- Vite starts on an available local port such as `http://127.0.0.1:5176/`.

If Vite exits during dependency optimization with an esbuild target mismatch,
patch `optimizeDeps.esbuildOptions.target` to match the production build target
and restart verification from the full gates. This is a verified Lane 0 blocker,
not cosmetic config churn.

- [ ] **Step 2: Open the app in the in-app browser**

Open:

```text
http://127.0.0.1:<vite-port>/?lane0-smoke=<timestamp>
```

Expected:

- App renders.
- Light UI renders.
- Workspace, tool strip, menu bar, layers/device panels, and laser panel render.

- [ ] **Step 3: Smoke drawing and selection**

Manual browser actions:

1. Draw a rectangle.
2. Draw an ellipse.
3. Select both objects.
4. Use Arrange menu Align Center X.
5. Use Arrange menu Distribute only after three objects exist.
6. Press arrow keys and verify selected objects move together.
7. Press `H`, then `V`, and verify group-centered flip behavior.

Expected:

- No crash.
- Selection remains coherent.
- Objects do not jump unexpectedly.
- Flip operates in place around selection center.

- [ ] **Step 4: Smoke preview gating**

Manual browser actions:

1. Ensure at least one output-enabled vector object exists.
2. Toggle Preview.
3. Disable Output on its layer.
4. Verify Preview is disabled or exits honestly.

Expected:

- Preview never claims there is burn output when output is disabled.

### Task 9: Stage and Commit the Checkpoint

**Files:**

- Source WIP listed in this plan.
- Test WIP listed in this plan.
- Audit and planning artifacts listed in this plan.

- [ ] **Step 1: Review final status**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- Only intentional Lane 0 files are dirty.

- [ ] **Step 2: Stage intentionally**

Run:

```powershell
git add WORKFLOW.md vite.config.ts src/core/scene/index.ts src/core/scene/selection-transform.ts src/core/scene/selection-transform.test.ts src/core/scene/selection-align.ts src/core/scene/selection-align.test.ts src/core/scene/selection-distribute.ts src/core/scene/selection-distribute.test.ts src/ui/state/selection-transform-actions.ts src/ui/state/selection-transform-actions.test.ts src/ui/state/object-delete-actions.ts src/ui/state/store.ts src/ui/state/store.test.ts src/ui/app/shortcuts.ts src/ui/app/shortcuts.test.ts src/ui/app/shortcuts-docs.test.ts src/ui/app/use-shortcuts.ts src/ui/commands/command-types.ts src/ui/commands/command-families.ts src/ui/commands/command-registry.test.ts src/ui/commands/use-app-commands.ts src/ui/commands/previewable-content.ts src/ui/commands/previewable-content.test.ts
git add audit/prompts/karpathy-laser-bug-hunt-audit-2026-06-15.md audit/findings/karpathy-laser-bug-hunt-findings-2026-06-15.json audit/reports/karpathy-laser-bug-hunt-audit-2026-06-15.md audit/reports/lightburn-feature-gap-list-2026-06-15.md docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md docs/superpowers/plans/2026-06-15-lane-0-stabilize-current-work.md
```

Expected:

- `git diff --cached --stat` shows only the intended files.

- [ ] **Step 3: Commit after final review**

Run:

```powershell
git commit -m "chore: stabilize lane 0 lightburn parity checkpoint"
```

Expected:

- Commit succeeds.

### Task 10: Post-Commit Verification

**Files:**

- Entire repo.

- [ ] **Step 1: Verify no accidental dirty production files**

Run:

```powershell
git status --short --branch
```

Expected:

- Either clean, or only intentionally uncommitted files called out to the user.

- [ ] **Step 2: Record final verification summary**

Summarize:

- commit hash;
- focused tests;
- full gates;
- browser smoke result;
- any accepted warnings;
- any deferred risks.

Do not push or deploy unless the user explicitly asks after seeing this summary.

## Execution Policy

Do not change production code during Lane 0 unless one of the audit tasks finds a
verified bug. If a bug is found:

1. Stop the checkpoint flow.
2. State the exact bug, trigger path, and file/line evidence.
3. Write or adjust a failing test for that bug.
4. Patch the smallest local fix.
5. Restart Lane 0 verification from the relevant focused task.

## Self-Review

Spec coverage:

- Repo boundary covered by Task 1.
- Dirty worktree scope covered by Task 1 and Current Dirty Worktree Map.
- Multi-object transform risk covered by Task 2.
- Store/undo risk covered by Task 3.
- Command/shortcut risk covered by Task 4.
- Preview truth covered by Task 5.
- Safety/output invariants covered by Task 6.
- Full gates covered by Task 7.
- Browser smoke covered by Task 8.
- Commit discipline covered by Tasks 9 and 10.

Placeholder scan:

- No TBD/TODO placeholders.
- Every task has concrete commands and acceptance checks.

Type consistency:

- The plan uses actual current names: `buildSelectionAlignEdit`,
  `buildSelectionDistributeEdit`, `buildSelectionFlipEdit`,
  `buildSelectionNudgeEdit`, `removeSceneObjects`, `hasPreviewableContent`,
  `alignSelection`, `distributeSelection`, `nudgeSelection`, and
  `flipSelection`.
