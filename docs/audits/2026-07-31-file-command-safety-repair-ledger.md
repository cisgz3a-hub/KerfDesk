# CurveDesk menu-command safety repair ledger — 2026-07-31

Status: bundle #1 is under integration correction on draft PR #528 after the
active-job File refusal was held; bundle #2 merged through PR #531 at
`da56b579`.

This is dated evidence for the sequential repair branches. It does not supersede
the living product, workflow, safety, or machine-control authorities.

## Authority and scope

- Bundle #1 correction base: exact `origin/main` commit
  `da56b5793ba9efb86e10fb42323ebc0201e6f059`; branch
  `codex/file-safety-lightburn`; amended draft PR #528.
- Bundle #2 base: exact `origin/main` commit
  `e3d5cc11ed1b3a0a8f0fd37251306de3aa1bca81`; branch
  `codex/inspector-delete-consistency`.
- Ranked repair order:
  1. keep File commands available during an active job while preserving Abort
     reachability through presentation and layout;
  2. unsaved-state preservation after `.lbrn` / `.lbrn2` conversion;
  3. G-code Inspector modal isolation;
  4. node-mode Delete consistency across keyboard, menu, and workspace context
     actions.
- Excluded: Start/Frame policy, controller or firmware behavior, settings,
  hardware, native-picker qualification, and physical output.

## Repair 1 correction — active-job File actions remain available

### Failing reproductions

The held draft introduced three policy violations:

- all ten registered File commands were disabled while a job was active;
- all six File keyboard chords were intercepted with a refusal toast; and
- `confirmDiscardAsync` refused both clean and dirty New/Open flows during an
  active job.

The correction's failing-first run reported 11 expected failures across
`confirm-discard.test.ts`, `shortcuts-file-active-job.test.ts`,
`use-shortcuts-streaming-gate.test.tsx`, and `command-registry.test.ts`.
LightBurn migration and topmost Abort-layout checks passed in that same red
run.

### Narrow repair

- Removed the `fileCommand` active-job disabling constructor and its shared
  refusal copy.
- Removed the active-job intercept from all six File chords (`New`, `Open`,
  `Save`, `Save As`, `Import SVG`, and Save G-code).
- Removed the active-job refusal from `confirmDiscardAsync`; dirty projects
  retain the normal Save / Don't Save / Cancel flow and clean projects retain
  the fast path.
- Added a rendered layout regression proving the persistent Live Motion bar
  retains maximum stacking order and an enabled `ABORT JOB` action while File
  dialogs are presented.
- Existing picker-cancel, save, error, and idle behavior remains unchanged.

### Green evidence

- Focused red-to-green bundle: 6 files, 70 tests passed.
- All ten registered File commands passed enabled-state and invocation checks
  with `jobActive: true`.
- All six File chords reached their normal confirmation or picker path with a
  live streamer and produced no active-job refusal.
- Clean and dirty `Ctrl+N` integration paths passed with a live streamer.
- Abort stayed enabled in the maximum-stacking-order live-motion surface.

## Repair 2 — LightBurn conversion remains unsaved

### Failing reproduction

The original `.lbrn2` test received only `markLoaded('sign.lf2')`; the required
`{ dirty: true }` argument was absent.

### Narrow repair

Every successful `.lbrn` / `.lbrn2` conversion now calls:

`markLoaded(convertedName, { dirty: true })`.

The production save-tracking action also clears `lastSaveTarget`, so a converted
project cannot overwrite the previously opened native project and cannot close
without the unsaved-changes flow.

### Green evidence

- Migration/store bundle: 3 files, 55 tests passed.
- Tests verify both the exact `markLoaded` call and real store state:
  `dirty: true`, the converted `.lf2` name, and `lastSaveTarget: null`.

## Independent review — bundle #1 correction

The original bundle #1 review is superseded because it accepted the
active-job File refusal that was subsequently held as a policy violation. A
fresh independent read-only review inspected the complete corrected diff
against exact base `da56b579` and returned **PRE-PUBLISH PASS — no blocking
findings**.

The reviewer independently passed the 6-file / 70-test focused bundle,
TypeScript, changed-file ESLint, changed-file Prettier, and
`git diff --check`. The reviewer confirmed all ten File commands and all six
File chords remain available during a live streamer; clean and dirty
confirmation paths retain normal behavior; the maximum-stacking-order Live
Motion bar keeps Abort enabled above dialog backdrops; LightBurn conversion
remains dirty and clears the prior save target; and no Start/Frame, controller,
firmware, settings, or hardware production path changed.

A post-publication identity and PR-state audit remains required after the
amended commit is pushed.

## Repair 3 — G-code Inspector modal isolation

### Failing reproduction

The visible Inspector overlay had `role="dialog"` but no `aria-modal`, did not
register in the application's `modalDepth` shortcut gate, and left focus
outside the Inspector. The red test failed with `aria-modal` missing; the same
path also observed modal depth `0` and no owned initial focus.

### Narrow repair

- `GcodeInspectorDialog` now composes the shared `Dialog` shell already used by
  the rest of CurveDesk.
- The shell supplies modal semantics, initial focus, Tab containment, Escape
  handling, focus restoration, and same-commit `modalDepth` registration.
- A feature-specific panel class preserves the Inspector's established
  1400-by-760 maximum workbench footprint and zero-padding layout.
- The Inspector still only parses and renders the opened text. No scene import,
  compile, stream, execution, or machine-control path was added.

### Green evidence

- Inspector/shared-modal/shortcut-gate bundle: 3 files, 12 tests passed.
- The Inspector-specific test verifies `aria-modal="true"`, modal depth `1`,
  and initial focus on Close.
- Existing shared-dialog tests verify Escape and focus restoration; the
  shortcut-gate suite verifies File/Edit/Transform/View commands yield while a
  registered modal is open.

## Repair 4 — node-mode Delete consistency

### Failing reproduction

The keyboard handler already called `deleteSelectedPathNodes` when a path node
was selected. Edit → Delete and workspace-context Delete instead reached the
shared command callback, which always called `removeSceneObjects`. The red
command-shell reproduction expected the vector object to remain but found zero
scene objects.

### Narrow repair

The shared Delete command now reads current selection state when invoked:

- with a selected path node, it calls the existing undoable
  `deleteSelectedPathNodes` action;
- otherwise, it retains the existing batch object-deletion behavior.

Because both the Edit menu and workspace-context surface consume the same
registered command, their behavior now matches the Delete/Backspace keyboard
path.

### Green evidence

- Three rendered command-shell checks pass: Edit → Delete and
  workspace-context Delete each remove one selected node, preserve the vector
  object, and create one undo entry; ordinary Edit → Delete still removes the
  selected whole object outside node mode.
- Keyboard, command registry, and path-node action regression bundle: 4 files,
  67 tests passed.
- Combined repairs #3/#4 focused bundle: 7 files, 81 tests passed.
- TypeScript, ESLint on changed TypeScript files, Prettier on all changed source
  files, and `git diff --check` passed.
- Existing path-node tests verify Undo restoration, invalid-contour and
  missing-reference refusal, bounds updates, and shape-spec synchronization.
  Locked/raster refusal remains source-confirmed in the unchanged node action
  but is not directly exercised by this bundle.
- The direct non-test release gates passed: full source and Electron lint,
  repository formatting, ADR-number and license policy, 14 release-integrity
  tests, web and Electron builds, file-size policy, soft-size report, and index
  export ratchet.
- The package-manager release wrapper stopped before running because it would
  replace this isolated worktree's shared dependency link. A direct full Vitest
  sweep was attempted separately but exceeded 20 minutes without a final
  result; no full-suite pass is claimed. The ranked 81-test bundle was rerun
  successfully after refreshing onto the final base.

## Bundle #2 independent review

An independent read-only reviewer inspected all six changed or untracked files
against the exact current base and returned **PASS — no blocking findings**.

The reviewer confirmed:

- the shared Dialog supplies `aria-modal`, initial focus, Tab containment,
  Escape, focus restoration, and same-commit shortcut isolation;
- the Inspector remains parse/render-only and adds no scene, compile, stream,
  execution, Start, or machine-control path;
- the feature-specific CSS retains the prior workbench footprint;
- Edit-menu and workspace-context Delete share the live node-mode action;
- ordinary object deletion, one-step Undo, and invalid/missing-reference safety
  remain intact;
- no Start/Frame, controller, firmware, settings, hardware, or Abort behavior
  changed.

The reviewer independently passed the 7-file / 81-test focused bundle,
TypeScript, changed-file ESLint, Prettier, and `git diff --check`.

Non-blocking P3 coverage note: locked/raster node-deletion refusal is
source-confirmed in the unchanged action but lacks a direct Delete invocation in
the existing test bundle.

## Residual qualification boundary

These bundles establish source, state, command-registry, keyboard, and rendered
surface behavior. They do not qualify native OS pickers, packaged Electron,
controller timing, machine motion, placement, burn quality, or any other
physical behavior. No hardware was connected or operated.
